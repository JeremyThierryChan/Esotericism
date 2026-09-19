/**
 * ADR-0016 新增规则的触发测试：R3 加强 / R12 / R13 / R14
 *
 * 原则：**每条规则都必须能被触发，否则规则只是注释。**
 */
import { describe, expect, it } from 'vitest';
import { validateBundle } from '../src/validate/rules.js';
import type { ContentBundle } from '../src/bundle.js';
import type { Exercise } from '../src/layer3/exercise.js';
import type { Rule } from '../src/layer1/rule.js';
import type { TransferEdge } from '../src/layer1/transfer.js';
import { fixtureSkill, fixtureSpec, humanProvenance, validBundle } from './fixtures.js';

const ruleIds = (b: ContentBundle) => validateBundle(b).errors.map((e) => e.rule);

/** 一块规则判分的拼装：Rule + 规则判定 Skill + 绑定该 Rule 的规约 */
function withRuleJudgedSkill(b: ContentBundle): ContentBundle {
  const rule: Rule = {
    id: 'rule.test.shengke',
    system_id: 'system.liuyao',
    school_id: 'school.liuyao.zengshan',
    name: '测试规则',
    procedure_ref: 'test#fn',
    applies_to_symbol_ids: [],
    provenance: humanProvenance(),
  };
  b.rules = [rule];
  b.skills = [...b.skills, fixtureSkill({ id: 'skill.rule-judged', kind: '推导', judging_mode: '规则判定', schema_ids: ['S4'] })];
  b.assessment_specs = [
    ...b.assessment_specs,
    fixtureSpec({ id: 'spec.rule-judged', skill_ids: ['skill.rule-judged'], rubric_id: undefined, rule_ids: [rule.id] }),
  ];
  return b;
}

/** 一块 Rubric 判分的拼装（validBundle 里已有 skill.t5.1 / rubric.t5.1 / spec.t5.1） */
function rubJudgedBundle(): ContentBundle {
  return validBundle();
}

function withExercise(b: ContentBundle, ex: Partial<Exercise> & { id: string }): ContentBundle {
  b.exercises = [...b.exercises, { ...(ex as Exercise) }];
  return b;
}

/**
 * 跨 Formalism 的两个符号。
 * 类型 3 边必须跨 Formalism —— 同 Formalism 内建边会被 R8 拦（那是另一条规则，不该混进这些断言）。
 */
function withCrossFormalismSymbols(b: ContentBundle): ContentBundle {
  b.symbols = [
    ...b.symbols,
    {
      id: 'sym.tarot.strength',
      formalism_id: 'tarot-symbolic',
      canonical_name: '力量',
      aliases: [],
      symbol_kind: 'native',
      provenance: humanProvenance(),
    },
    {
      id: 'sym.zodiac.leo',
      formalism_id: 'planetary-zodiac',
      canonical_name: '狮子座',
      aliases: [],
      symbol_kind: 'native',
      provenance: humanProvenance(),
    },
  ];
  return b;
}

