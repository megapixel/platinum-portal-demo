// views/billing: client Billing tab, staff invoice card on the case page, and the invoices list.
import { db, store } from '../store.js';
import { esc, fmtDate, fmtMoney, isoDate } from '../utils.js';
import { auth } from '../auth/session.js';
import { can } from '../auth/permissions.js';
import { api } from '../api/index.js';
import { statusOf } from '../api/invoices.js';
import { INVOICE_STATUS, PAYMENT_METHODS, paidAmount, balanceOf, scheduleView } from '../invoicing.js';
import { ui } from './common.js';

export const invoiceChip = (status) => `<span class="chip ${INVOICE_STATUS[status].tone}">${INVOICE_STATUS[status].label}</span>`;

/** Payment status of a case for the case list and case page: the worst status across its live invoices. */
export function casePaymentStatus(caseId) {
  const invs = db.invoices.filter((i) => i.caseId === caseId && i.status !== 'VOID');
  if (!invs.length) return null;
  const st = invs.map(statusOf);
  for (const s of ['OVERDUE', 'PARTIALLY_PAID', 'ISSUED', 'DRAFT']) if (st.includes(s)) return s;
  return 'PAID';
}
export const paymentChip = (caseId) => { const s = casePaymentStatus(caseId); return s ? invoiceChip(s) : '<span class="chip grey plain">No invoice</span>'; };

function scheduleTable(inv, c) {
  return `<div class="table-wrap"><table class="data"><thead><tr><th>Instalment</th><th>Due</th><th>Amount</th><th>Paid</th><th></th></tr></thead><tbody>
    ${scheduleView(inv, c, db.config).map((s) => `<tr><td>${esc(s.label)} (${s.pct}%)</td><td class="small ${s.overdue ? 'fu-overdue' : ''}">${fmtDate(s.dueDate)}</td><td>${fmtMoney(s.amount)}</td><td>${fmtMoney(s.paid)}</td>
      <td>${s.outstanding <= 0 ? '<span class="chip green plain">Paid</span>' : s.overdue ? '<span class="chip red plain">Overdue</span>' : ''}</td></tr>`).join('')}</tbody></table></div>`;
}

function paymentsList(inv) {
  return inv.payments.length ? `<ul class="history">${inv.payments.map((p) => `<li><b>${fmtMoney(p.amount)}</b> by ${esc(PAYMENT_METHODS[p.method] || p.method)}${p.reference ? ` (${esc(p.reference)})` : ''}<br>
    <span class="muted">${fmtDate(p.date)}, recorded by ${esc((store.user(p.recordedById) || {}).name || '-')}</span></li>`).join('')}</ul>` : '<p class="muted small">No payments yet.</p>';
}

// ---------- client ----------
export function viewBilling(query) {
  const u = auth.currentUser();
  const cases = api.myCases();
  const c = query.case ? api.getCase(query.case) : cases[0];
  if (!c) return '<main class="page narrow"><div class="card">No application found for your account yet.</div></main>';
  const invs = api.caseInvoices(c.id).filter((i) => i.status !== 'VOID');
  return `<main class="page narrow stack">
    <nav class="subtabs"><a href="#/portal?case=${encodeURIComponent(c.id)}">Application</a><a class="active" href="#/portal/billing?case=${encodeURIComponent(c.id)}">Billing</a></nav>
    <h1 style="font-size:22px">Billing</h1>
    ${invs.length ? invs.map((inv) => {
      const st = statusOf(inv);
      return `<section class="card stack">
        <div class="row between"><div><h2 style="margin:0">${esc(inv.number)}</h2><p class="muted small">${esc(inv.lines[0].description)} &middot; issued ${fmtDate(inv.issuedAt)}</p></div>${invoiceChip(st)}</div>
        <div class="bill-totals">
          <div><span class="muted small">Total (incl. GST)</span><b>${fmtMoney(inv.total)}</b></div>
          <div><span class="muted small">Paid</span><b>${fmtMoney(paidAmount(inv))}</b></div>
          <div><span class="muted small">Balance</span><b class="${balanceOf(inv) > 0 ? 'owing' : ''}">${fmtMoney(balanceOf(inv))}</b></div>
        </div>
        ${scheduleTable(inv, c)}
        <div class="row">
          ${balanceOf(inv) > 0 ? `<button class="btn gold" data-action="payNow" data-invoice="${esc(inv.id)}">Pay now (${fmtMoney(balanceOf(inv))})</button>` : ''}
          <button class="btn" data-action="invoicePdf" data-invoice="${esc(inv.id)}">Download PDF</button>
        </div>
        <p class="tiny muted">"Pay now" is simulated in this prototype and marks the balance as paid.</p>
        <h3>Payments</h3>${paymentsList(inv)}
      </section>`; }).join('')
      : '<section class="card"><p class="muted">No invoices yet. Your consultant will issue one when your application starts.</p></section>'}
  </main>`;
}

