// Expenses: add receipts (camera, files, by hand), the list, and the receipt screen.
import { html, useState, useEffect, useRef } from './ui.js';
import * as api from './api.js';
import {
  CATEGORIES, CURRENCIES, COUNTRIES, RATES, HOME_COUNTRY, DOC_TYPES, money, fmtDate, problems, splitGross, linesSum,
  fxFor, isNum, round2, countryName, weakProof, parseNum, periodLabel, periodOf, bookingPeriod, expectedVat, vatOff, followVat, fmtNum,
} from './vat.js';
import { go, Badge, PeriodBadges, Preview, NumInput, toField } from './kit.js';

// ---------- adding ----------

export function QueuedRow({ item, label, onRemove }) {
  return html`
    <div class="row">
      <span class="what">${label} from ${new Date(item.added).toLocaleString('en-US')}</span>
      <${Badge} status="queued" />
      <button class="link danger" onClick=${() => onRemove(item)}>Remove</button>
    </div>`;
}

const hasCamera = !!navigator.mediaDevices?.getUserMedia;

function AddButtons({ addFiles: add, addManual }) {
  const camera = useRef();
  const files = useRef();
  const [open, setOpen] = useState(false);
  const [annual, setAnnual] = useState(false);
  const extra = annual ? { annual_only: true } : {};
  const addFiles = (f) => add(f, extra);
  const pick = (ref) => ref.current.click();
  const onPick = (e) => { addFiles(e.target.files); e.target.value = ''; };
  return html`
    <div class="actions">
      <button class="primary big" onClick=${() => (hasCamera ? setOpen(true) : pick(camera))}>📷 Take photo</button>
      <button class="big" onClick=${() => pick(files)}>Photos & files</button>
      <button class="big" onClick=${() => addManual(extra)} title="No receipt? Enter it by hand and attach a payment receipt later">Enter by hand</button>
      <input ref=${camera} type="file" accept="image/*" capture="environment" hidden onChange=${onPick} />
      <input ref=${files} type="file" accept="image/*,application/pdf" multiple hidden onChange=${onPick} />
    </div>
    <label class="check annual-pick"><input type="checkbox" checked=${annual} onChange=${(e) => setAnnual(e.target.checked)} />
      <span><strong>Import as annual costs only</strong> · not for the VAT return. The CPA uses these for the annual cost calculation only.</span></label>
    ${open && html`<${Camera} addFiles=${addFiles} close=${() => setOpen(false)}
      fallback=${(which) => { setOpen(false); pick(which === 'camera' ? camera : files); }} />`}`;
}

