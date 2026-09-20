/**
 * 审核操作：记一条人工复核记录 / 升级 reviewed / 撤回 draft。
 *
 * ── 一条刻意的硬约束（这是本工具的设计核心，不是疏漏）──
 * 本工具**只能写 `checked_by: 'human'`**，没有写 `ai-candidate` 的入口。
 *
 * 理由：认识论原则 3 说「`ai-candidate` 产出永远不能直接进入 `reviewed`」，
 * CI 规则 R1b/R19 也照着这条拦。但那两道闸门挡的是**状态**，不是**动作** ——
 * 如果工具提供一个「记一条 AI 复核记录」的按钮，那从 AI 找到来源到条目变成 reviewed
 * 就只差一次点击，而点击的人并没有真的核对原文。闸门会被**合规地**绕过。
 * 所以这里把入口本身去掉：能进 `verifications[]` 的 AI 记录，只能由内容作者
 * 直接写进 bundle.json（那是有意为之的动作，不是一次误点）。
 *
 * ── 每个写操作都过同一道门 ──
 * 全部经 `writeBundle`：schema 校验 → 原子写 → 读回校验 → 出现新 error 就自动回滚。
 * 并且升级前**先用真校验器预检**，把「为什么不行」讲清楚，而不是先写坏再回滚。
 *
 * ── 改动落在**原始 JSON** 上，改动面尽量小 ──
 * 每次签字只动「那一条」的几个键，所以 diff 是几行，不是上千行（见 store.ts 顶部）。
 */
import type { Verification } from '@dlg/domain';
import { buildInventory, findProvenance, type Blocker, type EntityRef, type InventoryEntry } from './inventory.js';
import { loadBundle, resolveBundlePath, writeBundle, type RawBundle, type WriteOutcome } from './store.js';

/** 人填的复核记录。`checked_by` 与 `checked_at` 由工具填，不由调用方填 */
export interface VerificationInput {
  /** 被核实的**具体论断** */
  claim: string;
  source: {
    ref: string;
    author?: string;
    year?: number;
    url?: string;
    confidence?: Verification['source']['confidence'];
    note?: string;
  };
  /** 定位：卷次 / 篇名 / 章节 / URL 锚点 */
  locator?: string;
  /** 关键原文摘录 */
  excerpt?: string;
  outcome: Verification['outcome'];
  note?: string;
}

export interface ReviewResult {
  ref: EntityRef;
  action: 'verify' | 'promote' | 'demote';
  /** 变更后的条目状态（重新清点得到，不是手拼的） */
  entry: InventoryEntry;
  /** 写入后的 CI 报告 */
  report: WriteOutcome['report'];
  /** 写入前的原始字节（UI 的「撤回」用） */
  previous: string;
}

export class ReviewError extends Error {
  constructor(message: string, public readonly blockers: Blocker[] = []) {
    super(message);
    this.name = 'ReviewError';
  }
}

/** 取条目并断言存在 —— 定位失败要立刻报错，不能静默改到别处 */
async function requireEntry(path: string, ref: EntityRef): Promise<{ json: RawBundle; entry: InventoryEntry }> {
  const { raw, json } = await loadBundle(path);
  const entry = buildInventory(json, raw).find((e) => e.kind === ref.kind && e.id === ref.id);
  if (!entry) {
    throw new ReviewError(`定位不到条目：${ref.kind} / ${ref.id} —— 检查 id 是否拼错，或内容库是否已变更`);
  }
  return { json, entry };
}

/**
 * 记一条**人工**复核记录。
 *
 * ⚠️ 只追加、不修改既有记录：复核记录是审计链，改写它等于伪造审计。
 * 写错了就再记一条把结论说明白，而不是覆盖。
 */
