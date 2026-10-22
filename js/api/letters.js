// api/letters: letter templates, letters on a case, download logging. Staff only.
// CLIENT has no letter permission, so every call below is refused for clients. The one exception is the
// opt-in "client may download blank form" flag, which defaults to off and logs every download.
import { db, store } from '../store.js';
import { HttpError, uid, nowIso } from '../utils.js';
import { requirePerm, requireCaseAccess } from '../auth/session.js';
import { letterVars, renderLetter, availableFields } from '../letters.js';

const FORMATS = ['PDF', 'DOCX'];
const KINDS = ['RECOMMENDATION', 'COVER', 'OTHER'];

export const letterApi = {
  letterFieldList() { requirePerm('letter:generate'); return availableFields(db.formDefs); },
  listLetterTemplates() { requirePerm('letter:generate'); return db.letterTemplates.slice(); },

  saveLetterTemplate(spec) {
    const user = requirePerm('letter:template');
    const name = String(spec.name || '').trim();
    const body = String(spec.body || '').trim();
    if (!name || !body) throw new HttpError(400, 'A template needs a name and some text.');
    if (!KINDS.includes(spec.kind)) throw new HttpError(400, 'Choose a letter type.');
    let t = spec.id && db.letterTemplates.find((x) => x.id === spec.id);
    const before = t ? { name: t.name, clientMayDownloadBlank: t.clientMayDownloadBlank } : null;
    if (!t) { t = { id: uid('lt'), clientMayDownloadBlank: db.config.letterBlankDownloadDefault }; db.letterTemplates.push(t); }
    Object.assign(t, { name, body, kind: spec.kind, updatedAt: nowIso() });
    if (spec.clientMayDownloadBlank !== undefined) t.clientMayDownloadBlank = !!spec.clientMayDownloadBlank;
    db.audit.push({ id: uid('au'), caseId: null, leadId: null, itemId: null, action: 'LETTER_TEMPLATE_EDITED', detail: `${before ? 'Edited' : 'Created'} letter template: ${name}`, actorId: user.id, at: nowIso(), before, after: { name, clientMayDownloadBlank: t.clientMayDownloadBlank } });
    store.save();
    return t;
  },

  removeLetterTemplate(id) {
    const user = requirePerm('letter:template');
    const t = db.letterTemplates.find((x) => x.id === id);
    if (!t) return;
    if (db.letters.some((l) => l.templateId === id)) throw new HttpError(409, 'Letters were generated from this template, so it cannot be deleted.');
    db.letterTemplates = db.letterTemplates.filter((x) => x.id !== id);
    db.audit.push({ id: uid('au'), caseId: null, leadId: null, itemId: null, action: 'LETTER_TEMPLATE_EDITED', detail: `Deleted letter template: ${t.name}`, actorId: user.id, at: nowIso(), before: { name: t.name }, after: null });
    store.save();
  },

  /** The template filled in from the client profile and onboarding form, ready to edit. */
  previewLetter(caseId, templateId) {
    const { caseRec } = requireCaseAccess(caseId, 'letter:generate');
    const t = db.letterTemplates.find((x) => x.id === templateId);
    if (!t) throw new HttpError(404, 'Template not found.');
    const vars = letterVars({ caseRec, client: store.caseClient(caseRec), consultant: store.user(caseRec.assignedStaffId) });
    return { template: t, html: renderLetter(t.body, vars) };
  },

  caseLetters(caseId) {
    requireCaseAccess(caseId, 'letter:generate');
    return db.letters.filter((l) => l.caseId === caseId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  getLetter(letterId) {
    const l = db.letters.find((x) => x.id === letterId);
    if (!l) throw new HttpError(404, 'Letter not found.');
    requireCaseAccess(l.caseId, 'letter:generate');
    return l;
  },

  /** Attaches the (edited) letter to the case as an internal document. Saving again on the same letter makes a new version. */
  saveLetter(caseId, spec) {
    const { user, caseRec } = requireCaseAccess(caseId, 'letter:generate');
    const body = String(spec.body || '').trim();
    const name = String(spec.name || '').trim();
    if (!body || !name) throw new HttpError(400, 'A letter needs a name and some text.');
    let l = spec.letterId && db.letters.find((x) => x.id === spec.letterId && x.caseId === caseId);
    const isNew = !l;
    if (isNew) { l = { id: uid('lt_doc'), caseId, templateId: spec.templateId || null, createdById: user.id, createdAt: nowIso(), version: 0, internal: true }; db.letters.push(l); }
    l.name = name; l.body = body; l.version += 1; l.updatedAt = nowIso(); l.updatedById = user.id;
    store.audit(caseRec.id, isNew ? 'LETTER_GENERATED' : 'LETTER_ATTACHED', `${isNew ? 'Generated' : 'Edited'} letter "${name}" (v${l.version}), internal`, user.id, null, { after: { letter: l.id, version: l.version } });
    store.save();
    return l;
  },

  deleteLetter(letterId) {
    const l = db.letters.find((x) => x.id === letterId);
    if (!l) return;
    const { user, caseRec } = requireCaseAccess(l.caseId, 'letter:generate');
    db.letters = db.letters.filter((x) => x.id !== letterId);
    store.audit(caseRec.id, 'LETTER_ATTACHED', `Deleted letter "${l.name}"`, user.id, null, { before: { letter: l.id } });
    store.save();
  },

  /** Every download is logged: who, which letter, which format. */
  logLetterDownload(letterId, format) {
    const l = db.letters.find((x) => x.id === letterId);
    if (!l) throw new HttpError(404, 'Letter not found.');
    const { user, caseRec } = requireCaseAccess(l.caseId, 'letter:generate');
    if (!FORMATS.includes(format)) throw new HttpError(400, 'Choose PDF or DOCX.');
    store.audit(caseRec.id, 'LETTER_DOWNLOADED', `Downloaded "${l.name}" (v${l.version}) as ${format}`, user.id, null, { after: { letter: l.id, format } });
    store.save();
    return l;
  },

  // ----- the opt-in client blank forms -----
  /** Templates the client may download blank. Empty unless staff switched the flag on for a template. */
  clientBlankForms(caseId) {
    const { user } = requireCaseAccess(caseId, 'case:view');
    if (user.role !== 'CLIENT') return [];
    return db.letterTemplates.filter((t) => t.clientMayDownloadBlank).map((t) => ({ id: t.id, name: t.name }));
  },
  /** Returns the template with every merge field left blank, and logs the download against the client. */
  downloadBlankForm(caseId, templateId, format) {
    const { user, caseRec } = requireCaseAccess(caseId, 'case:view');
    const t = db.letterTemplates.find((x) => x.id === templateId);
    if (!t || !t.clientMayDownloadBlank || !FORMATS.includes(format)) throw new HttpError(403, 'This form is not available to download.');
    const vars = letterVars({ caseRec, client: store.caseClient(caseRec), consultant: null, blank: true });
    store.audit(caseRec.id, 'BLANK_FORM_DOWNLOADED', `${user.name} downloaded the blank form "${t.name}" as ${format}`, user.id, null, { after: { template: t.id, format } });
    store.save();
    return { name: t.name, html: renderLetter(t.body, vars) };
  },

  /** Download log for the Letters page: staff downloads and client blank-form downloads. */
  letterDownloadLog() {
    requirePerm('letter:template');
    return db.audit.filter((a) => ['LETTER_DOWNLOADED', 'BLANK_FORM_DOWNLOADED'].includes(a.action)).sort((a, b) => b.at.localeCompare(a.at));
  },
};
