// Sky, light, weather and time of day. The sun follows the player's own clock by default
// (or a chosen time), and the weather changes the sky, the fog, the light and the grip.
import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export const TIMES = { now: 'Now (your clock)', morning: 'Morning', noon: 'Midday', evening: 'Evening', night: 'Night' };
export const WEATHERS = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', fog: 'Fog' };
const FIXED_HOUR = { morning: 7.2, noon: 12.5, evening: 18.3, night: 22 };

// Colours at three points of the day; twilight is blended in around sunrise and sunset.
const C = {
  dayTop: new THREE.Color(0x6f9fd0), dayHz: new THREE.Color(0xcfdde6),
  duskTop: new THREE.Color(0x3d5b8c), duskHz: new THREE.Color(0xf2a36b),
  nightTop: new THREE.Color(0x060b16), nightHz: new THREE.Color(0x141c2b),
  grey: new THREE.Color(0x9aa3ab), rainGrey: new THREE.Color(0x737c85), fogGrey: new THREE.Color(0xc5c9cc),
  sunDay: new THREE.Color(0xfff0da), sunLow: new THREE.Color(0xffa55c), moon: new THREE.Color(0x9fb4ff),
  hemiDay: new THREE.Color(0xe3efff), hemiNight: new THREE.Color(0x4a5a80),
};

const RADIUS = 1600, DROPS = 1400, RAIN_BOX = 70;

export class Sky {
  constructor(scene) {
    this.scene = scene;
    this.time = 'now'; this.weather = 'clear'; this.view = 950;
    this.hemi = new THREE.HemisphereLight(0xe3efff, 0x55623a, 1.15); scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0da, 2.3); scene.add(this.sun, this.sun.target);
    scene.fog = new THREE.Fog(0xcfdde6, 180, 950);

