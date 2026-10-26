// Quarter exports for the accountant: Excel (summary + receipts), PDF (overview + photos), ZIP (Excel + photos).
import { summarize, vatLabel, countryName, DOC_TYPES, weakProof, fmtDate, money } from './vat.js';
import { fileBlob } from './api.js';

const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
const JSPDF_URL = 'https://cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm';
const AUTOTABLE_URL = 'https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/+esm';
const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm';

const safe = (s) => String(s || '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40);

// Receipts sorted by date get numbers 1..n; the same number is on the photo file name and in the PDF.
export function numbered(receipts) {
  return [...receipts]
    .sort((a, b) => (a.receipt_date || '').localeCompare(b.receipt_date || '') || a.created_at.localeCompare(b.created_at))
    .map((r, i) => ({ r, no: i + 1, file: r.file_path ? `${String(i + 1).padStart(3, '0')}_${r.receipt_date || 'no-date'}_${safe(r.store || r.description)}.${r.file_path.split('.').pop()}` : '' }));
}

const status = (r) => (r.status === 'done' ? 'Checked' : 'Needs checking');

// Rows shared by Excel and PDF.
function tables(receipts) {
  const s = summarize(receipts);
  const nums = new Map(numbered(receipts).map((n) => [n.r.id, n]));
  const unknown = (g) => g.key.endsWith(':unknown');
  const groupRows = (part) => part.groups.map((g) => [g.label, g.count, unknown(g) ? null : g.net, unknown(g) ? null : g.vat, g.gross]);
  const detail = [...s.rows]
    .sort((a, b) => nums.get(a.receipt.id).no - nums.get(b.receipt.id).no)
    .map((row) => ({ row, n: nums.get(row.receipt.id) }));
  return { s, nums, groupRows, detail };
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- Excel ----------

async function buildExcel(receipts, meta) {
  const XLSX = await import(XLSX_URL);
  const { s, groupRows, detail } = tables(receipts);
  const head = ['VAT category', 'Receipts', 'Net', 'VAT', 'Gross'];
  const aoa = [[`Receipts ${meta.title}`], [meta.owner || ''], []];
  const moneyCells = []; // rows whose columns 2..4 hold amounts
  const push = (row, amounts = false) => { if (amounts) moneyCells.push(aoa.length); aoa.push(row); };
  if (s.home.groups.length) {
    push(['Netherlands (EUR)']); push(head);
    groupRows(s.home).forEach((r) => push(r, true));
    push(['Total Netherlands', s.home.count, s.home.net, s.home.vat, s.home.gross], true);
    push(['Dutch VAT to deduct (input tax)', null, null, s.homeVat, null], true);
    if (s.weakVat > 0) push(['  of which on a payment receipt or no document', null, null, s.weakVat, null], true);
    push([]);
  }
  if (s.foreign.groups.length) {
    push(['Foreign VAT, not on the Dutch VAT return (EUR)']); push(head);
    groupRows(s.foreign).forEach((r) => push(r, true));
    push(['Total foreign', s.foreign.count, s.foreign.net, s.foreign.vat, s.foreign.gross], true);
    push([]);
    push(['Foreign VAT per country', 'Receipts', 'Net', 'VAT', 'Gross']);
    s.foreign.countries.forEach((c) => push([c.name, c.count, c.net, c.vat, c.gross], true));
    push([]);
  }
  push(['All receipts', receipts.length, s.total.net, s.total.vat, s.total.gross], true);
  if (s.open.length) push([`${s.open.length} receipt(s) not checked yet: see Status on the Receipts sheet`]);
  push(['Amounts in EUR; foreign currencies at the ECB rate on the receipt date.']);

  const sum = XLSX.utils.aoa_to_sheet(aoa);
  for (const r of moneyCells) for (const c of [2, 3, 4]) {
    const cell = sum[XLSX.utils.encode_cell({ r, c })];
    if (cell && cell.t === 'n') cell.z = '#,##0.00';
  }
  sum['!cols'] = [{ wch: 46 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];

  const header = ['No.', 'Date', 'Store', 'Address', 'Country', 'Description', 'Category', 'Document', 'VAT category', 'VAT rate',
    'Net EUR', 'VAT EUR', 'Gross EUR', 'Currency', 'Gross in currency', 'Exchange rate', 'Status', 'Notes', 'Photo file'];
  const rows = detail.map(({ row, n }) => {
    const r = row.receipt;
    return [n.no, r.receipt_date ? new Date(`${r.receipt_date}T12:00:00`) : null, r.store, r.store_address, countryName(r.vat_country || 'NL'),
      r.description, r.category, DOC_TYPES[r.doc_type || 'receipt'], vatLabel(row.key),
      row.rate === null || row.rate === undefined ? null : row.rate / 100, row.net, row.vat, row.gross,
      r.currency, r.currency === 'EUR' ? null : row.gross_orig, r.currency === 'EUR' ? null : Number(r.fx_rate) || null,
      status(r), r.notes, n.file];
  });
  const det = XLSX.utils.aoa_to_sheet([header, ...rows], { cellDates: true });
  for (let i = 1; i <= rows.length; i++) {
    const fmt = (c, z) => { const cell = det[XLSX.utils.encode_cell({ r: i, c })]; if (cell && (cell.t === 'n' || cell.t === 'd')) cell.z = z; };
    fmt(1, 'yyyy-mm-dd'); fmt(9, '0%'); [10, 11, 12, 14].forEach((c) => fmt(c, '#,##0.00')); fmt(15, '0.0000');
  }
  det['!cols'] = [6, 11, 24, 30, 14, 30, 22, 20, 26, 8, 11, 11, 11, 8, 12, 11, 14, 24, 40].map((wch) => ({ wch }));
  det['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sum, 'Summary');
  XLSX.utils.book_append_sheet(wb, det, 'Receipts');
  const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellDates: true });
  return new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function downloadExcel(receipts, meta) {
  download(await buildExcel(receipts, meta), `${meta.fileBase}.xlsx`);
}

// ---------- PDF ----------

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = () => reject(fr.error);
  fr.readAsDataURL(blob);
});

export async function downloadPdf(receipts, meta, onProgress) {
  const [{ jsPDF }, plugin] = await Promise.all([import(JSPDF_URL), import(AUTOTABLE_URL)]);
  // The CDN build wraps the CommonJS module: the function sits one level deeper.
  const autoTable = [plugin.default, plugin.default?.default].find((f) => typeof f === 'function');
  const { s, groupRows, detail } = tables(receipts);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const eur = (v) => (v === null || v === undefined ? '-' : money(v));
  const green = [47, 111, 94];
  const style = {
    theme: 'striped', headStyles: { fillColor: green }, styles: { fontSize: 9, cellPadding: 1.6 },
    columnStyles: { 0: { cellWidth: 82 }, 1: { halign: 'right', cellWidth: 20 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  };
  let y = 18;
  const heading = (text) => { doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.text(text, 14, y); doc.setFont('helvetica', 'normal'); y += 2; };
  const after = () => { y = doc.lastAutoTable.finalY + 9; };
  const fmtRow = (r) => [r[0], String(r[1] ?? ''), eur(r[2]), eur(r[3]), eur(r[4])];

  doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.text(`Receipts ${meta.title}`, 14, y);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text(`${meta.owner || ''}  ·  created ${new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}  ·  amounts in EUR`, 14, y + 6);
  y += 16;

  const head = [['VAT category', 'Receipts', 'Net', 'VAT', 'Gross']];
  if (s.home.groups.length) {
    heading('Netherlands');
    const foot = [['Total Netherlands', String(s.home.count), eur(s.home.net), eur(s.home.vat), eur(s.home.gross)],
      ['Dutch VAT to deduct (input tax)', '', '', eur(s.homeVat), '']];
    if (s.weakVat > 0) foot.push(['of which on a payment receipt or no document', '', '', eur(s.weakVat), '']);
    autoTable(doc, { ...style, startY: y, head, body: groupRows(s.home).map(fmtRow), foot, footStyles: { fillColor: [226, 239, 233], textColor: 20 } });
    after();
  }
  if (s.foreign.groups.length) {
    heading('Foreign VAT (not on the Dutch VAT return)');
    autoTable(doc, { ...style, startY: y, head, body: groupRows(s.foreign).map(fmtRow),
      foot: [['Total foreign', String(s.foreign.count), eur(s.foreign.net), eur(s.foreign.vat), eur(s.foreign.gross)]],
      footStyles: { fillColor: [226, 239, 233], textColor: 20 } });
    after();
    autoTable(doc, { ...style, startY: y, head: [['Per country', 'Receipts', 'Net', 'VAT', 'Gross']],
      body: s.foreign.countries.map((c) => [c.name, String(c.count), eur(c.net), eur(c.vat), eur(c.gross)]) });
    after();
  }
  doc.setFontSize(9);
  doc.text(`All receipts: ${receipts.length}, gross ${eur(s.total.gross)}, VAT ${eur(s.total.vat)}.${s.open.length ? ` ${s.open.length} not checked yet.` : ''}`, 14, y);
  y += 5;
  doc.text('Foreign currencies at the ECB rate on the receipt date.', 14, y);
  y += 9;

  heading('Receipts');
  autoTable(doc, {
    ...style, startY: y, styles: { fontSize: 7.5, cellPadding: 1.2 },
    head: [['No.', 'Date', 'Store / description', 'Country', 'Category', 'Document', 'VAT category', 'Net', 'VAT', 'Gross']],
    body: detail.map(({ row, n }) => {
      const r = row.receipt;
      return [String(n.no), r.receipt_date || '', [r.store, r.description].filter(Boolean).join(' - ') + (r.status === 'done' ? '' : ' (check)'),
        countryName(r.vat_country || 'NL'), r.category || '', DOC_TYPES[r.doc_type || 'receipt'], vatLabel(row.key), eur(row.net), eur(row.vat), eur(row.gross)];
    }),
    columnStyles: { 0: { halign: 'right', cellWidth: 8 }, 1: { cellWidth: 17 }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' } },
  });

  // One page per receipt photo, numbered like the table.
  const withPhotos = numbered(receipts).filter((n) => n.r.file_path);
  let done = 0;
  for (const n of withPhotos) {
    onProgress?.(++done, withPhotos.length);
    doc.addPage();
    doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    const r = n.r;
    doc.text(`No. ${n.no}  ·  ${r.receipt_date ? fmtDate(r.receipt_date) : 'no date'}  ·  ${r.store || r.description || ''}  ·  ${money(r.total, r.currency || 'EUR')}`, 14, 14, { maxWidth: W - 28 });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    if (weakProof(r)) doc.text(DOC_TYPES[r.doc_type], 14, 19);
    if (r.file_type === 'application/pdf') {
      doc.text('This receipt is a PDF: see the ZIP export or the app.', 14, 30);
      continue;
    }
    try {
      const blob = await fileBlob(r.file_path);
      const bmp = await createImageBitmap(blob);
      const maxW = W - 28, maxH = H - 36;
      const scale = Math.min(maxW / bmp.width, maxH / bmp.height);
      const w = bmp.width * scale, h = bmp.height * scale;
      doc.addImage(await blobToDataUrl(blob), r.file_type === 'image/png' ? 'PNG' : 'JPEG', (W - w) / 2, 24, w, h);
    } catch (e) {
      doc.text(`Photo could not be loaded (${e.message}).`, 14, 30);
    }
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Receipts ${meta.title}  ·  page ${i} of ${pages}`, W / 2, H - 8, { align: 'center' });
    doc.setTextColor(0);
  }
  download(doc.output('blob'), `${meta.fileBase}.pdf`);
}

// ---------- ZIP ----------

export async function downloadZip(receipts, meta, onProgress) {
  const { default: JSZip } = await import(JSZIP_URL);
  const zip = new JSZip();
  zip.file(`${meta.fileBase}.xlsx`, await buildExcel(receipts, meta));
  const list = numbered(receipts).filter((n) => n.file);
  let done = 0;
  for (const n of list) {
    zip.file(`photos/${n.file}`, await fileBlob(n.r.file_path));
    onProgress?.(++done, list.length);
  }
  download(await zip.generateAsync({ type: 'blob' }), `${meta.fileBase}.zip`);
}
