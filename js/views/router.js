// views/router: hash routing, role-based route guards, painting.
import { db, store } from '../store.js';
import { isStaffRole } from '../domain.js';
import { esc, HttpError } from '../utils.js';
import { auth, requirePerm, inspectMagicLink, consumeMagicLink } from '../auth/session.js';
import { can } from '../auth/permissions.js';
import { clientResultMessage } from '../ai.js';
import { api } from '../api/index.js';
import { root, ui, parseHash, go } from './common.js';
import { clientShell, staffShell, viewLogin, viewMagicProblem, viewDenied } from './shell.js';
import { viewPortal, viewHelp, viewInfoForm } from './client.js';
import { viewDashboard, viewCase, viewOutbox, viewTemplates, viewNewCase, rejectModal, addItemModal } from './staff.js';
import { viewApply, viewLeads, viewLead, viewMyDay, convertModal, lostModal } from './leads.js';
import { viewAdmin } from './admin.js';
import { viewReviewQueue, viewPack } from './consolidation.js';
import { viewBilling, viewInvoices } from './billing.js';

function uploadModal(m) {
  const item = store.item(m.itemId);
  if (!item) return '<p>Item no longer exists.</p>';
  if (m.phase === 'checking') {
    return `<div class="checking"><div class="spinner"></div><h2>Checking your document...</h2><p class="muted small">${esc(m.fileName)}</p></div>`;
  }
  if (m.phase === 'result') {
    const doc = db.documents.find((d) => d.id === m.docId);
    const ok = item.status === 'UPLOADED';
    return `<div class="result-icon" aria-hidden="true">${ok ? '&#9989;' : '&#9888;&#65039;'}</div>
      <h2 style="text-align:center">${ok ? 'Document received' : 'Please check this document'}</h2>
      <p class="note ${ok ? 'green' : 'amber'}" style="margin-top:12px">${esc(clientResultMessage(doc))}</p>
      <p class="muted small" style="margin-top:10px">${ok ? 'When you have uploaded everything for now, press "submit for review" so we know to check it.' : 'You can upload a new copy now, or leave this one for your consultant to review.'}</p>
      <div class="row" style="margin-top:16px;justify-content:flex-end">
        ${ok ? '' : `<button class="btn" data-action="uploadAgain">Upload a new copy</button>`}
        <button class="btn primary" data-action="closeModal">Done</button>
      </div>`;
  }
  const user = auth.currentUser();
  return `<h2>${esc(item.label)}</h2>
    <p class="muted small">${esc(item.personLabel)}${item.personLabel !== 'Main applicant' ? ' &middot; ' + esc(item.personName) : ''}</p>
    ${user.role !== 'CLIENT' ? '<p class="note blue small" style="margin-top:8px">You are uploading on the client\'s behalf. The document will be marked with your name.</p>' : ''}
    <p class="small" style="margin-top:8px">${esc(item.description || '')}</p>
    ${item.requiredFields.length ? `<p class="tiny muted" style="margin-top:8px">We will check for: ${item.requiredFields.map(esc).join(', ')}.</p>` : ''}
    <label class="dropzone" data-dropzone>
      <b>Drag and drop your file here</b>
      <span class="muted small">or tap to choose a file. PDF, JPG or PNG, up to 10 MB.</span>
      <input class="hidden-input" type="file" data-upload-input accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png">
    </label>
    <label class="btn block" style="margin-top:10px">&#128247; Take a photo
      <input class="hidden-input" type="file" data-upload-input accept="image/*" capture="environment">
    </label>
    ${m.error ? `<p class="note red small" style="margin-top:10px">${esc(m.error)}</p>` : ''}
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" data-action="closeModal">Cancel</button></div>`;
}
function viewModal() {
  const m = ui.modal;
  if (!m) return '';
  const inner = {
    upload: uploadModal, reject: rejectModal, addItem: addItemModal, convert: convertModal, lostReason: lostModal,
  }[m.type](m);
  return `<div class="modal-backdrop" data-action="closeModalBackdrop"><div class="modal" role="dialog" aria-modal="true">${inner}</div></div>`;
}

