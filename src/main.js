import * as THREE from 'three';
import { World, LANE, ROAD_HALF, HALF } from './world.js';
import { Drivetrain, SPEC, TOP_GEAR, BITE_TOP, BITE_BOTTOM } from './drivetrain.js';
import { Sound } from './audio.js';
import { Hud, fmtTime } from './hud.js';
import { makeCar, poseCar, addInterior, DRIVER } from './cars.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ORD = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: '5th' };
const gearName = g => g === -1 ? 'R' : g === 0 ? 'N' : String(g);

/* ---------- Renderer, scene, sky ---------- */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
const HORIZON = 0xcfdde6;
scene.background = new THREE.Color(HORIZON);
scene.fog = new THREE.Fog(HORIZON, 180, 950);
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.05, 2000);

scene.add(new THREE.HemisphereLight(0xe3efff, 0x55623a, 1.15));
const sun = new THREE.DirectionalLight(0xfff0da, 2.3); sun.position.set(-400, 520, 260); scene.add(sun);
{
  const geo = new THREE.SphereGeometry(1600, 24, 12), col = [], pos = geo.attributes.position, top = new THREE.Color(0x6f9fd0), hz = new THREE.Color(HORIZON), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) { const t = clamp(pos.getY(i) / 1600, 0, 1); c.copy(hz).lerp(top, Math.pow(t, 0.6)); col.push(c.r, c.g, c.b); }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })));
}

/* ---------- World, player, traffic ---------- */
const world = new World(scene);
const L = world.length;
const wrap = d => ((d % L) + L) % L;
const wrapDiff = (a, b) => wrap(a - b + L / 2) - L / 2;

const dt = new Drivetrain();
const sound = new Sound();
const hud = new Hud(document.getElementById('hud'), world);

const player = { x: 0, z: 0, y: 0, yaw: 0, steer: 0, steerVel: 0, head: 0, pitch: 0, roll: 0, car: addInterior(makeCar(0xe0730f)) };
scene.add(player.car.group);

function spawnAt(d) {
  const p = world.pointAt(d, LANE);
  player.x = p.x; player.z = p.z; player.y = p.y; player.yaw = Math.atan2(p.tx, p.tz); player.steer = player.steerVel = player.head = 0;
  dt.v = 0;
}

const PALETTE = [0x3a6ea5, 0xd7d9dc, 0x2f3438, 0x8c2f2f, 0x5e7d4d, 0xc9b27c, 0x6a5a8c, 0xf1f1ee, 0x7a8a99, 0x355e5b, 0xb5452e];
const traffic = [];
for (let k = 0; k < 11; k++) {
  const lane = k < 6 ? 1 : -1;
  const d = lane > 0 ? 160 + k * (L - 200) / 6 : 90 + (k - 6) * L / 5;
  const cruise = lane > 0 ? 10 + (k % 3) * 1.8 : 12 + (k % 3) * 1.5;
  const car = makeCar(PALETTE[k % PALETTE.length]);
  scene.add(car.group);
  traffic.push({ d, lane, dir: lane, cruise, speed: cruise, stopT: 0, car, x: 0, z: 0, yaw: 0 });
}

/* ---------- Input ---------- */
// Two key layouts. "pedals" puts the three pedals on ← ↓ → in the same order as in a real car.
const LAYOUTS = {
  standard: {
    throttle: ['KeyW', 'ArrowUp'], brake: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
    clutch: ['ShiftLeft', 'ShiftRight'], handbrake: ['Space'], clutchName: 'Shift', goName: 'W',
  },
  pedals: {
    throttle: ['ArrowRight'], brake: ['ArrowDown'], left: ['KeyA'], right: ['KeyD'],
    clutch: ['ArrowLeft', 'ShiftLeft', 'ShiftRight'], handbrake: ['ArrowUp', 'Space'], clutchName: '←', goName: '→',
  },
};
let layoutName = 'standard';
try { if (LAYOUTS[localStorage.getItem('clutchrun-layout')]) layoutName = localStorage.getItem('clutchrun-layout'); } catch (e) {}
let K = LAYOUTS[layoutName];
const keys = new Set();
const state = {
  started: false, paused: false, cam: 0, horn: false,
  throttle: 0, brake: 0, handbrake: 0, clutchHold: 0,
  crashes: 0, stalls: 0, grinds: 0, crashCool: 0, shake: 0,
  lap: 1, lapStart: null, lapTime: 0, best: null, nextCp: 0,
  greenT: 0, driveT: 0, lastToast: {},
};

