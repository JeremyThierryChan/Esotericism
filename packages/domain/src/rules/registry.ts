/**
 * 规则引擎：规则实现的注册表 + 一个**数据驱动**的五行生克规则。
 *
 * 依据：V0.1 §12（能确定的一律交给规则；AI 不得介入有唯一答案处）、V0.2 §5.6（M6）
 *
 * ⚠️ **关键设计：规则不硬编码术数理论，而是执行内容库里的关系数据。**
 *
 * `resolveRelation` 不写死"木生火"，它去 `bundle.relations` 里查 `related_by/生` 与
 * `related_by/克` 的边。理由：
 *   1. 遵守工作方式约定 5（AI 不生成未经人工审核的术数理论）—— 理论只存在于内容库，
 *      而内容库的每一条都带 `sources` + `review_status`，可被 CI 拦
 *   2. 改真值表 = 改内容库，不改代码；内容与引擎不会各说一套
 *   3. 同一个规则实现可以服务任何"有向作用关系"的真值表（生克、冲合、相位）
 *
 * 本模块**必须能在浏览器里跑**（GitHub Pages 版预览靠它做真实判分），
 * 因此不得引入任何 Node 专有 API。这一点由 `apps/preview` 的构建来验证。
 */
import type { ContentBundle } from '../bundle.js';

export interface RuleEngineContext {
  bundle: ContentBundle;
}

/** 规则过程：输入 + 知识库上下文 → 输出。必须是**纯函数**（可复现、可审计） */
export type RuleProcedure = (input: unknown, ctx: RuleEngineContext) => unknown;

export class RuleInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleInputError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 五行生克（rule.wuxing.shengke）
// ─────────────────────────────────────────────────────────────────────────────

export interface RelationQueryInput {
  /** 符号的 canonical_name 或 symbol id */
  a: string;
  b: string;
}

export interface RelationQueryResult {
  relation: '生' | '克' | 'none';
  /** 'a→b' | 'b→a' | 'none' */
  direction: 'a→b' | 'b→a' | 'none';
  /** 依据：命中哪一条闭循环 */
  basis?: string;
}

function asString(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.length === 0) {
    throw new RuleInputError(`字段 ${field} 必须是非空字符串`);
  }
  return v;
}

/** 把 canonical_name 或 symbol id 解析成 symbol id */
function resolveSymbolId(nameOrId: string, ctx: RuleEngineContext): string {
  if (ctx.bundle.symbols.some((s) => s.id === nameOrId)) return nameOrId;
  const byName = ctx.bundle.symbols.find((s) => s.canonical_name === nameOrId);
  if (!byName) throw new RuleInputError(`符号「${nameOrId}」不在内容库中`);
  return byName.id;
}

/**
 * 由两个符号判生克关系与方向。
 *
 * **真值表来自内容库**（`related_by` 边），不是代码里的常量。
 */
export function resolveRelation(input: unknown, ctx: RuleEngineContext): RelationQueryResult {
  if (typeof input !== 'object' || input === null) {
    throw new RuleInputError('输入必须是 { a, b } 对象');
  }
  const { a, b } = input as Record<string, unknown>;
  const idA = resolveSymbolId(asString(a, 'a'), ctx);
  const idB = resolveSymbolId(asString(b, 'b'), ctx);

  if (idA === idB) return { relation: 'none', direction: 'none' };

  for (const subtype of ['生', '克'] as const) {
    const edges = ctx.bundle.relations.filter((r) => r.subtype === subtype);
    if (edges.some((r) => r.from_symbol_id === idA && r.to_symbol_id === idB)) {
      return { relation: subtype, direction: 'a→b', basis: `内容库 related_by/${subtype}：${idA} → ${idB}` };
    }
    if (edges.some((r) => r.from_symbol_id === idB && r.to_symbol_id === idA)) {
      return { relation: subtype, direction: 'b→a', basis: `内容库 related_by/${subtype}：${idB} → ${idA}` };
    }
  }
  return { relation: 'none', direction: 'none' };
}

// ─────────────────────────────────────────────────────────────────────────────
// 注册表
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `procedure_ref` → 实现。
 *
 * `Rule.procedure_ref` 的格式是 `'<模块>/<名字>#<导出名>'`，例如
 * `'wuxing/shengke#resolveRelation'`。这里按导出名索引，避免把文件路径写进内容库。
 */
export const RULE_REGISTRY: Readonly<Record<string, RuleProcedure>> = {
  resolveRelation,
};

export interface ResolvedRule {
  rule_id: string;
  procedure_ref: string;
  /** 注册表里查到的实现 */
  procedure: RuleProcedure;
}

/** 按 rule_id 找到实现（查注册表 → 查 procedure_ref 的导出名） */
export function resolveRule(ruleId: string, ctx: RuleEngineContext): ResolvedRule {
  const rule = ctx.bundle.rules.find((r) => r.id === ruleId);
  if (!rule) throw new RuleInputError(`内容库里没有规则 ${ruleId}`);

  const exportName = rule.procedure_ref.split('#')[1];
  if (!exportName) {
    throw new RuleInputError(`规则 ${ruleId} 的 procedure_ref「${rule.procedure_ref}」缺少 #导出名`);
  }
  const procedure = RULE_REGISTRY[exportName];
  if (!procedure) {
    throw new RuleInputError(
      `规则 ${ruleId} 指向未注册的实现「${exportName}」。已注册：${Object.keys(RULE_REGISTRY).join(', ')}`,
    );
  }
  return { rule_id: rule.id, procedure_ref: rule.procedure_ref, procedure };
}
