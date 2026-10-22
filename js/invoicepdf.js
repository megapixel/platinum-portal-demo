// invoicepdf: renders an invoice as a PDF with pdf-lib (vendored). Production: the same layout server side.
import { fmtDate, fmtMoney } from './utils.js';
import { INVOICE_STATUS, PAYMENT_METHODS, paidAmount, balanceOf, scheduleView, invoiceStatus } from './invoicing.js';

const safe = (t) => String(t == null ? '' : t).replace(/[^\x20-\x7e\xa0-\xff]/g, '*');

export async function buildInvoicePdf(inv, caseRec, client, config) {
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28; const R = W - 40;
  const text = (t, x, y, o = {}) => page.drawText(safe(t), { x, y, size: o.size || 10, font: o.bold ? bold : font, color: o.color || rgb(0.1, 0.1, 0.1) });
  const right = (t, y, o = {}) => { const s = safe(t); const w = (o.bold ? bold : font).widthOfTextAtSize(s, o.size || 10); text(s, R - w, y, o); };
  const status = invoiceStatus(inv, caseRec, config);

  page.drawRectangle({ x: 0, y: 841.89 - 100, width: W, height: 100, color: rgb(0.106, 0.165, 0.29) });
  text('PLATINUM IMMIGRATION', 40, 841.89 - 48, { size: 18, bold: true, color: rgb(1, 1, 1) });
  text('Platinum Immigration Consultancy Pte. Ltd.', 40, 841.89 - 68, { size: 9, color: rgb(0.9, 0.85, 0.7) });
  right('INVOICE', 841.89 - 48, { size: 18, bold: true, color: rgb(1, 1, 1) });
  right(inv.number, 841.89 - 68, { size: 10, color: rgb(0.9, 0.85, 0.7) });

  let y = 841.89 - 140;
  text('Bill to', 40, y, { size: 8, color: rgb(0.45, 0.45, 0.45) });
  text(client.name, 40, y - 14, { bold: true, size: 11 });
  text(`Case ${caseRec.id}`, 40, y - 28);
  right(`Issued: ${inv.issuedAt ? fmtDate(inv.issuedAt) : 'Draft'}`, y - 14);
  right(`Status: ${INVOICE_STATUS[status].label}`, y - 28, { bold: true });

  y -= 70;
  page.drawRectangle({ x: 40, y: y - 6, width: R - 40, height: 20, color: rgb(0.94, 0.95, 0.97) });
  text('Description', 48, y, { bold: true, size: 9 }); text('Qty', 340, y, { bold: true, size: 9 });
  text('Unit price', 380, y, { bold: true, size: 9 }); right('Amount', y, { bold: true, size: 9 });
  y -= 24;
  inv.lines.forEach((l) => {
    text(l.description, 48, y); text(String(l.qty), 340, y); text(fmtMoney(l.unit), 380, y); right(fmtMoney(l.qty * l.unit), y);
    y -= 18;
  });
  y -= 6;
  page.drawLine({ start: { x: 340, y }, end: { x: R, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
  y -= 16;
  text('Subtotal', 340, y); right(fmtMoney(inv.subtotal), y); y -= 16;
  text(`GST (${Math.round(inv.gstRate * 1000) / 10}%)`, 340, y); right(fmtMoney(inv.gst), y); y -= 18;
  text('Total', 340, y, { bold: true, size: 11 }); right(fmtMoney(inv.total), y, { bold: true, size: 11 }); y -= 16;
  text('Paid', 340, y); right(fmtMoney(paidAmount(inv)), y); y -= 16;
  text('Balance due', 340, y, { bold: true }); right(fmtMoney(balanceOf(inv)), y, { bold: true });

  y -= 40;
  text('Payment schedule', 40, y, { bold: true, size: 11 }); y -= 18;
  scheduleView(inv, caseRec, config).forEach((s) => {
    text(`${s.label} (${s.pct}%)`, 48, y); text(`Due ${fmtDate(s.dueDate)}`, 250, y);
    text(s.outstanding <= 0 ? 'Paid' : s.overdue ? 'Overdue' : 'Outstanding', 380, y); right(fmtMoney(s.amount), y); y -= 16;
  });
  if (inv.payments.length) {
    y -= 18;
    text('Payments received', 40, y, { bold: true, size: 11 }); y -= 18;
    inv.payments.forEach((p) => {
      text(fmtDate(p.date), 48, y); text(PAYMENT_METHODS[p.method] || p.method, 150, y); text(p.reference || '', 260, y); right(fmtMoney(p.amount), y); y -= 16;
    });
  }
  text('Prototype document. Prices, GST rate and payment terms are samples to be confirmed.', 40, 40, { size: 8, color: rgb(0.5, 0.5, 0.5) });
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}
