// pack: builds the submission pack in the browser (production: a server job).
// ZIP of consistently named PDFs ({CaseNo}_{Person}_{SortOrder}_{DocCode}.pdf) plus one merged PDF with an index page.
// pdf-lib and JSZip are vendored under vendor/ and load as globals.
import { DOC_TYPES } from './domain.js';
import { fmtDate } from './utils.js';
import { storage } from './storage.js';

const lib = () => window.PDFLib;
const A4 = [595.28, 841.89];

/** The standard PDF fonts only cover Latin-1, so anything else becomes "*". */
const safe = (t) => String(t == null ? '' : t).replace(/[^\x20-\x7e\xa0-\xff]/g, '*');

async function specimenPdf(entry, caseRec) {
  const { PDFDocument, StandardFonts, rgb } = lib();
  const pdf = await PDFDocument.create();
  const page = pdf.addPage(A4);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const t = DOC_TYPES[entry.doc.aiDetectedType] || DOC_TYPES.other;
  page.drawRectangle({ x: 30, y: 30, width: A4[0] - 60, height: A4[1] - 60, borderColor: rgb(0.79, 0.73, 0.56), borderWidth: 2 });
  page.drawText(safe(t.label.toUpperCase()), { x: 56, y: A4[1] - 90, size: 20, font: bold, color: rgb(0.1, 0.16, 0.29) });
  page.drawText(safe(`${entry.item.label} - ${entry.item.personLabel}`), { x: 56, y: A4[1] - 114, size: 11, font, color: rgb(0.4, 0.4, 0.4) });
  page.drawText(safe(`Case ${caseRec.id}  |  ${entry.doc.fileName}`), { x: 56, y: A4[1] - 130, size: 9, font, color: rgb(0.5, 0.5, 0.5) });
  let y = A4[1] - 180;
  for (const [k, v] of Object.entries(entry.doc.aiExtracted || {})) {
    page.drawText(safe(k.toUpperCase()), { x: 56, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    page.drawText(safe(v == null ? '(unreadable)' : v), { x: 230, y, size: 11, font: bold, color: rgb(0.1, 0.1, 0.1) });
    y -= 26;
  }
  page.drawText('SPECIMEN', { x: 110, y: A4[1] / 2 - 60, size: 90, font: bold, color: rgb(0.84, 0.23, 0.18), opacity: 0.12, rotate: lib().degrees(30) });
  return pdf.save();
}

async function imagePdf(bytes, mime) {
  const { PDFDocument } = lib();
  const pdf = await PDFDocument.create();
  const img = mime === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
  const page = pdf.addPage(A4);
  const scale = Math.min((A4[0] - 60) / img.width, (A4[1] - 60) / img.height, 1);
  const w = img.width * scale; const h = img.height * scale;
  page.drawImage(img, { x: (A4[0] - w) / 2, y: (A4[1] - h) / 2, width: w, height: h });
  return pdf.save();
}

/** One PDF per accepted document: uploaded PDFs pass through, images get a page, specimens are drawn. */
async function entryPdf(entry, caseRec) {
  const raw = entry.doc.source === 'seed' ? null : await storage.bytes(entry.doc.blobId || entry.doc.id);
  try {
    if (raw && entry.doc.mimeType === 'application/pdf') { await lib().PDFDocument.load(raw); return new Uint8Array(raw); }
    if (raw && /^image\/(png|jpeg)$/.test(entry.doc.mimeType)) return await imagePdf(raw, entry.doc.mimeType);
  } catch (e) { /* unreadable file: fall back to a specimen page so the pack still builds */ }
  return specimenPdf(entry, caseRec);
}

async function indexPages(merged, caseRec, clientName, rows) {
  const { StandardFonts, rgb } = lib();
  const font = await merged.embedFont(StandardFonts.Helvetica);
  const bold = await merged.embedFont(StandardFonts.HelveticaBold);
  const perPage = 28;
  const pages = [];
  for (let start = 0; start < Math.max(rows.length, 1); start += perPage) {
    const page = merged.addPage(A4);
    pages.push(page);
    page.drawRectangle({ x: 0, y: A4[1] - 110, width: A4[0], height: 110, color: rgb(0.106, 0.165, 0.29) });
    page.drawText('PLATINUM IMMIGRATION', { x: 40, y: A4[1] - 50, size: 18, font: bold, color: rgb(1, 1, 1) });
    page.drawText('Submission pack', { x: 40, y: A4[1] - 74, size: 12, font, color: rgb(0.9, 0.85, 0.7) });
    page.drawText(safe(`Case ${caseRec.id}  |  ${clientName}`), { x: 40, y: A4[1] - 140, size: 12, font: bold });
    page.drawText(safe(`Generated ${fmtDate(new Date().toISOString())}  |  ${rows.length} documents`), { x: 40, y: A4[1] - 158, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    let y = A4[1] - 195;
    page.drawText('No.', { x: 40, y, size: 9, font: bold }); page.drawText('Document', { x: 80, y, size: 9, font: bold });
    page.drawText('Person', { x: 380, y, size: 9, font: bold }); page.drawText('Page', { x: 520, y, size: 9, font: bold });
    y -= 6; page.drawLine({ start: { x: 40, y }, end: { x: A4[0] - 40, y }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) });
    y -= 16;
    rows.slice(start, start + perPage).forEach((r, i) => {
      page.drawText(String(start + i + 1), { x: 40, y, size: 10, font });
      page.drawText(safe(r.label).slice(0, 60), { x: 80, y, size: 10, font });
      page.drawText(safe(r.person).slice(0, 24), { x: 380, y, size: 10, font });
      page.drawText(String(r.startPage), { x: 520, y, size: 10, font });
      y -= 22;
    });
  }
  return pages.length;
}

/**
 * entries: from api.preparePack. Returns { zip: Blob, pdf: Blob, zipName, pdfName, files, pages }.
 */
export async function buildPack(caseRec, clientName, entries) {
  const { PDFDocument } = lib();
  const built = [];
  for (const e of entries) built.push({ e, bytes: await entryPdf(e, caseRec) });

  // Page counts decide the index page numbers.
  const counts = [];
  for (const b of built) counts.push((await PDFDocument.load(b.bytes)).getPageCount());
  const indexCount = Math.max(1, Math.ceil(entries.length / 28));
  let cursor = indexCount + 1;
  const rows = entries.map((e, i) => { const r = { label: e.item.label, person: e.item.personLabel, startPage: cursor }; cursor += counts[i]; return r; });

  const merged = await PDFDocument.create();
  await indexPages(merged, caseRec, clientName, rows);
  for (const b of built) {
    const src = await PDFDocument.load(b.bytes);
    (await merged.copyPages(src, src.getPageIndices())).forEach((p) => merged.addPage(p));
  }
  merged.setTitle(`Submission pack ${caseRec.id}`);
  const pdfBytes = await merged.save();

  const zip = new window.JSZip();
  built.forEach((b) => zip.file(b.e.fileName, b.bytes));
  const zipBlob = await zip.generateAsync({ type: 'blob' });
  return {
    zip: zipBlob, pdf: new Blob([pdfBytes], { type: 'application/pdf' }),
    zipName: `${caseRec.id}_submission_pack.zip`, pdfName: `${caseRec.id}_submission_pack.pdf`,
    files: entries.map((e) => e.fileName), pages: cursor - 1,
  };
}
