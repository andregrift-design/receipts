// Shared UI pieces: routing, number fields, badges, dialogs, document preview, icons.
import { html, useState, useEffect, useRef } from './ui.js';
import * as api from './api.js';
import { fmtNum, parseNum, isNum, periodLabel, isLate, naturalPeriod } from './vat.js';

export { html };

// ---------- routing ----------

export function useRoute() {
  const get = () => location.hash.replace(/^#\/?/, '').split('/');
  const [route, setRoute] = useState(get());
  useEffect(() => {
    const on = () => setRoute(get());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}
export const go = (path) => { location.hash = `#/${path}`; };

// ---------- numbers ----------

// Amount field: type freely, shows 1,234.56 when you leave the field.
export function NumInput({ value, onInput, label, disabled, placeholder = '0.00', decimals = 2, ...rest }) {
  const bad = Number.isNaN(parseNum(value));
  const onBlur = () => {
    const n = parseNum(value);
    if (isNum(n)) onInput(fmtNum(n, decimals));
  };
  return html`<input class=${`num${bad ? ' invalid' : ''}`} inputmode="decimal" aria-label=${label} placeholder=${placeholder}
    disabled=${disabled} value=${value ?? ''} onInput=${(e) => onInput(e.target.value)} onBlur=${onBlur} ...${rest} />`;
}
export const toField = (n, decimals = 2) => (isNum(n) ? fmtNum(n, decimals) : '');

// ---------- badges ----------

const STATUS = {
  processing: ['Reading…', 'st-processing'],
  review: ['Check', 'st-review'],
  done: ['Done', 'st-done'],
  error: ['Error', 'st-review'],
  queued: ['Waiting to upload', 'st-processing'],
};
export const Badge = ({ status }) => html`<span class="badge ${STATUS[status]?.[1] || 'st-quiet'}">${STATUS[status]?.[0] || status}</span>`;

// Badges about the quarter: filed (locked), correction, late entry.
export function PeriodBadges({ rec, filed, all }) {
  const out = [];
  if (rec.period && filed.has(rec.period)) out.push(html`<span class="badge st-lock" title="Filed with the CPA">🔒 ${periodLabel(rec.period)}</span>`);
  if (rec.corrects) {
    const orig = all?.find((x) => x.id === rec.corrects);
    out.push(html`<span class="badge st-info" title="Correction">↩︎ Correction of ${periodLabel(orig?.period)}</span>`);
  } else if (isLate(rec)) {
    out.push(html`<span class="badge st-info" title="Its own quarter was already filed">↩︎ Belongs to ${periodLabel(naturalPeriod(rec))}</span>`);
  }
  return out;
}

// ---------- dialogs ----------

export function Modal({ children, onClose, className = '' }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return html`
    <div class="backdrop" onClick=${(e) => e.target === e.currentTarget && onClose?.()}>
      <div class=${`dialog ${className}`} role="dialog">${children}</div>
    </div>`;
}

// ---------- document preview ----------

export function Preview({ r, onAttach, label = 'document' }) {
  const [url, setUrl] = useState(null);
  const [zoom, setZoom] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef();
  useEffect(() => { if (r.file_path) api.fileUrl(r.file_path).then(setUrl).catch(() => setUrl('')); }, [r.file_path, r.updated_at]);
  const pickFile = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setBusy(true);
    try { await onAttach(f); } catch (err) { alert(err.message); } finally { setBusy(false); }
  };
  const attach = onAttach && html`<input ref=${input} type="file" accept="image/*,application/pdf" hidden onChange=${pickFile} />`;
  if (!r.file_path) return html`
    <div class="preview empty-preview">
      <div class="center">
        <p>No ${label}</p>
        ${onAttach && html`<button class="primary" disabled=${busy} onClick=${() => input.current.click()}>${busy ? 'Uploading…' : 'Attach photo or PDF'}</button>
          <p class="hint">For example the payment receipt or a bank screenshot.</p>`}
        ${attach}
      </div>
    </div>`;
  if (url === null) return html`<div class="preview empty-preview">Loading…</div>`;
  const replace = onAttach && html`<button class="open replace" disabled=${busy} onClick=${(e) => { e.stopPropagation(); input.current.click(); }}>${busy ? 'Uploading…' : 'Replace'}</button>${attach}`;
  if (r.file_type === 'application/pdf') return html`
    <div class="preview"><iframe src=${url} title="PDF"></iframe><a class="open" href=${url} target="_blank" rel="noopener">Open PDF</a>${replace}</div>`;
  return html`
    <div class="preview ${zoom ? 'zoom' : ''}" onClick=${() => setZoom(!zoom)}>
      <img src=${url} alt="Photo" />
      <a class="open" href=${url} target="_blank" rel="noopener" onClick=${(e) => e.stopPropagation()}>Full size</a>${replace}
    </div>`;
}

// ---------- tables ----------

// Column layout shared by all tables: label, then fixed count and amount columns, so tables line up.
export const Cols = ({ count = true, amounts = 3, extra = [] }) => html`
  <colgroup><col />${extra.map((c) => html`<col class=${c} />`)}${count ? html`<col class="c-cnt" />` : ''}${Array.from({ length: amounts }, () => html`<col class="c-num" />`)}</colgroup>`;

// ---------- icons (SF Symbols style, inline SVG) ----------

const svg = (d) => html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const Icon = {
  home: svg(html`<path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" />`),
  expenses: svg(html`<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><path d="M9 8h6M9 12h6" />`),
  income: svg(html`<path d="M12 3v18" /><path d="M17 7.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.6 5 3 5 1.1 5 3-2.2 3-5 3-5-1.1-5-3" />`),
  overview: svg(html`<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />`),
  settings: svg(html`<circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />`),
  search: svg(html`<circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />`),
};
