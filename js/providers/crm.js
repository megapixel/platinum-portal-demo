// crm - CrmSync interface (platform TBC). No-op in the prototype.
export const crmSync = {
  // TODO: push stage changes to the client's CRM once the platform is confirmed.
  onStageChanged(caseId, stage) { console.debug('[crmSync] stage changed', caseId, stage); },
  // TODO: push document status changes so the CRM no longer sends the generic Sunday blast.
  onItemStatusChanged(caseId, itemId, status) { console.debug('[crmSync] item status', caseId, itemId, status); },
  // TODO: create or update the lead in the CRM, and pull new leads from it.
  onLeadChanged(leadId, stage) { console.debug('[crmSync] lead changed', leadId, stage); },
};
