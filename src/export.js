// Period exports for the accountants: Excel (summary, receipts, income), PDF (overview + photos), ZIP (Excel + documents).
import { summarize, vatLabel, countryName, DOC_TYPES, weakProof, fmtDate, money, eurConversion, summarizeIncome, mergeCategories, neg,
  statementAsReceipt, lineTotal, JOB_KINDS, round2 } from './vat.js';
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

// Rows shared by Excel and PDF. meta.conv converts to meta.currency (EUR by default).
function tables(receipts, meta) {
  const conv = meta.conv || eurConversion;
  const s = summarize(receipts, conv.factor);
  const nums = new Map(numbered(receipts).map((n) => [n.r.id, n]));
  const unknown = (g) => g.key.endsWith(':unknown');
  const groupRows = (part) => part.groups.map((g) => [g.label, g.count, unknown(g) ? null : g.net, unknown(g) ? null : g.vat, g.gross]);
  const detail = [...s.rows]
    .sort((a, b) => nums.get(a.receipt.id).no - nums.get(b.receipt.id).no)
    .map((row) => ({ row, n: nums.get(row.receipt.id) }));
  const statements = meta.statements || [];
  const inc = summarizeIncome(statements, conv.factor);
  const cats = mergeCategories(s.categories, inc.categories);
  const vatDue = round2(inc.homeVat - s.homeVat - inc.deductionVat);
  return { s, nums, groupRows, detail, conv, cur: meta.currency || 'EUR', statements, inc, cats, vatDue };
}

const dedSum = (l, type) => (l.deductions || []).filter((d) => (type ? d.type === type : true)).reduce((t, d) => t + (Number(d.amount) || 0), 0);

