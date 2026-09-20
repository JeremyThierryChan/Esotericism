/**
 * 数据分析层测试（合成数据）
 *
 * 采集规格说「用两周自用数据校准我拍的数值」，但**函数本身不必等两周** ——
 * 它们是纯函数，可以用合成数据把每条判定都测到。这样真实数据来了才不会算错。
 */
import { describe, expect, it } from 'vitest';
import {
  computeConfusionPairs,
  exerciseStats,
  forgettingCurve,
  latencyByKind,
  scoreStats,
  type PresetConfusion,
} from '../src/layer4/analysis.js';
import type { Attempt, JudgingRecord } from '../src/layer4/user-state.js';

function rec(exerciseId: string, passed: boolean): JudgingRecord {
  return {
    skill_ids: ['skill.x'],
    passed,
    findings: [],
    decided_by: 'rule-engine',
    assessment_spec_id: 'spec.x',
    exercise_id: exerciseId,
    audit: {
      knowledge_scope_ids: [],
      wrote_to_library: false,
      recorded_at: '2026-09-19T00:00:00.000Z',
      runtime: 'offline-skeleton',
      human_reviewed: false,
    },
  };
}

let seq = 0;
function attempt(over: Partial<Attempt> & { exercise_id: string; passed: boolean; at: string }): Attempt {
  seq++;
  // 注意顺序：默认值在前，`...over` 在后 —— 否则 exercise_id 之类会被默认值覆盖
  return {
    id: `at.${seq}`,
    exercise_kind: '关系判断',
    session_id: 's.test',
    answer: { label: over.chosen_label ?? '' },
    hints_used: 0,
    is_first_try: false,
    judging: rec(over.exercise_id, over.passed),
    ...over,
    exercise_id: over.exercise_id,
    submitted_at: over.at,
  } as Attempt;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('每小题统计', () => {
  it('首次答对 vs 多次答对要分开（前者才是难度信号）', () => {
    const a = [
      attempt({ exercise_id: 'e1', passed: false, at: '2026-09-19T10:00:00Z' }),
      attempt({ exercise_id: 'e1', passed: true, at: '2026-09-19T11:00:00Z' }),
      attempt({ exercise_id: 'e1', passed: true, at: '2026-09-19T12:00:00Z' }),
    ];
    const s = exerciseStats(a, 'e1')!;
    expect(s.attempts).toBe(3);
    expect(s.first_try_passed).toBe(false);
    expect(s.pass_rate).toBeCloseTo(2 / 3, 4);
  });

  it('按时间排序取首次，而不是按数组顺序', () => {
    const a = [
      attempt({ exercise_id: 'e1', passed: true, at: '2026-09-19T12:00:00Z' }),
      attempt({ exercise_id: 'e1', passed: false, at: '2026-09-19T10:00:00Z' }),
    ];
    expect(exerciseStats(a, 'e1')!.first_try_passed).toBe(false);
  });

  it('无耗时的作答 → median_latency_ms 为 null（不伪造成 0）', () => {
    const a = [attempt({ exercise_id: 'e1', passed: true, at: '2026-09-19T10:00:00Z' })];
    expect(exerciseStats(a, 'e1')!.median_latency_ms).toBeNull();
  });
});

describe('耗时分布（校准认知负荷权重的输入）', () => {
  it('按题型聚合中位数与 p90', () => {
    const a = [
      attempt({ exercise_id: 'e1', passed: true, at: '2026-09-19T10:00:00Z', exercise_kind: '识别', latency_ms: 1000 }),
      attempt({ exercise_id: 'e2', passed: true, at: '2026-09-19T10:01:00Z', exercise_kind: '识别', latency_ms: 3000 }),
      attempt({ exercise_id: 'e3', passed: true, at: '2026-09-19T10:02:00Z', exercise_kind: '识别', latency_ms: 5000 }),
      attempt({ exercise_id: 'e4', passed: true, at: '2026-09-19T10:03:00Z', exercise_kind: '推理', latency_ms: 20000 }),
    ];
    const rows = latencyByKind(a);
    const 识别 = rows.find((r) => r.exercise_kind === '识别')!;
    const 推理 = rows.find((r) => r.exercise_kind === '推理')!;
    expect(识别.samples).toBe(3);
    expect(识别.median_ms).toBe(3000);
    expect(推理.median_ms).toBe(20000);
    // 排序：耗时短的在前
    expect(rows[0]!.exercise_kind).toBe('识别');
  });
});

describe('实测混淆对 vs 预设（V0.1 §9.3 三分支）', () => {
  const presets: PresetConfusion[] = [
    {
      id: 'sym.bagua.震~sym.bagua.艮',
      from_node_id: 'sym.bagua.震',
      to_node_id: 'sym.bagua.艮',
      rationale: '互为镜像，都只有一阳、位置相反',
      expected_direction: 'both',
    },
  ];
  const names: Record<string, string> = {
    'sym.bagua.震': '震',
    'sym.bagua.艮': '艮',
    'sym.bagua.乾': '乾',
  };
  const nameOf = (id: string) => names[id];
  const formalismOf = () => 'east-xiangshu';

  it('命中预设 → expected（教学正常现象）', () => {
    const a = [
      attempt({ exercise_id: 'e1', passed: false, at: '2026-09-19T10:00:00Z', chosen_label: '艮', correct_label: '震' }),
      attempt({ exercise_id: 'e2', passed: false, at: '2026-09-19T11:00:00Z', chosen_label: '艮', correct_label: '震' }),
    ];
    const rows = computeConfusionPairs({ attempts: a, presets, nameOf, formalismOf });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ correct_label: '震', chosen_label: '艮', count: 2, verdict: 'expected' });
    expect(rows[0]!.matched_preset?.id).toContain('震');
    // 聚合时间跨度
    expect(rows[0]!.first_seen).toBe('2026-09-19T10:00:00Z');
    expect(rows[0]!.last_seen).toBe('2026-09-19T11:00:00Z');
    expect(rows[0]!.exercise_ids).toEqual(['e1', 'e2']);
  });

  it('未命中预设 → unexpected（内容或教学可能有问题）', () => {
    const a = [
      attempt({ exercise_id: 'e1', passed: false, at: '2026-09-19T10:00:00Z', chosen_label: '乾', correct_label: '震' }),
    ];
    const rows = computeConfusionPairs({ attempts: a, presets, nameOf, formalismOf });
    expect(rows[0]!.verdict).toBe('unexpected');
    expect(rows[0]!.matched_preset).toBeUndefined();
  });

  it('方向受 expected_direction 约束', () => {
    const oneWay: PresetConfusion[] = [{ ...presets[0]!, expected_direction: 'from_to' }];
    // 震→艮 命中；艮→震 不命中
    const fwd = computeConfusionPairs({
      attempts: [attempt({ exercise_id: 'e1', passed: false, at: '2026-09-19T10:00:00Z', chosen_label: '艮', correct_label: '震' })],
      presets: oneWay,
      nameOf,
      formalismOf,
    });
    const bwd = computeConfusionPairs({
      attempts: [attempt({ exercise_id: 'e1', passed: false, at: '2026-09-19T10:00:00Z', chosen_label: '震', correct_label: '艮' })],
      presets: oneWay,
      nameOf,
      formalismOf,
    });
    expect(fwd[0]!.verdict).toBe('expected');
    expect(bwd[0]!.verdict).toBe('unexpected');
  });

  it('答对的作答不算混淆；正确项与所选项相同也不算', () => {
    const a = [
      attempt({ exercise_id: 'e1', passed: true, at: '2026-09-19T10:00:00Z', chosen_label: '震', correct_label: '震' }),
      attempt({ exercise_id: 'e2', passed: false, at: '2026-09-19T11:00:00Z', chosen_label: '震', correct_label: '震' }),
    ];
    expect(computeConfusionPairs({ attempts: a, presets, nameOf, formalismOf })).toEqual([]);
  });

  it('自由作答（无选项标签）不计入混淆对', () => {
    const a = [attempt({ exercise_id: 'e1', passed: false, at: '2026-09-19T10:00:00Z' })];
    expect(computeConfusionPairs({ attempts: a, presets, nameOf, formalismOf })).toEqual([]);
  });

  it('按次数降序，最多的混淆排最前（最少发现的先看得见）', () => {
    const a = [
      ...Array.from({ length: 5 }, (_, i) =>
        attempt({ exercise_id: `e${i}`, passed: false, at: `2026-09-19T1${i}:00:00Z`, chosen_label: '艮', correct_label: '震' }),
      ),
      attempt({ exercise_id: 'e9', passed: false, at: '2026-09-19T20:00:00Z', chosen_label: '乾', correct_label: '震' }),
    ];
    const rows = computeConfusionPairs({ attempts: a, presets, nameOf, formalismOf });
    expect(rows[0]!.count).toBe(5);
    expect(rows[1]!.count).toBe(1);
  });
});

