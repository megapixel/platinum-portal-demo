import { start, resetAndLogin, loginAs, check, db, BASE, SEEDF } from './lib.mjs';
const { browser, errors, newPage } = await start();
const body = (p) => p.locator('body').innerText();

// ---------- Phase 1: roles, access ----------
const a = await newPage();
await resetAndLogin(a, 'consultant1@demo.sg');
await a.goto(BASE + '#/staff/case/PIC-2026-0118');          // Nurul belongs to consultant2
await a.waitForTimeout(300);
check('consultant1 denied consultant2 case', /assigned to another consultant/.test(await body(a)));
await a.goto(BASE + '#/staff/admin'); await a.waitForTimeout(300);
check('consultant denied Admin page', /Access denied/.test(await body(a)));
await loginAs(a, 'specialist@demo.sg');
await a.goto(BASE + '#/staff/leads'); await a.waitForTimeout(300);
check('specialist can view pipeline read-only', /Lead pipeline/.test(await body(a)));
await a.goto(BASE + '#/staff/lead/lead_001'); await a.waitForTimeout(300);
check('specialist lead detail has no write controls', (await a.locator('#leadNoteForm').count()) === 0 && (await a.locator('[data-lead-stage][disabled]').count()) === 1);
await loginAs(a, 'elizabeth@demo.sg');
await a.goto(BASE + '#/staff'); await a.waitForTimeout(300);
check('client denied staff area', /Staff only|Access denied/.test(await body(a)));
await a.goto(BASE + '#/portal?case=PIC-2026-0118'); await a.waitForTimeout(300);
check('client denied another client case', /do not have access/.test(await body(a)));
await loginAs(a, 'ops@demo.sg');
await a.goto(BASE + '#/staff/admin'); await a.waitForTimeout(300);
check('ops sees permissions matrix', /Permissions/.test(await body(a)) && (await a.locator('table.matrix').count()) === 1);
check('ops has no Users tab', (await a.locator('[data-action=adminTab][data-tab=users]').count()) === 0);
await loginAs(a, 'admin@demo.sg');
await a.goto(BASE + '#/staff/admin'); await a.waitForTimeout(300);
await a.click('[data-action=adminTab][data-tab=users]');
await a.selectOption('[data-user-role="u_sarah"]', 'OPS_MANAGER'); await a.waitForTimeout(300);
let d = await db(a);
check('admin role change audited', d.audit.some((x) => x.action === 'PERMISSION_CHANGED' && /Sarah/.test(x.detail)));
await a.selectOption('[data-user-role="u_sarah"]', 'CONSULTANT'); await a.waitForTimeout(200);

// magic link expiry
await loginAs(a, 'consultant1@demo.sg');
await a.goto(BASE + '#/login'); await a.waitForSelector('#loginForm');
await a.fill('#loginForm [name=email]', 'elizabeth.spouse@demo.sg');
await a.click('[data-action=emailMagicLink]'); await a.waitForTimeout(300);
d = await db(a);
const em = d.emails.find((m) => m.trigger === 'MAGIC_LINK');
check('magic link written to email outbox', !!em && /expires in 15 minutes/.test(em.body));
// expire it
await a.evaluate(() => { const x = JSON.parse(localStorage.getItem('pi_portal_db_v2')); x.magicLinks.forEach((m) => { m.expiresAt = new Date(Date.now() - 1000).toISOString(); }); localStorage.setItem('pi_portal_db_v2', JSON.stringify(x)); });
const b = await newPage();
await b.goto(em.link); await b.waitForTimeout(400);
check('expired magic link shows expired message', /has expired/.test(await body(b)));
await b.fill('#magicRequestForm [name=email]', 'elizabeth.spouse@demo.sg'); await b.click('#magicRequestForm button'); await b.waitForTimeout(300);
d = await db(a);
const fresh = d.emails.filter((m) => m.trigger === 'MAGIC_LINK');
check('new link requested from expired page', fresh.length === 2);
await b.goto(fresh[0].link); await b.waitForSelector('.hero');
check('second contact signs in via magic link', /Hi Jonathan/.test(await body(b)));

