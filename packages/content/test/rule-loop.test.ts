/**
 * 纯规则闭环在**真实内容库**上的验收测试
 *
 * 与 domain 的 `rule-loop.test.ts` 的分工：
 *   · domain 侧用人工夹具测边界与反刷分
 *   · 这里用**真实 bundle.json** 测「端到端跑得通、且判分零误判」
 */
import { describe, expect, it, beforeAll } from 'vitest';
import {
  appendToLedger,
  validateBundle,
  computeSkillMastery,
  createRuleJudge,
  dimensionValueOrNull,
  evidenceFromAttempt,
  generateExercises,
  scoreAttempt,
  toJudgeableExercise,
  type ContentBundle,
  type Evidence,
  type ScoreLedger,
} from '@dlg/domain';
import { PALACES, TRIGRAM_BY_BITS, TRIGRAM_ELEMENT } from '@dlg/domain/liuyao';
import { loadBundle } from '../src/load.js';

let bundle: ContentBundle;
beforeAll(async () => {
  const loaded = await loadBundle();
  if (!loaded.ok || !loaded.bundle) throw new Error('bundle.json 未通过 schema 校验');
  bundle = loaded.bundle;
});

const WUXING_TPL = 'tpl.b0.s4.wuxing-relation';
/** 取某题组的生成题 */
const ofTemplate = (id: string) => generateExercises(bundle).instances.filter((i) => i.template_id === id);
/** 按实例取它自己的模板（不能假定 exercises_templates[0]） */
const tplOf = (instanceId: string) => {
  const inst = generateExercises(bundle).instances.find((i) => i.id === instanceId)!;
  return bundle.exercise_templates.find((t) => t.id === inst.template_id)!;
};

describe('真实内容库 · 题目生成', () => {
  it('五行题组生成出 25 题（5 个符号的全有序对）', () => {
    const report = generateExercises(bundle).byTemplate.find((t) => t.template_id === WUXING_TPL);
    expect(report?.count).toBe(25);
    expect(report?.skipped).toEqual([]);
    expect(ofTemplate(WUXING_TPL)).toHaveLength(25);
  });

  it('每个有序对都恰好一题，无重复无遗漏', () => {
    const instances = ofTemplate(WUXING_TPL);
    const ids = instances.map((i) => i.id);
    expect(new Set(ids).size).toBe(25);
    const pairs = new Set(instances.map((i) => `${i.params.a}|${i.params.b}`));
    expect(pairs.size).toBe(25);
  });

  it('答案分布合理：含相生、相克、以及 5 个自身配对的「无作用关系」', () => {
    const instances = ofTemplate(WUXING_TPL);
    const labels = instances.map((i) => String((i.answer_key.expected as { label?: string }).label));
    expect(labels.filter((l) => l.endsWith('相生'))).toHaveLength(10); // 5 条生边 × 2 方向
    expect(labels.filter((l) => l.endsWith('相克'))).toHaveLength(10); // 5 条克边 × 2 方向
    expect(labels.filter((l) => l === '无作用关系')).toHaveLength(5); // 自身配对
  });
});

describe('真实内容库 · 判分零误判', () => {
  it('五行题组 25/25：按标准答案作答 → 全部通过', () => {
    const judge = createRuleJudge({ bundle });
    let passed = 0;
    for (const inst of ofTemplate(WUXING_TPL)) {
      const tpl = bundle.exercise_templates.find((t) => t.id === inst.template_id)!;
      if (judge.judge(toJudgeableExercise(inst, tpl), String((inst.answer_key.expected as { label?: string }).label)).passed) {
        passed++;
      }
    }
    expect(passed).toBe(25);
  });

  it('五行题组：任何错误选项都判为不通过（逐题穷举全部错项）', () => {
    const judge = createRuleJudge({ bundle });
    let wrongOptionAttempts = 0;
    let falsePasses = 0;
    for (const inst of ofTemplate(WUXING_TPL)) {
      const ex = toJudgeableExercise(inst, tplOf(inst.id));
      const correct = String((inst.answer_key.expected as { label?: string }).label);
      for (const c of inst.answer_key.choices ?? []) {
        if (c === correct) continue;
        wrongOptionAttempts++;
        if (judge.judge(ex, c).passed) falsePasses++;
      }
    }
    expect(wrongOptionAttempts).toBeGreaterThan(80); // 25 题 × 4 个错项
    expect(falsePasses).toBe(0);
  });
});

