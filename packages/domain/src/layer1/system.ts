/**
 * Layer 1 · System / School
 *
 * 依据：ADR-0012（School 以可引证文献为锚）、ADR-0015④（删除 System.family）
 */
import { z } from 'zod';
import { entityBaseSchema, sourceRefSchema } from '../layer0/provenance.js';

export const systemSchema = entityBaseSchema.extend({
  name: z.string().min(1),
  era: z.string().optional(),
  /**
   * 入门阶段锁定的流派（ADR-0006）。
   * 注意：**不含 `family(东方/西方)`** —— 七政四余同时引用「东方象数」与「行星黄道」
   * 两个 Formalism，二值字段无法容纳真实存在的体系（ADR-0015④）。
   * 传统归属由 `SymbolUsage` 的集合派生。
   */
  default_school_id: z.string().min(1),
  /** 该体系引用到的 Formalism 集合（派生字段，落库以便查询；由 SymbolUsage 校验一致性） */
  formalism_ids: z.array(z.string().min(1)).min(1),
});
export type System = z.infer<typeof systemSchema>;

/**
 * 流派 / 传承。
 *
 * ADR-0012：**必须以「可引证文献」为锚**（如"依据《增删卜易》一路的取法"），
 * **不得使用「古法/新派」这类无学术界定的当代实务分类作锚**。
 * R1 Q3.3：「古法／传统派 vs 现代新派」未找到学术文献作为标准分类（置信度**低**），
 * 按它建模等于把当代民间分类包装成历史事实 —— 直接违反认识论原则 4。
 */
export const schoolSchema = entityBaseSchema.extend({
  system_id: z.string().min(1),
  name: z.string().min(1),
  /** 该派对同一符号/规则的立场简述 */
  stance: z.string().min(1),
  /**
   * **可引证文献锚点（ADR-0012）**。入门 `default_school` 必须非空，否则 CI 失败。
   * 年份字段可空且不得编造 —— R1 只核实了《增删卜易》（野鹤老人／李文辉刊）、
   * 《卜筮正宗》（王洪绪·王维德）、《易隐》（曹九锡）的**书名与作者归属**。
   */
  anchor_sources: z.array(sourceRefSchema).default([]),
  /** 是否为所属体系的入门默认流派 */
  is_default_of_system: z.boolean().default(false),
});
export type School = z.infer<typeof schoolSchema>;
