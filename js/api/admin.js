// api/admin: users, templates, settings. Guarded by user:manage / template:manage / config:manage.
import { db, store } from '../store.js';
import { ROLES } from '../domain.js';
import { HttpError, uid } from '../utils.js';
import { requirePerm } from '../auth/session.js';

export const adminApi = {
  listUsers() { requirePerm('user:manage'); return db.users.slice(); },

  setUserRole(userId, role) {
    const admin = requirePerm('user:manage');
    const u = store.user(userId);
    if (!u) throw new HttpError(404, 'User not found.');
    if (!ROLES[role] || role === 'CLIENT' || u.role === 'CLIENT') throw new HttpError(400, 'Only staff roles can be changed here.');
    if (u.id === admin.id && role !== 'ADMIN') throw new HttpError(400, 'You cannot remove your own admin role.');
    if (u.role === role) return;
    const before = u.role;
    u.role = role;
    db.audit.push({ id: uid('au'), caseId: null, leadId: null, itemId: null, action: 'PERMISSION_CHANGED', detail: `${u.name}: ${ROLES[before].label} to ${ROLES[role].label}`, actorId: admin.id, at: new Date().toISOString(), before: { role: before }, after: { role } });
    store.save();
  },

  // Checklist template CRUD
  updateTemplate(tplId, patch) {
    requirePerm('template:manage');
    const t = db.templates.find((x) => x.id === tplId);
    if (t) { Object.assign(t, patch); store.save(); }
  },
  updateTemplateItem(tplId, itemId, patch) {
    requirePerm('template:manage');
    const t = db.templates.find((x) => x.id === tplId);
    const it = t && t.items.find((x) => x.id === itemId);
    if (it) { Object.assign(it, patch); store.save(); }
  },
  addTemplateItem(tplId) {
    requirePerm('template:manage');
    const t = db.templates.find((x) => x.id === tplId);
    const order = t.items.length ? Math.max(...t.items.map((i) => i.sortOrder)) + 1 : 1;
    const it = { id: uid('ti'), code: `ITEM_${order}`, label: 'New document', description: '', required: true, appliesTo: 'MAIN', sortOrder: order, docType: 'other', requiredFields: [] };
    t.items.push(it);
    store.save();
    return it;
  },
  removeTemplateItem(tplId, itemId) {
    requirePerm('template:manage');
    const t = db.templates.find((x) => x.id === tplId);
    t.items = t.items.filter((x) => x.id !== itemId);
    store.save();
  },
  moveTemplateItem(tplId, itemId, dir) {
    requirePerm('template:manage');
    const t = db.templates.find((x) => x.id === tplId);
    const sorted = t.items.slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const i = sorted.findIndex((x) => x.id === itemId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return;
    const a = sorted[i].sortOrder; sorted[i].sortOrder = sorted[j].sortOrder; sorted[j].sortOrder = a;
    if (sorted[i].sortOrder === sorted[j].sortOrder) sorted[i].sortOrder += dir;
    store.save();
  },

  // Onboarding form definitions
  updateFormField(formId, sectionKey, fieldKey, patch) {
    requirePerm('template:manage');
    const f = db.formDefs.find((x) => x.id === formId);
    const s = f && f.sections.find((x) => x.key === sectionKey);
    const fld = s && s.fields.find((x) => x.key === fieldKey);
    if (fld) { Object.assign(fld, patch); store.save(); }
  },
  addFormField(formId, sectionKey) {
    requirePerm('template:manage');
    const f = db.formDefs.find((x) => x.id === formId);
    const s = f && f.sections.find((x) => x.key === sectionKey);
    if (!s) return;
    const key = `custom_${uid('f').slice(2)}`;
    s.fields.push({ key, label: 'New field', type: 'text', required: false });
    store.save();
  },
  removeFormField(formId, sectionKey, fieldKey) {
    requirePerm('template:manage');
    const f = db.formDefs.find((x) => x.id === formId);
    const s = f && f.sections.find((x) => x.key === sectionKey);
    if (s) { s.fields = s.fields.filter((x) => x.key !== fieldKey); store.save(); }
  },

  /** Settings the client has not confirmed. Stored in db.config, never hard-coded. */
  updateConfig(patch) {
    requirePerm('config:manage');
    Object.assign(db.config, patch);
    store.save();
  },
};
