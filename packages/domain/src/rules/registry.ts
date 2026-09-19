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

/**
 * 规则过程：输入 + 知识库上下文 + **自身声明** → 输出。
 *
 * 为什么要把 `rule` 传进来：表驱动规则需要读**自己那张表**（`rule.table`），
 * 而 `ctx.bundle` 里有很多规则，procedure 无从知道自己是哪一条。
 */
export type RuleProcedure = (
  input: unknown,
  ctx: RuleEngineContext,
  rule: import('../layer1/rule.js').Rule,
) => unknown;

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
// 六爻 · 由爻定卦（表驱动）
//
// 依据 V0.2 §6：这两条规则刻意选成**形状不同**的：
//   · resolveTrigram   —— 8 行的**小表**（三爻阴阳 → 八卦名与卦象）
//   · resolveHexagram  —— 64 行的**大表** + 派生（六爻 → 本卦名/上下卦/宫/世/应）
// 表本身住在内容库（`rule.table`），带列定义与来源 —— **不在代码里硬编码术数数据**。
//
// ⚠️ 与 `resolveRelation` 同样的原则：过程是纯函数，真值表来自内容库。
//    删掉表里一行 → 对应题目就答不出来（而不是悄悄给出错答案）。
// ─────────────────────────────────────────────────────────────────────────────

/** 一行三爻（自初爻起，阳=1 阴=0）→ 八卦 */
export interface TrigramByYaoResult {
  name: string;
  /** 卦象符号，如 ☰ */
  symbol: string;
  element: string;
  /** 位组合字符串，如 '111' */
  bits: string;
}

function yaoBits(input: unknown, count: number, field = 'lines'): string {
  const obj = input as Record<string, unknown> | null;
  const raw = obj?.[field];
  if (!Array.isArray(raw) || raw.length !== count) {
    throw new RuleInputError(`字段 ${field} 必须是长度 ${count} 的数组（自初爻起，阳=1 阴=0）`);
  }
  return raw.map((v) => (v === 1 || v === 0 ? String(v) : (() => { throw new RuleInputError(`${field} 的元素只能是 0 或 1`); })())).join('');
}

/** 从规则自己的表里按位组合查行；查不到**抛错而不是返回 undefined** */
function lookupByBits(rule: import('../layer1/rule.js').Rule, bits: string, tableLabel: string): Record<string, string | number> {
  const table = rule.table;
  if (!table) throw new RuleInputError(`规则 ${rule.id} 没有 table，无法做表驱动查表（${tableLabel}）`);
  const row = table.rows.find((r) => String(r[table.columns[0]!.key]) === bits);
  if (!row) throw new RuleInputError(`${tableLabel}：表中没有位组合 ${bits}（表不完整？）`);
  return row;
}

/**
 * L2.1 · 由三爻阴阳推出八卦（不靠背诵）
 *
 * 表驱动：内容库 `rule.table` 的 8 行，每行给位组合 → 卦名/卦象/五行。
 * 与《梅花易數》「乾三連，坤六斷，震仰盂，艮覆碗，離中虛，坎中滿，兌上缺，巽下斷」对应。
 */
export function resolveTrigramByYao(
  input: unknown,
  _ctx: RuleEngineContext,
  rule: import('../layer1/rule.js').Rule,
): TrigramByYaoResult {
  const bits = yaoBits(input, 3);
  const row = lookupByBits(rule, bits, '八卦表');
  return {
    name: String(row.name),
    symbol: String(row.symbol),
    element: String(row.element),
    bits,
  };
}

/** 六爻（自初爻起）→ 本卦 */
export interface HexagramByYaoResult {
  name: string;
  /** 下卦（1–3 爻） */
  lower: string;
  /** 上卦（4–6 爻） */
  upper: string;
  palace: string;
  palace_element: string;
  shi: number;
  ying: number;
  position_kind: string;
  bits: string;
}

/**
 * L6.1 · 由六爻阴阳定本卦（卦名 / 上下卦 / 宫 / 世 / 应）
 *
 * 表驱动：内容库 `rule.table` 的 64 行（下卦 + 上卦 → 卦名与八宫信息）。
 * 世应为派生值：表里给世爻位置，应爻 = 世爻隔三位。
 * 世位规则有古典出处（《郑氏易谱》：游魂=四世、归魂=三世）。
 */
export function resolveHexagramByYao(
  input: unknown,
  _ctx: RuleEngineContext,
  rule: import('../layer1/rule.js').Rule,
): HexagramByYaoResult {
  const bits = yaoBits(input, 6);
  const lower = bits.slice(0, 3);
  const upper = bits.slice(3, 6);
  const key = `${lower}/${upper}`;

  const table = rule.table;
  if (!table) throw new RuleInputError(`规则 ${rule.id} 没有 table，无法查六十四卦表`);
  const row = table.rows.find((r) => String(r.key) === key);
  if (!row) throw new RuleInputError(`六十四卦表：没有「下${lower}/上${upper}」这一行（表不完整？）`);

  const shi = Number(row.shi);
  if (!Number.isInteger(shi) || shi < 1 || shi > 6) {
    throw new RuleInputError(`六十四卦表：${String(row.name)} 的世爻位置 ${String(row.shi)} 非法`);
  }
  const ying = shi <= 3 ? shi + 3 : shi - 3;

  return {
    name: String(row.name),
    lower: String(row.lower_name),
    upper: String(row.upper_name),
    palace: String(row.palace),
    palace_element: String(row.palace_element),
    shi,
    ying,
    position_kind: String(row.position_kind),
    bits,
  };
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
  resolveTrigramByYao,
  resolveHexagramByYao,
};

export interface ResolvedRule {
  rule_id: string;
  procedure_ref: string;
  /** 注册表里查到的实现 */
  procedure: RuleProcedure;
  /** 规则自身的声明（含 table / school_id / applies_to_symbol_ids） */
  rule: import('../layer1/rule.js').Rule;
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
  return { rule_id: rule.id, procedure_ref: rule.procedure_ref, procedure, rule };
}
