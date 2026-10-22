// auth (simulated). Production: server sessions plus SSO for staff and OTP / magic link for clients.
import { db, store } from '../store.js';
import { can, staffScopeOk } from './permissions.js';
import { isStaffRole } from '../domain.js';
import { HttpError, safeGet, safeSet, safeRemove, uid, nowIso } from '../utils.js';
import { emailer } from '../providers/email.js';

const SESSION_KEY = 'pi_portal_session';

export const auth = {
  currentUser() {
    const id = safeGet(window.sessionStorage, SESSION_KEY);
    return id ? store.user(id) || null : null;
  },
  login(identifier, password) {
    const key = String(identifier).trim().toLowerCase();
    const u = db.users.find((x) => x.email.toLowerCase() === key || (x.aliases || []).includes(key));
    if (!u || u.password !== password) throw new HttpError(401, 'Email or password is incorrect.');
    safeSet(window.sessionStorage, SESSION_KEY, u.id);
    return u;
  },
  logout() { safeRemove(window.sessionStorage, SESSION_KEY); },
  startSession(userId) { safeSet(window.sessionStorage, SESSION_KEY, userId); },
};

// ---------- magic links (passwordless login) ----------

export function baseUrl() { return window.location.href.split('#')[0]; }

/** Creates a one-time link for a user. Expires after config.magicLinkMinutes. Caller saves the store. */
export function createMagicLink(userId, next) {
  const token = uid('ml').replace('_', '') + Math.random().toString(36).slice(2, 10);
  const now = Date.now();
  db.magicLinks.push({
    token, userId, next: next || '/portal', createdAt: nowIso(),
    expiresAt: new Date(now + db.config.magicLinkMinutes * 60000).toISOString(), usedAt: null,
  });
  return { token, url: `${baseUrl()}#/magic/${token}` };
}

/** Checks the token without consuming it. status: OK | EXPIRED | USED | INVALID */
export function inspectMagicLink(token) {
  const ml = db.magicLinks.find((m) => m.token === token);
  if (!ml) return { status: 'INVALID' };
  if (ml.usedAt) return { status: 'USED', link: ml };
  if (new Date(ml.expiresAt).getTime() < Date.now()) return { status: 'EXPIRED', link: ml };
  return { status: 'OK', link: ml };
}

export function consumeMagicLink(token) {
  const r = inspectMagicLink(token);
  if (r.status !== 'OK') return r;
  r.link.usedAt = nowIso();
  auth.startSession(r.link.userId);
  const user = store.user(r.link.userId);
  const c = user && user.clientId ? db.cases.find((x) => x.clientId === user.clientId) : null;
  if (c) store.audit(c.id, 'MAGIC_LINK_LOGIN', `${user.name} signed in with a magic link`, user.id);
  store.save();
  return r;
}

/** Public: "email me a sign-in link". Always reports success so it cannot be used to probe for accounts. */
export async function requestMagicLink(email) {
  const key = String(email || '').trim().toLowerCase();
  const user = db.users.find((u) => u.email.toLowerCase() === key);
  if (user) {
    const next = user.role === 'CLIENT' ? '/portal' : '/staff';
    const { url } = createMagicLink(user.id, next);
    const c = user.clientId ? db.cases.find((x) => x.clientId === user.clientId) : null;
    await emailer.send({
      caseId: c ? c.id : null, to: user.email, toName: user.name, trigger: 'MAGIC_LINK',
      subject: 'Your Platinum Immigration sign-in link',
      body: `Hi ${user.name.split(' ')[0]},\n\nUse this link to sign in. It works once and expires in ${db.config.magicLinkMinutes} minutes:\n${url}\n\nIf you did not ask for this, you can ignore this email.`,
      link: url,
    });
    store.save();
  }
}

// ---------- guards ----------
// In production these run inside every API route handler and server action.

export function requireUser() {
  const u = auth.currentUser();
  if (!u) throw new HttpError(401, 'Please sign in.');
  return u;
}
export function requirePerm(permission) {
  const u = requireUser();
  if (!can(u, permission)) throw new HttpError(403, 'You do not have permission to do that.');
  return u;
}
/** Any staff role. Prefer requirePerm with a specific permission. */
export function requireStaff() {
  const u = requireUser();
  if (!isStaffRole(u.role)) throw new HttpError(403, 'Staff only.');
  return u;
}
/** Case access: clients only their own case, consultants only assigned cases, others per permission. */
export function requireCaseAccess(caseId, permission = 'case:view') {
  const u = requirePerm(permission);
  const c = store.case(caseId);
  if (!c) throw new HttpError(404, 'Case not found.');
  if (u.role === 'CLIENT') {
    const client = store.client(c.clientId);
    if (!client || !client.contacts.some((x) => x.userId === u.id)) throw new HttpError(403, 'You do not have access to this case.');
  } else if (!staffScopeOk(u, c.assignedStaffId)) {
    throw new HttpError(403, 'This case is assigned to another consultant.');
  }
  return { user: u, caseRec: c };
}
export function requireLeadAccess(leadId, permission = 'lead:view') {
  const u = requirePerm(permission);
  const l = store.lead(leadId);
  if (!l) throw new HttpError(404, 'Lead not found.');
  // Unassigned leads (new enquiries) are open to every consultant until one claims them.
  if (l.assignedStaffId && !staffScopeOk(u, l.assignedStaffId)) throw new HttpError(403, 'This lead is assigned to another consultant.');
  return { user: u, lead: l };
}
