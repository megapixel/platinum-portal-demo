import { start, resetAndLogin, loginAs, check, db, BASE, OUT } from './lib.mjs';
const { browser, errors, newPage } = await start();
const a = await newPage();
await resetAndLogin(a, 'admin@demo.sg');
const body = () => a.locator('body').innerText();
const api = (fn, ...args) => a.evaluate(async ([fn, args]) => { const { api } = await import('/js/api/index.js'); try { return { ok: await api[fn](...args) }; } catch (e) { return { err: e.message, unpaid: e.unpaidBalance }; } }, [fn, args]);

// ---- outcome approved (demo step 7): Kittisak is SUBMITTED
await a.goto(BASE + '#/staff/case/PIC-2026-0044'); await a.waitForSelector('#outcomeForm');
let r = await api('recordOutcome', 'PIC-2026-0142', { result: 'APPROVED', decisionDate: '2026-10-01' });
check('outcome only from Submitted', /Submitted before recording/.test(r.err || ''), r.err);
await a.fill('#outcomeForm [name=reference]', 'PR-2026-77821'); await a.fill('#outcomeForm [name=nextSteps]', 'Collect your PR card from the ICA.');
await a.click('#outcomeForm button[type=submit]'); await a.waitForTimeout(700);
let d = await db(a);
const k = d.cases.find((c) => c.id === 'PIC-2026-0044');
check('approved outcome recorded and stage moved to Outcome', k.stage === 'OUTCOME' && k.outcome.result === 'APPROVED' && k.outcome.reference === 'PR-2026-77821');
const msg = d.outbox.find((m) => m.trigger === 'OUTCOME_APPROVED' && m.caseId === k.id);
check('client sent the approved message with reference and next steps', msg && /approved/i.test(msg.body) && /PR-2026-77821/.test(msg.body) && /Collect your PR card/.test(msg.body));
check('no generic stage message for the outcome move', !d.outbox.some((m) => m.trigger === 'STAGE_CHANGED' && m.caseId === k.id && /Outcome/.test(m.body)));
check('staff alerted of outcome received', d.emails.some((m) => m.trigger === 'STAFF_ALERT' && m.caseId === k.id && /Outcome received/.test(m.subject)));
const tl = d.audit.find((x) => x.action === 'OUTCOME_RECORDED' && x.caseId === k.id);
check('audit has before/after for the stage move and outcome', d.audit.some((x) => x.action === 'STAGE_CHANGED' && x.caseId === k.id && x.before.stage === 'SUBMITTED' && x.after.stage === 'OUTCOME') && tl && tl.after.result === 'APPROVED');
// client sees it
const cl = await newPage(); await resetAndLogin(cl, 'kittisak@demo.sg'); await cl.waitForSelector('.hero');
check('client sees the approved outcome card', /Your application was approved/.test(await cl.locator('body').innerText()) && /PR-2026-77821/.test(await cl.locator('body').innerText()));
// no approved re-apply
r = await api('reapply', 'PIC-2026-0044');
check('cannot re-apply an approved case', /rejected outcome/.test(r.err || ''));
// correction
r = await api('recordOutcome', 'PIC-2026-0044', { result: 'APPROVED', decisionDate: '2026-10-02', reference: 'PR-2026-77822' });
d = await db(a);
check('correction updates record, audits, does not re-notify', d.cases.find((c) => c.id === 'PIC-2026-0044').outcome.reference === 'PR-2026-77822' && d.audit.some((x) => x.action === 'OUTCOME_CORRECTED') && d.outbox.filter((m) => m.trigger === 'OUTCOME_APPROVED' && m.caseId === 'PIC-2026-0044').length === 1);
r = await api('setStage', 'PIC-2026-0109', 'OUTCOME');
check('cannot jump to Outcome without recording one', /Record the outcome/.test(r.err || ''));

