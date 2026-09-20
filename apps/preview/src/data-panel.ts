/**
 * 预览站 · 数据面板（把「攒到什么」直接显示出来）
 *
 * 依据：`docs/待采集数据.md` —— 攒数据的目的就是这几个数，所以它们应该在页面上可见，
 * 而不是存在浏览器里等人想起来去挖。
 *
 * 面板显示五件事，对应采集规格 §一 的 8 类数据：
 *   ① 攒了多少（四张表的行数 + 存储位置）
 *   ② 每小题首次答对率 → 难度是否合理
 *   ③ 按题型的耗时分布 → **校准我拍的认知负荷权重**
 *   ④ 实测混淆对 vs 预设 → V0.1 §9.3 三分支（**最值钱的一环**）
 *   ⑤ 遗忘曲线 → 校准 SRS
 *
 * ⚠️ 面板明确写出「这些数据能得出什么、不能得出什么」——
 * 两周自用数据**不能**证明学习方法有效（开发者偏差，见采集规格 §〇）。
 */
import {
  computeConfusionPairs,
  forgettingCurve,
  isConfusableWith,
  latencyByKind,
  type Attempt,
  type ContentBundle,
  type ObservedConfusion,
  type PresetConfusion,
} from '@dlg/domain';
import { allAttempts, clearAll, counts, dumpAll, storageKind } from './store.js';

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`;
const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

export function renderDataPanel(): string {
  return `
    <div class="card" id="data-panel">
      <div class="meta" id="data-counts"><span class="tag">读取中…</span></div>
      <div class="row">
        <button data-role="data-export">导出 JSON</button>
        <button class="ghost" data-role="data-refresh">刷新统计</button>
        <button class="ghost" data-role="data-clear">清空（导出后再清）</button>
      </div>
      <div id="data-storage-note"></div>
      <div id="data-body"></div>
      <details>
        <summary>这些数据能得出什么、不能得出什么</summary>
        <p class="note">
          <b>能：</b>校准一批<b>我拍的</b>数值 —— 认知负荷权重（现在是 1/2/3/4/5）、
          难度权重、掌握度门槛（现在是 3/10 样本）、积分给分是否合理，以及
          <b>验证我预测的易混对是否真的会混</b>。
        </p>
        <p class="note">
          <b>不能：</b>证明「这套学习方法有效」。那需要真实用户与对照 ——
          我是出题人，知道所有答案与设计意图，这是严重的观察者偏差。
          自用数据只能<b>校准仪器</b>，不能证明仪器测的东西有意义。
        </p>
        <p class="note">
          数据存在浏览器本地（IndexedDB）。<b>不导出就等于只存在这台机器上</b> ——
          所以「导出 JSON」不是可选项。
        </p>
      </details>
    </div>`;
}

function presetList(bundle: ContentBundle): PresetConfusion[] {
  return bundle.relations.filter(isConfusableWith).map((r) => ({
    id: `${r.from_node_id}~${r.to_node_id}`,
    from_node_id: r.from_node_id,
    to_node_id: r.to_node_id,
    rationale: r.rationale,
    expected_direction: r.expected_direction,
  }));
}

function renderConfusions(rows: ObservedConfusion[]): string {
  if (rows.length === 0) {
    return '<p class="note">还没有错选记录（或所有题都答对了）。混淆对是**答错且选错项**才产生的。</p>';
  }
  const label: Record<ObservedConfusion['verdict'], string> = {
    expected: '预设内 · 教学正常',
    unexpected: '⚠️ 未预设 · 内容或教学有问题',
    cross_system: '过度迁移 · 需反向练习',
  };
  const cls: Record<ObservedConfusion['verdict'], string> = {
    expected: 'rule',
    unexpected: 'draft',
    cross_system: 'rubric',
  };
  return `
    <table>
      <tr><th>把…选成了…</th><th>次数</th><th>判定</th><th>说明</th></tr>
      ${rows
        .map(
          (c) => `<tr>
            <td><b>${esc(c.correct_label)}</b> → ${esc(c.chosen_label)}</td>
            <td>${c.count}</td>
            <td><span class="tag ${cls[c.verdict]}">${esc(label[c.verdict])}</span></td>
            <td class="note">${
              c.matched_preset ? esc(c.matched_preset.rationale) : '这个错选**不在预设里** —— 值得回头查是选项设计问题还是教学顺序问题'
            }</td>
          </tr>`,
        )
        .join('')}
    </table>`;
}

export function wireDataPanel(bundle: ContentBundle, container: HTMLElement): () => Promise<void> {
  const el = <T extends HTMLElement>(sel: string): T => {
    const found = container.querySelector<T>(sel);
    if (!found) throw new Error(`数据面板缺少必需元素 ${sel}`);
    return found;
  };

  const presets = presetList(bundle);
  const nameOf = (id: string): string | undefined => bundle.symbols.find((s) => s.id === id)?.canonical_name;
  const formalismOf = (id: string): string | undefined => bundle.symbols.find((s) => s.id === id)?.formalism_id;

  async function refresh(): Promise<void> {
    const kind = storageKind();
    const c = await counts();
    const attempts: Attempt[] = await allAttempts();

    el('#data-counts').innerHTML = [
      `<span class="tag">作答 ${c.attempt ?? 0}</span>`,
      `<span class="tag">证据 ${c.evidence ?? 0}</span>`,
      `<span class="tag">积分记录 ${c.score ?? 0}</span>`,
      `<span class="tag">掌握度快照 ${c.mastery_snapshot ?? 0}</span>`,
      `<span class="tag ${kind === 'memory' ? 'draft' : 'rule'}">存储：${kind === 'memory' ? '内存（不会保存）' : 'IndexedDB（本地持久）'}</span>`,
    ].join('');

    el('#data-storage-note').innerHTML =
      kind === 'memory'
        ? `<p class="note warn">⚠️ 当前浏览器不可用 IndexedDB，本次数据只存在内存里，<b>刷新即丢</b>。</p>`
        : '';

    if (attempts.length === 0) {
      el('#data-body').innerHTML =
        '<p class="note">还没有作答记录。在上面的练习区做几题，这里就会出现统计。</p>';
      return;
    }

    // ①② 每题首次答对率
    const byExercise = new Map<string, Attempt[]>();
    for (const a of attempts) {
      const list = byExercise.get(a.exercise_id) ?? [];
      list.push(a);
      byExercise.set(a.exercise_id, list);
    }
    const perExercise = [...byExercise.entries()].map(([id, list]) => {
      const sorted = list.slice().sort((x, y) => x.submitted_at.localeCompare(y.submitted_at));
      const first = sorted[0]!;
      return {
        id,
        template: first.template_id ?? '（手写题）',
        firstPassed: first.judging.passed,
        passRate: list.filter((a) => a.judging.passed).length / list.length,
        n: list.length,
      };
    });
    const firstTryRate =
      perExercise.filter((p) => p.firstPassed).length / Math.max(1, perExercise.length);

    // ③ 耗时
    const lat = latencyByKind(attempts);

    // ④ 混淆对
    const confusions = computeConfusionPairs({ attempts, presets, nameOf, formalismOf });

    // ⑤ 遗忘曲线
    const curve = forgettingCurve(attempts);

    el('#data-body').innerHTML = `
      <div class="hr"></div>
      <div class="meta">
        <span class="tag">已练题目 ${perExercise.length} 道</span>
        <span class="tag">首次答对率 ${pct(firstTryRate)}</span>
      </div>

      <h3>③ 按题型的耗时（校准认知负荷权重）</h3>
      ${lat.length === 0 ? '<p class="note">无耗时记录。</p>' : `
      <table>
        <tr><th>题型</th><th>样本</th><th>中位耗时</th><th>p90</th></tr>
        ${lat.map((l) => `<tr><td>${esc(l.exercise_kind)}</td><td>${l.samples}</td><td>${secs(l.median_ms)}</td><td>${secs(l.p90_ms)}</td></tr>`).join('')}
      </table>
      <p class="note">给各题型拍的权重是：识别 1 · 匹配 1 · 分类 2 · 比较 2 · 关系判断 3 · 结构分析 4 · 推理 4 · 开放式解读 5。
      若实测耗时比例与权重比例差得远，说明权重该改。</p>`}

      <h3>④ 实测混淆对 vs 预设（最值钱的一环）</h3>
      <p class="note">预设了 ${presets.length} 对（八卦镜像对）。命中 = 教学正常现象；
      未命中 = <b>内容或教学可能有问题</b>，值得回头查。</p>
      ${renderConfusions(confusions)}

      <h3>⑤ 遗忘曲线（校准 SRS 间隔）</h3>
      <table>
        <tr><th>距上次作答</th><th>样本</th><th>重答正确率</th></tr>
        ${curve
          .map(
            (b) =>
              `<tr><td>${b.min_days}–${b.max_days === -1 ? '∞' : b.max_days} 天</td><td>${b.samples}</td><td>${
                b.samples === 0 ? '—' : pct(b.pass_rate)
              }</td></tr>`,
          )
          .join('')}
      </table>
      <p class="note">⚠️ 只有（a）同一题答过多次（b）间隔被刻意拉开，这条曲线才有意义。
      全挤在 0–1 天桶里说明还没做间隔重测。</p>
    `;
  }

  container.querySelector('[data-role="data-refresh"]')?.addEventListener('click', () => void refresh());

  container.querySelector('[data-role="data-export"]')?.addEventListener('click', () => {
    void dumpAll().then((dump) => {
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dlg-attempts-${dump.exported_at.slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });
  });

  container.querySelector('[data-role="data-clear"]')?.addEventListener('click', () => {
    void clearAll().then(() => refresh());
  });

  void refresh();
  return refresh;
}
