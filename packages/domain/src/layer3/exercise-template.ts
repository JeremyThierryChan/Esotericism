/**
 * Layer 3 · ExerciseTemplate（题目模板）
 *
 * 依据：V0.2 §5.6「规则密集型体系的题目**可以**自动生成（随机取卦 → 规则算答案 → 自动出题）」、
 *       V0.1 §12「客观题目的答案与选项生成」属规则/数据库职责
 *
 * 为什么需要模板，而不是手写每道题：
 *
 *   1. **内容经济学**（V0.2 §5.6）：规则密集型体系的质量瓶颈是**规则引擎正确性**，不是题目数量。
 *      手写 25 道五行生克题毫无价值 —— 它们只是同一张关系表的 25 个投影。
 *   2. **答案不可能抄错**：题目答案由**规则引擎**从内容库的关系边算出，
 *      与判分用的是同一套真值表。手写题号/手写答案才有抄错的可能。
 *   3. **可复现**：同一份内容库 + 同一模板 → 同一批题（确定性生成，有测试锁住）。
 *
 * ⚠️ 关键约束（防止「生成器变成真理来源」）：
 *   生成器**不产生任何术数知识**。它只是在**已审核的关系边**上做组合与投影。
 *   若一条关系边不存在，对应题目就不会生成 —— 真值表始终只有内容库一个来源。
 *   这一点由测试保证（删掉一条边 → 对应题目消失）。
 */
import { z } from 'zod';
import { entityBaseSchema } from '../layer0/provenance.js';
import { exerciseKindSchema, answerKeySchema } from './exercise.js';

/** 题目实例（由模板生成，不落库为内容条目；结构与 Exercise 对齐） */
export const exerciseInstanceSchema = z.object({
  /** 由模板 id + 参数确定，同一内容库下稳定 */
  id: z.string().min(1),
  template_id: z.string().min(1),
  kind: exerciseKindSchema,
  prompt: z.string().min(1),
  skill_ids: z.array(z.string().min(1)).min(1),
  assessment_spec_id: z.string().min(1),
  answer_key: answerKeySchema,
  requires_process: z.boolean(),
  difficulty: z.enum(['入门', '进阶']),
  /** 生成参数（便于复现与调试） */
  params: z.record(z.string(), z.string()),
});
export type ExerciseInstance = z.infer<typeof exerciseInstanceSchema>;

export const exerciseTemplateSchema = entityBaseSchema.extend({
  name: z.string().min(1),
  /** 本模板评测哪些 Skill */
  skill_ids: z.array(z.string().min(1)).min(1),
  kind: exerciseKindSchema,
  /** 本题按哪份评测规约判分 */
  assessment_spec_id: z.string().min(1),
  /**
   * 用来推导正确答案的规则。**必须有 `rule_test_sets` 里的验证集**
   * —— 否则规则引擎正确性无从保证（M6），生成出来的题目也就不可信。
   */
  rule_id: z.string().min(1),
  /**
   * 参数空间。生成器只在这个空间内出题。
   * `domain_symbol_ids` 必须与规则的 `applies_to_symbol_ids` 兼容（CI 校验）。
   */
  parameter_space: z.object({
    /** 参与组合的符号（有序对，含自身） */
    domain_symbol_ids: z.array(z.string().min(1)).min(2),
    /** 组合方式：全部有序对 / 仅生克对（排除自身） */
    coverage: z.enum(['all-ordered-pairs', 'distinct-ordered-pairs']).default('all-ordered-pairs'),
    /** 是否包含「无作用关系」的自身配对作为干扰项 */
    include_identity_pairs: z.boolean().default(true),
  }),
  /** 题干模板。`{a}` `{b}` 会被参数替换 */
  prompt_template: z.string().min(1),
  /**
   * 选项生成方式：
   *   · relation-labels —— 由规则的可能取值生成（生/克/无 的正反向组合）
   *   · none —— 不给选项（自由作答，仍由规则判分）
   */
  choices_mode: z.enum(['relation-labels', 'none']).default('relation-labels'),
  difficulty: z.enum(['入门', '进阶']).default('入门'),
  requires_process: z.boolean().default(true),
  /** 生成数量上限（防止组合爆炸进入前端） */
  max_instances: z.number().int().positive().max(200).default(50),
});
export type ExerciseTemplate = z.infer<typeof exerciseTemplateSchema>;
