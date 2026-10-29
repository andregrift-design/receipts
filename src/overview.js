// Overview of a quarter or year, in a fixed order: expenses (NL, foreign), income (Dutch, foreign agencies),
// Dutch VAT position, corrections. Quarters filed with the CPA are locked.
import { html, useState, useEffect, useMemo } from './ui.js';
import * as api from './api.js';
import {
  money, fmtDate, quarterOf, quarterLabel, summarize, summarizeIncome, mergeCategories, countryName, DOC_TYPES, weakProof,
  usdConversion, eurConversion, round2, neg, periodLabel, forPeriod, isLate, naturalPeriod, JOB_KINDS, HOME_COUNTRY,
  statementAsReceipt, lineTotal, vatLabel, ANNUAL_LABEL,
} from './vat.js';
import { go, Cols, Badge, Modal } from './kit.js';
import { downloadExcel, downloadPdf, downloadZip, numbered } from './export.js';

function defaultPeriod() {
  const d = new Date();
  let { year, q } = quarterOf(d.toISOString().slice(0, 10));
  // In the first three weeks of a quarter you most likely want the one that just ended.
  if (d.getMonth() === (q - 1) * 3 && d.getDate() <= 21) { q -= 1; if (q === 0) { q = 4; year -= 1; } }
  return { year, q };
}

// Everything the screen and the exports need for one period.
export function buildPeriod({ receipts, statements, year, quarter, conv }) {
  const period = quarter ? `${year}-Q${quarter}` : null;
  const match = (p) => (period ? p === period : !!p && p.startsWith(`${year}-`));
  const rec = forPeriod(receipts, receipts, match);
  const sts = forPeriod(statements, statements, match);
  const s = summarize(rec, conv.factor);
  const inc = summarizeIncome(sts, conv.factor);
  const cats = mergeCategories(s.categories, inc.categories);
  const vatDue = round2(inc.homeVat - s.homeVat - inc.deductionVat);
  const corrections = [...rec, ...sts].filter((x) => !x._reversal && (x.corrects || isLate(x)));
  return { period, rec, sts, s, inc, cats, vatDue, corrections };
}

const reportCurrency = () => localStorage.getItem('reportCurrency') || 'EUR';

