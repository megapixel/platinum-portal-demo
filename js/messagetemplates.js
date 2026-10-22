// messagetemplates: admin-editable message bodies with {{merge fields}}.
// The defaults are seeded into db.messageTemplates, so edits survive and the Admin page can list them.
import { db } from './store.js';

export const DEFAULT_MESSAGE_TEMPLATES = [
  { key: 'LEAD_GREETING', name: 'Lead greeting (after /apply)', channel: 'WHATSAPP', subject: 'Thank you for your enquiry',
    body: 'Hi {{firstName}}, thank you for your enquiry about {{interest}}. This is Platinum Immigration. Our consultant will reach out to you shortly.' },
  { key: 'WELCOME', name: 'Welcome / greeting (new client)', channel: 'BOTH', subject: 'Welcome to Platinum Immigration',
    body: 'Hi {{firstName}}, welcome to Platinum Immigration. Your {{caseType}} application ({{caseNo}}) has started.\nPlease complete your information and upload your {{requiredCount}} documents by {{targetDate}}. You can see exactly what we need and track your progress here: {{link}}' },
  { key: 'REMINDER_WEEKLY', name: 'Weekly outstanding documents reminder', channel: 'BOTH', subject: 'What we still need for your application',
    body: 'Hi {{firstName}}, this is Platinum Immigration. For your {{caseType}} application, we still need:\n{{outstandingList}}\n{{timing}} Upload securely here: {{link}}' },
  { key: 'DOC_REJECTED', name: 'Document rejected', channel: 'BOTH', subject: 'Please re-upload a document',
    body: 'Hi {{firstName}}, we could not accept your {{documentName}} ({{person}}).\nReason: {{reason}}\nWhat to do next: {{nextStep}}\nRe-upload here: {{link}}' },
  { key: 'DOC_ACCEPTED', name: 'Document accepted', channel: 'WHATSAPP', subject: 'Document accepted',
    body: 'Hi {{firstName}}, your {{documentName}} ({{person}}) has been accepted. Your documents are now {{pct}}% complete.' },
  { key: 'ALL_DOCS_COMPLETE', name: 'All documents complete', channel: 'BOTH', subject: 'All documents received',
    body: 'Hi {{firstName}}, good news. We have received and accepted all the documents we need for your {{caseType}} application. Your consultant will now prepare your submission.' },
  { key: 'STAGE_CHANGED', name: 'Stage changed', channel: 'WHATSAPP', subject: 'Your application has moved on',
    body: 'Hi {{firstName}}, your application ({{caseNo}}) is now at: {{stage}}. Track it here: {{link}}' },
  { key: 'REVIEW_SUBMITTED', name: 'Submitted for review (confirmation)', channel: 'WHATSAPP', subject: 'We received your upload',
    body: 'Hi {{firstName}}, thank you. We have received your uploads for {{caseNo}} and our document specialist will review them. We will message you if anything needs to change.' },
  { key: 'APPLICATION_SUBMITTED', name: 'Application submitted', channel: 'BOTH', subject: 'Your application has been submitted',
    body: 'Hi {{firstName}}, your {{caseType}} application ({{caseNo}}) was submitted to the authority on {{date}}. We will let you know as soon as there is an outcome.' },
  { key: 'OUTCOME_APPROVED', name: 'Outcome approved', channel: 'BOTH', subject: 'Your application was approved',
    body: 'Hi {{firstName}}, congratulations. Your {{caseType}} application ({{caseNo}}) was approved on {{date}}. Reference: {{reference}}.\nNext steps: {{nextSteps}}' },
  { key: 'OUTCOME_REJECTED', name: 'Outcome rejected', channel: 'BOTH', subject: 'Update on your application',
    body: 'Hi {{firstName}}, we have an update on your {{caseType}} application ({{caseNo}}). The authority did not approve it on {{date}}. Reason given: {{reason}}.\nNext steps: {{nextSteps}} Your consultant will call you to discuss.' },
  { key: 'INVOICE_ISSUED', name: 'Invoice issued', channel: 'BOTH', subject: 'Invoice {{invoiceNo}}',
    body: 'Hi {{firstName}}, invoice {{invoiceNo}} for {{amount}} has been issued for your application ({{caseNo}}). View it in your portal: {{link}}' },
  { key: 'PAYMENT_REMINDER', name: 'Payment reminder', channel: 'BOTH', subject: 'Payment reminder for {{invoiceNo}}',
    body: 'Hi {{firstName}}, a friendly reminder that {{balance}} is outstanding on invoice {{invoiceNo}}. You can view and pay it here: {{link}}' },
  { key: 'PAYMENT_RECEIVED', name: 'Payment received', channel: 'BOTH', subject: 'Payment received',
    body: 'Hi {{firstName}}, we received your payment of {{amount}} for invoice {{invoiceNo}}. Balance remaining: {{balance}}. Thank you.' },
];

