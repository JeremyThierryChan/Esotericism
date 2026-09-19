/**
 * CI 校验规则（step 1 的验收标准）
 *
 * 依据：docs/V0.1-知识架构.md §14 的 9 条规则、docs/V0.2.1-架构决定清单.md §4
 *
 * 设计取舍（**需要人类复核的一处细化**）：
 *   规则 R1 在 V0.2.1 里写成「`sources[]` 为空 → 构建失败」。但 V0.1 §14 的元数据注释
 *   写的是「空数组 = **禁止进入 reviewed**」，而流水线 ① 明确允许 AI/人工起草产出
 *   `draft`。若按字面执行 R1，则**草稿阶段就无法存在**，流水线第一步即死。
 *   因此本实现拆成三条：
 *     R1a `review_status === 'reviewed'` 且 `sources` 为空        → **error**（无来源不入库）
 *     R1b `authored_by === 'ai-candidate'` 且 `review_status === 'reviewed'` → **error**（认识论原则 3）
 *     R1c `draft` 且 `sources` 为空                              → **warning**（可存在，但不可升级）
 *   这与流水线的实际意图一致，但**改动了 V0.2.1 的字面表述**，已记入 step 1 报告待确认。
 */
import type { ContentBundle } from '../bundle.js';
import { isSameFormalismEdge } from '../derive.js';
import {
  HYBRID_JUDGING_MODES,
  RUBRIC_JUDGING_MODES,
  RULE_JUDGING_MODES,
  type Skill,
} from '../layer2/skill.js';
import { specsProvidingRubric, specsProvidingRules } from '../layer3/assessment.js';
import { KIND_ALLOWED_JUDGING_MODES } from '../layer3/exercise.js';
import { scanForbiddenPhrases } from './forbidden.js';

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  /** 规则编号，与 V0.1 §14 的清单对齐 */
  rule: string;
  severity: IssueSeverity;
  /** 出错实体 */
  entity_kind: string;
  entity_id: string;
  message: string;
  /** 依据（文档出处 / ADR 编号） */
  basis: string;
}

export interface ValidationReport {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  checked: {
    /** 各实体计数，便于人眼核对"校验确实跑了" */
    counts: Record<string, number>;
  };
}

const RULE_BASIS = {
  R1: '认识论原则 3（无来源，不入库）；V0.1 §14',
  R1b: '认识论原则 3（AI 产出永远不能直接进入 reviewed）',
  R2: 'V0.1 §5.2.1（类型 3 必须声明 historicity）',
  R3: 'ADR-0007（类型 4 必须有配对反向练习）；ADR-0014（类型 3 重建类同理）',
  R4: '认识论原则 5（类比必须可见）',
  R5: 'V0.2 §1.3（规则判定必须绑定 Rule）',
  R6: 'V0.2 §1.3（含 Rubric 必须绑定 Rubric）',
  R7: 'ADR-0012（default_school 必须绑可引证文献）',
  R8: 'ADR-0011（同一 Formalism 内不得人工建边，应为派生投影）',
  R9: 'V0.1 §14（禁用语检查）',
  R10: 'V0.1 §14 流水线（② 引用完整性）',
  R11: 'ADR-0010（属性取值必须是 Symbol）',
  R12: 'ADR-0016（题型 ↔ 判分方式必须一致）；V0.1 §10.2',
  R13: 'ADR-0016（含规则判分的题必须有答案键）；V0.1 §12',
  R14: 'V0.1 §8.2（跨体系关卡四段式，缺一不可）',
} as const;

function hasSources(p: { sources: readonly unknown[] }): boolean {
  return p.sources.length > 0;
}

/** Layer 0 通用检查：R1a / R1b / R1c */
function checkProvenance(
  issues: ValidationIssue[],
  entityKind: string,
  entityId: string,
  prov: { sources: readonly unknown[]; review_status: string; authored_by: string },
): void {
  if (prov.review_status === 'reviewed' && !hasSources(prov)) {
    issues.push({
      rule: 'R1a',
      severity: 'error',
      entity_kind: entityKind,
      entity_id: entityId,
      message: 'reviewed 条目没有任何来源 —— 无来源不入库',
      basis: RULE_BASIS.R1,
    });
  }
  if (prov.review_status === 'reviewed' && prov.authored_by === 'ai-candidate') {
    issues.push({
      rule: 'R1b',
      severity: 'error',
      entity_kind: entityKind,
      entity_id: entityId,
      message: 'AI 产出的条目处于 reviewed —— AI 产出必须先经人工复核改判 authored_by',
      basis: RULE_BASIS.R1b,
    });
  }
  if (prov.review_status === 'draft' && !hasSources(prov)) {
    issues.push({
      rule: 'R1c',
      severity: 'warning',
      entity_kind: entityKind,
      entity_id: entityId,
      message: 'draft 条目无来源：允许存在，但不得升级为 reviewed',
      basis: RULE_BASIS.R1,
    });
  }
}

