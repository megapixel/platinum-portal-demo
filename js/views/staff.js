// views/staff: back-office dashboard, case page, outbox, checklist templates, new case.
import { db, store } from '../store.js';
import { STAGES, STAGE_INDEX, CASE_TYPES, DOC_TYPES, REJECT_REASONS } from '../domain.js';
import { esc, fmtDate, fmtDateTime, relTime, isoDate } from '../utils.js';
import { auth, requirePerm } from '../auth/session.js';
import { can } from '../auth/permissions.js';
import { api } from '../api/index.js';
import { metrics } from '../metrics.js';
import { formProgress } from '../caselogic.js';
import { ui, chip, ragDot, linkify, groupByPerson, uploadedByLabel } from './common.js';
import { casePeople } from '../api/cases.js';
import { DAY_NAMES, effectiveRule } from '../reminders.js';
import { ruleFields } from './admin.js';
import { paymentChip, invoiceCard } from './billing.js';
import { storage } from '../storage.js';

const DAY = 86400000;

function caseRows() {
  return api.visibleCases().map((c) => {
    const client = store.caseClient(c);
    const comp = metrics.completion(c.id);
    const out = metrics.outstanding(c.id).length;
    return { c, client, comp, out, left: metrics.daysLeft(c), last: metrics.lastActivity(c.id), staff: store.user(c.assignedStaffId), rag: metrics.rag(c) };
  });
}

