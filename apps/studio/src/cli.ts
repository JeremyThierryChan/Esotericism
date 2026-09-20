#!/usr/bin/env tsx
/**
 * 内容流水线工具 · 命令行入口
 *
 * 用法：
 *   pnpm --filter @dlg/studio serve    启动本机界面（默认 http://127.0.0.1:4180/）
 *   pnpm --filter @dlg/studio check    不开浏览器，直接在终端看「现在能不能签字」
 *
 * 关于 `DLG_BUNDLE`：设了它，工具就改那个文件而不是仓库里的 bundle.json。
 * 测试与演练用它 —— 任何测试都**不许**碰真实内容库。
 */
import process from 'node:process';
import { buildInventory, summarize } from './lib/inventory.js';
import { loadBundle, resolveBundlePath } from './lib/store.js';
import { serve } from './lib/server.js';
import { validateBundle } from '@dlg/domain';

async function cmdCheck(): Promise<number> {
  const path = resolveBundlePath();
  const { raw, json, bundle } = await loadBundle(path);
  const entries = buildInventory(json, raw);
  const s = summarize(entries);
  const report = validateBundle(bundle);

  process.stdout.write(`\n内容库    ${path}\n`);
  process.stdout.write(`条目      ${s.total}\n`);
  process.stdout.write(`状态      ${Object.entries(s.byStatus).map(([k, v]) => `${k} ${v}`).join(' · ')}\n`);
  process.stdout.write(`复核记录  AI ${s.aiVerifications} · 人工 ${s.humanVerifications}\n`);
  process.stdout.write(`CI        error ${report.errors.length} · warning ${report.warnings.length}\n`);

  const ready = entries.filter((e) => e.review_status === 'draft' && e.blockers.length === 0);
  process.stdout.write(`\n── 现在就能签字（${ready.length} 条）──\n`);
  for (const e of ready.slice(0, 40)) {
    process.stdout.write(`  ${e.kind.padEnd(18)} ${e.id}\n`);
  }
  if (ready.length > 40) process.stdout.write(`  …还有 ${ready.length - 40} 条\n`);
  if (ready.length === 0) process.stdout.write('  （没有 —— 都需要先补人工复核记录）\n');

  // 按「阻塞规则」聚合：这一栏回答的是「我该先做什么」
  const byRule = new Map<string, number>();
  for (const e of entries) {
    if (e.review_status !== 'draft') continue;
    for (const b of e.blockers) byRule.set(b.rule, (byRule.get(b.rule) ?? 0) + 1);
  }
  process.stdout.write('\n── 阻塞按规则聚合 ──\n');
  for (const [rule, n] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${rule.padEnd(6)} 阻塞 ${n} 条\n`);
  }

  process.stdout.write('\n── 下一步 ──\n');
  process.stdout.write('  pnpm --filter @dlg/studio serve   # 打开界面：记复核记录 → 签字\n\n');
  return report.ok ? 0 : 1;
}

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? 'serve';
  if (cmd === 'check') {
    process.exit(await cmdCheck());
  }
  if (cmd === 'serve') {
    await serve();
    return;
  }
  process.stderr.write(`未知命令：${cmd}\n可用：serve | check\n`);
  process.exit(2);
}

await main();
