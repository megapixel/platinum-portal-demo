// The README "Demo script v2", steps 1 to 8, driven through the UI as written.
import { start, resetAndLogin, loginAs, check, db, BASE, SEEDF, OUT } from './lib.mjs';
import fs from 'node:fs'; import { execSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
const { browser, errors, newPage } = await start();
const text = (p) => p.locator('body').innerText();

// ===== Step 1: /apply on a phone-width screen
const phone = await newPage({ width: 390, height: 800 });
await phone.goto(BASE + '#/apply'); await phone.waitForSelector('#applyForm');
for (const [n, v] of Object.entries({ name: 'Zara Demo Tester', phone: '+65 9555 0101', email: 'zara.tester@demo.sg', nationality: 'Malaysian', yearsInSg: '6' })) await phone.fill(`[name=${n}]`, v);
await phone.selectOption('[name=passType]', 'Employment Pass'); await phone.selectOption('[name=interest]', 'PR'); await phone.selectOption('[name=sourceId]', 'src_social');
await phone.click('#applyForm button[type=submit]'); await phone.waitForTimeout(400);
check('1. thank-you shown', /Our consultant will reach out to you/.test(await text(phone)));
const ops = await newPage(); await resetAndLogin(ops, 'ops@demo.sg');
let d = await db(ops);
const lead = d.leads.find((l) => l.email === 'zara.tester@demo.sg');
await ops.goto(BASE + '#/staff/leads'); await ops.waitForSelector('.kanban');
check('1. lead appears under New', /Zara Demo Tester/.test(await ops.locator('[data-drop-stage=NEW]').innerText()));
await ops.goto(BASE + '#/staff/outbox'); await ops.waitForSelector('.phone');
check('1. WhatsApp greeting shows in the Outbox', /Zara Demo Tester|Zara/.test(await ops.locator('.msg-list').innerText()) && d.outbox.some((m) => m.trigger === 'LEAD_GREETING' && m.leadId === lead.id));

// ===== Step 2: consultant1 moves, notes, wins, converts
const c1 = await newPage(); await resetAndLogin(c1, 'consultant1@demo.sg');
await c1.goto(BASE + '#/staff/leads'); await c1.waitForSelector('.kanban');
await c1.click(`[data-lead-card="${lead.id}"]`); await c1.waitForSelector('[data-lead-stage]');
await c1.selectOption('[data-lead-field=packageId]', 'pkg_pr'); await c1.waitForTimeout(250);
await c1.selectOption('[data-lead-stage]', 'CONSULTATION_BOOKED'); await c1.waitForTimeout(250);
await c1.fill('#leadNoteForm [name=text]', 'Called and booked a consultation'); await c1.click('#leadNoteForm button'); await c1.waitForTimeout(250);
await c1.selectOption('[data-lead-stage]', 'WON'); await c1.waitForTimeout(250);
await c1.click('[data-action=openConvert]'); await c1.click('#convertForm button[type=submit]'); await c1.waitForTimeout(900);
d = await db(ops);
const kase = d.cases.find((c) => c.sourceLeadId === lead.id);
check('2. client, PR case and invoice created; welcome queued', !!kase && kase.caseType === 'PR' && d.invoices.some((i) => i.caseId === kase.id) && d.outbox.some((m) => m.trigger === 'WELCOME' && m.caseId === kase.id));
const welcome = d.outbox.find((m) => m.trigger === 'WELCOME' && m.caseId === kase.id);

// ===== Step 3: new client via magic link: form, two documents, submit for review
const cl = await newPage({ width: 390, height: 800 });
await cl.goto(welcome.link); await cl.waitForSelector('.hero');
await cl.click('a[href^="#/portal/info"]'); await cl.waitForSelector('#onboardingForm');
const fills = { dob: '1990-05-05', nationality: 'Malaysian', employer: 'Orion Labs Pte Ltd', position: 'Engineer', monthly_salary: '7000', highest_qualification: 'BEng', institution: 'NUS', address_sg: 'Blk 1 Test Rd', years_in_sg: '6', full_name: 'Zara Demo Tester' };
for (const [k, v] of Object.entries(fills)) await cl.fill(`[name=${k}]`, v);
await cl.selectOption('[name=marital_status]', 'Single'); await cl.selectOption('[name=pass_type]', 'Employment Pass');
await cl.click('[data-mode=submit]'); await cl.waitForSelector('.hero');
const up = async (code, file) => { await cl.click(`#todo [data-action=openUpload][data-item="${kase.id}_${code}"]`); await cl.setInputFiles('.modal input[data-upload-input] >> nth=0', SEEDF + file); await cl.waitForSelector('.modal .result-icon', { timeout: 8000 }); await cl.click('.modal [data-action=closeModal]'); };
await up('PHOTO', 'photo_headshot_sample.png');
await up('PASSPORT', 'passport_name_mismatch_elizabeth_tan.png');
await cl.click('[data-action=submitReview]'); await cl.waitForTimeout(500);
d = await db(ops);
check('3. form submitted, two uploads, review task created', d.cases.find((c) => c.id === kase.id).onboarding.status === 'SUBMITTED' && d.reviewTasks.some((t) => t.caseId === kase.id && t.status === 'OPEN'));

// ===== Step 4: specialist queue, AI flag (name mismatch), reject with reason
const sp = await newPage(); await resetAndLogin(sp, 'specialist@demo.sg');
await sp.goto(BASE + '#/staff/review'); await sp.waitForSelector('.queue-grid');
await sp.click('[data-action=queueFilter][data-filter=AI_FLAGGED]');
await sp.click('.msg-list li:has-text("Zara"):has-text("Passport")'); await sp.waitForTimeout(200);
const flaggedTxt = await sp.locator('.queue-grid').innerText();
check('4. queue shows the AI-flagged name mismatch', /Passport/.test(flaggedTxt) && /does not match the name on your information form/.test(flaggedTxt));
await sp.keyboard.press('r'); await sp.waitForSelector('#rejectForm'); await sp.keyboard.press('5'); await sp.keyboard.press('Control+Enter'); await sp.waitForTimeout(500);
d = await db(ops);
const rej = d.outbox.find((m) => m.trigger === 'DOC_REJECTED' && m.caseId === kase.id);
check('4. client got a rejection with reason and what to do next', rej && /name does not match/i.test(rej.body) && /What to do next/.test(rej.body));


// ===== Step 5: Run Sunday reminders
await ops.goto(BASE + '#/staff'); await ops.waitForSelector('table.data');
check('5. button reads "Run Sunday reminders"', /Run Sunday reminders/.test(await text(ops)));
await ops.click('[data-action=runWeekly]'); await ops.waitForTimeout(800);
d = await db(ops);
const weekly = d.outbox.filter((m) => m.trigger === 'WEEKLY');
const names = weekly.map((m) => m.toName);
check('5. only clients with outstanding items are messaged, each personalised', names.includes('Elizabeth Tan') && names.includes('Zara Demo Tester') && !names.some((n) => /Priya|Kittisak/.test(n)) && weekly.every((m) => m.body.startsWith('Hi ' + m.toName.split(' ')[0])), names.join(', '));

// ===== Step 6: Elizabeth complete -> consolidation -> submission pack
const el = await newPage(); await resetAndLogin(el, 'elizabeth@demo.sg'); await el.waitForSelector('.hero');
const upE = async (code, file) => { await el.click(`#todo [data-action=openUpload][data-item$="_${code}"]`); await el.setInputFiles('.modal input[data-upload-input] >> nth=0', SEEDF + file); await el.waitForSelector('.modal .result-icon', { timeout: 8000 }); await el.click('.modal [data-action=closeModal]'); };
await upE('PASSPORT', 'passport_elizabeth_tan.png');
await upE('PAYSLIPS', 'payslips_elizabeth_tan_apr-sep_2026.pdf');
await upE('EMPLOYER_LETTER', 'employer_letter_signed_elizabeth_tan.pdf');
await el.click('[data-action=submitReview]'); await el.waitForTimeout(500);
await sp.reload(); await sp.waitForSelector('.queue-grid');
for (let i = 0; i < 3; i++) { await sp.click('.msg-list li:has-text("Elizabeth")'); await sp.waitForTimeout(200); await sp.keyboard.press('a'); await sp.waitForTimeout(500); }
d = await db(ops);
check('6. all of Elizabeth\'s items accepted', d.items.filter((i) => i.caseId === 'PIC-2026-0142' && i.required).every((i) => i.status === 'ACCEPTED'));
await sp.goto(BASE + '#/staff/case/PIC-2026-0142/pack'); await sp.waitForSelector('.checks');
check('6. consolidation checks all pass', (await sp.locator('.checks li.bad').count()) === 0);
const dls = []; sp.on('download', (x) => dls.push(x));
await sp.click('[data-action=generatePack]'); await sp.waitForFunction(() => /Pack generated/.test(document.getElementById('toast').innerText), null, { timeout: 25000 }); await sp.waitForTimeout(900);
fs.mkdirSync(OUT, { recursive: true });
for (const x of dls) await x.saveAs(`${OUT}/demo_${x.suggestedFilename()}`);
const zipNames = execSync(`unzip -Z1 ${OUT}/demo_PIC-2026-0142_submission_pack.zip`).toString().trim().split('\n');
const mergedPdf = await PDFDocument.load(fs.readFileSync(`${OUT}/demo_PIC-2026-0142_submission_pack.pdf`));
check('6. ZIP with consistent names and merged PDF with index page', zipNames.length === 8 && zipNames.every((n) => /^PIC-2026-0142_MainApplicant_\d{2}_[A-Z_]+\.pdf$/.test(n)) && mergedPdf.getPageCount() >= 9, `${zipNames.length} files, ${mergedPdf.getPageCount()} pages`);
d = await db(ops);
check('6. stage moved to Documents complete', d.cases.find((c) => c.id === 'PIC-2026-0142').stage === 'DOCUMENTS_COMPLETE');

// ===== Step 7: admin: deposit, recommendation letter, Submitted, Outcome Approved
const ad = await newPage(); await resetAndLogin(ad, 'admin@demo.sg');
await ad.goto(BASE + '#/staff/case/PIC-2026-0142'); await ad.waitForSelector('.pay-form');
await ad.click('.pay-form button'); await ad.waitForTimeout(500);
d = await db(ops);
check('7. deposit recorded (50%)', d.invoices.find((i) => i.caseId === 'PIC-2026-0142').payments.length === 1 && d.invoices.find((i) => i.caseId === 'PIC-2026-0142').payments[0].amount === 2071);
await ad.selectOption('[data-letter-new] select', 'lt_rec'); await ad.click('[data-letter-new] button'); await ad.waitForSelector('#letterForm');
check('7. recommendation letter pre-filled', /Elizabeth Tan/.test(await ad.inputValue('#letterForm [name=body]')));
await ad.click('#letterForm button[type=submit]'); await ad.waitForSelector('[data-action=downloadLetter]');
let warned = '';
ad.once('dialog', (dlg) => { warned = dlg.message(); dlg.accept(); });
await ad.selectOption('[data-stage-select]', 'SUBMITTED'); await ad.waitForTimeout(700);
check('7. Submitted warns about the unpaid balance, then proceeds', /unpaid balance of SGD 2,071.00/.test(warned) && (await db(ops)).cases.find((c) => c.id === 'PIC-2026-0142').stage === 'SUBMITTED', warned);
await ad.waitForSelector('#outcomeForm');
await ad.fill('#outcomeForm [name=reference]', 'PR-2026-90001'); await ad.fill('#outcomeForm [name=nextSteps]', 'Collect your PR card from the ICA.');
await ad.click('#outcomeForm button[type=submit]'); await ad.waitForTimeout(700);
await el.reload(); await el.waitForSelector('.hero');
check('7. client sees the Approved outcome', /Your application was approved/.test(await text(el)) && /PR-2026-90001/.test(await text(el)));

// ===== Step 8: ops: analytics and the case audit timeline
await ops.goto(BASE + '#/staff/analytics'); await ops.waitForSelector('.bar-row');
const an = await text(ops);
check('8. analytics: approval rate by nationality, source conversion, revenue collected vs outstanding', /Approval rate by nationality/.test(an) && /Leads by source and conversion/.test(an) && /Collected vs outstanding/.test(an) && /Revenue collected/.test(an));
check('8. approval rate shown overall and per nationality', (await ops.locator('.card:has(h2:text("Approval rate by nationality")) .bar-row').count()) >= 8);
await ops.goto(BASE + '#/staff/case/PIC-2026-0142'); await ops.waitForSelector('.audit');
const tl = await ops.locator('.timeline').innerText();
check('8. case audit timeline shows pack, payment, letter, stage and outcome with who and when', /pack generated/i.test(tl) && /payment recorded/i.test(tl) && /letter generated/i.test(tl) && /outcome recorded/i.test(tl) && /stage changed/i.test(tl));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