describe('真实内容库 · 闭环可跑通（题目→判分→证据→掌握度→积分）', () => {
  it('连续答对 8 题：掌握度从「数据不足」过渡到可估数值，且积分递减', () => {
    const tpl = bundle.exercise_templates.find((t) => t.id === WUXING_TPL)!;
    const skillId = tpl.skill_ids[0]!;
    const judge = createRuleJudge({ bundle });
    const instances = ofTemplate(WUXING_TPL);

    const evidence: Evidence[] = [];
    let ledger: ScoreLedger = { total: 0, entries: [] };
    const attemptCount: Record<string, number> = {};
    const pointsPerRound: number[] = [];

    instances.slice(0, 8).forEach((inst, i) => {
      const ex = toJudgeableExercise(inst, tpl);
      const chosen = String((inst.answer_key.expected as { label?: string }).label);
      const record = judge.judge(ex, chosen);
      expect(record.passed).toBe(true);

      const before = dimensionValueOrNull(computeSkillMastery(skillId, evidence), '应用');
      const ev = evidenceFromAttempt({
        attempt_id: `at.${i}`,
        exercise_kind: inst.kind,
        skill_id: skillId,
        passed: record.passed,
        decided_by: record.decided_by,
        submitted_at: new Date(Date.UTC(2026, 8, 19, 10, i)).toISOString(),
      });
      evidence.push(ev);
      const after = dimensionValueOrNull(computeSkillMastery(skillId, evidence), '应用');

      const prior = attemptCount[inst.id] ?? 0;
      const score = scoreAttempt({
        exercise_id: inst.id,
        exercise_kind: inst.kind,
        difficulty: inst.difficulty,
        mastery_before: before,
        mastery_after: after,
        prior_attempts_on_this_exercise: prior,
        passed: record.passed,
      });
      attemptCount[inst.id] = prior + 1;
      ledger = appendToLedger(ledger, {
        ...score,
        attempt_id: `at.${i}`,
        exercise_id: inst.id,
        skill_ids: inst.skill_ids,
        at: ev.created_at,
      });
      pointsPerRound.push(score.points);
    });

    // 前几轮样本不足 → 按「首次接触」给分；第 3 轮起掌握度可估（应用维度全对 → 1.0）
    const m = computeSkillMastery(skillId, evidence);
    const applied = m.dimensions.find((d) => d.dimension === '应用')!;
    expect(applied.status).toBe('初步');
    expect(applied.value).toBe(1);

    // 掌握度到顶后，后续答对**不再产生积分**（闸门 A）—— 这是反刷分在真实数据上的表现
    const lastPoints = pointsPerRound[pointsPerRound.length - 1] ?? 0;
    expect(lastPoints).toBe(0);

    expect(ledger.total).toBeGreaterThan(0);
    expect(ledger.entries).toHaveLength(8);
    expect(ledger.entries.every((e) => e.skill_ids.includes(skillId))).toBe(true);
  });

  it('同一题反复答对：积分随重复次数衰减到 0', () => {
    const tpl = bundle.exercise_templates.find((t) => t.id === WUXING_TPL)!;
    const skillId = tpl.skill_ids[0]!;
    const inst = ofTemplate(WUXING_TPL)[1]!;
    const points: number[] = [];
    for (let n = 0; n < 6; n++) {
      points.push(
        scoreAttempt({
          exercise_id: inst.id,
          exercise_kind: inst.kind,
          difficulty: inst.difficulty,
          mastery_before: 0.1,
          mastery_after: 0.4,
          prior_attempts_on_this_exercise: n,
          passed: true,
        }).points,
      );
    }
    // 单调不增，且最终为 0
    for (let i = 1; i < points.length; i++) {
      expect(points[i]!).toBeLessThanOrEqual(points[i - 1]!);
    }
    expect(points[points.length - 1]).toBe(0);
    expect(skillId).toBeTruthy();
  });
});

// ── 第二组内容：由爻定卦（表驱动）────────────────────────────────────────────

