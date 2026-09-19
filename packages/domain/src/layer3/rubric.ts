/**
 * Layer 3 · Rubric
 *
 * 依据：V0.1 §11.1、§16.2
 *
 * 「**Rubric 是全项目最难也最值钱的教学资产。** 它同时是：AI 的评测标准、内容质量的
 * 检查表、以及产品『不承诺准确率』的法律护栏。」（V0.1 §11.1）
 */
import { z } from 'zod';
import { entityBaseSchema } from '../layer0/provenance.js';

/** 开放式评价的固定六段反馈结构（V0.1 §11.1） */
export const feedbackTemplateSchema = z.object({
  /** ① 已识别 */
  recognized: z.string().min(1),
  /** ② 缺失 */
  missing: z.string().min(1),
  /** ③ 倾向性错误 */
  tendency_error: z.string().min(1),
  /** ④ 具体修正 */
  correction: z.string().min(1),
  /** ⑤ 下一步 */
  next_step: z.string().min(1),
  /** ⑥ 不做评价（不对具体生活事件下判断） */
  not_evaluated: z.string().min(1),
});
export type FeedbackTemplate = z.infer<typeof feedbackTemplateSchema>;

export const rubricSchema = entityBaseSchema.extend({
  name: z.string().min(1),
  /** 必需要素 */
  must_hit: z.array(z.string().min(1)).min(1),
  /** 加分要素 */
  should_hit: z.array(z.string().min(1)).default([]),
  /**
   * 禁止推断。命中必须是错误，不是"扣分"。
   * 例：断言具体事件（"你前任会回来"）、把逆位当阴阳、体系外推理、确定性话术。
   */
  forbidden: z.array(z.string().min(1)).default([]),
  /**
   * 容许的流派差异。
   * 入门课：容许差异；**流派对比课（V0.1 §16.2）：升级为考查差异**，
   * `must_hit` 中必须包含"指出分歧点"。
   */
  school_variance: z.string().optional(),
  /** 过程规范（ADR-0004：实战考过程，不考准不准） */
  process_rules: z.array(z.string().min(1)).default([]),
  /** 是否用于流派对比课（决定 school_variance 是"容许"还是"考查"） */
  is_school_comparison: z.boolean().default(false),
  feedback_template: feedbackTemplateSchema,
});
export type Rubric = z.infer<typeof rubricSchema>;