    // sky dome: colour from horizon to zenith, rewritten when the time or weather changes
    const geo = new THREE.SphereGeometry(RADIUS, 24, 12);
    this.domeT = Array.from({ length: geo.attributes.position.count }, (_, i) => clamp(geo.attributes.position.getY(i) / RADIUS, 0, 1));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(this.domeT.length * 3), 3));
    this.dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.dome.renderOrder = -1; scene.add(this.dome);

    // stars, faded in at night under a clear sky
    const sp = [];
    for (let i = 0; i < 700; i++) {
      const a = Math.random() * Math.PI * 2, e = Math.asin(0.08 + Math.random() * 0.92), r = RADIUS * 0.95;
      sp.push(Math.cos(e) * Math.cos(a) * r, Math.sin(e) * r, Math.cos(e) * Math.sin(a) * r);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, fog: false, depthWrite: false }));
    scene.add(this.stars);

    // rain: short streaks in a box that travels with the camera
    const rp = new Float32Array(DROPS * 6);
    for (let i = 0; i < DROPS; i++) { const x = (Math.random() - 0.5) * RAIN_BOX, y = Math.random() * 30, z = (Math.random() - 0.5) * RAIN_BOX; rp.set([x, y, z, x, y - 0.7, z], i * 6); }
    const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaab8c6, transparent: true, opacity: 0.45 }));
    this.rain.frustumCulled = false; this.rain.visible = false; scene.add(this.rain);
    this.rainOrigin = new THREE.Vector3();

    this.clockT = 0; this.apply();
  }

  set(time, weather) { if (time) this.time = time; if (weather) this.weather = weather; this.apply(); }
  setView(m) { this.view = m; this.apply(); } // how far the world is built: fog closes in before its edge

  hour() {
    if (this.time !== 'now') return FIXED_HOUR[this.time];
    const d = new Date(); return d.getHours() + d.getMinutes() / 60;
  }

  apply() {
    const hr = this.hour();
    // sun: rises at 6:00, sets at 18:30, highest (about 70 degrees) at midday
    const elev = Math.sin(Math.PI * (hr - 6) / 12.5) * 70; // degrees; negative is below the horizon
    const day = smooth(-8, 10, elev), dusk = clamp(1 - Math.abs(elev - 2) / 12, 0, 1) * (hr > 12 ? 1 : 0.7);
    this.dark = 1 - day; // 0 in daylight, 1 at night

    const top = C.nightTop.clone().lerp(C.dayTop, day).lerp(C.duskTop, dusk * 0.6);
    const hz = C.nightHz.clone().lerp(C.dayHz, day).lerp(C.duskHz, dusk * 0.75);
    let sunI = 2.3 * day + 0.35 * (1 - day), hemiI = 0.18 + 0.97 * day, near = 180, far = 950;
    const sunCol = elev > 0 ? C.sunDay.clone().lerp(C.sunLow, clamp(1 - elev / 25, 0, 1)) : C.moon.clone();

    const w = this.weather;
    if (w === 'cloudy') { top.lerp(C.grey.clone().multiplyScalar(0.35 + 0.65 * day), 0.65); hz.lerp(C.grey.clone().multiplyScalar(0.3 + 0.7 * day), 0.6); sunI *= 0.35; hemiI *= 0.9; }
    if (w === 'rain') { top.lerp(C.rainGrey.clone().multiplyScalar(0.25 + 0.75 * day), 0.8); hz.lerp(C.rainGrey.clone().multiplyScalar(0.25 + 0.75 * day), 0.8); sunI *= 0.2; hemiI *= 0.75; near = 40; far = 380; }
    if (w === 'fog') { top.lerp(C.fogGrey.clone().multiplyScalar(0.2 + 0.8 * day), 0.9); hz.lerp(C.fogGrey.clone().multiplyScalar(0.2 + 0.8 * day), 0.92); sunI *= 0.4; near = 4; far = 120; }
    far = Math.min(far, this.view); near = Math.min(near, far * 0.5);

    this.hemi.color.copy(C.hemiNight).lerp(C.hemiDay, day); this.hemi.intensity = hemiI;
    this.hemi.groundColor.setHex(0x55623a).multiplyScalar(0.25 + 0.75 * day);
    this.sun.color.copy(sunCol); this.sun.intensity = sunI;
    // moonlight comes from high up; the sun from where it is in the sky
    const e = elev > 0 ? elev : 50, az = (hr - 6) / 12.5 * Math.PI;
    this.sunDir = new THREE.Vector3(-Math.cos(az) * Math.cos(e * Math.PI / 180), Math.sin(e * Math.PI / 180), 0.45).normalize();

    this.scene.fog.color.copy(hz); this.scene.fog.near = near; this.scene.fog.far = far;
    this.scene.background = hz.clone();
    const col = this.dome.geometry.attributes.color, c = new THREE.Color();
    this.domeT.forEach((t, i) => { c.copy(hz).lerp(top, Math.pow(t, 0.6)); col.setXYZ(i, c.r, c.g, c.b); });
    col.needsUpdate = true;
    this.stars.material.opacity = w === 'clear' ? this.dark : 0; this.stars.visible = this.stars.material.opacity > 0.02;
    this.rain.visible = w === 'rain';
    this.grip = w === 'rain' ? 0.78 : 1; // a wet road: less grip for steering and braking
  }

  // per frame: keep the sky around the camera, move the rain, follow the clock
  update(h, camera, speed = 0) {
    const p = camera.position;
    this.dome.position.copy(p); this.stars.position.copy(p);
    this.sun.position.copy(p).addScaledVector(this.sunDir, 500); this.sun.target.position.copy(p);
    if (this.time === 'now' && (this.clockT += h) > 30) { this.clockT = 0; this.apply(); }
    if (this.rain.visible) {
      const a = this.rain.geometry.attributes.position, arr = a.array, fall = 16 * h, half = RAIN_BOX / 2;
      const ox = p.x - this.rainOrigin.x, oz = p.z - this.rainOrigin.z;
      for (let i = 0; i < DROPS; i++) {
        const k = i * 6; let x = arr[k] - ox, y = arr[k + 1] - fall, z = arr[k + 2] - oz;
        if (y < -4) y += 30;
        if (x < -half) x += RAIN_BOX; else if (x > half) x -= RAIN_BOX;
        if (z < -half) z += RAIN_BOX; else if (z > half) z -= RAIN_BOX;
        arr[k] = arr[k + 3] = x; arr[k + 1] = y; arr[k + 4] = y - 0.7; arr[k + 2] = arr[k + 5] = z;
      }
      a.needsUpdate = true; this.rainOrigin.set(p.x, 0, p.z);
      this.rain.position.set(p.x, p.y - 6, p.z);
    }
  }
}