export function getMessageTemplate(key) {
  return db.messageTemplates.find((t) => t.key === key) || DEFAULT_MESSAGE_TEMPLATES.find((t) => t.key === key);
}

export function fillTemplate(text, vars) {
  return String(text).replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] == null ? '' : String(vars[k])));
}

/** { subject, body, channel } with the merge fields filled in. Unknown fields become empty. */
export function renderMessage(key, vars) {
  const t = getMessageTemplate(key);
  if (!t) throw new Error(`Unknown message template ${key}`);
  return { subject: fillTemplate(t.subject, vars), body: fillTemplate(t.body, vars), channel: t.channel };
}

/** Merge fields each template may use. The editor lists them and rejects unknown ones. */
export const TEMPLATE_FIELDS = {
  LEAD_GREETING: ['firstName', 'interest'],
  WELCOME: ['firstName', 'caseType', 'caseNo', 'requiredCount', 'targetDate', 'link'],
  REMINDER_WEEKLY: ['firstName', 'caseType', 'caseNo', 'outstandingList', 'timing', 'link'],
  DOC_REJECTED: ['firstName', 'caseNo', 'documentName', 'person', 'reason', 'nextStep', 'link'],
  DOC_ACCEPTED: ['firstName', 'caseNo', 'documentName', 'person', 'pct'],
  ALL_DOCS_COMPLETE: ['firstName', 'caseNo', 'caseType'],
  STAGE_CHANGED: ['firstName', 'caseNo', 'stage', 'link'],
  REVIEW_SUBMITTED: ['firstName', 'caseNo'],
  APPLICATION_SUBMITTED: ['firstName', 'caseNo', 'caseType', 'date'],
  OUTCOME_APPROVED: ['firstName', 'caseNo', 'caseType', 'date', 'reference', 'nextSteps'],
  OUTCOME_REJECTED: ['firstName', 'caseNo', 'caseType', 'date', 'reason', 'nextSteps'],
  INVOICE_ISSUED: ['firstName', 'caseNo', 'invoiceNo', 'amount', 'link'],
  PAYMENT_REMINDER: ['firstName', 'invoiceNo', 'balance', 'link'],
  PAYMENT_RECEIVED: ['firstName', 'invoiceNo', 'amount', 'balance'],
};

export const SAMPLE_VARS = {
  firstName: 'Elizabeth', interest: 'PR', caseType: 'PR', caseNo: 'PIC-2026-0142', requiredCount: 8, targetDate: '16 Nov 2026',
  link: 'https://portal.example/#/magic/abc123', outstandingList: '- Passport (bio page) (Main applicant)\n- Latest 6 months payslips (Main applicant)',
  timing: 'You have 25 days left.', documentName: 'Passport (bio page)', person: 'Main applicant', reason: 'The image is blurry.',
  nextStep: 'Take a new photo in good light.', pct: 75, stage: 'Review and preparation', date: '22 Oct 2026', reference: 'PR-2026-77821',
  nextSteps: 'Collect your PR card from the ICA.', invoiceNo: 'INV-2026-0001', amount: 'SGD 2,071.00', balance: 'SGD 2,071.00',
};

/** Field names used in a body or subject that are not allowed for this template. */
export function unknownFields(key, ...texts) {
  const allowed = new Set(TEMPLATE_FIELDS[key] || []);
  const bad = new Set();
  texts.forEach((t) => String(t).replace(/\{\{(\w+)\}\}/g, (m, k) => { if (!allowed.has(k)) bad.add(k); return m; }));
  return [...bad];
}
