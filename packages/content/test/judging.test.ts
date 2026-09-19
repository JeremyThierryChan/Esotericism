/**
 * 判分闭环测试（ADR-0008 step 3 的核心）
 *
 * 验收标准：「提交真实答案 → 六段式反馈且**过程可审计**」。
 * 因此这里不只测判分对不对，还测**审计链的不变式**（V0.1 §12 三道闸门）。
 */
import { describe, expect, it } from 'vitest';
import {
  buildRubricPrompt,
  createRuleJudge,
  createRubricJudge,
  createSkeletonRubricJudge,
  digest,
  parseJudgeJson,
  toEvidence,
  validateBundle,
  type ContentBundle,
  type Exercise,
  type LlmCaller,
} from '@dlg/domain';
import { loadBundle } from '../src/load.js';

let bundle: ContentBundle;
const getBundle = async (): Promise<ContentBundle> => {
  if (!bundle) {
    const loaded = await loadBundle();
    if (!loaded.ok || !loaded.bundle) throw new Error('bundle.json 未通过 schema 校验');
    bundle = loaded.bundle;
  }
  return bundle;
};

const ruleExercise = async (): Promise<Exercise> => {
  const b = await getBundle();
  const ex = b.exercises.find((e) => e.kind === '关系判断');
  if (!ex) throw new Error('内容库缺少关系判断题');
  return ex;
};

const openExercise = async (): Promise<Exercise> => {
  const b = await getBundle();
  const ex = b.exercises.find((e) => e.kind === '开放式解读' && !e.is_reverse_exercise_of_edge_id);
  if (!ex) throw new Error('内容库缺少开放式题');
  return ex;
};

// ─────────────────────────────────────────────────────────────────────────────

