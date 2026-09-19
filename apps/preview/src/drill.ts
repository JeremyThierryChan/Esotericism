/**
 * 预览站 · 练习区（纯规则判分 + 纯规则积分）
 *
 * 全程不使用 AI：
 *   题目 → 由内容库关系表确定性生成
 *   判分 → 规则引擎（有唯一答案处不用 AI，V0.1 §12）
 *   积分 → 纯规则函数，挂在掌握度增长上（V0.1 §10.3）
 *
 * 刻意把**反刷分**显示出来：积分给 0 时会写明原因（掌握度未增长 / 重复作答衰减），
 * 让看的人能直接验证「刷题换分是数学上不划算的」，而不是听我们声称。
 */
import {
  appendToLedger,
  computeSkillMastery,
  createRuleJudge,
  dimensionValueOrNull,
  evidenceFromAttempt,
  generateExercises,
  scoreAttempt,
  toJudgeableExercise,
  type ContentBundle,
  type Evidence,
  type ExerciseInstance,
  type ExerciseTemplate,
  type ScoreLedger,
} from '@dlg/domain';

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

interface DrillState {
  instances: ExerciseInstance[];
  index: number;
  chosen: string | null;
  answered: boolean;
  attemptsByExercise: Record<string, number>;
  evidence: Evidence[];
  ledger: ScoreLedger;
  lastRender: {
    passed: boolean;
    points: number;
    reasons: string[];
    findings: Array<{ key: string; verdict: string; detail: string }>;
    masteryBefore: number | null;
    masteryAfter: number | null;
  } | null;
  answeredCount: number;
  correctCount: number;
}

export interface DrillPlan {
  template: ExerciseTemplate;
  skillId: string;
  sampled: ExerciseInstance[];
}

/**
 * 出题计划：**渲染与接线必须共用同一份**，否则首屏渲染的题与后续交互的题会不一致。
 * 抽样是确定性的（等距取样），因此不需要在两端传状态。
 */
export function buildDrillPlan(bundle: ContentBundle): DrillPlan | null {
  const template = bundle.exercise_templates[0];
  if (!template) return null;
  const all = generateExercises(bundle).instances;
  if (all.length === 0) return null;
  const pickCount = Math.min(10, all.length);
  const step = Math.max(1, Math.floor(all.length / pickCount));
  const sampled = Array.from({ length: pickCount }, (_, i) => all[(i * step) % all.length]!).filter(Boolean);
  return { template, skillId: template.skill_ids[0]!, sampled };
}

export function renderDrillSection(bundle: ContentBundle): string {
  const plan = buildDrillPlan(bundle);
  if (!plan) {
    return `<div class="card"><p class="note">内容库里没有可生成的题目（模板缺失或关系表不完整）。</p></div>`;
  }

  // 首题**直接渲染进 HTML**，而不是留给 JS 填：
  //   ① 用户不会看到「加载中…」闪烁
  //   ② 首屏可被冒烟测试验证（纯 JS 填充的内容在无头环境里验不到）
  const first = plan.sampled[0]!;
  const choices = first.answer_key.choices ?? [];

  return `
    <div class="card" id="drill">
      <div class="meta" id="drill-stats">
        <span class="tag">进度 1 / ${plan.sampled.length}</span>
        <span class="tag rule">规则判定</span>
        <span class="tag">累计积分 <b>0</b></span>
        <span class="tag">答对 0 / 已答 0</span>
        <span class="tag" title="掌握度：样本 &lt;3 时不给假数字">应用维度掌握度：数据不足</span>
        <span class="tag" title="学习节奏：只统计近 7 天有活动的天数，中断不清零">近 7 天学习 0 天</span>
      </div>
      <div class="prompt" id="drill-prompt">${esc(first.prompt)}</div>
      <div class="choices" id="drill-choices">
        ${choices
          .map(
            (c) => `<label class="choice">
          <input type="radio" name="drill-answer" value="${esc(c)}" />
          <span>${esc(c)}</span>
        </label>`,
          )
          .join('')}
      </div>
      <div class="row">
        <button data-role="drill-submit">提交</button>
        <button class="ghost" data-role="drill-next" disabled>下一题</button>
        <button class="ghost" data-role="drill-reset">重新开始</button>
      </div>
      <div id="drill-result"></div>
      <details>
        <summary>这个练习区为什么不需要 AI</summary>
        <p class="note">
          题目由内容库的<b>关系边</b>确定性生成（25 个有序对），答案由<b>规则引擎</b>从同一份真值表推出。
          判分用的是同一个规则引擎，所以「对错」是可复现的，不存在模型幻觉。
        </p>
        <p class="note">
          积分是纯规则函数：<code>认知负荷 × 难度 × 新额度 × 重复衰减</code>。
          <b>只有掌握度真的增长才给分</b>；已经掌握的内容几乎不给分；同一题重复作答按 <code>1/(1+n)</code> 衰减。
          这不是「不鼓励练习」，而是不让「练习次数」本身变成可以刷的指标（V0.1 §10.3）。
        </p>
      </details>
    </div>`;
}