function toastOnce(key, text, tone, gap = 4) {
  const now = performance.now() / 1000;
  if (state.lastToast[key] && now - state.lastToast[key] < gap) return;
  state.lastToast[key] = now; hud.toast(text, tone);
}

function requestGear(g) {
  if (!state.started || g === dt.gear) return;
  if (!dt.autoClutch && dt.pedal < 0.8) {
    sound.grind(); state.grinds++; hud.toast(`Press the clutch (${K.clutchName}) first`, 'warn'); return;
  }
  if (g === -1 && dt.v > 0.8) { sound.grind(); state.grinds++; hud.toast('Stop before selecting reverse', 'warn'); return; }
  if (g > 0 && dt.v < -0.8) { sound.grind(); state.grinds++; hud.toast('Stop before selecting a forward gear', 'warn'); return; }
  if (g > 0 && dt.wheelRpmFor(g) > 6900) {
    sound.grind(); state.grinds++;
    hud.toast(`Too fast for ${ORD[g]}: the engine would over-rev`, 'bad'); return;
  }
  dt.setGear(g); sound.shift();
}

const CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyH'];
window.addEventListener('keydown', e => {
  if (CODES.includes(e.code)) e.preventDefault();
  if (!state.started) return;
  if (e.code === 'KeyP' || e.code === 'Escape') { setPaused(!state.paused); return; }
  if (state.paused) return;
  keys.add(e.code);
  if (e.repeat) return;
  const c = e.code;
  if (/^Digit[1-5]$/.test(c)) requestGear(+c.slice(5));
  else if (c === 'Digit0' || c === 'KeyN' || c === 'Backquote') requestGear(0);
  else if (c === 'KeyR') requestGear(-1);
  else if (c === 'KeyE') requestGear(dt.gear < 0 ? 0 : Math.min(TOP_GEAR, dt.gear + 1));
  else if (c === 'KeyQ') requestGear(dt.gear <= 0 ? dt.gear : dt.gear - 1);
  else if (c === 'KeyI') {
    if (dt.on) return;
    if (dt.gear !== 0 && (dt.autoClutch ? false : dt.pedal < 0.8)) { hud.toast(`Clutch in (${K.clutchName}) or select neutral (N) to start`, 'warn'); return; }
    if (dt.gear !== 0 && dt.autoClutch) dt.setGear(0);
    if (dt.crank()) hud.toast('Starting…');
  }
  else if (c === 'KeyC') { dt.autoClutch = !dt.autoClutch; hud.toast(dt.autoClutch ? 'Auto clutch on' : `Manual clutch: hold ${K.clutchName} to press it`); }
  else if (c === 'KeyV') { state.cam = (state.cam + 1) % CAMS.length; hud.toast(CAMS[state.cam]); }
  else if (c === 'KeyT') { const n = world.nearest(player.x, player.z, 6); spawnAt(n ? n.i * world.ds : 0); dt.setGear(0); hud.toast('Back on the road'); }
  else if (c === 'KeyM') { sound.setMuted(!sound.muted); hud.toast(sound.muted ? 'Sound off' : 'Sound on'); }
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
const down = (...c) => c.some(k => keys.has(k));

/* ---------- Collisions ---------- */
const CR = 0.95, CO = 1.1; // car = two circles along its length
const circles = (x, z, yaw) => { const fx = Math.sin(yaw) * CO, fz = Math.cos(yaw) * CO; return [[x + fx, z + fz], [x - fx, z - fz]]; };

function crash(rel, what) {
  if (state.crashCool > 0) return;
  state.crashCool = 1.0; state.crashes++;
  const k = clamp(rel / 14, 0.25, 1);
  sound.crash(k); hud.flash = k; state.shake = 0.6 * k;
  hud.toast(what, 'bad');
}

function collide() {
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
  let hit = null; // strongest contact this frame: {into, rel, car}
  const contact = (nx, nz, o, rel, car) => {
    player.x += nx * o; player.z += nz * o;
    const into = -(fx * nx + fz * nz) * dt.v; // speed towards the obstacle
    const r = car ? rel : Math.max(0, into);
    if (!hit || r > hit.rel) hit = { into, rel: r, car };
  };
  for (const c of world.colliders) {
    if (Math.abs(c.x - player.x) > 5 || Math.abs(c.z - player.z) > 5) continue;
    for (const p of circles(player.x, player.z, player.yaw)) {
      const dx = p[0] - c.x, dz = p[1] - c.z, d = Math.hypot(dx, dz), min = CR + c.r;
      if (d < min && d > 1e-4) contact(dx / d, dz / d, min - d, 0, null);
    }
  }
  for (const t of traffic) {
    if (Math.abs(t.x - player.x) > 7 || Math.abs(t.z - player.z) > 7) continue;
    for (const p of circles(player.x, player.z, player.yaw)) for (const q of circles(t.x, t.z, t.yaw)) {
      const dx = p[0] - q[0], dz = p[1] - q[1], d = Math.hypot(dx, dz), min = CR * 2;
      if (d < min && d > 1e-4) {
        const rel = Math.hypot(fx * dt.v - Math.sin(t.yaw) * t.speed, fz * dt.v - Math.cos(t.yaw) * t.speed);
        contact(dx / d, dz / d, min - d, rel, t);
      }
    }
  }
  if (!hit) return;
  if (hit.rel > 2 && state.crashCool <= 0) {
    crash(hit.rel, hit.car ? 'Crash! You hit another car' : 'Crash!');
    if (hit.into > 0) dt.v *= -0.15;
    if (hit.car) { hit.car.stopT = 3.5; hit.car.speed = 0; }
  } else if (hit.into > 0) dt.v *= 0.4; // scraping or pushing: lose speed
}

/* ---------- Traffic ---------- */
function updateTraffic(h, pd, pLane) {
  for (const t of traffic) {
    if (t.stopT > 0) { t.stopT -= h; t.speed = Math.max(0, t.speed - 9 * h); }
    else {
      let gap = Infinity;
      for (const o of traffic) if (o !== t && o.lane === t.lane) { const gd = wrap((o.d - t.d) * t.dir); if (gd < gap) gap = gd; }
      if (pLane === t.lane || pLane === 0) { const gd = wrap((pd - t.d) * t.dir); if (gd < gap) gap = gd; }
      let tgt = t.cruise;
      if (gap < 50) tgt = Math.min(tgt, Math.max(0, (gap - 9) * 0.5));
      t.speed += clamp(tgt - t.speed, -8 * h, 2.2 * h);
    }
    t.braking = t.speed < t.lastSpeed - 0.01;
    t.lastSpeed = t.speed;
    t.d = wrap(t.d + t.speed * t.dir * h);
    const p = world.pointAt(t.d, t.lane * LANE);
    t.x = p.x; t.z = p.z; t.yaw = Math.atan2(p.tx, p.tz) + (t.dir < 0 ? Math.PI : 0);
    const grade = world.S[p.i].grade * t.dir;
    poseCar(t.car, p.x, p.y + 0.03, p.z, t.yaw, -Math.atan(grade), 0, t.speed, 0, h, t.braking || t.speed < 0.5);
  }
}

/* ---------- Coaching ---------- */
function bestGear(dir) {
  const inBand = g => { const r = dt.wheelRpmFor(g); return r >= 1600 && r <= 4800; };
  if (dir > 0) { for (let g = dt.gear + 1; g <= TOP_GEAR; g++) if (inBand(g)) return g; return Math.min(TOP_GEAR, dt.gear + 1); }
  for (let g = dt.gear - 1; g >= 1; g--) if (inBand(g)) return g;
  return Math.max(1, dt.gear - 1);
}

function coach(n, grade) {
  const rpm = dt.rpm, sp = dt.v;
  if (dt.crankT > 0) return { hint: { text: 'Starting the engine…', tone: 'warn' } };
  if (!dt.on) return { hint: { text: 'Stalled. Press I to restart (select N first)', tone: 'bad' } };
  if (n && n.dist > ROAD_HALF + 1 && Math.abs(sp) > 1) return { hint: { text: 'Off the road. Press T to get back on it', tone: 'warn' } };
  if (n && n.lat < -0.6 && sp > 3 && n.dist < ROAD_HALF + 1) return { hint: { text: 'Keep left: you are in the oncoming lane', tone: 'bad' } };
  if (!dt.autoClutch && dt.gear !== 0 && Math.abs(sp) < 4 && dt.pedal < BITE_TOP && dt.pedal > BITE_BOTTOM) {
    if (rpm < 1000) return { hint: { text: `Revs dropping: more accelerator, or clutch back in (${K.clutchName})`, tone: 'bad' } };
    return { hint: { text: `Clutch at the bite point: tap ${K.clutchName} to hold it here`, tone: 'good' } };
  }
  if (dt.gear === 0 && state.throttle > 0.3 && Math.abs(sp) < 1) return { hint: { text: 'You are in neutral. Press 1 for first gear', tone: 'warn' }, suggest: { gear: 1, dir: 1 } };
  if (dt.gear > 0) {
    if (rpm > 5600 && dt.gear < TOP_GEAR) { const g = bestGear(1); return { hint: { text: `High revs: change up to ${ORD[g]}`, tone: 'bad' }, suggest: { gear: g, dir: 1 } }; }
    if (grade > 0.06 && dt.gear >= 3 && rpm < 2300 && sp > 2) { const g = Math.min(2, bestGear(-1)); return { hint: { text: `Steep climb: change down to ${ORD[g]}`, tone: 'warn' }, suggest: { gear: g, dir: -1 } }; }
    if (sp > 2 && rpm < 1300 && state.throttle > 0.25 && dt.gear > 1) { const g = bestGear(-1); return { hint: { text: `Revs too low: change down to ${ORD[g]}`, tone: 'warn' }, suggest: { gear: g, dir: -1 } }; }
    if (grade < -0.06 && dt.gear >= 4 && sp > 12) return { hint: { text: 'Steep descent: a lower gear holds your speed', tone: 'warn' }, suggest: { gear: 3, dir: -1 } };
    if (rpm > 3200 && dt.gear < TOP_GEAR && state.throttle < 0.5 && Math.abs(grade) < 0.03) { const g = bestGear(1); if (dt.wheelRpmFor(g) > 1500) return { suggest: { gear: g, dir: 1 } }; }
  }
  return {};
}

/* ---------- Main update ---------- */
const CAMS = ['Behind the car', "Driver's seat", 'Bonnet'];
const seat = new THREE.Vector3(), flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), head = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let camInit = false;

function update(h) {
  // pedals and steering
  const ramp = (cur, on, up, dn) => clamp(cur + (on ? up : -dn) * h, 0, 1);
  state.throttle = ramp(state.throttle, down(...K.throttle), 3.5, 6);
  state.brake = ramp(state.brake, down(...K.brake), 4, 8);
  state.handbrake = down(...K.handbrake) ? 1 : 0;
  // Clutch pedal. Holding the key pushes it down (gently for the first moment, so a tap nudges it).
  // Letting go lets it rise by itself: quickly to the bite point, slowly through it, quickly after,
  // the way a driver's foot does. Tap while it rises to hover at the bite point.
  const clutchDown = down(...K.clutch);
  state.clutchHold = clutchDown ? state.clutchHold + h : 0;
  if (clutchDown) dt.pedal += (state.clutchHold < 0.2 ? 1.5 : 6) * h;
  else dt.pedal -= (dt.pedal <= BITE_TOP + 0.02 && dt.pedal >= BITE_BOTTOM ? 0.45 : 3) * h;
  dt.pedal = clamp(dt.pedal, 0, 1);
  state.horn = down('KeyH');

  const sp = Math.abs(dt.v);
  const steerIn = (down(...K.left) ? 1 : 0) - (down(...K.right) ? 1 : 0);
  const maxSteer = 0.55 / (1 + sp * 0.07);
  const tgt = steerIn * maxSteer;
  // The wheel turns like a driver's hands move it: a critically damped spring eases in and out
  // instead of jumping straight to a fixed turning rate, so the car never snaps into a turn.
  const sw = steerIn ? 10 : 12;
  player.steerVel += (sw * sw * (tgt - player.steer) - 2 * sw * player.steerVel) * h;
  player.steer += player.steerVel * h;

  // surface and slope
  const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw), lx = fz, lz = -fx;
  const here = world.surfaceAt(player.x, player.z);
  const hF = world.surfaceAt(player.x + fx * 1.25, player.z + fz * 1.25).y;
  const hB = world.surfaceAt(player.x - fx * 1.25, player.z - fz * 1.25).y;
  const hL = world.surfaceAt(player.x + lx * 0.8, player.z + lz * 0.8).y;
  const hR = world.surfaceAt(player.x - lx * 0.8, player.z - lz * 0.8).y;
  const sinG = clamp((hF - hB) / 2.5, -0.5, 0.5);
  const crr = here.surf === 'asphalt' ? 0.015 : here.surf === 'gravel' ? 0.035 : 0.1;
  const grip = here.surf === 'asphalt' ? 1 : here.surf === 'gravel' ? 0.82 : 0.7;

  dt.step(h, { throttle: state.throttle, brake: state.brake, handbrake: state.handbrake }, { sinGrade: sinG, crr });
  for (const ev of dt.events) {
    if (ev === 'stall') { state.stalls++; sound.clunk(); hud.toast('Stalled!', 'bad'); }
    if (ev === 'started') hud.toast('Engine running', 'good');
  }
  dt.events.length = 0;

  // move
  player.yaw += dt.v / SPEC.wheelbase * Math.tan(player.steer) * grip * h;
  player.x += Math.sin(player.yaw) * dt.v * h;
  player.z += Math.cos(player.yaw) * dt.v * h;
  player.x = clamp(player.x, -HALF + 20, HALF - 20); player.z = clamp(player.z, -HALF + 20, HALF - 20);
  collide();
  state.crashCool -= h;

  const now = world.surfaceAt(player.x, player.z);
  player.y += (now.y - player.y) * Math.min(1, h * 20);
  player.pitch += (-Math.atan(sinG) - player.pitch) * Math.min(1, h * 10);
  player.roll += (Math.atan((hL - hR) / 1.6) - player.roll) * Math.min(1, h * 10);
  poseCar(player.car, player.x, player.y, player.z, player.yaw, player.pitch, player.roll, dt.v, player.steer, h, state.brake > 0.1);

  // where we are on the loop
  const n = world.nearest(player.x, player.z, 3);
  const pd = n ? wrap(n.i * world.ds + n.along) : 0;
  const pLane = n && n.dist < ROAD_HALF + 1 ? (n.lat > 0.4 ? 1 : n.lat < -0.4 ? -1 : 0) : 2;
  updateTraffic(h, pd, pLane);

  // laps
  if (state.lapStart === null && sp > 0.5) state.lapStart = performance.now() / 1000;
  if (state.lapStart !== null) state.lapTime = performance.now() / 1000 - state.lapStart;
  if (n) {
    const cps = [0.25, 0.5, 0.75].map(f => f * L);
    if (state.nextCp < 3 && Math.abs(wrapDiff(pd, cps[state.nextCp])) < 20) state.nextCp++;
    else if (state.nextCp === 3 && Math.abs(wrapDiff(pd, 0)) < 12) {
      const t = state.lapTime; state.best = state.best ? Math.min(state.best, t) : t;
      showLap(t); state.lap++; state.nextCp = 0; state.lapStart = performance.now() / 1000;
    }
  }

  // driving quality: time with the revs in a healthy band while moving
  if (sp > 2 && dt.on && dt.gear !== 0) { state.driveT += h; const r = dt.rpm; if (r >= 1400 && r <= 5000) state.greenT += h; }

  // sounds
  const lat = sp * sp * Math.abs(Math.tan(player.steer)) / SPEC.wheelbase;
  const squeal = clamp((lat - 6) / 6, 0, 1) + clamp((-dt.accel - 7) / 4, 0, 1) * (sp > 3 ? 1 : 0);
  sound.update({ rpm: dt.rpm, throttle: state.throttle, on: dt.on, cranking: dt.crankT > 0, speed: dt.v, surf: here.surf, squeal: clamp(squeal, 0, 1), horn: state.horn });

  // camera
  const cam = state.cam;
  player.car.interior.visible = cam === 1;
  let want, look;
  if (cam === 1) {
    // Driver's seat: fixed to the car, so it pitches and rolls with it; the head turns a little into corners
    const gp = player.car.group; gp.updateMatrixWorld();
    seat.set(DRIVER.x, DRIVER.y, DRIVER.z); gp.localToWorld(seat);
    camera.position.copy(seat);
    player.head += (player.steer * 0.35 - player.head) * (1 - Math.exp(-h * 3)); // the eyes follow the turn, a beat behind the hands
    head.setFromAxisAngle(UP, player.head);
    camera.quaternion.copy(gp.quaternion).multiply(flip).multiply(head);
    if (state.shake > 0) { camera.position.x += (Math.random() - 0.5) * state.shake * 0.3; camera.position.y += (Math.random() - 0.5) * state.shake * 0.3; state.shake = Math.max(0, state.shake - h * 1.2); }
    camera.fov = 70; camera.updateProjectionMatrix();
    camInit = false;
  } else {
  if (cam === 0) {
    want = new THREE.Vector3(player.x - fx * 8.5, player.y + 3.4, player.z - fz * 8.5);
    want.y = Math.max(want.y, world.surfaceAt(want.x, want.z).y + 1.6);
    look = new THREE.Vector3(player.x + fx * 5, player.y + 1.3, player.z + fz * 5);
  } else {
    want = new THREE.Vector3(player.x + fx * 0.4, player.y + 1.32, player.z + fz * 0.4);
    look = new THREE.Vector3(player.x + fx * 20, player.y + 1.2 + Math.tan(-player.pitch) * 20, player.z + fz * 20);
  }
  const k = cam === 0 ? 1 - Math.exp(-h * 4.5) : 1;
  if (!camInit) { camPos.copy(want); camLook.copy(look); camInit = true; }
  camPos.lerp(want, k); camLook.lerp(look, cam === 0 ? 1 - Math.exp(-h * 8) : 1);
  camera.position.copy(camPos);
  if (state.shake > 0) { camera.position.x += (Math.random() - 0.5) * state.shake; camera.position.y += (Math.random() - 0.5) * state.shake; state.shake = Math.max(0, state.shake - h * 1.2); }
  camera.lookAt(camLook);
  camera.fov = 60 + Math.min(12, sp * 0.3); camera.updateProjectionMatrix();
  }

  // HUD
  const c = coach(n, sinG);
  const section = !n || n.dist > ROAD_HALF + 1 ? 'Off road · grass'
    : `${here.surf === 'gravel' ? 'Gravel road' : 'Tarmac'}${sinG > 0.035 ? ` · climbing ${Math.round(sinG * 100)}%` : sinG < -0.035 ? ` · downhill ${Math.round(-sinG * 100)}%` : ''}`;
  hud.draw({
    rpm: dt.rpm, kmh: sp * 3.6, gearLabel: gearName(dt.gear), on: dt.on || dt.crankT > 0,
    suggest: c.suggest, hint: c.hint,
    clutch: dt.autoClutch ? (dt.gear === 0 ? 0 : 1 - dt.eng) : dt.pedal, brake: state.brake, throttle: state.throttle,
    auto: dt.autoClutch, clutchKey: K.clutchName, bite: [BITE_BOTTOM, BITE_TOP], section, lap: state.lap, lapTime: state.lapTime, best: state.best,
    crashes: state.crashes, stalls: state.stalls, grinds: state.grinds,
    green: state.driveT > 1 ? Math.round(100 * state.greenT / state.driveT) : 100,
    traffic, x: player.x, z: player.z, yaw: player.yaw,
  }, h);
}

