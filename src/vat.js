// VAT categories, expense categories, checks and the quarterly overview. Pure functions, no I/O.

export const HOME_COUNTRY = 'NL';

export const CATEGORIES = [
  'Travel', 'Accommodation', 'Transportation', 'Meals & Drinks', 'Health & Beauty', 'Clothing & Accessories',
  'Fitness & Wellness', 'Portfolio & Content', 'Agency & Management', 'Casting & Auditions', 'Marketing & Promotion',
  'Technology & Equipment', 'Software & Subscriptions', 'Professional Services', 'Education & Training', 'Other',
];

// What the record is based on. Only receipts and invoices are proper proof for deducting VAT.
export const DOC_TYPES = {
  receipt: 'Receipt',
  invoice: 'Invoice',
  payment: 'Payment receipt only',
  none: 'No document',
};
export const weakProof = (r) => r.doc_type === 'payment' || r.doc_type === 'none';

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'JPY', 'CAD', 'AUD'];

export const COUNTRIES = {
  NL: 'Netherlands', BE: 'Belgium', DE: 'Germany', FR: 'France', LU: 'Luxembourg', GB: 'United Kingdom',
  IE: 'Ireland', ES: 'Spain', PT: 'Portugal', IT: 'Italy', AT: 'Austria', CH: 'Switzerland', DK: 'Denmark',
  SE: 'Sweden', NO: 'Norway', FI: 'Finland', IS: 'Iceland', PL: 'Poland', CZ: 'Czechia', SK: 'Slovakia',
  HU: 'Hungary', SI: 'Slovenia', HR: 'Croatia', RO: 'Romania', BG: 'Bulgaria', GR: 'Greece', CY: 'Cyprus',
  MT: 'Malta', EE: 'Estonia', LV: 'Latvia', LT: 'Lithuania', MC: 'Monaco', TR: 'Turkey', MA: 'Morocco',
  AE: 'United Arab Emirates', US: 'United States', CA: 'Canada', MX: 'Mexico', BR: 'Brazil', JP: 'Japan',
  KR: 'South Korea', CN: 'China', HK: 'Hong Kong', SG: 'Singapore', TH: 'Thailand', AU: 'Australia', ZA: 'South Africa',
};
export const countryName = (code) => COUNTRIES[code] || code || 'Unknown country';

// Standard rates the rate picker offers per country (anything else can be typed).
export const RATES = { NL: [21, 9, 0], BE: [21, 12, 6, 0], DE: [19, 7, 0], FR: [20, 10, 5.5, 0], GB: [20, 5, 0] };

// Negative for display, without showing -0.00.
export const neg = (v) => (Number(v) ? -Number(v) : 0);
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const isNum = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));

