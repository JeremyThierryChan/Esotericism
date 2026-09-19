/**
 * 派生视图测试 —— 机制 A（同源投影）必须是**推导出来的**，不是人工建的边。
 */
import { describe, expect, it } from 'vitest';
import { isSameFormalismEdge, sameFormalismProjection } from '../src/derive.js';
import type { Symbol, SymbolUsage } from '../src/layer1/symbol.js';
import { humanProvenance } from './fixtures.js';

const sym = (id: string, formalism_id: Symbol['formalism_id']): Symbol => ({
  id,
  formalism_id,
  canonical_name: id,
  aliases: [],
  symbol_kind: 'native',
  provenance: humanProvenance(),
});

const use = (symbol_id: string, system_id: string, role: string): SymbolUsage => ({
  symbol_id,
  system_id,
  role,
});

describe('sameFormalismProjection · 机制 A', () => {
  it('同一符号被两个体系使用 → 产生一条投影', () => {
    const symbols = [sym('sym.qian', 'east-xiangshu')];
    const usages = [
      use('sym.qian', 'system.liuyao', '卦宫五行'),
      use('sym.qian', 'system.meihua', '体用'),
    ];
    const proj = sameFormalismProjection(symbols, usages);
    expect(proj).toHaveLength(1);
    expect(proj[0]).toMatchObject({
      symbol_id: 'sym.qian',
      formalism_id: 'east-xiangshu',
      system_count: 2,
    });
  });

  it('只被一个体系使用 → 不构成投影', () => {
    const symbols = [sym('sym.qian', 'east-xiangshu')];
    const proj = sameFormalismProjection(symbols, [use('sym.qian', 'system.liuyao', '卦宫五行')]);
    expect(proj).toEqual([]);
  });

  it('没有 usage 的符号不出现', () => {
    const symbols = [sym('sym.gu', 'east-xiangshu')];
    expect(sameFormalismProjection(symbols, [])).toEqual([]);
  });

  it('三个体系共用一个符号 → system_count = 3（六爻/梅花/八字共用五行）', () => {
    const symbols = [sym('sym.wuxing.mu', 'east-xiangshu')];
    const usages = [
      use('sym.wuxing.mu', 'system.liuyao', '六亲取用'),
      use('sym.wuxing.mu', 'system.meihua', '体用生克'),
      use('sym.wuxing.mu', 'system.bazi', '日主强弱'),
    ];
    expect(sameFormalismProjection(symbols, usages)[0]?.system_count).toBe(3);
  });

  it('输出稳定排序（可复现）', () => {
    const symbols = [sym('sym.b', 'east-xiangshu'), sym('sym.a', 'east-xiangshu')];
    const usages = [
      use('sym.b', 's1', 'r'),
      use('sym.b', 's2', 'r'),
      use('sym.a', 's1', 'r'),
      use('sym.a', 's2', 'r'),
    ];
    expect(sameFormalismProjection(symbols, usages).map((p) => p.symbol_id)).toEqual(['sym.a', 'sym.b']);
  });
});

describe('isSameFormalismEdge · CI 规则 R8 的判定函数', () => {
  const formalismOf = (id: string) =>
    id.startsWith('sym.east') ? ('east-xiangshu' as const) : id.startsWith('sym.planet') ? ('planetary-zodiac' as const) : undefined;

  it('同 Formalism → true（该边非法，应为派生投影）', () => {
    expect(isSameFormalismEdge({ from_node_id: 'sym.east.a', to_node_id: 'sym.east.b' }, formalismOf)).toBe(true);
  });

  it('跨 Formalism → false（塔罗↔占星属此类）', () => {
    expect(isSameFormalismEdge({ from_node_id: 'sym.east.a', to_node_id: 'sym.planet.mars' }, formalismOf)).toBe(false);
  });

  it('端点不是 Symbol（如 Concept/Skill）→ 无法判定，不拦', () => {
    expect(isSameFormalismEdge({ from_node_id: 'concept.x', to_node_id: 'sym.east.a' }, formalismOf)).toBe(false);
  });
});
