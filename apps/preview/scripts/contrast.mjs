#!/usr/bin/env node
/**
 * 色主题对比度校验（WCAG 2.1）
 *
 * 为什么需要它：我看不到浏览器渲染结果，而「这颜色好不好看」无法自动验证，
 * 「这颜色读不读得清」**可以**。所以把可计算的部分算掉：
 * 直接解析 styles.css 的 CSS 变量，解析 var() 引用，逐对算对比度。
 *
 * 阈值（WCAG 2.1 AA）：
 *   · 正文/小字 ≥ 4.5:1
 *   · 大字（≥18.66px 粗体 或 ≥24px）与 UI 元素/图形 ≥ 3:1
 * 本项目把**所有**文字对都按 4.5 要求（页面上大量 11.5–13px 小字）。
 *
 * 深色（夜紫宫廷）与浅色（石膏画板）两套主题都校验。
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = join(here, '..', 'src', 'styles.css');

// ── 解析 CSS 变量 ────────────────────────────────────────────────────────────

function extractBlock(css, startPattern) {
  const m = startPattern.exec(css);
  if (!m) return '';
  // 从 { 开始做括号配平
  let i = css.indexOf('{', m.index);
  let depth = 0;
  const from = i;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) return css.slice(from + 1, i);
    }
  }
  return '';
}

function parseVars(block) {
  const vars = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars[m[1]] = m[2].trim();
  }
  return vars;
}

async function loadThemes() {
  const css = await readFile(cssPath, 'utf8');

  const rootBlock = extractBlock(css, /^:root\s*\{/m);
  const lightBlock = extractBlock(css, /@media\s*\(prefers-color-scheme:\s*light\)\s*\{/);
  const lightInner = extractBlock(lightBlock, /:root\s*\{/);

  const dark = parseVars(rootBlock);
  const light = { ...dark, ...parseVars(lightInner) };
  return { dark, light };
}

/** 递归解析 var(--x) 引用 */
function resolve(value, vars, seen = new Set()) {
  let out = String(value).trim();
  for (let i = 0; i < 12; i++) {
    const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)$/.exec(out);
    if (!m) break;
    const name = m[1];
    if (seen.has(name)) return m[2]?.trim() ?? '#000000';
    seen.add(name);
    if (!(name in vars)) {
      if (m[2]) out = m[2].trim();
      else throw new Error(`未定义的变量 ${name}`);
      continue;
    }
    out = vars[name];
  }
  return out;
}

// ── 对比度计算 ──────────────────────────────────────────────────────────────

function parseColor(input) {
  const s = input.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [0, 1, 2].map((i) => parseInt(m[1][i] + m[1][i], 16));
  m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(s);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  throw new Error(`无法解析颜色：${input}`);
}

