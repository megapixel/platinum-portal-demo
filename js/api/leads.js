// api/leads: marketing and sales. The public enquiry form is the only unauthenticated call.
import { db, store } from '../store.js';
import { LEAD_STAGES, LEAD_STAGE_LABEL, INTERESTS } from '../domain.js';
import { HttpError, uid, nowIso, firstName } from '../utils.js';
import { requirePerm, requireLeadAccess } from '../auth/session.js';
import { staffScopeOk, can } from '../auth/permissions.js';
import { messaging } from '../providers/messaging.js';
import { crmSync } from '../providers/crm.js';
import { renderMessage } from '../messagetemplates.js';
import { createClientWithCase } from './cases.js';
import { buildInvoice } from './invoices.js';

const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

/** Per-introducer lead count, conversion count and won value. */
export function introducerStats() {
  return db.introducers.map((intro) => {
    const leads = db.leads.filter((l) => l.introducerId === intro.id);
    const won = leads.filter((l) => l.stage === 'WON');
    return { intro, leads: leads.length, won: won.length, wonValue: won.reduce((s, l) => s + (l.quotedAmount || 0), 0) };
  });
}

function claim(lead, user) {
  if (!lead.assignedStaffId && user.role === 'CONSULTANT') {
    lead.assignedStaffId = user.id;
    store.auditLead(lead.id, 'LEAD_CLAIMED', `${user.name} took this lead`, user.id, { before: { assignedStaffId: null }, after: { assignedStaffId: user.id } });
  }
}