// ---- rejection + same-case re-application (Priya: paid, DOCUMENTS_COMPLETE)
await api('setStage', 'PIC-2026-0109', 'SUBMITTED');
r = await api('recordOutcome', 'PIC-2026-0109', { result: 'REJECTED', decisionDate: '2026-10-05' });
check('rejection needs a reason', /reason/.test(r.err || ''), r.err);
r = await api('recordOutcome', 'PIC-2026-0109', { result: 'REJECTED', decisionDate: '2099-01-01', reason: 'x' });
check('future decision date rejected', /future/.test(r.err || ''));
r = await api('recordOutcome', 'PIC-2026-0109', { result: 'REJECTED', decisionDate: '2026-10-05', reason: 'Insufficient income history', nextSteps: 'Re-apply after 6 more payslips.' });
d = await db(a);
check('rejected message includes reason and next steps', d.outbox.some((m) => m.trigger === 'OUTCOME_REJECTED' && /Insufficient income history/.test(m.body) && /Re-apply after 6 more payslips/.test(m.body)));
// age the payslips (6-month window) and expire the passport so they must be renewed
await a.evaluate(async () => { const x = JSON.parse(localStorage.getItem('pi_portal_db_v2'));
  x.documents.filter((dd) => dd.itemId === 'PIC-2026-0109_PAYSLIPS').forEach((dd) => { dd.uploadedAt = new Date(Date.now() - 200 * 86400000).toISOString(); });
  x.documents.filter((dd) => dd.itemId === 'PIC-2026-0109_PASSPORT').forEach((dd) => { dd.aiExtracted['expiry date'] = '1 Jan 2025'; });
  localStorage.setItem('pi_portal_db_v2', JSON.stringify(x)); (await import('/js/store.js')).store.reload(); });
const itemsBefore = (await db(a)).items.filter((i) => i.caseId === 'PIC-2026-0109').length;
await a.goto(BASE + '#/staff/case/PIC-2026-0109'); await a.waitForSelector('[data-action=reapply]');
a.once('dialog', (dlg) => dlg.accept());
await a.click('[data-action=reapply]'); await a.waitForTimeout(800);
d = await db(a);
const p = d.cases.find((c) => c.id === 'PIC-2026-0109');
const it = (code) => d.items.find((i) => i.id === `PIC-2026-0109_${code}`);
check('same case continues as attempt 2 at Collecting documents, outcome cleared', p.attempt === 2 && p.stage === 'COLLECTING_DOCUMENTS' && p.outcome === null);
check('attempt 1 archived with its rejection', p.attemptHistory.length === 1 && p.attemptHistory[0].attempt === 1 && p.attemptHistory[0].outcome.result === 'REJECTED');
check('unexpired accepted documents reused', it('BIRTH_CERT').status === 'ACCEPTED' && it('BIRTH_CERT').reusedFromAttempt === 1 && it('EDU_CERT').status === 'ACCEPTED');
check('expired passport and stale payslips go back to Pending with a note', it('PASSPORT').status === 'PENDING' && /Expired/.test(it('PASSPORT').attemptNote) && it('PAYSLIPS').status === 'PENDING' && /Older than 6 months/.test(it('PAYSLIPS').attemptNote));
check('documents and history kept (no data lost)', d.documents.filter((x) => x.caseId === 'PIC-2026-0109').length === itemsBefore && d.items.filter((i) => i.caseId === 'PIC-2026-0109').length === itemsBefore);
check('onboarding reopened for the client to confirm', p.onboarding.status === 'DRAFT');
const pc = await newPage(); await resetAndLogin(pc, 'priya@demo.sg'); await pc.waitForSelector('.hero');
check('client portal shows Attempt 2', /Attempt 2/.test(await pc.locator('.hero').innerText()));
await a.reload(); await a.waitForSelector('.item-card');
check('case page shows attempt badge, attempts card and reused chips', /Attempt 2/.test(await body()) && (await a.locator('.card:has(h2:text("Attempts"))').count()) === 1 && (await a.locator('.chip:has-text("reused from attempt 1")').count()) >= 3);

