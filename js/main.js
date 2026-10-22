/*
 * Platinum Immigration - Client Portal (HTML prototype, v2)
 * Ref: Q202607041IMMIGRATION. Prepared by Megapixel Consulting & Solutions Pte Ltd.
 *
 * ES modules, no build step, no network. Each module stands in for a production module
 * (see ARCHITECTURE.md): domain, seed, store, auth (permissions + guards), providers, api, views.
 */
import { store, db } from './store.js';
import { api } from './api/index.js';
import { metrics } from './metrics.js';
import { documentReader } from './ai.js';
import { buildReminderMessage } from './reminders.js';
import { MockWhatsAppProvider, WhatsAppCloudApiProvider } from './providers/messaging.js';
import { MockEmailProvider, SmtpEmailProvider } from './providers/email.js';
import { render } from './views/router.js';
import './views/events.js';

store.load();
render();

// Exposed for the demo console and future cron wiring.
window.PlatinumPortal = {
  runWeeklyReminders: () => api.runWeeklyReminders().then((r) => { render(); return r; }),
  buildReminderMessage: (caseId) => buildReminderMessage(store.case(caseId)),
  analyseDocument: documentReader.analyseDocument,
  metrics,
  resetDemo: () => { store.reset(); render(); },
  providers: { MockWhatsAppProvider, WhatsAppCloudApiProvider, MockEmailProvider, SmtpEmailProvider },
  get db() { return db; },
};
