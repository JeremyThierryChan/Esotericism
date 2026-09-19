/**
 * 确定性题目生成器
 *
 * 依据：V0.2 §5.6（规则密集型体系题目可自动生成）、V0.1 §12（客观题答案与选项由规则生成）
 *
 * **完全不使用 AI，且不产生任何术数知识。** 生成器只做两件事：
 *   1. 在「已存在于内容库的关系边」上做有序对组合；
 *   2. 用**规则引擎**算出每道题的正确答案。
 *
 * 因此：内容库里没有的关系，就不会出成题。真值表只有内容库一个来源。
 *
 * 确定性：同一 content bundle → 同一批题目（顺序稳定、id 稳定），有测试锁住。
 */
import type { ContentBundle } from '../bundle.js';
import type { Exercise } from '../layer3/exercise.js';
import type { ExerciseInstance, ExerciseTemplate } from '../layer3/exercise-template.js';
import { RuleInputError, resolveRule, type RuleEngineContext } from '../rules/registry.js';
import { relatedByEdges } from '../layer1/relation.js';

export interface GenerateOptions {
  /** 只生成某个模板的题 */
  templateId?: string;
  /** 每个模板最多生成多少题 */
  limitPerTemplate?: number;
  /** 每次生成时打乱选项顺序用的种子（0 = 不打乱，保证确定性） */
  shuffleSeed?: number;
}

/** 生成结果：题目 + 可解释的生成说明 */
export interface GenerateReport {
  instances: ExerciseInstance[];
  /** 每个模板生成了多少题，以及为什么 */
  byTemplate: Array<{ template_id: string; count: number; skipped: string[] }>;
}

function fillTemplate(tpl: string, params: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, key: string) => params[key] ?? `{${key}}`);
}

/** 把规则输出映射成人类可读的答案标签（用于客观题比对与选项展示） */
export function relationAnswerLabel(result: { relation: string; direction: string }): string {
  if (result.relation === 'none' || result.direction === 'none') return '无作用关系';
  const arrow = result.direction === 'a→b' ? 'a→b' : 'b→a';
  return `${arrow} ${result.relation === '生' ? '相生' : '相克'}`;
}

/** 模板要求的答案字段 */
function answerFieldOf(template: ExerciseTemplate): string {
  const f = template.answer_field;
  if (!f) {
    throw new Error(
      `模板 ${template.id} 需要 answer_field（bit-combinations 模式与 answer-field-distinct 选项都要靠它）`,
    );
  }
  return f;
}

/**
 * 取规则表里 `answer_field` 的去重取值作为选项（**排序保证确定性**）。
 *
 * 为什么从表里取而不是硬编码：选项必须与规则的可能输出**同源**，
 * 否则会出「正确答案不在选项里」这种最难发现的坏题。
 */
function collectAnswerFieldChoices(
  template: ExerciseTemplate,
  bundle: ContentBundle,
  field: string,
): string[] | undefined {
  if (template.choices_mode !== 'answer-field-distinct') return undefined;
  const rule = bundle.rules.find((r) => r.id === template.rule_id);
  if (!rule?.table) return undefined;
  const values = new Set<string>();
  for (const row of rule.table.rows) {
    const v = row[field];
    if (v !== undefined) values.add(String(v));
  }
  return [...values].sort();
}

/** 跑规则；失败则记原因并返回 undefined（**不静默出题**） */
function runRule(
  procedure: ReturnType<typeof resolveRule>['procedure'],
  input: unknown,
  ctx: RuleEngineContext,
  ruleDecl: ReturnType<typeof resolveRule>['rule'],
  skipped: string[],
  ...labels: string[]
): Record<string, unknown> | undefined {
  try {
    return procedure(input, ctx, ruleDecl) as Record<string, unknown>;
  } catch (e) {
    if (e instanceof RuleInputError) {
      skipped.push(`规则拒绝输入 ${labels.join('/')}：${e.message}`);
      return undefined;
    }
    throw e;
  }
}

/** 组装一道生成题 */
function makeInstance(
  template: ExerciseTemplate,
  input: unknown,
  result: Record<string, unknown>,
  label: string,
  params: Record<string, string>,
  choices?: string[],
): ExerciseInstance {
  const resolvedChoices =
    choices ??
    (template.choices_mode === 'relation-labels'
      ? ['a→b 相生', 'b→a 相生', 'a→b 相克', 'b→a 相克', '无作用关系']
      : template.choices_mode === 'none'
        ? undefined
        : undefined);

  return {
    id: `${template.id}#${Object.values(params).join('-')}`,
    template_id: template.id,
    kind: template.kind,
    prompt: fillTemplate(template.prompt_template, params),
    skill_ids: template.skill_ids,
    assessment_spec_id: template.assessment_spec_id,
    answer_key: {
      rule_id: template.rule_id,
      input,
      // expected 保留规则输出的**全部**字段供审计，另存 label 作为选择题的判定值
      expected: { ...result, label },
      ...(resolvedChoices && resolvedChoices.length > 0 ? { choices: resolvedChoices } : {}),
    },
    requires_process: template.requires_process,
    difficulty: template.difficulty,
    params,
  };
}

