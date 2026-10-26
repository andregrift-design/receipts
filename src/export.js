// Quarter exports for the accountant: CSV (summary + detail) and a ZIP with the CSV and all photos.
import { summarize, vatLabel, fmtDate, countryName } from './vat.js';
import { fileBlob } from './api.js';

const JSZIP = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';

export const getNumberFormat = () => localStorage.getItem('numberFormat') || 'nl';
export const setNumberFormat = (v) => localStorage.setItem('numberFormat', v);

function csvValue(v, fmt) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return fmt === 'nl' ? v.toFixed(2).replace('.', ',') : v.toFixed(2);
  const s = String(v);
  return /[";,\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const safe = (s) => String(s || '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40);

// Receipts sorted by date get numbers 1..n; the same number is on the photo file name.
export function numbered(receipts) {
  return [...receipts]
    .sort((a, b) => (a.receipt_date || '').localeCompare(b.receipt_date || '') || a.created_at.localeCompare(b.created_at))
    .map((r, i) => ({ r, no: i + 1, file: r.file_path ? `${String(i + 1).padStart(3, '0')}_${r.receipt_date || 'no-date'}_${safe(r.store || r.description)}.${r.file_path.split('.').pop()}` : '' }));
}

export function buildCsv(receipts, { title, owner }) {
  const fmt = getNumberFormat();
  const sep = fmt === 'nl' ? ';' : ',';
  const line = (cells) => cells.map((c) => csvValue(c, fmt)).join(sep);
  const s = summarize(receipts);
  const nums = new Map(numbered(receipts).map((n) => [n.r.id, n]));
  const out = [];
  out.push(line([`Receipts ${title}`]), line([owner || '']), '');
  const block = (title, part, totalLabel) => {
    out.push(line([title]));
    out.push(line(['VAT category', 'Receipts', 'Net', 'VAT', 'Gross']));
    for (const g of part.groups) {
      const unknown = g.key.endsWith(':unknown');
      out.push(line([g.label, String(g.count), unknown ? null : g.net, unknown ? null : g.vat, g.gross]));
    }
    out.push(line([totalLabel, String(part.count), part.net, part.vat, part.gross]));
    out.push('');
  };
  if (s.home.groups.length) block('Netherlands (EUR)', s.home, 'Total Netherlands');
  if (s.foreign.groups.length) {
    block('Foreign VAT, not on the Dutch VAT return (EUR)', s.foreign, 'Total foreign');
    out.push(line(['Foreign VAT per country', 'Receipts', 'Net', 'VAT', 'Gross']));
    for (const c of s.foreign.countries) out.push(line([c.name, String(c.count), c.net, c.vat, c.gross]));
    out.push('');
  }
  out.push(line(['Dutch VAT to deduct (input tax)', '', '', s.homeVat]));
  out.push(line(['Foreign VAT', '', '', s.foreignVat]));
  out.push(line(['All receipts', String(receipts.length), s.total.net, s.total.vat, s.total.gross]));
  if (s.open.length) out.push(line([`${s.open.length} receipt(s) not checked yet, see Status below`]));
  out.push('');
  out.push(line(['No.', 'Date', 'Store', 'Address', 'Country', 'Description', 'Category', 'VAT category', 'VAT rate', 'Net EUR', 'VAT EUR', 'Gross EUR',
    'Currency', 'Gross in currency', 'Exchange rate', 'Status', 'Notes', 'Photo file']));
  const rows = [...s.rows].sort((a, b) => nums.get(a.receipt.id).no - nums.get(b.receipt.id).no);
  for (const row of rows) {
    const r = row.receipt;
    const n = nums.get(r.id);
    out.push(line([String(n.no), r.receipt_date || '', r.store, r.store_address, countryName(r.vat_country || 'NL'), r.description, r.category, vatLabel(row.key),
      row.rate === null || row.rate === undefined ? '' : `${row.rate}%`, row.net, row.vat, row.gross,
      r.currency, r.currency === 'EUR' ? null : (row.gross_orig ?? null), r.currency === 'EUR' ? '' : String(r.fx_rate ?? '').replace('.', fmt === 'nl' ? ',' : '.'),
      r.status === 'done' ? 'Checked' : 'Needs checking', r.notes, n.file]));
  }
  // Excel opens UTF-8 correctly only with a BOM.
  return '\uFEFF' + out.join('\r\n') + '\r\n';
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function downloadCsv(receipts, meta) {
  download(new Blob([buildCsv(receipts, meta)], { type: 'text/csv;charset=utf-8' }), `${meta.fileBase}.csv`);
}

export async function downloadZip(receipts, meta, onProgress) {
  const { default: JSZip } = await import(JSZIP);
  const zip = new JSZip();
  zip.file(`${meta.fileBase}.csv`, buildCsv(receipts, meta));
  const list = numbered(receipts).filter((n) => n.file);
  let done = 0;
  for (const n of list) {
    zip.file(`photos/${n.file}`, await fileBlob(n.r.file_path));
    onProgress?.(++done, list.length);
  }
  download(await zip.generateAsync({ type: 'blob' }), `${meta.fileBase}.zip`);
}

export { fmtDate };
