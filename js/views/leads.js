// views/leads: public enquiry form, pipeline (Kanban and table), lead detail, "My day".
import { db, store } from '../store.js';
import { LEAD_STAGES, LEAD_STAGE_LABEL, INTERESTS, PASS_TYPES } from '../domain.js';
import { esc, fmtDate, fmtDateTime, fmtMoney, isoDate, relTime, startOfDay } from '../utils.js';
import { auth } from '../auth/session.js';
import { can } from '../auth/permissions.js';
import { api } from '../api/index.js';
import { metrics } from '../metrics.js';
import { ui } from './common.js';

// ---------- public enquiry form ----------
export function viewApply(query) {
  const utm = { source: query.utm_source || '', medium: query.utm_medium || '', campaign: query.utm_campaign || '' };
  const logo = '<div class="logo dark"><b>PLATINUM</b><span>Immigration</span></div>';
  if (ui.applyDone) {
    return `<div class="apply-wrap"><div class="card apply-card">${logo}
      <div class="result-icon" aria-hidden="true">&#9989;</div>
      <h1 style="font-size:20px;text-align:center">Thank you, ${esc(ui.applyDone.firstName)}</h1>
      <p class="note green" style="margin:14px 0">Our consultant will reach out to you shortly. We have also sent a WhatsApp message to confirm we received your enquiry.</p>
      <p class="muted small" style="text-align:center">You can close this page.</p>
      <p style="text-align:center;margin-top:12px"><button class="btn" data-action="applyAgain">Submit another enquiry</button></p>
    </div></div>`;
  }
  return `<div class="apply-wrap"><div class="card apply-card">${logo}
    <h1 style="font-size:20px;text-align:center">Tell us about yourself</h1>
    <p class="muted small" style="text-align:center;margin:4px 0 16px">A few quick questions so the right consultant can help you with PR or citizenship.</p>
    <form id="applyForm" class="stack" autocomplete="on">
      <input type="hidden" name="utm_source" value="${esc(utm.source)}"><input type="hidden" name="utm_medium" value="${esc(utm.medium)}"><input type="hidden" name="utm_campaign" value="${esc(utm.campaign)}">
      <label class="field"><span>Your name</span><input class="input" name="name" required autocomplete="name"></label>
      <label class="field"><span>Phone (WhatsApp)</span><input class="input" type="tel" name="phone" required placeholder="+65 9123 4567" autocomplete="tel" inputmode="tel"></label>
      <label class="field"><span>Email</span><input class="input" type="email" name="email" required autocomplete="email" inputmode="email"></label>
      <label class="field"><span>Nationality</span><input class="input" name="nationality" required></label>
      <label class="field"><span>Your current pass</span><select class="input" name="passType" required><option value="">Choose...</option>${PASS_TYPES.map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>
      <label class="field"><span>Years in Singapore</span><input class="input" type="number" name="yearsInSg" min="0" max="60" required inputmode="numeric"></label>
      <label class="field"><span>What are you interested in?</span><select class="input" name="interest" required><option value="">Choose...</option>${INTERESTS.map((p) => `<option>${esc(p)}</option>`).join('')}</select></label>
      <label class="field"><span>How did you hear about us?</span><select class="input" name="sourceId" required><option value="">Choose...</option>${db.leadSources.map((s) => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('')}</select></label>
      ${ui.applyError ? `<p class="note red small">${esc(ui.applyError)}</p>` : ''}
      <p class="tiny muted">We use these details only to contact you about your enquiry. By submitting, you agree that Platinum Immigration may contact you by WhatsApp, phone and email.</p>
      <button class="btn primary block" type="submit">Send my enquiry</button>
    </form>
  </div></div>`;
}

// ---------- pipeline ----------
function initials(name) { return String(name).split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase(); }

export function filteredLeads() {
  const f = ui.leadFilters;
  return api.visibleLeads().filter((l) =>
    (!f.q || l.name.toLowerCase().includes(f.q.toLowerCase()) || (l.email || '').toLowerCase().includes(f.q.toLowerCase()))
    && (!f.source || l.sourceId === f.source) && (!f.staff || (f.staff === 'NONE' ? !l.assignedStaffId : l.assignedStaffId === f.staff)));
}

const followUpState = (l) => {
  if (!l.nextFollowUp) return '';
  const d = Math.round((startOfDay(l.nextFollowUp) - startOfDay(new Date())) / 86400000);
  return d < 0 ? 'overdue' : d === 0 ? 'today' : '';
};

