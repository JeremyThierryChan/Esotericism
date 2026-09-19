/**
 * 试玩预览站（ADR-0008 step 3 的「试玩预览页」）
 *
 * ⚠️ 架构约束（GitHub Pages）：**这是纯静态站，没有服务端。**
 *   · 规则判分 → 在浏览器里真跑（规则引擎是纯 TS，无 Node 依赖）
 *   · AI 判分   → Pages 上没有安全的 key 存放处，因此退化为：
 *                   (a) 离线骨架（确定性机械检查 + 自查清单）
 *                   (b) 可选「自带 endpoint + key」直连（key 只存本机 localStorage）
 *   → 结论：**Pages 版能验证"功能与内容"，但不能作为 H4（AI 判分稳定性）的验证载体。**
 *     H4 需要服务端调用 + 落库审计，属私有部署。
 *
 * 所有渲染都从 `bundle.json` 读，页面里不硬编码任何术数内容 ——
 * 与规则引擎同样的理由：理论只存在于内容库，而内容库每一条都带来源与审核状态。
 */
import {
  contentBundleSchema,
  createSkeletonRubricJudge,
  validateBundle,
  type ContentBundle,
  type Exercise,
  type JudgingRecord,
} from '@dlg/domain';
// 直接 import 内容库 JSON —— 浏览器里没有 node:fs，所以不能用 @dlg/content 的 Node 版 loader。
// 走的是同一个 schema，因此与 CI 校验完全一致。
import rawBundle from '@dlg/content/bundle.json';
import { renderDrillSection, wireDrill } from './drill.js';

const appEl = document.querySelector<HTMLDivElement>('#app');
if (!appEl) throw new Error('缺少 #app 容器');
/** 收窄后固定类型，避免跨函数 narrowing 失效 */
const app: HTMLDivElement = appEl;

// ─────────────────────────────────────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────────────────────────────────────

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const verdictLabel: Record<string, string> = {
  hit: '命中',
  miss: '未命中',
  violation: '违规',
  uncertain: '待判',
};

const decidedByLabel: Record<string, string> = {
  'rule-engine': '规则引擎（AI 未介入）',
  'ai-rubric': 'AI 按 Rubric 判分',
  'ai-assisted': '半规则 + AI',
  'offline-skeleton': '离线骨架（未做判断）',
};

