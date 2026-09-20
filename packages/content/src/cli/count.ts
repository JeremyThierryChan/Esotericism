#!/usr/bin/env tsx
/**
 * 内容量统计：每个题组能生成多少题、总计多少。
 *
 * 为什么单独做成命令：文档里曾硬编码「25 题」「97 题」这类数字，改内容即过期。
 * 现在权威数字由命令产出：`pnpm --filter @dlg/content count`（或总的 `pnpm facts`）。
 */
import { generateExercises, validateBundle } from '@dlg/domain';
import { loadBundle } from '../load.js';

const loaded = await loadBundle();
if (!loaded.ok || !loaded.bundle) {
  console.error('❌ bundle.json 未通过 schema 校验：');
  for (const i of loaded.schemaIssues ?? []) console.error('  -', i);
  process.exit(1);
}
const b = loaded.bundle;
const report = validateBundle(b);
const gen = generateExercises(b);

const rows = gen.byTemplate.map((t) => {
  const tpl = b.exercise_templates.find((x) => x.id === t.template_id);
  return {
    template: t.template_id,
    name: tpl?.name ?? '（未知）',
    mode: tpl?.parameter_space.mode ?? '?',
    count: t.count,
    skipped: t.skipped,
  };
});

const width = Math.max(...rows.map((r) => r.template.length), 10);
for (const r of rows) {
  console.log(`  ${r.template.padEnd(width)}  ${String(r.count).padStart(3)} 题  [${r.mode}]  ${r.name}`);
  for (const s of r.skipped) console.log(`  ${''.padEnd(width)}  ⚠️ ${s}`);
}
console.log(`  ${'合计'.padEnd(width)}  ${String(gen.instances.length).padStart(3)} 题`);

if (!report.ok) {
  console.error(`\n❌ 内容库 CI 校验未通过（${report.errors.length} 个 error）—— 上面的题数不可信`);
  process.exit(1);
}
