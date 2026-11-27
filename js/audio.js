// All sound is synthesised with the Web Audio API: engine, tyres, sirens, crashes, and three
// radio stations that compose their own music as you drive.
import { clamp, mulberry32 } from './util.js';

const STATIONS = [
  { name: 'Calloway FM 97.2', style: 'pop', bpm: [104, 118] },
  { name: 'Low Tide 88.4', style: 'lofi', bpm: [78, 88] },
  { name: 'Pulse 101', style: 'house', bpm: [120, 126] },
  { name: 'Radio off', style: 'off' },
];
const PROGRESSIONS = [[0, 5, 3, 4], [0, 3, 4, 4], [5, 3, 0, 4], [0, 4, 5, 3], [0, 5, 1, 4], [3, 4, 0, 0]];
const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10];
const GEARS = [0, 11, 20, 30, 42, 56, 80, 96];
const ENGINE_NOTE = { van: 34, armored: 34, sports: 58, gt: 54, super: 64, hyper: 70 }; // base pitch, Hz
// gunshots: [noise length s, loudness, filter, cutoff Hz, thump from Hz, thump length s]
const GUNS = {
  pistol: [0.14, 0.55, 'bandpass', 1700, 190, 0.1],
  smg: [0.09, 0.4, 'bandpass', 2300, 220, 0.06],
  shotgun: [0.42, 0.85, 'lowpass', 1500, 140, 0.3],
  rifle: [0.18, 0.62, 'highpass', 900, 170, 0.14],
  sniper: [0.45, 0.95, 'highpass', 650, 130, 0.35],
  launcher: [0.7, 0.55, 'lowpass', 700, 90, 0.45],
};

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.vol = { music: 0.6, sfx: 0.8 };
    this.station = 0;
    this.showName = 0;
    this.r = mulberry32(Date.now() % 100000);
  }

  resume() {
    try {
      if (!this.ctx) this.init();
      this.ctx.resume();
    } catch { this.ctx = null; }
  }

  init() {
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    const comp = ctx.createDynamicsCompressor();
    comp.connect(ctx.destination);
    this.sfx = ctx.createGain(); this.sfx.gain.value = this.vol.sfx; this.sfx.connect(comp);
    this.music = ctx.createGain(); this.music.gain.value = 0; this.music.connect(comp);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // engine: two oscillators through a low-pass filter
    this.eng = { a: ctx.createOscillator(), b: ctx.createOscillator(), f: ctx.createBiquadFilter(), g: ctx.createGain() };
    this.eng.a.type = 'sawtooth'; this.eng.b.type = 'square';
    this.eng.f.type = 'lowpass'; this.eng.f.Q.value = 2;
    this.eng.g.gain.value = 0;
    this.eng.a.connect(this.eng.f); this.eng.b.connect(this.eng.f); this.eng.f.connect(this.eng.g); this.eng.g.connect(this.sfx);
    this.eng.a.start(); this.eng.b.start();
    this.screech = this.loopNoise('bandpass', 1900, 6);
    // helicopter: low noise pulsed at the blade-pass rate, and a turbine whine
    this.chop = this.loopNoise('lowpass', 380, 0.8);
    this.chopLfo = ctx.createOscillator(); this.chopLfo.type = 'square'; this.chopLfo.frequency.value = 16;
    this.chopDepth = ctx.createGain(); this.chopDepth.gain.value = 0;
    this.chopLfo.connect(this.chopDepth); this.chopDepth.connect(this.chop.g.gain);
    this.chopLfo.start();
    this.whine = { o: ctx.createOscillator(), g: ctx.createGain() };
    this.whine.o.type = 'sine'; this.whine.o.frequency.value = 900; this.whine.g.gain.value = 0;
    this.whine.o.connect(this.whine.g); this.whine.g.connect(this.sfx); this.whine.o.start();
    this.wind = this.loopNoise('lowpass', 500, 0.7);
    this.horn = { a: ctx.createOscillator(), b: ctx.createOscillator(), g: ctx.createGain(), f: ctx.createBiquadFilter() };
    this.horn.a.type = this.horn.b.type = 'square';
    this.horn.a.frequency.value = 392; this.horn.b.frequency.value = 494;
    this.horn.f.type = 'lowpass'; this.horn.f.frequency.value = 1600;
    this.horn.a.connect(this.horn.f); this.horn.b.connect(this.horn.f); this.horn.f.connect(this.horn.g); this.horn.g.connect(this.sfx);
    this.horn.g.gain.value = 0;
    this.horn.a.start(); this.horn.b.start();
    this.sir = { o: ctx.createOscillator(), lfo: ctx.createOscillator(), depth: ctx.createGain(), g: ctx.createGain(), f: ctx.createBiquadFilter() };
    this.sir.o.type = 'square'; this.sir.o.frequency.value = 950;
    this.sir.lfo.frequency.value = 0.7; this.sir.depth.gain.value = 320;
    this.sir.lfo.connect(this.sir.depth); this.sir.depth.connect(this.sir.o.frequency);
    this.sir.f.type = 'lowpass'; this.sir.f.frequency.value = 2200;
    this.sir.o.connect(this.sir.f); this.sir.f.connect(this.sir.g); this.sir.g.connect(this.sfx);
    this.sir.g.gain.value = 0;
    this.sir.o.start(); this.sir.lfo.start();
    this.nextNote = 0;
    this.song = null;
  }

  loopNoise(type, freq, q) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.sfx);
    src.start();
    return { src, f, g };
  }

  setPaused(on) { if (!this.ctx) return; if (on) this.ctx.suspend(); else this.ctx.resume(); }
  setVolume(kind, v) { this.vol[kind] = v; if (this.ctx && kind === 'sfx') this.sfx.gain.value = v; }
  nextStation() { this.station = (this.station + 1) % STATIONS.length; this.showName = 3; this.song = null; this.blip(0.4); }
  stationName() { return STATIONS[this.station].name; }

  set(param, value, t = 0.05) { param.setTargetAtTime(value, this.ctx.currentTime, t); }

  update(dt, world, police, env) {
    if (this.showName > 0) this.showName -= dt;
    if (!this.ctx || this.ctx.state !== 'running') return;
    const p = world.player, v = p.vehicle;
    if (v && !v.wrecked && v.m.air === 'plane') {
      // a propeller drone that rises with the throttle
      const r = v.rotor, f = 30 + r * 72;
      this.set(this.eng.a.frequency, f);
      this.set(this.eng.b.frequency, f * 0.5);
      this.set(this.eng.f.frequency, 300 + r * 1100);
      this.set(this.eng.g.gain, (0.04 + r * 0.1) * (v.health > 0 ? 1 : 0.3));
      this.set(this.screech.g.gain, 0);
      this.set(this.wind.g.gain, clamp(v.speed / 70, 0, 0.3));
      this.set(this.horn.g.gain, 0, 0.01);
    } else if (v && !v.wrecked && v.m.air) {
      this.set(this.eng.g.gain, 0, 0.1);
      this.set(this.screech.g.gain, 0);
      this.set(this.wind.g.gain, clamp(v.speed / 60, 0, 0.25));
      this.set(this.horn.g.gain, 0, 0.01);
    } else if (v && !v.wrecked) {
      const vl = Math.abs(v.vx * Math.sin(v.h) + v.vz * Math.cos(v.h));
      let g = 1;
      while (g < GEARS.length - 1 && vl > GEARS[g]) g++;
      const frac = clamp((vl - GEARS[g - 1]) / (GEARS[g] - GEARS[g - 1]), 0, 1);
      const rpm = 0.2 + frac * 0.8 + (v.airborne ? 0.3 : 0);
      const thr = v.input.throttle;
      const base = ENGINE_NOTE[v.m.kind] ?? 46;
      this.set(this.eng.a.frequency, base + rpm * base * 1.6);
      this.set(this.eng.b.frequency, (base + rpm * base * 1.6) * 0.5);
      this.set(this.eng.f.frequency, 250 + rpm * 900 + thr * 700);
      this.set(this.eng.g.gain, (0.05 + thr * 0.09 + rpm * 0.03) * (v.health > 0 ? 1 : 0.3));
      this.set(this.screech.g.gain, v.airborne ? 0 : clamp((v.slip - 3) / 7, 0, 0.22));
      this.set(this.wind.g.gain, clamp(v.speed / 60, 0, 0.25));
      this.set(this.horn.g.gain, v.horn ? 0.08 : 0, 0.01);
    } else {
      this.set(this.eng.g.gain, 0, 0.1);
      this.set(this.screech.g.gain, 0);
      this.set(this.wind.g.gain, 0);
      this.set(this.horn.g.gain, 0, 0.01);
    }
    // rotor chop: your own helicopter, or the nearest one with its rotor turning
    let heli = null, hk = 0;
    if (v?.m.air === 'heli' && !v.wrecked) { heli = v; hk = 1; }
    else for (const o of world.vehicles) {
      if (o.m.air !== 'heli' || !(o.rotor > 0.05)) continue;
      const k = 1 - Math.hypot(o.x - p.x, o.z - p.z) / 150;
      if (k > hk) { hk = k; heli = o; }
    }
    const r = heli ? heli.rotor * hk : 0;
    this.set(this.chop.g.gain, r * 0.15);
    this.set(this.chopDepth.gain, r * 0.14);
    this.set(this.whine.g.gain, r * 0.012);
    if (heli) { this.set(this.chopLfo.frequency, 4 + heli.rotor * 14); this.set(this.whine.o.frequency, 300 + heli.rotor * 700); }
    // the nearest police siren
    let near = 0;
    if (police.level > 0) for (const u of police.units()) if (u.siren) near = Math.max(near, 1 - Math.hypot(u.x - p.x, u.z - p.z) / 160);
    this.set(this.sir.g.gain, clamp(near, 0, 1) * 0.05, 0.2);
    // NPC horns and car alarms nearby
    for (const o of world.vehicles) {
      if (o === v) continue;
      if ((o.horn > 0 || o.alarm > 0) && !o.honking) {
        o.honking = true;
        const d = Math.hypot(o.x - p.x, o.z - p.z);
        if (d < 80) this.beep(o.alarm > 0 ? 880 : 330, o.alarm > 0 ? 0.25 : 0.5, 0.06 * (1 - d / 80));
        setTimeout(() => { o.honking = false; }, o.alarm > 0 ? 400 : 1500);
      }
      if (o.horn > 0) o.horn -= dt;
    }
    // radio: only in a vehicle
    const on = v && STATIONS[this.station].style !== 'off';
    this.set(this.music.gain, on ? this.vol.music * 0.5 : 0, 0.4);
    if (on) this.schedule();
  }

  // ---- music ----
  newSong() {
    const st = STATIONS[this.station], r = this.r;
    const minor = st.style !== 'pop' ? r() < 0.7 : r() < 0.35;
    this.song = {
      st, bpm: st.bpm[0] + r() * (st.bpm[1] - st.bpm[0]), root: 45 + Math.floor(r() * 7), scale: minor ? MINOR : MAJOR,
      prog: PROGRESSIONS[Math.floor(r() * PROGRESSIONS.length)], step: 0, bars: 24 + Math.floor(r() * 3) * 8,
      arp: [0, 2, 4, 2, 4, 7, 4, 2].map((x) => (r() < 0.2 ? x + 1 : x)), seed: r(),
    };
    this.nextNote = Math.max(this.nextNote, this.ctx.currentTime + 0.1);
  }

  schedule() {
    if (!this.song || this.song.st !== STATIONS[this.station]) this.newSong();
    const s = this.song, ctx = this.ctx;
    const sixteenth = 60 / s.bpm / 4;
    while (this.nextNote < ctx.currentTime + 0.25) {
      const step = s.step % 16, bar = Math.floor(s.step / 16);
      let t = this.nextNote;
      if (s.st.style === 'lofi' && step % 2 === 1) t += sixteenth * 0.28; // swing
      this.playStep(s, step, bar, t, sixteenth);
      this.nextNote += sixteenth;
      s.step++;
      if (bar >= s.bars) { this.chime(this.nextNote); this.nextNote += 1.2; this.newSong(); return; }
    }
  }

  midi(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  degree(s, d, oct = 0) { const sc = s.scale; return s.root + 12 * (oct + Math.floor(d / 7)) + sc[((d % 7) + 7) % 7]; }

  playStep(s, step, bar, t, six) {
    const chord = s.prog[Math.floor(bar / 2) % 4];
    const style = s.st.style;
    const intro = bar < 2;
    if (style === 'pop') {
      if (step % 8 === 0) this.kick(t);
      if (step % 8 === 4 && !intro) this.snare(t, 0.5);
      if (step % 2 === 0) this.hat(t, 0.12);
      if (step % 2 === 0) this.tone(this.midi(this.degree(s, chord, -1)), t, six * 1.8, 'sawtooth', 0.11, 600);
      if (step === 0) for (const k of [0, 2, 4]) this.tone(this.midi(this.degree(s, chord + k, 1)), t, six * 15, 'sawtooth', 0.035, 1400, 0.3);
      if (!intro && bar % 4 >= 2) this.tone(this.midi(this.degree(s, chord + s.arp[step % 8], 2)), t, six * 0.9, 'triangle', 0.06, 3000);
    } else if (style === 'lofi') {
      if (step === 0 || step === 7 || step === 10) this.kick(t, 0.6);
      if (step === 4 || step === 12) this.snare(t, 0.25, true);
      if (step % 2 === 0) this.hat(t, 0.05);
      if (step === 0 || step === 8) for (const k of [0, 2, 4, 6]) this.tone(this.midi(this.degree(s, chord + k, 1)), t + k * 0.012, six * 7.5, 'sine', 0.05, 1800, 0.05);
      if (step === 0 || step === 6 || step === 10) this.tone(this.midi(this.degree(s, chord, -1)), t, six * 3, 'triangle', 0.13, 500);
      if (!intro && step % 4 === 2 && this.r() < 0.4) this.tone(this.midi(this.degree(s, chord + s.arp[(step + bar) % 8], 2)), t, six * 2, 'sine', 0.04, 2500);
      if (step % 4 === 0) this.crackle(t);
    } else if (style === 'house') {
      if (step % 4 === 0) this.kick(t, 1);
      if (step % 4 === 2) this.hat(t, 0.16, true);
      if (step % 8 === 4 && !intro) this.snare(t, 0.3);
      if (step % 4 === 2) this.tone(this.midi(this.degree(s, chord, -1)), t, six * 1.5, 'square', 0.07, 500);
      if (!intro && (step === 3 || step === 6 || step === 11)) for (const k of [0, 2, 4]) this.tone(this.midi(this.degree(s, chord + k, 1)), t, six * 1.2, 'sawtooth', 0.04, 2200);
      if (bar % 8 >= 4 && step % 2 === 1) this.tone(this.midi(this.degree(s, chord + s.arp[step % 8], 3)), t, six * 0.7, 'triangle', 0.025, 4000);
    }
  }

  tone(freq, t, dur, type, vol, cutoff = 2000, attack = 0.005) {
    const ctx = this.ctx;
    const o = ctx.createOscillator(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    o.type = type; o.frequency.value = freq;
    if (type === 'sawtooth') o.detune.value = (this.r() - 0.5) * 12;
    f.type = 'lowpass'; f.frequency.value = cutoff;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur + attack);
    o.connect(f); f.connect(g); g.connect(this.music);
    o.start(t); o.stop(t + dur + attack + 0.05);
  }

  kick(t, vol = 0.9) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(vol * 0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.music); o.start(t); o.stop(t + 0.32);
  }

  noiseHit(t, dur, vol, type, freq, bus) {
    const ctx = this.ctx, src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = this.noise;
    f.type = type; f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(bus || this.music);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  snare(t, vol, rim = false) { this.noiseHit(t, rim ? 0.06 : 0.18, vol * 0.4, rim ? 'bandpass' : 'highpass', rim ? 2500 : 1500); }
  hat(t, vol, open = false) { this.noiseHit(t, open ? 0.14 : 0.04, vol * 0.4, 'highpass', 7000); }
  crackle(t) { for (let k = 0; k < 3; k++) this.noiseHit(t + Math.random() * 0.3, 0.01, 0.05, 'highpass', 3000); }

  chime(t) {
    [0, 4, 7, 12].forEach((n, k) => this.tone(this.midi(72 + n), t + k * 0.12, 0.5, 'sine', 0.06, 5000));
    this.showName = 2.5;
  }

  // ---- sound effects ----
  ok() { return this.ctx && this.ctx.state === 'running'; }
  beep(freq, dur, vol) {
    if (!this.ok()) return;
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.setTargetAtTime(0, t + dur, 0.03);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.2);
  }
  sweep(f0, f1, dur, vol, type = 'sine') {
    if (!this.ok()) return;
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  crash(impact, near = 1) {
    if (!this.ok() || near <= 0) return;
    const v = clamp(impact / 15, 0.15, 1) * near;
    this.noiseHit(this.ctx.currentTime, 0.25 + v * 0.3, v * 0.6, 'lowpass', 1200 + v * 2000, this.sfx);
    this.sweep(120, 40, 0.25, v * 0.5);
  }
  thud(near = 1) { if (this.ok() && near > 0) { this.sweep(160, 50, 0.15, 0.4 * near); this.noiseHit(this.ctx.currentTime, 0.08, 0.2 * near, 'lowpass', 800, this.sfx); } }
  clang(near = 1) { if (this.ok() && near > 0) for (const f of [520, 731, 1180]) this.sweep(f, f * 0.97, 0.5, 0.06 * near, 'triangle'); }
  door() { if (this.ok()) { this.noiseHit(this.ctx.currentTime, 0.05, 0.25, 'lowpass', 900, this.sfx); this.sweep(90, 60, 0.08, 0.25); } }
  whoosh(near = 1) { if (this.ok() && near > 0) this.noiseHit(this.ctx.currentTime, 0.9, 0.3 * near, 'lowpass', 600, this.sfx); }
  boom(near = 1) {
    if (!this.ok()) return;
    const v = 0.3 + 0.7 * near;
    this.noiseHit(this.ctx.currentTime, 1.6, v * 0.9, 'lowpass', 500, this.sfx);
    this.sweep(90, 25, 1.2, v * 0.8);
  }
  splash(near = 1) { if (this.ok() && near > 0) this.noiseHit(this.ctx.currentTime, 0.8, 0.5 * near, 'highpass', 600, this.sfx); }
  blip(vol = 1) { this.sweep(880, 1320, 0.12, 0.12 * vol); }
  cash() { if (this.ok()) { this.sweep(1320, 1330, 0.1, 0.1); setTimeout(() => this.sweep(1760, 1770, 0.18, 0.1), 90); } }
  siren() { this.sweep(700, 1300, 0.35, 0.05, 'square'); setTimeout(() => this.sweep(1300, 700, 0.35, 0.05, 'square'), 350); }

  // A gunshot: a burst of filtered noise for the crack and a falling tone for the thump.
  // Far away it is quieter and duller.
  gun(kind, near = 1) {
    if (!this.ok() || near <= 0) return;
    const [len, vol, type, cutoff, f0, thump] = GUNS[kind] || GUNS.pistol;
    const v = vol * (0.15 + 0.85 * near);
    const t = this.ctx.currentTime;
    this.noiseHit(t, len * (0.7 + 0.6 * (1 - near)), v, near > 0.6 ? type : 'lowpass', near > 0.6 ? cutoff : cutoff * 0.5, this.sfx);
    this.sweep(f0, 45, thump, v * 0.9);
  }
  dry() { if (this.ok()) this.noiseHit(this.ctx.currentTime, 0.02, 0.25, 'highpass', 3500, this.sfx); }
  reload(seconds = 1.2) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    this.noiseHit(t + 0.05, 0.03, 0.22, 'bandpass', 2400, this.sfx);
    this.noiseHit(t + seconds * 0.85, 0.05, 0.3, 'bandpass', 1500, this.sfx);
  }
  punch(hit = true, near = 1, bat = false) {
    if (!this.ok() || near <= 0) return;
    const t = this.ctx.currentTime;
    if (bat) {
      // a whoosh, and a hollow wooden crack when it connects
      this.noiseHit(t, 0.16, 0.12 * near, 'bandpass', 500, this.sfx);
      if (hit) { this.sweep(320, 70, 0.12, 0.5 * near, 'triangle'); this.noiseHit(t, 0.06, 0.35 * near, 'bandpass', 1400, this.sfx); }
      return;
    }
    if (hit) { this.sweep(210, 55, 0.09, 0.45 * near); this.noiseHit(t, 0.05, 0.25 * near, 'lowpass', 900, this.sfx); }
    else this.noiseHit(t, 0.12, 0.08 * near, 'bandpass', 700, this.sfx);
  }
  pickup() { this.sweep(660, 990, 0.08, 0.1); setTimeout(() => this.sweep(990, 1320, 0.1, 0.08), 70); }
}