// 1,234.56 (always a comma for thousands and a dot for decimals).
export function fmtNum(n, decimals = 2) {
  if (!isNum(n)) return '';
  return Number(n).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// Reads what people type: 1234.5, 1,234.50, 1.234,50, 12,50 (Dutch decimal comma), 1,500 (thousands).
export function parseNum(v) {
  if (v === null || v === undefined) return null;
  let t = String(v).trim().replace(/[€$£\s]/g, '');
  if (!t) return null;
  const neg = /^-|^\(.*\)$/.test(t);
  t = t.replace(/[()-]/g, '');
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (/^\d{1,3}(,\d{3})+$/.test(t)) t = t.replace(/,/g, '');
  else if (t.includes(',')) t = t.replace(',', '.');
  const n = Number(t);
  return Number.isNaN(n) ? NaN : neg ? -n : n;
}

export function money(n, currency = 'EUR') {
  if (!isNum(n)) return '–';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(n);
}

export function fmtDate(iso) {
  if (!iso) return 'No date';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------- VAT categories ----------
// Key = "<country>:<rate>", "<country>:none" (no VAT / exempt) or "<country>:unknown" (VAT not entered).

export const isHome = (key) => key.startsWith(`${HOME_COUNTRY}:`);

function vatKey(receipt, line) {
  const country = receipt.vat_country || HOME_COUNTRY;
  if (line.rate === undefined) return `${country}:unknown`;
  if (line.rate === null || line.rate === '') return `${country}:none`;
  return `${country}:${Number(line.rate)}`;
}

export const ANNUAL_LABEL = 'Annual costs only (not on the VAT return)';

export function vatLabel(key) {
  if (key === 'annual') return ANNUAL_LABEL;
  const [country, rate] = key.split(':');
  if (country === HOME_COUNTRY) {
    if (rate === 'none') return 'No VAT / exempt';
    if (rate === 'unknown') return 'VAT not entered';
    const name = { 21: 'high rate', 9: 'low rate', 0: 'zero rate' }[rate];
    return `${rate}% VAT${name ? ` (${name})` : ''}`;
  }
  if (rate === 'none') return `${countryName(country)}: no VAT`;
  if (rate === 'unknown') return `${countryName(country)}: VAT not entered`;
  return `${countryName(country)}: ${rate}% VAT`;
}

// Netherlands first, then other countries by name; within a country: rates high to low, no VAT, not entered.
function keyOrder(key) {
  const [country, rate] = key.split(':');
  const r = rate === 'none' ? 1000 : rate === 'unknown' ? 2000 : -Number(rate);
  return [country === HOME_COUNTRY ? 0 : 1, country === HOME_COUNTRY ? '' : countryName(country), r];
}
function compareKeys(a, b) {
  const x = keyOrder(a), y = keyOrder(b);
  return x[0] - y[0] || x[1].localeCompare(y[1]) || x[2] - y[2];
}

// ---------- checks ----------

export function fxFor(r) {
  if ((r.currency || 'EUR') === 'EUR') return 1;
  return isNum(r.fx_rate) ? Number(r.fx_rate) : null;
}

export function linesSum(lines) {
  return round2((lines || []).reduce((s, l) => s + (Number(l.net) || 0) + (Number(l.vat) || 0), 0));
}

// VAT that belongs to a net amount at a rate (null when it can't be computed).
export const expectedVat = (net, rate) => (isNum(net) && isNum(rate) ? round2((Number(net) * Number(rate)) / 100) : null);

// The expected VAT when the entered VAT doesn't match the rate, else null. Receipts round per item, so a few
// cents (or 0.2% on large amounts) of difference is accepted.
export function vatOff(net, rate, vat) {
  const e = expectedVat(net, rate);
  if (e === null || !isNum(vat)) return null;
  return Math.abs(Number(vat) - e) > 0.05 + Math.abs(e) * 0.002 ? e : null;
}

// When the net amount changes: the VAT follows if it was empty or matched the old amount (so it was not typed off the receipt).
export function followVat(oldNet, oldVat, newNet, rate) {
  if (!isNum(rate) || !isNum(newNet)) return undefined;
  const was = expectedVat(oldNet, rate);
  const auto = !isNum(oldVat) || Number(oldVat) === 0 || (was !== null && Math.abs(Number(oldVat) - was) < 0.005);
  return auto ? expectedVat(newNet, rate) : undefined;
}

// What still needs to be filled in or fixed before the receipt counts as done.
export function problems(r) {
  const out = [];
  if (!r.receipt_date) out.push('date');
  if (!r.store && !r.description) out.push('store or description');
  if (!isNum(r.total)) out.push('amount');
  if (!r.currency) out.push('currency');
  if (r.currency && r.currency !== 'EUR' && !isNum(r.fx_rate)) out.push('exchange rate');
  if (r.annual_only) return out; // not on the VAT return: VAT lines are not needed
  const lines = r.vat_lines || [];
  if (!lines.length) out.push('VAT');
  else if (lines.some((l) => !isNum(l.net) || (l.rate !== null && !isNum(l.vat)))) out.push('VAT amounts');
  else if (isNum(r.total) && Math.abs(linesSum(lines) - Number(r.total)) > 0.02 * lines.length) out.push('VAT lines don’t add up to the total');
  if (lines.some((l) => l.rate !== null && vatOff(l.net, l.rate, l.vat) !== null)) out.push('VAT doesn’t match the rate');
  return out;
}

// Split a gross amount into net and VAT for one rate.
export function splitGross(gross, rate) {
  if (!isNum(gross)) return { net: null, vat: null };
  if (rate === null) return { net: round2(gross), vat: 0 };
  const net = round2(Number(gross) / (1 + Number(rate) / 100));
  return { net, vat: round2(Number(gross) - net) };
}

// ---------- quarters ----------

export function quarterOf(iso) {
  const [y, m] = iso.split('-').map(Number);
  return { year: y, q: Math.floor((m - 1) / 3) + 1 };
}

// q = 1..4, or 0 for the whole year.
export function quarterRange(year, q) {
  if (!q) return { start: `${year}-01-01`, end: `${year}-12-31` };
  const start = `${year}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`;
  const endMonth = q * 3;
  const last = new Date(year, endMonth, 0).getDate();
  return { start, end: `${year}-${String(endMonth).padStart(2, '0')}-${last}` };
}

export const quarterLabel = (year, q) => {
  if (!q) return `${year} (full year)`;
  const { start, end } = quarterRange(year, q);
  const m = (iso) => new Date(iso + 'T12:00').toLocaleDateString('en-US', { month: 'short' });
  return `Q${q} ${year} (${m(start)}–${m(end)})`;
};

// One row per VAT line, converted with factor(receipt) (default: to EUR). Receipts without VAT lines get one "unknown" row.
function rowsFor(receipts, factor = fxFor) {
  const rows = [];
  for (const r of receipts) {
    const fx = factor(r);
    const eur = (v) => (isNum(v) && fx != null ? round2(Number(v) * fx) : null);
    // Annual costs only: one row, the whole amount is the cost, no VAT.
    if (r.annual_only) {
      rows.push({ receipt: r, key: 'annual', rate: undefined, net: eur(r.total), vat: 0, gross: eur(r.total), net_orig: r.total, vat_orig: 0, gross_orig: r.total });
      continue;
    }
    const lines = r.vat_lines?.length ? r.vat_lines : [{ rate: undefined, net: null, vat: null, gross: r.total }];
    for (const l of lines) {
      const key = vatKey(r, l);
      const gross = l.rate === undefined ? r.total : (Number(l.net) || 0) + (Number(l.vat) || 0);
      rows.push({ receipt: r, key, rate: l.rate, net: eur(l.net), vat: eur(l.rate === null ? 0 : l.vat), gross: eur(gross), net_orig: l.net, vat_orig: l.vat, gross_orig: gross });
    }
  }
  return rows;
}

const sumOf = (list) => ({
  count: new Set(list.flatMap((g) => [...g.receipts])).size,
  net: round2(list.reduce((s, g) => s + g.net, 0)),
  vat: round2(list.reduce((s, g) => s + g.vat, 0)),
  gross: round2(list.reduce((s, g) => s + g.gross, 0)),
});

// Quarter overview: Dutch VAT and foreign VAT kept apart, foreign VAT also per country.
export function summarize(receipts, factor = fxFor) {
  const rows = rowsFor(receipts, factor);
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.key)) groups.set(row.key, { key: row.key, country: row.key.split(':')[0], label: vatLabel(row.key), receipts: new Set(), net: 0, vat: 0, gross: 0, rows: [] });
    const g = groups.get(row.key);
    if (!row.receipt._reversal) g.receipts.add(row.receipt.id);
    g.net += row.net || 0;
    g.vat += row.vat || 0;
    g.gross += row.gross || 0;
    g.rows.push(row);
  }
  const all = [...groups.values()].map((g) => ({ ...g, count: g.receipts.size, net: round2(g.net), vat: round2(g.vat), gross: round2(g.gross) }));
  const annualGroup = all.find((g) => g.key === 'annual');
  const list = all.filter((g) => g.key !== 'annual').sort((a, b) => compareKeys(a.key, b.key));
  const home = list.filter((g) => isHome(g.key));
  const foreign = list.filter((g) => !isHome(g.key));
  const countries = [...new Set(foreign.map((g) => g.country))]
    .map((c) => ({ country: c, name: countryName(c), ...sumOf(foreign.filter((g) => g.country === c)) }));
  return {
    groups: list,
    home: { groups: home, ...sumOf(home) },
    foreign: { groups: foreign, countries, ...sumOf(foreign) },
    rows,
    // Not on the VAT return; counted as costs (whole amount) in the categories and the total.
    annual: annualGroup ? { count: annualGroup.count, gross: annualGroup.gross, rows: annualGroup.rows } : { count: 0, gross: 0, rows: [] },
    total: sumOf(all),
    homeVat: round2(home.reduce((s, g) => s + g.vat, 0)),
    // Dutch VAT that rests on a payment receipt or no document at all.
    weakVat: round2(home.flatMap((g) => g.rows).filter((row) => weakProof(row.receipt)).reduce((s, row) => s + (row.vat || 0), 0)),
    weakCount: receipts.filter(weakProof).length,
    foreignVat: round2(foreign.reduce((s, g) => s + g.vat, 0)),
    open: receipts.filter((r) => r.status !== 'done'),
    // Expense categories (gross, VAT included), largest first.
    categories: [...rows.reduce((m, row) => {
      const c = row.receipt.category || 'No category';
      const e = m.get(c) || { category: c, receipts: new Set(), net: 0, vat: 0, gross: 0 };
      if (!row.receipt._reversal) e.receipts.add(row.receipt.id); e.net += row.net || 0; e.vat += row.vat || 0; e.gross += row.gross || 0;
      return m.set(c, e);
    }, new Map()).values()]
      .map((e) => ({ ...e, count: e.receipts.size, net: round2(e.net), vat: round2(e.vat), gross: round2(e.gross) }))
      .sort((a, b) => b.gross - a.gross),
    missingRate: receipts.filter((r) => factor(r) == null),
  };
}

