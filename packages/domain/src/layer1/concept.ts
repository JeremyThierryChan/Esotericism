/**
 * Layer 1 · Concept / Schema（认知图式 S1–S9）
 *
 * 依据：V0.1 §4、V0.2 §2.1、ADR-0015①
 */
import { z } from 'zod';
import { entityBaseSchema } from '../layer0/provenance.js';

/**
 * 认知图式 S1–S9。V0.1 原为 8 个；V0.2 §5.4 压测发现缺少「把现实问题映射到符号」
 * 这一步（六爻取用神 / 梅花起卦取数 / 塔罗选牌阵 / 占星问事宫位），故新增 S9。
 * ADR-0015①：收敛为 9 个。
 */
export const SCHEMA_IDS = [
  'S1', // 指认
  'S2', // 归类
  'S3', // 对立配对
  'S4', // 作用联结
  'S5', // 组合成局
  'S6', // 演化
  'S7', // 取舍判断
  'S8', // 叙事
  'S9', // 取象 / 命题（新增）
] as const;

export const schemaIdSchema = z.enum(SCHEMA_IDS);
export type SchemaId = z.infer<typeof schemaIdSchema>;

export const schemaSchema = entityBaseSchema.extend({
  id: schemaIdSchema,
  name: z.string().min(1),
  /** 操作定义：用户能做什么 */
  operation: z.string().min(1),
  /** 覆盖的元概念 */
  covers: z.array(z.string().min(1)).default([]),
  /**
   * S9 在教学中应**提前**（它是入口技能，不是高阶技能），
   * 并在 B2 流派对比课程里再次出现（同一卦例、两派取用神不同、结论不同）。
   */
  teaching_note: z.string().optional(),
});
export type SchemaNode = z.infer<typeof schemaSchema>;

/** 原子概念：体系无关，是跨体系挂载点 */
export const conceptSchema = entityBaseSchema.extend({
  name: z.string().min(1),
  definition: z.string().min(1),
  schema_id: schemaIdSchema.optional(),
});
export type Concept = z.infer<typeof conceptSchema>;
