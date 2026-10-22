// seed: lead sources, introducers, packages and about 25 open leads across the pipeline.
import { uid, daysAgo, daysFromNow, rng } from '../utils.js';

export const SEED_SOURCES = [
  { id: 'src_tv', label: 'TV commercial' },
  { id: 'src_referral', label: 'Referral / Introducer' },
  { id: 'src_partner', label: 'Partner (employment agency, school, charity, HR)' },
  { id: 'src_social', label: 'Social media' },
  { id: 'src_event', label: 'Event / seminar' },
  { id: 'src_walkin', label: 'Walk-in' },
  { id: 'src_web', label: 'Website' },
];

export const SEED_INTRODUCERS = [
  { id: 'intro_1', name: 'Rachel Goh', org: 'Pinnacle Talent Partners', tier: 'PREMIUM', email: 'rachel@pinnacle.example', phone: '+65 9100 2001' },
  { id: 'intro_2', name: 'Dr Anand Pillai', org: 'Harbour Community Clinic', tier: 'PREMIUM', email: 'anand@harbour.example', phone: '+65 9100 2002' },
  { id: 'intro_3', name: 'Michelle Teo', org: 'BrightPath HR Consulting', tier: 'PREMIUM', email: 'michelle@brightpath.example', phone: '+65 9100 2003' },
  { id: 'intro_4', name: 'Faizal Rahim', org: 'Eastside Employment Agency', tier: 'STANDARD', email: 'faizal@eastside.example', phone: '+65 9100 2004' },
  { id: 'intro_5', name: 'Linda Chua', org: 'Lighthouse Charity', tier: 'STANDARD', email: 'linda@lighthouse.example', phone: '+65 9100 2005' },
  { id: 'intro_6', name: 'Kenneth Yap', org: 'Independent', tier: 'STANDARD', email: 'kenneth@yap.example', phone: '+65 9100 2006' },
];

// Sample prices. The client confirms the real ones (TBC), so they are editable on the Packages page.
export const SEED_PACKAGES = [
  { id: 'pkg_pr', name: 'PR Application', caseType: 'PR', price: 3800, description: 'Permanent Residence application for the main applicant.' },
  { id: 'pkg_cit', name: 'Citizenship Application', caseType: 'CITIZENSHIP', price: 4500, description: 'Citizenship application for an existing PR.' },
  { id: 'pkg_dep', name: 'PR with Dependants', caseType: 'PR_WITH_DEPENDANTS', price: 5800, description: 'PR application including spouse and children.' },
  { id: 'pkg_biz', name: 'Business Ownership to PR (bundle)', caseType: 'PR', price: 12000, description: 'Company set-up support bundled with a PR application.' },
];

const PEOPLE = [
  ['Wong Mei Yee', 'Malaysian'], ['Arjun Nair', 'Indian'], ['Tran Thi Lan', 'Vietnamese'], ['Joel Fernandez', 'Filipino'],
  ['Chen Xiaoyu', 'Chinese'], ['Putri Maharani', 'Indonesian'], ['Sunil Kapoor', 'Indian'], ['Ploy Chaiyasit', 'Thai'],
  ['Mohd Irfan bin Salleh', 'Malaysian'], ['Nadia Karim', 'Bangladeshi'], ['Li Wei', 'Chinese'], ['Grace Santos', 'Filipino'],
  ['Hoang Minh Tuan', 'Vietnamese'], ['Anita Desai', 'Indian'], ['Budi Santoso', 'Indonesian'], ['Kim Ji-woo', 'Korean'],
  ['Zaw Min Htet', 'Myanmar'], ['Ong Siew Hui', 'Malaysian'], ['Rohan Mehta', 'Indian'], ['Maria Lopez', 'Filipino'],
  ['Wirat Phanich', 'Thai'], ['Siti Aminah', 'Indonesian'], ['Yuki Tanaka', 'Japanese'], ['Vikram Singh', 'Indian'],
  ['Nguyen Hai Yen', 'Vietnamese'], ['Tan Boon Keat', 'Malaysian'], ['Aiko Sato', 'Japanese'],
];
const PASSES = ['Employment Pass', 'S Pass', 'Employment Pass', 'Dependant Pass', 'Employment Pass'];
const INTERESTS = ['PR', 'PR', 'Citizenship', 'PR', 'Business ownership to PR', 'Other'];
// stage, count per stage
const STAGE_PLAN = ['NEW', 'NEW', 'NEW', 'NEW', 'NEW', 'NEW', 'CONTACTED', 'CONTACTED', 'CONTACTED', 'CONTACTED', 'CONTACTED', 'CONTACTED',
  'CONSULTATION_BOOKED', 'CONSULTATION_BOOKED', 'CONSULTATION_BOOKED', 'CONSULTATION_BOOKED', 'CONSULTATION_BOOKED',
  'PROPOSAL_SENT', 'PROPOSAL_SENT', 'PROPOSAL_SENT', 'PROPOSAL_SENT', 'WON', 'WON', 'LOST', 'LOST', 'LOST', 'LOST'];

