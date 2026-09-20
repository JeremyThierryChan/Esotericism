/**
 * Layer 4 · 作答数据分析（纯函数，确定性）
 *
 * 依据：`docs/待采集数据.md` —— 「攒什么数据」的落点是**能算出这几个数**：
 *
 *   ① 每小题首次答对率      → 难度是否合理（难度权重是我拍的）
 *   ② 耗时分布             → **校准认知负荷权重**（1/2/3/4/5 是我拍的）
 *   ③ 实测混淆对 vs 预设   → V0.1 §9.3 的三分支判断（最有价值的一环）
 *   ④ 遗忘曲线             → 校准 V0.6 的 SRS 参数
 *   ⑤ 积分分布             → 给分是否过少 / 是否可刷
 *
 * 全部是**纯函数**：同输入同输出，无随机、无时间依赖（当前时间由参数传入）。
 * 因此可以在 Node 里用合成数据测，而不用等两周的真实数据。
 *
 * ⚠️ 这些函数只做**统计与归类**，不做因果推断。用两周自用数据得出
 * 「这套学习方法有效」是无效推论 —— 采集规格里已写明原因（开发者偏差）。
 */
import type { Attempt } from './user-state.js';

// ─────────────────────────────────────────────────────────────────────────────
// ① 每小题统计
// ─────────────────────────────────────────────────────────────────────────────

export interface ExerciseStats {
  exercise_id: string;
  template_id?: string;
  exercise_kind: string;
  attempts: number;
  /** 首次作答是否答对 */
  first_try_passed: boolean;
  /** 多次作答后的正确率 0–1 */
  pass_rate: number;
  /** 无耗时的作答（例如未记录）时为 null，而不是 undefined —— 便于序列化与比较 */
  median_latency_ms: number | null;
}

export function exerciseStats(attempts: readonly Attempt[], exerciseId: string): ExerciseStats | null {
  const mine = attempts
    .filter((a) => a.exercise_id === exerciseId)
    .slice()
    .sort((x, y) => x.submitted_at.localeCompare(y.submitted_at));
  const first = mine[0];
  if (!first) return null;

  const passed = mine.filter((a) => a.judging.passed).length;
  return {
    exercise_id: exerciseId,
    ...(first.template_id !== undefined ? { template_id: first.template_id } : {}),
    exercise_kind: first.exercise_kind,
    attempts: mine.length,
    first_try_passed: first.judging.passed,
    pass_rate: Number((passed / mine.length).toFixed(4)),
    median_latency_ms: medianLatency(mine) ?? null,
  };
}

/** 全部题的统计，按题组分组 */
export function allExerciseStats(attempts: readonly Attempt[]): ExerciseStats[] {
  const ids = [...new Set(attempts.map((a) => a.exercise_id))].sort();
  return ids.map((id) => exerciseStats(attempts, id)).filter((s): s is ExerciseStats => s !== null);
}

// ─────────────────────────────────────────────────────────────────────────────
// ② 耗时分布（校准认知负荷权重的主要输入）
// ─────────────────────────────────────────────────────────────────────────────

export interface KindLatency {
  exercise_kind: string;
  samples: number;
  median_ms: number;
  p90_ms: number;
}

