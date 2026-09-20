/**
 * 界面逻辑（无框架、无构建）。
 *
 * 为什么不用 React/Vue：这个工具是**本机单用户**的，界面由 5 个面板组成，
 * 全部状态就是「服务端返回的那一份快照」。引入框架会带来构建链、依赖树、
 * 以及一套与仓库其余部分不同的写法，换来的只是省掉几百行 render 函数。
 *
 * 一条纪律：**界面不自己拼状态**。任何写操作之后都重新拉 `/api/state`，
 * 用服务端的清点结果重画。本地拼状态迟早会漂移，而这个界面显示的正是
 * 「能不能签字」这种一旦说错就会造成错误签字的判断。
 */

const $ = (sel) => document.querySelector(sel);

/** HTML 转义。内容库里的文字（题干、摘录、论断）都可能含 < > & */
const esc = (v) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

let state = null;
let selected = null; // { kind, id }
let previewCache = null;

/* ────────────────────────────── 基础 ────────────────────────────── */

function toast(msg, bad = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = bad ? 'toast bad' : 'toast';
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, bad ? 12000 : 5000);
}

async function api(path, options) {
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`服务端返回了非 JSON：${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const blockerText = Array.isArray(body.blockers) && body.blockers.length
      ? `\n${body.blockers.map((b) => `[${b.rule}] ${b.message}`).join('\n')}`
      : '';
    throw new Error((body.error ?? `HTTP ${res.status}`) + blockerText);
  }
  return body;
}

const reviewerName = {
  get: () => localStorage.getItem('dlg.studio.reviewer') ?? '',
  set: (v) => localStorage.setItem('dlg.studio.reviewer', v),
};

/* ────────────────────────────── 载入 ────────────────────────────── */

async function refresh() {
  state = await api('/api/state');
  $('#bundlePath').textContent = state.bundlePath;
  $('#undoBtn').disabled = !state.canUndo;
  renderStatBar();
  renderOverview();
  renderReview();
  renderValidate();
  renderEntryCollections();
}

async function boot() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => selectTab(tab.dataset.tab));
  }
  $('#undoBtn').addEventListener('click', async () => {
    if (!confirm('撤回本进程上一次写入？这会用内存里保存的字节覆盖内容库。')) return;
    try {
      const r = await api('/api/undo', { method: 'POST', body: '{}' });
      state = r.state;
      await refreshPanelFromState();
      toast(`已撤回：${r.undone}`);
    } catch (e) {
      toast(e.message, true);
    }
  });
  try {
    await refresh();
    selectTab('overview');
  } catch (e) {
    toast(`载入失败：${e.message}`, true);
  }
}

async function refreshPanelFromState() {
  await refresh();
}

function selectTab(name) {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === name));
  }
  for (const p of document.querySelectorAll('.panel')) {
    p.dataset.active = String(p.id === `panel-${name}`);
  }
  if (name === 'preview' && !previewCache) void loadPreview();
}

/* ────────────────────────────── 总览 ────────────────────────────── */

function renderStatBar() {
  const s = state.summary;
  $('#statBar').innerHTML = `
    <span class="stat">条目 <b>${s.total}</b></span>
    <span class="stat">现在就能签字 <b>${s.readyToSign}</b></span>
    <span class="stat">已有人工签字记录 <b>${s.signed}</b></span>
    <span class="stat">AI 复核记录 <b>${s.aiVerifications}</b></span>
    <span class="stat">人工复核记录 <b>${s.humanVerifications}</b></span>
    <span class="stat">CI error <b>${state.validation.errors.length}</b></span>
    <span class="stat">CI warning <b>${state.validation.warnings.length}</b></span>
  `;
}

function renderOverview() {
  const s = state.summary;
  const statusLine = Object.entries(s.byStatus)
    .map(([k, v]) => `${k} ${v}`)
    .join(' · ');

  $('#panel-overview').innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">这一屏回答一个问题：现在能不能签字？</h2>
      <p class="hint">
        内容当前状态：<strong>${esc(statusLine)}</strong>。
        「现在就能签字」= 把该条目改成 <code>reviewed</code> 后，跑<strong>真正的 CI 校验器</strong>不会报 error。
        这个判断不是本工具自己算的 —— 它就是把条目放进内存副本里升一次级、看校验器说什么。
      </p>
      <p class="hint">
        ${s.aiVerifications} 条 AI 复核记录 + ${s.humanVerifications} 条人工复核记录。
        依 R19，只有<strong>人工</strong>记录（且结论为「证实 / 部分证实」）才算签字依据 ——
        所以 AI 记录再多，条目依然停在 draft。
      </p>
    </div>

    <div class="card">
      <h3 style="margin-top:0">按集合看</h3>
      <table>
        <thead>
          <tr><th>集合</th><th class="num">条目</th><th class="num">现在就能签</th><th class="num">已有签字记录</th></tr>
        </thead>
        <tbody>
          ${s.byKind
            .map(
              (k) => `<tr>
                <td>${esc(k.kind)}</td>
                <td class="num">${k.total}</td>
                <td class="num">${k.ready}</td>
                <td class="num">${k.signed}</td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* ─────────────────────────── 审核工作台 ─────────────────────────── */

function filteredEntries() {
  const kind = $('#filterKind').value;
  const status = $('#filterStatus').value;
  const ready = $('#filterReady').value;
  const text = $('#filterText').value.trim().toLowerCase();

  return state.entries.filter((e) => {
    if (kind && e.kind !== kind) return false;
    if (status && e.review_status !== status) return false;
    if (ready === 'ready' && !(e.review_status === 'draft' && e.blockers.length === 0)) return false;
    if (ready === 'blocked' && e.blockers.length === 0) return false;
    if (ready === 'signed' && !e.humanSigned) return false;
    if (text && !`${e.id} ${e.label}`.toLowerCase().includes(text)) return false;
    return true;
  });
}

function renderReview() {
  const kindSel = $('#filterKind');
  if (kindSel.options.length <= 1) {
    for (const k of [...new Set(state.entries.map((e) => e.kind))].sort()) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = k;
      kindSel.append(opt);
    }
    for (const id of ['filterKind', 'filterStatus', 'filterReady']) {
      $(`#${id}`).addEventListener('change', renderReview);
    }
    $('#filterText').addEventListener('input', renderReview);
  }

  const list = filteredEntries();
  $('#entryList').innerHTML =
    list.length === 0
      ? '<div class="empty">没有符合条件的条目</div>'
      : list
          .map((e) => {
            const isSel = selected && selected.kind === e.kind && selected.id === e.id;
            const readiness =
              e.review_status === 'draft'
                ? e.blockers.length === 0
                  ? '<span class="tag ready">可签字</span>'
                  : `<span class="tag blocked">阻塞 ${e.blockers.length}</span>`
                : '';
            return `<button class="entryRow" data-kind="${esc(e.kind)}" data-id="${esc(e.id)}" aria-current="${isSel}">
              <span class="name">${esc(e.label) || esc(e.id)}</span>
              <span class="meta">
                <span class="tag ${esc(e.review_status)}">${esc(e.review_status)}</span>
                ${readiness}
                ${e.humanSigned ? '<span class="tag reviewed">已签字</span>' : ''}
                ${esc(e.kind)} · ${esc(e.id)}
              </span>
            </button>`;
          })
          .join('');

  for (const row of document.querySelectorAll('.entryRow')) {
    row.addEventListener('click', () => {
      selected = { kind: row.dataset.kind, id: row.dataset.id };
      renderReview();
      renderDetail();
    });
  }

  renderDetail();
}

