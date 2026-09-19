/**
 * CI 校验 · 禁用语检查
 *
 * 依据：V0.1 §14 末、V0 认识论原则 4/5/6、V0 伦理边界 §四.4
 *
 * 这是"认识论诚实"落成代码的地方：命中即**构建失败**，不是警告。
 */

export interface ForbiddenPattern {
  id: string;
  /** 用于扫描的正则（不要加 g 标志，避免 lastIndex 状态） */
  pattern: RegExp;
  /** 为什么禁止 */
  reason: string;
  /** 依据 */
  basis: string;
}

export const FORBIDDEN_PATTERNS: readonly ForbiddenPattern[] = [
  {
    id: 'FORBIDDEN-EQUIVALENCE-WUXING-ELEMENTS',
    // 未标注的等价断言：五行 等于/就是/= 四元素
    pattern: /五行[\s\S]{0,6}(等于|就是|即|=|等同于)[\s\S]{0,6}四元素/,
    reason: '把「五行 ↔ 四元素」写成理论等价 —— R1 已确认无传播证据且结构不同（五行为功能关系与生克闭环，四元素为质料构成）',
    basis: 'V0.1 §5.4；V0.2 §5.9（禁止"理论等价"成立，但可另设明末四元行传入的历史比较课）',
  },
  {
    id: 'FORBIDDEN-EQUIVALENCE-ELEMENTS-WUXING',
    pattern: /四元素[\s\S]{0,6}(等于|就是|即|=|等同于)[\s\S]{0,6}五行/,
    reason: '同上，反向表述',
    basis: 'V0.1 §5.4；V0.2 §5.9',
  },
  {
    id: 'FORBIDDEN-ZODIAC-ORDINAL',
    // 12 地支按序数等同 12 星座（子＝白羊 之类）
    pattern: /(子|丑|寅|卯|辰|巳|午|未|申|酉|戌|亥)[\s\S]{0,4}(＝|=|就是|等于)[\s\S]{0,4}(白羊|金牛|双子|巨蟹|狮子|处女|天秤|天蝎|射手|摩羯|水瓶|双鱼)/,
    reason: '序数式等同无依据（数字相同不构成对应）。注意：星命术以地支作宫名是**非序数**的真实传统用法，可教（《张果星宗》「子宫：水清宝瓶」）',
    basis: 'V0.1 §5.4 + V0.2 §5.9 的两条拆分',
  },
  {
    id: 'FORBIDDEN-REVERSAL-YINYANG',
    pattern: /逆位[\s\S]{0,6}(就是|=|等于|相当于)[\s\S]{0,6}(阴|阴阳)/,
    reason: '形似神异：逆位是解读约定/程度变化，与阴阳的互补生成逻辑无关',
    basis: 'V0.1 §5.4；V0.2 §3.1（T3.2 预设易混淆对「逆位↔阴阳」）',
  },
  {
    id: 'FORBIDDEN-CERTAINTY-TALK',
    pattern: /(一定|必然|百分百|100%|必定)[\s\S]{0,8}(会|发生|应验|成|败)/,
    reason: '确定性话术。产品不承诺、不呈现、不暗示预测准确率；教用户对他人说"一定会发生"是产品在制造伤害',
    basis: 'V0 认识论原则 6、伦理边界 §四.4；ADR-0004',
  },
  {
    id: 'FORBIDDEN-ACCURACY-CLAIM',
    pattern: /(准确率|命中率)[\s\S]{0,6}(达|高达|超过|≥|>=)[\s\S]{0,4}\d/,
    reason: '以"预测准确率"作为卖点或指标',
    basis: 'V0 非目标清单 · 考核',
  },
] as const;

export interface ForbiddenHit {
  text_id: string;
  owner_id: string;
  pattern_id: string;
  reason: string;
  basis: string;
  excerpt: string;
}

/** 扫描一批内容文本，返回所有命中 */
export function scanForbiddenPhrases(
  texts: readonly { id: string; owner_id: string; text: string }[],
): ForbiddenHit[] {
  const hits: ForbiddenHit[] = [];
  for (const t of texts) {
    for (const p of FORBIDDEN_PATTERNS) {
      const m = p.pattern.exec(t.text);
      if (m) {
        const start = Math.max(0, m.index - 12);
        hits.push({
          text_id: t.id,
          owner_id: t.owner_id,
          pattern_id: p.id,
          reason: p.reason,
          basis: p.basis,
          excerpt: t.text.slice(start, m.index + m[0].length + 12),
        });
      }
    }
  }
  return hits;
}
