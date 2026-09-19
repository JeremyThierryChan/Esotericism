/**
 * Layer 1 · Symbol / AttributeSpace / SymbolUsage
 *
 * 依据：ADR-0009（Symbol 归属 Formalism）、ADR-0010（= V0.2 M13）
 *
 * ADR-0010 的核心修订：**废止 `Attribute` 实体**。
 *
 * 原因（可验证）：V0 术语表规定「『水元素』是属性，不是符号」，V0.1 把 `Attribute`
 * 列为独立实体；但 V0.1 §2 又规定 `related_by | Symbol ↔ Symbol | 体系内关系（生克冲合相位）`。
 * 于是「生克是五行值之间的关系，而五行的值是 Attribute」→ `related_by` 的定义域不包含它
 * → **「木生火」这条最基础的关系在 schema 里无处安放**。
 *
 * 判据（ADR-0010）：凡需要被 `Rule` 作用、需要携带来源与流派、需要参与有向关系的对象，
 * 必须是一等节点。五行的值三条全中。
 */
import { z } from 'zod';
import { entityBaseSchema } from '../layer0/provenance.js';
import { formalismIdSchema } from './formalism.js';

/**
 * 属性空间：一组可用来给符号分类的维度。
 * 例：五行 / 四元素 / 阴阳 / 极性 / 数字
 */
export const attributeSpaceSchema = entityBaseSchema.extend({
  /** 归属的 Formalism（属性空间是 Formalism 级分类） */
  formalism_id: formalismIdSchema,
  name: z.string().min(1),
  /** 该空间的取值符号 id 列表（取值本身是 Symbol，见下） */
  value_symbol_ids: z.array(z.string().min(1)).min(1),
});
export type AttributeSpace = z.infer<typeof attributeSpaceSchema>;

export const symbolSchema = entityBaseSchema.extend({
  /** ADR-0009：符号归属 Formalism，不再归属 System */
  formalism_id: formalismIdSchema,
  canonical_name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  /**
   * 符号种类。区分「原生符号」与「属性空间取值符号」，
   * 便于校验 value_symbol_ids 指向的确实是取值。
   */
  symbol_kind: z.enum(['native', 'attribute_value']).default('native'),
  /** 若为 attribute_value，指向它所属的属性空间 */
  attribute_space_id: z.string().min(1).optional(),
});
export type Symbol = z.infer<typeof symbolSchema>;

/**
 * 属性归属**关系**（不是实体）。
 * "甲属木" = hasAttribute(甲, 五行, 木)
 */
export const hasAttributeSchema = z.object({
  symbol_id: z.string().min(1),
  space_id: z.string().min(1),
  value_symbol_id: z.string().min(1),
});
export type HasAttribute = z.infer<typeof hasAttributeSchema>;

/**
 * 符号用法：「某体系以什么角色使用某符号」。
 *
 * 一个 System 可以引用**多个 Formalism** 的符号 —— 七政四余／果老星宗同时使用东方
 * 十二地支（作十二宫名）与西方七政（行星）就是真实案例（R1 Q5.1，置信度中–高）。
 * 这是 M1 的活体检验案例，也是为什么 `System` 不能带 `family(东方/西方)`（ADR-0015④）。
 */
export const symbolUsageSchema = z.object({
  symbol_id: z.string().min(1),
  system_id: z.string().min(1),
  school_id: z.string().min(1).optional(),
  /** 该体系以此符号扮演的角色，如「卦宫五行」「体用」「日主强弱」 */
  role: z.string().min(1),
});
export type SymbolUsage = z.infer<typeof symbolUsageSchema>;
