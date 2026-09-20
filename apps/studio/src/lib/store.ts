/**
 * 内容库读写 —— **唯一**允许动 `bundle.json` 的地方。
 *
 * 为什么这里值得单独一层、还写这么多注释：
 * `bundle.json` 是内容的**唯一事实来源**，而且它是**手写的**（3686 行、2 空格缩进、
 * 键序有意义）。一个会改它的工具如果做不到下面四件事，就等于在给仓库随机投毒。
 *
 * ── ① 写回的是**原始 JSON**，不是 zod 的输出（这一条是踩出来的，别改回去）──
 * 最初的实现是 `JSON.parse` → `contentBundleSchema.parse` → `JSON.stringify(zod输出)`。
 * 结果：**整份文件 974 行 diff**。两个原因，都不是 bug 而是 zod 的正常行为：
 *   · **键序变了**：`entityBaseSchema.extend({...})` 的字段顺序是「base 的键在前」，
 *     于是 `formalism[0]` 从 `id, name, description, symbol_scope, provenance`
 *     变成 `id, provenance, name, description, symbol_scope`；
 *   · **默认值被实体化**：`.default([])` 会把文件里**没有**的 `verifications: []`
 *     补出来（`provenance` 在很多条目里根本没写这个键）。
 * 后果不是「丑」而是**危险**：每次「签一个字」都会产生上千行 diff，
 * git 历史失去可读性，于是没人再看得清这次签字到底改了什么。
 * 所以：**zod 只用来校验（`safeParse`），写回一律用原始 JSON 对象**（`json` 字段）。
 * `store.test.ts` 有一条测试锁死「未修改的 bundle 写回去字节不变」。
 *
 * ── ② 原子 ──
 * 「临时文件 + rename」而不是直接覆写。写到一半被打断（Ctrl-C、断电、磁盘满）
 * 不能留下半个 JSON —— 那会让整个内容库 parse 失败，而唯一的事实来源坏了
 * 就没有第二份可恢复。
 *
 * ── ③ 失败即回滚，但只看**新增**的 error ──
 * 写完后从磁盘重新读回来再校验一遍；若**出现了写入前不存在的** error，就恢复原字节并抛错。
 * 为什么是「新增」而不是「有任何 error」：内容库本来可能就带着若干 error 在开发中，
 * 那种情况下如果一律拒绝写入，工具就完全用不了了 —— 而那会把「不许写坏」
 * 变成「什么都不许做」。真正要挡的是**这次改动造成的**破坏。
 *
 * ── ④ 不做版本号自增 ──
 * `provenance.version` 的语义在文档里没有定义（只写了 `int().positive().default(1)`），
 * 凭空赋予它「每次编辑 +1」的含义属于发明规格。见 ADR-0026 的「未决」一节。
 */
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { contentBundleSchema, validateBundle, type ContentBundle, type ValidationReport } from '@dlg/domain';
import { BUNDLE_PATH } from '@dlg/content';

/** 原始 JSON 对象（键序与文件一致）。**写回用的是它**，不是 zod 的输出 */
export type RawBundle = Record<string, unknown>;

/** 内容库路径。`DLG_BUNDLE` 供测试指向临时文件 —— 测试绝不能碰真实内容库 */
export function resolveBundlePath(): string {
  return process.env.DLG_BUNDLE ?? BUNDLE_PATH;
}

export interface LoadedBundle {
  /** 磁盘上的原始字节。回滚与「未修改」判定都以它为准 */
  raw: string;
  /** 原始 JSON 对象：**写回用这个**（保留键序，不补默认值） */
  json: RawBundle;
  /** zod 解析后的强类型对象：**只用于校验/清点/生成**，不要拿它写回 */
  bundle: ContentBundle;
}

export class BundleSchemaError extends Error {
  constructor(public readonly issues: string[]) {
    super(`bundle.json 不符合 schema：\n  - ${issues.join('\n  - ')}`);
    this.name = 'BundleSchemaError';
  }
}

/**
 * 序列化。**这是「字节级可预测」的唯一实现处** —— 任何地方都不许再自己 stringify。
 *
 * 尾随换行不是装饰：git 与多数编辑器约定文本文件以 \n 结束；少了它，
 * 每个 diff 都会显示「文件末尾无换行符」，噪声会淹没真正的改动。
 */