export const leadApi = {
  /**
   * Public enquiry form (/apply). No login. Production: add CAPTCHA and rate limiting, and a PDPA consent record.
   * Creates a Lead in New and queues the WhatsApp greeting.
   */
  async submitEnquiry(form) {
    const name = String(form.name || '').trim();
    const phone = String(form.phone || '').trim();
    const email = String(form.email || '').trim().toLowerCase();
    if (!name) throw new HttpError(400, 'Please enter your name.');
    if (!/^\+?[0-9 ]{8,}$/.test(phone)) throw new HttpError(400, 'Please enter your WhatsApp number, e.g. +65 9123 4567.');
    if (!validEmail(email)) throw new HttpError(400, 'Please enter a valid email address.');
    if (!String(form.nationality || '').trim()) throw new HttpError(400, 'Please enter your nationality.');
    const interest = INTERESTS.includes(form.interest) ? form.interest : 'Other';
    const source = db.leadSources.find((s) => s.id === form.sourceId) || null;
    const lead = {
      id: uid('lead'), name, phone, email, nationality: String(form.nationality).trim(), passType: form.passType || '',
      yearsInSg: Number(form.yearsInSg) || 0, interest, sourceId: source ? source.id : null,
      heardOfUs: source ? source.label : '', introducerId: null,
      utm: form.utm || {}, stage: 'NEW', lostReason: null, assignedStaffId: null, packageId: null, quotedAmount: null,
      nextFollowUp: nowIso(), notes: [], convertedCaseId: null, createdAt: nowIso(),
    };
    db.leads.push(lead);
    store.auditLead(lead.id, 'LEAD_CREATED', `Enquiry from ${source ? source.label : 'the website form'}`, null, { after: { stage: 'NEW', utm: lead.utm } });
    const msg = renderMessage('LEAD_GREETING', { firstName: firstName(name), interest });
    await messaging.send({ leadId: lead.id, toPhone: phone, toName: name, body: msg.body, trigger: 'LEAD_GREETING' });
    store.save();
    crmSync.onLeadChanged(lead.id, lead.stage);
    return { id: lead.id };
  },

  visibleLeads() {
    const u = requirePerm('lead:view');
    return db.leads.filter((l) => !l.assignedStaffId || staffScopeOk(u, l.assignedStaffId));
  },
  getLead(leadId) { return requireLeadAccess(leadId).lead; },

  moveLead(leadId, stage, lostReason) {
    const { user, lead } = requireLeadAccess(leadId, 'lead:manage');
    if (!LEAD_STAGES.some((s) => s.key === stage)) throw new HttpError(400, 'Invalid stage.');
    if (lead.convertedCaseId) throw new HttpError(409, 'This lead has already been converted.');
    if (lead.stage === stage) return;
    if (stage === 'LOST' && !String(lostReason || '').trim()) throw new HttpError(400, 'Please give a reason for losing this lead.');
    if (stage === 'WON' && !lead.packageId) throw new HttpError(400, 'Choose a package before marking this lead as Won.');
    claim(lead, user);
    const before = lead.stage;
    lead.stage = stage;
    lead.lostReason = stage === 'LOST' ? String(lostReason).trim() : null;
    if (stage === 'WON' || stage === 'LOST') lead.nextFollowUp = null;
    store.auditLead(lead.id, 'LEAD_STAGE_CHANGED', `${LEAD_STAGE_LABEL[before]} to ${LEAD_STAGE_LABEL[stage]}${lead.lostReason ? ': ' + lead.lostReason : ''}`, user.id,
      { before: { stage: before }, after: { stage, lostReason: lead.lostReason } });
    store.save();
    crmSync.onLeadChanged(lead.id, stage);
  },

  /** patch: packageId, quotedAmount, nextFollowUp (ISO date), assignedStaffId, sourceId, introducerId. */
  updateLead(leadId, patch) {
    const { user, lead } = requireLeadAccess(leadId, 'lead:manage');
    if (lead.convertedCaseId) throw new HttpError(409, 'This lead has already been converted.');
    const allowed = ['packageId', 'quotedAmount', 'nextFollowUp', 'assignedStaffId', 'sourceId', 'introducerId'];
    const before = {}; const after = {};
    for (const k of allowed) {
      if (!(k in patch)) continue;
      let v = patch[k] === '' ? null : patch[k];
      if (k === 'quotedAmount') v = v == null ? null : Number(v);
      if (k === 'assignedStaffId') {
        if (v !== lead.assignedStaffId && !(can(user, 'case:reassign') || (user.role === 'CONSULTANT' && (v === user.id)))) {
          throw new HttpError(403, 'You do not have permission to reassign leads.');
        }
        if (v && !db.users.some((u) => u.id === v && u.role === 'CONSULTANT')) throw new HttpError(400, 'Choose a consultant.');
      }
      if (k === 'packageId') {
        if (v && !db.packages.some((p) => p.id === v)) throw new HttpError(400, 'Unknown package.');
      }
      if (lead[k] !== v) { before[k] = lead[k]; after[k] = v; lead[k] = v; }
    }
    if ('packageId' in after && lead.packageId && !('quotedAmount' in after)) {
      const pkg = db.packages.find((p) => p.id === lead.packageId);
      before.quotedAmount = lead.quotedAmount; lead.quotedAmount = pkg.price; after.quotedAmount = pkg.price;
    }
    if ('sourceId' in after) { const s = db.leadSources.find((x) => x.id === lead.sourceId); lead.heardOfUs = s ? s.label : ''; }
    if (Object.keys(after).length) {
      claim(lead, user);
      store.auditLead(lead.id, 'LEAD_UPDATED', `Updated ${Object.keys(after).join(', ')}`, user.id, { before, after });
      store.save();
    }
  },

  addLeadNote(leadId, kind, text) {
    const { user, lead } = requireLeadAccess(leadId, 'lead:manage');
    const t = String(text || '').trim();
    if (!t) throw new HttpError(400, 'Please write a note.');
    claim(lead, user);
    const note = { id: uid('ln'), kind: ['CALL', 'WHATSAPP', 'MEETING', 'NOTE'].includes(kind) ? kind : 'NOTE', text: t, at: nowIso(), byId: user.id };
    lead.notes.push(note);
    store.auditLead(lead.id, 'LEAD_NOTE', `${note.kind.toLowerCase()}: ${t}`, user.id);
    store.save();
    return note;
  },

  /**
   * Won to Client + Case + Invoice in one click. Contact details copy over, the package picks the case template,
   * the invoice is generated from the package price and the welcome message is queued. No re-keying.
   */
  async convertLead(leadId, opts) {
    const { user, lead } = requireLeadAccess(leadId, 'lead:convert');
    if (lead.convertedCaseId) throw new HttpError(409, 'This lead has already been converted.');
    if (lead.stage !== 'WON') throw new HttpError(400, 'Mark the lead as Won before converting it.');
    const pkg = db.packages.find((p) => p.id === lead.packageId);
    if (!pkg) throw new HttpError(400, 'Choose a package first.');
    const o = opts || {};
    const { caseRec, client, welcome } = await createClientWithCase({
      name: lead.name, email: lead.email, phone: lead.phone, nationality: lead.nationality, dob: '',
      caseType: pkg.caseType, married: false, spouseName: o.spouseName || '', children: o.children || '',
      assignedStaffId: lead.assignedStaffId || user.id, stage: 'COLLECTING_DOCUMENTS', sendWelcome: true,
      sourceLeadId: lead.id, packageId: pkg.id, channelPref: 'WHATSAPP', allowNoDependants: true,
    }, user);
    // The quoted amount may differ from the catalogue price.
    const priced = lead.quotedAmount != null ? { ...pkg, price: lead.quotedAmount } : pkg;
    const invoice = buildInvoice(caseRec, priced, user.id);
    db.invoices.push(invoice);
    lead.convertedCaseId = caseRec.id;
    store.auditLead(lead.id, 'LEAD_CONVERTED', `Converted to case ${caseRec.id} and invoice ${invoice.number}`, user.id, { after: { caseId: caseRec.id, invoice: invoice.number } });
    store.audit(caseRec.id, 'INVOICE_CREATED', `${invoice.number} for ${pkg.name}`, user.id, null, { after: { total: invoice.total } });
    store.save();
    return { caseRec, client, invoice, welcome };
  },

  // ---------- catalogues: sources, packages, introducers ----------
  saveSource(spec) {
    requirePerm('introducer:manage');
    const label = String(spec.label || '').trim();
    if (!label) throw new HttpError(400, 'Please enter a name.');
    const s = spec.id && db.leadSources.find((x) => x.id === spec.id);
    if (s) s.label = label; else db.leadSources.push({ id: uid('src'), label });
    store.save();
  },
  removeSource(id) {
    requirePerm('introducer:manage');
    if (db.leads.some((l) => l.sourceId === id)) throw new HttpError(409, 'This source is used by leads, so it cannot be removed.');
    db.leadSources = db.leadSources.filter((s) => s.id !== id);
    store.save();
  },
  savePackage(spec) {
    requirePerm('introducer:manage');
    const name = String(spec.name || '').trim();
    const price = Number(spec.price);
    if (!name || !(price >= 0)) throw new HttpError(400, 'Please enter a name and a price.');
    const p = spec.id && db.packages.find((x) => x.id === spec.id);
    if (p) Object.assign(p, { name, price, caseType: spec.caseType, description: spec.description || '' });
    else db.packages.push({ id: uid('pkg'), name, price, caseType: spec.caseType, description: spec.description || '' });
    store.save();
  },
  removePackage(id) {
    requirePerm('introducer:manage');
    if (db.leads.some((l) => l.packageId === id)) throw new HttpError(409, 'This package is used by leads, so it cannot be removed.');
    db.packages = db.packages.filter((p) => p.id !== id);
    store.save();
  },
  saveIntroducer(spec) {
    requirePerm('introducer:manage');
    const name = String(spec.name || '').trim();
    if (!name) throw new HttpError(400, 'Please enter a name.');
    const tier = spec.tier === 'PREMIUM' ? 'PREMIUM' : 'STANDARD';
    const i = spec.id && db.introducers.find((x) => x.id === spec.id);
    if (i) Object.assign(i, { name, org: spec.org || '', tier, email: spec.email || '', phone: spec.phone || '' });
    else db.introducers.push({ id: uid('intro'), name, org: spec.org || '', tier, email: spec.email || '', phone: spec.phone || '' });
    store.save();
  },
};
