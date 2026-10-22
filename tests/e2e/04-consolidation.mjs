import { start, resetAndLogin, loginAs, check, db, BASE, SEEDF, OUT } from './lib.mjs';
import fs from 'node:fs'; import { execSync } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
const { browser, errors, newPage } = await start();
const p = await newPage();
await resetAndLogin(p, 'specialist@demo.sg');
await p.goto(BASE + '#/staff/review'); await p.waitForSelector('.queue-grid');
const nav = await p.locator('nav').innerText();
check('specialist nav has Review queue', /Review queue/.test(nav));
const items = await p.locator('.msg-list li').count();
check('queue lists awaiting items (Nurul payslips + flagged spouse passport)', items === 2, `items=${items}`);
const firstTxt = await p.locator('.msg-list li').first().innerText();
check('oldest first (spouse passport uploaded 2 days ago before payslips 1 day ago)', /Passport/.test(firstTxt), firstTxt.split('\n')[0]);
await p.click('[data-action=queueFilter][data-filter=AI_FLAGGED]');
check('AI-flagged filter', (await p.locator('.msg-list li').count()) === 1);
await p.click('[data-action=queueFilter][data-filter=ALL]');
// keyboard: down then A
await p.keyboard.press('j'); await p.waitForTimeout(150);
const sel = await p.locator('.msg-list li.active').innerText();
check('J moves selection', /payslips/i.test(sel), sel.split('\n')[0]);
await p.keyboard.press('a'); await p.waitForTimeout(400);
let d = await db(p);
check('A accepts the selected item', d.items.find((i) => i.id === 'PIC-2026-0118_PAYSLIPS').status === 'ACCEPTED');
check('only one left in queue', (await p.locator('.msg-list li').count()) === 1);
await p.keyboard.press('r'); await p.waitForSelector('#rejectForm');
await p.keyboard.press('1'); await p.keyboard.press('Control+Enter'); await p.waitForTimeout(500);
d = await db(p);
const sp = d.items.find((i) => i.id === 'PIC-2026-0118_SPOUSE_PASSPORT');
check('R then 1 then Ctrl+Enter rejects as blurry', sp.status === 'REJECTED' && sp.rejectReason === 'BLURRY');
check('queue now empty', /Queue is empty/.test(await p.locator('body').innerText()));

// Elizabeth not ready
await p.goto(BASE + '#/staff/case/PIC-2026-0142/pack'); await p.waitForSelector('.checks');
check('not-ready case: generate disabled', (await p.locator('[data-action=generatePack][disabled]').count()) === 1);
check('not-ready case: failing checks shown', (await p.locator('.checks li.bad').count()) >= 1);

// Priya ready; force stage back to Collecting to see the stage move
await p.evaluate(() => { const x = JSON.parse(localStorage.getItem('pi_portal_db_v2')); x.cases.find((c) => c.id === 'PIC-2026-0109').stage = 'COLLECTING_DOCUMENTS'; localStorage.setItem('pi_portal_db_v2', JSON.stringify(x)); });
await p.goto(BASE + '#/staff/case/PIC-2026-0109/pack'); await p.waitForSelector('.checks');
check('ready case: all checks pass', (await p.locator('.checks li.bad').count()) === 0);
const downloads = [];
p.on('download', (dl) => downloads.push(dl));
await p.click('[data-action=generatePack]');
await p.waitForFunction(() => /Pack generated/.test(document.getElementById('toast').innerText), null, { timeout: 20000 });
await p.waitForTimeout(900);
check('two downloads (zip + pdf)', downloads.length === 2, downloads.map((x) => x.suggestedFilename()).join(', '));
const dir = OUT;
fs.mkdirSync(dir, { recursive: true });
for (const dl of downloads) await dl.saveAs(`${dir}/${dl.suggestedFilename()}`);
const zipPath = `${dir}/PIC-2026-0109_submission_pack.zip`;
const names = execSync(`unzip -Z1 ${zipPath}`).toString().trim().split('\n');
check('zip has 8 consistently named PDFs', names.length === 8 && names.every((n) => /^PIC-2026-0109_MainApplicant_\d{2}_[A-Z_]+\.pdf$/.test(n)), names.slice(0, 3).join(' '));
const pdf = await PDFDocument.load(fs.readFileSync(`${dir}/PIC-2026-0109_submission_pack.pdf`));
check('merged PDF = index page + 8 document pages', pdf.getPageCount() === 9, `pages=${pdf.getPageCount()}`);
d = await db(p);
check('stage moved to Documents complete and pack recorded', d.cases.find((c) => c.id === 'PIC-2026-0109').stage === 'DOCUMENTS_COMPLETE' && d.cases.find((c) => c.id === 'PIC-2026-0109').packs.length === 1);
check('audit has PACK_GENERATED', d.audit.some((a) => a.action === 'PACK_GENERATED'));

// consultant cannot open the workspace
await loginAs(p, 'consultant1@demo.sg');
await p.goto(BASE + '#/staff/case/PIC-2026-0109/pack'); await p.waitForTimeout(300);
check('consultant denied consolidation workspace', /Access denied/.test(await p.locator('body').innerText()));
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
