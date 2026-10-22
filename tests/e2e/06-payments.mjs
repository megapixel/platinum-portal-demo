import { start, resetAndLogin, loginAs, check, db, BASE, OUT } from './lib.mjs';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
const { browser, errors, newPage } = await start();
const a = await newPage();
await resetAndLogin(a, 'admin@demo.sg');
let d = await db(a);
const st = async (caseId) => a.evaluate(async (id) => { const { statusOf, invoicesForCase } = await import('/js/api/invoices.js'); return invoicesForCase(id).map(statusOf)[0]; }, caseId);
const want = { 'PIC-2026-0142': 'OVERDUE', 'PIC-2026-0157': 'ISSUED', 'PIC-2026-0118': 'PARTIALLY_PAID', 'PIC-2026-0097': 'OVERDUE', 'PIC-2026-0126': 'PARTIALLY_PAID', 'PIC-2026-0109': 'PAID', 'PIC-2026-0081': 'OVERDUE', 'PIC-2026-0044': 'PAID' };
const got = {}; for (const k of Object.keys(want)) got[k] = await st(k);
check('8 seeded invoices in mixed payment states', JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got));
check('invoice numbers INV-YYYY-NNNN', d.invoices.every((i) => /^INV-\d{4}-\d{4}$/.test(i.number)));
await a.goto(BASE + '#/staff'); await a.waitForSelector('table.data');
check('dashboard shows payment chips', (await a.locator('table.data .chip:has-text("Overdue")').count()) === 3 && (await a.locator('table.data .chip:has-text("Paid")').count()) >= 2);
// case page: record deposit on Ahmad (ISSUED, nothing paid)
await a.goto(BASE + '#/staff/case/PIC-2026-0157'); await a.waitForSelector('.pay-form');
const amt = await a.inputValue('.pay-form [name=amount]');
check('payment form defaults to the first outstanding instalment (50% of 4,905)', Number(amt) === 2452.5, amt);
await a.fill('.pay-form [name=amount]', '99999'); await a.click('.pay-form button'); await a.waitForTimeout(300);
check('overpayment rejected', /more than the balance/.test(await a.locator('#toast').innerText()));
await a.fill('.pay-form [name=amount]', '2452.50'); await a.selectOption('.pay-form [name=method]', 'PAYNOW'); await a.fill('.pay-form [name=reference]', 'PN-DEMO-1');
await a.click('.pay-form button'); await a.waitForTimeout(500);
d = await db(a);
check('deposit recorded, status Partially paid, receipt message sent', (await st('PIC-2026-0157')) === 'PARTIALLY_PAID' && d.outbox.some((m) => m.trigger === 'PAYMENT_RECEIVED' && m.caseId === 'PIC-2026-0157') && d.audit.some((x) => x.action === 'PAYMENT_RECORDED' && x.caseId === 'PIC-2026-0157'));
// PDF
const dlp = a.waitForEvent('download');
await a.click('.inv-block [data-action=invoicePdf]');
const dl = await dlp; const pth = `${OUT}/inv.pdf`;
await dl.saveAs(pth);
const pdf = await PDFDocument.load(fs.readFileSync(pth));
check('invoice PDF downloads and opens', pdf.getPageCount() === 1 && /^INV-/.test(dl.suggestedFilename()), dl.suggestedFilename());
// warn-not-block
await a.goto(BASE + '#/staff/case/PIC-2026-0157'); await a.waitForSelector('[data-stage-select]');
let dialogMsg = '';
a.once('dialog', async (dlg) => { dialogMsg = dlg.message(); await dlg.dismiss(); });
await a.selectOption('[data-stage-select]', 'SUBMITTED'); await a.waitForTimeout(500);
d = await db(a);
check('Submitted with unpaid balance warns and dismissal keeps the stage', /unpaid balance of SGD 2,452.50/.test(dialogMsg) && d.cases.find((c) => c.id === 'PIC-2026-0157').stage === 'COLLECTING_DOCUMENTS', dialogMsg);
a.once('dialog', (dlg) => dlg.accept());
await a.selectOption('[data-stage-select]', 'SUBMITTED'); await a.waitForTimeout(600);
d = await db(a);
check('confirming moves the case (warn, not block) and audit notes it', d.cases.find((c) => c.id === 'PIC-2026-0157').stage === 'SUBMITTED' && d.audit.some((x) => /unpaid balance/.test(x.detail)));
check('client got "application submitted" message', d.outbox.some((m) => m.trigger === 'APPLICATION_SUBMITTED' && m.caseId === 'PIC-2026-0157'));
// paid case moves without warning
let warned = false; a.on('dialog', async (dlg) => { warned = true; await dlg.accept(); });
await a.goto(BASE + '#/staff/case/PIC-2026-0109'); await a.waitForSelector('[data-stage-select]');
await a.selectOption('[data-stage-select]', 'SUBMITTED'); await a.waitForTimeout(500);
check('fully paid case moves to Submitted without a warning', !warned);
a.removeAllListeners('dialog');
// config off: no warning
await a.evaluate(async () => { const { api } = await import('/js/api/index.js'); api.updateConfig({ warnUnpaidOnSubmit: false }); });
const r = await a.evaluate(async () => { const { api } = await import('/js/api/index.js'); try { await api.setStage('PIC-2026-0118', 'SUBMITTED'); return 'moved'; } catch (e) { return e.message; } });
check('rule off: no warning', r === 'moved', r);
await a.evaluate(async () => { const { api } = await import('/js/api/index.js'); api.updateConfig({ warnUnpaidOnSubmit: true }); });
// void rules
await a.goto(BASE + '#/staff/case/PIC-2026-0097'); await a.waitForSelector('.inv-block');
check('invoice with payments cannot be voided from UI; unpaid one can', (await a.locator('.inv-block [data-action=voidInvoice]').count()) === 1);
a.once('dialog', (dlg) => dlg.accept('Issued in error'));
await a.click('.inv-block [data-action=voidInvoice]'); await a.waitForTimeout(400);
d = await db(a);
check('void recorded with reason', d.invoices.find((i) => i.caseId === 'PIC-2026-0097').status === 'VOID');
// create + issue a new invoice on the voided case
await a.reload(); await a.waitForSelector('#createInvoiceForm');
await a.click('#createInvoiceForm button'); await a.waitForTimeout(400);
check('draft created', (await a.locator('.inv-block:has(.chip:has-text("Draft"))').count()) === 1);
await a.click('[data-action=issueInvoice]'); await a.waitForTimeout(500);
d = await db(a);
check('issuing sends the Invoice issued message', d.outbox.some((m) => m.trigger === 'INVOICE_ISSUED' && m.caseId === 'PIC-2026-0097'));
// permissions
const sp = await newPage(); await resetAndLogin(sp, 'specialist@demo.sg');
await sp.goto(BASE + '#/staff/case/PIC-2026-0142'); await sp.waitForSelector('.inv-block');
check('specialist sees invoices read-only', (await sp.locator('.pay-form').count()) === 0 && (await sp.locator('[data-action=issueInvoice],[data-action=voidInvoice]').count()) === 0);
const denied = await sp.evaluate(async () => { const { api } = await import('/js/api/index.js'); const d = JSON.parse(localStorage.getItem('pi_portal_db_v2')); try { await api.recordPayment(d.invoices[0].id, { amount: 1, method: 'CASH' }); return 'allowed'; } catch (e) { return e.message; } });
check('specialist cannot record payments (server-side check)', /permission/.test(denied), denied);
await loginAs(sp, 'consultant1@demo.sg');
const denied2 = await sp.evaluate(async () => { const { api } = await import('/js/api/index.js'); const d = JSON.parse(localStorage.getItem('pi_portal_db_v2')); try { await api.recordPayment(d.invoices[0].id, { amount: 1, method: 'CASH' }); return 'allowed'; } catch (e) { return e.message; } });
check('consultant cannot record payments', /permission/.test(denied2), denied2);
// client billing + pay now
const cl = await newPage(); await resetAndLogin(cl, 'elizabeth@demo.sg'); await cl.waitForSelector('.hero');
await cl.click('.subtabs a:has-text("Billing")'); await cl.waitForSelector('.bill-totals');
check('client billing shows total, paid, balance', /SGD 4,142.00/.test(await cl.locator('.bill-totals').innerText()) && /SGD 0.00/.test(await cl.locator('.bill-totals').innerText()));
await cl.click('[data-action=payNow]'); await cl.waitForTimeout(500);
d = await db(a);
check('mock Pay now settles the invoice', (await st('PIC-2026-0142')) === 'PAID' && d.invoices.find((i) => i.caseId === 'PIC-2026-0142').payments.slice(-1)[0].source === 'PAY_NOW');
check('client cannot see draft or other cases invoices', await cl.evaluate(async () => { const { api } = await import('/js/api/index.js'); try { api.caseInvoices('PIC-2026-0118'); return false; } catch (e) { return true; } }));
// exports
await a.goto(BASE + '#/staff/invoices'); await a.waitForSelector('.kpis');
const dl1 = a.waitForEvent('download'); await a.click('[data-action=exportInvoicesCsv]'); const f1 = await dl1;
const csvPath = `${OUT}/invoices.csv`; await f1.saveAs(csvPath);
const csv = fs.readFileSync(csvPath, 'utf8');
check('invoices CSV export', /^Invoice,Case,Client/.test(csv) && csv.split('\n').length >= 9, csv.split('\n')[1]);
const dl2 = a.waitForEvent('download'); await a.click('[data-action=exportPaymentsCsv]'); const f2 = await dl2;
check('payments CSV export', f2.suggestedFilename() === 'payments.csv');
// digest has overdue invoices
await a.goto(BASE + '#/staff/admin'); await a.click('[data-action=adminTab][data-tab=messaging]'); await a.click('[data-action=sendDigests]'); await a.waitForTimeout(500);
d = await db(a);
check('digest lists overdue invoices', d.emails.some((m) => m.trigger === 'STAFF_DIGEST' && /Overdue invoices/.test(m.body)));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
