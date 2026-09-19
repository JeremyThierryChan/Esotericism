/**
 * Layer 4 · 纯规则积分
 *
 * 依据：V0.1 §10.3 的五条游戏化约束（**这些是约束，不是建议**）
 *
 * V0.1 §10.3 原文：
 *   1. 激励必须挂在"能力增长"上，不能挂在"动作次数"上
 *   2. **禁止用简单选择题刷 XP**。低认知负荷题目权重必须低，否则用户会找到刷分路径
 *   3. Streak 不能惩罚休息（建议用"学习节奏"而非"连续天数归零"）
 *   4. 心数/错误次数只在该关卡内部生效，不跨关卡累积成惩罚
 *   5. 每周挑战 = 综合运用（跨 Skill），不是高难度识别题
 *
 * 本模块把这五条**变成可执行的函数与测试**，而不是留在文档里。
 * 全程确定性：同输入同输出，无随机、无 AI。
 *
 * ⚠️ 反刷分是硬要求，不是优化项。所以积分公式里有两道闸门：
 *   · 掌握度**没有增长** → 0 分（闸门 A）
 *   · 该题**重复作答**越多 → 分数按 1/(1+n) 衰减（闸门 B）
 * 再加认知负荷权重（原则 2），刷简单选择题在数学上就是不划算的。
 */
import type { ExerciseKind } from '../layer3/exercise.js';

/**
 * 认知负荷权重（V0.1 §10.3 原则 2）。
 * 数值刻意拉得开：最低 1、最高 5 —— 刷 5 道识别题（5 分）才等于 1 道推理题。
 */
export const COGNITIVE_LOAD_WEIGHT: Readonly<Record<ExerciseKind, number>> = {
  识别: 1,
  匹配: 1,
  分类: 2,
  比较: 2,
  关系判断: 3,
  结构分析: 4,
  推理: 4,
  开放式解读: 5,
};

export const DIFFICULTY_WEIGHT = { 入门: 1, 进阶: 1.5 } as const;

export interface ScoreInput {
  exercise_id: string;
  exercise_kind: ExerciseKind;
  difficulty: '入门' | '进阶';
  /** 本次作答前的掌握度估计（0–1）；样本不足时传 null */
  mastery_before: number | null;
  /** 本次作答后的掌握度估计（0–1）；样本不足时传 null */
  mastery_after: number | null;
  /** 该题此前被作答过几次（用于重复衰减） */
  prior_attempts_on_this_exercise: number;
  /** 本次是否判为通过 */
  passed: boolean;
}

