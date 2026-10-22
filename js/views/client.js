// views/client: the client portal (mobile-first) and the onboarding information form.
import { db, store } from '../store.js';
import { STAGES, STAGE_INDEX, CASE_TYPES, REJECT_REASON } from '../domain.js';
import { esc, fmtDate, firstName, fmtDateTime } from '../utils.js';
import { auth } from '../auth/session.js';
import { api } from '../api/index.js';
import { metrics } from '../metrics.js';
import { clientResultMessage } from '../ai.js';
import { formProgress } from '../caselogic.js';
import { nextReminderDate } from '../reminders.js';
import { chip, stepper, ring, groupByPerson, uploadedByLabel } from './common.js';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function dueLabel(item) {
  if (!item.dueDate) return '';
  const days = Math.ceil((new Date(item.dueDate) - new Date().setHours(0, 0, 0, 0)) / 86400000);
  const cls = days < 0 ? 'overdue' : days <= 3 ? 'soon' : '';
  return `<span class="due ${cls}">Due ${fmtDate(item.dueDate)}${days < 0 ? ' (overdue)' : ''}</span>`;
}

export function viewPortal(query) {
  const cases = api.myCases();
  let c = cases[0];
  if (query.case) c = api.getCase(query.case); // throws 403 for someone else's case
  if (!c) return `<main class="page narrow"><div class="card">No application found for your account yet. Your consultant will set it up.</div></main>`;
  const u = auth.currentUser();
  const client = store.caseClient(c);
  const comp = metrics.completion(c.id);
  const left = metrics.daysLeft(c);
  const todo = metrics.clientTodo(c.id);
  const items = store.itemsFor(c.id);
  const stage = STAGES[STAGE_INDEX[c.stage]];
  const collecting = STAGE_INDEX[c.stage] <= STAGE_INDEX.COLLECTING_DOCUMENTS;
  const groups = groupByPerson(items);
  const def = db.formDefs.find((f) => f.caseType === c.caseType);
  const prog = formProgress(def, c.onboarding.data);
  const pending = api.pendingUploads(c.id);
  const openTask = db.reviewTasks.some((t) => t.caseId === c.id && t.status === 'OPEN');
  const next = nextReminderDate(c);
  const contacts = store.contactUsers(client);

  return `<main class="page narrow stack">
    <section class="card hero">
      <p class="muted small">Case ${esc(c.id)} &middot; ${esc(CASE_TYPES[c.caseType].label)}${c.attempt > 1 ? ` &middot; Attempt ${c.attempt}` : ''}</p>
      <h1>Hi ${esc(firstName(u.name))}</h1>
      <p class="muted small">Target submission date: <b style="color:#fff">${fmtDate(c.targetSubmissionDate)}</b></p>
      ${collecting && todo.length ? `<div class="countdown ${left < 0 ? 'overdue' : ''}">
        <b>${Math.abs(left)}</b><span>${left >= 0 ? 'days left to submit your documents' : 'days past your target date. Please upload as soon as you can.'}</span></div>` : ''}
    </section>

    <section class="card">
      <h2>Application stage</h2>
      ${stepper(c.stage)}
      <p class="stage-caption"><b>${esc(stage.label)}:</b> <span class="muted">${esc(stage.client)}</span></p>
    </section>

    ${outcomeCard(c)}

    <section class="card">
      <div class="row between">
        <div><h2 style="margin-bottom:2px">Your information</h2>
          <p class="muted small">${c.onboarding.status === 'SUBMITTED' ? 'Submitted. You can still update it.' : `${prog.pct}% complete. Save as you go and come back any time.`}</p></div>
        <a class="btn ${c.onboarding.status === 'SUBMITTED' ? '' : 'gold'}" href="#/portal/info?case=${encodeURIComponent(c.id)}">${c.onboarding.status === 'SUBMITTED' ? 'Review' : prog.pct ? 'Continue' : 'Start'}</a>
      </div>
      <div class="bar" style="margin-top:10px"><i style="width:${prog.pct}%"></i></div>
    </section>

    <section class="card">
      <div class="progress-wrap">
        ${ring(comp.pct)}
        <div style="flex:1">
          <h2 style="margin-bottom:2px">Documents ${comp.pct}% complete</h2>
          <p class="muted small">${comp.accepted} of ${comp.total} required documents accepted by your team.</p>
          <div class="bar"><i style="width:${comp.pct}%"></i></div>
        </div>
      </div>
    </section>

    <section class="card" id="todo">
      <h2>What we still need from you</h2>
      ${todo.length ? `<ul class="todo-list">${todo.map((i) => {
        const reason = i.rejectReason ? REJECT_REASON[i.rejectReason] : null;
        return `
        <li>
          <div class="grow">
            <div class="label">${esc(i.label)}</div>
            <div class="small muted">${esc(i.personLabel)}${i.personLabel !== 'Main applicant' ? ' &middot; ' + esc(i.personName) : ''} ${dueLabel(i)}</div>
            ${i.status === 'REJECTED' ? `<div class="reject-box">
                <b>Not accepted</b>
                <p>${esc(i.staffRemark || 'Please upload a new copy.')}</p>
                <p class="next"><b>What to do next:</b> ${esc((reason || REJECT_REASON.OTHER).nextStep)}</p></div>` : ''}
            ${i.status === 'AI_FLAGGED' ? `<p class="note amber small remark">${esc(clientResultMessage(store.latestDoc(i.id)))}</p>` : ''}
          </div>
          <div style="text-align:right">
            ${chip(i.status)}
            <div style="margin-top:8px"><button class="btn sm gold" data-action="openUpload" data-item="${esc(i.id)}">${i.status === 'PENDING' ? 'Upload' : i.status === 'REJECTED' ? 'Re-upload' : 'Upload again'}</button></div>
          </div>
        </li>`; }).join('')}</ul>`
      : `<div class="all-done"><b>Nothing outstanding</b><span class="muted small">${items.some((i) => i.status === 'UPLOADED') ? 'Your consultant is reviewing what you uploaded.' : 'Thank you. We have everything we need for now.'}</span></div>`}
    </section>

    ${collecting ? `<section class="card submit-card">
      <h2>Finished uploading?</h2>
      ${pending.length
        ? `<p class="muted small" style="margin:4px 0 12px">You have ${pending.length} new upload${pending.length === 1 ? '' : 's'} that ${pending.length === 1 ? 'has' : 'have'} not been sent for review yet.</p>
           <button class="btn primary block" data-action="submitReview" data-case="${esc(c.id)}">I've finished uploading - submit for review</button>`
        : `<p class="muted small" style="margin:4px 0">${openTask ? 'Your last batch is with our document specialist.' : 'When you have uploaded a batch, a button will appear here to send it for review.'}</p>`}
      <p class="next-reminder">${c.remindersPaused ? 'Reminders are paused for this application.' : `Next reminder: <b>${DAY_NAMES[next.getDay()]}</b> (${fmtDate(next.toISOString())}). It is a good time to finish this week's uploads.`}</p>
    </section>` : ''}

    <section class="card">
      <h2>Full checklist</h2>
      ${groups.map((g) => `<div class="person-group">
        <h3>${esc(g.label)}${g.label !== 'Main applicant' ? ` <span class="muted small">(${esc(g.name)})</span>` : ''}</h3>
        ${g.items.map((i) => { const doc = store.latestDoc(i.id); return `<div class="check-row">
          <div class="grow"><span>${esc(i.label)}</span>${i.required ? '' : '<span class="opt">Optional</span>'} ${dueLabel(i)}
            ${doc ? `<div class="tiny muted">v${doc.version || 1} &middot; uploaded by ${esc(uploadedByLabel(doc, store.user))} &middot; ${fmtDateTime(doc.uploadedAt)}</div>` : ''}</div>
          ${chip(i.status)}
          ${i.status !== 'ACCEPTED' ? `<button class="btn sm" data-action="openUpload" data-item="${esc(i.id)}" aria-label="Upload ${esc(i.label)}">${i.status === 'PENDING' ? 'Upload' : 'Replace'}</button>` : ''}
        </div>`; }).join('')}
      </div>`).join('')}
    </section>

    <section class="card">
      <h2>How we contact you</h2>
      <p class="muted small" style="margin:2px 0 10px">People who can sign in to this application: ${contacts.map((x) => esc(x.name)).join(', ')}.</p>
      <label class="field"><span>Send my updates by</span>
        <select class="input" data-channel-pref="${esc(client.id)}">
          ${[['WHATSAPP', 'WhatsApp'], ['EMAIL', 'Email'], ['BOTH', 'WhatsApp and email']].map(([v, l]) => `<option value="${v}" ${client.channelPref === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select></label>
    </section>

    <section class="card row between">
      <div><b>Questions?</b><p class="muted small">Why we need each document, accepted formats and more.</p></div>
      <a class="btn" href="#/portal/help">Help and FAQ</a>
    </section>
  </main>`;
}

/** Outcome card. The outcome fields arrive in phase 7. */
function outcomeCard(c) {
  if (!c.outcome) return '';
  const approved = c.outcome.result === 'APPROVED';
  return `<section class="card outcome ${approved ? 'approved' : 'rejected'}">
    <h2>${approved ? 'Your application was approved' : 'Update on your application'}</h2>
    <p class="small muted">Decision date ${fmtDate(c.outcome.decisionDate)}${c.outcome.reference ? ` &middot; Reference ${esc(c.outcome.reference)}` : ''}</p>
    ${!approved && c.outcome.reason ? `<p style="margin-top:8px"><b>Reason:</b> ${esc(c.outcome.reason)}</p>` : ''}
    ${c.outcome.nextSteps ? `<p style="margin-top:8px"><b>Next steps:</b> ${esc(c.outcome.nextSteps)}</p>` : ''}
  </section>`;
}

const FAQ = [
  ['Why do you need my payslips?', 'The ICA uses your recent income to assess your economic contribution. Six months of payslips shows a stable salary that matches your employer letter and tax assessment.'],
  ['Why do you need an employer letter?', 'It confirms your position, salary and start date in one signed document. It must be on company letterhead and signed by HR or your manager.'],
  ['Where do I find my Notice of Assessment?', 'Log in to the IRAS myTax Portal with Singpass, go to Notices/Letters and download the latest Notice of Assessment as a PDF.'],
  ['What file types can I upload?', 'PDF, JPG or PNG files up to 10 MB each. On your phone you can take a photo directly. Make sure all four corners are visible and the text is sharp.'],
  ['What does "Needs attention" mean?', 'Our document check noticed something, for example the wrong document type, an unreadable detail, or a name that does not match your information form. Please read the note and upload a new copy.'],
  ['Can I replace a document?', 'Yes. You can replace any file until your consultant has accepted it. We keep the earlier version in your history.'],
  ['What happens when I press "submit for review"?', 'Your document specialist is notified and checks everything you uploaded. You will get a message if anything needs to change.'],
  ['Is my data safe?', 'Your documents are only visible to you, anyone you share this application with, and your team. We never send your NRIC or passport number in reminder messages.'],
  ['How do I reach my consultant?', 'Reply to our WhatsApp message or call us at +65 6123 4500, Monday to Friday, 9am to 6pm.'],
];
export function viewHelp() {
  return `<main class="page narrow stack">
    <a href="#/portal" class="small">&larr; Back to my application</a>
    <section class="card"><h2>Help and FAQ</h2>
      ${FAQ.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
    </section>
  </main>`;
}

function fieldInput(f, value) {
  const v = esc(value || '');
  const req = f.required ? 'required' : '';
  const name = `name="${esc(f.key)}"`;
  if (f.type === 'textarea') return `<textarea class="input" ${name} ${req}>${v}</textarea>`;
  if (f.type === 'select') return `<select class="input" ${name} ${req}><option value="">Choose...</option>${(f.options || []).map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  const type = f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text';
  return `<input class="input" type="${type}" ${name} ${req} value="${v}">`;
}

/** The onboarding information form. `staff` toggles the back-office framing (filled in on the client's behalf). */
export function viewInfoForm(caseId, staff) {
  const c = api.getCase(caseId);
  const form = api.getForm(caseId);
  const client = store.caseClient(c);
  const back = staff ? `#/staff/case/${encodeURIComponent(c.id)}` : '#/portal';
  const ob = c.onboarding;
  const by = ob.updatedById && store.user(ob.updatedById);
  return `<main class="page narrow stack">
    <a href="${back}" class="small">&larr; ${staff ? 'Back to case' : 'Back to my application'}</a>
    <div><h1 style="font-size:22px">${staff ? `Information form: ${esc(client.name)}` : 'Your information'}</h1>
      <p class="muted small">${staff ? 'You are filling this in on the client\'s behalf. Every change is recorded.' : 'We use this to prepare your application, so please use your name exactly as in your passport.'}</p></div>
    <div class="card"><div class="row between"><b>${form.progress.pct}% complete</b><span class="tiny muted">${ob.status === 'SUBMITTED' ? 'Submitted' : 'Draft'}${by ? ` &middot; last saved ${fmtDateTime(ob.updatedAt)} by ${esc(by.name)}` : ''}</span></div>
      <div class="bar" style="margin-top:8px"><i style="width:${form.progress.pct}%"></i></div></div>
    <form id="onboardingForm" data-case="${esc(c.id)}" data-staff="${staff ? '1' : ''}" class="stack">
      ${form.def.sections.map((s) => `<section class="card stack">
        <h2 style="margin:0">${esc(s.label)}</h2>
        <div class="tpl-grid" style="grid-template-columns:1fr">
          ${s.fields.map((f) => `<label class="field"><span>${esc(f.label)}${f.required ? ' <i class="req">*</i>' : ''}</span>${fieldInput(f, form.data[f.key])}</label>`).join('')}
        </div>
      </section>`).join('')}
      <div class="row" style="justify-content:flex-end">
        <button class="btn" type="submit" data-mode="draft" formnovalidate>Save draft</button>
        <button class="btn primary" type="submit" data-mode="submit">${ob.status === 'SUBMITTED' ? 'Save and resubmit' : 'Submit information'}</button>
      </div>
    </form>
  </main>`;
}
