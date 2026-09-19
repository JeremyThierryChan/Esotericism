/**
 * 内容库测试 = CI 校验的硬门。
 *
 * 依据：ADR-0008 step 2「手写一条真实内容穿过 schema」，验收标准 = 内容通过校验并入库。
 * 因此这里的断言不是"跑通就行"，而是逐条验证**这条内容确实穿过了我们想验证的机制**。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import {
  sameFormalismProjection,
  validateBundle,
  type ContentBundle,
  type ValidationReport,
} from '@dlg/domain';
import { loadBundle } from '../src/load.js';

let bundle: ContentBundle;
let report: ValidationReport;

beforeAll(async () => {
  const loaded = await loadBundle();
  if (!loaded.ok || !loaded.bundle) {
    throw new Error(`bundle.json 未通过 schema 校验：\n${(loaded.schemaIssues ?? []).join('\n')}`);
  }
  bundle = loaded.bundle;
  report = validateBundle(bundle);
});

describe('内容库通过 schema 与 CI 校验', () => {
  it('无 error 级问题（ADR-0008 step 2 的验收标准）', () => {
    if (report.errors.length > 0) {
      throw new Error(
        'CI 校验失败：\n' +
          report.errors.map((e) => `[${e.rule}] ${e.entity_kind}:${e.entity_id} — ${e.message}`).join('\n'),
      );
    }
    expect(report.ok).toBe(true);
  });

  it('全部条目处于 draft —— 因为唯一来源 R1 本身是 draft', () => {
    const all = [
      ...bundle.formalism,
      ...bundle.attribute_spaces,
      ...bundle.symbols,
      ...bundle.systems,
      ...bundle.schools,
      ...bundle.concepts,
      ...bundle.schemas,
      ...bundle.rules,
      ...bundle.skills,
      ...bundle.rubrics,
      ...bundle.assessment_specs,
      ...bundle.exercises,
    ];
    expect(all.length).toBeGreaterThan(0);
    expect(all.every((e) => e.provenance.review_status === 'draft')).toBe(true);
  });
});

// ── 点 1：B0 的 A 类样本，验证机制 A（同源投影） ──────────────────────────────

describe('点 1 · B0 · S4 五行生克方向（ADR-0013 A 类样本）', () => {
  it('五行取值是 Symbol 且 kind = attribute_value（ADR-0010）', () => {
    const sp = bundle.attribute_spaces.find((s) => s.id === 'space.wuxing');
    expect(sp).toBeDefined();
    expect(sp?.value_symbol_ids).toHaveLength(5);
    for (const vid of sp?.value_symbol_ids ?? []) {
      const sym = bundle.symbols.find((s) => s.id === vid);
      expect(sym?.symbol_kind, `${vid} 应为 attribute_value`).toBe('attribute_value');
      expect(sym?.formalism_id).toBe('east-xiangshu');
    }
  });

  it('生克是有向的 Symbol↔Symbol 关系（这正是 ADR-0010 要救回来的东西）', () => {
    const sheng = bundle.relations.filter((r) => r.subtype === '生');
    const ke = bundle.relations.filter((r) => r.subtype === '克');
    expect(sheng).toHaveLength(5);
    expect(ke).toHaveLength(5);
    expect(bundle.relations.every((r) => r.direction === 'forward')).toBe(true);
  });

  it('相生闭循环成立：木→火→土→金→水→木', () => {
    const sheng = bundle.relations.filter((r) => r.subtype === '生');
    const next = new Map(sheng.map((r) => [r.from_symbol_id, r.to_symbol_id]));
    let cur = 'sym.wuxing.木';
    const visited: string[] = [];
    for (let i = 0; i < 5; i++) {
      visited.push(cur);
      const n = next.get(cur);
      expect(n, `${cur} 没有相生对象`).toBeDefined();
      cur = n as string;
    }
    expect(cur).toBe('sym.wuxing.木'); // 回到起点 = 闭循环
    expect(new Set(visited).size).toBe(5); // 五个都走到，不重复
  });

  it('相克闭循环成立：木→土→水→火→金→木', () => {
    const ke = bundle.relations.filter((r) => r.subtype === '克');
    const next = new Map(ke.map((r) => [r.from_symbol_id, r.to_symbol_id]));
    let cur = 'sym.wuxing.木';
    for (let i = 0; i < 5; i++) {
      cur = next.get(cur) as string;
      expect(cur).toBeDefined();
    }
    expect(cur).toBe('sym.wuxing.木');
  });

  it('**机制 A 派生视图**：五行符号被六爻与梅花两个体系共用，可自动推导（不落库、无人工边）', () => {
    const proj = sameFormalismProjection(bundle.symbols, bundle.symbol_usages);
    const mu = proj.find((p) => p.symbol_id === 'sym.wuxing.木');
    expect(mu).toBeDefined();
    expect(mu?.system_count).toBe(2);
    expect(mu?.usages.map((u) => u.system_id).sort()).toEqual(['system.liuyao', 'system.meihua']);
    // 关键：这些体系关系**没有**用 transfers_as 边表达
    expect(bundle.transfer_edges.some((e) => e.from_node_id === 'sym.wuxing.木')).toBe(false);
  });

  it('规则判分的题有 answer_key，且题型与判分方式一致（R12/R13）', () => {
    const ex = bundle.exercises.find((e) => e.id === 'ex.b0.s4.wuxing-1');
    expect(ex?.kind).toBe('关系判断');
    expect(ex?.answer_key?.rule_id).toBe('rule.wuxing.shengke');
    const skill = bundle.skills.find((s) => s.id === 'skill.b0.s4.wuxing-direction');
    expect(skill?.judging_mode).toBe('规则判定');
  });

  it('规则自带验证集（M6），且验证集可被真值表复算', () => {
    const ts = bundle.rule_test_sets.find((t) => t.rule_id === 'rule.wuxing.shengke');
    expect(ts).toBeDefined();
    expect(ts?.cases.length).toBeGreaterThanOrEqual(5);
    // 用一个最小规则引擎实现跑一遍验证集
    const sheng = bundle.relations.filter((r) => r.subtype === '生').map((r) => [r.from_symbol_id, r.to_symbol_id]);
    const ke = bundle.relations.filter((r) => r.subtype === '克').map((r) => [r.from_symbol_id, r.to_symbol_id]);
    const idOf = (name: string) => `sym.wuxing.${name}`;
    const relationOf = (a: string, b: string) => {
      if (a === b) return { relation: 'none', direction: 'none' };
      const A = idOf(a);
      const B = idOf(b);
      if (sheng.some(([x, y]) => x === A && y === B)) return { relation: '生', direction: 'a→b' };
      if (sheng.some(([x, y]) => x === B && y === A)) return { relation: '生', direction: 'b→a' };
      if (ke.some(([x, y]) => x === A && y === B)) return { relation: '克', direction: 'a→b' };
      if (ke.some(([x, y]) => x === B && y === A)) return { relation: '克', direction: 'b→a' };
      return { relation: 'none', direction: 'none' };
    };
    for (const c of ts?.cases ?? []) {
      const inp = c.input as { a: string; b: string };
      expect(relationOf(inp.a, inp.b), `用例 ${inp.a}/${inp.b}`).toEqual(c.expected);
    }
  });
});

// ── 点 2：跨体系节点 B，验证类型 3 边 + 反向练习 ────────────────────────────

describe('点 2 · 塔罗 ↔ 占星（类型 3，historicity = 重建；ADR-0014）', () => {
  it('这是类型 3 且声明了 historicity = 重建', () => {
    const e = bundle.transfer_edges.find((x) => x.id === 'edge.tarot-astro.strength-leo');
    expect(e?.transfer_type).toBe(3);
    expect(e?.historicity).toBe('重建');
  });

  it('两端分属不同 Formalism —— 所以是「边」而不是共享符号（ADR-0009 的核心判定）', () => {
    const e = bundle.transfer_edges.find((x) => x.id === 'edge.tarot-astro.strength-leo');
    const from = bundle.symbols.find((s) => s.id === e?.from_node_id);
    const to = bundle.symbols.find((s) => s.id === e?.to_node_id);
    expect(from?.formalism_id).toBe('tarot-symbolic');
    expect(to?.formalism_id).toBe('planetary-zodiac');
    expect(from?.formalism_id).not.toBe(to?.formalism_id);
  });

  it('反向练习真实存在且双向确认（ADR-0014 强制；这是 R3 补 Exercise 后才真正可执行的）', () => {
    const e = bundle.transfer_edges.find((x) => x.id === 'edge.tarot-astro.strength-leo');
    const rev = bundle.exercises.find((x) => x.id === e?.paired_reverse_exercise_id);
    expect(rev).toBeDefined();
    expect(rev?.is_reverse_exercise_of_edge_id).toBe('edge.tarot-astro.strength-leo');
  });

  it('反向练习的素材是可查证史实（RWS/托特 VIII–XI 次序），不是自造的教学例子', () => {
    const rev = bundle.exercises.find((x) => x.id === 'ex.reverse.strength-order');
    expect(rev?.prompt).toContain('VIII');
    expect(rev?.prompt).toContain('Golden Dawn');
  });

  it('四段式结构完整，且第 ④ 段的迁移练习存在（V0.1 §8.2：缺一不可）', () => {
    const e = bundle.transfer_edges.find((x) => x.id === 'edge.tarot-astro.strength-leo');
    expect(e?.four_part_structure).toBeDefined();
    const fp = e?.four_part_structure;
    expect(fp?.known.length).toBeGreaterThan(0);
    expect(fp?.in_new_system.length).toBeGreaterThan(0);
    expect(fp?.relation_declaration).toContain('重建');
    expect(bundle.exercises.some((x) => x.id === fp?.transfer_exercise_id)).toBe(true);
  });

  it('来源链是 R1 给的可查文献：Lévi 1856 → Golden Dawn Book T 1888 → Dummett & Decker', () => {
    const e = bundle.transfer_edges.find((x) => x.id === 'edge.tarot-astro.strength-leo');
    const refs = (e?.sources ?? []).map((s) => s.ref).join(' | ');
    expect(refs).toContain('1856');
    expect(refs).toContain('Book T');
    expect(refs).toContain('Dummett');
  });

  it('Rubric 的 forbidden 拦住「断言同源」与确定性话术（认识论原则 4/6）', () => {
    const r = bundle.rubrics.find((x) => x.id === 'rubric.astro-reconstruction');
    const forbidden = (r?.forbidden ?? []).join(' | ');
    expect(forbidden).toContain('本相通');
    expect(forbidden).toContain('确定性话术');
  });
});

// ── 禁用语在真实内容上不误报也不漏报 ────────────────────────────────────────

describe('R9 禁用语检查在真实内容上的表现', () => {
  it('当前内容库没有触发任何禁用语', () => {
    expect(report.errors.filter((e) => e.rule === 'R9')).toEqual([]);
  });

  it('四段式的「关系声明」文案正确声明了重建性质，未被误判为等价断言', () => {
    const t = bundle.content_texts.find((x) => x.id === 'text.edge.tarot-astro.relation-declaration');
    expect(t?.text).toContain('不是塔罗的原生理论');
  });
});
