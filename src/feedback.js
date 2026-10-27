// Feedback: a comment box on every page; the comments are read (and ticked off) in Settings.
import { html, useState, useEffect } from './ui.js';
import * as api from './api.js';
import { Modal } from './kit.js';
import { fmtDate } from './vat.js';

export function FeedbackDialog({ ownerId, page, version, onClose }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const send = async () => {
    setBusy(true); setMsg('');
    try { await api.addFeedback(ownerId, page, version, text); setMsg('Thanks! Saved. You can read it in Settings → Feedback.'); setText(''); setTimeout(onClose, 1400); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  return html`
    <${Modal} onClose=${onClose}>
      <p class="kicker">Feedback · ${page}</p>
      <h2>What could be better?</h2>
      <p class="hint">Something unclear, wrong or missing? Saved with this page and version ${version}.</p>
      <label>Your comment<textarea rows="5" value=${text} onInput=${(e) => setText(e.target.value)} placeholder="For example: the total on this page looks wrong…" autofocus></textarea></label>
      ${msg && html`<p class="msg">${msg}</p>`}
      <div class="actions">
        <button class="primary" disabled=${busy || !text.trim()} onClick=${send}>${busy ? 'Saving…' : 'Send feedback'}</button>
        <button onClick=${onClose}>Cancel</button>
      </div>
    </${Modal}>`;
}

// Settings card: open comments first, newest first; done ones folded away.
export function FeedbackList({ ownerId, userId }) {
  const [list, setList] = useState(null);
  const [msg, setMsg] = useState('');
  const [showDone, setShowDone] = useState(false);
  const load = () => api.listFeedback(ownerId).then(setList).catch((e) => { setList([]); setMsg(e.message); });
  useEffect(() => { load(); }, [ownerId]);
  const act = async (fn) => { try { await fn(); load(); } catch (e) { setMsg(e.message); } };
  const mayEdit = (f) => userId === f.owner_id || userId === f.author_id;
  const open = (list || []).filter((f) => !f.done);
  const done = (list || []).filter((f) => f.done);
  const row = (f) => html`
    <div class=${`row feedback-item${f.done ? ' done' : ''}`}>
      <span class="what"><span class="fb-text">${f.message}</span>
        <small>${f.page || 'App'} · ${f.author_email || 'unknown'} · ${fmtDate(f.created_at.slice(0, 10))}${f.version ? ` · v${f.version}` : ''}</small></span>
      ${mayEdit(f) && html`<span class="fb-actions">
        <button class="link" onClick=${() => act(() => api.setFeedbackDone(f.id, !f.done))}>${f.done ? 'Reopen' : 'Done'}</button>
        <button class="link danger" onClick=${() => confirm('Delete this comment?') && act(() => api.deleteFeedback(f.id))}>Delete</button></span>`}
    </div>`;
  return html`
    <section class="card">
      <h3>Feedback${open.length ? html` <span class="count">${open.length}</span>` : ''}</h3>
      <p class="hint">Comments left with the Feedback button on any page, by you or anyone you share VH5 with.</p>
      ${list === null ? html`<p class="hint">Loading…</p>`
        : open.length ? html`<div class="feedback-list">${open.map(row)}</div>` : html`<p class="hint">No open comments.</p>`}
      ${done.length > 0 && html`
        <button class="link" onClick=${() => setShowDone(!showDone)}>${showDone ? 'Hide' : 'Show'} done (${done.length})</button>
        ${showDone && html`<div class="feedback-list">${done.map(row)}</div>`}`}
      ${msg && html`<p class="msg">${msg}</p>`}
    </section>`;
}