export function generateExercises(bundle: ContentBundle, options: GenerateOptions = {}): GenerateReport {
  const ctx: RuleEngineContext = { bundle };
  const templates = options.templateId
    ? bundle.exercise_templates.filter((t) => t.id === options.templateId)
    : bundle.exercise_templates;

  const instances: ExerciseInstance[] = [];
  const byTemplate: GenerateReport['byTemplate'] = [];

  for (const template of templates) {
    const skipped: string[] = [];
    const limit = Math.min(options.limitPerTemplate ?? template.max_instances, template.max_instances);
    const emitted = (): number => instances.filter((i) => i.template_id === template.id).length;
    const bail = (reason: string): void => {
      skipped.push(reason);
      byTemplate.push({ template_id: template.id, count: 0, skipped });
    };

    // ① 规则必须存在且能解析出实现（失败即跳过，不静默出题）
    let procedure: ReturnType<typeof resolveRule>['procedure'];
    let ruleDecl: ReturnType<typeof resolveRule>['rule'];
    try {
      const resolved = resolveRule(template.rule_id, ctx);
      procedure = resolved.procedure;
      ruleDecl = resolved.rule;
    } catch (e) {
      bail(`规则不可用：${(e as Error).message}`);
      continue;
    }

    const run = (input: unknown, ...labels: string[]): Record<string, unknown> | undefined =>
      runRule(procedure, input, ctx, ruleDecl, skipped, ...labels);

    // ── 模式 A：两个符号之间的关系题（如五行生克） ──
    if (template.parameter_space.mode === 'symbol-pairs') {
      const ps = template.parameter_space;
      const domain = ps.domain_symbol_ids;

      // 全组合覆盖前先检查关系表**完整性**：否则「查不到关系」会被当成「无作用关系」
      // 出成**错误答案**，而且看起来完全正常（有题干、有选项、判分还能通过）。
      // CI 规则 R18 做同一件事；这里再挡一次，让运行时也不能绕过。
      // 判定按**无序对**：关系有方向，但一条边足以回答两个方向的提问。
      if (ps.coverage === 'all-ordered-pairs' && ps.include_identity_pairs) {
        const missing: string[] = [];
        const seen = new Set<string>();
        for (const a of domain) {
          for (const b of domain) {
            if (a === b) continue;
            const key = [a, b].sort().join('|');
            if (seen.has(key)) continue;
            seen.add(key);
            const has = relatedByEdges(bundle.relations).some(
              (r) => (r.from_symbol_id === a && r.to_symbol_id === b) || (r.from_symbol_id === b && r.to_symbol_id === a),
            );
            if (!has) missing.push(`${a}↔${b}`);
          }
        }
        if (missing.length > 0) {
          bail(`关系表不完整（缺 ${missing.length} 条边），拒绝生成全组合题：${missing.slice(0, 4).join(', ')}…`);
          continue;
        }
      }

      for (const a of domain) {
        for (const b of domain) {
          if (emitted() >= limit) break;
          const isIdentity = a === b;
          if (isIdentity && !ps.include_identity_pairs) continue;
          if (isIdentity && ps.coverage === 'distinct-ordered-pairs') continue;

          const symA = bundle.symbols.find((s) => s.id === a);
          const symB = bundle.symbols.find((s) => s.id === b);
          if (!symA || !symB) {
            skipped.push(`符号不存在：${a} / ${b}`);
            continue;
          }

          const input = { a: symA.canonical_name, b: symB.canonical_name };
          const result = run(input, symA.canonical_name, symB.canonical_name);
          if (!result) continue;

          instances.push(
            makeInstance(
              template,
              input,
              result,
              relationAnswerLabel(result as { relation: string; direction: string }),
              { a: symA.canonical_name, b: symB.canonical_name },
            ),
          );
        }
      }
    } else {
      // ── 模式 B：位组合题（三爻→八卦、六爻→本卦） ──
      const n = template.parameter_space.bit_length;
      const choices = collectAnswerFieldChoices(template, bundle, answerFieldOf(template));

      for (let i = 0; i < 2 ** n; i++) {
        if (emitted() >= limit) break;
        // 自初爻起：第 k 位 = 第 k 爻（0 = 初爻）
        const lines = Array.from({ length: n }, (_, k) => ((i >> k) & 1) as 0 | 1);
        const bits = lines.join('');
        const input = { lines };
        const result = run(input, bits);
        if (!result) continue;

        const label = String(result[answerFieldOf(template)] ?? '');
        instances.push(
          makeInstance(template, input, result, label, {
            bits,
            // 不加「（自初爻起）」后缀：题干模板里有 —— 否则会出现「…自初爻起：阳 阴 阴（自初爻起）」
            yao: lines.map((v) => (v === 1 ? '阳' : '阴')).join(' '),
          }, choices),
        );
      }
    }

    byTemplate.push({
      template_id: template.id,
      count: instances.filter((i) => i.template_id === template.id).length,
      skipped,
    });
  }

  return { instances, byTemplate };
}

/**
 * 把生成实例转成「可判分的 Exercise 形状」。
 *
 * 判分器（`createRuleJudge`）只依赖 Exercise 的这几个字段，因此生成实例可以直接喂给它；
 * 这里显式做一次转换，而不是让判分器接受两种类型 —— 免得日后生成的题漏了字段却没人发现。
 */
export function toJudgeableExercise(instance: ExerciseInstance, template: ExerciseTemplate): Exercise {
  if (instance.template_id !== template.id) {
    throw new Error('实例与模板不匹配');
  }
  return {
    id: instance.id,
    kind: instance.kind,
    prompt: instance.prompt,
    skill_ids: instance.skill_ids,
    assessment_spec_id: instance.assessment_spec_id,
    answer_key: instance.answer_key,
    requires_process: instance.requires_process,
    difficulty: instance.difficulty,
    provenance: template.provenance,
  };
}
