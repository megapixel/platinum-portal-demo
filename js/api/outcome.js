// api/outcome: outcome capture, re-application as a new attempt, and the audit timeline.
import { db, store } from '../store.js';
import { CASE_TYPES } from '../domain.js';
import { HttpError, uid, nowIso, fmtDate, startOfDay } from '../utils.js';
import { requirePerm, requireCaseAccess, requireLeadAccess } from '../auth/session.js';
import { reuseCheck, defaultTargetDate } from '../caselogic.js';
import { notifyClient } from '../notify.js';
import { portalLinkFor } from '../reminders.js';
import { alertStaff } from '../digest.js';
import { changeStage } from './cases.js';
import { nextCaseNo } from './numbering.js';

export const outcomeApi = {
  /**
   * Records the decision. From Submitted this moves the case to Outcome and sends the matching message
   * (approved or rejected with next steps). On a case already at Outcome it corrects the record without re-notifying.
   */
  async recordOutcome(caseId, spec) {
    const { user, caseRec: c } = requireCaseAccess(caseId, 'case:stage');
    if (!['SUBMITTED', 'OUTCOME'].includes(c.stage)) throw new HttpError(409, 'Move the case to Submitted before recording an outcome.');
    const result = spec.result;
    if (!['APPROVED', 'REJECTED'].includes(result)) throw new HttpError(400, 'Choose approved or rejected.');
    const decisionDate = spec.decisionDate ? startOfDay(spec.decisionDate).toISOString() : '';
    if (!decisionDate) throw new HttpError(400, 'Enter the decision date.');
    if (new Date(decisionDate) > new Date()) throw new HttpError(400, 'The decision date cannot be in the future.');
    const reason = String(spec.reason || '').trim();
    if (result === 'REJECTED' && !reason) throw new HttpError(400, 'Enter the reason given for the rejection.');
    const outcome = {
      result, decisionDate, reference: String(spec.reference || '').trim(), reason: result === 'REJECTED' ? reason : '',
      nextSteps: String(spec.nextSteps || '').trim(), recordedById: user.id, recordedAt: nowIso(),
    };
    const correcting = c.stage === 'OUTCOME' && !!c.outcome;
    const before = c.outcome ? { result: c.outcome.result, reference: c.outcome.reference, reason: c.outcome.reason } : null;
    c.outcome = outcome;
    store.audit(caseId, correcting ? 'OUTCOME_CORRECTED' : 'OUTCOME_RECORDED',
      `${result === 'APPROVED' ? 'Approved' : 'Rejected'} on ${fmtDate(decisionDate)}${outcome.reference ? `, reference ${outcome.reference}` : ''}`, user.id, null,
      { before, after: { result, reference: outcome.reference, reason: outcome.reason } });
    if (!correcting) {
      await changeStage(c, 'OUTCOME', user, '', { silent: true });
      const approved = result === 'APPROVED';
      await notifyClient(store.caseClient(c), {
        caseId, trigger: approved ? 'OUTCOME_APPROVED' : 'OUTCOME_REJECTED', templateKey: approved ? 'OUTCOME_APPROVED' : 'OUTCOME_REJECTED', link: portalLinkFor(c),
        vars: { caseNo: c.id, caseType: CASE_TYPES[c.caseType].inMessage, date: fmtDate(decisionDate), reference: outcome.reference || 'n/a', reason, nextSteps: outcome.nextSteps || 'Your consultant will be in touch.' },
      });
      await alertStaff(c, 'STAFF_ALERT', `Outcome received: ${store.caseClient(c).name} (${approved ? 'approved' : 'rejected'})`,
        `An outcome was recorded: ${approved ? 'approved' : 'rejected'} on ${fmtDate(decisionDate)}.`);
    }
    store.save();
    return outcome;
  },

  /**
   * Re-application after a rejection. Default rule (config.reapplicationRule): the same case continues as a new attempt,
   * keeping history and documents. NEW_CASE opens a linked case instead. Accepted documents that have not expired and are
   * within their validity window carry over; the rest go back to Pending with a note.
   */
  async reapply(caseId) {
    const { user, caseRec: c } = requireCaseAccess(caseId, 'case:stage');
    if (c.stage !== 'OUTCOME' || !c.outcome || c.outcome.result !== 'REJECTED') throw new HttpError(409, 'Only a case with a rejected outcome can be re-applied.');
    const items = store.itemsFor(caseId);
    const checks = items.map((i) => ({ item: i, doc: store.latestDoc(i.id), check: reuseCheck(i, store.latestDoc(i.id), db.config) }));
    const reused = checks.filter((x) => x.check.ok).length;
    const submittedAt = db.stageHistory.filter((h) => h.caseId === caseId && h.stage === 'SUBMITTED').map((h) => h.changedAt).sort().pop() || null;
    const archive = { attempt: c.attempt || 1, startedAt: c.attemptStartedAt || c.startDate, submittedAt, outcome: c.outcome };
    const history = (c.attemptHistory || []).concat(archive);
    const next = (c.attempt || 1) + 1;
    const startDate = startOfDay(new Date()).toISOString();

    if (db.config.reapplicationRule === 'NEW_CASE') {
      const nid = nextCaseNo();
      const nc = {
        ...JSON.parse(JSON.stringify(c)), id: nid, stage: 'ONBOARDED', attempt: next, outcome: null, previousCaseId: c.id, attemptHistory: history,
        startDate, attemptStartedAt: startDate, targetSubmissionDate: defaultTargetDate(startDate), createdAt: nowIso(), packs: [], remindersPaused: false, lastReminderAt: null,
        sourceLeadId: null,
      };
      nc.onboarding.status = 'DRAFT';
      db.cases.push(nc);
      for (const { item, doc, check } of checks) {
        const nItem = { ...JSON.parse(JSON.stringify(item)), id: item.id.startsWith(c.id + '_') ? nid + item.id.slice(c.id.length) : uid('it'), caseId: nid, updatedAt: nowIso(), reuploaded: false, dueDate: null };
        if (check.ok) {
          nItem.reusedFromAttempt = archive.attempt;
          db.documents.push({ ...doc, id: uid('doc'), itemId: nItem.id, caseId: nid, blobId: doc.blobId || doc.id, version: 1 });
        } else {
          Object.assign(nItem, { status: 'PENDING', staffRemark: null, rejectedAt: null, rejectReason: null, attemptNote: item.status === 'ACCEPTED' ? check.reason : null });
        }
        db.items.push(nItem);
      }
      for (const st of ['ONBOARDED', 'COLLECTING_DOCUMENTS']) db.stageHistory.push({ id: uid('sh'), caseId: nid, stage: st, attempt: next, changedAt: nowIso(), changedById: user.id });
      nc.stage = 'COLLECTING_DOCUMENTS';
      store.audit(nid, 'REAPPLICATION_STARTED', `Attempt ${next}, linked to ${c.id}: ${reused} documents reused, ${items.length - reused} to renew`, user.id, null, { before: { previousCase: c.id }, after: { attempt: next } });
      store.audit(c.id, 'REAPPLICATION_STARTED', `Re-application opened as new case ${nid} (attempt ${next})`, user.id, null, { after: { newCase: nid } });
      await notifyClient(store.caseClient(nc), { caseId: nid, trigger: 'STAGE_CHANGED', templateKey: 'STAGE_CHANGED', link: portalLinkFor(nc), vars: { caseNo: nid, stage: `Collecting documents (attempt ${next})` } });
      store.save();
      return { caseRec: nc, reused, renewed: items.length - reused };
    }

    // Same case, new attempt (default).
    c.attemptHistory = history;
    c.attempt = next;
    c.attemptStartedAt = startDate;
    c.outcome = null;
    c.targetSubmissionDate = defaultTargetDate(startDate);
    c.remindersPaused = false; c.lastReminderAt = null;
    c.onboarding.status = 'DRAFT';
    for (const { item, check } of checks) {
      item.reuploaded = false; item.dueDate = null; item.updatedAt = nowIso();
      if (check.ok) { item.reusedFromAttempt = archive.attempt; item.attemptNote = null; continue; }
      const wasAccepted = item.status === 'ACCEPTED';
      Object.assign(item, { status: 'PENDING', staffRemark: null, rejectedAt: null, rejectReason: null, reusedFromAttempt: null, attemptNote: wasAccepted ? check.reason : null });
    }
    store.audit(caseId, 'REAPPLICATION_STARTED', `Attempt ${next}: ${reused} documents reused, ${items.length - reused} to renew`, user.id, null, { before: { attempt: next - 1, outcome: 'REJECTED' }, after: { attempt: next } });
    await changeStage(c, 'COLLECTING_DOCUMENTS', user, `re-application attempt ${next}`);
    store.save();
    return { caseRec: c, reused, renewed: items.length - reused };
  },

  /** Audit entries for one case, one lead, or everything (admin). Newest first. */
  auditFor(scope) {
    if (scope.caseId) { requireCaseAccess(scope.caseId, 'audit:view'); return db.audit.filter((a) => a.caseId === scope.caseId).sort((a, b) => b.at.localeCompare(a.at)); }
    if (scope.leadId) { requireLeadAccess(scope.leadId, 'audit:view'); return db.audit.filter((a) => a.leadId === scope.leadId).sort((a, b) => b.at.localeCompare(a.at)); }
    requirePerm('config:manage');
    return db.audit.slice().sort((a, b) => b.at.localeCompare(a.at));
  },
};
