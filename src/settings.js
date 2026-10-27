// Settings: account, sharing with accountants, filed quarters, install help.
import { html, useState, useEffect } from './ui.js';
import * as api from './api.js';
import { fmtDate, periodLabel } from './vat.js';
import { FeedbackList } from './feedback.js';

export function SettingsPage({ ctx, version }) {
  const { user, viewers, sharedWithMe, periods } = ctx;
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const add = async (e) => {
    e.preventDefault();
    try { await api.addShare(email); setEmail(''); setMsg(''); ctx.reloadShares(); } catch (err) { setMsg(err.message.includes('duplicate') ? 'Already shared with that address.' : err.message); }
  };
  const remove = async (s) => {
    if (!confirm(`Stop sharing with ${s.viewer_email}?`)) return;
    await api.removeShare(s.owner_id, s.viewer_email).catch((e) => setMsg(e.message));
    ctx.reloadShares();
  };
  const appUrl = location.origin + location.pathname;

  return html`
    <div class="settings">
      <div class="page-head"><div><p class="kicker">VH5</p><h1>Settings</h1></div></div>
      <section class="card">
        <h3>Account</h3>
        <p>Signed in as <strong>${user.email}</strong></p>
        <button onClick=${() => { localStorage.removeItem('owner'); api.sb.auth.signOut(); }}>Sign out</button>
      </section>

      ${api.passkeysSupported() && html`<${Passkeys} />`}
      <${FeedbackList} ownerId=${ctx.ownerId} userId=${ctx.user.id} />

      <section class="card">
        <h3>Share with your accountants</h3>
        <p class="hint">They see your expenses, income and overviews and can download the exports, but can’t change anything.
          Send them this address: <a href=${appUrl}>${appUrl}</a>. They create an account there with the email address below and confirm it.</p>
        <form class="row-form" onSubmit=${add}>
          <input type="email" required placeholder="accountant@example.com" value=${email} onInput=${(e) => setEmail(e.target.value)} />
          <button class="primary">Share</button>
        </form>
        ${msg && html`<p class="msg">${msg}</p>`}
        ${viewers.map((s) => html`<div class="row" style="padding:10px 0"><span class="what">${s.viewer_email}</span><button class="link danger" onClick=${() => remove(s)}>Stop sharing</button></div>`)}
      </section>

      ${sharedWithMe.length > 0 && html`
        <section class="card">
          <h3>Shared with you</h3>
          ${sharedWithMe.map((s) => html`<div class="row" style="padding:10px 0"><span class="what">${s.owner_email}</span></div>`)}
          <p class="hint">Switch accounts with the menu at the top.</p>
        </section>`}

      <section class="card">
        <h3>Filed quarters</h3>
        ${periods.length ? periods.map((p) => html`<div class="row" style="padding:10px 0"><span class="what">🔒 ${periodLabel(p.period)}</span><small>filed ${fmtDate(p.filed_at.slice(0, 10))}</small></div>`)
          : html`<p class="hint">None yet. File a quarter from its overview once the CPA has it.</p>`}
      </section>

      <section class="card">
        <h3>Install on your devices</h3>
        <p class="hint"><strong>iPhone / iPad:</strong> Safari → Share → Add to Home Screen. <strong>Mac:</strong> Safari → File → Add to Dock.
          Everything syncs through your account. The address is <a href=${appUrl}>${appUrl}</a>.</p>
      </section>
      <${About} version=${version} />
      <p class="hint center">VH5 ${version} · © 2026 EAGER Management B.V. All rights reserved.</p>
    </div>`;
}

