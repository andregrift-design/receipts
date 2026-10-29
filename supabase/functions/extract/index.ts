// Reads a receipt photo (or PDF) with Claude and fills in the receipt row, or an agency statement into the statement row.
// Body: { "id": "<receipt id>" } or { "id": "<statement id>", "kind": "statement" }. "Verify JWT with legacy secret" is off: the function checks the
// signed-in user itself and runs as that user, so row-level security decides what it may read and change.
// Secret needed: ANTHROPIC_API_KEY (Edge Functions > Secrets).

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Category -> examples; the examples guide the reader.
const CATEGORY_EXAMPLES: Record<string, string> = {
  'Travel': 'flights, trains, travel bookings',
  'Accommodation': 'hotels, apartments, model housing',
  'Transportation': 'taxis, Uber, parking, public transport, fuel',
  'Meals & Drinks': 'restaurants, groceries, coffee',
  'Health & Beauty': 'skincare, cosmetics, haircare, nails, treatments',
  'Clothing & Accessories': 'clothing, shoes, bags, accessories',
  'Fitness & Wellness': 'gym, Pilates, yoga, personal training',
  'Portfolio & Content': 'test shoots, photographers, portfolio development',
  'Agency & Management': 'agency commissions, management fees',
  'Casting & Auditions': 'casting-related expenses, self-tapes',
  'Marketing & Promotion': 'website, comp cards, social media promotion',
  'Technology & Equipment': 'phone, laptop, lighting, camera equipment',
  'Software & Subscriptions': 'editing apps, cloud storage, professional tools',
  'Professional Services': 'accounting, legal, insurance',
  'Education & Training': 'runway coaching, acting, workshops',
  'Other': 'anything that fits none of the above',
};
const CATEGORIES = Object.keys(CATEGORY_EXAMPLES);

const num = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const str = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['document_type', 'store', 'store_address', 'description', 'category', 'date', 'currency', 'total', 'vat_country', 'vat_lines', 'issues'],
  properties: {
    document_type: {
      type: 'string',
      enum: ['receipt', 'invoice', 'payment', 'other'],
      description: 'receipt = till receipt; invoice = invoice; payment = only proof of payment (card terminal slip, bank or payment app screenshot, PayPal or card statement line); other = not a receipt at all.',
    },
    store: { ...str, description: 'Name of the shop, restaurant or supplier as printed.' },
    store_address: { ...str, description: 'Address of the store as printed: street, postcode, city, country if shown.' },
    description: { ...str, description: 'What was bought, in a few words of English, e.g. "Lunch, 2 people" or "Diesel 42.3 L".' },
    category: { anyOf: [{ type: 'string', enum: CATEGORIES }, { type: 'null' }], description: 'Expense category; see the list in the instructions.' },
    date: { ...str, description: 'Purchase date as YYYY-MM-DD.' },
    currency: { ...str, description: 'ISO 4217 code, e.g. EUR, USD, GBP.' },
    total: { ...num, description: 'Total amount paid, VAT included. Positive number; negative only for a refund.' },
    vat_country: { ...str, description: 'ISO 3166-1 alpha-2 country of the store, from its address (see instructions). This is also the country whose VAT is charged.' },
    vat_lines: {
      type: 'array',
      description: 'One line per VAT rate on the receipt. Use rate null for amounts without VAT (exempt, not taxed). Empty if VAT cannot be read.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['rate', 'net', 'vat'],
        properties: {
          rate: { ...num, description: 'VAT percentage, e.g. 21 or 9. Null = no VAT.' },
          net: { ...num, description: 'Amount excluding VAT for this rate.' },
          vat: { ...num, description: 'VAT amount for this rate.' },
        },
      },
    },
    issues: {
      type: 'array',
      items: { type: 'string' },
      description: 'Short English notes on anything unreadable, missing or guessed. Empty if everything is clearly printed.',
    },
  },
};

