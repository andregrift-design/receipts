// Income: import agency statements (with an import date), agencies and clients, and the statement screen.
import { html, useState, useEffect, useRef, useMemo } from './ui.js';
import * as api from './api.js';
import {
  CURRENCIES, COUNTRIES, HOME_COUNTRY, JOB_KINDS, money, fmtDate, isNum, round2, countryName, parseNum, fxFor,
  lineTotal, statementAsReceipt, statementProblems, agencyOverview, periodLabel, bookingPeriod, periodOf, duplicateOf, vatOff, followVat, fmtNum,
} from './vat.js';
import { go, Badge, PeriodBadges, Preview, NumInput, toField, Modal, Cols } from './kit.js';
import { QueuedRow } from './expenses.js';

const today = () => new Date().toISOString().slice(0, 10);

// ---------- import date (asked at import) ----------

// Asked right after choosing statements: the date that decides which quarter the income counts in.
export function BookingDialog({ files, filed, onImport, onCancel }) {
  const [date, setDate] = useState(today());
  const p = bookingPeriod(date, filed);
  return html`
    <${Modal} onClose=${onCancel}>
      <p class="kicker">Import ${files.length} statement${files.length > 1 ? 's' : ''}</p>
      <h2>Import date</h2>
      <p class="hint">This date decides which quarter the income counts in. Today is suggested; you can change it later per statement.</p>
      <label>Import date<input type="date" value=${date} onInput=${(e) => setDate(e.target.value)} /></label>
      <p class="hint">${p ? html`Counts in <strong>${periodLabel(p)}</strong>${p !== periodOf(date) ? ` (${periodLabel(periodOf(date))} is already filed with the CPA)` : ''}.` : 'Choose a date.'}</p>
      <div class="actions">
        <button class="primary" disabled=${!date} onClick=${() => onImport(date)}>Import</button>
        <button onClick=${onCancel}>Cancel</button>
      </div>
    </${Modal}>`;
}

// ---------- income page ----------

export function IncomePage({ ctx }) {
  const { statements, mine, queue, filed } = ctx;
  const input = useRef();
  const agencies = useMemo(() => agencyOverview(statements.filter((st) => !st.corrects)), [statements]);
  const [sel, setSel] = useState(localStorage.getItem('agency') || '');
  const choose = (k) => { setSel(k); localStorage.setItem('agency', k); };
  const agency = agencies.find((a) => a.key === sel);
  const shown = agency ? statements.filter((st) => (st.agency || '').trim().toLowerCase() === agency.key) : statements;

  const groups = new Map();
  for (const st of shown) {
    const key = st.period || (st.status === 'processing' ? 'new' : 'nodate');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(st);
  }
  const order = (k) => (k === 'new' ? '9999' : k === 'nodate' ? '9998' : k);
  const keys = [...groups.keys()].sort((a, b) => order(b).localeCompare(order(a)));
  const title = (k) => (k === 'new' ? 'Just added' : k === 'nodate' ? 'No import date yet' : periodLabel(k));
  const eur = (st) => (isNum(st.total_paid) && fxFor(statementAsReceipt(st)) != null ? st.total_paid * fxFor(statementAsReceipt(st)) : 0);

  return html`
    <div class="page-head">
      <div><p class="kicker">Agency statements</p><h1>Income</h1></div>
    </div>
    ${mine && html`
      <div class="actions">
        <button class="primary big" onClick=${() => input.current.click()}>Import agency statement</button>
        <input ref=${input} type="file" accept="application/pdf,image/*" multiple hidden onChange=${(e) => { ctx.importStatements([...e.target.files]); e.target.value = ''; }} />
      </div>
      <p class="hint">PDF or photo of a payment statement, from any country or currency. Claude reads the agency, jobs, fees, VAT and deductions; you set the import date and check the result.</p>`}

    ${agencies.length > 0 && html`
      <div class="section-title"><h2>Agencies</h2><small>Pick one to see its clients and statements</small></div>
      <label class="picker" aria-label="Agency">
        <select value=${agency ? agency.key : ''} onChange=${(e) => choose(e.target.value)}>
          <option value="">All agencies (${agencies.length} agencies, ${statements.length} statement${statements.length === 1 ? '' : 's'})</option>
          ${agencies.map((a) => html`<option value=${a.key}>${a.name} · ${countryName(a.country)} · ${a.statements} statement${a.statements === 1 ? '' : 's'}</option>`)}
        </select>
      </label>
      <${ClientsCard} agencies=${agency ? [agency] : agencies} single=${!!agency} />`}

    ${queue.length > 0 && html`
      <section class="card flush">
        ${queue.map((i) => html`<${QueuedRow} item=${i} label="Statement" onRemove=${ctx.removeQueued} />`)}
        ${api.lastUploadError && html`<p class="hint bad" style="padding:0 18px">Upload problem: ${api.lastUploadError}</p>`}
      </section>`}
    ${!statements.length && !queue.length && html`<div class="empty"><p>No agency statements yet</p></div>`}
    ${keys.map((k) => html`
      <section>
        <h2 class="group-title">${title(k)} ${filed.has(k) ? html`<span class="badge st-lock">🔒 Filed</span>` : ''}
          <small>${groups.get(k).length} · ${money(groups.get(k).reduce((s, st) => s + eur(st), 0))}</small></h2>
        <div class="card flush">${groups.get(k).map((st) => html`<${StatementRow} st=${st} ctx=${ctx} />`)}</div>
      </section>`)}`;
}

