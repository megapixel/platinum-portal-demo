// seed: about 60 past cases across 12 months, with outcomes, nationalities, source leads and payments,
// so the analytics charts look real. Archived records: no checklist or documents, flagged `historical`.
import { uid, daysAgo, rng } from '../utils.js';
import { makeInvoice, round2 } from '../invoicing.js';
import { defaultTargetDate } from '../caselogic.js';

const FIRST = ['Aiman', 'Bich', 'Carlos', 'Dina', 'Eko', 'Farah', 'Gita', 'Hoa', 'Ivan', 'Jia', 'Kamal', 'Linh', 'Mei', 'Nadia', 'Omar', 'Priyanka', 'Qian', 'Rahul', 'Sari', 'Tuan', 'Uma', 'Vinh', 'Wei', 'Xin', 'Yusuf', 'Zainab'];
const LAST = ['Abdullah', 'Bui', 'Cruz', 'Das', 'Elias', 'Fong', 'Gunawan', 'Hassan', 'Ibrahim', 'Joseph', 'Khoo', 'Lim', 'Mohan', 'Nguyen', 'Ong', 'Pillai', 'Reyes', 'Santos', 'Tan', 'Wong', 'Yap', 'Zhang'];
// [nationality, weight, approval probability]
const NATIONALITIES = [['Malaysian', 22, 0.86], ['Indian', 12, 0.7], ['Filipino', 9, 0.78], ['Vietnamese', 6, 0.72], ['Indonesian', 6, 0.74], ['Chinese', 8, 0.68], ['Thai', 4, 0.8], ['Myanmar', 3, 0.6], ['Korean', 3, 0.82], ['Japanese', 3, 0.88]];
const SOURCE_WEIGHTS = [['src_referral', 28], ['src_social', 18], ['src_web', 15], ['src_partner', 12], ['src_tv', 10], ['src_walkin', 10], ['src_event', 7]];
const LOST_REASONS = ['Price too high', 'Chose another firm', 'Not eligible', 'No response', 'Timing not right'];
const REJECT_REASONS = ['Insufficient income history', 'Incomplete employment record', 'Did not meet the points threshold', 'Policy change', 'Short residence history'];

function weighted(r, table) {
  const total = table.reduce((s, t) => s + t[1], 0);
  let x = r() * total;
  for (const t of table) { x -= t[1]; if (x <= 0) return t; }
  return table[table.length - 1];
}