const SYSTEM = `You read receipts and invoices for the VAT administration of a self-employed model based in the Netherlands.
Extract exactly what is printed. Never invent amounts: use null when a value is missing or unreadable, and say so in issues.
Dutch terms: BTW = VAT, "excl." = net, "incl." = gross, "hoog" usually 21%, "laag" usually 9%. German: MwSt/USt. French: TVA.
If the receipt shows only VAT totals per rate, derive net = gross - VAT for that rate. If it shows only the total and one rate, compute net and VAT from it, and note that you computed it.
If VAT is not shown at all, leave vat_lines empty and add an issue.
Payment receipts (card terminal slips, bank or payment app confirmations) show only merchant, date and amount: never compute VAT for them; leave vat_lines empty and add the issue "Only a payment receipt: enter the VAT by hand if you know it." Use the merchant name as store, and the merchant's city or country if shown.
Amounts are numbers with a dot as decimal separator. Dates: receipts from the Netherlands and Europe are day-month-year.
Country: determine it from the store's address. Use, in this order: a country name; the postcode format (Dutch 1234 AB; Belgian 4 digits with a Belgian city; German 5 digits; French 5 digits; UK like SW1A 1AA); the phone prefix (+31, +32, +49, +33, +44); the VAT number prefix (NL...B01, BE0..., DE..., FR..., GB...); city names; the language and currency. If no address is printed, use the other clues and say in issues that the country was guessed. Online orders: the seller's country, unless the receipt charges Dutch VAT (21% BTW from a Dutch VAT number), then NL.
Pick the category that fits best:
${Object.entries(CATEGORY_EXAMPLES).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`;

// The API allows at most 16 nullable (anyOf) fields per schema: amounts that are 0 when absent are plain numbers.
const STATEMENT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_statement', 'agency', 'agency_country', 'agency_address', 'statement_no', 'statement_date', 'currency', 'total_paid', 'lines', 'issues'],
  properties: {
    is_statement: { type: 'boolean', description: 'False when this is not a payment statement or self-billing from an agency.' },
    agency: { ...str, description: 'Name of the model agency that pays.' },
    agency_country: { ...str, description: 'ISO 3166-1 alpha-2 country of the agency, from its address.' },
    agency_address: { type: 'string', description: 'Address of the agency as printed; empty if not shown.' },
    statement_no: { type: 'string', description: 'Payment / statement number; empty if not shown.' },
    statement_date: { ...str, description: 'Date of the statement or payment, YYYY-MM-DD.' },
    currency: { ...str, description: 'ISO 4217 code.' },
    total_paid: { ...num, description: 'Amount paid out to the model.' },
    lines: {
      type: 'array',
      description: 'One line per job (per client job and per fee type). Deductions belong to the job they are for.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['job_date', 'client', 'description', 'invoice_no', 'kind', 'fee', 'vat_rate', 'vat', 'expenses', 'expenses_vat', 'deductions', 'total'],
        properties: {
          job_date: { ...str, description: 'Date of the job, YYYY-MM-DD.' },
          client: { ...str, description: 'The client the job was for.' },
          description: { ...str, description: 'Short English description of the job, e.g. "Buy-out extension, TV campaign".' },
          invoice_no: { ...str, description: 'Invoice number(s) shown for the job, client and/or model invoice.' },
          kind: { type: 'string', enum: ['day_rate', 'usage', 'buyout', 'day_rate_usage', 'overtime', 'travel', 'other'] },
          fee: { ...num, description: 'The model fee for this job before deductions, excluding VAT.' },
          vat_rate: { type: 'number', description: 'VAT percentage charged on the fee (0 when none).' },
          vat: { type: 'number', description: 'VAT amount on the fee only, not on expenses (0 when none).' },
          expenses: { type: 'number', description: 'Expenses reimbursed to the model on top of the fee, excluding VAT (0 when none).' },
          expenses_vat: { type: 'number', description: 'VAT charged on the reimbursed expenses (0 when none). Keep it apart from the VAT on the fee.' },
          deductions: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['type', 'label', 'amount', 'vat', 'reverse_charge'],
              properties: {
                type: { type: 'string', enum: ['agency_fee', 'website', 'transport', 'tax_withheld', 'other'] },
                label: { type: 'string', description: 'As printed, e.g. "Agency fee 25%", "Website", "Uber", "Withholding tax".' },
                amount: { type: 'number', description: 'Deducted amount as a positive number, excluding VAT.' },
                vat: { type: 'number', description: 'VAT the agency charges on this deduction (0 when none).' },
                reverse_charge: { type: 'boolean', description: 'True when the agency charges this without VAT under reverse charge.' },
              },
            },
          },
          total: { ...num, description: 'Amount paid for this line: fee + VAT + expenses + VAT on expenses - deductions.' },
        },
      },
    },
    issues: { type: 'array', items: { type: 'string' }, description: 'Short English notes on anything unclear or guessed.' },
  },
};

