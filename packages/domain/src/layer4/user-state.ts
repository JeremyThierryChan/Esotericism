/**
 * Layer 4 · 用户状态层（最小实现）
 *
 * 依据：V0.1 §9.2 事件模型、§12 反幻觉三道闸门、ADR-0008 step 3（「落库」）
 *
 * 为什么现在补：step 3 的验收标准是「提交真实答案 → 六段式反馈且**过程可审计**」。
 * 「落库」与「可审计」都需要落库对象，而 Layer 4 原本排在 V0.6（step 5 之后）——
 * 与 step 2 必须先补 `Exercise` 是同一类顺序漏洞。
 *
 * 本文件只做 step 3 需要的最小部分：
 *   · `Attempt`       一次作答（含答案与判分记录）
 *   · `Evidence`      由 Attempt 抽出的、可用于更新 Mastery 的观测
 *   · `JudgeAudit`    每次 AI 调用的审计记录（三道闸门的落库形式）
 *
 * **不做**：`UserSkillMastery` 六维计算、衰减、SRS 排程、`ConfusionPair` 聚类
 * —— 那些是 V0.6，且需要真实用户数据才有意义。
 */
import { z } from 'zod';

/** 判分明细（与 domain/judges.ts 的 JudgeFinding 同构，此处为可落库的 zod 版本） */
export const judgeFindingSchema = z.object({
  key: z.string().min(1),
  verdict: z.enum(['hit', 'miss', 'violation', 'uncertain']),
  detail: z.string(),
});
export type JudgeFinding = z.infer<typeof judgeFindingSchema>;

/**
 * 判分审计记录 —— V0.1 §12 三道闸门的落库形式。
 *
 * 三道闸门：
 *   ① 知识边界：AI 上下文只注入已审核知识条目；答案必须引用条目 ID
 *   ② 不得写入：AI 输出永不直接进 `reviewed`
 *   ③ 落库可审计：每次 AI 调用记录 prompt / 模型 / 输入 / 输出 / 人工复核标记
 */
export const judgeAuditSchema = z.object({
  /** 闸门 ①：本次判分注入了哪些知识条目 */
  knowledge_scope_ids: z.array(z.string().min(1)).default([]),
  /** 闸门 ②：本次调用是否写回了知识库。**必须恒为 false** */
  wrote_to_library: z.literal(false),
  /** 闸门 ③：可审计 */
  prompt_digest: z.string().optional(),
  prompt_text: z.string().optional(),
  model: z.string().optional(),
  raw_output: z.string().optional(),
  /** 人工复核标记（用于后续校准与评测集构建） */
  human_reviewed: z.boolean().default(false),
  /** 落库时刻 */
  recorded_at: z.string().datetime(),
  /**
   * 运行时环境。区分「服务端调用（key 不出服务端）」与「浏览器自带 key」——
   * 后者的审计强度天然更弱，必须记录，否则评测集会被污染。
   */
  runtime: z.enum(['server', 'browser-byok', 'offline-skeleton']),
});
export type JudgeAudit = z.infer<typeof judgeAuditSchema>;

/** 判分记录 */
export const judgingRecordSchema = z.object({
  skill_ids: z.array(z.string().min(1)).min(1),
  passed: z.boolean(),
  findings: z.array(judgeFindingSchema),
  /**
   * 判分来源。规则算出的与 AI 判的必须可区分：
   * V0.6 的 Mastery 要按 Skill 的 `kind` 分两套算法（推导型可精确、解释型靠 Rubric）。
   */
  decided_by: z.enum(['rule-engine', 'ai-rubric', 'ai-assisted', 'offline-skeleton']),
  /** 判分所用规约与题目的锚点（可追溯） */
  assessment_spec_id: z.string().min(1),
  exercise_id: z.string().min(1),
  audit: judgeAuditSchema,
});
export type JudgingRecord = z.infer<typeof judgingRecordSchema>;

/** 一次作答 */
export const attemptSchema = z.object({
  id: z.string().min(1),
  exercise_id: z.string().min(1),
  /** 匿名会话标识（预览阶段不做账号） */
  session_id: z.string().min(1),
  /** 用户答案：自由文本或结构化 */
  answer: z.unknown(),
  /** 用户是否写下了推理解过程（ADR-0004：实战考过程规范） */
  process_text: z.string().optional(),
  hints_used: z.number().int().min(0).default(0),
  latency_ms: z.number().int().min(0).optional(),
  is_first_try: z.boolean().default(true),
  submitted_at: z.string().datetime(),
  judging: judgingRecordSchema,
});
export type Attempt = z.infer<typeof attemptSchema>;

/**
 * 证据：由 Attempt 抽出、可用于更新 Mastery 的观测。
 *
 * 原则（V0.1 §9.2）：**掌握度只由 Evidence 更新**。
 * 「看完一课」「连续签到」不产生掌握度。
 */
export const evidenceSchema = z.object({
  id: z.string().min(1),
  attempt_id: z.string().min(1),
  skill_id: z.string().min(1),
  /** 观测到的维度（V0.1 §9.1 的六维） */
  dimension: z.enum(['识别', '回忆', '应用', '结构', '迁移', '生成']),
  /** 该维度的本次观测值 0–1 */
  observed: z.number().min(0).max(1),
  /** 该项证据的置信度：规则判定天然比 AI 判分可信 */
  confidence: z.enum(['high', 'medium', 'low']),
  created_at: z.string().datetime(),
});
export type Evidence = z.infer<typeof evidenceSchema>;
