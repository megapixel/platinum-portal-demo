// seed: staff, the 8 active demo clients and their cases.
import { STAGES, STAGE_INDEX, DAY } from '../domain.js';
import { uid, nowIso, daysAgo, startOfDay } from '../utils.js';
import { mockAnalyse } from '../ai.js';
import { personList, instantiateItems, defaultTargetDate } from '../caselogic.js';

export const SEED_STAFF = [
  { id: 'u_admin', name: 'Priscilla Ong', email: 'admin@demo.sg', role: 'ADMIN', phone: '+65 6123 4510', createdAt: daysAgo(500) },
  { id: 'u_ops', name: 'Marcus Teo', email: 'ops@demo.sg', role: 'OPS_MANAGER', phone: '+65 6123 4511', createdAt: daysAgo(450) },
  { id: 'u_staff', name: 'Daniel Koh', email: 'consultant1@demo.sg', aliases: ['staff@demo.sg'], role: 'CONSULTANT', phone: '+65 6123 4500', createdAt: daysAgo(400) },
  { id: 'u_sarah', name: 'Sarah Lim', email: 'consultant2@demo.sg', aliases: ['sarah@demo.sg'], role: 'CONSULTANT', phone: '+65 6123 4501', createdAt: daysAgo(300) },
  { id: 'u_specialist', name: 'Grace Wong', email: 'specialist@demo.sg', role: 'DOCUMENT_SPECIALIST', phone: '+65 6123 4512', createdAt: daysAgo(350) },
];