describe('规则判分 · 真跑（AI 不介入）', () => {
  it('答对时 passed = true，且 decided_by = rule-engine', async () => {
    const b = await getBundle();
    const judge = createRuleJudge({ bundle: b });
    const ex = await ruleExercise();
    const record = judge.judge(ex, { a: '木', b: '火' });

    expect(record.decided_by).toBe('rule-engine');
    expect(record.passed).toBe(true);
    expect(record.findings.every((f) => f.verdict === 'hit')).toBe(true);
  });

  it('答错时 passed = false，并指出期望值与实际值', async () => {
    const b = await getBundle();
    const judge = createRuleJudge({ bundle: b });
    const ex = await ruleExercise();
    // 木 → 土 应为「克」，这里故意给反方向的输入
    const record = judge.judge(ex, { a: '火', b: '木' });

    expect(record.passed).toBe(false);
    const miss = record.findings.find((f) => f.verdict === 'miss');
    expect(miss).toBeDefined();
    expect(miss?.detail).toContain('期望');
    expect(miss?.detail).toContain('实际');
  });

  it('判分真值表来自内容库，不是代码常量（改内容库即改判分）', async () => {
    const b = await getBundle();
    const ex = await ruleExercise();

    // 复制一份内容库，把「木生火」这条边删掉
    const mutated: ContentBundle = {
      ...b,
      relations: b.relations.filter((r) => !(r.from_symbol_id === 'sym.wuxing.木' && r.to_symbol_id === 'sym.wuxing.火')),
    };
    const mutatedJudge = createRuleJudge({ bundle: mutated });
    const record = mutatedJudge.judge(ex, { a: '木', b: '火' });

    expect(record.passed).toBe(false);
  });

  it('规则判分器的审计记录：runtime 明确、写回知识库恒为 false', async () => {
    const b = await getBundle();
    const judge = createRuleJudge({ bundle: b });
    const record = judge.judge(await ruleExercise(), { a: '木', b: '火' });

    expect(record.audit.wrote_to_library).toBe(false);
    expect(record.audit.knowledge_scope_ids).toContain('rule.wuxing.shengke');
    expect(record.audit.human_reviewed).toBe(false);
    expect(new Date(record.audit.recorded_at).toString()).not.toBe('Invalid Date');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Rubric 判分 · 提示词与解析', () => {
  it('提示词注入了 Rubric 全文与可引用条目 ID（闸门 ①：知识边界）', async () => {
    const b = await getBundle();
    const ex = await openExercise();
    const spec = b.assessment_specs.find((s) => s.id === ex.assessment_spec_id);
    const rubric = b.rubrics.find((r) => r.id === spec?.rubric_id);
    expect(rubric).toBeDefined();

    const { system, user } = buildRubricPrompt(ex, rubric!, b);

    for (const item of rubric!.must_hit) expect(user).toContain(item);
    for (const item of rubric!.forbidden) expect(user).toContain(item);
    expect(user).toContain(ex.id);
    expect(user).toContain(rubric!.id);
    // 关键的硬约束必须在系统提示里
    expect(system).toContain('不得引入任何未给出的术数对应关系');
    expect(system).toContain('只判断解读的过程规范性与完整性');
    expect(system).toContain('严格 JSON');
  });

  it('能解析模型输出（容忍 markdown 代码围栏）', () => {
    const text = '```json\n{"passed": true, "findings": [{"key":"must_hit[0]","verdict":"hit","detail":"ok"}]}\n```';
    const parsed = parseJudgeJson(text);
    expect(parsed.passed).toBe(true);
    expect(parsed.findings[0]?.verdict).toBe('hit');
  });

  it('非法的 verdict 值被规整为 uncertain（不静默丢弃）', () => {
    const parsed = parseJudgeJson('{"passed": false, "findings": [{"key":"x","verdict":"怪值","detail":"d"}]}');
    expect(parsed.findings[0]?.verdict).toBe('uncertain');
  });

  it('模型输出不是 JSON 时抛出可识别错误', () => {
    expect(() => parseJudgeJson('我觉得这个答案还行。')).toThrow(/没有 JSON 对象/);
  });

  it('命中 violation 时一律判不通过（forbidden 是错误，不是扣分）', async () => {
    const b = await getBundle();
    const ex = await openExercise();
    const caller: LlmCaller = async () => ({
      text: JSON.stringify({
        passed: true, // 模型自己说通过
        findings: [{ key: 'forbidden[0]', verdict: 'violation', detail: '断言了同源' }],
      }),
      model: 'test-model',
    });
    const judge = createRubricJudge({ bundle: b, caller, runtime: 'server' });
    const record = await judge.judge(ex, '塔罗与占星本相通。');

    expect(record.passed).toBe(false);
    expect(record.decided_by).toBe('ai-rubric');
  });

  it('闸门 ② 与 ③：AI 判分记录写回知识库恒为 false，且 prompt/model/输出全部落审计', async () => {
    const b = await getBundle();
    const ex = await openExercise();
    const caller: LlmCaller = async () => ({
      text: '{"passed":true,"findings":[]}',
      model: 'test-model-v1',
    });
    const judge = createRubricJudge({ bundle: b, caller, runtime: 'server' });
    const record = await judge.judge(ex, '这是一段足够长的答案，用来通过长度检查并产生审计记录。');

    expect(record.audit.wrote_to_library).toBe(false);
    expect(record.audit.model).toBe('test-model-v1');
    expect(record.audit.raw_output).toContain('passed');
    expect(record.audit.prompt_digest).toMatch(/^[0-9a-f]{16}$/);
    expect(record.audit.prompt_text).toContain(ex.prompt);
    expect(record.audit.human_reviewed).toBe(false);
    expect(record.audit.runtime).toBe('server');
  });

  it('模型输出无法解析时，判分失败但审计仍然完整（可事后复盘）', async () => {
    const b = await getBundle();
    const ex = await openExercise();
    const caller: LlmCaller = async () => ({ text: '抱歉，我无法判断。', model: 'm' });
    const judge = createRubricJudge({ bundle: b, caller });
    const record = await judge.judge(ex, '一段够长的答案内容，用于触发正常路径。');

    expect(record.passed).toBe(false);
    expect(record.findings[0]?.key).toBe('ai.parse_error');
    expect(record.audit.raw_output).toBe('抱歉，我无法判断。');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('离线骨架判分 · 不伪装成 AI', () => {
  it('decided_by 与 runtime 都标为 offline-skeleton，且 pass 恒为 false', async () => {
    const b = await getBundle();
    const judge = createSkeletonRubricJudge({ bundle: b });
    const record = judge.judge(await openExercise(), '这是一段足够长的答案内容，用于测试骨架模式的行为。');

    expect(record.decided_by).toBe('offline-skeleton');
    expect(record.audit.runtime).toBe('offline-skeleton');
    expect(record.passed).toBe(false);
  });

  it('确定性检查仍然生效：命中禁用语 → violation', async () => {
    const b = await getBundle();
    const judge = createSkeletonRubricJudge({ bundle: b });
    const record = judge.judge(await openExercise(), '这件事一定会成，你前任必然回来找你。');

    const violations = record.findings.filter((f) => f.verdict === 'violation');
    expect(violations.length).toBeGreaterThan(0);
  });

  it('过短的答案被标为 uncertain（机械检查，不判断内容对错）', async () => {
    const b = await getBundle();
    const judge = createSkeletonRubricJudge({ bundle: b });
    const record = judge.judge(await openExercise(), '不知道');

    expect(record.findings.some((f) => f.key === 'answer.too_short')).toBe(true);
  });

  it('Rubric 逐条被摊成自查清单（must_hit / should_hit / forbidden 都出现）', async () => {
    const b = await getBundle();
    const judge = createSkeletonRubricJudge({ bundle: b });
    const ex = await openExercise();
    const spec = b.assessment_specs.find((s) => s.id === ex.assessment_spec_id);
    const rubric = b.rubrics.find((r) => r.id === spec?.rubric_id)!;
    const record = judge.judge(ex, '这是一段足够长的答案内容，用于测试自查清单是否完整。');

    expect(record.findings.filter((f) => f.key.startsWith('must_hit['))).toHaveLength(rubric.must_hit.length);
    expect(record.findings.filter((f) => f.key.startsWith('forbidden['))).toHaveLength(rubric.forbidden.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Evidence 导出 · 掌握度只由 Evidence 更新', () => {
  it('规则判分的证据置信度高于 AI 判分', async () => {
    const b = await getBundle();
    const ex = await ruleExercise();
    const ruleRecord = createRuleJudge({ bundle: b }).judge(ex, { a: '木', b: '火' });
    const aiRecord = await createRubricJudge({
      bundle: b,
      caller: async () => ({ text: '{"passed":true,"findings":[{"key":"must_hit[0]","verdict":"hit","detail":"ok"}]}', model: 'm' }),
    }).judge(await openExercise(), '一段足够长的答案，用于产生证据。');

    expect(toEvidence(ruleRecord, ex.skill_ids[0]!).confidence).toBe('high');
    expect(toEvidence(aiRecord, aiRecord.skill_ids[0]!).confidence).toBe('medium');
  });

  it('违规会拉低观测值，而不是与命中同权', async () => {
    const b = await getBundle();
    const ex = await openExercise();
    const record = await createRubricJudge({
      bundle: b,
      caller: async () => ({
        text: JSON.stringify({
          passed: false,
          findings: [
            { key: 'must_hit[0]', verdict: 'hit', detail: '' },
            { key: 'forbidden[0]', verdict: 'violation', detail: '' },
          ],
        }),
        model: 'm',
      }),
    }).judge(ex, '一段足够长的答案内容，用于产生证据样本。');

    expect(toEvidence(record, record.skill_ids[0]!).observed).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('digest · 审计摘要稳定', () => {
  it('同输入同摘要，异输入异摘要', () => {
    expect(digest('abc')).toBe(digest('abc'));
    expect(digest('abc')).not.toBe(digest('abd'));
    expect(digest('abc')).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('内容库仍然通过 CI（判分闭环没有破坏任何约束）', () => {
  it('零 error', async () => {
    const b = await getBundle();
    const report = validateBundle(b);
    if (report.errors.length > 0) {
      throw new Error(report.errors.map((e) => `[${e.rule}] ${e.entity_id}: ${e.message}`).join('\n'));
    }
    expect(report.ok).toBe(true);
  });
});
