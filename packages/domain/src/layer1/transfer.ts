/**
 * Layer 1 · 跨体系迁移边（transfers_as）
 *
 * 依据：ADR-0011（= V0.2 M15）、ADR-0007、ADR-0014、V0.1 §5.2
 *
 * **ADR-0011 的核心修订：`transfer_type` 只有三个值。**
 *
 * 原因（可验证）：V0.2 §7 明确「机制 A = 同 Formalism 内的算法（不需要人工建边，
 * 可自动推导）」，而 V0.1 §5.1 的五值枚举里，类型 1（同源同构）与类型 2（共享形式
 * 系统）**恰好都是机制 A** —— 它们根本不产生 `transfers_as` 边。但 §5.2 又规定
 * 「每条 `transfers_as` 边必须携带 `transfer_type`」。结果是枚举里有两个永远取不到的
 * 值。zod 的 `z.enum([...])` 必须现在拍定。
 *
 * 类型 1/2 已降级为**派生视图** `sameFormalismProjection()`（见 derive.ts），不落库。
 */
import { z } from 'zod';
import { sourceStrengthSchema } from '../layer0/provenance.js';
import { sourceRefSchema } from '../layer0/provenance.js';

export const TRANSFER_TYPES = [
  /** 3 历史影响：有可查证的传播/借用关系 */
  3,
  /** 4 功能类比：结构相似、来源无关 */
  4,
  /** 5 修辞比喻：仅语言层面相似，**不进教学内容** */
  5,
] as const;

export const transferTypeSchema = z.union([z.literal(3), z.literal(4), z.literal(5)]);
export type TransferType = z.infer<typeof transferTypeSchema>;

/**
 * 类型 3 必须再分 historicity（V0.1 §5.2.1）。
 * 「有历史影响」有两种完全相反的情况，教法完全不同：
 *   传播 —— 真实的历史传播/借用（七政四余 ← 印度/希腊占星，置信度高）
 *   重建 —— 有据可查的近代建构（塔罗 ← 占星的行星/星座指派，ADR-0014 的 MVP 节点）
 *   不明 —— 有传播迹象但证据不足，只能进延伸阅读
 */
export const historicitySchema = z.enum(['传播', '重建', '不明']);
export type Historicity = z.infer<typeof historicitySchema>;

export const transferEdgeSchema = z.object({
  id: z.string().min(1),
  from_node_id: z.string().min(1),
  to_node_id: z.string().min(1),
  transfer_type: transferTypeSchema,
  /** 类型 3 必填；类型 4/5 禁止填写 */
  historicity: historicitySchema.optional(),
  /** 来源强度（原名 evidence_strength — ADR-0015⑥） */
  source_strength: sourceStrengthSchema,
  sources: z.array(sourceRefSchema).min(1),
  /**
   * 类型 4 必填（ADR-0007）：配对的反向练习题 —— 找出**类比失效**的场景。
   * 这是 CI 校验规则，不是建议。
   * 同时适用于类型 3 的 `historicity = 重建`（ADR-0014）：重建类对应同样要找出指派的
   * 可争议处 —— 素材用 R1 Q1.6 的 RWS/托特 VIII–XI 次序颠倒。
   */
  paired_reverse_exercise_id: z.string().min(1).optional(),
  /** 类型 4/5 的内容文本必须带「类比」标注（认识论原则 5：类比必须可见） */
  analogy_label_present: z.boolean().default(false),
  /** 四段式结构（V0.1 §8.2）是否完整 */
  four_part_structure: z
    .object({
      known: z.string().min(1),
      in_new_system: z.string().min(1),
      relation_declaration: z.string().min(1),
      transfer_exercise_id: z.string().min(1),
    })
    .optional(),
});
export type TransferEdge = z.infer<typeof transferEdgeSchema>;
