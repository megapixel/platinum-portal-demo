# Architecture

The prototype is a static single-page app written as ES modules. Each module maps one to one onto a module a production build would have. The **interfaces** below are the contract: only their implementations change for production. `prisma/schema.prisma` is the production data model (a spec; the prototype stores the same entities as arrays in one JSON document).

```
 Client (phone)                 Staff (desktop)                Public
      └───────────────┬──────────────┘                          │
                      ▼                                         ▼
          views ──► api.*  (every call checks can() / guards)   /apply
                      │
   ┌──────┬──────┬────┴────┬──────────┬──────────┬───────────┬──────────┐
   ▼      ▼      ▼         ▼          ▼          ▼           ▼          ▼
 store  storage  ai    messaging   payment   accounting    crmSync   driveSync
 (DB)  (files) (reader) WhatsApp+  (gateway) (CSV export)  (CRM,TBC) (Drive)
                         email
```

## Modules (`js/`)

| Module | Role |
|---|---|
| `domain.js`, `utils.js` | Constants (stages, roles, document types) and pure helpers |
| `store.js`, `seed/*` | The database (`db`), versioned load, reset and seed builders |
| `auth/permissions.js` | **The one permission matrix.** `can(user, permission)` |
| `auth/session.js` | Sessions, magic links, and the guards `requirePerm`, `requireCaseAccess`, `requireLeadAccess` |
| `api/*.js` | One file per domain: `cases`, `onboarding`, `leads`, `consolidation`, `messaging`, `invoices`, `outcome`, `letters`, `integrations`, `admin`. Every function guards itself |
| `providers/*.js` | `messaging`, `email`, `payment`, `accounting`, `crm`, `drive` interfaces with mock implementations and production stubs |
| `ai.js` | Document reader (mock) and the cross-check of names against the onboarding form |
| `invoicing.js`, `caselogic.js`, `analytics.js`, `audit.js`, `letters.js` | Pure logic: invoice maths and status rules, checklists and re-application reuse, management numbers, audit categories, merge fields and DOCX/PDF output |
| `pack.js`, `invoicepdf.js` | Submission pack and invoice PDF (pdf-lib, JSZip, vendored under `vendor/`) |
| `views/*.js` | Rendering and events. Views never decide access: they call `api.*` |

## Roles and permissions

Five roles: `ADMIN`, `OPS_MANAGER`, `CONSULTANT`, `DOCUMENT_SPECIALIST`, `CLIENT`. `js/auth/permissions.js` lists every permission once (for example `case:view`, `item:review`, `invoice:manage`, `letter:generate`) and what each role may do. It is the only place access is defined.

- The **menu** is built from `can()`, so people never see a page that would be denied.
- The **router** checks the permission to avoid dead pages.
- **Every `api.*` function checks it again** through `requirePerm` or the case and lead guards. That is the check that counts: in production the same file is imported by every route handler and server action. Views are not trusted.
- **Scope:** a client only reaches a case through one of its contacts. A consultant only reaches cases and leads assigned to them (unassigned new leads are open until claimed). Other staff roles see everything their permissions allow.
- Admin > Permissions renders the matrix so the client can review it. Role changes are audited.

## Data model

The entities (full detail in `prisma/schema.prisma`):

- **People:** `User` (one login per contact), `Client` (profile, dependants, channel preference, a primary and a secondary contact), `MagicLink`.
- **Case:** `Case` (number `PIC-YYYY-NNNN`, stage, attempt, assigned consultant, onboarding answers), `CaseAttempt` (archived attempts), `Outcome`, `StageHistory`, `ReviewTask`.
- **Documents:** `ChecklistTemplate` and items, `CaseChecklistItem` (a **snapshot**, so editing a template never changes a live case), `Document` (versions, who uploaded, AI result), `FormDefinition` (onboarding form).
- **Sales:** `Lead`, `LeadNote`, `LeadSource`, `Introducer`, `Package`.
- **Money:** `Invoice` (number `INV-YYYY-NNNN`), `InvoiceLine`, `Payment`. Partially paid, Paid and Overdue are **derived** from payments and due dates, never stored, so they cannot drift.
- **Messaging:** `MessageTemplate` (editable, with allowed merge fields per key), `Message` (the per-case log).
- **Letters:** `LetterTemplate`, `Letter` (internal documents).
- **System:** `AuditEntry` (append only, with before and after), `Config`.

