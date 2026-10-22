// api/cases: cases, documents, review, stages. Every call is guarded, mirroring server routes.
import { db, store } from '../store.js';
import { STAGES, STAGE_INDEX, CASE_TYPES, ACCEPTED_MIME, MAX_UPLOAD_BYTES, REJECT_REASON } from '../domain.js';
import { HttpError, uid, nowIso, startOfDay, fmtDate, fmtMoney } from '../utils.js';
import { documentReader, crossCheckName } from '../ai.js';
import { storage } from '../storage.js';
import { crmSync } from '../providers/crm.js';
import { requireUser, requirePerm, requireCaseAccess } from '../auth/session.js';
import { staffScopeOk, can } from '../auth/permissions.js';
import { personList, instantiateItems, defaultTargetDate } from '../caselogic.js';
import { metrics } from '../metrics.js';
import { notifyClient } from '../notify.js';
import { portalLinkFor, sendCaseReminder, runWeeklyReminders } from '../reminders.js';
import { nextCaseNo } from './numbering.js';
import { alertStaff } from '../digest.js';
import { caseBalance } from './invoices.js';

export function casePeople(c) {
  const client = store.caseClient(c);
  return personList({ name: client.name, profile: client.profile, dependants: c.dependants });
}
export function personFor(c, item) {
  return casePeople(c).find((p) => p.label === item.personLabel) || casePeople(c)[0];
}

const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const validPhone = (p) => /^\+?[0-9 ]{8,}$/.test(p);

/**
 * Shared by createCase (staff, manual) and convertLead (sales): creates the Client record, one login per
 * contact, the case with its checklist from the template, and the welcome message. No re-keying.
 */
export async function createClientWithCase(spec, actor) {
  const name = String(spec.name || '').trim();
  const email = String(spec.email || '').trim().toLowerCase();
  const phone = String(spec.phone || '').trim();
  if (!name) throw new HttpError(400, 'Please enter the client name.');
  if (!validEmail(email)) throw new HttpError(400, 'Please enter a valid email address.');
  if (db.users.some((u) => u.email.toLowerCase() === email)) throw new HttpError(409, 'A user with this email already exists.');
  if (!validPhone(phone)) throw new HttpError(400, 'Please enter a mobile number for WhatsApp reminders, e.g. +65 9123 4567.');
  if (!CASE_TYPES[spec.caseType]) throw new HttpError(400, 'Please choose a case type.');
  const template = db.templates.find((t) => t.caseType === spec.caseType);
  if (!template || !template.items.length) throw new HttpError(400, 'There is no checklist template for this case type yet.');

  const sec = spec.secondary && (spec.secondary.email || spec.secondary.name || spec.secondary.phone) ? spec.secondary : null;
  if (sec) {
    const se = String(sec.email || '').trim().toLowerCase();
    if (!String(sec.name || '').trim() || !validEmail(se)) throw new HttpError(400, 'A secondary contact needs a name and a valid email address.');
    if (se === email || db.users.some((u) => u.email.toLowerCase() === se)) throw new HttpError(409, 'The secondary contact email is already in use.');
  }

  const dependants = [];
  if (spec.caseType === 'PR_WITH_DEPENDANTS') {
    const spouse = String(spec.spouseName || '').trim();
    if (spouse) dependants.push({ relation: 'SPOUSE', name: spouse, nationality: spec.nationality });
    String(spec.children || '').split('\n').map((x) => x.trim()).filter(Boolean)
      .forEach((child) => dependants.push({ relation: 'CHILD', name: child, nationality: spec.nationality }));
    if (!dependants.length && !spec.allowNoDependants) throw new HttpError(400, 'Please add at least one dependant, or choose a plain PR application.');
  }
  const married = !!spec.married || dependants.some((x) => x.relation === 'SPOUSE');

  const clientId = uid('cl');
  const profile = { nationality: String(spec.nationality || '').trim() || 'Malaysian', dob: spec.dob || '' };
  const user = { id: uid('u'), name, email, password: 'demo1234', role: 'CLIENT', phone, clientId, contactKind: 'PRIMARY', createdAt: nowIso() };
  const contacts = [{ userId: user.id, kind: 'PRIMARY' }];
  const users = [user];
  if (sec) {
    const su = { id: uid('u'), name: String(sec.name).trim(), email: String(sec.email).trim().toLowerCase(), password: 'demo1234', role: 'CLIENT', phone: String(sec.phone || '').trim(), clientId, contactKind: 'SECONDARY', createdAt: nowIso() };
    users.push(su);
    contacts.push({ userId: su.id, kind: 'SECONDARY' });
  }
  const client = { id: clientId, name, profile, dependants, channelPref: spec.channelPref || 'WHATSAPP', contacts, createdAt: nowIso() };

  const caseId = nextCaseNo();
  const startDate = startOfDay(spec.startDate ? new Date(spec.startDate) : new Date()).toISOString();
  const stage = spec.stage === 'ONBOARDED' ? 'ONBOARDED' : 'COLLECTING_DOCUMENTS';
  const caseRec = {
    id: caseId, clientId, caseType: spec.caseType, stage, attempt: 1,
    assignedStaffId: spec.assignedStaffId || actor.id, startDate, targetSubmissionDate: defaultTargetDate(startDate),
    married, dependants, createdAt: nowIso(), sourceLeadId: spec.sourceLeadId || null, packageId: spec.packageId || null,
    legacyDriveUrl: '', remindersPaused: false,
    onboarding: { data: { full_name: name, dob: profile.dob, nationality: profile.nationality, marital_status: married ? 'Married' : '' }, status: 'DRAFT', updatedAt: nowIso(), updatedById: actor.id, submittedAt: null },
  };
  const items = instantiateItems(template, caseRec, personList({ name, profile, dependants }), married);
  items.forEach((i) => { i.updatedAt = caseRec.createdAt; });

  db.users.push(...users);
  db.clients.push(client);
  db.cases.push(caseRec);
  db.items.push(...items);
  for (let i = 0; i <= STAGE_INDEX[caseRec.stage]; i++) {
    db.stageHistory.push({ id: uid('sh'), caseId, stage: STAGES[i].key, changedAt: nowIso(), changedById: actor.id });
  }
  store.audit(caseId, 'CASE_CREATED', `${CASE_TYPES[caseRec.caseType].label} with ${items.length} checklist items`, actor.id, null, { after: { stage, caseType: caseRec.caseType } });

  let welcome = null;
  if (spec.sendWelcome) {
    const msgs = await notifyClient(client, {
      caseId, trigger: 'WELCOME', templateKey: 'WELCOME', link: portalLinkFor(caseRec),
      vars: { caseType: CASE_TYPES[caseRec.caseType].inMessage, caseNo: caseId, requiredCount: items.filter((i) => i.required).length, targetDate: fmtDate(caseRec.targetSubmissionDate) },
    });
    welcome = msgs[0] || null;
  }
  crmSync.onStageChanged(caseId, caseRec.stage);
  return { caseRec, client, welcome, user };
}


