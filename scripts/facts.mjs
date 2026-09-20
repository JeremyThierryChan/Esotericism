#!/usr/bin/env node
/**
 * 事实自检：打印**当前仓库的权威数字**。
 *
 * 为什么需要它：文档里散落过「119 条测试」「156 条」这类数字，改代码后立刻过期，
 * 而**过期的数字比没有数字更糟** —— 冷启动的人会据此判断状态。
 *
 * 所以规则改成：**数字以 `pnpm facts` 输出为准，文档不重复维护**。
 * 文档只在需要「某一天的快照」时写数字，并注明日期。
 *
 * 用法：pnpm facts
 */
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sh = (cmd, opts = {}) => {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
  } catch (e) {
    return `(失败: ${e.message.split('\n')[0]})`;
  }
};

const line = (s = '') => console.log(s);
const row = (k, v) => console.log(`  ${String(k).padEnd(26)} ${v}`);

line('════════ 仓库 ════════');
row('跟踪文件', sh('git ls-files | wc -l').trim());
row('提交数', sh('git log --oneline | wc -l').trim());
row('最新提交', sh('git log -1 --format="%h %ad %s" --date=format:"%Y-%m-%d"').slice(0, 72));
row('工作区', sh('git status --porcelain | wc -l').trim() === '0' ? '干净' : '⚠️ 有未提交改动');
row('远端', sh('git remote get-url origin 2>/dev/null') || '(无)');

line();
line('════════ 代码规模 ════════');
// ⚠️ 新增包/应用时必须补进这张清单 —— 否则这里的「权威数字」会静默漏掉一整个包，
// 而文档恰恰规定「数字以本输出为准」。apps/studio 是 ADR-0026 加的。
for (const pkg of ['packages/domain', 'packages/content', 'apps/preview', 'apps/studio']) {
  const n = sh(`find ${pkg}/src -type f 2>/dev/null | wc -l`).trim();
  const l = sh(`find ${pkg}/src -type f 2>/dev/null -exec cat {} + 2>/dev/null | wc -l`).trim();
  row(pkg, `${n} 文件 / ${l} 行`);
}

line();
line('════════ 测试（真实运行）════════');
let total = 0;
for (const pkg of ['packages/domain', 'packages/content', 'apps/studio']) {
  const out = sh(`pnpm --filter @dlg/${pkg.split('/')[1]} test 2>&1 | tail -40`);
  const m = /Tests\s+(\d+) passed/.exec(out);
  const n = m ? Number(m[1]) : 0;
  const failed = /(\d+) failed/.exec(out);
  total += n;
  row(pkg.split('/')[1], m ? `${n} passed${failed ? ` ⚠️ ${failed[1]} failed` : ' ✓'}` : '⚠️ 无法解析（测试可能失败）');
}
row('合计', `${total} 条`);
// ⚠️ grep 无匹配时退出码为 1，会让 execSync 抛错 —— 必须兜住
const tcFail = sh('pnpm -r typecheck 2>&1 | grep -c Failed || true').trim();
const pkgCount = sh('pnpm -r list --depth -1 2>/dev/null | grep -c "/" || true').trim();
row('typecheck', tcFail === '0' ? `✓ ${Number(pkgCount) || 4} 个包干净` : `⚠️ ${tcFail} 处失败`);

line();
line('════════ CI 校验规则 ════════');
const rulesSrc = readFileSync(join(root, 'packages/domain/src/validate/rules.ts'), 'utf8');
const rules = [...new Set([...rulesSrc.matchAll(/'R\d+[a-c]?'/g)].map((m) => m[0].slice(1, -1)))].sort();
row('规则数', rules.length);
row('清单', rules.join(' '));

line();
line('════════ 内容库 ════════');
const bundle = JSON.parse(readFileSync(join(root, 'packages/content/bundle.json'), 'utf8'));
const arrays = Object.entries(bundle).filter(([, v]) => Array.isArray(v));
for (const [k, v] of arrays) row(k, v.length);

line();
line('── 审核状态分布（人类签字前应全部为 draft）──');
const withProv = [];
for (const [k, v] of arrays) {
  for (const it of v) if (it && typeof it === 'object' && it.provenance) withProv.push([k, it.provenance]);
}
const byStatus = {};
for (const [, p] of withProv) byStatus[p.review_status] = (byStatus[p.review_status] ?? 0) + 1;
row('带 provenance 的条目', withProv.length);
for (const [k, v] of Object.entries(byStatus)) row(`  ${k}`, v);
const human = withProv.filter(([, p]) => (p.verifications ?? []).some((x) => x.checked_by === 'human'));
row('人工签字过的条目', human.length === 0 ? '0 ⚠️（内容仍是 draft）' : String(human.length));

line();
line('── 可生成题（内容量）──');
line(sh('pnpm --filter @dlg/content count 2>&1 | tail -20'));

// ── 内容流水线工具的视角（ADR-0026）：直接回答「签字还差什么」 ──
// 这一段是刻意放进来替代「再写一份人工清单」的：清单会与代码漂移，而这里跑的是真校验器。
line();
line('── 签字就绪度（内容流水线工具 check）──');
line(sh('pnpm --filter @dlg/studio exec tsx src/cli.ts check 2>&1 | tail -30'));

line();
line('════════ 文档 ════════');
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : [];
  });
for (const f of walk(join(root, 'docs')).sort()) {
  const lines = readFileSync(f, 'utf8').split('\n').length;
  row(relative(root, f), `${lines} 行`);
}
row('README.md', `${readFileSync(join(root, 'README.md'), 'utf8').split('\n').length} 行`);

line();
line('════════ 提示 ════════');
line('  · 文档里的数字**以本输出为准**；若不一致，改文档，不要改脚本。');
line('  · CI 校验：pnpm validate ｜ 内容一致性：pnpm -r test');
line('  · 部署状态需查 GitHub Actions（本脚本不联网）。');