describe('R12 · 题型 ↔ 判分方式必须一致', () => {
  it('「开放式解读」配「规则判定」Skill → 失败（AI 判分与规则判定不可互换）', () => {
    let b = withRuleJudgedSkill(validBundle());
    b = withExercise(b, {
      id: 'ex.bad-kind',
      kind: '开放式解读',
      prompt: '写一段解读',
      skill_ids: ['skill.rule-judged'],
      assessment_spec_id: 'spec.rule-judged',
      answer_key: { rule_id: 'rule.test.shengke', input: {}, expected: {} },
      requires_process: false,
      difficulty: '入门',
      provenance: humanProvenance(),
    });
    expect(ruleIds(b)).toContain('R12');
  });

  it('「关系判断」配「Rubric+AI」Skill → 失败（V0.1 §10.2：关系判断必须由规则引擎判定）', () => {
    let b = rubJudgedBundle();
    b = withExercise(b, {
      id: 'ex.bad-kind-2',
      kind: '关系判断',
      prompt: '判断两牌关系',
      skill_ids: ['skill.t5.1'],
      assessment_spec_id: 'spec.t5.1',
      requires_process: false,
      difficulty: '入门',
      provenance: humanProvenance(),
    });
    expect(ruleIds(b)).toContain('R12');
  });

  it('assessment_spec_id 不存在 → 失败', () => {
    let b = rubJudgedBundle();
    b = withExercise(b, {
      id: 'ex.no-spec',
      kind: '开放式解读',
      prompt: '写一段解读',
      skill_ids: ['skill.t5.1'],
      assessment_spec_id: 'spec.不存在',
      requires_process: false,
      difficulty: '入门',
      provenance: humanProvenance(),
    });
    expect(ruleIds(b)).toContain('R12');
  });

  it('测的 Skill 不在所用规约的 skill_ids 内 → 失败', () => {
    let b = withRuleJudgedSkill(validBundle());
    b = withExercise(b, {
      id: 'ex.skill-not-in-spec',
      kind: '关系判断',
      prompt: '判断生克',
      skill_ids: ['skill.rule-judged'],
      assessment_spec_id: 'spec.t5.1', // 这份规约只覆盖 skill.t5.1
      answer_key: { rule_id: 'rule.test.shengke', input: {}, expected: {} },
      requires_process: false,
      difficulty: '入门',
      provenance: humanProvenance(),
    });
    expect(ruleIds(b)).toContain('R12');
  });

  it('题型与判分方式匹配时通过', () => {
    let b = withRuleJudgedSkill(validBundle());
    b = withExercise(b, {
      id: 'ex.good',
      kind: '关系判断',
      prompt: '判断生克',
      skill_ids: ['skill.rule-judged'],
      assessment_spec_id: 'spec.rule-judged',
      answer_key: { rule_id: 'rule.test.shengke', input: { a: '木', b: '火' }, expected: { relation: '生' } },
      requires_process: true,
      difficulty: '入门',
      provenance: humanProvenance(),
    });
    expect(validateBundle(b).errors).toEqual([]);
  });
});

describe('R13 · 含规则判分的题必须有答案键', () => {
  it('规则判定 Skill 的题缺 answer_key → 失败', () => {
    let b = withRuleJudgedSkill(validBundle());
    b = withExercise(b, {
      id: 'ex.no-key',
      kind: '关系判断',
      prompt: '判断生克',
      skill_ids: ['skill.rule-judged'],
      assessment_spec_id: 'spec.rule-judged',
      requires_process: false,
      difficulty: '入门',
      provenance: humanProvenance(),
    });
    expect(ruleIds(b)).toContain('R13');
  });

  it('answer_key.rule_id 不存在 → 失败', () => {
    let b = withRuleJudgedSkill(validBundle());
    b = withExercise(b, {
      id: 'ex.bad-rule-ref',
      kind: '关系判断',
      prompt: '判断生克',
      skill_ids: ['skill.rule-judged'],
      assessment_spec_id: 'spec.rule-judged',
      answer_key: { rule_id: 'rule.不存在', input: {}, expected: {} },
      requires_process: false,
      difficulty: '入门',
      provenance: humanProvenance(),
    });
    expect(ruleIds(b)).toContain('R13');
  });

  it('纯 Rubric 题不需要 answer_key', () => {
    let b = rubJudgedBundle();
    b = withExercise(b, {
      id: 'ex.rubric-only',
      kind: '开放式解读',
      prompt: '写一段解读',
      skill_ids: ['skill.t5.1'],
      assessment_spec_id: 'spec.t5.1',
      requires_process: true,
      difficulty: '入门',
      provenance: humanProvenance(),
    });
    expect(validateBundle(b).errors).toEqual([]);
  });
});

