/**
 * Layer 1 · Relation
 *
 * 依据：V0.1 §2 关系类型清单 + ADR-0010（两端都是 Symbol）
 */
import { z } from 'zod';
import { provenanceSchema } from '../layer0/provenance.js';

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
 *
 * ⚠️ 补记（T2 复核时发现）：关系边此前**没有 `provenance`**，
 * 而它正是题目真值表的来源 —— 即「我们唯一可玩的内容」当时没有任何来源记录。
 * V0.1 §14 规定元数据为「所有 Layer 1 实体共有」，`Relation` 属 Layer 1，故补齐。
 * 一条 `related_by` 边就是一条**知识论断**（「木生火」），必须能追溯到文献。
 */
export const relationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('related_by'),
    subtype: relatedBySubtypeSchema,
    from_symbol_id: z.string().min(1),
    to_symbol_id: z.string().min(1),
    /** 有向关系（生/克）必须有方向；无向（合）则 direction = 'none' */
    direction: z.enum(['forward', 'none']),
    school_id: z.string().min(1).optional(),
    /** 该关系边本身的来源与复核记录 */
    provenance: provenanceSchema,
  }),
  /**
   * 预设易混淆对（V0.1 §2 关系清单、§9.3）。
   *
   * ⚠️ 建模位置修正：V0.1 §2 把 `confusable_with` 定义为 **Symbol/Concept ↔ Symbol/Concept**，
   * 而它此前被我错放在 `Skill.confusable_with_skill_ids` 上（且留了一条悬空引用，CI 也没覆盖）。
   * 「初学者会把震和艮搞混」是关于**符号**的判断，不是关于技能的判断。
   *
   * ⚠️ 性质：这是**教学假设**，不是知识论断 —— 它没有文献来源，它的验证方式是**实测数据**
   * （用户真的把 A 判成 B 的频率）。因此它 `evidence_kind` 固定为「教学假设」，
   * 在没有数据前只能是 `draft`；有了数据之后用 `verifications` 记「证实/证否」。
   */
  z.object({
    type: z.literal('confusable_with'),
    /** 两端可以是 Symbol 或 Concept（CI 校验存在性） */
    from_node_id: z.string().min(1),
    to_node_id: z.string().min(1),
    /** 为什么预测这两者会被混淆 —— 没有理由的预测没有采集价值 */
    rationale: z.string().min(1),
    /** 预期混淆的方向（哪个更容易被误判为哪个）；双向则留空 */
    expected_direction: z.enum(['from_to', 'to_from', 'both']).default('both'),
    evidence_kind: z.literal('教学假设'),
    provenance: provenanceSchema,
  }),
]);export type Relation = z.infer<typeof relationSchema>;

export type RelatedByRelation = Extract<Relation, { type: 'related_by' }>;
export type ConfusableWithRelation = Extract<Relation, { type: 'confusable_with' }>;

/**
 * 类型谓词（而不是返回 boolean 的普通回调）。
 * `Array.filter` 只有在收到**类型谓词**时才会收窄元素类型 ——
 * 写成 `(r) => r.type === 'related_by'` 的话，后面访问 `from_symbol_id` 依旧报错。
 */
export const isRelatedBy = (r: Relation): r is RelatedByRelation => r.type === 'related_by';
export const isConfusableWith = (r: Relation): r is ConfusableWithRelation => r.type === 'confusable_with';

/** 取全部生克类关系边 */
export function relatedByEdges(relations: readonly Relation[]): RelatedByRelation[] {
  return relations.filter(isRelatedBy);
}

/** 取全部预设易混淆对 */
export function confusableWithEdges(relations: readonly Relation[]): ConfusableWithRelation[] {
  return relations.filter(isConfusableWith);
}
