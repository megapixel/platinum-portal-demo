// api/integrations: CRM lead import (mock), legacy Google Drive link and mock import. Stubs behind provider interfaces.
import { db, store } from '../store.js';
import { INTERESTS } from '../domain.js';
import { HttpError, uid, nowIso } from '../utils.js';
import { requirePerm, requireCaseAccess } from '../auth/session.js';
import { crmSync } from '../providers/crm.js';
import { driveSync } from '../providers/drive.js';
import { mockAnalyse } from '../ai.js';
import { personFor } from './cases.js';

const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

export const integrationApi = {
  crmStatus() { requirePerm('config:manage'); return crmSync.status(); },

  /** Mock import of leads from a CSV exported from the old CRM. Skips rows without a valid email, and duplicates. */
  importLeadsCsv(text) {
    const user = requirePerm('config:manage');
    const rows = crmSync.parseLeadCsv(text);
    if (!rows.length) throw new HttpError(400, 'The file has no rows. Expected a header line then one lead per line.');
    let src = db.leadSources.find((s) => s.label === 'CRM import');
    if (!src) { src = { id: uid('src'), label: 'CRM import' }; db.leadSources.push(src); }
    let added = 0; let skipped = 0;
    for (const r of rows) {
      const email = String(r.email || '').toLowerCase();
      if (!r.name || !validEmail(email) || db.leads.some((l) => l.email === email)) { skipped++; continue; }
      const interest = INTERESTS.find((i) => i.toLowerCase() === String(r.interest || '').toLowerCase()) || 'Other';
      const lead = {
        id: uid('lead'), name: r.name, phone: r.phone || '', email, nationality: r.nationality || '', passType: '', yearsInSg: 0, interest,
        sourceId: src.id, heardOfUs: src.label, introducerId: null, utm: {}, stage: 'NEW', lostReason: null, assignedStaffId: null,
        packageId: null, quotedAmount: null, nextFollowUp: nowIso(), notes: [], convertedCaseId: null, createdAt: nowIso(),
      };
      db.leads.push(lead);
      store.auditLead(lead.id, 'LEAD_CREATED', 'Imported from CRM CSV', user.id, { after: { stage: 'NEW' } });
      added++;
    }
    store.save();
    return { added, skipped };
  },

  setLegacyDriveUrl(caseId, url) {
    const { user, caseRec } = requireCaseAccess(caseId, 'item:manage');
    const v = String(url || '').trim();
    if (v && !/^https?:\/\//i.test(v)) throw new HttpError(400, 'Enter a full link starting with https://');
    const before = caseRec.legacyDriveUrl || '';
    caseRec.legacyDriveUrl = v;
    store.audit(caseId, 'DRIVE_LINK_SET', v ? 'Legacy Google Drive folder linked' : 'Legacy Google Drive link removed', user.id, null, { before: { url: before }, after: { url: v } });
    store.save();
  },

  /**
   * Mock "Import from Drive": copies the legacy folder's files into the case. Each file is matched to a pending checklist item
   * by its name, run through the same AI check as an upload, and marked as uploaded on the client's behalf from Drive.
   */
  async importFromDrive(caseId) {
    const { user, caseRec } = requireCaseAccess(caseId, 'item:manage');
    if (!caseRec.legacyDriveUrl) throw new HttpError(400, 'Add the legacy Google Drive folder link first.');
    const client = store.caseClient(caseRec);
    const files = await driveSync.listFolder(caseRec, client);
    const items = store.itemsFor(caseId);
    const used = new Set();
    const imported = []; const unmatched = [];
    for (const f of files) {
      let match = null; let result = null;
      for (const item of items) {
        if (used.has(item.id) || item.status !== 'PENDING' || item.personLabel !== 'Main applicant') continue;
        const person = personFor(caseRec, item);
        const r = mockAnalyse({ fileName: f.name, docType: item.docType, label: item.label, requiredFields: item.requiredFields, person });
        if (r.matchesExpected && r.detectedType === item.docType) { match = item; result = r; break; }
      }
      if (!match) { unmatched.push(f.name); continue; }
      used.add(match.id);
      const doc = {
        id: uid('doc'), itemId: match.id, caseId, fileName: f.name, version: store.docsFor(match.id).length + 1, mimeType: f.mimeType, size: f.size,
        uploadedAt: nowIso(), source: 'drive', uploadedById: user.id, uploadedBy: { userId: user.id, role: user.role, onBehalf: true, via: 'Google Drive import' },
        aiDetectedType: result.detectedType, aiConfidence: result.confidence, aiMatches: true, aiExtracted: result.extracted, aiIssues: result.issues, aiCheckedAt: nowIso(),
      };
      db.documents.push(doc);
      match.status = result.issues.length ? 'AI_FLAGGED' : 'UPLOADED';
      match.updatedAt = doc.uploadedAt;
      imported.push(f.name);
    }
    store.audit(caseId, 'DRIVE_IMPORT', `Imported ${imported.length} file${imported.length === 1 ? '' : 's'} from Google Drive${unmatched.length ? `, ${unmatched.length} not matched` : ''}`, user.id, null, { after: { imported, unmatched } });
    store.save();
    return { imported, unmatched };
  },
};