function StatementRow({ st, ctx }) {
  const dup = duplicateOf(st, ctx.statements);
  return html`
    <a class="row" href=${`#/s/${st.id}`}>
      <span class="what">
        <strong>${st.agency || (st.status === 'processing' ? 'Reading statement…' : 'Unknown agency')}</strong>
        <small>${[st.statement_date && `paid ${fmtDate(st.statement_date)}`, st.agency_country && countryName(st.agency_country),
          (st.lines || []).map((l) => l.client).filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</small>
      </span>
      <span class="badges">
        <${PeriodBadges} rec=${st} filed=${ctx.filed} all=${ctx.statements} />
        ${dup && html`<span class="badge st-bad">Possible duplicate</span>`}
        ${!st.booking_date && st.status !== 'processing' && html`<span class="badge st-review">No import date</span>`}
        ${st.status !== 'done' && html`<${Badge} status=${st.status} />`}
      </span>
      <span class="amount">${money(st.total_paid, st.currency || 'EUR')}
        ${st.currency && st.currency !== 'EUR' && isNum(st.total_paid) && isNum(st.fx_rate) && html`<small>${money(st.total_paid * st.fx_rate)}</small>`}</span>
    </a>`;
}

// Clients worked for, per agency. Same columns for every agency, so the tables line up.
function ClientsCard({ agencies, single }) {
  return html`
    <section class="card">
      ${agencies.map((a, i) => html`
        <div style=${i ? 'margin-top:16px' : ''}>
          <h3>${a.name} <small>${[countryName(a.country), single && a.address, `${a.statements} statement${a.statements > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}</small></h3>
          <table>
            <${Cols} amounts=${1} extra=${['c-date']} />
            <thead><tr><th>Client</th><th>Last job</th><th class="n">Jobs</th><th class="n">Fees</th></tr></thead>
            <tbody>${a.clients.map((c) => html`<tr><td>${c.name}${c.kinds.length ? html` <small>${c.kinds.join(', ')}</small>` : ''}</td><td class="nowrap">${c.last ? fmtDate(c.last) : '–'}</td><td class="n">${c.jobs}</td><td class="n">${money(c.fee)}</td></tr>`)}</tbody>
            <tfoot><tr><td colspan="2">Total</td><td class="n">${a.clients.reduce((s, c) => s + c.jobs, 0)}</td><td class="n">${money(a.fee)}</td></tr></tfoot>
          </table>
        </div>`)}
      <p class="hint">Fees in EUR, before deductions.</p>
    </section>`;
}

// ---------- statement screen ----------

// Deductions always shown as fixed fields, one per type.
const DED = ['agency_fee', 'website', 'transport', 'tax_withheld', 'other'];
const emptyDed = () => Object.fromEntries(DED.map((t) => [t, { amount: '', vat: '', label: '', reverse_charge: false }]));
const emptyLine = () => ({ job_date: '', client: '', description: '', invoice_no: '', kind: 'day_rate', fee: '', vat_rate: '0', vat: '', expenses: '', ded: emptyDed(), receipt_ids: [] });

function stToForm(st) {
  return {
    ...st,
    total_paid: toField(st.total_paid),
    fx_rate: st.currency === 'EUR' ? '' : toField(st.fx_rate, 6),
    lines: (st.lines || []).map((l) => {
      const ded = emptyDed();
      for (const d of l.deductions || []) {
        const t = DED.includes(d.type) ? d.type : 'other';
        const e = ded[t];
        e.amount = toField((parseNum(e.amount) || 0) + (Number(d.amount) || 0));
        e.vat = toField((parseNum(e.vat) || 0) + (Number(d.vat) || 0));
        e.label = [e.label, d.label].filter(Boolean).join(', ');
        e.reverse_charge = e.reverse_charge || !!d.reverse_charge;
      }
      return { ...l, job_date: l.job_date || '', fee: toField(l.fee), vat_rate: String(l.vat_rate ?? 0), vat: toField(l.vat ?? 0),
        expenses: toField(l.expenses ?? 0), ded, receipt_ids: l.receipt_ids || [] };
    }),
  };
}

function stFromForm(f) {
  return {
    ...f,
    total_paid: parseNum(f.total_paid),
    fx_rate: f.currency === 'EUR' ? 1 : parseNum(f.fx_rate),
    lines: f.lines.map(({ ded, ...l }) => ({
      ...l, fee: parseNum(l.fee), vat_rate: parseNum(l.vat_rate) ?? 0, vat: parseNum(l.vat) ?? 0, expenses: parseNum(l.expenses) ?? 0,
      deductions: DED.filter((t) => parseNum(ded[t].amount) || parseNum(ded[t].vat)).map((t) => ({
        type: t, label: ded[t].label || null, amount: parseNum(ded[t].amount) || 0, vat: parseNum(ded[t].vat) || 0,
        reverse_charge: t === 'agency_fee' ? !!ded[t].reverse_charge : false })),
    })),
  };
}

export function StatementEditor({ statement, ctx }) {
  const locked = !!statement.period && ctx.filed.has(statement.period);
  const readOnly = !ctx.mine || locked;
  const original = statement.corrects ? ctx.statements.find((x) => x.id === statement.corrects) : null;
  const dup = duplicateOf(statement, ctx.statements);
  const [form, setForm] = useState(() => stToForm(statement));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [picking, setPicking] = useState(null); // job index for the receipt picker
  const fxTouched = useRef(false);
  useEffect(() => { if (!dirty) setForm(stToForm(statement)); }, [statement.updated_at]);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); setMsg(''); };
  const setLine = (i, patch) => set({ lines: form.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const setDed = (i, t, patch) => setLine(i, { ded: { ...form.lines[i].ded, [t]: { ...form.lines[i].ded[t], ...patch } } });

  useEffect(() => {
    if (readOnly || !dirty || form.currency === 'EUR' || fxTouched.current || !form.statement_date) return;
    api.ecbRate(form.currency, form.statement_date).then((r) => r && setForm((f) => ({ ...f, fx_rate: toField(r.rate, 6), fx_date: r.date }))).catch(() => {});
  }, [form.currency, form.statement_date]);

  // Pick lists from earlier statements.
  const agencies = useMemo(() => agencyOverview(ctx.statements), [ctx.statements]);
  const current = agencies.find((a) => a.key === (form.agency || '').trim().toLowerCase());
  const clients = [...new Set([...(current?.clients || []), ...agencies.flatMap((a) => a.clients)].map((c) => c.name))];
  const pickAgency = (name) => {
    const a = agencies.find((x) => x.key === name.trim().toLowerCase());
    set(a ? { agency: a.name, agency_country: a.country || form.agency_country, agency_address: a.address || form.agency_address } : { agency: name });
  };

  const value = stFromForm(form);
  const todo = statementProblems(value);
  const sum = round2(value.lines.reduce((t, l) => t + lineTotal(l), 0));
  const fx = fxFor(statementAsReceipt(value));
  const foreign = form.agency_country !== HOME_COUNTRY;
  // Its own quarter while the import date is unchanged; otherwise where it would go now.
  const willCount = form.booking_date === statement.booking_date && statement.period ? statement.period : bookingPeriod(form.booking_date, ctx.filed);

  const save = async () => {
    setBusy('save');
    try {
      const saved = await api.saveStatement(value);
      setDirty(false);
      setForm(stToForm(saved));
      const left = statementProblems(saved);
      if (!left.length) go('income');
      else setMsg('Saved. Still to do: ' + left.join(', ') + '.');
    } catch (e) { setMsg(e.message); } finally { setBusy(''); }
  };
  const again = async () => {
    if (dirty && !confirm('Discard your changes and read the statement again?')) return;
    setBusy('read'); setDirty(false); fxTouched.current = false;
    try { setForm(stToForm(await api.readAgain(statement.id, 'statement'))); } catch (e) { setMsg(e.message); } finally { setBusy(''); }
  };
  const remove = async () => {
    if (!confirm(dup ? 'Delete this duplicate statement?' : 'Delete this statement and its document?')) return;
    setBusy('delete');
    try { await api.deleteStatement(statement); go('income'); } catch (e) { setMsg(e.message); setBusy(''); }
  };
  const correct = async () => {
    try { const c = await api.createCorrection('statements', statement); go(`s/${c.id}`); } catch (e) { alert(e.message); }
  };
  const vatFill = (i) => {
    const l = value.lines[i];
    if (isNum(l.fee) && isNum(l.vat_rate)) setLine(i, { vat: toField(round2(l.fee * l.vat_rate / 100)) });
  };
  // Linking receipts is allowed once the statement is done (and its quarter is open).
  const linkReceipts = async (i, ids) => {
    const lines = form.lines.map((l, j) => (j === i ? { ...l, receipt_ids: ids } : l));
    setForm((f) => ({ ...f, lines }));
    try { await api.saveStatement(stFromForm({ ...form, lines })); } catch (e) { setMsg(e.message); }
    setPicking(null);
  };
  const receiptById = (id) => ctx.receipts.find((r) => r.id === id);

  return html`
    <div class="editor-head">
      <a href="#/income" class="back">‹ Income</a>
      <span class="badges"><${PeriodBadges} rec=${statement} filed=${ctx.filed} all=${ctx.statements} /><${Badge} status=${statement.status} /></span>
    </div>
    <div class="editor-body wide">
      <${Preview} r=${original && !statement.file_path ? original : statement} label="statement" />
      <form class="card form" onSubmit=${(e) => { e.preventDefault(); save(); }}>
        ${locked && html`<div class="note lock">🔒 ${periodLabel(statement.period)} has been filed with the CPA. This statement can’t be changed.
          ${ctx.mine && html`<button type="button" onClick=${correct}>Make a correction</button>`}</div>`}
        ${original && html`<div class="note info">↩︎ Correction of the statement booked in ${periodLabel(original.period)}. Enter the right values; the overview books the difference.</div>`}
        ${dup && html`<div class="note bad">Possible duplicate: the same statement was imported on ${fmtDate(dup.created_at.slice(0, 10))}. <a href=${`#/s/${dup.id}`}>Open it</a>${!readOnly ? ' or delete this one below.' : '.'}</div>`}
        ${statement.status === 'processing' && html`<div class="note info">Claude is reading this statement. The fields fill in by themselves in a few seconds.</div>`}
        ${statement.error && html`<div class="note bad">Reading failed: ${statement.error}</div>`}
        ${statement.issues?.length > 0 && !locked && html`<div class="note"><strong>Check:</strong><ul>${statement.issues.map((i) => html`<li>${i}</li>`)}</ul></div>`}

        <fieldset disabled=${readOnly}>
          <div class="grid g-addr">
            <label>Agency<input list="agency-list" value=${form.agency || ''} placeholder="Choose or type" onInput=${(e) => pickAgency(e.target.value)} /></label>
            <label>Country
              <select value=${form.agency_country} onChange=${(e) => set({ agency_country: e.target.value })}>
                ${[...new Set([...Object.keys(COUNTRIES), form.agency_country])].map((k) => html`<option value=${k}>${countryName(k)}</option>`)}
              </select>
            </label>
          </div>
          <datalist id="agency-list">${agencies.map((a) => html`<option value=${a.name}>${countryName(a.country)}</option>`)}</datalist>
          <datalist id="client-list">${clients.map((c) => html`<option value=${c} />`)}</datalist>
          <div class="grid g-addr">
            <label>Address<input value=${form.agency_address || ''} onInput=${(e) => set({ agency_address: e.target.value })} /></label>
            <label>Statement no.<input value=${form.statement_no || ''} onInput=${(e) => set({ statement_no: e.target.value })} /></label>
          </div>
          <div class="grid g3">
            <label>Payment date<input type="date" value=${form.statement_date || ''} onInput=${(e) => set({ statement_date: e.target.value })} /></label>
            <label>Import date<input type="date" value=${form.booking_date || ''} onInput=${(e) => set({ booking_date: e.target.value })} /></label>
            <label>Counts in<input disabled value=${willCount ? `${periodLabel(willCount)}${willCount !== periodOf(form.booking_date) ? ' (late)' : ''}` : 'Set an import date'} /></label>
          </div>
          <div class="grid g4">
            <label>Currency
              <select value=${form.currency} onChange=${(e) => { fxTouched.current = false; set({ currency: e.target.value }); }}>
                ${[...new Set([...CURRENCIES, form.currency])].map((c) => html`<option value=${c}>${c}</option>`)}
              </select>
            </label>
            <label>Exchange rate${form.currency !== 'EUR' ? ` (EUR per ${form.currency})` : ''}
              <${NumInput} label="Exchange rate" decimals=${6} disabled=${form.currency === 'EUR'} value=${form.currency === 'EUR' ? '1.000000' : form.fx_rate}
                onInput=${(v) => { fxTouched.current = true; set({ fx_rate: v, fx_date: null }); }} />
            </label>
            <label>Rate date<input disabled value=${form.currency === 'EUR' ? '–' : form.fx_date ? fmtDate(form.fx_date) : 'by hand'} /></label>
            <label>Amount paid<${NumInput} label="Amount paid" value=${form.total_paid} onInput=${(v) => set({ total_paid: v })} /></label>
          </div>
          ${foreign && html`<p class="hint">Foreign agency: usually no Dutch VAT on your fee. An agency fee charged without VAT is reverse-charged: Dutch VAT on it is due and deductible at the same time.</p>`}

          ${form.lines.map((l, i) => html`
            <div class="job">
              <div class="job-head"><h3>Job ${i + 1}</h3>
                ${!readOnly && html`<button type="button" class="link danger" onClick=${() => set({ lines: form.lines.filter((_, j) => j !== i) })}>Remove job</button>`}</div>
              <div class="grid g2">
                <label>Client<input list="client-list" value=${l.client || ''} placeholder="Choose or type" onInput=${(e) => setLine(i, { client: e.target.value })} /></label>
                <label>Job date<input type="date" value=${l.job_date || ''} onInput=${(e) => setLine(i, { job_date: e.target.value })} /></label>
              </div>
              <div class="grid g2">
                <label>Type
                  <select value=${l.kind || 'other'} onChange=${(e) => setLine(i, { kind: e.target.value })}>
                    ${Object.entries(JOB_KINDS).map(([k, v]) => html`<option value=${k}>${v}</option>`)}
                  </select>
                </label>
                <label>Invoice no.<input value=${l.invoice_no || ''} onInput=${(e) => setLine(i, { invoice_no: e.target.value })} /></label>
              </div>
              <label>Job<input value=${l.description || ''} onInput=${(e) => setLine(i, { description: e.target.value })} /></label>

              <p class="subhead">Fee</p>
              <div class="grid g4">
                <label>Fee<${NumInput} label="Fee" value=${l.fee} onInput=${(v) => { const o = value.lines[i]; const vat = followVat(o.fee, o.vat, parseNum(v), o.vat_rate); setLine(i, { fee: v, ...(vat !== undefined ? { vat: toField(vat) } : {}) }); }} /></label>
                <label>VAT %<${NumInput} label="VAT %" decimals=${0} value=${l.vat_rate} onInput=${(v) => setLine(i, { vat_rate: v })} onBlur=${() => vatFill(i)} /></label>
                <label>VAT<${NumInput} label="VAT" value=${l.vat} onInput=${(v) => setLine(i, { vat: v })} /></label>
                <label>Expenses paid back<${NumInput} label="Expenses" value=${l.expenses} onInput=${(v) => setLine(i, { expenses: v })} /></label>
              </div>
              ${(() => {
                const v = value.lines[i];
                const e = v ? vatOff(v.fee, v.vat_rate ?? 0, v.vat ?? 0) : null;
                return e === null ? '' : html`<div class="vat-warn">${fmtNum(v.vat_rate ?? 0, 0)}% of ${money(v.fee, form.currency)} is <strong>${money(e, form.currency)}</strong>, not ${money(v.vat, form.currency)}.
                  ${!readOnly && html`<button type="button" class="link" onClick=${() => setLine(i, { vat: toField(e) })}>Use ${money(e, form.currency)}</button>`}
                  <small>If the statement really shows this VAT, check the VAT %.</small></div>`;
              })()}

              <p class="subhead">Deductions</p>
              <div class="grid g3">
                <label>Agency fee<${NumInput} label="Agency fee" value=${l.ded.agency_fee.amount} onInput=${(v) => setDed(i, 'agency_fee', { amount: v })} /></label>
                <label>VAT on agency fee<${NumInput} label="VAT on agency fee" value=${l.ded.agency_fee.vat} onInput=${(v) => setDed(i, 'agency_fee', { vat: v })} /></label>
                <label>Tax withheld<${NumInput} label="Tax withheld" value=${l.ded.tax_withheld.amount} onInput=${(v) => setDed(i, 'tax_withheld', { amount: v })} /></label>
                <label>Website<${NumInput} label="Website" value=${l.ded.website.amount} onInput=${(v) => setDed(i, 'website', { amount: v })} /></label>
                <label>Transport (Uber, taxi)<${NumInput} label="Transport" value=${l.ded.transport.amount} onInput=${(v) => setDed(i, 'transport', { amount: v })} /></label>
                <label>Other<${NumInput} label="Other deduction" value=${l.ded.other.amount} onInput=${(v) => setDed(i, 'other', { amount: v })} /></label>
              </div>
              <label class="check"><input type="checkbox" disabled=${!foreign} checked=${foreign && l.ded.agency_fee.reverse_charge}
                onChange=${(e) => setDed(i, 'agency_fee', { reverse_charge: e.target.checked })} />
                Agency fee is reverse-charged ${!foreign ? html`<small>(only for foreign agencies)</small>` : ''}</label>

              <div class="sumline"><span>Paid for this job</span><strong>${money(lineTotal(value.lines[i]), form.currency)}</strong></div>

              ${statement.status === 'done' && html`
                <p class="subhead">Receipts for this job</p>
                ${(l.receipt_ids || []).length ? html`<ul class="linked">${l.receipt_ids.map((id) => {
                  const r = receiptById(id);
                  return html`<li><a href=${`#/r/${id}`}>${r ? `${r.store || r.description || 'Receipt'} · ${fmtDate(r.receipt_date)}` : 'Receipt (deleted)'}</a>
                    <span>${r ? money(r.total, r.currency || 'EUR') : ''}</span></li>`;
                })}</ul>` : html`<p class="hint">None yet.</p>`}
                ${!readOnly && html`<button type="button" class="link" onClick=${() => setPicking(i)}>Attach receipts</button>`}`}
            </div>`)}
          ${!readOnly && html`<button type="button" class="link" onClick=${() => set({ lines: [...form.lines, emptyLine()] })}>+ Add job</button>`}

          <div class="sumline"><span>Jobs add up to</span>
            <strong class=${isNum(value.total_paid) && Math.abs(sum - value.total_paid) > 0.02 * Math.max(1, form.lines.length) ? 'bad-text' : ''}>${money(sum, form.currency)}</strong></div>
          ${fx != null && form.currency !== 'EUR' && html`<div class="sumline"><span>Amount paid in EUR</span><strong>${money((value.total_paid || 0) * fx)}</strong></div>`}
          <div class="form-section"><label>Notes<textarea rows="2" value=${form.notes || ''} onInput=${(e) => set({ notes: e.target.value })}></textarea></label></div>
        </fieldset>
        ${!readOnly && html`
          <div class=${todo.length ? 'note' : 'note good'}>${todo.length ? `To fix: ${todo.join(', ')}.` : 'Complete.'}</div>
          ${msg && html`<p class="msg">${msg}</p>`}
          <div class="actions">
            <button class="primary" disabled=${!!busy}>${busy === 'save' ? 'Saving…' : todo.length ? 'Save' : 'Save as done'}</button>
            ${statement.file_path && html`<button type="button" disabled=${!!busy} onClick=${again}>${busy === 'read' ? 'Reading…' : 'Read again'}</button>`}
            <button type="button" class="danger" disabled=${!!busy} onClick=${remove}>Delete</button>
          </div>`}
      </form>
    </div>
    ${picking !== null && html`<${ReceiptPicker} receipts=${ctx.receipts} selected=${form.lines[picking].receipt_ids || []}
      onDone=${(ids) => linkReceipts(picking, ids)} onCancel=${() => setPicking(null)} />`}`;
}

// Choose stored receipts to attach to a job (for the overview only; amounts are not changed).
function ReceiptPicker({ receipts, selected, onDone, onCancel }) {
  const [ids, setIds] = useState(new Set(selected));
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const list = receipts.filter((r) => r.status === 'done' && !r.corrects && (!needle
    || [r.store, r.description, r.category, r.receipt_date].some((v) => (v || '').toLowerCase().includes(needle))));
  const toggle = (id) => { const n = new Set(ids); n.has(id) ? n.delete(id) : n.add(id); setIds(n); };
  return html`
    <${Modal} onClose=${onCancel} className="picker">
      <h2>Attach receipts</h2>
      <input type="search" placeholder="Search receipts" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <div class="results">
        ${list.map((r) => html`
          <label class="row check" key=${r.id}>
            <input type="checkbox" checked=${ids.has(r.id)} onChange=${() => toggle(r.id)} />
            <span class="what"><strong>${r.store || r.description}</strong><small>${fmtDate(r.receipt_date)} · ${r.category || ''}</small></span>
            <span class="amount">${money(r.total, r.currency || 'EUR')}</span>
          </label>`)}
        ${!list.length && html`<p class="hint">No checked receipts found.</p>`}
      </div>
      <div class="actions">
        <button class="primary" onClick=${() => onDone([...ids])}>Attach ${ids.size || ''}</button>
        <button onClick=${onCancel}>Cancel</button>
      </div>
    </${Modal}>`;
}
