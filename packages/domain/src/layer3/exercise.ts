/**
 * Layer 3 · Exercise（题目）—— **最小可玩单元**
 *
 * 边界声明（ADR-0016）：
 *   本实体的唯一目的是让「一条真实内容能被作答」成立，从而使 ADR-0008 step 3 的验收
 *   标准（「提交真实答案 → 六段式反馈且过程可审计」）可达。
 *
 *   **它不是 V0.5 的题型系统**：不做难度曲线、不做自适应、不做 XP 挂点、不做变式生成。
 *   `Path` / `Unit` / `Lesson` 这些**编排**概念属 V0.4，本阶段一概不做 —— 一个 Exercise
 *   不隶属于任何课程结构，它就是一道能答的题。
 *
 * 为什么现在必须补（step 1 暴露的顺序漏洞）：
 *   · V0.1 把 `Exercise` 放在 Layer 3，与 `Rubric` 同级
 *   · ADR-0008 step 3 的验收标准要求用户「提交真实答案」
 *   · 但 `Exercise` 被排在 V0.5，而 V0.5 被排在 step 5 之后
 *   → 没有 `Exercise`，step 2 的「一条真实内容」就写不出可作答的题，只能写教材知识点；
 *     而且 `TransferEdge.paired_reverse_exercise_id`（R3 强制）**引用的是一个不存在的实体**，
 *     于是 R3 成了一条永远无法真正满足、也无法真正违反的死规则。
 *
 * 题型分类照 V0.1 §10.2 的 8 种（不新增分类，只是落实最小的那些）。
 */
import { z } from 'zod';
import { entityBaseSchema } from '../layer0/provenance.js';
import type { JudgingMode } from '../layer2/skill.js';

/** V0.1 §10.2 的 8 种题型 */
export const EXERCISE_KINDS = [
  '识别',
  '匹配',
  '分类',
  '比较',
  '关系判断',
  '结构分析',
  '推理',
  '开放式解读',
] as const;

export const exerciseKindSchema = z.enum(EXERCISE_KINDS);
export type ExerciseKind = z.infer<typeof exerciseKindSchema>;

/**
 * 题型 → 允许的判分方式（CI 规则 R12 用）。
 *
 * 依据 V0.1 §10.2 的「可否 AI 判分」列：
 *   · 「关系判断」**必须由规则引擎判定** —— 生克/相位由引擎算，不能问 AI
 *     （AI 会在生克冲合上产生幻觉，而这是有确定答案的领域）
 *   · 「开放式解读」是唯一必须靠 AI + Rubric 的
 */
export const KIND_ALLOWED_JUDGING_MODES: Readonly<Record<ExerciseKind, readonly JudgingMode[]>> = {
  识别: ['规则判定', '半规则+AI'],
  匹配: ['规则判定', '半规则+AI'],
  分类: ['规则判定', '半规则+AI'],
  比较: ['规则判定', '半规则+AI'],
  关系判断: ['规则判定', '半规则+AI'],
  结构分析: ['半规则+AI', 'Rubric+AI'],
  推理: ['半规则+AI', 'Rubric+AI'],
  开放式解读: ['Rubric+AI', '过程Rubric+AI'],
} as const;

/** 规则判分题的答案键。规则引擎据此判分，AI 不得介入 */
export const answerKeySchema = z.object({
  /** 判分所用规则（必须在 bundle.rules 中存在 — CI 规则 R10） */
  rule_id: z.string().min(1),
  /** 题目输入（喂给规则引擎） */
  input: z.unknown(),
  /** 期望输出 */
  expected: z.unknown(),
  /** 客观题的选项（可空） */
  choices: z.array(z.string()).optional(),
});
export type AnswerKey = z.infer<typeof answerKeySchema>;

export const exerciseSchema = entityBaseSchema.extend({
  kind: exerciseKindSchema,
  /** 题干 */
  prompt: z.string().min(1),
  /** 本题目评测哪些 Skill */
  skill_ids: z.array(z.string().min(1)).min(1),
  /**
   * 本题按哪份评测规约判分（Layer 3）。
   * 显式引用而非从 Skill 推导 —— 同一个 Skill 可以有多份规约
   * （入门规约 / B2 流派对比规约），题目必须指明用的是哪一份。
   */
  assessment_spec_id: z.string().min(1),
  /** 规则/半规则判分题的答案键。纯 Rubric 题留空 */
  answer_key: answerKeySchema.optional(),
  /** 是否要求用户写下推理过程（ADR-0004：实战考过程规范） */
  requires_process: z.boolean().default(false),
  /**
   * 若本题是某条迁移边的**配对反向练习**，指回该边。
   * 与 `TransferEdge.paired_reverse_exercise_id` 形成双向确认（CI 规则 R3）。
   */
  is_reverse_exercise_of_edge_id: z.string().min(1).optional(),
  /** 本题是否属于跨体系四段式结构的第 ④ 段（V0.1 §8.2） */
  is_transfer_exercise_of_edge_id: z.string().min(1).optional(),
  difficulty: z.enum(['入门', '进阶']).default('入门'),
});
export type Exercise = z.infer<typeof exerciseSchema>;
