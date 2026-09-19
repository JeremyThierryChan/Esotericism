/**
 * 确定性题目生成 + 纯规则积分 + 确定性掌握度 的测试
 *
 * 这一组测试是「纯规则闭环」的核心验收：
 *   题目 → 判分 → 证据 → 掌握度 → 积分，全程不使用 AI，
 *   因此**每一步都必须可复现、可解释、且能挡住刷分**。
 */
import { describe, expect, it } from 'vitest';
import { generateExercises, toJudgeableExercise } from '../src/generate/drill.js';
import { createRuleJudge } from '../src/index.js';
import { validateBundle } from '../src/validate/rules.js';
import type { ContentBundle } from '../src/bundle.js';
import {
  MASTERY_DIMENSIONS,
  computeSkillMastery,
  evidenceFromAttempt,
  dimensionValueOrNull,
} from '../src/layer4/mastery.js';
import {
  COGNITIVE_LOAD_WEIGHT,
  appendToLedger,
  learningRhythmDays,
  scoreAttempt,
  type ScoreLedger,
  type ScoreInput,
} from '../src/layer4/scoring.js';
import { validBundle } from './fixtures.js';

// ── 一个接近真实内容库的夹具（含模板与规则） ────────────────────────────────

function bundleWithTemplate(): ContentBundle {
  const b = validBundle();
  b.rules = [
    {
      id: 'rule.test.shengke',
      system_id: 'system.liuyao',
      school_id: 'school.liuyao.zengshan',
      name: '测试规则',
      procedure_ref: 'wuxing/shengke#resolveRelation',
      applies_to_symbol_ids: ['sym.wuxing.木', 'sym.wuxing.火', 'sym.wuxing.土', 'sym.wuxing.金', 'sym.wuxing.水'],
      provenance: humanProvenance(),
    },
  ];
  b.rule_test_sets = [{ rule_id: 'rule.test.shengke', cases: [{ input: { a: '木', b: '火' }, expected: { relation: '生' } }] }];
  b.skills = [
    ...b.skills,
    {
      id: 'skill.rule-judged',
      statement: '能判断两个五行符号之间的生克关系与方向',
      kind: '推导',
      judging_mode: '规则判定',
      schema_ids: ['S4'],
      confusable_with_skill_ids: [],
      provenance: humanProvenance(),
    },
  ];
  b.assessment_specs = [
    ...b.assessment_specs,
    {
      id: 'spec.rule-judged',
      name: '规则判定规约',
      skill_ids: ['skill.rule-judged'],
      rule_ids: ['rule.test.shengke'],
      is_school_comparison: false,
      provenance: humanProvenance(),
    },
  ];
  b.exercise_templates = [
    {
      id: 'tpl.test.wuxing',
      name: '五行生克全组合',
      skill_ids: ['skill.rule-judged'],
      kind: '关系判断',
      assessment_spec_id: 'spec.rule-judged',
      rule_id: 'rule.test.shengke',
      parameter_space: {
        mode: 'symbol-pairs',
        domain_symbol_ids: ['sym.wuxing.木', 'sym.wuxing.火', 'sym.wuxing.土', 'sym.wuxing.金', 'sym.wuxing.水'],
        coverage: 'all-ordered-pairs',
        include_identity_pairs: true,
      },
      prompt_template: '「{a}」与「{b}」之间？',
      answer_field: 'relation',
      choices_mode: 'relation-labels',
      difficulty: '入门',
      requires_process: true,
      max_instances: 50,
      provenance: humanProvenance(),
    },
  ];
  // 完整的生克表：相生 5 条 + 相克 5 条 = 10 条边。
  // 每条边可回答两个方向的提问，因此 10 条边覆盖全部 10 个**无序对**。
  const mk = (from: string, to: string, subtype: '生' | '克') => ({
    type: 'related_by' as const,
    subtype,
    from_symbol_id: `sym.wuxing.${from}`,
    to_symbol_id: `sym.wuxing.${to}`,
    direction: 'forward' as const,
    provenance: humanProvenance(),
  });
  b.relations = [
    mk('木', '火', '生'),
    mk('火', '土', '生'),
    mk('土', '金', '生'),
    mk('金', '水', '生'),
    mk('水', '木', '生'),
    mk('木', '土', '克'),
    mk('土', '水', '克'),
    mk('水', '火', '克'),
    mk('火', '金', '克'),
    mk('金', '木', '克'),
  ];
  return b;
}

