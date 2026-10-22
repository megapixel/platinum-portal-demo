// views/events: delegated event handling for every view.
import { db, store, setDb, DB_KEY } from '../store.js';
import { isStaffRole, LEAD_STAGE_LABEL } from '../domain.js';
import { esc, HttpError, toCsv } from '../utils.js';
import { auth, requestMagicLink } from '../auth/session.js';
import { api } from '../api/index.js';
import { metrics } from '../metrics.js';
import { root, ui, parseHash, go, toast, csvDownload } from './common.js';
import { render } from './router.js';
import { randomCaseSpec } from './staff.js';
import { filteredLeads } from './leads.js';

function handleError(e, modalTarget) {
  const msg = e instanceof HttpError ? e.message : 'Something went wrong. Please try again.';
  if (!(e instanceof HttpError)) console.error(e);
  if (modalTarget && ui.modal) { ui.modal.error = msg; ui.modal.phase = ui.modal.type === 'upload' ? 'choose' : ui.modal.phase; render(); } else toast(esc(msg));
}

async function doUpload(file) {
  const m = ui.modal;
  if (!m || m.type !== 'upload' || !file) return;
  m.error = '';
  m.phase = 'checking';
  m.fileName = file.name;
  render();
  try {
    const { doc } = await api.uploadDocument(m.itemId, file);
    if (ui.modal === m) { m.phase = 'result'; m.docId = doc.id; }
  } catch (e) { handleError(e, true); return; }
  render();
}

/** Moves a lead; Lost opens the reason dialog first. */
function moveLeadTo(leadId, stage) {
  const lead = store.lead(leadId);
  if (!lead || lead.stage === stage) return false;
  if (stage === 'LOST') { ui.modal = { type: 'lostReason', leadId }; render(); return false; }
  try {
    api.moveLead(leadId, stage);
    render();
    toast(`${esc(lead.name)} moved to ${esc(LEAD_STAGE_LABEL[stage])}.`);
    return true;
  } catch (e) { handleError(e); render(); return false; }
}