describe('六爻基础 · 由爻定卦（表驱动，来自已核数据）', () => {
  const gen = () => generateExercises(bundle);

  it('三个题组共生成 97 题（8 + 25 + 64）', () => {
    const byTpl = Object.fromEntries(gen().byTemplate.map((t) => [t.template_id, t.count]));
    expect(byTpl['tpl.liuyao.trigram']).toBe(8);
    expect(byTpl['tpl.b0.s4.wuxing-relation']).toBe(25);
    expect(byTpl['tpl.liuyao.hexagram']).toBe(64);
    expect(gen().instances).toHaveLength(97);
  });

  it('位组合枚举覆盖全部 2^n 种，无重复无遗漏', () => {
    for (const [tid, n] of [
      ['tpl.liuyao.trigram', 3],
      ['tpl.liuyao.hexagram', 6],
    ] as const) {
      const bits = gen()
        .instances.filter((i) => i.template_id === tid)
        .map((i) => i.params.bits);
      expect(bits).toHaveLength(2 ** n);
      expect(new Set(bits).size).toBe(2 ** n);
    }
  });

  it('三爻→八卦的答案与《梅花易數》取象口诀一致（震仰盂=100、艮覆碗=001…）', () => {
    const list = gen().instances.filter((i) => i.template_id === 'tpl.liuyao.trigram');
    const nameOf = (bits: string) => String((list.find((i) => i.params.bits === bits)!.answer_key.expected as { name?: string }).name);
    expect(nameOf('111')).toBe('乾');
    expect(nameOf('000')).toBe('坤');
    expect(nameOf('100')).toBe('震'); // 仰盂：初爻阳
    expect(nameOf('001')).toBe('艮'); // 覆碗：上爻阳
    expect(nameOf('101')).toBe('离'); // 中虚
    expect(nameOf('010')).toBe('坎'); // 中满
    expect(nameOf('110')).toBe('兑'); // 上缺
    expect(nameOf('011')).toBe('巽'); // 下断
  });

  it('六爻→世应的答案与八宫卦序一致（抽查各位置类型）', () => {
    const list = gen().instances.filter((i) => i.template_id === 'tpl.liuyao.hexagram');
    const rowOf = (bits: string) => list.find((i) => i.params.bits === bits)!.answer_key.expected as Record<string, unknown>;
    // 乾为天：本宫世 6 应 3
    expect(rowOf('111111')).toMatchObject({ name: '乾为天', palace: '乾宫', shi: 6, ying: 3, position_kind: '本宫' });
    // 天风姤：一世世 1 应 4
    expect(rowOf('011111')).toMatchObject({ name: '天风姤', shi: 1, ying: 4, position_kind: '一世' });
    // 火地晋：游魂世 4 应 1
    expect(rowOf('000101')).toMatchObject({ name: '火地晋', palace: '乾宫', shi: 4, ying: 1, position_kind: '游魂' });
    // 火天大有：归魂世 3 应 6
    expect(rowOf('111101')).toMatchObject({ name: '火天大有', shi: 3, ying: 6, position_kind: '归魂' });
  });

  it('选项取自规则表的去重取值，且**正确答案一定在选项里**', () => {
    for (const inst of gen().instances) {
      const choices = inst.answer_key.choices;
      expect(choices, `${inst.id} 缺选项`).toBeDefined();
      const label = String((inst.answer_key.expected as { label?: string }).label);
      expect(choices, `${inst.id}: 正确答案「${label}」不在选项里`).toContain(label);
    }
  });

  it('97/97 题按标准答案作答全部通过；穷举全部错项 0 误判', () => {
    const judge = createRuleJudge({ bundle });
    let passed = 0;
    let wrongAttempts = 0;
    let falsePasses = 0;
    for (const inst of gen().instances) {
      const tpl = bundle.exercise_templates.find((t) => t.id === inst.template_id)!;
      const ex = toJudgeableExercise(inst, tpl);
      const correct = String((inst.answer_key.expected as { label?: string }).label);
      if (judge.judge(ex, correct).passed) passed++;
      for (const c of inst.answer_key.choices ?? []) {
        if (c === correct) continue;
        wrongAttempts++;
        if (judge.judge(ex, c).passed) falsePasses++;
      }
    }
    expect(passed).toBe(97);
    expect(wrongAttempts).toBeGreaterThan(400);
    expect(falsePasses).toBe(0);
  });

  it('规则表与列定义一致（CI 规则 R20），且表行数正确', () => {
    const tri = bundle.rules.find((r) => r.id === 'rule.liuyao.trigram-by-yao')!;
    const hex = bundle.rules.find((r) => r.id === 'rule.liuyao.hexagram-by-yao')!;
    expect(tri.table?.rows).toHaveLength(8);
    expect(hex.table?.rows).toHaveLength(64);
    expect(validateBundle(bundle).errors.filter((e) => e.rule === 'R20')).toEqual([]);
  });

  it('八卦的五行归属与 has_attribute 一致（表与知识图谱不得分叉）', () => {
    const values: Record<string, string> = { 金: 'sym.wuxing.金', 水: 'sym.wuxing.水', 木: 'sym.wuxing.木', 火: 'sym.wuxing.火', 土: 'sym.wuxing.土' };
    const tri = bundle.rules.find((r) => r.id === 'rule.liuyao.trigram-by-yao')!;
    for (const row of tri.table!.rows) {
      const link = bundle.has_attributes.find((h) => h.symbol_id === `sym.bagua.${String(row.name)}`);
      expect(link, `八卦 ${String(row.name)} 没有 has_attribute`).toBeDefined();
      expect(link!.value_symbol_id).toBe(values[String(row.element)]);
    }
  });

  it('规则表不带来源就进不了 reviewed（R1a/R19 在表驱动规则上同样生效）', () => {
    const b = structuredClone(bundle) as ContentBundle;
    const rule = b.rules.find((r) => r.id === 'rule.liuyao.hexagram-by-yao')!;
    rule.provenance.review_status = 'reviewed';
    rule.provenance.verifications = [];
    expect(validateBundle(b).errors.map((e) => e.rule)).toContain('R19');
  });
});

