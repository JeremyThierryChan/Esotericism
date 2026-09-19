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
import { loadBundle } from '../src/load.js';

let bundle: ContentBundle;
beforeAll(async () => {
  const loaded = await loadBundle();
  if (!loaded.ok || !loaded.bundle) throw new Error('bundle.json 未通过 schema 校验');
  bundle = loaded.bundle;
});

describe('真实内容库 · 题目生成', () => {
  it('模板生成出 25 题（5 个符号的全有序对）', () => {
    const { instances, byTemplate } = generateExercises(bundle);
    expect(instances).toHaveLength(25);
    expect(byTemplate[0]?.count).toBe(25);
    expect(byTemplate[0]?.skipped).toEqual([]);
  });

  it('每个有序对都恰好一题，无重复无遗漏', () => {
    const { instances } = generateExercises(bundle);
    const ids = instances.map((i) => i.id);
    expect(new Set(ids).size).toBe(25);
    const pairs = new Set(instances.map((i) => `${i.params.a}|${i.params.b}`));
    expect(pairs.size).toBe(25);
  });

  it('答案分布合理：含相生、相克、以及 5 个自身配对的「无作用关系」', () => {
    const { instances } = generateExercises(bundle);
    const labels = instances.map((i) => String((i.answer_key.expected as { label?: string }).label));
    expect(labels.filter((l) => l.endsWith('相生'))).toHaveLength(10); // 5 条生边 × 2 方向
    expect(labels.filter((l) => l.endsWith('相克'))).toHaveLength(10); // 5 条克边 × 2 方向
    expect(labels.filter((l) => l === '无作用关系')).toHaveLength(5); // 自身配对
  });
});

describe('真实内容库 · 判分零误判', () => {
  it('25/25 题：按标准答案作答 → 全部通过', () => {
    const tpl = bundle.exercise_templates[0]!;
    const judge = createRuleJudge({ bundle });
    let passed = 0;
    for (const inst of generateExercises(bundle).instances) {
      if (judge.judge(toJudgeableExercise(inst, tpl), String((inst.answer_key.expected as { label?: string }).label)).passed) {
        passed++;
      }
    }
    expect(passed).toBe(25);
  });

  it('任何错误选项都判为不通过（逐题穷举全部错项）', () => {
    const tpl = bundle.exercise_templates[0]!;
    const judge = createRuleJudge({ bundle });
    let wrongOptionAttempts = 0;
    let falsePasses = 0;
    for (const inst of generateExercises(bundle).instances) {
      const ex = toJudgeableExercise(inst, tpl);
      const correct = String((inst.answer_key.expected as { label?: string }).label);
      for (const c of inst.answer_key.choices ?? []) {
        if (c === correct) continue;
        wrongOptionAttempts++;
        if (judge.judge(ex, c).passed) falsePasses++;
      }
    }
    expect(wrongOptionAttempts).toBeGreaterThan(80); // 25 题 × 约 4 个错项
    expect(falsePasses).toBe(0);
  });
});

describe('真实内容库 · 闭环可跑通（题目→判分→证据→掌握度→积分）', () => {
  it('连续答对 8 题：掌握度从「数据不足」过渡到可估数值，且积分递减', () => {
    const tpl = bundle.exercise_templates[0]!;
    const skillId = tpl.skill_ids[0]!;
    const judge = createRuleJudge({ bundle });
    const instances = generateExercises(bundle).instances;

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
    const tpl = bundle.exercise_templates[0]!;
    const skillId = tpl.skill_ids[0]!;
    const inst = generateExercises(bundle).instances[1]!;
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