export function serializeBundle(json: unknown): string {
  return `${JSON.stringify(json, null, 2)}\n`;
}

/** 读原始字节（回滚用） */
export async function readRaw(path: string = resolveBundlePath()): Promise<string> {
  return readFile(path, 'utf8');
}

/**
 * 把原始字节解析成 `{ raw, json, bundle }`。
 *
 * `json` 与 `bundle` 是**同一份数据的两种视图**：前者保真（键序、缺省），
 * 后者带类型与默认值。写用前者、读用后者，这个分工是刻意的。
 */
export function parseBundleText(raw: string): LoadedBundle {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new BundleSchemaError([`JSON 解析失败：${(e as Error).message}`]);
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new BundleSchemaError(['顶层必须是一个对象']);
  }
  const parsed = contentBundleSchema.safeParse(json);
  if (!parsed.success) {
    throw new BundleSchemaError(parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
  }
  return { raw, json: json as RawBundle, bundle: parsed.data };
}

export async function loadBundle(path: string = resolveBundlePath()): Promise<LoadedBundle> {
  return parseBundleText(await readRaw(path));
}

/** 对**内存里的**内容做 schema 校验（写前检查，不落盘） */
export function checkSchema(value: unknown): string[] {
  const parsed = contentBundleSchema.safeParse(value);
  return parsed.success
    ? []
    : parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

export interface WriteOutcome {
  /** 写入的字节 */
  text: string;
  /** 写入前的字节（回滚用；UI 的「撤回」也用它） */
  previous: string;
  /** 写入并重新读回后的校验报告 */
  report: ValidationReport;
}

/** error 的身份：规则 + 归属 + 说明。用它比较「写入前后新增了哪些 error」 */
function errorKey(e: { rule: string; entity_kind: string; entity_id: string; message: string }): string {
  return `${e.rule}|${e.entity_kind}|${e.entity_id}|${e.message}`;
}

/**
 * 原子写入 + 校验门 + 失败回滚。
 *
 * 顺序是刻意的：**先校验 → 再落盘 → 再读回校验**。
 * 只在写前校验不够：真正的事实来源是磁盘上的字节，不是内存里的对象。
 */
export async function writeBundle(
  json: RawBundle,
  path: string = resolveBundlePath(),
): Promise<WriteOutcome> {
  const schemaIssues = checkSchema(json);
  if (schemaIssues.length > 0) {
    throw new BundleSchemaError(schemaIssues);
  }

  const previous = await readRaw(path);
  const before = validateBundle(parseBundleText(previous).bundle);
  const beforeKeys = new Set(before.errors.map(errorKey));

  const text = serializeBundle(json);

  // ① 临时文件与目标同目录 —— 跨设备 rename 会失败，同目录才保证原子
  const tmp = `${path}.studio-tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, path);

  // ② 读回校验：确保**磁盘上的字节**能过 CI 门
  const reread = parseBundleText(await readRaw(path));
  const report = validateBundle(reread.bundle);
  const introduced = report.errors.filter((e) => !beforeKeys.has(errorKey(e)));

  if (introduced.length > 0) {
    // ③ 回滚。previous 已在内存里，直接写回即可
    await writeFile(path, previous, 'utf8');
    await unlinkIfExists(tmp);
    const detail = introduced
      .slice(0, 8)
      .map((e) => `[${e.rule}] ${e.entity_kind}:${e.entity_id} ${e.message}`)
      .join('\n  - ');
    throw new Error(
      `写入被拒绝并已回滚：这次改动引入了 ${introduced.length} 个新的 CI error。\n  - ${detail}`,
    );
  }

  await unlinkIfExists(tmp);
  return { text, previous, report };
}

async function unlinkIfExists(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // 临时文件通常已被 rename 消耗掉；不存在不算错误
  }
}

/** 直接以原始字节恢复（UI 的「撤回上一次写入」用） */
export async function restoreRaw(raw: string, path: string = resolveBundlePath()): Promise<void> {
  await writeFile(path, raw, 'utf8');
}
