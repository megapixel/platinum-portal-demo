// views/shell: page chrome (top bars) for the client and staff areas, login, magic link, access denied.
import { db } from '../store.js';
import { ROLES } from '../domain.js';
import { esc } from '../utils.js';
import { auth } from '../auth/session.js';
import { can } from '../auth/permissions.js';
import { ui } from './common.js';

export function clientShell(body) {
  const u = auth.currentUser();
  return `
  <header class="topbar"><div class="topbar-inner">
    <a class="logo" href="#/portal"><b>PLATINUM</b><span>Immigration</span></a>
    <span class="spacer"></span>
    <a class="btn sm ghost-light" href="#/portal/help">Help</a>
    <button class="btn sm ghost-light" data-action="logout" title="Signed in as ${esc(u.email)}">Log out</button>
  </div></header>
  ${body}
  <p class="footer-note">Your documents are stored securely and are only visible to you and your consultant.<br>Platinum Immigration Consultancy Pte. Ltd. &middot; 65 Ubi Rd 1, #03-63 Oxley Bizhub, Singapore 408729</p>`;
}

/** Nav entries depend on what the role may do, so the menu never shows a page that would be denied. */
function navItems(u) {
  const items = [['dash', '#/staff', 'Dashboard', true]];
  items.push(['myday', '#/staff/my-day', 'My day', can(u, 'lead:view')]);
  items.push(['review', '#/staff/review', 'Review queue', can(u, 'item:review')]);
  items.push(['leads', '#/staff/leads', 'Pipeline', can(u, 'lead:view')]);
  items.push(['invoices', '#/staff/invoices', 'Invoices', can(u, 'invoice:view')]);
  items.push(['outbox', '#/staff/outbox', 'Outbox', can(u, 'outbox:view')]);
  items.push(['templates', '#/staff/templates', 'Templates', can(u, 'template:manage')]);
  items.push(['admin', '#/staff/admin', 'Admin', can(u, 'config:manage') || can(u, 'user:manage') || can(u, 'messagetemplate:manage')]);
  return items.filter((i) => i[3]);
}

export function staffShell(active, body) {
  const u = auth.currentUser();
  const unread = db.outbox.length;
  return `
  <header class="topbar"><div class="topbar-inner">
    <a class="logo" href="#/staff"><b>PLATINUM</b><span>Back office</span></a>
    <nav>
      ${navItems(u).map(([key, href, label]) => `<a href="${href}" class="${active === key ? 'active' : ''}">${label}${key === 'outbox' && unread ? `<span class="badge">${unread}</span>` : ''}</a>`).join('')}
    </nav>
    <span class="spacer"></span>
    <span class="who">${esc(u.name)} <span class="role-tag">${esc(ROLES[u.role].label)}</span></span>
    ${can(u, 'demo:reset') ? '<button class="btn sm ghost-light" data-action="resetDemo" title="Restore the original demo data">Reset demo</button>' : ''}
    <button class="btn sm ghost-light" data-action="logout">Log out</button>
  </div></header>
  ${body}`;
}