const conversionNote = (cur) => (cur === 'USD'
  ? 'Amounts in USD, converted on each receipt date: receipt currency to EUR at the ECB rate, then EUR to USD at the ECB rate of that day (last business day before it on weekends and holidays). Receipts in USD are not converted.'
  : 'Amounts in EUR; foreign currencies at the ECB rate on the receipt date (last business day before it on weekends and holidays).');

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
  const { s, groupRows, detail, conv, cur, inc, cats, vatDue } = tables(receipts, meta);
  const head = ['VAT category', 'Receipts', 'Net', 'VAT', 'Gross'];
  const aoa = [[`VH5 ${meta.title}`], [meta.owner || ''], []];
  const moneyCells = []; // rows whose columns 2..5 hold amounts
  const push = (row, amounts = false) => { if (amounts) moneyCells.push(aoa.length); aoa.push(row); };
  if (inc.count) {
    push([`Income from agency statements (${cur})`]);
    push(['Agency', 'Statements', 'Fees', 'VAT', 'Deductions', 'Paid']);
    inc.agencies.forEach((a) => push([`${a.agency} (${countryName(a.country)})`, a.count, a.fee, a.vat, -a.deductions, a.paid], true));
    push(['Total income', inc.count, inc.fee, inc.vat, -round2(inc.fee + inc.vat + inc.expenses - inc.paid), inc.paid], true);
    push([]);
    push(['Fees by type', null, 'Amount']);
    inc.kinds.forEach((k) => push([k.label, null, k.amount], true));
    if (inc.deductions.length) { push(['Deductions by type', null, 'Amount']); inc.deductions.forEach((d) => push([d.label, null, d.amount], true)); }
    if (inc.expenses) push(['Expenses reimbursed by agencies', null, inc.expenses], true);
    push([]);
  }
  if (cur === 'EUR' && (inc.count || s.home.groups.length)) {
    push(['Dutch VAT position (EUR)', null, 'Amount']);
    push(['VAT on income from Dutch agencies (to pay)', null, inc.homeVat], true);
    if (inc.reverseCharge) push(['Reverse-charge VAT on foreign agency fees (due)', null, inc.reverseCharge], true);
    push(['VAT on receipts (deductible)', null, -s.homeVat], true);
    if (inc.deductionVat) push(['VAT on Dutch agency deductions (deductible)', null, -inc.deductionVat], true);
    if (inc.reverseCharge) push(['Reverse-charge VAT on foreign agency fees (deductible)', null, -inc.reverseCharge], true);
    push([vatDue >= 0 ? 'VAT to pay' : 'VAT to get back', null, Math.abs(vatDue)], true);
    push([]);
  }
  if (s.home.groups.length) {
    push([`Netherlands (${cur})`]); push(head);
    groupRows(s.home).forEach((r) => push(r, true));
    push(['Total Netherlands', s.home.count, s.home.net, s.home.vat, s.home.gross], true);
    push(['Dutch VAT to deduct (input tax)', null, null, s.homeVat, null], true);
    if (s.weakVat > 0) push(['  of which on a payment receipt or no document', null, null, s.weakVat, null], true);
    push([]);
  }
  if (s.foreign.groups.length) {
    push([`Foreign VAT, not on the Dutch VAT return (${cur})`]); push(head);
    groupRows(s.foreign).forEach((r) => push(r, true));
    push(['Total foreign', s.foreign.count, s.foreign.net, s.foreign.vat, s.foreign.gross], true);
    push([]);
    push(['Foreign VAT per country', 'Receipts', 'Net', 'VAT', 'Gross']);
    s.foreign.countries.forEach((c) => push([c.name, c.count, c.net, c.vat, c.gross], true));
    push([]);
  }
  push([`Per expense category (${cur})`, 'Receipts', 'Net', 'VAT', 'Gross', 'Of which deducted by agencies']);
  cats.forEach((c) => push([c.category, c.count, c.net, c.vat, c.gross, c.fromStatements || null], true));
  push([]);
  push(['All receipts', receipts.length, s.total.net, s.total.vat, s.total.gross], true);
  if (s.open.length) push([`${s.open.length} receipt(s) not checked yet: see Status on the Receipts sheet`]);
  if (s.missingRate.length) push([`${s.missingRate.length} receipt(s) without exchange rate are left out of the totals`]);
  push([conversionNote(cur)]);

  const sum = XLSX.utils.aoa_to_sheet(aoa);
  for (const r of moneyCells) for (const c of [2, 3, 4, 5]) {
    const cell = sum[XLSX.utils.encode_cell({ r, c })];
    if (cell && cell.t === 'n') cell.z = '#,##0.00';
  }
  sum['!cols'] = [{ wch: 50 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }];

  const header = ['No.', 'Date', 'Store', 'Address', 'Country', 'Description', 'Category', 'Document', 'VAT category', 'VAT rate',
    `Net ${cur}`, `VAT ${cur}`, `Gross ${cur}`, 'Receipt currency', 'Gross in receipt currency', `Rate to ${cur}`, 'Rate date', 'Status', 'Notes', 'Photo file'];
  const rows = detail.map(({ row, n }) => {
    const r = row.receipt;
    const rate = r.currency === cur ? null : conv.rate(r);
    return [n.no, r.receipt_date ? new Date(`${r.receipt_date}T12:00:00`) : null, r.store, r.store_address, countryName(r.vat_country || 'NL'),
      r.description, r.category, DOC_TYPES[r.doc_type || 'receipt'], vatLabel(row.key),
      row.rate === null || row.rate === undefined ? null : row.rate / 100, row.net, row.vat, row.gross,
      r.currency, r.currency === cur ? null : row.gross_orig, rate ? rate.rate : null,
      rate?.date ? new Date(`${rate.date}T12:00:00`) : null,
      status(r), r.notes, n.file];
  });
  const det = XLSX.utils.aoa_to_sheet([header, ...rows], { cellDates: true });
  for (let i = 1; i <= rows.length; i++) {
    const fmt = (c, z) => { const cell = det[XLSX.utils.encode_cell({ r: i, c })]; if (cell && (cell.t === 'n' || cell.t === 'd')) cell.z = z; };
    fmt(1, 'yyyy-mm-dd'); fmt(9, '0%'); [10, 11, 12, 14].forEach((c) => fmt(c, '#,##0.00')); fmt(15, '0.000000'); fmt(16, 'yyyy-mm-dd');
  }
  det['!cols'] = [6, 11, 24, 30, 14, 30, 22, 20, 26, 8, 11, 11, 11, 9, 12, 11, 11, 14, 24, 40].map((wch) => ({ wch }));
  det['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sum, 'Summary');
  XLSX.utils.book_append_sheet(wb, det, 'Receipts');
  if (inc.count) XLSX.utils.book_append_sheet(wb, incomeSheet(XLSX, inc, conv, cur), 'Income');
  const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellDates: true });
  return new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function incomeSheet(XLSX, inc, conv, cur) {
  const d = (iso) => (iso ? new Date(`${iso}T12:00:00`) : null);
  const header = ['Statement date', 'Statement no.', 'Agency', 'Agency country', 'Client', 'Job', 'Job date', 'Type', 'Invoice no.',
    `Fee ${cur}`, 'VAT %', `VAT ${cur}`, `Expenses ${cur}`, `Agency fee ${cur}`, `Website ${cur}`, `Transport ${cur}`, `Tax withheld ${cur}`,
    `Other deductions ${cur}`, `VAT on deductions ${cur}`, 'Reverse charge', `Paid ${cur}`, 'Statement currency', 'Paid in statement currency',
    `Rate to ${cur}`, 'Rate date', 'Status'];
  const rows = [...inc.lines]
    .sort((a, b) => (a.statement.statement_date || '').localeCompare(b.statement.statement_date || ''))
    .map(({ statement: st, line: l, fee, vat, expenses, paid }) => {
      const f = conv.factor(statementAsReceipt(st));
      const c = (v) => round2((Number(v) || 0) * f);
      const rate = st.currency === cur ? null : conv.rate(statementAsReceipt(st));
      return [d(st.statement_date), st.statement_no, st.agency, countryName(st.agency_country), l.client, l.description, d(l.job_date),
        JOB_KINDS[l.kind] || l.kind, l.invoice_no, fee, (Number(l.vat_rate) || 0) / 100, vat, expenses,
        c(dedSum(l, 'agency_fee')), c(dedSum(l, 'website')), c(dedSum(l, 'transport')), c(dedSum(l, 'tax_withheld')), c(dedSum(l, 'other')),
        c((l.deductions || []).reduce((t, x) => t + (Number(x.vat) || 0), 0)), (l.deductions || []).some((x) => x.reverse_charge) ? 'Yes' : '',
        paid, st.currency, st.currency === cur ? null : lineTotal(l), rate ? rate.rate : null, d(rate?.date), status(st)];
    });
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows], { cellDates: true });
  for (let i = 1; i <= rows.length; i++) {
    const fmt = (col, z) => { const cell = ws[XLSX.utils.encode_cell({ r: i, c: col })]; if (cell && (cell.t === 'n' || cell.t === 'd')) cell.z = z; };
    [0, 6, 24].forEach((col) => fmt(col, 'yyyy-mm-dd')); fmt(10, '0%'); fmt(23, '0.000000');
    [9, 11, 12, 13, 14, 15, 16, 17, 18, 20, 22].forEach((col) => fmt(col, '#,##0.00'));
  }
  ws['!cols'] = [12, 18, 24, 14, 22, 30, 12, 14, 18, 11, 7, 10, 10, 11, 10, 10, 11, 11, 11, 9, 11, 9, 12, 11, 11, 14].map((wch) => ({ wch }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) };
  return ws;
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
  const { s, groupRows, detail, conv, cur, inc, cats, vatDue } = tables(receipts, meta);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const eur = (v) => (v === null || v === undefined ? '-' : money(v, cur));
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

  doc.setFontSize(18); doc.setFont('helvetica', 'bold'); doc.text(`VH5 ${meta.title}`, 14, y);
  doc.setFontSize(9); doc.setFont('helvetica', 'normal');
  doc.text(`${meta.owner || ''}  ·  created ${new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}  ·  amounts in ${cur}`, 14, y + 6);
  y += 16;

  const footStyles = { fillColor: [226, 239, 233], textColor: 20 };
  if (inc.count) {
    heading('Income from agency statements');
    autoTable(doc, { ...style, startY: y, head: [['Agency', 'Statements', 'Fees', 'VAT', 'Deductions', 'Paid']],
      columnStyles: { 0: { cellWidth: 62 }, 1: { halign: 'right', cellWidth: 20 }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
      body: inc.agencies.map((a) => [`${a.agency} (${countryName(a.country)})`, String(a.count), eur(a.fee), eur(a.vat), eur(neg(a.deductions)), eur(a.paid)]),
      foot: [['Total', String(inc.count), eur(inc.fee), eur(inc.vat), eur(neg(round2(inc.fee + inc.vat + inc.expenses - inc.paid))), eur(inc.paid)]], footStyles });
    after();
    const small = [...inc.kinds.map((k) => [`Fee: ${k.label}`, eur(k.amount)]), ...inc.deductions.map((d) => [`Deduction: ${d.label}`, eur(d.amount)])];
    if (inc.expenses) small.push(['Expenses reimbursed by agencies', eur(inc.expenses)]);
    autoTable(doc, { ...style, startY: y, head: [['Fees and deductions', 'Amount']], body: small,
      columnStyles: { 0: { cellWidth: 102 }, 1: { halign: 'right' } } });
    after();
  }
  if (cur === 'EUR' && (inc.count || s.home.groups.length)) {
    heading('Dutch VAT position');
    const body = [['VAT on income from Dutch agencies (to pay)', eur(inc.homeVat)]];
    if (inc.reverseCharge) body.push(['Reverse-charge VAT on foreign agency fees (due)', eur(inc.reverseCharge)]);
    body.push(['VAT on receipts (deductible)', eur(neg(s.homeVat))]);
    if (inc.deductionVat) body.push(['VAT on Dutch agency deductions (deductible)', eur(neg(inc.deductionVat))]);
    if (inc.reverseCharge) body.push(['Reverse-charge VAT on foreign agency fees (deductible)', eur(neg(inc.reverseCharge))]);
    autoTable(doc, { ...style, startY: y, head: [['', 'Amount']], body, foot: [[vatDue >= 0 ? 'VAT to pay' : 'VAT to get back', eur(Math.abs(vatDue))]],
      footStyles, columnStyles: { 0: { cellWidth: 102 }, 1: { halign: 'right' } } });
    after();
  }

  const head = [['VAT category', 'Receipts', 'Net', 'VAT', 'Gross']];
  if (s.home.groups.length) {
    heading('Receipts: Netherlands');
    const foot = [['Total Netherlands', String(s.home.count), eur(s.home.net), eur(s.home.vat), eur(s.home.gross)],
      ['Dutch VAT to deduct (input tax)', '', '', eur(s.homeVat), '']];
    if (s.weakVat > 0) foot.push(['of which on a payment receipt or no document', '', '', eur(s.weakVat), '']);
    autoTable(doc, { ...style, startY: y, head, body: groupRows(s.home).map(fmtRow), foot, footStyles: { fillColor: [226, 239, 233], textColor: 20 } });
    after();
  }
  if (s.foreign.groups.length) {
    heading('Receipts: foreign VAT (not on the Dutch VAT return)');
    autoTable(doc, { ...style, startY: y, head, body: groupRows(s.foreign).map(fmtRow),
      foot: [['Total foreign', String(s.foreign.count), eur(s.foreign.net), eur(s.foreign.vat), eur(s.foreign.gross)]],
      footStyles: { fillColor: [226, 239, 233], textColor: 20 } });
    after();
    autoTable(doc, { ...style, startY: y, head: [['Per country', 'Receipts', 'Net', 'VAT', 'Gross']],
      body: s.foreign.countries.map((c) => [c.name, String(c.count), eur(c.net), eur(c.vat), eur(c.gross)]) });
    after();
  }
  if (cats.length) {
    heading('Expenses per category (receipts and agency deductions)');
    autoTable(doc, { ...style, startY: y, head: [['Category', 'Receipts', 'Net', 'VAT', 'Gross']],
      body: cats.map((c) => [c.category + (c.fromStatements ? ` (incl. ${eur(c.fromStatements)} by agencies)` : ''), String(c.count), eur(c.net), eur(c.vat), eur(c.gross)]),
      foot: [['Total', String(s.total.count), eur(cats.reduce((t, c) => t + c.net, 0)), eur(s.total.vat), eur(cats.reduce((t, c) => t + c.gross, 0))]], footStyles });
    after();
  }
  doc.setFontSize(9);
  doc.text(`All receipts: ${receipts.length}, gross ${eur(s.total.gross)}, VAT ${eur(s.total.vat)}.${s.open.length ? ` ${s.open.length} not checked yet.` : ''}${s.missingRate.length ? ` ${s.missingRate.length} without exchange rate, left out of the totals.` : ''}`, 14, y, { maxWidth: W - 28 });
  y += 5;
  const note = doc.splitTextToSize(conversionNote(cur), W - 28);
  doc.text(note, 14, y);
  y += note.length * 4 + 6;

  if (inc.count) {
    heading('Jobs (agency statements)');
    autoTable(doc, {
      ...style, startY: y, styles: { fontSize: 7.5, cellPadding: 1.2 },
      head: [['Paid', 'Agency', 'Client / job', 'Job date', 'Type', 'Fee', 'VAT', 'Deductions', 'Paid']],
      body: [...inc.lines].sort((a, b) => (a.statement.statement_date || '').localeCompare(b.statement.statement_date || '')).map(({ statement: st, line: l, fee, vat, deductions, paid }) => {
        const rate = st.currency === cur ? null : conv.rate(statementAsReceipt(st));
        const fx = rate ? `\n${money(lineTotal(l), st.currency)} at ${rate.rate.toFixed(4)}${rate.date ? ` (${rate.date})` : ''}` : '';
        return [st.statement_date || '', `${st.agency || ''}\n${countryName(st.agency_country)}`, [l.client, l.description].filter(Boolean).join(' - ') + fx,
          l.job_date || '', JOB_KINDS[l.kind] || '', eur(fee), eur(vat), eur(neg(deductions)), eur(paid)];
      }),
      columnStyles: { 0: { cellWidth: 17 }, 3: { cellWidth: 17 }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } },
    });
    after();
  }
  heading('Receipts');
  autoTable(doc, {
    ...style, startY: y, styles: { fontSize: 7.5, cellPadding: 1.2 },
    head: [['No.', 'Date', 'Store / description', 'Country', 'Category', 'Document', 'VAT category', 'Net', 'VAT', 'Gross']],
    body: detail.map(({ row, n }) => {
      const r = row.receipt;
      const rate = r.currency === cur ? null : conv.rate(r);
      const fx = rate ? `\n${money(row.gross_orig, r.currency)} at ${rate.rate.toFixed(4)}${rate.date ? ` (${rate.date})` : ''}` : '';
      return [String(n.no), r.receipt_date || '', [r.store, r.description].filter(Boolean).join(' - ') + (r.status === 'done' ? '' : ' (check)') + fx,
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
    doc.text(`VH5 receipts ${meta.title}  ·  page ${i} of ${pages}`, W / 2, H - 8, { align: 'center' });
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
  for (const st of (meta.statements || []).filter((x) => x.file_path)) {
    zip.file(`statements/${st.statement_date || 'no-date'}_${safe(st.agency)}_${safe(st.statement_no) || st.id.slice(0, 8)}.${st.file_path.split('.').pop()}`, await fileBlob(st.file_path));
  }
  download(await zip.generateAsync({ type: 'blob' }), `${meta.fileBase}.zip`);
}
