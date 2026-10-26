// VAT categories, checks and the quarterly overview. Pure functions, no I/O.

export const HOME_COUNTRY = 'NL';

export const CATEGORIES = [
  'Travel', 'Fuel', 'Parking', 'Public transport', 'Accommodation', 'Meals',
  'Office supplies', 'Hardware', 'Software', 'Telecom', 'Training', 'Representation', 'Other',
];

export const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'JPY', 'CAD', 'AUD'];

export const COUNTRIES = {
  NL: 'Netherlands', BE: 'Belgium', DE: 'Germany', FR: 'France', LU: 'Luxembourg', GB: 'United Kingdom',
  IE: 'Ireland', ES: 'Spain', PT: 'Portugal', IT: 'Italy', AT: 'Austria', CH: 'Switzerland', DK: 'Denmark',
  SE: 'Sweden', NO: 'Norway', FI: 'Finland', PL: 'Poland', CZ: 'Czechia', GR: 'Greece', US: 'United States',
};

// Standard rates the rate picker offers per country (anything else can be typed).
export const RATES = { NL: [21, 9, 0], BE: [21, 12, 6, 0], DE: [19, 7, 0], FR: [20, 10, 5.5, 0], GB: [20, 5, 0] };

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const isNum = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));

export function money(n, currency = 'EUR') {
  if (!isNum(n)) return '–';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(n);
}

export function fmtDate(iso) {
  if (!iso) return 'No date';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------- categories ----------

export function vatKey(receipt, line) {
  if (line.rate === null || line.rate === undefined || line.rate === '') return 'none';
  const country = receipt.vat_country || HOME_COUNTRY;
  return country === HOME_COUNTRY ? `${HOME_COUNTRY}:${Number(line.rate)}` : `${country}:${Number(line.rate)}`;
}

export function vatLabel(key) {
  if (key === 'none') return 'No VAT / exempt';
  if (key === 'unknown') return 'VAT not entered';
  const [country, rate] = key.split(':');
  if (country === HOME_COUNTRY) {
    const name = { 21: 'high rate', 9: 'low rate', 0: 'zero rate' }[rate];
    return `${rate}% VAT${name ? ` (${name})` : ''}`;
  }
  return `Foreign VAT: ${COUNTRIES[country] || country} ${rate}%`;
}

// Sort: home rates high to low, then no VAT, then foreign, then unknown.
function keyOrder(key) {
  if (key === 'unknown') return [4, 0, ''];
  if (key === 'none') return [2, 0, ''];
  const [country, rate] = key.split(':');
  return [country === HOME_COUNTRY ? 1 : 3, -Number(rate), country];
}
export function compareKeys(a, b) {
  const x = keyOrder(a), y = keyOrder(b);
  return x[0] - y[0] || x[2].localeCompare(y[2]) || x[1] - y[1];
}

// ---------- checks ----------

export function fxFor(r) {
  if ((r.currency || 'EUR') === 'EUR') return 1;
  return isNum(r.fx_rate) ? Number(r.fx_rate) : null;
}

export function linesSum(lines) {
  return round2((lines || []).reduce((s, l) => s + (Number(l.net) || 0) + (Number(l.vat) || 0), 0));
}

// What still needs to be filled in or fixed before the receipt counts as done.
export function problems(r) {
  const out = [];
  if (!r.receipt_date) out.push('date');
  if (!r.store && !r.description) out.push('store or description');
  if (!isNum(r.total)) out.push('amount');
  if (!r.currency) out.push('currency');
  if (r.currency && r.currency !== 'EUR' && !isNum(r.fx_rate)) out.push('exchange rate');
  const lines = r.vat_lines || [];
  if (!lines.length) out.push('VAT');
  else if (lines.some((l) => !isNum(l.net) || (l.rate !== null && !isNum(l.vat)))) out.push('VAT amounts');
  else if (isNum(r.total) && Math.abs(linesSum(lines) - Number(r.total)) > 0.02 * lines.length) out.push('VAT lines don’t add up to the total');
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

export function quarterRange(year, q) {
  const start = `${year}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`;
  const endMonth = q * 3;
  const last = new Date(year, endMonth, 0).getDate();
  return { start, end: `${year}-${String(endMonth).padStart(2, '0')}-${last}` };
}

export const quarterLabel = (year, q) => {
  const { start, end } = quarterRange(year, q);
  const m = (iso) => new Date(iso + 'T12:00').toLocaleDateString('en-US', { month: 'short' });
  return `Q${q} ${year} (${m(start)}–${m(end)})`;
};

// One row per VAT line, in EUR. Receipts without VAT lines get one "unknown" row.
export function rowsFor(receipts) {
  const rows = [];
  for (const r of receipts) {
    const fx = fxFor(r);
    const eur = (v) => (isNum(v) && fx != null ? round2(Number(v) * fx) : null);
    const lines = r.vat_lines?.length ? r.vat_lines : [{ rate: undefined, net: null, vat: null, gross: r.total }];
    for (const l of lines) {
      const key = l.rate === undefined ? 'unknown' : vatKey(r, l);
      const gross = l.rate === undefined ? r.total : (Number(l.net) || 0) + (Number(l.vat) || 0);
      rows.push({ receipt: r, key, rate: l.rate, net: eur(l.net), vat: eur(l.rate === null ? 0 : l.vat), gross: eur(gross), net_orig: l.net, vat_orig: l.vat, gross_orig: gross });
    }
  }
  return rows;
}

export function summarize(receipts) {
  const rows = rowsFor(receipts);
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.key)) groups.set(row.key, { key: row.key, label: vatLabel(row.key), receipts: new Set(), net: 0, vat: 0, gross: 0, rows: [] });
    const g = groups.get(row.key);
    g.receipts.add(row.receipt.id);
    g.net += row.net || 0;
    g.vat += row.vat || 0;
    g.gross += row.gross || 0;
    g.rows.push(row);
  }
  const list = [...groups.values()].sort((a, b) => compareKeys(a.key, b.key))
    .map((g) => ({ ...g, count: g.receipts.size, net: round2(g.net), vat: round2(g.vat), gross: round2(g.gross) }));
  const deductible = list.filter((g) => g.key.startsWith(`${HOME_COUNTRY}:`));
  return {
    groups: list,
    rows,
    total: { net: round2(list.reduce((s, g) => s + g.net, 0)), vat: round2(list.reduce((s, g) => s + g.vat, 0)), gross: round2(list.reduce((s, g) => s + g.gross, 0)) },
    homeVat: round2(deductible.reduce((s, g) => s + g.vat, 0)),
    open: receipts.filter((r) => r.status !== 'done'),
  };
}