export function viewLogin(query) {
  const next = query.next || '';
  const clients = db.users.filter((u) => u.role === 'CLIENT' && !['elizabeth@demo.sg', 'elizabeth.spouse@demo.sg'].includes(u.email));
  const staff = db.users.filter((u) => u.role !== 'CLIENT');
  const roleName = (r) => ROLES[r].label;
  return `
  <div class="login-wrap">
    <div class="card login-card">
      <div class="logo dark"><b>PLATINUM</b><span>Immigration</span></div>
      <h1 style="font-size:20px;text-align:center">Sign in to your portal</h1>
      <p class="muted small" style="text-align:center;margin:4px 0 16px">Track your documents and application progress.</p>
      ${next.includes('case=') ? '<p class="note blue small" style="margin-bottom:12px">Sign in to open your application.</p>' : ''}
      <form id="loginForm" class="stack" autocomplete="on">
        <input type="hidden" name="next" value="${esc(next)}">
        <label class="field"><span>Email</span><input class="input" type="email" name="email" required autocomplete="username" inputmode="email"></label>
        <label class="field"><span>Password</span><input class="input" type="password" name="password" autocomplete="current-password"></label>
        ${ui.loginError ? `<p class="note red small">${esc(ui.loginError)}</p>` : ''}
        ${ui.magicSent ? '<p class="note green small">If that email has an account, a sign-in link is on its way. In this demo it appears in Outbox &gt; Email.</p>' : ''}
        <button class="btn primary block" type="submit">Sign in</button>
        <button class="btn block" type="button" data-action="emailMagicLink">Email me a sign-in link instead</button>
      </form>
      <div class="demo-accounts">
        <p class="tiny muted">Demo accounts (password <span class="mono">demo1234</span>). Sign-in is simulated in this prototype. A magic link also works: use the button above, then open the link from the email outbox.</p>
        <button type="button" data-action="fill" data-email="elizabeth@demo.sg"><span><b>Client</b> Elizabeth Tan</span><span class="muted">elizabeth@demo.sg</span></button>
        <button type="button" data-action="fill" data-email="elizabeth.spouse@demo.sg"><span><b>Client</b> Elizabeth's spouse (2nd contact)</span><span class="muted">elizabeth.spouse@demo.sg</span></button>
        ${staff.map((u) => `<button type="button" data-action="fill" data-email="${esc(u.email)}"><span><b>${esc(roleName(u.role))}</b> ${esc(u.name)}</span><span class="muted">${esc(u.email)}</span></button>`).join('')}
        <details><summary>Other demo clients</summary>
          ${clients.map((u) => `<button type="button" data-action="fill" data-email="${esc(u.email)}"><span>${esc(u.name)}</span><span class="muted">${esc(u.email)}</span></button>`).join('')}
        </details>
        <p class="tiny" style="margin-top:10px"><a href="#/apply">Public enquiry form (/apply)</a></p>
      </div>
    </div>
  </div>`;
}

/** Shown when a magic link is expired, already used or unknown. */
export function viewMagicProblem(status) {
  const msg = {
    EXPIRED: 'This sign-in link has expired. Links work for 15 minutes.',
    USED: 'This sign-in link has already been used. Each link works once.',
    INVALID: 'This sign-in link is not valid.',
  }[status] || 'This sign-in link cannot be used.';
  return `<div class="login-wrap"><div class="card login-card">
    <div class="logo dark"><b>PLATINUM</b><span>Immigration</span></div>
    <h1 style="font-size:20px;text-align:center">Sign-in link problem</h1>
    <p class="note amber small" style="margin:14px 0">${esc(msg)}</p>
    <form id="magicRequestForm" class="stack">
      <label class="field"><span>Email me a new link</span><input class="input" type="email" name="email" required inputmode="email" autocomplete="username"></label>
      ${ui.magicSent ? '<p class="note green small">If that email has an account, a new link is on its way.</p>' : ''}
      <button class="btn primary block" type="submit">Send a new link</button>
    </form>
    <p style="text-align:center;margin-top:12px"><a class="small" href="#/login">Sign in with a password</a></p>
  </div></div>`;
}

export function viewDenied(title, message, status) {
  const u = auth.currentUser();
  return `<main class="page narrow"><div class="card denied">
    <p class="mono muted">${esc(status || '')}</p><h1 style="font-size:22px;margin:6px 0">${esc(title)}</h1>
    <p class="muted">${esc(message)}</p>
    <div class="row" style="justify-content:center;margin-top:16px">
      ${u ? `<a class="btn primary" href="#/">Go to my home</a><button class="btn" data-action="logout">Log out</button>` : '<a class="btn primary" href="#/login">Sign in</a>'}
    </div></div></main>`;
}