/* ---------- Loop ---------- */
let last = performance.now();
function frame(t) {
  const h = Math.min(0.05, (t - last) / 1000); last = t;
  if (!state.paused) update(state.started ? h : 0.0001);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

/* ---------- Menus ---------- */
const $ = id => document.getElementById(id);
function setPaused(p) {
  state.paused = p; $('pause').hidden = !p;
  if (sound.ctx) p ? sound.ctx.suspend() : sound.ctx.resume();
}
function showLap(t) {
  const pct = state.driveT > 1 ? Math.round(100 * state.greenT / state.driveT) : 100;
  $('lap-text').textContent = `Lap ${state.lap} in ${fmtTime(t)}. Crashes ${state.crashes}, stalls ${state.stalls}, revs in the green ${pct}% of the time.`;
  $('lap').hidden = false; clearTimeout(showLap.t); showLap.t = setTimeout(() => { $('lap').hidden = true; }, 7000);
}
function setLayout(name) {
  layoutName = name; K = LAYOUTS[name];
  document.querySelectorAll('[data-layout]').forEach(x => x.setAttribute('aria-pressed', x.dataset.layout === name));
  document.querySelectorAll('[data-keys]').forEach(x => { x.hidden = x.dataset.keys !== name; });
  try { localStorage.setItem('clutchrun-layout', name); } catch (e) {}
}
document.querySelectorAll('[data-layout]').forEach(b => b.addEventListener('click', () => setLayout(b.dataset.layout)));
setLayout(layoutName);
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', x === b));
  dt.autoClutch = b.dataset.mode === 'auto';
}));
$('go').addEventListener('click', () => {
  sound.init(); state.started = true; $('menu').hidden = true;
  hud.toast(`Press 1 for first gear, then ${K.goName} to go`, 'fg');
  canvas.focus();
});
$('resume').addEventListener('click', () => setPaused(false));
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
  hud.resize();
});

spawnAt(6);
requestAnimationFrame(frame);
// test hook: advance the simulation without waiting for frames
window.__game = { dt, player, state, world, traffic, sim: secs => { for (let i = 0; i < secs * 60; i++) update(1 / 60); } };
