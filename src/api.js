// Supabase access: auth, receipts, photos, sharing, and an offline queue for new photos.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { problems } from './vat.js';

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

export function watchReceipts(ownerId, onChange) {
  const channel = sb.channel(`receipts-${ownerId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'receipts', filter: `user_id=eq.${ownerId}` }, onChange)
    .subscribe();
  return () => sb.removeChannel(channel);
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
    notes: r.notes || null,
  };
  fields.status = problems(fields).length ? 'review' : 'done';
  const { data, error } = await sb.from('receipts').update(fields).eq('id', r.id).select().single();
  if (error) throw error;
  return data;
}

// A record without a document yet: everything is filled in by hand.
export async function createManual(userId) {
  const { data, error } = await sb.from('receipts')
    .insert({ user_id: userId, status: 'review', doc_type: 'none', receipt_date: new Date().toISOString().slice(0, 10) })
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

export async function readAgain(id) {
  await sb.from('receipts').update({ status: 'processing', error: null }).eq('id', id);
  const { data, error } = await sb.functions.invoke('extract', { body: { id } });
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

// ECB reference rate for the receipt date (EUR per 1 unit of the currency).
export async function ecbRate(currency, date) {
  if (!currency || currency === 'EUR') return 1;
  if (!date) return null;
  const res = await fetch(`https://api.frankfurter.dev/v1/${date}?base=${currency}&symbols=EUR`);
  if (!res.ok) return null;
  return (await res.json())?.rates?.EUR ?? null;
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

// Phone photos are large: scale to 2000 px on the long side, JPEG. PDFs pass through.
export async function prepareFile(file) {
  if (file.type === 'application/pdf') return { blob: file, type: 'application/pdf', ext: 'pdf' };
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
  return { blob, type: 'image/jpeg', ext: 'jpg' };
}

export async function addFiles(files, userId) {
  for (const file of files) {
    const prepared = await prepareFile(file);
    const item = { id: crypto.randomUUID(), userId, ...prepared, added: new Date().toISOString() };
    await outbox('readwrite', (s) => s.put(item));
  }
  return flushOutbox();
}

let flushing = null;
export function flushOutbox() {
  if (flushing) return flushing;
  flushing = (async () => {
    // Keep going until the queue is empty: photos taken during an upload join this run.
    for (;;) {
      const items = await queued();
      if (!items.length || !navigator.onLine) return;
      for (const item of items) {
        const path = `${item.userId}/${item.id}.${item.ext}`;
        const up = await sb.storage.from('receipts').upload(path, item.blob, { contentType: item.type, upsert: true });
        if (up.error) { console.warn('upload failed', up.error); return; }
        const ins = await sb.from('receipts').upsert({ id: item.id, user_id: item.userId, file_path: path, file_type: item.type, status: 'processing' });
        if (ins.error) { console.warn('insert failed', ins.error); return; }
        await outbox('readwrite', (s) => s.delete(item.id));
        // Reading takes a few seconds; the row updates through realtime when done.
        sb.functions.invoke('extract', { body: { id: item.id } }).catch(console.warn);
      }
    }
  })().finally(() => { flushing = null; });
  return flushing;
}
