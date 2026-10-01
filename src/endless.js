// Endless road: generated ahead of the car and cleared away behind it, so the drive never ends.
// It offers the same interface as World (S, nearest, pointAt, surfaceAt, groundHeight, colliders),
// with one difference: S is a moving window, and distances along the road (d) only ever grow.
//
//  - The road is a chain of samples 2 m apart. Its bends come from a curvature that eases between
//    random targets (straights and bends of 60 to 280 m radius), and it keeps heading roughly one
//    way so it never loops back over itself.
//  - Its height follows the land, averaged over about 160 m so the slopes stay drivable.
//  - The land is built in square tiles around the car; a tile is rebuilt if the road later reaches it.
//  - Road meshes, villages and signs are built in chunks of 200 m of road.
import * as THREE from 'three';
import { mulberry, ROAD_HALF, roadTexture, makeSign } from './world.js';

const DS = 2;                         // metres between road samples
const AHEAD = 1600, BEHIND = 700;     // metres of road kept in front of and behind the car
const BLUR = 40;                      // road height: triangle-weighted average over +-BLUR samples
const TILE = 248, RES = 4, TN = TILE / RES + 1, TILE_R = 3; // land tiles, 7 x 7 of them around the car
const CHUNK = 100;                    // road samples per road mesh chunk

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lin = c => Math.pow(c, 2.2);

// Rolling country: broad hills with smaller ones on top. The same everywhere, so tiles always meet.
function ground(x, z) {
  return 22 * Math.sin(x * 0.0021 + 0.7) * Math.cos(z * 0.0017 - 1.1)
    + 14 * Math.sin(x * 0.0047 - z * 0.0039 + 2.1)
    + 6 * Math.sin(x * 0.011 + z * 0.009)
    + 1.5 * Math.sin(x * 0.023 - z * 0.019 + 2);
}

// shared by every tile and chunk, so removing one never disposes what another still uses
const MAT = {};
function mats() {
  if (MAT.land) return MAT;
  MAT.land = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  MAT.trunk = new THREE.MeshStandardMaterial({ color: 0x6b4a32, roughness: 1 });
  MAT.crown = new THREE.MeshStandardMaterial({ color: 0x3f6b3a, roughness: 1 });
  MAT.road = { asphalt: new THREE.MeshStandardMaterial({ map: roadTexture(false), roughness: 0.95, metalness: 0, side: THREE.DoubleSide }),
               gravel: new THREE.MeshStandardMaterial({ map: roadTexture(true), roughness: 0.95, metalness: 0, side: THREE.DoubleSide }) };
  MAT.walls = [0xe8d8b8, 0xd9c2a0, 0xc9d3d6, 0xe3c9b0, 0xf0e6d2, 0xbfae98].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 }));
  MAT.roofs = [0x8a3b2a, 0x6d4a3a, 0x4f5a64, 0x9a5130].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
  MAT.trunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 2.2, 6); MAT.trunkGeo.translate(0, 1.1, 0);
  MAT.crownGeo = new THREE.ConeGeometry(1.6, 4.6, 7); MAT.crownGeo.translate(0, 4.2, 0);
  MAT.box = new THREE.BoxGeometry(1, 1, 1);
  MAT.roof = new THREE.ConeGeometry(0.78, 2.4, 4);
  return MAT;
}

export class EndlessWorld {
  constructor(root) {
    this.scene = root; this.loop = false; this.length = Infinity; this.ds = DS;
    this.view = TILE * (TILE_R + 0.4); // fog closes in before the edge of the built land
    this.rnd = mulberry(20261001);
    this.S = []; this.base = 0; this.end = 0; // S[k] is sample number base + k; samples before end are finished
    this.hash = new Map(); this.cell = 25;
    this.gen = { x: 0, z: 0, head: 0, mean: 0, curv: 0, tgt: 0, left: 80, surf: 'asphalt', surfLeft: 500 };
    this.tiles = new Map(); this.chunks = new Map(); this.dirty = new Set();
    this.colliders = [];
    mats();
    this.update(0, 0, 0, true);
  }

  key(a, b) { return a * 100003 + b; }