const STATEMENT_SYSTEM = `You read payment statements from model agencies for the administration of a self-employed model based in the Netherlands.
Agencies pay the model for jobs and deduct their agency fee and sometimes costs (website, Uber/transport) or tax withheld.
Extract exactly what is printed. Never invent amounts; use null when unreadable and say so in issues.
Fees: day rate / work day / model rate = day_rate; usage, licence = usage; buy-out, buyout, extension of buy-out (verlenging) = buyout.
Deductions are positive amounts. A negative line such as "AGENCY FEE EUR -500" is a deduction of 500 on the job it belongs to, not a separate job.
If the PDF also contains the agency's own invoice for its fee, that is the same fee as the deduction: do not count it twice. When that invoice or the statement says reverse charge / VAT free / tax liability transferred, set reverse_charge true on the deduction.
Expenses paid back (onkosten, expenses, reiskosten) go in expenses, excluding VAT. When the agency charges VAT on them, put that VAT in expenses_vat and keep vat for the VAT on the fee only. If the statement shows only one VAT amount over fee and expenses together, split it: VAT on the fee = fee x VAT %, the rest is VAT on expenses.
Dutch terms: BTW = VAT, Netto = net, Inhouding = deduction, Uitbetaling = payment, Onkostenvergoeding = expenses paid back. Dates in Europe are day-month-year.
Agency country from its address, postcode, phone prefix or VAT number (NL..B01, ATU..., DE..., GB..., FR...).
Amounts are numbers with a dot as decimal separator.`;

