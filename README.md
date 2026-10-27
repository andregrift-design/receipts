# VH5

Receipts app for Viola Haqi (VH5). Photograph a receipt; Claude reads the store, address, date, amount, currency and VAT. You check what it found, fill in what's missing, and at the end of each quarter (or year) you or your accountants download an overview in EUR or USD.

Works on iPhone, iPad and Mac as a home-screen app. Everything syncs through your account.

Live at **https://andregrift-design.github.io/receipts/**

## How it works

Menu: **Expenses → Income → Overview → Settings**, plus search (⌘K, or 🔍 on the phone). On the phone the menu sits at the bottom.

- **Home**: the quarter new receipts and statements go into, the year so far against the same period last year (income, expenses, result, Dutch VAT), monthly charts and what needs attention.
- **Expenses**: take a photo (camera in the app, several in a row), add photos/PDFs, or enter by hand. Claude reads document type, store, address, country, description, category, date, currency, total and VAT per rate. Foreign currencies get the ECB rate of the receipt date. Tick **Annual costs only** for receipts the CPA should count as yearly costs but not on the VAT return; they get their own block in the overview and a "VAT return: No" column in Excel.
- **Income**: import agency statements (any country or currency). You enter an **import date** at import (today suggested); it decides the quarter. Every job shows the same fields: fee, VAT, expenses paid back, agency fee (+ VAT, reverse charge), website, transport, tax withheld, other. Done statements can have receipts attached per job. Duplicates are flagged.
- **Overview** (quarter or year, EUR or USD): 1 Expenses (Netherlands, foreign per country, per category), 2 Income (Dutch agencies, foreign agencies per country, fees and deductions by type), 3 Dutch VAT position, 4 corrections and late entries, 5 details. Expenses count by receipt date, income by import date. Exports (Excel, PDF) follow the same order; tick Receipts and/or Statements to add the documents (PDF: as pages; Excel: as a ZIP with the Excel).
- **Filing**: *Mark as filed with CPA* locks a quarter in the database. Receipts dated in a filed quarter that arrive later, and corrections, go to the first open quarter with a ↩︎ mark. A correction holds the right values; the overview books the difference with the original.
- **Feedback**: the speech-bubble button at the top of every page saves a comment with the page and version (table `feedback`). Read, tick off or delete them in Settings → Feedback; everyone with access to the account sees them.
- **Passkeys**: Settings → Passkeys → *Add a passkey* (Face ID / Touch ID, synced through iCloud Keychain). Then *Sign in with a passkey* on the sign-in screen; the password keeps working. Supabase Auth → Passkeys is on with relying party `andregrift-design.github.io` (beta feature, supabase-js 2.118 with `experimental.passkey`).
- **Accountants**: Settings → Share → their email. They sign up with that email and see everything read-only.
- Numbers always show as 1,000.00; fields accept 1,000.00, 1.000,00 and 12,50.

## Setup (already done)

Supabase project `receipts` (Frankfurt, separate from Ataraxia's `stoa`):

1. `supabase/schema.sql` in the SQL Editor: tables `receipts` and `shares`, row-level security, realtime, private storage bucket `receipts`.
2. `supabase/functions/extract/index.ts` deployed as edge function `extract` with "Verify JWT with legacy secret" **off** (the function checks the signed-in user itself).
3. Edge Functions → Secrets: `ANTHROPIC_API_KEY` (create one at console.anthropic.com → API keys).
4. Authentication → URL Configuration: Site URL `https://andregrift-design.github.io/receipts/`, redirect URL `https://andregrift-design.github.io/receipts/**`.
5. `src/config.js` holds the project URL and publishable key (public by design).

After you and your accountant have accounts: Authentication → Sign In / Providers → turn off **Allow new users to sign up**.

## Hosting

GitHub Pages from `main` of `andregrift-design/receipts`. To ship a change: commit, bump `VERSION` in `sw.js`, push.

## Files

| File | Purpose |
| --- | --- |
| `src/main.js` | Sign-in, app frame (menu, search, routes), shared data |
| `src/home.js` | Home: current quarter, year so far vs last year, monthly charts, to-dos |
| `src/kit.js` | Shared UI: number fields, badges, dialogs, document preview, icons |
| `src/expenses.js` | Expenses list, camera, receipt screen |
| `src/income.js` | Income list, agencies and clients, import date dialog, statement screen |
| `src/overview.js` | Overview and filing with the CPA |
| `src/search.js` | Spotlight-style search |
| `src/settings.js` | Account, sharing, filed quarters |
| `src/api.js` | Supabase calls, photo resize, offline upload queue |
| `src/vat.js` | All calculations: VAT, income, quarters, corrections, duplicates, numbers |
| `src/export.js` | Excel, PDF and ZIP export in overview order |
| `supabase/` | Database schema and the receipt reader |
| `tools/test.html` | Logic and export tests: open `/tools/test.html` on a local server |
| `tools/ui-test.html` | All screens with sample data, no account needed |
| `tools/make-icon.swift` | Builds the app icons and the background silhouette from `tools/icon-design.webp` (Viola’s icon design) |

## Costs

Supabase free tier (500 MB database, 1 GB photos: roughly 4,000 receipts). Claude: about 1–2 cents per receipt. Free-tier projects pause after a week without use; opening the dashboard wakes them.
