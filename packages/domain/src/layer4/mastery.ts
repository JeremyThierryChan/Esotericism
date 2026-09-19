/**
 * Layer 4 · 确定性掌握度（仅适用于**规则判分**的技能）
 *
 * 依据：V0.1 §9.1（掌握度是向量不是百分比）、§9.2（只由 Evidence 更新）、
 *       V0.2 M7（推导型可精确计算，解释型只能靠 Rubric，**不能共用一套公式**）
 *
 * 本模块**只做规则判分那一类**（`judging_mode = '规则判定'`）。
 * 解释型/生成型的掌握度需要 Rubric 判分，而 AI 判分已延后（ADR-0020）——
 * 因此这里**刻意不实现**它们：宁可不给数字，也不给假数字（V0.1 §9.1）。
 *
 * 实现要点（都来自 V0.1 §9.1 的硬要求）：
 *   · 掌握度是六维向量，不是单一百分比
 *   · **置信度由样本量决定**：样本少时必须显示「数据不足」，而不是给一个假数字
 *   · 不同判分来源的证据权重不同：规则判定（high）> AI 判分（medium）> 离线骨架（low）
 *
 * 确定性：同一批 Evidence → 同一结果，无随机、无时间依赖（时间为显式入参）。
 */
import type { Evidence } from './user-state.js';

/** V0.1 §9.1 的六个维度 */
export const MASTERY_DIMENSIONS = ['识别', '回忆', '应用', '结构', '迁移', '生成'] as const;
export type MasteryDimension = (typeof MASTERY_DIMENSIONS)[number];

/** 判分来源 → 证据权重。规则判定天然最可信（无幻觉、可复现） */
const CONFIDENCE_WEIGHT: Record<Evidence['confidence'], number> = {
  high: 1,
  medium: 0.7,
  low: 0.4,
};

/**
 * 样本量门槛。
 * V0.1 §9.1：「样本少时掌握度不可信，UI 应显示『数据不足』而不是给一个假数字」。
 * 所以这里给出**明确的门槛**而不是永远返回一个数。
 */
export const MIN_SAMPLES_FOR_ESTIMATE = 3;
export const MIN_SAMPLES_FOR_STABLE = 10;

export type MasteryStatus = '数据不足' | '初步' | '稳定';

export interface DimensionMastery {
  dimension: MasteryDimension;
  /** 估计值 0–1；样本不足时仍给出（便于排序），但必须看 status */
  value: number;
  /** 参与计算的观测数 */
  samples: number;
  status: MasteryStatus;
  /** UI 直接可用的展示值：样本不足时就是字符串「数据不足」 */
  display: number | '数据不足';
}

export interface SkillMastery {
  skill_id: string;
  dimensions: DimensionMastery[];
  /** 只对**样本足够**的维度求平均；全部不足则整条为「数据不足」 */
  overall: number | '数据不足';
  /** 总观测数 */
  total_samples: number;
}

function statusOf(samples: number): MasteryStatus {
  if (samples < MIN_SAMPLES_FOR_ESTIMATE) return '数据不足';
  if (samples < MIN_SAMPLES_FOR_STABLE) return '初步';
  return '稳定';
}

/**
 * 计算某技能的掌握度向量。
 *
 * 加权方式：按证据置信度加权求平均（`high` 权重 1，`medium` 0.7，`low` 0.4）。
 * **不做时间衰减** —— 衰减与复习排程属 V0.6（SRS），现在做了也没有数据校准它。
 */
export function computeSkillMastery(skillId: string, evidence: readonly Evidence[]): SkillMastery {
  const mine = evidence.filter((e) => e.skill_id === skillId);

  const dimensions: DimensionMastery[] = MASTERY_DIMENSIONS.map((dimension) => {
    const obs = mine.filter((e) => e.dimension === dimension);
    if (obs.length === 0) {
      return { dimension, value: 0, samples: 0, status: '数据不足' as const, display: '数据不足' as const };
    }
    let num = 0;
    let den = 0;
    for (const o of obs) {
      const w = CONFIDENCE_WEIGHT[o.confidence];
      num += o.observed * w;
      den += w;
    }
    const value = den === 0 ? 0 : num / den;
    const status = statusOf(obs.length);
    return {
      dimension,
      value: Number(value.toFixed(4)),
      samples: obs.length,
      status,
      display: status === '数据不足' ? '数据不足' : Number(value.toFixed(4)),
    };
  });

  const estimable = dimensions.filter((d) => d.status !== '数据不足');
  const overall =
    estimable.length === 0
      ? ('数据不足' as const)
      : Number((estimable.reduce((s, d) => s + d.value, 0) / estimable.length).toFixed(4));

  return { skill_id: skillId, dimensions, overall, total_samples: mine.length };
}

/**
 * 取某技能某维度的**可比较数值**。
 * 用于积分计算：样本不足时不拿假数字算分，而是返回 0 并让调用方知道这是「未知」。
 */
export function dimensionValueOrNull(m: SkillMastery, dimension: MasteryDimension): number | null {
  const d = m.dimensions.find((x) => x.dimension === dimension);
  if (!d || d.status === '数据不足') return null;
  return d.value;
}

/** 由一次判分产出 Evidence 的确定性映射（供判分闭环使用） */
export function evidenceFromAttempt(args: {
  attempt_id: string;
  exercise_kind: string;
  skill_id: string;
  passed: boolean;
  decided_by: string;
  submitted_at: string;
}): Evidence {
  // 认知负荷 → 观测维度。规则判分题基本都是「应用」类（V0.1 §10.2 题型↔维度表）
  const dimension: MasteryDimension =
    args.exercise_kind === '识别' || args.exercise_kind === '匹配'
      ? '识别'
      : args.exercise_kind === '结构分析'
        ? '结构'
        : args.exercise_kind === '开放式解读'
          ? '生成'
          : '应用';

  const confidence: Evidence['confidence'] =
    args.decided_by === 'rule-engine' ? 'high' : args.decided_by === 'ai-rubric' ? 'medium' : 'low';

  return {
    id: `ev.${args.attempt_id}.${args.skill_id}`,
    attempt_id: args.attempt_id,
    skill_id: args.skill_id,
    dimension,
    observed: args.passed ? 1 : 0,
    confidence,
    created_at: args.submitted_at,
  };
}