function renderFindings(findings: JudgingRecord['findings']): string {
  if (findings.length === 0) return '<p class="note">（无判分明细）</p>';
  return `<ul class="findings">${findings
    .map(
      (f) =>
        `<li><span class="v ${f.verdict}">${verdictLabel[f.verdict] ?? f.verdict}</span><span><span class="mono">${esc(
          f.key,
        )}</span> — ${esc(f.detail)}</span></li>`,
    )
    .join('')}</ul>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 启动
// ─────────────────────────────────────────────────────────────────────────────

function main(): void {
  const parsed = contentBundleSchema.safeParse(rawBundle);
  if (!parsed.success) {
    app.innerHTML = `<div class="wrap"><div class="card"><h3>内容库未通过 schema 校验</h3><pre>${esc(
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n'),
    )}</pre></div></div>`;
    return;
  }

  const bundle: ContentBundle = parsed.data;
  const report = validateBundle(bundle);
  const skeletonJudge = createSkeletonRubricJudge({ bundle });

  app.innerHTML = `
    <div class="banner">
      <b>内部预览 · 内容未经人工复核。</b>
      本站全部知识条目状态为 <code>draft</code>，唯一来源 R1 自身也是 <code>draft</code>。
      按产品铁律（认识论原则 3），只有 <code>reviewed</code> 可上线——因此本页<b>不是产品</b>，
      仅用于内部评审功能与内容格式。所有输出<b>不构成任何预测或建议</b>。
    </div>
    <div class="wrap">
      <header class="site">
        <h1>术数学习游戏 · 试玩预览</h1>
        <div class="sub">像学语言一样学术数 —— 通过已经掌握的一套术数，学习另一套术数</div>
      </header>

      <h2><span class="idx">01</span>内容库状态</h2>
      <div class="card">
        <div class="meta">
          <span class="tag draft">全部条目 draft</span>
          <span class="tag">CI 校验：${report.ok ? '通过' : '失败'}</span>
          <span class="tag">error ${report.errors.length} / warning ${report.warnings.length}</span>
        </div>
        <table>
          <tr><th>实体</th><th>数量</th><th>实体</th><th>数量</th></tr>
          <tr><td>Formalism 形式系统</td><td>${bundle.formalism.length}</td><td>Symbol 符号</td><td>${bundle.symbols.length}</td></tr>
          <tr><td>System 体系</td><td>${bundle.systems.length}</td><td>Relation 关系</td><td>${bundle.relations.length}</td></tr>
          <tr><td>Skill 能力</td><td>${bundle.skills.length}</td><td>Rule 规则</td><td>${bundle.rules.length}</td></tr>
          <tr><td>Rubric 判分规约</td><td>${bundle.rubrics.length}</td><td>Exercise 题目</td><td>${bundle.exercises.length}</td></tr>
          <tr><td>迁移边</td><td>${bundle.transfer_edges.length}</td><td>评测量规</td><td>${bundle.assessment_specs.length}</td></tr>
        </table>
        <p class="note">数据来源：<code>packages/content/bundle.json</code>（内容库唯一事实来源，改动即触发 CI 校验）</p>
      </div>

      <h2><span class="idx">02</span>练习区（纯规则判分 + 纯规则积分 · 真跑）</h2>
      ${renderDrillSection(bundle)}

      <h2><span class="idx">03</span>做一道开放题（AI 判分 · 静态站受限）</h2>
      ${renderRubricExercise(bundle, skeletonJudge)}

      <h2><span class="idx">04</span>这一条跨体系对应是怎么来的</h2>
      ${renderTransferEdge(bundle)}

      <h2><span class="idx">05</span>溯源面板</h2>
      ${renderProvenance(bundle)}

      <footer>
        <div>术数学习游戏 · 内部预览 · 由 <code>apps/preview</code> 构建（纯静态，可部署到 GitHub Pages）</div>
        <div>架构决策与待复核事项见仓库 README 与 <code>packages/*/STEP*-REPORT.md</code>。</div>
      </footer>
    </div>
  `;

  const drillEl = document.querySelector<HTMLElement>('#drill');
  if (drillEl) wireDrill(bundle, drillEl);
  wireRubricExercise(bundle, skeletonJudge);
}

// ─────────────────────────────────────────────────────────────────────────────
// 03 · Rubric 开放题
// ─────────────────────────────────────────────────────────────────────────────

function renderRubricExercise(bundle: ContentBundle, _judge: unknown): string {
  const ex = bundle.exercises.find((e) => e.kind === '开放式解读' && !e.is_reverse_exercise_of_edge_id);
  if (!ex) return '<div class="card"><p class="note">内容库里没有开放式题。</p></div>';

  const spec = bundle.assessment_specs.find((s) => s.id === ex.assessment_spec_id);
  const rubric = bundle.rubrics.find((r) => r.id === spec?.rubric_id);
  const skill = bundle.skills.find((s) => ex.skill_ids.includes(s.id));

  return `
    <div class="card" data-ex-rubric="${esc(ex.id)}">
      <div class="meta">
        <span class="tag rubric">Rubric + AI</span>
        <span class="tag">题型 ${esc(ex.kind)}</span>
        <span class="tag" title="judging_mode">${esc(skill?.judging_mode ?? '')}</span>
      </div>
      <div class="prompt">${esc(ex.prompt)}</div>
      <textarea data-role="answer" placeholder="写下你的答案。判分看的是过程规范与完整性，不是「猜得准不准」。"></textarea>
      <div class="row">
        <button data-role="submit-skeleton">用离线骨架检查</button>
        <button class="ghost" data-role="show-rubric">看判分规约</button>
      </div>
      <div data-role="result"></div>
      <div data-role="rubric" hidden>
        <div class="hr"></div>
        <h3>判分规约 <span class="mono">${esc(rubric?.id ?? '')}</span></h3>
        <dl class="kv">
          <dt>必需要素</dt><dd>${(rubric?.must_hit ?? []).map((x) => esc(x)).join('<br>')}</dd>
          <dt>加分要素</dt><dd>${(rubric?.should_hit ?? []).map((x) => esc(x)).join('<br>') || '—'}</dd>
          <dt>禁止项</dt><dd>${(rubric?.forbidden ?? []).map((x) => esc(x)).join('<br>') || '—'}</dd>
          <dt>过程规范</dt><dd>${(rubric?.process_rules ?? []).map((x) => esc(x)).join('<br>') || '—'}</dd>
          <dt>流派差异</dt><dd>${esc(rubric?.school_variance ?? '—')}</dd>
        </dl>
        <p class="note">
          六段反馈结构：${Object.values(rubric?.feedback_template ?? {}).map((x) => esc(String(x))).join(' → ')}
        </p>
      </div>
      <details>
        <summary>为什么不在这里真跑 AI 判分</summary>
        <p class="note">
          GitHub Pages 是<b>纯静态托管，没有服务端</b>，因此没有 API key 的安全存放处。
          把 key 放进网页 = 任何人查看源码即可拿走 = 你的额度会被陌生人用掉。
          所以这里只做两件<b>确定性</b>的事：扫禁用语、查答案长度是否过短；其余要素列为自查清单，
          并标注 <code>uncertain</code>（待判）—— <b>不伪装成 AI 判分</b>。
        </p>
        <p class="note">
          真正的 AI 判分闭环（服务端调用 + 三道闸门审计 + 落库）属<b>私有部署</b>，
          那是验证 H4「AI 能稳定执行 Rubric 判分」的载体。
        </p>
      </details>
    </div>`;
}

function wireRubricExercise(bundle: ContentBundle, judge: ReturnType<typeof createSkeletonRubricJudge>): void {
  const card = document.querySelector<HTMLElement>('[data-ex-rubric]');
  if (!card) return;
  const exId = card.dataset.exRubric as string;
  const ex = bundle.exercises.find((e) => e.id === exId) as Exercise;
  const textarea = card.querySelector<HTMLTextAreaElement>('[data-role="answer"]');
  const resultEl = card.querySelector<HTMLElement>('[data-role="result"]');
  if (!textarea || !resultEl) return;

  card.querySelector('[data-role="submit-skeleton"]')?.addEventListener('click', () => {
    if (textarea.value.trim().length === 0) {
      resultEl.innerHTML = `<p class="note warn">请先写下你的答案。</p>`;
      return;
    }
    const record = judge.judge(ex, textarea.value);
    const violations = record.findings.filter((f) => f.verdict === 'violation');
    resultEl.innerHTML = `
      <div class="verdict ${violations.length > 0 ? 'fail' : ''}">
        ${violations.length > 0 ? '⛔ 机械检查命中违规项' : '⚠️ 机械检查未发现问题（这不等于答案正确）'}
      </div>
      <div class="meta">
        <span class="tag">${esc(decidedByLabel[record.decided_by] ?? record.decided_by)}</span>
        <span class="tag">runtime: ${esc(record.audit.runtime)}</span>
        <span class="tag">pass 恒为 false</span>
      </div>
      ${renderFindings(record.findings)}
      <p class="note">
        注意每条都是「待判」而不是「命中」—— 骨架没有判断能力。它之所以有用，是因为它把
        <b>Rubric 逐条摊开给你自查</b>，并且能确定性地拦住禁用语。
      </p>
    `;
  });

  card.querySelector('[data-role="show-rubric"]')?.addEventListener('click', () => {
    const el = card.querySelector<HTMLElement>('[data-role="rubric"]');
    if (el) el.hidden = !el.hidden;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 04 · 跨体系节点
// ─────────────────────────────────────────────────────────────────────────────

function renderTransferEdge(bundle: ContentBundle): string {
  const edge = bundle.transfer_edges[0];
  if (!edge) return '<div class="card"><p class="note">内容库里没有迁移边。</p></div>';

  const from = bundle.symbols.find((s) => s.id === edge.from_node_id);
  const to = bundle.symbols.find((s) => s.id === edge.to_node_id);
  const fp = edge.four_part_structure;
  const rev = bundle.exercises.find((e) => e.id === edge.paired_reverse_exercise_id);

  const threeLabels: Record<number, string> = {
    3: '历史影响（有可查证的传播／借用关系）',
    4: '功能类比（结构相似、来源无关）',
    5: '修辞比喻（不进教学内容）',
  };

  return `
    <div class="card">
      <div class="meta">
        <span class="tag type3">类型 ${edge.transfer_type} · ${esc(threeLabels[edge.transfer_type] ?? '')}</span>
        <span class="tag">historicity = ${esc(edge.historicity ?? '—')}</span>
        <span class="tag">来源强度 ${esc(edge.source_strength)}</span>
      </div>

      <div class="prompt">
        <b>${esc(from?.canonical_name ?? edge.from_node_id)}</b>
        <span class="mono">(${esc(from?.formalism_id ?? '')})</span>
        &nbsp;⟶&nbsp;
        <b>${esc(to?.canonical_name ?? edge.to_node_id)}</b>
        <span class="mono">(${esc(to?.formalism_id ?? '')})</span>
      </div>

      <p class="note">
        两端分属<b>不同 Formalism</b> —— 所以在数据结构上它是<b>一条边</b>，而不是"共享符号"。
        这正是 ADR-0009 要解决的问题：如果两者被塞进同一个「西方秘教形式系统」，
        塔罗的符号就会变成占星的共享符号，等于用数据结构断言两者同源。
      </p>

      <h3>四段式结构（缺一不可）</h3>
      <dl class="kv">
        <dt>① 你已掌握</dt><dd>${esc(fp?.known ?? '—')}</dd>
        <dt>② 新体系中</dt><dd>${esc(fp?.in_new_system ?? '—')}</dd>
        <dt>③ 关系声明</dt><dd>${esc(fp?.relation_declaration ?? '—')}</dd>
        <dt>④ 迁移练习</dt><dd class="mono">${esc(fp?.transfer_exercise_id ?? '—')}</dd>
        <dt>④b 反向练习</dt><dd class="mono">${esc(edge.paired_reverse_exercise_id ?? '—')}${
          rev ? `　<span class="note">→ ${esc(rev.prompt.slice(0, 60))}…</span>` : ''
        }</dd>
      </dl>

      <h3>文献链（来源即证据）</h3>
      <table>
        <tr><th>来源</th><th>置信度</th></tr>
        ${edge.sources
          .map(
            (s) =>
              `<tr><td>${esc(s.ref)}${s.note ? `<br><span class="note">${esc(s.note)}</span>` : ''}</td><td>${esc(
                s.confidence ?? '—',
              )}</td></tr>`,
          )
          .join('')}
      </table>

      <p class="note warn">
        historicity = <b>重建</b> 意味着：这条对应是 19 世纪西方秘教传统<b>建构出来的</b>，不是塔罗原生理论。
        表述必须是「这是 Golden Dawn 的建构」，绝不能是「塔罗与占星本相通」。
        反向练习用的素材是可查证史实（RWS 与托特在 VIII／XI 上次序相反），不是编的教学例子。
      </p>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 05 · 溯源面板
// ─────────────────────────────────────────────────────────────────────────────

function renderProvenance(bundle: ContentBundle): string {
  const rows: Array<{ kind: string; id: string; strength: string; status: string; sources: string; controversy: string }> = [];

  const push = (kind: string, items: Array<{ id: string; provenance: { source_strength: string; review_status: string; sources: Array<{ ref: string }>; controversy_flag: boolean } }>): void => {
    for (const it of items) {
      rows.push({
        kind,
        id: it.id,
        strength: it.provenance.source_strength,
        status: it.provenance.review_status,
        sources: it.provenance.sources.map((s) => s.ref).join('；'),
        controversy: it.provenance.controversy_flag ? '有争议' : '—',
      });
    }
  };

  push('Formalism', bundle.formalism);
  push('System', bundle.systems);
  push('School', bundle.schools);
  push('Rule', bundle.rules);
  push('Skill', bundle.skills);
  push('Rubric', bundle.rubrics);
  push('Exercise', bundle.exercises);

  return `
    <div class="card">
      <p class="note">
        每条内容都必须在界面上说清「依据什么、有多可信、有没有争议」。这不是合规装饰 ——
        它是这个产品与通俗术数教学的分界线：<b>来源可见</b>比「内容更多」更重要。
      </p>
      <table>
        <tr><th>类型</th><th>条目</th><th>来源强度</th><th>审核状态</th><th>争议</th><th>来源</th></tr>
        ${rows
          .map(
            (r) => `<tr>
              <td class="mono">${esc(r.kind)}</td>
              <td class="mono">${esc(r.id)}</td>
              <td>${esc(r.strength)}</td>
              <td><span class="tag ${r.status === 'draft' ? 'draft' : ''}">${esc(r.status)}</span></td>
              <td>${esc(r.controversy)}</td>
              <td class="note">${esc(r.sources)}</td>
            </tr>`,
          )
          .join('')}
      </table>
      <p class="note warn">
        全部条目为 <code>draft</code>：唯一来源 R1 自身也是 draft，因此<b>当前不可能升级为 reviewed</b>。
        要升级必须先人工核对一手文献（清单见 <code>packages/content/STEP2-REPORT.md</code> §五）。
      </p>
    </div>`;
}

try {
  main();
} catch (e: unknown) {
  app.innerHTML = `<div class="wrap"><div class="card"><h3>预览站启动失败</h3><pre>${esc(
    e instanceof Error ? (e.stack ?? e.message) : String(e),
  )}</pre></div></div>`;
}
