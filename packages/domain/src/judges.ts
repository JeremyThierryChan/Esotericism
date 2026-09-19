/**
 * 判分器实现
 *
 * 依据：V0.1 §11.1（六段反馈结构）、§12（分工与三道闸门）、V0.2 M7（按体系配置 AI 权重）
 *
 * 三个实现：
 *   · `createRuleJudge`         规则引擎判分，**AI 不得介入**
 *   · `createRubricJudge`       AI 按 Rubric 判分（调用方注入 LLM caller）
 *   · `createSkeletonRubricJudge` 无 AI 的离线骨架：给出六段反馈的**结构**与自查清单，
 *                                 标注 `offline-skeleton`，**不计入评测集**
 *
 * 为什么需要第三个：GitHub Pages 是纯静态托管，没有服务端，API key 无处安放。
 * 离线骨架让"没有 key 的人也能看懂功能长什么样"，同时用 `decided_by` 与
 * `audit.runtime` 明确标注它**不是 AI 判分** —— 不伪装。
 */
import type { ContentBundle } from './bundle.js';
import type { Exercise } from './layer3/exercise.js';
import type { Rubric } from './layer3/rubric.js';
import type { JudgingRecord } from './layer4/user-state.js';
import { RuleInputError, resolveRule, type RuleEngineContext } from './rules/registry.js';
import { scanForbiddenPhrases } from './validate/forbidden.js';
import type { JudgeAudit, JudgeFinding } from './layer4/user-state.js';

function nowIso(): string {
  return new Date().toISOString();
}

/** 简易稳定摘要（浏览器可用的无依赖哈希，用于 `prompt_digest`） */
export function digest(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 16);
}

// ─────────────────────────────────────────────────────────────────────────────
// 规则判分
// ─────────────────────────────────────────────────────────────────────────────

export interface RuleJudgeOptions {
  bundle: ContentBundle;
  sessionId?: string;
}

/**
 * 规则判分器。
 *
 * 流程：取题目的 `answer_key` → 用 `rule_id` 找规则实现 → 跑出实际结果 →
 * 与 `expected` 逐字段比较 → 产出 findings。
 *
 * **全流程不调用任何 AI**：AI 会在生克冲合这类有唯一正确答案的地方产生幻觉（V0.1 §12）。
 */
