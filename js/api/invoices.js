// api/invoices: invoices, payments, billing. Guarded by invoice:view / invoice:manage / invoice:pay.
import { db, store } from '../store.js';
import { HttpError, uid, nowIso, fmtMoney } from '../utils.js';
import { requirePerm, requireCaseAccess } from '../auth/session.js';
import { makeInvoice, paidAmount, balanceOf, invoiceStatus, PAYMENT_METHODS, round2 } from '../invoicing.js';
import { notifyClient } from '../notify.js';
import { portalLinkFor } from '../reminders.js';
import { paymentProvider } from '../providers/payment.js';
import { nextInvoiceNo } from './numbering.js';

/** Invoice generated from the package price. */
export function buildInvoice(caseRec, pkg, actorId, opts) {
  return makeInvoice({ id: uid('inv'), number: nextInvoiceNo(), caseRec, pkg, config: db.config, issuedAt: nowIso(), issuedById: actorId, draft: opts && opts.draft });
}

export const statusOf = (inv) => invoiceStatus(inv, store.case(inv.caseId), db.config);
export const invoicesForCase = (caseId) => db.invoices.filter((i) => i.caseId === caseId);

/** Unpaid balance across a case's live invoices. */
export const caseBalance = (caseId) => round2(invoicesForCase(caseId).reduce((s, i) => s + balanceOf(i), 0));

function getInvoice(id, perm) {
  const inv = db.invoices.find((i) => i.id === id);
  if (!inv) throw new HttpError(404, 'Invoice not found.');
  const { user, caseRec } = requireCaseAccess(inv.caseId, perm);
  return { inv, user, caseRec };
}

const vars = (inv, caseRec, extra) => ({ caseNo: caseRec.id, invoiceNo: inv.number, amount: fmtMoney(inv.total), balance: fmtMoney(balanceOf(inv)), ...extra });

