// 2D overlay: rev counter, speedometer, gear, pedals, minimap, hints and messages.
const C = {
  panel: 'rgba(10,14,19,0.78)', face: '#0b1015', fg: '#e8edf2', dim: '#7f8b97',
  accent: '#f28c2b', good: '#4db883', warn: '#e0ae3a', bad: '#ef5d50', gravel: '#b39468',
};
const DISP = '"Barlow Condensed","Arial Narrow",Arial,sans-serif';
const MONO = '"IBM Plex Mono",ui-monospace,Menlo,monospace';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Hud {
  constructor(canvas, world) {
    this.cv = canvas; this.g = canvas.getContext('2d'); this.world = world;
    this.toasts = []; this.flash = 0; this.time = 0;
    this.resize(); this.buildMap();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.cv.width = Math.round(this.w * dpr); this.cv.height = Math.round(this.h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  buildMap() {
    const S = this.world.S; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const s of S) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); }
    const size = 150, pad = 12, sc = (size - pad * 2) / Math.max(x1 - x0, z1 - z0);
    const ox = pad + ((size - pad * 2) - (x1 - x0) * sc) / 2, oz = pad + ((size - pad * 2) - (z1 - z0) * sc) / 2;
    this.map = { size, tx: x => ox + (x - x0) * sc, tz: z => oz + (z - z0) * sc };
    const cv = document.createElement('canvas'), dpr = 2; cv.width = cv.height = size * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.beginPath(); S.forEach((s, i) => { const x = this.map.tx(s.x), y = this.map.tz(s.z); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.stroke();
    g.lineWidth = 3;
    for (let i = 0; i < S.length; i++) {
      const a = S[i], b = S[(i + 1) % S.length];
      g.strokeStyle = a.surf === 'gravel' ? C.gravel : '#aeb7c0';
      g.beginPath(); g.moveTo(this.map.tx(a.x), this.map.tz(a.z)); g.lineTo(this.map.tx(b.x), this.map.tz(b.z)); g.stroke();
    }
    g.fillStyle = C.fg; g.beginPath(); g.arc(this.map.tx(S[0].x), this.map.tz(S[0].z), 3.5, 0, 7); g.fill();
    this.mapImg = cv;
  }

  toast(text, tone = 'fg') {
    if (this.toasts.length && this.toasts[this.toasts.length - 1].text === text) { this.toasts[this.toasts.length - 1].t = 2.8; return; }
    this.toasts.push({ text, tone, t: 2.8 });
    if (this.toasts.length > 3) this.toasts.shift();
  }

  dial(x, y, R, val, max, major, minor, label, redFrom, unit, digital) {
    const g = this.g, ang = v => (135 + 270 * clamp(v, 0, max) / max) * Math.PI / 180;
    g.save(); g.translate(x, y);
    g.fillStyle = C.face; g.beginPath(); g.arc(0, 0, R, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 2; g.stroke();
    if (redFrom != null) {
      g.strokeStyle = C.bad; g.lineWidth = R * 0.07;
      g.beginPath(); g.arc(0, 0, R * 0.86, ang(redFrom), ang(max)); g.stroke();
    }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let v = 0; v <= max + 1e-6; v += minor) {
      const a = ang(v), isMaj = Math.abs(v / major - Math.round(v / major)) < 1e-6;
      const r0 = R * 0.9, r1 = isMaj ? R * 0.76 : R * 0.82, red = redFrom != null && v >= redFrom;
      g.strokeStyle = red ? C.bad : C.fg; g.lineWidth = isMaj ? 2.4 : 1.1;
      g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); g.stroke();
      if (isMaj) {
        g.fillStyle = red ? C.bad : C.fg; g.font = `600 ${Math.round(R * 0.17)}px ${DISP}`;
        g.fillText(label(v), Math.cos(a) * R * 0.6, Math.sin(a) * R * 0.6);
      }
    }
    g.fillStyle = C.dim; g.font = `${Math.round(R * 0.1)}px ${MONO}`; g.fillText(unit, 0, R * 0.33);
    g.fillStyle = C.fg; g.font = `500 ${Math.round(R * 0.2)}px ${MONO}`; g.fillText(digital, 0, R * 0.58);
    const a = ang(val);
    g.strokeStyle = C.accent; g.lineWidth = R * 0.04; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-Math.cos(a) * R * 0.14, -Math.sin(a) * R * 0.14); g.lineTo(Math.cos(a) * R * 0.84, Math.sin(a) * R * 0.84); g.stroke();
    g.fillStyle = C.fg; g.beginPath(); g.arc(0, 0, R * 0.07, 0, 7); g.fill();
    g.restore();
  }

  round(x, y, w, h, r, fill) { const g = this.g; g.beginPath(); g.roundRect(x, y, w, h, r); g.fillStyle = fill; g.fill(); }

  draw(s, dt) {
    const g = this.g, w = this.w, h = this.h; this.time += dt;
    g.clearRect(0, 0, w, h);
    if (this.flash > 0) {
      const gr = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.7);
      gr.addColorStop(0, 'rgba(239,93,80,0)'); gr.addColorStop(1, `rgba(239,93,80,${0.55 * this.flash})`);
      g.fillStyle = gr; g.fillRect(0, 0, w, h); this.flash = Math.max(0, this.flash - dt * 1.5);
    }

    // Instrument cluster
    const R = clamp(Math.min(w, h) * 0.11, 56, 92), gap = R * 0.3, gw = R * 1.5;
    const cx = w / 2, cy = h - R - 22;
    const pw = 4 * R + gw + gap * 4, ph = 2 * R + 20;
    this.round(cx - pw / 2, cy - R - 10, pw, ph, 16, C.panel);
    const tx = cx - gw / 2 - gap - R, sx = cx + gw / 2 + gap + R;
    this.dial(tx, cy, R, s.rpm, 7000, 1000, 500, v => v / 1000, 6300, '×1000 r/min', Math.round(s.rpm / 10) * 10 + '');
    this.dial(sx, cy, R, s.kmh, 160, 20, 10, v => v, null, 'km/h', Math.round(s.kmh) + '');

    // Gear, suggestion and pedals
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = C.dim; g.font = `600 ${Math.round(R * 0.14)}px ${DISP}`; g.fillText('GEAR', cx, cy - R * 0.78);
    g.fillStyle = s.on ? C.fg : C.bad; g.font = `700 ${Math.round(R * 0.9)}px ${DISP}`; g.fillText(s.gearLabel, cx, cy - R * 0.22);
    if (s.suggest) {
      const on = Math.sin(this.time * 9) > -0.2;
      if (on) {
        g.fillStyle = C.accent; g.font = `700 ${Math.round(R * 0.3)}px ${DISP}`;
        g.fillText(`${s.suggest.dir > 0 ? '▲' : '▼'} ${s.suggest.gear}`, cx, cy + R * 0.3);
      }
    }
    const [b0, b1] = s.bite, inBite = !s.auto && s.clutch > b0 && s.clutch < b1;
    const clutchCol = s.auto ? C.dim : inBite ? C.warn : s.clutch >= b1 ? C.dim : C.good;
    const bars = [['C', s.clutch, clutchCol], ['B', s.brake, C.bad], ['A', s.throttle, C.good]];
    const bw = R * 0.18, bh = R * 0.42, by = cy + R * 0.48;
    bars.forEach(([lab, v, col], i) => {
      const bx = cx + (i - 1) * R * 0.38 - bw / 2;
      this.round(bx, by, bw, bh, 3, 'rgba(255,255,255,0.1)');
      if (i === 0 && !s.auto) { // bite zone marked on the clutch bar
        g.fillStyle = 'rgba(224,174,58,0.22)'; g.fillRect(bx - 2, by + bh * (1 - b1), bw + 4, bh * (b1 - b0));
      }
      if (v > 0.01) this.round(bx, by + bh * (1 - v), bw, bh * v, 3, col);
      g.fillStyle = C.dim; g.font = `600 ${Math.round(R * 0.12)}px ${DISP}`; g.fillText(lab, bx + bw / 2, by + bh + R * 0.1);
      if (i === 0 && inBite) { g.fillStyle = C.warn; g.textAlign = 'right'; g.fillText('BITE', bx - R * 0.08, by + bh / 2); g.textAlign = 'center'; }
    });

    // Top-left: where you are and how you're doing
    const lines = [
      [s.section, C.fg, `600 20px ${DISP}`],
      [`Lap ${s.lap}  ·  ${fmtTime(s.lapTime)}${s.best ? '  ·  best ' + fmtTime(s.best) : ''}`, C.fg, `14px ${MONO}`],
      [`Crashes ${s.crashes}   Stalls ${s.stalls}   Grinds ${s.grinds}`, C.dim, `13px ${MONO}`],
      [`In the green ${s.green}%`, s.green >= 75 ? C.good : s.green >= 50 ? C.warn : C.bad, `13px ${MONO}`],
      [s.auto ? 'Auto clutch  ·  C for manual' : `Manual clutch (${s.clutchKey})  ·  C for auto`, C.dim, `13px ${MONO}`],
    ];
    this.round(12, 12, 290, 24 + lines.length * 22, 12, C.panel);
    g.textAlign = 'left';
    lines.forEach(([t, col, f], i) => { g.fillStyle = col; g.font = f; g.fillText(t, 26, 34 + i * 22); });

    // Top-right: minimap
    const m = this.map, mx = w - m.size - 12, my = 12;
    this.round(mx, my, m.size, m.size, 12, C.panel);
    g.drawImage(this.mapImg, mx, my, m.size, m.size);
    for (const t of s.traffic) { g.fillStyle = t.lane > 0 ? '#8fb3d9' : '#c9a0dc'; g.beginPath(); g.arc(mx + m.tx(t.x), my + m.tz(t.z), 2.2, 0, 7); g.fill(); }
    g.save(); g.translate(mx + m.tx(s.x), my + m.tz(s.z)); g.rotate(-s.yaw + Math.PI);
    g.fillStyle = C.accent; g.beginPath(); g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(-5, 5); g.closePath(); g.fill();
    g.restore();

    // Hint banner
    if (s.hint) {
      g.font = `600 19px ${DISP}`; g.textAlign = 'center';
      const tw = g.measureText(s.hint.text).width + 36, col = C[s.hint.tone] || C.fg;
      const blink = s.hint.tone === 'bad' ? 0.75 + 0.25 * Math.sin(this.time * 8) : 1;
      g.globalAlpha = blink;
      this.round(cx - tw / 2, 18, tw, 36, 18, C.panel);
      g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); g.roundRect(cx - tw / 2, 18, tw, 36, 18); g.stroke();
      g.fillStyle = col; g.fillText(s.hint.text, cx, 37); g.globalAlpha = 1;
    }

    // Toasts
    g.font = `700 30px ${DISP}`; g.textAlign = 'center';
    this.toasts.forEach((t, i) => {
      t.t -= dt;
      g.globalAlpha = clamp(t.t / 0.5, 0, 1);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillText(t.text, cx + 2, h * 0.3 + i * 38 + 2);
      g.fillStyle = C[t.tone] || C.fg; g.fillText(t.text, cx, h * 0.3 + i * 38);
    });
    g.globalAlpha = 1;
    this.toasts = this.toasts.filter(t => t.t > 0);
  }
}

export function fmtTime(t) {
  if (t == null) return '–';
  const m = Math.floor(t / 60), sec = t - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
}