function luminance([r, g, b]) {
  const f = (c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(fg, bg) {
  const L1 = luminance(fg);
  const L2 = luminance(bg);
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

// ── 要校验的配对 ────────────────────────────────────────────────────────────

const PAIRS = [
  // 基础文字
  ['正文 · 石膏白 on 斑岩底', '--ink', '--bg', 4.5],
  ['正文 · 石膏白 on 面板', '--ink', '--panel', 4.5],
  ['正文 · 石膏白 on 面板2', '--ink', '--panel-2', 4.5],
  ['次级文字 · ink-dim on 面板', '--ink-dim', '--panel', 4.5],
  ['次级文字 · ink-dim on 面板2', '--ink-dim', '--panel-2', 4.5],
  ['最弱文字 · ink-faint on 底', '--ink-faint', '--bg', 4.5],
  // 金
  ['强调金 · accent on 面板', '--accent', '--panel', 4.5],
  ['强调金 · accent on 底', '--accent', '--bg', 4.5],
  ['金按钮字 · accent-ink on accent', '--accent-ink', '--accent', 4.5],
  ['金按钮悬停字 on accent-strong', '--accent-ink', '--accent-strong', 4.5],
  // 标签
  ['标签 draft on 其底', '--tag-draft', '--tag-draft-bg', 4.5],
  ['标签 type3 on 其底', '--tag-type3', '--tag-type3-bg', 4.5],
  ['标签 rule on 其底', '--tag-rule', '--tag-rule-bg', 4.5],
  ['标签 rubric on 其底', '--tag-rubric', '--tag-rubric-bg', 4.5],
  ['普通标签字 on 面板2', '--ink-dim', '--panel-2', 4.5],
  // 判分明细
  ['判分 hit on 其底', '--ok', '--v-hit-bg', 4.5],
  ['判分 miss on 其底', '--bad', '--v-miss-bg', 4.5],
  ['判分 violation on 其底', '--violation', '--v-violation-bg', 4.5],
  ['判分 uncertain on 其底', '--warn', '--v-uncertain-bg', 4.5],
  // 结论
  ['通过 · ok on 面板', '--ok', '--panel', 4.5],
  ['不通过 · bad on 面板', '--bad', '--panel', 4.5],
  ['警告 · warn on 面板', '--warn', '--panel', 4.5],
  // 选项卡
  ['选项对 · 字 on correct 底', '--ink', '--choice-correct-bg', 4.5],
  ['选项错 · 字 on wrong 底', '--ink', '--choice-wrong-bg', 4.5],
  // 横幅
  ['横幅字 on 条纹A', '--banner-ink', '--banner-bg-a', 4.5],
  ['横幅字 on 条纹B', '--banner-ink', '--banner-bg-b', 4.5],
  ['横幅粗体 on 条纹A', '--banner-strong', '--banner-bg-a', 4.5],
  ['横幅粗体 on 条纹B', '--banner-strong', '--banner-bg-b', 4.5],
  // 交互与结构
  ['summary 展开态金 on 面板', '--accent', '--panel', 4.5],
  ['边框可辨识 · line-strong on 面板', '--line-strong', '--panel', 1.3],
];

async function main() {
  const { dark, light } = await loadThemes();
  let failures = 0;

  // ── 前置检查：所有 var() 引用都已定义（改名最容易留下断链） ──
  {
    const css = await readFile(cssPath, 'utf8');
    const used = new Set([...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));
    const defined = new Set(Object.keys(dark));
    const missing = [...used].filter((n) => !defined.has(n));
    console.log(`\n变量引用检查：用到 ${used.size} 个，定义 ${defined.size} 个`);
    if (missing.length > 0) {
      console.log(`  ✗ 未定义：${missing.join(', ')}`);
      failures += missing.length;
    } else {
      console.log('  ✓ 全部已定义');
    }
    // 反向：定义了但没人用（只提示，不算失败）
    const unused = [...defined].filter((n) => !used.has(n));
    if (unused.length > 0) console.log(`  · 定义未使用：${unused.join(', ')}`);
  }

  for (const [label, vars] of [
    ['深色 · 夜紫宫廷（默认）', dark],
    ['浅色 · 石膏画板（prefers-color-scheme: light）', light],
  ]) {
    console.log(`\n══ ${label} ══`);
    console.log('  阈值  比值   结果  配对');
    for (const [name, fgVar, bgVar, min] of PAIRS) {
      const fgRaw = resolve(vars[fgVar], vars);
      const bgRaw = resolve(vars[bgVar], vars);
      let ratio;
      try {
        ratio = contrast(parseColor(fgRaw), parseColor(bgRaw));
      } catch (e) {
        console.log(`  ????  ──    ERR   ${name}  (${e.message})`);
        failures++;
        continue;
      }
      const ok = ratio >= min;
      if (!ok) failures++;
      console.log(
        `  ${min.toFixed(1).padStart(4)}  ${ratio.toFixed(2).padStart(5)}  ${ok ? ' ✓ ' : ' ✗ '}   ${name}`,
      );
    }
  }

  console.log(
    failures === 0
      ? '\n✅ 两套主题的全部文字配对均达标（WCAG 2.1 AA）'
      : `\n❌ ${failures} 项低于阈值`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

await main();
