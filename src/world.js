// World: terrain heightfield, the road loop, scenery and colliders.
import * as THREE from 'three';

export const SIZE = 1400;            // metres, square world
export const RES = 4;                // metres between terrain vertices
export const NV = SIZE / RES + 1;    // vertices per side
export const HALF = SIZE / 2;
export const LANE = 2.0;             // lane centre offset from road centre
export const ROAD_HALF = 4.0;        // half road width

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lin = c => Math.pow(c, 2.2); // sRGB-ish value to linear for vertex colours

export function mulberry(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rolling countryside with one big hill (the climb) and a smaller one.
export function baseHeight(x, z) {
  let h = 6 * Math.sin(x * 0.004 + 1.3) * Math.cos(z * 0.0035 - 0.4)
        + 3 * Math.sin(x * 0.011 + z * 0.007)
        + 1.5 * Math.sin(x * 0.023 - z * 0.019 + 2);
  h += 58 * Math.exp(-((x - 265) ** 2 + (z + 190) ** 2) / (2 * 165 * 165));
  h += 24 * Math.exp(-((x + 390) ** 2 + (z - 330) ** 2) / (2 * 140 * 140));
  h -= 10 * Math.exp(-((x + 150) ** 2 + (z + 300) ** 2) / (2 * 200 * 200));
  return h;
}

// The route, as control points (x, z). Driven in this order, keeping left.
const ROUTE = [
  [-430, -40], [-330, -230], [-120, -360], [120, -410], [290, -320],
  [265, -190], [350, -60], [230, 80], [60, 190], [-130, 360],
  [-330, 440], [-480, 320], [-540, 130],
];

function inRange(i, a, b) { return a <= b ? i >= a && i < b : i >= a || i < b; }

export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = [];
    this.buildRoute();
    this.buildTerrain();
    this.buildRoad();
    this.buildScenery();
  }

  buildRoute() {
    const curve = new THREE.CatmullRomCurve3(ROUTE.map(p => new THREE.Vector3(p[0], 0, p[1])), true, 'centripetal');
    this.length = curve.getLength();
    const N = Math.round(this.length / 2);
    this.N = N; this.ds = this.length / N;
    const pts = curve.getSpacedPoints(N);
    const S = [];
    for (let i = 0; i < N; i++) S.push({ x: pts[i].x, z: pts[i].z });
    for (let i = 0; i < N; i++) {
      const a = S[(i - 1 + N) % N], b = S[(i + 1) % N];
      let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz); tx /= l; tz /= l;
      Object.assign(S[i], { tx, tz, lx: tz, lz: -tx });   // left = (tz, -tx)
    }
    // Road height follows the land, smoothed so gradients stay drivable.
    let h = S.map(s => baseHeight(s.x, s.z));
    for (let pass = 0; pass < 3; pass++) {
      const w = 18, out = new Array(N);
      for (let i = 0; i < N; i++) { let sum = 0; for (let k = -w; k <= w; k++) sum += h[(i + k + N) % N]; out[i] = sum / (2 * w + 1); }
      h = out;
    }
    S.forEach((s, i) => { s.y = h[i]; });
    this.cpIndex = ROUTE.map(p => { let best = 0, bd = Infinity; S.forEach((s, i) => { const d = (s.x - p[0]) ** 2 + (s.z - p[1]) ** 2; if (d < bd) { bd = d; best = i; } }); return best; });
    const g0 = this.cpIndex[4], g1 = this.cpIndex[7];
    S.forEach((s, i) => { s.surf = inRange(i, g0, g1) ? 'gravel' : 'asphalt'; });
    S.forEach((s, i) => { s.grade = (S[(i + 3) % N].y - S[(i - 3 + N) % N].y) / (6 * this.ds); });
    this.S = S;
    this.cell = 25; this.hash = new Map();
    S.forEach((s, i) => {
      const k = this.key(Math.floor(s.x / this.cell), Math.floor(s.z / this.cell));
      if (!this.hash.has(k)) this.hash.set(k, []);
      this.hash.get(k).push(i);
    });
  }

  key(a, b) { return a * 100003 + b; }

  // Nearest road sample, with lateral offset (+ = left of travel) and road height.
  nearest(x, z, r = 1) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bd = Infinity;
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      const arr = this.hash.get(this.key(cx + a, cz + b)); if (!arr) continue;
      for (const i of arr) { const s = this.S[i]; const d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; best = i; } }
    }
    if (best < 0) return null;
    const s = this.S[best], dx = x - s.x, dz = z - s.z;
    const along = dx * s.tx + dz * s.tz, lat = dx * s.lx + dz * s.lz;
    const j = along >= 0 ? (best + 1) % this.N : (best - 1 + this.N) % this.N;
    const f = Math.min(1, Math.abs(along) / this.ds);
    const y = s.y + (this.S[j].y - s.y) * f;
    const dist = Math.abs(along) <= this.ds ? Math.abs(lat) : Math.sqrt(bd);
    return { i: best, s, lat, along, y, dist };
  }

  // Point on the road at distance d along the loop, offset sideways by lat.
  pointAt(d, lat = 0) {
    const L = this.length; d = ((d % L) + L) % L;
    const f = d / this.ds, i = Math.floor(f) % this.N, j = (i + 1) % this.N, t = f - Math.floor(f);
    const a = this.S[i], b = this.S[j];
    const lx = lerp(a.lx, b.lx, t), lz = lerp(a.lz, b.lz, t);
    return { x: lerp(a.x, b.x, t) + lx * lat, z: lerp(a.z, b.z, t) + lz * lat, y: lerp(a.y, b.y, t), tx: lerp(a.tx, b.tx, t), tz: lerp(a.tz, b.tz, t), i };
  }

  buildTerrain() {
    const H = new Float32Array(NV * NV); this.H = H;
    const pos = new Float32Array(NV * NV * 3), col = new Float32Array(NV * NV * 3);
    const rnd = mulberry(7);
    for (let j = 0; j < NV; j++) for (let i = 0; i < NV; i++) {
      const x = -HALF + i * RES, z = -HALF + j * RES, b = baseHeight(x, z);
      const n = this.nearest(x, z, 2);
      let h = b, d = Infinity;
      if (n) {
        d = n.dist; const hr = n.y - 0.05;
        h = d < ROAD_HALF + 1.5 ? hr : lerp(hr, b, smooth(ROAD_HALF + 1.5, 32, d));
      }
      const k = j * NV + i; H[k] = h;
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      const v = (Math.sin(x * 0.05) * Math.sin(z * 0.043) + Math.sin(x * 0.13 + z * 0.11)) * 0.035 + (rnd() - 0.5) * 0.03;
      let r = 0.36 + v, g = 0.52 + v * 1.2, bl = 0.25 + v * 0.5;
      const hi = smooth(30, 55, h); r = lerp(r, 0.6, hi); g = lerp(g, 0.56, hi); bl = lerp(bl, 0.38, hi);
      if (d < ROAD_HALF + 3) { r = 0.5; g = 0.43; bl = 0.32; }
      col[k * 3] = lin(r); col[k * 3 + 1] = lin(g); col[k * 3 + 2] = lin(bl);
    }
    const idx = new Uint32Array((NV - 1) * (NV - 1) * 6); let p = 0;
    for (let j = 0; j < NV - 1; j++) for (let i = 0; i < NV - 1; i++) {
      const a = j * NV + i, b = a + 1, c = a + NV, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
    this.scene.add(mesh);
  }

  groundHeight(x, z) {
    const fx = clamp((x + HALF) / RES, 0, NV - 1.001), fz = clamp((z + HALF) / RES, 0, NV - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, H = this.H;
    const a = H[j * NV + i], b = H[j * NV + i + 1], c = H[(j + 1) * NV + i], d = H[(j + 1) * NV + i + 1];
    return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
  }

  // Height and surface under a point: road if on the tarmac/gravel, terrain otherwise.
  surfaceAt(x, z) {
    const n = this.nearest(x, z, 1);
    if (n && n.dist <= ROAD_HALF + 0.3) return { y: n.y + 0.03, surf: n.s.surf, road: n };
    return { y: this.groundHeight(x, z), surf: 'grass', road: n };
  }

  buildRoad() {
    const tex = { asphalt: roadTexture(false), gravel: roadTexture(true) };
    const S = this.S, N = this.N;
    // contiguous runs of the same surface
    let start = 0; while (start < N && S[(start - 1 + N) % N].surf === S[start].surf) start++;
    if (start >= N) start = 0;
    let run = [start];
    const runs = [];
    for (let k = 1; k <= N; k++) {
      const i = (start + k) % N;
      run.push(i);
      if (S[i].surf !== S[run[0]].surf || k === N) { runs.push(run); run = [i]; }
    }
    let cum = 0;
    for (const r of runs) {
      const surf = S[r[0]].surf;
      const pos = [], uv = [], idx = [];
      r.forEach((i, k) => {
        const s = S[i];
        if (k > 0) { const p = S[r[k - 1]]; cum += Math.hypot(s.x - p.x, s.z - p.z); }
        pos.push(s.x + s.lx * ROAD_HALF, s.y + 0.03, s.z + s.lz * ROAD_HALF, s.x - s.lx * ROAD_HALF, s.y + 0.03, s.z - s.lz * ROAD_HALF);
        uv.push(0, cum / 10, 1, cum / 10);
        if (k > 0) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex[surf], roughness: 0.95, metalness: 0, side: THREE.DoubleSide }));
      this.scene.add(m);
    }
    // start / finish line
    const s0 = S[0];
    const line = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 1.2), new THREE.MeshBasicMaterial({ map: chequer() }));
    line.rotation.x = -Math.PI / 2; line.rotation.z = Math.atan2(s0.tx, s0.tz);
    line.position.set(s0.x, s0.y + 0.05, s0.z);
    this.scene.add(line);
  }

  addCollider(x, z, r) { this.colliders.push({ x, z, r }); }

  buildScenery() {
    const rnd = mulberry(42), S = this.S, N = this.N, scene = this.scene;
    // Village around the start line
    const wall = [0xe8d8b8, 0xd9c2a0, 0xc9d3d6, 0xe3c9b0, 0xf0e6d2, 0xbfae98];
    const roofC = [0x8a3b2a, 0x6d4a3a, 0x4f5a64, 0x9a5130];
    const village = [];
    for (let k = -110; k < 130; k += 9) village.push((k + N) % N);
    for (const i of village) {
      for (const side of [1, -1]) {
        if (rnd() < 0.35) continue;
        const s = S[i], w = 6 + rnd() * 4, d = 6 + rnd() * 4, hgt = 3.5 + rnd() * 3.5;
        const off = side * (ROAD_HALF + 6 + d / 2 + rnd() * 3);
        const x = s.x + s.lx * off, z = s.z + s.lz * off;
        const n = this.nearest(x, z, 1); if (n && n.dist < ROAD_HALF + 4 + d / 2) continue;
        const y = this.groundHeight(x, z);
        const g = new THREE.Group();
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, hgt, d), new THREE.MeshStandardMaterial({ color: wall[Math.floor(rnd() * wall.length)], roughness: 0.9 }));
        body.position.y = hgt / 2 - 0.5;
        const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 2.4, 4), new THREE.MeshStandardMaterial({ color: roofC[Math.floor(rnd() * roofC.length)], roughness: 0.8 }));
        roof.position.y = hgt - 0.5 + 1.2; roof.rotation.y = Math.PI / 4; roof.scale.set(w / Math.max(w, d), 1, d / Math.max(w, d));
        g.add(body, roof);
        g.position.set(x, y, z); g.rotation.y = Math.atan2(s.tx, s.tz);
        scene.add(g);
        this.addCollider(x, z, Math.min(w, d) / 2 + 0.4);
      }
    }
    // Trees
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 2.2, 6); trunkGeo.translate(0, 1.1, 0);
    const crownGeo = new THREE.ConeGeometry(1.6, 4.6, 7); crownGeo.translate(0, 4.2, 0);
    const MAX = 1100;
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 1 }), MAX);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0x3f6b3a, roughness: 1 }), MAX);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
    let count = 0;
    const vc = S[0];
    for (let t = 0; t < 6000 && count < MAX; t++) {
      const x = (rnd() - 0.5) * (SIZE - 40), z = (rnd() - 0.5) * (SIZE - 40);
      const n = this.nearest(x, z, 1); if (n && n.dist < ROAD_HALF + 5) continue;
      if (Math.hypot(x - vc.x, z - vc.z) < 230 && rnd() < 0.85) continue; // keep the village open
      const y = this.groundHeight(x, z);
      // clusters: denser where a slow noise is high
      const dens = 0.5 + 0.5 * Math.sin(x * 0.012 + 1) * Math.sin(z * 0.01 - 2);
      if (rnd() > dens) continue;
      const s = 0.7 + rnd() * 0.8;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
      m4.compose(p.set(x, y - 0.1, z), q, sc.set(s, s * (0.85 + rnd() * 0.4), s));
      trunks.setMatrixAt(count, m4); crowns.setMatrixAt(count, m4);
      crowns.setColorAt(count, c.setHSL(0.27 + rnd() * 0.07, 0.35 + rnd() * 0.2, 0.25 + rnd() * 0.1));
      this.addCollider(x, z, 0.45 * s);
      count++;
    }
    trunks.count = crowns.count = count;
    scene.add(trunks, crowns);
    // Signs that teach: before the climb, before the descent, at the gravel
    const climb = this.findGrade(0.06, 1), desc = this.findGrade(-0.06, 1, climb);
    this.signs = [];
    if (climb >= 0) this.sign((climb - 40 + N) % N, ['STEEP CLIMB', 'change down to 2nd']);
    if (desc >= 0) this.sign((desc - 40 + N) % N, ['STEEP DESCENT', 'use a low gear']);
    this.sign((this.cpIndex[4] - 25 + N) % N, ['GRAVEL ROAD', 'less grip · go gently']);
    this.sign(15, ['CLUTCH RUN', 'start · finish']);
  }

  findGrade(g, from = 0, after = 0) {
    for (let k = 0; k < this.N; k++) {
      const i = (after + k) % this.N;
      let sum = 0; for (let m = 0; m < 15; m++) sum += this.S[(i + m) % this.N].grade; sum /= 15;
      if ((g > 0 && sum > g) || (g < 0 && sum < g)) return i;
    }
    return -1;
  }

  sign(i, lines) {
    const s = this.S[i], off = ROAD_HALF + 2.2;
    const x = s.x + s.lx * off, z = s.z + s.lz * off, y = this.groundHeight(x, z);
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#f4f1e6'; g.fillRect(0, 0, 512, 256);
    g.strokeStyle = '#1b2128'; g.lineWidth = 16; g.strokeRect(8, 8, 496, 240);
    g.fillStyle = '#1b2128'; g.textAlign = 'center';
    g.font = 'bold 76px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText(lines[0], 256, 118);
    g.font = '46px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText(lines[1], 256, 190);
    const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, side: THREE.DoubleSide }));
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 6), new THREE.MeshStandardMaterial({ color: 0x777b80 }));
    const grp = new THREE.Group();
    post.position.y = 1.6; board.position.y = 2.8; board.position.z = 0.08;
    grp.add(post, board);
    // face oncoming drivers (who travel along +tangent)
    grp.position.set(x, y, z); grp.rotation.y = Math.atan2(-s.tx, -s.tz);
    this.scene.add(grp);
    this.addCollider(x, z, 0.3);
  }
}

function roadTexture(gravel) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 512;
  const g = cv.getContext('2d'), r = mulberry(gravel ? 3 : 5);
  g.fillStyle = gravel ? '#9b8566' : '#4b4e53'; g.fillRect(0, 0, 256, 512);
  for (let k = 0; k < 9000; k++) {
    const v = gravel ? 90 + r() * 110 : 55 + r() * 45;
    g.fillStyle = gravel ? `rgb(${v},${v * 0.86},${v * 0.66})` : `rgb(${v},${v},${v + 4})`;
    const s = gravel ? 1 + r() * 3 : 1 + r() * 1.5;
    g.fillRect(r() * 256, r() * 512, s, s);
  }
  if (gravel) {
    g.fillStyle = 'rgba(70,56,40,.35)';
    g.fillRect(48, 0, 30, 512); g.fillRect(178, 0, 30, 512);
  } else {
    g.fillStyle = '#e9e6dc';
    g.fillRect(8, 0, 6, 512); g.fillRect(242, 0, 6, 512);
    g.fillRect(125, 0, 6, 256);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function chequer() {
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 16;
  const g = cv.getContext('2d');
  for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#f2f2f2'; g.fillRect(i * 8, j * 8, 8, 8); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
  return t;
}