// Conversion to USD on the receipt date: receipt currency -> EUR (ECB) -> USD (ECB EUR/USD of that day).
// usdLookup comes from api.eurUsdRates. Returns { factor(r), rate(r) } where rate gives { rate, date } for display.
export function usdConversion(usdLookup) {
  const rate = (r) => {
    if (r.currency === 'USD') return { rate: 1, date: null };
    const toEur = fxFor(r);
    const eurUsd = r.receipt_date ? usdLookup(r.receipt_date) : null;
    if (toEur == null || !eurUsd) return null;
    return { rate: toEur * eurUsd.rate, date: eurUsd.date, eurUsd: eurUsd.rate };
  };
  return { factor: (r) => rate(r)?.rate ?? null, rate };
}
export const eurConversion = { factor: fxFor, rate: (r) => (r.currency === 'EUR' ? { rate: 1, date: null } : fxFor(r) == null ? null : { rate: fxFor(r), date: r.fx_date || null }) };

// ---------- agency statements (income) ----------

export const JOB_KINDS = {
  day_rate: 'Day rate', usage: 'Usage', buyout: 'Buy-out', day_rate_usage: 'Day rate + usage',
  overtime: 'Overtime', travel: 'Travel day', other: 'Other',
};

export const DEDUCTION_TYPES = {
  agency_fee: 'Agency fee', website: 'Website', transport: 'Transport (Uber, taxi)',
  tax_withheld: 'Tax withheld', other: 'Other deduction',
};