const actions = {
  fill(el) {
    const f = document.getElementById('loginForm');
    f.email.value = el.dataset.email;
    f.password.value = 'demo1234';
    f.password.focus();
  },
  async emailMagicLink() {
    const f = document.getElementById('loginForm');
    if (!f.email.value.trim()) { ui.loginError = 'Enter your email first, then ask for a sign-in link.'; render(); return; }
    await requestMagicLink(f.email.value);
    ui.loginError = ''; ui.magicSent = true; render();
  },
  logout() { auth.logout(); ui.modal = null; ui.loginError = ''; ui.magicSent = false; go('/login'); },
  openUpload(el) { ui.modal = { type: 'upload', itemId: el.dataset.item, phase: 'choose' }; render(); },
  uploadAgain() { ui.modal.phase = 'choose'; ui.modal.error = ''; render(); },
  closeModal() { ui.modal = null; render(); },
  closeModalBackdrop(el, e) { if (e.target === el && (!ui.modal || ui.modal.phase !== 'checking')) { ui.modal = null; render(); } },
  openCase(el) { go('/staff/case/' + encodeURIComponent(el.dataset.case)); },
  openLead(el) { go('/staff/lead/' + encodeURIComponent(el.dataset.lead)); },
  clearFilters() { ui.filters = { q: '', stage: '', type: '', rag: '', staff: '' }; render(); },
  toggleItem(el) { ui.expanded[el.dataset.item] = !ui.expanded[el.dataset.item]; render(); },
  async accept(el) {
    try {
      const caseId = store.item(el.dataset.item).caseId;
      const before = metrics.completion(caseId).pct;
      await api.reviewItem(el.dataset.item, 'ACCEPTED');
      render();
      toast(`Document accepted. Completion ${before}% &rarr; ${metrics.completion(caseId).pct}%`);
    } catch (e) { handleError(e); }
  },
  openReject(el) { ui.modal = { type: 'reject', itemId: el.dataset.item }; render(); },
  removeItem(el) {
    const it = store.item(el.dataset.item);
    if (!window.confirm(`Remove "${it.label}" (${it.personLabel}) from this case?`)) return;
    try { api.removeItem(it.id); render(); toast('Item removed.'); } catch (e) { handleError(e); }
  },
  fillRandom() { ui.newCase = Object.assign(randomCaseSpec(), { sample: true }); render(); },
  openAddItem(el) { ui.modal = { type: 'addItem', caseId: el.dataset.case }; render(); },
  async remindNow(el) {
    try {
      const msg = await api.sendReminderNow(el.dataset.case);
      if (msg) { ui.outboxId = msg.id; toast('Reminder added to the outbox. <a href="#/staff/outbox">View</a>', 5000); } else toast('Nothing outstanding, so no reminder was sent.');
      render();
    } catch (e) { handleError(e); }
  },
  async setStageQuick(el) {
    try { await api.setStage(el.dataset.case, el.dataset.stage); render(); toast('Stage updated.'); } catch (e) { handleError(e); }
  },
  async runWeekly() {
    try {
      const { sent, skipped } = await api.runWeeklyReminders();
      if (sent.length) ui.outboxId = sent[0].id;
      ui.outboxTab = 'whatsapp';
      render();
      toast(`${sent.length} personalised reminder${sent.length === 1 ? '' : 's'} generated${skipped ? `, ${skipped} skipped (nothing outstanding)` : ''}. <a href="#/staff/outbox">Open outbox</a>`, 6000);
    } catch (e) { handleError(e); }
  },
  selectMsg(el) { ui.outboxId = el.dataset.msg; render(); },
  outboxTab(el) { ui.outboxTab = el.dataset.tab; ui.outboxId = null; render(); },
  clearOutbox() { if (window.confirm('Clear all simulated messages?')) { api.clearOutbox(); ui.outboxId = null; render(); } },
  resetDemo() {
    if (!window.confirm('Reset all demo data to the original seed? Uploads, reviews and messages will be cleared.')) return;
    api.resetDemo();
    ui.expanded = {}; ui.expandedInit = {}; ui.outboxId = null; ui.modal = null;
    render();
    toast('Demo data reset.');
  },
  selectTpl(el) { ui.templateId = el.dataset.tpl; render(); },
  addTi() { api.addTemplateItem(ui.templateId); render(); window.scrollTo(0, 400); },
  removeTi(el) { if (window.confirm('Delete this template item?')) { api.removeTemplateItem(ui.templateId, el.dataset.ti); render(); } },
  moveTi(el) { api.moveTemplateItem(ui.templateId, el.dataset.ti, Number(el.dataset.dir)); render(); },
  removeField(el) {
    const t = db.templates.find((x) => x.id === ui.templateId);
    const it = t.items.find((x) => x.id === el.dataset.ti);
    const fields = it.requiredFields.slice();
    fields.splice(Number(el.dataset.index), 1);
    api.updateTemplateItem(t.id, it.id, { requiredFields: fields });
    render();
  },
  selectForm(el) { ui.formId = el.dataset.form; render(); },
  addFormField(el) { api.addFormField(ui.formId, el.dataset.section); render(); },
  removeFormField(el) { api.removeFormField(ui.formId, el.dataset.section, el.dataset.ff); render(); },
  async submitReview(el) {
    try {
      await api.submitForReview(el.dataset.case);
      render();
      toast('Thank you. Your uploads are with our document specialist, and we sent you a confirmation.', 5000);
    } catch (e) { handleError(e); }
  },
  applyAgain() { ui.applyDone = null; ui.applyError = ''; render(); },
  leadMode(el) { ui.leadMode = el.dataset.mode; render(); },
  exportLeadsCsv() {
    const leads = filteredLeads();
    csvDownload('leads.csv', toCsv(['Name', 'Email', 'Phone', 'Stage', 'Interest', 'Source', 'Quoted amount', 'Next follow-up', 'Assigned', 'Created'],
      leads.map((l) => [l.name, l.email, l.phone, LEAD_STAGE_LABEL[l.stage], l.interest, l.heardOfUs, l.quotedAmount, l.nextFollowUp, (store.user(l.assignedStaffId) || {}).name, l.createdAt])));
  },
  openConvert(el) { ui.modal = { type: 'convert', leadId: el.dataset.lead }; render(); },
  adminTab(el) { ui.adminTab = el.dataset.tab; render(); },
  removePackage(el) { try { api.removePackage(el.dataset.id); render(); } catch (e) { handleError(e); } },
  removeSource(el) { try { api.removeSource(el.dataset.id); render(); } catch (e) { handleError(e); } },
};

root.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || !root.contains(el)) return;
  const fn = actions[el.dataset.action];
  if (!fn) return;
  if (el.tagName === 'A') e.preventDefault();
  fn(el, e);
});

const formValues = (f) => Object.fromEntries(new FormData(f).entries());

