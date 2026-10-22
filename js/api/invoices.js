// api/invoices: invoice building. Phase 6 adds payments, status rules and the billing views.
import { db } from '../store.js';
import { uid, nowIso } from '../utils.js';
import { nextInvoiceNo } from './numbering.js';

const round2 = (n) => Math.round(n * 100) / 100;

/** Invoice generated from the package price. GST rate and payment schedule come from config (TBC with the client). */
export function buildInvoice(caseRec, pkg, actorId) {
  const cfg = db.config;
  const subtotal = round2(pkg.price);
  const gst = round2(subtotal * cfg.gstRate);
  const total = round2(subtotal + gst);
  let allocated = 0;
  const schedule = cfg.paymentSchedule.map((s, i, arr) => {
    const amount = i === arr.length - 1 ? round2(total - allocated) : round2((total * s.pct) / 100);
    allocated += amount;
    return { label: s.label, pct: s.pct, amount, due: s.due };
  });
  return {
    id: uid('inv'), number: nextInvoiceNo(), caseId: caseRec.id, clientId: caseRec.clientId, packageId: pkg.id,
    lines: [{ description: pkg.name, qty: 1, unit: subtotal }],
    subtotal, gstRate: cfg.gstRate, gst, total, schedule,
    status: 'ISSUED', issuedAt: nowIso(), issuedById: actorId, voidedAt: null, payments: [],
  };
}