export async function recordVerification(
  ref: EntityRef,
  input: VerificationInput,
  reviewer: string,
  path?: string,
): Promise<ReviewResult> {
  const name = reviewer.trim();
  if (name.length === 0) {
    throw new ReviewError('必须填「复核人」—— 没有署名的复核记录不构成签字（它是审计链的一环）');
  }
  if (input.claim.trim().length === 0) {
    throw new ReviewError('必须填「被核实的论断」—— 写「这本书是对的」这种话无法复核');
  }
  if (input.source.ref.trim().length === 0) {
    throw new ReviewError('必须填「依据来源」');
  }

  const target = path ?? resolveBundlePath();
  const { json } = await requireEntry(target, ref);
  const prov = findProvenance(json, ref);
  if (!prov) throw new ReviewError(`定位不到 ${ref.kind} / ${ref.id} 的 provenance`);

  const verification: Verification = {
    claim: input.claim.trim(),
    source: {
      ref: input.source.ref.trim(),
      ...(input.source.author ? { author: input.source.author } : {}),
      ...(input.source.year !== undefined ? { year: input.source.year } : {}),
      ...(input.source.url ? { url: input.source.url } : {}),
      ...(input.source.confidence ? { confidence: input.source.confidence } : {}),
      ...(input.source.note ? { note: input.source.note } : {}),
    },
    ...(input.locator ? { locator: input.locator } : {}),
    ...(input.excerpt ? { excerpt: input.excerpt } : {}),
    // ↓ 这两行是本工具存在的意义：不提供 'ai-candidate' 这个取值
    checked_by: 'human',
    checked_at: new Date().toISOString(),
    outcome: input.outcome,
    ...(input.note ? { note: input.note } : {}),
  };

  // 原始 JSON 里 `verifications` 可能整个键都不存在（文件里省略了默认值），所以要兜底
  const existing = Array.isArray(prov['verifications']) ? (prov['verifications'] as Verification[]) : [];
  prov['verifications'] = [...existing, verification];
  prov['reviewer'] = name;

  const written = await writeBundle(json, target);
  const after = await requireEntry(target, ref);
  return { ref, action: 'verify', entry: after.entry, report: written.report, previous: written.previous };
}

/**
 * 升级为 `reviewed`。
 *
 * 先预检、再写。预检不是为了「代替 CI」，而是为了在**还没动文件**时就把话说清楚；
 * 真正的闸门仍是 `writeBundle` 里的读回校验（预检与它用的是同一个校验器）。
 */
export async function promote(ref: EntityRef, reviewer: string, path?: string): Promise<ReviewResult> {
  const name = reviewer.trim();
  if (name.length === 0) {
    throw new ReviewError('必须填「签字人」—— reviewed 是需要署名的动作');
  }

  const target = path ?? resolveBundlePath();
  const { json, entry } = await requireEntry(target, ref);

  if (entry.review_status === 'reviewed') {
    throw new ReviewError(`${ref.kind} / ${ref.id} 已经是 reviewed`);
  }
  if (entry.blockers.length > 0) {
    throw new ReviewError(
      `还差条件，不能签字（CI 会打回）—— 共 ${entry.blockers.length} 项：\n` +
        entry.blockers.map((b) => `[${b.rule}] ${b.message}`).join('\n'),
      entry.blockers,
    );
  }

  const prov = findProvenance(json, ref);
  if (!prov) throw new ReviewError(`定位不到 ${ref.kind} / ${ref.id} 的 provenance`);

  prov['review_status'] = 'reviewed';
  prov['reviewer'] = name;
  prov['reviewed_at'] = new Date().toISOString();

  const written = await writeBundle(json, target);
  const after = await requireEntry(target, ref);
  return { ref, action: 'promote', entry: after.entry, report: written.report, previous: written.previous };
}

/**
 * 撤回为 `draft`。
 *
 * 为什么必须有这条路：签字若不可撤销，人就倾向于「反正签错也改不了」地拖着不签，
 * 或者签得比读得还快。可撤销才让「谨慎签字」这个要求站得住。
 *
 * `verifications` **保留**（那是审计历史）；但 `reviewer` / `reviewed_at` 会删掉 ——
 * 一个 draft 条目身上挂着「复核时间」只会误导后来的人。
 */
export async function demote(ref: EntityRef, path?: string): Promise<ReviewResult> {
  const target = path ?? resolveBundlePath();
  const { json, entry } = await requireEntry(target, ref);

  if (entry.review_status !== 'reviewed') {
    throw new ReviewError(`${ref.kind} / ${ref.id} 当前不是 reviewed（是 ${entry.review_status}），无需撤回`);
  }

  const prov = findProvenance(json, ref);
  if (!prov) throw new ReviewError(`定位不到 ${ref.kind} / ${ref.id} 的 provenance`);

  prov['review_status'] = 'draft';
  delete prov['reviewer'];
  delete prov['reviewed_at'];

  const written = await writeBundle(json, target);
  const after = await requireEntry(target, ref);
  return { ref, action: 'demote', entry: after.entry, report: written.report, previous: written.previous };
}
