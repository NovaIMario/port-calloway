// Game glue: runs the systems around the world simulation (traffic, pedestrians, police,
// missions) and turns world events into crimes, stunts, particles, sound and HUD messages.
import { Traffic } from './traffic.js';
import { Peds } from './peds.js';
import { Police } from './police.js';
import { MissionRunner, MISSIONS } from './missions.js';
import { JobContext } from './jobs.js';
import { Effects } from './render/effects.js';
import { Markers } from './render/markers.js';
import { GameAudio } from './audio.js';
import { heightAt, rampHeight } from './citygen.js';
import { forwardOf, rightOf } from './util.js';

const SAVE_KEY = 'port-calloway-save-1';

export class Game {
  constructor({ world, hud, rig, gfx, props, meshes, input }) {
    Object.assign(this, { world, hud, rig, gfx, props, meshes, input });
    this.sensitivity = 1;
    this.traffic = new Traffic(world);
    this.police = new Police(world, this.traffic);
    this.peds = new Peds(world);
    world.systems.push(this.traffic, this.police, this.peds);
    this.jobs = new JobContext(this);
    this.missions = new MissionRunner(this.jobs);
    this.effects = new Effects(gfx.scene);
    this.markers = new Markers(gfx.scene);
    this.audio = new GameAudio();
    this.stunts = new Set();
    this.timer = null;
    this.respawn = 0;
    this.saveTimer = 20;
    this.titleAngle = 0;
    this.save = this.loadSave();
    this.hasSave = !!this.save;
  }

