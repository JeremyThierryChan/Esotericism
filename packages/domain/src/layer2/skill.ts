/**
 * Layer 2 · Skill / SkillEdge
 *
 * 依据：V0.2 §1.3、§5.1、ADR-0015⑤（= M16）
 *
 * ⚠️ **M16 修订（ADR-0015⑤）：`Skill` 不含任何 Rubric 指针。**
 *
 * 原 V0.2 §1.3 的 CI 规则要求「声明含 Rubric 的 `judging_mode` 必须绑定 `Rubric`」，
 * 但 `Skill` 在 Layer 2、`Rubric` 在 Layer 3，而 V0.1 §2 的硬约束是「Layer 3 可以被
 * 整体替换而不动 Layer 1/2」。让 Layer 2 实体必须绑定 Layer 3 实体，等于把教学层焊进
 * 能力层 —— 换一套判分规约就要改 Skill 定义。
 *
 * 落地：`Skill.judging_mode` **只声明类型**；绑定关系表达在 Layer 3 的
 * `AssessmentSpec(skill_ids[], rubric_id | rule_ids[])` 上（见 layer3/assessment.ts）。
 * CI 的失败条件不变，只是失败点搬到了正确的层。
 */
import { z } from 'zod';
import { entityBaseSchema } from '../layer0/provenance.js';
import { schemaIdSchema } from '../layer1/concept.js';

/**
 * Skill 种类。由 V0.2 §1.3 压测得出：塔罗 0 个推导型、六爻 9 个推导型
 * —— 这两门体系需要的运行时几乎是两个不同的产品。
 */
export const skillKinds = ['识别', '推导', '解释', '结构', '生成'] as const;
export const skillKindSchema = z.enum(skillKinds);
export type SkillKind = z.infer<typeof skillKindSchema>;

/**
 * 判分方式。**只声明类型，不绑定具体 Rubric/Rule**（M16）。
 * `规则判定` 由规则引擎执行，**不用 AI**；含 Rubric 者须落库审计。
 */
export const judgingModes = ['规则判定', '半规则+AI', 'Rubric+AI', '过程Rubric+AI'] as const;
export const judgingModeSchema = z.enum(judgingModes);
export type JudgingMode = z.infer<typeof judgingModeSchema>;

/** 需要 Rubric 的判分方式（CI 规则 R6 用） */
export const RUBRIC_JUDGING_MODES: readonly JudgingMode[] = ['Rubric+AI', '过程Rubric+AI'];
/** 需要规则引擎的判分方式（CI 规则 R5 用） */
export const RULE_JUDGING_MODES: readonly JudgingMode[] = ['规则判定'];
/** 规则与 AI 都要的判分方式 */
export const HYBRID_JUDGING_MODES: readonly JudgingMode[] = ['半规则+AI'];

export const skillSchema = entityBaseSchema.extend({
  /**
   * Skill 的可评估书写规范（V0.2 §1.2）：
   *   能在【条件】下，对【对象】执行【操作】，并【说出依据】
   * 反例：'理解用神'（不可观测）/ '掌握六爻'（不是 Skill，是体系）
   */
  statement: z.string().min(1),
  kind: skillKindSchema,
  judging_mode: judgingModeSchema,
  /** 依赖的认知图式 */
  schema_ids: z.array(schemaIdSchema).default([]),
  /** 所属体系；B0 基础层为跨体系共享，故可空 */
  system_id: z.string().min(1).optional(),
  /** 预设易混淆对（confusable_with）：内容侧预先声明"这两个东西初学者一定会混" */
  confusable_with_skill_ids: z.array(z.string().min(1)).default([]),
});
export type Skill = z.infer<typeof skillSchema>;

export const skillEdgeSchema = z.object({
  from_skill_id: z.string().min(1),
  to_skill_id: z.string().min(1),
  /** 前置是否要求 Mastery 阈值（而不只是"完成"）—— T5.1 的前置即属此类 */
  requires_mastery_threshold: z.boolean().default(false),
});
export type SkillEdge = z.infer<typeof skillEdgeSchema>;
