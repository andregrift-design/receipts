// Easter egg: the 10th receipt added on this device gets confetti and a word of encouragement.
import { html, useEffect, useRef } from './ui.js';

const COLORS = ['#d2b08c', '#7a4f2e', '#e8a0a8', '#c2543f', '#e7bd6a', '#9fbfa8', '#a9c3dc', '#f3ece3'];

// Counts receipts added and says whether this batch reached the 10th (once only).
export function countAdded(userId, n) {
  const key = `vh5Added:${userId}`;
  const before = Number(localStorage.getItem(key)) || 0;
  const after = before + n;
  localStorage.setItem(key, String(after));
  return before < 10 && after >= 10;
}

export function Celebration({ onClose }) {
  const canvas = useRef(null);
  useEffect(() => {
    const done = setTimeout(onClose, 5000);
    const onKey = (e) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    const cleanup = () => { clearTimeout(done); removeEventListener('keydown', onKey); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return cleanup;

    const c = canvas.current, ctx = c.getContext('2d');
    const dpr = devicePixelRatio || 1;
    const size = () => { c.width = innerWidth * dpr; c.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size();
    addEventListener('resize', size);
    const bits = Array.from({ length: 180 }, (_, i) => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 80,
      y: innerHeight * 0.55,
      vx: (Math.random() - 0.5) * 16,
      vy: -8 - Math.random() * 12,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      w: 6 + Math.random() * 6,
      h: 4 + Math.random() * 6,
      heart: i % 9 === 0,
      color: COLORS[i % COLORS.length],
    }));
    const start = performance.now();
    let frame;
    const tick = (t) => {
      const age = (t - start) / 1000;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ctx.globalAlpha = Math.max(0, Math.min(1, 4.6 - age));
      for (const b of bits) {
        b.vy += 0.32; b.vx *= 0.99; b.vy *= 0.99;
        b.x += b.vx; b.y += b.vy; b.r += b.vr;
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.heart ? '#c2543f' : b.color;
        if (b.heart) { ctx.font = '16px sans-serif'; ctx.fillText('♥', -6, 6); }
        else ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.r * 2)) + 1);
        ctx.restore();
      }
      if (age < 4.7) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { cleanup(); cancelAnimationFrame(frame); removeEventListener('resize', size); };
  }, []);

  return html`
    <div class="celebrate" onClick=${onClose} role="status" aria-live="polite">
      <canvas ref=${canvas} aria-hidden="true"></canvas>
      <div class="celebrate-card">
        <svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-4.4-9.3-9C1 8.3 3.1 4.5 6.8 4.5c2.2 0 3.9 1.3 5.2 3 1.3-1.7 3-3 5.2-3 3.7 0 5.8 3.8 4.1 7.5C19 16.6 12 21 12 21z" /></svg>
        <p>You’re killing it Viola</p>
      </div>
    </div>`;
}