  loadSave() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; }
  }

  writeSave() {
    const p = this.world.player;
    const data = { cash: p.cash, done: [...this.missions.done], stunts: [...this.stunts], tod: this.world.tod };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* private mode */ }
  }

  start() {
    const w = this.world, f = w.city.pois.ferry;
    w.spawnPlayer(f.x, f.z, Math.PI);
    this.starter = w.addVehicle('corso', f.x + 6, f.z - 22, Math.PI, { color: 0x2a8f8a, owned: true });
    if (this.save) {
      w.player.cash = this.save.cash || 0;
      for (const id of this.save.done || []) this.missions.done.add(id);
      for (const s of this.save.stunts || []) this.stunts.add(s);
      w.tod = this.save.tod ?? w.tod;
      if (this.missions.done.has('homecoming')) {
        const g = w.city.pois.garage;
        w.spawnPlayer(g.x + 6, g.z + 2, 0);
        this.starter.x = g.road.x + 10; this.starter.z = g.road.z; this.starter.h = Math.PI / 2;
      }
    }
    this.rig.yaw = w.player.h;
  }

  newGame() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    location.reload();
  }

  restartMission() {
    const a = this.missions.active;
    if (!a) return;
    const m = a.m;
    this.missions.fail('Restarted.');
    const s = this.jobs.point(m.start);
    const w = this.world;
    if (w.player.vehicle) w.exitVehicle();
    w.player.x = s.x; w.player.z = s.z + 6; w.player.y = heightAt(w.city, s.x, s.z + 6) ?? 0;
    this.police.clear();
  }

  fillProgress(el) {
    const done = MISSIONS.filter((m) => this.missions.done.has(m.id)).length;
    el.innerHTML = `Story: ${done} of ${MISSIONS.length} jobs<br>Stunt jumps: ${this.stunts.size} of ${this.world.city.ramps.length}<br>Cash: $${this.world.player.cash.toLocaleString('en-GB')}`;
    document.getElementById('restart-mission').hidden = !this.missions.active;
  }

  update(dt, c) {
    const w = this.world, p = w.player;
    w.cameraYaw = this.rig.yaw;
    if (this.respawn > 0) {
      this.respawn -= dt;
      c = { ...c, throttle: 0, brake: 0, steer: 0, moveX: 0, moveY: 0, enter: false, jump: false };
      if (this.respawn <= 0) this.finishRespawn();
    }
    w.update(dt, c, this.rig.yaw);
    this.jobs.update(dt);
    this.missions.update(dt);
    if (!this.missions.active && this.respawn <= 0) {
      const m = this.missions.startable(p.x, p.z);
      if (m) this.missions.start(m);
    }
    this.handleEvents();
    if (p.health <= 0 && this.respawn <= 0) this.knockout('Hospitalised', 'hospital', 0.1);
    if (c.radio && p.vehicle) this.audio.nextStation();
    this.garageRespray();
    this.emitEffects(dt);
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) { this.saveTimer = 20; this.writeSave(); }
  }

  garageRespray() {
    const p = this.world.player, g = this.world.city.pois.garage;
    if (!p.vehicle || this.police.level === 0 || this.police.level > 2 || this.police.seen) return;
    if (Math.hypot(p.x - g.road.x, p.z - g.road.z) > 7 || p.vehicle.speed > 3 || p.cash < 100) return;
    this.police.clear();
    p.cash -= 100;
    p.vehicle.health = Math.max(p.vehicle.health, 100);
    this.hud.notice('Bea gives the car a quick respray and the police lose interest. −$100', 4);
    this.audio.cash();
  }

  knockout(title, where, fine) {
    const w = this.world, p = w.player;
    const lose = Math.min(p.cash, Math.max(100, Math.round(p.cash * fine)));
    p.cash -= lose;
    this.hud.banner(title, lose ? `−$${lose.toLocaleString('en-GB')}` : '', 3, 'bad');
    if (this.missions.active) this.missions.fail(title === 'Arrested' ? 'You were arrested.' : 'You were hospitalised.');
    this.respawn = 2.6;
    this.respawnAt = where;
  }

  finishRespawn() {
    const w = this.world, p = w.player;
    if (p.vehicle) w.exitVehicle();
    const poi = w.city.pois[this.respawnAt];
    w.spawnPlayer(poi.x, poi.z, poi.h ?? 0);
    p.y = heightAt(w.city, poi.x, poi.z) ?? 0;
    this.police.clear();
    this.rig.yaw = p.h;
    this.rig.snap();
  }

  handleEvents() {
    const w = this.world, p = w.player, pol = this.police;
    const mine = (v) => v && v === p.vehicle;
    for (const e of w.events) {
      switch (e.type) {
        case 'vehicleAdded': this.onVehicle?.add(e.v); break;
        case 'vehicleRemoved': this.onVehicle?.remove(e.v); break;
        case 'notice': this.hud.notice(e.text, e.seconds); break;
        case 'prop':
          this.props.knock(e.c, e.v.vx / (e.v.speed || 1), e.v.vz / (e.v.speed || 1));
          this.audio.clang(this.near(e.v));
          break;
        case 'crash':
          this.effects.sparks(e.x, e.v.y + 0.6, e.z, Math.min(30, e.impact * 2));
          this.audio.crash(e.impact, this.near(e.v));
          if (mine(e.v)) this.rig.shake = Math.min(0.6, e.impact * 0.03);
          this.peds.scare(e.x, e.z, 12);
          break;
        case 'carHit': {
          this.effects.sparks(e.x, 0.8, e.z, Math.min(30, e.impact * 2));
          this.audio.crash(e.impact, this.near(e.a));
          const other = mine(e.a) ? e.b : mine(e.b) ? e.a : null;
          if (other) {
            this.rig.shake = Math.min(0.6, e.impact * 0.03);
            if (other.model === 'interceptor') pol.crime(70, e.x, e.z, { force: true });
            else if (e.impact > 6) pol.crime(25, e.x, e.z, { callChance: 0.15 });
          }
          for (const v of [e.a, e.b]) if (v.ai?.kind === 'civilian' && e.impact > 2) v.ai.shock = 1.2;
          this.peds.scare(e.x, e.z, 14);
          break;
        }
        case 'knock':
          this.audio.thud(this.near(e.who));
          if (e.who === p) { this.rig.shake = 0.4; break; }
          if (e.by && mine(e.by)) pol.crime(55, e.who.x, e.who.z, { callChance: 0.5 });
          break;
        case 'jack': {
          pol.crime(40, e.v.x, e.v.z, { callChance: 0.2 });
          const rt = rightOf(e.v.h);
          this.peds.make(e.v.x - rt.x * 2, e.v.z - rt.z * 2, { state: 'flee', fleeT: 5, fx: p.x, fz: p.z, armsUp: true });
          this.audio.door();
          break;
        }
        case 'bail': {
          const rt = rightOf(e.v.h);
          this.peds.make(e.v.x - rt.x * 2, e.v.z - rt.z * 2, { state: 'flee', fleeT: 6, fx: p.x, fz: p.z });
          break;
        }
        case 'steal':
          if (!e.v.mission) pol.crime(20, e.v.x, e.v.z, { callChance: 0 });
          if (e.v.model !== 'corso' || !e.v.owned) e.v.alarm = 3;
          this.audio.door();
          break;
        case 'enter': case 'exit': this.audio.door(); break;
        case 'fire': this.audio.whoosh(this.near(e.v)); break;
        case 'explode': this.explode(e.v); break;
        case 'sunk': if (mine(e.v) || e.v.everDriven) this.hud.notice('Splash. The car is at the bottom of the harbour now.', 3); break;
        case 'splash': this.effects.splash(e.v.x, -2, e.v.z); this.audio.splash(this.near(e.v)); if (mine(e.v)) this.stunt(e, true); break;
        case 'land':
          if (e.hard > 6) this.effects.dust(e.v.x, e.v.y, e.v.z, 6);
          if (mine(e.v)) this.stunt(e, false);
          if (e.hard > 8) this.audio.crash(e.hard * 0.6, this.near(e.v));
          break;
        case 'heat':
          if (e.rising) this.audio.siren();
          if (!e.rising && e.level === 0) this.hud.notice('You lost the police.', 3);
          break;
        case 'arrested': this.knockout('Arrested', 'police', 0.1); break;
      }
    }
    w.events.length = 0;
  }

  near(o) {
    const p = this.world.player;
    return Math.max(0, 1 - Math.hypot(o.x - p.x, o.z - p.z) / 120);
  }

  explode(v) {
    const w = this.world, p = w.player;
    this.effects.explosion(v.x, v.y, v.z);
    this.audio.boom(this.near(v));
    this.rig.shake = 0.8 * this.near(v) + 0.1;
    for (const o of w.vehicles) {
      const d = Math.hypot(o.x - v.x, o.z - v.z);
      if (o === v || d > 9) continue;
      o.health -= 55 * (1 - d / 9);
      const k = (1 - d / 9) * 9 / (d || 1);
      o.vx += (o.x - v.x) * k; o.vz += (o.z - v.z) * k; o.awake = true;
    }
    if (p.vehicle === v) p.health = 0;
    else if (!p.vehicle && Math.hypot(p.x - v.x, p.z - v.z) < 9) w.knockDown(p, (p.x - v.x) * 2, (p.z - v.z) * 2, 12);
    for (const q of w.peds) if (Math.hypot(q.x - v.x, q.z - v.z) < 9 && !q.down) w.knockDown(q, (q.x - v.x) * 2, (q.z - v.z) * 2, 10);
    this.peds.scare(v.x, v.z, 45);
    if (v.model === 'interceptor') this.police.crime(120, v.x, v.z, { force: true });
    else if (v.everDriven || Math.hypot(p.x - v.x, p.z - v.z) < 40) this.police.crime(40, v.x, v.z, { callChance: 0.5 });
  }

  stunt(e, splash) {
    const from = e.from;
    if (!from) return;
    const ramp = this.world.city.ramps.find((rp) => {
      const f = forwardOf(rp.h);
      const ex = rp.x + f.x * rp.len, ez = rp.z + f.z * rp.len;
      return Math.hypot(from.x - ex, from.z - ez) < rp.width;
    });
    if (!ramp || e.airTime < 0.7) return;
    const v = e.v;
    const dist = Math.round(Math.hypot(v.x - from.x, v.z - from.z));
    if (splash && !ramp.splash) { this.hud.notice(`${ramp.name}: not quite. Splash!`, 3); return; }
    const first = !this.stunts.has(ramp.name);
    const cash = first ? 200 + dist * 4 : 40 + dist;
    this.stunts.add(ramp.name);
    this.world.player.cash += cash;
    this.hud.banner(first ? `Stunt: ${ramp.name}` : ramp.name, `${dist} m · ${e.airTime.toFixed(1)} s in the air · +$${cash}`, 3.5, 'good');
    this.audio.cash();
    if (first) this.writeSave();
  }

  onMissionDone(m) {
    this.writeSave();
    if (m.id === 'lastorders') {
      setTimeout(() => this.hud.banner('Port Calloway', 'Thanks for playing. The city is yours.', 6, 'good'), 4500);
    }
  }

  emitEffects(dt) {
    const w = this.world, p = w.player, fx = this.effects;
    this.fxClock = (this.fxClock || 0) + dt;
    const tick = this.fxClock > 0.06;
    if (tick) this.fxClock = 0;
    for (const v of w.vehicles) {
      if (Math.abs(v.x - p.x) > 160 || Math.abs(v.z - p.z) > 160) continue;
      const f = forwardOf(v.h), rt = rightOf(v.h);
      if (tick && (v.health < 45 || v.burning) && !v.sinking) {
        const hx = v.x + f.x * v.m.len * 0.35, hz = v.z + f.z * v.m.len * 0.35;
        fx.smoke(hx, v.y + v.m.hgt * 0.8, hz, v.burning || v.wrecked ? 0.95 : 1 - v.health / 60);
        if (v.burning) for (let k = 0; k < 3; k++) fx.fire(hx, v.y + v.m.hgt * 0.7, hz);
      }
      if (!v.airborne && v.y < 0.3 && (v.slip > 3.2 || (v.input.brake > 0.8 && v.speed > 9) || (v.input.handbrake && v.speed > 4))) {
        v.markAcc = (v.markAcc || 0) + v.speed * dt;
        if (v.markAcc > 0.7) {
          v.markAcc = 0;
          for (const s of [-1, 1]) {
            const ox = rt.x * s * (v.m.wid / 2 - 0.2) - f.x * v.m.wb / 2, oz = rt.z * s * (v.m.wid / 2 - 0.2) - f.z * v.m.wb / 2;
            fx.skid(v.x + ox, v.z + oz, v.y, Math.atan2(v.vx, v.vz));
          }
          if (v.slip > 5 && tick) fx.dust(v.x - f.x * 1.5, v.y, v.z - f.z * 1.5, 1);
        }
      } else if (tick && !v.airborne && v.speed > 12 && v.y > 0.1 && Math.random() < 0.3) {
        fx.dust(v.x - f.x * 2, v.y, v.z - f.z * 2, 1);
      }
      if (v.alarm > 0) v.alarm -= dt;
    }
  }

  prompt() {
    const w = this.world, p = w.player;
    if (p.vehicle || p.down || this.respawn > 0) return null;
    const v = w.nearestEnterable();
    if (!v) return null;
    return v.driver ? `<kbd>F</kbd> pull the driver out of the ${v.m.name}` : `<kbd>F</kbd> get in the ${v.m.name}`;
  }

  blips(full = false) {
    const out = this.jobs.blips();
    if (!this.missions.active) {
      for (const m of this.missions.available()) {
        const s = this.jobs.point(m.start);
        out.push({ x: s.x, z: s.z, kind: 'mission', big: true, label: full ? m.title : null });
      }
    }
    if (this.police.level > 0) for (const v of this.police.units()) out.push({ x: v.x, z: v.z, kind: 'police' });
    if (full) {
      for (const rp of this.world.city.ramps) if (!this.stunts.has(rp.name)) out.push({ x: rp.x, z: rp.z, kind: 'stunt', label: rp.name });
      for (const id of ['garage', 'hospital', 'police']) { const q = this.world.city.pois[id]; out.push({ x: q.x, z: q.z, kind: 'poi', label: q.name }); }
    }
    return out;
  }

  idle(dt) {
    this.titleAngle += dt * 0.05;
    const cam = this.gfx.camera;
    cam.position.set(Math.sin(this.titleAngle) * 420, 160, Math.cos(this.titleAngle) * 420);
    cam.lookAt(0, 20, 0);
  }

  render(dt, c) {
    const w = this.world, p = w.player;
    this.handleEvents();
    if (c) {
      if (c.camera) this.rig.mode = (this.rig.mode + 1) % 3;
      this.rig.update(dt, p, c);
    }
    const env = this.gfx.setTime(w.tod, p);
    for (const m of this.meshes.night) m.emissiveIntensity = env.night * env.night * 0.9;
    for (const m of this.props.lampMats) m.emissiveIntensity = env.night * 2;
    this.props.pools.opacity = env.night * 0.55;
    this.props.updateSignals(w.time);
    this.meshes.water.material.map.offset.set(w.time * 0.004, w.time * 0.0025);
    this.effects.update(dt);
    const ground = (x, z) => heightAt(w.city, x, z);
    const marks = this.jobs.marks.map((m) => (m.vehicle ? { ...m, y: m.y ?? 0 } : m));
    this.markers.set(marks, w.time, ground);
    const beacons = this.missions.active ? [] : this.missions.available().filter((m) => m.giver).map((m) => ({ ...this.jobs.point(m.start), letter: m.giver[0] }));
    this.markers.setBeacons(beacons, w.time, ground);
    this.audio.update(dt, w, this.police, env);
    if (c) {
      this.hud.update(dt, w, {
        prompt: this.prompt(), heat: this.police.level, heatSeen: this.police.seen, blips: this.blips(), yaw: this.rig.yaw,
        timer: this.timer, radio: this.audio.stationName(), radioShow: this.audio.showName > 0 && !!p.vehicle,
      });
    }
  }
}