// Passkeys: sign in with Face ID / Touch ID instead of a password. One per device or password manager.
function Passkeys() {
  const [list, setList] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = () => api.listPasskeys().then(setList).catch((e) => { setList([]); setMsg(e.message); });
  useEffect(() => { load(); }, []);
  const add = async () => {
    setBusy(true); setMsg('');
    try { if (await api.addPasskey()) { setMsg('Passkey added. Next time, choose “Sign in with a passkey”.'); load(); } }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  const remove = async (p) => {
    if (!confirm(`Remove the passkey “${p.friendly_name || 'Passkey'}”? You can still sign in with your password.`)) return;
    try { await api.removePasskey(p.id); load(); } catch (e) { setMsg(e.message); }
  };
  return html`
    <section class="card">
      <h3>Passkeys</h3>
      <p class="hint">Sign in with Face ID or Touch ID instead of your password. A passkey in iCloud Keychain works on your iPhone, iPad and Mac. Your password keeps working.</p>
      <div class="passkey-list">
        ${list === null ? html`<p class="hint">Loading…</p>` : list.length ? list.map((p) => html`
          <div class="row"><span class="what"><strong>${p.friendly_name || 'Passkey'}</strong>
            <small>added ${fmtDate(p.created_at.slice(0, 10))}${p.last_used_at ? ` · last used ${fmtDate(p.last_used_at.slice(0, 10))}` : ''}</small></span>
            <button class="link danger" onClick=${() => remove(p)}>Remove</button></div>`)
        : html`<p class="hint">No passkeys yet.</p>`}
      </div>
      <button class="primary" disabled=${busy} onClick=${add}>${busy ? 'Waiting for your device…' : 'Add a passkey'}</button>
      ${msg && html`<p class="msg">${msg}</p>`}
    </section>`;
}

// About: copyright, what the app does with your data, the limits of its figures, and the software it builds on.
const LIBS = [
  ['Preact and htm', 'MIT and Apache-2.0', 'https://preactjs.com'],
  ['Supabase JS client', 'MIT', 'https://github.com/supabase/supabase-js'],
  ['jsPDF and jsPDF-AutoTable', 'MIT', 'https://github.com/parallax/jsPDF'],
  ['SheetJS Community Edition', 'Apache-2.0', 'https://sheetjs.com'],
  ['JSZip', 'MIT', 'https://stuk.github.io/jszip/'],
  ['PDF.js', 'Apache-2.0', 'https://mozilla.github.io/pdf.js/'],
];

function About({ version }) {
  return html`
    <section class="card about">
      <h3>About VH5</h3>
      <p>VH5 ${version}<br />© 2026 EAGER Management B.V. All rights reserved.</p>
      <details>
        <summary>Privacy: where your data goes</summary>
        <ul>
          <li><strong>Storage and sign-in:</strong> Supabase, in Frankfurt (EU). Your receipts, statements and photos are visible only to you and to the people you share with in Settings.</li>
          <li><strong>Reading documents:</strong> photos and PDFs are sent to Anthropic (Claude) to read the amounts, VAT and dates. Anthropic does not use this data to train its models.</li>
          <li><strong>Exchange rates:</strong> fetched from Frankfurter (European Central Bank rates). Only a currency and a date are sent, nothing about you.</li>
          <li><strong>The app itself</strong> is served by GitHub Pages. No ads, no tracking, no analytics cookies. This device keeps a copy of the app and of photos waiting to upload, so VH5 works offline.</li>
          <li>Want your data exported or deleted? Download the quarters you need, then ask EAGER Management B.V. to delete your account via <a href="mailto:info@eagermgt.com">info@eagermgt.com</a>.</li>
        </ul>
      </details>
      <details>
        <summary>Disclaimer</summary>
        <p class="hint">VH5 helps you keep your receipts and agency statements in order. Its figures are indicative: amounts read automatically can be wrong, so check every document. VH5 is not tax advice; your accountant decides what goes on the VAT return and the income tax return. Keep the original receipts and invoices: the tax authorities can ask for them for 7 years.</p>
      </details>
      <details>
        <summary>Open-source software</summary>
        <ul>${LIBS.map(([name, lic, url]) => html`<li><a href=${url} target="_blank" rel="noopener">${name}</a> · ${lic}</li>`)}</ul>
        <p class="hint">Exchange rates: European Central Bank, via Frankfurter. Text recognition: Claude by Anthropic.</p>
      </details>
    </section>`;
}
