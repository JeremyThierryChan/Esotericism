/**
 * ⚠️⚠️ 未审核数据 —— L6.1「定世应」所需的八宫卦序表 ⚠️⚠️
 *
 * **本文件的内容是 AI 起草的 `draft` 候选，未经人工复核，不得进入 reviewed 内容库。**
 * 依据项目自身铁律：
 *   · 认识论原则 3：无来源，不入库。AI 只能产出 draft 候选，AI 产出永远不能直接进入 reviewed。
 *   · 工作方式约定 5：AI 不生成未经人工审核的术数理论。
 *   · R1 自身的方法学限制也一样适用于本次生成 —— 产品规则对自己的东西同样生效。
 *
 * 待人工复核事项：
 *   1. 八宫卦序（每宫八卦的次序与世爻位置）需与原典逐条核对。R1 Q3.2 只核实了
 *      《卜筮正宗》（清·王洪绪／王维德）、《增删卜易》（清·野鹤老人，李文辉编校刊行）、
 *      《易隐》（清·曹九锡）的**书名与作者归属**，**成书年份与具体世应表均未核实**。
 *   2. 世爻位置的推导规则（本宫世六 / 一世世初 / … / 游魂世四 / 归魂世三）需核对。
 *   3. 应爻＝世爻隔三位的规则需核对。
 *
 * 因此本表：
 *   · 不带 `sources`（所以 CI 会判定它**不可升级为 reviewed**，这是正确行为）
 *   · 用 `REVIEW_STATUS = 'draft'` 显式标注
 *   · 只用于**接口可行性 spike**，不用于教学或判分
 */

export type TrigramName = '乾' | '兑' | '离' | '震' | '巽' | '坎' | '艮' | '坤';

export const REVIEW_STATUS = 'draft' as const;
export const DATA_PROVENANCE_NOTE =
  'AI 起草的 draft 候选，未经人工复核；书名作者见 R1 Q3.2，世应表本身未核实';

/**
 * 三爻 → 八卦。
 *
 * 编码约定：数组索引 0 = 初爻，2 = 三爻；阳 = 1，阴 = 0。
 * 这是**结构性**约定（二进制组合），不是解释性内容。
 */
export const TRIGRAM_BY_BITS: Readonly<Record<string, TrigramName>> = {
  '111': '乾', // ☰ 三阳
  '110': '兑', // ☱ 上缺
  '101': '离', // ☲ 中虚
  '100': '震', // ☳ 仰盂（初爻阳）
  '011': '巽', // ☴ 下断（初爻阴）
  '010': '坎', // ☵ 中满
  '001': '艮', // ☶ 覆碗（上爻阳）
  '000': '坤', // ☷ 三阴
} as const;

/** 八卦的五行属性（宫所属五行） */
export const TRIGRAM_ELEMENT: Readonly<Record<TrigramName, '金' | '水' | '木' | '火' | '土'>> = {
  乾: '金',
  兑: '金',
  离: '火',
  震: '木',
  巽: '木',
  坎: '水',
  艮: '土',
  坤: '土',
} as const;

export interface PalaceEntry {
  /** 卦名 */
  name: string;
  /** 上卦 */
  upper: TrigramName;
  /** 下卦 */
  lower: TrigramName;
  /** 世爻位置：1 = 初爻 … 6 = 上爻 */
  shi: 1 | 2 | 3 | 4 | 5 | 6;
  /** 该卦在本宫中的位次类型（本宫 / 一世 … / 游魂 / 归魂） */
  position_kind: '本宫' | '一世' | '二世' | '三世' | '四世' | '五世' | '游魂' | '归魂';
}

export interface Palace {
  /** 宫名（以本宫卦命名） */
  name: string;
  /** 宫所属五行 */
  element: '金' | '水' | '木' | '火' | '土';
  entries: readonly PalaceEntry[];
}

/**
 * 京房八宫卦序（⚠️ 未审核，见文件头）。
 * 每宫八卦，自本宫卦起依次变初、二、三、四、五爻，再取游魂、归魂。
 */