/** Moves a case to a stage: history, audit, client message, CRM hook. Callers check permissions and save. */
export async function changeStage(c, stage, actor, note, opts) {
  if (!(stage in STAGE_INDEX)) throw new HttpError(400, 'Invalid stage.');
  if (c.stage === stage) return;
  const before = c.stage;
  c.stage = stage;
  db.stageHistory.push({ id: uid('sh'), caseId: c.id, stage, attempt: c.attempt || 1, changedAt: nowIso(), changedById: actor.id });
  store.audit(c.id, 'STAGE_CHANGED', STAGES[STAGE_INDEX[stage]].label + (note ? ` (${note})` : ''), actor.id, null, { before: { stage: before }, after: { stage } });
  const submitted = stage === 'SUBMITTED';
  if (!(opts && opts.silent)) await notifyClient(store.caseClient(c), {
    caseId: c.id, trigger: submitted ? 'APPLICATION_SUBMITTED' : 'STAGE_CHANGED', templateKey: submitted ? 'APPLICATION_SUBMITTED' : 'STAGE_CHANGED', link: portalLinkFor(c),
    vars: { caseNo: c.id, stage: STAGES[STAGE_INDEX[stage]].label, caseType: CASE_TYPES[c.caseType].inMessage, date: fmtDate(nowIso()) },
  });
  crmSync.onStageChanged(c.id, stage);
}

/** Closes open review tasks once nothing in them is waiting for review any more. */
function closeFinishedTasks(caseId) {
  for (const t of db.reviewTasks.filter((x) => x.caseId === caseId && x.status === 'OPEN')) {
    const waiting = t.itemIds.some((id) => { const i = store.item(id); return i && ['UPLOADED', 'AI_FLAGGED'].includes(i.status); });
    if (!waiting) { t.status = 'DONE'; t.doneAt = nowIso(); }
  }
}

