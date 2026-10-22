// domain: constants shared by every module. No state here.

export const STAGES = [
  { key: 'ONBOARDED', label: 'Onboarded', client: 'Engaged and welcome sent' },
  { key: 'COLLECTING_DOCUMENTS', label: 'Collecting documents', client: 'Document collection' },
  { key: 'DOCUMENTS_COMPLETE', label: 'Documents complete', client: 'All documents received' },
  { key: 'REVIEW_AND_PREPARATION', label: 'Review and preparation', client: 'Consultant review and application preparation' },
  { key: 'SUBMITTED', label: 'Submitted', client: 'Submitted to authority' },
  { key: 'OUTCOME', label: 'Outcome', client: 'Outcome received' },
];
export const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));

export const STATUS = {
  PENDING: { label: 'Pending', tone: 'grey' },
  UPLOADED: { label: 'Under review', tone: 'blue' },
  AI_FLAGGED: { label: 'Needs attention', tone: 'amber' },
  ACCEPTED: { label: 'Accepted', tone: 'green' },
  REJECTED: { label: 'Rejected', tone: 'red' },
};
export const CLIENT_ACTION_STATUSES = ['PENDING', 'REJECTED', 'AI_FLAGGED'];

export const CASE_TYPES = {
  PR: { label: 'PR application', short: 'PR', inMessage: 'PR' },
  CITIZENSHIP: { label: 'Citizenship application', short: 'Citizenship', inMessage: 'citizenship' },
  PR_WITH_DEPENDANTS: { label: 'PR application with dependants', short: 'PR + dependants', inMessage: 'PR (with dependants)' },
};

// Roles. The permission matrix lives in auth/permissions.js.
export const ROLES = {
  ADMIN: { label: 'Admin', staff: true },
  OPS_MANAGER: { label: 'Operations manager', staff: true },
  CONSULTANT: { label: 'Consultant', staff: true },
  DOCUMENT_SPECIALIST: { label: 'Document specialist', staff: true },
  CLIENT: { label: 'Client', staff: false },
};
export const isStaffRole = (role) => !!(ROLES[role] && ROLES[role].staff);

// Lead pipeline.
export const LEAD_STAGES = [
  { key: 'NEW', label: 'New' },
  { key: 'CONTACTED', label: 'Contacted' },
  { key: 'CONSULTATION_BOOKED', label: 'Consultation booked' },
  { key: 'PROPOSAL_SENT', label: 'Proposal sent' },
  { key: 'WON', label: 'Won' },
  { key: 'LOST', label: 'Lost' },
];
export const LEAD_STAGE_LABEL = Object.fromEntries(LEAD_STAGES.map((s) => [s.key, s.label]));
export const INTERESTS = ['PR', 'Citizenship', 'Business ownership to PR', 'Other'];
export const PASS_TYPES = ['Employment Pass', 'S Pass', 'Dependant Pass', 'Long-Term Visit Pass', 'Work Permit', 'Student Pass', 'Other'];
export const LOST_REASONS = ['Price too high', 'Chose another firm', 'Not eligible', 'No response', 'Timing not right', 'Other'];

// Document types the AI reader knows about. `words` drive the offline mock.
export const DOC_TYPES = {
  passport: { label: 'passport bio page', words: ['passport'] },
  work_pass: { label: 'work pass card', words: ['work_pass', 'workpass', 'employment_pass', 'spass', 'epass', 'ep_card'] },
  birth_certificate: { label: 'birth certificate', words: ['birth'] },
  education: { label: 'educational certificate', words: ['degree', 'transcript', 'diploma', 'education', 'graduation'] },
  payslip: { label: 'payslip', words: ['payslip', 'payslips', 'pay_slip', 'salary_slip'] },
  employer_letter: { label: 'employer letter', words: ['employer_letter', 'employment_letter', 'employer', 'letter'] },
  noa: { label: 'income tax Notice of Assessment', words: ['noa', 'notice_of_assessment', 'assessment', 'iras'] },
  photo: { label: 'passport-sized photo', words: ['photo', 'headshot'] },
  marriage_certificate: { label: 'marriage certificate', words: ['marriage'] },
  nric: { label: 'NRIC', words: ['nric'] },
  reentry_permit: { label: 'Re-Entry Permit', words: ['reentry', 're_entry', 'rep'] },
  cpf: { label: 'CPF contribution statement', words: ['cpf'] },
  other: { label: 'document', words: [] },
};
// Order matters: more specific types are checked first.
export const DETECT_ORDER = ['marriage_certificate', 'birth_certificate', 'photo', 'passport', 'payslip', 'work_pass',
  'education', 'noa', 'nric', 'reentry_permit', 'cpf', 'employer_letter'];

// Reasons a specialist picks when rejecting a document. `nextStep` is shown to the client.
export const REJECT_REASONS = [
  { key: 'BLURRY', label: 'Blurry', text: 'The image is blurry.', nextStep: 'Take a new photo in good light, or scan the document, and make sure all text is sharp.' },
  { key: 'CROPPED', label: 'Cropped', text: 'Part of the document is cropped.', nextStep: 'Upload the full page with all four corners visible.' },
  { key: 'EXPIRED', label: 'Expired', text: 'The document has expired.', nextStep: 'Upload a document that is still valid.' },
  { key: 'WRONG_DOCUMENT', label: 'Wrong document', text: 'This is not the document we asked for.', nextStep: 'Check the description on your checklist and upload the correct document.' },
  { key: 'NAME_MISMATCH', label: 'Name mismatch', text: 'The name does not match your information form.', nextStep: 'Check the spelling on your information form, or upload a document that shows your full legal name.' },
  { key: 'OTHER', label: 'Other', text: '', nextStep: 'Please upload a new copy.' },
];
export const REJECT_REASON = Object.fromEntries(REJECT_REASONS.map((r) => [r.key, r]));

export const ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const DAY = 86400000;
