# Architecture

The prototype is a single-page HTML app. `js/app.js` is split into sections that map one to one onto the modules a production build would have. The interfaces below are the contract. Only their implementations change for production.

```
 Client (phone)            Staff (desktop)
      │                          │
      └──────────┬───────────────┘
                 ▼
        views ──► api (guards: requireUser / requireStaff / requireCaseAccess)
                   │
     ┌───────┬─────┼─────────┬────────────┬──────────┐
     ▼       ▼     ▼         ▼            ▼          ▼
   store  storage  ai     messaging    reminders   crmSync
  (DB)   (files) (reader) (WhatsApp)  (weekly job) (CRM, TBC)
```

## Data model

These follow the brief. User, Case, ChecklistTemplate, ChecklistTemplateItem, CaseChecklistItem, Document, StageHistory and OutboxMessage are kept as arrays in `db`. On top of the brief:

- `audit` records uploads, accept/reject, item add/remove and stage changes, with the actor and time.
- Case checklist items **snapshot** the label, description, docType and requiredFields from the template, so editing a template never changes a live case.
- "Marriage certificate (if married)" is only added for married clients, and is then required.

## Interfaces

### StorageProvider
```ts
put(docId: string, file: Blob): Promise<void>
url(docId: string): string | null      // production: short-lived signed URL via an authenticated route
clearAll(): void                       // demo reset only
```
Prototype: object URLs in memory, with files of 1.5 MB or less mirrored to `localStorage` so a second tab can preview them.
Production: an S3-compatible bucket in a Singapore region (for example AWS ap-southeast-1), private, encrypted at rest, and never under `/public`.

### Document reader (AI)
```ts
analyseDocument(file, mimeType, expected: { label, requiredFields, docType?, person? })
  => Promise<{ detectedType, matchesExpected, confidence, extracted: Record<string, string|null>, issues: string[] }>
```
Status rule: `matchesExpected && issues.length === 0` sets the item to `UPLOADED`. Anything else sets it to `AI_FLAGGED`. Staff always make the final Accept or Reject.

Production (server side only, key in `ANTHROPIC_API_KEY`):
- Send the image, or the PDF as a native `document` content block, to a vision-capable Claude model, together with the expected label and required fields.
- Ask for strict JSON only: document type, whether it matches the expected type, each required field (null if missing or unreadable), and issues such as expired, blurry, missing pages or a name mismatch with the client profile.
- Validate with zod. Retry once on a parse failure, then mark the document for manual review.
- Fall back to the mock reader when no key is set, so demos still work offline.

### MessagingProvider
```ts
interface MessagingProvider { channel: 'WHATSAPP' | 'EMAIL'; send({ caseId, toPhone, body, link }): Promise<OutboxMessage> }
```
- `MockWhatsAppProvider` (used now) writes to the Outbox.
- `WhatsAppCloudApiProvider` is a stub with TODOs. Because weekly reminders fall outside WhatsApp's 24-hour service window, they need a **pre-approved message template**. Delivery status comes back through webhooks.

### Reminders
`buildReminderMessage(case)` and `runWeeklyReminders()` only target cases in `COLLECTING_DOCUMENTS` with items that are Pending, Rejected or Needs attention. Messages contain labels and remarks only, never ID numbers. In production a scheduled function (every Sunday, SGT) calls the same logic, and staff can still trigger "Send reminder now".

### CrmSync (platform TBC)
`onStageChanged(caseId, stage)` and `onItemStatusChanged(caseId, itemId, status)` are no-ops for now. Once the CRM is confirmed, these push status into it so the generic Sunday blast can be retired. A pull sync for new clients and cases would replace manual onboarding.

## What production needs

1. **Server and database:** Next.js (App Router) or similar, Postgres with Prisma, and the same guards enforced inside every route handler.
2. **Hosting in Singapore**, with HTTPS, backups and logging. No document content goes in the logs.
3. **Login:** SSO for staff (Microsoft 365 or Google Workspace), and OTP by SMS, WhatsApp or email for clients, so there are no passwords for clients to manage. Magic links from reminders should be short-lived and still need the OTP.
4. **WhatsApp:** WhatsApp Business Platform (Cloud API) with an approved template, or the existing CRM's WhatsApp channel.
5. **Storage:** an S3-compatible private bucket in Singapore, with virus scanning on upload and signed URLs for previews.
6. **AI:** the Claude API from the server, with zod validation, a retry, a manual-review fallback, and per-document cost and latency logging.
7. **PDPA:** a retention schedule with automated deletion, a consent notice in the portal, access logging, a DPO contact, and masking of NRIC and passport numbers in staff UI and exports.
8. **Template management:** finalise the real checklists with Platinum Immigration, and version the templates.
