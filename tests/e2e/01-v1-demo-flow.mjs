import { start, resetAndLogin, loginAs, check, db, BASE, SEEDF } from './lib.mjs';
const { browser, errors, newPage } = await start();
const staff = await newPage();
await resetAndLogin(staff, 'staff@demo.sg');   // v1 alias must still work
check('v1 alias staff@demo.sg logs in', (await staff.locator('h1').first().innerText()).includes('My clients'));
// KPIs and rows (consultant1 sees only own cases)
const rows = await staff.locator('table.data tbody tr').count();
check('consultant1 sees only assigned cases (5)', rows === 5, `rows=${rows}`);
// 2. run weekly reminders
await staff.click('[data-action=runWeekly]');
await staff.waitForTimeout(400);
await staff.goto(BASE + '#/staff/outbox');
await staff.waitForSelector('.phone');
const bubble = await staff.locator('.wa-bubble').innerText();
const first = await staff.locator('.msg-list li').first().innerText();
console.log('first outbox item:', first.split('\n')[0]);
const d1 = await db(staff);
const eliz = d1.outbox.find((m) => m.caseId === 'PIC-2026-0142' && m.trigger === 'WEEKLY');
check('Elizabeth reminder lists pending passport/payslips and rejected letter', eliz && /Passport/.test(eliz.body) && /payslips/i.test(eliz.body) && /unsigned/i.test(eliz.body));
check('reminder skips clients with nothing outstanding (Priya, Kittisak)', !d1.outbox.some((m) => m.toName && /Priya|Kittisak/.test(m.toName)));
check('reminder link is a magic link', /#\/magic\//.test(eliz.body));
// 3. open the magic link in a fresh tab
const link = eliz.link;
const client = await newPage({ width: 390, height: 800 });
await client.goto(link);
await client.waitForSelector('.hero');
check('magic link signs Elizabeth in at case', (await client.locator('h1').first().innerText()).includes('Elizabeth'));
// link is one-time
const again = await newPage();
await again.goto(link);
await again.waitForTimeout(300);
check('second use of the link shows the used message', /already been used/.test(await again.locator('body').innerText()));
// 4. upload wrong doc to passport
await client.click('#todo [data-action=openUpload][data-item$="_PASSPORT"]');
await client.setInputFiles('.modal input[data-upload-input] >> nth=0', SEEDF + 'payslip_elizabeth_tan_2026-09.pdf');
await client.waitForSelector('.modal .result-icon', { timeout: 8000 });
const msg1 = await client.locator('.modal .note').innerText();
check('AI flags a payslip uploaded as passport', /payslip/i.test(msg1) && /passport/i.test(msg1), msg1);
await client.click('.modal [data-action=uploadAgain]');
await client.setInputFiles('.modal input[data-upload-input] >> nth=0', SEEDF + 'passport_elizabeth_tan.png');
await client.waitForSelector('.modal .result-icon', { timeout: 8000 });
check('correct passport accepted for review', /All required details found|received/i.test(await client.locator('.modal .note').innerText()));
await client.click('.modal [data-action=closeModal]');
// 5. staff accepts
await staff.goto(BASE + '#/staff/case/PIC-2026-0142');
await staff.waitForSelector('.item-card');
const before = await staff.locator('text=Complete').first().innerText().catch(() => '');
if (!(await staff.locator('.item-card.open:has-text("Passport")').count())) { await staff.click('.item-card:has-text("Passport") .item-head'); await staff.waitForTimeout(150); }
const acceptBtn = staff.locator('.item-card.open:has-text("Passport") button[data-action=accept]:not([disabled])').first();
await acceptBtn.click();
await staff.waitForTimeout(500);
const toastTxt = await staff.locator('#toast').innerText();
check('accept raises completion', /Completion 63% .* 75%/.test(toastTxt), toastTxt);
// 6. Priya stage change
await staff.goto(BASE + '#/staff/case/PIC-2026-0109');
await staff.selectOption('[data-stage-select]', 'REVIEW_AND_PREPARATION');
await staff.waitForTimeout(500);
const d2 = await db(staff);
check('stage change recorded', d2.cases.find((c) => c.id === 'PIC-2026-0109').stage === 'REVIEW_AND_PREPARATION');
check('client got stage-changed message', d2.outbox.some((m) => m.trigger === 'STAGE_CHANGED' && m.caseId === 'PIC-2026-0109'));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