export function paint(html) {
  root.innerHTML = html + viewModal();
}

const STAFF_HOME = '/staff';

/** Routes and the permission each needs. The api re-checks every call; this just avoids dead pages. */
export function render() {
  const { path, query, raw } = parseHash();
  const user = auth.currentUser();
  try {
    // Public routes.
    if (path === '/login') return paint(viewLogin(query));
    if (path === '/apply') return paint(viewApply(query));
    if (path.startsWith('/magic/')) {
      const token = decodeURIComponent(path.split('/')[2] || '');
      const r = inspectMagicLink(token);
      if (r.status !== 'OK') return paint(viewMagicProblem(r.status));
      consumeMagicLink(token);
      return go(r.link.next || '/portal', true);
    }
    if (!user) return go('/login?next=' + encodeURIComponent(raw), true);
    if (path === '/' || path === '') return go(isStaffRole(user.role) ? STAFF_HOME : '/portal', true);

    if (path.startsWith('/portal')) {
      if (isStaffRole(user.role)) {
        return go(query.case && store.case(query.case) ? `/staff/case/${query.case}` : STAFF_HOME, true);
      }
      if (path === '/portal/help') return paint(clientShell(viewHelp()));
      if (path === '/portal/billing') return paint(clientShell(viewBilling(query)));
      if (path === '/portal/info') {
        const c = query.case ? api.getCase(query.case) : api.myCases()[0];
        if (!c) throw new HttpError(404, 'No application found for your account yet.');
        return paint(clientShell(viewInfoForm(c.id, false)));
      }
      return paint(clientShell(viewPortal(query)));
    }
    if (path.startsWith('/staff')) {
      if (!isStaffRole(user.role)) throw new HttpError(403, 'Staff only.');
      if (path === '/staff') return paint(staffShell('dash', viewDashboard()));
      if (path.startsWith('/staff/case/')) {
        const parts = path.split('/');
        const caseId = decodeURIComponent(parts[3]);
        if (parts[4] === 'pack') return paint(staffShell('review', viewPack(caseId)));
        if (parts[4] === 'info') return paint(staffShell('dash', viewInfoForm(caseId, true)));
        return paint(staffShell('dash', viewCase(caseId)));
      }
      if (path === '/staff/invoices') { requirePerm('invoice:view'); return paint(staffShell('invoices', viewInvoices())); }
      if (path === '/staff/review') { requirePerm('item:review'); return paint(staffShell('review', viewReviewQueue())); }
      if (path === '/staff/outbox') { requirePerm('outbox:view'); return paint(staffShell('outbox', viewOutbox())); }
      if (path === '/staff/new') return paint(staffShell('dash', viewNewCase()));
      if (path === '/staff/templates') return paint(staffShell('templates', viewTemplates()));
      if (path === '/staff/leads') { requirePerm('lead:view'); return paint(staffShell('leads', viewLeads())); }
      if (path.startsWith('/staff/lead/')) return paint(staffShell('leads', viewLead(decodeURIComponent(path.split('/')[3]))));
      if (path === '/staff/my-day') { requirePerm('lead:view'); return paint(staffShell('myday', viewMyDay())); }
      if (path === '/staff/admin') {
        if (!can(user, 'config:manage') && !can(user, 'user:manage') && !can(user, 'messagetemplate:manage')) throw new HttpError(403, 'You do not have permission to open Admin.');
        return paint(staffShell('admin', viewAdmin()));
      }
    }
    return paint(viewDenied('Page not found', 'That page does not exist.', 404));
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.status === 401) return go('/login?next=' + encodeURIComponent(raw), true);
      return paint(viewDenied(e.status === 404 ? 'Not found' : 'Access denied', e.message, e.status));
    }
    console.error(e);
    return paint(viewDenied('Something went wrong', e.message, 500));
  }
}

