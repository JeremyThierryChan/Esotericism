/**
 * 判分器接口定义
 *
 * 依据：V0.1 §12（规则引擎 vs AI 的分工）、V0.2 §6（M4：Rule 与判分器接口必须在
 * step 1 定义，**即使 MVP 用不到**）
 *
 * 总原则：**能确定的一律交给规则；只有"没有唯一正确答案"的部分才交给 AI。**
 *
 * ⚠️ 这是本阶段最重要的工程警告（V0.2 §5.2）：如果只做塔罗就以为"这个产品不需要规则
 * 引擎"，做六爻时才会发现架构缺一大块，而那时 schema 已经写进内容条目里了。schema 的
 * 改动成本远高于实现。所以接口现在定，实现只做 spike。
 */
import type { JudgingMode } from './layer2/skill.js';
import type { RuleTestSet } from './layer1/rule.js';

/** 判分请求的共同结构 */
export interface JudgeRequest<TPayload = unknown> {
  skill_id: string;
  /** 用户答案（自由文本或结构化） */
  answer: TPayload;
  /** 判分上下文（题目、规则、规约等） */
  context: {
    /** 规则判定时使用 */
    rule_ids?: readonly string[];
    /** Rubric 判定时使用 */
    rubric_id?: string;
  };
}

/** 判分明细：可审计是硬要求（V0.1 §12 第三道闸门：落库可审计） */
export interface JudgeFinding {
  /** 命中项在 Rubric/Rule 中的标识 */
  key: string;
  /** 判定结果 */
  verdict: 'hit' | 'miss' | 'violation' | 'uncertain';
  /** 人类可读说明 */
  detail: string;
}

export interface JudgeResult {
  skill_id: string;
  /** 是否通过（阈值判定由规则系统做，这里只给原始分项） */
  passed: boolean;
  findings: JudgeFinding[];
  /**
   * 判分来源。审计必填：区分"规则算出来的"与"AI 判的"。
   * AI 判分天然置信度更低，V0.6 的 Mastery 必须按 kind 分两套算法（V0.2 M7）。
   */
  decided_by: 'rule-engine' | 'ai-rubric' | 'ai-assisted';
  /** AI 判分必须记录可复核信息（V0.1 §12） */
  audit?: {
    prompt_digest?: string;
    model?: string;
    raw_output?: string;
    human_reviewed?: boolean;
  };
}

/**
 * 规则判分器：由**规则引擎**执行，AI 不得介入。
 * 适用 `judging_mode = '规则判定'`（六爻 L1.1–L11.1 共 9 个 Skill 属此类）。
 */
export interface RuleJudge<TPayload = unknown> {
  readonly kind: 'rule-engine';
  /** 声明它支持哪些 Skill 的判分方式 */
  supports(judgingMode: JudgingMode): boolean;
  judge(request: JudgeRequest<TPayload>): JudgeResult;
}

/**
 * Rubric 判分器：AI 按判分规约打分 + 反馈。
 * 适用含 Rubric 的 `judging_mode`（塔罗 12/17 技能属此类）。
 * 硬约束：强制 JSON Schema；按固定六段反馈结构输出（V0.1 §11.1）。
 */
export interface RubricJudge<TPayload = unknown> {
  readonly kind: 'ai-rubric';
  supports(judgingMode: JudgingMode): boolean;
  judge(request: JudgeRequest<TPayload>): Promise<JudgeResult>;
}

/**
 * 规则验证集执行器（M6）。
 * 规则引擎必须有可验证的用例集（给定输入 → 期望输出），否则"装卦/纳甲算得对不对"
 * 无从保证。这是六爻/占星进产品的**前置条件**。
 */
export interface RuleTestSetRunner {
  run(testSet: RuleTestSet, procedure: (input: unknown) => unknown): RuleTestSetResult;
}

export interface RuleTestSetResult {
  rule_id: string;
  total: number;
  passed: number;
  failures: Array<{ index: number; input: unknown; expected: unknown; actual: unknown }>;
}

export function createRuleTestSetRunner(): RuleTestSetRunner {
  return {
    run(testSet, procedure) {
      const failures: RuleTestSetResult['failures'] = [];
      testSet.cases.forEach((c, index) => {
        const actual = procedure(c.input);
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
