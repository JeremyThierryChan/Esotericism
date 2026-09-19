#!/usr/bin/env tsx
/**
 * CI 校验 CLI（流水线 ② 的落地）
 *
 * 用法：
 *   pnpm --filter @dlg/domain validate                  # 校验内置样例如库
 *   pnpm --filter @dlg/domain validate <bundle.json>    # 校验指定内容集合
 *
 * 退出码：0 = 通过，1 = 构建失败（有 error 级问题）
 */
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { contentBundleSchema, emptyBundle, formatReport, validateBundle } from '../index.js';

async function main(): Promise<void> {
  const file = process.argv[2];
  let bundle = emptyBundle();

  if (file) {
    const raw = await readFile(file, 'utf8');
    const parsed = contentBundleSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.error('❌ 内容集合不符合 schema：');
      console.error(JSON.stringify(parsed.error.issues.slice(0, 20), null, 2));
      process.exit(1);
    }
    bundle = parsed.data;
  } else {
    console.log('（未指定内容文件，校验空集合 —— 用于验证校验器本身可运行）');
  }

  const report = validateBundle(bundle);
  console.log(formatReport(report));
  process.exit(report.ok ? 0 : 1);
}

await main();
