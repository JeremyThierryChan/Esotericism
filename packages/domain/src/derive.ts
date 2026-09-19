/**
 * 派生视图 · same_formalism_projection（机制 A）
 *
 * 依据：ADR-0011、V0.1 §2「派生视图（不落库）」、V0.2 §5.3
 *
 * V0.1 §3 原把跨体系关系写成机制 A / 机制 B 两种「设计约定」。ADR-0009 引入
 * `Formalism` 层之后，它变成了**数据结构上的必然区分**：
 *
 *   机制 A 同源投影 —— 同一个 Formalism 内 → 共享 Symbol 节点，只交换 Rule
 *                      → **可自动推导，不人工建边**
 *   机制 B 迁移类比 —— 跨 Formalism      → 必须建 transfers_as 边 + 类型 + 来源强度
 *
 * 所以「六爻的乾」与「梅花的乾」是**同一个 Symbol 节点**的两种 `SymbolUsage`；
 * 它们之间的关系查一下就有，人工建边是冗余，还会产生 O(n²) 条目与推导结果不一致。
 *
 * ⚠️ 本函数是**唯一**判定「某对符号/体系之间是共享还是需要建边」的地方。
 * CI 规则 R8 用它来阻止「同一 Formalism 内出现人工 transfers_as 边」。
 */
import type { FormalismId } from './layer1/formalism.js';
import type { Symbol, SymbolUsage } from './layer1/symbol.js';

export interface ProjectionPair {
  symbol_id: string;
  formalism_id: FormalismId;
  /** 该符号在哪些体系里被使用，以及各自扮演的角色 */
  usages: Array<{ system_id: string; school_id?: string; role: string }>;
  /** 涉及的不同体系数量。≥2 才构成一条「投影」 */
  system_count: number;
}

/**
 * 计算同一 Formalism 内的投影关系。
 *
 * 只返回 `system_count >= 2` 的符号 —— 一个符号只被一个体系使用时不构成跨体系投影。
 */
export function sameFormalismProjection(
  symbols: readonly Symbol[],
  usages: readonly SymbolUsage[],
): ProjectionPair[] {
  const bySymbolId = new Map<string, SymbolUsage[]>();
  for (const u of usages) {
    const list = bySymbolId.get(u.symbol_id);
    if (list) list.push(u);
    else bySymbolId.set(u.symbol_id, [u]);
  }

  const out: ProjectionPair[] = [];
  for (const sym of symbols) {
    const symUsages = bySymbolId.get(sym.id);
    if (!symUsages || symUsages.length === 0) continue;

    const systemIds = new Set(symUsages.map((u) => u.system_id));
    if (systemIds.size < 2) continue;

    out.push({
      symbol_id: sym.id,
      formalism_id: sym.formalism_id,
      usages: symUsages.map((u) =>
        u.school_id === undefined
          ? { system_id: u.system_id, role: u.role }
          : { system_id: u.system_id, school_id: u.school_id, role: u.role },
      ),
      system_count: systemIds.size,
    });
  }

  // 稳定排序，让快照/测试可复现
  return out.sort((a, b) => a.symbol_id.localeCompare(b.symbol_id));
}

/**
 * 判断一条 `transfers_as` 边的两端是否落在**同一个** Formalism 内。
 * 是 → 该边非法（应为派生投影）。CI 规则 R8 用。
 *
 * `formalismOf` 返回普通 string（而不是 `FormalismId`）以便调用方从运行时数据取值；
 * 判定只做相等比较，不需要枚举约束。
 */
export function isSameFormalismEdge(
  edge: { from_node_id: string; to_node_id: string },
  formalismOf: (nodeId: string) => string | undefined,
): boolean {
  const a = formalismOf(edge.from_node_id);
  const b = formalismOf(edge.to_node_id);
  return a !== undefined && b !== undefined && a === b;
}
