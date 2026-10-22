import { start, resetAndLogin, loginAs, check, db, BASE, OUT } from './lib.mjs';
import fs from 'node:fs'; import { execSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
const { browser, errors, newPage } = await start();
const a = await newPage();
await resetAndLogin(a, 'admin@demo.sg');
const body = () => a.locator('body').innerText();
const call = (p, fn, ...args) => p.evaluate(async ([fn, args]) => { const { api } = await import('/js/api/index.js'); try { return { ok: await api[fn](...args) }; } catch (e) { return { err: e.message }; } }, [fn, args]);

// ---- template manager
await a.goto(BASE + '#/staff/letters'); await a.waitForSelector('#letterTemplateForm');
check('seeded with recommendation and cover letter templates, both internal', (await a.locator('.msg-list li').count()) === 2 && (await a.locator('.msg-list .chip:has-text("client blank")').count()) === 0);
await a.click('[data-action=newLetterTpl]'); await a.waitForSelector('#letterTemplateForm[data-id=""]');
check('client-blank flag defaults to off on a new template', !(await a.locator('#letterTemplateForm [name=clientMayDownloadBlank]').isChecked()));
fs.writeFileSync(`${OUT}/consent.html`, '<p>I, {{client_name}} ({{case_no}}), consent to the collection of my data.</p><p>Signed: ________</p>');
await a.setInputFiles('[data-letter-file]', `${OUT}/consent.html`);
await a.waitForFunction(() => document.querySelector('#letterTemplateForm [name=body]').value.includes('consent to the collection'));
check('template text loads from an uploaded file', (await a.inputValue('#letterTemplateForm [name=name]')) === 'consent');
await a.fill('#letterTemplateForm [name=name]', 'PDPA consent form'); await a.selectOption('#letterTemplateForm [name=kind]', 'OTHER');
await a.click('#letterTemplateForm button[type=submit]'); await a.waitForTimeout(400);
let d = await db(a);
const consent = d.letterTemplates.find((t) => t.name === 'PDPA consent form');
check('new template saved, internal by default, edit audited', consent && consent.clientMayDownloadBlank === false && d.audit.some((x) => x.action === 'LETTER_TEMPLATE_EDITED'));

// ---- generate on a case (consultant1 owns Elizabeth)
const c1 = await newPage(); await resetAndLogin(c1, 'consultant1@demo.sg');
await c1.goto(BASE + '#/staff/case/PIC-2026-0142'); await c1.waitForSelector('[data-letter-new]');
await c1.selectOption('[data-letter-new] select', 'lt_rec'); await c1.click('[data-letter-new] button'); await c1.waitForSelector('#letterForm');
const text = await c1.inputValue('#letterForm [name=body]');
check('letter pre-filled from profile and onboarding form', /Elizabeth Tan/.test(text) && /Nexora Analytics Pte Ltd/.test(text) && /Senior Data Analyst/.test(text) && /7800/.test(text) && /Daniel Koh/.test(text) && /PIC-2026-0142/.test(text) && !/\{\{/.test(text));
check('live preview shows the filled letter', /Recommendation for Elizabeth Tan/.test(await c1.locator('[data-letter-preview]').innerText()));
await c1.fill('#letterForm [name=body]', text.replace('We recommend the application', 'EDITED BY STAFF. We recommend the application'));
await c1.click('#letterForm button[type=submit]'); await c1.waitForSelector('[data-action=downloadLetter]');
d = await db(a);
const letter = d.letters.find((l) => l.caseId === 'PIC-2026-0142');
check('letter attached to the case as an internal document', letter && letter.internal === true && /EDITED BY STAFF/.test(letter.body) && d.audit.some((x) => x.action === 'LETTER_GENERATED' && x.caseId === 'PIC-2026-0142'));
const dp = c1.waitForEvent('download'); await c1.click('[data-action=downloadLetter][data-format=PDF]'); const pf = await dp; await pf.saveAs(`${OUT}/letter.pdf`);
const dd = c1.waitForEvent('download'); await c1.click('[data-action=downloadLetter][data-format=DOCX]'); const df = await dd; await df.saveAs(`${OUT}/letter.docx`);
const pdf = await PDFDocument.load(fs.readFileSync(`${OUT}/letter.pdf`));
check('PDF download opens', pdf.getPageCount() >= 1 && /\.pdf$/.test(pf.suggestedFilename()), pf.suggestedFilename());
const docxXml = execSync(`unzip -p ${OUT}/letter.docx word/document.xml`).toString();
check('DOCX is a valid package containing the letter text', /Elizabeth Tan/.test(docxXml) && /EDITED BY STAFF/.test(docxXml) && /<w:b\/>/.test(docxXml));
d = await db(a);
check('every download is logged with who and format', d.audit.filter((x) => x.action === 'LETTER_DOWNLOADED').map((x) => x.after.format).sort().join() === 'DOCX,PDF');
await c1.click('a[href*="letter?letter="]'); await c1.waitForSelector('#letterForm');
await c1.fill('#letterForm [name=name]', 'Recommendation (final)'); await c1.click('#letterForm button[type=submit]'); await c1.waitForTimeout(400);
d = await db(a);
check('re-saving makes a new version of the same letter', d.letters.filter((l) => l.caseId === 'PIC-2026-0142').length === 1 && d.letters[0].version === 2);

// ---- never visible to the client
const cl = await newPage(); await resetAndLogin(cl, 'elizabeth@demo.sg'); await cl.waitForSelector('.hero');
const ctext = await cl.locator('body').innerText();
check('client portal shows no letters or letter templates', !/Recommendation|Letters|Forms to download|PDPA consent/.test(ctext));
for (const [fn, args] of [['listLetterTemplates', []], ['caseLetters', ['PIC-2026-0142']], ['getLetter', [letter.id]], ['previewLetter', ['PIC-2026-0142', 'lt_rec']], ['logLetterDownload', [letter.id, 'PDF']], ['letterDownloadLog', []], ['saveLetterTemplate', [{ name: 'x', body: 'y', kind: 'OTHER' }]]]) {
  const r = await call(cl, fn, ...args);
  check(`client refused: ${fn}`, /permission/.test(r.err || ''), r.err || JSON.stringify(r.ok).slice(0, 60));
}
let r = await call(cl, 'downloadBlankForm', 'PIC-2026-0142', 'lt_rec', 'PDF');
check('client cannot download a blank form while the flag is off', /not available/.test(r.err || ''));
r = await call(cl, 'clientBlankForms', 'PIC-2026-0142');
check('no client forms listed while off', Array.isArray(r.ok) && r.ok.length === 0);
// consultant2 / specialist scope
const c2 = await newPage(); await resetAndLogin(c2, 'consultant2@demo.sg');
r = await call(c2, 'caseLetters', 'PIC-2026-0142');
check("consultant2 cannot read consultant1's letters", /another consultant/.test(r.err || ''));
r = await call(c2, 'saveLetterTemplate', { name: 'x', body: 'y', kind: 'OTHER' });
check('consultant cannot edit templates', /permission/.test(r.err || ''));
const sp = await newPage(); await resetAndLogin(sp, 'specialist@demo.sg');
r = await call(sp, 'previewLetter', 'PIC-2026-0142', 'lt_cover');
check('specialist can generate letters on any case', !r.err && /ICA|Immigration and Checkpoints/.test(r.ok.html), r.err);
// ---- opt-in blank form
await a.goto(BASE + '#/staff/letters'); await a.click(`.msg-list li:has-text("PDPA consent form")`); await a.waitForSelector('#letterTemplateForm');
await a.check('#letterTemplateForm [name=clientMayDownloadBlank]'); await a.click('#letterTemplateForm button[type=submit]'); await a.waitForTimeout(400);
await cl.reload(); await cl.waitForSelector('.hero');
check('client now sees only the opted-in blank form', /Forms to download/.test(await cl.locator('body').innerText()) && /PDPA consent form/.test(await cl.locator('body').innerText()) && !/Recommendation letter/.test(await cl.locator('body').innerText()));
const bd = cl.waitForEvent('download'); await cl.click('[data-action=blankForm][data-format=DOCX]'); const bf = await bd; await bf.saveAs(`${OUT}/blank.docx`);
const bx = execSync(`unzip -p ${OUT}/blank.docx word/document.xml`).toString();
check('blank copy leaves the merge fields empty', /________/.test(bx) && !/Elizabeth/.test(bx));
d = await db(a);
check('blank download logged against the client', d.audit.some((x) => x.action === 'BLANK_FORM_DOWNLOADED' && x.caseId === 'PIC-2026-0142' && x.actorId === 'u_elizabeth'));
await a.goto(BASE + '#/staff/letters'); await a.waitForSelector('.table-wrap');
check('download log table lists staff and client downloads', /Downloaded "Recommendation/.test(await a.locator('.table-wrap').innerText()) && /blank form/.test(await a.locator('.table-wrap').innerText()));

// ---- Drive
await c1.goto(BASE + '#/staff/case/PIC-2026-0142'); await c1.waitForSelector('#driveForm');
check('no import button until a link is saved', (await c1.locator('[data-action=importDrive]').count()) === 0);
r = await call(c1, 'setLegacyDriveUrl', 'PIC-2026-0142', 'not a link');
check('invalid link rejected by the server-side check', /https/.test(r.err || ''));
await c1.fill('#driveForm [name=url]', 'https://drive.google.com/drive/folders/abc123'); await c1.click('#driveForm button[type=submit]'); await c1.waitForTimeout(300);
await c1.click('[data-action=importDrive]'); await c1.waitForTimeout(600);
d = await db(a);
const imp = d.documents.filter((x) => x.source === 'drive' && x.caseId === 'PIC-2026-0142');
check('Drive import fills the pending passport and payslips items', imp.length === 2 && d.items.find((i) => i.id === 'PIC-2026-0142_PASSPORT').status === 'UPLOADED' && d.items.find((i) => i.id === 'PIC-2026-0142_PAYSLIPS').status === 'UPLOADED', imp.map((x) => x.fileName).join());
check('imported documents record Drive as the source', imp.every((x) => x.uploadedBy.via === 'Google Drive import' && x.uploadedBy.onBehalf));
check('already accepted items are not overwritten', d.items.find((i) => i.id === 'PIC-2026-0142_NOA').status === 'ACCEPTED');
// ---- CRM
await a.goto(BASE + '#/staff/admin'); await a.click('[data-action=adminTab][data-tab=integrations]'); await a.waitForSelector('[data-crm-csv]');
check('CRM page states it is not connected (platform TBC)', /not connected \(CRM platform TBC\)/i.test(await body()));
await a.click('[data-action=crmSample]'); await a.click('[data-action=crmImport]'); await a.waitForTimeout(400);
d = await db(a);
check('CSV import creates leads in New from a CRM import source', d.leads.filter((l) => l.heardOfUs === 'CRM import' && l.stage === 'NEW').length === 3);
await a.click('[data-action=crmSample]'); await a.click('[data-action=crmImport]'); await a.waitForTimeout(400);
check('re-importing skips duplicates', /3 skipped/.test(await a.locator('#toast').innerText()));
r = await call(c1, 'importLeadsCsv', 'name,email\nx,y@z.com');
check('only config:manage can import', /permission/.test(r.err || ''));
// retention
await a.click('[data-action=adminTab][data-tab=settings]'); await a.waitForSelector('[data-retention]');
await a.fill('[data-retention=OUTCOME]', '18'); await a.press('[data-retention=OUTCOME]', 'Tab'); await a.waitForTimeout(300);
d = await db(a);
check('retention per case status stored in config', d.config.retentionMonths.OUTCOME === 18);
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
