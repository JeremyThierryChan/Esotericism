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

/** 由规则的可能取值生成选项（生 / 克 / 无，含正反向） */
function relationChoices(): string[] {
  return ['a→b 相生', 'b→a 相生', 'a→b 相克', 'b→a 相克', '无作用关系'];
}

/** 把规则输出映射成人类可读的答案标签（用于客观题比对与选项展示） */
export function relationAnswerLabel(result: { relation: string; direction: string }): string {
  if (result.relation === 'none' || result.direction === 'none') return '无作用关系';
  const arrow = result.direction === 'a→b' ? 'a→b' : 'b→a';
  return `${arrow} ${result.relation === '生' ? '相生' : '相克'}`;
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

    // ① 规则必须存在且能解析出实现（失败即跳过，不静默出题）
    let procedure: ReturnType<typeof resolveRule>['procedure'];
    try {
      procedure = resolveRule(template.rule_id, ctx).procedure;
    } catch (e) {
      skipped.push(`规则不可用：${(e as Error).message}`);
      byTemplate.push({ template_id: template.id, count: 0, skipped });
      continue;
    }

    // ② 组合参数（确定性顺序：按内容库中的符号顺序）
    const domain = template.parameter_space.domain_symbol_ids;
    const pairs: Array<[string, string]> = [];
    for (const a of domain) {
      for (const b of domain) {
        const isIdentity = a === b;
        if (isIdentity && !template.parameter_space.include_identity_pairs) continue;
        if (isIdentity && template.parameter_space.coverage === 'distinct-ordered-pairs') continue;
        pairs.push([a, b]);
      }
    }

    // ②b 全组合覆盖时先检查关系表**完整性**。
    // 不加这道闸门的话，「规则查不到关系」会被当成「无作用关系」出成题 —— 那是**错误答案**，
    // 而且看起来完全正常（有题干、有选项、判分还能通过），属于最难发现的坏数据。
    // CI 规则 R18 做同一件事，这里再挡一次是为了让运行时也不能绕过。
    if (template.parameter_space.coverage === 'all-ordered-pairs' && template.parameter_space.include_identity_pairs) {
      // 注意：关系**有方向**，但一条边足以回答两个方向的提问
      // （问「火与木」时，规则会发现存在 木→火 的生边，答「b→a 相生」）。
      // 所以完整性按**无序对**判定 —— 按有序对判定会误报一半的缺失。
      const missing: string[] = [];
      const seen = new Set<string>();
      for (const a of domain) {
        for (const b of domain) {
          if (a === b) continue;
          const key = [a, b].sort().join('|');
          if (seen.has(key)) continue;
          seen.add(key);
          const has = bundle.relations.some(
            (r) =>
              (r.from_symbol_id === a && r.to_symbol_id === b) || (r.from_symbol_id === b && r.to_symbol_id === a),
          );
          if (!has) missing.push(`${a}↔${b}`);
        }
      }
      if (missing.length > 0) {
        skipped.push(`关系表不完整（缺 ${missing.length} 条边），拒绝生成全组合题：${missing.slice(0, 4).join(', ')}…`);
        byTemplate.push({ template_id: template.id, count: 0, skipped });
        continue;
      }
    }

    const limit = Math.min(options.limitPerTemplate ?? template.max_instances, template.max_instances);

    for (const [aId, bId] of pairs) {
      if (instances.filter((i) => i.template_id === template.id).length >= limit) break;

      const symA = bundle.symbols.find((s) => s.id === aId);
      const symB = bundle.symbols.find((s) => s.id === bId);
      if (!symA || !symB) {
        skipped.push(`符号不存在：${aId} / ${bId}`);
        continue;
      }

      // ③ 用规则算出正确答案（与判分同一套真值表）
      let result: unknown;
      try {
        result = procedure({ a: symA.canonical_name, b: symB.canonical_name }, ctx);
      } catch (e) {
        if (e instanceof RuleInputError) {
          skipped.push(`规则拒绝输入 ${symA.canonical_name}/${symB.canonical_name}：${e.message}`);
          continue;
        }
        throw e;
      }

      const label = relationAnswerLabel(result as { relation: string; direction: string });
      const params = { a: symA.canonical_name, b: symB.canonical_name };

      instances.push({
        id: `${template.id}#${symA.canonical_name}-${symB.canonical_name}`,
        template_id: template.id,
        kind: template.kind,
        prompt: fillTemplate(template.prompt_template, params),
        skill_ids: template.skill_ids,
        assessment_spec_id: template.assessment_spec_id,
        answer_key: {
          rule_id: template.rule_id,
          input: params,
          // expected 同时给结构化字段与 label：结构化用于审计，label 用于客观题选项比对
          expected: {
            relation: (result as { relation: string }).relation,
            direction: (result as { direction: string }).direction,
            label,
          },
          ...(template.choices_mode === 'relation-labels' ? { choices: relationChoices() } : {}),
        },
        requires_process: template.requires_process,
        difficulty: template.difficulty,
        params,
      });
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