function leadCard(l) {
  const pkg = db.packages.find((p) => p.id === l.packageId);
  const intro = db.introducers.find((i) => i.id === l.introducerId);
  const assignee = store.user(l.assignedStaffId);
  const fs = followUpState(l);
  return `<div class="lead-card" draggable="${l.convertedCaseId ? 'false' : 'true'}" data-lead-card="${esc(l.id)}" data-action="openLead" data-lead="${esc(l.id)}">
    <div class="row between"><b>${esc(l.name)}</b>${intro && intro.tier === 'PREMIUM' ? '<span class="chip gold plain" title="Premium introducer">&#9733; Premium</span>' : ''}</div>
    <div class="tiny muted">${esc(l.interest)} &middot; ${esc(l.nationality)}</div>
    ${pkg ? `<div class="tiny">${esc(pkg.name)}${l.quotedAmount != null ? ` &middot; ${fmtMoney(l.quotedAmount)}` : ''}</div>` : ''}
    <div class="row between" style="margin-top:6px">
      <span class="tiny ${fs ? 'fu-' + fs : 'muted'}">${l.nextFollowUp ? `Follow up ${fs === 'overdue' ? 'overdue ' : ''}${fmtDate(l.nextFollowUp)}` : (l.convertedCaseId ? 'Converted' : '')}</span>
      <span class="avatar" title="${esc(assignee ? assignee.name : 'Unassigned')}">${assignee ? initials(assignee.name) : '?'}</span>
    </div>
  </div>`;
}