root.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const v = (n) => f.elements.namedItem(n).value;
  try {
    if (f.id === 'loginForm') {
      try {
        const u = auth.login(f.email.value, f.password.value);
        ui.loginError = ''; ui.magicSent = false;
        const next = f.next.value;
        const allowed = next && next.startsWith('/') && !next.startsWith('/login') && (isStaffRole(u.role) ? next.startsWith('/staff') || next.startsWith('/portal') : next.startsWith('/portal'));
        go(allowed ? next : (isStaffRole(u.role) ? '/staff' : '/portal'));
      } catch (err) { ui.loginError = err.message; render(); }
    }
    if (f.id === 'magicRequestForm') {
      await requestMagicLink(v('email'));
      ui.magicSent = true; render();
    }
    if (f.id === 'rejectForm') {
      try {
        await api.reviewItem(ui.modal.itemId, 'REJECTED', v('remark'), f.elements.namedItem('reason').value);
        ui.modal = null; render(); toast('Document rejected. The client has been sent the reason and what to do next.', 4500);
      } catch (err) { ui.modal.remark = v('remark'); handleError(err, true); }
    }
    if (f.id === 'newCaseForm') {
      const on = (n) => f.elements.namedItem(n).checked;
      const spec = {
        name: v('name'), email: v('email'), phone: v('phone'), nationality: v('nationality'), dob: v('dob'),
        caseType: v('caseType'), spouseName: v('spouseName'), children: v('children'), married: on('married'),
        startDate: v('startDate'), assignedStaffId: v('assignedStaffId'), stage: v('stage'), sendWelcome: on('sendWelcome'),
        channelPref: v('channelPref'), secondary: { name: v('secName'), email: v('secEmail'), phone: v('secPhone') },
        secName: v('secName'), secEmail: v('secEmail'), secPhone: v('secPhone'),
      };
      try {
        const { caseRec, welcome } = await api.createCase(spec);
        ui.newCase = null;
        go('/staff/case/' + encodeURIComponent(caseRec.id));
        if (welcome) ui.outboxId = welcome.id;
        toast(`Case ${esc(caseRec.id)} created.${welcome ? ' Welcome message added to the <a href="#/staff/outbox">outbox</a>.' : ''}`, 6000);
      } catch (err) {
        ui.newCase = Object.assign(spec, { error: err instanceof HttpError ? err.message : 'Could not create the case.' });
        if (!(err instanceof HttpError)) console.error(err);
        render();
        window.scrollTo(0, document.body.scrollHeight);
      }
    }
    if (f.id === 'addItemForm') {
      try {
        const caseId = ui.modal.caseId;
        let spec;
        if (f.templateItemId.value) {
          let ti; db.templates.forEach((t) => t.items.forEach((x) => { if (x.id === f.templateItemId.value) ti = x; }));
          spec = { templateItemId: ti.id, code: ti.code, label: ti.label, description: ti.description, docType: ti.docType, requiredFields: ti.requiredFields.slice() };
        } else {
          spec = { label: f.label.value, requiredFields: f.fields.value.split(',').map((s) => s.trim()).filter(Boolean) };
        }
        spec.personLabel = f.personLabel.value;
        spec.required = f.required.checked;
        spec.dueDate = f.dueDate.value || null;
        const item = api.addItem(caseId, spec);
        ui.modal = null;
        ui.expanded[item.id] = true;
        render();
        toast('Item added. The client will see it in their checklist.');
      } catch (err) { handleError(err, true); }
    }
    if (f.id === 'addContactForm') {
      try { api.addContact(f.dataset.client, formValues(f)); render(); toast('Contact added. They can sign in with their own email.'); } catch (err) { handleError(err); }
    }
    if (f.id === 'onboardingForm') {
      const submit = e.submitter && e.submitter.dataset.mode === 'submit';
      try {
        const res = api.saveOnboarding(f.dataset.case, formValues(f), submit);
        if (submit) {
          go(f.dataset.staff ? `/staff/case/${encodeURIComponent(f.dataset.case)}` : '/portal');
          toast('Information submitted. Thank you.');
        } else { render(); toast(`Draft saved. ${res.progress.pct}% complete.`); }
      } catch (err) { handleError(err); }
    }
    if (f.id === 'applyForm') {
      try {
        const vals = formValues(f);
        const res = await api.submitEnquiry({ ...vals, utm: { source: vals.utm_source, medium: vals.utm_medium, campaign: vals.utm_campaign } });
        ui.applyDone = { id: res.id, firstName: String(vals.name).split(' ')[0] }; ui.applyError = ''; render();
        window.scrollTo(0, 0);
      } catch (err) { ui.applyError = err instanceof HttpError ? err.message : 'Something went wrong. Please try again.'; render(); }
    }
    if (f.id === 'leadNoteForm') {
      try { api.addLeadNote(f.dataset.lead, v('kind'), v('text')); render(); } catch (err) { handleError(err); }
    }
    if (f.id === 'convertForm') {
      try {
        const { caseRec, invoice, welcome } = await api.convertLead(f.dataset.lead, formValues(f));
        ui.modal = null;
        if (welcome) ui.outboxId = welcome.id;
        go('/staff/case/' + encodeURIComponent(caseRec.id));
        toast(`Converted. Case ${esc(caseRec.id)} and invoice ${esc(invoice.number)} created, and the welcome message is in the <a href="#/staff/outbox">outbox</a>.`, 7000);
      } catch (err) { handleError(err, true); }
    }
    if (f.id === 'lostForm') {
      try {
        const reason = [v('reason'), v('detail')].filter(Boolean).join(': ');
        api.moveLead(f.dataset.lead, 'LOST', reason);
        ui.modal = null; render(); toast('Lead marked as lost.');
      } catch (err) { handleError(err, true); }
    }
    if (f.classList.contains('cat-row')) {
      const vals = formValues(f);
      const spec = { ...vals, id: f.dataset.id || undefined };
      try {
        if (f.dataset.cat === 'package') api.savePackage(spec);
        if (f.dataset.cat === 'source') api.saveSource(spec);
        if (f.dataset.cat === 'introducer') api.saveIntroducer(spec);
        render(); toast('Saved.');
      } catch (err) { handleError(err); }
    }
  } catch (err) { handleError(err); }
});