export function OverviewPage({ ctx, arg }) {
  const def = defaultPeriod();
  const [y, q] = arg ? arg.split('-').map((x) => Number(String(x).replace('Q', ''))) : [def.year, def.q];
  const year = y || def.year;
  const quarter = Number.isInteger(q) && q >= 0 && q <= 4 ? q : def.q;
  const [cur, setCur] = useState(reportCurrency());
  const [usd, setUsd] = useState(null);
  const [busy, setBusy] = useState('');
  const [filing, setFiling] = useState(false);
  const [photos, setPhotos] = useState(localStorage.getItem('pdfPhotos') === '1');
  const togglePhotos = (on) => { setPhotos(on); localStorage.setItem('pdfPhotos', on ? '1' : '0'); };
  const [withStatements, setWithStatements] = useState(localStorage.getItem('pdfStatements') === '1');
  const toggleStatements = (on) => { setWithStatements(on); localStorage.setItem('pdfStatements', on ? '1' : '0'); };
  const period = quarter ? `${year}-Q${quarter}` : null;
  const filed = period && ctx.filed.has(period);
  const filedInfo = period && ctx.periods.find((p) => p.period === period);

  // USD needs EUR/USD rates for every date used: receipt dates and statement payment dates.
  const dates = useMemo(() => {
    const match = (p) => (period ? p === period : !!p && p.startsWith(`${year}-`));
    // Corrections also reverse their original, which is converted at the original's date.
    const orig = (list, x) => (x.corrects ? list.find((o) => o.id === x.corrects) : null);
    const rs = ctx.receipts.filter((r) => match(r.period));
    const ss = ctx.statements.filter((st) => match(st.period));
    const ds = [...rs, ...rs.map((r) => orig(ctx.receipts, r)).filter(Boolean)].map((r) => r.receipt_date)
      .concat([...ss, ...ss.map((st) => orig(ctx.statements, st)).filter(Boolean)].map((st) => st.statement_date))
      .filter(Boolean).sort();
    return ds.length ? [ds[0], ds[ds.length - 1]] : null;
  }, [ctx.receipts, ctx.statements, year, quarter]);
  useEffect(() => {
    if (cur !== 'USD' || !dates) return;
    const key = dates.join('|');
    if (usd?.key === key) return;
    setUsd(null);
    const end = dates[1] < new Date().toISOString().slice(0, 10) ? dates[1] : new Date().toISOString().slice(0, 10);
    api.eurUsdRates(dates[0], end).then((lookup) => setUsd({ key, lookup })).catch((e) => setUsd({ key, error: e.message }));
  }, [cur, dates]);

  const conv = cur === 'USD' ? (usd?.lookup ? usdConversion(usd.lookup) : dates ? null : usdConversion(() => null)) : eurConversion;
  const d = useMemo(() => (conv ? buildPeriod({ receipts: ctx.receipts, statements: ctx.statements, year, quarter, conv }) : null), [ctx.receipts, ctx.statements, year, quarter, conv]);
  const m = (v) => money(v, cur);

  const step = (dlt) => {
    if (!quarter) return go(`overview/${year + dlt}-0`);
    let yy = year, qq = quarter + dlt; if (qq < 1) { qq = 4; yy--; } if (qq > 4) { qq = 1; yy++; } go(`overview/${yy}-${qq}`);
  };
  const setCurrency = (c) => { localStorage.setItem('reportCurrency', c); setCur(c); };
  const title = quarter ? `Q${quarter} ${year}` : `${year}`;
  const meta = { title: `${title}${cur === 'USD' ? ' (USD)' : ''}`, owner: ctx.ownerLabel, currency: cur, conv, filed: filedInfo,
    fileBase: `VH5 ${quarter ? `${year}-Q${quarter}` : year}${cur === 'USD' ? ' USD' : ''}` };
  const run = async (label, fn) => { setBusy(label); try { await fn(); } catch (e) { alert(e.message); } finally { setBusy(''); } };
  const ready = !!d && (d.rec.length || d.sts.length) && !busy;
  const file = async () => {
    try { await api.filePeriod(period); setFiling(false); ctx.reload(); } catch (e) { alert(e.message); }
  };

  return html`
    <div class="page-head">
      <div><p class="kicker">Overview</p><h1>${quarterLabel(year, quarter)}</h1></div>
      <div class="actions">
        ${filed ? html`<span class="badge st-lock">🔒 Filed with CPA on ${fmtDate(filedInfo.filed_at.slice(0, 10))}</span>`
          : period ? html`<span class="badge st-quiet">Open</span>` : ''}
        ${period && !filed && ctx.mine && html`<button onClick=${() => setFiling(true)}>Mark as filed with CPA</button>`}
      </div>
    </div>
    <div class="periodbar">
      <div class="periodnav">
        <button class="icon" onClick=${() => step(-1)} aria-label="Previous">‹</button>
        <div class="seg">
          ${[1, 2, 3, 4].map((n) => html`<a class=${quarter === n ? 'on' : ''} href=${`#/overview/${year}-${n}`}>Q${n}</a>`)}
          <a class=${!quarter ? 'on' : ''} href=${`#/overview/${year}-0`}>Year</a>
        </div>
        <button class="icon" onClick=${() => step(1)} aria-label="Next">›</button>
      </div>
      <div class="seg">
        <button class=${cur === 'EUR' ? 'on' : ''} onClick=${() => setCurrency('EUR')}>EUR · Dutch accountant</button>
        <button class=${cur === 'USD' ? 'on' : ''} onClick=${() => setCurrency('USD')}>USD · US CPA</button>
      </div>
    </div>

    ${cur === 'USD' && dates && !usd && html`<p class="hint">Loading USD exchange rates…</p>`}
    ${usd?.error && html`<div class="note bad">${usd.error}</div>`}

    ${d && html`
      ${(d.s.open.length > 0 || d.sts.some((st) => st.status !== 'done' && !st._reversal)) && html`
        <div class="note">Still to check in this period: ${[...d.s.open, ...d.sts.filter((st) => st.status !== 'done' && !st._reversal)].map((x, i) => html`${i ? ', ' : ''}<a href=${x.receipt_date !== undefined ? `#/r/${x.id}` : `#/s/${x.id}`}>${x.store || x.agency || x.description || 'item'}</a>`)}.</div>`}
      ${(d.s.missingRate.length > 0 || d.inc.missingRate.length > 0) && html`<div class="note bad">Some items have no exchange rate and are left out of the totals.</div>`}

      <div class="tiles">
        <div class="tile"><p class="kicker">Expenses (incl. VAT)</p><div class="big-num">${m(d.cats.reduce((t, c) => t + c.gross, 0))}</div><small>${d.s.total.count} receipt${d.s.total.count === 1 ? '' : 's'}</small></div>
        <div class="tile"><p class="kicker">Income (fees)</p><div class="big-num">${m(d.inc.fee)}</div><small>${d.inc.count} statement${d.inc.count === 1 ? '' : 's'} · paid ${m(d.inc.paid)}</small></div>
        <div class="tile"><p class="kicker">${cur === 'EUR' ? (d.vatDue >= 0 ? 'Dutch VAT to pay' : 'Dutch VAT to get back') : 'Dutch VAT'}</p>
          <div class="big-num">${cur === 'EUR' ? m(Math.abs(d.vatDue)) : '–'}</div><small>${cur === 'EUR' ? 'income VAT minus deductible VAT' : 'shown in the EUR view'}</small></div>
      </div>

      <${ExpensesSection} d=${d} m=${m} />
      <${IncomeSection} d=${d} m=${m} />
      ${cur === 'EUR' && html`<${VatSection} d=${d} m=${m} />`}
      <${CorrectionsSection} d=${d} m=${m} ctx=${ctx} conv=${conv} />

      <p class="hint">${cur === 'USD'
        ? 'All amounts in USD, converted on each date: receipts at the receipt date, statements at the payment date (receipt currency to EUR at the ECB rate, then EUR to USD at the ECB rate of that day). Amounts already in USD are not converted.'
        : 'All amounts in EUR; foreign currencies at the ECB rate of the receipt date (statements: the payment date).'}
        Expenses count by receipt date, income by the import date you entered.</p>

      <div class="actions">
        <button class="primary" disabled=${!ready} onClick=${() => run('Excel…', () => (photos || withStatements
          ? downloadZip(d, { ...meta, photos, statements: withStatements }, (n, t) => setBusy(`ZIP: document ${n} of ${t}…`))
          : downloadExcel(d, meta)))}>Download Excel${cur === 'USD' ? ' (USD)' : ''}${photos || withStatements ? ' + documents (ZIP)' : ''}</button>
        <button disabled=${!ready} onClick=${() => run('PDF…', () => downloadPdf(d, { ...meta, photos, statements: withStatements }, (n, t) => setBusy(`PDF: document ${n} of ${t}…`)))}>Download PDF${cur === 'USD' ? ' (USD)' : ''}</button>
        <span class="doc-picks"><span class="hint">Include:</span>
          <label class="check"><input type="checkbox" checked=${photos} onChange=${(e) => togglePhotos(e.target.checked)} />Receipts</label>
          <label class="check"><input type="checkbox" checked=${withStatements} onChange=${(e) => toggleStatements(e.target.checked)} />Statements</label></span>
        ${busy && html`<span class="hint">${busy}</span>`}
      </div>

      <${DetailSection} d=${d} m=${m} cur=${cur} conv=${conv} />`}

    ${filing && html`
      <${Modal} onClose=${() => setFiling(false)}>
        <h2>File ${title} with the CPA</h2>
        <p>After this, nothing in ${title} can be changed: not by you, not by the CPA. Receipts dated in ${title} that you add later,
          and corrections, go into the next open quarter with a ↩︎ mark.</p>
        <p class="hint">Make sure the overview and the export you give the CPA are final.</p>
        <div class="actions">
          <button class="primary" onClick=${file}>File ${title}</button>
          <button onClick=${() => setFiling(false)}>Cancel</button>
        </div>
      </${Modal}>`}`;
}

// ---------- sections ----------

const Section = ({ title, note, children }) => html`
  <div class="section-title"><h2>${title}</h2>${note && html`<small>${note}</small>`}</div>${children}`;

function ExpensesSection({ d, m }) {
  const { s, cats } = d;
  // Foreign receipts marked annual-only sit in the annual block; the foreign card says so.
  const foreignAnnual = s.annual.rows.filter((row) => !row.receipt._reversal && (row.receipt.vat_country || HOME_COUNTRY) !== HOME_COUNTRY).length;
  const dash = (g, v) => (g.key.endsWith(':unknown') ? '–' : m(v));
  const vatRow = (g, label) => html`<tr><td>${label}</td><td class="n">${g.count}</td><td class="n">${dash(g, g.net)}</td><td class="n">${dash(g, g.vat)}</td><td class="n">${m(g.gross)}</td></tr>`;
  const head = html`<thead><tr><th>VAT category</th><th class="n">Receipts</th><th class="n">Net</th><th class="n">VAT</th><th class="n">Gross</th></tr></thead>`;
  return html`
    <${Section} title="1. Expenses" note="by receipt date">
      <div class="card">
        <h3>Netherlands</h3>
        ${s.home.groups.length ? html`
          <table><${Cols} amounts=${3} />${head}
            <tbody>${s.home.groups.map((g) => vatRow(g, g.label))}</tbody>
            <tfoot>
              <tr><td>Total Netherlands</td><td class="n">${s.home.count}</td><td class="n">${m(s.home.net)}</td><td class="n">${m(s.home.vat)}</td><td class="n">${m(s.home.gross)}</td></tr>
            </tfoot>
          </table>
          <p class="hint">Dutch VAT to deduct: <strong>${m(s.homeVat)}</strong>${s.weakVat > 0 ? html`, of which ${m(s.weakVat)} on a payment receipt or no document` : ''}</p>`
          : html`<p class="hint">No Dutch receipts.</p>`}
      </div>
      <div class="card">
        <h3>Foreign</h3>
        ${s.foreign.groups.length ? html`
          <table><${Cols} amounts=${3} />${head}
            <tbody>${s.foreign.countries.map((c) => html`
              <tr class="group"><td>${c.name}</td><td class="n">${c.count}</td><td class="n">${m(c.net)}</td><td class="n">${m(c.vat)}</td><td class="n">${m(c.gross)}</td></tr>
              ${s.foreign.groups.filter((g) => g.country === c.country).map((g) => vatRow(g, g.label.replace(`${c.name}: `, '')))}`)}</tbody>
            <tfoot><tr><td>Total foreign</td><td class="n">${s.foreign.count}</td><td class="n">${m(s.foreign.net)}</td><td class="n">${m(s.foreign.vat)}</td><td class="n">${m(s.foreign.gross)}</td></tr></tfoot>
          </table>
          <p class="hint">Foreign VAT (${m(s.foreignVat)}) can’t be deducted on the Dutch return; within the EU it can be reclaimed from that country.</p>`
          : !foreignAnnual && html`<p class="hint">No foreign receipts.</p>`}
        ${foreignAnnual > 0 && html`<p class="hint">${foreignAnnual} foreign receipt${foreignAnnual === 1 ? ' is' : 's are'} marked as annual costs only, so ${foreignAnnual === 1 ? 'it is' : 'they are'} listed under “Annual costs only” below, not here. Untick “Annual costs only” on a receipt to show it here.</p>`}
      </div>
      ${s.annual.count > 0 && html`
      <div class="card">
        <h3>${ANNUAL_LABEL}</h3>
        <table><${Cols} amounts=${3} />
          <thead><tr><th>Receipt</th><th class="n">Receipts</th><th class="n">Cost</th><th class="n">VAT</th><th class="n">Gross</th></tr></thead>
          <tbody>${s.annual.rows.map((row) => { const r = row.receipt; return html`
            <tr><td><a href=${`#/r/${r._correctionOf ? r._correctionOf.id : r.id}`}>${r._reversal ? '↩︎ reversal: ' : r.corrects ? '↩︎ ' : ''}${r.store || r.description || '–'}</a>
              <small> · ${[r.receipt_date && fmtDate(r.receipt_date), r.category, r.vat_country && r.vat_country !== HOME_COUNTRY && countryName(r.vat_country)].filter(Boolean).join(' · ')}</small></td>
              <td class="n">${r._reversal ? '' : 1}</td><td class="n">${m(row.net)}</td><td class="n">–</td><td class="n">${m(row.gross)}</td></tr>`; })}</tbody>
          <tfoot><tr><td>Total annual costs only</td><td class="n">${s.annual.count}</td><td class="n">${m(s.annual.gross)}</td><td class="n">–</td><td class="n">${m(s.annual.gross)}</td></tr></tfoot>
        </table>
        <p class="hint">Marked by you as annual costs only: not on the VAT return, no VAT deducted. The full amount counts as cost in the categories below and in the annual figures.</p>
      </div>`}
      <div class="card">
        <h3>Per category</h3>
        <table><${Cols} amounts=${3} />
          <thead><tr><th>Category</th><th class="n">Receipts</th><th class="n">Net</th><th class="n">VAT</th><th class="n">Gross</th></tr></thead>
          <tbody>${cats.map((c) => html`<tr><td>${c.category}${c.fromStatements ? html` <small>incl. ${m(c.fromStatements)} deducted by agencies</small>` : ''}</td><td class="n">${c.count}</td><td class="n">${m(c.net)}</td><td class="n">${m(c.vat)}</td><td class="n">${m(c.gross)}</td></tr>`)}
            ${!cats.length && html`<tr><td colspan="5" class="hint">No expenses.</td></tr>`}</tbody>
          <tfoot><tr><td>Total expenses</td><td class="n">${s.total.count}</td><td class="n">${m(cats.reduce((t, c) => t + c.net, 0))}</td><td class="n">${m(cats.reduce((t, c) => t + c.vat, 0))}</td><td class="n">${m(cats.reduce((t, c) => t + c.gross, 0))}</td></tr></tfoot>
        </table>
      </div>
    </${Section}>`;
}

const sumAgencies = (list) => list.reduce((t, a) => ({ count: t.count + a.count, fee: t.fee + a.fee, vat: t.vat + a.vat, deductions: t.deductions + a.deductions, paid: t.paid + a.paid }),
  { count: 0, fee: 0, vat: 0, deductions: 0, paid: 0 });

function IncomeSection({ d, m }) {
  const { inc } = d;
  const dutch = inc.agencies.filter((a) => (a.country || HOME_COUNTRY) === HOME_COUNTRY);
  const foreign = inc.agencies.filter((a) => (a.country || HOME_COUNTRY) !== HOME_COUNTRY);
  const countries = [...new Set(foreign.map((a) => a.country))];
  const head = html`<thead><tr><th>Agency</th><th class="n">Statements</th><th class="n">Fees</th><th class="n">VAT</th><th class="n">Deductions</th><th class="n">Paid</th></tr></thead>`;
  const row = (a, cls = '') => html`<tr class=${cls}><td>${a.agency || a.label}</td><td class="n">${a.count}</td><td class="n">${m(a.fee)}</td><td class="n">${m(a.vat)}</td><td class="n">${m(neg(a.deductions))}</td><td class="n">${m(a.paid)}</td></tr>`;
  const foot = (label, t) => html`<tfoot><tr><td>${label}</td><td class="n">${t.count}</td><td class="n">${m(t.fee)}</td><td class="n">${m(t.vat)}</td><td class="n">${m(neg(t.deductions))}</td><td class="n">${m(t.paid)}</td></tr></tfoot>`;
  return html`
    <${Section} title="2. Income" note="agency statements, by import date">
      <div class="card">
        <h3>Dutch agencies</h3>
        ${dutch.length ? html`<table><${Cols} amounts=${4} />${head}<tbody>${dutch.map((a) => row(a))}</tbody>${foot('Total Dutch agencies', sumAgencies(dutch))}</table>`
          : html`<p class="hint">No statements from Dutch agencies.</p>`}
      </div>
      <div class="card">
        <h3>Foreign agencies</h3>
        ${foreign.length ? html`<table><${Cols} amounts=${4} />${head}
          <tbody>${countries.map((c) => {
            const list = foreign.filter((a) => a.country === c);
            return html`${row({ label: countryName(c), ...sumAgencies(list) }, 'group')}${list.map((a) => row(a))}`;
          })}</tbody>${foot('Total foreign agencies', sumAgencies(foreign))}</table>
          ${inc.reverseCharge !== 0 && html`<p class="hint">Agency fees reverse-charged: Dutch VAT ${m(inc.reverseCharge)} due and deductible (see VAT position).</p>`}`
          : html`<p class="hint">No statements from foreign agencies.</p>`}
      </div>
      ${inc.count > 0 && html`
        <div class="split">
          <div class="card">
            <h3>Fees by type</h3>
            <table><${Cols} count=${false} amounts=${1} /><tbody>${inc.kinds.map((k) => html`<tr><td>${k.label}</td><td class="n">${m(k.amount)}</td></tr>`)}</tbody>
              <tfoot><tr><td>Total fees</td><td class="n">${m(inc.fee)}</td></tr></tfoot></table>
          </div>
          <div class="card">
            <h3>Deductions by type</h3>
            <table><${Cols} count=${false} amounts=${1} /><tbody>${inc.deductions.map((x) => html`<tr><td>${x.label}</td><td class="n">${m(x.amount)}</td></tr>`)}
              ${!inc.deductions.length && html`<tr><td class="hint">None</td><td></td></tr>`}</tbody>
              <tfoot><tr><td>Total deductions</td><td class="n">${m(inc.deductions.reduce((t, x) => t + x.amount, 0))}</td></tr></tfoot></table>
          </div>
        </div>
        <div class="card">
          <h3>Fees and expenses paid back (Dutch agencies)</h3>
          <table><${Cols} count=${false} amounts=${2} />
            <thead><tr><th></th><th class="n">Amount</th><th class="n">VAT</th></tr></thead>
            <tbody>
              <tr><td>Fees</td><td class="n">${m(inc.homeFee)}</td><td class="n">${m(inc.homeFeeVat)}</td></tr>
              <tr><td>Expenses paid back with VAT</td><td class="n">${m(inc.homeExpenses)}</td><td class="n">${m(inc.homeExpensesVat)}</td></tr>
            </tbody>
            <tfoot><tr><td>Turnover with Dutch VAT</td><td class="n">${m(round2(inc.homeFee + inc.homeExpenses))}</td><td class="n">${m(inc.homeVat)}</td></tr></tfoot>
          </table>
          <p class="hint">When an agency charges VAT on expenses it pays back, those expenses count as turnover and their VAT is due, like the VAT on fees.${round2(inc.expenses - inc.homeExpenses) !== 0 ? ` Expenses paid back without VAT: ${m(round2(inc.expenses - inc.homeExpenses))}.` : ''}</p>
        </div>`}
    </${Section}>`;
}

function VatSection({ d, m }) {
  const { s, inc, vatDue } = d;
  return html`
    <${Section} title="3. Dutch VAT position">
      <div class="card">
        <table><${Cols} count=${false} amounts=${1} />
          <tbody>
            <tr><td>VAT on fees from Dutch agencies (to pay)</td><td class="n">${m(inc.homeFeeVat)}</td></tr>
            <tr><td>VAT on expenses paid back by Dutch agencies (to pay)</td><td class="n">${m(inc.homeExpensesVat)}</td></tr>
            <tr><td>Reverse-charge VAT on foreign agency fees (due)</td><td class="n">${m(inc.reverseCharge)}</td></tr>
            <tr><td>VAT on Dutch receipts (deductible)</td><td class="n">${m(neg(s.homeVat))}</td></tr>
            <tr><td>VAT on Dutch agency deductions (deductible)</td><td class="n">${m(neg(inc.deductionVat))}</td></tr>
            <tr><td>Reverse-charge VAT on foreign agency fees (deductible)</td><td class="n">${m(neg(inc.reverseCharge))}</td></tr>
          </tbody>
          <tfoot><tr><td>${vatDue >= 0 ? 'VAT to pay' : 'VAT to get back'}</td><td class="n">${m(Math.abs(vatDue))}</td></tr></tfoot>
        </table>
        <p class="hint">Fees from foreign agencies carry no Dutch VAT and belong in their own boxes on the return. Your accountant decides the final return.</p>
      </div>
    </${Section}>`;
}

function CorrectionsSection({ d, m, ctx }) {
  if (!d.corrections.length) return null;
  return html`
    <${Section} title="4. Corrections and late entries" note="↩︎ related to an earlier quarter">
      <div class="card flush">
        ${d.corrections.map((x) => {
          const isRec = x.receipt_date !== undefined;
          const orig = x.corrects && (isRec ? ctx.receipts : ctx.statements).find((o) => o.id === x.corrects);
          return html`
            <a class="row" href=${isRec ? `#/r/${x.id}` : `#/s/${x.id}`}>
              <span class="what"><strong>↩︎ ${isRec ? x.store || x.description : x.agency}</strong>
                <small>${x.corrects ? `Correction of ${periodLabel(orig?.period)}: the difference with the original is booked here` : `Late entry: belongs to ${periodLabel(naturalPeriod(x))}, which was already filed`}</small></span>
              <span class="badges">${x.status !== 'done' && html`<${Badge} status=${x.status} />`}</span>
            </a>`;
        })}
      </div>
    </${Section}>`;
}

function DetailSection({ d, m, cur, conv }) {
  const nums = new Map(numbered(d.rec.filter((r) => !r._reversal)).map((n) => [n.r.id, n.no]));
  const rows = [...d.s.rows].sort((a, b) => (nums.get(a.receipt.id) || 999) - (nums.get(b.receipt.id) || 999));
  const jobs = [...d.inc.lines].sort((a, b) => (a.statement.statement_date || '').localeCompare(b.statement.statement_date || ''));
  return html`
    <${Section} title="5. Details">
      <div class="card">
        <h3>Receipts</h3>
        <div class="table-wrap"><table>
          <${Cols} count=${false} amounts=${3} extra=${['c-no', 'c-date']} />
          <thead><tr><th>Store / description</th><th>No.</th><th>Date</th><th class="n">Net</th><th class="n">VAT</th><th class="n">Gross</th></tr></thead>
          <tbody>${rows.map((row) => {
            const r = row.receipt;
            const rate = r.currency !== cur ? conv.rate(r) : null;
            return html`<tr>
              <td><a href=${`#/r/${r._correctionOf ? r._correctionOf.id : r.id}`}>${r._reversal ? '↩︎ reversal: ' : r.corrects ? '↩︎ ' : ''}${r.store || '–'}</a>
                <small> · ${vatLabel(row.key)}${r.category ? ` · ${r.category}` : ''}${rate ? ` · ${money(row.gross_orig, r.currency)} at ${rate.rate.toFixed(4)}${rate.date ? ` (${rate.date})` : ''}` : ''}${weakProof(r) ? ` · ${DOC_TYPES[r.doc_type]}` : ''}</small></td>
              <td>${nums.get(r.id) || ''}</td><td class="nowrap">${r.receipt_date || ''}</td>
              <td class="n">${m(row.net)}</td><td class="n">${m(row.vat)}</td><td class="n">${m(row.gross)}</td></tr>`;
          })}
          ${!rows.length && html`<tr><td colspan="6" class="hint">No receipts.</td></tr>`}</tbody>
        </table></div>
      </div>
      <div class="card">
        <h3>Jobs (agency statements)</h3>
        <div class="table-wrap"><table>
          <${Cols} count=${false} amounts=${4} extra=${['c-date']} />
          <thead><tr><th>Agency · client · job</th><th>Paid</th><th class="n">Fee</th><th class="n">VAT</th><th class="n">Deductions</th><th class="n">Paid</th></tr></thead>
          <tbody>${jobs.map(({ statement: st, line: l, fee, vat, deductions, paid }) => {
            const rate = st.currency !== cur ? conv.rate(statementAsReceipt(st)) : null;
            return html`<tr>
              <td><a href=${`#/s/${st._correctionOf ? st._correctionOf.id : st.id}`}>${st._reversal ? '↩︎ reversal: ' : st.corrects ? '↩︎ ' : ''}${st.agency}</a>
                <small> · ${countryName(st.agency_country)} · ${[l.client, l.description].filter(Boolean).join(' – ')} · ${JOB_KINDS[l.kind] || ''}${l.job_date ? ` · job ${l.job_date}` : ''}${rate ? ` · ${money(lineTotal(l), st.currency)} at ${rate.rate.toFixed(4)}` : ''}</small></td>
              <td class="nowrap">${st.statement_date || ''}</td>
              <td class="n">${m(fee)}</td><td class="n">${m(vat)}</td><td class="n">${m(neg(deductions))}</td><td class="n">${m(paid)}</td></tr>`;
          })}
          ${!jobs.length && html`<tr><td colspan="6" class="hint">No statements.</td></tr>`}</tbody>
        </table></div>
      </div>
    </${Section}>`;
}
