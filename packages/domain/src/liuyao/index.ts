/**
 * 规则引擎 spike（V0.2 §6 的技术 spike）
 *
 * 目的**不是**教六爻，而是验证 `RuleJudge` / `RuleTestSet` 接口设计是否可行 ——
 * 「一天的成本，避免『塔罗做完了才发现规则引擎接口设计不下去』」（V0.2 §6）。
 *
 * 选两条规则，因为它们形状不同：
 *   · L2.1  三爻阴阳 → 卦名          纯算法（位组合）
 *   · L6.1  定世应                   表驱动查表 + 派生
 * 只做 L2.1 会漏掉「接口只支持纯算法、不支持查表」的偏差 —— 这是本次增设 L6.1 的理由。
 *
 * ⚠️ 本模块的表格数据是 **AI 起草的 draft 候选，未经人工复核**（见 tables.ts 文件头）。
 */
import { PALACES, REVIEW_STATUS, TRIGRAM_BY_BITS, type PalaceEntry, type TrigramName } from './tables.js';

export * from './tables.js';

/** 阴阳爻。阳 = 1（实线），阴 = 0（断线） */
export type Yao = 0 | 1;

/** 三爻（自初爻起） */
export type TrigramBits = readonly [Yao, Yao, Yao];

/** 六爻（自初爻起） */
export type HexagramBits = readonly [Yao, Yao, Yao, Yao, Yao, Yao];

export interface TrigramResult {
  bits: TrigramBits;
  name: TrigramName;
  /** 八卦的自然象（结构性的符号名，不是解释） */
  symbol: string;
}

const TRIGRAM_SYMBOL: Readonly<Record<TrigramName, string>> = {
  乾: '☰',
  兑: '☱',
  离: '☲',
  震: '☳',
  巽: '☴',
  坎: '☵',
  艮: '☶',
  坤: '☷',
};

function bitsKey(bits: readonly Yao[]): string {
  return bits.join('');
}

/**
 * L2.1 · 由三爻的阴阳组合推出卦名与卦象（不靠背诵）
 *
 * 这是**纯算法**规则：位组合 → 八卦名，没有解释空间，因此 `judging_mode = 规则判定`，
 * AI 不得介入（AI 会在这种有唯一答案的地方产生幻觉 — V0.1 §12）。
 */
export function resolveTrigram(bits: TrigramBits): TrigramResult {
  const key = bitsKey(bits);
  const name = TRIGRAM_BY_BITS[key];
  if (!name) {
    throw new Error(`非法三爻组合：${key}`);
  }
  return { bits, name, symbol: TRIGRAM_SYMBOL[name] };
}

export interface HexagramResult {
  bits: HexagramBits;
  lower: TrigramName;
  upper: TrigramName;
  /** 卦名；若该组合不在已核对的八宫表内则为 undefined */
  name: string | undefined;
  /** 所属宫名（如「乾宫」） */
  palace_name: string | undefined;
  /** 宫所属五行 */
  palace_element: '金' | '水' | '木' | '火' | '土' | undefined;
  /** 该卦在八宫表中的原始条目 */
  entry: PalaceEntry | undefined;
}

/** 由六爻（自初爻起）拆出下卦（1–3 爻）与上卦（4–6 爻） */
export function splitTrigram(bits: HexagramBits): { lower: TrigramName; upper: TrigramName } {
  const lower = resolveTrigram([bits[0], bits[1], bits[2]]).name;
  const upper = resolveTrigram([bits[3], bits[4], bits[5]]).name;
  return { lower, upper };
}

/**
 * 六爻 → 本卦。需要**查表**（64 卦的上下卦组合 → 卦名）。
 * 这正是增设 L6.1 想验证的能力：接口不能只支持纯算法。
 */
export function resolveHexagram(bits: HexagramBits): HexagramResult {
  const { lower, upper } = splitTrigram(bits);
  for (const palace of PALACES) {
    for (const entry of palace.entries) {
      if (entry.lower === lower && entry.upper === upper) {
        return {
          bits,
          lower,
          upper,
          name: entry.name,
          palace_name: palace.name,
          palace_element: palace.element,
          entry,
        };
      }
    }
  }
  return {
    bits,
    lower,
    upper,
    name: undefined,
    palace_name: undefined,
    palace_element: undefined,
    entry: undefined,
  };
}

export interface ShiYingResult {
  /** 卦名 */
  name: string;
  /** 所属宫名 */
  palace_name: string;
  /** 宫所属五行 */
  palace_element: '金' | '水' | '木' | '火' | '土';
  /** 世爻位置：1 = 初爻 … 6 = 上爻 */
  shi: 1 | 2 | 3 | 4 | 5 | 6;
  /** 应爻位置：与世爻隔三位 */
  ying: 1 | 2 | 3 | 4 | 5 | 6;
  position_kind: PalaceEntry['position_kind'];
}

/** 应爻 = 世爻隔三位（1↔4, 2↔5, 3↔6），即 (shi ± 3) */
export function yingFromShi(shi: 1 | 2 | 3 | 4 | 5 | 6): 1 | 2 | 3 | 4 | 5 | 6 {
  const y = shi <= 3 ? shi + 3 : shi - 3;
  return y as 1 | 2 | 3 | 4 | 5 | 6;
}

/**
 * L6.1 · 定出任一卦的世爻与应爻
 *
 * **表驱动**：先查八宫卦序得到世爻位置，再派生应爻。
 * 这是与 L2.1 形状不同的规则 —— 它证明 `RuleJudge` 接口必须支持查表与多步派生。
 *
 * 表外组合**抛错而不静默返回 undefined**：规则引擎在有唯一答案的地方不许"猜"。
 */
export function resolveShiYing(bits: HexagramBits): ShiYingResult {
  const hex = resolveHexagram(bits);
  if (!hex.name || !hex.palace_name || !hex.palace_element || !hex.entry) {
    throw new Error(`六爻组合 ${bits.join('')} 不在已核对的八宫表内`);
  }
  const shi = hex.entry.shi;
  return {
    name: hex.name,
    palace_name: hex.palace_name,
    palace_element: hex.palace_element,
    shi,
    ying: yingFromShi(shi),
    position_kind: hex.entry.position_kind,
  };
}

/** 本 spike 数据的审核状态。**永远不是 reviewed** —— 见 tables.ts 文件头 */
export function spikeDataReviewStatus(): typeof REVIEW_STATUS {
  return REVIEW_STATUS;
}

/** 表内条目总数（用于自检：应为 8 宫 × 8 卦 = 64） */
export function palaceEntryCount(): number {
  return PALACES.reduce((n, p) => n + p.entries.length, 0);
}
