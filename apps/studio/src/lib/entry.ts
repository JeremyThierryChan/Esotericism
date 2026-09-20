/**
 * 录入：新增/修改内容条目。
 *
 * ── 为什么没有「每种实体一个表单」 ──
 * 有过这个冲动，但放弃了：14 组带 provenance 的实体 + 5 组连接表，字段各不相同，
 * 而 schema 是唯一权威。手写表单 = 在 schema 之外维护第二份字段清单，
 * 它一定会漂移，而漂移的表现是「表单能填、CI 打回」或者更糟「表单没这个字段、
 * 于是内容里永远不需要它」。所以录入走 **JSON + 真 schema 校验**：
 *   · 校验不重新实现规则，而是把条目**放进内容库副本**里，让 `contentBundleSchema`
 *     自己去报错（连 `content_texts` 这种没有独立导出 schema 的集合也天然覆盖）；
 *   · 报错里的 `symbols.17.canonical_name` 会被剥成 `canonical_name`，读起来像人话。
 * 代价是录入体验不如表单 —— 这是**刻意的**取舍，理由同 ADR-0008：这一步的工具
 * 服务的是「内容能安全进库」，不是「填得快」。
 *
 * ── 骨架为什么不是手写的 ──
 * 手写的示例 JSON 会随 schema 演进过期，而且会写成「看起来对、实际引用不存在」的样子。
 * 这里改为**从现有真实条目克隆**：结构、引用风格、字段齐全度都天然正确。
 * 但 provenance 会被**重置**（见 `scaffoldFrom`）—— 复制别人的复核记录等于伪造审计。
 *
 * ── 写回的是原始 JSON ──
 * 与 review.ts 同理（见 store.ts 顶部）：新增/修改只动目标集合，其余字节不动。
 */
import type { RawBundle } from './store.js';
import { checkSchema, loadBundle, resolveBundlePath, writeBundle, type WriteOutcome } from './store.js';
import { contentBundleSchema, validateBundle } from '@dlg/domain';
import type { EntityKind } from './inventory.js';

/** bundle 的数组集合（20 组）——录入的最小单位是「某集合里的一条」 */
export interface CollectionSpec {
  key: string;
  /** 与 inventory 的 EntityKind 对齐；连接表另有自己的标识 */
  kind: EntityKind | 'has_attribute' | 'symbol_usage' | 'rule_test_set' | 'skill_edge' | 'content_text' | 'transfer_edge';
  /** 该集合的条目是否带 provenance（决定它能否被签字） */
  hasProvenance: boolean;
  /** 是否用 `id` 作为键 */
  hasId: boolean;
  label: string;
}

export const COLLECTIONS: CollectionSpec[] = [
  { key: 'formalism', kind: 'formalism', hasProvenance: true, hasId: true, label: '形式系统' },
  { key: 'attribute_spaces', kind: 'attribute_space', hasProvenance: true, hasId: true, label: '属性空间' },
  { key: 'symbols', kind: 'symbol', hasProvenance: true, hasId: true, label: '符号' },
  { key: 'systems', kind: 'system', hasProvenance: true, hasId: true, label: '体系' },
  { key: 'schools', kind: 'school', hasProvenance: true, hasId: true, label: '流派' },
  { key: 'concepts', kind: 'concept', hasProvenance: true, hasId: true, label: '概念' },
  { key: 'schemas', kind: 'schema', hasProvenance: true, hasId: true, label: '认知图式' },
  { key: 'relations', kind: 'relation', hasProvenance: true, hasId: false, label: '关系边' },
  { key: 'rules', kind: 'rule', hasProvenance: true, hasId: true, label: '规则' },
  { key: 'rule_test_sets', kind: 'rule_test_set', hasProvenance: false, hasId: false, label: '规则测试集' },
  { key: 'transfer_edges', kind: 'transfer_edge', hasProvenance: false, hasId: true, label: '跨体系迁移边（⚠️ 无 provenance，不能签字）' },
  { key: 'skills', kind: 'skill', hasProvenance: true, hasId: true, label: '技能' },
  { key: 'skill_edges', kind: 'skill_edge', hasProvenance: false, hasId: false, label: '技能前置边' },
  { key: 'rubrics', kind: 'rubric', hasProvenance: true, hasId: true, label: '评分规约' },
  { key: 'assessment_specs', kind: 'assessment_spec', hasProvenance: true, hasId: true, label: '评测规约' },
  { key: 'exercises', kind: 'exercise', hasProvenance: true, hasId: true, label: '手写题目' },
  { key: 'exercise_templates', kind: 'exercise_template', hasProvenance: true, hasId: true, label: '题目模板' },
  { key: 'has_attributes', kind: 'has_attribute', hasProvenance: false, hasId: false, label: '符号属性赋值' },
  { key: 'symbol_usages', kind: 'symbol_usage', hasProvenance: false, hasId: false, label: '符号用法' },
  { key: 'content_texts', kind: 'content_text', hasProvenance: false, hasId: false, label: '自然语言文本' },
];

