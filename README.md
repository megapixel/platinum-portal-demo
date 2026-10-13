# Platinum Immigration Client Document Portal (prototype)

Ref: Q202607041IMMIGRATION. Prepared by Megapixel Consulting & Solutions Pte Ltd for Platinum Immigration Consultancy Pte. Ltd.

This is a clickable demo prototype, not production software. It is plain HTML, CSS and JavaScript, with no install, no build step and no network calls. All data is fake and lives in your browser.

## Open it

Double-click `index.html`, or run:

```bash
open index.html            # macOS
# or serve it so the reminder links use http:// instead of file://
npx serve .                # then open http://localhost:3000
```

Use **Reset demo** (top right, staff view) before each client presentation. It restores the seed data and moves all dates relative to today.

## Demo logins (password `demo1234` for all)

| Role | Email | Notes |
|---|---|---|
| Staff | `staff@demo.sg` | Daniel Koh, consultant |
| Staff | `sarah@demo.sg` | Sarah Lim, second consultant (for the staff filter) |
| Client | `elizabeth@demo.sg` | PR, 63%, 2 pending, 1 rejected with remark |
| Client | `ahmad@demo.sg` | Citizenship, 0%, just started |
| Client | `nurul@demo.sg` | PR with dependants, 40%, AI-flagged spouse passport, 10 days left (Amber) |
| Client | `weiling@demo.sg` | PR, 75%, past target date (Red) |
| Client | `rizal@demo.sg` | Citizenship, 55%, rejection not re-uploaded for 10 days (Red) |
| Client | `priya@demo.sg` | PR, 100%, Documents complete (use for demo step 6) |
| Client | `mai@demo.sg` | PR, 100%, Review and preparation |
| Client | `kittisak@demo.sg` | PR with dependants, Submitted |

The login page has one-click buttons for these accounts.

## Demo script

1. Log in as staff. The dashboard shows RAG status, KPIs and filters across 8 clients.
2. Click **Run weekly reminders**, then open **Outbox**. Elizabeth's message lists her 2 pending items, the rejected employer letter with the staff remark, and her portal link, shown in a WhatsApp-style phone. Clients with nothing outstanding are skipped.
3. Click the link in the phone. It opens a new tab with no session, so it goes to login. Log in as Elizabeth and you land on her case. Narrow the window, or use the browser's device toolbar, to show the phone layout.
4. Under **Passport (bio page)**, click Upload. Upload `seed-files/payslip_elizabeth_tan_2026-09.pdf`. The check flags it: "This looks like a payslip, but we expected a passport bio page." Upload again with `seed-files/passport_elizabeth_tan.png`, and all the required details are found.
5. Back in the staff tab (it refreshes by itself), open Elizabeth's case. Review the preview and the AI panel, then click **Accept**. Completion goes from 63% to 75%.
6. Open Priya Ramasamy's case and change the stage to **Review and preparation**. In her portal (`priya@demo.sg`), the stepper updates.

**Adding a new case:** on the dashboard, click **+ New case**. Enter the client details, case type, dependants (for PR with dependants), start date and consultant. This creates:
- the client's portal login (password `demo1234`);
- a checklist built from the matching template, with a set of items for each spouse and child;
- a target date two months after the start date;
- an optional welcome WhatsApp in the Outbox.

For demos, **Fill with sample data** fills every field with a random sample client (Malaysian, Indonesian, Filipino, Vietnamese, Thai or Myanmar, with a family for dependant cases). Every field stays editable, and clicking again picks another client.

New cases in "Collecting documents" are included in the weekly reminders.

Other sample files in `seed-files/`:
- `passport_blurry_elizabeth_tan.png` gives "The expiry date is not readable".
- `payslips_elizabeth_tan_apr-sep_2026.pdf` is a correct 6-month payslip upload.
- `employer_letter_signed_elizabeth_tan.pdf` fixes the rejected item.
- `noa_chong_wei_ling_ya2026.pdf` and `cpf_statement_rizal_santos_12m.pdf` are for the other clients.

Tip: run the staff and client views in two tabs side by side. They share data and refresh each other live.

## Mock AI vs real AI

This prototype always uses the **mock** document reader (`ai` section of `js/app.js`). It infers the document type from keywords in the filename and fills in plausible fields from the client profile:

- A filename with a different type than expected is flagged as a mismatch.
- `blurry` in the filename gives an unreadable expiry date.
- `expired` in the filename gives an expired document.
- `partial` or `page1` in the filename gives missing pages.
- Any other filename, such as a camera photo `IMG_1234.jpg`, is accepted with low confidence for staff to confirm.

The real Claude vision call is deliberately **not** in browser code, because it would expose the API key. In production it runs on the server behind the same `analyseDocument(file, mimeType, expected)` signature. See `ARCHITECTURE.md`.

## What is simulated

| Area | Prototype | Production |
|---|---|---|
| Database | `localStorage` JSON | Postgres/SQLite via Prisma |
| Login | Plain demo passwords, `sessionStorage` session | Server sessions plus OTP or SSO |
| Access control | Guard functions (`requireCaseAccess`, `requireStaff`) on every `api` call | The same guards inside every server route |
| File storage | Browser memory, small files mirrored to `localStorage` | S3-compatible bucket in Singapore, served via an authenticated route |
| WhatsApp | `MockWhatsAppProvider` writes to the Outbox | WhatsApp Business API or the CRM's WhatsApp channel |
| Weekly job | "Run weekly reminders" button (also `window.PlatinumPortal.runWeeklyReminders()`) | Scheduled function every Sunday |

## Security and PDPA notes (prototype level)

- Clients can only read their own case. Opening another case ID or `#/staff` shows "Access denied".
- Reminder messages contain document labels and staff remarks only, never NRIC or passport numbers. The staff AI panel masks ID numbers.
- Stage changes, uploads and accept/reject actions are recorded with who and when (Stage history and Audit trail on the case page).
- **TODO (data retention):** agree a retention period with Platinum Immigration, for example deleting documents a set number of months after the case outcome. Implement scheduled deletion from storage and the database, and document it in the PDPA notice.

## Files

```
index.html          app shell and demo banner
css/styles.css      all styles (mobile-first, no external fonts or CDNs)
js/app.js           the whole app, in sections that mirror production modules
seed-files/         specimen documents for upload demos
ARCHITECTURE.md     interfaces and what production needs
```
