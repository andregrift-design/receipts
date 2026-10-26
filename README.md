# VH5

Receipts app for Viola Haqi (VH5). Photograph a receipt; Claude reads the store, address, date, amount, currency and VAT. You check what it found, fill in what's missing, and at the end of each quarter (or year) you or your accountants download an overview in EUR or USD.

Works on iPhone, iPad and Mac as a home-screen app. Everything syncs through your account.

Live at **https://andregrift-design.github.io/receipts/**

## How it works

- **Add**: Take photo (camera inside the app, several in a row), Photos & files (photos and PDFs, several at once) or Enter manually. On a laptop you can drop files onto the page. Offline, photos wait on the device and upload when you're back online.
- **Read**: the `extract` edge function sends the photo to Claude and fills in document type, store, address, country (from the address), description, category, date, currency, total and one line per VAT rate. Foreign currencies get the ECB rate of the receipt date, stored with the date of that rate.
- **Check**: a receipt is **Done** when the date, store or description, amount, exchange rate and VAT are filled in and the VAT lines add up to the total. Anything else shows as **Check** with what's missing. The editor shows the photo next to the fields; "Fill" splits the total into net and VAT for the chosen rate.
- **No receipt?** Upload the payment receipt (card slip, bank screenshot) or tap Enter manually and attach a document later. Each record has a document type: Receipt, Invoice, Payment receipt only, No document. The overview shows how much Dutch VAT rests on payment receipts or no document.
- **Quarter**: Netherlands (21%, 9%, 0%, no VAT, VAT not entered, Dutch VAT to deduct) and foreign VAT (per country and rate, totals per country) shown separately, plus totals per expense category. Downloads: Excel (Summary and Receipts sheets), PDF (overview, list, one page per photo), ZIP (Excel + photos, numbered to match).
- **US CPA**: on the Quarter page switch to **USD · US CPA**. Every amount is converted on its receipt date (receipt currency to EUR at the ECB rate, then EUR to USD at the ECB rate of that day). Choose **Year** for the whole calendar year. Excel and PDF then come out in USD, with the rate and rate date per receipt.
- **Accountant**: Settings → Share with your accountant → their email. They create an account with that email at the same address and see your receipts and overviews read-only.

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
| `src/main.js` | Screens: sign-in, list, editor, quarter, settings |
| `src/api.js` | Supabase calls, photo resize, offline upload queue |
| `src/vat.js` | VAT categories, expense categories, checks, quarter totals |
| `src/export.js` | Excel, PDF and ZIP export |
| `supabase/` | Database schema and the receipt reader |
| `tools/test.html` | Logic and export tests: open `/tools/test.html` on a local server |
| `tools/ui-test.html` | All screens with sample data, no account needed |
| `tools/make-icon.swift` | Draws the app icons |

## Costs

Supabase free tier (500 MB database, 1 GB photos: roughly 4,000 receipts). Claude: about 1–2 cents per receipt. Free-tier projects pause after a week without use; opening the dashboard wakes them.
