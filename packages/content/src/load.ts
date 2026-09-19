/**
 * 内容库加载与 CI 校验的唯一入口。
 *
 * `bundle.json` 是**唯一事实来源**：它就是将来要入库的形态（JSON → Postgres）。
 * 不用 TS 写内容，是为了让「手写内容」与「CI 校验」走的是同一条路 —— 否则
 * 类型系统会替 schema 兜底，schema 本身的问题就被掩盖了。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { contentBundleSchema, type ContentBundle } from '@dlg/domain';

const here = dirname(fileURLToPath(import.meta.url));
export const BUNDLE_PATH = join(here, '..', 'bundle.json');

export interface LoadResult {
  ok: boolean;
  bundle?: ContentBundle;
  /** 若 schema 校验失败，这里是可读的失败原因 */
  schemaIssues?: string[];
}

export async function loadBundle(path: string = BUNDLE_PATH): Promise<LoadResult> {
  const raw = await readFile(path, 'utf8');
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    return { ok: false, schemaIssues: [`JSON 解析失败：${(e as Error).message}`] };
  }
  const parsed = contentBundleSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      schemaIssues: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
  }
  return { ok: true, bundle: parsed.data };
}