// ECB reference rate (EUR per 1 unit of currency) on the date, or the last business day before it.
async function fxRate(currency: string, date: string): Promise<{ rate: number; date: string | null } | null> {
  if (currency === 'EUR') return { rate: 1, date: null };
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/${date}?base=${currency}&symbols=EUR`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.rates?.EUR ? { rate: data.rates.EUR, date: data.date } : null;
  } catch {
    return null;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function fileBlock(supabase: any, path: string, type: string | null) {
  const { data: file, error } = await supabase.storage.from('receipts').download(path);
  if (error || !file) throw new Error(`Download failed: ${error?.message}`);
  const b64 = encodeBase64(new Uint8Array(await file.arrayBuffer()));
  const mediaType = type || file.type || 'image/jpeg';
  return mediaType === 'application/pdf'
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: b64 } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType as 'image/jpeg', data: b64 } };
}

async function ask(system: string, schema: unknown, source: unknown, text: string) {
  const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content: [source, { type: 'text', text }] }],
  } as any);
  if (response.stop_reason === 'refusal') throw new Error('The reader declined this document');
  const out = response.content.find((b: any) => b.type === 'text') as any;
  if (!out) throw new Error(`No result (stop reason ${response.stop_reason})`);
  return JSON.parse(out.text);
}

async function readStatement(supabase: any, userId: string, id: string) {
  const { data: row, error: rowErr } = await supabase.from('statements').select('*').eq('id', id).eq('user_id', userId).single();
  if (rowErr || !row) throw new Error('Statement not found');
  if (!row.file_path) throw new Error('Statement has no document');
  const x = await ask(STATEMENT_SYSTEM, STATEMENT_SCHEMA, await fileBlock(supabase, row.file_path, row.file_type), 'Read this agency statement.');

  const issues: string[] = [...(x.issues || [])];
  if (!x.is_statement) issues.unshift('This does not look like an agency statement.');
  const isDate = (d: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
  const num = (v: unknown) => (typeof v === 'number' ? round2(v) : null);
  const lines = (x.lines || []).map((l: any) => ({
    job_date: isDate(l.job_date) ? l.job_date : null, client: l.client, description: l.description, invoice_no: l.invoice_no,
    kind: l.kind, fee: num(l.fee), vat_rate: l.vat_rate ?? 0, vat: num(l.vat) ?? 0, expenses: num(l.expenses) ?? 0, expenses_vat: num(l.expenses_vat) ?? 0,
    deductions: (l.deductions || []).map((d: any) => ({ type: d.type, label: d.label, amount: num(Math.abs(d.amount)), vat: num(d.vat) ?? 0, reverse_charge: !!d.reverse_charge })),
  }));
  const lineTotal = (l: any) => (l.fee ?? 0) + l.vat + l.expenses + l.expenses_vat - l.deductions.reduce((s: number, d: any) => s + (d.amount ?? 0) + (d.vat ?? 0), 0);
  const sum = round2(lines.reduce((s: number, l: any) => s + lineTotal(l), 0));
  const adds = x.total_paid != null && lines.length > 0 && Math.abs(sum - x.total_paid) <= 0.02 * lines.length;
  if (x.total_paid != null && lines.length && !adds) issues.push(`Lines add up to ${sum.toFixed(2)}, amount paid is ${Number(x.total_paid).toFixed(2)}.`);
  for (const l of lines) {
    if (l.fee == null) continue;
    const e = round2((l.fee * (l.vat_rate || 0)) / 100);
    if (Math.abs(l.vat - e) > 0.05 + Math.abs(e) * 0.002) issues.push(`VAT ${l.vat.toFixed(2)} doesn't match ${l.vat_rate}% of ${l.fee.toFixed(2)} (expected ${e.toFixed(2)}).`);
    if (l.expenses_vat) {
      const ex = round2((l.expenses * (l.vat_rate || 0)) / 100);
      if (Math.abs(l.expenses_vat - ex) > 0.05 + Math.abs(ex) * 0.002) issues.push(`VAT on expenses ${l.expenses_vat.toFixed(2)} doesn't match ${l.vat_rate}% of ${l.expenses.toFixed(2)} (expected ${ex.toFixed(2)}).`);
    }
  }

  const date = isDate(x.statement_date) ? x.statement_date : null;
  const currency = /^[A-Z]{3}$/.test(x.currency || '') ? x.currency : 'EUR';
  const fx = date ? await fxRate(currency, date) : null;
  if (currency !== 'EUR' && fx == null) issues.push(`No ECB exchange rate found for ${currency}.`);
  // The booking date is entered by the user at import; without it the statement is not done.
  const complete = x.is_statement && x.agency && date && adds && (currency === 'EUR' || fx != null) && !!row.booking_date;

  const update = {
    status: complete && !issues.length ? 'done' : 'review',
    agency: x.agency, agency_country: /^[A-Z]{2}$/.test(x.agency_country || '') ? x.agency_country : row.agency_country,
    agency_address: x.agency_address || null, statement_no: x.statement_no || null, statement_date: date, currency,
    fx_rate: fx?.rate ?? null, fx_date: fx?.date ?? null, total_paid: num(x.total_paid), lines, issues, extraction: x, error: null,
  };
  const { data: saved, error: saveErr } = await supabase.from('statements').update(update).eq('id', id).select().single();
  if (saveErr) throw saveErr;
  return saved;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  );

  let id = '';
  let kind = 'receipt';
  try {
    ({ id, kind = 'receipt' } = await req.json());
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: 'Not signed in' }, 401);
    if (kind === 'statement') return json(await readStatement(supabase, user.id, id));

    const { data: row, error: rowErr } = await supabase
      .from('receipts').select('*').eq('id', id).eq('user_id', user.id).single();
    if (rowErr || !row) return json({ error: 'Receipt not found' }, 404);
    if (!row.file_path) return json({ error: 'Receipt has no photo' }, 400);

    const x = await ask(SYSTEM, SCHEMA, await fileBlock(supabase, row.file_path, row.file_type), 'Read this receipt.');

    const issues: string[] = [...(x.issues || [])];
    if (x.document_type === 'other') issues.unshift('This does not look like a receipt.');
    const docType = x.document_type === 'invoice' || x.document_type === 'payment' ? x.document_type : 'receipt';

    const date = /^\d{4}-\d{2}-\d{2}$/.test(x.date || '') ? x.date : null;
    const currency = /^[A-Z]{3}$/.test(x.currency || '') ? x.currency : 'EUR';
    const lines = (x.vat_lines || [])
      .filter((l: any) => l.net != null || l.vat != null)
      .map((l: any) => ({
        rate: l.rate,
        net: l.net != null ? round2(l.net) : (l.vat != null && x.total != null && (x.vat_lines.length === 1) ? round2(x.total - l.vat) : null),
        vat: l.rate === null ? 0 : (l.vat != null ? round2(l.vat) : null),
      }));

    // Check that the lines add up to the total.
    const sum = lines.reduce((s: number, l: any) => s + (l.net ?? 0) + (l.vat ?? 0), 0);
    const adds = x.total != null && lines.length > 0 && lines.every((l: any) => l.net != null && l.vat != null)
      && Math.abs(sum - x.total) <= 0.02 * Math.max(1, lines.length);
    if (x.total != null && lines.length && !adds) issues.push(`VAT lines add up to ${sum.toFixed(2)}, total is ${Number(x.total).toFixed(2)}.`);
    // VAT must match its rate (a few cents of rounding allowed), same rule as the app.
    for (const l of lines) {
      if (l.rate == null || l.net == null || l.vat == null) continue;
      const e = round2((l.net * l.rate) / 100);
      if (Math.abs(l.vat - e) > 0.05 + Math.abs(e) * 0.002) issues.push(`VAT ${l.vat.toFixed(2)} doesn't match ${l.rate}% of ${l.net.toFixed(2)} (expected ${e.toFixed(2)}).`);
    }

    const complete = x.document_type !== 'other' && date && x.total != null && (x.store || x.description) && adds;
    const fx = date ? await fxRate(currency, date) : null;
    if (currency !== 'EUR' && fx == null) issues.push(`No ECB exchange rate found for ${currency}.`);

    const update = {
      status: complete && (currency === 'EUR' || fx != null) && !issues.length ? 'done' : 'review',
      doc_type: docType, store: x.store, store_address: x.store_address, description: x.description, category: x.category,
      receipt_date: date, currency, total: x.total != null ? round2(x.total) : null,
      vat_country: /^[A-Z]{2}$/.test(x.vat_country || '') ? x.vat_country : row.vat_country,
      vat_lines: lines, fx_rate: fx?.rate ?? null, fx_date: fx?.date ?? null, issues, extraction: x, error: null,
    };
    const { data: saved, error: saveErr } = await supabase.from('receipts').update(update).eq('id', id).select().single();
    if (saveErr) throw saveErr;
    return json(saved);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    if (id) await supabase.from(kind === 'statement' ? 'statements' : 'receipts').update({ status: 'review', error: message }).eq('id', id);
    return json({ error: message }, 500);
  }
});
