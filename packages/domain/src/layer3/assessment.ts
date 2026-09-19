/**
 * Layer 3 · AssessmentSpec（评测规约）
 *
 * 依据：ADR-0015⑤（= M16）
 *
 * 这是 M16 修订引入的**新实体**：把「这个 Skill 必须用哪份判分规约」从 Layer 2 搬到
 * Layer 3，从而保住 V0.1 §2 的硬约束「Layer 3 可以被整体替换而不动 Layer 1/2」。
 *
 * 附带好处（这是 M16 的正面收益，不只是修 bug）：**同一个 Skill 可以有多个评测规约**
 * —— 入门规约用一套 Rubric，B2 流派对比课用另一套（`school_variance` 从"容许差异"
 * 升级为"考查差异"，`must_hit` 必须包含"指出分歧点"）。V0.1 §16.2 正需要这个能力。
 */
import { z } from 'zod';
import { entityBaseSchema } from '../layer0/provenance.js';

export const assessmentSpecSchema = entityBaseSchema.extend({
  name: z.string().min(1),
  /** 本规约评测哪些 Skill（Layer 2） */
  skill_ids: z.array(z.string().min(1)).min(1),
  /** 引用哪份 Rubric（Layer 3）。含 Rubric 判分方式的 Skill 必须有规约提供它 */
  rubric_id: z.string().min(1).optional(),
  /** 绑定哪些 Rule（Layer 1）。规则判定 / 半规则判分的 Skill 必须有规约提供它 */
  rule_ids: z.array(z.string().min(1)).default([]),
  /** 是否属于 B2 流派对比课程形态（V0.1 §16.2） */
  is_school_comparison: z.boolean().default(false),
});
export type AssessmentSpec = z.infer<typeof assessmentSpecSchema>;

/** 供 CI 使用：任一规约是否给该 Skill 提供了 Rubric / Rule */
export function specsProvidingRubric(specs: readonly AssessmentSpec[], skillId: string): AssessmentSpec[] {
  return specs.filter((s) => s.skill_ids.includes(skillId) && s.rubric_id !== undefined);
}

export function specsProvidingRules(specs: readonly AssessmentSpec[], skillId: string): AssessmentSpec[] {
  return specs.filter((s) => s.skill_ids.includes(skillId) && s.rule_ids.length > 0);
}
