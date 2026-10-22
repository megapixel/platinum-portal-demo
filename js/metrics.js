// metrics
import { db, store } from './store.js';
import { CLIENT_ACTION_STATUSES, DAY } from './domain.js';
import { startOfDay } from './utils.js';

export const metrics = {
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