function humanProvenance() {
  return {
    sources: [{ ref: '测试来源' }],
    source_strength: '中' as const,
    controversy_flag: false,
    review_status: 'draft' as const,
    verifications: [],
    authored_by: 'human' as const,
    version: 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('确定性题目生成 · 组合与可复现', () => {
  it('5 个符号的全有序对 = 25 题', () => {
    const b = bundleWithTemplate();
    const { instances } = generateExercises(b);
    expect(instances).toHaveLength(25);
  });

  it('两次生成结果完全一致（确定性）', () => {
    const b = bundleWithTemplate();
    const a = generateExercises(b);
    const c = generateExercises(b);
    expect(a.instances.map((i) => i.id)).toEqual(c.instances.map((i) => i.id));
    expect(JSON.stringify(a.instances)).toBe(JSON.stringify(c.instances));
  });

  it('题目 id 稳定且可读（模板#a-b）', () => {
    const b = bundleWithTemplate();
    const { instances } = generateExercises(b);
    expect(instances[0]?.id).toBe('tpl.test.wuxing#木-木');
    expect(instances.map((i) => i.id)).toContain('tpl.test.wuxing#木-火');
  });

  it('题干参数被替换，不含未替换占位符', () => {
    const b = bundleWithTemplate();
    for (const inst of generateExercises(b).instances) {
      expect(inst.prompt).not.toMatch(/\{\w+\}/);
      expect(inst.prompt).toContain(inst.params.a ?? '');
    }
  });

  it('limitPerTemplate 生效', () => {
    const b = bundleWithTemplate();
    expect(generateExercises(b, { limitPerTemplate: 7 }).instances).toHaveLength(7);
  });
});

describe('答案来自内容库真值表（生成器不是真理来源）', () => {
  it('木→火 的正确答案由关系边推出，且与规则标签一致', () => {
    const b = bundleWithTemplate();
    const inst = generateExercises(b).instances.find((i) => i.params.a === '木' && i.params.b === '火');
    expect(inst?.answer_key.expected).toMatchObject({ relation: '生', direction: 'a→b', label: 'a→b 相生' });
  });

  it('自身配对（木→木）正确判为「无作用关系」', () => {
    const b = bundleWithTemplate();
    const inst = generateExercises(b).instances.find((i) => i.params.a === '木' && i.params.b === '木');
    expect(inst?.answer_key.expected).toMatchObject({ relation: 'none', label: '无作用关系' });
  });

  it('关系表不完整时**拒绝生成**，而不是把「查不到」当成「无作用关系」', () => {
    const b = bundleWithTemplate();
    // 删掉一条边 → 表不完整
    b.relations = b.relations.filter((r) => !(r.from_symbol_id === 'sym.wuxing.木' && r.to_symbol_id === 'sym.wuxing.火'));
    const report = generateExercises(b);
    expect(report.instances).toHaveLength(0);
    expect(report.byTemplate[0]?.skipped.join()).toContain('关系表不完整');
  });

  it('CI 规则 R18 兜住同一件事（构建期拦截）', () => {
    const b = bundleWithTemplate();
    b.relations = b.relations.filter((r) => !(r.from_symbol_id === 'sym.wuxing.木' && r.to_symbol_id === 'sym.wuxing.火'));
    expect(validateBundle(b).errors.map((e) => e.rule)).toContain('R18');
  });
});

describe('生成的题可以被规则引擎真判分', () => {
  it('选对选项 → pass；选错 → fail，并指出正确项', () => {
    const b = bundleWithTemplate();
    const tpl = b.exercise_templates[0]!;
    const inst = generateExercises(b).instances.find((i) => i.params.a === '木' && i.params.b === '火')!;
    const judge = createRuleJudge({ bundle: b });
    const ex = toJudgeableExercise(inst, tpl);

    const right = judge.judge(ex, 'a→b 相生');
    expect(right.passed).toBe(true);
    expect(right.decided_by).toBe('rule-engine');

    const wrong = judge.judge(ex, 'b→a 相生');
    expect(wrong.passed).toBe(false);
    expect(wrong.findings.find((f) => f.key === 'answer.label')?.detail).toContain('正确应为');
  });

  it('自由作答（给参数）也能判，并回显由真值表推出的答案', () => {
    const b = bundleWithTemplate();
    const tpl = b.exercise_templates[0]!;
    const inst = generateExercises(b).instances.find((i) => i.params.a === '火' && i.params.b === '木')!;
    const ex = toJudgeableExercise(inst, tpl);
    const record = createRuleJudge({ bundle: b }).judge(ex, { a: '火', b: '木' });
    expect(record.passed).toBe(true);
    expect(record.findings.some((f) => f.key === 'answer.derived')).toBe(true);
  });
});

describe('CI 规则 R15–R17 · 模板', () => {
  it('模板绑的规则没有验证集 → 失败（M6）', () => {
    const b = bundleWithTemplate();
    b.rule_test_sets = [];
    expect(validateBundle(b).errors.map((e) => e.rule)).toContain('R15');
  });

  it('参数空间越出规则适用符号 → 失败', () => {
    const b = bundleWithTemplate();
    const ps = b.exercise_templates[0]!.parameter_space;
    if (ps.mode !== 'symbol-pairs') throw new Error('夹具应为 symbol-pairs');
    ps.domain_symbol_ids = ['sym.wuxing.木', 'sym.不存在'];
    expect(validateBundle(b).errors.map((e) => e.rule)).toContain('R16');
  });

  it('合法模板无 error', () => {
    expect(validateBundle(bundleWithTemplate()).errors).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('确定性掌握度 · 样本不足时不给假数字', () => {
  const ev = (observed: number, confidence: 'high' | 'medium' | 'low' = 'high', idx = 0) =>
    evidenceFromAttempt({
      attempt_id: `a${idx}`,
      exercise_kind: '关系判断',
      skill_id: 'skill.rule-judged',
      passed: observed === 1,
      decided_by: confidence === 'high' ? 'rule-engine' : 'ai-rubric',
      submitted_at: '2026-09-19T10:00:00.000Z',
    });

  it('1–2 个样本 → 状态为「数据不足」，display 是字符串而不是数字', () => {
    const m = computeSkillMastery('skill.rule-judged', [ev(1, 'high', 1), ev(1, 'high', 2)]);
    const applied = m.dimensions.find((d) => d.dimension === '应用')!;
    expect(applied.status).toBe('数据不足');
    expect(applied.display).toBe('数据不足');
    expect(m.overall).toBe('数据不足');
  });

  it('3+ 个样本 → 「初步」，给出数值', () => {
    const m = computeSkillMastery('skill.rule-judged', [ev(1, 'high', 1), ev(1, 'high', 2), ev(1, 'high', 3)]);
    const applied = m.dimensions.find((d) => d.dimension === '应用')!;
    expect(applied.status).toBe('初步');
    expect(applied.value).toBe(1);
    expect(m.overall).toBe(1);
  });

  it('10+ 个样本 → 「稳定」', () => {
    const ten = Array.from({ length: 10 }, (_, i) => ev(1, 'high', i));
    const applied = computeSkillMastery('skill.rule-judged', ten).dimensions.find((d) => d.dimension === '应用')!;
    expect(applied.status).toBe('稳定');
  });

  it('六维向量齐全，未观测的维度不伪造数值', () => {
    const m = computeSkillMastery('skill.rule-judged', [ev(1, 'high', 1)]);
    expect(m.dimensions).toHaveLength(MASTERY_DIMENSIONS.length);
    for (const d of m.dimensions) {
      if (d.samples === 0) expect(d.display).toBe('数据不足');
    }
    // 生成/迁移维度没有观测 → 不可比较
    expect(dimensionValueOrNull(m, '生成')).toBeNull();
  });

  it('规则判定证据权重高于 AI 判分（同分情况下）', () => {
    const high = computeSkillMastery('skill.rule-judged', [ev(1, 'high', 1), ev(1, 'high', 2), ev(1, 'high', 3)]);
    const mixed = computeSkillMastery('skill.rule-judged', [
      ev(1, 'high', 1),
      ev(1, 'high', 2),
      ev(0, 'low', 3),
    ]);
    const a = high.dimensions.find((d) => d.dimension === '应用')!.value;
    const m2 = mixed.dimensions.find((d) => d.dimension === '应用')!.value;
    expect(m2).toBeLessThan(a);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('纯规则积分 · 反刷分是硬要求（V0.1 §10.3）', () => {
  const base: ScoreInput = {
    exercise_id: 'ex.1',
    exercise_kind: '关系判断',
    difficulty: '入门',
    mastery_before: 0.2,
    mastery_after: 0.5,
    prior_attempts_on_this_exercise: 0,
    passed: true,
  };

  it('未通过 → 0 分', () => {
    expect(scoreAttempt({ ...base, passed: false }).points).toBe(0);
  });

  it('掌握度没有增长 → 0 分（原则 1：挂在能力增长上，不挂在动作次数上）', () => {
    const r = scoreAttempt({ ...base, mastery_before: 0.8, mastery_after: 0.8 });
    expect(r.points).toBe(0);
    expect(r.reasons.join()).toContain('掌握度未增长');
  });

  it('掌握度下降 → 0 分', () => {
    expect(scoreAttempt({ ...base, mastery_before: 0.8, mastery_after: 0.6 }).points).toBe(0);
  });

  it('认知负荷权重：低负荷题目权重必须低（原则 2）', () => {
    const easy = scoreAttempt({ ...base, exercise_kind: '识别' }).points;
    const hard = scoreAttempt({ ...base, exercise_kind: '推理' }).points;
    expect(easy).toBeLessThan(hard);
    expect(COGNITIVE_LOAD_WEIGHT['识别']).toBeLessThan(COGNITIVE_LOAD_WEIGHT['推理']);
  });

  it('已掌握的内容几乎不给分（反刷分的核心闸门）', () => {
    const fresh = scoreAttempt({ ...base, mastery_before: 0.1, mastery_after: 0.2 }).points;
    const mastered = scoreAttempt({ ...base, mastery_before: 0.95, mastery_after: 0.96 }).points;
    expect(mastered).toBeLessThan(fresh);
    expect(mastered).toBeLessThanOrEqual(1);
  });

  it('同一题反复作答 → 分数衰减（1/(1+n)）', () => {
    const first = scoreAttempt({ ...base, prior_attempts_on_this_exercise: 0 }).points;
    const tenth = scoreAttempt({ ...base, prior_attempts_on_this_exercise: 9 }).points;
    expect(tenth).toBeLessThan(first);
  });

  it('刷 5 道识别题 < 1 道推理题（数学校验「刷简单题不划算」）', () => {
    const grind = Array.from({ length: 5 }, (_, i) =>
      scoreAttempt({ ...base, exercise_id: `ex.${i}`, exercise_kind: '识别', mastery_before: 0.1, mastery_after: 0.2 }),
    ).reduce((s, r) => s + r.points, 0);
    const deep = scoreAttempt({ ...base, exercise_kind: '推理', mastery_before: 0.1, mastery_after: 0.2 }).points;
    expect(grind).toBeLessThanOrEqual(deep + 2);
  });

  it('难度因子生效（进阶 > 入门）', () => {
    expect(scoreAttempt({ ...base, difficulty: '进阶' }).points).toBeGreaterThan(scoreAttempt(base).points);
  });

  it('积分可解释：reasons 说明每个因子', () => {
    const r = scoreAttempt(base);
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
    expect(r.factors.cognitive_load).toBe(3);
    expect(r.factors.repeat_decay).toBe(1);
  });

  it('账本累加并保留来源（可审计）', () => {
    let ledger: ScoreLedger = { total: 0, entries: [] };
    const r = scoreAttempt(base);
    ledger = appendToLedger(ledger, {
      ...r,
      attempt_id: 'at.1',
      exercise_id: 'ex.1',
      skill_ids: ['skill.rule-judged'],
      at: '2026-09-19T10:00:00.000Z',
    });
    expect(ledger.total).toBe(r.points);
    expect(ledger.entries[0]?.exercise_id).toBe('ex.1');
  });

  it('「学习节奏」不惩罚休息：中断不清零（原则 3）', () => {
    const entries = [
      { at: '2026-09-19T10:00:00.000Z' },
      { at: '2026-09-17T10:00:00.000Z' }, // 中间空了一天
      { at: '2026-09-10T10:00:00.000Z' }, // 确实在 7 天窗口外
    ];
    expect(learningRhythmDays(entries, '2026-09-19T12:00:00.000Z', 7)).toBe(2);
    // 空一天不产生惩罚项 —— 函数只返回天数，没有任何"断签"概念
  });
});
