// Exports of a period, in the same order as the overview:
// 1 Expenses (Netherlands, foreign per country, per category), 2 Income (Dutch, foreign agencies, fees, deductions),
// 3 Dutch VAT position, 4 corrections and late entries, then the details.
// Excel: Summary, Expenses and Income sheets. PDF: overview, details, one page per receipt photo. ZIP: Excel + all documents.
import { vatLabel, countryName, DOC_TYPES, weakProof, fmtDate, money, neg, statementAsReceipt, lineTotal, JOB_KINDS, round2,
  periodLabel, naturalPeriod, HOME_COUNTRY } from './vat.js';
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
const sumAgencies = (list) => list.reduce((t, a) => ({ count: t.count + a.count, fee: t.fee + a.fee, vat: t.vat + a.vat, deductions: t.deductions + a.deductions, paid: t.paid + a.paid }),
  { count: 0, fee: 0, vat: 0, deductions: 0, paid: 0 });
const tag = (x) => (x._reversal ? '↩ reversal of original: ' : x.corrects ? '↩ correction: ' : '');

const conversionNote = (cur) => (cur === 'USD'
  ? 'All amounts in USD, converted on each date: receipts at the receipt date, statements at the payment date (receipt currency to EUR at the ECB rate, then EUR to USD at the ECB rate of that day; last business day before weekends and holidays). Amounts already in USD are not converted.'
  : 'All amounts in EUR; foreign currencies at the ECB rate of the receipt date (statements: the payment date; last business day before weekends and holidays).');