export function viewLeads() {
  const u = auth.currentUser();
  const leads = filteredLeads();
  const f = ui.leadFilters;
  const consultants = db.users.filter((x) => x.role === 'CONSULTANT');
  const openLeads = leads.filter((l) => !['WON', 'LOST'].includes(l.stage));
  const pipelineValue = openLeads.reduce((s, l) => s + (l.quotedAmount || 0), 0);
  const sel = (name, opts, val) => `<select class="input sm" data-lead-filter="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

  const board = `<div class="kanban">${LEAD_STAGES.map((s) => {
    const col = leads.filter((l) => l.stage === s.key);
    return `<div class="kan-col" data-drop-stage="${s.key}">
      <div class="kan-head"><b>${esc(s.label)}</b><span class="tiny muted">${col.length}</span></div>
      <div class="kan-body">${col.map(leadCard).join('') || '<p class="tiny muted" style="text-align:center;padding:12px 0">No leads</p>'}</div>
    </div>`; }).join('')}</div>`;

  const table = `<div class="table-wrap"><table class="data">
    <thead><tr><th>Name</th><th>Stage</th><th>Interest</th><th>Source</th><th>Package</th><th>Quote</th><th>Next follow-up</th><th>Assigned</th><th>Created</th></tr></thead>
    <tbody>${leads.map((l) => { const pkg = db.packages.find((p) => p.id === l.packageId); const fs = followUpState(l); return `<tr data-action="openLead" data-lead="${esc(l.id)}">
      <td><b>${esc(l.name)}</b><div class="tiny muted">${esc(l.email)}</div></td>
      <td>${esc(LEAD_STAGE_LABEL[l.stage])}</td><td>${esc(l.interest)}</td><td class="small">${esc(l.heardOfUs || '-')}</td>
      <td class="small">${esc(pkg ? pkg.name : '-')}</td><td>${l.quotedAmount != null ? fmtMoney(l.quotedAmount) : '-'}</td>
      <td class="small ${fs ? 'fu-' + fs : ''}">${l.nextFollowUp ? fmtDate(l.nextFollowUp) : '-'}</td>
      <td class="small">${esc((store.user(l.assignedStaffId) || {}).name || 'Unassigned')}</td><td class="small">${relTime(l.createdAt)}</td></tr>`; }).join('') || '<tr><td colspan="9" class="muted" style="text-align:center;padding:24px">No leads match these filters.</td></tr>'}</tbody>
  </table></div>`;

  return `<main class="page wide stack">
    <div class="row between">
      <div><h1 style="font-size:22px">Lead pipeline</h1>
        <p class="muted small">${leads.length} leads &middot; ${openLeads.length} open &middot; open pipeline value ${fmtMoney(pipelineValue)}</p></div>
      <div class="row">
        <a class="btn" href="#/apply" target="_blank" rel="noopener">Open /apply form</a>
        <button class="btn" data-action="exportLeadsCsv">Export CSV</button>
      </div>
    </div>
    <section class="card">
      <div class="filters">
        <div class="seg"><button class="btn sm ${ui.leadMode === 'board' ? 'active' : ''}" data-action="leadMode" data-mode="board">Board</button><button class="btn sm ${ui.leadMode === 'table' ? 'active' : ''}" data-action="leadMode" data-mode="table">Table</button></div>
        <input class="input sm search" type="search" placeholder="Search name or email" data-lead-filter="q" value="${esc(f.q)}">
        ${sel('source', [['', 'All sources'], ...db.leadSources.map((s) => [s.id, s.label])], f.source)}
        ${u.role !== 'CONSULTANT' ? sel('staff', [['', 'All consultants'], ['NONE', 'Unassigned'], ...consultants.map((x) => [x.id, x.name])], f.staff) : ''}
      </div>
      <div style="margin-top:12px">${ui.leadMode === 'board' ? board : table}</div>
      ${ui.leadMode === 'board' && can(u, 'lead:manage') ? '<p class="tiny muted" style="margin-top:8px">Drag a card to another column to move it. Every move is recorded in the audit trail.</p>' : ''}
    </section>
  </main>`;
}

// ---------- lead detail ----------
export function viewLead(leadId) {
  const l = api.getLead(leadId);
  const u = auth.currentUser();
  const canManage = can(u, 'lead:manage');
  const consultants = db.users.filter((x) => x.role === 'CONSULTANT');
  const pkg = db.packages.find((p) => p.id === l.packageId);
  const intro = db.introducers.find((i) => i.id === l.introducerId);
  const activity = db.audit.filter((a) => a.leadId === l.id).sort((a, b) => b.at.localeCompare(a.at));
  const notes = l.notes.slice().sort((a, b) => b.at.localeCompare(a.at));
  const converted = l.convertedCaseId && store.case(l.convertedCaseId);
  const canReassign = can(u, 'case:reassign');
  return `<main class="page stack">
    <div class="row between">
      <div><a href="#/staff/leads" class="small">&larr; Pipeline</a>
        <h1 style="font-size:22px;margin-top:4px">${esc(l.name)} <span class="chip grey">${esc(LEAD_STAGE_LABEL[l.stage])}</span></h1>
        <p class="muted small">${esc(l.interest)} &middot; ${esc(l.nationality)} &middot; enquiry ${fmtDate(l.createdAt)}</p></div>
      <div class="row">
        ${converted ? `<a class="btn primary" href="#/staff/case/${encodeURIComponent(converted.id)}">Open case ${esc(converted.id)}</a>` : ''}
        ${!converted && l.stage === 'WON' && can(u, 'lead:convert') ? `<button class="btn gold" data-action="openConvert" data-lead="${esc(l.id)}">Convert to client, case and invoice</button>` : ''}
      </div>
    </div>
    <div class="grid-2">
      <div class="stack">
        <section class="card">
          <h2>Contact</h2>
          <dl class="info-list">
            <dt>Phone</dt><dd>${esc(l.phone)}</dd><dt>Email</dt><dd>${esc(l.email)}</dd>
            <dt>Current pass</dt><dd>${esc(l.passType || '-')}</dd><dt>Years in Singapore</dt><dd>${esc(l.yearsInSg || '-')}</dd>
            <dt>Heard of us</dt><dd>${esc(l.heardOfUs || '-')}</dd>
            ${intro ? `<dt>Introducer</dt><dd>${esc(intro.name)} (${esc(intro.org)}) ${intro.tier === 'PREMIUM' ? '<span class="chip gold plain">&#9733; Premium</span>' : ''}</dd>` : ''}
            ${l.utm && (l.utm.source || l.utm.campaign) ? `<dt>Campaign</dt><dd class="small">${esc([l.utm.source, l.utm.medium, l.utm.campaign].filter(Boolean).join(' / '))}</dd>` : ''}
            ${l.lostReason ? `<dt>Lost reason</dt><dd>${esc(l.lostReason)}</dd>` : ''}
          </dl>
        </section>
        <section class="card stack">
          <h2 style="margin:0">Deal</h2>
          <label class="field"><span>Stage</span>
            <select class="input" data-lead-stage="${esc(l.id)}" ${canManage && !converted ? '' : 'disabled'}>${LEAD_STAGES.map((s) => `<option value="${s.key}" ${s.key === l.stage ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></label>
          <label class="field"><span>Package of interest</span>
            <select class="input" data-lead-field="packageId" data-lead="${esc(l.id)}" ${canManage && !converted ? '' : 'disabled'}><option value="">None yet</option>${db.packages.map((p) => `<option value="${esc(p.id)}" ${p.id === l.packageId ? 'selected' : ''}>${esc(p.name)} (${fmtMoney(p.price)})</option>`).join('')}</select></label>
          <label class="field"><span>Quoted amount (SGD, before GST)</span>
            <input class="input" type="number" min="0" step="1" data-lead-field="quotedAmount" data-lead="${esc(l.id)}" value="${l.quotedAmount != null ? esc(l.quotedAmount) : ''}" ${canManage && !converted ? '' : 'disabled'}></label>
          <label class="field"><span>Next follow-up</span>
            <input class="input" type="date" data-lead-field="nextFollowUp" data-lead="${esc(l.id)}" value="${l.nextFollowUp ? isoDate(l.nextFollowUp) : ''}" ${canManage && !converted ? '' : 'disabled'}></label>
          <label class="field"><span>Assigned consultant</span>
            <select class="input" data-lead-field="assignedStaffId" data-lead="${esc(l.id)}" ${(canReassign || !l.assignedStaffId) && canManage && !converted ? '' : 'disabled'}>
              <option value="">Unassigned</option>${consultants.map((x) => `<option value="${esc(x.id)}" ${x.id === l.assignedStaffId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
          ${pkg ? `<p class="tiny muted">Won converts to a ${esc(pkg.caseType.replace(/_/g, ' ').toLowerCase())} case with the matching checklist, an invoice and a welcome message.</p>` : ''}
        </section>
      </div>
      <div class="stack">
        <section class="card">
          <h2>Notes and activity</h2>
          ${canManage ? `<form id="leadNoteForm" data-lead="${esc(l.id)}" class="stack" style="margin:10px 0">
            <div class="row"><select class="input sm" name="kind" style="width:auto"><option value="NOTE">Note</option><option value="CALL">Call</option><option value="WHATSAPP">WhatsApp</option><option value="MEETING">Meeting</option></select>
              <input class="input sm" name="text" placeholder="What happened?" required style="flex:1"><button class="btn sm primary" type="submit">Add</button></div></form>` : ''}
          <ul class="history">
            ${notes.map((n) => `<li><b>${esc(n.kind.toLowerCase())}</b> ${esc(n.text)}<br><span class="muted">${fmtDateTime(n.at)} by ${esc((store.user(n.byId) || {}).name || '-')}</span></li>`).join('') || '<li class="muted">No notes yet.</li>'}
          </ul>
        </section>
        <section class="card">
          <h2>Audit trail</h2>
          <ul class="history">
            ${activity.map((a) => `<li><b>${esc(a.action.replace(/_/g, ' ').toLowerCase())}</b> ${esc(a.detail)}<br><span class="muted">${fmtDateTime(a.at)} by ${esc((store.user(a.actorId) || {}).name || 'public form')}</span></li>`).join('')}
          </ul>
        </section>
      </div>
    </div>
  </main>`;
}

// ---------- My day ----------
export function viewMyDay() {
  const u = auth.currentUser();
  const today = startOfDay(new Date());
  const mine = api.visibleLeads().filter((l) => !['WON', 'LOST'].includes(l.stage) && l.nextFollowUp && (!l.assignedStaffId || l.assignedStaffId === u.id || u.role !== 'CONSULTANT'));
  const overdue = mine.filter((l) => startOfDay(l.nextFollowUp) < today).sort((a, b) => a.nextFollowUp.localeCompare(b.nextFollowUp));
  const dueToday = mine.filter((l) => startOfDay(l.nextFollowUp).getTime() === today.getTime());
  const cases = api.visibleCases();
  const overdueDocs = cases.filter((c) => c.stage === 'COLLECTING_DOCUMENTS' && metrics.outstanding(c.id).length && metrics.daysLeft(c) < 0);
  const reviews = db.items.filter((i) => ['UPLOADED', 'AI_FLAGGED'].includes(i.status) && cases.some((c) => c.id === i.caseId));
  const leadRow = (l) => `<li data-action="openLead" data-lead="${esc(l.id)}" class="click-row"><div class="row between"><b>${esc(l.name)}</b><span class="tiny ${followUpState(l) ? 'fu-' + followUpState(l) : 'muted'}">${fmtDate(l.nextFollowUp)}</span></div>
    <div class="tiny muted">${esc(LEAD_STAGE_LABEL[l.stage])} &middot; ${esc(l.interest)} &middot; ${esc(l.phone)}</div></li>`;
  return `<main class="page stack">
    <div><h1 style="font-size:22px">My day</h1><p class="muted small">${new Date().toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long' })}</p></div>
    <section class="kpis">
      <div class="card kpi ${overdue.length ? 'alert' : ''}"><div class="num">${overdue.length}</div><div class="lbl">Follow-ups overdue</div></div>
      <div class="card kpi"><div class="num">${dueToday.length}</div><div class="lbl">Follow-ups today</div></div>
      <div class="card kpi ${overdueDocs.length ? 'warn' : ''}"><div class="num">${overdueDocs.length}</div><div class="lbl">Clients with overdue documents</div></div>
      <div class="card kpi"><div class="num">${reviews.length}</div><div class="lbl">Documents to review</div></div>
    </section>
    <div class="grid-2">
      <section class="card"><h2>My follow-ups</h2>
        <ul class="plain-list">${overdue.concat(dueToday).map(leadRow).join('') || '<li class="muted">Nothing due. Nice.</li>'}</ul></section>
      <section class="card"><h2>Clients with overdue documents</h2>
        <ul class="plain-list">${overdueDocs.map((c) => `<li class="click-row" data-action="openCase" data-case="${esc(c.id)}"><div class="row between"><b>${esc(store.caseClient(c).name)}</b><span class="tiny" style="color:var(--red)">${Math.abs(metrics.daysLeft(c))} days overdue</span></div>
          <div class="tiny muted">${esc(c.id)} &middot; ${metrics.outstanding(c.id).length} outstanding</div></li>`).join('') || '<li class="muted">No overdue clients.</li>'}</ul>
        <h2 style="margin-top:16px">Documents to review</h2>
        <ul class="plain-list">${reviews.slice(0, 8).map((i) => { const c = store.case(i.caseId); return `<li class="click-row" data-action="openCase" data-case="${esc(c.id)}"><b>${esc(i.label)}</b>
          <div class="tiny muted">${esc(store.caseClient(c).name)} &middot; ${esc(i.status === 'AI_FLAGGED' ? 'AI-flagged' : 'awaiting review')}</div></li>`; }).join('') || '<li class="muted">Review queue is empty.</li>'}</ul>
      </section>
    </div>
  </main>`;
}

// ---------- modals ----------
export function convertModal(m) {
  const l = store.lead(m.leadId);
  const pkg = db.packages.find((p) => p.id === l.packageId);
  const dep = pkg && pkg.caseType === 'PR_WITH_DEPENDANTS';
  return `<h2>Convert to client</h2>
    <p class="muted small">${esc(l.name)} &middot; ${esc(pkg ? pkg.name : '')}</p>
    <ul class="small" style="margin:12px 0 0 18px">
      <li>A client profile and portal login are created from the lead's contact details.</li>
      <li>A case with the ${esc(pkg ? pkg.caseType.replace(/_/g, ' ').toLowerCase() : '')} checklist is opened.</li>
      <li>An invoice is generated from ${l.quotedAmount != null ? fmtMoney(l.quotedAmount) : 'the package price'} plus GST.</li>
      <li>The welcome message with a sign-in link is queued.</li>
    </ul>
    <form id="convertForm" data-lead="${esc(l.id)}" class="stack" style="margin-top:12px">
      ${dep ? `<label class="field"><span>Spouse full name (optional, can be added later)</span><input class="input" name="spouseName"></label>
        <label class="field"><span>Children, one per line (optional)</span><textarea class="input" name="children" style="min-height:60px"></textarea></label>` : ''}
      ${m.error ? `<p class="note red small">${esc(m.error)}</p>` : ''}
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-action="closeModal">Cancel</button><button class="btn gold" type="submit">Convert</button></div>
    </form>`;
}

export function lostModal(m) {
  const l = store.lead(m.leadId);
  return `<h2>Mark as lost</h2><p class="muted small">${esc(l.name)}</p>
    <form id="lostForm" data-lead="${esc(l.id)}" class="stack" style="margin-top:12px">
      <label class="field"><span>Reason</span><select class="input" name="reason" required>${['Price too high', 'Chose another firm', 'Not eligible', 'No response', 'Timing not right', 'Other'].map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
      <label class="field"><span>Details (optional)</span><input class="input" name="detail"></label>
      ${m.error ? `<p class="note red small">${esc(m.error)}</p>` : ''}
      <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-action="closeModal">Cancel</button><button class="btn danger" type="submit">Mark as lost</button></div>
    </form>`;
}