// Deductions are business costs; they count as expenses in these categories. Tax withheld is not a cost.
const DEDUCTION_CATEGORY = { agency_fee: 'Agency & Management', website: 'Marketing & Promotion', transport: 'Transportation', other: 'Other' };

const n = (v) => (isNum(v) ? Number(v) : 0);
export const deductionTotal = (d) => n(d.amount) + n(d.vat);
// What a line pays out: fee + VAT + expenses + VAT on expenses - deductions (and VAT on them).
export const lineTotal = (l) => round2(n(l.fee) + n(l.vat) + n(l.expenses) + n(l.expenses_vat) - (l.deductions || []).reduce((s, d) => s + deductionTotal(d), 0));

// Converting a statement uses the same rate rules as a receipt, at the statement (payment) date.
export const statementAsReceipt = (st) => ({ currency: st.currency, fx_rate: st.fx_rate, fx_date: st.fx_date, receipt_date: st.statement_date });

export function statementProblems(st) {
  const out = [];
  if (!st.agency) out.push('agency');
  if (!st.statement_date) out.push('statement date');
  if (!st.booking_date) out.push('import date');
  if (!st.currency) out.push('currency');
  if (st.currency && st.currency !== 'EUR' && !isNum(st.fx_rate)) out.push('exchange rate');
  const lines = st.lines || [];
  if (!lines.length) out.push('job lines');
  if (lines.some((l) => !isNum(l.fee))) out.push('fee on every line');
  if (lines.some((l) => (l.deductions || []).some((d) => !isNum(d.amount)))) out.push('deduction amounts');
  if (lines.some((l) => vatOff(l.fee, l.vat_rate ?? 0, l.vat ?? 0) !== null)) out.push('VAT doesn’t match the VAT %');
  if (lines.some((l) => expensesVatOff(l) !== null)) out.push('VAT on expenses doesn’t match the VAT %');
  const sum = round2(lines.reduce((s, l) => s + lineTotal(l), 0));
  if (lines.length && isNum(st.total_paid) && Math.abs(sum - Number(st.total_paid)) > 0.02 * lines.length) out.push('lines don’t add up to the amount paid');
  return out;
}