describe('R3 加强 · 反向练习必须真实存在且双向确认', () => {
  const rebuildEdge = (over: Partial<TransferEdge> = {}): TransferEdge => ({
    id: 'edge.rebuild',
    from_node_id: 'sym.tarot.strength',
    to_node_id: 'sym.zodiac.leo',
    transfer_type: 3,
    historicity: '重建',
    source_strength: '中',
    sources: [{ ref: 'Lévi 1856 → Golden Dawn Book T 1888' }],
    analogy_label_present: false,
    four_part_structure: {
      known: '已知',
      in_new_system: '新体系中',
      relation_declaration: '类型 3，historicity = 重建',
      transfer_exercise_id: 'ex.transfer',
    },
    ...over,
  });

  it('paired_reverse_exercise_id 悬空（指向不存在的 Exercise）→ 失败', () => {
    const b = withCrossFormalismSymbols(validBundle());
    b.transfer_edges = [rebuildEdge({ paired_reverse_exercise_id: 'ex.根本不存在' })];
    expect(ruleIds(b)).toContain('R3');
  });

  it('配对的反练习没有指回这条边 → 失败（防止一条练习冒充多条边的反练习）', () => {
    const b = withCrossFormalismSymbols(validBundle());
    b.exercises = [
      {
        id: 'ex.transfer',
        kind: '开放式解读',
        prompt: '迁移练习',
        skill_ids: ['skill.t5.1'],
        assessment_spec_id: 'spec.t5.1',
        requires_process: false,
        difficulty: '进阶',
        provenance: humanProvenance(),
      },
      {
        id: 'ex.reverse',
        kind: '开放式解读',
        prompt: '反向练习',
        skill_ids: ['skill.t5.1'],
        assessment_spec_id: 'spec.t5.1',
        requires_process: false,
        difficulty: '进阶',
        is_reverse_exercise_of_edge_id: 'edge.别的边',
        provenance: humanProvenance(),
      },
    ];
    b.transfer_edges = [rebuildEdge({ paired_reverse_exercise_id: 'ex.reverse' })];
    expect(ruleIds(b)).toContain('R3');
  });

  it('双向确认齐全时通过', () => {
    const b = withCrossFormalismSymbols(validBundle());
    b.exercises = [
      {
        id: 'ex.transfer',
        kind: '开放式解读',
        prompt: '迁移练习',
        skill_ids: ['skill.t5.1'],
        assessment_spec_id: 'spec.t5.1',
        requires_process: false,
        difficulty: '进阶',
        provenance: humanProvenance(),
      },
      {
        id: 'ex.reverse',
        kind: '开放式解读',
        prompt: '反向练习',
        skill_ids: ['skill.t5.1'],
        assessment_spec_id: 'spec.t5.1',
        requires_process: false,
        difficulty: '进阶',
        is_reverse_exercise_of_edge_id: 'edge.rebuild',
        provenance: humanProvenance(),
      },
    ];
    b.transfer_edges = [rebuildEdge({ paired_reverse_exercise_id: 'ex.reverse' })];
    expect(validateBundle(b).errors).toEqual([]);
  });
});

describe('R14 · 跨体系四段式（V0.1 §8.2：缺一不可）', () => {
  it('类型 4 的边缺四段式结构 → 失败', () => {
    const b = validBundle();
    b.transfer_edges = [
      {
        id: 'edge.type4-no-structure',
        from_node_id: 'sym.wuxing.木',
        to_node_id: 'sym.wuxing.火',
        transfer_type: 4,
        source_strength: '低',
        sources: [{ ref: '教学类比' }],
        analogy_label_present: true,
        paired_reverse_exercise_id: 'ex.r',
      },
    ];
    expect(ruleIds(b)).toContain('R14');
  });

  it('四段式第 ④ 段的 transfer_exercise_id 悬空 → 失败', () => {
    const b = withCrossFormalismSymbols(validBundle());
    b.transfer_edges = [
      {
        id: 'edge.dangling',
        from_node_id: 'sym.wuxing.木',
        to_node_id: 'sym.wuxing.火',
        transfer_type: 3,
        historicity: '传播',
        source_strength: '高',
        sources: [{ ref: '《宿曜经》' }],
        analogy_label_present: false,
        four_part_structure: {
          known: '已知',
          in_new_system: '新体系中',
          relation_declaration: '类型 3，historicity = 传播',
          transfer_exercise_id: 'ex.不存在',
        },
      },
    ];
    expect(ruleIds(b)).toContain('R14');
  });
});

describe('ADR-0016 · Exercise 补齐后 R3 不再是死规则', () => {
  it('step 1 时 R3 只能检查「有没有填」，现在能检查「填的东西是否真实」', () => {
    const b = validBundle();
    // 只填一个字符串就能过 = step 1 的状态；现在必须真实存在 + 双向确认
    b.transfer_edges = [
      {
        id: 'edge.fake',
        from_node_id: 'sym.wuxing.木',
        to_node_id: 'sym.wuxing.火',
        transfer_type: 4,
        source_strength: '低',
        sources: [{ ref: '类比' }],
        analogy_label_present: true,
        paired_reverse_exercise_id: 'ex.任意字符串',
        four_part_structure: {
          known: '已知',
          in_new_system: '新体系中',
          relation_declaration: '教学类比',
          transfer_exercise_id: 'ex.另一个任意字符串',
        },
      },
    ];
    const rules = ruleIds(b);
    expect(rules).toContain('R3');
    expect(rules).toContain('R14');
  });
});
