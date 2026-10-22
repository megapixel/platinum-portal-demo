// views/letters: letter template manager, the letter editor on a case, the case letters card, client blank forms.
import { store } from '../store.js';
import { esc, fmtDateTime } from '../utils.js';
import { can } from '../auth/permissions.js';
import { auth } from '../auth/session.js';
import { api } from '../api/index.js';
import { plainText } from '../letters.js';
import { ui } from './common.js';

const KINDS = [['RECOMMENDATION', 'Recommendation letter'], ['COVER', 'Cover letter'], ['OTHER', 'Other']];

// ---------- template manager (letter:template) ----------
export function viewLetterTemplates() {
  const tpls = api.listLetterTemplates();
  const t = tpls.find((x) => x.id === ui.letterTplId) || tpls[0] || null;
  const fields = api.letterFieldList();
  const log = api.letterDownloadLog().slice(0, 30);
  return `<main class="page wide stack">
    <div><h1 style="font-size:22px">Letter templates</h1>
      <p class="muted small">Internal only. Clients never see these, unless you switch on "client may download a blank copy" for a specific template.</p></div>
    <div class="queue-grid">
      <section class="card">
        <ul class="msg-list">${tpls.map((x) => `<li class="${t && x.id === t.id ? 'active' : ''}" data-action="selectLetterTpl" data-id="${esc(x.id)}">
          <div class="row between"><b>${esc(x.name)}</b>${x.clientMayDownloadBlank ? '<span class="chip amber plain">client blank</span>' : '<span class="chip grey plain">internal</span>'}</div>
          <div class="tiny muted">${esc((KINDS.find((k) => k[0] === x.kind) || [0, x.kind])[1])}</div></li>`).join('')}</ul>
        <button class="btn sm" style="margin-top:10px" data-action="newLetterTpl">+ New template</button>
      </section>
      <section class="card stack">${t || ui.letterTplId === 'NEW' ? templateForm(ui.letterTplId === 'NEW' ? null : t, fields) : '<p class="muted">No templates yet.</p>'}</section>
    </div>
    <section class="card"><h2>Download log</h2>
      <div class="table-wrap"><table class="data"><thead><tr><th>When</th><th>Who</th><th>What</th><th>Case</th></tr></thead><tbody>
        ${log.map((a) => `<tr><td class="small">${fmtDateTime(a.at)}</td><td class="small">${esc((store.user(a.actorId) || {}).name || '-')}</td><td class="small">${esc(a.detail)}</td><td class="small">${esc(a.caseId || '')}</td></tr>`).join('') || '<tr><td colspan="4" class="muted" style="text-align:center;padding:12px">No downloads yet.</td></tr>'}
      </tbody></table></div></section>
  </main>`;
}

