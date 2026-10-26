// Reads a receipt photo (or PDF) with Claude and fills in the receipt row.
// Body: { "id": "<receipt id>" }. "Verify JWT with legacy secret" is off: the function checks the
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
  );

  let id = '';
  try {
    ({ id } = await req.json());
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: 'Not signed in' }, 401);

    const { data: row, error: rowErr } = await supabase
      .from('receipts').select('*').eq('id', id).eq('user_id', user.id).single();
    if (rowErr || !row) return json({ error: 'Receipt not found' }, 404);
    if (!row.file_path) return json({ error: 'Receipt has no photo' }, 400);

    const { data: file, error: fileErr } = await supabase.storage.from('receipts').download(row.file_path);
    if (fileErr || !file) throw new Error(`Photo download failed: ${fileErr?.message}`);
    const b64 = encodeBase64(new Uint8Array(await file.arrayBuffer()));
    const mediaType = row.file_type || file.type || 'image/jpeg';

    const source = mediaType === 'application/pdf'
      ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: b64 } }
      : { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType as 'image/jpeg', data: b64 } };

    const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
    const response = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content: [source, { type: 'text', text: 'Read this receipt.' }] }],
    } as any);

    if (response.stop_reason === 'refusal') throw new Error('The reader declined this image');
    const text = response.content.find((b: any) => b.type === 'text') as any;
    if (!text) throw new Error(`No result (stop reason ${response.stop_reason})`);
    const x = JSON.parse(text.text);

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
    if (id) await supabase.from('receipts').update({ status: 'review', error: message }).eq('id', id);
    return json({ error: message }, 500);
  }
});
