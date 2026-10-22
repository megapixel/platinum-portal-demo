// api/messaging: message templates, reminder rules, per-case overrides, staff digests, message log.
import { db, store } from '../store.js';
import { HttpError, uid, nowIso } from '../utils.js';
import { requirePerm, requireCaseAccess } from '../auth/session.js';
import { DEFAULT_MESSAGE_TEMPLATES, unknownFields } from '../messagetemplates.js';
import { FREQUENCY_DAYS, runScheduledReminders } from '../reminders.js';
import { runStaffDigests } from '../digest.js';

function systemAudit(action, detail, actorId, before, after) {
  db.audit.push({ id: uid('au'), caseId: null, leadId: null, itemId: null, action, detail, actorId, at: nowIso(), before, after });
}
function validRule(r) {
  if (!r || !(r.day >= 0 && r.day <= 6) || !(r.hour >= 0 && r.hour <= 23) || !(r.frequency in FREQUENCY_DAYS)) throw new HttpError(400, 'Choose a valid day, hour and frequency.');
  return { day: Number(r.day), hour: Number(r.hour), frequency: r.frequency };
}

export const messagingApi = {
  saveMessageTemplate(key, patch) {
    const user = requirePerm('messagetemplate:manage');
    const t = db.messageTemplates.find((x) => x.key === key);
    if (!t) throw new HttpError(404, 'Template not found.');
    const subject = String(patch.subject || '').trim();
    const body = String(patch.body || '').trim();
    if (!body || !subject) throw new HttpError(400, 'Subject and message cannot be empty.');
    if (!['WHATSAPP', 'EMAIL', 'BOTH'].includes(patch.channel)) throw new HttpError(400, 'Choose a channel.');
    const bad = unknownFields(key, subject, body);
    if (bad.length) throw new HttpError(400, `These merge fields are not available here: ${bad.map((b) => `{{${b}}}`).join(', ')}.`);
    const before = { subject: t.subject, body: t.body, channel: t.channel };
    Object.assign(t, { subject, body, channel: patch.channel });
    systemAudit('TEMPLATE_EDITED', `Edited message template: ${t.name}`, user.id, before, { subject, body, channel: patch.channel });
    store.save();
  },

  resetMessageTemplate(key) {
    const user = requirePerm('messagetemplate:manage');
    const def = DEFAULT_MESSAGE_TEMPLATES.find((x) => x.key === key);
    const t = db.messageTemplates.find((x) => x.key === key);
    if (!def || !t) throw new HttpError(404, 'Template not found.');
    Object.assign(t, { ...def });
    systemAudit('TEMPLATE_EDITED', `Reset message template to default: ${t.name}`, user.id);
    store.save();
  },

  /** Global reminder rule: day, hour and frequency. Per-case overrides are untouched. */
  saveReminderRules(rule) {
    const user = requirePerm('messagetemplate:manage');
    const before = { ...db.config.reminder };
    db.config.reminder = validRule(rule);
    systemAudit('REMINDER_RULE_CHANGED', 'Changed the global reminder rule', user.id, before, db.config.reminder);
    store.save();
  },

  /** Per-case: pause, or override the schedule. rule null clears the override. */
  setCaseReminder(caseId, { paused, rule }) {
    const { user, caseRec: c } = requireCaseAccess(caseId, 'message:send');
    const before = { paused: !!c.remindersPaused, rule: c.reminderRule || null };
    if (paused !== undefined) c.remindersPaused = !!paused;
    if (rule !== undefined) c.reminderRule = rule ? validRule(rule) : null;
    store.audit(caseId, 'REMINDER_SETTINGS_CHANGED', `Reminders ${c.remindersPaused ? 'paused' : 'active'}${c.reminderRule ? ', custom schedule' : ', global schedule'}`, user.id, null,
      { before, after: { paused: !!c.remindersPaused, rule: c.reminderRule || null } });
    store.save();
  },

  async sendStaffDigests() {
    requirePerm('messagetemplate:manage');
    const res = await runStaffDigests();
    store.save();
    return res;
  },

  /** Simulates the hourly cron: sends only cases whose rule is due at `now`. */
  async runScheduledReminders(now) {
    requirePerm('messagetemplate:manage');
    const res = await runScheduledReminders(now);
    store.save();
    return res;
  },

  /** Every message sent for a case, across channels. Answers "the client says they never received the list". */
  messageLog(caseId) {
    requireCaseAccess(caseId, 'outbox:view');
    const wa = db.outbox.filter((m) => m.caseId === caseId).map((m) => ({ ...m, channel: 'WHATSAPP', to: m.toPhone }));
    const em = db.emails.filter((m) => m.caseId === caseId).map((m) => ({ ...m, channel: 'EMAIL' }));
    return wa.concat(em).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
};
