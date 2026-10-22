// views/admin: permissions matrix, users, sales catalogue (sources, packages, introducers), settings.
import { db } from '../store.js';
import { ROLES, CASE_TYPES } from '../domain.js';
import { esc, fmtMoney, fmtDateTime } from '../utils.js';
import { auth } from '../auth/session.js';
import { can, MATRIX, PERMISSIONS, ASSIGNED_ONLY } from '../auth/permissions.js';
import { introducerStats } from '../api/leads.js';
import { ui } from './common.js';

const STAFF_ROLES = ['ADMIN', 'OPS_MANAGER', 'CONSULTANT', 'DOCUMENT_SPECIALIST', 'CLIENT'];

function tabs(u) {
  const t = [['permissions', 'Permissions', can(u, 'config:manage')], ['users', 'Users', can(u, 'user:manage')],
    ['catalogue', 'Sales catalogue', can(u, 'introducer:manage')], ['settings', 'Settings', can(u, 'config:manage')]];
  return t.filter((x) => x[2]);
}

export function viewAdmin() {
  const u = auth.currentUser();
  const available = tabs(u);
  if (!available.some((t) => t[0] === ui.adminTab)) ui.adminTab = available[0][0];
  const body = { permissions: permissionsTab, users: usersTab, catalogue: catalogueTab, settings: settingsTab }[ui.adminTab]();
  return `<main class="page wide stack">
    <div><h1 style="font-size:22px">Admin</h1><p class="muted small">Access rules, users, the sales catalogue and settings the client has not confirmed yet.</p></div>
    <div class="tpl-tabs">${available.map(([k, l]) => `<button class="btn sm ${ui.adminTab === k ? 'active' : ''}" data-action="adminTab" data-tab="${k}">${l}</button>`).join('')}</div>
    ${body}
  </main>`;
}

function permissionsTab() {
  const groups = [];
  PERMISSIONS.forEach(([key, label, group]) => { let g = groups.find((x) => x.name === group); if (!g) groups.push(g = { name: group, rows: [] }); g.rows.push([key, label]); });
  return `<section class="card">
    <p class="small muted" style="margin-bottom:10px">One matrix (<span class="mono">js/auth/permissions.js</span>) drives every screen and every API call. A tick means the role may do it.
      Consultants are limited to their own assigned leads and cases (marked <b>own</b>); clients see only their own case.</p>
    <div class="table-wrap"><table class="data matrix">
      <thead><tr><th>Permission</th>${STAFF_ROLES.map((r) => `<th>${esc(ROLES[r].label)}</th>`).join('')}</tr></thead>
      <tbody>${groups.map((g) => `<tr class="group-row"><td colspan="${STAFF_ROLES.length + 1}">${esc(g.name)}</td></tr>
        ${g.rows.map(([key, label]) => `<tr><td>${esc(label)} <span class="tiny muted mono">${esc(key)}</span></td>
          ${STAFF_ROLES.map((r) => { const has = MATRIX[r].includes(key); const own = has && (ASSIGNED_ONLY.includes(r) || r === 'CLIENT') && /^(case|lead|item|onboarding)/.test(key); return `<td class="tick">${has ? (own ? '&#10003; <span class="tiny muted">own</span>' : '&#10003;') : '<span class="muted">-</span>'}</td>`; }).join('')}</tr>`).join('')}`).join('')}
      </tbody></table></div>
  </section>`;
}

