// views/outcome: outcome capture, re-application and attempt history (staff case page).
import { db, store } from '../store.js';
import { esc, fmtDate, isoDate } from '../utils.js';
import { auth } from '../auth/session.js';
import { can } from '../auth/permissions.js';

function outcomeForm(c, o) {
  return `<form id="outcomeForm" data-case="${esc(c.id)}" class="stack">
    <div class="seg">
      <label class="seg-opt"><input type="radio" name="result" value="APPROVED" ${!o || o.result === 'APPROVED' ? 'checked' : ''}> Approved</label>
      <label class="seg-opt"><input type="radio" name="result" value="REJECTED" ${o && o.result === 'REJECTED' ? 'checked' : ''}> Rejected</label>
    </div>
    <div class="tpl-grid" style="grid-template-columns:1fr 1fr">
      <label class="field"><span>Decision date</span><input class="input sm" type="date" name="decisionDate" max="${isoDate(new Date())}" value="${o ? isoDate(o.decisionDate) : isoDate(new Date())}" required></label>
      <label class="field"><span>Reference number</span><input class="input sm" name="reference" value="${esc(o ? o.reference : '')}"></label>
    </div>
    <label class="field"><span>Reason given (required for a rejection)</span><textarea class="input" name="reason">${esc(o ? o.reason : '')}</textarea></label>
    <label class="field"><span>Next steps for the client</span><textarea class="input" name="nextSteps">${esc(o ? o.nextSteps : '')}</textarea></label>
    <button class="btn primary" type="submit">${o ? 'Save correction' : 'Record outcome and notify client'}</button>
    ${o ? '' : '<p class="tiny muted">The client is sent the approved or rejected message with these next steps, and staff are alerted.</p>'}
  </form>`;
}

export function outcomeCard(c) {
  const u = auth.currentUser();
  if (!can(u, 'case:stage')) return c.outcome ? summary(c, false) : '';
  if (c.stage === 'SUBMITTED') return `<section class="card stack"><h2 style="margin:0">Outcome</h2><p class="small muted">Record the authority's decision.</p>${outcomeForm(c, null)}</section>`;
  if (c.stage === 'OUTCOME' && c.outcome) return summary(c, true);
  return '';
}

function summary(c, canEdit) {
  const o = c.outcome;
  const approved = o.result === 'APPROVED';
  const rule = db.config.reapplicationRule;
  return `<section class="card stack outcome ${approved ? 'approved' : 'rejected'}">
    <div class="row between"><h2 style="margin:0">Outcome</h2><span class="chip ${approved ? 'green' : 'red'}">${approved ? 'Approved' : 'Rejected'}</span></div>
    <dl class="info-list">
      <dt>Decision date</dt><dd>${fmtDate(o.decisionDate)}</dd>
      <dt>Reference</dt><dd>${esc(o.reference || '-')}</dd>
      ${o.reason ? `<dt>Reason</dt><dd>${esc(o.reason)}</dd>` : ''}
      <dt>Next steps</dt><dd>${esc(o.nextSteps || '-')}</dd>
      <dt>Recorded by</dt><dd>${esc((store.user(o.recordedById) || {}).name || '-')}</dd>
    </dl>
    ${!approved && canEdit ? `<div class="note blue small">${rule === 'NEW_CASE' ? 'A re-application opens a new linked case.' : 'A re-application continues this case as a new attempt.'} Accepted documents that have not expired are reused.</div>
      <button class="btn gold" data-action="reapply" data-case="${esc(c.id)}">Start re-application (attempt ${(c.attempt || 1) + 1})</button>` : ''}
    ${canEdit ? `<details><summary class="small">Correct the outcome</summary><div style="margin-top:8px">${outcomeForm(c, o)}</div></details>` : ''}
  </section>`;
}

export function attemptsCard(c) {
  const hist = c.attemptHistory || [];
  if (!hist.length && !c.previousCaseId) return '';
  return `<section class="card">
    <h2>Attempts</h2>
    <ul class="history">
      <li><b>Attempt ${c.attempt || 1} (current)</b><br><span class="muted">${c.outcome ? (c.outcome.result === 'APPROVED' ? 'Approved' : 'Rejected') : 'In progress'}</span></li>
      ${hist.slice().reverse().map((h) => `<li><b>Attempt ${h.attempt}</b><br><span class="muted">Started ${fmtDate(h.startedAt)}${h.submittedAt ? `, submitted ${fmtDate(h.submittedAt)}` : ''}, ${h.outcome.result === 'APPROVED' ? 'approved' : 'rejected'} ${fmtDate(h.outcome.decisionDate)}${h.outcome.reason ? `: ${esc(h.outcome.reason)}` : ''}</span></li>`).join('')}
    </ul>
    ${c.previousCaseId ? `<p class="small" style="margin-top:6px">Linked to <a href="#/staff/case/${encodeURIComponent(c.previousCaseId)}">${esc(c.previousCaseId)}</a></p>` : ''}
  </section>`;
}
