import { html, render, useState, useEffect, useRef, useMemo } from './ui.js';
import * as api from './api.js';
import {
  CATEGORIES, CURRENCIES, COUNTRIES, RATES, HOME_COUNTRY, money, fmtDate, problems, splitGross, linesSum,
  fxFor, isNum, round2, quarterOf, quarterRange, quarterLabel, summarize, vatLabel, isHome, countryName, DOC_TYPES, weakProof,
} from './vat.js';
import { downloadExcel, downloadPdf, downloadZip, numbered } from './export.js';

const VERSION = '1.5';

// ---------- helpers ----------

// Accepts 12.50, 12,50, 1.234,56 and 1,234.56.
function parseNum(s) {
  if (s === null || s === undefined) return null;
  let t = String(s).trim().replace(/[€$£\s]/g, '');
  if (!t) return null;
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (t.includes(',')) t = t.replace(',', '.');
  const n = Number(t);
  return Number.isNaN(n) ? NaN : n;
}
const show = (n) => (isNum(n) ? Number(n).toFixed(2) : '');

function useRoute() {
  const get = () => location.hash.replace(/^#\/?/, '').split('/');
  const [route, setRoute] = useState(get());
  useEffect(() => {
    const on = () => setRoute(get());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}
const go = (path) => { location.hash = `#/${path}`; };

function defaultQuarter() {
  const d = new Date();
  let { year, q } = quarterOf(d.toISOString().slice(0, 10));
  // In the first three weeks of a quarter you most likely want the one that just ended.
  const firstMonth = (q - 1) * 3;
  if (d.getMonth() === firstMonth && d.getDate() <= 21) { q -= 1; if (q === 0) { q = 4; year -= 1; } }
  return { year, q };
}

const STATUS = {
  processing: ['Reading…', 'st-processing'],
  review: ['Check', 'st-review'],
  done: ['Done', 'st-done'],
  error: ['Error', 'st-review'],
  queued: ['Waiting to upload', 'st-processing'],
};
const Badge = ({ status }) => html`<span class="badge ${STATUS[status][1]}">${STATUS[status][0]}</span>`;

// ---------- sign in ----------

function SignIn() {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      if (mode === 'signin') {
        const { error } = await api.sb.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await api.sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: location.origin + location.pathname } });
        if (error) throw error;
        if (!data.session) setMsg('Check your email and click the link to confirm your account, then sign in here.');
      } else {
        const { error } = await api.sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname });
        if (error) throw error;
        setMsg('If that address has an account, you’ll get an email with a link to set a new password.');
      }
    } catch (err) {
      setMsg(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return html`
    <div class="auth">
      <form class="card auth-card" onSubmit=${submit}>
        <img src="icons/icon-192.png" alt="" class="auth-logo" />
        <h1>Receipts</h1>
        <p class="hint">${mode === 'signup' ? 'Create an account. Accountants: use the email address your client shared with.' : mode === 'forgot' ? 'Get a link to set a new password.' : 'Sign in to see your receipts on every device.'}</p>
        <label>Email<input type="email" autocomplete="email" required value=${email} onInput=${(e) => setEmail(e.target.value)} /></label>
        ${mode !== 'forgot' && html`<label>Password<input type="password" autocomplete=${mode === 'signup' ? 'new-password' : 'current-password'} required minlength="8" value=${password} onInput=${(e) => setPassword(e.target.value)} /></label>`}
        <button class="primary" disabled=${busy}>${mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send link'}</button>
        ${msg && html`<p class="msg">${msg}</p>`}
        <div class="auth-links">
          ${mode !== 'signin' && html`<a href="#" onClick=${(e) => { e.preventDefault(); setMode('signin'); setMsg(''); }}>Sign in</a>`}
          ${mode !== 'signup' && html`<a href="#" onClick=${(e) => { e.preventDefault(); setMode('signup'); setMsg(''); }}>Create account</a>`}
          ${mode !== 'forgot' && html`<a href="#" onClick=${(e) => { e.preventDefault(); setMode('forgot'); setMsg(''); }}>Forgot password</a>`}
        </div>
      </form>
    </div>`;
}

function NewPassword({ done }) {
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    const { error } = await api.sb.auth.updateUser({ password });
    if (error) return setMsg(error.message);
    done();
  };
  return html`
    <div class="auth">
      <form class="card auth-card" onSubmit=${submit}>
        <h1>New password</h1>
        <label>Password<input type="password" autocomplete="new-password" required minlength="8" value=${password} onInput=${(e) => setPassword(e.target.value)} /></label>
        <button class="primary">Save password</button>
        ${msg && html`<p class="msg">${msg}</p>`}
      </form>
    </div>`;
}

// ---------- app ----------

function App() {
  const [session, setSession] = useState(undefined);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    api.sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = api.sb.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(s);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return html`<p class="boot">Loading…</p>`;
  if (recovery) return html`<${NewPassword} done=${() => setRecovery(false)} />`;
  if (!session) return html`<${SignIn} />`;
  return html`<${Main} user=${session.user} key=${session.user.id} />`;
}

