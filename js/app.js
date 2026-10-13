/*
 * Platinum Immigration - Client Document Portal (HTML prototype)
 * Ref: Q202607041IMMIGRATION. Prepared by Megapixel Consulting & Solutions Pte Ltd.
 *
 * One classic script, no build step, no network. Each section below stands in for a
 * production module (see ARCHITECTURE.md): domain, seed, store, auth, metrics, storage,
 * ai, messaging, crm, reminders, api (guarded "routes"), views.
 */
(function () {
  'use strict';

  // ======================================================================
  // domain
  // ======================================================================
  const STAGES = [
    { key: 'ONBOARDED', label: 'Onboarded', client: 'Engaged and welcome sent' },
    { key: 'COLLECTING_DOCUMENTS', label: 'Collecting documents', client: 'Document collection' },
    { key: 'DOCUMENTS_COMPLETE', label: 'Documents complete', client: 'All documents received' },
    { key: 'REVIEW_AND_PREPARATION', label: 'Review and preparation', client: 'Consultant review and application preparation' },
    { key: 'SUBMITTED', label: 'Submitted', client: 'Submitted to authority' },
    { key: 'OUTCOME', label: 'Outcome', client: 'Outcome received' },
  ];
  const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));

  const STATUS = {
    PENDING: { label: 'Pending', tone: 'grey' },
    UPLOADED: { label: 'Under review', tone: 'blue' },
    AI_FLAGGED: { label: 'Needs attention', tone: 'amber' },
    ACCEPTED: { label: 'Accepted', tone: 'green' },
    REJECTED: { label: 'Rejected', tone: 'red' },
  };
  const CLIENT_ACTION_STATUSES = ['PENDING', 'REJECTED', 'AI_FLAGGED'];

  const CASE_TYPES = {
    PR: { label: 'PR application', short: 'PR', inMessage: 'PR' },
    CITIZENSHIP: { label: 'Citizenship application', short: 'Citizenship', inMessage: 'citizenship' },
    PR_WITH_DEPENDANTS: { label: 'PR application with dependants', short: 'PR + dependants', inMessage: 'PR (with dependants)' },
  };

  // Document types the AI reader knows about. `words` drive the offline mock.
  const DOC_TYPES = {
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
  const DETECT_ORDER = ['marriage_certificate', 'birth_certificate', 'photo', 'passport', 'payslip', 'work_pass',
    'education', 'noa', 'nric', 'reentry_permit', 'cpf', 'employer_letter'];

  const ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png'];
  const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
  const DAY = 86400000;

  // ======================================================================
  // utils
  // ======================================================================
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  let idCounter = 0;
  const uid = (p) => `${p}_${Date.now().toString(36)}${(idCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const nowIso = () => new Date().toISOString();
  const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addMonths = (iso, n) => { const d = new Date(iso); d.setMonth(d.getMonth() + n); return d.toISOString(); };
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';
  const fmtDateTime = (iso) => iso ? new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
  const firstName = (name) => String(name).split(' ')[0];
  function relTime(iso) {
    if (!iso) return '-';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} h ago`;
    const days = Math.round(hrs / 24);
    return days === 1 ? 'yesterday' : `${days} days ago`;
  }
  function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function safeGet(storageObj, key) { try { return storageObj.getItem(key); } catch (e) { return null; } }
  function safeSet(storageObj, key, val) { try { storageObj.setItem(key, val); return true; } catch (e) { return false; } }
  function safeRemove(storageObj, key) { try { storageObj.removeItem(key); } catch (e) { /* ignore */ } }

  class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  // ======================================================================
  // seed (sample checklist lists; the client will confirm the real ones)
  // ======================================================================
  const PASSPORT_FIELDS = ['full name', 'passport number', 'date of birth', 'nationality', 'expiry date'];
  const PR_ITEMS = [
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
  const CITIZENSHIP_EXTRA = [
    ['NRIC', 'NRIC (PR)', 'Front and back of your blue PR identity card.', true, 'nric', ['full name', 'NRIC number', 'date of birth', 'address']],
    ['REP', 'Re-Entry Permit', 'Your current Re-Entry Permit.', true, 'reentry_permit', ['full name', 'REP number', 'expiry date']],
    ['CPF', 'CPF contribution statement', '12 month contribution history from the CPF website.', true, 'cpf', ['member name', 'statement period', 'employer contributions']],
  ];
  const DEPENDANT_ITEMS = [
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

  function seedTemplates() {
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

  // Client profiles feed the mock AI so "extracted" fields look plausible.
  const SEED_CLIENTS = [
    {
      id: 'u_elizabeth', name: 'Elizabeth Tan', email: 'elizabeth@demo.sg', phone: '+65 9123 4567',
      profile: { dob: '1990-03-14', nationality: 'Malaysian', birthPlace: 'Penang, Malaysia', employer: 'Nexora Analytics Pte Ltd', position: 'Senior Data Analyst', salary: '7,800', institution: 'Universiti Sains Malaysia', qualification: 'BSc (Hons) Statistics', passportNo: 'A41237788' },
      case: { id: 'PI26-0142', caseType: 'PR', stage: 'COLLECTING_DOCUMENTS', startDaysAgo: 36, staff: 'u_staff', married: false,
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
      case: { id: 'PI26-0157', caseType: 'CITIZENSHIP', stage: 'COLLECTING_DOCUMENTS', startDaysAgo: 4, staff: 'u_staff', married: false, default: 'PENDING', overrides: {} },
    },
    {
      id: 'u_nurul', name: 'Nurul Aisyah binti Hassan', email: 'nurul@demo.sg', phone: '+65 9786 2210',
      profile: { dob: '1988-07-21', nationality: 'Malaysian', birthPlace: 'Kuala Lumpur, Malaysia', employer: 'Halcyon Biotech Pte Ltd', position: 'Research Scientist', salary: '8,900', institution: 'Universiti Malaya', qualification: 'PhD Biochemistry', passportNo: 'A27741290' },
      dependants: [
        { relation: 'SPOUSE', name: 'Muhammad Hafiz bin Ismail', dob: '1985-02-10', nationality: 'Malaysian' },
        { relation: 'CHILD', name: 'Aisyah Sofea binti Muhammad Hafiz', dob: '2019-09-05', nationality: 'Malaysian' },
      ],
      case: { id: 'PI26-0118', caseType: 'PR_WITH_DEPENDANTS', stage: 'COLLECTING_DOCUMENTS', startDaysAgo: 51, staff: 'u_sarah', married: true,
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
      case: { id: 'PI26-0097', caseType: 'PR', stage: 'COLLECTING_DOCUMENTS', startDaysAgo: 66, staff: 'u_staff', married: false,
        default: 'ACCEPTED', overrides: { NOA: { status: 'PENDING' }, PHOTO: { status: 'PENDING' } } },
    },
    {
      id: 'u_rizal', name: 'Rizal Santos', email: 'rizal@demo.sg', phone: '+65 8812 9034',
      profile: { dob: '1984-05-17', nationality: 'Filipino', birthPlace: 'Cebu City, Philippines', employer: 'Arcturus Shipping Pte Ltd', position: 'Operations Manager', salary: '8,100', institution: 'University of San Carlos', qualification: 'BS Industrial Engineering', passportNo: 'P2203917B' },
      case: { id: 'PI26-0126', caseType: 'CITIZENSHIP', stage: 'COLLECTING_DOCUMENTS', startDaysAgo: 30, staff: 'u_sarah', married: false,
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
      case: { id: 'PI26-0109', caseType: 'PR', stage: 'DOCUMENTS_COMPLETE', startDaysAgo: 40, staff: 'u_staff', married: false, default: 'ACCEPTED', overrides: {} },
    },
    {
      id: 'u_mai', name: 'Nguyen Thi Mai', email: 'mai@demo.sg', phone: '+65 8567 3301',
      profile: { dob: '1993-04-25', nationality: 'Vietnamese', birthPlace: 'Da Nang, Vietnam', employer: 'Solace Digital Pte Ltd', position: 'Software Engineer', salary: '8,500', institution: 'Hanoi University of Science and Technology', qualification: 'BEng Computer Science', passportNo: 'C8812045' },
      case: { id: 'PI26-0081', caseType: 'PR', stage: 'REVIEW_AND_PREPARATION', startDaysAgo: 70, staff: 'u_sarah', married: false, default: 'ACCEPTED', overrides: {} },
    },
    {
      id: 'u_kittisak', name: 'Kittisak Wongsawat', email: 'kittisak@demo.sg', phone: '+65 9670 4482',
      profile: { dob: '1983-08-19', nationality: 'Thai', birthPlace: 'Chiang Mai, Thailand', employer: 'Siam Precision Engineering (S) Pte Ltd', position: 'Regional Finance Director', salary: '14,500', institution: 'Chulalongkorn University', qualification: 'MBA', passportNo: 'AA3349810' },
      dependants: [
        { relation: 'SPOUSE', name: 'Siriporn Wongsawat', dob: '1986-03-02', nationality: 'Thai' },
        { relation: 'CHILD', name: 'Nattapong Wongsawat', dob: '2016-06-14', nationality: 'Thai' },
      ],
      case: { id: 'PI26-0044', caseType: 'PR_WITH_DEPENDANTS', stage: 'SUBMITTED', startDaysAgo: 120, staff: 'u_staff', married: true, default: 'ACCEPTED', overrides: {} },
    },
  ];

  function buildSeed() {
    const d = {
      version: 1,
      seededAt: nowIso(),
      users: [
        { id: 'u_staff', name: 'Daniel Koh', email: 'staff@demo.sg', password: 'demo1234', role: 'STAFF', phone: '+65 6123 4500', createdAt: daysAgo(400) },
        { id: 'u_sarah', name: 'Sarah Lim', email: 'sarah@demo.sg', password: 'demo1234', role: 'STAFF', phone: '+65 6123 4501', createdAt: daysAgo(300) },
      ],
      templates: seedTemplates(),
      cases: [], items: [], documents: [], stageHistory: [], audit: [], outbox: [],
    };
    for (const c of SEED_CLIENTS) {
      d.users.push({ id: c.id, name: c.name, email: c.email, password: 'demo1234', role: 'CLIENT', phone: c.phone, profile: c.profile, createdAt: daysAgo(c.case.startDaysAgo + 2) });
      seedCase(d, c);
    }
    return d;
  }

  function personList(client) {
    const people = [{ label: 'Main applicant', appliesTo: 'MAIN', name: client.name, profile: client.profile }];
    let child = 0;
    for (const dep of client.dependants || []) {
      if (dep.relation === 'SPOUSE') people.push({ label: 'Spouse', appliesTo: 'SPOUSE', name: dep.name, profile: dep });
      if (dep.relation === 'CHILD') people.push({ label: `Child ${++child}`, appliesTo: 'CHILD', name: dep.name, profile: dep });
    }
    return people;
  }

  // Turns a template into case checklist items (snapshotting labels so template edits only affect new cases).
  function instantiateItems(template, caseRec, people, married) {
    const items = [];
    for (const p of people) {
      for (const t of template.items.filter((x) => x.appliesTo === p.appliesTo)) {
        if (t.docType === 'marriage_certificate' && !married) continue;
        items.push({
          id: `${caseRec.id}_${t.code}${p.label.startsWith('Child') ? '_' + p.label.split(' ')[1] : ''}`,
          caseId: caseRec.id,
          templateItemId: t.id,
          code: t.code,
          label: t.label,
          description: t.description,
          // "If married" items become required once we know the client is married.
          required: t.docType === 'marriage_certificate' ? true : t.required,
          docType: t.docType,
          requiredFields: t.requiredFields.slice(),
          personLabel: p.label,
          personName: p.name,
          sortOrder: t.sortOrder,
          status: 'PENDING',
          staffRemark: null,
          rejectedAt: null,
          updatedAt: caseRec.createdAt,
        });
      }
    }
    return items;
  }

  function seedCase(d, client) {
    const spec = client.case;
    const startDate = startOfDay(daysAgo(spec.startDaysAgo)).toISOString();
    const caseRec = {
      id: spec.id, clientId: client.id, caseType: spec.caseType, stage: spec.stage,
      assignedStaffId: spec.staff, startDate, targetSubmissionDate: addMonths(startDate, 2),
      married: spec.married, dependants: client.dependants || [], createdAt: startDate,
    };
    d.cases.push(caseRec);
    const template = d.templates.find((t) => t.caseType === spec.caseType);
    const people = personList(client);
    const items = instantiateItems(template, caseRec, people, spec.married);

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
      d.documents.push({
        id: `doc_${it.id}`, itemId: it.id, caseId: caseRec.id, fileName,
        mimeType: ext === 'pdf' ? 'application/pdf' : 'image/jpeg', size: 180000 + (idx * 7919) % 400000,
        uploadedAt, source: 'seed',
        aiDetectedType: result.detectedType, aiConfidence: result.confidence, aiMatches: result.matchesExpected,
        aiExtracted: result.extracted, aiIssues: result.issues, aiCheckedAt: uploadedAt,
      });
      it.updatedAt = uploadedAt;
      if (status === 'ACCEPTED') {
        const at = new Date(new Date(uploadedAt).getTime() + DAY).toISOString();
        it.updatedAt = at < nowIso() ? at : uploadedAt;
        d.audit.push({ id: uid('au'), caseId: caseRec.id, itemId: it.id, action: 'ACCEPTED', detail: `${it.label} (${it.personLabel})`, actorId: spec.staff, at: it.updatedAt });
      }
      if (status === 'REJECTED') {
        it.staffRemark = o.remark;
        it.rejectedAt = daysAgo(o.rejectedDaysAgo || 2);
        it.updatedAt = it.rejectedAt;
        d.audit.push({ id: uid('au'), caseId: caseRec.id, itemId: it.id, action: 'REJECTED', detail: `${it.label} (${it.personLabel}): ${o.remark}`, actorId: spec.staff, at: it.rejectedAt });
      }
    });
    d.items.push(...items);

    // Backfill stage history up to the current stage.
    const target = STAGE_INDEX[spec.stage];
    for (let i = 0; i <= target; i++) {
      const at = i === 0 ? startDate : new Date(new Date(startDate).getTime() + Math.min(spec.startDaysAgo - 1, i === 1 ? 1 : 30 + i * 8) * DAY).toISOString();
      d.stageHistory.push({ id: uid('sh'), caseId: caseRec.id, stage: STAGES[i].key, changedAt: at, changedById: spec.staff });
    }
  }

  // ======================================================================
  // store (stands in for Prisma + SQLite)
  // ======================================================================
  const DB_KEY = 'pi_portal_db_v1';
  let db = null;

  const store = {
    load() {
      const raw = safeGet(window.localStorage, DB_KEY);
      if (raw) { try { db = JSON.parse(raw); return; } catch (e) { /* fall through to reseed */ } }
      store.reset();
    },
    /** Picks up writes from other tabs without ever reseeding. */
    reload() {
      const raw = safeGet(window.localStorage, DB_KEY);
      if (raw) { try { db = JSON.parse(raw); } catch (e) { /* keep in-memory copy */ } }
    },
    save() { safeSet(window.localStorage, DB_KEY, JSON.stringify(db)); },
    reset() {
      storage.clearAll();
      db = buildSeed();
      store.save();
    },
    user: (id) => db.users.find((u) => u.id === id),
    case: (id) => db.cases.find((c) => c.id === id),
    item: (id) => db.items.find((i) => i.id === id),
    itemsFor: (caseId) => db.items.filter((i) => i.caseId === caseId).sort((a, b) => a.sortOrder - b.sortOrder),
    docsFor: (itemId) => db.documents.filter((d) => d.itemId === itemId).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
    latestDoc: (itemId) => store.docsFor(itemId)[0] || null,
    audit(caseId, action, detail, actorId, itemId) {
      db.audit.push({ id: uid('au'), caseId, itemId: itemId || null, action, detail, actorId, at: nowIso() });
    },
  };

  // ======================================================================
  // storage (StorageProvider). Production: S3-compatible bucket in Singapore.
  // ======================================================================
  const FILE_PREFIX = 'pi_file_';
  const storage = {
    objectUrls: new Map(),
    /** put(docId, file): keeps bytes in memory and tries to persist small files for other tabs. */
    async put(docId, file) {
      this.objectUrls.set(docId, URL.createObjectURL(file));
      if (file.size <= 1.5 * 1024 * 1024) {
        const dataUrl = await new Promise((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result);
          r.onerror = () => resolve(null);
          r.readAsDataURL(file);
        });
        if (dataUrl) safeSet(window.localStorage, FILE_PREFIX + docId, dataUrl);
      }
    },
    /** url(docId): an object URL, or null when the bytes are no longer available. */
    url(docId) {
      if (this.objectUrls.has(docId)) return this.objectUrls.get(docId);
      const dataUrl = safeGet(window.localStorage, FILE_PREFIX + docId);
      if (!dataUrl) return null;
      try {
        const [meta, b64] = dataUrl.split(',');
        const mime = meta.slice(5).split(';')[0];
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const u = URL.createObjectURL(new Blob([bytes], { type: mime }));
        this.objectUrls.set(docId, u);
        return u;
      } catch (e) { return null; }
    },
    clearAll() {
      this.objectUrls.forEach((u) => URL.revokeObjectURL(u));
      this.objectUrls.clear();
      try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(FILE_PREFIX)) keys.push(k); }
        keys.forEach((k) => localStorage.removeItem(k));
      } catch (e) { /* ignore */ }
    },
  };

  // ======================================================================
  // ai - analyseDocument(file, mimeType, expected)
  // Real mode (production, server side): Claude vision with strict JSON + zod validation.
  // This prototype runs the deterministic mock only, so the demo works offline and no API key
  // is ever exposed in browser code.
  // ======================================================================
  function normaliseName(fileName) {
    return String(fileName).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }
  function detectType(fileName) {
    const norm = normaliseName(fileName);
    const tokens = norm.split('_');
    const padded = `_${norm}_`;
    for (const type of DETECT_ORDER) {
      for (const w of DOC_TYPES[type].words) {
        if (w.includes('_') ? padded.includes(`_${w}_`) : (tokens.includes(w) || (w.length > 4 && norm.includes(w)))) return type;
      }
    }
    return null;
  }
  function mask(value) {
    const s = String(value);
    return s.length <= 4 ? s : s[0] + '•'.repeat(s.length - 4) + s.slice(-3);
  }
  function fieldValue(field, person, docType) {
    const f = field.toLowerCase();
    const p = person.profile || {};
    const name = person.name.toUpperCase();
    const dob = p.dob ? fmtDate(p.dob) : '01 Jan 1990';
    const year = new Date().getFullYear();
    switch (f) {
      case 'full name': case 'employee name': case 'taxpayer name': case 'member name': return name;
      case 'passport number': return mask(p.passportNo || 'A' + String(hashStr(person.name)).slice(0, 8));
      case 'date of birth': return dob;
      case 'nationality': return (p.nationality || 'Malaysian').toUpperCase();
      case 'expiry date': return fmtDate(new Date(Date.now() + (900 + hashStr(person.name + docType) % 900) * DAY).toISOString());
      case 'fin': return mask('G' + String(hashStr(person.name)).slice(0, 7) + 'K');
      case 'nric number': return mask('S' + String(hashStr(person.name)).slice(0, 7) + 'D');
      case 'rep number': return mask('R' + String(hashStr(person.name)).slice(0, 8));
      case 'pass type': return 'Employment Pass';
      case 'place of birth': return p.birthPlace || 'Kuala Lumpur, Malaysia';
      case "parents' names": return 'Present (2 names)';
      case 'institution': return p.institution || 'Universiti Malaya';
      case 'qualification': return p.qualification || 'Bachelor degree';
      case 'date awarded': return String(Number((p.dob || '1990').slice(0, 4)) + 22);
      case 'employer name': return p.employer || 'Employer Pte Ltd';
      case 'pay period': {
        const end = new Date(); end.setMonth(end.getMonth() - 1);
        const start = new Date(end); start.setMonth(start.getMonth() - 5);
        const m = (d) => d.toLocaleDateString('en-SG', { month: 'short', year: 'numeric' });
        return `${m(start)} to ${m(end)}`;
      }
      case 'gross salary': case 'monthly salary': return `SGD ${p.salary || '6,000'}.00`;
      case 'position': return p.position || 'Manager';
      case 'start date': return fmtDate(new Date(Date.now() - 3 * 365 * DAY).toISOString());
      case 'signatory': return 'Head of Human Resources';
      case 'year of assessment': return `YA ${year}`;
      case 'assessable income': return `SGD ${(Number(String(p.salary || '6000').replace(/,/g, '')) * 13).toLocaleString('en-SG')}`;
      case 'tax payable': return `SGD ${Math.round(Number(String(p.salary || '6000').replace(/,/g, '')) * 13 * 0.07).toLocaleString('en-SG')}`;
      case 'face clearly visible': case 'plain white background': return 'Yes';
      case 'names of both parties': return 'Present';
      case 'date of marriage': return fmtDate(`${Number((p.dob || '1990').slice(0, 4)) + 27}-06-12`);
      case 'place of registration': return 'Registry of Marriages, Singapore';
      case 'address': return 'Blk 123 Ang Mo Kio Ave 3, #08-411';
      case 'statement period': {
        const m = (d) => d.toLocaleDateString('en-SG', { month: 'short', year: 'numeric' });
        const end = new Date(); const start = new Date(end); start.setMonth(start.getMonth() - 11);
        return `${m(start)} to ${m(end)}`;
      }
      case 'employer contributions': return 'Present for 12 months';
      default: return 'Present';
    }
  }

  /** Pure, synchronous mock used by the seed and by analyseDocument(). */
  function mockAnalyse({ fileName, docType, label, requiredFields, person }) {
    const norm = normaliseName(fileName);
    const detected = detectType(fileName);
    const expectedType = docType || 'other';
    const expectedLabel = DOC_TYPES[expectedType] && expectedType !== 'other' ? DOC_TYPES[expectedType].label : label.toLowerCase();
    const extracted = {};
    const issues = [];
    const jitter = (hashStr(norm) % 7) / 100;

    if (detected && detected !== expectedType && expectedType !== 'other') {
      requiredFields.forEach((f) => { extracted[f] = /name/.test(f) && !/employer|parents|both/.test(f) ? person.name.toUpperCase() : null; });
      issues.push(`This looks like a ${DOC_TYPES[detected].label}, but we expected a ${expectedLabel}. Please check.`);
      return { detectedType: detected, matchesExpected: false, confidence: 0.86 + jitter, extracted, issues };
    }

    requiredFields.forEach((f) => { extracted[f] = fieldValue(f, person, expectedType); });
    const type = detected || expectedType;
    let confidence = detected ? 0.9 + jitter : 0.55 + jitter;

    if (norm.includes('blurry') || norm.includes('blur')) {
      const target = requiredFields.find((f) => f.toLowerCase() === 'expiry date') || requiredFields[requiredFields.length - 1];
      extracted[target] = null;
      issues.push(`The ${target} is not readable. Please upload a clearer copy.`);
      confidence = 0.68 + jitter;
    }
    if (norm.includes('expired') && 'expiry date' in extracted) {
      extracted['expiry date'] = fmtDate(daysAgo(40));
      issues.push(`This document expired on ${extracted['expiry date']}. Please upload a valid one.`);
    }
    if (norm.includes('page1') || norm.includes('partial')) {
      issues.push('Some pages appear to be missing. Please upload the complete document.');
    }
    return { detectedType: type, matchesExpected: true, confidence: Math.min(confidence, 0.99), extracted, issues };
  }

  const documentReader = {
    mode: 'mock',
    /**
     * analyseDocument(file, mimeType, expected) => { detectedType, matchesExpected, confidence, extracted, issues }
     * `expected` carries { label, requiredFields } as per the brief, plus docType and person for the mock.
     */
    async analyseDocument(file, mimeType, expected) {
      await sleep(1300); // makes "Checking your document..." visible, like a real model call
      if (!ACCEPTED_MIME.includes(mimeType)) {
        return { detectedType: 'other', matchesExpected: false, confidence: 0, extracted: {}, issues: ['Unsupported file type.'] };
      }
      return mockAnalyse({ fileName: file.name, docType: expected.docType, label: expected.label, requiredFields: expected.requiredFields, person: expected.person });
    },
  };

  /** Plain-language summary shown to the client after the check. */
  function clientResultMessage(doc) {
    if (doc.aiMatches && !doc.aiIssues.length) {
      if (doc.aiConfidence < 0.7) return 'Thanks, we received your document. Our team will confirm it shortly.';
      const t = DOC_TYPES[doc.aiDetectedType];
      const article = /^[aeiou]/i.test(t.label) ? 'an' : 'a';
      return `Looks like ${article} ${t.label}. All required details found.`;
    }
    return doc.aiIssues.join(' ');
  }

  // ======================================================================
  // messaging - MessagingProvider interface
  // ======================================================================
  /**
   * interface MessagingProvider {
   *   channel: 'WHATSAPP' | 'EMAIL';
   *   send(msg: { caseId, toPhone, body, link }): Promise<OutboxMessage>;
   * }
   */
  class MockWhatsAppProvider {
    constructor() { this.channel = 'WHATSAPP'; }
    async send({ caseId, toPhone, body, link, trigger }) {
      const msg = { id: uid('msg'), caseId, channel: this.channel, toPhone, body, link, trigger, status: 'QUEUED', createdAt: nowIso(), sentAt: null };
      db.outbox.unshift(msg);
      // Simulated delivery: the mock marks messages as sent immediately.
      msg.status = 'SENT';
      msg.sentAt = nowIso();
      return msg;
    }
  }

  class WhatsAppCloudApiProvider {
    constructor(config) { this.channel = 'WHATSAPP'; this.config = config; }
    async send() {
      // TODO: call the WhatsApp Business Cloud API (or the client's CRM WhatsApp channel, platform TBC)
      //   POST https://graph.facebook.com/v{ver}/{phone_number_id}/messages with an approved template.
      // TODO: weekly reminders fall outside the 24h service window, so they need a pre-approved template.
      // TODO: store the provider message id and update status from delivery webhooks.
      throw new Error('WhatsAppCloudApiProvider is not implemented in the prototype.');
    }
  }

  const messaging = new MockWhatsAppProvider();

  // ======================================================================
  // crm - CrmSync interface (platform TBC). No-op in the prototype.
  // ======================================================================
  const crmSync = {
    // TODO: push stage changes to the client's CRM once the platform is confirmed.
    onStageChanged(caseId, stage) { console.debug('[crmSync] stage changed', caseId, stage); },
    // TODO: push document status changes so the CRM no longer sends the generic Sunday blast.
    onItemStatusChanged(caseId, itemId, status) { console.debug('[crmSync] item status', caseId, itemId, status); },
  };

  // ======================================================================
  // metrics
  // ======================================================================
  const metrics = {
    completion(caseId) {
      const req = store.itemsFor(caseId).filter((i) => i.required);
      const accepted = req.filter((i) => i.status === 'ACCEPTED').length;
      return { accepted, total: req.length, pct: req.length ? Math.round((accepted * 100) / req.length) : 0 };
    },
    outstanding: (caseId) => store.itemsFor(caseId).filter((i) => i.required && i.status !== 'ACCEPTED'),
    clientTodo: (caseId) => store.itemsFor(caseId).filter((i) => CLIENT_ACTION_STATUSES.includes(i.status)),
    daysLeft(c) { return Math.ceil((startOfDay(c.targetSubmissionDate) - startOfDay(new Date())) / DAY); },
    lastActivity(caseId) {
      const times = [];
      store.itemsFor(caseId).forEach((i) => times.push(i.updatedAt));
      db.documents.filter((d) => d.caseId === caseId).forEach((d) => times.push(d.uploadedAt));
      db.stageHistory.filter((h) => h.caseId === caseId).forEach((h) => times.push(h.changedAt));
      return times.filter(Boolean).sort().pop() || null;
    },
    rag(c) {
      const items = store.itemsFor(c.id);
      const out = metrics.outstanding(c.id).length;
      const left = metrics.daysLeft(c);
      const staleReject = items.find((i) => i.status === 'REJECTED' && i.rejectedAt && (Date.now() - new Date(i.rejectedAt).getTime()) > 7 * DAY);
      if (out > 0 && left < 0) return { rag: 'RED', reason: `Past target date with ${out} outstanding` };
      if (staleReject) return { rag: 'RED', reason: 'Rejected item not re-uploaded within 7 days' };
      const flagged = items.some((i) => i.status === 'AI_FLAGGED');
      if (out > 0 && left <= 14) return { rag: 'AMBER', reason: `${left} days left with ${out} outstanding` };
      if (flagged) return { rag: 'AMBER', reason: 'Has an AI-flagged document' };
      return { rag: 'GREEN', reason: out === 0 ? 'All documents accepted' : 'On track' };
    },
  };

  // ======================================================================
  // reminders
  // ======================================================================
  function portalLink(caseId) {
    const base = window.location.href.split('#')[0];
    return `${base}#/portal?case=${encodeURIComponent(caseId)}`;
  }

  /** Builds the personalised message. Only item labels and staff remarks are used: never NRIC or passport numbers. */
  function buildReminderMessage(c) {
    const client = store.user(c.clientId);
    const todo = metrics.clientTodo(c.id);
    if (!todo.length) return null;
    const lines = todo.map((i) => {
      const who = ` (${i.personLabel})`;
      if (i.status === 'REJECTED') return `- ${i.label}${who}: ${i.staffRemark || 'please upload a new copy'}`;
      if (i.status === 'AI_FLAGGED') return `- ${i.label}${who}: please check and upload a clearer or correct copy`;
      return `- ${i.label}${who}`;
    });
    const left = metrics.daysLeft(c);
    const link = portalLink(c.id);
    const timing = left >= 0
      ? `You have ${left} days left.`
      : 'Your target date has passed, so please upload these as soon as possible.';
    const body = `Hi ${firstName(client.name)}, this is Platinum Immigration. For your ${CASE_TYPES[c.caseType].inMessage} application, we still need:\n`
      + lines.join('\n')
      + `\n${timing} Upload securely here: ${link}`;
    return { body, link, toPhone: client.phone };
  }

  async function sendCaseReminder(c, trigger) {
    const built = buildReminderMessage(c);
    if (!built) return null;
    return messaging.send({ caseId: c.id, toPhone: built.toPhone, body: built.body, link: built.link, trigger });
  }

  /** Simulates the Sunday job. Production: a scheduled function (cron) calls the same logic server side. */
  async function runWeeklyReminders() {
    const sent = [];
    let skipped = 0;
    for (const c of db.cases) {
      if (c.stage !== 'COLLECTING_DOCUMENTS') continue;
      const msg = await sendCaseReminder(c, 'WEEKLY');
      if (msg) sent.push(msg); else skipped++;
    }
    return { sent, skipped };
  }

  // ======================================================================
  // auth (simulated). Production: server sessions plus SSO/OTP.
  // ======================================================================
  const SESSION_KEY = 'pi_portal_session';
  const auth = {
    currentUser() {
      const id = safeGet(window.sessionStorage, SESSION_KEY);
      return id ? store.user(id) || null : null;
    },
    login(email, password) {
      const u = db.users.find((x) => x.email.toLowerCase() === String(email).trim().toLowerCase());
      if (!u || u.password !== password) throw new HttpError(401, 'Email or password is incorrect.');
      safeSet(window.sessionStorage, SESSION_KEY, u.id);
      return u;
    },
    logout() { safeRemove(window.sessionStorage, SESSION_KEY); },
  };

  // Guards. In production these run inside every API route handler.
  function requireUser() {
    const u = auth.currentUser();
    if (!u) throw new HttpError(401, 'Please sign in.');
    return u;
  }
  function requireStaff() {
    const u = requireUser();
    if (u.role !== 'STAFF') throw new HttpError(403, 'Staff only.');
    return u;
  }
  function requireCaseAccess(caseId) {
    const u = requireUser();
    const c = store.case(caseId);
    if (!c) throw new HttpError(404, 'Case not found.');
    if (u.role === 'CLIENT' && c.clientId !== u.id) throw new HttpError(403, 'You do not have access to this case.');
    return { user: u, caseRec: c };
  }

  // ======================================================================
  // api - every call is guarded, mirroring server routes
  // ======================================================================
  const api = {
    myCases() {
      const u = requireUser();
      return db.cases.filter((c) => c.clientId === u.id);
    },
    getCase(caseId) { return requireCaseAccess(caseId).caseRec; },

    async uploadDocument(itemId, file) {
      const item = store.item(itemId);
      if (!item) throw new HttpError(404, 'Checklist item not found.');
      const { user, caseRec } = requireCaseAccess(item.caseId);
      if (item.status === 'ACCEPTED') throw new HttpError(409, 'This document has already been accepted.');
      const mime = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : /\.png$/i.test(file.name) ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : '');
      if (!ACCEPTED_MIME.includes(mime)) throw new HttpError(400, 'Please upload a PDF, JPG or PNG file.');
      if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(400, 'This file is larger than 10 MB. Please upload a smaller file.');

      const doc = { id: uid('doc'), itemId, caseId: caseRec.id, fileName: file.name, mimeType: mime, size: file.size, uploadedAt: nowIso(), source: 'upload', uploadedById: user.id };
      await storage.put(doc.id, file);

      const person = personFor(caseRec, item);
      let result;
      try {
        result = await documentReader.analyseDocument(file, mime, { label: item.label, requiredFields: item.requiredFields, docType: item.docType, person });
      } catch (e) {
        result = { detectedType: 'other', matchesExpected: false, confidence: 0, extracted: {}, issues: ['We could not read this automatically. Our team will review it manually.'] };
      }
      Object.assign(doc, {
        aiDetectedType: result.detectedType, aiConfidence: result.confidence, aiMatches: result.matchesExpected,
        aiExtracted: result.extracted, aiIssues: result.issues, aiCheckedAt: nowIso(),
      });

      // Re-read the item: another tab may have changed it while the check ran.
      store.reload();
      const fresh = store.item(itemId);
      if (!fresh) throw new HttpError(404, 'Checklist item was removed.');
      if (fresh.status === 'ACCEPTED') throw new HttpError(409, 'This document has already been accepted.');
      db.documents.push(doc);
      fresh.status = result.matchesExpected && result.issues.length === 0 ? 'UPLOADED' : 'AI_FLAGGED';
      fresh.staffRemark = null;
      fresh.rejectedAt = null;
      fresh.updatedAt = doc.uploadedAt;
      store.audit(caseRec.id, 'UPLOADED', `${fresh.label} (${fresh.personLabel}): ${doc.fileName}`, user.id, fresh.id);
      store.save();
      crmSync.onItemStatusChanged(caseRec.id, fresh.id, fresh.status);
      return { item: fresh, doc };
    },

    reviewItem(itemId, decision, remark) {
      const staff = requireStaff();
      const item = store.item(itemId);
      if (!item) throw new HttpError(404, 'Checklist item not found.');
      if (!store.latestDoc(itemId)) throw new HttpError(400, 'There is no document to review yet.');
      if (decision === 'REJECTED' && !String(remark || '').trim()) throw new HttpError(400, 'Please add a remark for the client.');
      item.status = decision;
      item.updatedAt = nowIso();
      if (decision === 'REJECTED') { item.staffRemark = remark.trim(); item.rejectedAt = item.updatedAt; } else { item.staffRemark = null; item.rejectedAt = null; }
      store.audit(item.caseId, decision, `${item.label} (${item.personLabel})${decision === 'REJECTED' ? ': ' + item.staffRemark : ''}`, staff.id, item.id);
      store.save();
      crmSync.onItemStatusChanged(item.caseId, item.id, decision);
    },

    setStage(caseId, stage) {
      const staff = requireStaff();
      const c = store.case(caseId);
      if (!c || !(stage in STAGE_INDEX)) throw new HttpError(400, 'Invalid stage.');
      if (c.stage === stage) return;
      c.stage = stage;
      db.stageHistory.push({ id: uid('sh'), caseId, stage, changedAt: nowIso(), changedById: staff.id });
      store.audit(caseId, 'STAGE_CHANGED', STAGES[STAGE_INDEX[stage]].label, staff.id);
      store.save();
      crmSync.onStageChanged(caseId, stage);
    },

    addItem(caseId, spec) {
      const staff = requireStaff();
      const c = store.case(caseId);
      if (!c) throw new HttpError(404, 'Case not found.');
      const label = String(spec.label || '').trim();
      if (!label) throw new HttpError(400, 'Please enter a document name.');
      const items = store.itemsFor(caseId);
      const people = casePeople(c);
      const person = people.find((p) => p.label === spec.personLabel) || people[0];
      const item = {
        id: uid('it'), caseId, templateItemId: spec.templateItemId || null, code: spec.code || 'CUSTOM',
        label, description: spec.description || 'Requested by your consultant.', required: spec.required !== false,
        docType: spec.docType || 'other', requiredFields: spec.requiredFields || [], personLabel: person.label, personName: person.name,
        sortOrder: (items.length ? Math.max(...items.map((i) => i.sortOrder)) : 0) + 1,
        status: 'PENDING', staffRemark: null, rejectedAt: null, updatedAt: nowIso(),
      };
      db.items.push(item);
      store.audit(caseId, 'ITEM_ADDED', `${item.label} (${item.personLabel})`, staff.id, item.id);
      store.save();
      return item;
    },

    removeItem(itemId) {
      const staff = requireStaff();
      const item = store.item(itemId);
      if (!item) return;
      db.items = db.items.filter((i) => i.id !== itemId);
      store.audit(item.caseId, 'ITEM_REMOVED', `${item.label} (${item.personLabel})`, staff.id);
      store.save();
    },

    async sendReminderNow(caseId) {
      requireStaff();
      const c = store.case(caseId);
      const msg = await sendCaseReminder(c, 'MANUAL');
      store.save();
      return msg;
    },

    async runWeeklyReminders() {
      requireStaff();
      const res = await runWeeklyReminders();
      store.save();
      return res;
    },

    clearOutbox() { requireStaff(); db.outbox = []; store.save(); },

    // Template CRUD
    updateTemplate(tplId, patch) {
      requireStaff();
      const t = db.templates.find((x) => x.id === tplId);
      if (t) { Object.assign(t, patch); store.save(); }
    },
    updateTemplateItem(tplId, itemId, patch) {
      requireStaff();
      const t = db.templates.find((x) => x.id === tplId);
      const it = t && t.items.find((x) => x.id === itemId);
      if (it) { Object.assign(it, patch); store.save(); }
    },
    addTemplateItem(tplId) {
      requireStaff();
      const t = db.templates.find((x) => x.id === tplId);
      const order = t.items.length ? Math.max(...t.items.map((i) => i.sortOrder)) + 1 : 1;
      const it = { id: uid('ti'), code: `ITEM_${order}`, label: 'New document', description: '', required: true, appliesTo: 'MAIN', sortOrder: order, docType: 'other', requiredFields: [] };
      t.items.push(it);
      store.save();
      return it;
    },
    removeTemplateItem(tplId, itemId) {
      requireStaff();
      const t = db.templates.find((x) => x.id === tplId);
      t.items = t.items.filter((x) => x.id !== itemId);
      store.save();
    },
    moveTemplateItem(tplId, itemId, dir) {
      requireStaff();
      const t = db.templates.find((x) => x.id === tplId);
      const sorted = t.items.slice().sort((a, b) => a.sortOrder - b.sortOrder);
      const i = sorted.findIndex((x) => x.id === itemId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= sorted.length) return;
      const a = sorted[i].sortOrder; sorted[i].sortOrder = sorted[j].sortOrder; sorted[j].sortOrder = a;
      if (sorted[i].sortOrder === sorted[j].sortOrder) sorted[i].sortOrder += dir;
      store.save();
    },
    resetDemo() { requireStaff(); store.reset(); },

    /** Creates the client login and a case whose checklist is built from the matching template. */
    async createCase(spec) {
      const staff = requireStaff();
      const name = String(spec.name || '').trim();
      const email = String(spec.email || '').trim().toLowerCase();
      const phone = String(spec.phone || '').trim();
      if (!name) throw new HttpError(400, 'Please enter the client name.');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Please enter a valid email address.');
      if (db.users.some((u) => u.email.toLowerCase() === email)) throw new HttpError(409, 'A user with this email already exists.');
      if (!/^\+?[0-9 ]{8,}$/.test(phone)) throw new HttpError(400, 'Please enter a mobile number for WhatsApp reminders, e.g. +65 9123 4567.');
      if (!CASE_TYPES[spec.caseType]) throw new HttpError(400, 'Please choose a case type.');
      const template = db.templates.find((t) => t.caseType === spec.caseType);
      if (!template || !template.items.length) throw new HttpError(400, 'There is no checklist template for this case type yet.');

      const dependants = [];
      if (spec.caseType === 'PR_WITH_DEPENDANTS') {
        const spouse = String(spec.spouseName || '').trim();
        if (spouse) dependants.push({ relation: 'SPOUSE', name: spouse, nationality: spec.nationality });
        String(spec.children || '').split('\n').map((x) => x.trim()).filter(Boolean)
          .forEach((child) => dependants.push({ relation: 'CHILD', name: child, nationality: spec.nationality }));
        if (!dependants.length) throw new HttpError(400, 'Please add at least one dependant, or choose a plain PR application.');
      }
      const married = !!spec.married || dependants.some((x) => x.relation === 'SPOUSE');

      const user = {
        id: uid('u'), name, email, password: 'demo1234', role: 'CLIENT', phone,
        profile: { nationality: String(spec.nationality || '').trim() || 'Malaysian', dob: spec.dob || '' },
        createdAt: nowIso(),
      };
      const nums = db.cases.map((c) => Number((c.id.match(/(\d+)$/) || [0, 0])[1]));
      const caseId = `PI${String(new Date().getFullYear()).slice(2)}-${String(Math.max(0, ...nums) + 1).padStart(4, '0')}`;
      const startDate = startOfDay(spec.startDate ? new Date(spec.startDate) : new Date()).toISOString();
      const caseRec = {
        id: caseId, clientId: user.id, caseType: spec.caseType, stage: spec.stage === 'ONBOARDED' ? 'ONBOARDED' : 'COLLECTING_DOCUMENTS',
        assignedStaffId: spec.assignedStaffId || staff.id, startDate, targetSubmissionDate: addMonths(startDate, 2),
        married, dependants, createdAt: nowIso(),
      };
      const items = instantiateItems(template, caseRec, personList({ name, profile: user.profile, dependants }), married);
      items.forEach((i) => { i.updatedAt = caseRec.createdAt; });

      db.users.push(user);
      db.cases.push(caseRec);
      db.items.push(...items);
      for (let i = 0; i <= STAGE_INDEX[caseRec.stage]; i++) {
        db.stageHistory.push({ id: uid('sh'), caseId, stage: STAGES[i].key, changedAt: nowIso(), changedById: staff.id });
      }
      store.audit(caseId, 'CASE_CREATED', `${CASE_TYPES[caseRec.caseType].label} with ${items.length} checklist items`, staff.id);

      let welcome = null;
      if (spec.sendWelcome) {
        const link = portalLink(caseId);
        const body = `Hi ${firstName(name)}, welcome to Platinum Immigration. Your ${CASE_TYPES[caseRec.caseType].inMessage} application has started.\n`
          + `Please upload your ${items.filter((i) => i.required).length} documents by ${fmtDate(caseRec.targetSubmissionDate)}. `
          + `You can see exactly what we need and track your progress here: ${link}\n`
          + `Sign in with ${email}.`;
        welcome = await messaging.send({ caseId, toPhone: phone, body, link, trigger: 'WELCOME' });
      }
      store.save();
      crmSync.onStageChanged(caseId, caseRec.stage);
      return { caseRec, welcome };
    },
  };

  function casePeople(c) {
    const client = store.user(c.clientId);
    return personList({ name: client.name, profile: client.profile, dependants: c.dependants });
  }
  function personFor(c, item) {
    return casePeople(c).find((p) => p.label === item.personLabel) || casePeople(c)[0];
  }

  // ======================================================================
  // views
  // ======================================================================
  const root = document.getElementById('app');
  const ui = {
    modal: null,          // { type: 'upload'|'reject'|'addItem', ... }
    expanded: {},         // staff case view: itemId -> bool
    expandedInit: {},     // caseId -> true once defaults applied
    filters: { q: '', stage: '', type: '', rag: '', staff: '' },
    outboxId: null,
    templateId: 'tpl_pr',
    loginError: '',
  };

  function parseHash() {
    const h = window.location.hash.replace(/^#/, '') || '/';
    const [path, qs] = h.split('?');
    const query = {};
    new URLSearchParams(qs || '').forEach((v, k) => { query[k] = v; });
    return { path: path || '/', query, raw: h };
  }
  function go(path, replace) {
    const target = '#' + path;
    if (replace) window.location.replace(target); else window.location.hash = path;
  }

  let toastTimer = null;
  function toast(html, ms) {
    const el = document.getElementById('toast');
    el.innerHTML = html;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, ms || 3200);
  }

  const chip = (status) => `<span class="chip ${STATUS[status].tone}">${STATUS[status].label}</span>`;
  const ragDot = (r) => `<span class="rag ${r.rag}" title="${esc(r.reason)}" aria-label="${r.rag}: ${esc(r.reason)}"></span>`;

  function render() {
    const { path, query, raw } = parseHash();
    const user = auth.currentUser();
    try {
      if (path === '/login') return paint(viewLogin(query));
      if (!user) return go('/login?next=' + encodeURIComponent(raw), true);
      if (path === '/' || path === '') return go(user.role === 'STAFF' ? '/staff' : '/portal', true);

      if (path.startsWith('/portal')) {
        if (user.role === 'STAFF') {
          return go(query.case && store.case(query.case) ? `/staff/case/${query.case}` : '/staff', true);
        }
        if (path === '/portal/help') return paint(clientShell(viewHelp()));
        return paint(clientShell(viewPortal(query)));
      }
      if (path.startsWith('/staff')) {
        requireStaff();
        if (path === '/staff') return paint(staffShell('dash', viewDashboard()));
        if (path.startsWith('/staff/case/')) return paint(staffShell('dash', viewCase(decodeURIComponent(path.split('/')[3]))));
        if (path === '/staff/outbox') return paint(staffShell('outbox', viewOutbox()));
        if (path === '/staff/new') return paint(staffShell('dash', viewNewCase()));
        if (path === '/staff/templates') return paint(staffShell('templates', viewTemplates()));
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

  function paint(html) {
    root.innerHTML = html + viewModal();
  }

  // ---------- login ----------
  function viewLogin(query) {
    const next = query.next || '';
    const clients = db.users.filter((u) => u.role === 'CLIENT' && u.email !== 'elizabeth@demo.sg');
    return `
    <div class="login-wrap">
      <div class="card login-card">
        <div class="logo dark"><b>PLATINUM</b><span>Immigration</span></div>
        <h1 style="font-size:20px;text-align:center">Sign in to your portal</h1>
        <p class="muted small" style="text-align:center;margin:4px 0 16px">Track your documents and application progress.</p>
        ${next.includes('case=') ? '<p class="note blue small" style="margin-bottom:12px">Sign in to open your application.</p>' : ''}
        <form id="loginForm" class="stack" autocomplete="on">
          <input type="hidden" name="next" value="${esc(next)}">
          <label class="field"><span>Email</span><input class="input" type="email" name="email" required autocomplete="username" inputmode="email"></label>
          <label class="field"><span>Password</span><input class="input" type="password" name="password" required autocomplete="current-password"></label>
          ${ui.loginError ? `<p class="note red small">${esc(ui.loginError)}</p>` : ''}
          <button class="btn primary block" type="submit">Sign in</button>
        </form>
        <div class="demo-accounts">
          <p class="tiny muted">Demo accounts (password <span class="mono">demo1234</span>). Sign-in is simulated in this prototype; production would use OTP or SSO.</p>
          <button type="button" data-action="fill" data-email="staff@demo.sg"><span><b>Staff</b> Daniel Koh</span><span class="muted">staff@demo.sg</span></button>
          <button type="button" data-action="fill" data-email="elizabeth@demo.sg"><span><b>Client</b> Elizabeth Tan</span><span class="muted">elizabeth@demo.sg</span></button>
          <details><summary>Other demo clients</summary>
            ${clients.map((u) => `<button type="button" data-action="fill" data-email="${esc(u.email)}"><span>${esc(u.name)}</span><span class="muted">${esc(u.email)}</span></button>`).join('')}
          </details>
        </div>
      </div>
    </div>`;
  }

  // ---------- client ----------
  function clientShell(body) {
    const u = auth.currentUser();
    return `
    <header class="topbar"><div class="topbar-inner">
      <a class="logo" href="#/portal"><b>PLATINUM</b><span>Immigration</span></a>
      <span class="spacer"></span>
      <a class="btn sm ghost-light" href="#/portal/help">Help</a>
      <button class="btn sm ghost-light" data-action="logout" title="Signed in as ${esc(u.email)}">Log out</button>
    </div></header>
    ${body}
    <p class="footer-note">Your documents are stored securely and are only visible to you and your consultant.<br>Platinum Immigration Consultancy Pte. Ltd. &middot; 65 Ubi Rd 1, #03-63 Oxley Bizhub, Singapore 408729</p>`;
  }

  function stepper(stage) {
    const cur = STAGE_INDEX[stage];
    return `<ol class="stepper" aria-label="Application stage">
      ${STAGES.map((s, i) => `<li class="${i < cur ? 'done' : i === cur ? 'current' : ''}" ${i === cur ? 'aria-current="step"' : ''}>
        <div class="dot">${i < cur ? '&#10003;' : i + 1}</div><span class="step-label">${esc(s.label)}</span></li>`).join('')}
    </ol>`;
  }

  function ring(pct) {
    const r = 34, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
    return `<svg class="ring" width="92" height="92" viewBox="0 0 92 92" role="img" aria-label="${pct}% complete">
      <circle cx="46" cy="46" r="${r}" fill="none" stroke="#eef0f3" stroke-width="10"/>
      <circle cx="46" cy="46" r="${r}" fill="none" stroke="#b8934a" stroke-width="10" stroke-linecap="round"
        stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${off.toFixed(2)}" transform="rotate(-90 46 46)"/>
      <text x="46" y="52" text-anchor="middle" font-size="18">${pct}%</text></svg>`;
  }

  function viewPortal(query) {
    const cases = api.myCases();
    let c = cases[0];
    if (query.case) c = api.getCase(query.case); // throws 403 for someone else's case
    if (!c) return `<main class="page narrow"><div class="card">No application found for your account yet. Your consultant will set it up.</div></main>`;
    const u = auth.currentUser();
    const comp = metrics.completion(c.id);
    const left = metrics.daysLeft(c);
    const todo = metrics.clientTodo(c.id);
    const items = store.itemsFor(c.id);
    const stage = STAGES[STAGE_INDEX[c.stage]];
    const collecting = STAGE_INDEX[c.stage] <= STAGE_INDEX.COLLECTING_DOCUMENTS;
    const groups = [];
    items.forEach((i) => { let g = groups.find((x) => x.label === i.personLabel); if (!g) groups.push(g = { label: i.personLabel, name: i.personName, items: [] }); g.items.push(i); });

    return `<main class="page narrow stack">
      <section class="card hero">
        <p class="muted small">Case ${esc(c.id)} &middot; ${esc(CASE_TYPES[c.caseType].label)}</p>
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

      <section class="card">
        <div class="progress-wrap">
          ${ring(comp.pct)}
          <div style="flex:1">
            <h2 style="margin-bottom:2px">Documents ${comp.pct}% complete</h2>
            <p class="muted small">${comp.accepted} of ${comp.total} required documents accepted by your consultant.</p>
            <div class="bar"><i style="width:${comp.pct}%"></i></div>
          </div>
        </div>
      </section>

      <section class="card" id="todo">
        <h2>What we still need from you</h2>
        ${todo.length ? `<ul class="todo-list">${todo.map((i) => `
          <li>
            <div class="grow">
              <div class="label">${esc(i.label)}</div>
              <div class="small muted">${esc(i.personLabel)}${i.personLabel !== 'Main applicant' ? ' &middot; ' + esc(i.personName) : ''}</div>
              ${i.status === 'REJECTED' && i.staffRemark ? `<p class="note amber small remark"><b>From your consultant:</b> ${esc(i.staffRemark)}</p>` : ''}
              ${i.status === 'AI_FLAGGED' ? `<p class="note amber small remark">${esc(clientResultMessage(store.latestDoc(i.id)))}</p>` : ''}
            </div>
            <div style="text-align:right">
              ${chip(i.status)}
              <div style="margin-top:8px"><button class="btn sm gold" data-action="openUpload" data-item="${esc(i.id)}">${i.status === 'PENDING' ? 'Upload' : 'Upload again'}</button></div>
            </div>
          </li>`).join('')}</ul>`
        : `<div class="all-done"><b>Nothing outstanding</b><span class="muted small">${items.some((i) => i.status === 'UPLOADED') ? 'Your consultant is reviewing what you uploaded.' : 'Thank you. We have everything we need for now.'}</span></div>`}
      </section>

      <section class="card">
        <h2>Full checklist</h2>
        ${groups.map((g) => `<div class="person-group">
          <h3>${esc(g.label)}${g.label !== 'Main applicant' ? ` <span class="muted small">(${esc(g.name)})</span>` : ''}</h3>
          ${g.items.map((i) => `<div class="check-row">
            <div class="grow"><span>${esc(i.label)}</span>${i.required ? '' : '<span class="opt">Optional</span>'}</div>
            ${chip(i.status)}
            ${i.status !== 'ACCEPTED' ? `<button class="btn sm" data-action="openUpload" data-item="${esc(i.id)}" aria-label="Upload ${esc(i.label)}">${i.status === 'PENDING' ? 'Upload' : 'Replace'}</button>` : ''}
          </div>`).join('')}
        </div>`).join('')}
      </section>

      <section class="card row between">
        <div><b>Questions?</b><p class="muted small">Why we need each document, accepted formats and more.</p></div>
        <a class="btn" href="#/portal/help">Help and FAQ</a>
      </section>
    </main>`;
  }

  const FAQ = [
    ['Why do you need my payslips?', 'The ICA uses your recent income to assess your economic contribution. Six months of payslips shows a stable salary that matches your employer letter and tax assessment.'],
    ['Why do you need an employer letter?', 'It confirms your position, salary and start date in one signed document. It must be on company letterhead and signed by HR or your manager.'],
    ['Where do I find my Notice of Assessment?', 'Log in to the IRAS myTax Portal with Singpass, go to Notices/Letters and download the latest Notice of Assessment as a PDF.'],
    ['What file types can I upload?', 'PDF, JPG or PNG files up to 10 MB each. On your phone you can take a photo directly. Make sure all four corners are visible and the text is sharp.'],
    ['What does "Needs attention" mean?', 'Our document check noticed something, for example the wrong document type or an unreadable detail. Please read the note and upload a new copy.'],
    ['Can I replace a document?', 'Yes. You can replace any file until your consultant has accepted it.'],
    ['Is my data safe?', 'Your documents are only visible to you and your assigned consultant. We never send your NRIC or passport number in reminder messages.'],
    ['How do I reach my consultant?', 'Reply to our WhatsApp message or call us at +65 6123 4500, Monday to Friday, 9am to 6pm.'],
  ];
  function viewHelp() {
    return `<main class="page narrow stack">
      <a href="#/portal" class="small">&larr; Back to my application</a>
      <section class="card"><h2>Help and FAQ</h2>
        ${FAQ.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
      </section>
    </main>`;
  }

  // ---------- modal ----------
  function viewModal() {
    const m = ui.modal;
    if (!m) return '';
    let inner = '';
    if (m.type === 'upload') inner = uploadModal(m);
    if (m.type === 'reject') inner = rejectModal(m);
    if (m.type === 'addItem') inner = addItemModal(m);
    return `<div class="modal-backdrop" data-action="closeModalBackdrop"><div class="modal" role="dialog" aria-modal="true">${inner}</div></div>`;
  }

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
        <p class="muted small" style="margin-top:10px">${ok ? 'Your consultant will review it and confirm.' : 'You can upload a new copy now, or leave this one for your consultant to review.'}</p>
        <div class="row" style="margin-top:16px;justify-content:flex-end">
          ${ok ? '' : `<button class="btn" data-action="uploadAgain">Upload a new copy</button>`}
          <button class="btn primary" data-action="closeModal">Done</button>
        </div>`;
    }
    return `<h2>${esc(item.label)}</h2>
      <p class="muted small">${esc(item.personLabel)}${item.personLabel !== 'Main applicant' ? ' &middot; ' + esc(item.personName) : ''}</p>
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

  function rejectModal(m) {
    const item = store.item(m.itemId);
    const presets = ['Image is blurry. Please upload a clearer copy.', 'Document has expired. Please upload a valid one.', 'Pages are missing. Please upload the complete document.', 'Letter is unsigned. Please upload a signed copy on company letterhead.'];
    return `<h2>Reject document</h2>
      <p class="muted small">${esc(item.label)} &middot; ${esc(item.personLabel)}</p>
      <form id="rejectForm" class="stack" style="margin-top:12px">
        <label class="field"><span>Remark for the client (shown in the portal and the next reminder)</span>
          <textarea class="input" name="remark" required placeholder="Explain what needs to change">${esc(m.remark || '')}</textarea></label>
        <div class="fields-chips">${presets.map((p) => `<button type="button" class="chip grey plain" style="border:0;cursor:pointer" data-action="presetRemark" data-text="${esc(p)}">${esc(p)}</button>`).join('')}</div>
        ${m.error ? `<p class="note red small">${esc(m.error)}</p>` : ''}
        <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-action="closeModal">Cancel</button><button class="btn danger" type="submit">Reject document</button></div>
      </form>`;
  }

  function addItemModal(m) {
    const c = store.case(m.caseId);
    const existing = new Set(store.itemsFor(c.id).map((i) => i.templateItemId + '|' + i.personLabel));
    const people = casePeople(c);
    const options = [];
    db.templates.forEach((t) => t.items.forEach((ti) => {
      if (!options.some((o) => o.label === ti.label && o.docType === ti.docType)) options.push(ti);
    }));
    return `<h2>Add checklist item</h2>
      <p class="muted small">For example, an extra document requested by the authority.</p>
      <form id="addItemForm" class="stack" style="margin-top:12px">
        <label class="field"><span>From the template library</span>
          <select class="input" name="templateItemId"><option value="">Custom document (type below)</option>
            ${options.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('')}</select></label>
        <label class="field"><span>Custom document name</span><input class="input" name="label" placeholder="e.g. Letter of consent from previous employer"></label>
        <label class="field"><span>Details the AI check should look for (comma separated)</span><input class="input" name="fields" placeholder="e.g. employee name, signatory, date"></label>
        <label class="field"><span>For</span><select class="input" name="personLabel">${people.map((p) => `<option>${esc(p.label)}</option>`).join('')}</select></label>
        <label class="row small"><input type="checkbox" name="required" checked> Required (counts towards % complete)</label>
        ${m.error ? `<p class="note red small">${esc(m.error)}</p>` : ''}
        <p class="tiny muted">${existing.size} items already on this case.</p>
        <div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-action="closeModal">Cancel</button><button class="btn primary" type="submit">Add item</button></div>
      </form>`;
  }

  // ---------- staff ----------
  function staffShell(active, body) {
    const u = auth.currentUser();
    const unread = db.outbox.length;
    return `
    <header class="topbar"><div class="topbar-inner">
      <a class="logo" href="#/staff"><b>PLATINUM</b><span>Back office</span></a>
      <nav>
        <a href="#/staff" class="${active === 'dash' ? 'active' : ''}">Dashboard</a>
        <a href="#/staff/outbox" class="${active === 'outbox' ? 'active' : ''}">Outbox${unread ? `<span class="badge">${unread}</span>` : ''}</a>
        <a href="#/staff/templates" class="${active === 'templates' ? 'active' : ''}">Templates</a>
      </nav>
      <span class="spacer"></span>
      <span class="who">${esc(u.name)}</span>
      <button class="btn sm ghost-light" data-action="resetDemo" title="Restore the original demo data">Reset demo</button>
      <button class="btn sm ghost-light" data-action="logout">Log out</button>
    </div></header>
    ${body}`;
  }

  function caseRows() {
    return db.cases.map((c) => {
      const client = store.user(c.clientId);
      const comp = metrics.completion(c.id);
      const out = metrics.outstanding(c.id).length;
      return {
        c, client, comp, out,
        left: metrics.daysLeft(c),
        last: metrics.lastActivity(c.id),
        staff: store.user(c.assignedStaffId),
        rag: metrics.rag(c),
      };
    });
  }

  function viewDashboard() {
    const rows = caseRows();
    const f = ui.filters;
    const active = rows.filter((r) => r.c.stage !== 'OUTCOME');
    const overdue = active.filter((r) => r.out > 0 && r.left < 0).length;
    const awaiting = db.items.filter((i) => i.status === 'UPLOADED').length;
    const flagged = db.items.filter((i) => i.status === 'AI_FLAGGED').length;
    const ragOrder = { RED: 0, AMBER: 1, GREEN: 2 };
    const visible = rows.filter((r) =>
      (!f.q || r.client.name.toLowerCase().includes(f.q.toLowerCase()) || r.c.id.toLowerCase().includes(f.q.toLowerCase()))
      && (!f.stage || r.c.stage === f.stage) && (!f.type || r.c.caseType === f.type)
      && (!f.rag || r.rag.rag === f.rag) && (!f.staff || r.c.assignedStaffId === f.staff))
      .sort((a, b) => ragOrder[a.rag.rag] - ragOrder[b.rag.rag] || a.left - b.left);
    const staffUsers = db.users.filter((u) => u.role === 'STAFF');
    const sel = (name, opts, val) => `<select class="input sm" data-filter="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === val ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

    return `<main class="page stack">
      <div class="row between">
        <div><h1 style="font-size:22px">Client dashboard</h1><p class="muted small">${rows.length} clients &middot; ${new Date().toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p></div>
        <div class="row">
          <a class="btn primary" href="#/staff/new">+ New case</a>
          <button class="btn gold" data-action="runWeekly">&#128172; Run weekly reminders</button>
        </div>
      </div>
      <section class="kpis">
        <div class="card kpi"><div class="num">${active.length}</div><div class="lbl">Active cases</div></div>
        <div class="card kpi ${overdue ? 'alert' : ''}"><div class="num">${overdue}</div><div class="lbl">Cases with overdue documents</div></div>
        <div class="card kpi"><div class="num">${awaiting}</div><div class="lbl">Documents awaiting review</div></div>
        <div class="card kpi ${flagged ? 'warn' : ''}"><div class="num">${flagged}</div><div class="lbl">AI-flagged documents</div></div>
      </section>
      <section class="card">
        <div class="filters">
          <input class="input sm search" type="search" placeholder="Search by name or case ID" data-filter="q" value="${esc(f.q)}">
          ${sel('stage', [['', 'All stages'], ...STAGES.map((s) => [s.key, s.label])], f.stage)}
          ${sel('type', [['', 'All case types'], ...Object.entries(CASE_TYPES).map(([k, v]) => [k, v.short])], f.type)}
          ${sel('rag', [['', 'All RAG'], ['RED', 'Red'], ['AMBER', 'Amber'], ['GREEN', 'Green']], f.rag)}
          ${sel('staff', [['', 'All staff'], ...staffUsers.map((u) => [u.id, u.name])], f.staff)}
          <button class="btn sm" data-action="clearFilters">Clear</button>
        </div>
        <div class="table-wrap" style="margin-top:12px">
          <table class="data">
            <thead><tr><th></th><th>Client</th><th>Case type</th><th>Stage</th><th>% complete</th><th>Outstanding</th><th>Days left</th><th>Last activity</th><th>Assigned</th></tr></thead>
            <tbody>
            ${visible.map((r) => `<tr data-action="openCase" data-case="${esc(r.c.id)}">
              <td>${ragDot(r.rag)}</td>
              <td><b>${esc(r.client.name)}</b><div class="tiny muted">${esc(r.c.id)}</div></td>
              <td>${esc(CASE_TYPES[r.c.caseType].short)}</td>
              <td>${esc(STAGES[STAGE_INDEX[r.c.stage]].label)}</td>
              <td><span class="mini-bar"><i style="width:${r.comp.pct}%"></i></span>${r.comp.pct}%</td>
              <td>${r.out ? `<b>${r.out}</b>` : '<span class="muted">0</span>'}</td>
              <td>${r.out === 0 ? '<span class="muted">-</span>' : r.left < 0 ? `<b style="color:var(--red)">${Math.abs(r.left)} overdue</b>` : r.left}</td>
              <td class="small">${relTime(r.last)}</td>
              <td class="small">${esc(r.staff ? r.staff.name : '-')}</td>
            </tr>`).join('') || '<tr><td colspan="9" class="muted" style="text-align:center;padding:24px">No clients match these filters.</td></tr>'}
            </tbody>
          </table>
        </div>
        <div class="legend" style="margin-top:12px">
          <span><i class="rag GREEN"></i> On track or 100%</span>
          <span><i class="rag AMBER"></i> 14 days or fewer left with items outstanding, or an AI flag</span>
          <span><i class="rag RED"></i> Past target with items outstanding, or a rejection not re-uploaded in 7 days</span>
        </div>
      </section>
    </main>`;
  }

  function specimenPreview(doc, item) {
    const t = DOC_TYPES[doc.aiDetectedType] || DOC_TYPES.other;
    const lines = Object.entries(doc.aiExtracted || {}).slice(0, 6);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300">
      <rect width="480" height="300" fill="#fbfaf6"/><rect x="10" y="10" width="460" height="280" fill="none" stroke="#c9b98f" stroke-width="2"/>
      <text x="28" y="46" font-family="Arial" font-size="18" font-weight="bold" fill="#1b2a4a">${esc(t.label.toUpperCase())}</text>
      <text x="28" y="66" font-family="Arial" font-size="11" fill="#777">${esc(doc.fileName)}</text>
      ${lines.map(([k, v], i) => `<text x="28" y="${100 + i * 28}" font-family="Arial" font-size="12" fill="#666">${esc(k.toUpperCase())}</text>
        <text x="200" y="${100 + i * 28}" font-family="Arial" font-size="13" fill="#222">${esc(v == null ? '(unreadable)' : v)}</text>`).join('')}
      <text x="240" y="190" font-family="Arial" font-size="56" font-weight="bold" fill="#d63b2f" fill-opacity=".14" text-anchor="middle" transform="rotate(-18 240 190)">SPECIMEN</text>
    </svg>`;
    return `<img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}" alt="Specimen preview of ${esc(item.label)}">`;
  }

  function docPreview(doc, item) {
    if (doc.source === 'seed') return specimenPreview(doc, item);
    const url = storage.url(doc.id);
    if (!url) return `<p class="muted small" style="padding:16px;text-align:center">File preview not available in this browser session.<br>Production serves files from secure storage through an authenticated route.</p>`;
    if (doc.mimeType === 'application/pdf') return `<iframe src="${esc(url)}" title="${esc(doc.fileName)}"></iframe>`;
    return `<img src="${esc(url)}" alt="${esc(doc.fileName)}">`;
  }

  function aiPanel(doc) {
    const t = DOC_TYPES[doc.aiDetectedType] || DOC_TYPES.other;
    const conf = Math.round((doc.aiConfidence || 0) * 100);
    const fields = Object.entries(doc.aiExtracted || {});
    return `<div class="ai-panel">
      <h4>AI document check</h4>
      <div class="info-list">
        <dt>Detected type</dt><dd>${esc(t.label.charAt(0).toUpperCase() + t.label.slice(1))} ${doc.aiMatches ? '<span class="chip green plain">matches</span>' : '<span class="chip amber plain">mismatch</span>'}</dd>
        <dt>Confidence</dt><dd>${conf}%<span class="conf"><i style="width:${conf}%"></i></span></dd>
        <dt>Checked</dt><dd>${fmtDateTime(doc.aiCheckedAt)}</dd>
      </div>
      ${fields.length ? `<ul class="field-list" style="margin-top:10px">${fields.map(([k, v]) => `<li><span class="muted">${esc(k)}</span>${v == null ? '<span class="missing">Not found</span>' : `<span>${esc(v)}</span>`}</li>`).join('')}</ul>` : ''}
      ${doc.aiIssues && doc.aiIssues.length ? `<p style="margin-top:10px"><b>Issues</b></p><ul class="issues">${doc.aiIssues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="small" style="margin-top:10px;color:var(--green)">No issues found.</p>'}
      <p class="ai-disclaimer">AI results are assistive. Staff confirm every document.</p>
    </div>`;
  }

  function viewCase(caseId) {
    const c = api.getCase(caseId);
    const client = store.user(c.clientId);
    const items = store.itemsFor(c.id);
    const comp = metrics.completion(c.id);
    const left = metrics.daysLeft(c);
    const rag = metrics.rag(c);
    const todo = metrics.clientTodo(c.id);
    if (!ui.expandedInit[c.id]) {
      items.forEach((i) => { if (['UPLOADED', 'AI_FLAGGED'].includes(i.status)) ui.expanded[i.id] = true; });
      ui.expandedInit[c.id] = true;
    }
    const history = db.stageHistory.filter((h) => h.caseId === c.id).sort((a, b) => b.changedAt.localeCompare(a.changedAt));
    const audit = db.audit.filter((a) => a.caseId === c.id).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 12);
    const allAccepted = comp.total > 0 && comp.accepted === comp.total;
    const groups = [];
    items.forEach((i) => { let g = groups.find((x) => x.label === i.personLabel); if (!g) groups.push(g = { label: i.personLabel, name: i.personName, items: [] }); g.items.push(i); });

    return `<main class="page stack">
      <div class="row between">
        <div>
          <a href="#/staff" class="small">&larr; Dashboard</a>
          <h1 style="font-size:22px;margin-top:4px">${ragDot(rag)} ${esc(client.name)}</h1>
          <p class="muted small">${esc(c.id)} &middot; ${esc(CASE_TYPES[c.caseType].label)} &middot; ${esc(rag.reason)}</p>
        </div>
        <div class="row">
          <a class="btn" href="${esc(portalLink(c.id))}" target="_blank" rel="noopener">Open client portal</a>
          <button class="btn gold" data-action="remindNow" data-case="${esc(c.id)}" ${todo.length ? '' : 'disabled title="Nothing outstanding from the client"'}>&#128172; Send reminder now</button>
        </div>
      </div>
      ${allAccepted && STAGE_INDEX[c.stage] < STAGE_INDEX.DOCUMENTS_COMPLETE ? `<div class="note green row between"><span>All required documents are accepted.</span><button class="btn sm success" data-action="setStageQuick" data-case="${esc(c.id)}" data-stage="DOCUMENTS_COMPLETE">Move to Documents complete</button></div>` : ''}

      <div class="grid-2">
        <div class="stack">
          <section class="card">
            <h2>Client</h2>
            <dl class="info-list">
              <dt>Email</dt><dd>${esc(client.email)}</dd>
              <dt>Mobile</dt><dd>${esc(client.phone)}</dd>
              <dt>Nationality</dt><dd>${esc((client.profile && client.profile.nationality) || '-')}</dd>
              ${c.dependants.length ? `<dt>Dependants</dt><dd>${c.dependants.map((d) => esc(d.name)).join('<br>')}</dd>` : ''}
              <dt>Assigned</dt><dd>${esc(store.user(c.assignedStaffId).name)}</dd>
              <dt>Started</dt><dd>${fmtDate(c.startDate)}</dd>
              <dt>Target</dt><dd>${fmtDate(c.targetSubmissionDate)} ${comp.accepted < comp.total ? `<span class="small ${left < 0 ? '' : 'muted'}" style="${left < 0 ? 'color:var(--red);font-weight:600' : ''}">(${left < 0 ? Math.abs(left) + ' days overdue' : left + ' days left'})</span>` : ''}</dd>
              <dt>Complete</dt><dd>${comp.pct}% (${comp.accepted}/${comp.total})<div class="bar"><i style="width:${comp.pct}%"></i></div></dd>
            </dl>
          </section>
          <section class="card">
            <h2>Stage</h2>
            <select class="input" data-stage-select="${esc(c.id)}">
              ${STAGES.map((s, i) => `<option value="${s.key}" ${s.key === c.stage ? 'selected' : ''}>${i + 1}. ${esc(s.label)}</option>`).join('')}
            </select>
            <p class="tiny muted" style="margin-top:6px">Changes are recorded in the stage history and shown to the client.</p>
            <ul class="history" style="margin-top:10px">
              ${history.map((h) => `<li><b>${esc(STAGES[STAGE_INDEX[h.stage]].label)}</b><br><span class="muted">${fmtDateTime(h.changedAt)} by ${esc((store.user(h.changedById) || {}).name || 'system')}</span></li>`).join('')}
            </ul>
          </section>
          <section class="card">
            <h2>Audit trail</h2>
            <ul class="history">
              ${audit.map((a) => `<li><b>${esc(a.action.replace(/_/g, ' ').toLowerCase())}</b> ${esc(a.detail)}<br><span class="muted">${fmtDateTime(a.at)} by ${esc((store.user(a.actorId) || {}).name || '-')}</span></li>`).join('') || '<li class="muted">No actions yet.</li>'}
            </ul>
          </section>
        </div>

        <section class="card">
          <div class="row between" style="margin-bottom:12px">
            <h2 style="margin:0">Checklist</h2>
            <button class="btn sm" data-action="openAddItem" data-case="${esc(c.id)}">+ Add item</button>
          </div>
          <p class="note blue small" style="margin-bottom:12px">AI results are assistive. Staff confirm every document.</p>
          ${groups.map((g) => `<p class="section-title">${esc(g.label)}${g.label !== 'Main applicant' ? ' &middot; ' + esc(g.name) : ''}</p>
            ${g.items.map((i) => caseItemCard(i)).join('')}`).join('')}
        </section>
      </div>
    </main>`;
  }

  function caseItemCard(i) {
    const docs = store.docsFor(i.id);
    const doc = docs[0];
    const open = !!ui.expanded[i.id];
    return `<div class="item-card ${open ? 'open' : ''}">
      <div class="item-head" data-action="toggleItem" data-item="${esc(i.id)}">
        <span class="caret">&#9656;</span>
        <div class="grow"><b>${esc(i.label)}</b>${i.required ? '' : ' <span class="tiny muted">optional</span>'}
          <div class="tiny muted">${doc ? `${esc(doc.fileName)} &middot; ${relTime(doc.uploadedAt)}` : 'Nothing uploaded yet'}</div>
          ${i.status === 'REJECTED' && i.staffRemark ? `<div class="tiny" style="color:var(--red)">Remark: ${esc(i.staffRemark)}</div>` : ''}
        </div>
        ${chip(i.status)}
      </div>
      ${open ? `<div class="item-body">
        ${doc ? `<div class="preview">${docPreview(doc, i)}</div>${aiPanel(doc)}` : `<p class="muted small">The client has not uploaded this document yet.</p><div></div>`}
        <div class="row" style="grid-column:1/-1">
          <button class="btn success" data-action="accept" data-item="${esc(i.id)}" ${doc && i.status !== 'ACCEPTED' ? '' : 'disabled'}>&#10003; Accept</button>
          <button class="btn danger" data-action="openReject" data-item="${esc(i.id)}" ${doc && i.status !== 'REJECTED' ? '' : 'disabled'}>&#10007; Reject</button>
          <span class="spacer" style="flex:1"></span>
          ${docs.length > 1 ? `<span class="prev-docs">${docs.length - 1} earlier upload${docs.length > 2 ? 's' : ''}</span>` : ''}
          <button class="btn sm ghost" data-action="removeItem" data-item="${esc(i.id)}" style="color:var(--red)">Remove item</button>
        </div>
      </div>` : ''}
    </div>`;
  }

  function linkify(text) {
    return esc(text).replace(/(https?:\/\/[^\s]+|file:\/\/[^\s]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  }

  function viewOutbox() {
    const msgs = db.outbox;
    const current = msgs.find((m) => m.id === ui.outboxId) || msgs[0];
    const toName = (m) => { const c = store.case(m.caseId); return c ? store.user(c.clientId).name : m.toPhone; };
    return `<main class="page stack">
      <div class="row between">
        <div><h1 style="font-size:22px">Reminder outbox</h1><p class="muted small">Simulated WhatsApp channel. No real messages are sent in the prototype.</p></div>
        <div class="row">
          ${msgs.length ? '<button class="btn" data-action="clearOutbox">Clear outbox</button>' : ''}
          <button class="btn gold" data-action="runWeekly">&#128172; Run weekly reminders</button>
        </div>
      </div>
      <div class="outbox-grid">
        <section class="card">
          ${msgs.length ? `<ul class="msg-list">${msgs.map((m) => `<li class="${current && m.id === current.id ? 'active' : ''}" data-action="selectMsg" data-msg="${esc(m.id)}">
            <div class="row between"><b>${esc(toName(m))}</b><span class="chip ${m.status === 'SENT' ? 'green' : 'grey'}">${m.status === 'SENT' ? 'Sent (simulated)' : 'Queued'}</span></div>
            <div class="tiny muted">${esc(m.toPhone)} &middot; ${m.channel} &middot; ${m.trigger === 'MANUAL' ? 'Manual' : m.trigger === 'WELCOME' ? 'Welcome' : 'Weekly job'} &middot; ${fmtDateTime(m.createdAt)}</div>
            <div class="preview-text">${esc(m.body.split('\n').slice(1).join(' '))}</div>
          </li>`).join('')}</ul>`
          : `<div class="all-done"><b style="color:var(--navy)">No messages yet</b><span class="muted small">Click "Run weekly reminders" to generate this week's personalised messages.</span></div>`}
        </section>
        <div>${current ? phone(current, toName(current)) : ''}</div>
      </div>
    </main>`;
  }

  function phone(m, name) {
    const time = new Date(m.createdAt).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });
    return `<div class="phone" aria-label="WhatsApp preview for ${esc(name)}"><div class="phone-screen">
      <div class="wa-head"><div class="wa-avatar">PI</div><div><b>Platinum Immigration</b><span>Business account</span></div></div>
      <div class="wa-body">
        <div class="wa-day"><span>${new Date(m.createdAt).toLocaleDateString('en-SG', { weekday: 'long' })}</span></div>
        <div class="wa-bubble">${linkify(m.body)}<div class="wa-meta">${time} &#10003;&#10003;</div></div>
      </div>
      <div class="wa-input"><div>Message</div></div>
    </div></div>
    <p class="tiny muted" style="text-align:center;margin-top:8px">To ${esc(name)} (${esc(m.toPhone)})</p>`;
  }

  function viewTemplates() {
    const t = db.templates.find((x) => x.id === ui.templateId) || db.templates[0];
    const items = t.items.slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const docTypeOpts = Object.entries(DOC_TYPES).map(([k, v]) => [k, v.label]);
    return `<main class="page stack">
      <div><h1 style="font-size:22px">Checklist templates</h1>
        <p class="muted small">Sample lists for the client to confirm. Changes apply to new cases; existing cases keep their own checklist (use "Add item" on a case to change it).</p></div>
      <div class="tpl-tabs">${db.templates.map((x) => `<button class="btn sm ${x.id === t.id ? 'active' : ''}" data-action="selectTpl" data-tpl="${esc(x.id)}">${esc(x.name)} <span class="tiny">(${x.items.length})</span></button>`).join('')}</div>
      <section class="card">
        <label class="field"><span>Template name</span><input class="input" data-tpl-name="${esc(t.id)}" value="${esc(t.name)}"></label>
        <p class="tiny muted" style="margin-top:6px">Case type: ${esc(CASE_TYPES[t.caseType].label)}</p>
      </section>
      ${items.map((it, idx) => `<div class="tpl-item">
        <div class="tpl-grid">
          <label class="field"><span>Label</span><input class="input sm" data-ti="${esc(it.id)}" data-key="label" value="${esc(it.label)}"></label>
          <label class="field"><span>Applies to</span><select class="input sm" data-ti="${esc(it.id)}" data-key="appliesTo">${['MAIN', 'SPOUSE', 'CHILD'].map((v) => `<option ${v === it.appliesTo ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="field"><span>Document type (AI)</span><select class="input sm" data-ti="${esc(it.id)}" data-key="docType">${docTypeOpts.map(([k, l]) => `<option value="${k}" ${k === it.docType ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
          <label class="field"><span>Code</span><input class="input sm mono" data-ti="${esc(it.id)}" data-key="code" value="${esc(it.code)}"></label>
        </div>
        <label class="field" style="margin-top:8px"><span>Description shown to the client</span><input class="input sm" data-ti="${esc(it.id)}" data-key="description" value="${esc(it.description)}"></label>
        <div style="margin-top:8px"><span class="tiny muted" style="font-weight:600">Required fields (checked by AI)</span>
          <div class="fields-chips">${it.requiredFields.map((f, fi) => `<span class="field-chip">${esc(f)}<button type="button" data-action="removeField" data-ti="${esc(it.id)}" data-index="${fi}" aria-label="Remove ${esc(f)}">&times;</button></span>`).join('')}
            <input class="input sm" style="width:180px" placeholder="Add field, press Enter" data-add-field="${esc(it.id)}"></div>
        </div>
        <div class="row" style="margin-top:10px">
          <label class="row small" style="gap:6px"><input type="checkbox" data-ti="${esc(it.id)}" data-key="required" ${it.required ? 'checked' : ''}> Required</label>
          <span style="flex:1"></span>
          <button class="btn sm" data-action="moveTi" data-ti="${esc(it.id)}" data-dir="-1" ${idx === 0 ? 'disabled' : ''} aria-label="Move up">&uarr;</button>
          <button class="btn sm" data-action="moveTi" data-ti="${esc(it.id)}" data-dir="1" ${idx === items.length - 1 ? 'disabled' : ''} aria-label="Move down">&darr;</button>
          <button class="btn sm danger" data-action="removeTi" data-ti="${esc(it.id)}">Delete</button>
        </div>
      </div>`).join('')}
      <button class="btn primary" data-action="addTi">+ Add item to template</button>
    </main>`;
  }

  // Demo helper: realistic random client for the New case form. Fields stay editable.
  const SAMPLE_FAMILIES = [
    { name: 'Siti Nurhaliza binti Ahmad', nat: 'Malaysian', spouse: 'Ahmad Zaki bin Yusof', kids: ['Nur Iman binti Ahmad Zaki', 'Muhammad Adam bin Ahmad Zaki'] },
    { name: 'Lim Mei Ling', nat: 'Malaysian', spouse: 'Tan Wei Jie', kids: ['Tan Yu Xuan'] },
    { name: 'Mohd Hafiz bin Kamarudin', nat: 'Malaysian', spouse: 'Nur Aina binti Rosli', kids: ['Hana Sofea binti Mohd Hafiz', 'Harith Danish bin Mohd Hafiz', 'Hawa Qistina binti Mohd Hafiz'] },
    { name: 'Kavitha Subramaniam', nat: 'Malaysian', spouse: 'Ravi Chandran', kids: ['Arjun Ravi'] },
    { name: 'Ong Jia Hui', nat: 'Malaysian', spouse: 'Lee Kok Wai', kids: ['Lee Zi Qi', 'Lee Zi Hao'] },
    { name: 'Dewi Lestari Santoso', nat: 'Indonesian', spouse: 'Budi Hartono', kids: ['Putri Ayu Hartono'] },
    { name: 'Maria Cristina Reyes', nat: 'Filipino', spouse: 'Jose Miguel Reyes', kids: ['Sofia Reyes', 'Gabriel Reyes'] },
    { name: 'Tran Minh Khoa', nat: 'Vietnamese', spouse: 'Le Thi Hoa', kids: ['Tran Bao Anh'] },
    { name: 'Pimchanok Srisawat', nat: 'Thai', spouse: 'Anan Srisawat', kids: ['Ploy Srisawat'] },
    { name: 'Aung Kyaw Min', nat: 'Myanmar', spouse: 'Thandar Win', kids: ['Htet Aung', 'Su Myat Noe'] },
    { name: 'Nguyen Van Duc', nat: 'Vietnamese', spouse: 'Pham Thu Trang', kids: ['Nguyen Gia Huy'] },
    { name: 'Farah Nadia binti Ismail', nat: 'Malaysian', spouse: 'Khairul Anuar bin Zainal', kids: ['Aisy Humaira binti Khairul Anuar'] },
  ];
  function randomCaseSpec() {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
    const unused = SAMPLE_FAMILIES.filter((f) => !db.users.some((u) => u.name === f.name));
    const fam = pick(unused.length ? unused : SAMPLE_FAMILIES);
    const caseType = pick(Object.keys(CASE_TYPES));
    const slug = fam.name.toLowerCase().split(' ').filter((w) => !['bin', 'binti'].includes(w)).slice(0, 2).join('.');
    let email = `${slug}@demo.sg`;
    for (let n = 2; db.users.some((u) => u.email === email); n++) email = `${slug}${n}@demo.sg`;
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const withDeps = caseType === 'PR_WITH_DEPENDANTS';
    const kids = withDeps ? fam.kids.slice(0, rand(1, fam.kids.length)) : [];
    const staffUsers = db.users.filter((u) => u.role === 'STAFF');
    return {
      name: fam.name, email, phone: `+65 ${pick(['8', '9'])}${rand(100, 999)} ${rand(1000, 9999)}`,
      nationality: fam.nat, dob: iso(new Date(rand(1980, 1996), rand(0, 11), rand(1, 28))),
      caseType, spouseName: withDeps ? fam.spouse : '', children: kids.join('\n'),
      married: withDeps || Math.random() < 0.5,
      startDate: iso(new Date(Date.now() - rand(0, 14) * DAY)),
      assignedStaffId: pick(staffUsers).id, stage: 'COLLECTING_DOCUMENTS', sendWelcome: true,
    };
  }

  function viewNewCase() {
    const f = ui.newCase || {};
    const me = auth.currentUser();
    const staffUsers = db.users.filter((u) => u.role === 'STAFF');
    const type = f.caseType || 'PR';
    const today = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const tplCount = (t) => { const tp = db.templates.find((x) => x.caseType === t); return tp ? tp.items.filter((i) => i.appliesTo === 'MAIN').length : 0; };
    return `<main class="page narrow stack">
      <a href="#/staff" class="small">&larr; Dashboard</a>
      <div class="row between" style="align-items:flex-start">
        <div style="flex:1;min-width:220px"><h1 style="font-size:22px">New case</h1>
          <p class="muted small">Creates the client's portal login and builds their checklist from the matching template. Demo logins use the password <span class="mono">demo1234</span>.</p></div>
        <button type="button" class="btn gold" data-action="fillRandom" title="Demo helper: fills every field with a random sample client. You can still edit anything.">&#127922; Fill with sample data</button>
      </div>
      ${f.sample ? '<p class="note blue small">Sample data filled in. Edit anything you like, or click the button again for another client.</p>' : ''}
      <form id="newCaseForm" class="stack">
        <section class="card stack">
          <h2 style="margin:0">Client</h2>
          <label class="field"><span>Full name (as in passport)</span><input class="input" name="name" required value="${esc(f.name || '')}" placeholder="e.g. Siti Nurhaliza binti Ahmad"></label>
          <div class="tpl-grid" style="grid-template-columns:1fr 1fr">
            <label class="field"><span>Email (portal login)</span><input class="input" type="email" name="email" required value="${esc(f.email || '')}" placeholder="name@example.com"></label>
            <label class="field"><span>Mobile (WhatsApp)</span><input class="input" type="tel" name="phone" required value="${esc(f.phone || '')}" placeholder="+65 9123 4567"></label>
            <label class="field"><span>Nationality</span><input class="input" name="nationality" value="${esc(f.nationality || 'Malaysian')}"></label>
            <label class="field"><span>Date of birth</span><input class="input" type="date" name="dob" value="${esc(f.dob || '')}"></label>
          </div>
        </section>
        <section class="card stack">
          <h2 style="margin:0">Application</h2>
          <label class="field"><span>Case type</span><select class="input" name="caseType" data-newcase-type>
            ${Object.entries(CASE_TYPES).map(([k, v]) => `<option value="${k}" ${k === type ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label>
          <p class="tiny muted" data-tpl-hint>${tplCount(type)} documents for the main applicant${type === 'PR_WITH_DEPENDANTS' ? ', plus passport, birth certificate and photo for each dependant' : ''}. Edit the lists under Templates.</p>
          <div class="stack" data-dep-fields ${type === 'PR_WITH_DEPENDANTS' ? '' : 'hidden'}>
            <label class="field"><span>Spouse full name (leave empty if none)</span><input class="input" name="spouseName" value="${esc(f.spouseName || '')}"></label>
            <label class="field"><span>Children, one full name per line</span><textarea class="input" name="children" style="min-height:70px">${esc(f.children || '')}</textarea></label>
          </div>
          <label class="row small"><input type="checkbox" name="married" ${f.married ? 'checked' : ''}> Client is married (adds the marriage certificate)</label>
          <div class="tpl-grid" style="grid-template-columns:1fr 1fr">
            <label class="field"><span>Start date</span><input class="input" type="date" name="startDate" value="${esc(f.startDate || iso(today))}"></label>
            <label class="field"><span>Assigned consultant</span><select class="input" name="assignedStaffId">
              ${staffUsers.map((u) => `<option value="${esc(u.id)}" ${u.id === (f.assignedStaffId || me.id) ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></label>
          </div>
          <p class="tiny muted">Target submission date is set to two months after the start date.</p>
          <label class="field"><span>Starting stage</span><select class="input" name="stage">
            <option value="COLLECTING_DOCUMENTS" ${f.stage !== 'ONBOARDED' ? 'selected' : ''}>Collecting documents (included in weekly reminders)</option>
            <option value="ONBOARDED" ${f.stage === 'ONBOARDED' ? 'selected' : ''}>Onboarded only</option></select></label>
          <label class="row small"><input type="checkbox" name="sendWelcome" ${f.sendWelcome === false ? '' : 'checked'}> Send a welcome WhatsApp with the portal link (simulated, goes to the Outbox)</label>
        </section>
        ${f.error ? `<p class="note red small">${esc(f.error)}</p>` : ''}
        <div class="row" style="justify-content:flex-end"><a class="btn" href="#/staff">Cancel</a><button class="btn primary" type="submit">Create case</button></div>
      </form>
    </main>`;
  }

  function viewDenied(title, message, status) {
    const u = auth.currentUser();
    return `<main class="page narrow"><div class="card denied">
      <p class="mono muted">${esc(status || '')}</p><h1 style="font-size:22px;margin:6px 0">${esc(title)}</h1>
      <p class="muted">${esc(message)}</p>
      <div class="row" style="justify-content:center;margin-top:16px">
        ${u ? `<a class="btn primary" href="#/">Go to my home</a><button class="btn" data-action="logout">Log out</button>` : '<a class="btn primary" href="#/login">Sign in</a>'}
      </div></div></main>`;
  }

  // ======================================================================
  // event handling (delegated)
  // ======================================================================
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

  const actions = {
    fill(el) {
      const f = document.getElementById('loginForm');
      f.email.value = el.dataset.email;
      f.password.value = 'demo1234';
      f.password.focus();
    },
    logout() { auth.logout(); ui.modal = null; ui.loginError = ''; go('/login'); },
    openUpload(el) { ui.modal = { type: 'upload', itemId: el.dataset.item, phase: 'choose' }; render(); },
    uploadAgain() { ui.modal.phase = 'choose'; ui.modal.error = ''; render(); },
    closeModal() { ui.modal = null; render(); },
    closeModalBackdrop(el, e) { if (e.target === el && (!ui.modal || ui.modal.phase !== 'checking')) { ui.modal = null; render(); } },
    openCase(el) { go('/staff/case/' + encodeURIComponent(el.dataset.case)); },
    clearFilters() { ui.filters = { q: '', stage: '', type: '', rag: '', staff: '' }; render(); },
    toggleItem(el) { ui.expanded[el.dataset.item] = !ui.expanded[el.dataset.item]; render(); },
    accept(el) {
      try {
        const before = metrics.completion(store.item(el.dataset.item).caseId).pct;
        const caseId = store.item(el.dataset.item).caseId;
        api.reviewItem(el.dataset.item, 'ACCEPTED');
        render();
        toast(`Document accepted. Completion ${before}% &rarr; ${metrics.completion(caseId).pct}%`);
      } catch (e) { handleError(e); }
    },
    openReject(el) { ui.modal = { type: 'reject', itemId: el.dataset.item }; render(); },
    presetRemark(el) { const ta = document.querySelector('#rejectForm textarea'); ta.value = el.dataset.text; ta.focus(); },
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
    setStageQuick(el) {
      try { api.setStage(el.dataset.case, el.dataset.stage); render(); toast('Stage updated.'); } catch (e) { handleError(e); }
    },
    async runWeekly() {
      try {
        const { sent, skipped } = await api.runWeeklyReminders();
        if (sent.length) ui.outboxId = sent[0].id;
        if (parseHash().path === '/staff/outbox') render();
        else { render(); }
        toast(`${sent.length} personalised reminder${sent.length === 1 ? '' : 's'} generated${skipped ? `, ${skipped} skipped (nothing outstanding)` : ''}. <a href="#/staff/outbox">Open outbox</a>`, 6000);
      } catch (e) { handleError(e); }
    },
    selectMsg(el) { ui.outboxId = el.dataset.msg; render(); },
    clearOutbox() { if (window.confirm('Clear all simulated messages?')) { api.clearOutbox(); ui.outboxId = null; render(); } },
    resetDemo() {
      if (!window.confirm('Reset all demo data to the original seed? Uploads, reviews and messages will be cleared.')) return;
      api.resetDemo();
      ui.expanded = {}; ui.expandedInit = {}; ui.outboxId = null; ui.modal = null;
      render();
      toast('Demo data reset.');
    },
    selectTpl(el) { ui.templateId = el.dataset.tpl; render(); },
    addTi() { api.addTemplateItem(ui.templateId); render(); window.scrollTo(0, document.body.scrollHeight); },
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
  };

  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const fn = actions[el.dataset.action];
    if (!fn) return;
    if (el.tagName === 'A') e.preventDefault();
    fn(el, e);
  });

  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.id === 'loginForm') {
      try {
        const u = auth.login(f.email.value, f.password.value);
        ui.loginError = '';
        const next = f.next.value;
        const allowed = next && next.startsWith('/') && !next.startsWith('/login') && (u.role === 'STAFF' ? next.startsWith('/staff') || next.startsWith('/portal') : next.startsWith('/portal'));
        go(allowed ? next : (u.role === 'STAFF' ? '/staff' : '/portal'));
      } catch (err) { ui.loginError = err.message; render(); }
    }
    if (f.id === 'rejectForm') {
      try { api.reviewItem(ui.modal.itemId, 'REJECTED', f.remark.value); ui.modal = null; render(); toast('Document rejected. The client will see your remark.'); } catch (err) { ui.modal.remark = f.remark.value; handleError(err, true); }
    }
    if (f.id === 'newCaseForm') {
      const v = (n) => f.elements.namedItem(n).value;
      const on = (n) => f.elements.namedItem(n).checked;
      const spec = {
        name: v('name'), email: v('email'), phone: v('phone'), nationality: v('nationality'), dob: v('dob'),
        caseType: v('caseType'), spouseName: v('spouseName'), children: v('children'), married: on('married'),
        startDate: v('startDate'), assignedStaffId: v('assignedStaffId'), stage: v('stage'), sendWelcome: on('sendWelcome'),
      };
      api.createCase(spec).then(({ caseRec, welcome }) => {
        ui.newCase = null;
        go('/staff/case/' + encodeURIComponent(caseRec.id));
        if (welcome) ui.outboxId = welcome.id;
        toast(`Case ${esc(caseRec.id)} created.${welcome ? ' Welcome message added to the <a href="#/staff/outbox">outbox</a>.' : ''}`, 6000);
      }).catch((err) => {
        ui.newCase = Object.assign(spec, { error: err instanceof HttpError ? err.message : 'Could not create the case.' });
        if (!(err instanceof HttpError)) console.error(err);
        render();
        window.scrollTo(0, document.body.scrollHeight);
      });
      return;
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
        const item = api.addItem(caseId, spec);
        ui.modal = null;
        ui.expanded[item.id] = true;
        render();
        toast('Item added. The client will see it in their checklist.');
      } catch (err) { handleError(err, true); }
    }
  });

  root.addEventListener('change', (e) => {
    const el = e.target;
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
      try { api.setStage(el.dataset.stageSelect, el.value); render(); toast('Stage updated. The client sees it straight away.'); } catch (err) { handleError(err); }
      return;
    }
    if (el.matches('[data-tpl-name]')) { api.updateTemplate(el.dataset.tplName, { name: el.value.trim() || 'Untitled template' }); render(); return; }
    if (el.matches('[data-ti]')) {
      const val = el.type === 'checkbox' ? el.checked : el.value;
      api.updateTemplateItem(ui.templateId, el.dataset.ti, { [el.dataset.key]: val });
      render();
    }
  });

  root.addEventListener('input', (e) => {
    const el = e.target;
    if (el.matches('input[data-filter="q"]')) {
      ui.filters.q = el.value;
      const pos = el.selectionStart;
      render();
      const again = root.querySelector('input[data-filter="q"]');
      if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    }
  });

  root.addEventListener('keydown', (e) => {
    const el = e.target;
    if (e.key === 'Enter' && el.matches('[data-add-field]')) {
      e.preventDefault();
      const v = el.value.trim();
      if (!v) return;
      const t = db.templates.find((x) => x.id === ui.templateId);
      const it = t.items.find((x) => x.id === el.dataset.addField);
      if (!it.requiredFields.includes(v)) api.updateTemplateItem(t.id, it.id, { requiredFields: it.requiredFields.concat(v) });
      render();
      const again = root.querySelector(`[data-add-field="${CSS.escape(it.id)}"]`);
      if (again) again.focus();
    }
    if (e.key === 'Escape' && ui.modal && ui.modal.phase !== 'checking') { ui.modal = null; render(); }
  });

  // Drag and drop onto the upload zone.
  root.addEventListener('dragover', (e) => {
    const z = e.target.closest && e.target.closest('[data-dropzone]');
    if (z) { e.preventDefault(); z.classList.add('over'); }
  });
  root.addEventListener('dragleave', (e) => {
    const z = e.target.closest && e.target.closest('[data-dropzone]');
    if (z) z.classList.remove('over');
  });
  root.addEventListener('drop', (e) => {
    const z = e.target.closest && e.target.closest('[data-dropzone]');
    if (!z) return;
    e.preventDefault();
    doUpload(e.dataTransfer.files && e.dataTransfer.files[0]);
  });

  // Keep side-by-side tabs (staff + client) in sync during the demo.
  window.addEventListener('storage', (e) => {
    if (e.key !== DB_KEY || !e.newValue) return;
    try { db = JSON.parse(e.newValue); } catch (err) { return; }
    if (ui.modal && ui.modal.phase === 'checking') return;
    render();
  });

  window.addEventListener('hashchange', () => {
    if (ui.modal && ui.modal.phase !== 'checking') ui.modal = null;
    if (parseHash().path !== '/staff/new') ui.newCase = null;
    render();
    window.scrollTo(0, 0);
  });

  // ======================================================================
  // boot
  // ======================================================================
  store.load();
  render();

  // Exposed for the demo console and future cron wiring.
  window.PlatinumPortal = {
    runWeeklyReminders: () => api.runWeeklyReminders().then((r) => { render(); return r; }),
    buildReminderMessage: (caseId) => buildReminderMessage(store.case(caseId)),
    analyseDocument: documentReader.analyseDocument,
    metrics,
    resetDemo: () => { store.reset(); render(); },
    providers: { MockWhatsAppProvider, WhatsAppCloudApiProvider },
  };
})();