// VAT on expenses paid back is charged at the line's VAT %, when there is any. Expected amount when it's off, else null.
export const expensesVatOff = (l) => (n(l.expenses_vat) ? vatOff(l.expenses, l.vat_rate ?? 0, l.expenses_vat) : null);

// Income for a period, converted with factor (EUR by default). Statements count in the period of their statement date.
export function summarizeIncome(statements, factor = fxFor) {
  const agencies = new Map();
  const kinds = new Map();
  const deductions = new Map();
  const categories = new Map();
  const lines = [];
  let fee = 0, vat = 0, expenses = 0, expensesVat = 0, paid = 0, homeVat = 0, homeFeeVat = 0, homeExpensesVat = 0, homeFee = 0, homeExpenses = 0, deductionVat = 0, reverseCharge = 0;
  for (const st of statements) {
    const f = factor(statementAsReceipt(st));
    if (f == null) continue;
    const c = (v) => n(v) * f;
    const home = (st.agency_country || HOME_COUNTRY) === HOME_COUNTRY;
    const key = `${st.agency || 'Unknown agency'}|${st.agency_country || ''}`;
    if (!agencies.has(key)) agencies.set(key, { agency: st.agency || 'Unknown agency', country: st.agency_country, statements: new Set(), fee: 0, vat: 0, expenses: 0, deductions: 0, paid: 0 });
    const a = agencies.get(key);
    if (!st._reversal) a.statements.add(st.id);
    for (const l of st.lines || []) {
      const ded = (l.deductions || []).reduce((s, d) => s + deductionTotal(d), 0);
      const row = { statement: st, line: l, fee: round2(c(l.fee)), vat: round2(c(l.vat)), expenses: round2(c(l.expenses)), expenses_vat: round2(c(l.expenses_vat)),
        deductions: round2(c(ded)), paid: round2(c(lineTotal(l))) };
      lines.push(row);
      // Agency totals: VAT = all VAT the agency charged, on the fee and on expenses paid back.
      a.fee += row.fee; a.vat += row.vat + row.expenses_vat; a.expenses += row.expenses; a.deductions += row.deductions; a.paid += row.paid;
      fee += row.fee; vat += row.vat; expenses += row.expenses; expensesVat += row.expenses_vat; paid += row.paid;
      if (home) {
        homeVat += row.vat + row.expenses_vat;
        homeFeeVat += row.vat; homeExpensesVat += row.expenses_vat; homeFee += row.fee;
        if (row.expenses_vat) homeExpenses += row.expenses; // expenses charged with VAT are turnover too
      }
      const k = l.kind || 'other';
      kinds.set(k, (kinds.get(k) || 0) + row.fee);
      for (const d of l.deductions || []) {
        const t = d.type || 'other';
        deductions.set(t, (deductions.get(t) || 0) + c(d.amount));
        if (t !== 'tax_withheld') categories.set(DEDUCTION_CATEGORY[t] || 'Other', (categories.get(DEDUCTION_CATEGORY[t] || 'Other') || 0) + c(d.amount));
        if (home) deductionVat += c(d.vat);
        // Reverse charge: a foreign agency charges its fee without VAT; Dutch VAT on it is due and deductible at the same time.
        if (!home && d.reverse_charge && t !== 'tax_withheld') reverseCharge += c(d.amount) * 0.21;
      }
    }
  }
  const r = (m) => [...m.entries()].map(([k, v]) => ({ key: k, amount: round2(v) }));
  return {
    count: statements.filter((st) => !st._reversal).length,
    lines,
    agencies: [...agencies.values()].map((a) => ({ ...a, count: a.statements.size, fee: round2(a.fee), vat: round2(a.vat), expenses: round2(a.expenses), deductions: round2(a.deductions), paid: round2(a.paid) }))
      .sort((x, y) => y.fee - x.fee),
    kinds: r(kinds).map((k) => ({ ...k, label: JOB_KINDS[k.key] || k.key })),
    deductions: r(deductions).map((d) => ({ ...d, label: DEDUCTION_TYPES[d.key] || d.key })),
    categories: r(categories).map((x) => ({ category: x.key, amount: x.amount })),
    fee: round2(fee), vat: round2(vat), expenses: round2(expenses), expensesVat: round2(expensesVat), paid: round2(paid),
    homeVat: round2(homeVat), // Dutch VAT on income (fees and expenses paid back): to pay
    homeFee: round2(homeFee), homeFeeVat: round2(homeFeeVat), // fees from Dutch agencies and their VAT
    homeExpenses: round2(homeExpenses), homeExpensesVat: round2(homeExpensesVat), // expenses paid back with VAT, and that VAT
    deductionVat: round2(deductionVat), // Dutch VAT on deductions by Dutch agencies: deductible
    reverseCharge: round2(reverseCharge), // due and deductible
    missingRate: statements.filter((st) => factor(statementAsReceipt(st)) == null),
  };
}

