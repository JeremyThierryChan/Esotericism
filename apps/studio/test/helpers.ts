/**
 * 测试公共夹具。
 *
 * 铁律：**任何测试都不许写真实 `bundle.json`**。这里统一提供「临时目录里的内容库副本」，
 * 所有写操作都打在副本上。`store.test.ts` 会断言真实文件在跑完测试后 sha256 未变。
 */
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUNDLE_PATH } from '@dlg/content';

const dirs: string[] = [];

/** 复制一份真实内容库到临时目录，返回它的路径作为 `DLG_BUNDLE` 的目标 */
export async function tempBundle(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dlg-studio-test-'));
  dirs.push(dir);
  const path = join(dir, 'bundle.json');
  await copyFile(BUNDLE_PATH, path);
  return path;
}

/** 在临时内容库上跑一段代码（自动清理） */
export async function withTempBundle<T>(fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'dlg-studio-test-'));
  dirs.push(dir);
  const path = join(dir, 'bundle.json');
  await copyFile(BUNDLE_PATH, path);
  return fn(path);
}

export async function cleanupTempBundles(): Promise<void> {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  dirs.length = 0;
}
