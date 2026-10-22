// seed: invoices for the 8 active cases, in mixed payment states.
import { uid, daysAgo, nowIso } from '../utils.js';
import { makeInvoice, round2 } from '../invoicing.js';

const PKG = { u_elizabeth: 'pkg_pr', u_ahmad: 'pkg_cit', u_nurul: 'pkg_dep', u_weiling: 'pkg_pr', u_rizal: 'pkg_cit', u_priya: 'pkg_pr', u_mai: 'pkg_pr', u_kittisak: 'pkg_dep' };
// Payment plan per client: fraction of the total paid, and how many days ago.
const PAID = {
  u_elizabeth: [[0.5, 30, 'PAYNOW']],                    // deposit paid, balance not yet due
  u_ahmad: [],                                           // just issued, nothing paid
  u_nurul: [[0.5, 45, 'BANK_TRANSFER']],
  u_weiling: [],                                         // nothing paid and past the target date: overdue
  u_rizal: [[0.5, 26, 'CARD']],
  u_priya: [[0.5, 38, 'PAYNOW'], [0.5, 12, 'BANK_TRANSFER']],   // fully paid
  u_mai: [[0.5, 66, 'PAYNOW']],                          // balance due before submission, target passed: overdue
  u_kittisak: [[0.5, 118, 'BANK_TRANSFER'], [0.5, 60, 'BANK_TRANSFER']],
};

export function seedInvoices(d) {
  let n = 0;
  for (const c of d.cases) {
    const userId = Object.keys(PKG).find((k) => c.clientId === 'cl_' + k.replace(/^u_/, ''));
    if (!userId) continue;
    const pkg = d.packages.find((p) => p.id === PKG[userId]);
    c.packageId = pkg.id;
    const inv = makeInvoice({ id: uid('inv'), number: `INV-${new Date().getFullYear()}-${String(++n).padStart(4, '0')}`, caseRec: c, pkg, config: d.config, issuedAt: c.startDate, issuedById: 'u_admin' });
    for (const [fraction, ago, method] of PAID[userId]) {
      inv.payments.push({
        id: uid('pay'), date: daysAgo(ago), amount: round2(inv.total * fraction), method,
        reference: method === 'BANK_TRANSFER' ? `TT${String(10000 + n * 137 + ago)}` : method === 'PAYNOW' ? `PN${String(20000 + n * 91 + ago)}` : `CARD-${String(4000 + n)}`,
        recordedById: 'u_admin', recordedAt: nowIso(), source: 'MANUAL',
      });
    }
    d.invoices.push(inv);
  }
}
