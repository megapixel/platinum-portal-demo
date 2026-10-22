# End-to-end tests

Plain Node scripts that drive the prototype in a real browser. They are not needed to run the demo.

```bash
cd tests/e2e
npm install                      # playwright-core and pdf-lib only (no browser download)
npm run serve &                  # serves the project on http://localhost:8123
CHROME_PATH="/path/to/chrome" npm test
```

`CHROME_PATH` defaults to Google Chrome on macOS. `PORTAL_URL` overrides the address.
Each script resets to the seed data itself, uses the real seed files in `seed-files/`, and prints PASS or FAIL per check.

| Script | Covers |
|---|---|
| `01-v1-demo-flow` | The v1 demo: reminders, magic link, AI flag, staff accept, stage change |
| `02-roles-sales-onboarding` | Phases 1 to 3: permissions, magic links, /apply, pipeline, convert, onboarding, submit for review, rejection, versioning |
| `04-consolidation` | Review queue with keyboard review, readiness checks, ZIP and merged PDF |
| `05-messaging` | Template editor, reminder rules, per-case overrides, channel preference, digests, alerts, message log |
| `06-payments` | Invoices, payments, Pay now, warn-not-block, PDF, CSV exports |
| `07-outcome-audit` | Outcome, re-application (both rules), audit timeline |
| `08-letters-integrations` | Letters, DOCX and PDF, client blank forms, Drive and CRM stubs, retention |
| `09-analytics-history` | Historical seed, analytics, CSV on every table, archived filters |
| `10-demo-script-v2` | The README demo script v2, steps 1 to 8, as written |
