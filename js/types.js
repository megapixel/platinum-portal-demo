// types: JSDoc typedefs for the main records. Documentation and editor help only (no runtime code).
// `npx tsc -p jsconfig.json` type-checks the project against these as an optional developer check.

/** @typedef {'ADMIN'|'OPS_MANAGER'|'CONSULTANT'|'DOCUMENT_SPECIALIST'|'CLIENT'} Role */
/** @typedef {'ONBOARDED'|'COLLECTING_DOCUMENTS'|'DOCUMENTS_COMPLETE'|'REVIEW_AND_PREPARATION'|'SUBMITTED'|'OUTCOME'} Stage */
/** @typedef {'PENDING'|'UPLOADED'|'AI_FLAGGED'|'ACCEPTED'|'REJECTED'} ItemStatus */
/** @typedef {'NEW'|'CONTACTED'|'CONSULTATION_BOOKED'|'PROPOSAL_SENT'|'WON'|'LOST'} LeadStage */

/**
 * @typedef {object} User
 * @property {string} id
 * @property {string} name
 * @property {string} email
 * @property {Role} role
 * @property {string} [phone]
 * @property {string} [clientId]            set for CLIENT users; each contact has their own login
 * @property {boolean} [historical]         archived history record
 */

/**
 * @typedef {object} Client
 * @property {string} id
 * @property {string} name
 * @property {Record<string, any>} profile
 * @property {Array<{relation: string, name: string}>} dependants
 * @property {'WHATSAPP'|'EMAIL'|'BOTH'} channelPref
 * @property {Array<{userId: string, kind: 'PRIMARY'|'SECONDARY'}>} contacts
 */

/**
 * @typedef {object} Case
 * @property {string} id                    PIC-YYYY-NNNN
 * @property {string} clientId
 * @property {'PR'|'CITIZENSHIP'|'PR_WITH_DEPENDANTS'} caseType
 * @property {Stage} stage
 * @property {number} attempt
 * @property {string} assignedStaffId
 * @property {string} startDate
 * @property {string} targetSubmissionDate
 * @property {{data: Record<string, string>, status: 'DRAFT'|'SUBMITTED'}} onboarding
 * @property {Outcome|null} [outcome]
 * @property {boolean} [remindersPaused]
 */

/**
 * @typedef {object} Outcome
 * @property {'APPROVED'|'REJECTED'} result
 * @property {string} decisionDate
 * @property {string} reference
 * @property {string} reason
 * @property {string} nextSteps
 */

/**
 * @typedef {object} ChecklistItem
 * @property {string} id
 * @property {string} caseId
 * @property {string} label
 * @property {boolean} required
 * @property {ItemStatus} status
 * @property {string} personLabel
 * @property {number} sortOrder
 * @property {string|null} [dueDate]
 */

/**
 * @typedef {object} Document
 * @property {string} id
 * @property {string} itemId
 * @property {number} version
 * @property {string} fileName
 * @property {{userId: string, role: Role, onBehalf: boolean, via?: string}} uploadedBy
 * @property {string[]} aiIssues
 */

/**
 * @typedef {object} Invoice
 * @property {string} id
 * @property {string} number                INV-YYYY-NNNN
 * @property {string} caseId
 * @property {'DRAFT'|'ISSUED'|'VOID'} status   Paid, partially paid and overdue are derived: see invoicing.js
 * @property {number} total
 * @property {Array<{id: string, date: string, amount: number, method: string, reference: string}>} payments
 */

/**
 * @typedef {object} Lead
 * @property {string} id
 * @property {string} name
 * @property {LeadStage} stage
 * @property {string|null} assignedStaffId  null until a consultant claims it
 * @property {string|null} convertedCaseId
 * @property {boolean} [archived]
 */

/**
 * @typedef {object} AuditEntry
 * @property {string} id
 * @property {string|null} caseId
 * @property {string|null} leadId
 * @property {string} action
 * @property {string} detail
 * @property {string|null} actorId
 * @property {string} at
 * @property {object|null} [before]
 * @property {object|null} [after]
 */

export {};