function templateForm(t, fields) {
  return `<form id="letterTemplateForm" data-id="${esc(t ? t.id : '')}" class="stack">
    <h2 style="margin:0">${t ? 'Edit template' : 'New template'}</h2>
    <div class="tpl-grid" style="grid-template-columns:2fr 1fr">
      <label class="field"><span>Name</span><input class="input" name="name" required value="${esc(t ? t.name : '')}"></label>
      <label class="field"><span>Type</span><select class="input" name="kind">${KINDS.map(([v, l]) => `<option value="${v}" ${t && t.kind === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <label class="field"><span>Letter text (HTML: p, br, b)</span><textarea class="input tall mono" name="body" required>${esc(t ? t.body : '')}</textarea></label>
    <label class="btn sm" style="align-self:flex-start">Load from a .html or .txt file<input class="hidden-input" type="file" accept=".html,.htm,.txt,text/html,text/plain" data-letter-file></label>
    <div><span class="tiny muted" style="font-weight:600">Merge fields from the client profile and onboarding form</span>
      <div class="fields-chips">${fields.map((f) => `<span class="field-chip mono" title="${esc(f.label)}">{{${esc(f.key)}}}</span>`).join('')}</div></div>
    <label class="row small"><input type="checkbox" name="clientMayDownloadBlank" ${t && t.clientMayDownloadBlank ? 'checked' : ''}> Client may download a blank copy (off by default; every download is logged)</label>
    ${ui.letterTplError ? `<p class="note red small">${esc(ui.letterTplError)}</p>` : ''}
    <div class="row"><button class="btn primary" type="submit">Save template</button>${t ? `<button class="btn danger" type="button" data-action="deleteLetterTpl" data-id="${esc(t.id)}">Delete</button>` : ''}</div>
  </form>`;
}

// ---------- letter editor on a case ----------
export function viewLetterEditor(caseId, query) {
  const c = api.getCase(caseId);
  const client = store.caseClient(c);
  let name; let body; let templateId = query.tpl || null; let letterId = query.letter || '';
  if (letterId) {
    const l = api.getLetter(letterId);
    name = l.name; body = l.body; templateId = l.templateId;
  } else {
    const p = api.previewLetter(caseId, templateId || api.listLetterTemplates()[0].id);
    name = `${p.template.name} - ${client.name}`; body = p.html; templateId = p.template.id;
  }
  const tpls = api.listLetterTemplates();
  return `<main class="page stack">
    <a href="#/staff/case/${encodeURIComponent(c.id)}" class="small">&larr; Back to case</a>
    <div><h1 style="font-size:22px">${letterId ? 'Edit letter' : 'Generate letter'}: ${esc(client.name)}</h1>
      <p class="muted small">${esc(c.id)}. The letter is pre-filled from the client profile and information form. Edit it as needed, then attach it to the case. It stays internal.</p></div>
    <form id="letterForm" data-case="${esc(c.id)}" data-letter="${esc(letterId)}" data-template="${esc(templateId || '')}" class="stack">
      ${letterId ? '' : `<label class="field"><span>Template</span><select class="input" data-letter-template-switch="${esc(c.id)}">${tpls.map((t) => `<option value="${esc(t.id)}" ${t.id === templateId ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>`}
      <label class="field"><span>Document name</span><input class="input" name="name" required value="${esc(name)}"></label>
      <div class="letter-grid">
        <label class="field"><span>Letter text (HTML: p, br, b)</span><textarea class="input tall mono" name="body" data-letter-body required>${esc(body)}</textarea></label>
        <div><span class="tiny muted" style="font-weight:600">Preview</span><div class="letter-preview" data-letter-preview>${esc(plainText(body))}</div></div>
      </div>
      ${ui.letterError ? `<p class="note red small">${esc(ui.letterError)}</p>` : ''}
      <div class="row"><button class="btn primary" type="submit">Attach to case as internal document</button><a class="btn" href="#/staff/case/${encodeURIComponent(c.id)}">Cancel</a></div>
    </form>
  </main>`;
}

// ---------- case page card ----------
export function lettersCard(c) {
  const u = auth.currentUser();
  if (!can(u, 'letter:generate')) return '';
  const letters = api.caseLetters(c.id);
  const tpls = api.listLetterTemplates();
  return `<section class="card stack">
    <div class="row between"><h2 style="margin:0">Letters</h2><span class="chip grey plain">internal, hidden from client</span></div>
    ${letters.map((l) => `<div class="inv-block"><div class="row between"><b>${esc(l.name)}</b><span class="tiny muted">v${l.version} &middot; ${fmtDateTime(l.updatedAt)}</span></div>
      <div class="row"><button class="btn sm" data-action="downloadLetter" data-letter="${esc(l.id)}" data-format="PDF">PDF</button><button class="btn sm" data-action="downloadLetter" data-letter="${esc(l.id)}" data-format="DOCX">DOCX</button>
        <a class="btn sm" href="#/staff/case/${encodeURIComponent(c.id)}/letter?letter=${encodeURIComponent(l.id)}">Edit</a>
        <button class="btn sm ghost" style="color:var(--red)" data-action="deleteLetter" data-letter="${esc(l.id)}">Delete</button></div></div>`).join('') || '<p class="muted small">No letters yet.</p>'}
    ${tpls.length ? `<form class="row" data-letter-new="${esc(c.id)}"><select class="input sm" name="tpl">${tpls.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select><button class="btn sm gold" type="submit">Generate letter</button></form>` : ''}
  </section>`;
}

// ---------- client: blank forms (only when staff opted a template in) ----------
export function clientFormsCard(c) {
  const forms = api.clientBlankForms(c.id);
  if (!forms.length) return '';
  return `<section class="card stack"><h2 style="margin:0">Forms to download</h2>
    <p class="muted small">Blank forms you can print and fill in.</p>
    ${forms.map((f) => `<div class="row between"><span>${esc(f.name)}</span><span class="row"><button class="btn sm" data-action="blankForm" data-case="${esc(c.id)}" data-tpl="${esc(f.id)}" data-format="PDF">PDF</button><button class="btn sm" data-action="blankForm" data-case="${esc(c.id)}" data-tpl="${esc(f.id)}" data-format="DOCX">DOCX</button></span></div>`).join('')}
  </section>`;
}

export function driveCard(c) {
  const u = auth.currentUser();
  if (!can(u, 'item:manage')) return '';
  return `<section class="card stack"><h2 style="margin:0">Legacy Google Drive folder</h2>
    <form id="driveForm" data-case="${esc(c.id)}" class="stack">
      <input class="input sm" type="url" name="url" placeholder="https://drive.google.com/drive/folders/..." value="${esc(c.legacyDriveUrl || '')}">
      <div class="row"><button class="btn sm" type="submit">Save link</button>
        ${c.legacyDriveUrl ? `<a class="btn sm" href="${esc(c.legacyDriveUrl)}" target="_blank" rel="noopener">Open folder</a><button class="btn sm gold" type="button" data-action="importDrive" data-case="${esc(c.id)}">Import from Drive</button>` : ''}</div>
    </form>
    <p class="tiny muted">The import is mocked in this prototype: it copies sample files into matching pending checklist items.</p>
  </section>`;
}

