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
   *
   * 两种模式对应**两类规则形状**（V0.2 §6 特意区分过）：
   *   · `symbol-pairs`      —— 两个符号之间的关系题（如五行生克）
   *   · `bit-combinations`  —— 位组合题（如三爻→八卦、六爻→本卦）
   */
  parameter_space: z.discriminatedUnion('mode', [
    z.object({
      mode: z.literal('symbol-pairs'),
      /** 参与组合的符号（有序对，含自身） */
      domain_symbol_ids: z.array(z.string().min(1)).min(2),
      /** 组合方式：全部有序对 / 排除自身 */
      coverage: z.enum(['all-ordered-pairs', 'distinct-ordered-pairs']).default('all-ordered-pairs'),
      /** 是否包含「无作用关系」的自身配对作为干扰项 */
      include_identity_pairs: z.boolean().default(true),
    }),
    z.object({
      mode: z.literal('bit-combinations'),
      /** 位长：3（三爻成八卦）或 6（六爻成卦） */
      bit_length: z.union([z.literal(3), z.literal(6)]),
    }),
  ]),
  /**
   * 题干模板。占位符：
   *   `{a}` `{b}`   —— symbol-pairs 模式的两个符号名
   *   `{bits}`      —— bit-combinations 模式的位组合（如 111）
   *   `{yao}`       —— bit-combinations 模式的爻象（如「阳 阳 阳（自初爻起）」）
   */
  prompt_template: z.string().min(1),
  /**
   * 本题的答案取规则输出的哪个字段。
   * 客观选择题靠它生成选项；`expected` 里仍保留规则输出的**全部**字段供审计。
   */
  answer_field: z.string().min(1).optional(),
  /**
   * 选项生成方式：
   *   · relation-labels      —— 生/克/无 的正反向组合（供关系题用）
   *   · answer-field-distinct —— 取规则表里 `answer_field` 的**去重取值**（供表驱动题用）
   *   · none                 —— 不给选项（自由作答，仍由规则判分）
   */
  choices_mode: z.enum(['relation-labels', 'answer-field-distinct', 'none']).default('relation-labels'),
  difficulty: z.enum(['入门', '进阶']).default('入门'),
  requires_process: z.boolean().default(true),
  /** 生成数量上限（防止组合爆炸进入前端） */
  max_instances: z.number().int().positive().max(200).default(50),
});
export type ExerciseTemplate = z.infer<typeof exerciseTemplateSchema>;
