// VH5: sign-in, the app frame (menu, search, routes) and the shared data.
// Screens live in expenses.js, income.js, overview.js and settings.js.
import { html, render, useState, useEffect, useMemo } from './ui.js';
import * as api from './api.js';
import { go, useRoute, Icon } from './kit.js';
import { ExpensesPage, ReceiptEditor } from './expenses.js';
import { IncomePage, StatementEditor, BookingDialog } from './income.js';
import { HomePage } from './home.js';
import { OverviewPage } from './overview.js';
import { SettingsPage } from './settings.js';
import { Spotlight } from './search.js';

const VERSION = '2.2.2';

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
  const link = (to, label) => html`<a href="#" onClick=${(e) => { e.preventDefault(); setMode(to); setMsg(''); }}>${label}</a>`;
  return html`
    <div class="auth">
      <form class="card auth-card" onSubmit=${submit}>
        <img src="icons/icon-192.png" alt="VH5" class="auth-logo" />
        <h1>VH5</h1>
        <p class="hint">${mode === 'signup' ? 'Create an account. Accountants: use the email address your client shared with.' : mode === 'forgot' ? 'Get a link to set a new password.' : 'Expenses, income and overviews, on every device.'}</p>
        <label>Email<input type="email" autocomplete="email" required value=${email} onInput=${(e) => setEmail(e.target.value)} /></label>
        ${mode !== 'forgot' && html`<label>Password<input type="password" autocomplete=${mode === 'signup' ? 'new-password' : 'current-password'} required minlength="8" value=${password} onInput=${(e) => setPassword(e.target.value)} /></label>`}
        <button class="primary" disabled=${busy}>${mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send link'}</button>
        ${msg && html`<p class="msg">${msg}</p>`}
        <div class="auth-links">
          ${mode !== 'signin' && link('signin', 'Sign in')}
          ${mode !== 'signup' && link('signup', 'Create account')}
          ${mode !== 'forgot' && link('forgot', 'Forgot password')}
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
  return html`<${Shell} user=${session.user} key=${session.user.id} />`;
}

// ---------- app frame ----------

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

function Shell({ user }) {
  const route = useRoute();
  const [shares, setShares] = useState([]);
  const [ownerId, setOwnerId] = useState(localStorage.getItem('owner') || user.id);
  const [receipts, setReceipts] = useState(null);
  const [statements, setStatements] = useState(null);
  const [periods, setPeriods] = useState([]);
  const [queue, setQueue] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const [dragging, setDragging] = useState(false);
  const [searching, setSearching] = useState(false);
  const [pendingStatements, setPendingStatements] = useState(null);

  const email = (user.email || '').toLowerCase();
  const sharedWithMe = shares.filter((s) => s.viewer_email === email && s.owner_id !== user.id);
  const viewers = shares.filter((s) => s.owner_id === user.id);
  const accounts = [{ id: user.id, label: 'My VH5' }, ...sharedWithMe.map((s) => ({ id: s.owner_id, label: s.owner_email || 'Shared with me' }))];
  const mine = ownerId === user.id;
  const ownerLabel = mine ? user.email : accounts.find((a) => a.id === ownerId)?.label;

  const reloadShares = () => api.myShares().then(setShares).catch((e) => console.warn(e));
  useEffect(() => { reloadShares(); }, []);
  const setOwner = (id) => { localStorage.setItem('owner', id); setReceipts(null); setStatements(null); setOwnerId(id); go('home'); };
  // An accountant without data of their own lands on the first shared account.
  useEffect(() => {
    if (!localStorage.getItem('owner') && sharedWithMe.length && receipts && !receipts.length && statements && !statements.length && mine) setOwner(sharedWithMe[0].owner_id);
    if (!mine && shares.length && !sharedWithMe.some((s) => s.owner_id === ownerId)) setOwner(user.id);
  }, [shares, receipts]);

  const reload = () => Promise.all([api.listReceipts(ownerId), api.listStatements(ownerId), api.listPeriods(ownerId)])
    .then(([r, st, p]) => { setReceipts(r); setStatements(st); setPeriods(p); setLoadError(''); }).catch((e) => setLoadError(e.message));
  const refreshQueue = () => api.queued().then((q) => setQueue(q.filter((i) => i.userId === user.id))).catch(() => {});
  const reportDropped = () => {
    const n = api.takeDropped();
    if (n) alert(`${n} file${n > 1 ? 's' : ''} waiting to upload could not be read and ${n > 1 ? 'were' : 'was'} removed. Please import ${n > 1 ? 'them' : 'it'} again.`);
  };

  useEffect(() => {
    reload();
    const stops = [
      api.watchReceipts(ownerId, (p) => setReceipts(patch(p))),
      api.watchReceipts(ownerId, (p) => setStatements(patch(p)), 'statements'),
      api.watchReceipts(ownerId, () => api.listPeriods(ownerId).then(setPeriods), 'periods'),
    ];
    const onVisible = () => { if (document.visibilityState === 'visible') { reload(); reloadShares(); } };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => document.visibilityState === 'visible' && reload(), 60000);
    return () => { stops.forEach((s) => s()); document.removeEventListener('visibilitychange', onVisible); clearInterval(timer); };
  }, [ownerId]);

  useEffect(() => {
    refreshQueue();
    const up = () => { setOnline(true); api.flushOutbox().then(() => { reportDropped(); refreshQueue(); reload(); }); };
    const down = () => setOnline(false);
    addEventListener('online', up);
    addEventListener('offline', down);
    api.flushOutbox().then(() => { reportDropped(); refreshQueue(); });
    // ⌘K / Ctrl+K opens the search.
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearching(true); } };
    addEventListener('keydown', onKey);
    return () => { removeEventListener('online', up); removeEventListener('offline', down); removeEventListener('keydown', onKey); };
  }, []);

  const addFiles = async (files, kind = 'receipt', extra = {}) => {
    if (!files?.length) return;
    if (!mine) setOwner(user.id);
    try { await api.addFiles([...files], user.id, kind, extra); } catch (e) { alert(e.message); }
    reportDropped();
    await refreshQueue();
    reload();
  };
  const addManual = async (extra = {}) => {
    try { const r = await api.createManual(user.id, extra); setReceipts((list) => (list && !list.some((x) => x.id === r.id) ? [r, ...list] : list)); go(`r/${r.id}`); }
    catch (e) { alert(e.message); }
  };
  const removeQueued = async (item) => {
    if (!confirm('Remove this file from the upload queue? You can import it again afterwards.')) return;
    await api.unqueue(item.id);
    refreshQueue();
  };

  const [view = 'home', arg] = route;
  const page = { '': 'home', home: 'home', r: 'expenses', expenses: 'expenses', s: 'income', income: 'income', quarter: 'overview', overview: 'overview', settings: 'settings' }[view] || 'home';
  const filed = useMemo(() => new Set(periods.map((p) => p.period)), [periods]);
  const ctx = {
    user, mine, ownerLabel, receipts: receipts || [], statements: statements || [], periods, filed, viewers, sharedWithMe,
    queue, reload, reloadShares, addFiles, addManual, removeQueued,
    importStatements: (files) => files.length && setPendingStatements(files),
  };
  ctx.queue = queue.filter((i) => (page === 'income' ? i.kind === 'statement' : i.kind !== 'statement'));

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (page === 'income') ctx.importStatements(files); else addFiles(files, 'receipt');
  };

  const openR = (receipts || []).filter((r) => r.status !== 'done').length;
  const openS = (statements || []).filter((r) => r.status !== 'done').length;
  let body;
  if (!receipts || !statements) body = html`<p class="boot">${loadError || 'Loading…'}</p>`;
  else if (view === 'r') {
    const r = receipts.find((x) => x.id === arg);
    body = r ? html`<${ReceiptEditor} receipt=${r} ctx=${ctx} key=${r.id} />` : html`<p class="boot">Receipt not found. <a href="#/expenses">Back</a></p>`;
  } else if (view === 's') {
    const st = statements.find((x) => x.id === arg);
    body = st ? html`<${StatementEditor} statement=${st} ctx=${ctx} key=${st.id} />` : html`<p class="boot">Statement not found. <a href="#/income">Back</a></p>`;
  } else if (page === 'income') body = html`<${IncomePage} ctx=${ctx} />`;
  else if (page === 'overview') body = html`<${OverviewPage} ctx=${ctx} arg=${arg} />`;
  else if (page === 'home') body = html`<${HomePage} ctx=${ctx} />`;
  else if (page === 'settings') body = html`<${SettingsPage} ctx=${ctx} version=${VERSION} />`;
  else body = html`<${ExpensesPage} ctx=${ctx} />`;

  const tab = (key, label, icon, count) => html`
    <a class=${page === key ? 'on' : ''} href=${`#/${key}`}>${icon}<span>${label}</span>${count ? html`<span class="count">${count}</span>` : ''}</a>`;

  return html`
    <div class="app"
      onDragOver=${(e) => { if (mine && (page === 'expenses' || page === 'income')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave=${(e) => { if (e.target === e.currentTarget) setDragging(false); }}
      onDrop=${mine ? onDrop : undefined}>
      <header class="topbar">
        <a class="brand" href="#/home"><img src="icons/icon-192.png" alt="" />VH5</a>
        <nav class="tabs">
          ${tab('home', 'Home', Icon.home)}
          ${tab('expenses', 'Expenses', Icon.expenses, openR)}
          ${tab('income', 'Income', Icon.income, openS)}
          ${tab('overview', 'Overview', Icon.overview)}
          ${tab('settings', 'Settings', Icon.settings)}
        </nav>
        <div class="top-right">
          <button class="searchbtn" onClick=${() => setSearching(true)} aria-label="Search">${Icon.search}<span>Search</span><kbd>⌘K</kbd></button>
          ${accounts.length > 1 && html`
            <select class="account" value=${ownerId} onChange=${(e) => setOwner(e.target.value)} aria-label="Whose data">
              ${accounts.map((a) => html`<option value=${a.id}>${a.label}</option>`)}
            </select>`}
        </div>
      </header>
      ${!online && html`<div class="banner">Offline. New photos are saved on this device and upload when you’re back online.</div>`}
      ${!mine && html`<div class="banner info">You’re viewing ${ownerLabel} (read-only).</div>`}
      <main class="main">${body}</main>
      ${dragging && html`<div class="dropzone">${page === 'income' ? 'Drop agency statements to import them' : 'Drop receipts to add them'}</div>`}
      ${searching && html`<${Spotlight} ctx=${ctx} onClose=${() => setSearching(false)} />`}
      ${pendingStatements && html`<${BookingDialog} files=${pendingStatements} filed=${filed}
        onCancel=${() => setPendingStatements(null)}
        onImport=${(date) => { const f = pendingStatements; setPendingStatements(null); addFiles(f, 'statement', { booking_date: date }); }} />`}
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
