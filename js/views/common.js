// views/common: UI state and small shared view helpers. No imports from other views.
import { STATUS, STAGES, STAGE_INDEX } from '../domain.js';
import { esc } from '../utils.js';

export const root = document.getElementById('app');

export const ui = {
  modal: null,          // { type: 'upload'|'reject'|'addItem'|'convert'|'lostReason'|..., ... }
  expanded: {},         // staff case view: itemId -> bool
  expandedInit: {},     // caseId -> true once defaults applied
  filters: { q: '', stage: '', type: '', rag: '', staff: '', closed: false },
  outboxId: null,
  outboxTab: 'whatsapp',
  templateId: 'tpl_pr',
  formId: 'form_pr',
  loginError: '',
  newCase: null,
  leadMode: 'board',
  leadFilters: { q: '', source: '', staff: '', archived: false },
  leadId: null,
  applyDone: null,
  applyError: '',
  magicSent: false,
  queueFilter: 'ALL',
  queueSel: null,
  adminTab: 'permissions',
  invoiceFilter: '',
  audit: {},
  letterTplId: null,
  letterTplError: '',
  letterError: '',
  adminImport: '',
  msgTplKey: null,
  msgTplError: '',
};

export function parseHash() {
  const h = window.location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  const query = {};
  new URLSearchParams(qs || '').forEach((v, k) => { query[k] = v; });
  return { path: path || '/', query, raw: h };
}
export function go(path, replace) {
  const target = '#' + path;
  if (replace) window.location.replace(target); else window.location.hash = path;
}

let toastTimer = null;
export function toast(html, ms) {
  const el = document.getElementById('toast');
  el.innerHTML = html;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms || 3200);
}

export const chip = (status) => `<span class="chip ${STATUS[status].tone}">${STATUS[status].label}</span>`;
export const ragDot = (r) => `<span class="rag ${r.rag}" title="${esc(r.reason)}" aria-label="${r.rag}: ${esc(r.reason)}"></span>`;

export function linkify(text) {
  return esc(text).replace(/(https?:\/\/[^\s]+|file:\/\/[^\s]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
}

export function stepper(stage) {
  const cur = STAGE_INDEX[stage];
  return `<ol class="stepper" aria-label="Application stage">
    ${STAGES.map((s, i) => `<li class="${i < cur ? 'done' : i === cur ? 'current' : ''}" ${i === cur ? 'aria-current="step"' : ''}>
      <div class="dot">${i < cur ? '&#10003;' : i + 1}</div><span class="step-label">${esc(s.label)}</span></li>`).join('')}
  </ol>`;
}

export function ring(pct) {
  const r = 34, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
  return `<svg class="ring" width="92" height="92" viewBox="0 0 92 92" role="img" aria-label="${pct}% complete">
    <circle cx="46" cy="46" r="${r}" fill="none" stroke="#eef0f3" stroke-width="10"/>
    <circle cx="46" cy="46" r="${r}" fill="none" stroke="#b8934a" stroke-width="10" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 46 46)"/>
    <text x="46" y="52" text-anchor="middle" font-size="18">${pct}%</text></svg>`;
}

export function groupByPerson(items) {
  const groups = [];
  items.forEach((i) => { let g = groups.find((x) => x.label === i.personLabel); if (!g) groups.push(g = { label: i.personLabel, name: i.personName, items: [] }); g.items.push(i); });
  return groups;
}

/** "Uploaded by Priya (client)" or "Daniel Koh (consultant, on behalf)". */
export function uploadedByLabel(doc, getUser) {
  const by = doc.uploadedBy;
  if (!by) return '';
  const u = getUser(by.userId);
  const who = u ? u.name : 'unknown';
  const role = { CLIENT: 'client', CONSULTANT: 'consultant', DOCUMENT_SPECIALIST: 'specialist', ADMIN: 'admin', OPS_MANAGER: 'operations' }[by.role] || by.role.toLowerCase();
  return `${who} (${role}${by.onBehalf ? ', on behalf' : ''}${by.via ? `, ${by.via}` : ''})`;
}

export function downloadBlob(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function csvDownload(filename, csv) {
  downloadBlob(filename, new Blob([csv], { type: 'text/csv;charset=utf-8' }));
}