// Viewfinder inside the app (getUserMedia). Several receipts in a row; falls back to the
// phone's own camera or photo picker when access is blocked or no picture comes through.
function Camera({ addFiles, close, fallback }) {
  const video = useRef();
  const stream = useRef(null);
  const [state, setState] = useState('starting');
  const [error, setError] = useState('');
  const [taken, setTaken] = useState(0);
  const [flash, setFlash] = useState(false);
  const [info, setInfo] = useState('');

  useEffect(() => {
    let cancelled = false;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };
    // True when the picture is (nearly) pure black: some devices deliver a stream without an image.
    const isBlack = (v) => {
      if (!v.videoWidth) return true;
      const c = document.createElement('canvas');
      c.width = 32; c.height = 32;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(v, 0, 0, 32, 32);
      const d = ctx.getImageData(0, 0, 32, 32).data;
      let max = 0;
      for (let i = 0; i < d.length; i += 4) max = Math.max(max, d[i], d[i + 1], d[i + 2]);
      return max < 12;
    };
    // Simplest requests last: high resolutions or a specific lens sometimes give a black picture.
    const attempts = [{ facingMode: { ideal: 'environment' } }, { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, true];
    (async () => {
      const v = video.current;
      v.muted = true;
      v.setAttribute('muted', '');
      v.setAttribute('playsinline', '');
      let lastError = null;
      for (let i = 0; i < attempts.length && !cancelled; i++) {
        try {
          stop();
          const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: attempts[i] });
          if (cancelled) return s.getTracks().forEach((t) => t.stop());
          stream.current = s;
          v.srcObject = s;
          await v.play().catch(() => {});
          for (let t = 0; t < 30 && !v.videoWidth && !cancelled; t++) await sleep(100);
          await sleep(700);
          if (cancelled) return;
          setInfo(`${s.getVideoTracks()[0]?.label || 'camera'} · ${v.videoWidth}×${v.videoHeight} · try ${i + 1}`);
          if (!isBlack(v)) { setState('live'); return; }
          lastError = null;
        } catch (err) {
          lastError = err;
          if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') break;
        }
      }
      if (cancelled) return;
      stop();
      const blocked = lastError && (lastError.name === 'NotAllowedError' || lastError.name === 'SecurityError');
      setError(blocked
        ? 'Camera access is blocked for this site. Tap aA in the address bar → Website Settings → Camera → Allow, then try again.'
        : lastError ? `The camera couldn’t start (${lastError.name || lastError}).`
          : 'The camera gives a black picture. Close other apps that use it (FaceTime, Zoom, a Mac using this iPhone as its webcam); on iPad use Safari full screen.');
      setState('error');
    })();
    const onKey = (e) => e.key === 'Escape' && close();
    addEventListener('keydown', onKey);
    return () => { cancelled = true; removeEventListener('keydown', onKey); stop(); };
  }, []);

  const shoot = () => {
    const v = video.current;
    if (!v?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      addFiles([new File([blob], `receipt-${Date.now()}.jpg`, { type: 'image/jpeg' })]);
      setTaken((n) => n + 1);
    }, 'image/jpeg', 0.92);
    setFlash(true);
    setTimeout(() => setFlash(false), 150);
  };

  return html`
    <div class="camera" role="dialog" aria-label="Camera">
      <video ref=${video} autoplay playsinline muted></video>
      ${flash && html`<div class="camera-flash"></div>`}
      ${state === 'starting' && html`<p class="camera-msg">Starting camera…</p>`}
      ${state === 'error' && html`
        <div class="camera-msg card">
          <p>${error}</p>
          <div class="actions">
            <button class="primary" onClick=${() => fallback('camera')}>Use the phone’s camera</button>
            <button onClick=${() => fallback('files')}>Choose from photos</button>
            <button onClick=${close}>Cancel</button>
          </div>
        </div>`}
      ${state === 'live' && html`<div class="camera-guide"></div>`}
      ${info && html`<p class="camera-info">${info}</p>`}
      <div class="camera-bar">
        <button class="camera-done" onClick=${close}>${taken ? 'Done' : 'Cancel'}</button>
        <button class="shutter" disabled=${state !== 'live'} onClick=${shoot} aria-label="Take photo"></button>
        <span class="camera-count">${taken ? `${taken} added` : ''}</span>
      </div>
    </div>`;
}

// ---------- list ----------