// Client profiles feed the mock AI so "extracted" fields look plausible.
export const SEED_CLIENTS = [
  {
    id: 'u_elizabeth', name: 'Elizabeth Tan', email: 'elizabeth@demo.sg', phone: '+65 9123 4567',
    secondary: { id: 'u_elizabeth_spouse', name: 'Jonathan Lee', email: 'elizabeth.spouse@demo.sg', phone: '+65 9123 4568' },
    profile: { dob: '1990-03-14', nationality: 'Malaysian', birthPlace: 'Penang, Malaysia', employer: 'Nexora Analytics Pte Ltd', position: 'Senior Data Analyst', salary: '7,800', institution: 'Universiti Sains Malaysia', qualification: 'BSc (Hons) Statistics', passportNo: 'A41237788' },
    case: { id: 'PIC-2026-0142', caseType: 'PR', stage: 'COLLECTING_DOCUMENTS', startDaysAgo: 36, staff: 'u_staff', married: false,
      default: 'ACCEPTED',
      overrides: {
        PASSPORT: { status: 'PENDING' },
        PAYSLIPS: { status: 'PENDING' },
        EMPLOYER_LETTER: { status: 'REJECTED', rejectedDaysAgo: 3, remark: 'Letter is unsigned. Please upload a signed copy on company letterhead.' },
      } },
  },
  {
    id: 'u_ahmad', name: 'Ahmad Faizal bin Rahman', email: 'ahmad@demo.sg', phone: '+65 8234 1188',
    profile: { dob: '1986-11-02', nationality: 'Malaysian', birthPlace: 'Johor Bahru, Malaysia', employer: 'Keppel Marine Services', position: 'Project Engineer', salary: '6,400', institution: 'Universiti Teknologi Malaysia', qualification: 'BEng Mechanical Engineering', passportNo: 'A30984412' },
    onboarding: 'EMPTY',
    case: { id: 'PIC-2026-0157', caseType: 'CITIZENSHIP', stage: 'COLLECTING_DOCUMENTS', startDaysAgo: 4, staff: 'u_staff', married: false, default: 'PENDING', overrides: {} },
  },
  {
    id: 'u_nurul', name: 'Nurul Aisyah binti Hassan', email: 'nurul@demo.sg', phone: '+65 9786 2210',
    profile: { dob: '1988-07-21', nationality: 'Malaysian', birthPlace: 'Kuala Lumpur, Malaysia', employer: 'Halcyon Biotech Pte Ltd', position: 'Research Scientist', salary: '8,900', institution: 'Universiti Malaya', qualification: 'PhD Biochemistry', passportNo: 'A27741290' },
    dependants: [
      { relation: 'SPOUSE', name: 'Muhammad Hafiz bin Ismail', dob: '1985-02-10', nationality: 'Malaysian' },
      { relation: 'CHILD', name: 'Aisyah Sofea binti Muhammad Hafiz', dob: '2019-09-05', nationality: 'Malaysian' },
    ],
    case: { id: 'PIC-2026-0118', caseType: 'PR_WITH_DEPENDANTS', stage: 'COLLECTING_DOCUMENTS', startDaysAgo: 51, staff: 'u_sarah', married: true,
      default: 'PENDING',
      overrides: {
        PASSPORT: { status: 'ACCEPTED' }, WORK_PASS: { status: 'ACCEPTED' }, BIRTH_CERT: { status: 'ACCEPTED' },
        EDU_CERT: { status: 'ACCEPTED' }, MARRIAGE_CERT: { status: 'ACCEPTED' }, PHOTO: { status: 'ACCEPTED' },
        PAYSLIPS: { status: 'UPLOADED', uploadedDaysAgo: 1 },
        SPOUSE_PASSPORT: { status: 'AI_FLAGGED', uploadedDaysAgo: 2, blurry: true },
      } },
  },
  {
    id: 'u_weiling', name: 'Chong Wei Ling', email: 'weiling@demo.sg', phone: '+65 9011 7743',
    profile: { dob: '1992-01-30', nationality: 'Malaysian', birthPlace: 'Ipoh, Malaysia', employer: 'Lumen Fintech Pte Ltd', position: 'Product Manager', salary: '9,200', institution: 'Monash University Malaysia', qualification: 'BBus Marketing', passportNo: 'A55120931' },
    case: { id: 'PIC-2026-0097', caseType: 'PR', stage: 'COLLECTING_DOCUMENTS', startDaysAgo: 66, staff: 'u_staff', married: false,
      default: 'ACCEPTED', overrides: { NOA: { status: 'PENDING' }, PHOTO: { status: 'PENDING' } } },
  },
  {
    id: 'u_rizal', name: 'Rizal Santos', email: 'rizal@demo.sg', phone: '+65 8812 9034',
    profile: { dob: '1984-05-17', nationality: 'Filipino', birthPlace: 'Cebu City, Philippines', employer: 'Arcturus Shipping Pte Ltd', position: 'Operations Manager', salary: '8,100', institution: 'University of San Carlos', qualification: 'BS Industrial Engineering', passportNo: 'P2203917B' },
    case: { id: 'PIC-2026-0126', caseType: 'CITIZENSHIP', stage: 'COLLECTING_DOCUMENTS', startDaysAgo: 30, staff: 'u_sarah', married: false,
      default: 'PENDING',
      overrides: {
        PASSPORT: { status: 'ACCEPTED' }, WORK_PASS: { status: 'ACCEPTED' }, BIRTH_CERT: { status: 'ACCEPTED' },
        EDU_CERT: { status: 'ACCEPTED' }, NRIC: { status: 'ACCEPTED' }, REP: { status: 'ACCEPTED' },
        CPF: { status: 'REJECTED', rejectedDaysAgo: 10, remark: 'Statement covers only 3 months. Please download the full 12 month statement.' },
      } },
  },
  {
    id: 'u_priya', name: 'Priya Ramasamy', email: 'priya@demo.sg', phone: '+65 9345 6620',
    profile: { dob: '1991-12-08', nationality: 'Malaysian', birthPlace: 'Klang, Malaysia', employer: 'Meridian Health Group', position: 'Clinical Pharmacist', salary: '7,300', institution: 'International Medical University', qualification: 'BPharm (Hons)', passportNo: 'A60471125' },
    case: { id: 'PIC-2026-0109', caseType: 'PR', stage: 'DOCUMENTS_COMPLETE', startDaysAgo: 40, staff: 'u_staff', married: false, default: 'ACCEPTED', overrides: {} },
  },
  {
    id: 'u_mai', name: 'Nguyen Thi Mai', email: 'mai@demo.sg', phone: '+65 8567 3301',
    profile: { dob: '1993-04-25', nationality: 'Vietnamese', birthPlace: 'Da Nang, Vietnam', employer: 'Solace Digital Pte Ltd', position: 'Software Engineer', salary: '8,500', institution: 'Hanoi University of Science and Technology', qualification: 'BEng Computer Science', passportNo: 'C8812045' },
    case: { id: 'PIC-2026-0081', caseType: 'PR', stage: 'REVIEW_AND_PREPARATION', startDaysAgo: 70, staff: 'u_sarah', married: false, default: 'ACCEPTED', overrides: {} },
  },
  {
    id: 'u_kittisak', name: 'Kittisak Wongsawat', email: 'kittisak@demo.sg', phone: '+65 9670 4482',
    profile: { dob: '1983-08-19', nationality: 'Thai', birthPlace: 'Chiang Mai, Thailand', employer: 'Siam Precision Engineering (S) Pte Ltd', position: 'Regional Finance Director', salary: '14,500', institution: 'Chulalongkorn University', qualification: 'MBA', passportNo: 'AA3349810' },
    dependants: [
      { relation: 'SPOUSE', name: 'Siriporn Wongsawat', dob: '1986-03-02', nationality: 'Thai' },
      { relation: 'CHILD', name: 'Nattapong Wongsawat', dob: '2016-06-14', nationality: 'Thai' },
    ],
    case: { id: 'PIC-2026-0044', caseType: 'PR_WITH_DEPENDANTS', stage: 'SUBMITTED', startDaysAgo: 120, staff: 'u_staff', married: true, default: 'ACCEPTED', overrides: {} },
  },
];

