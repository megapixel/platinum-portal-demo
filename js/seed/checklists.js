// seed: sample checklist lists. The client will confirm the real ones (TBC).
const PASSPORT_FIELDS = ['full name', 'passport number', 'date of birth', 'nationality', 'expiry date'];
export const PR_ITEMS = [
  ['PASSPORT', 'Passport (bio page)', 'Clear colour scan of the page with your photo and personal details.', true, 'passport', PASSPORT_FIELDS],
  ['WORK_PASS', 'Current work pass card', 'Front and back of your Employment Pass or S Pass card.', true, 'work_pass', ['full name', 'FIN', 'pass type', 'expiry date']],
  ['BIRTH_CERT', 'Birth certificate', 'Official birth certificate. Include a certified English translation if it is not in English.', true, 'birth_certificate', ['full name', 'date of birth', 'place of birth', "parents' names"]],
  ['EDU_CERT', 'Highest educational certificate and transcript', 'Degree or diploma certificate together with the full transcript.', true, 'education', ['full name', 'institution', 'qualification', 'date awarded']],
  ['PAYSLIPS', 'Latest 6 months payslips', 'One PDF with your six most recent monthly payslips.', true, 'payslip', ['employee name', 'employer name', 'pay period', 'gross salary']],
  ['EMPLOYER_LETTER', 'Employer letter stating position, salary and start date', 'Signed letter on company letterhead, dated within the last 3 months.', true, 'employer_letter', ['employee name', 'position', 'monthly salary', 'start date', 'signatory']],
  ['NOA', 'Latest income tax Notice of Assessment', 'Download it from the IRAS myTax Portal.', true, 'noa', ['taxpayer name', 'year of assessment', 'assessable income', 'tax payable']],
  ['PHOTO', 'Recent passport-sized photo', 'Taken within the last 3 months on a plain white background.', true, 'photo', ['face clearly visible', 'plain white background']],
  ['MARRIAGE_CERT', 'Marriage certificate (if married)', 'Only needed if you are married.', false, 'marriage_certificate', ['names of both parties', 'date of marriage', 'place of registration']],
];
export const CITIZENSHIP_EXTRA = [
  ['NRIC', 'NRIC (PR)', 'Front and back of your blue PR identity card.', true, 'nric', ['full name', 'NRIC number', 'date of birth', 'address']],
  ['REP', 'Re-Entry Permit', 'Your current Re-Entry Permit.', true, 'reentry_permit', ['full name', 'REP number', 'expiry date']],
  ['CPF', 'CPF contribution statement', '12 month contribution history from the CPF website.', true, 'cpf', ['member name', 'statement period', 'employer contributions']],
];
export const DEPENDANT_ITEMS = [
  ['PASSPORT', 'Passport (bio page)', 'Bio page of the dependant\'s passport.', true, 'passport', PASSPORT_FIELDS],
  ['BIRTH_CERT', 'Birth certificate', 'Official birth certificate with English translation if needed.', true, 'birth_certificate', ['full name', 'date of birth', 'place of birth', "parents' names"]],
  ['PHOTO', 'Recent passport-sized photo', 'Taken within the last 3 months on a plain white background.', true, 'photo', ['face clearly visible', 'plain white background']],
];

function tplItems(templateId, rows, appliesTo, codePrefix, startOrder) {
  return rows.map((r, i) => ({
    id: `${templateId}_${codePrefix}${r[0]}`,
    code: codePrefix + r[0],
    label: r[1],
    description: r[2],
    required: r[3],
    appliesTo,
    sortOrder: startOrder + i,
    docType: r[4],
    requiredFields: r[5].slice(),
  }));
}

export function seedTemplates() {
  const pr = { id: 'tpl_pr', caseType: 'PR', name: 'PR application', items: tplItems('tpl_pr', PR_ITEMS, 'MAIN', '', 1) };
  const cit = {
    id: 'tpl_cit', caseType: 'CITIZENSHIP', name: 'Citizenship application',
    items: tplItems('tpl_cit', PR_ITEMS, 'MAIN', '', 1).concat(tplItems('tpl_cit', CITIZENSHIP_EXTRA, 'MAIN', '', 20)),
  };
  const dep = {
    id: 'tpl_dep', caseType: 'PR_WITH_DEPENDANTS', name: 'PR application with dependants',
    items: tplItems('tpl_dep', PR_ITEMS, 'MAIN', '', 1)
      .concat(tplItems('tpl_dep', DEPENDANT_ITEMS, 'SPOUSE', 'SPOUSE_', 40))
      .concat(tplItems('tpl_dep', DEPENDANT_ITEMS, 'CHILD', 'CHILD_', 60)),
  };
  return [pr, cit, dep];
}

// Onboarding information form, one definition per case type (TBC with the client).
const FORM_SECTIONS = [
  { key: 'PERSONAL', label: 'Personal particulars', fields: [
    { key: 'full_name', label: 'Full name (as in passport)', type: 'text', required: true },
    { key: 'dob', label: 'Date of birth', type: 'date', required: true },
    { key: 'nationality', label: 'Nationality', type: 'text', required: true },
    { key: 'marital_status', label: 'Marital status', type: 'select', required: true, options: ['Single', 'Married', 'Divorced', 'Widowed'] },
    { key: 'pass_type', label: 'Current pass type', type: 'select', required: true, options: ['Employment Pass', 'S Pass', 'Dependant Pass', 'Long-Term Visit Pass', 'Work Permit', 'Other'] },
    { key: 'pass_expiry', label: 'Pass expiry date', type: 'date', required: false },
  ] },
  { key: 'FAMILY', label: 'Family', fields: [
    { key: 'spouse_name', label: 'Spouse name (if any)', type: 'text', required: false },
    { key: 'children_count', label: 'Number of children', type: 'number', required: false },
    { key: 'family_in_sg', label: 'Family members living in Singapore', type: 'textarea', required: false },
  ] },
  { key: 'EMPLOYMENT', label: 'Employment', fields: [
    { key: 'employer', label: 'Current employer', type: 'text', required: true },
    { key: 'position', label: 'Job title', type: 'text', required: true },
    { key: 'monthly_salary', label: 'Monthly salary (SGD)', type: 'number', required: true },
    { key: 'employment_start', label: 'Employment start date', type: 'date', required: false },
  ] },
  { key: 'EDUCATION', label: 'Education', fields: [
    { key: 'highest_qualification', label: 'Highest qualification', type: 'text', required: true },
    { key: 'institution', label: 'Institution', type: 'text', required: true },
    { key: 'graduation_year', label: 'Year awarded', type: 'number', required: false },
  ] },
  { key: 'ADDRESS', label: 'Address history', fields: [
    { key: 'address_sg', label: 'Current address in Singapore', type: 'textarea', required: true },
    { key: 'years_in_sg', label: 'Years living in Singapore', type: 'number', required: true },
    { key: 'address_home', label: 'Home country address', type: 'textarea', required: false },
  ] },
];

export function seedFormDefs() {
  const clone = () => JSON.parse(JSON.stringify(FORM_SECTIONS));
  return [
    { id: 'form_pr', caseType: 'PR', name: 'PR application form', sections: clone() },
    { id: 'form_cit', caseType: 'CITIZENSHIP', name: 'Citizenship application form', sections: clone() },
    { id: 'form_dep', caseType: 'PR_WITH_DEPENDANTS', name: 'PR with dependants form', sections: clone() },
  ];
}
