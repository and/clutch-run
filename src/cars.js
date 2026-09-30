// Low-poly hatchback built from boxes and cylinders. Forward is +z.
import * as THREE from 'three';

let shadowTex = null;
function blobShadow() {
  if (shadowTex) return shadowTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  shadowTex = new THREE.CanvasTexture(cv);
  return shadowTex;
}

const tyreGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.22, 14); tyreGeo.rotateZ(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.24, 8); hubGeo.rotateZ(Math.PI / 2);

export function makeCar(color) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.25 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1c252d, roughness: 0.2, metalness: 0.3 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x23272b, roughness: 0.8 });
  const tyre = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 });
  const hub = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.4, metalness: 0.6 });
  const box = (w, h, d, m, x, y, z) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };

  box(1.74, 0.6, 3.86, paint, 0, 0.62, 0);           // body
  box(1.56, 0.52, 1.95, glass, 0, 1.17, -0.3);        // glasshouse
  box(1.5, 0.07, 1.75, paint, 0, 1.46, -0.35);        // roof
  box(1.78, 0.22, 0.2, trim, 0, 0.42, 1.95);          // front bumper
  box(1.78, 0.22, 0.2, trim, 0, 0.42, -1.95);         // rear bumper
  const headMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0c0, emissiveIntensity: 0.4 });
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x8a1410, emissive: 0xff2010, emissiveIntensity: 0.15 });
  for (const s of [-1, 1]) {
    box(0.36, 0.14, 0.05, headMat, s * 0.6, 0.72, 1.94);
    box(0.34, 0.14, 0.05, brakeMat, s * 0.62, 0.74, -1.94);
  }
  const wheels = [], steer = [];
  for (const [x, z] of [[0.8, 1.28], [-0.8, 1.28], [0.8, -1.28], [-0.8, -1.28]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.3, z);
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(tyreGeo, tyre), new THREE.Mesh(hubGeo, hub));
    pivot.add(spin); g.add(pivot);
    wheels.push(spin); if (z > 0) steer.push(pivot);
  }
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.7), new THREE.MeshBasicMaterial({ map: blobShadow(), transparent: true, depthWrite: false }));
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.04; g.add(sh);
  return { group: g, wheels, steer, brakeMat };
}

// Driver's-seat interior, right-hand drive as in India. Only shown in the inside view.
export const DRIVER = { x: -0.38, y: 1.23, z: -0.2 };
export function addInterior(c) {
  const g = new THREE.Group();
  const dash = new THREE.MeshStandardMaterial({ color: 0x2a2f35, roughness: 0.85 });
  const soft = new THREE.MeshStandardMaterial({ color: 0x1b1f23, roughness: 0.95 });
  const pillar = new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.9 });
  const add = (geo, m, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); g.add(o); return o; };
  add(new THREE.BoxGeometry(1.56, 0.24, 0.55), dash, 0, 0.87, 0.66);                 // dashboard
  add(new THREE.BoxGeometry(1.56, 0.05, 0.34), soft, 0, 1.0, 0.8, -0.2);            // dash top, sloping to the screen
  add(new THREE.BoxGeometry(0.34, 0.06, 0.14), soft, DRIVER.x, 1.02, 0.56);             // instrument hood
  add(new THREE.BoxGeometry(0.22, 0.3, 0.5), dash, 0.02, 0.72, 0.2);                  // centre console
  for (const s of [1, -1]) add(new THREE.BoxGeometry(0.07, 0.62, 0.07), pillar, s * 0.74, 1.2, 0.5, -0.62, 0, 0); // A-pillars
  add(new THREE.BoxGeometry(1.5, 0.08, 0.14), pillar, 0, 1.45, 0.22);                  // top of the windscreen
  add(new THREE.BoxGeometry(0.2, 0.055, 0.02), new THREE.MeshStandardMaterial({ color: 0x9fb4c4, roughness: 0.1, metalness: 0.8 }), 0, 1.38, 0.46);
  add(new THREE.BoxGeometry(1.52, 0.02, 1.8), new THREE.MeshStandardMaterial({ color: 0x8d9296, roughness: 1, emissive: 0x3a3d40 }), 0, 1.43, -0.35); // headliner
  add(new THREE.BoxGeometry(1.56, 0.02, 1.9), soft, 0, 0.935, -0.35); // floor and seats area, hides the body top // rear-view mirror
  for (const s of [1, -1]) add(new THREE.BoxGeometry(0.05, 0.22, 1.5), soft, s * 0.8, 0.94, -0.3); // door tops
  // steering wheel: tilt group, then a spin group that turns with the steering
  const tilt = new THREE.Group(); tilt.position.set(DRIVER.x, 0.95, 0.3); tilt.rotation.x = 0.38;
  const spin = new THREE.Group();
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x141619, roughness: 0.7 });
  spin.add(new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.022, 8, 28), wheelMat));
  for (const a of [0, 2.2, -2.2]) { const sp = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.17, 0.02), wheelMat); sp.position.set(Math.sin(a) * 0.09, -Math.cos(a) * 0.09, 0); sp.rotation.z = a; spin.add(sp); }
  spin.add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12).rotateX(Math.PI / 2), wheelMat));
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), new THREE.MeshStandardMaterial({ color: 0xf28c2b }));
  mark.position.set(0, 0.19, 0); spin.add(mark);                                         // top-centre marker, so you can see how far it's turned
  tilt.add(spin); g.add(tilt);
  // gear lever
  add(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 6), soft, 0.02, 0.9, 0.18);
  add(new THREE.SphereGeometry(0.035, 10, 8), soft, 0.02, 1.0, 0.18);
  g.visible = false;
  c.group.add(g);
  c.interior = g; c.wheelSpin = spin;
  return c;
}

// Place a car on the ground: yaw, then pitch and roll from the surface.
export function poseCar(c, x, y, z, yaw, pitch, roll, v, steerAngle, dt, braking) {
  const g = c.group;
  g.position.set(x, y, z);
  g.rotation.set(pitch, yaw, roll, 'YXZ');
  for (const w of c.wheels) w.rotation.x += v * dt / 0.3;
  for (const p of c.steer) p.rotation.y = steerAngle;
  if (c.wheelSpin) c.wheelSpin.rotation.z = -steerAngle * 6;
  c.brakeMat.emissiveIntensity = braking ? 1.6 : 0.15;
}
