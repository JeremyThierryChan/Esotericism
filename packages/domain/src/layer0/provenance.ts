/**
 * Layer 0 · 元数据层（横切所有层）
 *
 * 依据：docs/V0.1-知识架构.md §14、docs/V0-术语与边界.md §一.4
 * 修订：ADR-0015⑥ —— EvidenceStrength 改名为 SourceStrength
 *       （原名与 Layer 4 的 `Evidence`（用户练习证据）同词冲突，违反认识论原则 7 术语唯一性）
 */
import { z } from 'zod';

/** 来源强度：决定该条目能否作为练习考点（V0 术语表 §4） */
export const sourceStrengthSchema = z.enum(['高', '中', '低']);
export type SourceStrength = z.infer<typeof sourceStrengthSchema>;

/**
 * 审核状态。只有 `reviewed` 可上线。
 * 流转：draft → reviewed → deprecated（deprecated 不静默删除，保留可追溯性）
 */
export const reviewStatusSchema = z.enum(['draft', 'reviewed', 'deprecated']);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

/**
 * 作者来源。
 * 硬约束（认识论原则 3）：`ai-candidate` 产出**永远不能**直接进入 `reviewed`。
 */
export const authoredBySchema = z.enum(['human', 'ai-candidate']);
export type AuthoredBy = z.infer<typeof authoredBySchema>;

/** 来源条目。`year` 可空且**不得编造** —— ADR-0012（R1 只核实了书名与作者，成书年份未核实） */
export const sourceRefSchema = z.object({
  /** 文献名或链接 */
  ref: z.string().min(1),
  /** 作者 / 编者（可空） */
  author: z.string().min(1).optional(),
  /** 成书/出版年份。**未核实即留空，禁止填猜测值**（ADR-0012） */
  year: z.number().int().optional(),
  /** 可核查链接 */
  url: z.string().url().optional(),
  /** 该来源核实的程度，与 R1 的置信度口径对齐 */
  confidence: z.enum(['高', '中–高', '中', '低–中', '低', '未核实']).optional(),
  note: z.string().optional(),
});
export type SourceRef = z.infer<typeof sourceRefSchema>;

/**
 * 复核记录：**某条具体论断被谁、依据什么、核到了什么结果**。
 *
 * 为什么「有来源」还不够：`sources[]` 只说明「引了哪本书」，
 * 不说明「书里到底怎么写的、有没有人核对过」。V0.1 §14 的流水线是
 * `draft --CI--> 人工审核 --> reviewed`，而中间那一步此前**没有落库对象**。
 *
 * ⚠️ `checked_by` 是这条记录存在的意义：
 *   - `ai-candidate` —— AI 找来源、摘原文、给结论。**可以进 draft，永远不能独自撑起 reviewed**
 *   - `human`       —— 人核过。只有这种记录能作为升级 `reviewed` 的依据（CI 规则 R19）
 */
export const verificationSchema = z.object({
  /** 被核实的**具体论断**（越具体越好，不要写"这本书是对的"） */
  claim: z.string().min(1),
  /** 依据来源 */
  source: sourceRefSchema,
  /** 定位：卷次 / 篇名 / 章节 / URL 锚点 */
  locator: z.string().optional(),
  /** 关键原文摘录 —— 让复核可被第三方直接验证，而不是只能相信结论 */
  excerpt: z.string().min(1).optional(),
  checked_by: z.enum(['human', 'ai-candidate']),
  checked_at: z.string().datetime(),
  /** 核查结果。`证否` 意味着该论断被推翻，不得据此上线 */
  outcome: z.enum(['证实', '部分证实', '证否', '无法核实']),
  /** 仍需人工补核的部分、或来源之间的分歧 */
  note: z.string().optional(),
});
export type Verification = z.infer<typeof verificationSchema>;

/**
 * Layer 0 元数据。每个 Layer 1 / 2 / 3 实体都必须携带。
 */
export const provenanceSchema = z.object({
  /** 文献/链接。空数组的含义由 CI 规则界定：
   *   - `review_status = 'reviewed'` 且为空 → **构建失败**（无来源不入库）
   *   - `draft` 且为空 → 允许存在，但标记为不可升级（见 validate/rules.ts R1）
   */
  sources: z.array(sourceRefSchema).default([]),
  /** 来源强度（原名 evidence_strength — ADR-0015⑥） */
  source_strength: sourceStrengthSchema,
  /** 是否存在流派/学界分歧 */
  controversy_flag: z.boolean().default(false),
  /** 分歧点与双方立场。controversy_flag = true 时必填 */
  controversy_note: z.string().min(1).optional(),
  /**
   * 复核记录（见 `verificationSchema`）。升级 `reviewed` 时 CI 规则 R19 要求
   * 至少一条 `checked_by = 'human'` 且 `outcome ∈ {证实, 部分证实}` 的记录。
   */
  verifications: z.array(verificationSchema).default([]),
  review_status: reviewStatusSchema.default('draft'),
  authored_by: authoredBySchema.default('ai-candidate'),
  reviewer: z.string().min(1).optional(),
  reviewed_at: z.string().datetime().optional(),
  version: z.number().int().positive().default(1),
});
export type Provenance = z.infer<typeof provenanceSchema>;

/** 所有 Layer 1/2/3 实体共有的形状：id + 元数据 */
export const entityBaseSchema = z.object({
  id: z.string().min(1),
  provenance: provenanceSchema,
});
export type EntityBase = z.infer<typeof entityBaseSchema>;