function Main({ user }) {
  const route = useRoute();
  const [shares, setShares] = useState([]);
  const [ownerId, setOwnerId] = useState(localStorage.getItem('owner') || user.id);
  const [receipts, setReceipts] = useState(null);
  const [queue, setQueue] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [dragging, setDragging] = useState(false);

  const email = (user.email || '').toLowerCase();
  const sharedWithMe = shares.filter((s) => s.viewer_email === email && s.owner_id !== user.id);
  const myViewers = shares.filter((s) => s.owner_id === user.id);
  const accounts = [{ id: user.id, label: 'My receipts' }, ...sharedWithMe.map((s) => ({ id: s.owner_id, label: s.owner_email || 'Shared with me' }))];
  const mine = ownerId === user.id;
  const ownerLabel = mine ? user.email : accounts.find((a) => a.id === ownerId)?.label;

  const loadShares = () => api.myShares().then(setShares).catch((e) => console.warn(e));
  useEffect(() => { loadShares(); }, []);

  // An accountant without receipts of their own lands on the first shared account.
  useEffect(() => {
    if (!localStorage.getItem('owner') && sharedWithMe.length && receipts && !receipts.length && mine) setOwner(sharedWithMe[0].owner_id);
    if (!mine && shares.length && !sharedWithMe.some((s) => s.owner_id === ownerId)) setOwner(user.id);
  }, [shares, receipts]);

  const setOwner = (id) => {
    localStorage.setItem('owner', id);
    setReceipts(null);
    setOwnerId(id);
    go('');
  };

  const refresh = () => api.listReceipts(ownerId).then((r) => { setReceipts(r); setLoadError(''); }).catch((e) => setLoadError(e.message));
  const refreshQueue = () => api.queued().then((q) => setQueue(q.filter((i) => i.userId === user.id))).catch(() => {});

  useEffect(() => {
    refresh();
    const stop = api.watchReceipts(ownerId, (p) => {
      setReceipts((list) => {
        if (!list) return list;
        if (p.eventType === 'DELETE') return list.filter((r) => r.id !== p.old.id);
        const i = list.findIndex((r) => r.id === p.new.id);
        if (i < 0) return [p.new, ...list];
        const copy = [...list];
        copy[i] = p.new;
        return copy;
      });
    });
    const onVisible = () => { if (document.visibilityState === 'visible') { refresh(); loadShares(); } };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => document.visibilityState === 'visible' && refresh(), 60000);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisible); clearInterval(timer); };
  }, [ownerId]);

  useEffect(() => {
    refreshQueue();
    const up = () => { setOnline(true); api.flushOutbox().then(() => { refreshQueue(); refresh(); }); };
    const down = () => setOnline(false);
    addEventListener('online', up);
    addEventListener('offline', down);
    api.flushOutbox().then(refreshQueue);
    return () => { removeEventListener('online', up); removeEventListener('offline', down); };
  }, []);

  const addFiles = async (files) => {
    if (!files?.length) return;
    if (!mine) setOwner(user.id);
    await api.addFiles([...files], user.id);
    await refreshQueue();
    refresh();
  };

  const addManual = async () => {
    if (!mine) setOwner(user.id);
    try {
      const r = await api.createManual(user.id);
      setReceipts((list) => (list && !list.some((x) => x.id === r.id) ? [r, ...list] : list));
      go(`r/${r.id}`);
    } catch (e) { alert(e.message); }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    addFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf'));
  };

  const [view, arg] = route;
  const open = receipts?.filter((r) => r.status !== 'done').length || 0;
  let body;
  if (!receipts) body = html`<p class="boot">${loadError || 'Loading receipts…'}</p>`;
  else if (view === 'r') {
    const r = receipts.find((x) => x.id === arg);
    body = r ? html`<${Editor} receipt=${r} readOnly=${!mine} key=${r.id} />` : html`<p class="boot">Receipt not found. <a href="#/">Back</a></p>`;
  } else if (view === 'quarter') body = html`<${Quarter} receipts=${receipts} arg=${arg} owner=${ownerLabel} />`;
  else if (view === 'settings') body = html`<${Settings} user=${user} viewers=${myViewers} sharedWithMe=${sharedWithMe} reload=${loadShares} />`;
  else body = html`<${List} receipts=${receipts} queue=${mine ? queue : []} canAdd=${mine} addFiles=${addFiles} addManual=${addManual} />`;

  return html`
    <div class="app ${dragging ? 'dragging' : ''}"
      onDragOver=${(e) => { if (mine) { e.preventDefault(); setDragging(true); } }}
      onDragLeave=${(e) => { if (e.target === e.currentTarget) setDragging(false); }}
      onDrop=${mine ? onDrop : undefined}>
      <header class="topbar">
        <a class="brand" href="#/"><img src="icons/icon-192.png" alt="" />Receipts</a>
        <nav class="tabs">
          <a class=${!view || view === 'r' ? 'on' : ''} href="#/">Receipts${open ? html` <span class="count">${open}</span>` : ''}</a>
          <a class=${view === 'quarter' ? 'on' : ''} href="#/quarter">Quarter</a>
          <a class=${view === 'settings' ? 'on' : ''} href="#/settings">Settings</a>
        </nav>
        ${accounts.length > 1 && html`
          <select class="account" value=${ownerId} onChange=${(e) => setOwner(e.target.value)} aria-label="Whose receipts">
            ${accounts.map((a) => html`<option value=${a.id}>${a.label}</option>`)}
          </select>`}
      </header>
      ${!online && html`<div class="banner">Offline. New photos are saved on this device and upload when you’re back online.</div>`}
      ${!mine && html`<div class="banner info">You’re viewing ${ownerLabel}’s receipts (read-only).</div>`}
      <main class="main">${body}</main>
      ${dragging && html`<div class="dropzone">Drop receipts to add them</div>`}
    </div>`;
}

