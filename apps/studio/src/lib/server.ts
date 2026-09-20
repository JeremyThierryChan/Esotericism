/**
 * 本机 HTTP 服务：给 `public/` 的界面提供 JSON API。
 *
 * ── 安全边界（这不是「本地工具所以随便写」就能带过的事）──
 * 这个进程**能改写内容库的唯一事实来源**（`bundle.json`）。因此：
 *   ① 只绑 `127.0.0.1` —— 不监听 0.0.0.0，局域网内其他机器连不上；
 *   ② 校验 `Host` 头必须是 localhost/127.0.0.1 —— 防 **DNS rebinding**：
 *      恶意页面可以把自己的域名解析到 127.0.0.1，然后从浏览器里打这个端口；
 *      只绑本机**挡不住**这种攻击，校验 Host 才挡得住（域名不会等于 localhost）；
 *   ③ 静态文件走**白名单**（三个固定文件名），不做路径拼接 —— 没有目录穿越面；
 *   ④ 不提供任何写 `checked_by: 'ai-candidate'` 的接口（见 review.ts 顶部说明）。
 *
 * ── 为什么用 node:http 而不是现成框架 ──
 * 需求是「本机、十几个接口、单用户」。引入 express/koa 会多一层依赖和一套
 * 与仓库其余部分不同的惯例，而省下的代码不到一百行。仓库已有的原则是
 * 依赖尽量少（domain 只依赖 zod、preview 只依赖 vite）。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { validateBundle } from '@dlg/domain';
import { buildInventory, summarize, type EntityRef } from './inventory.js';
import { COLLECTIONS, deleteEntry, referenceIndex, saveEntry, scaffoldFrom, validateEntry } from './entry.js';
import { preview } from './preview.js';
import { demote, promote, recordVerification, ReviewError, type VerificationInput } from './review.js';
import { loadBundle, restoreRaw, resolveBundlePath } from './store.js';

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(here, '..', '..', 'public');

/** 静态文件白名单：不拼接用户输入，因此不存在目录穿越 */
const STATIC_FILES: Record<string, string> = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/studio.css': 'studio.css',
  '/studio.js': 'studio.js',
};

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** 上一次写入前的字节 —— 「撤回」用。只在内存里，进程退出即失效（git 才是长期历史） */
let lastPrevious: { raw: string; label: string } | undefined;

class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly blockers?: unknown) {
    super(message);
    this.name = 'HttpError';
  }
}

function isLocalHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.split(':')[0]?.toLowerCase() ?? '';
  return name === 'localhost' || name === '127.0.0.1' || name === '[::1]' || name === '::1';
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, '请求体过大');
    chunks.push(buf);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (e) {
    throw new HttpError(400, `请求体不是合法 JSON：${(e as Error).message}`);
  }
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

/** 取请求体里的实体引用并做形状检查 —— 坏输入应当得到 400，而不是 500 */
function asRef(value: unknown): EntityRef {
  if (value === null || typeof value !== 'object') throw new HttpError(400, '缺少 ref');
  const o = value as Record<string, unknown>;
  if (typeof o['kind'] !== 'string' || typeof o['id'] !== 'string') {
    throw new HttpError(400, 'ref 必须是 { kind, id }');
  }
  return { kind: o['kind'] as EntityRef['kind'], id: o['id'] };
}

function asString(value: unknown, field: string, required = true): string {
  if (typeof value !== 'string') {
    if (!required) return '';
    throw new HttpError(400, `缺少 ${field}`);
  }
  return value;
}

/** 统一的「当前状态」快照 —— 界面每次写操作后都重新拉这一份，避免本地拼状态产生漂移 */
async function stateSnapshot() {
  const path = resolveBundlePath();
  const { raw, json: rawJson, bundle } = await loadBundle(path);
  const entries = buildInventory(rawJson, raw);
  return {
    bundlePath: path,
    summary: summarize(entries),
    collections: COLLECTIONS,
    validation: validateBundle(bundle),
    entries,
    aiWriteDisabledReason:
      '本工具只写 checked_by=human：若允许在这里写 AI 复核记录，「AI 找到来源」到「条目 reviewed」只差一次点击，R1b/R19 会被合规地绕过。',
    canUndo: lastPrevious !== undefined,
  };
}

