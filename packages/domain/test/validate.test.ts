/**
 * CI 校验规则测试 —— 每条规则都要能被触发，否则规则只是注释。
 *
 * 依据：docs/V0.1-知识架构.md §14、docs/V0.2.1-架构决定清单.md §4
 */
import { describe, expect, it } from 'vitest';
import { validateBundle } from '../src/validate/rules.js';
import { scanForbiddenPhrases } from '../src/validate/forbidden.js';
import { emptyBundle } from '../src/bundle.js';
import type { TransferEdge } from '../src/layer1/transfer.js';
import type { Provenance, Verification } from '../src/layer0/provenance.js';
import type { Exercise } from '../src/layer3/exercise.js';
import type { ExerciseTemplate } from '../src/layer3/exercise-template.js';
import { fixtureSkill, fixtureSpec, humanProvenance, validBundle, withFormalisms, withSystemsAndSchools } from './fixtures.js';

const ruleIds = (b: Parameters<typeof validateBundle>[0]) => validateBundle(b).errors.map((e) => e.rule);

describe('基线：合法内容集合应当通过', () => {
  it('最小合法集合无 error', () => {
    const report = validateBundle(validBundle());
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

describe('R1 · 来源与审核状态（认识论原则 3）', () => {
  it('R1a：reviewed 但无来源 → 失败', () => {
    const b = validBundle();
    b.schemas = [
      {
        id: 'S1',
        name: '指认',
        operation: '在符号系统中准确指出并命名一个符号',
        covers: [],
        provenance: { ...humanProvenance(false), review_status: 'reviewed' },
      },
    ];
    expect(ruleIds(b)).toContain('R1a');
  });

  it('R1b：ai-candidate 处于 reviewed → 失败（AI 产出永不直接进 reviewed）', () => {
    const b = validBundle();
    b.schemas = [
      {
        id: 'S1',
        name: '指认',
        operation: '在符号系统中准确指出并命名一个符号',
        covers: [],
        provenance: { ...humanProvenance(true), review_status: 'reviewed', authored_by: 'ai-candidate' },
      },
    ];
    expect(ruleIds(b)).toContain('R1b');
  });

  it('R1c：draft 无来源 → 仅警告，不阻塞（否则流水线第一步即死）', () => {
    const b = validBundle();
    b.schemas = [
      { id: 'S1', name: '指认', operation: '指出并命名符号', covers: [], provenance: humanProvenance(false) },
    ];
    const report = validateBundle(b);
    expect(report.warnings.map((w) => w.rule)).toContain('R1c');
    expect(report.ok).toBe(true);
  });
});

describe('R19 · 升级 reviewed 必须有人工复核记录', () => {
  const withSchema = (prov: Record<string, unknown>) => {
    const b = validBundle();
    b.schemas = [
      { id: 'S1', name: '指认', operation: '指出并命名符号', covers: [], provenance: { ...humanProvenance(true), review_status: 'reviewed', ...prov } as never },
    ];
    return b;
  };

  it('reviewed 但没有任何复核记录 → 失败', () => {
    expect(ruleIds(withSchema({ verifications: [] }))).toContain('R19');
  });

  it('只有 AI 的复核记录 → 失败（AI 产出不能独自撑起 reviewed）', () => {
    const b = withSchema({
      verifications: [
        { claim: 'x', source: { ref: 'y' }, checked_by: 'ai-candidate', checked_at: '2026-09-19T00:00:00.000Z', outcome: '证实' },
      ],
    });
    expect(ruleIds(b)).toContain('R19');
  });

  it('人工复核但结论为「无法核实」→ 失败', () => {
    const b = withSchema({
      verifications: [
        { claim: 'x', source: { ref: 'y' }, checked_by: 'human', checked_at: '2026-09-19T00:00:00.000Z', outcome: '无法核实' },
      ],
    });
    expect(ruleIds(b)).toContain('R19');
  });

  it('人工复核且结论为「证实」→ 通过', () => {
    const b = withSchema({
      verifications: [
        { claim: 'x', source: { ref: 'y' }, checked_by: 'human', checked_at: '2026-09-19T00:00:00.000Z', outcome: '证实' },
      ],
    });
    expect(ruleIds(b)).not.toContain('R19');
  });
});

/**
 * R1/R19 的**覆盖范围**必须被测住。
 *
 * 起因：`Exercise` 与 `ExerciseTemplate` 的 schema 里都带 `provenance`（数据里也都有），
 * 但 `validateBundle` 的 layer0Groups 曾经漏了这两组 → R1a/R1b/R1c/R19 对它们完全不生效。
 * 也就是说：**题目可以被标成 `reviewed` 而没有任何人工复核记录，CI 照样通过。**
 * 而题目正是玩家实际作答的对象，是 R19 最该管住的东西。
 *
 * 这类「声明了但没接上」的漏检不会自己报错，只会静默放过 —— 所以必须有测试锁住。
 */
describe('R1/R19 覆盖范围 · 带 provenance 的实体一个都不能漏检', () => {
  /**
   * 已升 reviewed 的 provenance。
   *
   * 注意类型：`Exercise`/`ExerciseTemplate` 用的是 zod 的**输出类型**，
   * 所以带 `.default()` 的字段（`requires_process`、`difficulty`、`choices_mode`…）
   * 在 TS 里是**必填**的 —— 缺了它们 typecheck 会报错（虽然运行时 schema 会补）。
   * 这也是本组测试的价值之一：它顺手证明了「默认值不会让夹具写少字段」。
   */
  const reviewedProv = (over: Partial<Provenance> = {}): Provenance => ({
    ...humanProvenance(true),
    review_status: 'reviewed',
    ...over,
  });

  const aiVerification = (): Verification => ({
    claim: 'x',
    source: { ref: 'y' },
    checked_by: 'ai-candidate',
    checked_at: '2026-09-19T00:00:00.000Z',
    outcome: '证实',
  });

  const humanVerification = (): Verification => ({
    claim: 'x',
    source: { ref: 'y' },
    checked_by: 'human',
    checked_at: '2026-09-19T00:00:00.000Z',
    outcome: '证实',
  });

  /** 一个纯 Rubric 题（无需 answer_key，避免引入规则相关规则干扰本组断言） */
  const fixtureExercise = (over: Partial<Exercise> = {}): Exercise => ({
    id: 'ex.coverage.1',
    kind: '开放式解读',
    prompt: '写出三张牌构成的序列叙事',
    skill_ids: ['skill.t5.1'],
    assessment_spec_id: 'spec.t5.1',
    requires_process: false,
    difficulty: '入门',
    provenance: reviewedProv(),
    ...over,
  });

  const fixtureTemplate = (over: Partial<ExerciseTemplate> = {}): ExerciseTemplate => ({
    id: 'tpl.coverage.1',
    name: '覆盖范围测试模板',
    skill_ids: ['skill.t5.1'],
    kind: '开放式解读',
    assessment_spec_id: 'spec.t5.1',
    rule_id: 'rule.coverage.1',
    parameter_space: { mode: 'bit-combinations', bit_length: 3 },
    prompt_template: '由三爻阴阳定八卦：{yao}',
    answer_field: 'trigram',
    choices_mode: 'none',
    difficulty: '入门',
    requires_process: false,
    max_instances: 8,
    provenance: reviewedProv(),
    ...over,
  });

  it('exercise 处于 reviewed 但无人工复核 → 必须报 R19（此前会静默通过）', () => {
    const b = validBundle();
    b.exercises = [fixtureExercise()];
    expect(ruleIds(b)).toContain('R19');
  });

  it('exercise 处于 reviewed 但只有 AI 复核 → 必须报 R19', () => {
    const b = validBundle();
    b.exercises = [fixtureExercise({ provenance: reviewedProv({ verifications: [aiVerification()] }) })];
    expect(ruleIds(b)).toContain('R19');
  });

  it('exercise 有「人工 + 证实」→ 不报 R19', () => {
    const b = validBundle();
    b.exercises = [fixtureExercise({ provenance: reviewedProv({ verifications: [humanVerification()] }) })];
    expect(ruleIds(b)).not.toContain('R19');
  });

  it('exercise_template 处于 reviewed 但无人工复核 → 必须报 R19（此前会静默通过）', () => {
    const b = validBundle();
    b.exercise_templates = [fixtureTemplate()];
    expect(ruleIds(b)).toContain('R19');
  });

  it('exercise_template 有「人工 + 部分证实」→ 不报 R19', () => {
    const b = validBundle();
    b.exercise_templates = [
      fixtureTemplate({
        provenance: reviewedProv({
          verifications: [{ ...humanVerification(), outcome: '部分证实' }],
        }),
      }),
    ];
    expect(ruleIds(b)).not.toContain('R19');
  });

  it('exercise 处于 reviewed 但来源为空 → 必须报 R1a', () => {
    const b = validBundle();
    b.exercises = [
      fixtureExercise({ provenance: reviewedProv({ sources: [], verifications: [humanVerification()] }) }),
    ];
    expect(ruleIds(b)).toContain('R1a');
  });

  it('exercise 处于 reviewed 且 authored_by = ai-candidate → 必须报 R1b', () => {
    const b = validBundle();
    b.exercises = [
      fixtureExercise({
        provenance: reviewedProv({ authored_by: 'ai-candidate', verifications: [humanVerification()] }),
      }),
    ];
    expect(ruleIds(b)).toContain('R1b');
  });

  it('exercise 处于 draft 且无来源 → 只警告 R1c，不阻塞（草稿阶段必须能存在）', () => {
    const b = validBundle();
    b.exercises = [
      fixtureExercise({ provenance: { ...humanProvenance(false), review_status: 'draft' } }),
    ];
    const report = validateBundle(b);
    expect(report.warnings.map((w) => w.rule)).toContain('R1c');
    expect(report.ok).toBe(true);
  });
});

describe('R2 · 类型 3 必须声明 historicity（V0.1 §5.2.1）', () => {
  const edge = (over: Partial<TransferEdge>): TransferEdge => ({
    id: 'edge.1',
    from_node_id: 'sym.wuxing.木',
    to_node_id: 'sym.wuxing.火',
    transfer_type: 3,
    source_strength: '中',
    sources: [{ ref: '测试来源' }],
    analogy_label_present: false,
    ...over,
  });

  it('类型 3 缺 historicity → 失败', () => {
    const b = validBundle();
    b.transfer_edges = [edge({})];
    expect(ruleIds(b)).toContain('R2');
  });

  it('类型 4 携带 historicity → 失败（historicity 只属于类型 3）', () => {
    const b = validBundle();
    b.transfer_edges = [edge({ transfer_type: 4, historicity: '重建', analogy_label_present: true })];
    expect(ruleIds(b)).toContain('R2');
  });
});

describe('R3 · 反向练习（ADR-0007 + ADR-0014）', () => {
  it('类型 4 缺配对反向练习 → 失败', () => {
    const b = validBundle();
    b.transfer_edges = [
      {
        id: 'edge.type4',
        from_node_id: 'sym.wuxing.木',
        to_node_id: 'sym.wuxing.火',
        transfer_type: 4,
        source_strength: '低',
        sources: [{ ref: '教学类比' }],
        analogy_label_present: true,
      },
    ];
    expect(ruleIds(b)).toContain('R3');
  });

  it('类型 3 且 historicity = 重建 缺反向练习 → 失败（ADR-0014 的 MVP 节点即此类）', () => {
    const b = validBundle();
    b.transfer_edges = [
      {
        id: 'edge.rebuild',
        from_node_id: 'sym.wuxing.木',
        to_node_id: 'sym.wuxing.火',
        transfer_type: 3,
        historicity: '重建',
        source_strength: '中',
        sources: [{ ref: 'Lévi 1856 → Golden Dawn Book T 1888' }],
        analogy_label_present: true,
      },
    ];
    expect(ruleIds(b)).toContain('R3');
  });

  it('类型 3 且 historicity = 传播 不要求反向练习', () => {
    const b = validBundle();
    b.transfer_edges = [
      {
        id: 'edge.spread',
        from_node_id: 'sym.wuxing.木',
        to_node_id: 'sym.wuxing.火',
        transfer_type: 3,
        historicity: '传播',
        source_strength: '高',
        sources: [{ ref: '《宿曜经》8 世纪不空译' }],
        analogy_label_present: true,
      },
    ];
    expect(ruleIds(b)).not.toContain('R3');
  });
});

describe('R4 · 类比必须可见（认识论原则 5）', () => {
  it('类型 4 缺「类比」标注 → 失败', () => {
    const b = validBundle();
    b.transfer_edges = [
      {
        id: 'edge.no-label',
        from_node_id: 'sym.wuxing.木',
        to_node_id: 'sym.wuxing.火',
        transfer_type: 4,
        source_strength: '低',
        sources: [{ ref: '教学类比' }],
        paired_reverse_exercise_id: 'ex.reverse.1',
        analogy_label_present: false,
      },
    ];
    expect(ruleIds(b)).toContain('R4');
  });

  it('类型 5 修辞比喻 → 一律失败（不进教学内容）', () => {
    const b = validBundle();
    b.transfer_edges = [
      {
        id: 'edge.metaphor',
        from_node_id: 'sym.wuxing.木',
        to_node_id: 'sym.wuxing.火',
        transfer_type: 5,
        source_strength: '低',
        sources: [{ ref: '语言层相似' }],
        analogy_label_present: true,
      },
    ];
    expect(ruleIds(b)).toContain('R4');
  });
});

describe('R5 / R6 · 判分绑定挂在 Layer 3（ADR-0015⑤ / M16）', () => {
  it('R5：规则判定但没有规约绑定 Rule → 失败', () => {
    const b = validBundle();
    b.skills = [fixtureSkill({ id: 'skill.l6.1', kind: '推导', judging_mode: '规则判定' })];
    b.assessment_specs = [];
    expect(ruleIds(b)).toContain('R5');
  });

  it('R6：Rubric 判分但没有规约绑定 Rubric → 失败', () => {
    const b = validBundle();
    b.assessment_specs = [fixtureSpec({ rubric_id: undefined })];
    expect(ruleIds(b)).toContain('R6');
  });

  it('M16 的正面收益：同一 Skill 可以有第二个规约（流派对比课）', () => {
    const b = validBundle();
    b.assessment_specs = [
      fixtureSpec({ id: 'spec.t5.1.intro', name: '入门规约' }),
      fixtureSpec({ id: 'spec.t5.1.compare', name: 'B2 流派对比规约', is_school_comparison: true }),
    ];
    expect(validateBundle(b).errors).toEqual([]);
  });
});

describe('R7 · default_school 必须绑可引证文献（ADR-0012）', () => {
  it('默认流派 anchor_sources 为空 → 失败', () => {
    const b = validBundle();
    const s = b.schools[0];
    if (!s) throw new Error('夹具缺少 school');
    s.anchor_sources = [];
    expect(ruleIds(b)).toContain('R7');
  });

  it('default_school_id 指向不存在的 School → 失败', () => {
    const b = validBundle();
    const sys = b.systems[0];
    if (!sys) throw new Error('夹具缺少 system');
    sys.default_school_id = 'school.不存在';
    expect(ruleIds(b)).toContain('R7');
  });
});

describe('R8 · 同一 Formalism 内不得人工建边（ADR-0011）', () => {
  it('两端同属 east-xiangshu 的 transfers_as 边 → 失败（应为派生投影）', () => {
    const b = validBundle();
    b.transfer_edges = [
      {
        id: 'edge.same-formalism',
        from_node_id: 'sym.wuxing.木',
        to_node_id: 'sym.wuxing.火',
        transfer_type: 3,
        historicity: '传播',
        source_strength: '高',
        sources: [{ ref: '不应存在：机制 A 可自动推导' }],
        analogy_label_present: true,
      },
    ];
    expect(ruleIds(b)).toContain('R8');
  });

  it('跨 Formalism 的边不被 R8 拦（塔罗 ↔ 占星属此类）', () => {
    let b = emptyBundle();
    b = withFormalisms(b);
    b = withSystemsAndSchools(b);
    b.symbols = [
      {
        id: 'sym.planet.mars',
        formalism_id: 'planetary-zodiac',
        canonical_name: '火星',
        aliases: [],
        symbol_kind: 'native',
        provenance: humanProvenance(),
      },
      {
        id: 'sym.tarot.tower',
        formalism_id: 'tarot-symbolic',
        canonical_name: '高塔',
        aliases: [],
        symbol_kind: 'native',
        provenance: humanProvenance(),
      },
    ];
    b.transfer_edges = [
      {
        id: 'edge.tarot-astro',
        from_node_id: 'sym.tarot.tower',
        to_node_id: 'sym.planet.mars',
        transfer_type: 3,
        historicity: '重建',
        source_strength: '中',
        sources: [{ ref: 'Golden Dawn Book T（1888）', confidence: '中–高' }],
        analogy_label_present: true,
        paired_reverse_exercise_id: 'ex.reverse.rws-thoth-8-11',
      },
    ];
    expect(ruleIds(b)).not.toContain('R8');
  });
});

describe('R9 · 禁用语检查（V0.1 §14）', () => {
  it('五行 = 四元素 的未标注等价断言被拦', () => {
    const hits = scanForbiddenPhrases([
      { id: 't1', owner_id: 'lesson.1', text: '五行就是四元素，本质相同。' },
    ]);
    expect(hits.map((x) => x.pattern_id)).toContain('FORBIDDEN-EQUIVALENCE-WUXING-ELEMENTS');
  });

  it('序数式地支＝星座被拦', () => {
    const hits = scanForbiddenPhrases([{ id: 't2', owner_id: 'lesson.1', text: '子宫就是白羊座。' }]);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('逆位＝阴阳 被拦', () => {
    const hits = scanForbiddenPhrases([{ id: 't3', owner_id: 'lesson.2', text: '逆位就是阴。' }]);
    expect(hits.map((x) => x.pattern_id)).toContain('FORBIDDEN-REVERSAL-YINYANG');
  });

  it('确定性话术被拦', () => {
    const hits = scanForbiddenPhrases([{ id: 't4', owner_id: 'lesson.3', text: '这段感情一定会成。' }]);
    expect(hits.map((x) => x.pattern_id)).toContain('FORBIDDEN-CERTAINTY-TALK');
  });

  it('正确的历史比较课文案不被拦（假阳性检查）', () => {
    const hits = scanForbiddenPhrases([
      {
        id: 't5',
        owner_id: 'lesson.history',
        text: '明末《乾坤体义》传入了亚里士多德的四元行；它与五行是两套不同的分类逻辑，不构成理论等价。',
      },
    ]);
    expect(hits).toEqual([]);
  });
});

describe('R10 · 引用完整性', () => {
  it('symbol_usage 引用不存在的 symbol → 失败', () => {
    const b = validBundle();
    b.symbol_usages = [{ symbol_id: 'sym.不存在', system_id: 'system.liuyao', role: '卦宫五行' }];
    expect(ruleIds(b)).toContain('R10');
  });

  it('assessment_spec 引用不存在的 rubric → 失败', () => {
    const b = validBundle();
    b.assessment_specs = [fixtureSpec({ rubric_id: 'rubric.不存在' })];
    expect(ruleIds(b)).toContain('R10');
  });
});

describe('R11 · 属性空间取值必须是 Symbol（ADR-0010）', () => {
  it('取值不是 Symbol → 失败', () => {
    const b = validBundle();
    const sp = b.attribute_spaces[0];
    if (!sp) throw new Error('夹具缺少 attribute_space');
    sp.value_symbol_ids = ['五行.木（字符串，不是 Symbol）'];
    expect(ruleIds(b)).toContain('R11');
  });

  it('取值 symbol_kind 不是 attribute_value → 失败', () => {
    const b = validBundle();
    const sym = b.symbols[0];
    if (!sym) throw new Error('夹具缺少 symbol');
    sym.symbol_kind = 'native';
    expect(ruleIds(b)).toContain('R11');
  });
});