const VERDICT_LABEL: Record<string, string> = { hit: '命中', miss: '未命中', violation: '违规', uncertain: '待判' };

export function wireDrill(bundle: ContentBundle, container: HTMLElement): void {
  const plan = buildDrillPlan(bundle);
  if (!plan) return;
  const template: ExerciseTemplate = plan.template;
  const skillId = plan.skillId;
  const judge = createRuleJudge({ bundle });
  const sampled = plan.sampled;

  let state: DrillState = freshState(sampled);

  function freshState(instances: ExerciseInstance[]): DrillState {
    return {
      instances,
      index: 0,
      chosen: null,
      answered: false,
      attemptsByExercise: {},
      evidence: [],
      ledger: { total: 0, entries: [] },
      lastRender: null,
      answeredCount: 0,
      correctCount: 0,
    };
  }

  /**
   * 取必需子元素。缺失时**抛明确错误**而不是让 `as T` 把 null 蒙过去 ——
   * 否则一旦 renderDrillSection 的 id 改了，报错会是
   * "Cannot set properties of null"，完全指不出是哪一处。
   */
  const el = <T extends HTMLElement>(sel: string): T => {
    const found = container.querySelector<T>(sel);
    if (!found) throw new Error(`练习区缺少必需元素 ${sel}（renderDrillSection 与 wireDrill 的 id 不一致？）`);
    return found;
  };

  function currentInstance(): ExerciseInstance | undefined {
    return state.instances[state.index];
  }

  function masteryNow(): number | null {
    return dimensionValueOrNull(computeSkillMastery(skillId, state.evidence), '应用');
  }

  function renderStats(): void {
    const m = computeSkillMastery(skillId, state.evidence);
    const applied = m.dimensions.find((d) => d.dimension === '应用');
    el('#drill-stats').innerHTML = [
      `<span class="tag">进度 ${state.index + 1} / ${state.instances.length}</span>`,
      `<span class="tag rule">规则判定</span>`,
      `<span class="tag">累计积分 <b>${state.ledger.total}</b></span>`,
      `<span class="tag">答对 ${state.correctCount} / 已答 ${state.answeredCount}</span>`,
      `<span class="tag" title="掌握度：样本 &lt;3 时不给假数字">应用维度掌握度：${
        applied ? esc(String(applied.display)) : '数据不足'
      }${applied ? `（样本 ${applied.samples}，${esc(applied.status)}）` : ''}</span>`,
      `<span class="tag" title="学习节奏：只统计近 7 天有活动的天数，中断不清零">近 7 天学习 ${new Set(
        state.evidence.map((e) => e.created_at.slice(0, 10)),
      ).size} 天</span>`,
    ].join('');
  }

  function renderQuestion(): void {
    const inst = currentInstance();
    if (!inst) return;
    el('#drill-prompt').textContent = inst.prompt;
    const choices = inst.answer_key.choices ?? [];
    el('#drill-choices').innerHTML = choices
      .map(
        (c) => `<label class="choice">
          <input type="radio" name="drill-answer" value="${esc(c)}"${state.chosen === c ? ' checked' : ''}${
            state.answered ? ' disabled' : ''
          } />
          <span>${esc(c)}</span>
        </label>`,
      )
      .join('');
    el<HTMLButtonElement>('[data-role="drill-submit"]').disabled = state.answered;
    el<HTMLButtonElement>('[data-role="drill-next"]').disabled = !state.answered;
    el('#drill-result').innerHTML = '';
    if (state.answered && state.lastRender) renderResult();
  }

  function renderResult(): void {
    const r = state.lastRender;
    const inst = currentInstance();
    if (!r || !inst) return;

    const correctLabel = String((inst.answer_key.expected as { label?: string }).label ?? '');

    // 选项着色
    container.querySelectorAll<HTMLElement>('.choice').forEach((label) => {
      label.classList.remove('correct', 'wrong');
      const text = label.querySelector('span')?.textContent ?? '';
      if (text === correctLabel) label.classList.add('correct');
      else if (text === state.chosen) label.classList.add('wrong');
    });

    const masteryLine =
      r.masteryBefore === null || r.masteryAfter === null
        ? `掌握度：样本不足（<3），本次不计入增长幅度，按「首次接触」给分`
        : `掌握度：${r.masteryBefore.toFixed(2)} → ${r.masteryAfter.toFixed(2)}`;

    el('#drill-result').innerHTML = `
      <div class="verdict ${r.passed ? 'pass' : 'fail'}">${r.passed ? '✅ 回答正确' : '❌ 回答不正确'}</div>
      <div class="meta">
        <span class="tag rule">判分：规则引擎（AI 未介入）</span>
        <span class="tag ${r.points > 0 ? 'rule' : 'draft'}">本次积分 +${r.points}</span>
        <span class="tag">累计 ${state.ledger.total}</span>
      </div>
      <ul class="findings">
        ${r.findings
          .map(
            (f) =>
              `<li><span class="v ${esc(f.verdict)}">${esc(VERDICT_LABEL[f.verdict] ?? f.verdict)}</span><span><span class="mono">${esc(
                f.key,
              )}</span> — ${esc(f.detail)}</span></li>`,
          )
          .join('')}
      </ul>
      <p class="note">${esc(masteryLine)}</p>
      <p class="note ${r.points === 0 ? 'warn' : ''}"><b>积分依据：</b>${r.reasons.map((x) => esc(x)).join('　·　')}</p>
    `;
  }

  function submit(): void {
    const inst = currentInstance();
    if (!inst || state.answered) return;
    const picked = container.querySelector<HTMLInputElement>('input[name="drill-answer"]:checked');
    if (!picked) {
      el('#drill-result').innerHTML = `<p class="note warn">请先选一个答案。</p>`;
      return;
    }
    state.chosen = picked.value;

    const ex = toJudgeableExercise(inst, template);
    const record = judge.judge(ex, state.chosen);

    const before = masteryNow();
    const ev = evidenceFromAttempt({
      attempt_id: `at.${state.answeredCount + 1}`,
      exercise_kind: inst.kind,
      skill_id: skillId,
      passed: record.passed,
      decided_by: record.decided_by,
      submitted_at: new Date().toISOString(),
    });
    state.evidence.push(ev);
    const after = masteryNow();

    const prior = state.attemptsByExercise[inst.id] ?? 0;
    const score = scoreAttempt({
      exercise_id: inst.id,
      exercise_kind: inst.kind,
      difficulty: inst.difficulty,
      mastery_before: before,
      mastery_after: after,
      prior_attempts_on_this_exercise: prior,
      passed: record.passed,
    });
    state.attemptsByExercise[inst.id] = prior + 1;
    state.ledger = appendToLedger(state.ledger, {
      ...score,
      attempt_id: ev.id,
      exercise_id: inst.id,
      skill_ids: inst.skill_ids,
      at: ev.created_at,
    });

    state.answered = true;
    state.answeredCount++;
    if (record.passed) state.correctCount++;
    state.lastRender = {
      passed: record.passed,
      points: score.points,
      reasons: score.reasons,
      findings: record.findings.map((f) => ({ key: f.key, verdict: f.verdict, detail: f.detail })),
      masteryBefore: before,
      masteryAfter: after,
    };

    renderStats();
    renderQuestion();
  }

  function next(): void {
    if (state.index >= state.instances.length - 1) {
      el('#drill-result').innerHTML = `
        <div class="verdict pass">🎉 这一轮做完了：${state.correctCount} / ${state.answeredCount} 答对，累计积分 ${state.ledger.total}</div>
        <p class="note">再点「重新开始」会重置本页状态。积分不落库（静态站没有数据库）—— 这一版只是把闭环跑通给人看。</p>`;
      el<HTMLButtonElement>('[data-role="drill-next"]').disabled = true;
      el<HTMLButtonElement>('[data-role="drill-submit"]').disabled = true;
      return;
    }
    state.index++;
    state.chosen = null;
    state.answered = false;
    state.lastRender = null;
    renderStats();
    renderQuestion();
  }

  container.querySelector('[data-role="drill-submit"]')?.addEventListener('click', submit);
  container.querySelector('[data-role="drill-next"]')?.addEventListener('click', next);
  container.querySelector('[data-role="drill-reset"]')?.addEventListener('click', () => {
    state = freshState(sampled);
    renderStats();
    renderQuestion();
  });
  // 选中即记录（提交时再读一次也行，这里保持与单选交互一致）
  container.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'drill-answer') state.chosen = t.value;
  });

  renderStats();
  renderQuestion();
}
