#!/usr/bin/env tsx
/**
 * 规则引擎 spike 报告
 *
 * 目的：验证 `RuleJudge` / `RuleTestSet` 接口在两种**形状不同**的规则下都可行：
 *   · L2.1  三爻 → 卦名（纯算法）
 *   · L6.1  定世应（表驱动查表 + 多步派生）
 *
 * 同时演示 M6 的 `RuleTestSet`：规则引擎必须有「给定输入 → 期望输出」的用例集，
 * 否则「装卦/纳甲算得对不对」无从保证 —— 这是六爻/占星进产品的前置条件。
 *
 * ⚠️ 输出中明确标注数据审核状态：本 spike 用的八宫卦序表是 **AI 起草的 draft 候选，
 * 未经人工复核**，不得作为教学内容或判分依据（见 src/liuyao/tables.ts 文件头）。
 */
import process from 'node:process';
import { createRuleTestSetRunner } from '../judges.js';
import type { RuleTestSet } from '../layer1/rule.js';
import type { HexagramBits, Yao } from '../liuyao/index.js';
import {
  DATA_PROVENANCE_NOTE,
  REVIEW_STATUS,
  palaceEntryCount,
  resolveHexagram,
  resolveShiYing,
  resolveTrigram,
} from '../liuyao/index.js';

/** 六爻字面量构造（自初爻起，阳=1 阴=0） */
function h(...bits: number[]): HexagramBits {
  if (bits.length !== 6) throw new Error(`需要 6 个爻，收到 ${bits.length} 个`);
  return bits as unknown as HexagramBits;
}

/** 三爻字面量构造 */
function t(a: number, b: number, c: number): readonly [Yao, Yao, Yao] {
  return [a, b, c] as unknown as readonly [Yao, Yao, Yao];
}

// ---- RuleTestSet：L2.1 三爻 → 八卦 ----
const trigramTestSet: RuleTestSet = {
  rule_id: 'liuyao.L2.1.trigram',
  cases: [
    { input: [1, 1, 1], expected: '乾', note: '☰ 三阳' },
    { input: [1, 1, 0], expected: '兑', note: '☱ 上缺' },
    { input: [1, 0, 1], expected: '离', note: '☲ 中虚' },
    { input: [1, 0, 0], expected: '震', note: '☳ 仰盂' },
    { input: [0, 1, 1], expected: '巽', note: '☴ 下断' },
    { input: [0, 1, 0], expected: '坎', note: '☵ 中满' },
    { input: [0, 0, 1], expected: '艮', note: '☶ 覆碗' },
    { input: [0, 0, 0], expected: '坤', note: '☷ 三阴' },
  ],
};

// ---- RuleTestSet：L6.1 定世应（表驱动） ----
// 覆盖 5 种位置类型：本宫（世6）/ 一世（世1）/ 二世 / 三世 / 四世 / 五世 / 游魂（世4）/ 归魂（世3）
const shiYingTestSet: RuleTestSet = {
  rule_id: 'liuyao.L6.1.shiying',
  cases: [
    { input: h(1, 1, 1, 1, 1, 1), expected: { name: '乾为天', shi: 6, ying: 3, position_kind: '本宫' } },
    { input: h(0, 1, 1, 1, 1, 1), expected: { name: '天风姤', shi: 1, ying: 4, position_kind: '一世' } },
    { input: h(0, 0, 1, 1, 1, 1), expected: { name: '天山遁', shi: 2, ying: 5, position_kind: '二世' } },
    { input: h(0, 0, 0, 1, 1, 1), expected: { name: '天地否', shi: 3, ying: 6, position_kind: '三世' } },
    { input: h(0, 0, 0, 0, 1, 1), expected: { name: '风地观', shi: 4, ying: 1, position_kind: '四世' } },
    { input: h(0, 0, 0, 0, 0, 1), expected: { name: '山地剥', shi: 5, ying: 2, position_kind: '五世' } },
    { input: h(0, 0, 0, 1, 0, 1), expected: { name: '火地晋', shi: 4, ying: 1, position_kind: '游魂' } },
    { input: h(1, 1, 1, 1, 0, 1), expected: { name: '火天大有', shi: 3, ying: 6, position_kind: '归魂' } },
    { input: h(0, 1, 0, 0, 1, 0), expected: { name: '坎为水', shi: 6, ying: 3, position_kind: '本宫' } },
    { input: h(0, 1, 0, 0, 0, 0), expected: { name: '地水师', shi: 3, ying: 6, position_kind: '归魂' } },
  ],
};

function main(): void {
  console.log('=== 规则引擎 spike（V0.2 §6）===\n');

  console.log('数据审核状态：', REVIEW_STATUS);
  console.log('数据说明：', DATA_PROVENANCE_NOTE);
  console.log('八宫卦序条目数：', palaceEntryCount(), '（应为 8×8 = 64）\n');

  const runner = createRuleTestSetRunner();

  // L2.1 —— 纯算法
  const r1 = runner.run(trigramTestSet, (input) => {
    const b = input as [number, number, number];
    return resolveTrigram(t(b[0] ?? 0, b[1] ?? 0, b[2] ?? 0)).name;
  });
  console.log(`[L2.1 三爻→八卦] ${r1.passed}/${r1.total} 通过`);
  for (const f of r1.failures) console.log('   ✗', JSON.stringify(f));

  // L6.1 —— 表驱动 + 派生
  const r2 = runner.run(shiYingTestSet, (input) => {
    const r = resolveShiYing(input as HexagramBits);
    return { name: r.name, shi: r.shi, ying: r.ying, position_kind: r.position_kind };
  });
  console.log(`[L6.1 定世应]     ${r2.passed}/${r2.total} 通过`);
  for (const f of r2.failures) console.log('   ✗', JSON.stringify(f));

  // 演示接口不只支持纯算法：一次查询同时返回卦名、宫、宫五行、世、应、位次类型
  const demo = resolveShiYing(h(0, 0, 0, 1, 0, 1));
  console.log('\n派生示例：六爻 000101（初→上）');
  console.log('  本卦解析：', JSON.stringify(resolveHexagram(h(0, 0, 0, 1, 0, 1))));
  console.log('  世应结果：', JSON.stringify(demo));

  const ok = r1.passed === r1.total && r2.passed === r2.total;
  console.log(
    ok
      ? '\n✅ 接口可行：纯算法规则与表驱动规则都能在同一 RuleTestSet 契约下表达'
      : '\n❌ 存在失败用例',
  );
  console.log(
    '⚠️ 数据本身未经人工复核 —— 本 spike 只验证接口形状，不验证术数正确性（见 src/liuyao/tables.ts 文件头）',
  );
  process.exit(ok ? 0 : 1);
}

main();
