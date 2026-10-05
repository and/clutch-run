// Engine, clutch, gearbox and longitudinal car physics for a small petrol hatchback.
export const RPM = 60 / (2 * Math.PI); // rad/s -> rev/min

export const SPEC = {
  mass: 1050, wheelR: 0.30, fd: 4.07, eff: 0.9, g: 9.81,
  ratios: { [-1]: -3.3, 0: 0, 1: 3.55, 2: 1.95, 3: 1.28, 4: 0.97, 5: 0.78 },
  idle: 850, redline: 6300, limiter: 6800, stall: 420,
  Ie: 0.16, clutchMax: 240, wheelbase: 2.5,
};
export const TOP_GEAR = 5;
// Clutch pedal travel (0 = foot off, 1 = pressed to the floor). Between these two points it slips: the bite zone.
export const BITE_TOP = 0.88, BITE_BOTTOM = 0.38;

const engineDrag = w => 7 + 0.065 * w; // N m at w rad/s
const TQ = [[0, 50], [800, 72], [1500, 92], [2500, 106], [3500, 113], [4200, 115], [5000, 111], [6000, 101], [7000, 86], [8000, 60]];
export function torqueAt(rpm) {
  if (rpm <= 0) return TQ[0][1];
  for (let i = 1; i < TQ.length; i++) if (rpm <= TQ[i][0]) {
    const [a, ta] = TQ[i - 1], [b, tb] = TQ[i];
    return ta + (tb - ta) * (rpm - a) / (b - a);
  }
  return TQ[TQ.length - 1][1];
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class Drivetrain {
  constructor() { this.autoClutch = true; this.reset(); }

  reset() {
    this.omega = SPEC.idle / RPM; this.on = true; this.gear = 0; this.v = 0;
    this.pedal = 0; this.shiftT = 0; this.eng = 0; this.crankT = 0; this.events = [];
    this.accel = 0;
  }

  get rpm() { return this.omega * RPM; }
  G(g = this.gear) { return SPEC.ratios[g] * SPEC.fd; }
  // Engine speed the wheels would demand in gear g at the current road speed.
  wheelRpmFor(g) { return Math.abs(this.v / SPEC.wheelR * this.G(g)) * RPM; }

  setGear(g) { this.gear = g; if (this.autoClutch) this.shiftT = 0.3; }

  crank() { if (this.on || this.crankT > 0) return false; this.crankT = 0.8; return true; }

  // inp: {throttle, brake, handbrake 0..1}; env: {sinGrade, crr, grip (1 dry, less when wet)}
  step(dt, inp, env) {
    const n = 10, h = dt / n, m = SPEC.mass, g = SPEC.g;
    const v0 = this.v;
    for (let k = 0; k < n; k++) {
      if (this.crankT > 0) {
        this.crankT -= h;
        this.omega = Math.max(this.omega, 260 / RPM);
        if (this.crankT <= 0) { this.on = true; this.omega = 1150 / RPM; this.events.push('started'); }
      }
      const G = this.G(), rpm = this.omega * RPM;

      // How firmly the clutch is gripping, 0..1
      let eng;
      if (this.gear === 0) eng = 0;
      else if (this.autoClutch) {
        if (this.shiftT > 0) eng = 0;
        else {
          eng = clamp((rpm - 1000) / 900, 0, 1);
          if (this.wheelRpmFor(this.gear) > 1250 && rpm > 1150) eng = 1;
        }
      } else eng = clamp((BITE_TOP - this.pedal) / (BITE_TOP - BITE_BOTTOM), 0, 1);
      this.eng = eng;

      // Engine torque: throttle, an idle governor, and internal drag (friction and pumping against a
      // closed throttle: about 30 N m at 3500 r/min, which is what makes lifting off slow the car in gear)
      const drag = engineDrag(this.omega);
      let drive = 0;
      if (this.on) {
        const thr = rpm > SPEC.limiter ? 0 : inp.throttle;
        const idleW = SPEC.idle / RPM;
        const gov = clamp(engineDrag(idleW) + (idleW - this.omega) * 4, 0, 85);
        drive = Math.max(thr * torqueAt(rpm), gov);
      }
      const Te = drive - drag;

      // Clutch transmits torque up to its grip limit
      const ww = this.v / SPEC.wheelR * G;
      // grip builds slowly at first, then firmly: most of the torque comes in the lower half of the bite zone
      const cap = Math.pow(eng, 2.2) * SPEC.clutchMax;
      const Tc = cap > 0 ? clamp((this.omega - ww) * 40, -cap, cap) : 0;
      this.omega = Math.max(0, this.omega + (Te - Tc) / SPEC.Ie * h);

      // Car
      const Fd = Tc * G * SPEC.eff / SPEC.wheelR;
      const Fg = -m * g * env.sinGrade;
      const Fa = -0.42 * this.v * Math.abs(this.v);
      let v = this.v + (Fd + Fg + Fa) / m * h;
      const Fr = (inp.brake * 9500 + inp.handbrake * 5000) * (env.grip ?? 1) + env.crr * m * g; // can stop the car, never reverse it; less on a wet road
      const dv = Fr / m * h;
      v = Math.abs(v) <= dv ? 0 : v - Math.sign(v) * dv;
      this.v = v;

      if (this.shiftT > 0) this.shiftT -= h;
      if (this.on && this.crankT <= 0 && this.omega * RPM < SPEC.stall) { this.on = false; this.events.push('stall'); }
    }
    this.accel = (this.v - v0) / dt;
  }
}