// ---------- list ----------

const hasCamera = !!navigator.mediaDevices?.getUserMedia;

function AddButtons({ addFiles, addManual }) {
  const camera = useRef();
  const files = useRef();
  const [open, setOpen] = useState(false);
  const pick = (ref) => ref.current.click();
  const onPick = (e) => { addFiles(e.target.files); e.target.value = ''; };
  return html`
    <div class="add">
      <button class="primary big" onClick=${() => (hasCamera ? setOpen(true) : pick(camera))}>📷 Take photo</button>
      <button class="big" onClick=${() => pick(files)}>Photos & files</button>
      <button class="big" onClick=${addManual} title="No receipt? Enter it by hand and attach a payment receipt later">Enter manually</button>
      <input ref=${camera} type="file" accept="image/*" capture="environment" hidden onChange=${onPick} />
      <input ref=${files} type="file" accept="image/*,application/pdf" multiple hidden onChange=${onPick} />
    </div>
    ${open && html`<${Camera} addFiles=${addFiles} close=${() => setOpen(false)}
      fallback=${(which) => { setOpen(false); pick(which === 'camera' ? camera : files); }} />`}`;
}

// Viewfinder inside the app (getUserMedia). Several receipts in a row; falls back to the
// phone's own camera or photo picker when access is blocked or no picture comes through.
function Camera({ addFiles, close, fallback }) {
  const video = useRef();
  const stream = useRef(null);
  const [state, setState] = useState('starting'); // starting | live | error
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
    const attempts = [
      { facingMode: { ideal: 'environment' } },
      { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      true,
    ];

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
          // Wait for real frames, then check they aren't black.
          for (let t = 0; t < 30 && !v.videoWidth && !cancelled; t++) await sleep(100);
          await sleep(700);
          if (cancelled) return;
          const track = s.getVideoTracks()[0];
          setInfo(`${track?.label || 'camera'} · ${v.videoWidth}×${v.videoHeight} · try ${i + 1}`);
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
        ? 'Camera access is blocked for this site. Tap aA in the address bar → Website Settings → Camera → Allow, then try again. Or check Settings → Apps → Safari → Camera.'
        : lastError
          ? `The camera couldn’t start (${lastError.name || lastError}).`
          : 'The camera gives a black picture. This usually means the camera is busy or not allowed right now: close other apps that use it (FaceTime, Zoom, a Mac using this iPhone as its webcam), and on iPad use Safari full screen, not Split View or Slide Over.');
      setState('error');
    })();
    const onKey = (e) => e.key === 'Escape' && close();
    addEventListener('keydown', onKey);
    return () => {
      cancelled = true;
      removeEventListener('keydown', onKey);
      stop();
    };
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

