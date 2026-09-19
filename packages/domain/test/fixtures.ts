/**
 * 测试夹具：构造最小可用的内容集合
 *
 * ⚠️ 这里的数据是**测试夹具**，不是内容库内容。它刻意保持最小，
 * 只用于让 CI 校验规则可被触发与验证。真实内容在 ADR-0008 step 2 手写。
 */
import type { ContentBundle } from '../src/bundle.js';
import { emptyBundle } from '../src/bundle.js';
import type { School } from '../src/layer1/system.js';
import type { Symbol } from '../src/layer1/symbol.js';
import type { Skill } from '../src/layer2/skill.js';
import type { Rubric } from '../src/layer3/rubric.js';
import type { AssessmentSpec } from '../src/layer3/assessment.js';

export const humanProvenance = (sources = true) => ({
  sources: sources
    ? [{ ref: '《卜筮正宗》', author: '清·王洪绪／王维德', confidence: '中–高' as const }]
    : [],
  /**
   * 注意取值域是 高/中/低 三档（V0 术语表 §4）。
   * R1 报告里出现的「中–高」「低–中」是**文献置信度**的细分口径，
   * 只出现在 `SourceRef.confidence` 上，不进入 `source_strength`。
   */
  source_strength: '中' as const,
  controversy_flag: false,
  review_status: 'draft' as const,
  authored_by: 'human' as const,
  version: 1,
});

/** 夹具用的 4 个 Formalism */
export function withFormalisms(b: ContentBundle): ContentBundle {
  b.formalism = [
    {
      id: 'east-xiangshu',
      name: '东方象数形式系统',
      description: '阴阳 · 五行 · 天干地支 · 八卦；符号间可互相定义',
      symbol_scope: ['阴阳', '五行', '天干地支', '八卦'],
      provenance: humanProvenance(),
    },
    {
      id: 'greek-four-elements',
      name: '希腊四元素形式系统',
      description: '火 · 气 · 水 · 土；塔罗与占星共同引用 → 机制 A 共享',
      symbol_scope: ['火', '气', '水', '土'],
      provenance: humanProvenance(),
    },
    {
      id: 'planetary-zodiac',
      name: '行星黄道形式系统',
      description: '行星 · 星座 · 宫位',
      symbol_scope: ['行星', '星座', '宫位'],
      provenance: humanProvenance(),
    },
    {
      id: 'tarot-symbolic',
      name: '塔罗象征系统',
      description: '22 大牌序列 · 四花色 · 牌义',
      symbol_scope: ['大阿卡纳', '四花色', '牌义'],
      provenance: humanProvenance(),
    },
  ];
  return b;
}

/** 夹具：两个体系、两个流派 */
export function withSystemsAndSchools(b: ContentBundle): ContentBundle {
  const defaultSchool: School = {
    id: 'school.liuyao.zengshan',
    system_id: 'system.liuyao',
    name: '《增删卜易》一路取法',
    stance: '以用神为核心，重旺衰',
    anchor_sources: [{ ref: '《增删卜易》', author: '清·野鹤老人（李文辉编校刊行）', confidence: '中–高' }],
    is_default_of_system: true,
    provenance: humanProvenance(),
  };
  b.schools = [defaultSchool];
  b.systems = [
    {
      id: 'system.liuyao',
      name: '六爻',
      default_school_id: 'school.liuyao.zengshan',
      formalism_ids: ['east-xiangshu'],
      provenance: humanProvenance(),
    },
    {
      id: 'system.tarot',
      name: '塔罗',
      default_school_id: 'school.liuyao.zengshan', // 夹具简化：复用同一 School
      formalism_ids: ['tarot-symbolic', 'greek-four-elements'],
      provenance: humanProvenance(),
    },
  ];
  return b;
}

/** 夹具：五行属性空间 + 取值符号（ADR-0010 的形状） */
export function withAttributeSpace(b: ContentBundle): ContentBundle {
  const values = ['木', '火', '土', '金', '水'] as const;
  b.attribute_spaces = [
    {
      id: 'space.wuxing',
      formalism_id: 'east-xiangshu',
      name: '五行',
      value_symbol_ids: values.map((v) => `sym.wuxing.${v}`),
      provenance: humanProvenance(),
    },
  ];
  b.symbols = values.map(
    (v): Symbol => ({
      id: `sym.wuxing.${v}`,
      formalism_id: 'east-xiangshu',
      canonical_name: v,
      aliases: [],
      symbol_kind: 'attribute_value',
      attribute_space_id: 'space.wuxing',
      provenance: humanProvenance(),
    }),
  );
  return b;
}

export const fixtureRubric = (): Rubric => ({
  id: 'rubric.t5.1',
  name: 'T5.1 三牌叙事',
  must_hit: ['三张牌核心象征正确', '说明牌与牌之间的序列关系（非并列）', '给出有方向的整体解读'],
  should_hit: ['区分"牌面所示"与"我的推测"'],
  forbidden: ['逐牌翻译关键词后不作整合', '断言具体事件', '把逆位当阴阳', '体系外推理'],
  school_variance: '是否使用固定位置含义',
  process_rules: ['声明所用牌阵与位置定义'],
  is_school_comparison: false,
  feedback_template: {
    recognized: '已识别',
    missing: '缺失',
    tendency_error: '倾向性错误',
    correction: '具体修正',
    next_step: '下一步',
    not_evaluated: '不做评价',
  },
  provenance: humanProvenance(),
});

export const fixtureSkill = (over: Partial<Skill> = {}): Skill => ({
  id: 'skill.t5.1',
  statement: '能写出三张牌构成的序列叙事，含各牌核心象征、牌间序列关系、有方向的整体解读',
  kind: '生成',
  judging_mode: 'Rubric+AI',
  schema_ids: ['S6', 'S8'],
  confusable_with_skill_ids: [],
  provenance: humanProvenance(),
  ...over,
});

export const fixtureSpec = (over: Partial<AssessmentSpec> = {}): AssessmentSpec => ({
  id: 'spec.t5.1',
  name: 'T5.1 入门规约',
  skill_ids: ['skill.t5.1'],
  rubric_id: 'rubric.t5.1',
  rule_ids: [],
  is_school_comparison: false,
  provenance: humanProvenance(),
  ...over,
});

/** 一个「全部合法」的最小内容集合 */
export function validBundle(): ContentBundle {
  let b = emptyBundle();
  b = withFormalisms(b);
  b = withSystemsAndSchools(b);
  b = withAttributeSpace(b);
  b.rubrics = [fixtureRubric()];
  b.skills = [fixtureSkill()];
  b.assessment_specs = [fixtureSpec()];
  return b;
}
