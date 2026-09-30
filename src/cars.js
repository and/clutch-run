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

// Place a car on the ground: yaw, then pitch and roll from the surface.
export function poseCar(c, x, y, z, yaw, pitch, roll, v, steerAngle, dt, braking) {
  const g = c.group;
  g.position.set(x, y, z);
  g.rotation.set(pitch, yaw, roll, 'YXZ');
  for (const w of c.wheels) w.rotation.x += v * dt / 0.3;
  for (const p of c.steer) p.rotation.y = steerAngle;
  c.brakeMat.emissiveIntensity = braking ? 1.6 : 0.15;
}