function List({ receipts, queue, canAdd, addFiles, addManual }) {
  const [filter, setFilter] = useState(localStorage.getItem('filter') || 'all');
  const [q, setQ] = useState('');
  const setF = (f) => { setFilter(f); localStorage.setItem('filter', f); };
  const open = receipts.filter((r) => r.status !== 'done');
  const needle = q.trim().toLowerCase();
  const shown = (filter === 'open' ? open : receipts).filter((r) => !needle
    || [r.store, r.description, r.category, r.notes, r.receipt_date, String(r.total ?? '')].some((v) => (v || '').toLowerCase().includes(needle)));

  const groups = [];
  for (const r of shown) {
    const key = r.receipt_date ? r.receipt_date.slice(0, 7) : (r.status === 'processing' ? 'new' : 'nodate');
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, items: [] }));
    g.items.push(r);
  }
  const order = (k) => (k === 'new' ? '9999' : k === 'nodate' ? '9998' : k);
  groups.sort((a, b) => order(b.key).localeCompare(order(a.key)));
  const title = (k) => (k === 'new' ? 'Just added' : k === 'nodate' ? 'No date' : new Date(k + '-15').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));

  return html`
    <div class="list">
      ${canAdd && html`<${AddButtons} addFiles=${addFiles} addManual=${addManual} />`}
      <div class="filters">
        <button class=${filter === 'all' ? 'chip on' : 'chip'} onClick=${() => setF('all')}>All (${receipts.length})</button>
        <button class=${filter === 'open' ? 'chip on' : 'chip'} onClick=${() => setF('open')}>Needs checking (${open.length})</button>
        <input type="search" placeholder="Search" value=${q} onInput=${(e) => setQ(e.target.value)} />
      </div>
      ${queue.length > 0 && html`
        <section class="card">
          ${queue.map((i) => html`<div class="row"><span class="what">Photo from ${new Date(i.added).toLocaleString('en-US')}</span><${Badge} status="queued" /></div>`)}
        </section>`}
      ${!receipts.length && !queue.length && html`
        <div class="empty">
          <p>No receipts yet.</p>
          <p class="hint">${canAdd ? 'Take a photo of a receipt, or drop photos and PDFs here. Claude reads the store, date, amount and VAT; you check the result.' : 'Nothing has been added to this account yet.'}</p>
        </div>`}
      ${groups.map((g) => html`
        <section class="month">
          <h2>${title(g.key)}</h2>
          <div class="card">
            ${g.items.map((r) => html`<${Row} r=${r} />`)}
          </div>
        </section>`)}
    </div>`;
}