export const invoiceApi = {
  /** Invoices the caller may see for one case. Clients see their own; draft invoices stay internal. */
  caseInvoices(caseId) {
    const { user } = requireCaseAccess(caseId, 'invoice:view');
    return invoicesForCase(caseId).filter((i) => user.role !== 'CLIENT' || i.status !== 'DRAFT');
  },

  /** All invoices the caller may see (staff). Consultants only see their own cases. */
  listInvoices() {
    const user = requirePerm('invoice:view');
    return db.invoices.filter((i) => { try { requireCaseAccess(i.caseId, 'invoice:view'); return true; } catch (e) { return false; } })
      .filter(() => user.role !== 'CLIENT');
  },

  /** Creates an invoice for a case that has none, from a package. Draft until issued. */
  createInvoice(caseId, packageId) {
    const { user, caseRec } = requireCaseAccess(caseId, 'invoice:manage');
    const pkg = db.packages.find((p) => p.id === (packageId || caseRec.packageId));
    if (!pkg) throw new HttpError(400, 'Choose a package for this invoice.');
    const inv = buildInvoice(caseRec, pkg, user.id, { draft: true });
    db.invoices.push(inv);
    store.audit(caseId, 'INVOICE_CREATED', `${inv.number} (draft) for ${pkg.name}`, user.id, null, { after: { total: inv.total } });
    store.save();
    return inv;
  },

  async issueInvoice(invoiceId) {
    const { inv, user, caseRec } = getInvoice(invoiceId, 'invoice:manage');
    if (inv.status !== 'DRAFT') throw new HttpError(409, 'Only a draft invoice can be issued.');
    inv.status = 'ISSUED'; inv.issuedAt = nowIso(); inv.issuedById = user.id;
    store.audit(caseRec.id, 'INVOICE_ISSUED', `${inv.number} issued`, user.id, null, { before: { status: 'DRAFT' }, after: { status: 'ISSUED' } });
    await notifyClient(store.caseClient(caseRec), { caseId: caseRec.id, trigger: 'INVOICE_ISSUED', templateKey: 'INVOICE_ISSUED', link: portalLinkFor(caseRec), vars: vars(inv, caseRec) });
    store.save();
  },

  voidInvoice(invoiceId, reason) {
    const { inv, user, caseRec } = getInvoice(invoiceId, 'invoice:manage');
    if (inv.status === 'VOID') throw new HttpError(409, 'This invoice is already void.');
    if (paidAmount(inv) > 0) throw new HttpError(409, 'This invoice has payments. Remove or refund them before voiding.');
    if (!String(reason || '').trim()) throw new HttpError(400, 'Please give a reason for voiding this invoice.');
    const before = inv.status;
    inv.status = 'VOID'; inv.voidedAt = nowIso(); inv.voidReason = String(reason).trim();
    store.audit(caseRec.id, 'INVOICE_VOIDED', `${inv.number}: ${inv.voidReason}`, user.id, null, { before: { status: before }, after: { status: 'VOID' } });
    store.save();
  },

  /** Manual payment: date, amount, method, reference. */
  async recordPayment(invoiceId, spec) {
    const { inv, user, caseRec } = getInvoice(invoiceId, 'invoice:manage');
    return recordPaymentOn(inv, caseRec, user, spec, 'MANUAL');
  },

  /** Client "Pay now" through the PaymentProvider (mocked): settles the whole balance. */
  async payNow(invoiceId) {
    const { inv, user, caseRec } = getInvoice(invoiceId, 'invoice:pay');
    if (inv.status === 'DRAFT' || inv.status === 'VOID') throw new HttpError(409, 'This invoice cannot be paid.');
    const balance = balanceOf(inv);
    if (balance <= 0) throw new HttpError(409, 'This invoice is already paid.');
    const res = await paymentProvider.charge({ invoice: inv, amount: balance, payer: user });
    if (!res.ok) throw new HttpError(402, 'The payment did not go through.');
    return recordPaymentOn(inv, caseRec, user, { date: nowIso(), amount: balance, method: res.method, reference: res.reference }, 'PAY_NOW');
  },

  /** Staff-only warning: unpaid balance when moving to Submitted. Returns null when there is nothing to warn about. */
  submitWarning(caseId) {
    requirePerm('invoice:view');
    const bal = caseBalance(caseId);
    return db.config.warnUnpaidOnSubmit && bal > 0 ? { balance: bal } : null;
  },
};

async function recordPaymentOn(inv, caseRec, user, spec, source) {
  if (inv.status === 'DRAFT') throw new HttpError(409, 'Issue the invoice before recording a payment.');
  if (inv.status === 'VOID') throw new HttpError(409, 'This invoice is void.');
  const amount = round2(Number(spec.amount));
  if (!(amount > 0)) throw new HttpError(400, 'Enter an amount greater than zero.');
  const balance = balanceOf(inv);
  if (amount > balance + 0.001) throw new HttpError(400, `The amount is more than the balance (${fmtMoney(balance)}).`);
  if (!PAYMENT_METHODS[spec.method]) throw new HttpError(400, 'Choose a payment method.');
  const date = spec.date ? new Date(spec.date).toISOString() : nowIso();
  const payment = { id: uid('pay'), date, amount, method: spec.method, reference: String(spec.reference || '').trim(), recordedById: user.id, recordedAt: nowIso(), source };
  inv.payments.push(payment);
  const after = balanceOf(inv);
  store.audit(caseRec.id, 'PAYMENT_RECORDED', `${inv.number}: ${fmtMoney(amount)} by ${PAYMENT_METHODS[spec.method]}${payment.reference ? ' (' + payment.reference + ')' : ''}`, user.id, null,
    { before: { balance }, after: { balance: after, status: invoiceStatus(inv, caseRec, db.config) } });
  await notifyClient(store.caseClient(caseRec), { caseId: caseRec.id, trigger: 'PAYMENT_RECEIVED', templateKey: 'PAYMENT_RECEIVED', vars: vars(inv, caseRec, { amount: fmtMoney(amount), balance: fmtMoney(after) }) });
  store.save();
  return payment;
}