// ---------- Phase 2: /apply -> lead -> won -> convert ----------
await a.evaluate(() => sessionStorage.clear());
const phone = await newPage({ width: 390, height: 800 });
await phone.goto(BASE + '#/apply?utm_source=facebook&utm_medium=social&utm_campaign=pr-autumn');
await phone.waitForSelector('#applyForm');
await phone.fill('[name=name]', 'Zara Demo Tester');
await phone.fill('[name=phone]', '+65 9555 0101');
await phone.fill('[name=email]', 'zara.tester@demo.sg');
await phone.fill('[name=nationality]', 'Malaysian');
await phone.selectOption('[name=passType]', 'Employment Pass');
await phone.fill('[name=yearsInSg]', '6');
await phone.selectOption('[name=interest]', 'PR');
await phone.selectOption('[name=sourceId]', 'src_social');
const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
check('/apply has no horizontal scroll at 390px', !overflow);
await phone.click('#applyForm button[type=submit]'); await phone.waitForTimeout(400);
check('/apply shows thank-you', /Our consultant will reach out to you/.test(await body(phone)));
d = await db(a);
const lead = d.leads.find((l) => l.email === 'zara.tester@demo.sg');
check('lead created in New with UTM', lead && lead.stage === 'NEW' && lead.utm.campaign === 'pr-autumn');
check('WhatsApp greeting queued', d.outbox.some((m) => m.trigger === 'LEAD_GREETING' && m.leadId === lead.id));