export const PALACES: readonly Palace[] = [
  {
    name: '乾宫',
    element: '金',
    entries: [
      { name: '乾为天', upper: '乾', lower: '乾', shi: 6, position_kind: '本宫' },
      { name: '天风姤', upper: '乾', lower: '巽', shi: 1, position_kind: '一世' },
      { name: '天山遁', upper: '乾', lower: '艮', shi: 2, position_kind: '二世' },
      { name: '天地否', upper: '乾', lower: '坤', shi: 3, position_kind: '三世' },
      { name: '风地观', upper: '巽', lower: '坤', shi: 4, position_kind: '四世' },
      { name: '山地剥', upper: '艮', lower: '坤', shi: 5, position_kind: '五世' },
      { name: '火地晋', upper: '离', lower: '坤', shi: 4, position_kind: '游魂' },
      { name: '火天大有', upper: '离', lower: '乾', shi: 3, position_kind: '归魂' },
    ],
  },
  {
    name: '坎宫',
    element: '水',
    entries: [
      { name: '坎为水', upper: '坎', lower: '坎', shi: 6, position_kind: '本宫' },
      { name: '水泽节', upper: '坎', lower: '兑', shi: 1, position_kind: '一世' },
      { name: '水雷屯', upper: '坎', lower: '震', shi: 2, position_kind: '二世' },
      { name: '水火既济', upper: '坎', lower: '离', shi: 3, position_kind: '三世' },
      { name: '泽火革', upper: '兑', lower: '离', shi: 4, position_kind: '四世' },
      { name: '雷火丰', upper: '震', lower: '离', shi: 5, position_kind: '五世' },
      { name: '地火明夷', upper: '坤', lower: '离', shi: 4, position_kind: '游魂' },
      { name: '地水师', upper: '坤', lower: '坎', shi: 3, position_kind: '归魂' },
    ],
  },
  {
    name: '艮宫',
    element: '土',
    entries: [
      { name: '艮为山', upper: '艮', lower: '艮', shi: 6, position_kind: '本宫' },
      { name: '山火贲', upper: '艮', lower: '离', shi: 1, position_kind: '一世' },
      { name: '山天大畜', upper: '艮', lower: '乾', shi: 2, position_kind: '二世' },
      { name: '山泽损', upper: '艮', lower: '兑', shi: 3, position_kind: '三世' },
      { name: '火泽睽', upper: '离', lower: '兑', shi: 4, position_kind: '四世' },
      { name: '天泽履', upper: '乾', lower: '兑', shi: 5, position_kind: '五世' },
      { name: '风泽中孚', upper: '巽', lower: '兑', shi: 4, position_kind: '游魂' },
      { name: '风山渐', upper: '巽', lower: '艮', shi: 3, position_kind: '归魂' },
    ],
  },
  {
    name: '震宫',
    element: '木',
    entries: [
      { name: '震为雷', upper: '震', lower: '震', shi: 6, position_kind: '本宫' },
      { name: '雷地豫', upper: '震', lower: '坤', shi: 1, position_kind: '一世' },
      { name: '雷水解', upper: '震', lower: '坎', shi: 2, position_kind: '二世' },
      { name: '雷风恒', upper: '震', lower: '巽', shi: 3, position_kind: '三世' },
      { name: '地风升', upper: '坤', lower: '巽', shi: 4, position_kind: '四世' },
      { name: '水风井', upper: '坎', lower: '巽', shi: 5, position_kind: '五世' },
      { name: '泽风大过', upper: '兑', lower: '巽', shi: 4, position_kind: '游魂' },
      { name: '泽雷随', upper: '兑', lower: '震', shi: 3, position_kind: '归魂' },
    ],
  },
  {
    name: '巽宫',
    element: '木',
    entries: [
      { name: '巽为风', upper: '巽', lower: '巽', shi: 6, position_kind: '本宫' },
      { name: '风天小畜', upper: '巽', lower: '乾', shi: 1, position_kind: '一世' },
      { name: '风火家人', upper: '巽', lower: '离', shi: 2, position_kind: '二世' },
      { name: '风雷益', upper: '巽', lower: '震', shi: 3, position_kind: '三世' },
      { name: '天雷无妄', upper: '乾', lower: '震', shi: 4, position_kind: '四世' },
      { name: '火雷噬嗑', upper: '离', lower: '震', shi: 5, position_kind: '五世' },
      { name: '山雷颐', upper: '艮', lower: '震', shi: 4, position_kind: '游魂' },
      { name: '山风蛊', upper: '艮', lower: '巽', shi: 3, position_kind: '归魂' },
    ],
  },
  {
    name: '离宫',
    element: '火',
    entries: [
      { name: '离为火', upper: '离', lower: '离', shi: 6, position_kind: '本宫' },
      { name: '火山旅', upper: '离', lower: '艮', shi: 1, position_kind: '一世' },
      { name: '火风鼎', upper: '离', lower: '巽', shi: 2, position_kind: '二世' },
      { name: '火水未济', upper: '离', lower: '坎', shi: 3, position_kind: '三世' },
      { name: '山水蒙', upper: '艮', lower: '坎', shi: 4, position_kind: '四世' },
      { name: '风水涣', upper: '巽', lower: '坎', shi: 5, position_kind: '五世' },
      { name: '天水讼', upper: '乾', lower: '坎', shi: 4, position_kind: '游魂' },
      { name: '天火同人', upper: '乾', lower: '离', shi: 3, position_kind: '归魂' },
    ],
  },
  {
    name: '坤宫',
    element: '土',
    entries: [
      { name: '坤为地', upper: '坤', lower: '坤', shi: 6, position_kind: '本宫' },
      { name: '地雷复', upper: '坤', lower: '震', shi: 1, position_kind: '一世' },
      { name: '地泽临', upper: '坤', lower: '兑', shi: 2, position_kind: '二世' },
      { name: '地天泰', upper: '坤', lower: '乾', shi: 3, position_kind: '三世' },
      { name: '雷天大壮', upper: '震', lower: '乾', shi: 4, position_kind: '四世' },
      { name: '泽天夬', upper: '兑', lower: '乾', shi: 5, position_kind: '五世' },
      { name: '水天需', upper: '坎', lower: '乾', shi: 4, position_kind: '游魂' },
      { name: '水地比', upper: '坎', lower: '坤', shi: 3, position_kind: '归魂' },
    ],
  },
  {
    name: '兑宫',
    element: '金',
    entries: [
      { name: '兑为泽', upper: '兑', lower: '兑', shi: 6, position_kind: '本宫' },
      { name: '泽水困', upper: '兑', lower: '坎', shi: 1, position_kind: '一世' },
      { name: '泽地萃', upper: '兑', lower: '坤', shi: 2, position_kind: '二世' },
      { name: '泽山咸', upper: '兑', lower: '艮', shi: 3, position_kind: '三世' },
      { name: '水山蹇', upper: '坎', lower: '艮', shi: 4, position_kind: '四世' },
      { name: '地山谦', upper: '坤', lower: '艮', shi: 5, position_kind: '五世' },
      { name: '雷山小过', upper: '震', lower: '艮', shi: 4, position_kind: '游魂' },
      { name: '雷泽归妹', upper: '震', lower: '兑', shi: 3, position_kind: '归魂' },
    ],
  },
] as const;