  /* ---------- the road ---------- */
  grow() {
    const g = this.gen, r = this.rnd;
    if (--g.left <= 0) { // the next stretch: a straight, or a bend one way or the other
      g.tgt = r() < 0.35 ? 0 : (r() < 0.5 ? -1 : 1) / (60 + r() * 220);
      g.left = 20 + Math.floor(r() * 90);
    }
    g.mean += (r() - 0.5) * 0.002; // the general direction drifts slowly
    let tgt = g.tgt; const dev = g.head - g.mean;
    if (dev > 0.9) tgt = Math.min(tgt, -1 / 150); else if (dev < -0.9) tgt = Math.max(tgt, 1 / 150);
    g.curv += (tgt - g.curv) * 0.05;
    g.head += g.curv * DS;
    g.x += Math.sin(g.head) * DS; g.z += Math.cos(g.head) * DS;
    if (--g.surfLeft <= 0) { // now and then a stretch of gravel
      g.surf = g.surf === 'asphalt' && r() < 0.35 ? 'gravel' : 'asphalt';
      g.surfLeft = g.surf === 'gravel' ? 120 + r() * 160 : 300 + r() * 700;
    }
    this.S.push({ x: g.x, z: g.z, h: ground(g.x, g.z), surf: g.surf });
  }

  at(gi) { return this.S[clamp(gi, this.base, this.base + this.S.length - 1) - this.base]; }

  heightAt(gi) { // the land under the road, averaged so the road climbs and falls smoothly
    let sum = 0, wsum = 0;
    for (let k = -BLUR; k <= BLUR; k++) { const w = BLUR + 1 - Math.abs(k); sum += w * this.at(gi + k).h; wsum += w; }
    return sum / wsum;
  }

  finish(gi) {
    const s = this.at(gi), a = this.at(gi - 1), b = this.at(gi + 1);
    let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    Object.assign(s, { tx, tz, lx: tz, lz: -tx, y: this.heightAt(gi) });
    s.grade = (this.heightAt(gi + 3) - this.heightAt(gi - 3)) / (6 * DS);
    const k = this.key(Math.floor(s.x / this.cell), Math.floor(s.z / this.cell));
    if (!this.hash.has(k)) this.hash.set(k, []);
    this.hash.get(k).push(gi);
    // land already built here was made without this stretch of road: rebuild it
    for (const dx of [-40, 0, 40]) for (const dz of [-40, 0, 40]) {
      const tk = this.key(Math.floor((s.x + dx) / TILE), Math.floor((s.z + dz) / TILE));
      if (this.tiles.has(tk)) this.dirty.add(tk);
      if (this.job && this.job.key === tk) this.job.stale = true; // being built from older road: build it again after
    }
  }

