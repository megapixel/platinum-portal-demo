// api/onboarding: the onboarding information form, and "submit for review".
import { db, store } from '../store.js';
import { HttpError, uid, nowIso } from '../utils.js';
import { requireCaseAccess } from '../auth/session.js';
import { formProgress } from '../caselogic.js';
import { notifyClient } from '../notify.js';

export const formDefFor = (caseType) => db.formDefs.find((f) => f.caseType === caseType) || null;

export const onboardingApi = {
  getForm(caseId) {
    const { caseRec } = requireCaseAccess(caseId, 'case:view');
    const def = formDefFor(caseRec.caseType);
    return { def, data: caseRec.onboarding.data, status: caseRec.onboarding.status, progress: formProgress(def, caseRec.onboarding.data) };
  },

  /** Saves answers as a draft, or submits when `submit` is true (all required fields must be filled). */
  saveOnboarding(caseId, answers, submit) {
    const { user, caseRec } = requireCaseAccess(caseId, 'onboarding:edit');
    const def = formDefFor(caseRec.caseType);
    if (!def) throw new HttpError(400, 'There is no information form for this case type.');
    const known = new Set(def.sections.flatMap((s) => s.fields.map((f) => f.key)));
    const ob = caseRec.onboarding;
    const before = {};
    const after = {};
    for (const [k, v] of Object.entries(answers || {})) {
      if (!known.has(k)) continue;
      const nv = String(v == null ? '' : v).trim();
      if ((ob.data[k] || '') !== nv) { before[k] = ob.data[k] || ''; after[k] = nv; }
      ob.data[k] = nv;
    }
    const progress = formProgress(def, ob.data);
    if (submit && progress.done < progress.total) {
      throw new HttpError(400, `Please complete the required fields first (${progress.done} of ${progress.total} done).`);
    }
    ob.updatedAt = nowIso();
    ob.updatedById = user.id;
    if (submit) { ob.status = 'SUBMITTED'; ob.submittedAt = ob.updatedAt; }
    // Keep the client profile name in step with the form, so letters and AI checks use one source.
    if (ob.data.full_name) store.caseClient(caseRec).profile.formName = ob.data.full_name;
    if (Object.keys(after).length || submit) {
      store.audit(caseId, submit ? 'ONBOARDING_SUBMITTED' : 'ONBOARDING_SAVED',
        `${submit ? 'Submitted' : 'Saved'} information form (${progress.pct}% complete)${user.role === 'CLIENT' ? '' : ' on behalf of the client'}`, user.id, null, { before, after });
    }
    store.save();
    return { progress, status: ob.status };
  },

  /** Documents uploaded since the last review request, i.e. what a "submit for review" covers. */
  pendingUploads(caseId) {
    const last = db.reviewTasks.filter((t) => t.caseId === caseId).map((t) => t.createdAt).sort().pop() || '';
    return db.documents.filter((d) => d.caseId === caseId && d.uploadedAt > last);
  },

  /** "I've finished uploading - submit for review": creates a task for the document specialist and confirms to the client. */
  async submitForReview(caseId) {
    const { user, caseRec } = requireCaseAccess(caseId, 'item:upload');
    const docs = onboardingApi.pendingUploads(caseId);
    if (!docs.length) throw new HttpError(400, 'Upload at least one document first.');
    const task = {
      id: uid('rt'), caseId, createdAt: nowIso(), createdById: user.id, status: 'OPEN',
      itemIds: [...new Set(docs.map((d) => d.itemId))], doneAt: null,
    };
    db.reviewTasks.push(task);
    store.audit(caseId, 'SUBMITTED_FOR_REVIEW', `${task.itemIds.length} document${task.itemIds.length === 1 ? '' : 's'} sent for review`, user.id);
    await notifyClient(store.caseClient(caseRec), { caseId, trigger: 'REVIEW_SUBMITTED', templateKey: 'REVIEW_SUBMITTED', vars: { caseNo: caseRec.id } });
    store.save();
    return task;
  },
};
