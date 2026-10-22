// letters: merge fields, and DOCX / PDF output for staff letters. Browser-side for the prototype (production: a server job).
// Letters and letter templates are internal. They are never attached to the client checklist or included in a submission pack.
import { fmtDate, esc } from './utils.js';
import { CASE_TYPES } from './domain.js';
import { fillTemplate } from './messagetemplates.js';

/** Merge fields that come from the case and client profile. Onboarding form answers are added by key (employer, position, ...). */
export const CASE_FIELDS = [
  ['client_name', 'Client full name'], ['first_name', 'Client first name'], ['nationality', 'Nationality'], ['dob', 'Date of birth'],
  ['case_no', 'Case number'], ['case_type', 'Application type'], ['attempt', 'Attempt number'], ['today', "Today's date"], ['consultant_name', 'Assigned consultant'],
];

export const BLANK = '________';

/** Values for one case. `blank` leaves every field as a line to fill in by hand (client blank forms). */
export function letterVars({ caseRec, client, consultant, blank }) {
  const form = (caseRec.onboarding && caseRec.onboarding.data) || {};
  const base = {
    client_name: client.name, first_name: String(client.name).split(' ')[0], nationality: (client.profile && client.profile.nationality) || form.nationality || '',
    dob: form.dob ? fmtDate(form.dob) : (client.profile && client.profile.dob ? fmtDate(client.profile.dob) : ''),
    case_no: caseRec.id, case_type: CASE_TYPES[caseRec.caseType].label, attempt: caseRec.attempt || 1, today: fmtDate(new Date().toISOString()),
    consultant_name: consultant ? consultant.name : '',
  };
  const vars = { ...form, ...base };
  if (blank) Object.keys(vars).forEach((k) => { vars[k] = BLANK; });
  return vars;
}

/** All merge field names a template may use: case fields plus the keys of the onboarding form definitions. */
export function availableFields(formDefs) {
  const keys = new Set(CASE_FIELDS.map((f) => f[0]));
  const out = CASE_FIELDS.map((f) => ({ key: f[0], label: f[1] }));
  formDefs.forEach((d) => d.sections.forEach((s) => s.fields.forEach((f) => { if (!keys.has(f.key)) { keys.add(f.key); out.push({ key: f.key, label: f.label }); } })));
  return out;
}

export const renderLetter = (body, vars) => fillTemplate(body, vars);

// ---------- HTML to paragraphs ----------
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Very small HTML subset: p, br, div, headings, li, and bold. Returns [{ runs: [{ text, bold }] }]. */
export function htmlToParagraphs(html) {
  const src = String(html || '').replace(/\r/g, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li)>/gi, '\n\n');
  const paragraphs = [{ runs: [] }];
  let bold = false;
  for (const tok of src.split(/(<\/?(?:b|strong)>|<[^>]+>)/gi)) {
    if (!tok) continue;
    if (/^<(b|strong)>$/i.test(tok)) { bold = true; continue; }
    if (/^<\/(b|strong)>$/i.test(tok)) { bold = false; continue; }
    if (tok.startsWith('<')) continue;
    tok.split('\n').forEach((part, i) => {
      if (i > 0) paragraphs.push({ runs: [] });
      const text = decode(part);
      if (text) paragraphs[paragraphs.length - 1].runs.push({ text, bold });
    });
  }
  // Collapse runs of empty paragraphs to one blank line.
  const out = [];
  paragraphs.forEach((p) => { const empty = !p.runs.length; if (empty && out.length && !out[out.length - 1].runs.length) return; out.push(p); });
  while (out.length && !out[0].runs.length) out.shift();
  while (out.length && !out[out.length - 1].runs.length) out.pop();
  return out;
}

export const plainText = (html) => htmlToParagraphs(html).map((p) => p.runs.map((r) => r.text).join('')).join('\n');

// ---------- DOCX ----------
const x = (s) => esc(s).replace(/&#39;/g, "'");

export async function buildDocx(paragraphs) {
  const body = paragraphs.map((p) => p.runs.length
    ? `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr>${p.runs.map((r) => `<w:r>${r.bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${x(r.text)}</w:t></w:r>`).join('')}</w:p>`
    : '<w:p/>').join('');
  const zip = new window.JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1304" w:bottom="1440" w:left="1304" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// ---------- PDF ----------
const safe = (t) => String(t == null ? '' : t).replace(/[^\x20-\x7e\xa0-\xff]/g, '*');

export async function buildLetterPdf(paragraphs) {
  const { PDFDocument, StandardFonts, rgb } = window.PDFLib;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [W, H] = [595.28, 841.89]; const margin = 64; const size = 11; const lead = 16;
  let page = pdf.addPage([W, H]); let y = H - margin;
  const newPage = () => { page = pdf.addPage([W, H]); y = H - margin; };
  for (const p of paragraphs) {
    if (!p.runs.length) { y -= lead * 0.7; continue; }
    // Greedy word wrap across runs.
    const words = p.runs.flatMap((r) => safe(r.text).split(/(\s+)/).filter((w) => w !== '').map((w) => ({ w, b: r.bold })));
    let line = []; let lineW = 0;
    const flush = () => {
      if (y < margin) newPage();
      let cx = margin;
      line.forEach((t) => { page.drawText(t.w, { x: cx, y, size, font: t.b ? bold : font, color: rgb(0.1, 0.1, 0.1) }); cx += (t.b ? bold : font).widthOfTextAtSize(t.w, size); });
      y -= lead; line = []; lineW = 0;
    };
    for (const t of words) {
      const w = (t.b ? bold : font).widthOfTextAtSize(t.w, size);
      if (lineW + w > W - margin * 2 && line.length && !/^\s+$/.test(t.w)) flush();
      if (!(line.length === 0 && /^\s+$/.test(t.w))) { line.push(t); lineW += w; }
    }
    if (line.length) flush();
    y -= 4;
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}

export async function buildLetterFile(html, format) {
  const paras = htmlToParagraphs(html);
  return format === 'DOCX' ? { blob: await buildDocx(paras), ext: 'docx' } : { blob: await buildLetterPdf(paras), ext: 'pdf' };
}