  // Nearest finished road sample, as World.nearest: lateral offset (+ = left), road height, distance d along the road
  nearest(x, z, r = 1) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    let best = -1, bd = Infinity;
    for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) {
      const arr = this.hash.get(this.key(cx + a, cz + b)); if (!arr) continue;
      for (const gi of arr) {
        if (gi < this.base || gi >= this.end) continue;
        const s = this.S[gi - this.base], d = (s.x - x) ** 2 + (s.z - z) ** 2;
        if (d < bd) { bd = d; best = gi; }
      }
    }
    return best < 0 ? null : this.result(best, bd, x, z);
  }

  // what nearest() reports, for the closest sample (global index best, squared distance bd)
  result(best, bd, x, z) {
    const s = this.S[best - this.base], dx = x - s.x, dz = z - s.z;
    const along = dx * s.tx + dz * s.tz, lat = dx * s.lx + dz * s.lz;
    const j = clamp(along >= 0 ? best + 1 : best - 1, this.base, this.end - 1);
    const f = Math.min(1, Math.abs(along) / DS);
    const y = s.y + (this.S[j - this.base].y - s.y) * f;
    const dist = Math.abs(along) <= DS ? Math.abs(lat) : Math.sqrt(bd);
    return { i: best - this.base, s, lat, along, y, dist, d: best * DS + along };
  }

  // Point on the road at distance d, offset sideways by lat
  pointAt(d, lat = 0) {
    const f = d / DS, gi = clamp(Math.floor(f), this.base, this.end - 2), t = clamp(f - gi, 0, 1);
    const a = this.S[gi - this.base], b = this.S[gi + 1 - this.base];
    const lx = lerp(a.lx, b.lx, t), lz = lerp(a.lz, b.lz, t);
    return { x: lerp(a.x, b.x, t) + lx * lat, z: lerp(a.z, b.z, t) + lz * lat, y: lerp(a.y, b.y, t), tx: lerp(a.tx, b.tx, t), tz: lerp(a.tz, b.tz, t), i: gi - this.base };
  }

  // The land's height as the tiles build it: the road's level next to the road, the hills further out
  terrainAt(x, z) { return this.terrainFrom(this.nearest(x, z, 2), x, z); }
  terrainFrom(n, x, z) {
    const b = ground(x, z);
    if (!n) return { h: b, d: Infinity };
    const hr = n.y - 0.05, d = n.dist;
    return { h: d < ROAD_HALF + 1.5 ? hr : lerp(hr, b, smooth(ROAD_HALF + 1.5, 32, d)), d };
  }

  groundHeight(x, z) {
    const t = this.tiles.get(this.key(Math.floor(x / TILE), Math.floor(z / TILE)));
    if (!t) return this.terrainAt(x, z).h;
    const fx = clamp((x - t.x0) / RES, 0, TN - 1.001), fz = clamp((z - t.z0) / RES, 0, TN - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, H = t.H;
    return lerp(lerp(H[j * TN + i], H[j * TN + i + 1], u), lerp(H[(j + 1) * TN + i], H[(j + 1) * TN + i + 1], u), v);
  }

  surfaceAt(x, z) {
    const n = this.nearest(x, z, 1);
    if (n && n.dist <= ROAD_HALF + 0.3) return { y: n.y + 0.03, surf: n.s.surf, road: n };
    return { y: this.groundHeight(x, z), surf: 'grass', road: n };
  }

  /* ---------- keeping the world built around the car ---------- */
  update(pd, px, pz, all = false) {
    const pi = Math.floor(pd / DS);
    let changed = false;
    while (this.base + this.S.length < pi + AHEAD / DS + BLUR + 8) this.grow();
    while (this.end < this.base + this.S.length - BLUR - 4) this.finish(this.end++);
    // forget the road far behind
    const keepFrom = pi - BEHIND / DS - CHUNK - BLUR; // chunks still standing behind the car keep their samples
    if (keepFrom - this.base > 300) {
      const drop = keepFrom - this.base;
      for (let k = 0; k < drop; k++) {
        const s = this.S[k], key = this.key(Math.floor(s.x / this.cell), Math.floor(s.z / this.cell)), arr = this.hash.get(key);
        if (arr) { const left = arr.filter(gi => gi >= keepFrom); if (left.length) this.hash.set(key, left); else this.hash.delete(key); }
      }
      this.S.splice(0, drop); this.base = keepFrom;
    }
    // road chunks from a little behind the car to the end of the finished road
    const c0 = Math.max(0, Math.floor((pi - BEHIND / DS) / CHUNK)), c1 = Math.floor((this.end - 20) / CHUNK) - 1;
    for (const [c, ch] of this.chunks) if (c < c0) { this.drop(ch); this.chunks.delete(c); changed = true; }
    for (let c = c0; c <= c1; c++) if (!this.chunks.has(c)) { this.chunks.set(c, this.buildChunk(c)); changed = true; if (!all) break; }
    // land tiles around the car, nearest first
    const tx = Math.floor(px / TILE), tz = Math.floor(pz / TILE);
    for (const [k, t] of this.tiles) if (Math.abs(t.tx - tx) > TILE_R + 1 || Math.abs(t.tz - tz) > TILE_R + 1) { this.drop(t); this.tiles.delete(k); this.dirty.delete(k); changed = true; }
    if (this.job && (Math.abs(this.job.tx - tx) > TILE_R + 1 || Math.abs(this.job.tz - tz) > TILE_R + 1)) this.job = null;
    const want = [];
    for (let a = -TILE_R; a <= TILE_R; a++) for (let b = -TILE_R; b <= TILE_R; b++) {
      const k = this.key(tx + a, tz + b);
      if (!this.tiles.has(k) && !(this.job && this.job.key === k)) want.push([a * a + b * b, tx + a, tz + b]);
    }
    want.sort((p, q) => p[0] - q[0]);
    if (all) { // the first build: everything at once
      for (const [, a, b] of want) this.tiles.set(this.key(a, b), this.buildTile(a, b));
      this.dirty.clear(); changed = true;
    } else {
      // one tile at a time, missing land first, then land the road has since reached; about 4 ms a frame
      if (!this.job) {
        let next = want.length ? { tx: want[0][1], tz: want[0][2] } : null;
        if (!next) for (const k of this.dirty) { this.dirty.delete(k); const t = this.tiles.get(k); if (t) { next = { tx: t.tx, tz: t.tz }; break; } }
        if (next) this.job = { ...next, key: this.key(next.tx, next.tz), gen: this.tileJob(next.tx, next.tz) };
      }
      if (this.job) {
        const t0 = performance.now(); let r;
        do r = this.job.gen.next(); while (!r.done && performance.now() - t0 < 4);
        if (r.done) {
          const old = this.tiles.get(this.job.key); if (old) this.drop(old);
          this.tiles.set(this.job.key, r.value); if (this.job.stale) this.dirty.add(this.job.key);
          this.job = null; changed = true;
        }
      }
    }
    if (changed) { this.colliders = []; for (const m of [this.tiles, this.chunks]) for (const t of m.values()) this.colliders.push(...t.colliders); }
  }

  drop(part) { for (const o of part.objects) { this.scene.remove(o); if (o.userData.own) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); } }

  buildTile(tx, tz) { const job = this.tileJob(tx, tz); let r; do r = job.next(); while (!r.done); return r.value; }

  // Builds one tile, pausing (yield) every few rows, so the work can be spread over several frames.
  *tileJob(tx, tz) {
    const x0 = tx * TILE, z0 = tz * TILE, H = new Float32Array(TN * TN);
    const pos = new Float32Array(TN * TN * 3), col = new Float32Array(TN * TN * 3);
    // The road samples terrainAt() would look at, gathered once per 25 m cell of this tile. Far from
    // the road a cell has none, and its land needs no search at all. Same answers, many times faster.
    const cell = this.cell, ci0 = Math.floor(x0 / cell), cj0 = Math.floor(z0 / cell), CW = Math.ceil(TILE / cell) + 1;
    const near = new Array(CW * CW).fill(null);
    for (let b = 0; b < CW; b++) for (let a = 0; a < CW; a++) {
      let list = null;
      for (let da = -2; da <= 2; da++) for (let db = -2; db <= 2; db++) {
        const arr = this.hash.get(this.key(ci0 + a + da, cj0 + b + db));
        if (arr) for (const gi of arr) if (gi >= this.base && gi < this.end) (list || (list = [])).push(gi);
      }
      near[b * CW + a] = list;
    }
    const landAt = (x, z) => {
      const a = Math.floor(x / cell) - ci0, b = Math.floor(z / cell) - cj0;
      if (a < 0 || b < 0 || a >= CW || b >= CW) return this.terrainAt(x, z); // the border row, just outside the tile
      const list = near[b * CW + a];
      if (!list) return this.terrainFrom(null, x, z);
      let best = -1, bd = Infinity;
      for (const gi of list) { const s = this.S[gi - this.base], d = (s.x - x) ** 2 + (s.z - z) ** 2; if (d < bd) { bd = d; best = gi; } }
      return this.terrainFrom(this.result(best, bd, x, z), x, z);
    };
    yield;
    // Heights with a one-vertex border, so each normal comes straight from its neighbours' heights,
    // matching the next tile's exactly (no seams in the shading, and much cheaper than computeVertexNormals)
    const NB = TN + 2, HB = new Float32Array(NB * NB), DB = new Float32Array(NB * NB);
    for (let j = 0; j < NB; j++) {
      for (let i = 0; i < NB; i++) { const { h, d } = landAt(x0 + (i - 1) * RES, z0 + (j - 1) * RES); HB[j * NB + i] = h; DB[j * NB + i] = d; }
      if (j % 10 === 9) yield;
    }
    const nrm = new Float32Array(TN * TN * 3);
    for (let j = 0; j < TN; j++) for (let i = 0; i < TN; i++) {
      const x = x0 + i * RES, z = z0 + j * RES, k = j * TN + i, b = (j + 1) * NB + i + 1, h = HB[b], d = DB[b];
      const nx = HB[b - 1] - HB[b + 1], ny = 2 * RES, nz = HB[b - NB] - HB[b + NB], nl = Math.hypot(nx, ny, nz);
      nrm[k * 3] = nx / nl; nrm[k * 3 + 1] = ny / nl; nrm[k * 3 + 2] = nz / nl;
      H[k] = h; pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      const v = (Math.sin(x * 0.05) * Math.sin(z * 0.043) + Math.sin(x * 0.13 + z * 0.11)) * 0.035;
      let r = 0.36 + v, g = 0.52 + v * 1.2, bl = 0.25 + v * 0.5;
      const hi = smooth(30, 55, h); r = lerp(r, 0.6, hi); g = lerp(g, 0.56, hi); bl = lerp(bl, 0.38, hi);
      if (d < ROAD_HALF + 3) { r = 0.5; g = 0.43; bl = 0.32; }
      col[k * 3] = lin(r); col[k * 3 + 1] = lin(g); col[k * 3 + 2] = lin(bl);
    }
    const idx = new Uint32Array((TN - 1) * (TN - 1) * 6); let p = 0;
    for (let j = 0; j < TN - 1; j++) for (let i = 0; i < TN - 1; i++) {
      const a = j * TN + i, b = a + 1, c = a + TN, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    yield;
    const land = new THREE.Mesh(geo, MAT.land); land.userData.own = true;
    // trees, clustered, kept off the road; the same trees each time this tile is built
    const rnd = mulberry((tx * 73856093) ^ (tz * 19349663)), colliders = [];
    const MAX = 70, trunks = new THREE.InstancedMesh(MAT.trunkGeo, MAT.trunk, MAX), crowns = new THREE.InstancedMesh(MAT.crownGeo, MAT.crown, MAX);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v3 = new THREE.Vector3(), c = new THREE.Color(), Y = new THREE.Vector3(0, 1, 0);
    let count = 0;
    for (let t = 0; t < 220 && count < MAX; t++) {
      const x = x0 + rnd() * TILE, z = z0 + rnd() * TILE, dens = 0.5 + 0.5 * Math.sin(x * 0.012 + 1) * Math.sin(z * 0.01 - 2);
      if (rnd() > dens) continue;
      const n = this.nearest(x, z, 1); if (n && n.dist < ROAD_HALF + 5) continue;
      const s = 0.7 + rnd() * 0.8;
      q.setFromAxisAngle(Y, rnd() * 6.28);
      m4.compose(v3.set(x, this.groundAtTile(H, x0, z0, x, z) - 0.1, z), q, sc.set(s, s * (0.85 + rnd() * 0.4), s));
      trunks.setMatrixAt(count, m4); crowns.setMatrixAt(count, m4);
      crowns.setColorAt(count, c.setHSL(0.27 + rnd() * 0.07, 0.35 + rnd() * 0.2, 0.25 + rnd() * 0.1));
      colliders.push({ x, z, r: 0.45 * s }); count++;
    }
    trunks.count = crowns.count = count;
    trunks.userData.own = crowns.userData.own = false;
    this.scene.add(land, trunks, crowns);
    return { tx, tz, x0, z0, H, colliders, objects: [land, trunks, crowns] };
  }

  groundAtTile(H, x0, z0, x, z) {
    const fx = clamp((x - x0) / RES, 0, TN - 1.001), fz = clamp((z - z0) / RES, 0, TN - 1.001);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    return lerp(lerp(H[j * TN + i], H[j * TN + i + 1], u), lerp(H[(j + 1) * TN + i], H[(j + 1) * TN + i + 1], u), v);
  }

  buildChunk(c) {
    const g0 = c * CHUNK, g1 = g0 + CHUNK, objects = [], colliders = [];
    // road surface, one mesh per run of the same surface
    let run = [];
    const flush = () => {
      if (run.length < 2) return;
      const surf = this.at(run[0]).surf, pos = [], uv = [], idx = [];
      run.forEach((gi, k) => {
        const s = this.at(gi);
        pos.push(s.x + s.lx * ROAD_HALF, s.y + 0.03, s.z + s.lz * ROAD_HALF, s.x - s.lx * ROAD_HALF, s.y + 0.03, s.z - s.lz * ROAD_HALF);
        uv.push(0, gi * DS / 10, 1, gi * DS / 10);
        if (k > 0) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setIndex(idx); geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, MAT.road[surf]); m.userData.own = true; objects.push(m);
    };
    for (let gi = g0; gi <= g1; gi++) {
      if (run.length && this.at(gi).surf !== this.at(run[0]).surf) { run.push(gi); flush(); run = [gi]; } else run.push(gi);
    }
    flush();
    const rnd = mulberry(c * 2654435761 + 7);
    // a village every so often: houses along both sides
    if (c > 1 && rnd() < 0.16) {
      for (let gi = g0; gi < g1; gi += 9) for (const side of [1, -1]) {
        if (rnd() < 0.35) continue;
        const s = this.at(gi), w = 6 + rnd() * 4, d = 6 + rnd() * 4, hgt = 3.5 + rnd() * 3.5;
        const off = side * (ROAD_HALF + 6 + d / 2 + rnd() * 3), x = s.x + s.lx * off, z = s.z + s.lz * off;
        const n = this.nearest(x, z, 1); if (n && n.dist < ROAD_HALF + 4 + d / 2) continue;
        const house = new THREE.Group();
        const body = new THREE.Mesh(MAT.box, MAT.walls[Math.floor(rnd() * MAT.walls.length)]); body.scale.set(w, hgt, d); body.position.y = hgt / 2 - 0.5;
        const roof = new THREE.Mesh(MAT.roof, MAT.roofs[Math.floor(rnd() * MAT.roofs.length)]);
        roof.position.y = hgt - 0.5 + 1.2; roof.rotation.y = Math.PI / 4; roof.scale.set(w, 1, d);
        house.add(body, roof); house.position.set(x, this.terrainAt(x, z).h, z); house.rotation.y = Math.atan2(s.tx, s.tz);
        objects.push(house); colliders.push({ x, z, r: Math.min(w, d) / 2 + 0.4 });
      }
    }
    // signs that teach, 80 m before steep climbs, steep descents and gravel
    const avg = gi => { let sum = 0; for (let m = 0; m < 15; m++) sum += this.at(gi + m).grade; return sum / 15; };
    const sign = (gi, lines) => {
      const s = this.at(gi), off = ROAD_HALF + 2.2, x = s.x + s.lx * off, z = s.z + s.lz * off, grp = makeSign(lines);
      grp.position.set(x, this.terrainAt(x, z).h, z); grp.rotation.y = Math.atan2(-s.tx, -s.tz);
      objects.push(grp); colliders.push({ x, z, r: 0.3 });
    };
    if (c === 0) sign(12, ['CLUTCH RUN', 'endless road']);
    for (let gi = Math.max(g0, 45); gi < g1; gi++) {
      if (avg(gi) > 0.07 && avg(gi - 1) <= 0.07) sign(gi - 40, ['STEEP CLIMB', 'change down to 2nd']);
      if (avg(gi) < -0.07 && avg(gi - 1) >= -0.07) sign(gi - 40, ['STEEP DESCENT', 'use a low gear']);
      if (this.at(gi).surf === 'gravel' && this.at(gi - 1).surf !== 'gravel') sign(gi - 25, ['GRAVEL ROAD', 'less grip · go gently']);
    }
    for (const o of objects) this.scene.add(o);
    return { objects, colliders };
  }
}