export interface ScoreResult {
  /** 本次获得的积分（整数） */
  points: number;
  /** 为什么给这个分（可解释，UI 直接展示） */
  reasons: string[];
  /** 明细因子，便于审计与调参 */
  factors: {
    cognitive_load: number;
    difficulty: number;
    novelty: number;
    repeat_decay: number;
    passed: boolean;
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * 计算一次作答的积分。
 *
 * 公式：
 *   points = 0                                            若未通过，或掌握度没有增长（闸门 A）
 *          = 认知负荷 × 难度 × 新额度 × 重复衰减           否则
 *
 *   新额度 novelty = clamp(1 - mastery_before, 0.2, 1)
 *     —— 已经掌握的内容再答对，几乎不给分（这是反刷分的核心）
 *   重复衰减 repeat_decay = 1 / (1 + prior_attempts)
 *     —— 同一题反复答，分数迅速趋零
 *
 * ⚠️ 刻意**不做**的事（都对应 V0.1 §10.3 的条款）：
 *   · 不因"答对一题 +10"给固定分（原则 1）
 *   · 不做连续天数与签到奖励（原则 3：Streak 不能惩罚休息）
 *   · 不做跨关卡错误累积惩罚（原则 4）
 */
export function scoreAttempt(input: ScoreInput): ScoreResult {
  const factors = {
    cognitive_load: COGNITIVE_LOAD_WEIGHT[input.exercise_kind],
    difficulty: DIFFICULTY_WEIGHT[input.difficulty],
    novelty: 0,
    repeat_decay: 1 / (1 + Math.max(0, input.prior_attempts_on_this_exercise)),
    passed: input.passed,
  };

  const reasons: string[] = [];

  // ── 闸门：未通过不给分 ──
  if (!input.passed) {
    reasons.push('未通过：不产生积分（积分只奖励能力增长，不奖励尝试次数）');
    return { points: 0, reasons, factors };
  }

  // ── 闸门 A：掌握度没有增长就不给分 ──
  // 样本不足（mastery 为 null）时**不当作增长**，按"首次接触"给一个保守的新额度，
  // 但仍然要求 this attempt 是首次或低重复，避免用刷题把样本量灌上去换分。
  if (input.mastery_before !== null && input.mastery_after !== null) {
    const delta = input.mastery_after - input.mastery_before;
    if (delta <= 0) {
      reasons.push(
        `掌握度未增长（${input.mastery_before.toFixed(2)} → ${input.mastery_after.toFixed(2)}）：0 分 —— 激励挂在能力增长上，不挂在动作次数上`,
      );
      return { points: 0, reasons, factors };
    }
    reasons.push(`掌握度增长 +${delta.toFixed(2)}`);
  } else {
    reasons.push('样本不足：本次按「首次接触」计，不计入增长幅度');
  }

  // ── 新额度：已掌握的内容几乎不给分 ──
  const novelty = clamp(1 - (input.mastery_before ?? 0), 0.2, 1);
  factors.novelty = Number(novelty.toFixed(4));
  if (novelty <= 0.25) {
    reasons.push(`该能力已较熟练（新额度 ${novelty.toFixed(2)}）：分数大幅降低，避免重复刷已掌握内容`);
  }

  const raw = factors.cognitive_load * factors.difficulty * novelty * factors.repeat_decay;
  const points = Math.max(0, Math.round(raw));

  reasons.push(
    `认知负荷 ${factors.cognitive_load} × 难度 ${factors.difficulty} × 新额度 ${novelty.toFixed(2)} × 重复衰减 ${factors.repeat_decay.toFixed(2)}`,
  );
  if (input.prior_attempts_on_this_exercise > 0) {
    reasons.push(`该题已作答 ${input.prior_attempts_on_this_exercise} 次：重复作答按 1/(1+n) 衰减`);
  }

  return { points, reasons, factors };
}

/**
 * 累计积分账本。
 * 只累加，不做"分数上限/等级惩罚"—— 等级与奖励曲线属 V0.7，此处只保证**来源可审计**。
 */
export interface ScoreLedgerEntry extends ScoreResult {
  attempt_id: string;
  exercise_id: string;
  skill_ids: string[];
  at: string;
}

export interface ScoreLedger {
  total: number;
  entries: ScoreLedgerEntry[];
}

export function appendToLedger(ledger: ScoreLedger, entry: ScoreLedgerEntry): ScoreLedger {
  return { total: ledger.total + entry.points, entries: [...ledger.entries, entry] };
}

/**
 * 「学习节奏」替代连续天数（V0.1 §10.3 原则 3：Streak 不能惩罚休息）。
 *
 * 返回近 N 天里**有学习活动**的天数，而不是"连续多少天没断"。
 * 中断不清零，也不产生惩罚 —— 它只是一个描述性指标。
 */
export function learningRhythmDays(entries: readonly { at: string }[], now: string, windowDays = 7): number {
  const end = new Date(now).getTime();
  const start = end - windowDays * 24 * 60 * 60 * 1000;
  const days = new Set<string>();
  for (const e of entries) {
    const t = new Date(e.at).getTime();
    if (t >= start && t <= end) days.add(new Date(t).toISOString().slice(0, 10));
  }
  return days.size;
}
