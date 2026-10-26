// Supabase access: auth, receipts, photos, sharing, and an offline queue for new photos.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { problems, statementProblems } from './vat.js';

const SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/+esm';

export let sb = null;

export async function initClient() {
  const { createClient } = await import(SUPABASE_JS);
  sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return sb;
}

// ---------- receipts ----------

export async function listReceipts(ownerId) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('receipts').select('*').eq('user_id', ownerId)
      .order('receipt_date', { ascending: false, nullsFirst: true })
      .order('created_at', { ascending: false })
      .range(from, from + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) return all;
  }
}

export function watchReceipts(ownerId, onChange, table = 'receipts') {
  const channel = sb.channel(`${table}-${ownerId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table, filter: `user_id=eq.${ownerId}` }, onChange)
    .subscribe();
  return () => sb.removeChannel(channel);
}

// ---------- filed quarters ----------

export async function listPeriods(ownerId) {
  const { data, error } = await sb.from('periods').select('*').eq('user_id', ownerId).order('period');
  if (error) throw error;
  return data;
}

// Locks a quarter for good: the database refuses changes to its records from then on.
export async function filePeriod(period, note) {
  const { error } = await sb.from('periods').insert({ period, note: note || null });
  if (error) throw error;
}

// A correction is a new record with the right values; the overview books the difference with the original.
const CORRECTION_FIELDS = {
  receipts: ['user_id', 'doc_type', 'store', 'store_address', 'description', 'category', 'receipt_date', 'currency', 'total',
    'vat_country', 'vat_lines', 'fx_rate', 'fx_date', 'notes', 'annual_only'],
  statements: ['user_id', 'agency', 'agency_country', 'agency_address', 'statement_no', 'statement_date', 'booking_date',
    'currency', 'fx_rate', 'fx_date', 'lines', 'total_paid', 'notes'],
};
export async function createCorrection(table, rec) {
  const row = Object.fromEntries(CORRECTION_FIELDS[table].map((k) => [k, rec[k] ?? null]));
  Object.assign(row, { corrects: rec.id, status: 'review', file_path: null, file_type: null });
  const { data, error } = await sb.from(table).insert(row).select().single();
  if (error) throw error;
  return data;
}

// ---------- agency statements ----------

export async function listStatements(ownerId) {
  const { data, error } = await sb.from('statements').select('*').eq('user_id', ownerId)
    .order('statement_date', { ascending: false, nullsFirst: true }).order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

export async function saveStatement(st) {
  const fields = {
    agency: st.agency || null, agency_country: st.agency_country || 'NL', agency_address: st.agency_address || null,
    statement_no: st.statement_no || null, statement_date: st.statement_date || null, booking_date: st.booking_date || null,
    currency: st.currency || 'EUR',
    fx_rate: st.currency === 'EUR' ? 1 : numOrNull(st.fx_rate), fx_date: st.currency === 'EUR' ? null : st.fx_date || null,
    total_paid: numOrNull(st.total_paid), notes: st.notes || null,
    lines: (st.lines || []).map((l) => ({
      job_date: l.job_date || null, client: l.client || null, description: l.description || null, invoice_no: l.invoice_no || null,
      kind: l.kind || 'other', fee: numOrNull(l.fee), vat_rate: numOrNull(l.vat_rate) ?? 0, vat: numOrNull(l.vat) ?? 0,
      expenses: numOrNull(l.expenses) ?? 0, receipt_ids: l.receipt_ids || [],
      deductions: (l.deductions || []).map((d) => ({ type: d.type || 'other', label: d.label || null, amount: numOrNull(d.amount), vat: numOrNull(d.vat) ?? 0, reverse_charge: !!d.reverse_charge })),
    })),
  };
  fields.status = statementProblems(fields).length ? 'review' : 'done';
  const { data, error } = await sb.from('statements').update(fields).eq('id', st.id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteStatement(st) {
  if (st.file_path) await sb.storage.from('receipts').remove([st.file_path]);
  const { error } = await sb.from('statements').delete().eq('id', st.id);
  if (error) throw error;
}

export async function saveReceipt(r) {
  const fields = {
    doc_type: r.doc_type || 'receipt', store: r.store || null, store_address: r.store_address || null, description: r.description || null, category: r.category || null,
    receipt_date: r.receipt_date || null, currency: r.currency || 'EUR',
    total: r.total === '' || r.total == null ? null : Number(r.total),
    vat_country: r.vat_country || 'NL',
    vat_lines: (r.vat_lines || []).map((l) => ({
      rate: l.rate === null || l.rate === '' ? null : Number(l.rate),
      net: l.net === '' || l.net == null ? null : Number(l.net),
      vat: l.rate === null ? 0 : l.vat === '' || l.vat == null ? null : Number(l.vat),
    })),
    fx_rate: r.currency === 'EUR' ? 1 : r.fx_rate === '' || r.fx_rate == null ? null : Number(r.fx_rate),
    fx_date: r.currency === 'EUR' ? null : r.fx_date || null,
    notes: r.notes || null,
    annual_only: !!r.annual_only,
  };
  fields.status = problems(fields).length ? 'review' : 'done';
  const { data, error } = await sb.from('receipts').update(fields).eq('id', r.id).select().single();
  if (error) throw error;
  return data;
}

// A record without a document yet: everything is filled in by hand.
export async function createManual(userId, extra = {}) {
  const { data, error } = await sb.from('receipts')
    .insert({ ...extra, user_id: userId, status: 'review', doc_type: 'none', receipt_date: new Date().toISOString().slice(0, 10) })
    .select().single();
  if (error) throw error;
  return data;
}

// Add or replace the photo/PDF of an existing record. Does not read it; "Read again" does.
export async function attachFile(r, file) {
  const prepared = await prepareFile(file);
  const path = `${r.user_id}/${r.id}.${prepared.ext}`;
  if (r.file_path && r.file_path !== path) await sb.storage.from('receipts').remove([r.file_path]);
  const up = await sb.storage.from('receipts').upload(path, prepared.blob, { contentType: prepared.type, upsert: true });
  if (up.error) throw up.error;
  urlCache.delete(path);
  const { data, error } = await sb.from('receipts')
    .update({ file_path: path, file_type: prepared.type, doc_type: r.doc_type === 'none' ? 'receipt' : r.doc_type })
    .eq('id', r.id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteReceipt(r) {
  if (r.file_path) await sb.storage.from('receipts').remove([r.file_path]);
  const { error } = await sb.from('receipts').delete().eq('id', r.id);
  if (error) throw error;
}

export async function readAgain(id, kind = 'receipt') {
  await sb.from(kind === 'statement' ? 'statements' : 'receipts').update({ status: 'processing', error: null }).eq('id', id);
  const { data, error } = await sb.functions.invoke('extract', { body: { id, kind } });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return data;
}

const urlCache = new Map();
export async function fileUrl(path) {
  const hit = urlCache.get(path);
  if (hit && hit.expires > Date.now()) return hit.url;
  const { data, error } = await sb.storage.from('receipts').createSignedUrl(path, 3600);
  if (error) throw error;
  urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 3500 * 1000 });
  return data.signedUrl;
}

export async function fileBlob(path) {
  const { data, error } = await sb.storage.from('receipts').download(path);
  if (error) throw error;
  return data;
}

// ECB reference rate for the receipt date: { rate (EUR per 1 unit), date (the business day it is from) }.
export async function ecbRate(currency, date) {
  if (!currency || currency === 'EUR') return { rate: 1, date: null };
  if (!date) return null;
  const res = await fetch(`https://api.frankfurter.dev/v1/${date}?base=${currency}&symbols=EUR`);
  if (!res.ok) return null;
  const data = await res.json();
  return data?.rates?.EUR ? { rate: data.rates.EUR, date: data.date } : null;
}

// ECB EUR->USD rates for a period. Returns lookup(date) -> { rate, date } using the last business day on or before it.
export async function eurUsdRates(start, end) {
  const from = new Date(`${start}T12:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 10); // weekends and holidays at the start of the period
  if (from.toISOString().slice(0, 10) > end) return () => null; // period entirely in the future
  const res = await fetch(`https://api.frankfurter.dev/v1/${from.toISOString().slice(0, 10)}..${end}?base=EUR&symbols=USD`);
  if (!res.ok) throw new Error(`Could not load USD exchange rates (${res.status})`);
  const days = Object.entries((await res.json()).rates || {}).map(([d, r]) => [d, r.USD]).sort((a, b) => a[0].localeCompare(b[0]));
  return (date) => {
    let hit = null;
    for (const d of days) { if (d[0] <= date) hit = d; else break; }
    return hit ? { rate: hit[1], date: hit[0] } : null;
  };
}

// ---------- sharing ----------

export async function myShares() {
  const { data, error } = await sb.from('shares').select('*').order('created_at');
  if (error) throw error;
  return data;
}

export async function addShare(email) {
  const { error } = await sb.from('shares').insert({ viewer_email: email.trim().toLowerCase() });
  if (error) throw error;
}

export async function removeShare(ownerId, email) {
  const { error } = await sb.from('shares').delete().eq('owner_id', ownerId).eq('viewer_email', email);
  if (error) throw error;
}

// ---------- adding photos (works offline: queued in IndexedDB) ----------

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('receipts', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('outbox', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function outbox(mode, fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('outbox', mode);
    const req = fn(t.objectStore('outbox'));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
}
export const queued = () => outbox('readonly', (s) => s.getAll());
export const unqueue = (id) => outbox('readwrite', (s) => s.delete(id));

// Phone photos are large: scale to 2000 px on the long side, JPEG. PDFs pass through.
async function prepareFile(file) {
  // Some apps hand over PDFs without a file type: go by the name too.
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) {
    // Copy the contents now: Safari can lose access to the picked file (iCloud Drive, Downloads) before the upload,
    // and a stored file reference then uploads empty.
    const bytes = await file.arrayBuffer();
    if (!bytes.byteLength) throw new Error('the file is empty or could not be read');
    return { blob: new Blob([bytes], { type: 'application/pdf' }), type: 'application/pdf', ext: 'pdf' };
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
  return { blob, type: 'image/jpeg', ext: 'jpg' };
}

// kind: 'receipt' or 'statement' (agency statement). extra: fields for the new record, e.g. { booking_date }.
export async function addFiles(files, userId, kind = 'receipt', extra = {}) {
  const failed = [];
  for (const file of files) {
    try {
      const prepared = await prepareFile(file);
      const item = { id: crypto.randomUUID(), userId, kind, extra, ...prepared, added: new Date().toISOString() };
      await outbox('readwrite', (s) => s.put(item));
    } catch (e) {
      failed.push(`${file.name || 'file'}: ${e.message || e}`);
    }
  }
  await flushOutbox();
  if (failed.length) throw new Error(`Could not add ${failed.join('; ')}. Use a PDF, JPEG or PNG.`);
}

let flushing = null;
// Last upload problem, shown under the waiting items.
export let lastUploadError = '';
let dropped = 0;
// Number of unreadable queued files removed since the last call.
export const takeDropped = () => { const n = dropped; dropped = 0; return n; };
export function flushOutbox() {
  if (flushing) return flushing;
  flushing = (async () => {
    // Keep going until the queue is empty: photos taken during an upload join this run.
    for (;;) {
      const items = await queued();
      if (!items.length) return;
      if (!navigator.onLine) return;
      for (const item of items) {
        // Items queued by older versions can hold a file that can no longer be read (iOS still reports
        // its size): read it now, and drop it with a message if that fails or it is empty.
        let body = null;
        try {
          const bytes = item.blob ? await item.blob.arrayBuffer() : null;
          if (bytes && bytes.byteLength) body = new Blob([bytes], { type: item.type });
        } catch {}
        if (!body) {
          await outbox('readwrite', (s) => s.delete(item.id));
          dropped++;
          continue;
        }
        const statement = item.kind === 'statement';
        const path = `${item.userId}/${statement ? 'st-' : ''}${item.id}.${item.ext}`;
        const up = await sb.storage.from('receipts').upload(path, body, { contentType: item.type, upsert: true });
        if (up.error) {
          // The server calls it empty: retrying will not help.
          if (/no content|empty/i.test(up.error.message || '')) {
            await outbox('readwrite', (s) => s.delete(item.id));
            dropped++;
            continue;
          }
          lastUploadError = up.error.message;
          console.warn('upload failed', up.error);
          return;
        }
        const ins = await sb.from(statement ? 'statements' : 'receipts')
          .upsert({ ...(item.extra || {}), id: item.id, user_id: item.userId, file_path: path, file_type: item.type, status: 'processing' });
        if (ins.error) { lastUploadError = ins.error.message; console.warn('insert failed', ins.error); return; }
        await outbox('readwrite', (s) => s.delete(item.id));
        lastUploadError = '';
        // Reading takes a few seconds; the row updates through realtime when done.
        sb.functions.invoke('extract', { body: { id: item.id, kind: item.kind || 'receipt' } }).catch(console.warn);
      }
    }
  })().finally(() => { flushing = null; });
  return flushing;
}