export function viewDashboard() {
  const rows = caseRows();
  const u = auth.currentUser();
  const f = ui.filters;
  const visibleIds = new Set(rows.map((r) => r.c.id));
  const active = rows.filter((r) => r.c.stage !== 'OUTCOME');
  const overdue = active.filter((r) => r.out > 0 && r.left < 0).length;
  const awaiting = db.items.filter((i) => visibleIds.has(i.caseId) && i.status === 'UPLOADED').length;
  const flagged = db.items.filter((i) => visibleIds.has(i.caseId) && i.status === 'AI_FLAGGED').length;
  const ragOrder = { RED: 0, AMBER: 1, GREEN: 2 };
  const visible = rows.filter((r) =>
    (!f.q || r.client.name.toLowerCase().includes(f.q.toLowerCase()) || r.c.id.toLowerCase().includes(f.q.toLowerCase()))
    && (!f.stage || r.c.stage === f.stage) && (!f.type || r.c.caseType === f.type)
    && (!f.rag || r.rag.rag === f.rag) && (!f.staff || r.c.assignedStaffId === f.staff))
    .sort((a, b) => ragOrder[a.rag.rag] - ragOrder[b.rag.rag] || a.left - b.left);
  const consultants = db.users.filter((x) => x.role === 'CONSULTANT');
  const sel = (name, opts, val) => `<select class="input sm" data-filter="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

  return `<main class="page stack">
    <div class="row between">
      <div><h1 style="font-size:22px">${u.role === 'CONSULTANT' ? 'My clients' : 'Client dashboard'}</h1><p class="muted small">${rows.length} clients &middot; ${new Date().toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
      <div class="row">
        ${can(u, 'case:create') ? '<a class="btn primary" href="#/staff/new">+ New case</a>' : ''}
        ${can(u, 'message:send') ? `<button class="btn gold" data-action="runWeekly">&#128172; Run ${DAY_NAMES[db.config.reminder.day]} reminders</button>` : ''}
      </div>
    </div>
    <section class="kpis">
      <div class="card kpi"><div class="num">${active.length}</div><div class="lbl">Active cases</div></div>
      <div class="card kpi ${overdue ? 'alert' : ''}"><div class="num">${overdue}</div><div class="lbl">Cases with overdue documents</div></div>
      <div class="card kpi"><div class="num">${awaiting}</div><div class="lbl">Documents awaiting review</div></div>
      <div class="card kpi ${flagged ? 'warn' : ''}"><div class="num">${flagged}</div><div class="lbl">AI-flagged documents</div></div>
    </section>
    <section class="card">
      <div class="filters">
        <input class="input sm search" type="search" placeholder="Search by name or case ID" data-filter="q" value="${esc(f.q)}">
        ${sel('stage', [['', 'All stages'], ...STAGES.map((s) => [s.key, s.label])], f.stage)}
        ${sel('type', [['', 'All case types'], ...Object.entries(CASE_TYPES).map(([k, v]) => [k, v.short])], f.type)}
        ${sel('rag', [['', 'All RAG'], ['RED', 'Red'], ['AMBER', 'Amber'], ['GREEN', 'Green']], f.rag)}
        ${u.role !== 'CONSULTANT' ? sel('staff', [['', 'All consultants'], ...consultants.map((x) => [x.id, x.name])], f.staff) : ''}
        <button class="btn sm" data-action="clearFilters">Clear</button>
      </div>
      <div class="table-wrap" style="margin-top:12px">
        <table class="data">
          <thead><tr><th></th><th>Client</th><th>Case type</th><th>Stage</th><th>% complete</th><th>Outstanding</th><th>Days left</th><th>Payment</th><th>Last activity</th><th>Assigned</th></tr></thead>
          <tbody>
          ${visible.map((r) => `<tr data-action="openCase" data-case="${esc(r.c.id)}">
            <td>${ragDot(r.rag)}</td>
            <td><b>${esc(r.client.name)}</b><div class="tiny muted">${esc(r.c.id)}</div></td>
            <td>${esc(CASE_TYPES[r.c.caseType].short)}</td>
            <td>${esc(STAGES[STAGE_INDEX[r.c.stage]].label)}</td>
            <td><span class="mini-bar"><i style="width:${r.comp.pct}%"></i></span>${r.comp.pct}%</td>
            <td>${r.out ? `<b>${r.out}</b>` : '<span class="muted">0</span>'}</td>
            <td>${r.out === 0 ? '<span class="muted">-</span>' : r.left < 0 ? `<b style="color:var(--red)">${Math.abs(r.left)} overdue</b>` : r.left}</td>
            <td>${can(u, 'invoice:view') ? paymentChip(r.c.id) : ''}</td>
            <td class="small">${relTime(r.last)}</td>
            <td class="small">${esc(r.staff ? r.staff.name : '-')}</td>
          </tr>`).join('') || '<tr><td colspan="10" class="muted" style="text-align:center;padding:24px">No clients match these filters.</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="legend" style="margin-top:12px">
        <span><i class="rag GREEN"></i> On track or 100%</span>
        <span><i class="rag AMBER"></i> 14 days or fewer left with items outstanding, or an AI flag</span>
        <span><i class="rag RED"></i> Past target with items outstanding, or a rejection not re-uploaded in 7 days</span>
      </div>
    </section>
  </main>`;
}

function specimenPreview(doc, item) {
  const t = DOC_TYPES[doc.aiDetectedType] || DOC_TYPES.other;
  const lines = Object.entries(doc.aiExtracted || {}).slice(0, 6);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300">
    <rect width="480" height="300" fill="#fbfaf6"/><rect x="10" y="10" width="460" height="280" fill="none" stroke="#c9b98f" stroke-width="2"/>
    <text x="28" y="46" font-family="Arial" font-size="18" font-weight="bold" fill="#1b2a4a">${esc(t.label.toUpperCase())}</text>
    <text x="28" y="66" font-family="Arial" font-size="11" fill="#777">${esc(doc.fileName)}</text>
    ${lines.map(([k, v], i) => `<text x="28" y="${100 + i * 28}" font-family="Arial" font-size="12" fill="#666">${esc(k.toUpperCase())}</text>
      <text x="200" y="${100 + i * 28}" font-family="Arial" font-size="13" fill="#222">${esc(v == null ? '(unreadable)' : v)}</text>`).join('')}
    <text x="240" y="190" font-family="Arial" font-size="56" font-weight="bold" fill="#d63b2f" fill-opacity=".14" text-anchor="middle" transform="rotate(-18 240 190)">SPECIMEN</text>
  </svg>`;
  return `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" alt="Specimen preview of ${esc(item.label)}">`;
}

export function docPreview(doc, item) {
  if (doc.source === 'seed') return specimenPreview(doc, item);
  const url = storage.url(doc.id);
  if (!url) return `<p class="muted small" style="padding:16px;text-align:center">File preview not available in this browser session.<br>Production serves files from secure storage through an authenticated route.</p>`;
  if (doc.mimeType === 'application/pdf') return `<iframe src="${esc(url)}" title="${esc(doc.fileName)}"></iframe>`;
  return `<img src="${esc(url)}" alt="${esc(doc.fileName)}">`;
}

export function aiPanel(doc) {
  const t = DOC_TYPES[doc.aiDetectedType] || DOC_TYPES.other;
  const conf = Math.round((doc.aiConfidence || 0) * 100);
  const fields = Object.entries(doc.aiExtracted || {});
  return `<div class="ai-panel">
    <h4>AI document check</h4>
    <div class="info-list">
      <dt>Detected type</dt><dd>${esc(t.label.charAt(0).toUpperCase() + t.label.slice(1))} ${doc.aiMatches ? '<span class="chip green plain">matches</span>' : '<span class="chip amber plain">mismatch</span>'}</dd>
      <dt>Confidence</dt><dd>${conf}%<span class="conf"><i style="width:${conf}%"></i></span></dd>
      <dt>Checked</dt><dd>${fmtDateTime(doc.aiCheckedAt)}</dd>
    </div>
    ${fields.length ? `<ul class="field-list" style="margin-top:10px">${fields.map(([k, v]) => `<li><span class="muted">${esc(k)}</span>${v == null ? '<span class="missing">Not found</span>' : `<span>${esc(v)}</span>`}</li>`).join('')}</ul>` : ''}
    ${doc.aiIssues && doc.aiIssues.length ? `<p style="margin-top:10px"><b>Issues</b></p><ul class="issues">${doc.aiIssues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="small" style="margin-top:10px;color:var(--green)">No issues found.</p>'}
    <p class="ai-disclaimer">AI results are assistive. Staff confirm every document.</p>
  </div>`;
}

export function viewCase(caseId) {
  const c = api.getCase(caseId);
  const u = auth.currentUser();
  const client = store.caseClient(c);
  const items = store.itemsFor(c.id);
  const comp = metrics.completion(c.id);
  const left = metrics.daysLeft(c);
  const rag = metrics.rag(c);
  const todo = metrics.clientTodo(c.id);
  if (!ui.expandedInit[c.id]) {
    items.forEach((i) => { if (['UPLOADED', 'AI_FLAGGED'].includes(i.status)) ui.expanded[i.id] = true; });
    ui.expandedInit[c.id] = true;
  }
  const history = db.stageHistory.filter((h) => h.caseId === c.id).sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  const audit = db.audit.filter((a) => a.caseId === c.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
  const allAccepted = comp.total > 0 && comp.accepted === comp.total;
  const groups = groupByPerson(items);
  const def = db.formDefs.find((f) => f.caseType === c.caseType);
  const prog = formProgress(def, c.onboarding.data);
  const contacts = client.contacts.map((x) => ({ ...x, user: store.user(x.userId) }));
  const canStage = can(u, 'case:stage');
  const canEditInfo = can(u, 'onboarding:edit');
  const consultants = db.users.filter((x) => x.role === 'CONSULTANT');
  const openTasks = db.reviewTasks.filter((t) => t.caseId === c.id && t.status === 'OPEN').length;

  return `<main class="page stack">
    <div class="row between">
      <div>
        <a href="#/staff" class="small">&larr; Dashboard</a>
        <h1 style="font-size:22px;margin-top:4px">${ragDot(rag)} ${esc(client.name)}</h1>
        <p class="muted small">${esc(c.id)} &middot; ${esc(CASE_TYPES[c.caseType].label)} &middot; ${esc(rag.reason)} ${can(u, 'invoice:view') ? paymentChip(c.id) : ''}</p>
      </div>
      <div class="row">
        ${can(u, 'pack:generate') ? `<a class="btn" href="#/staff/case/${encodeURIComponent(c.id)}/pack">Consolidation</a>` : ''}
        <a class="btn" href="#/portal?case=${encodeURIComponent(c.id)}" target="_blank" rel="noopener">Open client portal</a>
        ${can(u, 'message:send') ? `<button class="btn gold" data-action="remindNow" data-case="${esc(c.id)}" ${todo.length ? '' : 'disabled title="Nothing outstanding from the client"'}>&#128172; Send reminder now</button>` : ''}
      </div>
    </div>
    ${openTasks ? `<div class="note blue row between"><span>The client sent ${openTasks} batch${openTasks === 1 ? '' : 'es'} of uploads for review.</span></div>` : ''}
    ${allAccepted && canStage && STAGE_INDEX[c.stage] < STAGE_INDEX.DOCUMENTS_COMPLETE ? `<div class="note green row between"><span>All required documents are accepted.</span><button class="btn sm success" data-action="setStageQuick" data-case="${esc(c.id)}" data-stage="DOCUMENTS_COMPLETE">Move to Documents complete</button></div>` : ''}

    <div class="grid-2">
      <div class="stack">
        <section class="card">
          <h2>Client</h2>
          <dl class="info-list">
            ${contacts.map((x) => `<dt>${x.kind === 'PRIMARY' ? 'Primary contact' : 'Secondary contact'}</dt><dd>${esc(x.user.name)}<br><span class="muted small">${esc(x.user.email)} &middot; ${esc(x.user.phone || '-')}</span></dd>`).join('')}
            <dt>Nationality</dt><dd>${esc((client.profile && client.profile.nationality) || '-')}</dd>
            <dt>Updates by</dt><dd>${esc({ WHATSAPP: 'WhatsApp', EMAIL: 'Email', BOTH: 'WhatsApp and email' }[client.channelPref])}</dd>
            ${c.dependants.length ? `<dt>Dependants</dt><dd>${c.dependants.map((d) => esc(d.name)).join('<br>')}</dd>` : ''}
            <dt>Assigned</dt><dd>${esc(store.user(c.assignedStaffId).name)}</dd>
            <dt>Started</dt><dd>${fmtDate(c.startDate)}</dd>
            <dt>Target</dt><dd>${fmtDate(c.targetSubmissionDate)} ${comp.accepted < comp.total ? `<span class="small ${left < 0 ? '' : 'muted'}" style="${left < 0 ? 'color:var(--red);font-weight:600' : ''}">(${left < 0 ? Math.abs(left) + ' days overdue' : left + ' days left'})</span>` : ''}</dd>
            <dt>Complete</dt><dd>${comp.pct}% (${comp.accepted}/${comp.total})<div class="bar"><i style="width:${comp.pct}%"></i></div></dd>
          </dl>
          ${client.contacts.length < 2 && can(u, 'case:create') ? `<details style="margin-top:10px"><summary class="small">Add a secondary contact (e.g. spouse)</summary>
            <form id="addContactForm" data-client="${esc(client.id)}" class="stack" style="margin-top:8px">
              <input class="input sm" name="name" placeholder="Full name" required>
              <input class="input sm" type="email" name="email" placeholder="Email (their own login)" required>
              <input class="input sm" type="tel" name="phone" placeholder="Mobile">
              <button class="btn sm primary" type="submit">Add contact</button>
            </form></details>` : ''}
        </section>
        <section class="card">
          <h2>Information form</h2>
          <p class="muted small" style="margin:2px 0 8px">${c.onboarding.status === 'SUBMITTED' ? 'Submitted' : 'Draft'} &middot; ${prog.pct}% complete</p>
          <div class="bar"><i style="width:${prog.pct}%"></i></div>
          <div class="row" style="margin-top:10px">
            ${canEditInfo ? `<a class="btn sm" href="#/staff/case/${encodeURIComponent(c.id)}/info">${prog.pct < 100 ? 'Fill in for client' : 'View or edit'}</a>` : ''}
          </div>
        </section>
        ${invoiceCard(c)}
        ${can(u, 'message:send') ? reminderCard(c, client) : ''}
        <section class="card">
          <h2>Stage</h2>
          <select class="input" data-stage-select="${esc(c.id)}" ${canStage ? '' : 'disabled'}>
            ${STAGES.map((s, i) => `<option value="${s.key}" ${s.key === c.stage ? 'selected' : ''}>${i + 1}. ${esc(s.label)}</option>`).join('')}
          </select>
          <p class="tiny muted" style="margin-top:6px">Changes are recorded in the stage history and shown to the client.</p>
          <ul class="history" style="margin-top:10px">
            ${history.map((h) => `<li><b>${esc(STAGES[STAGE_INDEX[h.stage]].label)}</b><br><span class="muted">${fmtDateTime(h.changedAt)} by ${esc((store.user(h.changedById) || {}).name || 'system')}</span></li>`).join('')}
          </ul>
        </section>
        ${can(u, 'outbox:view') ? messageLogCard(c) : ''}
        <section class="card">
          <h2>Audit trail</h2>
          <ul class="history">
            ${audit.map((a) => `<li><b>${esc(a.action.replace(/_/g, ' ').toLowerCase())}</b> ${esc(a.detail)}<br><span class="muted">${fmtDateTime(a.at)} by ${esc((store.user(a.actorId) || {}).name || '-')}</span></li>`).join('') || '<li class="muted">No actions yet.</li>'}
          </ul>
        </section>
      </div>

      <section class="card">
        <div class="row between" style="margin-bottom:12px">
          <h2 style="margin:0">Checklist</h2>
          ${can(u, 'item:manage') ? `<button class="btn sm" data-action="openAddItem" data-case="${esc(c.id)}">+ Add item</button>` : ''}
        </div>
        <p class="note blue small" style="margin-bottom:12px">AI results are assistive. Staff confirm every document.</p>
        ${groups.map((g) => `<p class="section-title">${esc(g.label)}${g.label !== 'Main applicant' ? ' &middot; ' + esc(g.name) : ''}</p>
          ${g.items.map((i) => caseItemCard(i, u)).join('')}`).join('')}
      </section>
    </div>
  </main>`;
}

export function caseItemCard(i, u) {
  const docs = store.docsFor(i.id);
  const doc = docs[0];
  const open = !!ui.expanded[i.id];
  const canReview = can(u, 'item:review');
  return `<div class="item-card ${open ? 'open' : ''}">
    <div class="item-head" data-action="toggleItem" data-item="${esc(i.id)}">
      <span class="caret">&#9656;</span>
      <div class="grow"><b>${esc(i.label)}</b>${i.required ? '' : ' <span class="tiny muted">optional</span>'}
        <div class="tiny muted">${doc ? `${esc(doc.fileName)} &middot; v${doc.version || 1} &middot; ${relTime(doc.uploadedAt)}` : 'Nothing uploaded yet'}${i.dueDate ? ` &middot; due ${fmtDate(i.dueDate)}` : ''}</div>
        ${i.status === 'REJECTED' && i.staffRemark ? `<div class="tiny" style="color:var(--red)">Remark: ${esc(i.staffRemark)}</div>` : ''}
      </div>
      ${i.reuploaded ? '<span class="chip blue plain">re-uploaded</span>' : ''}
      ${chip(i.status)}
    </div>
    ${open ? `<div class="item-body">
      ${doc ? `<div class="preview">${docPreview(doc, i)}</div>${aiPanel(doc)}` : `<p class="muted small">The client has not uploaded this document yet.</p><div></div>`}
      ${doc ? `<p class="tiny muted" style="grid-column:1/-1">Uploaded by ${esc(uploadedByLabel(doc, store.user))} on ${fmtDateTime(doc.uploadedAt)}</p>` : ''}
      <div class="row" style="grid-column:1/-1">
        ${canReview ? `<button class="btn success" data-action="accept" data-item="${esc(i.id)}" ${doc && i.status !== 'ACCEPTED' ? '' : 'disabled'}>&#10003; Accept</button>
        <button class="btn danger" data-action="openReject" data-item="${esc(i.id)}" ${doc && i.status !== 'REJECTED' ? '' : 'disabled'}>&#10007; Reject</button>` : ''}
        ${can(u, 'item:upload') && i.status !== 'ACCEPTED' ? `<button class="btn" data-action="openUpload" data-item="${esc(i.id)}">Upload on behalf</button>` : ''}
        <span class="spacer" style="flex:1"></span>
        ${can(u, 'item:manage') ? `<label class="tiny muted">Deadline <input class="input sm" type="date" style="width:auto" data-deadline="${esc(i.id)}" value="${i.dueDate ? isoDate(i.dueDate) : ''}"></label>` : ''}
      </div>
      ${docs.length > 1 ? `<div style="grid-column:1/-1"><p class="tiny muted" style="font-weight:600">Version history</p><ul class="history">
        ${docs.map((d) => `<li>v${d.version || 1} &middot; ${esc(d.fileName)} &middot; ${fmtDateTime(d.uploadedAt)} &middot; ${esc(uploadedByLabel(d, store.user))}${d === doc ? ' (current)' : ''}</li>`).join('')}</ul></div>` : ''}
      ${can(u, 'item:manage') ? `<div class="row" style="grid-column:1/-1;justify-content:flex-end"><button class="btn sm ghost" data-action="removeItem" data-item="${esc(i.id)}" style="color:var(--red)">Remove item</button></div>` : ''}
    </div>` : ''}
  </div>`;
}

export function viewOutbox() {
  const tab = ui.outboxTab;
  const msgs = tab === 'email' ? db.emails : db.outbox;
  const current = msgs.find((m) => m.id === ui.outboxId) || msgs[0];
  const toName = (m) => {
    if (m.toName) return m.toName;
    const c = m.caseId && store.case(m.caseId);
    return c ? store.caseClient(c).name : (m.toPhone || m.to);
  };
  const triggerLabel = (t) => ({ MANUAL: 'Manual', WELCOME: 'Welcome', WEEKLY: 'Weekly job', LEAD_GREETING: 'Lead greeting', DOC_REJECTED: 'Document rejected', MAGIC_LINK: 'Sign-in link', STAGE_CHANGED: 'Stage changed', REVIEW_SUBMITTED: 'Review confirmation', ALL_DOCS_COMPLETE: 'All documents complete', DOC_ACCEPTED: 'Document accepted' }[t] || t);
  return `<main class="page stack">
    <div class="row between">
      <div><h1 style="font-size:22px">Outbox</h1><p class="muted small">Simulated WhatsApp and email channels. No real messages are sent in the prototype.</p></div>
      <div class="row">
        ${can(auth.currentUser(), 'config:manage') && (db.outbox.length || db.emails.length) ? '<button class="btn" data-action="clearOutbox">Clear outbox</button>' : ''}
        ${can(auth.currentUser(), 'message:send') ? `<button class="btn gold" data-action="runWeekly">&#128172; Run ${DAY_NAMES[db.config.reminder.day]} reminders</button>` : ''}
      </div>
    </div>
    <div class="tpl-tabs">
      <button class="btn sm ${tab === 'whatsapp' ? 'active' : ''}" data-action="outboxTab" data-tab="whatsapp">WhatsApp <span class="tiny">(${db.outbox.length})</span></button>
      <button class="btn sm ${tab === 'email' ? 'active' : ''}" data-action="outboxTab" data-tab="email">Email <span class="tiny">(${db.emails.length})</span></button>
    </div>
    <div class="outbox-grid">
      <section class="card">
        ${msgs.length ? `<ul class="msg-list">${msgs.map((m) => `<li class="${current && m.id === current.id ? 'active' : ''}" data-action="selectMsg" data-msg="${esc(m.id)}">
          <div class="row between"><b>${esc(toName(m))}</b><span class="chip ${m.status === 'SENT' ? 'green' : 'grey'}">${m.status === 'SENT' ? 'Sent (simulated)' : 'Queued'}</span></div>
          <div class="tiny muted">${esc(m.toPhone || m.to)} &middot; ${triggerLabel(m.trigger)} &middot; ${fmtDateTime(m.createdAt)}</div>
          <div class="preview-text">${esc(tab === 'email' ? m.subject : m.body.split('\n').slice(0, 2).join(' '))}</div>
        </li>`).join('')}</ul>`
        : `<div class="all-done"><b style="color:var(--navy)">No messages yet</b><span class="muted small">Run the weekly reminders to generate this week's personalised messages.</span></div>`}
      </section>
      <div>${current ? (tab === 'email' ? emailPreview(current, toName(current)) : phone(current, toName(current))) : ''}</div>
    </div>
  </main>`;
}

function phone(m, name) {
  const time = new Date(m.createdAt).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });
  return `<div class="phone" aria-label="WhatsApp preview for ${esc(name)}"><div class="phone-screen">
    <div class="wa-head"><div class="wa-avatar">PI</div><div><b>Platinum Immigration</b><span>Business account</span></div></div>
    <div class="wa-body">
      <div class="wa-day"><span>${new Date(m.createdAt).toLocaleDateString('en-SG', { weekday: 'long' })}</span></div>
      <div class="wa-bubble">${linkify(m.body)}<div class="wa-meta">${time} &#10003;&#10003;</div></div>
    </div>
    <div class="wa-input"><div>Message</div></div>
  </div></div>
  <p class="tiny muted" style="text-align:center;margin-top:8px">To ${esc(name)} (${esc(m.toPhone)})</p>`;
}

function emailPreview(m, name) {
  return `<div class="email-card card">
    <p class="tiny muted">To: ${esc(name)} &lt;${esc(m.to)}&gt;</p>
    <p class="tiny muted">${fmtDateTime(m.createdAt)}</p>
    <h3 style="margin:8px 0">${esc(m.subject)}</h3>
    <div class="email-body">${linkify(m.body)}</div>
  </div>`;
}

export function viewTemplates() {
  requirePerm('template:manage');
  const t = db.templates.find((x) => x.id === ui.templateId) || db.templates[0];
  const items = t.items.slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const docTypeOpts = Object.entries(DOC_TYPES).map(([k, v]) => [k, v.label]);
  return `<main class="page stack">
    <div><h1 style="font-size:22px">Checklist templates</h1>
      <p class="muted small">Sample lists for the client to confirm. Changes apply to new cases; existing cases keep their own checklist (use "Add item" on a case to change it).</p></div>
    <div class="tpl-tabs">${db.templates.map((x) => `<button class="btn sm ${x.id === t.id ? 'active' : ''}" data-action="selectTpl" data-tpl="${esc(x.id)}">${esc(x.name)} <span class="tiny">(${x.items.length})</span></button>`).join('')}</div>
    <section class="card">
      <label class="field"><span>Template name</span><input class="input" data-tpl-name="${esc(t.id)}" value="${esc(t.name)}"></label>
      <p class="tiny muted" style="margin-top:6px">Case type: ${esc(CASE_TYPES[t.caseType].label)}</p>
    </section>
    ${items.map((it, idx) => `<div class="tpl-item">
      <div class="tpl-grid">
        <label class="field"><span>Label</span><input class="input sm" data-ti="${esc(it.id)}" data-key="label" value="${esc(it.label)}"></label>
        <label class="field"><span>Applies to</span><select class="input sm" data-ti="${esc(it.id)}" data-key="appliesTo">${['MAIN', 'SPOUSE', 'CHILD'].map((v) => `<option ${v === it.appliesTo ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="field"><span>Document type (AI)</span><select class="input sm" data-ti="${esc(it.id)}" data-key="docType">${docTypeOpts.map(([k, l]) => `<option value="${k}" ${k === it.docType ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="field"><span>Code</span><input class="input sm mono" data-ti="${esc(it.id)}" data-key="code" value="${esc(it.code)}"></label>
      </div>
      <label class="field" style="margin-top:8px"><span>Description shown to the client</span><input class="input sm" data-ti="${esc(it.id)}" data-key="description" value="${esc(it.description)}"></label>
      <div style="margin-top:8px"><span class="tiny muted" style="font-weight:600">Required fields (checked by AI)</span>
        <div class="fields-chips">${it.requiredFields.map((f, fi) => `<span class="field-chip">${esc(f)}<button type="button" data-action="removeField" data-ti="${esc(it.id)}" data-index="${fi}" aria-label="Remove ${esc(f)}">&times;</button></span>`).join('')}
          <input class="input sm" style="width:180px" placeholder="Add field, press Enter" data-add-field="${esc(it.id)}"></div>
      </div>
      <div class="row" style="margin-top:10px">
        <label class="row small" style="gap:6px"><input type="checkbox" data-ti="${esc(it.id)}" data-key="required" ${it.required ? 'checked' : ''}> Required</label>
        <span style="flex:1"></span>
        <button class="btn sm" data-action="moveTi" data-ti="${esc(it.id)}" data-dir="-1" ${idx === 0 ? 'disabled' : ''} aria-label="Move up">&uarr;</button>
        <button class="btn sm" data-action="moveTi" data-ti="${esc(it.id)}" data-dir="1" ${idx === items.length - 1 ? 'disabled' : ''} aria-label="Move down">&darr;</button>
        <button class="btn sm danger" data-action="removeTi" data-ti="${esc(it.id)}">Delete</button>
      </div>
    </div>`).join('')}
    <button class="btn primary" data-action="addTi">+ Add item to template</button>

    <h2 style="margin-top:20px">Onboarding information forms</h2>
    <p class="muted small">The fields clients fill in before the document checklist. Sample fields, to be confirmed with the client.</p>
    ${formDefsEditor()}
  </main>`;
}

function formDefsEditor() {
  const f = db.formDefs.find((x) => x.id === ui.formId) || db.formDefs[0];
  const types = ['text', 'textarea', 'number', 'date', 'select'];
  return `<div class="tpl-tabs">${db.formDefs.map((x) => `<button class="btn sm ${x.id === f.id ? 'active' : ''}" data-action="selectForm" data-form="${esc(x.id)}">${esc(x.name)}</button>`).join('')}</div>
  ${f.sections.map((s) => `<section class="card stack">
    <h3 style="margin:0">${esc(s.label)}</h3>
    ${s.fields.map((fld) => `<div class="form-field-row">
      <input class="input sm" data-ff="${esc(fld.key)}" data-section="${esc(s.key)}" data-key="label" value="${esc(fld.label)}">
      <select class="input sm" data-ff="${esc(fld.key)}" data-section="${esc(s.key)}" data-key="type">${types.map((t) => `<option ${t === fld.type ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label class="row small" style="gap:4px"><input type="checkbox" data-ff="${esc(fld.key)}" data-section="${esc(s.key)}" data-key="required" ${fld.required ? 'checked' : ''}> Required</label>
      <button class="btn sm danger" data-action="removeFormField" data-ff="${esc(fld.key)}" data-section="${esc(s.key)}">Delete</button>
    </div>`).join('')}
    <div><button class="btn sm" data-action="addFormField" data-section="${esc(s.key)}">+ Add field</button></div>
  </section>`).join('')}`;
}

// Demo helper: realistic random client for the New case form. Fields stay editable.
const SAMPLE_FAMILIES = [
  { name: 'Siti Nurhaliza binti Ahmad', nat: 'Malaysian', spouse: 'Ahmad Zaki bin Yusof', kids: ['Nur Iman binti Ahmad Zaki', 'Muhammad Adam bin Ahmad Zaki'] },
  { name: 'Lim Mei Ling', nat: 'Malaysian', spouse: 'Tan Wei Jie', kids: ['Tan Yu Xuan'] },
  { name: 'Mohd Hafiz bin Kamarudin', nat: 'Malaysian', spouse: 'Nur Aina binti Rosli', kids: ['Hana Sofea binti Mohd Hafiz', 'Harith Danish bin Mohd Hafiz', 'Hawa Qistina binti Mohd Hafiz'] },
  { name: 'Kavitha Subramaniam', nat: 'Malaysian', spouse: 'Ravi Chandran', kids: ['Arjun Ravi'] },
  { name: 'Ong Jia Hui', nat: 'Malaysian', spouse: 'Lee Kok Wai', kids: ['Lee Zi Qi', 'Lee Zi Hao'] },
  { name: 'Dewi Lestari Santoso', nat: 'Indonesian', spouse: 'Budi Hartono', kids: ['Putri Ayu Hartono'] },
  { name: 'Maria Cristina Reyes', nat: 'Filipino', spouse: 'Jose Miguel Reyes', kids: ['Sofia Reyes', 'Gabriel Reyes'] },
  { name: 'Tran Minh Khoa', nat: 'Vietnamese', spouse: 'Le Thi Hoa', kids: ['Tran Bao Anh'] },
  { name: 'Pimchanok Srisawat', nat: 'Thai', spouse: 'Anan Srisawat', kids: ['Ploy Srisawat'] },
  { name: 'Aung Kyaw Min', nat: 'Myanmar', spouse: 'Thandar Win', kids: ['Htet Aung', 'Su Myat Noe'] },
  { name: 'Nguyen Van Duc', nat: 'Vietnamese', spouse: 'Pham Thu Trang', kids: ['Nguyen Gia Huy'] },
  { name: 'Farah Nadia binti Ismail', nat: 'Malaysian', spouse: 'Khairul Anuar bin Zainal', kids: ['Aisy Humaira binti Khairul Anuar'] },
];
export function randomCaseSpec() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
  const unused = SAMPLE_FAMILIES.filter((f) => !db.users.some((u) => u.name === f.name));
  const fam = pick(unused.length ? unused : SAMPLE_FAMILIES);
  const caseType = pick(Object.keys(CASE_TYPES));
  const slug = fam.name.toLowerCase().split(' ').filter((w) => !['bin', 'binti'].includes(w)).slice(0, 2).join('.');
  let email = `${slug}@demo.sg`;
  for (let n = 2; db.users.some((u) => u.email === email); n++) email = `${slug}${n}@demo.sg`;
  const withDeps = caseType === 'PR_WITH_DEPENDANTS';
  const kids = withDeps ? fam.kids.slice(0, rand(1, fam.kids.length)) : [];
  const consultants = db.users.filter((u) => u.role === 'CONSULTANT');
  return {
    name: fam.name, email, phone: `+65 ${pick(['8', '9'])}${rand(100, 999)} ${rand(1000, 9999)}`,
    nationality: fam.nat, dob: isoDate(new Date(rand(1980, 1996), rand(0, 11), rand(1, 28))),
    caseType, spouseName: withDeps ? fam.spouse : '', children: kids.join('\n'),
    married: withDeps || Math.random() < 0.5,
    startDate: isoDate(new Date(Date.now() - rand(0, 14) * DAY)),
    assignedStaffId: pick(consultants).id, stage: 'COLLECTING_DOCUMENTS', sendWelcome: true,
  };
}

export function viewNewCase() {
  requirePerm('case:create');
  const f = ui.newCase || {};
  const me = auth.currentUser();
  const consultants = db.users.filter((u) => u.role === 'CONSULTANT');
  const type = f.caseType || 'PR';
  const tplCount = (t) => { const tp = db.templates.find((x) => x.caseType === t); return tp ? tp.items.filter((i) => i.appliesTo === 'MAIN').length : 0; };
  const defaultAssignee = f.assignedStaffId || (me.role === 'CONSULTANT' ? me.id : consultants[0].id);
  return `<main class="page narrow stack">
    <a href="#/staff" class="small">&larr; Dashboard</a>
    <div class="row between" style="align-items:flex-start">
      <div style="flex:1;min-width:220px"><h1 style="font-size:22px">New case</h1>
        <p class="muted small">Creates the client's portal login and builds their checklist from the matching template. Demo logins use the password <span class="mono">demo1234</span>. To start from a lead, use <b>Convert</b> on a Won lead instead.</p></div>
      <button type="button" class="btn gold" data-action="fillRandom" title="Demo helper: fills every field with a random sample client. You can still edit anything.">&#127922; Fill with sample data</button>
    </div>
    ${f.sample ? '<p class="note blue small">Sample data filled in. Edit anything you like, or click the button again for another client.</p>' : ''}
    <form id="newCaseForm" class="stack">
      <section class="card stack">
        <h2 style="margin:0">Client</h2>
        <label class="field"><span>Full name (as in passport)</span><input class="input" name="name" required value="${esc(f.name || '')}" placeholder="e.g. Siti Nurhaliza binti Ahmad"></label>
        <div class="tpl-grid" style="grid-template-columns:1fr 1fr">
          <label class="field"><span>Email (portal login)</span><input class="input" type="email" name="email" required value="${esc(f.email || '')}" placeholder="name@example.com"></label>
          <label class="field"><span>Mobile (WhatsApp)</span><input class="input" type="tel" name="phone" required value="${esc(f.phone || '')}" placeholder="+65 9123 4567"></label>
          <label class="field"><span>Nationality</span><input class="input" name="nationality" value="${esc(f.nationality || 'Malaysian')}"></label>
          <label class="field"><span>Date of birth</span><input class="input" type="date" name="dob" value="${esc(f.dob || '')}"></label>
        </div>
        <details><summary class="small">Secondary contact (optional, gets their own login to the same case)</summary>
          <div class="tpl-grid" style="grid-template-columns:1fr 1fr;margin-top:8px">
            <label class="field"><span>Name</span><input class="input" name="secName" value="${esc(f.secName || '')}"></label>
            <label class="field"><span>Email</span><input class="input" type="email" name="secEmail" value="${esc(f.secEmail || '')}"></label>
            <label class="field"><span>Mobile</span><input class="input" type="tel" name="secPhone" value="${esc(f.secPhone || '')}"></label>
          </div></details>
        <label class="field"><span>Send updates by</span><select class="input" name="channelPref">${[['WHATSAPP', 'WhatsApp'], ['EMAIL', 'Email'], ['BOTH', 'WhatsApp and email']].map(([v, l]) => `<option value="${v}" ${f.channelPref === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </section>
      <section class="card stack">
        <h2 style="margin:0">Application</h2>
        <label class="field"><span>Case type</span><select class="input" name="caseType" data-newcase-type>
          ${Object.entries(CASE_TYPES).map(([k, v]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
        <p class="tiny muted" data-tpl-hint>${tplCount(type)} documents for the main applicant${type === 'PR_WITH_DEPENDANTS' ? ', plus passport, birth certificate and photo for each dependant' : ''}. Edit the lists under Templates.</p>
        <div class="stack" data-dep-fields ${type === 'PR_WITH_DEPENDANTS' ? '' : 'hidden'}>
          <label class="field"><span>Spouse full name (leave empty if none)</span><input class="input" name="spouseName" value="${esc(f.spouseName || '')}"></label>
          <label class="field"><span>Children, one full name per line</span><textarea class="input" name="children" style="min-height:70px">${esc(f.children || '')}</textarea></label>
        </div>
        <label class="row small"><input type="checkbox" name="married" ${f.married ? 'checked' : ''}> Client is married (adds the marriage certificate)</label>
        <div class="tpl-grid" style="grid-template-columns:1fr 1fr">
          <label class="field"><span>Start date</span><input class="input" type="date" name="startDate" value="${esc(f.startDate || isoDate(new Date()))}"></label>
          <label class="field"><span>Assigned consultant</span><select class="input" name="assignedStaffId" ${me.role === 'CONSULTANT' ? 'disabled' : ''}>
            ${consultants.map((u) => `<option value="${esc(u.id)}" ${u.id === defaultAssignee ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
        </div>
        <p class="tiny muted">Target submission date is set to two months after the start date.</p>
        <label class="field"><span>Starting stage</span><select class="input" name="stage">
          <option value="COLLECTING_DOCUMENTS" ${f.stage !== 'ONBOARDED' ? 'selected' : ''}>Collecting documents (included in weekly reminders)</option>
          <option value="ONBOARDED" ${f.stage === 'ONBOARDED' ? 'selected' : ''}>Onboarded only</option></select></label>
        <label class="row small"><input type="checkbox" name="sendWelcome" ${f.sendWelcome === false ? '' : 'checked'}> Send a welcome message with a sign-in link (simulated, goes to the Outbox)</label>
      </section>
      ${f.error ? `<p class="note red small">${esc(f.error)}</p>` : ''}
      <div class="row" style="justify-content:flex-end"><a class="btn" href="#/staff">Cancel</a><button class="btn primary" type="submit">Create case</button></div>
    </form>
  </main>`;
}

// ---------- modals ----------
export function rejectModal(m) {
  const item = store.item(m.itemId);
  return `<h2>Reject document</h2>
    <p class="muted small">${esc(item.label)} &middot; ${esc(item.personLabel)}</p>
    <form id="rejectForm" class="stack" style="margin-top:12px">
      <fieldset class="reason-picker"><legend class="tiny muted" style="font-weight:600">Reason (the client sees this with what to do next)</legend>
        ${REJECT_REASONS.map((r, i) => `<label class="reason"><input type="radio" name="reason" value="${r.key}" ${m.reason === r.key || (!m.reason && i === 0) ? 'checked' : ''}> <span>${esc(r.label)}</span></label>`).join('')}
      </fieldset>
      <label class="field"><span>Note for the client (optional)</span>
        <textarea class="input" name="remark" placeholder="Add detail, e.g. which page">${esc(m.remark || '')}</textarea></label>
      ${m.error ? `<p class="note red small">${esc(m.error)}</p>` : ''}
      <p class="tiny muted">Shortcuts: press 1 to 6 to pick a reason, then Ctrl+Enter to reject.</p>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-action="closeModal">Cancel</button><button class="btn danger" type="submit">Reject document</button></div>
    </form>`;
}

export function addItemModal(m) {
  const c = store.case(m.caseId);
  const existing = new Set(store.itemsFor(c.id).map((i) => i.templateItemId + '|' + i.personLabel));
  const people = casePeople(c);
  const options = [];
  db.templates.forEach((t) => t.items.forEach((ti) => {
    if (!options.some((o) => o.label === ti.label && o.docType === ti.docType)) options.push(ti);
  }));
  return `<h2>Add checklist item</h2>
    <p class="muted small">For example, an extra document requested by the authority.</p>
    <form id="addItemForm" class="stack" style="margin-top:12px">
      <label class="field"><span>From the template library</span>
        <select class="input" name="templateItemId"><option value="">Custom document (type below)</option>
          ${options.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('')}</select></label>
      <label class="field"><span>Custom document name</span><input class="input" name="label" placeholder="e.g. Letter of consent from previous employer"></label>
      <label class="field"><span>Details the AI check should look for (comma separated)</span><input class="input" name="fields" placeholder="e.g. employee name, signatory, date"></label>
      <label class="field"><span>For</span><select class="input" name="personLabel">${people.map((p) => `<option>${esc(p.label)}</option>`).join('')}</select></label>
      <label class="field"><span>Deadline (optional)</span><input class="input" type="date" name="dueDate"></label>
      <label class="row small"><input type="checkbox" name="required" checked> Required (counts towards % complete)</label>
      ${m.error ? `<p class="note red small">${esc(m.error)}</p>` : ''}
      <p class="tiny muted">${existing.size} items already on this case.</p>
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-action="closeModal">Cancel</button><button class="btn primary" type="submit">Add item</button></div>
    </form>`;
}

function reminderCard(c, client) {
  const rule = effectiveRule(c);
  return `<section class="card stack">
    <h2 style="margin:0">Messages and reminders</h2>
    <label class="field"><span>Send updates by</span><select class="input sm" data-channel-pref="${esc(client.id)}">
      ${[['WHATSAPP', 'WhatsApp'], ['EMAIL', 'Email'], ['BOTH', 'WhatsApp and email']].map(([v, l]) => `<option value="${v}" ${client.channelPref === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="row small"><input type="checkbox" data-case-pause="${esc(c.id)}" ${c.remindersPaused ? 'checked' : ''}> Pause weekly reminders for this case</label>
    <form id="caseReminderForm" data-case="${esc(c.id)}" class="stack">
      <label class="row small"><input type="checkbox" name="custom" ${c.reminderRule ? 'checked' : ''}> Use a custom schedule for this case</label>
      <div class="rule-grid">${ruleFields(rule)}</div>
      <p class="tiny muted">${c.reminderRule ? 'Custom schedule.' : `Following the global schedule (${DAY_NAMES[db.config.reminder.day]}, ${String(db.config.reminder.hour).padStart(2, '0')}:00).`}</p>
      <button class="btn sm" type="submit">Save schedule</button>
    </form>
  </section>`;
}

const TRIGGER_LABELS = { MANUAL: 'Reminder (manual)', WEEKLY: 'Weekly reminder', WELCOME: 'Welcome', LEAD_GREETING: 'Lead greeting', DOC_REJECTED: 'Document rejected', DOC_ACCEPTED: 'Document accepted', MAGIC_LINK: 'Sign-in link', STAGE_CHANGED: 'Stage changed', REVIEW_SUBMITTED: 'Review confirmation', ALL_DOCS_COMPLETE: 'All documents complete', STAFF_ALERT: 'Staff alert', STAFF_DIGEST: 'Staff digest' };

function messageLogCard(c) {
  const log = api.messageLog(c.id);
  return `<section class="card">
    <h2>Message log</h2>
    <p class="tiny muted" style="margin-bottom:8px">Everything sent for this case, on every channel.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>Channel</th><th>What</th><th>To</th><th>Status</th></tr></thead><tbody>
      ${log.map((m) => `<tr><td class="small">${fmtDateTime(m.createdAt)}</td><td>${m.channel === 'WHATSAPP' ? 'WhatsApp' : 'Email'}</td><td class="small">${esc(TRIGGER_LABELS[m.trigger] || m.trigger)}</td>
        <td class="small">${esc(m.toName || m.to)}</td><td><span class="chip ${m.status === 'SENT' ? 'green' : 'grey'} plain">${m.status === 'SENT' ? 'Sent (simulated)' : 'Queued'}</span></td></tr>`).join('') || '<tr><td colspan="5" class="muted" style="text-align:center;padding:12px">No messages yet.</td></tr>'}
    </tbody></table></div>
  </section>`;
}
