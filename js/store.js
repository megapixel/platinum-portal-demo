// store (stands in for Prisma + Postgres). One JSON document in localStorage.
// `db` is a live binding: importers read it, only this module reassigns it.
import { safeGet, safeSet, uid, nowIso } from './utils.js';
import { storage } from './storage.js';
import { buildSeed, DB_VERSION } from './seed/index.js';

export const DB_KEY = 'pi_portal_db_v2';
export let db = null;

/** Versioned migrations. The prototype has no v1 data worth keeping, so an old version reseeds. */
function migrate(data) {
  if (!data || data.version !== DB_VERSION) return null;
  return data;
}

export function setDb(next) { db = next; }

export const store = {
  load() {
    const raw = safeGet(window.localStorage, DB_KEY);
    if (raw) {
      try { const m = migrate(JSON.parse(raw)); if (m) { db = m; return; } } catch (e) { /* fall through to reseed */ }
    }
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
  client: (id) => db.clients.find((c) => c.id === id),
  case: (id) => db.cases.find((c) => c.id === id),
  item: (id) => db.items.find((i) => i.id === id),
  lead: (id) => db.leads.find((l) => l.id === id),
  itemsFor: (caseId) => db.items.filter((i) => i.caseId === caseId).sort((a, b) => a.sortOrder - b.sortOrder),
  docsFor: (itemId) => db.documents.filter((d) => d.itemId === itemId).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)),
  latestDoc: (itemId) => store.docsFor(itemId)[0] || null,
  primaryContact(client) {
    const c = client.contacts.find((x) => x.kind === 'PRIMARY') || client.contacts[0];
    return store.user(c.userId);
  },
  contactUsers: (client) => client.contacts.map((c) => store.user(c.userId)).filter(Boolean),
  /** The client record a CLIENT user belongs to. */
  clientOf: (user) => (user && user.clientId ? store.client(user.clientId) : null),
  caseClient: (c) => store.client(c.clientId),
  /** Granular audit entry. before/after hold the changed values. */
  audit(caseId, action, detail, actorId, itemId, extra) {
    db.audit.push({ id: uid('au'), caseId, leadId: null, itemId: itemId || null, action, detail, actorId, at: nowIso(), ...(extra || {}) });
  },
  auditLead(leadId, action, detail, actorId, extra) {
    db.audit.push({ id: uid('au'), caseId: null, leadId, itemId: null, action, detail, actorId, at: nowIso(), ...(extra || {}) });
  },
};