// ---------- staff: invoice card on the case page ----------
export function invoiceCard(c) {
  const u = auth.currentUser();
  if (!can(u, 'invoice:view')) return '';
  const invs = api.caseInvoices(c.id);
  const manage = can(u, 'invoice:manage');
  return `<section class="card stack">
    <div class="row between"><h2 style="margin:0">Invoices and payments</h2>${paymentChip(c.id)}</div>
    ${invs.map((inv) => {
      const st = statusOf(inv);
      return `<div class="inv-block">
        <div class="row between"><b>${esc(inv.number)}</b>${invoiceChip(st)}</div>
        <p class="small muted">${esc(inv.lines[0].description)} &middot; ${fmtMoney(inv.subtotal)} + GST ${fmtMoney(inv.gst)} = <b>${fmtMoney(inv.total)}</b> &middot; paid ${fmtMoney(paidAmount(inv))} &middot; balance ${fmtMoney(balanceOf(inv))}</p>
        ${inv.status === 'VOID' ? `<p class="tiny muted">Voided: ${esc(inv.voidReason || '')}</p>` : scheduleTable(inv, c)}
        ${paymentsList(inv)}
        <div class="row">
          <button class="btn sm" data-action="invoicePdf" data-invoice="${esc(inv.id)}">PDF</button>
          ${manage && inv.status === 'DRAFT' ? `<button class="btn sm primary" data-action="issueInvoice" data-invoice="${esc(inv.id)}">Issue invoice</button>` : ''}
          ${manage && inv.status !== 'VOID' && !inv.payments.length ? `<button class="btn sm danger" data-action="voidInvoice" data-invoice="${esc(inv.id)}">Void</button>` : ''}
        </div>
        ${manage && inv.status !== 'DRAFT' && inv.status !== 'VOID' && balanceOf(inv) > 0 ? `<form class="pay-form" data-invoice="${esc(inv.id)}">
          <input class="input sm" type="date" name="date" value="${isoDate(new Date())}" required>
          <input class="input sm" type="number" name="amount" min="0.01" step="0.01" placeholder="Amount" value="${(scheduleView(inv, c, db.config).find((s) => s.outstanding > 0) || { outstanding: balanceOf(inv) }).outstanding}" required>
          <select class="input sm" name="method">${Object.entries(PAYMENT_METHODS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
          <input class="input sm" name="reference" placeholder="Reference">
          <button class="btn sm gold" type="submit">Record payment</button></form>` : ''}
      </div>`; }).join('') || '<p class="muted small">No invoice for this case.</p>'}
    ${manage && !invs.some((i) => i.status !== 'VOID') ? `<form id="createInvoiceForm" data-case="${esc(c.id)}" class="row">
      <select class="input sm" name="packageId">${db.packages.map((p) => `<option value="${esc(p.id)}" ${p.id === c.packageId ? 'selected' : ''}>${esc(p.name)} (${fmtMoney(p.price)})</option>`).join('')}</select>
      <button class="btn sm" type="submit">Create invoice</button></form>` : ''}
  </section>`;
}

// ---------- staff: invoices list ----------
export function viewInvoices() {
  const rows = api.listInvoices().map((inv) => {
    const c = store.case(inv.caseId);
    return { inv, c, client: store.caseClient(c), status: statusOf(inv), paid: paidAmount(inv), balance: balanceOf(inv) };
  });
  const f = ui.invoiceFilter || '';
  const shown = rows.filter((r) => !f || r.status === f).sort((a, b) => b.inv.number.localeCompare(a.inv.number));
  const collected = rows.reduce((s, r) => s + r.paid, 0);
  const outstanding = rows.filter((r) => !['VOID', 'DRAFT'].includes(r.status)).reduce((s, r) => s + r.balance, 0);
  const overdue = rows.filter((r) => r.status === 'OVERDUE').reduce((s, r) => s + r.balance, 0);
  const manage = can(auth.currentUser(), 'invoice:manage');
  return `<main class="page wide stack">
    <div class="row between">
      <div><h1 style="font-size:22px">Invoices</h1><p class="muted small">${rows.length} invoices</p></div>
      <div class="row"><button class="btn" data-action="exportInvoicesCsv">Export invoices CSV</button><button class="btn" data-action="exportPaymentsCsv">Export payments CSV</button></div>
    </div>
    <section class="kpis">
      <div class="card kpi"><div class="num sm">${fmtMoney(collected)}</div><div class="lbl">Collected</div></div>
      <div class="card kpi"><div class="num sm">${fmtMoney(outstanding)}</div><div class="lbl">Outstanding</div></div>
      <div class="card kpi ${overdue ? 'alert' : ''}"><div class="num sm">${fmtMoney(overdue)}</div><div class="lbl">Overdue</div></div>
    </section>
    <section class="card">
      <div class="filters"><select class="input sm" data-invoice-filter><option value="">All statuses</option>${Object.entries(INVOICE_STATUS).map(([k, v]) => `<option value="${k}" ${k === f ? 'selected' : ''}>${v.label}</option>`).join('')}</select></div>
      <div class="table-wrap" style="margin-top:12px"><table class="data"><thead><tr><th>Invoice</th><th>Client</th><th>Issued</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>
        ${shown.map((r) => `<tr data-action="openCase" data-case="${esc(r.c.id)}"><td><b>${esc(r.inv.number)}</b><div class="tiny muted">${esc(r.c.id)}</div></td><td>${esc(r.client.name)}</td><td class="small">${fmtDate(r.inv.issuedAt)}</td>
          <td>${fmtMoney(r.inv.total)}</td><td>${fmtMoney(r.paid)}</td><td>${fmtMoney(r.balance)}</td><td>${invoiceChip(r.status)}</td></tr>`).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:20px">No invoices.</td></tr>'}
      </tbody></table></div>
      ${manage ? '' : '<p class="tiny muted" style="margin-top:8px">You have read-only access to payment data.</p>'}
    </section>
  </main>`;
}
