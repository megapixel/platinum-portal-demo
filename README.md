# Platinum Immigration Client Portal (prototype v2)

Ref: Q202607041IMMIGRATION. Prepared by Megapixel Consulting & Solutions Pte Ltd for Platinum Immigration Consultancy Pte. Ltd.

A clickable demo of one **single source of truth** for the whole client journey:

lead, sale, onboarding, document collection, consolidation, submission, outcome, payment.

It is a prototype, not production software. It is plain HTML, CSS and JavaScript (ES modules), with no build step and no network calls. All data is fake and lives in your browser. WhatsApp, email, payments, CRM, Google Drive and the AI document reader are all mocked behind interfaces (see `ARCHITECTURE.md`).

## Run it

ES modules do not load from `file://`, so serve the folder:

```bash
npx serve .          # then open http://localhost:3000
# or
python3 -m http.server 8123   # then open http://localhost:8123
```

The live demo on GitHub Pages works the same way. Use **Reset demo** (top right, staff view) before each presentation. It restores the seed data and moves all dates relative to today.

## Demo logins (password `demo1234`; a magic link also works)

| Login | Role | Notes |
|---|---|---|
| `admin@demo.sg` | Admin | Everything, including users, templates, rules, invoices |
| `ops@demo.sg` | Operations manager | All cases and leads, analytics, reassignment. No user admin |
| `consultant1@demo.sg` | Consultant | Daniel Koh. Only their own leads and clients (also `staff@demo.sg`) |
| `consultant2@demo.sg` | Consultant | Sarah Lim (also `sarah@demo.sg`) |
| `specialist@demo.sg` | Document specialist | Review queue, consolidation, packs. Read-only on sales and payments |
| `elizabeth@demo.sg` | Client | PR, 63%, 2 pending, 1 rejected with remark, deposit not yet paid |
| `elizabeth.spouse@demo.sg` | Client | Second contact on Elizabeth's case, own login |
| `ahmad@demo.sg` | Client | Citizenship, just started |
| `nurul@demo.sg` | Client | PR with dependants, AI-flagged spouse passport |
| `weiling@demo.sg` | Client | PR, past target date (red), invoice overdue |
| `rizal@demo.sg` | Client | Citizenship, rejection not re-uploaded for 10 days |
| `priya@demo.sg` | Client | PR, 100%, Documents complete, fully paid (good for the pack) |
| `mai@demo.sg` | Client | PR, Review and preparation, balance overdue |
| `kittisak@demo.sg` | Client | PR with dependants, Submitted (good for recording an outcome) |

The login page has one-click buttons for these. Archived history clients (see below) are not listed.

Seeded data: 8 active cases with invoices in mixed payment states, 21 open leads across the pipeline (3 premium introducers), and 60 archived closed cases across 12 months (outcomes, nationalities, payments) so the charts look real. The dashboard and pipeline hide archived history until you tick "Show closed cases" or "Include archived history".

## Demo script v2

Run these in order. Keep the staff and client views in separate tabs; they share data and refresh each other.

1. **Lead.** Open `#/apply` on a phone-width screen (or use `?utm_source=facebook&utm_campaign=pr-autumn`) and submit an enquiry. The lead appears under New in the pipeline, and a WhatsApp greeting shows in the Outbox.
2. **Sale.** Log in as `consultant1`. Open the lead, choose the PR package, move it to Consultation booked, log a note, set it Won, and click **Convert**. The client, a PR case and an invoice are created, and the welcome message (with a sign-in link) is queued.
3. **Client.** In the Outbox, click the link in the welcome message. You are signed in as the new client. Fill in **Your information**, upload two documents, and press **I've finished uploading - submit for review**. Use `seed-files/photo_headshot_sample.png` for the photo and `seed-files/passport_name_mismatch_elizabeth_tan.png` for the passport.
4. **Specialist.** Log in as `specialist`. In **Review queue**, filter AI-flagged: the passport is flagged for a name mismatch with the information form. Press **R**, press **5** (name mismatch), then **Ctrl+Enter**. The client gets a message with the reason and what to do next.
5. **Reminders.** Click **Run Sunday reminders**. Only clients with outstanding items get a personalised message; Priya and Kittisak are skipped.
6. **Consolidation.** Elizabeth needs her last items first: as Elizabeth upload `passport_elizabeth_tan.png`, `payslips_elizabeth_tan_apr-sep_2026.pdf` and `employer_letter_signed_elizabeth_tan.pdf`, press submit for review, and accept them in the review queue (or use Priya, who is already complete). Open the case, click **Consolidation**, and **Generate submission pack**. You get a ZIP with files named `{CaseNo}_{Person}_{SortOrder}_{DocCode}.pdf` and a merged PDF with an index page. The stage moves to Documents complete.
7. **Admin.** Log in as `admin`. On Elizabeth's case record the deposit payment, generate a recommendation letter, and move the case to Submitted (you get a warning about the unpaid balance, and can continue). Then record **Outcome = Approved**. In Elizabeth's portal the outcome card appears.
8. **Management.** Log in as `ops`. Open **Analytics** (approval rate by nationality, lead source conversion, revenue collected vs outstanding), then the case's **Audit timeline**.

