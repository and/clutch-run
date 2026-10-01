// Touch controls for phones: tilt the phone like a steering wheel, press the analog pedals with
// one thumb, change gear with the other. Dragging sideways on the road steers when there is no tilt.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// keep receiving a finger's moves after it slides off the control it started on
const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch (err) {} };
const FULL_TILT = 32, DEAD_ZONE = 3; // degrees of phone rotation for full lock, and the slack around straight

export class TouchControls {
  constructor(root, scene) {
    this.throttle = 0; this.brake = 0;
    this.tilt = 0; this.tiltAt = 0; this.sign = 0;
    this.drag = null; this.handlers = {};
    root.querySelectorAll('[data-pedal]').forEach(el => this.pedal(el));
    root.querySelectorAll('[data-act]').forEach(el => el.addEventListener('pointerdown', e => {
      e.preventDefault(); const f = this.handlers[el.dataset.act]; if (f) f();
    }));
    scene.addEventListener('pointerdown', e => { this.drag = { id: e.pointerId, x0: e.clientX, x: e.clientX }; capture(scene, e); });
    scene.addEventListener('pointermove', e => { if (this.drag && this.drag.id === e.pointerId) this.drag.x = e.clientX; });
    const end = e => { if (this.drag && this.drag.id === e.pointerId) this.drag = null; };
    scene.addEventListener('pointerup', end); scene.addEventListener('pointercancel', end);
  }

  on(act, fn) { this.handlers[act] = fn; }

  // How hard a pedal is pressed comes from how high up it the thumb is: low = gently, top = floored.
  pedal(el) {
    const name = el.dataset.pedal;
    const set = e => {
      const r = el.getBoundingClientRect();
      this[name] = clamp(0.2 + 0.8 * (r.bottom - e.clientY) / r.height, 0.2, 1);
      el.style.setProperty('--press', this[name]);
    };
    let id = null; // the finger on this pedal; others sliding across it are ignored
    const release = e => { if (e.pointerId !== id) return; id = null; this[name] = 0; el.style.setProperty('--press', 0); };
    el.addEventListener('pointerdown', e => { e.preventDefault(); id = e.pointerId; capture(el, e); set(e); });
    el.addEventListener('pointermove', e => { if (e.pointerId === id) set(e); });
    el.addEventListener('pointerup', release); el.addEventListener('pointercancel', release);
  }

  // Must be called from a tap: iPhones only hand out motion data after asking the player.
  async enableTilt() {
    const DME = window.DeviceMotionEvent;
    if (!DME) return false;
    try { if (typeof DME.requestPermission === 'function' && await DME.requestPermission() !== 'granted') return false; } catch (e) { return false; }
    window.addEventListener('devicemotion', e => this.motion(e));
    return true;
  }

  motion(e) {
    const g = e.accelerationIncludingGravity;
    if (!g || g.x == null || g.y == null) return;
    // gravity in screen axes (x right, y up, as the player sees the screen)
    const a = ((screen.orientation && screen.orientation.angle) || window.orientation || 0) * Math.PI / 180;
    const sx = g.x * Math.cos(a) - g.y * Math.sin(a), sy = g.x * Math.sin(a) + g.y * Math.cos(a);
    if (Math.hypot(sx, sy) < 2) return; // phone lying flat: no wheel to read
    // Browsers disagree on the sign of this reading. The phone is held top-up when driving starts,
    // so whichever sign "up" has then is the one to use.
    if (!this.sign) { if (Math.abs(sy) < 3) return; this.sign = Math.sign(sy); }
    const deg = Math.atan2(sx * this.sign, sy * this.sign) * 180 / Math.PI; // + = phone turned anticlockwise
    const mag = Math.max(0, Math.abs(deg) - DEAD_ZONE) / (FULL_TILT - DEAD_ZONE);
    const raw = -Math.sign(deg) * clamp(mag, 0, 1);
    this.tilt += (raw - this.tilt) * 0.35;
    this.tiltAt = performance.now();
  }

  get tilting() { return performance.now() - this.tiltAt < 500; }

  // -1 full left .. +1 full right
  get steer() {
    if (this.drag) return clamp((this.drag.x - this.drag.x0) / (window.innerWidth * 0.15), -1, 1);
    return this.tilting ? this.tilt : 0;
  }
}
