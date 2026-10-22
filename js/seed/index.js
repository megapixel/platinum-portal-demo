// seed: assembles the full demo database. Each phase adds its own seeder here.
import { nowIso } from '../utils.js';
import { seedTemplates, seedFormDefs } from './checklists.js';
import { SEED_STAFF, SEED_CLIENTS, seedClient } from './core.js';
import { seedSales } from './sales.js';
import { seedInvoices } from './invoices.js';
import { DEFAULT_MESSAGE_TEMPLATES } from '../messagetemplates.js';

export const DB_VERSION = 2;

/** Settings the client has not confirmed (TBC) live here, never in code. */
export function defaultConfig() {
  return {
    magicLinkMinutes: 15,
    reminder: { day: 0, hour: 10, frequency: 'WEEKLY' },          // Sunday 10:00 weekly (TBC)
    gstRate: 0.09,                                                // prevailing Singapore GST (TBC)
    paymentSchedule: [                                            // TBC with the client
      { label: 'Deposit', pct: 50, due: 'ON_ISSUE' },
      { label: 'Balance', pct: 50, due: 'BEFORE_SUBMISSION' },
    ],
    docValidityMonths: { employer_letter: 3, photo: 3, payslip: 6 },// documents older than this are not reused on re-application (TBC)
    paymentTermsDays: 14,                                         // deposit due this many days after issue (TBC)
    stageAfterPack: 'DOCUMENTS_COMPLETE',                         // or REVIEW_AND_PREPARATION
    warnUnpaidOnSubmit: true,
    notifyOnAccept: false,                                        // send DOC_ACCEPTED on every accept (noisy, so off)
    reapplicationRule: 'SAME_CASE_NEW_ATTEMPT',                   // TBC
    retentionMonths: { SUBMITTED: 24, OUTCOME: 12, LOST_LEAD: 6 },// TBC
    letterBlankDownloadDefault: false,
    caseNumberPrefix: 'PIC',
    invoicePrefix: 'INV',
  };
}

export function buildSeed() {
  const d = {
    version: DB_VERSION,
    seededAt: nowIso(),
    config: defaultConfig(),
    users: SEED_STAFF.map((u) => ({ ...u, password: 'demo1234' })),
    clients: [],
    templates: seedTemplates(),
    formDefs: seedFormDefs(),
    cases: [], items: [], documents: [], stageHistory: [], audit: [],
    outbox: [], emails: [], magicLinks: [], reviewTasks: [],
    leads: [], leadSources: [], introducers: [], packages: [], invoices: [],
    messageTemplates: DEFAULT_MESSAGE_TEMPLATES.map((t) => ({ ...t })),
  };
  for (const c of SEED_CLIENTS) seedClient(d, c);
  seedSales(d);
  seedInvoices(d);
  return d;
}