export interface EntryIssue {
  path: string;
  message: string;
}

export interface EntryValidation {
  ok: boolean;
  /** schema 层的问题（字段类型、必填、取值域） */
  schemaIssues: EntryIssue[];
  /** CI 层的问题（引用完整性、来源、跨实体一致性…）——只保留属于本条目的 */
  ciIssues: EntryIssue[];
}

function findSpec(key: string): CollectionSpec {
  const spec = COLLECTIONS.find((c) => c.key === key);
  if (!spec) throw new Error(`未知集合：${key}`);
  return spec;
}

type Json = Record<string, unknown>;

function listOf(json: RawBundle, key: string): Json[] {
  const v = json[key];
  return Array.isArray(v) ? (v as Json[]) : [];
}

/** 键值：有 id 用 id；连接表用「两端」合成一个可读键（仅用于定位） */
export function keyOf(spec: CollectionSpec, item: unknown): string {
  if (item === null || typeof item !== 'object') return '';
  const o = item as Json;
  if (spec.hasId && typeof o['id'] === 'string') return o['id'];
  return Object.entries(o)
    .filter(([k]) => k.endsWith('_id'))
    .map(([, v]) => String(v))
    .join('|');
}

/**
 * 校验一条待录入的内容。
 *
 * 做法：把条目**放进内容库副本**再整体过 schema —— 而不是单独 parse 一个实体 schema。
 * 好处是连 `content_texts`（schema 内联在 contentBundleSchema 里、没有单独导出）
 * 也一并覆盖，且不需要维护「kind → schema」的第二份映射表。
 */
export function validateEntry(
  json: RawBundle,
  key: string,
  item: unknown,
  mode: 'create' | 'update',
): EntryValidation {
  const spec = findSpec(key);
  const probe = structuredClone(json) as RawBundle;
  const list = [...listOf(probe, key)];

  const itemKey = keyOf(spec, item);
  const index = list.findIndex((x) => keyOf(spec, x) === itemKey);
  if (mode === 'create' && index >= 0) {
    return { ok: false, schemaIssues: [{ path: spec.key, message: `已存在同一个键的条目：${itemKey}` }], ciIssues: [] };
  }
  if (mode === 'update' && index < 0) {
    return { ok: false, schemaIssues: [{ path: spec.key, message: `找不到要更新的条目：${itemKey}` }], ciIssues: [] };
  }

  if (index >= 0) list[index] = item as Json;
  else list.push(item as Json);
  probe[key] = list;

  const prefix = `${key}.`;
  const strip = (p: string): string => (p.startsWith(prefix) ? p.slice(prefix.length) : p);

  const schemaIssues = checkSchema(probe).map((raw) => {
    const at = raw.indexOf(': ');
    const path = at >= 0 ? raw.slice(0, at) : raw;
    const message = at >= 0 ? raw.slice(at + 2) : '';
    return { path: strip(path), message };
  });

  // schema 都不过就不必跑 CI：CI 是在合法内容上做跨实体判断的
  if (schemaIssues.length > 0) return { ok: false, schemaIssues, ciIssues: [] };

  const parsed = contentBundleSchema.safeParse(probe);
  if (!parsed.success) {
    return { ok: false, schemaIssues: [{ path: '(schema)', message: '内容库副本解析失败' }], ciIssues: [] };
  }
  const ciIssues = validateBundle(parsed.data).errors
    .filter((e) => e.entity_id === itemKey)
    .map((e) => ({ path: `[${e.rule}] ${e.entity_kind}`, message: e.message }));

  return { ok: ciIssues.length === 0, schemaIssues, ciIssues };
}

