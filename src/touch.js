// Touch controls for phones: tilt the phone like a steering wheel, press the analog pedals with
// one thumb, change gear with the other. Dragging sideways on the road steers when there is no tilt.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// keep receiving a finger's moves after it slides off the control it started on
const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch (err) {} };
const FULL_TILT = 32, DEAD_ZONE = 3; // degrees of phone rotation for full lock, and the slack around straight
// Automatic mode: the phone flat is foot off the accelerator; lifting its top edge presses it, fully by this angle
const LIFT_START = 8, LIFT_FULL = 55;

export class TouchControls {
  constructor(root, scene) {
    this.throttle = 0; this.brake = 0;
    this.tilt = 0; this.tiltAt = 0; this.sign = 0;
    this.automatic = false; this.liftRaw = 0; // automatic mode: steer by rolling the phone, accelerate by lifting it
    this.drag = null; this.handlers = {};
    root.querySelectorAll('[data-pedal]').forEach(el => this.pedal(el));
    root.querySelectorAll('[data-gate]').forEach(el => this.gate(el));
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

  // H-pattern gear lever. The knob only moves along the gate, like a real one:
  //   1   3   5
  //   |---N---|
  //   2   4   R
  // A gear engages once the knob is most of the way into its slot; back on the middle rail is neutral.
  // The game may refuse a gear (too fast for 1st, reverse while moving); on release the knob then
  // springs back to neutral, and between drags it follows whatever gear the car is really in.
  gate(el) {
    this.gateEl = el;
    const knob = el.querySelector('.knob'), label = knob.querySelector('b');
    const COLS = [26 / 132, 0.5, 106 / 132], TOP = 18 / 132, MID = 0.5, BOT = 114 / 132;
    const SLOTS = [[1, 2], [3, 4], [5, -1]]; // [up, down] per column
    const k = this.lever = { x: 0.5, y: MID, id: null, want: 0, gear: null };
    const nearestCol = x => COLS.reduce((b, c, i) => Math.abs(c - x) < Math.abs(COLS[b] - x) ? i : b, 0);
    const place = () => {
      knob.style.left = `${k.x * 100}%`; knob.style.top = `${k.y * 100}%`;
      const g = k.id !== null ? k.want : k.gear; // while dragging, the gear being asked for
      label.textContent = g === -1 ? 'R' : g ? String(g) : 'N';
    };
    const move = e => {
      const r = el.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      if (Math.abs(k.y - MID) < 0.03) { // on the neutral rail: slide across, or drop into a slot at a column
        const c = nearestCol(k.x);
        if (Math.abs(k.x - COLS[c]) < 0.1 && Math.abs(fy - MID) > 0.08) { k.x = COLS[c]; k.y = clamp(fy, TOP, BOT); }
        else { k.x = clamp(fx, COLS[0], COLS[2]); k.y = MID; }
      } else { // in a slot: only up and down, back onto the rail near the middle
        k.y = clamp(fy, TOP, BOT); if (Math.abs(k.y - MID) < 0.03) k.y = MID;
      }
      const c = nearestCol(k.x), depth = k.y < MID ? (MID - k.y) / (MID - TOP) : (k.y - MID) / (BOT - MID);
      const want = depth > 0.7 ? SLOTS[c][k.y < MID ? 0 : 1] : depth < 0.3 ? 0 : k.want;
      if (want !== k.want) { k.want = want; const f = this.handlers.gear; if (f) f(want); }
      place();
    };
    el.addEventListener('pointerdown', e => { e.preventDefault(); k.id = e.pointerId; capture(el, e); el.classList.add('drag'); move(e); });
    el.addEventListener('pointermove', e => { if (e.pointerId === k.id) move(e); });
    const end = e => { if (e.pointerId !== k.id) return; k.id = null; el.classList.remove('drag'); k.gear = null; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
    this.leverPlace = place; this.leverCols = COLS; this.leverSlots = SLOTS; this.leverEnds = [TOP, MID, BOT];
    place();
  }

  // Called every frame with the car's real gear: between drags the knob sits where that gear is.
  syncGear(g) {
    const k = this.lever;
    if (!k || k.id !== null || k.gear === g) return;
    const [TOP, MID, BOT] = this.leverEnds;
    k.gear = g; k.want = g;
    if (g === 0) k.y = MID; // neutral: stay at this column on the rail
    else this.leverSlots.forEach((s, c) => { const i = s.indexOf(g); if (i >= 0) { k.x = this.leverCols[c]; k.y = i ? BOT : TOP; } });
    this.leverPlace();
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
    if (!this.automatic && Math.hypot(sx, sy) < 2) return; // phone lying flat: no wheel to read
    // Browsers disagree on the sign of this reading. The phone is held top-up when driving starts
    // (in automatic mode, the first time it is lifted), so whichever sign "up" has then is the one to use.
    if (!this.sign) {
      if (Math.abs(sy) < 3) { if (this.automatic) this.tiltAt = performance.now(); return; } // flat: motion works, nothing pressed yet
      this.sign = Math.sign(sy);
    }
    let deg = Math.atan2(sx * this.sign, sy * this.sign) * 180 / Math.PI; // + = phone turned anticlockwise
    if (this.automatic) {
      // Held anywhere from flat to upright, so the wheel is the phone's roll: how far one side is
      // lower than the other. The lift is how far the top edge is raised above the bottom one.
      const gm = Math.hypot(sx, sy, g.z || 0) || 9.81;
      deg = Math.asin(clamp(sx * this.sign / gm, -1, 1)) * 180 / Math.PI;
      const lift = Math.atan2(sy * this.sign, Math.abs(g.z || 0)) * 180 / Math.PI;
      this.liftRaw += (clamp((lift - LIFT_START) / (LIFT_FULL - LIFT_START), 0, 1) - this.liftRaw) * 0.35;
    }
    const mag = Math.max(0, Math.abs(deg) - DEAD_ZONE) / (FULL_TILT - DEAD_ZONE);
    const raw = -Math.sign(deg) * clamp(mag, 0, 1);
    this.tilt += (raw - this.tilt) * 0.35;
    this.tiltAt = performance.now();
  }

  get tilting() { return performance.now() - this.tiltAt < 500; }

  // Automatic mode's accelerator, 0..1, from how far the phone is lifted
  get lift() { return this.automatic && this.tilting ? this.liftRaw : 0; }

  // -1 full left .. +1 full right
  get steer() {
    if (this.drag) return clamp((this.drag.x - this.drag.x0) / (window.innerWidth * 0.15), -1, 1);
    return this.tilting ? this.tilt : 0;
  }
}
