// digest: the daily staff email digest, and immediate alerts for critical events.
// Production: a scheduled function sends the digest each morning; alerts fire from the same events.
import { db, store } from './store.js';
import { emailer } from './providers/email.js';
import { metrics } from './metrics.js';
import { invoiceStatus } from './invoicing.js';
import { staffScopeOk } from './auth/permissions.js';
import { startOfDay, fmtDate } from './utils.js';
import { baseUrl } from './auth/session.js';

const link = (path) => `${baseUrl()}#${path}`;

/** What one staff member should know today. Consultants only see their own work. */
export function digestFor(user) {
  const mine = (assignedId) => staffScopeOk(user, assignedId);
  const cases = db.cases.filter((c) => mine(c.assignedStaffId));
  const caseIds = new Set(cases.map((c) => c.id));
  const toReview = db.items.filter((i) => caseIds.has(i.caseId) && ['UPLOADED', 'AI_FLAGGED'].includes(i.status));
  const overdueCases = cases.filter((c) => c.stage === 'COLLECTING_DOCUMENTS' && metrics.outstanding(c.id).length && metrics.daysLeft(c) < 0);
  const today = startOfDay(new Date());
  const followUps = db.leads.filter((l) => !['WON', 'LOST'].includes(l.stage) && l.nextFollowUp && startOfDay(l.nextFollowUp) <= today
    && (user.role === 'CONSULTANT' ? l.assignedStaffId === user.id : true));
  const overdueInvoices = db.invoices.filter((i) => caseIds.has(i.caseId) && invoiceStatus(i, store.case(i.caseId), db.config) === 'OVERDUE');
  return { toReview, overdueCases, followUps, overdueInvoices };
}

export function buildDigest(user) {
  const d = digestFor(user);
  const total = d.toReview.length + d.overdueCases.length + d.followUps.length + d.overdueInvoices.length;
  if (!total) return null;
  const name = (c) => store.caseClient(c).name;
  const lines = [`Good morning ${user.name.split(' ')[0]}, here is your digest for ${fmtDate(new Date().toISOString())}.`, ''];
  if (d.toReview.length) {
    lines.push(`New uploads to review (${d.toReview.length}):`);
    d.toReview.slice(0, 10).forEach((i) => lines.push(`- ${i.label} (${name(store.case(i.caseId))}, ${i.caseId})${i.status === 'AI_FLAGGED' ? ' [AI-flagged]' : ''}`));
    lines.push(`Open the queue: ${link('/staff/review')}`, '');
  }
  if (d.overdueCases.length) {
    lines.push(`Overdue cases (${d.overdueCases.length}):`);
    d.overdueCases.slice(0, 10).forEach((c) => lines.push(`- ${name(c)} (${c.id}): ${Math.abs(metrics.daysLeft(c))} days past target, ${metrics.outstanding(c.id).length} outstanding`));
    lines.push('');
  }
  if (d.followUps.length) {
    lines.push(`Follow-ups due or overdue (${d.followUps.length}):`);
    d.followUps.slice(0, 10).forEach((l) => lines.push(`- ${l.name} (${l.stage.replace(/_/g, ' ').toLowerCase()}), due ${fmtDate(l.nextFollowUp)}`));
    lines.push(`My day: ${link('/staff/my-day')}`, '');
  }
  if (d.overdueInvoices.length) {
    lines.push(`Overdue invoices (${d.overdueInvoices.length}):`);
    d.overdueInvoices.forEach((i) => lines.push(`- ${i.number} (${i.caseId})`));
    lines.push('');
  }
  return { subject: `Daily digest: ${total} item${total === 1 ? '' : 's'} need attention`, body: lines.join('\n').trim(), total };
}

/** Sends one email per staff member who has something to act on. */
export async function runStaffDigests() {
  let sent = 0; let skipped = 0;
  for (const u of db.users.filter((x) => x.role !== 'CLIENT')) {
    const dg = buildDigest(u);
    if (!dg) { skipped++; continue; }
    await emailer.send({ to: u.email, toName: u.name, subject: dg.subject, body: dg.body, trigger: 'STAFF_DIGEST' });
    sent++;
  }
  return { sent, skipped };
}

/** Immediate alert for a critical event: goes to the assigned consultant and every document specialist. */
export async function alertStaff(caseRec, trigger, subject, text) {
  const ids = new Set([caseRec.assignedStaffId]);
  db.users.filter((u) => u.role === 'DOCUMENT_SPECIALIST').forEach((u) => ids.add(u.id));
  for (const id of ids) {
    const u = store.user(id);
    if (!u) continue;
    await emailer.send({
      caseId: caseRec.id, to: u.email, toName: u.name, trigger, subject,
      body: `${text}\nCase ${caseRec.id} (${store.caseClient(caseRec).name}): ${link('/staff/case/' + encodeURIComponent(caseRec.id))}`,
    });
  }
}