Settings the client has not confirmed (reminder rule, GST, payment schedule, retention, re-application rule, document validity windows) are `Config` rows, edited in Admin > Settings, and message and letter wording are editable templates.

## Interfaces

### StorageProvider
```ts
put(docId: string, file: Blob): Promise<void>
url(docId: string): string | null      // production: short-lived signed URL via an authenticated route
bytes(docId: string): Promise<ArrayBuffer | null>
clearAll(): void                       // demo reset only
```
Prototype: object URLs in memory, with files of 1.5 MB or less mirrored to `localStorage`. Production: a private, encrypted S3-compatible bucket in a Singapore region, virus scanning on upload, never under `/public`. Documents reused by a re-application share the original file through `blobId`.

### Document reader (AI)
```ts
analyseDocument(file, mimeType, expected: { label, requiredFields, docType?, person? })
  => Promise<{ detectedType, matchesExpected, confidence, extracted: Record<string, string|null>, issues: string[] }>
```
Status rule: `matchesExpected && issues.length === 0` sets the item to `UPLOADED`; anything else sets `AI_FLAGGED`. The API then **cross-checks** the extracted name against the onboarding form for the main applicant and adds an issue on a mismatch. Staff always make the final Accept or Reject.

Production (server side only, key in `ANTHROPIC_API_KEY`): send the image, or the PDF as a native `document` block, to a vision-capable Claude model with the expected label and fields; ask for strict JSON; validate with zod; retry once, then mark for manual review; fall back to the mock when no key is set.

### MessagingProvider and EmailProvider
```ts
interface MessagingProvider { channel: 'WHATSAPP'; send({ caseId?, leadId?, toPhone, toName?, body, link?, trigger }): Promise<OutboxMessage> }
interface EmailProvider     { channel: 'EMAIL';    send({ caseId?, leadId?, to, toName?, subject, body, link?, trigger }): Promise<EmailMessage> }
```
`notifyClient()` renders a template and sends it on the client's preferred channel (WhatsApp, email or both). The mocks write to the Outbox. `WhatsAppCloudApiProvider` is a stub: weekly reminders fall outside WhatsApp's 24-hour service window, so they need **pre-approved templates**, and delivery status comes back through webhooks.

### Reminders and the digest
`reminderDue(case, now)` applies the case's own rule or the global one (day, hour, frequency) and the interval since `lastReminderAt`. Production: a scheduled function runs it every hour (SGT). Messages hold labels, dates and staff remarks only, never ID numbers. The staff digest and the immediate alerts (client re-uploaded a rejected item, outcome received) use the email provider.

### PaymentProvider
```ts
charge({ invoice, amount, payer }): Promise<{ ok: boolean, method: string, reference: string }>
```
The mock settles instantly. Production: create a PayNow or card checkout and mark the invoice paid **only from the gateway's signed webhook**, never from the browser.

### AccountingExportProvider
```ts
invoicesCsv(rows): string
paymentsCsv(rows): string
```
CSV today. `XeroExportProvider` is a stub for a future Xero or QuickBooks link (accounting system TBC).

### CrmSyncProvider
```ts
status(): { connected: boolean, platform: string }
onStageChanged(caseId, stage) / onItemStatusChanged(caseId, itemId, status) / onLeadChanged(leadId, stage)
parseLeadCsv(text): Array<{ name, email, phone, nationality, interest, source }>
```
Not connected (CRM platform TBC). Once chosen, these push status into the CRM so the generic Sunday blast can be retired, and a pull sync replaces manual lead entry. Admin > Integrations has a mock CSV import.

