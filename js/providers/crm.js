// crm - CrmSyncProvider interface (platform TBC). A no-op in the prototype, with a mock lead import from CSV.
/**
 * interface CrmSyncProvider {
 *   status(): { connected: boolean, platform: string };
 *   onStageChanged(caseId, stage): void;
 *   onItemStatusChanged(caseId, itemId, status): void;
 *   onLeadChanged(leadId, stage): void;
 *   parseLeadCsv(text): Array<{ name, email, phone, nationality, interest, source }>;
 * }
 */
export class NoopCrmSync {
  status() { return { connected: false, platform: 'TBC' }; }
  // TODO: push stage changes to the client's CRM once the platform is confirmed.
  onStageChanged(caseId, stage) { console.debug('[crmSync] stage changed', caseId, stage); }
  // TODO: push document status changes so the CRM no longer sends the generic Sunday blast.
  onItemStatusChanged(caseId, itemId, status) { console.debug('[crmSync] item status', caseId, itemId, status); }
  // TODO: create or update the lead in the CRM, and pull new leads from it on a schedule.
  onLeadChanged(leadId, stage) { console.debug('[crmSync] lead changed', leadId, stage); }

  /** Mock import: reads a CSV exported from the old CRM. Columns: name, email, phone, nationality, interest, source. */
  parseLeadCsv(text) {
    const lines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return [];
    const split = (line) => { const out = []; let cur = ''; let q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((c) => c.trim()); };
    const head = split(lines[0]).map((h) => h.toLowerCase());
    return lines.slice(1).map((l) => { const cells = split(l); const row = {}; head.forEach((h, i) => { row[h] = cells[i] || ''; }); return row; });
  }
}

export const crmSync = new NoopCrmSync();
