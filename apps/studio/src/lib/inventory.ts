/**
 * 清点：**哪些条目可以签字、哪些卡住、卡在哪条规则**。
 *
 * 这是整个工具最要紧的一层。人工签字（缺口清单 D1）之所以一直没做，不是不愿意，
 * 而是 62 条带 provenance 的条目、45 条复核记录、22 条 CI 规则混在一起，
 * 没人能一眼看出「现在到底能不能签、签了会不会被 CI 打回」。
 *
 * ── 核心设计一：**不重新实现规则** ──
 * 「能不能升 reviewed」的答案**不是**在这里用 if 拼出来的，而是：
 *   把条目在**内存副本**里改成 `reviewed` → 跑**真正的** `validateBundle` → 看它报什么。
 *
 * 为什么必须这样：任何「工具自己算一遍规则」的实现都会与 `validate/rules.ts` 漂移，
 * 而漂移的表现是**工具说「可以签字」、CI 说「不行」**——这种谎比没有工具更糟。
 * 走真校验器则天然不会撒谎：工具的判据就是 CI 的判据。
 * （`inventory.test.ts` 逐条把全部条目推进校验器，锁住这条不变量。）
 *
 * ── 核心设计二：操作对象是**原始 JSON**，不是 zod 的输出 ──
 * 原因见 store.ts 顶部：zod 会改键序、补默认值，用它写回会产生上千行 diff。
 * 所以这一层遍历原始 JSON（`RawBundle`），只在**模拟校验**时才把副本交给 zod 解析。
 */
import { contentBundleSchema, validateBundle, type Provenance, type Verification } from '@dlg/domain';
import type { RawBundle } from './store.js';

/** 与 `validate/rules.ts` 的 `entity_kind` 取值一一对应 */
export type EntityKind =
  | 'formalism'
  | 'attribute_space'
  | 'symbol'
  | 'system'
  | 'school'
  | 'concept'
  | 'schema'
  | 'rule'
  | 'skill'
  | 'rubric'
  | 'assessment_spec'
  | 'relation'
  | 'exercise'
  | 'exercise_template';

export interface EntityRef {
  kind: EntityKind;
  id: string;
}

export interface Blocker {
  /** CI 规则号（R1a / R1b / R19 …）—— 让「卡在哪」可追溯到规则条文 */
  rule: string;
  message: string;
}

export interface InventoryEntry {
  kind: EntityKind;
  /** 对 relation 而言是合成标签（关系边没有 id 字段），格式与 CI 报错一致 */
  id: string;
  /** 给人看的名字 */
  label: string;
  review_status: Provenance['review_status'];
  authored_by: Provenance['authored_by'];
  source_strength: Provenance['source_strength'];
  controversy_flag: boolean;
  sources: Provenance['sources'];
  verifications: Verification[];
  reviewer?: string;
  reviewed_at?: string;
  /** 是否已有「人工 + 证实/部分证实」的复核记录（R19 的实质要件） */
  humanSigned: boolean;
  /** 把本条目改成 reviewed 后，CI 会报出的、属于本条目的 error。空 = 现在就能签 */
  blockers: Blocker[];
  /**
   * 是否属于「验证方式是实测数据、不是文献」的教学假设（预设易混淆对）。
   * 这类条目永远不能靠文献升 reviewed —— 它们只能靠玩出来的数据记「证实/证否」。
   */
  isTeachingHypothesis: boolean;
}

type Json = Record<string, unknown>;

/** bundle 里 14 组带 provenance 的集合 → CI 的 entity_kind + 人类可读标签 */
const COLLECTIONS: Array<{ key: string; kind: EntityKind; label: (item: Json) => string }> = [
  { key: 'formalism', kind: 'formalism', label: (i) => String(i['name'] ?? '') },
  { key: 'attribute_spaces', kind: 'attribute_space', label: (i) => String(i['name'] ?? '') },
  { key: 'symbols', kind: 'symbol', label: (i) => String(i['canonical_name'] ?? '') },
  { key: 'systems', kind: 'system', label: (i) => String(i['name'] ?? '') },
  { key: 'schools', kind: 'school', label: (i) => String(i['name'] ?? '') },
  { key: 'concepts', kind: 'concept', label: (i) => String(i['name'] ?? '') },
  { key: 'schemas', kind: 'schema', label: (i) => String(i['name'] ?? '') },
  { key: 'rules', kind: 'rule', label: (i) => String(i['name'] ?? '') },
  { key: 'skills', kind: 'skill', label: (i) => truncate(String(i['statement'] ?? '')) },
  { key: 'rubrics', kind: 'rubric', label: (i) => String(i['name'] ?? '') },
  { key: 'assessment_specs', kind: 'assessment_spec', label: (i) => String(i['name'] ?? '') },
  { key: 'exercises', kind: 'exercise', label: (i) => truncate(String(i['prompt'] ?? '')) },
  { key: 'exercise_templates', kind: 'exercise_template', label: (i) => String(i['name'] ?? '') },
];