// ── 防分叉：代码里的 spike 表 与 内容库里的规则表 必须一致 ──────────────────
//
// 八宫卦序现在有两份表示：
//   ① packages/domain/src/liuyao/tables.ts —— spike 期写下的代码常量（已对照古典文献核对）
//   ② packages/content/bundle.json 的 rule.table —— 内容的正式归属，带来源与复核记录
// 两份独立表示**一致**本身就是一种交叉验证；但它们也可能各自漂移，所以必须有测试看着。
// 将来若删除 ①，这个测试就是「内容库与古典文献对照结果一致」的回归基线。

describe('防分叉 · 代码 spike 表 vs 内容库规则表', () => {
  it('八卦位编码一致（8 个位组合）', () => {
    const tri = bundle.rules.find((r) => r.id === 'rule.liuyao.trigram-by-yao')!;
    const fromContent = Object.fromEntries(tri.table!.rows.map((r) => [String(r.bits), String(r.name)]));
    expect(fromContent).toEqual({ ...TRIGRAM_BY_BITS });
  });

  it('八卦五行一致（8 个）', () => {
    const tri = bundle.rules.find((r) => r.id === 'rule.liuyao.trigram-by-yao')!;
    const fromContent = Object.fromEntries(tri.table!.rows.map((r) => [String(r.name), String(r.element)]));
    expect(fromContent).toEqual({ ...TRIGRAM_ELEMENT });
  });

  it('六十四卦的卦名/上下卦/宫/宫五行/世位/位次 全部一致（64 行逐条）', () => {
    const hex = bundle.rules.find((r) => r.id === 'rule.liuyao.hexagram-by-yao')!;
    const bitsOf = (t: string) => Object.entries(TRIGRAM_BY_BITS).find(([, n]) => n === t)![0];
    const fromCode = new Map<string, Record<string, string | number>>();
    for (const p of PALACES) {
      for (const e of p.entries) {
        fromCode.set(`${bitsOf(e.lower)}/${bitsOf(e.upper)}`, {
          name: e.name, upper_name: e.upper, lower_name: e.lower,
          palace: p.name, palace_element: p.element, shi: e.shi, position_kind: e.position_kind,
        });
      }
    }
    expect(hex.table!.rows).toHaveLength(64);
    for (const row of hex.table!.rows) {
      const code = fromCode.get(String(row.key));
      expect(code, `内容库有而代码表没有：${String(row.key)}`).toBeDefined();
      expect({ ...row, key: undefined }).toEqual({ ...code, key: undefined });
    }
    expect(fromCode.size).toBe(64);
  });
});