/** 主校验入口 */
export function validateBundle(bundle: ContentBundle): ValidationReport {
  const issues: ValidationIssue[] = [];

  const counts: Record<string, number> = {
    formalism: bundle.formalism.length,
    attribute_spaces: bundle.attribute_spaces.length,
    symbols: bundle.symbols.length,
    symbol_usages: bundle.symbol_usages.length,
    systems: bundle.systems.length,
    schools: bundle.schools.length,
    concepts: bundle.concepts.length,
    schemas: bundle.schemas.length,
    relations: bundle.relations.length,
    rules: bundle.rules.length,
    rule_test_sets: bundle.rule_test_sets.length,
    transfer_edges: bundle.transfer_edges.length,
    skills: bundle.skills.length,
    skill_edges: bundle.skill_edges.length,
    rubrics: bundle.rubrics.length,
    assessment_specs: bundle.assessment_specs.length,
    exercises: bundle.exercises.length,
    content_texts: bundle.content_texts.length,
  };

  // ---- R1: Layer 0 元数据（所有实体） ----
  const layer0Groups: Array<
    [
      string,
      {
        id: string;
        provenance: { sources: readonly unknown[]; review_status: string; authored_by: string };
      }[],
    ]
  > = [
    ['formalism', bundle.formalism],
    ['attribute_space', bundle.attribute_spaces],
    ['symbol', bundle.symbols],
    ['system', bundle.systems],
    ['school', bundle.schools],
    ['concept', bundle.concepts],
    ['schema', bundle.schemas],
    ['rule', bundle.rules],
    ['skill', bundle.skills],
    ['rubric', bundle.rubrics],
    ['assessment_spec', bundle.assessment_specs],
  ];
  for (const [kind, items] of layer0Groups) {
    for (const it of items) checkProvenance(issues, kind, it.id, it.provenance);
  }

  // 迁移边自带 `sources`（不走 provenance），单独校验非空
  for (const e of bundle.transfer_edges) {
    if (e.sources.length === 0) {
      issues.push({
        rule: 'R1a',
        severity: 'error',
        entity_kind: 'transfer_edge',
        entity_id: e.id,
        message: '跨体系关系边没有任何来源 —— 认识论原则 2/3：每条边必须声明来源',
        basis: RULE_BASIS.R1,
      });
    }
  }

  // ---- R2: 类型 3 必须声明 historicity ----
  for (const e of bundle.transfer_edges) {
    if (e.transfer_type === 3 && e.historicity === undefined) {
      issues.push({
        rule: 'R2',
        severity: 'error',
        entity_kind: 'transfer_edge',
        entity_id: e.id,
        message: 'transfer_type = 3（历史影响）必须声明 historicity（传播 / 重建 / 不明）',
        basis: RULE_BASIS.R2,
      });
    }
    if (e.transfer_type !== 3 && e.historicity !== undefined) {
      issues.push({
        rule: 'R2',
        severity: 'error',
        entity_kind: 'transfer_edge',
        entity_id: e.id,
        message: `transfer_type = ${e.transfer_type} 不应携带 historicity（historicity 只属于类型 3）`,
        basis: RULE_BASIS.R2,
      });
    }
  }

  // ---- R3: 类型 4 必须配对反向练习；类型 3 且 historicity = 重建 同理（ADR-0014） ----
  // 并且**双向确认**：反练习必须真实存在，且指回这条边（ADR-0016 补 Exercise 后 R3 才真正可执行）
  const exerciseIds = new Set(bundle.exercises.map((e) => e.id));
  for (const e of bundle.transfer_edges) {
    const needsReverse = e.transfer_type === 4 || (e.transfer_type === 3 && e.historicity === '重建');
    if (needsReverse && e.paired_reverse_exercise_id === undefined) {
      issues.push({
        rule: 'R3',
        severity: 'error',
        entity_kind: 'transfer_edge',
        entity_id: e.id,
        message:
          e.transfer_type === 4
            ? '类型 4 功能类比必须配反向练习题（找出类比失效的场景）—— 这是 CI 校验规则，不是建议'
            : '类型 3 且 historicity = 重建 的边必须配反向练习题（指出该指派的可争议处）',
        basis: RULE_BASIS.R3,
      });
      continue;
    }
    if (e.paired_reverse_exercise_id === undefined) continue;

    // (a) 引用的练习必须存在
    if (!exerciseIds.has(e.paired_reverse_exercise_id)) {
      issues.push({
        rule: 'R3',
        severity: 'error',
        entity_kind: 'transfer_edge',
        entity_id: e.id,
        message: `paired_reverse_exercise_id = ${e.paired_reverse_exercise_id} 不是已存在的 Exercise —— 悬空的"反向练习"等于没有反向练习`,
        basis: RULE_BASIS.R3,
      });
      continue;
    }
    // (b) 该练习必须指回这条边（双向确认，防止一条练习被复用冒充多条边的反练习）
    const rev = bundle.exercises.find((x) => x.id === e.paired_reverse_exercise_id);
    if (rev && rev.is_reverse_exercise_of_edge_id !== e.id) {
      issues.push({
        rule: 'R3',
        severity: 'error',
        entity_kind: 'transfer_edge',
        entity_id: e.id,
        message: `配对的 Exercise ${rev.id} 的 is_reverse_exercise_of_edge_id = ${rev.is_reverse_exercise_of_edge_id ?? '(未填)'}，未指回本边 —— 反向练习必须双向确认`,
        basis: RULE_BASIS.R3,
      });
    }
  }

  // ---- R4: 类型 4/5 的内容文本必须带「类比」标注 ----
  for (const e of bundle.transfer_edges) {
    if ((e.transfer_type === 4 || e.transfer_type === 5) && !e.analogy_label_present) {
      issues.push({
        rule: 'R4',
        severity: 'error',
        entity_kind: 'transfer_edge',
        entity_id: e.id,
        message: `类型 ${e.transfer_type} 的边缺「类比」标注 —— 类比必须对用户可见（不是埋在脚注）`,
        basis: RULE_BASIS.R4,
      });
    }
  }
  // 类型 5 不进教学内容
  for (const e of bundle.transfer_edges) {
    if (e.transfer_type === 5) {
      issues.push({
        rule: 'R4',
        severity: 'error',
        entity_kind: 'transfer_edge',
        entity_id: e.id,
        message: '类型 5 修辞比喻不进教学内容（不得作为学习目标或考点）',
        basis: RULE_BASIS.R4,
      });
    }
  }

  // ---- R5 / R6: 判分绑定（在 Layer 3 校验 — ADR-0015⑤ / M16） ----
  const summarise = (s: Skill): string => `judging_mode = ${s.judging_mode}`;
  for (const s of bundle.skills) {
    const needsRule =
      RULE_JUDGING_MODES.includes(s.judging_mode) || HYBRID_JUDGING_MODES.includes(s.judging_mode);
    const needsRubric =
      RUBRIC_JUDGING_MODES.includes(s.judging_mode) || HYBRID_JUDGING_MODES.includes(s.judging_mode);

    if (needsRule && specsProvidingRules(bundle.assessment_specs, s.id).length === 0) {
      issues.push({
        rule: 'R5',
        severity: 'error',
        entity_kind: 'skill',
        entity_id: s.id,
        message: `${summarise(s)} 需要规则引擎判分，但没有任何 Layer 3 评测规约（AssessmentSpec）为它绑定 Rule`,
        basis: RULE_BASIS.R5,
      });
    }
    if (needsRubric && specsProvidingRubric(bundle.assessment_specs, s.id).length === 0) {
      issues.push({
        rule: 'R6',
        severity: 'error',
        entity_kind: 'skill',
        entity_id: s.id,
        message: `${summarise(s)} 需要 Rubric 判分，但没有任何 Layer 3 评测规约（AssessmentSpec）为它绑定 Rubric`,
        basis: RULE_BASIS.R6,
      });
    }
  }

  // ---- R7: default_school 必须绑可引证文献（ADR-0012） ----
  for (const s of bundle.schools) {
    if (s.is_default_of_system && s.anchor_sources.length === 0) {
      issues.push({
        rule: 'R7',
        severity: 'error',
        entity_kind: 'school',
        entity_id: s.id,
        message: '入门默认流派没有可引证文献锚点 —— School 必须以「可引证文献」为锚，不得以「古法/新派」这类无学术界定的当代分类为锚',
        basis: RULE_BASIS.R7,
      });
    }
  }
  for (const sys of bundle.systems) {
    const def = bundle.schools.find((s) => s.id === sys.default_school_id);
    if (!def) {
      issues.push({
        rule: 'R7',
        severity: 'error',
        entity_kind: 'system',
        entity_id: sys.id,
        message: `default_school_id = ${sys.default_school_id} 不存在于 schools[]`,
        basis: RULE_BASIS.R7,
      });
    }
  }

  // ---- R8: 同一 Formalism 内不得人工建 transfers_as 边（ADR-0011） ----
  const formalismOfNode = (nodeId: string): string | undefined =>
    bundle.symbols.find((s) => s.id === nodeId)?.formalism_id;
  for (const e of bundle.transfer_edges) {
    if (isSameFormalismEdge({ from_node_id: e.from_node_id, to_node_id: e.to_node_id }, formalismOfNode)) {
      issues.push({
        rule: 'R8',
        severity: 'error',
        entity_kind: 'transfer_edge',
        entity_id: e.id,
        message:
          '两端落在同一个 Formalism 内：这属于「机制 A 同源投影」，应通过 sameFormalismProjection() 派生，不得人工建边',
        basis: RULE_BASIS.R8,
      });
    }
  }

  // ---- R9: 禁用语检查 ----
  for (const hit of scanForbiddenPhrases(bundle.content_texts)) {
    issues.push({
      rule: 'R9',
      severity: 'error',
      entity_kind: 'content_text',
      entity_id: hit.text_id,
      message: `[${hit.pattern_id}] ${hit.reason}｜上下文：…${hit.excerpt}…`,
      basis: RULE_BASIS.R9,
    });
  }

  // ---- R10: 引用完整性 ----
  const symbolIds = new Set(bundle.symbols.map((s) => s.id));
  const spaceIds = new Set(bundle.attribute_spaces.map((s) => s.id));
  const systemIds = new Set(bundle.systems.map((s) => s.id));
  const ruleIds = new Set(bundle.rules.map((r) => r.id));
  const rubricIds = new Set(bundle.rubrics.map((r) => r.id));
  const skillIds = new Set(bundle.skills.map((s) => s.id));

  const ref = (rule: string, kind: string, id: string, target: string, ok: boolean): void => {
    if (!ok) {
      issues.push({
        rule,
        severity: 'error',
        entity_kind: kind,
        entity_id: id,
        message: `引用了不存在的 ${target}`,
        basis: RULE_BASIS.R10,
      });
    }
  };

  for (const u of bundle.symbol_usages) {
    ref('R10', 'symbol_usage', `${u.symbol_id}@${u.system_id}`, `symbol（${u.symbol_id}）`, symbolIds.has(u.symbol_id));
    ref('R10', 'symbol_usage', `${u.symbol_id}@${u.system_id}`, `system（${u.system_id}）`, systemIds.has(u.system_id));
  }
  for (const h of bundle.has_attributes) {
    ref('R10', 'has_attribute', `${h.symbol_id}/${h.space_id}`, `space（${h.space_id}）`, spaceIds.has(h.space_id));
    ref('R10', 'has_attribute', `${h.symbol_id}/${h.space_id}`, `value symbol（${h.value_symbol_id}）`, symbolIds.has(h.value_symbol_id));
  }
  for (const r of bundle.relations) {
    ref('R10', 'relation', `${r.from_symbol_id}->${r.to_symbol_id}`, `symbol（${r.from_symbol_id}）`, symbolIds.has(r.from_symbol_id));
    ref('R10', 'relation', `${r.from_symbol_id}->${r.to_symbol_id}`, `symbol（${r.to_symbol_id}）`, symbolIds.has(r.to_symbol_id));
  }
  for (const spec of bundle.assessment_specs) {
    for (const sid of spec.skill_ids) ref('R10', 'assessment_spec', spec.id, `skill（${sid}）`, skillIds.has(sid));
    if (spec.rubric_id !== undefined) ref('R10', 'assessment_spec', spec.id, `rubric（${spec.rubric_id}）`, rubricIds.has(spec.rubric_id));
    for (const rid of spec.rule_ids) ref('R10', 'assessment_spec', spec.id, `rule（${rid}）`, ruleIds.has(rid));
  }
  for (const r of bundle.rules) {
    if (r.test_set_id !== undefined) {
      ref(
        'R10',
        'rule',
        r.id,
        `rule_test_set（${r.test_set_id}）`,
        bundle.rule_test_sets.some((t) => t.rule_id === r.id),
      );
    }
  }
  for (const e of bundle.transfer_edges) {
    ref('R10', 'transfer_edge', e.id, `from node（${e.from_node_id}）`, symbolIds.has(e.from_node_id) || skillIds.has(e.from_node_id) || bundle.concepts.some((c) => c.id === e.from_node_id));
    ref('R10', 'transfer_edge', e.id, `to node（${e.to_node_id}）`, symbolIds.has(e.to_node_id) || skillIds.has(e.to_node_id) || bundle.concepts.some((c) => c.id === e.to_node_id));
  }
  for (const se of bundle.skill_edges) {
    ref('R10', 'skill_edge', `${se.from_skill_id}->${se.to_skill_id}`, `skill（${se.from_skill_id}）`, skillIds.has(se.from_skill_id));
    ref('R10', 'skill_edge', `${se.from_skill_id}->${se.to_skill_id}`, `skill（${se.to_skill_id}）`, skillIds.has(se.to_skill_id));
  }

  // ---- R11: 属性空间的取值必须是 Symbol，且 symbol_kind = attribute_value ----
  for (const sp of bundle.attribute_spaces) {
    for (const vid of sp.value_symbol_ids) {
      const sym = bundle.symbols.find((s) => s.id === vid);
      if (!sym) {
        issues.push({
          rule: 'R11',
          severity: 'error',
          entity_kind: 'attribute_space',
          entity_id: sp.id,
          message: `取值 ${vid} 不是 Symbol —— ADR-0010 规定属性空间的取值必须是符号（它要被 Rule 作用、要携带来源与流派、要参与有向关系）`,
          basis: RULE_BASIS.R11,
        });
        continue;
      }
      if (sym.symbol_kind !== 'attribute_value') {
        issues.push({
          rule: 'R11',
          severity: 'error',
          entity_kind: 'attribute_space',
          entity_id: sp.id,
          message: `取值 ${vid} 的 symbol_kind = ${sym.symbol_kind}，应为 attribute_value`,
          basis: RULE_BASIS.R11,
        });
      }
      if (sym.attribute_space_id !== sp.id) {
        issues.push({
          rule: 'R11',
          severity: 'error',
          entity_kind: 'attribute_space',
          entity_id: sp.id,
          message: `取值 ${vid} 的 attribute_space_id 指向 ${sym.attribute_space_id ?? '(未填)'}，与本空间 ${sp.id} 不一致`,
          basis: RULE_BASIS.R11,
        });
      }
    }
  }

  // ---- R12: 题型 ↔ 判分方式必须一致（ADR-0016） ----
  // 「关系判断」必须由规则引擎判定；「开放式解读」只能由 Rubric 判分。混用即失败。
  const specById = new Map(bundle.assessment_specs.map((s) => [s.id, s]));
  for (const ex of bundle.exercises) {
    if (!specById.has(ex.assessment_spec_id)) {
      issues.push({
        rule: 'R12',
        severity: 'error',
        entity_kind: 'exercise',
        entity_id: ex.id,
        message: `assessment_spec_id = ${ex.assessment_spec_id} 不存在`,
        basis: RULE_BASIS.R12,
      });
      continue;
    }
    const allowed = KIND_ALLOWED_JUDGING_MODES[ex.kind];
    for (const sid of ex.skill_ids) {
      const sk = bundle.skills.find((s) => s.id === sid);
      if (!sk) {
        issues.push({
          rule: 'R12',
          severity: 'error',
          entity_kind: 'exercise',
          entity_id: ex.id,
          message: `引用了不存在的 skill（${sid}）`,
          basis: RULE_BASIS.R12,
        });
        continue;
      }
      if (!allowed.includes(sk.judging_mode)) {
        issues.push({
          rule: 'R12',
          severity: 'error',
          entity_kind: 'exercise',
          entity_id: ex.id,
          message: `题型「${ex.kind}」不允许 judging_mode = ${sk.judging_mode}（Skill: ${sid}）。允许：${allowed.join(' / ')}`,
          basis: RULE_BASIS.R12,
        });
      }
    }
  }

  // ---- R13: 规则/半规则判分题必须有答案键（ADR-0016） ----
  for (const ex of bundle.exercises) {
    const skills = ex.skill_ids
      .map((sid) => bundle.skills.find((s) => s.id === sid))
      .filter((s): s is Skill => s !== undefined);
    const hasRulePart = skills.some(
      (s) => RULE_JUDGING_MODES.includes(s.judging_mode) || HYBRID_JUDGING_MODES.includes(s.judging_mode),
    );
    if (hasRulePart && ex.answer_key === undefined) {
      issues.push({
        rule: 'R13',
        severity: 'error',
        entity_kind: 'exercise',
        entity_id: ex.id,
        message: '含规则判分部分的题目没有 answer_key —— 规则引擎无从判分（AI 不得介入有唯一答案处）',
        basis: RULE_BASIS.R13,
      });
    }
    if (ex.answer_key !== undefined && !ruleIds.has(ex.answer_key.rule_id)) {
      issues.push({
        rule: 'R13',
        severity: 'error',
        entity_kind: 'exercise',
        entity_id: ex.id,
        message: `answer_key.rule_id = ${ex.answer_key.rule_id} 不存在于 rules[]`,
        basis: RULE_BASIS.R13,
      });
    }
    // 题目所测的每个 Skill 都必须被它所用的规约覆盖
    const spec = specById.get(ex.assessment_spec_id);
    if (spec) {
      for (const sid of ex.skill_ids) {
        if (!spec.skill_ids.includes(sid)) {
          issues.push({
            rule: 'R12',
            severity: 'error',
            entity_kind: 'exercise',
            entity_id: ex.id,
            message: `测的 Skill ${sid} 不在所用规约 ${spec.id} 的 skill_ids 内`,
            basis: RULE_BASIS.R12,
          });
        }
      }
    }
  }

  // ---- R14: 跨体系四段式第 ④ 段必须真实存在（V0.1 §8.2） ----
  for (const e of bundle.transfer_edges) {
    const fp = e.four_part_structure;
    if (fp && !exerciseIds.has(fp.transfer_exercise_id)) {
      issues.push({
        rule: 'R14',
        severity: 'error',
        entity_kind: 'transfer_edge',
        entity_id: e.id,
        message: `四段式第 ④ 段的 transfer_exercise_id = ${fp.transfer_exercise_id} 不是已存在的 Exercise`,
        basis: RULE_BASIS.R14,
      });
    }
    if (e.transfer_type === 4 && fp === undefined) {
      issues.push({
        rule: 'R14',
        severity: 'error',
        entity_kind: 'transfer_edge',
        entity_id: e.id,
        message: '类型 4 的边必须写完整的四段式结构（V0.1 §8.2：①你已掌握 ②新体系中 ③关系声明 ④迁移练习+反向练习）',
        basis: RULE_BASIS.R14,
      });
    }
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return { ok: errors.length === 0, errors, warnings, checked: { counts } };
}

/** 人类可读的报告（CLI 用） */
export function formatReport(report: ValidationReport): string {
  const lines: string[] = [];
  const c = report.checked.counts;
  lines.push('内容计数：' + Object.entries(c).map(([k, v]) => `${k}=${v}`).join(' '));
  if (report.warnings.length > 0) {
    lines.push(`\n警告 ${report.warnings.length} 条：`);
    for (const w of report.warnings) lines.push(`  [${w.rule}] ${w.entity_kind}:${w.entity_id} — ${w.message}`);
  }
  if (report.errors.length > 0) {
    lines.push(`\n错误 ${report.errors.length} 条（构建失败）：`);
    for (const e of report.errors) lines.push(`  [${e.rule}] ${e.entity_kind}:${e.entity_id} — ${e.message}\n        依据：${e.basis}`);
  }
  lines.push(report.ok ? '\n✅ CI 校验通过' : '\n❌ CI 校验失败');
  return lines.join('\n');
}
