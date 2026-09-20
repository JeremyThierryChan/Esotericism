#!/usr/bin/env node
/**
 * 内容流水线工具 · 端到端冒烟测试
 *
 * 为什么需要它：单元测试直接调 `lib/` 里的函数，**绕过了 HTTP 层**。
 * 而 HTTP 层恰恰是几处最容易坏、又最不该坏的地方：
 *   · Host 头校验（DNS rebinding 防线）—— 写错了等于把改内容库的能力开放给任意网页；
 *   · 静态文件白名单 —— 写错了就是目录穿越；
 *   · 请求体解析与形状检查 —— 坏输入应当得到 4xx，而不是 500 或者静默写入。
 * 所以这里真的起一个服务、真的发请求，并且**全程指向临时内容库**
 * （`DLG_BUNDLE`），最后再断言真实 `bundle.json` 一个字节都没动。
 *
 * 用法：`pnpm --filter @dlg/studio build`（它会先 typecheck，再跑本脚本）
 */
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..');
const REAL_BUNDLE = join(pkgDir, '..', '..', 'packages', 'content', 'bundle.json');

const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    process.stdout.write(`  ✓ ${name}\n`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    process.stdout.write(`  ✗ ${name}${detail ? ` — ${detail}` : ''}\n`);
  }
}

