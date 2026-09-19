/**
 * Layer 1 · Relation
 *
 * 依据：V0.1 §2 关系类型清单 + ADR-0010（两端都是 Symbol）
 */
import { z } from 'zod';

export const RELATION_TYPES = [
  'has_attribute', // 属性归属（Symbol → 取值 Symbol），取代原 attribute_of
  'related_by', // 体系内关系：生 / 克 / 冲 / 合 / 相位 / 互卦 / 牌序
  'used_as', // 符号用法（SymbolUsage）
  'variant_of', // 流派变体（School → School）
  'contradicts', // 流派/学界冲突，UI 必须呈现
  'projects_to', // 体系投影（Concept → (System, Rule)）
  'transfers_as', // 跨体系迁移边（只有类型 3/4/5 — ADR-0011）
  'prerequisite_of', // 能力依赖（Skill → Skill）
  'teaches',
  'assesses',
  'requires',
  'confusable_with', // 内容侧预设易混淆对
  'supported_by',
] as const;

export const relationTypeSchema = z.enum(RELATION_TYPES);
export type RelationType = z.infer<typeof relationTypeSchema>;

/** `related_by` 的具体子类型（东方象数形式系统内部） */
export const RELATED_BY_SUBTYPES = ['生', '克', '冲', '合', '刑', '害', '相位', '互卦', '牌序'] as const;
export const relatedBySubtypeSchema = z.enum(RELATED_BY_SUBTYPES);
export type RelatedBySubtype = z.infer<typeof relatedBySubtypeSchema>;

/**
 * 关系。**两端都是 `Symbol`** —— 这正是 ADR-0010 修订的理由：
 * 若五行的值是 `Attribute`，则「木生火」无处安放。
 */
export const relationSchema = z.object({
  type: z.literal('related_by'),
  subtype: relatedBySubtypeSchema,
  from_symbol_id: z.string().min(1),
  to_symbol_id: z.string().min(1),
  /** 有向关系（生/克）必须有方向；无向（合）则 direction = 'none' */
  direction: z.enum(['forward', 'none']),
  school_id: z.string().min(1).optional(),
});
export type Relation = z.infer<typeof relationSchema>;
