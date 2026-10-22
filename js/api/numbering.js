// numbering: PIC-YYYY-NNNN case numbers and INV-YYYY-NNNN invoice numbers. Prefixes come from config.
import { db } from '../store.js';

function nextNumber(prefix, existingIds) {
  const year = new Date().getFullYear();
  const re = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  const max = existingIds.reduce((m, id) => { const x = re.exec(id || ''); return x ? Math.max(m, Number(x[1])) : m; }, 0);
  return `${prefix}-${year}-${String(max + 1).padStart(4, '0')}`;
}
export const nextCaseNo = () => nextNumber(db.config.caseNumberPrefix, db.cases.map((c) => c.id));
export const nextInvoiceNo = () => nextNumber(db.config.invoicePrefix, db.invoices.map((i) => i.number));