export function ExpensesPage({ ctx }) {
  const { receipts, mine, queue, filed } = ctx;
  const [filter, setFilter] = useState(localStorage.getItem('filter') || 'all');
  const [q, setQ] = useState('');
  const setF = (f) => { setFilter(f); localStorage.setItem('filter', f); };
  const open = receipts.filter((r) => r.status !== 'done');
  const needle = q.trim().toLowerCase();
  const shown = (filter === 'open' ? open : receipts).filter((r) => !needle
    || [r.store, r.description, r.category, r.notes, r.receipt_date, String(r.total ?? '')].some((v) => (v || '').toLowerCase().includes(needle)));

  // Grouped by quarter, newest first; records without a date on top.
  const groups = new Map();
  for (const r of shown) {
    const key = r.period || (r.status === 'processing' ? 'new' : 'nodate');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const order = (k) => (k === 'new' ? '9999' : k === 'nodate' ? '9998' : k);
  const keys = [...groups.keys()].sort((a, b) => order(b).localeCompare(order(a)));
  const title = (k) => (k === 'new' ? 'Just added' : k === 'nodate' ? 'No date yet' : periodLabel(k));
  const total = (list) => list.reduce((s, r) => s + (isNum(r.total) && fxFor(r) != null ? r.total * fxFor(r) : 0), 0);

  return html`
    <div class="page-head">
      <div><p class="kicker">Receipts and costs</p><h1>Expenses</h1></div>
    </div>
    ${mine && html`<${AddButtons} addFiles=${(f, extra) => ctx.addFiles(f, 'receipt', extra)} addManual=${ctx.addManual} />`}
    <div class="toolbar">
      <button class=${filter === 'all' ? 'chip on' : 'chip'} onClick=${() => setF('all')}>All (${receipts.length})</button>
      <button class=${filter === 'open' ? 'chip on' : 'chip'} onClick=${() => setF('open')}>Needs checking (${open.length})</button>
      <input type="search" placeholder="Filter" value=${q} onInput=${(e) => setQ(e.target.value)} />
    </div>
    ${queue.length > 0 && html`
      <section class="card flush">
        ${queue.map((i) => html`<${QueuedRow} item=${i} label="Photo" onRemove=${ctx.removeQueued} />`)}
        ${api.lastUploadError && html`<p class="hint bad" style="padding:0 18px">Upload problem: ${api.lastUploadError}</p>`}
      </section>`}
    ${!receipts.length && !queue.length && html`
      <div class="empty"><p>No receipts yet</p>
        <p class="hint">${mine ? 'Take a photo of a receipt, or drop photos and PDFs here. Claude reads the store, date, amount and VAT; you check the result.' : 'Nothing has been added yet.'}</p></div>`}
    ${keys.map((k) => html`
      <section>
        <h2 class="group-title">${title(k)} ${filed.has(k) ? html`<span class="badge st-lock">🔒 Filed</span>` : ''}
          <small>${groups.get(k).length} · ${money(total(groups.get(k)))}</small></h2>
        <div class="card flush">${groups.get(k).map((r) => html`<${ReceiptRow} r=${r} ctx=${ctx} />`)}</div>
      </section>`)}`;
}

function ReceiptRow({ r, ctx }) {
  const fx = fxFor(r);
  return html`
    <a class="row" href=${`#/r/${r.id}`}>
      <span class="what">
        <strong>${r.store || r.description || (r.status === 'processing' ? 'Reading receipt…' : 'Unknown store')}</strong>
        <small>${[r.receipt_date && fmtDate(r.receipt_date), r.vat_country && r.vat_country !== HOME_COUNTRY && countryName(r.vat_country), r.store && r.description, r.category].filter(Boolean).join(' · ')}</small>
      </span>
      <span class="badges">
        <${PeriodBadges} rec=${r} filed=${ctx.filed} all=${ctx.receipts} />
        ${r.annual_only && html`<span class="badge st-annual" title="Annual cost calculation only, not on the VAT return">Annual only</span>`}
        ${weakProof(r) && r.status !== 'processing' && html`<span class="badge st-weak">${r.doc_type === 'payment' ? 'Payment only' : 'No document'}</span>`}
        ${r.status !== 'done' && html`<${Badge} status=${r.status} />`}
      </span>
      <span class="amount">
        ${money(r.total, r.currency || 'EUR')}
        ${r.currency && r.currency !== 'EUR' && fx != null && isNum(r.total) && html`<small>${money(r.total * fx)}</small>`}
      </span>
    </a>`;
}

// ---------- receipt screen ----------

function toForm(r) {
  return {
    ...r,
    total: toField(r.total),
    fx_rate: r.currency === 'EUR' ? '' : toField(r.fx_rate, 6),
    vat_lines: (r.vat_lines || []).map((l) => ({ rate: l.rate, net: toField(l.net), vat: l.rate === null ? '' : toField(l.vat) })),
  };
}

function fromForm(f) {
  return {
    ...f,
    total: parseNum(f.total),
    fx_rate: f.currency === 'EUR' ? 1 : parseNum(f.fx_rate),
    vat_lines: f.vat_lines.map((l) => ({ rate: l.rate, net: parseNum(l.net), vat: l.rate === null ? 0 : parseNum(l.vat) })),
  };
}

export function ReceiptEditor({ receipt, ctx }) {
  const locked = !!receipt.period && ctx.filed.has(receipt.period);
  const readOnly = !ctx.mine || locked;
  const original = receipt.corrects ? ctx.receipts.find((x) => x.id === receipt.corrects) : null;
  const [form, setForm] = useState(() => toForm(receipt));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const fxTouched = useRef(false);

  // Take over changes from other devices or from the reader, unless you're editing.
  useEffect(() => { if (!dirty) setForm(toForm(receipt)); }, [receipt.updated_at]);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); setMsg(''); };
  const setLine = (i, patch) => set({ vat_lines: form.vat_lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  // Fetch the ECB rate when the currency or date changes (unless you typed one).
  useEffect(() => {
    if (readOnly || !dirty || form.currency === 'EUR' || fxTouched.current || !form.receipt_date) return;
    api.ecbRate(form.currency, form.receipt_date).then((r) => r && setForm((f) => ({ ...f, fx_rate: toField(r.rate, 6), fx_date: r.date }))).catch(() => {});
  }, [form.currency, form.receipt_date]);

  const value = fromForm(form);
  const todo = problems(value);
  const badNumbers = [value.total, value.fx_rate, ...value.vat_lines.flatMap((l) => [l.net, l.vat])].some((n) => Number.isNaN(n));
  const rates = RATES[form.vat_country] || [];
  const sum = linesSum(value.vat_lines);
  const fx = fxFor(value);
  // Its own quarter while the date is unchanged; otherwise where it would go now.
  const willCount = form.receipt_date === receipt.receipt_date && receipt.period ? receipt.period : bookingPeriod(form.receipt_date, ctx.filed);
  const jobs = ctx.statements.flatMap((st) => (st.lines || []).filter((l) => (l.receipt_ids || []).includes(receipt.id)).map((l) => ({ st, l })));

  const splitTotal = (i) => {
    const l = form.vat_lines[i];
    const others = value.vat_lines.reduce((s, x, j) => (j === i ? s : s + (x.net || 0) + (x.vat || 0)), 0);
    const { net, vat } = splitGross(round2((value.total || 0) - others), l.rate);
    setLine(i, { net: toField(net), vat: l.rate === null ? '' : toField(vat) });
  };
  const addLine = () => {
    const rate = form.vat_lines.length ? null : rates[0] ?? 21;
    const lines = [...form.vat_lines, { rate, net: '', vat: '' }];
    if (!form.vat_lines.length && isNum(value.total)) {
      const s = splitGross(value.total, rate);
      lines[0] = { rate, net: toField(s.net), vat: rate === null ? '' : toField(s.vat) };
    }
    set({ vat_lines: lines });
  };
  const save = async () => {
    setBusy('save');
    try {
      const saved = await api.saveReceipt(value);
      setDirty(false);
      setForm(toForm(saved));
      if (saved.status === 'done') go('expenses');
      else setMsg('Saved. Still to do: ' + problems(saved).join(', ') + '.');
    } catch (e) { setMsg(e.message); } finally { setBusy(''); }
  };
  const again = async () => {
    if (dirty && !confirm('Discard your changes and read the receipt again?')) return;
    setBusy('read'); setDirty(false); fxTouched.current = false;
    try { setForm(toForm(await api.readAgain(receipt.id))); } catch (e) { setMsg(e.message); } finally { setBusy(''); }
  };
  const remove = async () => {
    if (!confirm(receipt.corrects ? 'Delete this correction?' : 'Delete this receipt and its photo? Keep receipts for 7 years for the tax office.')) return;
    setBusy('delete');
    try { await api.deleteReceipt(receipt); go('expenses'); } catch (e) { setMsg(e.message); setBusy(''); }
  };
  const correct = async () => {
    try { const c = await api.createCorrection('receipts', receipt); go(`r/${c.id}`); } catch (e) { alert(e.message); }
  };
  const rateOptions = (current) => {
    const list = [...new Set([...rates, ...(current === null || current === undefined ? [] : [Number(current)])])];
    return html`${list.map((r) => html`<option value=${r}>${r}%</option>`)}<option value="none">No VAT</option><option value="other">Other…</option>`;
  };
  // A new rate keeps what was paid on this line (net + VAT) and splits it again; without amounts yet, VAT follows the net.
  const withRate = (i, rate) => {
    const l = value.vat_lines[i];
    if (rate === null) return setLine(i, { rate, vat: '', ...(isNum(l.net) && isNum(l.vat) ? { net: toField(round2(l.net + l.vat)) } : {}) });
    if (isNum(l.net) && isNum(l.vat) && l.net + l.vat !== 0) { const sp = splitGross(round2(l.net + l.vat), rate); return setLine(i, { rate, net: toField(sp.net), vat: toField(sp.vat) }); }
    setLine(i, { rate, ...(isNum(l.net) ? { vat: toField(expectedVat(l.net, rate)) } : {}) });
  };
  const onRate = (i, v) => {
    if (v === 'other') {
      const typed = parseNum(prompt('VAT rate in %'));
      if (isNum(typed)) withRate(i, typed);
      return;
    }
    withRate(i, v === 'none' ? null : Number(v));
  };
  const onNet = (i, v) => {
    const l = value.vat_lines[i];
    const vat = l.rate === null ? undefined : followVat(l.net, l.vat, parseNum(v), l.rate);
    setLine(i, { net: v, ...(vat !== undefined ? { vat: toField(vat) } : {}) });
  };

  return html`
    <div class="editor-head">
      <a href="#/expenses" class="back">‹ Expenses</a>
      <span class="badges"><${PeriodBadges} rec=${receipt} filed=${ctx.filed} all=${ctx.receipts} /><${Badge} status=${receipt.status} /></span>
    </div>
    <div class="editor-body">
      <${Preview} r=${original && !receipt.file_path ? original : receipt} onAttach=${readOnly || original ? null : (f) => api.attachFile(receipt, f)} />
      <form class="card form" onSubmit=${(e) => { e.preventDefault(); save(); }}>
        ${locked && html`<div class="note lock">🔒 ${periodLabel(receipt.period)} has been filed with the CPA. This receipt can’t be changed.
          ${ctx.mine && html`<button type="button" onClick=${correct}>Make a correction</button>`}</div>`}
        ${original && html`<div class="note info">↩︎ Correction of the receipt from ${fmtDate(original.receipt_date)} (${periodLabel(original.period)}). Enter the right values;
          the overview of ${periodLabel(receipt.period || willCount)} books the difference with the original.</div>`}
        ${receipt.status === 'processing' && html`<div class="note info">Claude is reading this receipt. The fields fill in by themselves in a few seconds.</div>`}
        ${receipt.error && html`<div class="note bad">Reading failed: ${receipt.error}</div>`}
        ${receipt.issues?.length > 0 && !locked && html`<div class="note"><strong>Check:</strong><ul>${receipt.issues.map((i) => html`<li>${i}</li>`)}</ul></div>`}

        <fieldset disabled=${readOnly}>
          <div class="grid g2">
            <label>Store<input value=${form.store || ''} onInput=${(e) => set({ store: e.target.value })} /></label>
            <label>Receipt date<input type="date" value=${form.receipt_date || ''} onInput=${(e) => set({ receipt_date: e.target.value })} /></label>
          </div>
          <div class="grid g-addr">
            <label>Address<input value=${form.store_address || ''} placeholder="Street, postcode, city" onInput=${(e) => set({ store_address: e.target.value })} /></label>
            <label>Country
              <select value=${form.vat_country} onChange=${(e) => set({ vat_country: e.target.value })}>
                ${[...new Set([...Object.keys(COUNTRIES), form.vat_country])].map((k) => html`<option value=${k}>${countryName(k)}</option>`)}
              </select>
            </label>
          </div>
          <label>Description<input value=${form.description || ''} placeholder="What was it for?" onInput=${(e) => set({ description: e.target.value })} /></label>
          <div class="grid g3">
            <label>Category
              <select value=${form.category || ''} onChange=${(e) => set({ category: e.target.value })}>
                <option value="">–</option>
                ${[...new Set([...CATEGORIES, ...(form.category ? [form.category] : [])])].map((c) => html`<option value=${c}>${c}</option>`)}
              </select>
            </label>
            <label>Document
              <select value=${form.doc_type || 'receipt'} onChange=${(e) => set({ doc_type: e.target.value })}>
                ${Object.entries(DOC_TYPES).map(([k, v]) => html`<option value=${k}>${v}</option>`)}
              </select>
            </label>
            <label>Counts in<input disabled value=${willCount ? `${periodLabel(willCount)}${willCount !== periodOf(form.receipt_date) ? ' (late entry)' : ''}` : '–'} /></label>
          </div>
          <label class="check annual-pick"><input type="checkbox" checked=${!!form.annual_only} onChange=${(e) => set({ annual_only: e.target.checked })} />
            <span><strong>Annual costs only</strong> · not for the VAT return. The CPA counts it in the annual cost calculation only.</span></label>
          ${weakProof(form) && html`<p class="hint">${form.doc_type === 'payment' ? 'A payment receipt shows no VAT. Fill in the VAT if you know it, or choose No VAT.' : 'Fill in the fields by hand and attach a payment receipt or bank screenshot if you have one.'} Your accountant decides whether VAT without a proper receipt can be deducted.</p>`}

          <div class="form-section">
            <h3>Amount</h3>
            <div class="grid g3">
              <label>Total paid<${NumInput} label="Total paid" value=${form.total} onInput=${(v) => set({ total: v })} /></label>
              <label>Currency
                <select value=${form.currency} onChange=${(e) => { fxTouched.current = false; set({ currency: e.target.value, fx_rate: e.target.value === 'EUR' ? '' : form.fx_rate }); }}>
                  ${[...new Set([...CURRENCIES, form.currency])].map((c) => html`<option value=${c}>${c}</option>`)}
                </select>
              </label>
              <label>In EUR<input class="num" disabled value=${fx != null && isNum(value.total) ? toField(value.total * fx) : ''} /></label>
            </div>
            ${form.currency !== 'EUR' && html`
              <div class="grid g2">
                <label>Exchange rate${form.currency !== 'EUR' ? ` (EUR per ${form.currency})` : ''}
                  <${NumInput} label="Exchange rate" decimals=${6} value=${form.fx_rate} onInput=${(v) => { fxTouched.current = true; set({ fx_rate: v, fx_date: null }); }} />
                </label>
                <p class="hint fx">${fx == null ? 'Fills in from the ECB once the date is set.' : form.fx_date
                  ? `ECB rate of ${fmtDate(form.fx_date)}${form.fx_date !== form.receipt_date ? ' (last business day before the receipt date)' : ''}` : 'Rate entered by hand'}</p>
              </div>`}
          </div>

          <div class="form-section">
            <h3>VAT ${form.vat_country !== HOME_COUNTRY && html`<span class="badge st-review">Foreign: ${countryName(form.vat_country)}</span>`}</h3>
            ${form.annual_only && html`<p class="hint">Annual costs only: the VAT below is kept for reference and is not used on the VAT return. The full amount counts as cost.${form.vat_country !== HOME_COUNTRY ? ' In the overview this receipt is listed under “Annual costs only”, not under Foreign.' : ''}</p>`}
            ${form.vat_country !== HOME_COUNTRY && html`<p class="hint">Foreign VAT can’t be deducted on your Dutch VAT return. It’s listed separately in the overview, per country.</p>`}
            <div class="vat-line labels"><span>Rate</span><span>Net</span><span>VAT</span><span></span></div>
            ${form.vat_lines.map((l, i) => html`
              <div class="vat-line">
                <select value=${l.rate === null ? 'none' : l.rate} onChange=${(e) => onRate(i, e.target.value)}>${rateOptions(l.rate)}</select>
                <${NumInput} label="Net" value=${l.net} onInput=${(v) => onNet(i, v)} />
                <${NumInput} label="VAT" disabled=${l.rate === null} value=${l.rate === null ? '0.00' : l.vat} onInput=${(v) => setLine(i, { vat: v })} />
                <span class="line-actions">
                  <button type="button" class="link" title="Fill from the total" onClick=${() => splitTotal(i)}>Fill</button>
                  <button type="button" class="link danger" title="Remove" onClick=${() => set({ vat_lines: form.vat_lines.filter((_, j) => j !== i) })}>✕</button>
                </span>
              </div>
              ${(() => {
                const v = value.vat_lines[i];
                const e = v && v.rate !== null ? vatOff(v.net, v.rate, v.vat) : null;
                if (e === null) return '';
                const gross = round2(v.net + v.vat), sp = splitGross(gross, v.rate);
                return html`<div class="vat-warn">${fmtNum(v.rate, v.rate % 1 ? 1 : 0)}% of ${money(v.net, form.currency)} is <strong>${money(e, form.currency)}</strong>, not ${money(v.vat, form.currency)}.
                  ${!readOnly && html`<span>
                    <button type="button" class="link" onClick=${() => setLine(i, { vat: toField(e) })}>Use ${money(e, form.currency)} VAT</button>
                    <button type="button" class="link" onClick=${() => setLine(i, { net: toField(sp.net), vat: toField(sp.vat) })}>Split ${money(gross, form.currency)} at ${fmtNum(v.rate, v.rate % 1 ? 1 : 0)}%</button></span>`}
                  <small>Check the receipt: if it really shows this VAT, the rate may be wrong.</small></div>`;
              })()}`)}
            ${!form.vat_lines.length && html`<p class="hint">No VAT entered yet.</p>`}
            <div class="sumline">
              <button type="button" class="link" onClick=${addLine}>+ ${form.vat_lines.length ? 'Add another rate' : 'Add VAT'}</button>
              <span class=${isNum(value.total) && form.vat_lines.length && Math.abs(sum - value.total) > 0.02 * form.vat_lines.length ? 'bad-text' : ''}>
                Net + VAT <strong>${money(sum, form.currency)}</strong>${isNum(value.total) ? html` · total <strong>${money(value.total, form.currency)}</strong>` : ''}</span>
            </div>
          </div>

          <div class="form-section">
            <label>Notes<textarea rows="2" value=${form.notes || ''} onInput=${(e) => set({ notes: e.target.value })}></textarea></label>
          </div>
        </fieldset>

        ${jobs.length > 0 && html`<div class="note info">Attached to ${jobs.map(({ st, l }, i) => html`${i ? ', ' : ''}<a href=${`#/s/${st.id}`}>${l.client || 'job'} (${st.agency})</a>`)}.</div>`}

        ${!readOnly && html`
          <div class=${todo.length ? 'note' : 'note good'}>${todo.length ? `To fix: ${todo.join(', ')}.` : 'Complete.'}</div>
          ${badNumbers && html`<div class="note bad">One of the amounts isn’t a number.</div>`}
          ${msg && html`<p class="msg">${msg}</p>`}
          <div class="actions">
            <button class="primary" disabled=${!!busy || badNumbers}>${busy === 'save' ? 'Saving…' : todo.length ? 'Save' : 'Save as done'}</button>
            ${receipt.file_path && html`<button type="button" disabled=${!!busy} onClick=${again}>${busy === 'read' ? 'Reading…' : 'Read again'}</button>`}
            <button type="button" class="danger" disabled=${!!busy} onClick=${remove}>Delete</button>
          </div>`}
      </form>
    </div>`;
}