const truncate = (s: string, n = 52): string => (s.length <= n ? s : `${s.slice(0, n)}…`);

function arrayAt(json: Json, key: string): Json[] {
  const v = json[key];
  return Array.isArray(v) ? (v.filter((x) => x !== null && typeof x === 'object') as Json[]) : [];
}

/**
 * 关系边的合成标签。**必须与 `validate/rules.ts` 里 R1 报错用的字符串逐字符一致**，
 * 否则按 entity_id 归属报错就会全部落空（表现是「工具说没阻塞，CI 说不行」）。
 * `inventory.test.ts` 有一条测试专门锁这个一致性。
 */
export function relationEntityId(r: Json): string {
  return r['type'] === 'related_by'
    ? `related_by ${String(r['from_symbol_id'])}→${String(r['to_symbol_id'])}`
    : `confusable_with ${String(r['from_node_id'])}~${String(r['to_node_id'])}`;
}

/** 一条清点到的实体（provenance 是**原始 JSON 对象**，可直接改） */
export interface RawEntity {
  ref: EntityRef;
  label: string;
  provenance: Json;
  isTeachingHypothesis: boolean;
}

/** 遍历全部带 provenance 的条目（顺序稳定：按集合声明顺序，再按数组顺序） */
export function enumerateEntities(json: RawBundle): RawEntity[] {
  const out: RawEntity[] = [];

  for (const spec of COLLECTIONS) {
    for (const item of arrayAt(json, spec.key)) {
      const prov = item['provenance'];
      if (prov === null || typeof prov !== 'object') continue;
      out.push({
        ref: { kind: spec.kind, id: String(item['id'] ?? '') },
        label: spec.label(item),
        provenance: prov as Json,
        isTeachingHypothesis: false,
      });
    }
  }

  for (const r of arrayAt(json, 'relations')) {
    const prov = r['provenance'];
    if (prov === null || typeof prov !== 'object') continue;
    const isConfusable = r['type'] === 'confusable_with';
    out.push({
      ref: { kind: 'relation', id: relationEntityId(r) },
      label: isConfusable
        ? `${String(r['from_node_id'])} ~ ${String(r['to_node_id'])}（易混淆）`
        : `${String(r['from_symbol_id'])} --${String(r['subtype'])}--> ${String(r['to_symbol_id'])}`,
      provenance: prov as Json,
      // 教学假设：验证方式是实测数据，不是文献（见 relation.ts 的注释与 R1c 的特殊提示）
      isTeachingHypothesis: isConfusable,
    });
  }

  return out;
}

/** 取某个条目的 provenance（**唯一的定位入口**，review.ts 也走它） */
export function findProvenance(json: RawBundle, ref: EntityRef): Json | undefined {
  return enumerateEntities(json).find((e) => e.ref.kind === ref.kind && e.ref.id === ref.id)?.provenance;
}

/** R19 的实质要件：至少一条「人工 + 证实/部分证实」 */
export function hasHumanSignoff(verifications: readonly Verification[]): boolean {
  return verifications.some(
    (v) => v.checked_by === 'human' && (v.outcome === '证实' || v.outcome === '部分证实'),
  );
}

/**
 * 模拟「把这一条改成 reviewed」，跑**真校验器**，收回属于它的 error。
 *
 * 副本必须**先过 schema 解析**再交给 `validateBundle`：校验器读的是带默认值的强类型
 * 形状（例如 `verifications` 可能整个键都不存在），直接喂原始 JSON 会让它读到 undefined。
 */