export const caseApi = {
  /** Cases the current user may see: a client's own, a consultant's assigned ones, or all for other staff. */
  visibleCases() {
    const u = requirePerm('case:view');
    if (u.role === 'CLIENT') {
      const client = store.clientOf(u);
      return client ? db.cases.filter((c) => c.clientId === client.id) : [];
    }
    return db.cases.filter((c) => staffScopeOk(u, c.assignedStaffId));
  },
  myCases() { return caseApi.visibleCases(); },
  getCase(caseId) { return requireCaseAccess(caseId).caseRec; },

  async uploadDocument(itemId, file) {
    const item = store.item(itemId);
    if (!item) throw new HttpError(404, 'Checklist item not found.');
    const { user, caseRec } = requireCaseAccess(item.caseId, 'item:upload');
    if (item.status === 'ACCEPTED') throw new HttpError(409, 'This document has already been accepted.');
    const mime = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : /\.png$/i.test(file.name) ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : '');
    if (!ACCEPTED_MIME.includes(mime)) throw new HttpError(400, 'Please upload a PDF, JPG or PNG file.');
    if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(400, 'This file is larger than 10 MB. Please upload a smaller file.');

    const onBehalf = user.role !== 'CLIENT';
    const doc = {
      id: uid('doc'), itemId, caseId: caseRec.id, fileName: file.name, mimeType: mime, size: file.size, uploadedAt: nowIso(),
      source: 'upload', uploadedById: user.id, uploadedBy: { userId: user.id, role: user.role, onBehalf },
    };
    await storage.put(doc.id, file);

    const person = personFor(caseRec, item);
    let result;
    try {
      result = await documentReader.analyseDocument(file, mime, { label: item.label, requiredFields: item.requiredFields, docType: item.docType, person });
    } catch (e) {
      result = { detectedType: 'other', matchesExpected: false, confidence: 0, extracted: {}, issues: ['We could not read this automatically. Our team will review it manually.'] };
    }
    // Cross-check against the onboarding form: names must agree (main applicant documents only).
    const issues = result.issues.slice();
    if (person.appliesTo === 'MAIN') {
      const mismatch = crossCheckName(result.extracted, caseRec.onboarding && caseRec.onboarding.data.full_name);
      if (mismatch) issues.push(mismatch);
    }
    Object.assign(doc, {
      aiDetectedType: result.detectedType, aiConfidence: result.confidence, aiMatches: result.matchesExpected,
      aiExtracted: result.extracted, aiIssues: issues, aiCheckedAt: nowIso(),
    });

    // Re-read the item: another tab may have changed it while the check ran.
    store.reload();
    const fresh = store.item(itemId);
    if (!fresh) throw new HttpError(404, 'Checklist item was removed.');
    if (fresh.status === 'ACCEPTED') throw new HttpError(409, 'This document has already been accepted.');
    doc.version = store.docsFor(itemId).length + 1;
    db.documents.push(doc);
    const before = fresh.status;
    fresh.status = result.matchesExpected && issues.length === 0 ? 'UPLOADED' : 'AI_FLAGGED';
    const wasRejected = before === 'REJECTED';
    fresh.staffRemark = null;
    fresh.rejectedAt = null;
    fresh.rejectReason = null;
    fresh.reuploaded = wasRejected;
    fresh.updatedAt = doc.uploadedAt;
    store.audit(caseRec.id, 'UPLOADED', `${fresh.label} (${fresh.personLabel}): ${doc.fileName} (v${doc.version})${onBehalf ? ' on behalf of the client' : ''}`, user.id, fresh.id,
      { before: { status: before }, after: { status: fresh.status, version: doc.version } });
    if (wasRejected && !onBehalf) {
      await alertStaff(caseRec, 'STAFF_ALERT', `Re-upload: ${fresh.label}`, `${store.caseClient(caseRec).name} re-uploaded a rejected document: ${fresh.label} (${fresh.personLabel}).`);
    }
    store.save();
    crmSync.onItemStatusChanged(caseRec.id, fresh.id, fresh.status);
    return { item: fresh, doc };
  },

  /** decision: ACCEPTED | REJECTED. For REJECTED pass a reason key from REJECT_REASONS and an optional note. */
  async reviewItem(itemId, decision, remark, reasonKey) {
    const item = store.item(itemId);
    if (!item) throw new HttpError(404, 'Checklist item not found.');
    const { user: staff, caseRec } = requireCaseAccess(item.caseId, 'item:review');
    if (!store.latestDoc(itemId)) throw new HttpError(400, 'There is no document to review yet.');
    const reason = REJECT_REASON[reasonKey] || null;
    const note = String(remark || '').trim();
    if (decision === 'REJECTED' && !reason && !note) throw new HttpError(400, 'Please pick a reason or add a remark for the client.');
    const before = item.status;
    item.status = decision;
    item.updatedAt = nowIso();
    item.reuploaded = false;
    if (decision === 'REJECTED') {
      item.staffRemark = [reason && reason.text, note].filter(Boolean).join(' ') || 'Please upload a new copy.';
      item.rejectReason = reason ? reason.key : 'OTHER';
      item.rejectedAt = item.updatedAt;
    } else { item.staffRemark = null; item.rejectReason = null; item.rejectedAt = null; }
    store.audit(item.caseId, decision, `${item.label} (${item.personLabel})${decision === 'REJECTED' ? ': ' + item.staffRemark : ''}`, staff.id, item.id,
      { before: { status: before }, after: { status: decision, reason: item.rejectReason } });

    const client = store.caseClient(caseRec);
    const base = { caseNo: caseRec.id, documentName: item.label, person: item.personLabel };
    if (decision === 'REJECTED') {
      await notifyClient(client, {
        caseId: caseRec.id, trigger: 'DOC_REJECTED', templateKey: 'DOC_REJECTED', link: portalLinkFor(caseRec),
        vars: { ...base, reason: item.staffRemark, nextStep: (reason || REJECT_REASON.OTHER).nextStep },
      });
    } else {
      const comp = metrics.completion(caseRec.id);
      if (db.config.notifyOnAccept) {
        await notifyClient(client, { caseId: caseRec.id, trigger: 'DOC_ACCEPTED', templateKey: 'DOC_ACCEPTED', vars: { ...base, pct: comp.pct } });
      }
      if (comp.total > 0 && comp.accepted === comp.total) {
        await notifyClient(client, { caseId: caseRec.id, trigger: 'ALL_DOCS_COMPLETE', templateKey: 'ALL_DOCS_COMPLETE', vars: { ...base, caseType: CASE_TYPES[caseRec.caseType].inMessage } });
      }
    }
    closeFinishedTasks(item.caseId);
    store.save();
    crmSync.onItemStatusChanged(item.caseId, item.id, decision);
  },

  /**
   * Moving to Submitted with an unpaid balance warns (config.warnUnpaidOnSubmit) but never blocks:
   * the first call throws a 409 with `unpaidBalance`; the caller confirms and passes acknowledgeUnpaid.
   */
  async setStage(caseId, stage, opts) {
    const { user: staff, caseRec: c } = requireCaseAccess(caseId, 'case:stage');
    if (stage === 'OUTCOME' && !c.outcome) throw new HttpError(400, 'Record the outcome (approved or rejected) to move a case to Outcome.');
    let note = '';
    if (stage === 'SUBMITTED' && c.stage !== 'SUBMITTED' && can(staff, 'invoice:view')) {
      const bal = caseBalance(caseId);
      if (db.config.warnUnpaidOnSubmit && bal > 0) {
        if (!(opts && opts.acknowledgeUnpaid)) {
          const err = new HttpError(409, `This case has an unpaid balance of ${fmtMoney(bal)}.`);
          err.unpaidBalance = bal;
          throw err;
        }
        note = `submitted with unpaid balance ${fmtMoney(bal)}`;
      }
    }
    await changeStage(c, stage, staff, note);
    store.save();
  },

  addItem(caseId, spec) {
    const { user: staff, caseRec: c } = requireCaseAccess(caseId, 'item:manage');
    const label = String(spec.label || '').trim();
    if (!label) throw new HttpError(400, 'Please enter a document name.');
    const items = store.itemsFor(caseId);
    const people = casePeople(c);
    const person = people.find((p) => p.label === spec.personLabel) || people[0];
    const item = {
      id: uid('it'), caseId, templateItemId: spec.templateItemId || null, code: spec.code || 'CUSTOM',
      label, description: spec.description || 'Requested by your consultant.', required: spec.required !== false,
      docType: spec.docType || 'other', requiredFields: spec.requiredFields || [], personLabel: person.label, personName: person.name,
      sortOrder: (items.length ? Math.max(...items.map((i) => i.sortOrder)) : 0) + 1,
      status: 'PENDING', staffRemark: null, rejectedAt: null, dueDate: spec.dueDate || null, updatedAt: nowIso(),
    };
    db.items.push(item);
    store.audit(caseId, 'ITEM_ADDED', `${item.label} (${item.personLabel})`, staff.id, item.id, { after: { label: item.label } });
    store.save();
    return item;
  },

  removeItem(itemId) {
    const item = store.item(itemId);
    if (!item) return;
    const { user: staff } = requireCaseAccess(item.caseId, 'item:manage');
    db.items = db.items.filter((i) => i.id !== itemId);
    store.audit(item.caseId, 'ITEM_REMOVED', `${item.label} (${item.personLabel})`, staff.id, null, { before: { label: item.label } });
    store.save();
  },

  /** Per-item deadline set by staff. Pass an ISO date string or empty to clear. */
  setItemDeadline(itemId, date) {
    const item = store.item(itemId);
    if (!item) throw new HttpError(404, 'Checklist item not found.');
    const { user: staff } = requireCaseAccess(item.caseId, 'item:manage');
    const before = item.dueDate;
    item.dueDate = date ? startOfDay(date).toISOString() : null;
    store.audit(item.caseId, 'DEADLINE_SET', `${item.label} (${item.personLabel}): ${item.dueDate ? fmtDate(item.dueDate) : 'cleared'}`, staff.id, item.id, { before: { dueDate: before }, after: { dueDate: item.dueDate } });
    store.save();
  },

  async sendReminderNow(caseId) {
    const { caseRec } = requireCaseAccess(caseId, 'message:send');
    const msg = await sendCaseReminder(caseRec, 'MANUAL');
    store.save();
    return msg;
  },

  async runWeeklyReminders() {
    const user = requirePerm('message:send');
    const res = await runWeeklyReminders((c) => staffScopeOk(user, c.assignedStaffId));
    store.save();
    return res;
  },

  clearOutbox() { requirePerm('config:manage'); db.outbox = []; db.emails = []; store.save(); },
  resetDemo() { requirePerm('demo:reset'); store.reset(); },

  /** Staff-created case. Creates the client record, the logins and a checklist built from the matching template. */
  async createCase(spec) {
    const staff = requirePerm('case:create');
    const res = await createClientWithCase(spec, staff);
    store.save();
    return res;
  },

  /** Adds a secondary contact (e.g. the spouse) who gets their own login to the same case. */
  addContact(clientId, spec) {
    const staff = requirePerm('case:create');
    const client = store.client(clientId);
    if (!client) throw new HttpError(404, 'Client not found.');
    const c = db.cases.find((x) => x.clientId === clientId);
    if (c && !staffScopeOk(staff, c.assignedStaffId)) throw new HttpError(403, 'This case is assigned to another consultant.');
    if (client.contacts.length >= 2) throw new HttpError(409, 'This client already has a primary and a secondary contact.');
    const name = String(spec.name || '').trim();
    const email = String(spec.email || '').trim().toLowerCase();
    if (!name || !validEmail(email)) throw new HttpError(400, 'Please enter a name and a valid email address.');
    if (db.users.some((u) => u.email.toLowerCase() === email)) throw new HttpError(409, 'A user with this email already exists.');
    const user = { id: uid('u'), name, email, password: 'demo1234', role: 'CLIENT', phone: String(spec.phone || '').trim(), clientId, contactKind: 'SECONDARY', createdAt: nowIso() };
    db.users.push(user);
    client.contacts.push({ userId: user.id, kind: 'SECONDARY' });
    if (c) store.audit(c.id, 'CONTACT_ADDED', `${name} (${email}) added as a secondary contact`, staff.id);
    store.save();
    return user;
  },

  setChannelPref(clientId, pref) {
    const u = requireUser();
    const client = store.client(clientId);
    if (!client) throw new HttpError(404, 'Client not found.');
    const own = u.role === 'CLIENT' && client.contacts.some((x) => x.userId === u.id);
    if (!own && !can(u, 'message:send')) throw new HttpError(403, 'You do not have permission to do that.');
    if (!['WHATSAPP', 'EMAIL', 'BOTH'].includes(pref)) throw new HttpError(400, 'Invalid channel.');
    client.channelPref = pref;
    store.save();
  },
};