export function seedSales(d) {
  d.leadSources = SEED_SOURCES.map((s) => ({ ...s }));
  d.introducers = SEED_INTRODUCERS.map((s) => ({ ...s }));
  d.packages = SEED_PACKAGES.map((s) => ({ ...s }));
  const r = rng(20261014);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const consultants = ['u_staff', 'u_sarah'];
  const pkgFor = (interest) => (interest === 'Citizenship' ? 'pkg_cit' : interest === 'Business ownership to PR' ? 'pkg_biz' : r() < 0.3 ? 'pkg_dep' : 'pkg_pr');
  const noteBank = [
    ['CALL', 'Called, discussed eligibility. Has 5 years on EP.'],
    ['WHATSAPP', 'Sent the document checklist overview on WhatsApp.'],
    ['MEETING', 'Consultation held. Interested, wants to discuss with spouse.'],
    ['CALL', 'No answer. Left a voicemail.'],
    ['WHATSAPP', 'Client asked about timeline and fees.'],
  ];

  STAGE_PLAN.forEach((stage, i) => {
    const [name, nationality] = PEOPLE[i % PEOPLE.length];
    const interest = pick(INTERESTS);
    const source = pick(d.leadSources);
    const introducer = source.id === 'src_referral' || source.id === 'src_partner'
      ? (i % 4 === 0 ? d.introducers[i % 3] : pick(d.introducers)) : null;
    const created = Math.floor(r() * 40) + 1;
    const pkgId = stage === 'NEW' || stage === 'CONTACTED' ? null : pkgFor(interest);
    const pkg = d.packages.find((p) => p.id === pkgId);
    const slug = name.toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter((w) => !['bin', 'binti'].includes(w)).slice(0, 2).join('.');
    const lead = {
      id: `lead_${String(i + 1).padStart(3, '0')}`, name, nationality,
      phone: `+65 ${pick(['8', '9'])}${Math.floor(100 + r() * 899)} ${Math.floor(1000 + r() * 8999)}`,
      email: `${slug}@mail.example`, passType: pick(PASSES), yearsInSg: Math.floor(2 + r() * 9), interest,
      sourceId: source.id, heardOfUs: source.label, introducerId: introducer ? introducer.id : null,
      utm: r() < 0.4 ? { source: pick(['facebook', 'google', 'tv']), medium: pick(['cpc', 'social', 'broadcast']), campaign: pick(['pr-autumn', 'citizenship-2026', 'brand']) } : {},
      stage, lostReason: stage === 'LOST' ? pick(['Price too high', 'Chose another firm', 'No response', 'Timing not right']) : null,
      assignedStaffId: stage === 'NEW' && i % 2 === 0 ? null : pick(consultants),
      packageId: pkgId, quotedAmount: pkg ? pkg.price : null,
      nextFollowUp: stage === 'WON' || stage === 'LOST' ? null : daysFromNow(Math.floor(r() * 10) - 3),
      notes: [], convertedCaseId: null, createdAt: daysAgo(created),
    };
    const noteCount = stage === 'NEW' ? 0 : 1 + Math.floor(r() * 2);
    for (let n = 0; n < noteCount; n++) {
      const [kind, text] = noteBank[(i + n) % noteBank.length];
      lead.notes.push({ id: uid('ln'), kind, text, at: daysAgo(Math.max(0, created - 1 - n)), byId: lead.assignedStaffId || 'u_staff' });
    }
    d.leads.push(lead);
    d.audit.push({ id: uid('au'), caseId: null, leadId: lead.id, itemId: null, action: 'LEAD_CREATED', detail: `Enquiry from ${source.label}`, actorId: null, at: lead.createdAt, before: null, after: { stage: 'NEW' } });
  });
}
