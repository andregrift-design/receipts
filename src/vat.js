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

// ---------- VAT categories ----------
// Key = "<country>:<rate>", "<country>:none" (no VAT / exempt) or "<country>:unknown" (VAT not entered).

export const isHome = (key) => key.startsWith(`${HOME_COUNTRY}:`);

export function vatKey(receipt, line) {
  const country = receipt.vat_country || HOME_COUNTRY;
  if (line.rate === undefined) return `${country}:unknown`;
  if (line.rate === null || line.rate === '') return `${country}:none`;
  return `${country}:${Number(line.rate)}`;
}

export function vatLabel(key) {
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
export function compareKeys(a, b) {
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
export function summarize(receipts) {
  const rows = rowsFor(receipts);
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.key)) groups.set(row.key, { key: row.key, country: row.key.split(':')[0], label: vatLabel(row.key), receipts: new Set(), net: 0, vat: 0, gross: 0, rows: [] });
    const g = groups.get(row.key);
    g.receipts.add(row.receipt.id);
    g.net += row.net || 0;
    g.vat += row.vat || 0;
    g.gross += row.gross || 0;
    g.rows.push(row);
  }
  const list = [...groups.values()].sort((a, b) => compareKeys(a.key, b.key))
    .map((g) => ({ ...g, count: g.receipts.size, net: round2(g.net), vat: round2(g.vat), gross: round2(g.gross) }));
  const home = list.filter((g) => isHome(g.key));
  const foreign = list.filter((g) => !isHome(g.key));
  const countries = [...new Set(foreign.map((g) => g.country))]
    .map((c) => ({ country: c, name: countryName(c), ...sumOf(foreign.filter((g) => g.country === c)) }));
  return {
    groups: list,
    home: { groups: home, ...sumOf(home) },
    foreign: { groups: foreign, countries, ...sumOf(foreign) },
    rows,
    total: sumOf(list),
    homeVat: round2(home.reduce((s, g) => s + g.vat, 0)),
    // Dutch VAT that rests on a payment receipt or no document at all.
    weakVat: round2(home.flatMap((g) => g.rows).filter((row) => weakProof(row.receipt)).reduce((s, row) => s + (row.vat || 0), 0)),
    weakCount: receipts.filter(weakProof).length,
    foreignVat: round2(foreign.reduce((s, g) => s + g.vat, 0)),
    open: receipts.filter((r) => r.status !== 'done'),
  };
}
