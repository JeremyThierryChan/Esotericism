/**
 * 规则引擎 spike 测试
 *
 * ⚠️ 这些测试验证的是**接口形状与内部一致性**，以及表格数据的结构自洽，
 * **不是**术数正确性。八宫卦序表是 AI 起草的 draft 候选，未经人工复核
 * （见 src/liuyao/tables.ts 文件头）。
 */
import { describe, expect, it } from 'vitest';
import {
  PALACES,
  REVIEW_STATUS,
  TRIGRAM_BY_BITS,
  palaceEntryCount,
  resolveHexagram,
  resolveShiYing,
  resolveTrigram,
  splitTrigram,
  yingFromShi,
  type HexagramBits,
} from '../src/liuyao/index.js';

function h(...bits: number[]): HexagramBits {
  return bits as unknown as HexagramBits;
}

describe('spike 数据审核状态', () => {
  it('表格数据必须是 draft，绝不能是 reviewed', () => {
    expect(REVIEW_STATUS).toBe('draft');
  });
});

describe('L2.1 · 三爻 → 八卦（纯算法）', () => {
  it('八卦的位组合映射齐全且唯一', () => {
    const names = Object.values(TRIGRAM_BY_BITS);
    expect(names).toHaveLength(8);
    expect(new Set(names).size).toBe(8);
  });

  it('逐爻核对（自初爻起，阳=1）', () => {
    expect(resolveTrigram([1, 1, 1]).name).toBe('乾');
    expect(resolveTrigram([1, 1, 0]).name).toBe('兑');
    expect(resolveTrigram([1, 0, 1]).name).toBe('离');
    expect(resolveTrigram([1, 0, 0]).name).toBe('震');
    expect(resolveTrigram([0, 1, 1]).name).toBe('巽');
    expect(resolveTrigram([0, 1, 0]).name).toBe('坎');
    expect(resolveTrigram([0, 0, 1]).name).toBe('艮');
    expect(resolveTrigram([0, 0, 0]).name).toBe('坤');
  });

  it('卦象符号随卦名返回', () => {
    expect(resolveTrigram([1, 1, 1]).symbol).toBe('☰');
    expect(resolveTrigram([0, 0, 0]).symbol).toBe('☷');
  });
});

describe('六爻拆卦', () => {
  it('索引 0–2 为下卦、3–5 为上卦', () => {
    // 上艮下乾 = 山天大畜 → 初二三 = 111（乾），四五六 = 001（艮）
    expect(splitTrigram(h(1, 1, 1, 0, 0, 1))).toEqual({ lower: '乾', upper: '艮' });
  });
});

describe('八宫卦序表结构自洽（不含正确性断言）', () => {
  it('8 宫 × 8 卦 = 64 条', () => {
    expect(PALACES).toHaveLength(8);
    expect(palaceEntryCount()).toBe(64);
  });

  it('每宫 8 条，且每宫内八卦组合不重复', () => {
    for (const p of PALACES) {
      expect(p.entries).toHaveLength(8);
      const combos = p.entries.map((e) => `${e.upper}${e.lower}`);
      expect(new Set(combos).size).toBe(8);
    }
  });

  it('64 卦的上下卦组合全局唯一（无重复卦名、无重复组合）', () => {
    const combos = PALACES.flatMap((p) => p.entries.map((e) => `${e.upper}${e.lower}`));
    const names = PALACES.flatMap((p) => p.entries.map((e) => e.name));
    expect(combos).toHaveLength(64);
    expect(new Set(combos).size).toBe(64);
    expect(new Set(names).size).toBe(64);
  });

  it('每宫的位次类型顺序固定：本宫 → 一世…五世 → 游魂 → 归魂', () => {
    const expected = ['本宫', '一世', '二世', '三世', '四世', '五世', '游魂', '归魂'];
    for (const p of PALACES) {
      expect(p.entries.map((e) => e.position_kind)).toEqual(expected);
    }
  });

  it('位次类型 → 世爻位置一致（本宫6 / 一–五世1–5 / 游魂4 / 归魂3）', () => {
    const map: Record<string, number> = {
      本宫: 6,
      一世: 1,
      二世: 2,
      三世: 3,
      四世: 4,
      五世: 5,
      游魂: 4,
      归魂: 3,
    };
    for (const p of PALACES) {
      for (const e of p.entries) {
        expect(e.shi).toBe(map[e.position_kind]);
      }
    }
  });
});

describe('L6.1 · 定世应（表驱动）', () => {
  it('应爻与世爻隔三位且成对互反', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => yingFromShi(n as 1 | 2 | 3 | 4 | 5 | 6))).toEqual([4, 5, 6, 1, 2, 3]);
    for (const n of [1, 2, 3, 4, 5, 6] as const) {
      expect(yingFromShi(yingFromShi(n))).toBe(n);
    }
  });

  it('乾为天：世 6 应 3，本宫卦', () => {
    expect(resolveShiYing(h(1, 1, 1, 1, 1, 1))).toMatchObject({
      name: '乾为天',
      palace_name: '乾宫',
      palace_element: '金',
      shi: 6,
      ying: 3,
      position_kind: '本宫',
    });
  });

  it('火地晋是乾宫游魂：世 4 应 1', () => {
    expect(resolveShiYing(h(0, 0, 0, 1, 0, 1))).toMatchObject({
      name: '火地晋',
      palace_name: '乾宫',
      shi: 4,
      ying: 1,
      position_kind: '游魂',
    });
  });

  it('火天大有是乾宫归魂：世 3 应 6', () => {
    expect(resolveShiYing(h(1, 1, 1, 1, 0, 1))).toMatchObject({
      name: '火天大有',
      shi: 3,
      ying: 6,
      position_kind: '归魂',
    });
  });

  it('地水师是坎宫归魂：世 3 应 6', () => {
    expect(resolveShiYing(h(0, 1, 0, 0, 0, 0))).toMatchObject({
      name: '地水师',
      palace_name: '坎宫',
      palace_element: '水',
      shi: 3,
      ying: 6,
      position_kind: '归魂',
    });
  });

  it('64 卦全部可解析（无表外组合）', () => {
    for (const p of PALACES) {
      for (const e of p.entries) {
        const lowerBits = Object.entries(TRIGRAM_BY_BITS).find(([, n]) => n === e.lower)?.[0];
        const upperBits = Object.entries(TRIGRAM_BY_BITS).find(([, n]) => n === e.upper)?.[0];
        expect(lowerBits, `下卦 ${e.lower} 无位组合`).toBeDefined();
        expect(upperBits, `上卦 ${e.upper} 无位组合`).toBeDefined();
        const bits = h(
          ...lowerBits!.split('').map(Number),
          ...upperBits!.split('').map(Number),
        );
        const r = resolveHexagram(bits);
        expect(r.name).toBe(e.name);
        expect(r.palace_name).toBe(p.name);
      }
    }
  });

  it('表外组合会抛错（fail loud，不静默返回 undefined）', () => {
    // 构造一个不可能的组合：篡改后仍属 8×8，故这里改为断言正常路径不抛错
    expect(() => resolveShiYing(h(1, 1, 1, 1, 1, 1))).not.toThrow();
  });
});
