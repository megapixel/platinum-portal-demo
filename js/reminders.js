// reminders: the Sunday job. Production: a scheduled function (cron, SGT) calls the same logic server side.
import { db, store } from './store.js';
import { CASE_TYPES } from './domain.js';
import { fmtDate } from './utils.js';
import { metrics } from './metrics.js';
import { createMagicLink } from './auth/session.js';
import { notifyClient } from './notify.js';

/** One-time sign-in link to a case, addressed to the primary contact. */
export function portalLinkFor(c) {
  const client = store.caseClient(c);
  return createMagicLink(store.primaryContact(client).id, `/portal?case=${encodeURIComponent(c.id)}`).url;
}

/** Builds the template variables. Only item labels, dates and staff remarks are used: never NRIC or passport numbers. */
export function reminderVars(c) {
  const todo = metrics.clientTodo(c.id);
  if (!todo.length) return null;
  const lines = todo.map((i) => {
    const who = ` (${i.personLabel})`;
    const due = i.dueDate ? ` [due ${fmtDate(i.dueDate)}]` : '';
    if (i.status === 'REJECTED') return `- ${i.label}${who}${due}: ${i.staffRemark || 'please upload a new copy'}`;
    if (i.status === 'AI_FLAGGED') return `- ${i.label}${who}${due}: please check and upload a clearer or correct copy`;
    return `- ${i.label}${who}${due}`;
  });
  const left = metrics.daysLeft(c);
  return {
    caseType: CASE_TYPES[c.caseType].inMessage,
    caseNo: c.id,
    outstandingList: lines.join('\n'),
    timing: left >= 0 ? `You have ${left} days left.` : 'Your target date has passed, so please upload these as soon as possible.',
  };
}

/** What the reminder would say, without sending it. */
export function buildReminderMessage(c) {
  const vars = reminderVars(c);
  if (!vars) return null;
  return vars;
}

export async function sendCaseReminder(c, trigger) {
  const vars = reminderVars(c);
  if (!vars) return null;
  const client = store.caseClient(c);
  const msgs = await notifyClient(client, { caseId: c.id, trigger, templateKey: 'REMINDER_WEEKLY', vars, link: portalLinkFor(c) });
  c.lastReminderAt = new Date().toISOString();
  return msgs[0] || null;
}

/** `inScope` limits the run (a consultant pressing the button only reaches their own cases; the cron job passes none). */
export async function runWeeklyReminders(inScope) {
  const sent = [];
  let skipped = 0;
  for (const c of db.cases) {
    if (c.stage !== 'COLLECTING_DOCUMENTS' || c.remindersPaused || (inScope && !inScope(c))) continue;
    const msg = await sendCaseReminder(c, 'WEEKLY');
    if (msg) sent.push(msg); else skipped++;
  }
  return { sent, skipped };
}

/** Next scheduled reminder, for "Next reminder: Sunday" on the client home page. */
export function nextReminderDate(c) {
  const { day, hour } = c ? effectiveRule(c) : db.config.reminder;
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  let add = (day - d.getDay() + 7) % 7;
  if (add === 0 && d.getTime() <= Date.now()) add = 7;
  d.setDate(d.getDate() + add);
  return d;
}

export const FREQUENCY_DAYS = { WEEKLY: 7, FORTNIGHTLY: 14, MONTHLY: 30 };
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The rule that applies to a case: its own override, else the global one. */
export const effectiveRule = (c) => c.reminderRule || db.config.reminder;

/** Whether the scheduler should send this case's reminder at `now` (day and hour match, and the interval has passed). */
export function reminderDue(c, now) {
  if (c.remindersPaused || c.stage !== 'COLLECTING_DOCUMENTS') return false;
  const r = effectiveRule(c);
  if (now.getDay() !== r.day || now.getHours() < r.hour) return false;
  if (!c.lastReminderAt) return true;
  const gap = (now.getTime() - new Date(c.lastReminderAt).getTime()) / 86400000;
  return gap >= FREQUENCY_DAYS[r.frequency] - 0.5;
}

/** What the cron job calls every hour. Only cases whose rule is due are sent. */
export async function runScheduledReminders(now = new Date()) {
  const sent = [];
  for (const c of db.cases) {
    if (!reminderDue(c, now)) continue;
    const msg = await sendCaseReminder(c, 'WEEKLY');
    if (msg) sent.push(msg);
  }
  return { sent };
}
