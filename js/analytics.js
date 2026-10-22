// analytics: management numbers computed from the database. Pure reads, no side effects.
import { db, store } from './store.js';
import { STAGES, DAY } from './domain.js';
import { balanceOf, invoiceStatus } from './invoicing.js';
import { metrics } from './metrics.js';

const sum = (a) => a.reduce((s, x) => s + x, 0);
const avg = (a) => (a.length ? sum(a) / a.length : null);
const pct = (n, d) => (d ? Math.round((n * 1000) / d) / 10 : 0);

export function leadsBySource() {
  return db.leadSources.map((s) => {
    const leads = db.leads.filter((l) => l.sourceId === s.id);
    const won = leads.filter((l) => l.stage === 'WON');
    return { id: s.id, label: s.label, leads: leads.length, won: won.length, open: leads.filter((l) => !['WON', 'LOST'].includes(l.stage)).length,
      conversion: pct(won.length, leads.length), wonValue: sum(won.map((l) => l.quotedAmount || 0)) };
  }).filter((r) => r.leads > 0).sort((a, b) => b.leads - a.leads);
}

export function pipeline() {
  const open = db.leads.filter((l) => !['WON', 'LOST'].includes(l.stage));
  const byStage = ['NEW', 'CONTACTED', 'CONSULTATION_BOOKED', 'PROPOSAL_SENT'].map((k) => {
    const ls = open.filter((l) => l.stage === k);
    return { key: k, count: ls.length, value: sum(ls.map((l) => l.quotedAmount || 0)) };
  });
  return { count: open.length, value: sum(open.map((l) => l.quotedAmount || 0)), byStage };
}

export function wonThisMonth(now = new Date()) {
  const won = db.leads.filter((l) => l.stage === 'WON' && l.wonAt && new Date(l.wonAt).getMonth() === now.getMonth() && new Date(l.wonAt).getFullYear() === now.getFullYear());
  return { count: won.length, value: sum(won.map((l) => l.quotedAmount || 0)) };
}

export function activeByStage() {
  const active = db.cases.filter((c) => c.stage !== 'OUTCOME');
  return STAGES.filter((s) => s.key !== 'OUTCOME').map((s) => ({ key: s.key, label: s.label, count: active.filter((c) => c.stage === s.key).length }));
}

/** Average days between the first time a case entered `from` and the first time it entered `to`. */
export function avgDaysBetween(from, to) {
  const first = new Map();
  for (const h of db.stageHistory) {
    const k = `${h.caseId}|${h.stage}`;
    if (!first.has(k) || h.changedAt < first.get(k)) first.set(k, h.changedAt);
  }
  const days = [];
  for (const c of db.cases) {
    const a = first.get(`${c.id}|${from}`); const b = first.get(`${c.id}|${to}`);
    if (a && b && b >= a) days.push((new Date(b) - new Date(a)) / DAY);
  }
  return { avg: avg(days), n: days.length };
}

/** Approval rate on the final outcome of each decided case, overall and by nationality. */
export function approval() {
  const decided = db.cases.filter((c) => c.outcome);
  const approved = decided.filter((c) => c.outcome.result === 'APPROVED');
  const by = new Map();
  decided.forEach((c) => {
    const nat = (store.caseClient(c).profile || {}).nationality || 'Unknown';
    if (!by.has(nat)) by.set(nat, { nationality: nat, decided: 0, approved: 0 });
    const r = by.get(nat); r.decided++; if (c.outcome.result === 'APPROVED') r.approved++;
  });
  const rows = [...by.values()].map((r) => ({ ...r, rate: pct(r.approved, r.decided) })).sort((a, b) => b.decided - a.decided || b.rate - a.rate);
  return { decided: decided.length, approved: approved.length, rate: pct(approved.length, decided.length), byNationality: rows };
}

export function avgAttempts() {
  const cases = db.cases;
  return { avg: avg(cases.map((c) => c.attempt || 1)), n: cases.length, reapplied: cases.filter((c) => (c.attempt || 1) > 1).length };
}

export function outstandingPerConsultant() {
  return db.users.filter((u) => u.role === 'CONSULTANT').map((u) => {
    const cases = db.cases.filter((c) => c.assignedStaffId === u.id && c.stage === 'COLLECTING_DOCUMENTS');
    const outstanding = sum(cases.map((c) => metrics.outstanding(c.id).length));
    return { id: u.id, name: u.name, cases: cases.length, outstanding, overdue: cases.filter((c) => metrics.outstanding(c.id).length && metrics.daysLeft(c) < 0).length };
  });
}

/** Cash collected by month for the last 12 months, plus the current collected / outstanding / overdue totals. */
export function revenue(now = new Date()) {
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: `${d.getFullYear()}-${d.getMonth()}`, label: d.toLocaleDateString('en-SG', { month: 'short' }), year: d.getFullYear(), collected: 0 });
  }
  let collected = 0; let outstanding = 0; let overdue = 0;
  for (const inv of db.invoices) {
    const c = store.case(inv.caseId);
    for (const p of inv.payments) {
      collected += p.amount;
      const d = new Date(p.date);
      const m = months.find((x) => x.key === `${d.getFullYear()}-${d.getMonth()}`);
      if (m) m.collected += p.amount;
    }
    const st = invoiceStatus(inv, c, db.config);
    if (!['VOID', 'DRAFT', 'PAID'].includes(st)) { outstanding += balanceOf(inv); if (st === 'OVERDUE') overdue += balanceOf(inv); }
  }
  return { months, collected, outstanding, overdue };
}
