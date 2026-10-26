// Reads a receipt photo (or PDF) with Claude and fills in the receipt row.
// Body: { "id": "<receipt id>" }. Keep "Verify JWT" enabled: it runs as the signed-in user,
// so row-level security decides which receipt it may read and change.
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

const CATEGORIES = [
  'Travel', 'Fuel', 'Parking', 'Public transport', 'Accommodation', 'Meals',
  'Office supplies', 'Hardware', 'Software', 'Telecom', 'Training', 'Representation', 'Other',
];

const num = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const str = { anyOf: [{ type: 'string' }, { type: 'null' }] };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_receipt', 'store', 'description', 'category', 'date', 'currency', 'total', 'vat_country', 'vat_lines', 'issues'],
  properties: {
    is_receipt: { type: 'boolean', description: 'False when the image is not a receipt or invoice.' },
    store: { ...str, description: 'Name of the shop, restaurant or supplier as printed.' },
    description: { ...str, description: 'What was bought, in a few words of English, e.g. "Lunch, 2 people" or "Diesel 42.3 L".' },
    category: { anyOf: [{ type: 'string', enum: CATEGORIES }, { type: 'null' }] },
    date: { ...str, description: 'Purchase date as YYYY-MM-DD.' },
    currency: { ...str, description: 'ISO 4217 code, e.g. EUR, USD, GBP.' },
    total: { ...num, description: 'Total amount paid, VAT included. Positive number; negative only for a refund.' },
    vat_country: { ...str, description: 'ISO 3166-1 alpha-2 country whose VAT is charged, usually where the store is.' },
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

const SYSTEM = `You read receipts and invoices for a Dutch business owner's VAT administration.
Extract exactly what is printed. Never invent amounts: use null when a value is missing or unreadable, and say so in issues.
Dutch terms: BTW = VAT, "excl." = net, "incl." = gross, "hoog" usually 21%, "laag" usually 9%. German: MwSt/USt. French: TVA.
If the receipt shows only VAT totals per rate, derive net = gross - VAT for that rate. If it shows only the total and one rate, compute net and VAT from it, and note that you computed it.
If VAT is not shown at all, leave vat_lines empty and add an issue.
Amounts are numbers with a dot as decimal separator. Dates: receipts from the Netherlands and Europe are day-month-year.`;

async function fxRate(currency: string, date: string): Promise<number | null> {
  if (currency === 'EUR') return 1;
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/${date}?base=${currency}&symbols=EUR`);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.rates?.EUR ?? null;
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
    if (!x.is_receipt) issues.unshift('This does not look like a receipt.');

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

    const complete = x.is_receipt && date && x.total != null && (x.store || x.description) && adds;
    const fx = date ? await fxRate(currency, date) : null;
    if (currency !== 'EUR' && fx == null) issues.push(`No ECB exchange rate found for ${currency}.`);

    const update = {
      status: complete && (currency === 'EUR' || fx != null) && !issues.length ? 'done' : 'review',
      store: x.store, description: x.description, category: x.category,
      receipt_date: date, currency, total: x.total != null ? round2(x.total) : null,
      vat_country: /^[A-Z]{2}$/.test(x.vat_country || '') ? x.vat_country : row.vat_country,
      vat_lines: lines, fx_rate: fx, issues, extraction: x, error: null,
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
