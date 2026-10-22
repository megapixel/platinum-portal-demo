// views/audit: the filterable audit timeline, used on cases, leads and in Admin.
import { store } from '../store.js';
import { esc, fmtDateTime } from '../utils.js';
import { AUDIT_CATEGORIES, categoryOf, describeChange } from '../audit.js';
import { ui } from './common.js';

export const auditState = (key) => (ui.audit[key] = ui.audit[key] || { cat: '', actor: '', q: '' });

export function filterAudit(key, entries) {
  const f = auditState(key);
  const q = f.q.trim().toLowerCase();
  return entries.filter((a) => (!f.cat || categoryOf(a) === f.cat)
    && (!f.actor || (f.actor === 'SYSTEM' ? !a.actorId : a.actorId === f.actor))
    && (!q || `${a.action} ${a.detail}`.toLowerCase().includes(q)));
}

const catLabel = (c) => (AUDIT_CATEGORIES.find((x) => x[0] === c) || [0, c])[1];

/** key: 'case:<id>' | 'lead:<id>' | 'all'. entries: newest first. */
export function auditTimeline(key, entries, opts = {}) {
  const f = auditState(key);
  const actors = [...new Set(entries.map((a) => a.actorId || 'SYSTEM'))];
  const shown = filterAudit(key, entries).slice(0, opts.limit || 150);
  const actorName = (id) => (id === 'SYSTEM' ? 'Public form / system' : (store.user(id) || {}).name || id);
  return `<div class="audit">
    <div class="filters">
      <select class="input sm" data-audit-filter="${esc(key)}" data-field="cat">${AUDIT_CATEGORIES.map(([v, l]) => `<option value="${v}" ${v === f.cat ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <select class="input sm" data-audit-filter="${esc(key)}" data-field="actor"><option value="">Everyone</option>${actors.map((id) => `<option value="${esc(id)}" ${id === f.actor ? 'selected' : ''}>${esc(actorName(id))}</option>`).join('')}</select>
      <input class="input sm search" type="search" placeholder="Search" data-audit-q="${esc(key)}" value="${esc(f.q)}">
      <button class="btn sm" data-action="exportAuditCsv" data-key="${esc(key)}">CSV</button>
    </div>
    <p class="tiny muted" style="margin:8px 0">${shown.length} of ${entries.length} entries</p>
    <ol class="timeline">
      ${shown.map((a) => {
        const changes = describeChange(a.before, a.after);
        return `<li class="tl-${categoryOf(a).toLowerCase()}">
          <div class="row between"><b>${esc(a.action.replace(/_/g, ' ').toLowerCase())}</b><span class="chip grey plain">${esc(catLabel(categoryOf(a)))}</span></div>
          <div class="small">${esc(a.detail)}</div>
          ${changes.length ? `<div class="tl-changes">${changes.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : ''}
          <div class="tiny muted">${fmtDateTime(a.at)} by ${esc(actorName(a.actorId || 'SYSTEM'))}${opts.showRef && (a.caseId || a.leadId) ? ` &middot; ${esc(a.caseId || a.leadId)}` : ''}</div>
        </li>`; }).join('') || '<li class="muted">No entries match.</li>'}
    </ol>
  </div>`;
}