function usersTab() {
  const staff = db.users.filter((x) => x.role !== 'CLIENT');
  const clients = db.users.filter((x) => x.role === 'CLIENT');
  const perm = db.audit.filter((a) => a.action === 'PERMISSION_CHANGED').sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
  const me = auth.currentUser();
  return `<section class="card"><h2>Staff</h2>
    <div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>
      ${staff.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td class="small">${esc(x.email)}</td>
        <td><select class="input sm" data-user-role="${esc(x.id)}" ${x.id === me.id ? 'disabled' : ''}>${STAFF_ROLES.filter((r) => r !== 'CLIENT').map((r) => `<option value="${r}" ${r === x.role ? 'selected' : ''}>${esc(ROLES[r].label)}</option>`).join('')}</select></td></tr>`).join('')}
    </tbody></table></div>
    <p class="tiny muted" style="margin-top:8px">Role changes are written to the audit trail. In production, staff sign in with SSO and roles come from the identity provider.</p>
  </section>
  <section class="card"><h2>Recent permission changes</h2>
    <ul class="history">${perm.map((a) => `<li><b>${esc(a.detail)}</b><br><span class="muted">${fmtDateTime(a.at)}</span></li>`).join('') || '<li class="muted">None yet.</li>'}</ul></section>
  <section class="card"><h2>Client logins</h2><p class="small muted">${clients.length} client contacts. Each contact has their own login; the audit trail records which contact did what.</p></section>`;
}

function catalogueTab() {
  const stats = introducerStats();
  const typeOpts = (val) => Object.entries(CASE_TYPES).map(([k, v]) => `<option value="${k}" ${k === val ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
  return `<section class="card"><h2>Packages</h2><p class="small muted">Sample prices. The client confirms the real ones.</p>
    ${db.packages.map((p) => `<form class="cat-row" data-cat="package" data-id="${esc(p.id)}">
      <input class="input sm" name="name" value="${esc(p.name)}" required>
      <select class="input sm" name="caseType">${typeOpts(p.caseType)}</select>
      <input class="input sm" type="number" name="price" min="0" step="1" value="${esc(p.price)}" required style="max-width:110px">
      <button class="btn sm" type="submit">Save</button><button class="btn sm danger" type="button" data-action="removePackage" data-id="${esc(p.id)}">Delete</button>
    </form>`).join('')}
    <form class="cat-row" data-cat="package" data-id=""><input class="input sm" name="name" placeholder="New package name" required>
      <select class="input sm" name="caseType">${typeOpts('PR')}</select><input class="input sm" type="number" name="price" min="0" step="1" placeholder="Price" required style="max-width:110px">
      <button class="btn sm primary" type="submit">Add</button></form>
  </section>
  <section class="card"><h2>Lead sources</h2>
    ${db.leadSources.map((s) => `<form class="cat-row" data-cat="source" data-id="${esc(s.id)}"><input class="input sm" name="label" value="${esc(s.label)}" required>
      <button class="btn sm" type="submit">Save</button><button class="btn sm danger" type="button" data-action="removeSource" data-id="${esc(s.id)}">Delete</button></form>`).join('')}
    <form class="cat-row" data-cat="source" data-id=""><input class="input sm" name="label" placeholder="New source" required><button class="btn sm primary" type="submit">Add</button></form>
  </section>
  <section class="card"><h2>Introducers</h2>
    <div class="table-wrap"><table class="data"><thead><tr><th>Introducer</th><th>Tier</th><th>Leads</th><th>Converted</th><th>Won value</th></tr></thead><tbody>
      ${stats.sort((a, b) => b.wonValue - a.wonValue || b.leads - a.leads).map((s) => `<tr><td><b>${esc(s.intro.name)}</b><div class="tiny muted">${esc(s.intro.org)}</div></td>
        <td>${s.intro.tier === 'PREMIUM' ? '<span class="chip gold plain">&#9733; Premium</span>' : 'Standard'}</td><td>${s.leads}</td><td>${s.won}</td><td>${fmtMoney(s.wonValue)}</td></tr>`).join('')}
    </tbody></table></div>
    <form class="cat-row" data-cat="introducer" data-id="" style="margin-top:12px"><input class="input sm" name="name" placeholder="Name" required><input class="input sm" name="org" placeholder="Organisation">
      <select class="input sm" name="tier"><option value="STANDARD">Standard</option><option value="PREMIUM">Premium</option></select><button class="btn sm primary" type="submit">Add introducer</button></form>
  </section>`;
}

function settingsTab() {
  const c = db.config;
  return `<section class="card stack"><h2 style="margin:0">Settings</h2>
    <p class="small muted">Values the client has not confirmed (TBC). Nothing here is hard-coded in the app.</p>
    <label class="field"><span>Magic link lifetime (minutes)</span><input class="input" type="number" min="1" max="1440" data-config="magicLinkMinutes" data-type="number" value="${esc(c.magicLinkMinutes)}"></label>
    <label class="field"><span>GST rate (e.g. 0.09 for 9%)</span><input class="input" type="number" min="0" max="1" step="0.01" data-config="gstRate" data-type="number" value="${esc(c.gstRate)}"></label>
    <label class="field"><span>Stage after generating a submission pack</span><select class="input" data-config="stageAfterPack"><option value="DOCUMENTS_COMPLETE" ${c.stageAfterPack === 'DOCUMENTS_COMPLETE' ? 'selected' : ''}>Documents complete</option><option value="REVIEW_AND_PREPARATION" ${c.stageAfterPack === 'REVIEW_AND_PREPARATION' ? 'selected' : ''}>Review and preparation</option></select></label>
    <label class="row small"><input type="checkbox" data-config="warnUnpaidOnSubmit" data-type="bool" ${c.warnUnpaidOnSubmit ? 'checked' : ''}> Warn (not block) when moving to Submitted with an unpaid balance</label>
    <label class="row small"><input type="checkbox" data-config="notifyOnAccept" data-type="bool" ${c.notifyOnAccept ? 'checked' : ''}> Message the client each time a document is accepted</label>
  </section>`;
}