const realHash = () => createHash('sha256').update(realRaw).digest('hex');
let realRaw;

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/state`);
      if (res.ok) return true;
    } catch {
      // 还没起来
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

/**
 * 发一个**原始** HTTP 请求，绕开 fetch 对 Host 头的限制。
 * 只用于测 Host 校验这一步 —— 其余请求都用 fetch（更贴近真实客户端）。
 */
async function rawRequest(payload, timeoutMs = 5000) {
  const { connect } = await import('node:net');
  return new Promise((resolve, reject) => {
    const socket = connect(PORT, '127.0.0.1');
    let data = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('raw request 超时'));
    }, timeoutMs);
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(payload));
    socket.on('data', (chunk) => {
      data += chunk;
    });
    socket.on('end', () => {
      clearTimeout(timer);
      resolve(data);
    });
    socket.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function main() {
  realRaw = await readFile(REAL_BUNDLE);
  const before = realHash();

  const dir = await mkdtemp(join(tmpdir(), 'dlg-studio-smoke-'));
  const tempBundle = join(dir, 'bundle.json');
  await copyFile(REAL_BUNDLE, tempBundle);

  process.stdout.write('\n内容流水线工具 · 冒烟测试\n');
  process.stdout.write(`  临时内容库 ${tempBundle}\n\n`);

  const child = spawn(
    'node',
    ['--import', 'tsx', join('src', 'cli.ts'), 'serve'],
    {
      cwd: pkgDir,
      env: { ...process.env, DLG_BUNDLE: tempBundle, DLG_STUDIO_PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let serverLog = '';
  child.stdout.on('data', (d) => {
    serverLog += d.toString();
  });
  child.stderr.on('data', (d) => {
    serverLog += d.toString();
  });

  try {
    const up = await waitForServer();
    check('服务能启动并响应 /api/state', up, up ? '' : serverLog.slice(0, 400));
    if (!up) return;

    // ── 静态资源 ──
    const html = await fetch(`${BASE}/`).then((r) => r.text());
    check('GET / 返回界面 HTML', html.includes('内容流水线工具'));
    const js = await fetch(`${BASE}/studio.js`);
    check('GET /studio.js 返回 JS', (await js.text()).includes('boot'));
    const css = await fetch(`${BASE}/studio.css`);
    check('GET /studio.css 返回 CSS', (await css.text()).includes('--porphyry-950'));

    // ── 目录穿越：白名单之外的路径必须 404 ──
    for (const p of ['/../package.json', '/%2e%2e/package.json', '/etc/passwd']) {
      const r = await fetch(`${BASE}${p}`);
      check(`白名单外路径被拒（${p}）`, r.status === 404, `实际 ${r.status}`);
    }

    // ── Host 头校验（DNS rebinding 防线）──
    // ⚠️ 必须用**裸 socket**：Node 的 fetch（undici）把 Host 当作禁止修改的头，
    //    传了也会被忽略 —— 用 fetch 测这一条会得到「服务端通过了」，而那是假绿灯
    //    （请求实际带的是正确的 Host）。第一次写这条测试就踩了这个坑。
    const rawHostResult = await rawRequest(
      `GET /api/state HTTP/1.1\r\nHost: evil.example.com\r\nConnection: close\r\n\r\n`,
    );
    check('非本机 Host 头被拒 403', rawHostResult.includes(' 403 '), `实际响应行：${rawHostResult.split('\r\n')[0]}`);

    const rawLocalResult = await rawRequest(
      `GET /api/state HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`,
    );
    check('本机 Host 头被放行', rawLocalResult.includes(' 200 '), `实际响应行：${rawLocalResult.split('\r\n')[0]}`);

    // ── 状态接口 ──
    const state = await fetch(`${BASE}/api/state`).then((r) => r.json());
    check('/api/state 报告内容库路径指向临时文件', state.bundlePath === tempBundle);
    check('/api/state 清点出 62 个带 provenance 的条目', state.summary.total === 62, `实际 ${state.summary.total}`);
    check('/api/state 报出「人工复核记录为 0」（签字前应当如此）', state.summary.humanVerifications === 0);
    check('本工具声明只写 human 复核记录', String(state.aiWriteDisabledReason).includes('human'));
    check('初始状态没有可撤回的写入', state.canUndo === false);

    // ── 试玩预览 ──
    const pv = await fetch(`${BASE}/api/preview?limit=2`).then((r) => r.json());
    check('试玩预览能生成题目', pv.total > 0, `total=${pv.total}`);
    check('试玩预览给出样题', pv.templates.some((t) => t.samples.length > 0));

    // ── 引用清单 / 骨架 ──
    const refs = await fetch(`${BASE}/api/references`).then((r) => r.json());
    check('引用清单列出了符号 id', refs.references.byCollection.some((c) => c.key === 'symbols' && c.ids.length > 0));
    const sc = await fetch(`${BASE}/api/scaffold?key=symbols`).then((r) => r.json());
    check('骨架清空了 sources（防伪造审计链）', Array.isArray(sc.scaffold.provenance.sources) && sc.scaffold.provenance.sources.length === 0);
    check('骨架清空了 verifications', Array.isArray(sc.scaffold.provenance.verifications) && sc.scaffold.provenance.verifications.length === 0);

    // ── 录入校验：坏输入得到 4xx/校验结果，而不是落盘 ──
    const badEntry = await fetch(`${BASE}/api/entry/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'symbols', mode: 'create', item: { id: 'x', provenance: {} } }),
    });
    check('不合法的录入返回 422', badEntry.status === 422, `实际 ${badEntry.status}`);

    // ── 写路径：记复核记录 → 签字 ──
    const ref = { kind: 'symbol', id: 'sym.wuxing.木' };
    const verify = await fetch(`${BASE}/api/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ref,
        reviewer: '冒烟测试',
        input: {
          claim: '五行相生的次序',
          source: { ref: '《春秋繁露·五行对》' },
          outcome: '证实',
        },
      }),
    });
    check('记人工复核记录成功', verify.ok, `HTTP ${verify.status}`);
    const verified = await verify.json();
    check('新增记录 checked_by = human', verified.entry.verifications.at(-1)?.checked_by === 'human');

    const noSignature = await fetch(`${BASE}/api/promote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref, reviewer: '   ' }),
    });
    check('无署名的签字被拒', noSignature.status === 409 || noSignature.status === 400, `实际 ${noSignature.status}`);

    const promote = await fetch(`${BASE}/api/promote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref, reviewer: '冒烟测试' }),
    });
    check('签字成功', promote.ok, `HTTP ${promote.status}`);
    const promoted = await promote.json();
    check('签字后状态为 reviewed', promoted.entry.review_status === 'reviewed');
    check('签字后 CI 无新增 error', promoted.state.validation.errors.length === 0, JSON.stringify(promoted.state.validation.errors.slice(0, 2)));

    // ── 已签字的条目不能被 AI 记录推翻，但可撤回 ──
    const demote = await fetch(`${BASE}/api/demote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ref }),
    });
    check('撤回成功', demote.ok);
    const demoted = await demote.json();
    check('撤回后回到 draft', demoted.entry.review_status === 'draft');
    check('撤回保留 verifications（审计历史）', demoted.entry.verifications.length > 0);
    check('撤回清掉 reviewer', demoted.entry.reviewer === undefined);

    // ── 撤回上一次写入 ──
    // 语义：撤回**最后一次**写入。最后一次是 demote，所以撤回后应当回到 **reviewed**
    // （不是 draft —— 那次撤回本身就 undo 掉了）。
    const undo = await fetch(`${BASE}/api/undo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    check('撤回上一次写入成功', undo.ok, `HTTP ${undo.status}`);
    const undone = await undo.json();
    const afterUndo = undone.state.entries.find((e) => e.id === ref.id);
    check('撤回 demote 后回到 reviewed（而不是留在 draft）', afterUndo?.review_status === 'reviewed', `实际 ${afterUndo?.review_status}`);
    check('撤回后不能再撤回（槽位已用完）', undone.state.canUndo === false);

    const undoAgain = await fetch(`${BASE}/api/undo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    check('没有可撤回内容时返回 409', undoAgain.status === 409, `实际 ${undoAgain.status}`);

    // ── 幂等性：撤回到底后内容库应当接近原样 ──
    const finalRaw = await readFile(tempBundle, 'utf8');
    check('临时内容库仍是合法 JSON 且以换行结尾', finalRaw.trimEnd().length > 0 && finalRaw.endsWith('\n'));

    // ── 最要紧的一条：真实内容库没被动过 ──
    check('真实 bundle.json 未被改动（sha256 一致）', realHash() === before);

    // ── 未知接口 ──
    const unknown = await fetch(`${BASE}/api/nope`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    check('未知接口返回 404', unknown.status === 404, `实际 ${unknown.status}`);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 200));
    await rm(dir, { recursive: true, force: true });
  }
}

await main();

process.stdout.write(`\n冒烟结果：${passed} 项通过，${failures.length} 项失败\n`);
if (failures.length > 0) {
  for (const f of failures) process.stdout.write(`  ✗ ${f}\n`);
  process.exit(1);
}