root.addEventListener('change', async (e) => {
  const el = e.target;
  try {
    if (el.matches('[data-upload-input]')) { doUpload(el.files && el.files[0]); return; }
    if (el.matches('[data-newcase-type]')) {
      const dep = el.value === 'PR_WITH_DEPENDANTS';
      root.querySelector('[data-dep-fields]').hidden = !dep;
      const tp = db.templates.find((x) => x.caseType === el.value);
      const n = tp ? tp.items.filter((i) => i.appliesTo === 'MAIN').length : 0;
      root.querySelector('[data-tpl-hint]').textContent = `${n} documents for the main applicant${dep ? ', plus passport, birth certificate and photo for each dependant' : ''}. Edit the lists under Templates.`;
      return;
    }
    if (el.matches('select[data-filter]')) { ui.filters[el.dataset.filter] = el.value; render(); return; }
    if (el.matches('[data-stage-select]')) {
      await api.setStage(el.dataset.stageSelect, el.value); render(); toast('Stage updated. The client sees it straight away.');
      return;
    }
    if (el.matches('[data-tpl-name]')) { api.updateTemplate(el.dataset.tplName, { name: el.value.trim() || 'Untitled template' }); render(); return; }
    if (el.matches('[data-ti]')) {
      const val = el.type === 'checkbox' ? el.checked : el.value;
      api.updateTemplateItem(ui.templateId, el.dataset.ti, { [el.dataset.key]: val });
      render();
      return;
    }
    if (el.matches('[data-ff]')) {
      api.updateFormField(ui.formId, el.dataset.section, el.dataset.ff, { [el.dataset.key]: el.type === 'checkbox' ? el.checked : el.value });
      render();
      return;
    }
    if (el.matches('[data-deadline]')) { api.setItemDeadline(el.dataset.deadline, el.value); render(); toast('Deadline saved.'); return; }
    if (el.matches('[data-channel-pref]')) { api.setChannelPref(el.dataset.channelPref, el.value); toast('Preference saved.'); return; }
    if (el.matches('[data-lead-filter]')) { ui.leadFilters[el.dataset.leadFilter] = el.value; if (el.tagName === 'SELECT') render(); return; }
    if (el.matches('[data-lead-stage]')) { moveLeadTo(el.dataset.leadStage, el.value); return; }
    if (el.matches('[data-lead-field]')) {
      api.updateLead(el.dataset.lead, { [el.dataset.leadField]: el.value });
      render();
      toast('Saved.');
      return;
    }
    if (el.matches('[data-user-role]')) { api.setUserRole(el.dataset.userRole, el.value); render(); toast('Role updated and recorded in the audit trail.'); return; }
    if (el.matches('[data-config]')) {
      const v = el.dataset.type === 'bool' ? el.checked : el.dataset.type === 'number' ? Number(el.value) : el.value;
      api.updateConfig({ [el.dataset.config]: v });
      toast('Setting saved.');
    }
  } catch (err) { handleError(err); render(); }
});