### DriveSyncProvider
```ts
listFolder(caseRec, client): Promise<Array<{ name, mimeType, size }>>
```
Each case has a "Legacy Google Drive folder link". The mock **Import from Drive** matches sample files to pending checklist items and marks them as uploaded on the client's behalf, via Drive. Two ways to handle the real folders, to decide with the client:

1. **Migrate:** copy the files into portal storage once (through this provider and `StorageProvider`), then retire the folders. One source of truth, simplest permissions and retention. Best if the folders are tidy and the team is ready to stop using Drive.
2. **Sync metadata:** keep files in Drive and store only links and metadata in the portal. Less to migrate, but access, retention and the AI check depend on Drive permissions, and the portal is no longer the only source of truth.

## Key behaviours

- **Review and consolidation.** The review queue is oldest first across cases. A case is pack-ready when every required item is accepted, the onboarding form is submitted and complete, and no item is flagged or waiting. The pack is a ZIP of `{CaseNo}_{Person}_{SortOrder}_{DocCode}.pdf` plus a merged PDF with an index page, and moves the case to the stage set in config. Production: a server job.
- **Invoices.** Generated from the package price. GST and the schedule come from config at issue time and are stored on the invoice. A manual payment records date, amount, method and reference; overpayment is refused. Moving to Submitted with an unpaid balance warns and never blocks.
- **Outcome and re-application.** Recording a decision moves the case to Outcome and sends the matching message. After a rejection, the default rule continues the **same case as a new attempt**, keeping history. Accepted documents carry over unless their own expiry has passed or they are older than their validity window (`docValidityMonths`). The alternative rule opens a linked new case.
- **Letters.** Templates and letters are staff-only: `CLIENT` holds no letter permission, so every letter call is refused for clients. The one exception is the per-template "client may download a blank copy" flag (off by default), which returns the template with fields left blank and logs each download.
- **Audit.** Append only, with who, when and before and after values. Filterable by category, person and text on every case and lead, with an all-system view in Admin.
- **Archived history.** About 60 past cases are seeded without checklists or documents, flagged `historical`, so analytics have real-looking data. The dashboard and pipeline hide them by default.

## What production needs

1. **Server and database:** Next.js (App Router) or similar, Postgres with Prisma (`prisma/schema.prisma`), TypeScript strict, and the same `permissions.js` matrix enforced inside every route handler and server action. The prototype ships JSDoc typedefs (`js/types.js`) and a `jsconfig.json`, but most code is not annotated: `npx tsc -p jsconfig.json --checkJs` currently reports about 1,950 strict errors (mostly implicit `any`). Strict TypeScript is a goal of the port, not something the prototype meets.
2. **Hosting in Singapore**, with HTTPS, backups and logging. No document content in the logs.
3. **Login:** SSO for staff (Microsoft 365 or Google Workspace), and OTP or short-lived magic links for clients, with no passwords for clients to manage. Magic links from reminders should still require the OTP.
4. **WhatsApp:** the WhatsApp Business Platform (Cloud API) with approved templates, or the existing CRM's WhatsApp channel. An email service for email.
5. **Payments:** a gateway with signed webhooks (PayNow and cards), and an accounting link once the system is chosen.
6. **Storage:** a private S3-compatible bucket in Singapore, virus scanning on upload, signed URLs for previews.
7. **AI:** the Claude API from the server, with zod validation, a retry, a manual-review fallback, and per-document cost and latency logging.
8. **PDPA:** a retention schedule with automated deletion (the per-status settings already exist), a consent record on `/apply`, a consent notice in the portal, access logging, a DPO contact, and masking of NRIC and passport numbers in staff UI and exports.
9. **Scheduling:** an hourly scheduled function for reminders and a morning one for the staff digest.
10. **Content:** finalise the real checklists, onboarding fields, message wording, letter wording and package prices with Platinum Immigration, and version the templates.
