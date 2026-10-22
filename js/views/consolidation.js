// views/consolidation: review queue across cases, and the per-case consolidation workspace.
import { store } from '../store.js';
import { CASE_TYPES } from '../domain.js';
import { esc, relTime, fmtDateTime } from '../utils.js';
import { api } from '../api/index.js';
import { ui, chip, uploadedByLabel } from './common.js';
import { docPreview, aiPanel } from './staff.js';

const FILTERS = [['ALL', 'All'], ['AI_FLAGGED', 'AI-flagged'], ['AWAITING', 'Awaiting review'], ['REUPLOADED', 'Re-uploaded after rejection']];

/** The queue as currently filtered. The events module uses it to move the selection. */
export function queueRows() { return api.reviewQueue(ui.queueFilter); }

export function viewReviewQueue() {
  const rows = queueRows();
  const all = api.reviewQueue('ALL');
  const counts = {
    ALL: all.length,
    AI_FLAGGED: all.filter((r) => r.item.status === 'AI_FLAGGED').length,
    AWAITING: all.filter((r) => r.item.status === 'UPLOADED').length,
    REUPLOADED: all.filter((r) => r.item.reuploaded).length,
  };
  const sel = rows.find((r) => r.item.id === ui.queueSel) || rows[0];
  if (sel) ui.queueSel = sel.item.id;
  return `<main class="page wide stack">
    <div class="row between">
      <div><h1 style="font-size:22px">Review queue</h1>
        <p class="muted small">Oldest uploads first, across all cases you can see.</p></div>
    </div>
    <div class="tpl-tabs">${FILTERS.map(([k, l]) => `<button class="btn sm ${ui.queueFilter === k ? 'active' : ''}" data-action="queueFilter" data-filter="${k}">${esc(l)} <span class="tiny">(${counts[k]})</span></button>`).join('')}</div>
    <div class="queue-grid">
      <section class="card">
        ${rows.length ? `<ul class="msg-list">${rows.map((r) => `<li class="${sel && r.item.id === sel.item.id ? 'active' : ''}" data-action="queueSelect" data-item="${esc(r.item.id)}">
          <div class="row between"><b>${esc(r.item.label)}</b>${chip(r.item.status)}</div>
          <div class="tiny muted">${esc(r.client.name)} &middot; ${esc(r.caseRec.id)} &middot; ${esc(r.item.personLabel)}</div>
          <div class="tiny muted">${relTime(r.doc.uploadedAt)} &middot; v${r.doc.version || 1}${r.item.reuploaded ? ' &middot; <b>re-uploaded</b>' : ''}</div>
        </li>`).join('')}</ul>`
        : '<div class="all-done"><b style="color:var(--navy)">Queue is empty</b><span class="muted small">Nothing is waiting for review.</span></div>'}
      </section>
      <section class="card">
        ${sel ? queueDetail(sel) : '<p class="muted">Select an item to review.</p>'}
      </section>
    </div>
    <p class="tiny muted">Keyboard: &uarr; &darr; (or J K) to move, <b>A</b> to accept, <b>R</b> to reject. In the reject dialog, 1 to 6 picks a reason and Ctrl+Enter confirms.</p>
  </main>`;
}

function queueDetail(r) {
  const { item, doc, caseRec, client } = r;
  return `<div class="row between" style="margin-bottom:10px">
      <div><h2 style="margin:0">${esc(item.label)}</h2>
        <p class="muted small">${esc(client.name)} &middot; <a href="#/staff/case/${encodeURIComponent(caseRec.id)}">${esc(caseRec.id)}</a> &middot; ${esc(item.personLabel)}</p></div>
      ${chip(item.status)}
    </div>
    <p class="tiny muted" style="margin-bottom:8px">v${doc.version || 1} &middot; uploaded by ${esc(uploadedByLabel(doc, store.user))} &middot; ${fmtDateTime(doc.uploadedAt)}</p>
    <div class="item-body" style="border:0;padding:0"><div class="preview">${docPreview(doc, item)}</div>${aiPanel(doc)}</div>
    <div class="row" style="margin-top:12px">
      <button class="btn success" data-action="queueAccept" data-item="${esc(item.id)}">&#10003; Accept (A)</button>
      <button class="btn danger" data-action="openReject" data-item="${esc(item.id)}">&#10007; Reject (R)</button>
    </div>`;
}

// ---------- consolidation workspace ----------
export function viewPack(caseId) {
  const r = api.packReadiness(caseId);
  const c = r.caseRec;
  const client = store.caseClient(c);
  const groups = [];
  r.entries.forEach((e) => { let g = groups.find((x) => x.label === e.item.personLabel); if (!g) groups.push(g = { label: e.item.personLabel, name: e.item.personName, rows: [] }); g.rows.push(e); });
  const packs = (c.packs || []).slice().reverse();
  return `<main class="page stack">
    <a href="#/staff/case/${encodeURIComponent(c.id)}" class="small">&larr; Back to case</a>
    <div class="row between">
      <div><h1 style="font-size:22px">Consolidation: ${esc(client.name)}</h1>
        <p class="muted small">${esc(c.id)} &middot; ${esc(CASE_TYPES[c.caseType].label)}</p></div>
      <button class="btn gold" data-action="generatePack" data-case="${esc(c.id)}" ${r.ready ? '' : 'disabled title="Resolve the checks first"'}>Generate submission pack</button>
    </div>
    <section class="card">
      <h2>Readiness</h2>
      <ul class="checks">${r.checks.map((k) => `<li class="${k.ok ? 'ok' : 'bad'}"><span class="tick">${k.ok ? '&#10003;' : '&#10007;'}</span><div><b>${esc(k.label)}</b><div class="tiny muted">${esc(k.detail)}</div></div></li>`).join('')}</ul>
      ${r.ready ? '' : '<p class="note amber small" style="margin-top:10px">The pack can be generated once every check passes.</p>'}
    </section>
    <section class="card">
      <h2>Pack contents <span class="muted small">(${r.entries.length} accepted documents, latest version of each)</span></h2>
      ${groups.map((g) => `<p class="section-title">${esc(g.label)}${g.label !== 'Main applicant' ? ' &middot; ' + esc(g.name) : ''}</p>
        <div class="table-wrap"><table class="data"><tbody>${g.rows.map((e) => `<tr><td><b>${esc(e.item.label)}</b><div class="tiny muted">v${e.doc.version || 1} &middot; ${esc(e.doc.fileName)}</div></td>
          <td class="mono small">${esc(e.fileName)}</td></tr>`).join('')}</tbody></table></div>`).join('') || '<p class="muted">No accepted documents yet.</p>'}
      <p class="tiny muted" style="margin-top:8px">File names follow <span class="mono">{CaseNo}_{Person}_{SortOrder}_{DocCode}.pdf</span>. The merged PDF starts with an index page.</p>
    </section>
    <section class="card">
      <h2>Packs generated</h2>
      <ul class="history">${packs.map((p) => `<li><b>${p.files.length} files, ${p.pages} pages</b><br><span class="muted">${fmtDateTime(p.at)} by ${esc((store.user(p.byId) || {}).name || '-')}</span></li>`).join('') || '<li class="muted">None yet.</li>'}</ul>
      <p class="tiny muted" style="margin-top:6px">Generating a pack moves the case to <b>${esc(api.packTargetLabel())}</b> (set in Admin &gt; Settings).</p>
    </section>
  </main>`;
}