/** Answers for the onboarding form, derived from the client profile. */
export function profileToFormData(client, married) {
  const p = client.profile || {};
  const deps = client.dependants || [];
  const spouse = deps.find((d) => d.relation === 'SPOUSE');
  return {
    full_name: client.name, dob: p.dob || '', nationality: p.nationality || '',
    marital_status: married ? 'Married' : 'Single', pass_type: 'Employment Pass',
    pass_expiry: '', spouse_name: spouse ? spouse.name : '', children_count: String(deps.filter((d) => d.relation === 'CHILD').length),
    family_in_sg: '', employer: p.employer || '', position: p.position || '', monthly_salary: String(p.salary || '').replace(/,/g, ''),
    employment_start: '', highest_qualification: p.qualification || '', institution: p.institution || '', graduation_year: '',
    address_sg: 'Blk 123 Ang Mo Kio Ave 3, #08-411', years_in_sg: '6', address_home: p.birthPlace || '',
  };
}

export function seedCase(d, client, clientId) {
  const spec = client.case;
  const startDate = startOfDay(daysAgo(spec.startDaysAgo)).toISOString();
  const caseRec = {
    id: spec.id, clientId, caseType: spec.caseType, stage: spec.stage, attempt: 1,
    assignedStaffId: spec.staff, startDate, targetSubmissionDate: defaultTargetDate(startDate),
    married: spec.married, dependants: client.dependants || [], createdAt: startDate,
    sourceLeadId: null, packageId: null, legacyDriveUrl: '', remindersPaused: false,
    onboarding: client.onboarding === 'EMPTY'
      ? { data: {}, status: 'DRAFT', updatedAt: startDate, updatedById: null, submittedAt: null }
      : { data: profileToFormData(client, spec.married), status: 'SUBMITTED', updatedAt: startDate, updatedById: clientId, submittedAt: startDate },
  };
  d.cases.push(caseRec);
  const template = d.templates.find((t) => t.caseType === spec.caseType);
  const people = personList(client);
  const items = instantiateItems(template, caseRec, people, spec.married);
  const clientUserId = client.id;

  items.forEach((it, idx) => {
    const o = spec.overrides[it.code] || {};
    const status = o.status || spec.default;
    it.status = status;
    if (status === 'PENDING') return;
    const person = people.find((p) => p.label === it.personLabel);
    const uploadedDaysAgo = o.uploadedDaysAgo != null ? o.uploadedDaysAgo
      : Math.max(1, spec.startDaysAgo - 3 - (idx % 9) * 2);
    const uploadedAt = new Date(Date.now() - uploadedDaysAgo * DAY - (idx * 37 % 600) * 60000).toISOString();
    const ext = ['photo', 'passport'].includes(it.docType) ? 'jpg' : 'pdf';
    const fileName = `${it.docType}_${person.name.split(' ')[0].toLowerCase()}${o.blurry ? '_blurry' : ''}.${ext}`;
    const result = mockAnalyse({ fileName, docType: it.docType, label: it.label, requiredFields: it.requiredFields, person });
    // Every fourth document was uploaded by the consultant on the client's behalf.
    const onBehalf = idx % 4 === 3;
    d.documents.push({
      id: `doc_${it.id}`, itemId: it.id, caseId: caseRec.id, fileName, version: 1,
      mimeType: ext === 'pdf' ? 'application/pdf' : 'image/jpeg', size: 180000 + (idx * 7919) % 400000,
      uploadedAt, source: 'seed',
      uploadedById: onBehalf ? spec.staff : clientUserId,
      uploadedBy: { userId: onBehalf ? spec.staff : clientUserId, role: onBehalf ? 'CONSULTANT' : 'CLIENT', onBehalf },
      aiDetectedType: result.detectedType, aiConfidence: result.confidence, aiMatches: result.matchesExpected,
      aiExtracted: result.extracted, aiIssues: result.issues, aiCheckedAt: uploadedAt,
    });
    it.updatedAt = uploadedAt;
    if (status === 'ACCEPTED') {
      const at = new Date(new Date(uploadedAt).getTime() + DAY).toISOString();
      it.updatedAt = at < nowIso() ? at : uploadedAt;
      d.audit.push({ id: uid('au'), caseId: caseRec.id, itemId: it.id, action: 'ACCEPTED', detail: `${it.label} (${it.personLabel})`, actorId: spec.staff, at: it.updatedAt, before: { status: 'UPLOADED' }, after: { status: 'ACCEPTED' } });
    }
    if (status === 'REJECTED') {
      it.staffRemark = o.remark;
      it.rejectedAt = daysAgo(o.rejectedDaysAgo || 2);
      it.updatedAt = it.rejectedAt;
      d.audit.push({ id: uid('au'), caseId: caseRec.id, itemId: it.id, action: 'REJECTED', detail: `${it.label} (${it.personLabel}): ${o.remark}`, actorId: spec.staff, at: it.rejectedAt, before: { status: 'UPLOADED' }, after: { status: 'REJECTED' } });
    }
  });
  d.items.push(...items);
  // Seeded uploads were already reviewed, so they are not offered for "submit for review".
  d.reviewTasks.push({ id: uid('rt'), caseId: caseRec.id, createdAt: nowIso(), createdById: clientUserId, status: 'DONE', itemIds: [], doneAt: nowIso() });

  // Backfill stage history up to the current stage.
  const target = STAGE_INDEX[spec.stage];
  for (let i = 0; i <= target; i++) {
    const at = i === 0 ? startDate : new Date(new Date(startDate).getTime() + Math.min(spec.startDaysAgo - 1, i === 1 ? 1 : 30 + i * 8) * DAY).toISOString();
    d.stageHistory.push({ id: uid('sh'), caseId: caseRec.id, stage: STAGES[i].key, changedAt: at, changedById: spec.staff });
  }
  return caseRec;
}

/** Creates the Client record and login user(s) for a seed client, then its case. */
export function seedClient(d, c) {
  const clientId = 'cl_' + c.id.replace(/^u_/, '');
  const contacts = [{ userId: c.id, kind: 'PRIMARY' }];
  d.users.push({ id: c.id, name: c.name, email: c.email, password: 'demo1234', role: 'CLIENT', phone: c.phone, clientId, contactKind: 'PRIMARY', createdAt: daysAgo(c.case.startDaysAgo + 2) });
  if (c.secondary) {
    contacts.push({ userId: c.secondary.id, kind: 'SECONDARY' });
    d.users.push({ id: c.secondary.id, name: c.secondary.name, email: c.secondary.email, password: 'demo1234', role: 'CLIENT', phone: c.secondary.phone, clientId, contactKind: 'SECONDARY', createdAt: daysAgo(c.case.startDaysAgo + 1) });
  }
  d.clients.push({
    id: clientId, name: c.name, profile: c.profile, dependants: c.dependants || [],
    channelPref: 'WHATSAPP', contacts, createdAt: daysAgo(c.case.startDaysAgo + 2),
  });
  return seedCase(d, c, clientId);
}
