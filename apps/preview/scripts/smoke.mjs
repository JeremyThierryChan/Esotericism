#!/usr/bin/env node
/**
 * 预览站产物冒烟测试。
 *
 * 为什么需要它：HTTP 200 只能证明文件送达，不能证明**代码能跑**。
 * Vite 打包后不变量（"内容库里的题被渲染出来"）没有任何自动化覆盖，
 * 而这是 step 3 唯一给合伙人看的东西。
 *
 * 做法：用最小 DOM 替身执行打包产物，然后检查它写进 #app 的 HTML。
 * 这不是浏览器，所以只覆盖"启动路径 + 首屏渲染"，不覆盖交互事件。
 * 交互仍需人工点一遍（`pnpm --filter @dlg/preview dev`）。
 */
import { readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, '..', 'dist');

/** 极简 DOM 替身：只实现被用到的接口 */
function makeElement(tag = 'div') {
  const el = {
    tagName: tag.toUpperCase(),
    _html: '',
    dataset: {},
    hidden: false,
    value: '',
    style: {},
    get innerHTML() {
      return this._html;
    },
    set innerHTML(v) {
      this._html = String(v);
    },
    textContent: '',
    classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {},
    appendChild() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    setAttribute() {},
    getAttribute: () => null,
  };
  return el;
}

async function main() {
  const html = await readFile(join(distDir, 'index.html'), 'utf8');
  const jsMatch = html.match(/src="([^"]+\.js)"/);
  if (!jsMatch) throw new Error('dist/index.html 里找不到 JS 入口');

  // 把 /repo/assets/x.js 映射回 dist/assets/x.js
  const assetRel = jsMatch[1].replace(/^.*\/assets\//, 'assets/');
  const jsPath = join(distDir, assetRel);
  const js = await readFile(jsPath, 'utf8');

  // 拦截外部请求：静态站不该在启动时联网
  const networkCalls = [];
  globalThis.fetch = (...args) => {
    networkCalls.push(args[0]);
    return Promise.reject(new Error('冒烟测试禁止联网'));
  };

  const appEl = makeElement();
  globalThis.document = {
    querySelector: (sel) => (sel === '#app' ? appEl : null),
    querySelectorAll: () => [],
    createElement: (t) => makeElement(t),
    addEventListener: () => {},
    body: makeElement('body'),
  };
  globalThis.window = { addEventListener: () => {}, location: { href: 'http://localhost/' } };
  // Vite 可能注入依赖 MutationObserver 的代码；给出替身以便产物在这里能跑
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.location = globalThis.window.location;

  // 写到临时文件再 import —— 用 data: URL 会因 148KB 产物超长而失败，
  // 且失败时会把整段 base64 打进错误信息（踩过一次）。
  const tmpFile = join(tmpdir(), `dlg-preview-smoke-${process.pid}.mjs`);
  await writeFile(tmpFile, js, 'utf8');
  try {
    await import(`file://${tmpFile}`);
  } finally {
    await rm(tmpFile, { force: true });
  }

  const out = appEl.innerHTML ?? '';

  const failures = [];
  const checks = [
    ['渲染了页面骨架', out.includes('试玩预览')],
    ['渲染了未复核横幅', out.includes('内容未经人工复核')],
    ['渲染了内容库计数表', out.includes('Formalism 形式系统')],
    ['渲染了规则判分题（来自内容库）', out.includes('木') && out.includes('火')],
    ['渲染了 Rubric 开放题', out.includes('判分规约')],
    ['渲染了跨体系节点与 historicity', out.includes('重建')],
    ['渲染了溯源面板', out.includes('来源强度')],
    ['未出现启动失败', !out.includes('预览站启动失败') && !out.includes('内容库未通过 schema 校验')],
    ['启动过程未联网', networkCalls.length === 0],
  ];

  for (const [name, ok] of checks) {
    if (!ok) failures.push(name);
    console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  }

  console.log(`\n渲染产物大小：${out.length} 字符`);
  if (networkCalls.length > 0) console.log('  联网调用：', networkCalls);

  if (failures.length > 0) {
    console.error(`\n❌ 冒烟测试失败：${failures.join('、')}`);
    const idx = out.indexOf('预览站启动失败');
    if (idx !== -1) console.error('\n启动错误片段：\n' + out.slice(idx, idx + 800));
    process.exit(1);
  }
  console.log('\n✅ 预览站产物冒烟测试通过');
}

await main();