// The summary as rows of [label, count, a, b, c, d] with a section/heading type, shared by Excel and PDF.
function summaryBlocks(d, cur) {
  const { s, inc, cats, vatDue } = d;
  const blocks = [];
  const unknown = (g) => g.key.endsWith(':unknown');
  const vrow = (g, label) => [label, g.count, unknown(g) ? null : g.net, unknown(g) ? null : g.vat, g.gross];
  const vhead = ['VAT category', 'Receipts', 'Net', 'VAT', 'Gross'];

  blocks.push({ section: '1. Expenses (by receipt date)' });
  blocks.push({ title: 'Netherlands', head: vhead, rows: s.home.groups.map((g) => vrow(g, g.label)),
    foot: [['Total Netherlands', s.home.count, s.home.net, s.home.vat, s.home.gross]],
    note: `Dutch VAT to deduct: ${money(s.homeVat, cur)}${s.weakVat ? ` (of which ${money(s.weakVat, cur)} on a payment receipt or no document)` : ''}` });
  blocks.push({ title: 'Foreign', head: vhead,
    rows: s.foreign.countries.flatMap((c) => [{ group: true, cells: [c.name, c.count, c.net, c.vat, c.gross] },
      ...s.foreign.groups.filter((g) => g.country === c.country).map((g) => vrow(g, `   ${g.label.replace(`${c.name}: `, '')}`))]),
    foot: [['Total foreign', s.foreign.count, s.foreign.net, s.foreign.vat, s.foreign.gross]],
    note: s.foreign.groups.length ? 'Foreign VAT is not deductible on the Dutch return; within the EU it can be reclaimed from that country.' : '' });
  blocks.push({ title: 'Per category', head: ['Category', 'Receipts', 'Net', 'VAT', 'Gross'],
    rows: cats.map((c) => [c.category + (c.fromStatements ? ` (incl. ${money(c.fromStatements, cur)} deducted by agencies)` : ''), c.count, c.net, c.vat, c.gross]),
    foot: [['Total expenses', s.total.count, round2(cats.reduce((t, c) => t + c.net, 0)), round2(cats.reduce((t, c) => t + c.vat, 0)), round2(cats.reduce((t, c) => t + c.gross, 0))]] });

  const dutch = inc.agencies.filter((a) => (a.country || HOME_COUNTRY) === HOME_COUNTRY);
  const foreign = inc.agencies.filter((a) => (a.country || HOME_COUNTRY) !== HOME_COUNTRY);
  const arow = (a, label) => [label || a.agency, a.count, a.fee, a.vat, neg(a.deductions), a.paid];
  const ahead = ['Agency', 'Statements', 'Fees', 'VAT', 'Deductions', 'Paid'];
  blocks.push({ section: '2. Income (agency statements, by booking date)' });
  const td = sumAgencies(dutch), tf = sumAgencies(foreign);
  blocks.push({ title: 'Dutch agencies', head: ahead, rows: dutch.map((a) => arow(a)), foot: [arow(td, 'Total Dutch agencies')] });
  blocks.push({ title: 'Foreign agencies', head: ahead,
    rows: [...new Set(foreign.map((a) => a.country))].flatMap((c) => {
      const list = foreign.filter((a) => a.country === c);
      return [{ group: true, cells: arow(sumAgencies(list), countryName(c)) }, ...list.map((a) => arow(a, `   ${a.agency}`))];
    }),
    foot: [arow(tf, 'Total foreign agencies')],
    note: inc.reverseCharge ? `Agency fees reverse-charged: Dutch VAT ${money(inc.reverseCharge, cur)} due and deductible.` : '' });
  blocks.push({ title: 'Fees by type', head: ['Type', '', 'Amount'], rows: inc.kinds.map((k) => [k.label, null, k.amount]), foot: [['Total fees', null, inc.fee]] });
  blocks.push({ title: 'Deductions by type', head: ['Deduction', '', 'Amount'], rows: inc.deductions.map((x) => [x.label, null, x.amount]),
    foot: [['Total deductions', null, round2(inc.deductions.reduce((t, x) => t + x.amount, 0))]],
    note: inc.expenses ? `Expenses paid back by agencies: ${money(inc.expenses, cur)}` : '' });

  if (cur === 'EUR') {
    blocks.push({ section: '3. Dutch VAT position' });
    blocks.push({ title: '', head: ['', '', 'Amount'], rows: [
      ['VAT on income from Dutch agencies (to pay)', null, inc.homeVat],
      ['Reverse-charge VAT on foreign agency fees (due)', null, inc.reverseCharge],
      ['VAT on Dutch receipts (deductible)', null, neg(s.homeVat)],
      ['VAT on Dutch agency deductions (deductible)', null, neg(inc.deductionVat)],
      ['Reverse-charge VAT on foreign agency fees (deductible)', null, neg(inc.reverseCharge)],
    ], foot: [[vatDue >= 0 ? 'VAT to pay' : 'VAT to get back', null, Math.abs(vatDue)]] });
  }
  if (d.corrections.length) {
    blocks.push({ section: '4. Corrections and late entries' });
    blocks.push({ title: '', head: ['Item', '', 'Related to'], rows: d.corrections.map((x) => {
      const isRec = x.receipt_date !== undefined;
      return [`↩ ${isRec ? x.store || x.description : x.agency} (${x.corrects ? 'correction: difference booked here' : 'late entry'})`, null,
        x.corrects ? `correction of an earlier quarter` : periodLabel(naturalPeriod(x))];
    }) });
  }
  return blocks;
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

async function buildExcel(d, meta) {
  const XLSX = await import(XLSX_URL);
  const cur = meta.currency || 'EUR';
  const conv = meta.conv;
  const aoa = [[`VH5 ${meta.title}`], [meta.owner || ''], [meta.filed ? `Filed with the CPA on ${fmtDate(meta.filed.filed_at.slice(0, 10))}` : 'Open period'], []];
  const money2 = []; // rows with amounts in columns 2..5
  for (const b of summaryBlocks(d, cur)) {
    if (b.section) { aoa.push([b.section]); continue; }
    if (b.title) aoa.push([b.title]);
    aoa.push(b.head);
    for (const r of b.rows) { money2.push(aoa.length); aoa.push(r.group ? r.cells : r); }
    for (const r of b.foot || []) { money2.push(aoa.length); aoa.push(r); }
    if (b.note) aoa.push([b.note]);
    aoa.push([]);
  }
  aoa.push([conversionNote(cur)]);
  aoa.push(['Expenses count by receipt date, income by the booking date entered for each statement.']);
  const sum = XLSX.utils.aoa_to_sheet(aoa);
  for (const r of money2) for (const c of [2, 3, 4, 5]) {
    const cell = sum[XLSX.utils.encode_cell({ r, c })];
    if (cell && cell.t === 'n') cell.z = '#,##0.00';
  }
  sum['!cols'] = [{ wch: 56 }, { wch: 11 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }];

  // Expenses detail
  const dt = (iso) => (iso ? new Date(`${iso}T12:00:00`) : null);
  const nums = new Map(numbered(d.rec.filter((r) => !r._reversal)).map((n) => [n.r.id, n]));
  const header = ['No.', 'Receipt date', 'Quarter', 'Store', 'Address', 'Country', 'Description', 'Category', 'Document', 'VAT category', 'VAT rate',
    `Net ${cur}`, `VAT ${cur}`, `Gross ${cur}`, 'Receipt currency', 'Gross in receipt currency', `Rate to ${cur}`, 'Rate date', 'Status', 'Correction / late', 'Notes', 'Photo file'];
  const rows = [...d.s.rows].sort((a, b) => (nums.get(a.receipt.id)?.no || 999) - (nums.get(b.receipt.id)?.no || 999)).map((row) => {
    const r = row.receipt;
    const n = nums.get(r.id);
    const rate = r.currency === cur ? null : conv.rate(r);
    return [n?.no ?? null, dt(r.receipt_date), periodLabel(r.period), tag(r) + (r.store || ''), r.store_address, countryName(r.vat_country || 'NL'), r.description, r.category,
      DOC_TYPES[r.doc_type || 'receipt'], vatLabel(row.key), row.rate === null || row.rate === undefined ? null : row.rate / 100,
      row.net, row.vat, row.gross, r.currency, r.currency === cur ? null : row.gross_orig, rate ? rate.rate : null, dt(rate?.date), status(r),
      r.corrects || r._reversal ? 'Correction' : naturalPeriod(r) && naturalPeriod(r) !== r.period ? `Late: belongs to ${periodLabel(naturalPeriod(r))}` : '', r.notes, n?.file || ''];
  });
  const det = XLSX.utils.aoa_to_sheet([header, ...rows], { cellDates: true });
  fmtCols(XLSX, det, rows.length, { date: [1, 17], pct: [10], money: [11, 12, 13, 15], rate: [16] });
  det['!cols'] = [6, 12, 9, 26, 30, 14, 30, 22, 20, 26, 8, 12, 12, 12, 9, 12, 11, 11, 14, 22, 24, 40].map((wch) => ({ wch }));
  det['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sum, 'Summary');
  XLSX.utils.book_append_sheet(wb, det, 'Expenses');
  if (d.inc.lines.length) XLSX.utils.book_append_sheet(wb, incomeSheet(XLSX, d, conv, cur), 'Income');
  const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellDates: true });
  return new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

function fmtCols(XLSX, ws, n, f) {
  for (let i = 1; i <= n; i++) {
    const set = (c, z) => { const cell = ws[XLSX.utils.encode_cell({ r: i, c })]; if (cell && (cell.t === 'n' || cell.t === 'd')) cell.z = z; };
    (f.date || []).forEach((c) => set(c, 'yyyy-mm-dd'));
    (f.pct || []).forEach((c) => set(c, '0%'));
    (f.money || []).forEach((c) => set(c, '#,##0.00'));
    (f.rate || []).forEach((c) => set(c, '0.000000'));
  }
}

const dedSum = (l, type) => (l.deductions || []).filter((x) => x.type === type).reduce((t, x) => t + (Number(x.amount) || 0), 0);

function incomeSheet(XLSX, d, conv, cur) {
  const dt = (iso) => (iso ? new Date(`${iso}T12:00:00`) : null);
  const header = ['Booking date', 'Quarter', 'Payment date', 'Statement no.', 'Agency', 'Agency country', 'Client', 'Job', 'Job date', 'Type', 'Invoice no.',
    `Fee ${cur}`, 'VAT %', `VAT ${cur}`, `Expenses ${cur}`, `Agency fee ${cur}`, `Website ${cur}`, `Transport ${cur}`, `Tax withheld ${cur}`,
    `Other deductions ${cur}`, `VAT on deductions ${cur}`, 'Reverse charge', `Paid ${cur}`, 'Statement currency', 'Paid in statement currency',
    `Rate to ${cur}`, 'Rate date', 'Status', 'Correction / late', 'Receipts attached'];
  const rows = [...d.inc.lines]
    .sort((a, b) => (a.statement.booking_date || '').localeCompare(b.statement.booking_date || ''))
    .map(({ statement: st, line: l, fee, vat, expenses, paid }) => {
      const f = conv.factor(statementAsReceipt(st));
      const c = (v) => round2((Number(v) || 0) * f);
      const rate = st.currency === cur ? null : conv.rate(statementAsReceipt(st));
      return [dt(st.booking_date), periodLabel(st.period), dt(st.statement_date), st.statement_no, tag(st) + (st.agency || ''), countryName(st.agency_country),
        l.client, l.description, dt(l.job_date), JOB_KINDS[l.kind] || l.kind, l.invoice_no, fee, (Number(l.vat_rate) || 0) / 100, vat, expenses,
        c(dedSum(l, 'agency_fee')), c(dedSum(l, 'website')), c(dedSum(l, 'transport')), c(dedSum(l, 'tax_withheld')), c(dedSum(l, 'other')),
        c((l.deductions || []).reduce((t, x) => t + (Number(x.vat) || 0), 0)), (l.deductions || []).some((x) => x.reverse_charge) ? 'Yes' : '',
        paid, st.currency, st.currency === cur ? null : lineTotal(l), rate ? rate.rate : null, dt(rate?.date), status(st),
        st.corrects || st._reversal ? 'Correction' : naturalPeriod(st) && naturalPeriod(st) !== st.period ? `Late: belongs to ${periodLabel(naturalPeriod(st))}` : '',
        (l.receipt_ids || []).length || ''];
    });
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows], { cellDates: true });
  fmtCols(XLSX, ws, rows.length, { date: [0, 2, 8, 26], pct: [12], money: [11, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24], rate: [25] });
  ws['!cols'] = [12, 9, 12, 18, 24, 14, 22, 30, 12, 14, 18, 11, 7, 10, 10, 11, 10, 10, 11, 11, 11, 9, 11, 9, 12, 11, 11, 14, 22, 9].map((wch) => ({ wch }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: header.length - 1 } }) };
  return ws;
}