function outcomeTag(outcome) {
  const color = outcome === '证实' ? 'reviewed' : outcome === '部分证实' ? 'draft' : 'deprecated';
  return `<span class="tag ${color}">${esc(outcome)}</span>`;
}

function renderDetail() {
  const el = $('#entryDetail');
  if (!selected) {
    el.innerHTML = '<div class="empty">从左侧选一个条目</div>';
    return;
  }
  const e = state.entries.find((x) => x.kind === selected.kind && x.id === selected.id);
  if (!e) {
    el.innerHTML = '<div class="empty">条目已不存在（内容库可能刚被改动）</div>';
    return;
  }
  selected = { kind: e.kind, id: e.id };

  const blockers = e.blockers.length
    ? e.blockers
        .map((b) => `<div class="blocker"><span class="rule">[${esc(b.rule)}]</span>${esc(b.message)}</div>`)
        .join('')
    : e.review_status === 'reviewed'
      ? '<p class="hint">已经是 reviewed，无阻塞项。</p>'
      : '<p class="hint">✅ 没有阻塞项 —— 现在可以签字。</p>';

  const verifications = e.verifications.length
    ? e.verifications
        .map(
          (v) => `<div class="verification ${v.checked_by === 'human' ? 'human' : ''}">
            <div>
              <strong>${esc(v.claim)}</strong>
              ${outcomeTag(v.outcome)}
              <span class="tag ${v.checked_by === 'human' ? 'reviewed' : 'ai'}">${esc(v.checked_by)}</span>
            </div>
            <div class="hint">依据：${esc(v.source.ref)}${v.locator ? ` · ${esc(v.locator)}` : ''}</div>
            ${v.excerpt ? `<div class="excerpt">${esc(v.excerpt)}</div>` : '<div class="hint">⚠️ 没有原文摘录</div>'}
            ${v.note ? `<div class="hint">备注：${esc(v.note)}</div>` : ''}
          </div>`,
        )
        .join('')
    : '<p class="hint">没有任何复核记录。</p>';

  const sources = e.sources.length
    ? e.sources
        .map(
          (s) =>
            `<div class="verification"><div>${esc(s.ref)}</div>
             <div class="hint">${s.author ? esc(s.author) : ''}${s.year ? ` · ${esc(s.year)}` : ''}${s.confidence ? ` · 置信度 ${esc(s.confidence)}` : ''}</div>
             ${s.note ? `<div class="hint">${esc(s.note)}</div>` : ''}</div>`,
        )
        .join('')
    : '<p class="hint">⚠️ sources 为空 —— R1c：可存在但不可升级。</p>';

  const canPromote = e.review_status !== 'reviewed' && e.blockers.length === 0;

  el.innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">${esc(e.label) || esc(e.id)}</h2>
      <dl class="kv">
        <dt>集合</dt><dd><code>${esc(e.kind)}</code></dd>
        <dt>id</dt><dd><code>${esc(e.id)}</code></dd>
        <dt>状态</dt><dd><span class="tag ${esc(e.review_status)}">${esc(e.review_status)}</span> ${
          e.authored_by === 'ai-candidate' ? '<span class="tag ai">AI 起草</span>' : ''
        }</dd>
        <dt>来源强度</dt><dd>${esc(e.source_strength)}${e.controversy_flag ? ' · ⚠️ 有争议' : ''}</dd>
        ${e.reviewer ? `<dt>签字人</dt><dd>${esc(e.reviewer)}</dd>` : ''}
        ${e.reviewed_at ? `<dt>签字时间</dt><dd>${esc(e.reviewed_at)}</dd>` : ''}
      </dl>
      ${e.isTeachingHypothesis
        ? `<p class="hint">⚠️ 这是<strong>教学假设</strong>：它的验证方式是实测数据，不是文献。它永远不能靠文献升 reviewed，只能靠 <code>verifications</code> 记「证实 / 证否」。</p>`
        : ''}
    </div>

    <div class="card">
      <h3 style="margin-top:0">卡在哪（由真 CI 校验器算出）</h3>
      ${blockers}
    </div>

    <div class="card">
      <h3 style="margin-top:0">来源（sources）</h3>
      ${sources}
    </div>

    <div class="card">
      <h3 style="margin-top:0">复核记录（verifications）</h3>
      ${verifications}
    </div>

    <div class="card">
      <h3 style="margin-top:0">记一条人工复核</h3>
      <p class="hint">
        这里<strong>只能</strong>记 <code>checked_by: human</code>。理由：若允许在这里写 AI 记录，
        「AI 找到来源」到「条目 reviewed」只差一次点击 —— R1b/R19 会被合规地绕过，而那两道闸门拦的是状态、不是动作。
      </p>
      <form class="stack" id="verifyForm">
        <label>被核实的论断（越具体越好）<input name="claim" required /></label>
        <div class="row2">
          <label>依据来源<input name="sourceRef" required /></label>
          <label>作者 / 编者<input name="sourceAuthor" /></label>
        </div>
        <div class="row2">
          <label>定位（卷次 / 篇名 / URL 锚点）<input name="locator" /></label>
          <label>来源置信度
            <select name="confidence">
              <option value="">（不填）</option>
              <option>高</option><option>中–高</option><option>中</option>
              <option>低–中</option><option>低</option><option>未核实</option>
            </select>
          </label>
        </div>
        <label>关键原文摘录（让第三方能直接验证，而不是只能相信结论）
          <textarea name="excerpt" style="min-height:80px"></textarea>
        </label>
        <div class="row2">
          <label>核查结果
            <select name="outcome">
              <option>证实</option><option>部分证实</option><option>无法核实</option><option>证否</option>
            </select>
          </label>
          <label>复核人（署名，会写进 provenance.reviewer）<input name="reviewer" value="${esc(reviewerName.get())}" required /></label>
        </div>
        <label>备注（仍需补核的部分 / 来源之间的分歧）<input name="note" /></label>
        <div class="actions">
          <button class="btn primary" type="submit">记下这条复核</button>
        </div>
      </form>
    </div>

    <div class="card">
      <h3 style="margin-top:0">状态变更</h3>
      <div class="actions">
        <button class="btn primary" id="promoteBtn" ${canPromote ? '' : 'disabled'}>
          ${e.review_status === 'reviewed' ? '已经是 reviewed' : canPromote ? '签字 → 升为 reviewed' : '有阻塞，不能签字'}
        </button>
        <button class="btn danger" id="demoteBtn" ${e.review_status === 'reviewed' ? '' : 'disabled'}>撤回 → 回到 draft</button>
      </div>
      <p class="hint" style="margin-top:8px">
        撤回是刻意保留的路径：签字若不可撤销，人就倾向于拖着不签、或签得比读得还快。
        撤回时 <code>verifications</code> 保留（审计历史），但 <code>reviewer</code> / <code>reviewed_at</code> 会删掉。
      </p>
    </div>
  `;

  $('#verifyForm').addEventListener('submit', onVerify);
  $('#promoteBtn').addEventListener('click', onPromote);
  $('#demoteBtn').addEventListener('click', onDemote);
}

async function onVerify(ev) {
  ev.preventDefault();
  const f = new FormData(ev.target);
  const reviewer = String(f.get('reviewer') ?? '').trim();
  reviewerName.set(reviewer);
  try {
    const r = await api('/api/verify', {
      method: 'POST',
      body: JSON.stringify({
        ref: selected,
        reviewer,
        input: {
          claim: f.get('claim'),
          source: {
            ref: f.get('sourceRef'),
            author: f.get('sourceAuthor'),
            confidence: f.get('confidence') || undefined,
          },
          locator: f.get('locator'),
          excerpt: f.get('excerpt'),
          outcome: f.get('outcome'),
          note: f.get('note'),
        },
      }),
    });
    state = r.state;
    await refreshPanelFromState();
    toast(`已记下复核记录（${selected.kind}/${selected.id}）。现在再看它是否满足 R19 的要件。`);
  } catch (e) {
    toast(e.message, true);
  }
}

async function onPromote() {
  const reviewer = prompt('签字人（会写进 provenance.reviewer）', reviewerName.get());
  if (reviewer === null) return;
  reviewerName.set(reviewer.trim());
  try {
    const r = await api('/api/promote', {
      method: 'POST',
      body: JSON.stringify({ ref: selected, reviewer: reviewer.trim() }),
    });
    state = r.state;
    await refreshPanelFromState();
    toast(`✅ ${selected.kind}/${selected.id} 已升为 reviewed。别忘了 git diff 看一眼。`);
  } catch (e) {
    toast(e.message, true);
  }
}

async function onDemote() {
  if (!confirm('撤回为 draft？verifications 会保留，reviewer/reviewed_at 会删掉。')) return;
  try {
    const r = await api('/api/demote', { method: 'POST', body: JSON.stringify({ ref: selected }) });
    state = r.state;
    await refreshPanelFromState();
    toast('已撤回为 draft');
  } catch (e) {
    toast(e.message, true);
  }
}

/* ────────────────────────────── 录入 ────────────────────────────── */

let referencesLoaded = false;

function renderEntryCollections() {
  const sel = $('#collectionSel');
  if (!sel) {
    $('#panel-entry').innerHTML = `
      <div class="card">
        <h2 style="margin-top:0">录入</h2>
        <p class="hint">
          录入走 <strong>JSON + 真 schema 校验</strong>，不做「一种实体一个表单」。
          理由：字段清单的唯一权威是 schema；手写表单等于在 schema 之外维护第二份，
          它必然漂移，而漂移的表现是「表单能填、CI 打回」。
          校验方式是把条目放进 bundle 副本里，让 <code>contentBundleSchema</code> 自己报错。
        </p>
        <div class="filters" style="margin-top:12px">
          <label>集合 <select id="collectionSel"></select></label>
          <label>模式
            <select id="entryMode">
              <option value="create">新增（create）</option>
              <option value="update">修改（update）</option>
            </select>
          </label>
        </div>
        <div class="actions" style="margin-bottom:8px">
          <button class="btn" id="scaffoldBtn">载入骨架</button>
          <button class="btn" id="validateEntryBtn">校验</button>
          <button class="btn primary" id="saveEntryBtn">保存</button>
          <button class="btn" id="refsBtn">引用清单</button>
          <button class="btn danger" id="deleteEntryBtn">删除</button>
        </div>
        <textarea id="entryJson" spellcheck="false"></textarea>
        <div id="entryResult"></div>
        <div id="refsPanel"></div>
      </div>`;
    const sel2 = $('#collectionSel');
    for (const c of state.collections) {
      const o = document.createElement('option');
      o.value = c.key;
      o.textContent = `${c.label}（${c.key}${c.hasProvenance ? '' : ' · 无 provenance'}）`;
      sel2.append(o);
    }
    $('#scaffoldBtn').addEventListener('click', loadScaffold);
    $('#validateEntryBtn').addEventListener('click', () => void runValidateEntry());
    $('#saveEntryBtn').addEventListener('click', () => void runSaveEntry());
    $('#deleteEntryBtn').addEventListener('click', () => void runDeleteEntry());
    $('#refsBtn').addEventListener('click', () => void loadReferences());
    return;
  }
}

async function loadScaffold() {
  const key = $('#collectionSel').value;
  try {
    const r = await api(`/api/scaffold?key=${encodeURIComponent(key)}`);
    $('#entryJson').value = JSON.stringify(r.scaffold, null, 2);
    $('#entryResult').innerHTML =
      '<p class="hint">骨架<strong>从现有真实条目克隆</strong>并重置了 provenance：<code>sources</code> 与 <code>verifications</code> 被清空、状态回到 draft。复制别人的复核记录等于伪造审计链，所以这里必须清空 —— 清空后 R1c 会警告「draft 无来源」，那正是要的效果：逼你补来源。</p>';
  } catch (e) {
    toast(e.message, true);
  }
}

function parseEntryJson() {
  try {
    return { ok: true, value: JSON.parse($('#entryJson').value) };
  } catch (e) {
    $('#entryResult').innerHTML = `<div class="blocker"><span class="rule">JSON</span>${esc(e.message)}</div>`;
    return { ok: false };
  }
}

function renderEntryResult(v) {
  const part = (title, issues, cls) =>
    issues.length === 0
      ? ''
      : `<h3>${title}（${issues.length}）</h3>` +
        issues
          .map((i) => `<div class="blocker" style="border-left-color:var(--${cls})"><span class="rule">${esc(i.path)}</span>${esc(i.message)}</div>`)
          .join('');
  $('#entryResult').innerHTML = `
    <h3>${v.ok ? '✅ 校验通过' : '❌ 未通过'}</h3>
    ${part('schema 问题', v.schemaIssues ?? [], 'bad')}
    ${part('CI 问题', v.ciIssues ?? [], 'warn')}
  `;
}

async function runValidateEntry() {
  const parsed = parseEntryJson();
  if (!parsed.ok) return;
  try {
    const v = await api('/api/entry/validate', {
      method: 'POST',
      body: JSON.stringify({ key: $('#collectionSel').value, item: parsed.value, mode: $('#entryMode').value }),
    });
    renderEntryResult(v);
  } catch (e) {
    toast(e.message, true);
  }
}

async function runSaveEntry() {
  const parsed = parseEntryJson();
  if (!parsed.ok) return;
  try {
    const r = await api('/api/entry/save', {
      method: 'POST',
      body: JSON.stringify({ key: $('#collectionSel').value, item: parsed.value, mode: $('#entryMode').value }),
    });
    renderEntryResult(r.validation);
    state = r.state;
    await refreshPanelFromState();
    toast(`已保存：${r.entryKey}。改动已落盘，请 git diff 核对。`);
  } catch (e) {
    $('#entryResult').innerHTML = `<div class="blocker"><span class="rule">写入被拒</span>${esc(e.message)}</div>`;
    toast('写入被拒绝（已回滚）—— 见下方原因', true);
  }
}

async function runDeleteEntry() {
  const parsed = parseEntryJson();
  if (!parsed.ok) return;
  const item = parsed.value;
  const entryKey = item && typeof item === 'object' ? (item.id ?? '') : '';
  if (!entryKey) {
    toast('要删除的条目必须带 id（连接表请用「修改」而不是删除）', true);
    return;
  }
  if (!confirm(`删除 ${$('#collectionSel').value} / ${entryKey}？`)) return;
  try {
    const r = await api('/api/entry/delete', {
      method: 'POST',
      body: JSON.stringify({ key: $('#collectionSel').value, entryKey }),
    });
    state = r.state;
    await refreshPanelFromState();
    toast('已删除');
  } catch (e) {
    toast(e.message, true);
  }
}

async function loadReferences() {
  try {
    const r = await api('/api/references');
    referencesLoaded = true;
    $('#refsPanel').innerHTML = `
      <h3>合法引用清单</h3>
      <p class="hint">录入时最常犯的错是「引用了不存在的 id」。下面是当前内容库里真实存在的 id（CI 会校验引用完整性）。</p>
      ${r.references.byCollection
        .map(
          (c) => `<div style="margin:8px 0">
            <div class="hint">${esc(c.label)} · <code>${esc(c.key)}</code>（${c.ids.length}）</div>
            <div class="pillRow">${c.ids.map((i) => `<code>${esc(i)}</code>`).join('')}</div>
          </div>`,
        )
        .join('')}`;
  } catch (e) {
    toast(e.message, true);
  }
}

/* ─────────────────────────── 试玩预览 ─────────────────────────── */

async function loadPreview() {
  const panel = $('#panel-preview');
  panel.innerHTML = '<div class="empty">正在生成题目…</div>';
  try {
    const r = await api('/api/preview?limit=6');
    previewCache = r;
    const okBanner = r.validation.ok
      ? ''
      : `<div class="blocker"><span class="rule">CI</span>内容库有 ${r.validation.errors.length} 个 error —— 下面的题数<strong>不可信</strong>。</div>`;
    panel.innerHTML = `
      <div class="card">
        <h2 style="margin-top:0">共 ${r.total} 题，来自 ${r.templates.length} 个模板</h2>
        <p class="hint">
          题目由模板 + 规则引擎<strong>确定性生成</strong>（ADR-0021），不用 AI，也不产生任何术数知识。
          所以改一条关系边或一行规则表，题目会整体变化 —— 这一屏就是为了先看见这件事。
        </p>
        ${okBanner}
      </div>
      ${r.templates
        .map((t) => {
          const truncated = t.count >= t.max_instances;
          return `<div class="card">
            <h3 style="margin-top:0">${esc(t.name)} <span class="tag draft">${esc(t.template_id)}</span></h3>
            <dl class="kv">
              <dt>生成模式</dt><dd><code>${esc(t.mode)}</code></dd>
              <dt>可生成</dt><dd><strong>${t.count}</strong> 题${truncated ? `（已达上限 max_instances=${t.max_instances}，可能是被截断而非穷尽）` : '（已穷尽参数空间）'}</dd>
              <dt>难度</dt><dd>${esc(t.difficulty)}</dd>
              <dt>评测技能</dt><dd>${t.skillIds.map((s) => `<code>${esc(s)}</code>`).join(' ')}</dd>
            </dl>
            ${t.skipped.length ? `<div class="skipped">规则跳过的输入（${t.skipped.length}）：${esc(t.skipped.slice(0, 3).join('；'))}${t.skipped.length > 3 ? ' …' : ''}</div>` : ''}
            <h3>样题</h3>
            ${t.samples
              .map(
                (s) => `<div class="prompt">${esc(s.prompt)}</div>
                  <div class="answer">正确答案：${esc(s.answer)}${s.requiresProcess ? ' · 要求写下过程' : ''}</div>
                  ${s.choices.length ? `<div class="hint">选项：${s.choices.map((c) => esc(c)).join(' ｜ ')}</div>` : ''}`,
              )
              .join('')}
          </div>`;
        })
        .join('')}
    `;
  } catch (e) {
    panel.innerHTML = `<div class="empty">生成失败：${esc(e.message)}</div>`;
  }
}

/* ─────────────────────────── CI 校验 ─────────────────────────── */

function renderValidate() {
  const v = state.validation;
  const block = (title, list, cls) =>
    list.length === 0
      ? `<p class="hint">${title}：无</p>`
      : `<h3>${title}（${list.length}）</h3>
         <table><thead><tr><th>规则</th><th>条目</th><th>说明</th></tr></thead><tbody>
         ${list
           .map(
             (i) => `<tr>
               <td><code>${esc(i.rule)}</code></td>
               <td><code>${esc(i.entity_kind)}:${esc(i.entity_id)}</code></td>
               <td style="color:var(--${cls})">${esc(i.message)}</td>
             </tr>`,
           )
           .join('')}
         </tbody></table>`;

  $('#panel-validate').innerHTML = `
    <div class="card">
      <h2 style="margin-top:0">CI 校验（${state.validation.ok ? '通过' : '未通过'}）</h2>
      <p class="hint">
        与 <code>pnpm --filter @dlg/content validate</code> 走的是同一个校验器
        （<code>validateBundle</code>），所以这一屏与 CI 的结论一致 —— 不存在「界面说没事、CI 说不行」。
      </p>
      ${block('error', v.errors, 'bad')}
      ${block('warning', v.warnings, 'warn')}
    </div>`;
}

void boot();
