import { start, resetAndLogin, loginAs, check, db, BASE, SEEDF, OUT } from './lib.mjs';
const { browser, errors, newPage } = await start();
const a = await newPage();
await resetAndLogin(a, 'admin@demo.sg');
const body = () => a.locator('body').innerText();
await a.goto(BASE + '#/staff/admin'); await a.waitForSelector('.tpl-tabs');
await a.click('[data-action=adminTab][data-tab=messaging]'); await a.waitForSelector('#msgTemplateForm');
// template edit
await a.selectOption('[data-msgtpl-select]', 'DOC_REJECTED'); await a.waitForSelector('#msgTemplateForm[data-key=DOC_REJECTED]');
await a.fill('#msgTemplateForm textarea', 'EDITED Hi {{firstName}}, {{documentName}} not accepted: {{reason}}. Next: {{nextStep}} {{link}}');
await a.click('#msgTemplateForm button[type=submit]'); await a.waitForTimeout(300);
let d = await db(a);
check('template edit saved and audited', /EDITED/.test(d.messageTemplates.find((t) => t.key === 'DOC_REJECTED').body) && d.audit.some((x) => x.action === 'TEMPLATE_EDITED'));
await a.fill('#msgTemplateForm textarea', 'Hi {{firstName}} {{bogus}}');
await a.click('#msgTemplateForm button[type=submit]'); await a.waitForTimeout(300);
check('unknown merge field rejected', /\{\{bogus\}\}/.test(await body()) && !/bogus/.test((await db(a)).messageTemplates.find((t) => t.key === 'DOC_REJECTED').body));
// rule change
await a.selectOption('#reminderRuleForm [name=day]', '1'); await a.selectOption('#reminderRuleForm [name=hour]', '9');
await a.click('#reminderRuleForm button[type=submit]'); await a.waitForTimeout(300);
d = await db(a);
check('global rule saved (Monday 09:00)', d.config.reminder.day === 1 && d.config.reminder.hour === 9);
await a.goto(BASE + '#/staff'); await a.waitForSelector('table.data');
check('button label follows the rule', /Run Monday reminders/.test(await body()));
// back to Sunday 10:00
await a.goto(BASE + '#/staff/admin'); await a.click('[data-action=adminTab][data-tab=messaging]');
await a.selectOption('#reminderRuleForm [name=day]', '0'); await a.selectOption('#reminderRuleForm [name=hour]', '10');
await a.click('#reminderRuleForm button[type=submit]'); await a.waitForTimeout(300);
// scheduler simulation: pause one case, custom one case
await a.goto(BASE + '#/staff/case/PIC-2026-0142'); await a.waitForSelector('#caseReminderForm');
await a.check('[data-case-pause]'); await a.waitForTimeout(300);
await a.goto(BASE + '#/staff/case/PIC-2026-0118'); await a.waitForSelector('#caseReminderForm');
await a.check('#caseReminderForm [name=custom]'); await a.selectOption('#caseReminderForm [name=day]', '3'); await a.click('#caseReminderForm button[type=submit]'); await a.waitForTimeout(300);
d = await db(a);
check('case pause and custom rule saved', d.cases.find((c) => c.id === 'PIC-2026-0142').remindersPaused === true && d.cases.find((c) => c.id === 'PIC-2026-0118').reminderRule.day === 3);
await a.goto(BASE + '#/staff/admin'); await a.click('[data-action=adminTab][data-tab=messaging]');
await a.click('[data-action=simulateSchedule]'); await a.waitForTimeout(600);
d = await db(a);
const weekly = d.outbox.filter((m) => m.trigger === 'WEEKLY');
const ids = new Set(weekly.map((m) => m.caseId));
check('scheduler skips paused and custom-day cases', !ids.has('PIC-2026-0142') && !ids.has('PIC-2026-0118') && ids.has('PIC-2026-0126') && ids.has('PIC-2026-0097'), [...ids].join(','));
const n1 = weekly.length;
await a.click('[data-action=simulateSchedule]'); await a.waitForTimeout(600);
d = await db(a);
check('second run same day sends nothing (interval not reached)', d.outbox.filter((m) => m.trigger === 'WEEKLY').length === n1);
// manual run honours pause
await a.goto(BASE + '#/staff'); await a.click('[data-action=runWeekly]'); await a.waitForTimeout(600);
d = await db(a);
check('manual run also skips paused case', !d.outbox.some((m) => m.trigger === 'WEEKLY' && m.caseId === 'PIC-2026-0142'));
// channel pref EMAIL -> rejection by email only
await a.goto(BASE + '#/staff/case/PIC-2026-0126'); await a.waitForSelector('[data-channel-pref]');
await a.selectOption('[data-channel-pref]', 'EMAIL'); await a.waitForTimeout(300);
await loginAs(a, 'consultant2@demo.sg');
await a.goto(BASE + '#/staff/case/PIC-2026-0126'); await a.waitForSelector('.item-card');
// need a document to reject: Rizal CPF is rejected already; use passport accepted -> not rejectable. Use Weiling? Use direct API instead.
const r = await a.evaluate(async () => { const { api } = await import('/js/api/index.js'); try { await api.reviewItem('PIC-2026-0126_PASSPORT', 'REJECTED', 'x', 'CROPPED'); return 'ok'; } catch (e) { return e.message; } });
d = await db(a);
const em = d.emails.find((m) => m.trigger === 'DOC_REJECTED' && m.caseId === 'PIC-2026-0126');
check('EMAIL preference sends by email only', r === 'ok' && !!em && !d.outbox.some((m) => m.trigger === 'DOC_REJECTED' && m.caseId === 'PIC-2026-0126'), r);
check('edited template used in the message', !!em && /EDITED/.test(em.body));
// message log on case
await a.reload(); await a.waitForSelector('.item-card');
const logTxt = await a.locator('.card:has(h2:text("Message log"))').innerText();
console.log('LOG:', logTxt.replace(/\n/g,' | ').slice(0,300));
check('message log shows email rejection', /Email/.test(logTxt) && /Document rejected/.test(logTxt));
// BOTH
await a.selectOption('[data-channel-pref]', 'BOTH'); await a.waitForTimeout(300);
await a.evaluate(async () => { const { api } = await import('/js/api/index.js'); await api.reviewItem('PIC-2026-0126_BIRTH_CERT', 'REJECTED', 'x', 'BLURRY'); });
d = await db(a);
check('BOTH sends WhatsApp and email', d.outbox.some((m) => m.trigger === 'DOC_REJECTED' && /birth/i.test(m.body)) && d.emails.some((m) => m.trigger === 'DOC_REJECTED' && /birth/i.test(m.body)));
// digests
await loginAs(a, 'admin@demo.sg');
await a.goto(BASE + '#/staff/admin'); await a.click('[data-action=adminTab][data-tab=messaging]'); await a.click('[data-action=sendDigests]'); await a.waitForTimeout(600);
d = await db(a);
const digs = d.emails.filter((m) => m.trigger === 'STAFF_DIGEST');
check('digests sent to staff with something to act on', digs.length >= 2 && digs.some((m) => m.to === 'specialist@demo.sg') && digs.some((m) => m.to === 'consultant1@demo.sg'), digs.map((m) => m.to).join(','));
const sdig = digs.find((m) => m.to === 'consultant2@demo.sg');
check('consultant digest only mentions own cases', sdig && !/Elizabeth/.test(sdig.body), sdig && sdig.body.slice(0, 120).replace(/\n/g, ' | '));
check('digest has review, overdue and follow-up sections', /New uploads to review/.test(digs.find((m) => m.to === 'specialist@demo.sg').body) && digs.some((m) => /Overdue cases/.test(m.body)) && digs.some((m) => /Follow-ups due/.test(m.body)));
// immediate alert on re-upload of rejected item
const cl = await newPage(); await resetAndLogin(cl, 'elizabeth@demo.sg');
await cl.waitForSelector('.hero');
await cl.click('#todo [data-action=openUpload][data-item$="_EMPLOYER_LETTER"]');
await cl.setInputFiles('.modal input[data-upload-input] >> nth=0', SEEDF + 'employer_letter_signed_elizabeth_tan.pdf');
await cl.waitForSelector('.modal .result-icon', { timeout: 8000 });
d = await db(a);
const alerts = d.emails.filter((m) => m.trigger === 'STAFF_ALERT' && m.caseId === 'PIC-2026-0142');
check('re-upload alerts consultant and specialist immediately', alerts.map((m) => m.to).sort().join() === 'consultant1@demo.sg,specialist@demo.sg', alerts.map((m) => m.to).join());
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
