// utils: pure helpers.
import { DAY } from './domain.js';

export const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
let idCounter = 0;
export const uid = (p) => `${p}_${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const nowIso = () => new Date().toISOString();
export const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();
export const daysFromNow = (n) => new Date(Date.now() + n * DAY).toISOString();
export const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addMonths = (iso, n) => { const d = new Date(iso); d.setMonth(d.getMonth() + n); return d.toISOString(); };
export const isoDate = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
export const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
export const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
export const fmtMoney = (n) => `SGD ${Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const firstName = (name) => String(name).split(' ')[0];
export function relTime(iso) {
  if (!iso) return '-';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
export function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function safeGet(storageObj, key) { try { return storageObj.getItem(key); } catch (e) { return null; } }
export function safeSet(storageObj, key, val) { try { storageObj.setItem(key, val); return true; } catch (e) { return false; } }
export function safeRemove(storageObj, key) { try { storageObj.removeItem(key); } catch (e) { /* ignore */ } }

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Deterministic pseudo random so the seed looks the same on every reset. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function groupBy(arr, keyFn) {
  const m = new Map();
  arr.forEach((x) => { const k = keyFn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); });
  return m;
}

/** Name comparison for cross-checks: case, punctuation and word order are ignored. */
export function sameName(a, b) {
  const tok = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  return tok(a) === tok(b);
}

export function csvEscape(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(headers, rows) {
  return [headers.map(csvEscape).join(',')].concat(rows.map((r) => r.map(csvEscape).join(','))).join('\n');
}