function blockersFor(json: RawBundle, ref: EntityRef): Blocker[] {
  const probe = structuredClone(json) as RawBundle;
  const prov = findProvenance(probe, ref);
  if (!prov) return [{ rule: '(内部)', message: '定位不到该条目的 provenance —— 工具的实体映射与内容库不一致' }];

  prov['review_status'] = 'reviewed';
  // reviewer / reviewed_at 不是 R19 的要件（文档未把它们定为必填），
  // 所以这里不设它们 —— 否则会把「工具顺手填的占位值」算成签字要件。

  const parsed = contentBundleSchema.safeParse(probe);
  if (!parsed.success) {
    return [{ rule: '(schema)', message: '把该条目改成 reviewed 后内容库不再符合 schema —— 这不该发生' }];
  }
  const report = validateBundle(parsed.data);

  return report.errors
    .filter((e) => e.entity_kind === ref.kind && e.entity_id === ref.id)
    .map((e) => ({ rule: e.rule, message: e.message }));
}

function entryOf(raw: RawEntity, json: RawBundle): InventoryEntry {
  const p = raw.provenance;
  const verifications = (p['verifications'] ?? []) as Verification[];
  const base = {
    kind: raw.ref.kind,
    id: raw.ref.id,
    label: raw.label,
    review_status: p['review_status'] as Provenance['review_status'],
    authored_by: p['authored_by'] as Provenance['authored_by'],
    source_strength: p['source_strength'] as Provenance['source_strength'],
    controversy_flag: p['controversy_flag'] === true,
    sources: (p['sources'] ?? []) as Provenance['sources'],
    verifications,
    humanSigned: hasHumanSignoff(verifications),
    isTeachingHypothesis: raw.isTeachingHypothesis,
  };
  return {
    ...base,
    ...(typeof p['reviewer'] === 'string' ? { reviewer: p['reviewer'] } : {}),
    ...(typeof p['reviewed_at'] === 'string' ? { reviewed_at: p['reviewed_at'] } : {}),
    blockers: p['review_status'] === 'reviewed' ? [] : blockersFor(json, raw.ref),
  };
}

/**
 * 清点结果。`cacheKey` 相同则直接复用 —— 每次清点要跑 62 次校验器（每次都克隆并解析
 * 整个内容库），本机够快但没必要在每个 HTTP 请求里重算。
 */
let memo: { key: string; value: InventoryEntry[] } | undefined;

export function buildInventory(json: RawBundle, cacheKey?: string): InventoryEntry[] {
  if (cacheKey !== undefined && memo?.key === cacheKey) return memo.value;

  const entries = enumerateEntities(json).map((raw) => entryOf(raw, json));

  if (cacheKey !== undefined) memo = { key: cacheKey, value: entries };
  return entries;
}

/** 清点汇总 —— 给总览页用 */
export interface InventorySummary {
  total: number;
  byStatus: Record<string, number>;
  byKind: Array<{ kind: EntityKind; total: number; ready: number; signed: number }>;
  readyToSign: number;
  signed: number;
  aiVerifications: number;
  humanVerifications: number;
}

export function summarize(entries: readonly InventoryEntry[]): InventorySummary {
  const byStatus: Record<string, number> = {};
  const kindMap = new Map<EntityKind, { total: number; ready: number; signed: number }>();
  let readyToSign = 0;
  let signed = 0;
  let aiVerifications = 0;
  let humanVerifications = 0;

  for (const e of entries) {
    byStatus[e.review_status] = (byStatus[e.review_status] ?? 0) + 1;
    const k = kindMap.get(e.kind) ?? { total: 0, ready: 0, signed: 0 };
    k.total += 1;
    if (e.review_status === 'draft' && e.blockers.length === 0) {
      k.ready += 1;
      readyToSign += 1;
    }
    if (e.humanSigned) {
      k.signed += 1;
      signed += 1;
    }
    kindMap.set(e.kind, k);
    for (const v of e.verifications) {
      if (v.checked_by === 'human') humanVerifications += 1;
      else aiVerifications += 1;
    }
  }

  return {
    total: entries.length,
    byStatus,
    byKind: [...kindMap.entries()]
      .map(([kind, v]) => ({ kind, ...v }))
      .sort((a, b) => b.total - a.total),
    readyToSign,
    signed,
    aiVerifications,
    humanVerifications,
  };
}
