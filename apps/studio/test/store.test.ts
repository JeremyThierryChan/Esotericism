/**
 * 读写层测试。
 *
 * ⚠️ 铁律：**测试绝不写真实 `bundle.json`**。
 * 每个用例都在 mkdtemp 出来的临时目录里复制一份内容库来操作 ——
 * 一个会改内容库的工具，如果它的测试直接改内容库，那测试本身就成了风险源。
 * `store.test.ts` 最后一组用例专门断言「跑完全部测试后真实内容库字节未变」。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUNDLE_PATH } from '@dlg/content';
import { loadBundle, readRaw, resolveBundlePath, serializeBundle, writeBundle } from '../src/lib/store.js';

const REAL = BUNDLE_PATH;
const realHashBefore = createHash('sha256').update(await readFile(REAL)).digest('hex');

const dirs: string[] = [];

async function tempBundle(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dlg-studio-'));
  dirs.push(dir);
  const path = join(dir, 'bundle.json');
  await copyFile(REAL, path);
  return path;
}

afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe('序列化：字节级可预测（否则每次签字都是上千行 diff）', () => {
  it('真实内容库往返后逐字节相同（写回用的是原始 JSON，不是 zod 输出）', async () => {
    const raw = await readRaw(REAL);
    const { json } = await loadBundle(REAL);
    expect(serializeBundle(json)).toBe(raw);
  });

  it('⚠️ 反例：拿 **zod 输出** 写回会产生大量 diff（这条测试解释上一条为什么必须存在）', async () => {
    const raw = await readRaw(REAL);
    const { bundle } = await loadBundle(REAL);
    const viaZod = serializeBundle(bundle);
    // zod 会改键序、并把 .default([]) 的字段实体化 → 不能拿它写回
    expect(viaZod).not.toBe(raw);

    const changedLines = (() => {
      const a = raw.split('\n');
      const b = viaZod.split('\n');
      let n = 0;
      for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) n += 1;
      return n;
    })();
    // 实测约 900+ 行；这里只断言「量级」—— 具体数字会随内容增长而变化
    expect(changedLines).toBeGreaterThan(200);
  });

  it('zod 输出不丢数据（可以多出默认值，但不许少东西）', async () => {
    const { json, bundle } = await loadBundle(REAL);
    const viaZod = JSON.parse(serializeBundle(bundle)) as unknown;

    /**
     * 子集比较：`json` 里有的键值，zod 输出里必须有且相等；zod 多出的键（默认值）不算错。
     * 为什么不用 `toEqual`：zod 会把 `.default([])` 的字段**补出来**
     * （例如文件里根本没写的 `verifications: []`），而 `toEqual` 把「多一个键」判为不等。
     * 我们要守的不是「形状一模一样」（那由上面两条测试守），而是**没有内容丢失**。
     */
    const missing: string[] = [];
    const check = (a: unknown, b: unknown, path: string): void => {
      if (Array.isArray(a)) {
        if (!Array.isArray(b) || b.length !== a.length) {
          missing.push(`${path}（数组长度 ${a.length} → ${Array.isArray(b) ? b.length : '非数组'}）`);
          return;
        }
        a.forEach((x, i) => check(x, b[i], `${path}[${i}]`));
        return;
      }
      if (a !== null && typeof a === 'object') {
        if (b === null || typeof b !== 'object' || Array.isArray(b)) {
          missing.push(`${path}（对象 → 非对象）`);
          return;
        }
        for (const [k, v] of Object.entries(a as Record<string, unknown>)) {
          check(v, (b as Record<string, unknown>)[k], `${path}.${k}`);
        }
        return;
      }
      if (a !== b) missing.push(`${path}（${JSON.stringify(a)} → ${JSON.stringify(b)}）`);
    };
    check(json, viaZod, '$');

    expect(missing).toEqual([]);
  });

  it('把未修改的内容库写回去，文件字节不变', async () => {
    const path = await tempBundle();
    const before = await readRaw(path);
    const { json } = await loadBundle(path);
    await writeBundle(json, path);
    expect(await readRaw(path)).toBe(before);
  });

  it('以空格缩进 + 尾随换行（与仓库现有风格一致）', async () => {
    const { json } = await loadBundle(REAL);
    const text = serializeBundle(json);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "version"');
  });
});

describe('写入门：schema 不过就不许落盘', () => {
  it('schema 不合法的输入被拒绝，且文件未被改动', async () => {
    const path = await tempBundle();
    const before = await readRaw(path);
    const { json } = await loadBundle(path);
    // version 必须是正整数
    const broken = structuredClone(json);
    broken['version'] = -1;

    await expect(writeBundle(broken as never, path)).rejects.toThrow(/schema/);
    expect(await readRaw(path)).toBe(before);
  });
});

describe('写入门：CI 不过就回滚', () => {
  it('把某条内容标成 reviewed 但无人工复核 → 拒绝写入并恢复原字节', async () => {
    const path = await tempBundle();
    const before = await readRaw(path);
    const { json } = await loadBundle(path);

    const symbols = json['symbols'] as Array<Record<string, unknown>>;
    const target = symbols[0];
    if (!target) throw new Error('夹具缺失：真实内容库里应当有符号');
    const prov = target['provenance'] as Record<string, unknown>;
    prov['review_status'] = 'reviewed';

    await expect(writeBundle(json, path)).rejects.toThrow(/回滚/);
    expect(await readRaw(path)).toBe(before);
  });

  it('回滚后不留下临时文件', async () => {
    const path = await tempBundle();
    const { json } = await loadBundle(path);
    const symbols = json['symbols'] as Array<Record<string, unknown>>;
    const target = symbols[0];
    if (!target) throw new Error('夹具缺失');
    (target['provenance'] as Record<string, unknown>)['review_status'] = 'reviewed';
    await expect(writeBundle(json, path)).rejects.toThrow();
    await expect(readRaw(`${path}.studio-tmp`)).rejects.toThrow();
  });
});

describe('DLG_BUNDLE：内容库路径可被改写（测试与演练必须能指向临时文件）', () => {
  it('设了环境变量就用它', async () => {
    const path = await tempBundle();
    const old = process.env['DLG_BUNDLE'];
    process.env['DLG_BUNDLE'] = path;
    try {
      expect(resolveBundlePath()).toBe(path);
    } finally {
      if (old === undefined) delete process.env['DLG_BUNDLE'];
      else process.env['DLG_BUNDLE'] = old;
    }
  });

  it('没设就指向仓库里的 bundle.json', async () => {
    const old = process.env['DLG_BUNDLE'];
    delete process.env['DLG_BUNDLE'];
    try {
      expect(resolveBundlePath()).toBe(REAL);
    } finally {
      if (old !== undefined) process.env['DLG_BUNDLE'] = old;
    }
  });
});

describe('安全：测试跑完之后真实内容库必须字节未变', () => {
  it('真实 bundle.json 的 sha256 与测试开始时一致', async () => {
    const after = createHash('sha256').update(await readFile(REAL)).digest('hex');
    expect(after).toBe(realHashBefore);
  });
});

// 显式引用 writeFile：部分用例依赖「写入的东西被回滚」，用一个空写入确认临时目录可写
it('临时目录可写（前置条件）', async () => {
  const path = await tempBundle();
  await writeFile(path, await readFile(path));
  expect((await readRaw(path)).length).toBeGreaterThan(0);
});