// Receipt categories plus agency deductions (gross), largest first.
export function mergeCategories(receiptCats, incomeCats) {
  const m = new Map(receiptCats.map((c) => [c.category, { ...c, fromStatements: 0 }]));
  for (const x of incomeCats) {
    const e = m.get(x.category) || { category: x.category, count: 0, net: 0, vat: 0, gross: 0, fromStatements: 0 };
    e.fromStatements = round2(e.fromStatements + x.amount);
    e.net = round2(e.net + x.amount);
    e.gross = round2(e.gross + x.amount);
    m.set(x.category, e);
  }
  return [...m.values()].sort((a, b) => b.gross - a.gross);
}

// Agencies and the clients worked for through them, from statements. Amounts in EUR (statement date rate).
export function agencyOverview(statements) {
  const agencies = new Map();
  for (const st of statements) {
    const name = (st.agency || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const f = fxFor(statementAsReceipt(st));
    if (!agencies.has(key)) agencies.set(key, { key, name, country: st.agency_country, address: st.agency_address, statements: 0, fee: 0, paid: 0, clients: new Map(), last: '' });
    const a = agencies.get(key);
    a.statements++;
    if ((st.statement_date || '') >= a.last) { a.last = st.statement_date || a.last; a.country = st.agency_country || a.country; a.address = st.agency_address || a.address; }
    if (f != null) a.paid += n(st.total_paid) * f;
    for (const l of st.lines || []) {
      const c = (l.client || 'Unknown client').trim();
      const ck = c.toLowerCase();
      if (!a.clients.has(ck)) a.clients.set(ck, { name: c, jobs: 0, fee: 0, last: '', kinds: new Set() });
      const e = a.clients.get(ck);
      e.jobs++;
      if (f != null) { e.fee += n(l.fee) * f; a.fee += n(l.fee) * f; }
      const d = l.job_date || st.statement_date || '';
      if (d > e.last) e.last = d;
      if (l.kind) e.kinds.add(JOB_KINDS[l.kind] || l.kind);
    }
  }
  return [...agencies.values()]
    .map((a) => ({ ...a, fee: round2(a.fee), paid: round2(a.paid),
      clients: [...a.clients.values()].map((c) => ({ ...c, fee: round2(c.fee), kinds: [...c.kinds] })).sort((x, y) => y.fee - x.fee) }))
    .sort((x, y) => x.name.localeCompare(y.name));
}

// ---------- periods, corrections, duplicates ----------

export const periodOf = (iso) => (iso ? `${iso.slice(0, 4)}-Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}` : null);

// The quarter whose VAT return is due soon: only in the last 14 days of the month after it ends (e.g. 18-31 Oct for Q3).
export function filingDue(iso) {
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7)), day = Number(iso.slice(8, 10));
  if ((m - 1) % 3 !== 0) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (day <= last - 14) return null;
  return m === 1 ? `${y - 1}-Q4` : `${y}-Q${(m - 1) / 3}`;
}
// Today on this device, as YYYY-MM-DD in local time (VH5_TODAY overrides it in tests).
export const todayISO = () => {
  if (globalThis.VH5_TODAY) return globalThis.VH5_TODAY;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// The VAT return due soon: quarter, due date (last day of the month after it) and days left; null outside the window.
// urgent = the last two days (e.g. 30 and 31 October for Q3).
export function filingDeadline(iso) {
  const period = filingDue(iso);
  if (!period) return null;
  const y = Number(iso.slice(0, 4)), m = Number(iso.slice(5, 7));
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const daysLeft = last - Number(iso.slice(8, 10));
  return { period, due: `${iso.slice(0, 8)}${String(last).padStart(2, '0')}`, daysLeft, urgent: daysLeft <= 1 };
}

// "Due today" / "Due tomorrow" / "5 days left".
export const daysLeftLabel = (n) => (n === 0 ? 'Due today' : n === 1 ? 'Due tomorrow' : `${n} days left`);

export const periodLabel = (p) => (p ? `${p.slice(5)} ${p.slice(0, 4)}` : 'No quarter');
export const nextPeriod = (p) => (p.endsWith('4') ? `${Number(p.slice(0, 4)) + 1}-Q1` : `${p.slice(0, 6)}${Number(p.slice(6)) + 1}`);
// The quarter a record belongs to by its own date: receipt date for expenses, import date for statements.
export const naturalPeriod = (rec) => periodOf(rec.receipt_date !== undefined ? rec.receipt_date : rec.booking_date);
// Imported in a later quarter because its own quarter was already filed.
export const isLate = (rec) => !!rec.period && !!naturalPeriod(rec) && naturalPeriod(rec) !== rec.period;
// First open quarter for a date, given the filed quarters (same rule as the database).
export function bookingPeriod(iso, filed) {
  let p = periodOf(iso);
  while (p && filed.has(p)) p = nextPeriod(p);
  return p;
}

function negateReceipt(r) {
  return { ...r, id: `${r.id}~rev`, _reversal: true, total: -n(r.total),
    vat_lines: (r.vat_lines || []).map((l) => ({ ...l, net: -n(l.net), vat: -n(l.vat) })) };
}
function negateStatement(st) {
  return { ...st, id: `${st.id}~rev`, _reversal: true, total_paid: -n(st.total_paid),
    lines: (st.lines || []).map((l) => ({ ...l, fee: -n(l.fee), vat: -n(l.vat), expenses: -n(l.expenses), expenses_vat: -n(l.expenses_vat),
      deductions: (l.deductions || []).map((d) => ({ ...d, amount: -n(d.amount), vat: -n(d.vat) })) })) };
}

// Records of a period. A correction counts as the difference: its own values plus the reversed values
// of the record it corrects. all = every record (to find the originals).
export function forPeriod(records, all, match) {
  const byId = new Map(all.map((x) => [x.id, x]));
  const out = [];
  for (const rec of records.filter((x) => match(x.period))) {
    out.push(rec);
    const orig = rec.corrects && byId.get(rec.corrects);
    if (orig) out.push({ ...(rec.receipt_date !== undefined ? negateReceipt(orig) : negateStatement(orig)), period: rec.period, _correctionOf: orig });
  }
  return out;
}

// Same agency and statement number (or, without a number, same agency, date and amount) as an earlier statement.
export function duplicateOf(st, statements) {
  const key = (x) => [(x.agency || '').trim().toLowerCase(), x.statement_no ? x.statement_no.trim().toLowerCase() : `${x.statement_date}|${x.total_paid}`].join('|');
  if (!st.agency || st.corrects) return null;
  const k = key(st);
  return statements.find((x) => x.id !== st.id && !x.corrects && x.agency && key(x) === k && x.created_at < st.created_at) || null;
}

// ---------- year to date (home screen) ----------

// Figures for one year in EUR, per month and in total: expenses by receipt date, income by import date.
// until = 'MM-DD' to stop at the same day of the year (for a fair comparison with last year).
// A record replaced by a correction is left out; the correction counts instead.
export function yearFigures(receipts, statements, year, until = null) {
  const replaced = new Set([...receipts, ...statements].map((x) => x.corrects).filter(Boolean));
  const inRange = (iso) => !!iso && iso.startsWith(`${year}-`) && (!until || iso.slice(5) <= until);
  const month = (iso) => Number(iso.slice(5, 7)) - 1;
  const z = () => Array(12).fill(0);
  const m = { expenses: z(), income: z() };
  const t = { expenses: 0, cost: 0, income: 0, paid: 0, deductions: 0, vatIn: 0, vatOut: 0, receipts: 0, statements: 0 };
  for (const r of receipts) {
    if (replaced.has(r.id) || !inRange(r.receipt_date) || !isNum(r.total)) continue;
    const f = fxFor(r);
    if (f == null) continue;
    const gross = Number(r.total) * f;
    const home = (r.vat_country || HOME_COUNTRY) === HOME_COUNTRY && !r.annual_only;
    const vat = home ? (r.vat_lines || []).reduce((s, l) => s + n(l.vat), 0) * f : 0;
    m.expenses[month(r.receipt_date)] += gross;
    t.expenses += gross;
    t.cost += gross - vat; // Dutch VAT comes back; foreign VAT and annual-only receipts cost the full amount
    t.vatIn += vat;
    t.receipts++;
  }
  for (const st of statements) {
    if (replaced.has(st.id) || !inRange(st.booking_date)) continue;
    const f = fxFor(statementAsReceipt(st));
    if (f == null) continue;
    const home = (st.agency_country || HOME_COUNTRY) === HOME_COUNTRY;
    for (const l of st.lines || []) {
      m.income[month(st.booking_date)] += n(l.fee) * f;
      t.income += n(l.fee) * f;
      t.paid += lineTotal(l) * f;
      if (home) t.vatOut += (n(l.vat) + n(l.expenses_vat)) * f;
      for (const d of l.deductions || []) {
        if (d.type !== 'tax_withheld') t.deductions += n(d.amount) * f;
        if (home) t.vatIn += n(d.vat) * f;
      }
    }
    t.statements++;
  }
  const r2 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v.map(round2) : round2(v)]));
  const totals = r2(t);
  totals.result = round2(t.income - t.deductions - t.cost); // indicative, before income tax
  totals.vatDue = round2(t.vatOut - t.vatIn);
  return { months: r2(m), totals };
}