// ---- NEW_CASE rule
await api('updateConfig', { reapplicationRule: 'NEW_CASE' });
await api('setStage', 'PIC-2026-0081', 'SUBMITTED', { acknowledgeUnpaid: true });
await api('recordOutcome', 'PIC-2026-0081', { result: 'REJECTED', decisionDate: '2026-10-05', reason: 'Policy change' });
r = await api('reapply', 'PIC-2026-0081');
d = await db(a);
const nc = d.cases.find((c) => c.previousCaseId === 'PIC-2026-0081');
check('NEW_CASE opens a linked case with a new number and attempt 2', nc && /^PIC-\d{4}-\d{4}$/.test(nc.id) && nc.attempt === 2 && nc.stage === 'COLLECTING_DOCUMENTS');
check('old case stays at Outcome', d.cases.find((c) => c.id === 'PIC-2026-0081').stage === 'OUTCOME');
const nItems = d.items.filter((i) => i.caseId === nc.id);
check('new case has copied items, reused docs point at original files', nItems.length > 5 && nItems.some((i) => i.status === 'ACCEPTED') && d.documents.filter((x) => x.caseId === nc.id).every((x) => x.blobId));
await a.goto(BASE + `#/staff/case/${nc.id}`); await a.waitForSelector('.item-card');
check('new case shows link back to the previous case', (await a.locator('a[href$="PIC-2026-0081"]').count()) >= 1);
await api('updateConfig', { reapplicationRule: 'SAME_CASE_NEW_ATTEMPT' });

// ---- timeline filters
await a.goto(BASE + '#/staff/case/PIC-2026-0109'); await a.waitForSelector('.audit');
const total = await a.locator('.timeline li').count();
await a.selectOption('[data-audit-filter][data-field=cat]', 'STAGE'); await a.waitForTimeout(200);
const stageOnly = await a.locator('.timeline li').count();
check('category filter narrows the timeline', stageOnly > 0 && stageOnly < total, `${stageOnly}/${total}`);
check('stage entries show before and after values', /stage: submitted → outcome/i.test(await a.locator('.timeline').innerText()));
await a.selectOption('[data-audit-filter][data-field=cat]', ''); 
await a.fill('[data-audit-q]', 'reapplication'); await a.waitForTimeout(250);
check('search filters entries', (await a.locator('.timeline li').count()) === 1);
await a.fill('[data-audit-q]', '');
const dl = a.waitForEvent('download'); await a.click('[data-action=exportAuditCsv]'); const f = await dl;
check('timeline CSV export', /^audit-case-PIC-2026-0109/.test(f.suggestedFilename()));
await a.goto(BASE + '#/staff/lead/lead_001'); await a.waitForSelector('.audit');
check('lead has the same timeline', (await a.locator('.timeline li').count()) >= 1);
await a.goto(BASE + '#/staff/admin'); await a.click('[data-action=adminTab][data-tab=users]');
await a.selectOption('[data-user-role="u_sarah"]', 'OPS_MANAGER'); await a.waitForTimeout(200); await a.selectOption('[data-user-role="u_sarah"]', 'CONSULTANT'); await a.waitForTimeout(200);
await a.click('[data-action=adminTab][data-tab=audit]'); await a.waitForSelector('.audit');
await a.selectOption('[data-audit-filter][data-field=cat]', 'ACCESS'); await a.waitForTimeout(200);
check('Admin audit tab shows permission changes with before/after', /role: admin|role: consultant → ops manager|role: consultant → ops_manager|operations/i.test(await a.locator('.timeline').innerText()) && (await a.locator('.timeline li').count()) >= 2);
// consultant / specialist scope
await loginAs(a, 'consultant2@demo.sg');
r = await api('auditFor', { caseId: 'PIC-2026-0142' });
check('consultant cannot read another consultant case timeline', /another consultant/.test(r.err || ''), r.err);
r = await api('auditFor', {});
check('only config:manage can read the whole audit log', /permission/.test(r.err || ''));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