function Row({ r }) {
  const fx = fxFor(r);
  return html`
    <a class="row" href=${`#/r/${r.id}`}>
      <span class="what">
        <strong>${r.store || r.description || (r.status === 'processing' ? 'Reading receipt…' : 'Unknown store')}</strong>
        <small>${[r.receipt_date && fmtDate(r.receipt_date), r.vat_country && r.vat_country !== HOME_COUNTRY && countryName(r.vat_country), r.store && r.description, r.category].filter(Boolean).join(' · ')}</small>
      </span>
      <span class="amount">
        ${money(r.total, r.currency || 'EUR')}
        ${r.currency && r.currency !== 'EUR' && fx != null && isNum(r.total) && html`<small>${money(r.total * fx)}</small>`}
      </span>
      ${weakProof(r) && r.status !== 'processing' && html`<span class="badge st-weak">${r.doc_type === 'payment' ? 'Payment only' : 'No document'}</span>`}
      ${r.status !== 'done' && html`<${Badge} status=${r.status} />`}
    </a>`;
}

// ---------- receipt editor ----------

function toForm(r) {
  return {
    ...r,
    total: show(r.total),
    fx_rate: r.currency === 'EUR' ? '' : (r.fx_rate ?? '') + '',
    vat_lines: (r.vat_lines || []).map((l) => ({ rate: l.rate, net: show(l.net), vat: l.rate === null ? '' : show(l.vat) })),
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

function Preview({ r, onAttach }) {
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
  const attach = onAttach && html`
    <input ref=${input} type="file" accept="image/*,application/pdf" hidden onChange=${pickFile} />`;
  if (!r.file_path) return html`
    <div class="preview empty-preview">
      <div class="center">
        <p>No document</p>
        ${onAttach && html`<button class="primary" disabled=${busy} onClick=${() => input.current.click()}>${busy ? 'Uploading…' : 'Attach photo or PDF'}</button>
          <p class="hint">For example the payment receipt or a bank screenshot.</p>`}
        ${attach}
      </div>
    </div>`;
  if (url === null) return html`<div class="preview empty-preview">Loading photo…</div>`;
  const replace = onAttach && html`<button class="open replace" disabled=${busy} onClick=${(e) => { e.stopPropagation(); input.current.click(); }}>${busy ? 'Uploading…' : 'Replace'}</button>${attach}`;
  if (r.file_type === 'application/pdf') return html`
    <div class="preview"><iframe src=${url} title="Receipt PDF"></iframe><a class="open" href=${url} target="_blank" rel="noopener">Open PDF</a>${replace}</div>`;
  return html`
    <div class="preview ${zoom ? 'zoom' : ''}" onClick=${() => setZoom(!zoom)}>
      <img src=${url} alt="Receipt photo" />
      <a class="open" href=${url} target="_blank" rel="noopener" onClick=${(e) => e.stopPropagation()}>Full size</a>${replace}
    </div>`;
}

function Editor({ receipt, readOnly }) {
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
    api.ecbRate(form.currency, form.receipt_date).then((rate) => rate && setForm((f) => ({ ...f, fx_rate: String(rate) }))).catch(() => {});
  }, [form.currency, form.receipt_date]);

  const value = fromForm(form);
  const todo = problems(value);
  const badNumbers = [value.total, value.fx_rate, ...value.vat_lines.flatMap((l) => [l.net, l.vat])].some((n) => Number.isNaN(n));
  const rates = RATES[form.vat_country] || [];
  const sum = linesSum(value.vat_lines);
  const fx = fxFor(value);

  const splitTotal = (i) => {
    const l = form.vat_lines[i];
    const others = value.vat_lines.reduce((s, x, j) => (j === i ? s : s + (x.net || 0) + (x.vat || 0)), 0);
    const { net, vat } = splitGross(round2((value.total || 0) - others), l.rate);
    setLine(i, { net: show(net), vat: l.rate === null ? '' : show(vat) });
  };

  const addLine = () => {
    const rate = form.vat_lines.length ? null : rates[0] ?? 21;
    const lines = [...form.vat_lines, { rate, net: '', vat: '' }];
    if (!form.vat_lines.length && isNum(value.total)) {
      const s = splitGross(value.total, rate);
      lines[0] = { rate, net: show(s.net), vat: rate === null ? '' : show(s.vat) };
    }
    set({ vat_lines: lines });
  };

  const save = async () => {
    setBusy('save');
    try {
      const saved = await api.saveReceipt(value);
      setDirty(false);
      setForm(toForm(saved));
      if (saved.status === 'done') go('');
      else setMsg('Saved. Still to do: ' + problems(saved).join(', ') + '.');
    } catch (e) { setMsg(e.message); } finally { setBusy(''); }
  };

  const again = async () => {
    if (dirty && !confirm('Discard your changes and read the receipt again?')) return;
    setBusy('read'); setDirty(false); fxTouched.current = false;
    try { const r = await api.readAgain(receipt.id); setForm(toForm(r)); } catch (e) { setMsg(e.message); } finally { setBusy(''); }
  };

  const remove = async () => {
    if (!confirm('Delete this receipt and its photo? Keep receipts for 7 years for the tax office.')) return;
    setBusy('delete');
    try { await api.deleteReceipt(receipt); go(''); } catch (e) { setMsg(e.message); setBusy(''); }
  };

  const rateOptions = (current) => {
    const list = [...new Set([...rates, ...(current === null || current === undefined ? [] : [Number(current)])])];
    return html`${list.map((r) => html`<option value=${r}>${r}%</option>`)}<option value="none">No VAT</option><option value="other">Other…</option>`;
  };
  const onRate = (i, v) => {
    if (v === 'other') {
      const typed = parseNum(prompt('VAT rate in %'));
      if (isNum(typed)) setLine(i, { rate: typed });
      return;
    }
    setLine(i, { rate: v === 'none' ? null : Number(v), ...(v === 'none' ? { vat: '' } : {}) });
  };

  return html`
    <div class="editor">
      <div class="editor-head">
        <a href="#/" class="back">‹ Receipts</a>
        <${Badge} status=${receipt.status} />
      </div>
      <div class="editor-body">
        <${Preview} r=${receipt} onAttach=${readOnly ? null : (f) => api.attachFile(receipt, f)} />
        <form class="card form" onSubmit=${(e) => { e.preventDefault(); save(); }}>
          ${receipt.status === 'processing' && html`<div class="note">Claude is reading this receipt. The fields fill in by themselves in a few seconds.</div>`}
          ${receipt.error && html`<div class="note bad">Reading failed: ${receipt.error}</div>`}
          ${receipt.issues?.length > 0 && html`<div class="note"><strong>Check:</strong><ul>${receipt.issues.map((i) => html`<li>${i}</li>`)}</ul></div>`}

          <fieldset disabled=${readOnly}>
            <label>Document
              <select value=${form.doc_type || 'receipt'} onChange=${(e) => set({ doc_type: e.target.value })}>
                ${Object.entries(DOC_TYPES).map(([k, v]) => html`<option value=${k}>${v}</option>`)}
              </select>
            </label>
            ${weakProof(form) && html`<p class="hint">${form.doc_type === 'payment' ? 'A payment receipt shows no VAT. Fill in the VAT by hand if you know it (for example from the menu or the shop), or choose No VAT.' : 'Fill in the fields by hand. Attach a payment receipt or bank screenshot if you have one.'} Your accountant decides whether VAT without a proper receipt can be deducted.</p>`}
            <div class="grid2">
              <label>Store<input value=${form.store || ''} onInput=${(e) => set({ store: e.target.value })} /></label>
              <label>Date<input type="date" value=${form.receipt_date || ''} onInput=${(e) => set({ receipt_date: e.target.value })} /></label>
            </div>
            <div class="grid-addr">
              <label>Address<input value=${form.store_address || ''} placeholder="Street, postcode, city" onInput=${(e) => set({ store_address: e.target.value })} /></label>
              <label>Country
                <select value=${form.vat_country} onChange=${(e) => set({ vat_country: e.target.value })}>
                  ${[...new Set([...Object.keys(COUNTRIES), form.vat_country])].map((k) => html`<option value=${k}>${countryName(k)}</option>`)}
                </select>
              </label>
            </div>
            <label>Description<input value=${form.description || ''} placeholder="What was it for?" onInput=${(e) => set({ description: e.target.value })} /></label>
            <div class="grid3">
              <label>Total paid
                <input inputmode="decimal" class=${Number.isNaN(value.total) ? 'invalid' : ''} value=${form.total} onInput=${(e) => set({ total: e.target.value })} />
              </label>
              <label>Currency
                <select value=${form.currency} onChange=${(e) => { fxTouched.current = false; set({ currency: e.target.value, fx_rate: e.target.value === 'EUR' ? '' : form.fx_rate }); }}>
                  ${[...new Set([...CURRENCIES, form.currency])].map((c) => html`<option value=${c}>${c}</option>`)}
                </select>
              </label>
              <label>Category
                <select value=${form.category || ''} onChange=${(e) => set({ category: e.target.value })}>
                  <option value="">–</option>
                  ${[...new Set([...CATEGORIES, ...(form.category ? [form.category] : [])])].map((c) => html`<option value=${c}>${c}</option>`)}
                </select>
              </label>
            </div>
            ${form.currency !== 'EUR' && html`
              <div class="grid2">
                <label>Exchange rate (EUR per ${form.currency})
                  <input inputmode="decimal" value=${form.fx_rate} onInput=${(e) => { fxTouched.current = true; set({ fx_rate: e.target.value }); }} />
                </label>
                <p class="hint fx">${fx != null && isNum(value.total) ? `= ${money(value.total * fx)} (ECB rate on the receipt date)` : 'Fills in from the ECB once the date is set.'}</p>
              </div>`}

            <div class="vat">
              <div class="vat-head"><h3>VAT</h3>${form.vat_country !== HOME_COUNTRY && html`<span class="badge st-review">Foreign: ${countryName(form.vat_country)}</span>`}</div>
              ${form.vat_country !== HOME_COUNTRY && html`<p class="hint">Foreign VAT can’t be deducted on your Dutch VAT return. It’s listed separately in the overview, per country.</p>`}
              ${form.vat_lines.length > 0 && html`
                <div class="vat-lines">
                  <div class="vat-line labels"><span>Rate</span><span>Net</span><span>VAT</span><span></span></div>
                  ${form.vat_lines.map((l, i) => html`
                    <div class="vat-line">
                      <select value=${l.rate === null ? 'none' : l.rate} onChange=${(e) => onRate(i, e.target.value)}>${rateOptions(l.rate)}</select>
                      <input inputmode="decimal" aria-label="Net" value=${l.net} onInput=${(e) => setLine(i, { net: e.target.value })} />
                      <input inputmode="decimal" aria-label="VAT" disabled=${l.rate === null} value=${l.rate === null ? '0.00' : l.vat} onInput=${(e) => setLine(i, { vat: e.target.value })} />
                      <span class="line-actions">
                        <button type="button" class="link" title="Fill from the total" onClick=${() => splitTotal(i)}>Fill</button>
                        <button type="button" class="link danger" title="Remove" onClick=${() => set({ vat_lines: form.vat_lines.filter((_, j) => j !== i) })}>✕</button>
                      </span>
                    </div>`)}
                  <p class=${isNum(value.total) && Math.abs(sum - value.total) > 0.02 * form.vat_lines.length ? 'hint bad' : 'hint'}>
                    Net + VAT = ${money(sum, form.currency)}${isNum(value.total) ? ` · total ${money(value.total, form.currency)}` : ''}
                  </p>
                </div>`}
              <button type="button" class="link" onClick=${addLine}>+ ${form.vat_lines.length ? 'Add another rate' : 'Add VAT'}</button>
            </div>

            <label>Notes<textarea rows="2" value=${form.notes || ''} onInput=${(e) => set({ notes: e.target.value })}></textarea></label>
          </fieldset>

          ${!readOnly && html`
            <div class=${todo.length ? 'note' : 'note good'}>${todo.length ? `Missing: ${todo.join(', ')}.` : 'Complete.'}</div>
            ${badNumbers && html`<div class="note bad">One of the amounts isn’t a number.</div>`}
            ${msg && html`<p class="msg">${msg}</p>`}
            <div class="actions">
              <button class="primary" disabled=${!!busy || badNumbers}>${busy === 'save' ? 'Saving…' : todo.length ? 'Save' : 'Save as done'}</button>
              ${receipt.file_path && html`<button type="button" disabled=${!!busy} onClick=${again}>${busy === 'read' ? 'Reading…' : 'Read again'}</button>`}
              <button type="button" class="danger" disabled=${!!busy} onClick=${remove}>Delete</button>
            </div>`}
        </form>
      </div>
    </div>`;
}

// ---------- quarter overview ----------

function SummaryTable({ groups, sum, totalLabel }) {
  const dash = (g, v) => (g.key.endsWith(':unknown') ? '–' : money(v));
  return html`
    <table class="summary">
      <thead><tr><th>VAT category</th><th class="n">Receipts</th><th class="n">Net</th><th class="n">VAT</th><th class="n">Gross</th></tr></thead>
      <tbody>${groups.map((g) => html`<tr><td>${g.label}</td><td class="n">${g.count}</td><td class="n">${dash(g, g.net)}</td><td class="n">${dash(g, g.vat)}</td><td class="n">${money(g.gross)}</td></tr>`)}</tbody>
      <tfoot><tr><td>${totalLabel}</td><td class="n">${sum.count}</td><td class="n">${money(sum.net)}</td><td class="n">${money(sum.vat)}</td><td class="n">${money(sum.gross)}</td></tr></tfoot>
    </table>`;
}

function Quarter({ receipts, arg, owner }) {
  const def = defaultQuarter();
  const [y, q] = arg ? arg.split('-').map(Number) : [def.year, def.q];
  const year = y || def.year, quarter = q || def.q;
  const [busy, setBusy] = useState('');
  const { start, end } = quarterRange(year, quarter);
  const inQ = useMemo(() => receipts.filter((r) => r.receipt_date && r.receipt_date >= start && r.receipt_date <= end), [receipts, start]);
  const undated = receipts.filter((r) => !r.receipt_date && r.status !== 'processing');
  const s = useMemo(() => summarize(inQ), [inQ]);
  const nums = useMemo(() => new Map(numbered(inQ).map((n) => [n.r.id, n.no])), [inQ]);
  const step = (d) => { let yy = year, qq = quarter + d; if (qq < 1) { qq = 4; yy--; } if (qq > 4) { qq = 1; yy++; } go(`quarter/${yy}-${qq}`); };
  const meta = { title: `Q${quarter} ${year}`, owner, fileBase: `Receipts ${year}-Q${quarter}` };

  const run = async (label, fn) => {
    setBusy(label);
    try { await fn(); } catch (e) { alert(e.message); } finally { setBusy(''); }
  };

  return html`
    <div class="quarter">
      <div class="qhead">
        <button class="icon" onClick=${() => step(-1)} aria-label="Previous quarter">‹</button>
        <h1>${quarterLabel(year, quarter)}</h1>
        <button class="icon" onClick=${() => step(1)} aria-label="Next quarter">›</button>
      </div>
      <p class="print-only">${owner} · printed ${new Date().toLocaleDateString('en-US')}</p>

      ${s.open.length > 0 && html`
        <div class="note">${s.open.length} receipt${s.open.length > 1 ? 's' : ''} in this quarter still need${s.open.length > 1 ? '' : 's'} checking:
          ${s.open.map((r, i) => html`${i ? ', ' : ' '}<a href=${`#/r/${r.id}`}>${r.store || r.description || fmtDate(r.receipt_date)}</a>`)}.</div>`}
      ${undated.length > 0 && html`<div class="note">${undated.length} receipt${undated.length > 1 ? 's have' : ' has'} no date and ${undated.length > 1 ? 'are' : 'is'} not in any quarter. <a href="#/">Fix in the list</a>.</div>`}

      ${!s.groups.length && html`<section class="card"><p class="hint">No receipts in this quarter.</p></section>`}

      ${s.home.groups.length > 0 && html`
        <h2>Netherlands</h2>
        <section class="card">
          <${SummaryTable} groups=${s.home.groups} sum=${s.home} totalLabel="Total Netherlands" />
          <p class="hint">Dutch VAT to deduct (input tax): <strong>${money(s.homeVat)}</strong>${s.weakVat > 0 ? html`, of which <strong>${money(s.weakVat)}</strong> rests on a payment receipt or no document` : ''}</p>
        </section>`}

      ${s.foreign.groups.length > 0 && html`
        <h2>Foreign VAT</h2>
        <section class="card">
          <${SummaryTable} groups=${s.foreign.groups} sum=${s.foreign} totalLabel="Total foreign" />
          ${s.foreign.countries.length > 1 && html`
            <table class="summary per-country">
              <thead><tr><th>Per country</th><th class="n">Receipts</th><th class="n">Net</th><th class="n">VAT</th><th class="n">Gross</th></tr></thead>
              <tbody>${s.foreign.countries.map((c) => html`<tr><td>${c.name}</td><td class="n">${c.count}</td><td class="n">${money(c.net)}</td><td class="n">${money(c.vat)}</td><td class="n">${money(c.gross)}</td></tr>`)}</tbody>
            </table>`}
          <p class="hint">Foreign VAT: <strong>${money(s.foreignVat)}</strong>. Not deductible on your Dutch VAT return; within the EU it can be reclaimed from that country (EU VAT refund).</p>
        </section>`}

      ${s.groups.length > 0 && html`<p class="hint">All amounts in EUR; foreign currencies at the ECB rate on the receipt date. ${inQ.length} receipts, ${money(s.total.gross)} in total.</p>`}

      <div class="actions no-print">
        <button class="primary" disabled=${!inQ.length || !!busy} onClick=${() => run('Excel…', () => downloadExcel(inQ, meta))}>Download Excel</button>
        <button disabled=${!inQ.length || !!busy} onClick=${() => run('PDF…', () => downloadPdf(inQ, meta, (n, t) => setBusy(`PDF: photo ${n} of ${t}…`)))}>Download PDF</button>
        <button disabled=${!inQ.length || !!busy} onClick=${() => run('ZIP…', () => downloadZip(inQ, meta, (n, t) => setBusy(`ZIP: photo ${n} of ${t}…`)))}>ZIP with photos</button>
        ${busy && html`<span class="hint">${busy}</span>`}
      </div>

      ${s.groups.map((g) => html`
        <section class="detail">
          <h2>${g.label}</h2>
          <div class="card">
            <table>
              <thead><tr><th>No.</th><th>Date</th><th>Store / description</th><th class="n">Net</th><th class="n">VAT</th><th class="n">Gross</th></tr></thead>
              <tbody>
                ${[...g.rows].sort((a, b) => nums.get(a.receipt.id) - nums.get(b.receipt.id)).map((row) => html`
                  <tr>
                    <td>${nums.get(row.receipt.id)}</td>
                    <td class="nowrap">${row.receipt.receipt_date}</td>
                    <td><a href=${`#/r/${row.receipt.id}`}>${row.receipt.store || '–'}</a>${row.receipt.description ? html`<small> · ${row.receipt.description}</small>` : ''}
                      ${row.receipt.currency !== 'EUR' ? html`<small> · ${money(row.gross_orig, row.receipt.currency)}</small>` : ''}
                      ${weakProof(row.receipt) ? html` <span class="badge st-weak">${DOC_TYPES[row.receipt.doc_type]}</span>` : ''}
                      ${row.receipt.status !== 'done' ? html` <${Badge} status=${row.receipt.status} />` : ''}</td>
                    <td class="n">${money(row.net)}</td><td class="n">${money(row.vat)}</td><td class="n">${money(row.gross)}</td>
                  </tr>`)}
              </tbody>
              <tfoot><tr><td colspan="3">Subtotal</td><td class="n">${money(g.net)}</td><td class="n">${money(g.vat)}</td><td class="n">${money(g.gross)}</td></tr></tfoot>
            </table>
          </div>
        </section>`)}
    </div>`;
}

// ---------- settings ----------

function Settings({ user, viewers, sharedWithMe, reload }) {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const add = async (e) => {
    e.preventDefault();
    try { await api.addShare(email); setEmail(''); setMsg(''); reload(); } catch (err) { setMsg(err.message.includes('duplicate') ? 'Already shared with that address.' : err.message); }
  };
  const remove = async (s) => {
    if (!confirm(`Stop sharing with ${s.viewer_email}?`)) return;
    await api.removeShare(s.owner_id, s.viewer_email).catch((e) => setMsg(e.message));
    reload();
  };
  const appUrl = location.origin + location.pathname;

  return html`
    <div class="settings">
      <section class="card">
        <h3>Account</h3>
        <p>Signed in as <strong>${user.email}</strong></p>
        <button onClick=${() => { localStorage.removeItem('owner'); api.sb.auth.signOut(); }}>Sign out</button>
      </section>

      <section class="card">
        <h3>Share with your accountant</h3>
        <p class="hint">They can see your receipts and photos and download the quarter overviews, but can’t change anything.
          Send them this address: <a href=${appUrl}>${appUrl}</a>. They create an account there with the email address below and confirm it.</p>
        <form class="row-form" onSubmit=${add}>
          <input type="email" required placeholder="accountant@example.com" value=${email} onInput=${(e) => setEmail(e.target.value)} />
          <button class="primary">Share</button>
        </form>
        ${msg && html`<p class="msg">${msg}</p>`}
        ${viewers.map((s) => html`<div class="row"><span class="what">${s.viewer_email}</span><button class="link danger" onClick=${() => remove(s)}>Stop sharing</button></div>`)}
      </section>

      ${sharedWithMe.length > 0 && html`
        <section class="card">
          <h3>Shared with you</h3>
          ${sharedWithMe.map((s) => html`<div class="row"><span class="what">${s.owner_email}</span></div>`)}
          <p class="hint">Switch accounts with the menu at the top.</p>
        </section>`}

      <section class="card">
        <h3>Install on your devices</h3>
        <p class="hint"><strong>iPhone / iPad:</strong> Safari → Share → Add to Home Screen. <strong>Mac:</strong> Safari → File → Add to Dock. Everything syncs through your account.</p>
      </section>
      <p class="hint center">Receipts ${VERSION}</p>
    </div>`;
}

// ---------- boot ----------

async function boot() {
  const root = document.getElementById('app');
  try {
    await api.initClient();
  } catch (err) {
    root.innerHTML = '<p class="boot">Can’t reach the server. Check your connection and reload.</p>';
    return;
  }
  root.textContent = '';
  render(html`<${App} />`, root);
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const hadController = !!navigator.serviceWorker.controller;
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController && !reloaded) { reloaded = true; location.reload(); }
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then((reg) => document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update()))
      .catch(console.warn);
  }
}

boot();
