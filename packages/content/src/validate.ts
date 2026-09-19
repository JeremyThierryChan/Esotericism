#!/usr/bin/env tsx
/**
 * 内容库 CI 校验 CLI（流水线 ② 的落地）
 *
 * 用法：pnpm --filter @dlg/content validate
 * 退出码：0 = 通过，1 = 构建失败
 */
import process from 'node:process';
import { formatReport, validateBundle, sameFormalismProjection } from '@dlg/domain';
import { loadBundle } from './load.js';

async function main(): Promise<void> {
  const loaded = await loadBundle();
  if (!loaded.ok || !loaded.bundle) {
    console.error('❌ 内容库不符合 schema：');
    for (const i of loaded.schemaIssues ?? []) console.error('  -', i);
    process.exit(1);
  }

  const report = validateBundle(loaded.bundle);
  console.log(formatReport(report));

  // 顺带打印派生视图（机制 A）—— 它不落库，所以在这里看得见才有意义
  const proj = sameFormalismProjection(loaded.bundle.symbols, loaded.bundle.symbol_usages);
  console.log(`\n派生视图 same_formalism_projection（机制 A，不落库）：${proj.length} 条`);
  for (const p of proj) {
    console.log(
      `  ${p.symbol_id}（${p.formalism_id}）被 ${p.system_count} 个体系使用：` +
        p.usages.map((u) => `${u.system_id}[${u.role}]`).join('、'),
    );
  }

  process.exit(report.ok ? 0 : 1);
}

await main();