export function seedHistory(d) {
  const r = rng(77031);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const between = (a, b) => a + Math.floor(r() * (b - a + 1));
  const consultants = ['u_staff', 'u_sarah'];
  const caseSeq = { 2025: 0, 2026: 0 };
  const invSeq = { 2025: 0, 2026: 100 };       // active demo invoices use INV-2026-0001..0008
  const N = 60;
  const stageAt = (caseId, stage, ago, attempt) => d.stageHistory.push({ id: uid('sh'), caseId, stage, attempt, changedAt: daysAgo(ago), changedById: 'u_staff' });

  for (let i = 0; i < N; i++) {
    // Decision dates spread over the last 12 months, oldest first.
    const decisionAgo = Math.round(4 + ((N - 1 - i) / (N - 1)) * 356 + between(-3, 3));
    const [nat, , approveP] = weighted(r, NATIONALITIES);
    const caseType = r() < 0.55 ? 'PR' : r() < 0.45 ? 'CITIZENSHIP' : 'PR_WITH_DEPENDANTS';
    const pkgId = caseType === 'CITIZENSHIP' ? 'pkg_cit' : caseType === 'PR_WITH_DEPENDANTS' ? 'pkg_dep' : (r() < 0.12 ? 'pkg_biz' : 'pkg_pr');
    const pkg = d.packages.find((p) => p.id === pkgId);
    const staff = consultants[i % 2];

    // Attempts: roughly one in five cases were rejected first and re-applied.
    const attempts = r() < 0.2 ? (r() < 0.2 ? 3 : 2) : 1;
    const finalApproved = r() < (attempts > 1 ? 0.75 : approveP);
    // Build attempts backwards from the final decision.
    const chain = [];
    let decAgo = decisionAgo;
    for (let a = attempts; a >= 1; a--) {
      const lag = between(40, 110); const sub = between(8, 35); const doc = a === 1 ? between(25, 70) : between(12, 30);
      const submittedAgo = decAgo + lag; const docsCompleteAgo = submittedAgo + sub; const startAgo = docsCompleteAgo + doc;
      chain.unshift({ attempt: a, decAgo, submittedAgo, docsCompleteAgo, startAgo, approved: a === attempts ? finalApproved : false });
      decAgo = startAgo + 3;         // the previous attempt was decided 3 days before this one began
    }
    const first = chain[0];
    const year = new Date(daysAgo(first.startAgo)).getFullYear();
    const caseId = `PIC-${year}-${String(++caseSeq[year]).padStart(4, '0')}`;
    const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7 + 3) % LAST.length]}`;
    const clientId = `cl_h${i + 1}`; const userId = `u_h${i + 1}`;
    const startDate = daysAgo(first.startAgo);
    const married = caseType === 'PR_WITH_DEPENDANTS' || r() < 0.4;
    const dependants = caseType === 'PR_WITH_DEPENDANTS' ? [{ relation: 'SPOUSE', name: `${pick(FIRST)} ${name.split(' ')[1]}`, nationality: nat }] : [];

    d.users.push({ id: userId, name, email: `hist${i + 1}@archive.example`, password: uid('pw'), role: 'CLIENT', phone: `+65 8${between(100, 999)} ${between(1000, 9999)}`, clientId, contactKind: 'PRIMARY', historical: true, createdAt: startDate });
    d.clients.push({ id: clientId, name, profile: { nationality: nat }, dependants, channelPref: 'WHATSAPP', contacts: [{ userId, kind: 'PRIMARY' }], createdAt: startDate });

    // Source lead, won when the case started.
    const srcId = weighted(r, SOURCE_WEIGHTS)[0];
    const intro = (srcId === 'src_referral' || srcId === 'src_partner') ? (r() < 0.4 ? d.introducers[between(0, 2)] : pick(d.introducers)) : null;
    const leadId = `lead_h${String(i + 1).padStart(3, '0')}`;
    const wonAgo = first.startAgo;
    d.leads.push({
      id: leadId, name, phone: '', email: `hist${i + 1}@archive.example`, nationality: nat, passType: 'Employment Pass', yearsInSg: between(3, 12),
      interest: caseType === 'CITIZENSHIP' ? 'Citizenship' : pkgId === 'pkg_biz' ? 'Business ownership to PR' : 'PR', sourceId: srcId, heardOfUs: d.leadSources.find((s) => s.id === srcId).label,
      introducerId: intro ? intro.id : null, utm: {}, stage: 'WON', lostReason: null, assignedStaffId: staff, packageId: pkgId, quotedAmount: r() < 0.15 ? Math.round(pkg.price * 0.9) : pkg.price,
      nextFollowUp: null, notes: [], convertedCaseId: caseId, createdAt: daysAgo(wonAgo + between(5, 25)), wonAt: daysAgo(wonAgo), archived: true,
    });
    d.audit.push({ id: uid('au'), caseId: null, leadId, itemId: null, action: 'LEAD_CREATED', detail: 'Archived history', actorId: null, at: daysAgo(wonAgo + 10), before: null, after: { stage: 'NEW' } });

    const last = chain[chain.length - 1];
    const history = chain.slice(0, -1).map((c) => ({
      attempt: c.attempt, startedAt: daysAgo(c.startAgo), submittedAt: daysAgo(c.submittedAgo),
      outcome: { result: 'REJECTED', decisionDate: daysAgo(c.decAgo), reference: '', reason: pick(REJECT_REASONS), nextSteps: 'Re-apply with updated documents.', recordedById: staff },
    }));
    const outcome = {
      result: last.approved ? 'APPROVED' : 'REJECTED', decisionDate: daysAgo(last.decAgo), reference: last.approved ? `${caseType === 'CITIZENSHIP' ? 'CZ' : 'PR'}-${year}-${String(60000 + i * 37)}` : '',
      reason: last.approved ? '' : pick(REJECT_REASONS), nextSteps: last.approved ? 'Collect the card from the ICA.' : 'Your consultant will contact you.', recordedById: staff, recordedAt: daysAgo(last.decAgo),
    };
    d.cases.push({
      id: caseId, clientId, caseType, stage: 'OUTCOME', attempt: attempts, attemptHistory: history, outcome, assignedStaffId: staff,
      startDate, targetSubmissionDate: defaultTargetDate(startDate), married, dependants, createdAt: startDate, sourceLeadId: leadId, packageId: pkgId,
      legacyDriveUrl: '', remindersPaused: false, historical: true,
      onboarding: { data: { full_name: name, nationality: nat }, status: 'SUBMITTED', updatedAt: startDate, updatedById: userId, submittedAt: startDate },
    });
    // Stage timeline for every attempt (first attempt starts at Onboarded, later ones at Collecting documents).
    chain.forEach((c) => {
      if (c.attempt === 1) stageAt(caseId, 'ONBOARDED', c.startAgo, 1);
      stageAt(caseId, 'COLLECTING_DOCUMENTS', c.startAgo - 1, c.attempt);
      stageAt(caseId, 'DOCUMENTS_COMPLETE', c.docsCompleteAgo, c.attempt);
      stageAt(caseId, 'REVIEW_AND_PREPARATION', c.docsCompleteAgo - 2, c.attempt);
      stageAt(caseId, 'SUBMITTED', c.submittedAgo, c.attempt);
    });
    stageAt(caseId, 'OUTCOME', last.decAgo, attempts);
    d.audit.push({ id: uid('au'), caseId, leadId: null, itemId: null, action: 'CASE_CREATED', detail: 'Archived history', actorId: staff, at: startDate, before: null, after: { caseType } });
    d.audit.push({ id: uid('au'), caseId, leadId: null, itemId: null, action: 'OUTCOME_RECORDED', detail: `${outcome.result === 'APPROVED' ? 'Approved' : 'Rejected'}, archived history`, actorId: staff, at: daysAgo(last.decAgo), before: null, after: { result: outcome.result } });

    // Invoice: issued at the start, deposit early, balance near submission. A few were never fully settled.
    const invYear = new Date(startDate).getFullYear();
    const inv = makeInvoice({ id: uid('inv'), number: `INV-${invYear}-${String(++invSeq[invYear]).padStart(4, '0')}`, caseRec: d.cases[d.cases.length - 1], pkg: { ...pkg, price: d.leads[d.leads.length - 1].quotedAmount }, config: d.config, issuedAt: startDate, issuedById: 'u_admin' });
    const settle = i % 12 === 7 ? 'DEPOSIT_ONLY' : i % 20 === 11 ? 'NONE' : 'FULL';
    const pay = (fraction, ago, method) => inv.payments.push({ id: uid('pay'), date: daysAgo(Math.max(1, ago)), amount: round2(inv.total * fraction), method, reference: `H${i + 1}-${Math.abs(ago)}`, recordedById: 'u_admin', recordedAt: daysAgo(Math.max(1, ago)), source: 'MANUAL' });
    const methods = ['PAYNOW', 'BANK_TRANSFER', 'CARD', 'PAYNOW'];
    if (settle !== 'NONE') pay(0.5, first.startAgo - between(2, 10), pick(methods));
    if (settle === 'FULL') pay(1 - 0.5, first.submittedAgo + between(-5, 5), pick(methods));
    if (settle === 'FULL') inv.payments[1].amount = round2(inv.total - inv.payments[0].amount);
    d.invoices.push(inv);
  }

  // Leads that never converted, across the same year.
  for (let j = 0; j < 45; j++) {
    const srcId = weighted(r, SOURCE_WEIGHTS)[0];
    const [nat] = weighted(r, NATIONALITIES);
    const intro = (srcId === 'src_referral' || srcId === 'src_partner') && r() < 0.5 ? pick(d.introducers) : null;
    d.leads.push({
      id: `lead_hl${String(j + 1).padStart(3, '0')}`, name: `${pick(FIRST)} ${pick(LAST)}`, phone: '', email: `lost${j + 1}@archive.example`, nationality: nat, passType: 'Employment Pass', yearsInSg: between(1, 9),
      interest: pick(['PR', 'PR', 'Citizenship', 'Business ownership to PR']), sourceId: srcId, heardOfUs: d.leadSources.find((s) => s.id === srcId).label, introducerId: intro ? intro.id : null,
      utm: {}, stage: 'LOST', lostReason: pick(LOST_REASONS), assignedStaffId: consultants[j % 2], packageId: null, quotedAmount: null, nextFollowUp: null, notes: [], convertedCaseId: null,
      createdAt: daysAgo(between(20, 420)), archived: true,
    });
  }
}
