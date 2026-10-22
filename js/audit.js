// audit: categories and change descriptions for the timeline. Pure.
export const AUDIT_CATEGORIES = [
  ['', 'All activity'],
  ['STAGE', 'Stage changes'],
  ['DOCUMENT', 'Documents'],
  ['PAYMENT', 'Payments and invoices'],
  ['OUTCOME', 'Outcome and re-application'],
  ['ACCESS', 'Access and permissions'],
  ['LETTER', 'Letters'],
  ['MESSAGE', 'Messages and reminders'],
  ['SALES', 'Sales (leads)'],
];

const CATEGORY_BY_ACTION = {
  STAGE_CHANGED: 'STAGE',
  UPLOADED: 'DOCUMENT', ACCEPTED: 'DOCUMENT', REJECTED: 'DOCUMENT', ITEM_ADDED: 'DOCUMENT', ITEM_REMOVED: 'DOCUMENT', DEADLINE_SET: 'DOCUMENT',
  ONBOARDING_SAVED: 'DOCUMENT', ONBOARDING_SUBMITTED: 'DOCUMENT', SUBMITTED_FOR_REVIEW: 'DOCUMENT', PACK_GENERATED: 'DOCUMENT', CASE_CREATED: 'DOCUMENT',
  INVOICE_CREATED: 'PAYMENT', INVOICE_ISSUED: 'PAYMENT', INVOICE_VOIDED: 'PAYMENT', PAYMENT_RECORDED: 'PAYMENT',
  OUTCOME_RECORDED: 'OUTCOME', OUTCOME_CORRECTED: 'OUTCOME', REAPPLICATION_STARTED: 'OUTCOME',
  PERMISSION_CHANGED: 'ACCESS', CONTACT_ADDED: 'ACCESS', MAGIC_LINK_LOGIN: 'ACCESS',
  LETTER_GENERATED: 'LETTER', LETTER_ATTACHED: 'LETTER', LETTER_DOWNLOADED: 'LETTER', LETTER_TEMPLATE_EDITED: 'LETTER', BLANK_FORM_DOWNLOADED: 'LETTER',
  REMINDER_SETTINGS_CHANGED: 'MESSAGE', REMINDER_RULE_CHANGED: 'MESSAGE', TEMPLATE_EDITED: 'MESSAGE',
};
export function categoryOf(a) {
  if (CATEGORY_BY_ACTION[a.action]) return CATEGORY_BY_ACTION[a.action];
  return String(a.action).startsWith('LEAD_') ? 'SALES' : 'DOCUMENT';
}

const label = (k) => String(k).replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').toLowerCase();
const show = (v) => (v == null || v === '' ? 'none' : typeof v === 'object' ? JSON.stringify(v) : String(v).replace(/_/g, ' ').toLowerCase());

/** "stage: collecting documents to submitted" lines for the changed keys. */
export function describeChange(before, after) {
  const b = before || {}; const a = after || {};
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys.map((k) => {
    if (k in b && k in a) return `${label(k)}: ${show(b[k])} → ${show(a[k])}`;
    if (k in a) return `${label(k)}: ${show(a[k])}`;
    return `${label(k)} was ${show(b[k])}`;
  });
}