describe('遗忘曲线', () => {
  it('按「距上次作答」的间隔分桶，正确率随间隔下降', () => {
    const a = [
      // 同一题：首答 → 4 小时后重答（正确）→ 5 天后重答（错误）→ 20 天后重答（错误）
      attempt({ exercise_id: 'e1', passed: true, at: '2026-09-01T10:00:00Z' }),
      attempt({ exercise_id: 'e1', passed: true, at: '2026-09-01T14:00:00Z' }), // 0–1 天
      attempt({ exercise_id: 'e1', passed: false, at: '2026-09-06T14:00:00Z' }), // 5 天 → 3–7 桶
      attempt({ exercise_id: 'e1', passed: false, at: '2026-09-26T14:00:00Z' }), // 20 天 → 14+ 桶
    ];
    const curve = forgettingCurve(a);
    const b0 = curve.find((b) => b.min_days === 0)!;
    const b37 = curve.find((b) => b.min_days === 3)!;
    const b14 = curve.find((b) => b.min_days === 14)!;
    expect(b0.samples).toBe(1);
    expect(b0.pass_rate).toBe(1);
    expect(b37.samples).toBe(1);
    expect(b37.pass_rate).toBe(0);
    expect(b14.samples).toBe(1);
    expect(b14.pass_rate).toBe(0);
  });

  it('没做过间隔重答 → 样本全在 0–1 天桶（这正是「该怎么玩」要解决的问题）', () => {
    const a = [
      attempt({ exercise_id: 'e1', passed: true, at: '2026-09-19T10:00:00Z' }),
      attempt({ exercise_id: 'e1', passed: true, at: '2026-09-19T11:00:00Z' }),
    ];
    const curve = forgettingCurve(a);
    expect(curve.find((b) => b.min_days === 0)!.samples).toBe(1);
    expect(curve.filter((b) => b.min_days > 0).every((b) => b.samples === 0)).toBe(true);
  });

  it('首次作答不产生配对（没有「上一次」可比）', () => {
    const a = [attempt({ exercise_id: 'e1', passed: true, at: '2026-09-01T10:00:00Z' })];
    expect(forgettingCurve(a).every((b) => b.samples === 0)).toBe(true);
  });
});

describe('积分分布', () => {
  it('统计总额、零分占比、单次最高', () => {
    const s = scoreStats([0, 0, 3, 5]);
    expect(s.total).toBe(8);
    expect(s.attempts).toBe(4);
    expect(s.zero_share).toBe(0.5);
    expect(s.max_single).toBe(5);
  });

  it('空输入不炸', () => {
    expect(scoreStats([])).toEqual({ total: 0, attempts: 0, zero_share: 0, max_single: 0 });
  });
});