export async function downloadExcel(d, meta) {
  download(await buildExcel(d, meta), `${meta.fileBase}.xlsx`);
}

// ---------- PDF ----------

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = () => reject(fr.error);
  fr.readAsDataURL(blob);
});

export async function downloadPdf(d, meta, onProgress) {
  const [{ jsPDF }, plugin] = await Promise.all([import(JSPDF_URL), import(AUTOTABLE_URL)]);
  // The CDN build wraps the CommonJS module: the function sits one level deeper.
  const autoTable = [plugin.default, plugin.default?.default].find((f) => typeof f === 'function');
  const cur = meta.currency || 'EUR';
  const conv = meta.conv;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const m = (v) => (v === null || v === undefined || v === '' ? '' : typeof v === 'number' ? money(v, cur) : v);
  const black = [17, 17, 17];
  const base = { theme: 'grid', headStyles: { fillColor: black, textColor: 255 }, styles: { fontSize: 8.5, cellPadding: 1.6, lineColor: [226, 226, 222], lineWidth: 0.1 },
    footStyles: { fillColor: [240, 240, 237], textColor: 17, fontStyle: 'bold' }, margin: { left: 14, right: 14 } };
  let y = 18;
  const ensure = (h) => { if (y + h > H - 16) { doc.addPage(); y = 18; } };
  const after = () => { y = doc.lastAutoTable.finalY + 6; };

  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text(`VH5 ${meta.title}`, 14, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
  doc.text(`${meta.owner || ''}  ·  ${meta.filed ? `filed with the CPA on ${fmtDate(meta.filed.filed_at.slice(0, 10))}` : 'open period'}  ·  created ${fmtDate(new Date().toISOString().slice(0, 10))}  ·  amounts in ${cur}`, 14, y + 6);
  y += 14;

  // Every summary table uses the same column widths so they line up.
  const numW = 26, cntW = 18;
  for (const b of summaryBlocks(d, cur)) {
    if (b.section) {
      ensure(20);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(b.section, 14, y + 4);
      doc.setLineWidth(0.5); doc.line(14, y + 6, W - 14, y + 6); doc.setFont('helvetica', 'normal');
      y += 11;
      continue;
    }
    ensure(18);
    if (b.title) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(b.title, 14, y + 3); doc.setFont('helvetica', 'normal'); y += 5; }
    const cols = b.head.length;
    const columnStyles = { 1: { halign: 'right', cellWidth: b.head[1] ? cntW : 4 } };
    for (let c = 2; c < cols; c++) columnStyles[c] = { halign: 'right', cellWidth: numW };
    const fmt = (r) => r.map((v, i) => (i === 0 ? v : i === 1 ? (v ?? '') : m(v)));
    autoTable(doc, { ...base, startY: y, head: [b.head], columnStyles,
      body: b.rows.length ? b.rows.map((r) => (r.group ? { _group: true, cells: fmt(r.cells) } : fmt(r))).map((r) => (r._group ? r.cells.map((c) => ({ content: c, styles: { fontStyle: 'bold', fillColor: [246, 246, 243] } })) : r))
        : [[{ content: 'None', colSpan: cols, styles: { textColor: 140 } }]],
      foot: b.foot ? b.foot.map(fmt) : undefined, showFoot: 'lastPage' });
    after();
    if (b.note) { doc.setFontSize(8); doc.setTextColor(110); const t = doc.splitTextToSize(b.note, W - 28); ensure(t.length * 4); doc.text(t, 14, y); y += t.length * 3.6 + 3; doc.setTextColor(0); }
  }
  doc.setFontSize(8); doc.setTextColor(110);
  const note = doc.splitTextToSize(`${conversionNote(cur)} Expenses count by receipt date, income by the booking date entered for each statement.`, W - 28);
  ensure(note.length * 4); doc.text(note, 14, y); y += note.length * 3.6 + 6; doc.setTextColor(0);

  // Details
  const nums = new Map(numbered(d.rec.filter((r) => !r._reversal)).map((n) => [n.r.id, n.no]));
  doc.addPage(); y = 18;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('5. Details: receipts', 14, y); doc.setFont('helvetica', 'normal'); y += 4;
  autoTable(doc, { ...base, startY: y, styles: { ...base.styles, fontSize: 7.5 },
    head: [['No.', 'Date', 'Store / description', 'Country', 'Category', 'VAT category', 'Net', 'VAT', 'Gross']],
    body: [...d.s.rows].sort((a, b) => (nums.get(a.receipt.id) || 999) - (nums.get(b.receipt.id) || 999)).map((row) => {
      const r = row.receipt;
      const rate = r.currency === cur ? null : conv.rate(r);
      const fx = rate ? `\n${money(row.gross_orig, r.currency)} at ${rate.rate.toFixed(4)}${rate.date ? ` (${rate.date})` : ''}` : '';
      return [String(nums.get(r.id) || ''), r.receipt_date || '', tag(r) + [r.store, r.description].filter(Boolean).join(' - ') + (weakProof(r) ? ` (${DOC_TYPES[r.doc_type]})` : '') + fx,
        countryName(r.vat_country || 'NL'), r.category || '', vatLabel(row.key), m(row.net), m(row.vat), m(row.gross)];
    }),
    columnStyles: { 0: { cellWidth: 8, halign: 'right' }, 1: { cellWidth: 17 }, 6: { halign: 'right', cellWidth: 20 }, 7: { halign: 'right', cellWidth: 18 }, 8: { halign: 'right', cellWidth: 20 } } });
  after();
  if (d.inc.lines.length) {
    ensure(20);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('Details: jobs (agency statements)', 14, y + 4); doc.setFont('helvetica', 'normal'); y += 8;
    autoTable(doc, { ...base, startY: y, styles: { ...base.styles, fontSize: 7.5 },
      head: [['Booked', 'Agency', 'Client / job', 'Job date', 'Type', 'Fee', 'VAT', 'Deductions', 'Paid']],
      body: [...d.inc.lines].sort((a, b) => (a.statement.booking_date || '').localeCompare(b.statement.booking_date || '')).map(({ statement: st, line: l, fee, vat, deductions, paid }) => {
        const rate = st.currency === cur ? null : conv.rate(statementAsReceipt(st));
        const fx = rate ? `\n${money(lineTotal(l), st.currency)} at ${rate.rate.toFixed(4)}${rate.date ? ` (${rate.date})` : ''}` : '';
        return [st.booking_date || '', `${tag(st)}${st.agency || ''}\n${countryName(st.agency_country)}`, [l.client, l.description].filter(Boolean).join(' - ') + fx,
          l.job_date || '', JOB_KINDS[l.kind] || '', m(fee), m(vat), m(neg(deductions)), m(paid)];
      }),
      columnStyles: { 0: { cellWidth: 17 }, 3: { cellWidth: 17 }, 5: { halign: 'right', cellWidth: 19 }, 6: { halign: 'right', cellWidth: 17 }, 7: { halign: 'right', cellWidth: 19 }, 8: { halign: 'right', cellWidth: 19 } } });
    after();
  }

  // One page per receipt photo, numbered like the table.
  const photos = numbered(d.rec.filter((r) => !r._reversal)).filter((n) => n.r.file_path);
  let done = 0;
  for (const n of photos) {
    onProgress?.(++done, photos.length);
    doc.addPage();
    const r = n.r;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text(`No. ${n.no}  ·  ${r.receipt_date ? fmtDate(r.receipt_date) : 'no date'}  ·  ${r.store || r.description || ''}  ·  ${money(r.total, r.currency || 'EUR')}`, 14, 14, { maxWidth: W - 28 });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    if (weakProof(r)) doc.text(DOC_TYPES[r.doc_type], 14, 19);
    if (r.file_type === 'application/pdf') { doc.text('This receipt is a PDF: see the ZIP export or the app.', 14, 30); continue; }
    try {
      const blob = await fileBlob(r.file_path);
      const bmp = await createImageBitmap(blob);
      const scale = Math.min((W - 28) / bmp.width, (H - 36) / bmp.height);
      const w = bmp.width * scale, h = bmp.height * scale;
      doc.addImage(await blobToDataUrl(blob), r.file_type === 'image/png' ? 'PNG' : 'JPEG', (W - w) / 2, 24, w, h);
    } catch (e) {
      doc.text(`Photo could not be loaded (${e.message}).`, 14, 30);
    }
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`VH5 ${meta.title}  ·  page ${i} of ${pages}`, W / 2, H - 8, { align: 'center' });
    doc.setTextColor(0);
  }
  download(doc.output('blob'), `${meta.fileBase}.pdf`);
}

// ---------- ZIP ----------

export async function downloadZip(d, meta, onProgress) {
  const { default: JSZip } = await import(JSZIP_URL);
  const zip = new JSZip();
  zip.file(`${meta.fileBase}.xlsx`, await buildExcel(d, meta));
  const list = numbered(d.rec.filter((r) => !r._reversal)).filter((n) => n.file);
  const sts = d.sts.filter((st) => !st._reversal && st.file_path);
  let done = 0;
  for (const n of list) { zip.file(`receipts/${n.file}`, await fileBlob(n.r.file_path)); onProgress?.(++done, list.length + sts.length); }
  for (const st of sts) {
    zip.file(`statements/${st.booking_date || 'no-date'}_${safe(st.agency)}_${safe(st.statement_no) || st.id.slice(0, 8)}.${st.file_path.split('.').pop()}`, await fileBlob(st.file_path));
    onProgress?.(++done, list.length + sts.length);
  }
  download(await zip.generateAsync({ type: 'blob' }), `${meta.fileBase}.zip`);
}
