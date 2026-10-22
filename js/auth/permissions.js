// permissions: the single permission matrix. Every api.* function checks it through the guards
// in auth/session.js, and the Admin > Permissions page renders it so the client can review it.
// Production: the same file is imported by every route handler and server action.

/** Every permission, with the label shown on the Admin > Permissions page. */
export const PERMISSIONS = [
  ['case:view', 'View cases', 'Cases'],
  ['case:create', 'Create cases', 'Cases'],
  ['case:stage', 'Move a case between stages', 'Cases'],
  ['case:reassign', 'Reassign a case or lead', 'Cases'],
  ['item:upload', 'Upload documents (clients for themselves, staff on behalf)', 'Documents'],
  ['item:review', 'Accept or reject documents', 'Documents'],
  ['item:manage', 'Add or remove checklist items, set deadlines', 'Documents'],
  ['onboarding:edit', 'Fill in the onboarding form', 'Documents'],
  ['pack:generate', 'Generate submission packs', 'Documents'],
  ['message:send', 'Send messages and reminders', 'Messaging'],
  ['outbox:view', 'View the message outbox', 'Messaging'],
  ['messagetemplate:manage', 'Edit message templates and reminder rules', 'Messaging'],
  ['lead:view', 'View leads', 'Sales'],
  ['lead:manage', 'Create and update leads, log activity', 'Sales'],
  ['lead:convert', 'Convert a won lead into a client, case and invoice', 'Sales'],
  ['introducer:manage', 'Manage introducers, sources and packages', 'Sales'],
  ['invoice:view', 'View invoices and payments', 'Payments'],
  ['invoice:manage', 'Issue invoices and record payments', 'Payments'],
  ['invoice:pay', 'Pay an invoice online (clients)', 'Payments'],
  ['letter:generate', 'Generate letters on a case', 'Letters'],
  ['letter:template', 'Manage letter templates', 'Letters'],
  ['template:manage', 'Edit checklist and onboarding form templates', 'Admin'],
  ['analytics:view', 'View analytics and reports', 'Admin'],
  ['audit:view', 'View the audit timeline', 'Admin'],
  ['user:manage', 'Manage users', 'Admin'],
  ['config:manage', 'Change system settings and integrations', 'Admin'],
  ['demo:reset', 'Reset the demo data', 'Admin'],
];
const ALL = PERMISSIONS.map((p) => p[0]).filter((p) => p !== 'invoice:pay');

export const MATRIX = {
  ADMIN: ALL,
  // Everything except user administration.
  OPS_MANAGER: ALL.filter((p) => p !== 'user:manage'),
  // Only their assigned leads and clients (scope is enforced in the guards).
  CONSULTANT: [
    'case:view', 'case:create', 'case:stage', 'item:upload', 'item:review', 'item:manage', 'onboarding:edit',
    'message:send', 'outbox:view', 'lead:view', 'lead:manage', 'lead:convert', 'invoice:view', 'letter:generate',
    'audit:view', 'demo:reset',
  ],
  // Review queue across all cases. Read-only on sales and payment data.
  DOCUMENT_SPECIALIST: [
    'case:view', 'item:upload', 'item:review', 'item:manage', 'onboarding:edit', 'pack:generate', 'outbox:view',
    'lead:view', 'invoice:view', 'letter:generate', 'audit:view',
  ],
  CLIENT: ['case:view', 'item:upload', 'onboarding:edit', 'invoice:view', 'invoice:pay'],
};

/** Roles whose case and lead access is limited to records assigned to them. */
export const ASSIGNED_ONLY = ['CONSULTANT'];

export function can(user, permission) {
  return !!user && (MATRIX[user.role] || []).includes(permission);
}

/** Whether a staff user may see a record assigned to `assignedToId`. */
export function staffScopeOk(user, assignedToId) {
  return !ASSIGNED_ONLY.includes(user.role) || user.id === assignedToId;
}
