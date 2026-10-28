// Home: where new receipts and statements are going, the year so far compared with last year, and what needs attention.
import { html, useState, useMemo } from './ui.js';
import { money, fmtNum, periodLabel, bookingPeriod, periodOf, todayISO, daysLeftLabel, yearFigures, duplicateOf, quarterLabel } from './vat.js';
import { go, Modal } from './kit.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const today = todayISO;
const longDate = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });

// € 1.2k / € 12k / € 1.2M for axis labels and the hero numbers' comparison.
const compact = (v) => {
  const a = Math.abs(v), sign = v < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}€${fmtNum(a / 1e6, 1)}M`;
  if (a >= 1e3) return `${sign}€${fmtNum(a / 1e3, a >= 1e4 ? 0 : 1)}k`;
  return `${sign}€${fmtNum(a, 0)}`;
};

// Change against last year: arrow + percentage, or "new" when there was nothing last year.
function Delta({ now, before, goodWhenUp = true }) {
  if (!before && !now) return html`<small>no data yet</small>`;
  if (!before) return html`<small>new this year</small>`;
  // A percentage against a loss (or a sign change) says nothing; show the difference instead.
  if (before < 0 || now < 0) {
    const higher = now >= before;
    return html`<small class=${`delta ${higher === goodWhenUp ? 'up-good' : 'up-bad'}`}>
      ${higher ? '▲' : '▼'} ${compact(Math.abs(now - before))} vs ${compact(before)} last year</small>`;
  }
  const pct = ((now - before) / Math.abs(before)) * 100;
  const up = pct >= 0;
  const good = up === goodWhenUp;
  return html`<small class=${`delta ${Math.abs(pct) < 0.5 ? '' : good ? 'up-good' : 'up-bad'}`}>
    ${up ? '▲' : '▼'} ${fmtNum(Math.abs(pct), 0)}% vs ${compact(before)} last year</small>`;
}

// Grouped bars per month: last year (light) and this year (strong). One measure per chart, one axis.
function MonthChart({ title, now, before, thisYear, lastMonth }) {
  const [hover, setHover] = useState(null);
  const W = 520, H = 230, padL = 52, padB = 30, padT = 12;
  const max = Math.max(1, ...now, ...before);
  const step = niceStep(max / 3);
  const top = Math.ceil(max / step) * step;
  const y = (v) => padT + (H - padT - padB) * (1 - v / top);
  const gw = (W - padL - 8) / 12;
  const bw = Math.min(14, (gw - 6) / 2);
  const bar = (x, v, cls) => {
    if (!v) return '';
    const yy = y(Math.max(0, v)), h = H - padB - yy, r = Math.min(4, h);
    // Rounded top (4px), square on the baseline.
    return html`<path class=${cls} d=${`M${x},${H - padB} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + bw - r} Q${x + bw},${yy} ${x + bw},${yy + r} V${H - padB} Z`} />`;
  };
  return html`
    <div class="card chart">
      <div class="chart-head">
        <h3>${title}</h3>
        <span class="legend"><i class="sw last"></i>${thisYear - 1}<i class="sw now"></i>${thisYear}</span>
      </div>
      <svg viewBox=${`0 0 ${W} ${H}`} role="img" aria-label=${`${title} per month, ${thisYear} compared with ${thisYear - 1}`}>
        ${[0, 1, 2, 3].map((i) => i * step).filter((v) => v <= top).map((v) => html`
          <line class="grid" x1=${padL} x2=${W - 4} y1=${y(v)} y2=${y(v)} />
          <text class="axis" x=${padL - 6} y=${y(v) + 4} text-anchor="end">${compact(v)}</text>`)}
        ${MONTHS.map((mLabel, i) => {
          const x0 = padL + i * gw + (gw - (bw * 2 + 2)) / 2;
          return html`
            <g class=${hover === i ? 'month on' : 'month'} onMouseEnter=${() => setHover(i)} onMouseLeave=${() => setHover(null)} onClick=${() => setHover(i)}>
              <rect class="hit" x=${padL + i * gw} y=${padT} width=${gw} height=${H - padT} />
              ${bar(x0, before[i], 'b-last')}
              ${i <= lastMonth && bar(x0 + bw + 2, now[i], 'b-now')}
              <text class="axis" x=${padL + i * gw + gw / 2} y=${H - 9} text-anchor="middle">${mLabel}</text>
            </g>`;
        })}
      </svg>
      ${hover !== null && html`<div class="tip">${MONTHS[hover]}: <strong>${money(hover <= lastMonth ? now[hover] : 0)}</strong> in ${thisYear} · ${money(before[hover])} in ${thisYear - 1}</div>`}
      <details class="table-view"><summary>Show as table</summary>
        <table><colgroup><col /><col class="c-num" /><col class="c-num" /></colgroup>
          <thead><tr><th>Month</th><th class="n">${thisYear - 1}</th><th class="n">${thisYear}</th></tr></thead>
          <tbody>${MONTHS.map((mLabel, i) => html`<tr><td>${mLabel}</td><td class="n">${money(before[i])}</td><td class="n">${i <= lastMonth ? money(now[i]) : '–'}</td></tr>`)}</tbody>
        </table>
      </details>
    </div>`;
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(Math.max(raw, 1)));
  return [1, 2, 2.5, 5, 10].map((f) => f * p).find((s) => s >= raw) || p * 10;
}

export function HomePage({ ctx }) {
  const d = today();
  const year = Number(d.slice(0, 4));
  const until = d.slice(5);
  const lastMonth = Number(d.slice(5, 7)) - 1;
  const now = useMemo(() => yearFigures(ctx.receipts, ctx.statements, year, until), [ctx.receipts, ctx.statements]);
  const before = useMemo(() => yearFigures(ctx.receipts, ctx.statements, year - 1, until), [ctx.receipts, ctx.statements]);
  const beforeFull = useMemo(() => yearFigures(ctx.receipts, ctx.statements, year - 1), [ctx.receipts, ctx.statements]);

  const current = bookingPeriod(d, ctx.filed);
  const [cy, cq] = [Number(current.slice(0, 4)), Number(current.slice(6))];
  const dl = ctx.deadline; // set only while a quarter's VAT return is due and not yet filed
  const inCurrent = { r: ctx.receipts.filter((x) => x.period === current).length, s: ctx.statements.filter((x) => x.period === current).length };

  const todo = [
    [ctx.receipts.filter((r) => r.status !== 'done').length, 'receipts to check', 'expenses'],
    [ctx.statements.filter((s) => s.status !== 'done').length, 'statements to check', 'income'],
    [ctx.statements.filter((s) => !s.booking_date && s.status !== 'processing').length, 'statements without import date', 'income'],
    [ctx.statements.filter((s) => duplicateOf(s, ctx.statements)).length, 'possible duplicate statements', 'income'],
  ].filter(([n]) => n > 0);

  const t = now.totals, b = before.totals;
  return html`
    <div class="page-head">
      <div><p class="kicker">VH5 · ${new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p><h1>Home</h1></div>
    </div>

    <section class="card now-card">
      <div>
        <p class="kicker">Now adding to</p>
        <p class="now-period">${quarterLabel(cy, cq)}</p>
        <p class="hint">New receipts and statements dated today go into this quarter. So far: ${inCurrent.r} receipt${inCurrent.r === 1 ? '' : 's'}, ${inCurrent.s} statement${inCurrent.s === 1 ? '' : 's'}.
          ${current !== periodOf(d) ? ` (${periodLabel(periodOf(d))} is already filed.)` : ''}</p>
      </div>
      ${ctx.mine && html`<div class="actions">
        <button class="primary" onClick=${() => go('expenses')}>Add receipts</button>
        <button onClick=${() => go('income')}>Import statement</button>
        <button onClick=${() => go(`overview/${cy}-${cq}`)}>Overview ${periodLabel(current)}</button>
      </div>`}
    </section>

    ${dl && html`
      <a class=${`open-quarter${dl.daysLeft === 0 ? ' today' : dl.urgent ? ' soon' : ''}`} href=${`#/overview/${dl.period.slice(0, 4)}-${dl.period.slice(6)}`}>
        <span class="oq-icon" aria-hidden="true">${dl.urgent ? '!' : '◷'}</span>
        <span class="oq-text"><strong>${periodLabel(dl.period)} is still open · ${daysLeftLabel(dl.daysLeft)}</strong>
          <small>The VAT return is due by ${longDate(dl.due)}. Check it and file it with the CPA when it’s ready.</small></span>
        <span class="oq-go">Review ${periodLabel(dl.period)} ›</span>
      </a>`}

    <div class="section-title"><h2>${year} so far</h2><small>1 Jan – ${new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}, compared with the same period in ${year - 1} · EUR</small></div>
    <div class="tiles four">
      <div class="tile"><p class="kicker">Income (fees)</p><div class="big-num">${money(t.income)}</div><${Delta} now=${t.income} before=${b.income} /></div>
      <div class="tile"><p class="kicker">Expenses (incl. VAT)</p><div class="big-num">${money(t.expenses)}</div><${Delta} now=${t.expenses} before=${b.expenses} goodWhenUp=${false} /></div>
      <div class="tile"><p class="kicker">Result before tax</p><div class="big-num">${money(t.result)}</div><${Delta} now=${t.result} before=${b.result} /></div>
      <div class="tile"><p class="kicker">${t.vatDue >= 0 ? 'Dutch VAT to pay' : 'Dutch VAT to get back'}</p><div class="big-num">${money(Math.abs(t.vatDue))}</div><small>${t.receipts} receipts · ${t.statements} statements</small></div>
    </div>
    <p class="hint">Result = fees − agency deductions − costs (Dutch VAT on receipts comes back, so it is not a cost). Indicative, before income tax.</p>

    <div class="split">
      <${MonthChart} title="Income per month" now=${now.months.income} before=${beforeFull.months.income} thisYear=${year} lastMonth=${lastMonth} />
      <${MonthChart} title="Expenses per month" now=${now.months.expenses} before=${beforeFull.months.expenses} thisYear=${year} lastMonth=${lastMonth} />
    </div>

    <div class="section-title"><h2>Needs attention</h2></div>
    ${todo.length ? html`<div class="card flush">${todo.map(([n, label, href]) => html`
      <a class="row" href=${`#/${href}`}><span class="what"><strong>${n} ${label}</strong></span><span class="badge st-review">Open</span></a>`)}</div>`
      : html`<div class="card"><p class="hint">Nothing waiting. Everything is checked.</p></div>`}`;
}

// Shown once a day per device, on opening the app in the last two days before a VAT return is due.
export function DueDialog({ dl, onClose }) {
  const q = periodLabel(dl.period);
  return html`
    <${Modal} onClose=${onClose} className="due-dialog">
      <p class="kicker">${daysLeftLabel(dl.daysLeft)}</p>
      <h2>${q} VAT return ${dl.daysLeft === 0 ? 'is due today' : 'is due tomorrow'}</h2>
      <p>${q} is not marked as filed yet. Check it and send it to the CPA ${dl.daysLeft === 0 ? 'today' : `before the end of ${longDate(dl.due)}`}, then mark it as filed in the overview.</p>
      <div class="actions">
        <button class="primary" onClick=${() => { onClose(); go(`overview/${dl.period.slice(0, 4)}-${dl.period.slice(6)}`); }}>Review ${q}</button>
        <button onClick=${onClose}>${dl.daysLeft === 0 ? 'Later' : 'Remind me tomorrow'}</button>
      </div>
    </${Modal}>`;
}
