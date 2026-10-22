// api/consolidation: the document specialist's review queue and submission packs.
import { db, store } from '../store.js';
import { STAGES, STAGE_INDEX } from '../domain.js';
import { HttpError, uid, nowIso } from '../utils.js';
import { requirePerm, requireCaseAccess } from '../auth/session.js';
import { staffScopeOk } from '../auth/permissions.js';
import { formProgress } from '../caselogic.js';
import { metrics } from '../metrics.js';
import { changeStage } from './cases.js';

const person = (label) => String(label).split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
const baseCode = (code) => String(code).replace(/^(SPOUSE|CHILD)_/, '');

/**
 * Review queue across the cases the caller may see, oldest upload first.
 * filter: ALL | AI_FLAGGED | AWAITING | REUPLOADED
 */
export function reviewQueue(filter) {
  const user = requirePerm('item:review');
  const rows = [];
  for (const item of db.items) {
    if (!['UPLOADED', 'AI_FLAGGED'].includes(item.status)) continue;
    const c = store.case(item.caseId);
    if (!c || !staffScopeOk(user, c.assignedStaffId)) continue;
    const doc = store.latestDoc(item.id);
    if (!doc) continue;
    if (filter === 'AI_FLAGGED' && item.status !== 'AI_FLAGGED') continue;
    if (filter === 'AWAITING' && item.status !== 'UPLOADED') continue;
    if (filter === 'REUPLOADED' && !item.reuploaded) continue;
    rows.push({ item, doc, caseRec: c, client: store.caseClient(c) });
  }
  return rows.sort((a, b) => a.doc.uploadedAt.localeCompare(b.doc.uploadedAt));
}

/** Accepted documents in template order, grouped by person, latest version only. */
export function packEntries(caseId) {
  const items = store.itemsFor(caseId).filter((i) => i.status === 'ACCEPTED');
  const order = [];
  store.itemsFor(caseId).forEach((i) => { if (!order.includes(i.personLabel)) order.push(i.personLabel); });
  items.sort((a, b) => order.indexOf(a.personLabel) - order.indexOf(b.personLabel) || a.sortOrder - b.sortOrder);
  const c = store.case(caseId);
  return items.map((item) => {
    const doc = store.latestDoc(item.id);
    return {
      item, doc,
      fileName: `${c.id}_${person(item.personLabel)}_${String(item.sortOrder).padStart(2, '0')}_${baseCode(item.code)}.pdf`,
    };
  }).filter((e) => e.doc);
}

export function packReadiness(caseId) {
  const { caseRec } = requireCaseAccess(caseId, 'pack:generate');
  const def = db.formDefs.find((f) => f.caseType === caseRec.caseType);
  const prog = formProgress(def, caseRec.onboarding.data);
  const comp = metrics.completion(caseId);
  const items = store.itemsFor(caseId);
  const flagged = items.filter((i) => i.status === 'AI_FLAGGED');
  const waiting = items.filter((i) => i.status === 'UPLOADED');
  const checks = [
    { label: 'Every required item is accepted', ok: comp.total > 0 && comp.accepted === comp.total, detail: `${comp.accepted} of ${comp.total} accepted` },
    { label: 'Onboarding form is complete', ok: caseRec.onboarding.status === 'SUBMITTED' && prog.pct === 100, detail: `${prog.pct}% complete${caseRec.onboarding.status === 'SUBMITTED' ? ', submitted' : ', not submitted'}` },
    { label: 'AI cross-check issues are resolved', ok: flagged.length === 0 && waiting.length === 0, detail: flagged.length || waiting.length ? `${flagged.length} flagged, ${waiting.length} awaiting review` : 'No open flags' },
  ];
  return { caseRec, checks, ready: checks.every((c) => c.ok), entries: packEntries(caseId) };
}

export const consolidationApi = {
  reviewQueue,
  packTargetLabel: () => STAGES[STAGE_INDEX[db.config.stageAfterPack]].label,
  packReadiness,

  /** Guard step before the browser builds the files. Throws when the case is not ready. */
  preparePack(caseId) {
    const r = packReadiness(caseId);
    if (!r.ready) throw new HttpError(409, 'This case is not ready for a submission pack. Resolve the checks first.');
    return { caseRec: r.caseRec, entries: r.entries };
  },

  /** Records the generated pack, then moves the stage as configured (Documents complete or Review and preparation). */
  async completePack(caseId, summary) {
    const { user, caseRec } = requireCaseAccess(caseId, 'pack:generate');
    const pack = { id: uid('pk'), at: nowIso(), byId: user.id, files: summary.files, pages: summary.pages };
    caseRec.packs = (caseRec.packs || []).concat(pack);
    store.audit(caseId, 'PACK_GENERATED', `Submission pack: ${summary.files.length} files, ${summary.pages} pages`, user.id, null, { after: { files: summary.files.length } });
    const target = db.config.stageAfterPack;
    if (STAGE_INDEX[caseRec.stage] < STAGE_INDEX[target]) await changeStage(caseRec, target, user);
    store.save();
    return pack;
  },
};