root.addEventListener('input', (e) => {
  const el = e.target;
  const sel = el.matches('input[data-filter="q"]') ? 'input[data-filter="q"]' : el.matches('input[data-lead-filter="q"]') ? 'input[data-lead-filter="q"]' : null;
  if (!sel) return;
  if (sel.includes('data-lead-filter')) ui.leadFilters.q = el.value; else ui.filters.q = el.value;
  const pos = el.selectionStart;
  render();
  const again = root.querySelector(sel);
  if (again) { again.focus(); again.setSelectionRange(pos, pos); }
});

document.addEventListener('keydown', (e) => {
  const el = e.target;
  if (e.key === 'Enter' && el.matches('[data-add-field]')) {
    e.preventDefault();
    const val = el.value.trim();
    if (!val) return;
    const t = db.templates.find((x) => x.id === ui.templateId);
    const it = t.items.find((x) => x.id === el.dataset.addField);
    if (!it.requiredFields.includes(val)) api.updateTemplateItem(t.id, it.id, { requiredFields: it.requiredFields.concat(val) });
    render();
    const again = root.querySelector(`[data-add-field="${CSS.escape(it.id)}"]`);
    if (again) again.focus();
  }
  if (e.key === 'Escape' && ui.modal && ui.modal.phase !== 'checking') { ui.modal = null; render(); }
  // Keyboard-friendly review: 1-6 picks a reject reason, Ctrl+Enter submits.
  if (ui.modal && ui.modal.type === 'reject' && !el.matches('textarea')) {
    const radios = root.querySelectorAll('#rejectForm input[name="reason"]');
    const n = Number(e.key);
    if (n >= 1 && n <= radios.length) { radios[n - 1].checked = true; e.preventDefault(); }
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ui.modal && ui.modal.type === 'reject') {
    const form = document.getElementById('rejectForm');
    if (form) form.requestSubmit();
  }
});

// Drag and drop onto the upload zone, and lead cards between pipeline columns.
root.addEventListener('dragstart', (e) => {
  const card = e.target.closest && e.target.closest('[data-lead-card]');
  if (card) { e.dataTransfer.setData('text/plain', card.dataset.leadCard); e.dataTransfer.effectAllowed = 'move'; card.classList.add('dragging'); }
});
root.addEventListener('dragend', (e) => {
  const card = e.target.closest && e.target.closest('[data-lead-card]');
  if (card) card.classList.remove('dragging');
  root.querySelectorAll('.kan-col.over').forEach((c) => c.classList.remove('over'));
});
root.addEventListener('dragover', (e) => {
  const col = e.target.closest && e.target.closest('[data-drop-stage]');
  if (col) { e.preventDefault(); col.classList.add('over'); return; }
  const z = e.target.closest && e.target.closest('[data-dropzone]');
  if (z) { e.preventDefault(); z.classList.add('over'); }
});
root.addEventListener('dragleave', (e) => {
  const col = e.target.closest && e.target.closest('[data-drop-stage]');
  if (col && !col.contains(e.relatedTarget)) col.classList.remove('over');
  const z = e.target.closest && e.target.closest('[data-dropzone]');
  if (z) z.classList.remove('over');
});
root.addEventListener('drop', (e) => {
  const col = e.target.closest && e.target.closest('[data-drop-stage]');
  if (col) {
    e.preventDefault();
    col.classList.remove('over');
    const id = e.dataTransfer.getData('text/plain');
    if (id) moveLeadTo(id, col.dataset.dropStage);
    return;
  }
  const z = e.target.closest && e.target.closest('[data-dropzone]');
  if (!z) return;
  e.preventDefault();
  doUpload(e.dataTransfer.files && e.dataTransfer.files[0]);
});

// Keep side-by-side tabs (staff + client) in sync during the demo.
window.addEventListener('storage', (e) => {
  if (e.key !== DB_KEY || !e.newValue) return;
  try { setDb(JSON.parse(e.newValue)); } catch (err) { return; }
  if (ui.modal && ui.modal.phase === 'checking') return;
  if (parseHash().path === '/apply' || document.activeElement && document.activeElement.closest && document.activeElement.closest('form')) return;
  render();
});

window.addEventListener('hashchange', () => {
  if (ui.modal && ui.modal.phase !== 'checking') ui.modal = null;
  if (parseHash().path !== '/staff/new') ui.newCase = null;
  render();
  window.scrollTo(0, 0);
});
