// accounting - AccountingExportProvider interface. The prototype exports CSV; Xero or QuickBooks sync is a future link (TBC).
import { toCsv } from '../utils.js';

/**
 * interface AccountingExportProvider {
 *   invoicesCsv(rows): string;   // rows: { invoice, status, paid, balance, clientName }
 *   paymentsCsv(rows): string;   // rows: { invoice, payment, clientName }
 * }
 */
export class CsvAccountingExport {
  invoicesCsv(rows) {
    return toCsv(['Invoice', 'Case', 'Client', 'Issued', 'Subtotal', 'GST', 'Total', 'Paid', 'Balance', 'Status'],
      rows.map((r) => [r.invoice.number, r.invoice.caseId, r.clientName, r.invoice.issuedAt, r.invoice.subtotal, r.invoice.gst, r.invoice.total, r.paid, r.balance, r.status]));
  }
  paymentsCsv(rows) {
    return toCsv(['Invoice', 'Case', 'Client', 'Date', 'Amount', 'Method', 'Reference'],
      rows.map((r) => [r.invoice.number, r.invoice.caseId, r.clientName, r.payment.date, r.payment.amount, r.payment.method, r.payment.reference]));
  }
}

export class XeroExportProvider {
  constructor(config) { this.config = config; }
  invoicesCsv() { throw new Error('Not implemented: push invoices to Xero or QuickBooks once the accounting system is confirmed.'); }
  paymentsCsv() { throw new Error('Not implemented: push payments to the accounting system.'); }
}

export const accountingExport = new CsvAccountingExport();
