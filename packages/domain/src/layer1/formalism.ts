/**
 * Layer 1 · Formalism（形式系统）
 *
 * 依据：ADR-0009（= V0.2 M1 + M12）
 *
 * 判据（这是本项目最容易做错的一处）：
 *   Formalism 的划分判据是「**符号集是同一套，且符号间规则可互相定义**」，
 *   **不是文化圈**。
 *
 * 为什么必须这么严：V0.2 §5.3 原先写的是「东方象数形式系统 / 西方秘教形式系统：
 * 行星 · 星座 · 四元素」两个 Formalism，同时又有硬约束「共享只在同一 Formalism
 * 内部成立，塔罗里的『火星』不是共享符号，而是一条 transfers_as 边」。这两条不能
 * 同时成立 —— 若行星属「西方秘教」，则塔罗的火星与占星的火星同属一个 Formalism，
 * 按硬约束就是共享符号；但同一句又要求它是边。这不是措辞问题：它决定 `symbol_id`
 * 填什么，而这个值会写进每一条涉及行星的塔罗内容。
 *
 * 修正后（本文件即为其落地）：「行星」「星座」归 ③行星黄道；塔罗通过**跨 Formalism
 * 的 transfers_as 边**（类型 3，historicity = 重建）引用它们 —— 这正好就是 MVP 的
 * 跨体系节点（ADR-0014）。
 */
import { z } from 'zod';
import { entityBaseSchema } from '../layer0/provenance.js';

/** 4 个 Formalism 的固定 id（ADR-0009 的清单，不是示例） */
export const FORMALISM_IDS = [
  /** ① 阴阳 · 五行 · 天干地支 · 八卦 —— 符号间可互相定义（干支有五行、八卦纳甲配干支） */
  'east-xiangshu',
  /** ② 火 · 气 · 水 · 土 —— 塔罗与占星共同引用 → 机制 A 共享 */
  'greek-four-elements',
  /** ③ 行星 · 星座 · 宫位 —— 占星的原生形式系统 */
  'planetary-zodiac',
  /** ④ 22 大牌序列 · 四花色 · 牌义 —— 塔罗的原生符号 */
  'tarot-symbolic',
] as const;

export const formalismIdSchema = z.enum(FORMALISM_IDS);
export type FormalismId = z.infer<typeof formalismIdSchema>;

export const formalismSchema = entityBaseSchema.extend({
  id: formalismIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  /**
   * 该形式系统包含的符号集范围。用于回答「这个符号该归哪个 Formalism」，
   * 也是 CI 判断「共享 vs 建边」的依据。
   */
  symbol_scope: z.array(z.string().min(1)).min(1),
});
export type Formalism = z.infer<typeof formalismSchema>;
