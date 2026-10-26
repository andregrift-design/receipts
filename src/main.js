import { html, render, useState, useEffect, useRef, useMemo } from './ui.js';
import * as api from './api.js';
import {
  CATEGORIES, CURRENCIES, COUNTRIES, RATES, HOME_COUNTRY, money, fmtDate, problems, splitGross, linesSum,
  fxFor, isNum, round2, quarterOf, quarterRange, quarterLabel, summarize, countryName, DOC_TYPES, weakProof,
  usdConversion, eurConversion, JOB_KINDS, DEDUCTION_TYPES, lineTotal, statementAsReceipt, statementProblems, summarizeIncome, mergeCategories, neg,
} from './vat.js';
import { downloadExcel, downloadPdf, downloadZip, numbered } from './export.js';

const VERSION = '1.7.1';

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
        <img src="icons/icon-192.png" alt="VH5" class="auth-logo" />
        <h1>VH5</h1>
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
  const [statements, setStatements] = useState(null);
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

  const refresh = () => Promise.all([api.listReceipts(ownerId), api.listStatements(ownerId)])
    .then(([r, st]) => { setReceipts(r); setStatements(st); setLoadError(''); }).catch((e) => setLoadError(e.message));
  // Apply a realtime change to a list.
  const patch = (p) => (list) => {
    if (!list) return list;
    if (p.eventType === 'DELETE') return list.filter((r) => r.id !== p.old.id);
    const i = list.findIndex((r) => r.id === p.new.id);
    if (i < 0) return [p.new, ...list];
    const copy = [...list];
    copy[i] = p.new;
    return copy;
  };
  const refreshQueue = () => api.queued().then((q) => setQueue(q.filter((i) => i.userId === user.id))).catch(() => {});

  useEffect(() => {
    refresh();
    const stopR = api.watchReceipts(ownerId, (p) => setReceipts(patch(p)));
    const stopS = api.watchReceipts(ownerId, (p) => setStatements(patch(p)), 'statements');
    const stop = () => { stopR(); stopS(); };
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

  const addFiles = async (files, kind = 'receipt') => {
    if (!files?.length) return;
    if (!mine) setOwner(user.id);
    try {
      await api.addFiles([...files], user.id, kind);
    } catch (e) {
      alert(e.message);
    }
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
    addFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf'), view === 'income' || view === 's' ? 'statement' : 'receipt');
  };

  const [view, arg] = route;
  const open = receipts?.filter((r) => r.status !== 'done').length || 0;
  const openSt = statements?.filter((r) => r.status !== 'done').length || 0;
  let body;
  if (!receipts || !statements) body = html`<p class="boot">${loadError || 'Loading receipts…'}</p>`;
  else if (view === 'r') {
    const r = receipts.find((x) => x.id === arg);
    body = r ? html`<${Editor} receipt=${r} readOnly=${!mine} key=${r.id} />` : html`<p class="boot">Receipt not found. <a href="#/">Back</a></p>`;
  } else if (view === 's') {
    const st = statements.find((x) => x.id === arg);
    body = st ? html`<${StatementEditor} statement=${st} readOnly=${!mine} key=${st.id} />` : html`<p class="boot">Statement not found. <a href="#/income">Back</a></p>`;
  } else if (view === 'income') body = html`<${Income} statements=${statements} queue=${mine ? queue.filter((i) => i.kind === 'statement') : []} canAdd=${mine} addFiles=${(f) => addFiles(f, 'statement')} />`;
  else if (view === 'quarter') body = html`<${Quarter} receipts=${receipts} statements=${statements} arg=${arg} owner=${ownerLabel} />`;
  else if (view === 'settings') body = html`<${Settings} user=${user} viewers=${myViewers} sharedWithMe=${sharedWithMe} reload=${loadShares} />`;
  else body = html`<${List} receipts=${receipts} queue=${mine ? queue.filter((i) => i.kind !== 'statement') : []} canAdd=${mine} addFiles=${addFiles} addManual=${addManual} />`;

  return html`
    <div class="app ${dragging ? 'dragging' : ''}"
      onDragOver=${(e) => { if (mine) { e.preventDefault(); setDragging(true); } }}
      onDragLeave=${(e) => { if (e.target === e.currentTarget) setDragging(false); }}
      onDrop=${mine ? onDrop : undefined}>
      <header class="topbar">
        <a class="brand" href="#/"><img src="icons/icon-192.png" alt="" />VH5</a>
        <nav class="tabs">
          <a class=${!view || view === 'r' ? 'on' : ''} href="#/">Receipts${open ? html` <span class="count">${open}</span>` : ''}</a>
          <a class=${view === 'income' || view === 's' ? 'on' : ''} href="#/income">Income${openSt ? html` <span class="count">${openSt}</span>` : ''}</a>
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
      ${dragging && html`<div class="dropzone">${view === 'income' || view === 's' ? 'Drop agency statements to import them' : 'Drop receipts to add them'}</div>`}
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
          ${api.lastUploadError && html`<p class="hint bad">Upload problem: ${api.lastUploadError}</p>`}
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
    api.ecbRate(form.currency, form.receipt_date).then((r) => r && setForm((f) => ({ ...f, fx_rate: String(r.rate), fx_date: r.date }))).catch(() => {});
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
                  <input inputmode="decimal" value=${form.fx_rate} onInput=${(e) => { fxTouched.current = true; set({ fx_rate: e.target.value, fx_date: null }); }} />
                </label>
                <p class="hint fx">${fx == null ? 'Fills in from the ECB once the date is set.' : html`
                  1 ${form.currency} = ${fx.toFixed(4)} EUR · ${form.fx_date ? `ECB rate of ${fmtDate(form.fx_date)}${form.fx_date !== form.receipt_date ? ' (last business day before the receipt date)' : ''}` : 'rate entered by hand'}
                  ${isNum(value.total) ? html`<br /><strong>${money(value.total, form.currency)} = ${money(value.total * fx)}</strong>` : ''}`}</p>
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

// ---------- agency statements (income) ----------

function Income({ statements, queue, canAdd, addFiles }) {
  const input = useRef();
  const groups = [];
  for (const st of statements) {
    const key = st.statement_date ? st.statement_date.slice(0, 7) : (st.status === 'processing' ? 'new' : 'nodate');
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, items: [] }));
    g.items.push(st);
  }
  const order = (k) => (k === 'new' ? '9999' : k === 'nodate' ? '9998' : k);
  groups.sort((a, b) => order(b.key).localeCompare(order(a.key)));
  const title = (k) => (k === 'new' ? 'Just added' : k === 'nodate' ? 'No date' : new Date(k + '-15').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
  return html`
    <div class="list">
      ${canAdd && html`
        <div class="add">
          <button class="primary big" onClick=${() => input.current.click()}>Import agency statement</button>
          <input ref=${input} type="file" accept="application/pdf,image/*" multiple hidden onChange=${(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        </div>
        <p class="hint">PDF or photo of a payment statement from an agency, from any country or currency. Claude reads the agency, the jobs, fees, VAT and deductions; you check the result. On a laptop you can also drop the files here.</p>`}
      ${queue.length > 0 && html`
        <section class="card">${queue.map((i) => html`<div class="row"><span class="what">Statement from ${new Date(i.added).toLocaleString('en-US')}</span><${Badge} status="queued" /></div>`)}
          ${api.lastUploadError && html`<p class="hint bad">Upload problem: ${api.lastUploadError}</p>`}</section>`}
      ${!statements.length && !queue.length && html`<div class="empty"><p>No agency statements yet.</p></div>`}
      ${groups.map((g) => html`
        <section class="month">
          <h2>${title(g.key)}</h2>
          <div class="card">
            ${g.items.map((st) => html`
              <a class="row" href=${`#/s/${st.id}`}>
                <span class="what">
                  <strong>${st.agency || (st.status === 'processing' ? 'Reading statement…' : 'Unknown agency')}</strong>
                  <small>${[st.statement_date && fmtDate(st.statement_date), st.agency_country && countryName(st.agency_country),
                    (st.lines || []).map((l) => l.client).filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</small>
                </span>
                <span class="amount">${money(st.total_paid, st.currency || 'EUR')}
                  ${st.currency && st.currency !== 'EUR' && isNum(st.total_paid) && isNum(st.fx_rate) && html`<small>${money(st.total_paid * st.fx_rate)}</small>`}</span>
                ${st.status !== 'done' && html`<${Badge} status=${st.status} />`}
              </a>`)}
          </div>
        </section>`)}
    </div>`;
}

const emptyLine = () => ({ job_date: '', client: '', description: '', invoice_no: '', kind: 'day_rate', fee: '', vat_rate: '0', vat: '0', expenses: '0', deductions: [] });

function stToForm(st) {
  const s = (v) => (isNum(v) ? Number(v).toFixed(2) : '');
  return {
    ...st,
    total_paid: s(st.total_paid),
    fx_rate: st.currency === 'EUR' ? '' : (st.fx_rate ?? '') + '',
    lines: (st.lines || []).map((l) => ({
      ...l, job_date: l.job_date || '', fee: s(l.fee), vat_rate: String(l.vat_rate ?? 0), vat: s(l.vat ?? 0), expenses: s(l.expenses ?? 0),
      deductions: (l.deductions || []).map((d) => ({ ...d, amount: s(d.amount), vat: s(d.vat ?? 0) })),
    })),
  };
}

function stFromForm(f) {
  return {
    ...f,
    total_paid: parseNum(f.total_paid),
    fx_rate: f.currency === 'EUR' ? 1 : parseNum(f.fx_rate),
    lines: f.lines.map((l) => ({
      ...l, fee: parseNum(l.fee), vat_rate: parseNum(l.vat_rate) ?? 0, vat: parseNum(l.vat) ?? 0, expenses: parseNum(l.expenses) ?? 0,
      deductions: l.deductions.map((d) => ({ ...d, amount: parseNum(d.amount), vat: parseNum(d.vat) ?? 0 })),
    })),
  };
}

function StatementEditor({ statement, readOnly }) {
  const [form, setForm] = useState(() => stToForm(statement));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const fxTouched = useRef(false);
  useEffect(() => { if (!dirty) setForm(stToForm(statement)); }, [statement.updated_at]);

  const set = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true); setMsg(''); };
  const setLine = (i, patch) => set({ lines: form.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const setDed = (i, k, patch) => setLine(i, { deductions: form.lines[i].deductions.map((d, j) => (j === k ? { ...d, ...patch } : d)) });

  useEffect(() => {
    if (readOnly || !dirty || form.currency === 'EUR' || fxTouched.current || !form.statement_date) return;
    api.ecbRate(form.currency, form.statement_date).then((r) => r && setForm((f) => ({ ...f, fx_rate: String(r.rate), fx_date: r.date }))).catch(() => {});
  }, [form.currency, form.statement_date]);

  const value = stFromForm(form);
  const todo = statementProblems(value);
  const sum = round2(value.lines.reduce((t, l) => t + lineTotal(l), 0));
  const fx = fxFor(statementAsReceipt(value));
  const foreign = form.agency_country !== HOME_COUNTRY;

  const save = async () => {
    setBusy('save');
    try {
      const saved = await api.saveStatement(value);
      setDirty(false);
      setForm(stToForm(saved));
      if (saved.status === 'done') go('income');
      else setMsg('Saved. Still to do: ' + statementProblems(saved).join(', ') + '.');
    } catch (e) { setMsg(e.message); } finally { setBusy(''); }
  };
  const again = async () => {
    if (dirty && !confirm('Discard your changes and read the statement again?')) return;
    setBusy('read'); setDirty(false); fxTouched.current = false;
    try { setForm(stToForm(await api.readAgain(statement.id, 'statement'))); } catch (e) { setMsg(e.message); } finally { setBusy(''); }
  };
  const remove = async () => {
    if (!confirm('Delete this statement and its document?')) return;
    setBusy('delete');
    try { await api.deleteStatement(statement); go('income'); } catch (e) { setMsg(e.message); setBusy(''); }
  };
  const vatFill = (i) => {
    const l = value.lines[i];
    if (isNum(l.fee) && isNum(l.vat_rate)) setLine(i, { vat: (round2(l.fee * l.vat_rate / 100)).toFixed(2) });
  };

  return html`
    <div class="editor">
      <div class="editor-head">
        <a href="#/income" class="back">‹ Income</a>
        <${Badge} status=${statement.status} />
      </div>
      <div class="editor-body">
        <${Preview} r=${statement} />
        <form class="card form" onSubmit=${(e) => { e.preventDefault(); save(); }}>
          ${statement.status === 'processing' && html`<div class="note">Claude is reading this statement. The fields fill in by themselves in a few seconds.</div>`}
          ${statement.error && html`<div class="note bad">Reading failed: ${statement.error}</div>`}
          ${statement.issues?.length > 0 && html`<div class="note"><strong>Check:</strong><ul>${statement.issues.map((i) => html`<li>${i}</li>`)}</ul></div>`}
          <fieldset disabled=${readOnly}>
            <div class="grid-addr">
              <label>Agency<input value=${form.agency || ''} onInput=${(e) => set({ agency: e.target.value })} /></label>
              <label>Country
                <select value=${form.agency_country} onChange=${(e) => set({ agency_country: e.target.value })}>
                  ${[...new Set([...Object.keys(COUNTRIES), form.agency_country])].map((k) => html`<option value=${k}>${countryName(k)}</option>`)}
                </select>
              </label>
            </div>
            <label>Address<input value=${form.agency_address || ''} onInput=${(e) => set({ agency_address: e.target.value })} /></label>
            <div class="grid3">
              <label>Statement no.<input value=${form.statement_no || ''} onInput=${(e) => set({ statement_no: e.target.value })} /></label>
              <label>Payment date<input type="date" value=${form.statement_date || ''} onInput=${(e) => set({ statement_date: e.target.value })} /></label>
              <label>Currency
                <select value=${form.currency} onChange=${(e) => { fxTouched.current = false; set({ currency: e.target.value }); }}>
                  ${[...new Set([...CURRENCIES, form.currency])].map((c) => html`<option value=${c}>${c}</option>`)}
                </select>
              </label>
            </div>
            ${form.currency !== 'EUR' && html`
              <div class="grid2">
                <label>Exchange rate (EUR per ${form.currency})
                  <input inputmode="decimal" value=${form.fx_rate} onInput=${(e) => { fxTouched.current = true; set({ fx_rate: e.target.value, fx_date: null }); }} />
                </label>
                <p class="hint fx">${fx == null ? 'Fills in from the ECB once the date is set.' : `1 ${form.currency} = ${fx.toFixed(4)} EUR · ${form.fx_date ? `ECB rate of ${fmtDate(form.fx_date)}` : 'rate entered by hand'}`}</p>
              </div>`}
            ${foreign && html`<p class="hint">Foreign agency: usually no Dutch VAT on your fee (reverse charge). Agency fees it charges without VAT are reverse-charged: Dutch VAT on them is due and deductible at the same time.</p>`}

            ${form.lines.map((l, i) => html`
              <div class="job">
                <div class="job-head"><h3>Job ${i + 1}</h3>
                  <button type="button" class="link danger" onClick=${() => set({ lines: form.lines.filter((_, j) => j !== i) })}>Remove job</button></div>
                <div class="grid2">
                  <label>Client<input value=${l.client || ''} onInput=${(e) => setLine(i, { client: e.target.value })} /></label>
                  <label>Job date<input type="date" value=${l.job_date || ''} onInput=${(e) => setLine(i, { job_date: e.target.value })} /></label>
                </div>
                <label>Job<input value=${l.description || ''} onInput=${(e) => setLine(i, { description: e.target.value })} /></label>
                <div class="grid2">
                  <label>Type
                    <select value=${l.kind || 'other'} onChange=${(e) => setLine(i, { kind: e.target.value })}>
                      ${Object.entries(JOB_KINDS).map(([k, v]) => html`<option value=${k}>${v}</option>`)}
                    </select>
                  </label>
                  <label>Invoice no.<input value=${l.invoice_no || ''} onInput=${(e) => setLine(i, { invoice_no: e.target.value })} /></label>
                </div>
                <div class="grid4">
                  <label>Fee<input inputmode="decimal" value=${l.fee} onInput=${(e) => setLine(i, { fee: e.target.value })} /></label>
                  <label>VAT %<input inputmode="decimal" value=${l.vat_rate} onInput=${(e) => setLine(i, { vat_rate: e.target.value })} onBlur=${() => vatFill(i)} /></label>
                  <label>VAT<input inputmode="decimal" value=${l.vat} onInput=${(e) => setLine(i, { vat: e.target.value })} /></label>
                  <label>Expenses<input inputmode="decimal" value=${l.expenses} onInput=${(e) => setLine(i, { expenses: e.target.value })} /></label>
                </div>
                ${l.deductions.length > 0 && html`<div class="ded-line labels"><span>Deduction</span><span>Description</span><span>Amount</span><span>VAT</span><span></span></div>`}
                ${l.deductions.map((d, k) => html`
                  <div class="ded-line">
                    <select value=${d.type || 'other'} onChange=${(e) => setDed(i, k, { type: e.target.value })}>
                      ${Object.entries(DEDUCTION_TYPES).map(([key, v]) => html`<option value=${key}>${v}</option>`)}
                    </select>
                    <input value=${d.label || ''} placeholder="As printed" onInput=${(e) => setDed(i, k, { label: e.target.value })} />
                    <input inputmode="decimal" aria-label="Amount" value=${d.amount} onInput=${(e) => setDed(i, k, { amount: e.target.value })} />
                    <input inputmode="decimal" aria-label="VAT" value=${d.vat} onInput=${(e) => setDed(i, k, { vat: e.target.value })} />
                    <button type="button" class="link danger" onClick=${() => setLine(i, { deductions: l.deductions.filter((_, j) => j !== k) })}>✕</button>
                    ${foreign && d.type !== 'tax_withheld' && html`<label class="rc"><input type="checkbox" checked=${!!d.reverse_charge} onChange=${(e) => setDed(i, k, { reverse_charge: e.target.checked })} /> Reverse charge</label>`}
                  </div>`)}
                <div class="job-foot">
                  <button type="button" class="link" onClick=${() => setLine(i, { deductions: [...l.deductions, { type: 'agency_fee', label: '', amount: '', vat: '0', reverse_charge: foreign }] })}>+ Add deduction</button>
                  <span class="hint">Paid for this job: <strong>${money(lineTotal(value.lines[i]), form.currency)}</strong></span>
                </div>
              </div>`)}
            <button type="button" class="link" onClick=${() => set({ lines: [...form.lines, emptyLine()] })}>+ Add job</button>

            <div class="grid2 total-paid">
              <label>Amount paid (statement total)<input inputmode="decimal" value=${form.total_paid} onInput=${(e) => set({ total_paid: e.target.value })} /></label>
              <p class=${isNum(value.total_paid) && Math.abs(sum - value.total_paid) > 0.02 * Math.max(1, form.lines.length) ? 'hint bad fx' : 'hint fx'}>Jobs add up to ${money(sum, form.currency)}</p>
            </div>
            <label>Notes<textarea rows="2" value=${form.notes || ''} onInput=${(e) => set({ notes: e.target.value })}></textarea></label>
          </fieldset>
          ${!readOnly && html`
            <div class=${todo.length ? 'note' : 'note good'}>${todo.length ? `Missing: ${todo.join(', ')}.` : 'Complete.'}</div>
            ${msg && html`<p class="msg">${msg}</p>`}
            <div class="actions">
              <button class="primary" disabled=${!!busy}>${busy === 'save' ? 'Saving…' : todo.length ? 'Save' : 'Save as done'}</button>
              ${statement.file_path && html`<button type="button" disabled=${!!busy} onClick=${again}>${busy === 'read' ? 'Reading…' : 'Read again'}</button>`}
              <button type="button" class="danger" disabled=${!!busy} onClick=${remove}>Delete</button>
            </div>`}
        </form>
      </div>
    </div>`;
}

// ---------- quarter overview ----------

function SummaryTable({ groups, sum, totalLabel, cur }) {
  const m = (v) => money(v, cur);
  const dash = (g, v) => (g.key.endsWith(':unknown') ? '–' : m(v));
  return html`
    <table class="summary">
      <thead><tr><th>VAT category</th><th class="n">Receipts</th><th class="n">Net</th><th class="n">VAT</th><th class="n">Gross</th></tr></thead>
      <tbody>${groups.map((g) => html`<tr><td>${g.label}</td><td class="n">${g.count}</td><td class="n">${dash(g, g.net)}</td><td class="n">${dash(g, g.vat)}</td><td class="n">${m(g.gross)}</td></tr>`)}</tbody>
      <tfoot><tr><td>${totalLabel}</td><td class="n">${sum.count}</td><td class="n">${m(sum.net)}</td><td class="n">${m(sum.vat)}</td><td class="n">${m(sum.gross)}</td></tr></tfoot>
    </table>`;
}

// Report currency: EUR for the Dutch accountant, USD for the US CPA (converted on the receipt date).
const getReportCurrency = () => localStorage.getItem('reportCurrency') || 'EUR';

function Quarter({ receipts, statements, arg, owner }) {
  const def = defaultQuarter();
  const [y, q] = arg ? arg.split('-').map(Number) : [def.year, def.q];
  const year = y || def.year, quarter = Number.isInteger(q) && q >= 0 && q <= 4 ? q : def.q;
  const [busy, setBusy] = useState('');
  const [cur, setCur] = useState(getReportCurrency());
  const [usd, setUsd] = useState(null); // { start, lookup } or { error }
  const { start, end } = quarterRange(year, quarter);
  const inQ = useMemo(() => receipts.filter((r) => r.receipt_date && r.receipt_date >= start && r.receipt_date <= end), [receipts, start, end]);
  const undated = receipts.filter((r) => !r.receipt_date && r.status !== 'processing');
  // Agency statements count in the period of their statement (payment) date.
  const stInQ = useMemo(() => statements.filter((st) => st.statement_date && st.statement_date >= start && st.statement_date <= end), [statements, start, end]);

  useEffect(() => {
    if (cur !== 'USD' || (usd && usd.start === start && usd.end === end)) return;
    setUsd(null);
    api.eurUsdRates(start, end < new Date().toISOString().slice(0, 10) ? end : new Date().toISOString().slice(0, 10))
      .then((lookup) => setUsd({ start, end, lookup }))
      .catch((e) => setUsd({ start, end, error: e.message }));
  }, [cur, start, end]);

  const conv = useMemo(() => (cur === 'USD' ? (usd?.lookup ? usdConversion(usd.lookup) : null) : eurConversion), [cur, usd]);
  const s = useMemo(() => (conv ? summarize(inQ, conv.factor) : null), [inQ, conv]);
  const inc = useMemo(() => (conv ? summarizeIncome(stInQ, conv.factor) : null), [stInQ, conv]);
  const cats = s && inc ? mergeCategories(s.categories, inc.categories) : [];
  // Dutch VAT return: VAT on income minus deductible VAT (receipts and Dutch agency deductions). Reverse charge cancels out.
  const vatDue = s && inc ? round2(inc.homeVat + inc.reverseCharge - s.homeVat - inc.deductionVat - inc.reverseCharge) : 0;
  const nums = useMemo(() => new Map(numbered(inQ).map((n) => [n.r.id, n.no])), [inQ]);
  const m = (v) => money(v, cur);
  const step = (d) => {
    if (!quarter) return go(`quarter/${year + d}-0`);
    let yy = year, qq = quarter + d; if (qq < 1) { qq = 4; yy--; } if (qq > 4) { qq = 1; yy++; } go(`quarter/${yy}-${qq}`);
  };
  const setCurrency = (c) => { localStorage.setItem('reportCurrency', c); setCur(c); };
  const title = quarter ? `Q${quarter} ${year}` : `${year}`;
  const meta = { title: `${title}${cur === 'USD' ? ' (USD)' : ''}`, owner, currency: cur, conv, statements: stInQ, fileBase: `VH5 receipts ${quarter ? `${year}-Q${quarter}` : year}${cur === 'USD' ? ' USD' : ''}` };

  const run = async (label, fn) => {
    setBusy(label);
    try { await fn(); } catch (e) { alert(e.message); } finally { setBusy(''); }
  };
  const ready = !!s && (inQ.length > 0 || stInQ.length > 0) && !busy;

  return html`
    <div class="quarter">
      <div class="qhead">
        <button class="icon" onClick=${() => step(-1)} aria-label="Previous period">‹</button>
        <h1>${quarterLabel(year, quarter)}</h1>
        <button class="icon" onClick=${() => step(1)} aria-label="Next period">›</button>
      </div>
      <div class="qswitch">
        <div class="seg">
          ${[1, 2, 3, 4].map((n) => html`<a class=${quarter === n ? 'on' : ''} href=${`#/quarter/${year}-${n}`}>Q${n}</a>`)}
          <a class=${!quarter ? 'on' : ''} href=${`#/quarter/${year}-0`}>Year</a>
        </div>
        <div class="seg">
          <button class=${cur === 'EUR' ? 'on' : ''} onClick=${() => setCurrency('EUR')}>EUR · Dutch accountant</button>
          <button class=${cur === 'USD' ? 'on' : ''} onClick=${() => setCurrency('USD')}>USD · US CPA</button>
        </div>
      </div>

      ${cur === 'USD' && !usd && html`<p class="hint">Loading USD exchange rates…</p>`}
      ${cur === 'USD' && usd?.error && html`<div class="note bad">${usd.error}</div>`}

      ${s && html`
      ${s.open.length > 0 && html`
        <div class="note">${s.open.length} receipt${s.open.length > 1 ? 's' : ''} in this period still need${s.open.length > 1 ? '' : 's'} checking:
          ${s.open.map((r, i) => html`${i ? ', ' : ' '}<a href=${`#/r/${r.id}`}>${r.store || r.description || fmtDate(r.receipt_date)}</a>`)}.</div>`}
      ${s.missingRate.length > 0 && html`<div class="note bad">No exchange rate for: ${s.missingRate.map((r, i) => html`${i ? ', ' : ''}<a href=${`#/r/${r.id}`}>${r.store || fmtDate(r.receipt_date)}</a>`)}. Their amounts are left out of the totals.</div>`}
      ${undated.length > 0 && html`<div class="note">${undated.length} receipt${undated.length > 1 ? 's have' : ' has'} no date and ${undated.length > 1 ? 'are' : 'is'} not in any period. <a href="#/">Fix in the list</a>.</div>`}

      ${!s.groups.length && !stInQ.length && html`<section class="card"><p class="hint">No receipts or statements in this period.</p></section>`}

      ${inc.count > 0 && html`
        <h2>Income (agency statements)</h2>
        <section class="card">
          ${inc.missingRate.length > 0 && html`<div class="note bad">No exchange rate for ${inc.missingRate.map((st) => st.agency).join(', ')}; left out.</div>`}
          <table class="summary">
            <thead><tr><th>Agency</th><th class="n">Statements</th><th class="n">Fees</th><th class="n">VAT</th><th class="n">Deductions</th><th class="n">Paid</th></tr></thead>
            <tbody>${inc.agencies.map((a) => html`<tr><td>${a.agency} <small>${countryName(a.country)}</small></td><td class="n">${a.count}</td><td class="n">${m(a.fee)}</td><td class="n">${m(a.vat)}</td><td class="n">${m(neg(a.deductions))}</td><td class="n">${m(a.paid)}</td></tr>`)}</tbody>
            <tfoot><tr><td>Total</td><td class="n">${inc.count}</td><td class="n">${m(inc.fee)}</td><td class="n">${m(inc.vat)}</td><td class="n">${m(neg(inc.fee + inc.vat + inc.expenses - inc.paid))}</td><td class="n">${m(inc.paid)}</td></tr></tfoot>
          </table>
          <div class="income-split">
            <table class="summary">
              <thead><tr><th>Fees by type</th><th class="n">Amount</th></tr></thead>
              <tbody>${inc.kinds.map((k) => html`<tr><td>${k.label}</td><td class="n">${m(k.amount)}</td></tr>`)}</tbody>
            </table>
            ${inc.deductions.length > 0 && html`
              <table class="summary">
                <thead><tr><th>Deductions</th><th class="n">Amount</th></tr></thead>
                <tbody>${inc.deductions.map((d) => html`<tr><td>${d.label}</td><td class="n">${m(d.amount)}</td></tr>`)}</tbody>
              </table>`}
          </div>
          ${inc.expenses > 0 && html`<p class="hint">Expenses reimbursed by agencies: <strong>${m(inc.expenses)}</strong></p>`}
          ${inc.deductions.some((d) => d.key === 'tax_withheld') && html`<p class="hint">Tax withheld abroad is not a cost; it may be credited against your income tax.</p>`}
        </section>`}

      ${cur === 'EUR' && (inc.count > 0 || s.home.groups.length > 0) && html`
        <h2>Dutch VAT position</h2>
        <section class="card">
          <table class="summary">
            <tbody>
              <tr><td>VAT on income from Dutch agencies (to pay)</td><td class="n">${m(inc.homeVat)}</td></tr>
              ${inc.reverseCharge > 0 && html`<tr><td>Reverse-charge VAT on foreign agency fees (due)</td><td class="n">${m(inc.reverseCharge)}</td></tr>`}
              <tr><td>VAT on receipts (deductible)</td><td class="n">${m(neg(s.homeVat))}</td></tr>
              ${inc.deductionVat > 0 && html`<tr><td>VAT on Dutch agency deductions (deductible)</td><td class="n">${m(neg(inc.deductionVat))}</td></tr>`}
              ${inc.reverseCharge > 0 && html`<tr><td>Reverse-charge VAT on foreign agency fees (deductible)</td><td class="n">${m(neg(inc.reverseCharge))}</td></tr>`}
            </tbody>
            <tfoot><tr><td>${vatDue >= 0 ? 'To pay' : 'To get back'}</td><td class="n">${m(Math.abs(vatDue))}</td></tr></tfoot>
          </table>
          <p class="hint">Fees from foreign agencies carry no Dutch VAT (reverse charge or outside the EU) and belong in their own boxes on the VAT return. Your accountant decides the final return.</p>
        </section>`}

      ${s.home.groups.length > 0 && html`
        <h2>Netherlands</h2>
        <section class="card">
          <${SummaryTable} groups=${s.home.groups} sum=${s.home} totalLabel="Total Netherlands" cur=${cur} />
          <p class="hint">Dutch VAT to deduct (input tax): <strong>${m(s.homeVat)}</strong>${s.weakVat > 0 ? html`, of which <strong>${m(s.weakVat)}</strong> rests on a payment receipt or no document` : ''}</p>
        </section>`}

      ${s.foreign.groups.length > 0 && html`
        <h2>Foreign VAT</h2>
        <section class="card">
          <${SummaryTable} groups=${s.foreign.groups} sum=${s.foreign} totalLabel="Total foreign" cur=${cur} />
          ${s.foreign.countries.length > 1 && html`
            <table class="summary per-country">
              <thead><tr><th>Per country</th><th class="n">Receipts</th><th class="n">Net</th><th class="n">VAT</th><th class="n">Gross</th></tr></thead>
              <tbody>${s.foreign.countries.map((c) => html`<tr><td>${c.name}</td><td class="n">${c.count}</td><td class="n">${m(c.net)}</td><td class="n">${m(c.vat)}</td><td class="n">${m(c.gross)}</td></tr>`)}</tbody>
            </table>`}
          <p class="hint">Foreign VAT: <strong>${m(s.foreignVat)}</strong>. Not deductible on your Dutch VAT return; within the EU it can be reclaimed from that country (EU VAT refund).</p>
        </section>`}

      ${cats.length > 0 && html`
        <h2>Per expense category</h2>
        <section class="card">
          <table class="summary">
            <thead><tr><th>Category</th><th class="n">Receipts</th><th class="n">Net</th><th class="n">VAT</th><th class="n">Gross</th></tr></thead>
            <tbody>${cats.map((c) => html`<tr><td>${c.category}${c.fromStatements ? html` <small>incl. ${m(c.fromStatements)} deducted by agencies</small>` : ''}</td><td class="n">${c.count}</td><td class="n">${m(c.net)}</td><td class="n">${m(c.vat)}</td><td class="n">${m(c.gross)}</td></tr>`)}</tbody>
            <tfoot><tr><td>Total</td><td class="n">${s.total.count}</td><td class="n">${m(cats.reduce((t, c) => t + c.net, 0))}</td><td class="n">${m(s.total.vat)}</td><td class="n">${m(cats.reduce((t, c) => t + c.gross, 0))}</td></tr></tfoot>
          </table>
        </section>`}

      ${s.groups.length > 0 && html`<p class="hint">All amounts in ${cur}. ${cur === 'USD'
        ? 'Converted on each receipt date: receipt currency to EUR at the ECB rate, then EUR to USD at the ECB rate of that day (last business day before it on weekends and holidays). Receipts in USD are not converted.'
        : 'Foreign currencies at the ECB rate on the receipt date.'} ${inQ.length} receipts, ${m(s.total.gross)} in total.</p>`}
      `}

      <div class="actions">
        <button class="primary" disabled=${!ready} onClick=${() => run('Excel…', () => downloadExcel(inQ, meta))}>Download Excel${cur === 'USD' ? ' (USD)' : ''}</button>
        <button disabled=${!ready} onClick=${() => run('PDF…', () => downloadPdf(inQ, meta, (n, t) => setBusy(`PDF: photo ${n} of ${t}…`)))}>Download PDF${cur === 'USD' ? ' (USD)' : ''}</button>
        <button disabled=${!ready} onClick=${() => run('ZIP…', () => downloadZip(inQ, meta, (n, t) => setBusy(`ZIP: photo ${n} of ${t}…`)))}>ZIP with photos</button>
        ${busy && html`<span class="hint">${busy}</span>`}
      </div>

      ${s && s.groups.map((g) => html`
        <section class="detail">
          <h2>${g.label}</h2>
          <div class="card">
            <table>
              <thead><tr><th>No.</th><th>Date</th><th>Store / description</th><th class="n">Net</th><th class="n">VAT</th><th class="n">Gross</th></tr></thead>
              <tbody>
                ${[...g.rows].sort((a, b) => nums.get(a.receipt.id) - nums.get(b.receipt.id)).map((row) => {
                  const r = row.receipt;
                  const rate = r.currency !== cur ? conv.rate(r) : null;
                  return html`
                  <tr>
                    <td>${nums.get(r.id)}</td>
                    <td class="nowrap">${r.receipt_date}</td>
                    <td><a href=${`#/r/${r.id}`}>${r.store || '–'}</a>${r.description ? html`<small> · ${r.description}</small>` : ''}
                      ${rate ? html`<small> · ${money(row.gross_orig, r.currency)} at ${rate.rate.toFixed(4)}${rate.date ? ` (${rate.date})` : ''}</small>` : ''}
                      ${weakProof(r) ? html` <span class="badge st-weak">${DOC_TYPES[r.doc_type]}</span>` : ''}
                      ${r.status !== 'done' ? html` <${Badge} status=${r.status} />` : ''}</td>
                    <td class="n">${m(row.net)}</td><td class="n">${m(row.vat)}</td><td class="n">${m(row.gross)}</td>
                  </tr>`;
                })}
              </tbody>
              <tfoot><tr><td colspan="3">Subtotal</td><td class="n">${m(g.net)}</td><td class="n">${m(g.vat)}</td><td class="n">${m(g.gross)}</td></tr></tfoot>
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
      <p class="hint center">VH5 ${VERSION}</p>
    </div>`;
}

// ---------- boot ----------

async function boot() {
  localStorage.removeItem('numberFormat'); // setting of the old CSV export
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
      .then((reg) => {
        // Look for a new version when the app comes to the front, and every 15 minutes while it is open.
        document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && reg.update());
        setInterval(() => reg.update(), 15 * 60 * 1000);
      })
      .catch(console.warn);
  }
}

boot();