const c1 = await newPage();
await resetAndLogin(c1, 'consultant1@demo.sg').catch(() => {});
await loginAs(c1, 'consultant1@demo.sg');
await c1.goto(BASE + '#/staff/leads'); await c1.waitForSelector('.kanban');
const newCol = await c1.locator('[data-drop-stage=NEW]').innerText();
check('lead appears under New', /Zara Demo Tester/.test(newCol));
await c1.click(`[data-lead-card="${lead.id}"]`); await c1.waitForSelector('[data-lead-stage]');
await c1.selectOption('[data-lead-field=packageId]', 'pkg_pr'); await c1.waitForTimeout(300);
await c1.selectOption('[data-lead-stage]', 'CONSULTATION_BOOKED'); await c1.waitForTimeout(300);
await c1.fill('#leadNoteForm [name=text]', 'Called, booked for Tuesday'); await c1.selectOption('#leadNoteForm [name=kind]', 'CALL'); await c1.click('#leadNoteForm button'); await c1.waitForTimeout(300);
await c1.selectOption('[data-lead-stage]', 'WON'); await c1.waitForTimeout(300);
await c1.click('[data-action=openConvert]'); await c1.waitForSelector('#convertForm');
await c1.click('#convertForm button[type=submit]'); await c1.waitForTimeout(800);
d = await db(a);
const lead2 = d.leads.find((l) => l.id === lead.id);
const kase = d.cases.find((c) => c.id === lead2.convertedCaseId);
check('lead converted to case with PR template', kase && kase.caseType === 'PR' && /^PIC-\d{4}-\d{4}$/.test(kase.id), kase && kase.id);
const inv = d.invoices.find((i) => i.caseId === kase.id);
check('invoice created from package (3800 + 9% GST)', inv && inv.subtotal === 3800 && inv.total === 4142 && /^INV-\d{4}-\d{4}$/.test(inv.number), inv && `${inv.number} ${inv.total}`);
const welcome = d.outbox.find((m) => m.trigger === 'WELCOME' && m.caseId === kase.id);
check('welcome message queued with magic link', welcome && /#\/magic\//.test(welcome.body));
check('lead audit trail has stage moves and conversion', d.audit.filter((x) => x.leadId === lead.id).map((x) => x.action).join(',').includes('LEAD_CONVERTED'));
check('lead claimed by consultant1', lead2.assignedStaffId === 'u_staff');

// ---------- Phase 3: client onboarding + submit for review ----------
const cl = await newPage({ width: 390, height: 800 });
await cl.goto(welcome.link); await cl.waitForSelector('.hero');
check('new client lands via magic link', /Hi Zara/.test(await body(cl)));
await cl.click('a[href^="#/portal/info"]'); await cl.waitForSelector('#onboardingForm');
// draft save
await cl.fill('[name=employer]', 'Orion Labs Pte Ltd');
await cl.click('[data-mode=draft]'); await cl.waitForTimeout(300);
d = await db(a);
check('draft saved with partial progress', d.cases.find((c) => c.id === kase.id).onboarding.status === 'DRAFT' && d.cases.find((c) => c.id === kase.id).onboarding.data.employer === 'Orion Labs Pte Ltd');
// submit with missing fields should fail
await cl.click('[data-mode=submit]'); await cl.waitForTimeout(300);
check('submit blocked until required fields filled', /Please complete the required fields|#\/portal\/info/.test(await body(cl) + cl.url()));
// fill all required
const fills = { dob: '1990-05-05', nationality: 'Malaysian', position: 'Engineer', monthly_salary: '7000', highest_qualification: 'BEng', institution: 'NUS', address_sg: 'Blk 1 Test Rd', years_in_sg: '6' };
for (const [k, v] of Object.entries(fills)) await cl.fill(`[name=${k}]`, v);
await cl.selectOption('[name=marital_status]', 'Single');
await cl.selectOption('[name=pass_type]', 'Employment Pass');
await cl.fill('[name=full_name]', 'Zara Demo Tester');
await cl.click('[data-mode=submit]'); await cl.waitForTimeout(400);
d = await db(a);
check('information form submitted', d.cases.find((c) => c.id === kase.id).onboarding.status === 'SUBMITTED');
// upload two documents
const itemId = (code) => `${kase.id}_${code}`;
await cl.waitForSelector('.hero');
await cl.click(`#todo [data-action=openUpload][data-item="${itemId('PHOTO')}"]`);
await cl.setInputFiles('.modal input[data-upload-input] >> nth=0', SEEDF + 'passport_elizabeth_tan.png');
await cl.waitForSelector('.modal .result-icon', { timeout: 8000 });
await cl.click('.modal [data-action=closeModal]');
await cl.click(`#todo [data-action=openUpload][data-item="${itemId('PASSPORT')}"]`);
await cl.setInputFiles('.modal input[data-upload-input] >> nth=0', SEEDF + 'passport_name_mismatch_elizabeth_tan.png');
await cl.waitForSelector('.modal .result-icon', { timeout: 8000 });
const flagMsg = await cl.locator('.modal .note').innerText();
check('AI flags name mismatch against information form', /does not match the name on your information form/.test(flagMsg), flagMsg);
await cl.click('.modal [data-action=closeModal]');
check('submit-for-review button visible with uploads pending', (await cl.locator('[data-action=submitReview]').count()) === 1);
check('Next reminder: Sunday shown', /Next reminder: Sunday/.test(await body(cl)));
await cl.click('[data-action=submitReview]'); await cl.waitForTimeout(400);
d = await db(a);
check('review task created for specialist', d.reviewTasks.some((t) => t.caseId === kase.id && t.status === 'OPEN' && t.itemIds.length === 2));
check('client got review confirmation', d.outbox.some((m) => m.trigger === 'REVIEW_SUBMITTED' && m.caseId === kase.id));
check('uploads record who uploaded', d.documents.filter((x) => x.caseId === kase.id).every((x) => x.uploadedBy && x.uploadedBy.role === 'CLIENT' && x.uploadedBy.onBehalf === false));

// specialist rejects the flagged doc with a reason
const sp = await newPage();
await resetAndLogin(sp, 'specialist@demo.sg').catch(() => {});
await loginAs(sp, 'specialist@demo.sg');
await sp.goto(BASE + `#/staff/case/${kase.id}`); await sp.waitForSelector('.item-card');
const rejectHead = sp.locator(`.item-card:has-text("Passport (bio page)")`).first();
if (!(await sp.locator('.item-card.open:has-text("Passport (bio page)")').count())) await rejectHead.locator('.item-head').click();
await sp.locator('.item-card.open:has-text("Passport (bio page)") [data-action=openReject]').click();
await sp.waitForSelector('#rejectForm');
await sp.keyboard.press('5');   // keyboard: 5 = name mismatch
await sp.fill('#rejectForm textarea', 'Spelling differs on page 2.');
await sp.click('#rejectForm button[type=submit]'); await sp.waitForTimeout(500);
d = await db(a);
const rej = d.outbox.find((m) => m.trigger === 'DOC_REJECTED' && m.caseId === kase.id);
check('rejection message has reason and what to do next', rej && /name does not match/i.test(rej.body) && /What to do next/.test(rej.body) && /Spelling differs/.test(rej.body), rej && rej.body.replace(/\n/g, ' | '));
// client sees rejection prominently, re-uploads -> v2
await cl.reload(); await cl.waitForSelector('.hero');
check('client sees rejection box with next step', (await cl.locator('.reject-box .next').count()) === 1);
await cl.click(`#todo [data-action=openUpload][data-item="${itemId('PASSPORT')}"]`);
await cl.setInputFiles('.modal input[data-upload-input] >> nth=0', SEEDF + 'passport_elizabeth_tan.png');
await cl.waitForSelector('.modal .result-icon', { timeout: 8000 });
d = await db(a);
const pdocs = d.documents.filter((x) => x.itemId === itemId('PASSPORT'));
check('re-upload creates v2 and keeps v1', pdocs.length === 2 && pdocs.map((x) => x.version).sort().join() === '1,2');
check('re-uploaded flag set for specialist queue', d.items.find((i) => i.id === itemId('PASSPORT')).reuploaded === true);
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