export function createRuleJudge(opts: RuleJudgeOptions) {
  const ctx: RuleEngineContext = { bundle: opts.bundle };

  return {
    judge(exercise: Exercise, answer: unknown): JudgingRecord {
      const key = exercise.answer_key;
      if (!key) {
        throw new RuleInputError(`题目 ${exercise.id} 没有 answer_key，不能走规则判分`);
      }
      const { procedure } = resolveRule(key.rule_id, ctx);

      const expected =
        typeof answer === 'object' && answer !== null && 'a' in (answer as object) && 'b' in (answer as object)
          ? // 用户只给了选择/对象答案：直接与期望值比较
            answer
          : key.input; // 用户只点了选项：用题目输入跑规则，再比期望

      let actual: unknown;
      let error: string | undefined;
      try {
        actual = procedure(expected, ctx);
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }

      const findings: JudgeFinding[] = [];
      if (error) {
        findings.push({ key: 'rule.error', verdict: 'uncertain', detail: `规则执行失败：${error}` });
      } else {
        const exp = key.expected as Record<string, unknown> | undefined;
        const act = actual as Record<string, unknown> | undefined;
        for (const field of Object.keys(exp ?? {})) {
          const hit = exp?.[field] === act?.[field];
          findings.push({
            key: `rule.${field}`,
            verdict: hit ? 'hit' : 'miss',
            detail: hit
              ? `${field} = ${JSON.stringify(act?.[field])} ✓`
              : `期望 ${field} = ${JSON.stringify(exp?.[field])}，实际 ${JSON.stringify(act?.[field])}`,
          });
        }
      }

      const passed = !error && findings.length > 0 && findings.every((f) => f.verdict === 'hit');
      const audit: JudgeAudit = {
        knowledge_scope_ids: [key.rule_id, ...exercise.skill_ids],
        wrote_to_library: false,
        recorded_at: nowIso(),
        runtime: 'offline-skeleton',
        human_reviewed: false,
      };

      return {
        skill_ids: exercise.skill_ids,
        passed,
        findings,
        decided_by: 'rule-engine',
        assessment_spec_id: exercise.assessment_spec_id,
        exercise_id: exercise.id,
        audit,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rubric 判分
// ─────────────────────────────────────────────────────────────────────────────

/** 调用方注入的 LLM 能力。返回原始文本；本模块负责解析与审计 */
export interface LlmCaller {
  (args: { system: string; user: string; model: string }): Promise<{ text: string; model: string }>;
}

export interface RubricJudgeOptions {
  bundle: ContentBundle;
  caller: LlmCaller;
  model?: string;
  /** 审计用的运行时环境标记 */
  runtime?: JudgeAudit['runtime'];
}

const SIX_PART_TEMPLATE_KEYS = ['recognized', 'missing', 'tendency_error', 'correction', 'next_step', 'not_evaluated'] as const;

/**
 * 构造给 AI 的判分提示词。
 *
 * 硬约束（V0.1 §12 闸门 ①）：**知识边界** —— 上下文只注入已审核知识条目。
 * 这里注入的是题目、Rubric、以及本题涉及的 Skill/内容条目 ID；
 * 提示词明确要求 AI 引用条目 ID，并禁止它在范围外发明对应关系。
 */
export function buildRubricPrompt(exercise: Exercise, rubric: Rubric, bundle: ContentBundle): { system: string; user: string } {
  const skills = bundle.skills.filter((s) => exercise.skill_ids.includes(s.id));
  const scopeIds = [exercise.id, rubric.id, exercise.assessment_spec_id, ...exercise.skill_ids];

  const system = [
    '你是一个术数学习产品的判分器。你只做一件事：按给定的判分规约（Rubric）评价用户的答案并给出结构化反馈。',
    '',
    '硬约束：',
    '1. 你的判断必须只基于下面给出的 Rubric 与知识条目，不得引入任何未给出的术数对应关系。',
    '2. 你**不判断预测准不准**，只判断解读的过程规范性与完整性。',
    '3. 命中 forbidden 中的任何一条，必须作为 violation 报告。',
    '4. 输出必须是**严格 JSON**，不要 markdown 代码围栏，不要额外解释。',
    '',
    '输出 JSON 结构：',
    JSON.stringify(
      {
        passed: 'boolean',
        findings: [{ key: 'must_hit[i] | should_hit[i] | forbidden[i]', verdict: 'hit|miss|violation|uncertain', detail: 'string' }],
        feedback: Object.fromEntries(SIX_PART_TEMPLATE_KEYS.map((k) => [k, rubric.feedback_template[k]])),
      },
      null,
      2,
    ),
  ].join('\n');

  const user = [
    `【题面】\n${exercise.prompt}`,
    `【题型】${exercise.kind}`,
    `【涉及能力】\n${skills.map((s) => `- ${s.id}: ${s.statement}`).join('\n')}`,
    `【判分规约 ${rubric.id}】`,
    `必需要素 must_hit:\n${rubric.must_hit.map((x, i) => `  must_hit[${i}] ${x}`).join('\n')}`,
    `加分要素 should_hit:\n${rubric.should_hit.map((x, i) => `  should_hit[${i}] ${x}`).join('\n')}`,
    `禁止项 forbidden:\n${rubric.forbidden.map((x, i) => `  forbidden[${i}] ${x}`).join('\n')}`,
    rubric.school_variance ? `容许的流派差异: ${rubric.school_variance}` : '',
    rubric.process_rules.length > 0 ? `过程规范:\n${rubric.process_rules.map((x) => `  - ${x}`).join('\n')}` : '',
    `【可引用的知识条目 ID】${scopeIds.join(', ')}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  return { system, user };
}

/** 从模型输出里抽出 JSON（容忍代码围栏） */
export function parseJudgeJson(text: string): { passed: boolean; findings: JudgeFinding[]; feedback?: Record<string, string> } {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('模型输出中没有 JSON 对象');
  const obj = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  const findingsRaw: unknown[] = Array.isArray(obj.findings) ? (obj.findings as unknown[]) : [];
  const findings: JudgeFinding[] = findingsRaw.map((f: unknown) => {
    const r = f as Record<string, unknown>;
    const v = String(r.verdict ?? 'uncertain');
    return {
      key: String(r.key ?? 'unknown'),
      verdict: (['hit', 'miss', 'violation', 'uncertain'].includes(v) ? v : 'uncertain') as JudgeFinding['verdict'],
      detail: String(r.detail ?? ''),
    };
  });
  return {
    passed: obj.passed === true,
    findings,
    ...(obj.feedback && typeof obj.feedback === 'object' ? { feedback: obj.feedback as Record<string, string> } : {}),
  };
}

/** AI Rubric 判分器 */
export function createRubricJudge(opts: RubricJudgeOptions) {
  const model = opts.model ?? 'default';
  const runtime = opts.runtime ?? 'server';

  return {
    async judge(exercise: Exercise, answer: string): Promise<JudgingRecord> {
      const rubric = opts.bundle.rubrics.find((r) => r.id === exercise.assessment_spec_id || r.id === findRubricId(exercise, opts.bundle));
      if (!rubric) throw new Error(`题目 ${exercise.id} 找不到对应的 Rubric`);

      const { system, user } = buildRubricPrompt(exercise, rubric, opts.bundle);
      const prompt = `${system}\n\n---\n\n${user}\n\n【用户答案】\n${answer}`;
      const { text, model: usedModel } = await opts.caller({ system, user: `${user}\n\n【用户答案】\n${answer}`, model });

      let parsed: ReturnType<typeof parseJudgeJson>;
      try {
        parsed = parseJudgeJson(text);
      } catch (e) {
        return {
          skill_ids: exercise.skill_ids,
          passed: false,
          findings: [{ key: 'ai.parse_error', verdict: 'uncertain', detail: `模型输出无法解析为 JSON：${(e as Error).message}` }],
          decided_by: 'ai-rubric',
          assessment_spec_id: exercise.assessment_spec_id,
          exercise_id: exercise.id,
          audit: {
            knowledge_scope_ids: [exercise.id, rubric.id, ...exercise.skill_ids],
            wrote_to_library: false, // 闸门 ②：AI 输出永不写回知识库
            prompt_digest: digest(prompt),
            prompt_text: prompt,
            model: usedModel,
            raw_output: text,
            human_reviewed: false,
            recorded_at: nowIso(),
            runtime,
          },
        };
      }

      // violation 一律判为不通过（forbidden 命中是错误，不是"扣分"）
      const passed = parsed.passed && !parsed.findings.some((f) => f.verdict === 'violation');

      return {
        skill_ids: exercise.skill_ids,
        passed,
        findings: parsed.findings,
        decided_by: 'ai-rubric',
        assessment_spec_id: exercise.assessment_spec_id,
        exercise_id: exercise.id,
        audit: {
          knowledge_scope_ids: [exercise.id, rubric.id, ...exercise.skill_ids],
          wrote_to_library: false,
          prompt_digest: digest(prompt),
          prompt_text: prompt,
          model: usedModel,
          raw_output: text,
          human_reviewed: false,
          recorded_at: nowIso(),
          runtime,
        },
      };
    },
  };
}

function findRubricId(exercise: Exercise, bundle: ContentBundle): string {
  const spec = bundle.assessment_specs.find((s) => s.id === exercise.assessment_spec_id);
  return spec?.rubric_id ?? '';
}

/**
 * 离线骨架判分器（无 AI）。
 *
 * 用途：静态托管（GitHub Pages）没有服务端，无法安全保存 API key 时，
 * 让用户仍能看到**反馈结构**与**自查清单**。
 *
 * **它不做任何判断** —— `decided_by = 'offline-skeleton'`，`runtime = 'offline-skeleton'`。
 * 这样它就不会被误当成 AI 判分样本而污染 H4 的评测集（V0.1 §5：H4 需人工标注 50 条做一致性检验）。
 */
export function createSkeletonRubricJudge(opts: { bundle: ContentBundle }) {
  return {
    judge(exercise: Exercise, answer: string): JudgingRecord {
      const rubricId = findRubricId(exercise, opts.bundle);
      const rubric = opts.bundle.rubrics.find((r) => r.id === rubricId);
      if (!rubric) throw new Error(`题目 ${exercise.id} 找不到对应的 Rubric`);

      // 骨架模式仍做两件**确定性**的机械检查（这是规则能做、且不该交给 AI 的部分）：
      //   ① 答案是否命中全局禁用语（确定性话术等）→ violation
      //   ② 答案是否短到不可能是完整解读 → uncertain
      const hits = scanForbiddenPhrases([{ id: 'answer', owner_id: exercise.id, text: answer }]);

      const findings: JudgeFinding[] = [
        ...hits.map((h) => ({
          key: `forbidden.global.${h.pattern_id}`,
          verdict: 'violation' as const,
          detail: `${h.reason}｜上下文：…${h.excerpt}…`,
        })),
        ...(answer.trim().length < 30
          ? [
              {
                key: 'answer.too_short',
                verdict: 'uncertain' as const,
                detail: `答案只有 ${answer.trim().length} 字，不足以构成一次完整说明（本检查是机械的，不判断内容对错）`,
              },
            ]
          : []),
        // 其余要素无法用规则判断，作为自查清单给出 —— 明确标注为 uncertain，不伪装成判分
        ...rubric.must_hit.map((x: string, i: number) => ({
          key: `must_hit[${i}]`,
          verdict: 'uncertain' as const,
          detail: `需人工或 AI 判断，请自查：${x}`,
        })),
        ...rubric.should_hit.map((x: string, i: number) => ({
          key: `should_hit[${i}]`,
          verdict: 'uncertain' as const,
          detail: `加分项（需人工/AI 判断）：${x}`,
        })),
        ...rubric.forbidden.map((x: string, i: number) => ({
          key: `forbidden[${i}]`,
          verdict: 'uncertain' as const,
          detail: `禁止项（需人工/AI 判断，命中即判不通过）：${x}`,
        })),
      ];

      return {
        skill_ids: exercise.skill_ids,
        // 骨架模式**永不给通过** —— 它没有判断能力
        passed: false,
        findings,
        decided_by: 'offline-skeleton',
        assessment_spec_id: exercise.assessment_spec_id,
        exercise_id: exercise.id,
        audit: {
          knowledge_scope_ids: [exercise.id, rubric.id, ...exercise.skill_ids],
          wrote_to_library: false,
          recorded_at: nowIso(),
          runtime: 'offline-skeleton',
          human_reviewed: false,
        },
      };
    },
  };
}

/** 由判分记录抽 Evidence（V0.1 §9.2：掌握度只由 Evidence 更新） */
export function toEvidence(record: JudgingRecord, skillId: string): {
  skill_id: string;
  dimension: '应用' | '生成';
  observed: number;
  confidence: 'high' | 'medium' | 'low';
} {
  const related = record.findings.filter((f) => f.key !== 'ai.parse_error' && f.key !== 'rule.error');
  const hits = related.filter((f) => f.verdict === 'hit').length;
  const violations = related.filter((f) => f.verdict === 'violation').length;
  const observed = related.length === 0 ? 0 : Math.max(0, hits / related.length - violations * 0.5);

  return {
    skill_id: skillId,
    dimension: record.decided_by === 'rule-engine' ? '应用' : '生成',
    observed: Number(observed.toFixed(3)),
    confidence: record.decided_by === 'rule-engine' ? 'high' : record.decided_by === 'ai-rubric' ? 'medium' : 'low',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 规则验证集执行器（M6）
// ─────────────────────────────────────────────────────────────────────────────

import type { RuleTestSet } from './layer1/rule.js';

export interface RuleTestSetResult {
  rule_id: string;
  total: number;
  passed: number;
  failures: Array<{ index: number; input: unknown; expected: unknown; actual: unknown }>;
}

export interface RuleTestSetRunner {
  run(testSet: RuleTestSet, procedure: (input: unknown) => unknown): RuleTestSetResult;
}

/**
 * 规则验证集执行器。
 *
 * M6：规则引擎必须有可验证的用例集（给定输入 → 期望输出），否则「装卦/纳甲算得对不对」
 * 无从保证。这是规则密集型体系（六爻/占星/梅花）进产品的前置条件。
 */
export function createRuleTestSetRunner(): RuleTestSetRunner {
  return {
    run(testSet, procedure) {
      const failures: RuleTestSetResult['failures'] = [];
      testSet.cases.forEach((c, index) => {
        let actual: unknown;
        try {
          actual = procedure(c.input);
        } catch (e) {
          actual = `ERROR: ${(e as Error).message}`;
        }
        if (JSON.stringify(actual) !== JSON.stringify(c.expected)) {
          failures.push({ index, input: c.input, expected: c.expected, actual });
        }
      });
      return {
        rule_id: testSet.rule_id,
        total: testSet.cases.length,
        passed: testSet.cases.length - failures.length,
        failures,
      };
    },
  };
}
