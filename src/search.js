// Spotlight-style search (⌘K): receipts, statements, agencies, clients, quarters and pages in one list.
import { html, useState, useEffect, useRef, useMemo } from './ui.js';
import { money, fmtDate, fmtNum, countryName, agencyOverview, periodLabel, isNum } from './vat.js';
import { go, Modal } from './kit.js';

const norm = (v) => String(v ?? '').toLowerCase();

function build(ctx) {
  const items = [];
  for (const r of ctx.receipts) {
    items.push({ kind: 'Expenses', ico: '🧾', title: r.store || r.description || 'Receipt',
      sub: [fmtDate(r.receipt_date), r.category, r.vat_country && countryName(r.vat_country)].filter(Boolean).join(' · '),
      amount: money(r.total, r.currency || 'EUR'), href: `r/${r.id}`,
      text: [r.store, r.description, r.category, r.store_address, r.notes, r.receipt_date, r.period, countryName(r.vat_country), r.total, isNum(r.total) && fmtNum(r.total)].map(norm).join(' ') });
  }
  for (const st of ctx.statements) {
    items.push({ kind: 'Income', ico: '💶', title: st.agency || 'Statement',
      sub: [st.statement_date && `paid ${fmtDate(st.statement_date)}`, (st.lines || []).map((l) => l.client).filter(Boolean).join(', ')].filter(Boolean).join(' · '),
      amount: money(st.total_paid, st.currency || 'EUR'), href: `s/${st.id}`,
      text: [st.agency, st.statement_no, st.statement_date, st.booking_date, st.period, countryName(st.agency_country), st.total_paid, isNum(st.total_paid) && fmtNum(st.total_paid),
        ...(st.lines || []).flatMap((l) => [l.client, l.description, l.invoice_no, l.job_date])].map(norm).join(' ') });
  }
  for (const a of agencyOverview(ctx.statements)) {
    items.push({ kind: 'Agencies', ico: '🏢', title: a.name, sub: `${countryName(a.country)} · ${a.statements} statements`, amount: money(a.fee),
      href: 'income', pick: () => localStorage.setItem('agency', a.key), text: norm(`${a.name} ${countryName(a.country)}`) });
    for (const c of a.clients) {
      items.push({ kind: 'Clients', ico: '👤', title: c.name, sub: `via ${a.name} · ${c.jobs} job${c.jobs > 1 ? 's' : ''}`, amount: money(c.fee),
        href: 'income', pick: () => localStorage.setItem('agency', a.key), text: norm(`${c.name} ${a.name}`) });
    }
  }
  const periods = [...new Set([...ctx.receipts, ...ctx.statements].map((x) => x.period).filter(Boolean))].sort().reverse();
  for (const p of periods) {
    items.push({ kind: 'Overview', ico: '📊', title: `Overview ${periodLabel(p)}`, sub: ctx.filed.has(p) ? '🔒 Filed with the CPA' : 'Open',
      href: `overview/${p.slice(0, 4)}-${p.slice(6)}`, text: norm(`overview quarter ${periodLabel(p)} ${p}`) });
  }
  for (const [title, href] of [['Expenses', 'expenses'], ['Income', 'income'], ['Overview', 'overview'], ['Settings', 'settings']]) {
    items.push({ kind: 'Go to', ico: '→', title, sub: '', href, text: norm(title) });
  }
  return items;
}

export function Spotlight({ ctx, onClose }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef();
  const all = useMemo(() => build(ctx), [ctx.receipts, ctx.statements, ctx.filed]);
  const words = norm(q).replace(/,/g, '').split(/\s+/).filter(Boolean);
  const hits = (words.length ? all.filter((it) => words.every((w) => it.text.replace(/,/g, '').includes(w))) : all.filter((it) => it.kind === 'Go to' || it.kind === 'Overview')).slice(0, 40);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => setSel(0), [q]);
  const open = (it) => { it.pick?.(); onClose(); go(it.href); };
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && hits[sel]) open(hits[sel]);
  };
  let last = '';
  return html`
    <${Modal} onClose=${onClose} className="spotlight">
      <input ref=${input} type="search" placeholder="Search receipts, statements, clients, amounts…" value=${q} onInput=${(e) => setQ(e.target.value)} onKeyDown=${onKey} />
      <div class="results">
        ${hits.map((it, i) => {
          const head = it.kind !== last ? html`<p class="kicker">${it.kind}</p>` : '';
          last = it.kind;
          return html`${head}
            <a class=${`result${i === sel ? ' on' : ''}`} onMouseEnter=${() => setSel(i)} onClick=${() => open(it)}>
              <span class="ico">${it.ico}</span>
              <span class="what"><strong>${it.title}</strong>${it.sub && html`<small>${it.sub}</small>`}</span>
              ${it.amount && html`<span class="amount">${it.amount}</span>`}
            </a>`;
        })}
        ${!hits.length && html`<p class="hint" style="padding:12px 18px">Nothing found.</p>`}
      </div>
    </${Modal}>`;
}
