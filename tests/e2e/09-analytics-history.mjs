import { start, resetAndLogin, loginAs, check, db, BASE, OUT } from './lib.mjs';
import fs from 'node:fs';
const { browser, errors, newPage } = await start();
const a = await newPage(); await resetAndLogin(a, 'ops@demo.sg');
const d = await db(a);
// ---- seed shape
const hist = d.cases.filter((c) => c.historical);
check('about 60 historical closed cases, all with outcomes', hist.length === 60 && hist.every((c) => c.stage === 'OUTCOME' && c.outcome));
const months = new Set(hist.map((c) => c.outcome.decisionDate.slice(0, 7)));
check('decisions span 12 months', months.size >= 12, `${months.size} months`);
check('several nationalities and mixed outcomes', new Set(hist.map((c) => d.clients.find((x) => x.id === c.clientId).profile.nationality)).size >= 8 && hist.some((c) => c.outcome.result === 'REJECTED') && hist.some((c) => c.attempt > 1));
check('each historical case has a won source lead and an invoice with payments', hist.every((c) => d.leads.some((l) => l.id === c.sourceLeadId && l.stage === 'WON') && d.invoices.some((i) => i.caseId === c.id)) && d.invoices.filter((i) => i.payments.length).length >= 55);
check('about 25 open leads remain across the pipeline stages', d.leads.filter((l) => !l.archived && !['WON', 'LOST'].includes(l.stage)).length === 21 && d.leads.filter((l) => l.introducerId && d.introducers.find((i) => i.id === l.introducerId).tier === 'PREMIUM').length >= 3);
check('no future-dated payments or decisions', d.invoices.flatMap((i) => i.payments).every((p) => new Date(p.date) <= new Date()) && hist.every((c) => new Date(c.outcome.decisionDate) <= new Date()));
const kb = (await a.evaluate(() => localStorage.getItem('pi_portal_db_v2').length)) / 1024;
check('database fits comfortably in localStorage', kb < 1500, `${Math.round(kb)} KB`);
// ---- login screen hides archive users
await a.evaluate(() => { sessionStorage.clear(); location.hash = '#/login'; }); await a.waitForSelector('#loginForm');
check('login screen does not list archived clients', !/archive\.example/.test(await a.locator('body').innerHTML()));
// ---- dashboard hides closed by default
await loginAs(a, 'ops@demo.sg'); await a.goto(BASE + '#/staff'); await a.waitForSelector('table.data');
const open = await a.locator('table.data tbody tr').count();
await a.check('[data-filter-closed]'); await a.waitForTimeout(250);
const all = await a.locator('table.data tbody tr').count();
check('dashboard shows active cases by default and all 68 with "Show closed"', open === 8 && all === 68, `${open}/${all}`);
await a.uncheck('[data-filter-closed]');
// ---- pipeline hides archived history
await a.goto(BASE + '#/staff/leads'); await a.waitForSelector('.kanban');
const cardsDefault = await a.locator('.lead-card').count();
await a.check('[data-lead-archived]'); await a.waitForTimeout(250);
check('pipeline hides archived history by default', cardsDefault === 27 && (await a.locator('.lead-card').count()) > 100, `${cardsDefault} then ${await a.locator('.lead-card').count()}`);
// ---- analytics numbers
await a.goto(BASE + '#/staff/analytics'); await a.waitForSelector('.bar-row');
const an = await a.locator('body').innerText();
const apprOverall = Math.round((hist.filter((c) => c.outcome.result === 'APPROVED').length / hist.length) * 1000) / 10;
check('approval rate tile matches the data', new RegExp(`${apprOverall}%`).test(an), String(apprOverall));
const sources = await a.locator('.card:has(h2:text("Leads by source")) tbody tr').count();
check('lead source table covers every source', sources === 7);
const totalLeads = (await db(a)).leads.length;
const tableLeads = await a.evaluate(() => [...document.querySelectorAll('.card:has(h2) table')].filter((t) => /^SOURCE/i.test(t.innerText.trim()))[0] ? [...[...document.querySelectorAll('table')].find((t) => /^SOURCE/i.test(t.innerText.trim())).querySelectorAll('tbody tr')].reduce((s, tr) => s + Number(tr.children[1].innerText), 0) : -1);
check('lead counts across sources add up to every lead with a source', tableLeads === (await db(a)).leads.filter((l) => l.sourceId).length, `${tableLeads} of ${totalLeads}`);
check('avg days tiles computed from stage history', /\d+ days/.test(an) && !/NaN/.test(an));
check('revenue chart has 12 months', (await a.locator('.cols .col').count()) === 12);
const clipped = await a.evaluate(() => [...document.querySelectorAll('.table-wrap')].filter((w) => w.scrollWidth > w.clientWidth + 1).length);
check('no analytics table is clipped', clipped === 0, String(clipped));
// ---- CSV on every table
const tables = await a.locator('.table-wrap').count(); const bars = await a.locator('.csv-bar').count();
check('every table has a CSV button', tables > 0 && tables === bars, `${bars}/${tables}`);
const dl = a.waitForEvent('download'); await a.click('.card:has(h2:text("Approval rate by nationality")) .csv-bar button'); const f = await dl;
await f.saveAs(`${OUT}/nat.csv`); const csv = fs.readFileSync(`${OUT}/nat.csv`, 'utf8').split('\n');
check('table CSV has the header and one row per nationality', /^Nationality,Decided,Approved,Rate/.test(csv[0]) && csv.length >= 10, csv[0]);
for (const route of ['#/staff', '#/staff/invoices', '#/staff/admin', '#/staff/letters']) {
  await a.goto(BASE + route); await a.waitForTimeout(350);
  const t = await a.locator('.table-wrap').count(); const b = await a.locator('.csv-bar').count();
  check(`CSV buttons on ${route}`, t === b && t > 0, `${b}/${t}`);
}
// ---- consultant sees no analytics; closed cases scoped
await loginAs(a, 'consultant1@demo.sg'); await a.goto(BASE + '#/staff/analytics'); await a.waitForTimeout(300);
check('consultant denied analytics', /Access denied/.test(await a.locator('body').innerText()));
check('consultant nav has no Analytics link', (await a.locator('nav a:has-text("Analytics")').count()) === 0);
// ---- historical case page renders
await loginAs(a, 'admin@demo.sg'); await a.goto(BASE + `#/staff/case/${hist[0].id}`); await a.waitForSelector('.audit');
check('archived case page renders with outcome and timeline', /Outcome/.test(await a.locator('body').innerText()) && (await a.locator('.timeline li').count()) >= 2);
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