/**
 * 生成骨架：**从现有真实条目克隆**，然后重置 provenance。
 *
 * ⚠️ 为什么必须清空 `verifications` 与 `sources`：
 * 从别的条目复制复核记录 = **伪造审计链**（那条记录说的是「我核过 X 的论断」，
 * 不是「我核过你新写的这条」）。清空后 R1c 会给出「draft 无来源」警告 ——
 * 这正是想要的：它挡在签字路上，逼作者真的补来源，而不是继承一条看起来很像的来源。
 */
export function scaffoldFrom(json: RawBundle, key: string): unknown {
  const spec = findSpec(key);
  const sample = listOf(json, key)[0];
  if (sample === undefined) {
    throw new Error(`集合 ${key} 里没有任何条目可供克隆 —— 骨架需要一条真实样本`);
  }
  const clone = structuredClone(sample) as Json;

  if (spec.hasId) clone['id'] = 'new.id';
  const p = clone['provenance'];
  if (spec.hasProvenance && p !== null && typeof p === 'object') {
    const prov = p as Json;
    // 结构字段（source_strength 等）保留：它们是作者要显式决定的
    prov['sources'] = [];
    prov['verifications'] = [];
    prov['review_status'] = 'draft';
    prov['authored_by'] = 'human';
    prov['version'] = 1;
    delete prov['reviewer'];
    delete prov['reviewed_at'];
  }
  return clone;
}

/** 合法引用清单：录入时最常出错的是「引用了不存在的 id」，这里把它列出来 */
export interface ReferenceIndex {
  byCollection: Array<{ key: string; label: string; ids: string[] }>;
}

export function referenceIndex(json: RawBundle): ReferenceIndex {
  return {
    byCollection: COLLECTIONS.map((spec) => ({
      key: spec.key,
      label: spec.label,
      ids: listOf(json, spec.key)
        .map((x) => x['id'])
        .filter((x): x is string => typeof x === 'string'),
    })).filter((c) => c.ids.length > 0),
  };
}

export interface SaveEntryResult {
  key: string;
  entryKey: string;
  mode: 'create' | 'update';
  validation: EntryValidation;
  report?: WriteOutcome['report'];
  previous?: string;
}

/** 保存（先校验，再走统一的写入门） */
export async function saveEntry(
  key: string,
  item: unknown,
  mode: 'create' | 'update',
  path?: string,
): Promise<SaveEntryResult> {
  const spec = findSpec(key);
  const target = path ?? resolveBundlePath();
  const { json } = await loadBundle(target);

  const validation = validateEntry(json, key, item, mode);
  const entryKey = keyOf(spec, item);
  if (!validation.ok) {
    return { key, entryKey, mode, validation };
  }

  const next = structuredClone(json) as RawBundle;
  const list = [...listOf(next, key)];
  const index = list.findIndex((x) => keyOf(spec, x) === entryKey);
  if (index >= 0) list[index] = item as Json;
  else list.push(item as Json);
  next[key] = list;

  const written = await writeBundle(next, target);
  return { key, entryKey, mode, validation, report: written.report, previous: written.previous };
}

/** 删除条目（内容出错时得能拿掉，而不是留着坏数据等 CI 拦） */
export async function deleteEntry(
  key: string,
  entryKey: string,
  path?: string,
): Promise<{ removed: boolean; report?: WriteOutcome['report']; previous?: string }> {
  const spec = findSpec(key);
  const target = path ?? resolveBundlePath();
  const { json } = await loadBundle(target);

  const list = listOf(json, key);
  const index = list.findIndex((x) => keyOf(spec, x) === entryKey);
  if (index < 0) return { removed: false };

  const next = structuredClone(json) as RawBundle;
  const nextList = [...listOf(next, key)];
  nextList.splice(index, 1);
  next[key] = nextList;

  const written = await writeBundle(next, target);
  return { removed: true, report: written.report, previous: written.previous };
}