`tests/e2e/10-demo-script-v2.mjs` drives this script in a real browser.

## What is in it

| Area | Where |
|---|---|
| Roles and one permission matrix (shown in Admin > Permissions) | `js/auth/permissions.js` |
| Passwordless magic links (15 minutes, one use), multiple contacts per client, "uploaded by" on every document | `js/auth/session.js`, `js/api/cases.js` |
| Public enquiry form, lead pipeline (board and table), follow-ups, packages, introducers, convert Won to client + case + invoice | `js/api/leads.js`, `js/views/leads.js` |
| Onboarding form per case type, save draft, % complete, consultant fill-in, AI cross-check of names | `js/api/onboarding.js` |
| Client submission ("submit for review"), per-item deadlines, document versions | `js/api/cases.js` |
| Review queue with keyboard review, consolidation workspace, submission pack | `js/api/consolidation.js`, `js/pack.js` |
| Editable message templates, reminder rules (Sunday 10:00 default), per-case pause or override, staff digest and alerts, message log | `js/api/messaging.js`, `js/digest.js` |
| Invoices (GST, payment schedule, statuses), manual payments, mock Pay now, billing tab, PDF, CSV export | `js/api/invoices.js`, `js/invoicing.js` |
| Outcome capture, re-application as a new attempt, filterable audit timeline | `js/api/outcome.js`, `js/views/audit.js` |
| Letter templates, generation to PDF and DOCX, download log, opt-in client blank forms | `js/api/letters.js`, `js/letters.js` |
| CRM sync, Google Drive and accounting stubs, data retention settings | `js/providers/`, `js/api/integrations.js` |
| Analytics dashboard | `js/analytics.js`, `js/views/analytics.js` |

Every table has a **CSV** button.

## Settings the client has not confirmed (TBC)

These are values in `db.config`, editable in Admin > Settings, or editable templates. None is hard-coded:

- reminder day, time and frequency, global and per case
- GST rate, payment schedule, payment terms
- stage after generating a pack
- warn on unpaid balance when submitting
- re-application rule (same case, new attempt, or a new linked case) and document validity windows
- retention months per case status
- checklists, onboarding fields, message templates, letter templates, package prices
- whether a letter template may be downloaded blank by clients (off by default)

## Mock AI vs real AI

The document reader is a deterministic **mock**. It infers the document type from the filename and fills plausible fields from the client profile. Filename hints: `blurry` (unreadable expiry), `expired`, `partial` or `page1` (missing pages), `mismatch` (a different name on the document). The real Claude vision call must run on a server, so the API key is never in browser code. See `ARCHITECTURE.md`.

## What is simulated

| Area | Prototype | Production |
|---|---|---|
| Database | `localStorage` JSON, versioned | Postgres via Prisma (see `prisma/schema.prisma`) |
| Login | Demo passwords and magic links in `sessionStorage` | SSO for staff, OTP or magic link for clients |
| Access control | `can()` and guards on every `api.*` call | The same matrix inside every route and server action |
| Files | Browser memory, small files mirrored to `localStorage` | Private S3-compatible bucket in Singapore |
| WhatsApp and email | Mock providers write to the Outbox | WhatsApp Business Cloud API, an email service |
| Payments | Mock provider settles instantly | A payment gateway with signed webhooks |
| Pack and letter files | Built in the browser with pdf-lib and JSZip | A server job |
| CRM, Google Drive, accounting | Interfaces with mock or stub providers | The real systems once chosen |
| Scheduler | Buttons that simulate the cron job | A scheduled function every hour |

## Security and PDPA notes (prototype level)

- Clients can only read their own case. Consultants only see their own leads and cases. Opening another case or a page without permission shows "Access denied", and the API refuses the call too.
- Letters and letter templates are staff-only. A client only sees a blank form if staff switched that on for the template, and each download is logged.
- Reminder messages contain document labels, dates and staff remarks only, never ID numbers. The staff AI panel masks ID numbers.
- Stage changes, document actions, payments, permission changes and letter downloads are written to the audit trail with who, when, and before and after values.
- **TODO (data retention):** the period per status is a setting, but nothing is deleted in the prototype. Production needs a scheduled deletion job and a PDPA notice.
- **TODO (consent):** record the consent given on the public enquiry form.

## Files

```
index.html           app shell
css/styles.css       all styles (mobile-first, no external fonts or CDNs)
js/                  ES modules (see ARCHITECTURE.md)
vendor/              pdf-lib and JSZip (with licences), loaded as globals
seed-files/          specimen documents for upload demos
prisma/schema.prisma production data model (a spec that passes `prisma validate`, not executed)
jsconfig.json        optional type-check config; js/types.js has the JSDoc typedefs
tests/e2e/           browser tests
ARCHITECTURE.md      interfaces, data model, and what production needs
```
