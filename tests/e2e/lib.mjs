import { chromium } from 'playwright-core';
import os from 'node:os'; import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url';
export const BASE = process.env.PORTAL_URL || 'http://localhost:8123/index.html';
export const OUT = path.join(os.tmpdir(), 'platinum-e2e-out');
fs.mkdirSync(OUT, { recursive: true });
export const SEEDF = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../seed-files') + '/';
export async function start() {
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  const newPage = async (vp) => {
    const p = await ctx.newPage();
    if (vp) await p.setViewportSize(vp);
    p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push('console: ' + m.text()); });
    return p;
  };
  return { browser, ctx, errors, newPage };
}
export async function resetAndLogin(page, email) {
  await page.goto(BASE + '#/login');
  await page.waitForSelector('#loginForm');
  await page.evaluate(() => { sessionStorage.clear(); });
  await page.fill('#loginForm [name=email]', email);
  await page.fill('#loginForm [name=password]', 'demo1234');
  await page.click('#loginForm button[type=submit]');
  await page.waitForTimeout(250);
}
export async function loginAs(page, email) {
  await page.evaluate(() => { sessionStorage.clear(); location.hash = '#/login'; });
  await page.waitForSelector('#loginForm');
  await page.fill('#loginForm [name=email]', email);
  await page.fill('#loginForm [name=password]', 'demo1234');
  await page.click('#loginForm button[type=submit]');
  await page.waitForTimeout(250);
}
export const check = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  [' + extra + ']' : ''}`); if (!cond) process.exitCode = 1; };
export const db = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('pi_portal_db_v2')));