function medianLatency(attempts: readonly Attempt[]): number | undefined {
  const xs = attempts.map((a) => a.latency_ms).filter((x): x is number => typeof x === 'number').sort((a, b) => a - b);
  if (xs.length === 0) return undefined;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 0 ? Math.round((xs[mid - 1]! + xs[mid]!) / 2) : xs[mid]!;
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

/**
 * 按题型的耗时分布。
 *
 * **用途**：我现在给各题型的认知负荷权重是**拍的**（识别 1 … 开放式 5）。
 * 如果「识别题」的中位耗时接近「推理题」，说明权重拍错了 —— 那是把低负荷题当高负荷刷分。
 * 反过来若差距远大于 5:1，说明权重拉得不够开。
 */
export function latencyByKind(attempts: readonly Attempt[]): KindLatency[] {
  const byKind = new Map<string, number[]>();
  for (const a of attempts) {
    if (typeof a.latency_ms !== 'number') continue;
    const list = byKind.get(a.exercise_kind) ?? [];
    list.push(a.latency_ms);
    byKind.set(a.exercise_kind, list);
  }
  return [...byKind.entries()]
    .map(([exercise_kind, xs]) => ({
      exercise_kind,
      samples: xs.length,
      median_ms: percentile(xs, 50),
      p90_ms: percentile(xs, 90),
    }))
    .sort((a, b) => a.median_ms - b.median_ms);
}

// ─────────────────────────────────────────────────────────────────────────────
// ③ 实测混淆对 vs 预设（V0.1 §9.3 的三分支）
// ─────────────────────────────────────────────────────────────────────────────

/** 内容侧预设（来自 `confusable_with` 边） */
export interface PresetConfusion {
  id: string;
  from_node_id: string;
  to_node_id: string;
  rationale: string;
  expected_direction: 'from_to' | 'to_from' | 'both';
}

/**
 * 三分支判断。V0.1 §9.3：
 *   · `expected`     —— 用户混淆了**预设的**一对：教学正常现象 → 触发对比练习
 *   · `unexpected`   —— 用户混淆了**未预设的**一对：⚠️ **内容或教学有问题** → 内容质检
 *   · `cross_system` —— 混淆的两端分属不同形式系统：过度迁移 → 触发反向练习
 */
export type ConfusionVerdict = 'expected' | 'unexpected' | 'cross_system';

export interface ObservedConfusion {
  /** 正确的那一项（标签文本） */
  correct_label: string;
  /** 用户实际选的那一项 */
  chosen_label: string;
  count: number;
  exercise_ids: string[];
  first_seen: string;
  last_seen: string;
  verdict: ConfusionVerdict;
  /** 命中预设时给出 id 与理由 */
  matched_preset?: { id: string; rationale: string };
}

export interface ConfusionInput {
  attempts: readonly Attempt[];
  presets: readonly PresetConfusion[];
  /** 节点 id → 展示名（用来把预设端点与选项标签对上） */
  nameOf: (nodeId: string) => string | undefined;
  /** 节点 id → 形式系统 id（用于判 cross_system）。没有则跳过该分支 */
  formalismOf?: (nodeId: string) => string | undefined;
}

/**
 * 从作答记录聚合出实测混淆对，并与预设比对。
 *
 * 只有**答错**且**选中了与正确项不同的标签**的作答才算混淆。
 * 匹配预设的方式是**按展示名比对**：预设的端点是节点 id，而作答记的是选项标签；
 * 用 `nameOf` 把端点翻成展示名再比 —— 这样不依赖标签与 id 的命名约定。
 */
export function computeConfusionPairs(input: ConfusionInput): ObservedConfusion[] {
  const { attempts, presets, nameOf, formalismOf } = input;
  const buckets = new Map<string, { correct: string; chosen: string; at: string[]; exercises: Set<string> }>();

  for (const a of attempts) {
    if (a.judging.passed) continue;
    const correct = a.correct_label;
    const chosen = a.chosen_label;
    if (correct === undefined || chosen === undefined || correct === chosen) continue;
    const key = `${correct}␟${chosen}`;
    const b = buckets.get(key) ?? { correct, chosen, at: [], exercises: new Set<string>() };
    b.at.push(a.submitted_at);
    b.exercises.add(a.exercise_id);
    buckets.set(key, b);
  }

  const out: ObservedConfusion[] = [];
  for (const [key, b] of buckets) {
    const times = [...b.at].sort();
    const matched = presets.find((p) => {
      const from = nameOf(p.from_node_id);
      const to = nameOf(p.to_node_id);
      if (from === undefined || to === undefined) return false;
      const forward = from === b.correct && to === b.chosen;
      const backward = from === b.chosen && to === b.correct;
      if (forward) return p.expected_direction !== 'to_from';
      if (backward) return p.expected_direction !== 'from_to';
      return false;
    });

    out.push({
      correct_label: b.correct,
      chosen_label: b.chosen,
      count: times.length,
      exercise_ids: [...b.exercises].sort(),
      first_seen: times[0]!,
      last_seen: times[times.length - 1]!,
      verdict: matched
        ? 'expected'
        : isCrossSystem(b.correct, b.chosen, presets, nameOf, formalismOf)
          ? 'cross_system'
          : 'unexpected',
      ...(matched ? { matched_preset: { id: matched.id, rationale: matched.rationale } } : {}),
    });
    void key;
  }
  return out.sort((a, b) => b.count - a.count || a.correct_label.localeCompare(b.correct_label));
}

/** 判断混淆的两端是否分属不同形式系统（需要调用方提供 formalismOf） */
function isCrossSystem(
  correct: string,
  chosen: string,
  presets: readonly PresetConfusion[],
  nameOf: (nodeId: string) => string | undefined,
  formalismOf: ((nodeId: string) => string | undefined) | undefined,
): boolean {
  if (!formalismOf) return false;
  const find = (label: string) => {
    const fromPreset = presets.flatMap((p) => [p.from_node_id, p.to_node_id]).find((id) => nameOf(id) === label);
    return fromPreset;
  };
  const a = find(correct);
  const b = find(chosen);
  if (a === undefined || b === undefined) return false;
  const fa = formalismOf(a);
  const fb = formalismOf(b);
  return fa !== undefined && fb !== undefined && fa !== fb;
}

// ─────────────────────────────────────────────────────────────────────────────
// ④ 遗忘曲线（校准 SRS）
// ─────────────────────────────────────────────────────────────────────────────

export interface ForgettingBucket {
  /** 距上次作答的间隔（天）区间的下界 */
  min_days: number;
  /** 上界（不含） */
  max_days: number;
  samples: number;
  pass_rate: number;
}

const DAY = 24 * 60 * 60 * 1000;
const BUCKETS: Array<[number, number]> = [
  [0, 1],
  [1, 3],
  [3, 7],
  [7, 14],
  [14, Number.POSITIVE_INFINITY],
];

/**
 * 遗忘曲线：同一题**两次作答之间**间隔越长，重答正确率如何变化。
 *
 * 每次作答与**上一次同一题**的作答配对，按间隔分桶。
 * 校准用途：若「7–14 天」桶的正确率仍然很高，说明复习间隔可以拉长；
 * 若「3–7 天」就掉下来，说明 SRS 的初始间隔设短了。
 *
 * ⚠️ 前提是**刻意安排间隔重答**（见采集规格 §六）。随便玩攒不出这条曲线 ——
 * 不按间隔玩的话，样本会全挤在 [0,1) 桶里。
 */
export function forgettingCurve(attempts: readonly Attempt[]): ForgettingBucket[] {
  const byExercise = new Map<string, Attempt[]>();
  for (const a of attempts) {
    const list = byExercise.get(a.exercise_id) ?? [];
    list.push(a);
    byExercise.set(a.exercise_id, list);
  }

  const pairs: Array<{ days: number; passed: boolean }> = [];
  for (const list of byExercise.values()) {
    const sorted = list.slice().sort((x, y) => x.submitted_at.localeCompare(y.submitted_at));
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      const days = (new Date(cur.submitted_at).getTime() - new Date(prev.submitted_at).getTime()) / DAY;
      pairs.push({ days, passed: cur.judging.passed });
    }
  }

  return BUCKETS.map(([lo, hi]) => {
    const inBucket = pairs.filter((p) => p.days >= lo && p.days < hi);
    const passed = inBucket.filter((p) => p.passed).length;
    return {
      min_days: lo,
      max_days: Number.isFinite(hi) ? hi : -1,
      samples: inBucket.length,
      pass_rate: inBucket.length === 0 ? 0 : Number((passed / inBucket.length).toFixed(4)),
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ⑤ 积分分布
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoreStats {
  total: number;
  attempts: number;
  /** 得 0 分的作答占比（反映反刷分闸门触发了多少次） */
  zero_share: number;
  max_single: number;
}

export function scoreStats(points: readonly number[]): ScoreStats {
  if (points.length === 0) return { total: 0, attempts: 0, zero_share: 0, max_single: 0 };
  const zeros = points.filter((p) => p === 0).length;
  return {
    total: points.reduce((s, p) => s + p, 0),
    attempts: points.length,
    zero_share: Number((zeros / points.length).toFixed(4)),
    max_single: Math.max(...points),
  };
}