async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const key = url.pathname;

  // ── 静态资源 ──
  if (req.method === 'GET' && key in STATIC_FILES) {
    const file = STATIC_FILES[key];
    if (!file) throw new HttpError(404, 'not found');
    const ext = file.slice(file.lastIndexOf('.'));
    try {
      const body = await readFile(join(PUBLIC_DIR, file));
      res.writeHead(200, {
        'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      throw new HttpError(500, `读不到界面文件 ${file} —— 是否在 apps/studio 目录下运行？`);
    }
    return;
  }

  if (!key.startsWith('/api/')) throw new HttpError(404, `未知路径 ${key}`);

  // ── 读接口 ──
  if (req.method === 'GET' && key === '/api/state') {
    json(res, 200, await stateSnapshot());
    return;
  }

  if (req.method === 'GET' && key === '/api/preview') {
    const limit = Number(url.searchParams.get('limit') ?? '8');
    const { bundle } = await loadBundle();
    json(res, 200, preview(bundle, Number.isFinite(limit) && limit > 0 ? Math.min(limit, 30) : 8));
    return;
  }

  if (req.method === 'GET' && key === '/api/references') {
    const { json: rawJson } = await loadBundle();
    json(res, 200, {
      references: referenceIndex(rawJson),
      // 骨架按需生成（克隆现有条目），一次给全部会很大
      scaffoldKeys: COLLECTIONS.map((c) => c.key),
    });
    return;
  }

  if (req.method === 'GET' && key === '/api/scaffold') {
    const collectionKey = url.searchParams.get('key');
    if (!collectionKey) throw new HttpError(400, '缺少 key');
    const { json: rawJson } = await loadBundle();
    json(res, 200, { key: collectionKey, scaffold: scaffoldFrom(rawJson, collectionKey) });
    return;
  }

  if (req.method !== 'POST') throw new HttpError(405, `方法不允许：${req.method}`);

  // ── 写接口 ──
  const body = await readBody(req);

  if (key === '/api/verify') {
    const o = body as Record<string, unknown>;
    const ref = asRef(o['ref']);
    const reviewer = asString(o['reviewer'], 'reviewer');
    const input = o['input'];
    if (input === null || typeof input !== 'object') throw new HttpError(400, '缺少 input');
    const i = input as Record<string, unknown>;
    const source = i['source'];
    if (source === null || typeof source !== 'object') throw new HttpError(400, '缺少 input.source');
    const s = source as Record<string, unknown>;

    const verificationInput: VerificationInput = {
      claim: asString(i['claim'], 'input.claim'),
      source: {
        ref: asString(s['ref'], 'input.source.ref'),
        ...(typeof s['author'] === 'string' && s['author'] ? { author: s['author'] } : {}),
        ...(typeof s['year'] === 'number' ? { year: s['year'] } : {}),
        ...(typeof s['url'] === 'string' && s['url'] ? { url: s['url'] } : {}),
        ...(typeof s['confidence'] === 'string'
          ? { confidence: s['confidence'] as VerificationInput['source']['confidence'] }
          : {}),
      },
      ...(typeof i['locator'] === 'string' && i['locator'] ? { locator: i['locator'] } : {}),
      ...(typeof i['excerpt'] === 'string' && i['excerpt'] ? { excerpt: i['excerpt'] } : {}),
      outcome: asString(i['outcome'], 'input.outcome') as VerificationInput['outcome'],
      ...(typeof i['note'] === 'string' && i['note'] ? { note: i['note'] } : {}),
    };

    const result = await recordVerification(ref, verificationInput, reviewer);
    lastPrevious = { raw: result.previous, label: `记复核记录：${ref.kind}/${ref.id}` };
    json(res, 200, { action: result.action, entry: result.entry, state: await stateSnapshot() });
    return;
  }

  if (key === '/api/promote') {
    const o = body as Record<string, unknown>;
    const ref = asRef(o['ref']);
    const reviewer = asString(o['reviewer'], 'reviewer');
    const result = await promote(ref, reviewer);
    lastPrevious = { raw: result.previous, label: `签字：${ref.kind}/${ref.id}` };
    json(res, 200, { action: result.action, entry: result.entry, state: await stateSnapshot() });
    return;
  }

  if (key === '/api/demote') {
    const o = body as Record<string, unknown>;
    const ref = asRef(o['ref']);
    const result = await demote(ref);
    lastPrevious = { raw: result.previous, label: `撤回：${ref.kind}/${ref.id}` };
    json(res, 200, { action: result.action, entry: result.entry, state: await stateSnapshot() });
    return;
  }

  if (key === '/api/entry/validate') {
    const o = body as Record<string, unknown>;
    const collectionKey = asString(o['key'], 'key');
    const mode = asString(o['mode'], 'mode') === 'update' ? 'update' : 'create';
    const { json: rawJson } = await loadBundle();
    json(res, 200, validateEntry(rawJson, collectionKey, o['item'], mode));
    return;
  }

  if (key === '/api/entry/save') {
    const o = body as Record<string, unknown>;
    const collectionKey = asString(o['key'], 'key');
    const mode = asString(o['mode'], 'mode') === 'update' ? 'update' : 'create';
    const result = await saveEntry(collectionKey, o['item'], mode);
    if (!result.validation.ok) {
      json(res, 422, { validation: result.validation });
      return;
    }
    if (result.previous !== undefined) {
      lastPrevious = { raw: result.previous, label: `录入：${collectionKey}/${result.entryKey}` };
    }
    json(res, 200, { entryKey: result.entryKey, mode, validation: result.validation, state: await stateSnapshot() });
    return;
  }

  if (key === '/api/entry/delete') {
    const o = body as Record<string, unknown>;
    const collectionKey = asString(o['key'], 'key');
    const entryKey = asString(o['entryKey'], 'entryKey');
    const result = await deleteEntry(collectionKey, entryKey);
    if (!result.removed) throw new HttpError(404, `找不到要删除的条目：${collectionKey}/${entryKey}`);
    if (result.previous !== undefined) {
      lastPrevious = { raw: result.previous, label: `删除：${collectionKey}/${entryKey}` };
    }
    json(res, 200, { removed: true, state: await stateSnapshot() });
    return;
  }

  /**
   * 撤回上一次写入。
   *
   * 这是安全网，不是版本控制：只在**本进程内存**里记住上一次写入前的字节。
   * 真正的历史是 git —— 所以这里不建备份目录、不 rolling 文件名，
   * 那些东西会让人以为「有备份了」而不再看 diff。
   */
  if (key === '/api/undo') {
    if (!lastPrevious) throw new HttpError(409, '没有可撤回的写入（本进程还没写过东西）');
    const { raw, label } = lastPrevious;
    lastPrevious = undefined;
    await restoreRaw(raw);
    json(res, 200, { undone: label, state: await stateSnapshot() });
    return;
  }

  throw new HttpError(404, `未知接口 ${key}`);
}

export function createStudioServer(): Server {
  return createServer((req, res) => {
    void (async () => {
      try {
        // DNS rebinding 防线：只绑本机挡不住「恶意域名解析到 127.0.0.1」
        if (!isLocalHost(req.headers.host)) {
          throw new HttpError(403, `Host 头必须是 localhost/127.0.0.1，收到：${req.headers.host ?? '(空)'}`);
        }
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        await route(req, res, url);
      } catch (e) {
        if (e instanceof HttpError) {
          json(res, e.status, { error: e.message, ...(e.blockers ? { blockers: e.blockers } : {}) });
          return;
        }
        if (e instanceof ReviewError) {
          // 签字失败是**预期路径**（条件不足），不是 500
          json(res, 409, { error: e.message, blockers: e.blockers });
          return;
        }
        json(res, 500, { error: (e as Error).message });
      }
    })();
  });
}

export interface ServeOptions {
  port?: number;
  host?: string;
}

export async function serve(options: ServeOptions = {}): Promise<Server> {
  const port = options.port ?? Number(process.env.DLG_STUDIO_PORT ?? '4180');
  const host = options.host ?? '127.0.0.1';
  const server = createStudioServer();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      resolve();
    });
  });

  // 必须把「正在改哪个文件」印出来：这个工具的破坏力全部来自这一点
  process.stdout.write(
    `\n内容流水线工具已启动\n  界面      http://${host}:${port}/\n  内容库    ${resolveBundlePath()}\n  仅本机可访问（Host 头校验已开）\n\n`,
  );
  return server;
}
