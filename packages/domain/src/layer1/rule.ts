/**
 * Layer 1 · Rule / RuleTestSet
 *
 * 依据：V0.2 §5.2（规则引擎是规则密集型体系的核心）、§5.6（M6：规则验证集）
 *
 * ⚠️ 本文件定义的 `Rule` 是**确定性程序**，由规则引擎执行，**AI 不得介入**。
 * 原因：AI 会在纳甲、六亲上产生幻觉，而这里本来有唯一正确答案（V0.1 §12）。
 */
import { z } from 'zod';
import { entityBaseSchema } from '../layer0/provenance.js';

/** 规则验证集（M6）：规则引擎正确性的唯一保证 */
export const ruleTestCaseSchema = z.object({
  /** 输入（已序列化为 JSON 可存的形式） */
  input: z.unknown(),
  /** 期望输出 */
  expected: z.unknown(),
  note: z.string().optional(),
});
export type RuleTestCase = z.infer<typeof ruleTestCaseSchema>;

export const ruleTestSetSchema = z.object({
  rule_id: z.string().min(1),
  cases: z.array(ruleTestCaseSchema).min(1),
});
export type RuleTestSet = z.infer<typeof ruleTestSetSchema>;

/**
 * 表驱动规则的数据表。
 *
 * 依据 V0.2 §6：spike 时特意选了 L6.1「定世应」做第二条规则，因为它是**表驱动**的
 * （八宫卦序查表），而纯算法规则验证不出「接口只支持算法、不支持查表」的偏差。
 * 这里把那张表变成**有类型、可校验、带来源**的内容数据。
 *
 * 为什么表要有列定义：`z.unknown()` 存表等于放弃校验。列定义让 CI 能检查
 * 「每行是否齐全、类型是否对得上」—— 卦序表有 64 行，手抄错一行的概率不低。
 */
export const ruleTableColumnSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(['string', 'number']),
});
export type RuleTableColumn = z.infer<typeof ruleTableColumnSchema>;

export const ruleTableSchema = z.object({
  /** 这张表是干什么的 */
  description: z.string().min(1),
  columns: z.array(ruleTableColumnSchema).min(1),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))).min(1),
});
export type RuleTable = z.infer<typeof ruleTableSchema>;

export const ruleSchema = entityBaseSchema.extend({
  /** 规则所属体系 */
  system_id: z.string().min(1),
  /** 流派归属。**不是「以后再说」的字段** —— 若入门不写，做对比课程时无法回溯每条规则属于哪一派（V0.2 §5.5） */
  school_id: z.string().min(1),
  name: z.string().min(1),
  /**
   * 规则引擎实现的引用（模块路径 + 导出名），供 `RuleJudge` 定位实现。
   * 例：'liuyao/shiying#resolveShiYing'
   */
  procedure_ref: z.string().min(1),
  /** 绑定的验证集 */
  test_set_id: z.string().min(1).optional(),
  /** 规则的应用对象（符号 id 列表） */
  applies_to_symbol_ids: z.array(z.string().min(1)).default([]),
  /** 表驱动规则的数据表。算法类规则留空 */
  table: ruleTableSchema.optional(),
});
export type Rule = z.infer<typeof ruleSchema>;
