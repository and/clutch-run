// All sound is synthesised with the Web Audio API: no audio files to load.
export class Sound {
  constructor() { this.ctx = null; this.muted = false; this.volume = 1; }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.7 * this.volume;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(ctx.destination);

    // white-noise buffer shared by everything
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.start(); return s; };

    // Engine: sawtooth stack at the firing frequency, through a lowpass and a little distortion
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.Q.value = 1.2;
    const shaper = ctx.createWaveShaper(); shaper.curve = distCurve(18); shaper.oversample = '2x';
    this.engFilter.connect(shaper); shaper.connect(this.engGain); this.engGain.connect(this.master);
    this.oscs = [['sawtooth', 1, 0.5], ['sawtooth', 2.005, 0.32], ['triangle', 3, 0.22], ['square', 0.5, 0.18]].map(([type, mul, g]) => {
      const o = ctx.createOscillator(); o.type = type; const gg = ctx.createGain(); gg.gain.value = g;
      o.connect(gg); gg.connect(this.engFilter); o.start(); return { o, mul };
    });
    // intake roar
    this.roarF = ctx.createBiquadFilter(); this.roarF.type = 'bandpass'; this.roarF.Q.value = 2;
    this.roarG = ctx.createGain(); this.roarG.gain.value = 0;
    noise().connect(this.roarF); this.roarF.connect(this.roarG); this.roarG.connect(this.engFilter);

    // road and wind
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 420;
    this.roadG = ctx.createGain(); this.roadG.gain.value = 0;
    noise().connect(rf); rf.connect(this.roadG); this.roadG.connect(this.master);
    // gravel crunch
    const gf = ctx.createBiquadFilter(); gf.type = 'bandpass'; gf.frequency.value = 1400; gf.Q.value = 0.8;
    this.gravelG = ctx.createGain(); this.gravelG.gain.value = 0;
    noise().connect(gf); gf.connect(this.gravelG); this.gravelG.connect(this.master);
    // tyre squeal
    const sf = ctx.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 2300; sf.Q.value = 9;
    this.squealG = ctx.createGain(); this.squealG.gain.value = 0;
    noise().connect(sf); sf.connect(this.squealG); this.squealG.connect(this.master);
    // horn
    this.hornG = ctx.createGain(); this.hornG.gain.value = 0;
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 2200;
    for (const f of [415, 520]) { const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f; o.connect(hf); o.start(); }
    hf.connect(this.hornG); this.hornG.connect(this.master);
  }

  setMuted(m) { this.muted = m; this.applyGain(); }
  // volume 0..1 scales everything; mute stays a separate switch so M brings back the chosen level
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); this.applyGain(); }
  applyGain() { if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7 * this.volume, this.ctx.currentTime, 0.05); }

  // s: {rpm, throttle, on, cranking, speed (m/s), surf, squeal 0..1, horn}
  update(s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.03;
    const rpm = Math.max(s.rpm, s.cranking ? 260 : 0);
    const f = Math.max(8, rpm / 60 * 2); // four-cylinder: two firings per revolution
    for (const { o, mul } of this.oscs) o.frequency.setTargetAtTime(f * mul, t, k);
    this.engFilter.frequency.setTargetAtTime(180 + rpm * 0.22 + s.throttle * 1600, t, k);
    let vol = 0;
    if (s.on) vol = 0.13 + 0.2 * s.throttle + Math.min(1, rpm / 7000) * 0.12;
    else if (s.cranking) vol = 0.12 * (0.5 + 0.5 * Math.sin(t * 60));
    this.engGain.gain.setTargetAtTime(vol, t, s.on || s.cranking ? 0.04 : 0.25);
    this.roarF.frequency.setTargetAtTime(f * 3, t, k);
    this.roarG.gain.setTargetAtTime(s.on ? s.throttle * 0.35 : 0, t, 0.05);
    const sp = Math.abs(s.speed);
    this.roadG.gain.setTargetAtTime(Math.min(0.28, sp / 40 * 0.28), t, 0.1);
    this.gravelG.gain.setTargetAtTime(s.surf === 'gravel' || s.surf === 'grass' ? Math.min(0.22, sp / 20 * 0.22) : 0, t, 0.1);
    this.squealG.gain.setTargetAtTime(s.squeal * 0.25, t, 0.05);
    this.hornG.gain.setTargetAtTime(s.horn ? 0.12 : 0, t, 0.01);
  }

  burst(dur, freq, type, gain, q = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + dur + 0.05);
  }
  tone(dur, f0, f1, type, gain) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  crash(strength = 1) {
    this.burst(0.8, 900, 'lowpass', 0.9 * strength);
    this.burst(0.35, 3200, 'bandpass', 0.35 * strength, 0.7);
    this.tone(0.45, 90, 35, 'sine', 0.8 * strength);
  }
  grind() {
    this.burst(0.4, 3400, 'bandpass', 0.5, 3);
    this.tone(0.4, 140, 90, 'sawtooth', 0.18);
  }
  clunk() { this.tone(0.18, 120, 50, 'sine', 0.5); this.burst(0.12, 600, 'lowpass', 0.3); }
  shift() { this.burst(0.08, 1200, 'bandpass', 0.12, 2); }
}

function distCurve(k) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = i * 2 / n - 1; c[i] = (1 + k) * x / (1 + k * Math.abs(x)); }
  return c;
}
