// invoicing: pure invoice maths and status rules. No db access, so the seed and the api share it.
import { DAY } from './domain.js';
import { startOfDay } from './utils.js';

export const INVOICE_STATUS = {
  DRAFT: { label: 'Draft', tone: 'grey' },
  ISSUED: { label: 'Issued', tone: 'blue' },
  PARTIALLY_PAID: { label: 'Partially paid', tone: 'amber' },
  PAID: { label: 'Paid', tone: 'green' },
  OVERDUE: { label: 'Overdue', tone: 'red' },
  VOID: { label: 'Void', tone: 'grey' },
};
export const PAYMENT_METHODS = { PAYNOW: 'PayNow', BANK_TRANSFER: 'Bank transfer', CARD: 'Card', CASH: 'Cash' };

export const round2 = (n) => Math.round(n * 100) / 100;

/** Builds an invoice from a package price. GST rate and payment schedule come from config (TBC with the client). */
export function makeInvoice({ id, number, caseRec, pkg, config, issuedAt, issuedById, draft }) {
  const subtotal = round2(pkg.price);
  const gst = round2(subtotal * config.gstRate);
  const total = round2(subtotal + gst);
  let allocated = 0;
  const schedule = config.paymentSchedule.map((s, i, arr) => {
    const amount = i === arr.length - 1 ? round2(total - allocated) : round2((total * s.pct) / 100);
    allocated = round2(allocated + amount);
    return { label: s.label, pct: s.pct, amount, due: s.due };
  });
  return {
    id, number, caseId: caseRec.id, clientId: caseRec.clientId, packageId: pkg.id,
    lines: [{ description: pkg.name, qty: 1, unit: subtotal }],
    subtotal, gstRate: config.gstRate, gst, total, schedule,
    status: draft ? 'DRAFT' : 'ISSUED', issuedAt: draft ? null : issuedAt, issuedById, voidedAt: null, voidReason: null, payments: [],
  };
}

export const paidAmount = (inv) => round2(inv.payments.reduce((s, p) => s + p.amount, 0));
export const balanceOf = (inv) => (inv.status === 'VOID' ? 0 : round2(inv.total - paidAmount(inv)));

/** When a scheduled instalment falls due. ON_ISSUE = issue date plus the payment terms; BEFORE_SUBMISSION = the case target date. */
export function dueDateFor(inv, item, caseRec, config) {
  if (item.due === 'BEFORE_SUBMISSION') return caseRec.targetSubmissionDate;
  const base = inv.issuedAt || new Date().toISOString();
  return new Date(new Date(base).getTime() + (config.paymentTermsDays || 14) * DAY).toISOString();
}

/** The schedule with each line's due date and whether it is covered by what has been paid so far (paid in order). */
export function scheduleView(inv, caseRec, config) {
  let remaining = paidAmount(inv);
  return inv.schedule.map((s) => {
    const covered = Math.min(remaining, s.amount);
    remaining = round2(remaining - covered);
    const dueDate = dueDateFor(inv, s, caseRec, config);
    const outstanding = round2(s.amount - covered);
    return { ...s, dueDate, paid: round2(covered), outstanding, overdue: outstanding > 0 && startOfDay(dueDate) < startOfDay(new Date()) };
  });
}

/** Derived status. DRAFT and VOID are stored; the rest follow from payments and due dates. */
export function invoiceStatus(inv, caseRec, config) {
  if (inv.status === 'VOID' || inv.status === 'DRAFT') return inv.status;
  const paid = paidAmount(inv);
  if (paid >= inv.total) return 'PAID';
  if (caseRec && scheduleView(inv, caseRec, config).some((s) => s.overdue)) return 'OVERDUE';
  return paid > 0 ? 'PARTIALLY_PAID' : 'ISSUED';
}
