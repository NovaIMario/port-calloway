// Heat and the police. Crimes add heat; police cars route towards the player along the lanes,
// then chase directly once they can see them. Out of sight for long enough, the heat drops a
// level at a time. Boxed in and stationary next to a police car means arrest.
// When a car pulls up close, officers get out on foot: they run you down to arrest you, and at
// high heat (or once you have turned violent) they open fire.
import { clamp, forwardOf, rightOf, mulberry32, wrapAngle } from './util.js';
import { followPath } from './traffic.js';
import { heightAt } from './citygen.js';
import { makePerson } from './peds.js';
import { castRay, hurtPlayer, hurtPed, shootVehicle, lineClear } from './combat.js';

export const LEVELS = [0, 1, 120, 260, 450, 700]; // heat points needed for each level
const UNITS = [0, 2, 3, 4, 5, 6];
const LOSE_TIME = [0, 9, 12, 15, 18, 22];
const MAX_OFFICERS = 8;
const UNIFORM = { shirt: 0x1d3a5c, trousers: 0x162236, hair: 0x101826, sleeves: true };
const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;

export function levelFor(points) {
  let l = 0;
  for (let i = 1; i < LEVELS.length; i++) if (points >= LEVELS[i]) l = i;
  return l;
}

export class Police {
  constructor(world, traffic, seed = 77) {
    this.world = world;
    this.traffic = traffic;
    this.r = mulberry32(seed);
    this.points = 0;
    this.level = 0;
    this.seen = false;
    this.unseen = 0;
    this.bust = 0;
    this.spawnTimer = 0;
    this.patrolTarget = 2;
    this.disabled = false;
    this.hostile = 0; // seconds that officers shoot on sight at two bars, after the player turns violent
  }

  units() { return this.world.vehicles.filter((v) => v.ai?.kind === 'police'); }
  watchers() { return this.world.vehicles.filter((v) => v.ai?.kind === 'police' || v.ai?.kind === 'patrol'); }
  officers() { return this.world.peds.filter((p) => p.cop); }

  // Officers shoot at three bars and up, or at two once the player has been violent.
  armed() { return this.level >= 3 || (this.level >= 2 && this.hostile > 0); }

  // severity in heat points; witnessed crimes count in full, unwitnessed ones may be phoned in
  crime(severity, x, z, opts = {}) {
    if (this.disabled) return;
    const witnessed = opts.force || this.canSee(x, z, 70);
    if (!witnessed && this.r() > (opts.callChance ?? 0.35)) return;
    this.add(witnessed ? severity : severity * 0.6);
    if (witnessed) this.unseen = 0;
  }

  // Violence by the player, as reported by the game: what was done, and to whom.
  report(e) {
    const x = e.x ?? e.ped?.x ?? e.v?.x ?? this.world.player.x, z = e.z ?? e.ped?.z ?? e.v?.z ?? this.world.player.z;
    const angry = (s) => { this.hostile = Math.max(this.hostile, s); };
    switch (e.type) {
      case 'gunfire':
        this.crime(28, x, z, { callChance: 0.15 });
        if (this.canSee(x, z, 70)) angry(25);
        break;
      case 'punch':
        if (e.target?.cop) { this.crime(150, x, z, { force: true }); angry(30); }
        else if (e.hit) this.crime(18, x, z, { callChance: 0.2 });
        break;
      case 'pedHurt':
        if (e.ped.cop) { this.crime(260, x, z, { force: true }); angry(60); }
        else this.crime(40, x, z, { callChance: 0.35 });
        break;
      case 'pedKilled':
        if (e.ped.cop) { this.crime(420, x, z, { force: true }); angry(90); }
        else { this.crime(110, x, z, { callChance: 0.6 }); if (this.canSee(x, z, 70)) angry(40); }
        break;
      case 'carShot':
        if (e.v.model === 'interceptor') { this.crime(90, x, z, { force: true }); angry(40); }
        break;
      case 'blast': // a rocket or a grenade going off
        this.crime(130, x, z, { callChance: 0.8 });
        if (this.canSee(x, z, 90)) angry(50);
        break;
      case 'robbery': // the clerk hits the alarm
        this.crime(160, x, z, { force: true });
        angry(40);
        break;
    }
  }

  add(points) {
    const before = this.level;
    this.points = Math.min(LEVELS[5] + 100, Math.max(this.points, LEVELS[this.level]) + points);
    this.level = Math.max(this.level, levelFor(this.points));
    // a reported crime tells them roughly where you are, so the search starts over (and a
    // fresh call gives the cars a few seconds to get there before they start to lose you)
    this.unseen = Math.min(this.unseen, this.level > before ? -6 : 0);
    if (this.level > before) this.world.emit({ type: 'heat', level: this.level, rising: true });
  }

  setLevel(level) {
    this.points = Math.max(this.points, LEVELS[level] + 1);
    const before = this.level;
    this.level = Math.max(this.level, level);
    if (this.level > before) this.world.emit({ type: 'heat', level: this.level, rising: true });
  }

  clear() {
    this.points = 0; this.level = 0; this.unseen = 0; this.bust = 0; this.hostile = 0;
    for (const o of this.officers()) if (!o.dead) this.dismiss(o);
    for (const v of this.units()) { v.ai.deployed = false; this.toPatrol(v); }
  }

  // Line of sight from any police car or officer to a point, blocked by buildings.
  canSee(x, z, range = 90) {
    for (const v of this.watchers()) {
      if (v.wrecked) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < range && this.clearLine(v.x, v.z, x, z)) return true;
    }
    for (const o of this.officers()) {
      if (o.dead || o.down) continue;
      if (Math.hypot(o.x - x, o.z - z) < range * 0.7 && this.clearLine(o.x, o.z, x, z)) return true;
    }
    return false;
  }

  clearLine(x0, z0, x1, z1) { return lineClear(this.world, x0, z0, x1, z1); }

  route(v) {
    const T = this.traffic, pl = this.world.player;
    const target = T.nearestNode(pl.x, pl.z);
    v.ai.pts = [{ x: v.x, z: v.z }, ...T.pathTo(v, target.id), { x: pl.x, z: pl.z }];
    v.ai.i = 1;
  }

  spawnUnit() {
    const w = this.world, pl = w.player;
    const lanes = this.traffic.net.lanes;
    const cf = forwardOf(w.cameraYaw ?? pl.h);
    for (let tries = 0; tries < 20; tries++) {
      const lane = lanes[Math.floor(this.r() * lanes.length)];
      const t = 0.2 + this.r() * 0.6;
      const x = lane.sx + (lane.ex - lane.sx) * t, z = lane.sz + (lane.ez - lane.sz) * t;
      const dx = x - pl.x, dz = z - pl.z, d = Math.hypot(dx, dz);
      if (d < 90 || d > 210) continue;
      if ((dx * cf.x + dz * cf.z) / d > 0.5 && d < 160) continue;
      if (w.vehicles.some((o) => Math.abs(o.x - x) < 12 && Math.abs(o.z - z) < 12)) continue;
      const v = w.addVehicle('interceptor', x, z, Math.atan2(lane.dx, lane.dz), { color: 0xf4f4f4, driver: 'npc', locked: true });
      v.ai = { kind: 'police', pts: [], i: 1, cruise: 30, replan: 0, stuck: 0, reverse: 0 };
      v.siren = true;
      v.vx = lane.dx * 10; v.vz = lane.dz * 10;
      return v;
    }
    return null;
  }

  toPatrol(v) {
    v.siren = false;
    if (!this.traffic.reattach(v)) { v.ai = null; return; }
    v.ai.kind = 'patrol';
    v.ai.cruise = 12;
  }

  update(dt) {
    const w = this.world, pl = w.player;
    if (this.disabled) return;
    this.hostile = Math.max(0, this.hostile - dt);
    const units = this.units();
    // can any unit see the player right now?
    this.seen = this.level > 0 && this.canSee(pl.x, pl.z, 95);
    if (this.level > 0) {
      if (this.seen) this.unseen = 0;
      else {
        this.unseen += dt;
        if (this.unseen > LOSE_TIME[this.level]) {
          this.level -= 1;
          this.points = this.level ? LEVELS[this.level] : 0;
          this.unseen = 0;
          w.emit({ type: 'heat', level: this.level, rising: false });
        }
      }
    }
    // keep the right number of units on the chase
    this.spawnTimer -= dt;
    if (this.level > 0 && this.spawnTimer <= 0) {
      this.spawnTimer = 2.5;
      if (units.filter((v) => !v.wrecked).length < UNITS[this.level]) this.spawnUnit();
    }
    this.patrolTimer = (this.patrolTimer ?? 4) - dt;
    if (this.level === 0 && this.patrolTimer <= 0) {
      this.patrolTimer = 8;
      if (w.vehicles.filter((v) => v.ai?.kind === 'patrol').length < this.patrolTarget) {
        const v = this.spawnUnit();
        if (v) this.toPatrol(v);
      }
    }
    for (const v of units) this.drive(v, dt);
    for (const o of this.officers()) this.stepOfficer(o, dt);
    // patrols: a couple of police cars cruise with the traffic and witness crimes
    for (const v of w.vehicles) {
      if (v.ai?.kind !== 'patrol') continue;
      if (this.level > 0 && Math.hypot(v.x - pl.x, v.z - pl.z) < 160) { v.ai = { kind: 'police', pts: [], i: 1, cruise: 30, replan: 0, stuck: 0, reverse: 0 }; v.siren = true; continue; }
      if (!followPath(w, v, v.ai, dt)) this.traffic.extend(v.ai); else this.traffic.extend(v.ai);
      if (Math.hypot(v.x - pl.x, v.z - pl.z) > 340) w.removeVehicle(v);
    }
    this.arrestCheck(dt);
  }

  drive(v, dt) {
    const w = this.world, pl = w.player, ai = v.ai;
    if (v.wrecked || v.health <= 0 || v.sinking) { v.siren = false; v.ai = null; v.driver = null; return; }
    const d = Math.hypot(pl.x - v.x, pl.z - v.z);
    if (ai.deployed) {
      // parked while the crew is out on foot (a held brake would reverse a stopped car)
      v.input.throttle = 0; v.input.brake = v.speed > 0.6 ? 1 : 0; v.input.steer = 0; v.input.handbrake = true;
      const crew = this.officers().filter((o) => o.car === v);
      if (!crew.length) ai.deployed = false; // they all got back in (or were lost)
      else if (crew.every((o) => o.dead)) this.abandon(v);
      return;
    }
    if (this.level === 0) { this.toPatrol(v); return; }
    if (d > 380) { w.removeVehicle(v); return; }
    // pulled up close to a player who isn't getting away: the officers get out
    const slowTarget = !pl.vehicle || pl.vehicle.speed < 3;
    if (d < 26 && v.speed < 3 && slowTarget && pl.health > 0 && this.clearLine(v.x, v.z, pl.x, pl.z)) { this.deploy(v); if (ai.deployed) return; }
    const f = forwardOf(v.h), rt = rightOf(v.h);
    if (ai.reverse > 0) {
      ai.reverse -= dt;
      v.input.throttle = 0; v.input.brake = 0.8; v.input.steer = ai.reverseSteer; v.input.handbrake = false;
      return;
    }
    const direct = d < 75 && this.clearLine(v.x, v.z, pl.x, pl.z);
    if (direct) {
      const target = pl.vehicle || pl;
      const lead = Math.min(1.2, d / 25);
      const tx = pl.x + (target.vx || 0) * lead, tz = pl.z + (target.vz || 0) * lead;
      const dx = tx - v.x, dz = tz - v.z;
      const ang = wrapAngle(Math.atan2(dx, dz) - v.h);
      const lat = dx * rt.x + dz * rt.z, ld2 = Math.max(9, dx * dx + dz * dz);
      const vl = v.vx * f.x + v.vz * f.z;
      v.input.steer = clamp((Math.atan((2 * lat * v.m.wb) / ld2) * (1 + Math.abs(vl) * 0.03)) / v.m.steer * 1.4, -1, 1);
      const close = d < 10 && !pl.vehicle;
      const want = close ? Math.max(2, d - 5) : pl.vehicle ? Math.max(18, (pl.vehicle.speed || 0) * 1.25 + 6) : 14;
      v.input.throttle = vl < want ? (Math.abs(ang) > 1.2 ? 0.5 : 1) : 0;
      v.input.brake = vl > want + 3 ? 0.6 : 0;
      v.input.handbrake = Math.abs(ang) > 1.1 && vl > 12;
    } else {
      ai.replan -= dt;
      if (ai.replan <= 0 || ai.i >= ai.pts.length) { ai.replan = 1.5; this.route(v); }
      ai.cruise = d > 150 ? 32 : 24;
      followPath(w, v, ai, dt, { ignoreLights: true, turnScale: 1.5, maxThrottle: 1, decel: 7, overtake: true });
    }
    // unstick: if barely moving while trying to drive, back up and turn
    if (v.speed < 1 && v.input.throttle > 0.3) ai.stuck += dt; else ai.stuck = Math.max(0, ai.stuck - dt);
    if (ai.stuck > 1.6) { ai.stuck = 0; ai.reverse = 1.1; ai.reverseSteer = this.r() < 0.5 ? -1 : 1; }
  }

  // Two officers step out of the car's doors.
  deploy(v) {
    const w = this.world, rt = rightOf(v.h);
    let n = 0;
    for (const side of [1, -1]) {
      if (this.officers().filter((o) => !o.dead).length >= MAX_OFFICERS) break;
      const off = v.m.wid / 2 + 0.6;
      const x = v.x + rt.x * side * off, z = v.z + rt.z * side * off;
      const y = heightAt(w.city, x, z);
      if (y === null) continue;
      w.peds.push(makePerson(this.r, x, z, y, { ...UNIFORM, cop: true, car: v, state: 'cop', h: v.h, fireT: 0.7 + this.r() * 0.8, burst: 3, walk: 0 }));
      n++;
    }
    if (n) { v.ai.deployed = true; w.emit({ type: 'copsOut', v }); }
  }

  // A car whose whole crew is down is left where it stands, unlocked.
  abandon(v) {
    v.ai = null; v.driver = null; v.siren = false; v.locked = false;
    v.input.throttle = 0; v.input.brake = 0.5; v.input.steer = 0;
  }

  dismiss(o) {
    const i = this.world.peds.indexOf(o);
    if (i >= 0) this.world.peds.splice(i, 1);
  }

  stepOfficer(o, dt) {
    const w = this.world, pl = w.player;
    o.shotT = Math.max(0, (o.shotT || 0) - dt);
    o.aim = false;
    if (o.dead || o.down > 0) return;
    const dx = pl.x - o.x, dz = pl.z - o.z, d = Math.hypot(dx, dz);
    if (d > 110) return this.dismiss(o);
    const car = o.car && !o.car.wrecked && w.vehicles.includes(o.car) ? o.car : null;
    // stood down, or the player has driven off: back to the car (and away)
    const gone = pl.vehicle && pl.vehicle.speed > 6 && d > 30;
    if (this.level === 0 || gone || pl.health <= 0 && d > 6) {
      o.armed = this.level > 0;
      o.leaveT = (o.leaveT || 0) + dt;
      if (!car) {
        if (o.leaveT > 12 || d > 60) return this.dismiss(o);
        return this.runTo(o, o.x - dx, o.z - dz, 1.6, dt);
      }
      if (Math.hypot(car.x - o.x, car.z - o.z) < 2.6 || o.leaveT > 25) return this.dismiss(o);
      return this.runTo(o, car.x, car.z, 4.8, dt, 1.5);
    }
    o.leaveT = 0;
    const armed = this.armed();
    o.armed = armed || this.level >= 2;
    if (pl.health <= 0) { o.speed = 0; o.swing = 0; return; }
    // high up in a helicopter (or on a roof) is a long way off for a pistol
    const d3 = Math.hypot(d, pl.y - o.y);
    const see = d3 < 50 && this.clearLine(o.x, o.z, pl.x, pl.z);
    if (armed && see && d3 < 28) {
      // stand, face the player and fire in short bursts
      o.speed = 0; o.swing = 0;
      o.h = lerpAngle(o.h, Math.atan2(dx, dz), 1 - Math.exp(-10 * dt));
      o.aim = true;
      o.fireT -= dt;
      if (o.fireT <= 0) {
        this.shoot(o, d3);
        o.burst -= 1;
        if (o.burst > 0) o.fireT = 0.25 + this.r() * 0.15;
        else { o.burst = 2 + Math.floor(this.r() * 3); o.fireT = 0.9 + this.r() * 1.0; }
      }
      return;
    }
    // close in: to make the arrest, or to get a clear shot
    if (armed) this.runTo(o, pl.x, pl.z, 5.4, dt, 0);
    else if (d > 1.1) this.runTo(o, pl.x, pl.z, d > 8 ? 5.4 : 3.4, dt, 1.0);
    else { o.speed = 0; o.swing = 0; o.h = lerpAngle(o.h, Math.atan2(dx, dz), 1 - Math.exp(-10 * dt)); }
  }

  // Run towards a point, sliding along walls and stepping round corners when stuck.
  runTo(o, tx, tz, speed, dt, stopAt = 0) {
    const w = this.world;
    const dx = tx - o.x, dz = tz - o.z, d = Math.hypot(dx, dz);
    if (d <= stopAt + 0.05) { o.speed = 0; o.swing = 0; return; }
    let hx = dx / d, hz = dz / d;
    if (o.detour > 0) {
      o.detour -= dt;
      const s = o.detourSide;
      hx = hx * 0.35 - hz * s; hz = hz * 0.35 + (dx / d) * s;
      const l = Math.hypot(hx, hz) || 1; hx /= l; hz /= l;
    }
    const step = Math.min(speed * dt, d - stopAt);
    const bx = o.x, bz = o.z;
    w.moveOnFoot(o, hx * step, hz * step);
    const moved = Math.hypot(o.x - bx, o.z - bz);
    if (moved < step * 0.3) {
      o.stuck = (o.stuck || 0) + dt;
      if (o.stuck > 0.5) { o.stuck = 0; o.detour = 1.2; o.detourSide = this.r() < 0.5 ? -1 : 1; }
    } else o.stuck = 0;
    o.h = lerpAngle(o.h, Math.atan2(hx, hz), 1 - Math.exp(-10 * dt));
    o.speed = moved / dt;
    o.phase += o.speed * dt * 2.3;
    o.swing = Math.sin(o.phase) * Math.min(1, o.speed / 3) * 0.75;
  }

  // One shot at the player (or their car). Harder to hit at range and on the move.
  shoot(o, d) {
    const w = this.world, pl = w.player;
    const f = forwardOf(o.h), rt = rightOf(o.h);
    const m = { x: o.x + f.x * 0.5 + rt.x * 0.28, y: o.y + 1.42, z: o.z + f.z * 0.5 + rt.z * 0.28 };
    const v = pl.vehicle;
    const moving = v ? v.speed : pl.speed;
    const acc = clamp(0.58 - d * 0.013 - moving * 0.035, 0.06, 0.62);
    let tx = pl.x, ty = v ? v.y + 0.8 : pl.y + (pl.down ? 0.3 : 1.15), tz = pl.z;
    if (this.r() > acc) {
      const a = this.r() * Math.PI * 2, off = 0.9 + this.r() * 1.6;
      tx += Math.cos(a) * off; tz += Math.sin(a) * off; ty += (this.r() - 0.3) * 1.2;
    }
    const l = Math.hypot(tx - m.x, ty - m.y, tz - m.z) || 1;
    const dir = { x: (tx - m.x) / l, y: (ty - m.y) / l, z: (tz - m.z) / l };
    const hit = castRay(w, m, dir, 70, o);
    if (hit.kind === 'player') hurtPlayer(w, 7 + this.r() * 4, o);
    else if (hit.kind === 'vehicle') {
      shootVehicle(w, hit.target, 12, o);
      if (hit.target === v && this.r() < 0.3) hurtPlayer(w, 4, o);
    } else if (hit.kind === 'ped' && !hit.target.cop) hurtPed(w, hit.target, 30, dir, o, { weapon: 'pistol' });
    o.shotT = 0.15;
    w.emit({ type: 'shot', by: o, weapon: 'pistol', x0: m.x, y0: m.y, z0: m.z, x1: hit.x, y1: hit.y, z1: hit.z, kind: hit.kind, tracer: true });
  }

  arrestCheck(dt) {
    const w = this.world, pl = w.player;
    // nobody is arrested in mid-air, under a parachute or out of reach on a roof
    const up = pl.chute || (pl.vehicle?.m.air && !pl.vehicle.grounded);
    if (this.level === 0 || pl.down || pl.health <= 0 || up) { this.bust = Math.max(0, this.bust - dt); return; }
    const slow = pl.vehicle ? pl.vehicle.speed < 1.5 : pl.speed < 2.5;
    const nearCar = this.units().some((v) => !v.wrecked && Math.hypot(v.x - pl.x, v.z - pl.z) < (pl.vehicle ? 7.5 : 5.5) && v.speed < 6 && Math.abs(v.y - pl.y) < 3);
    const reach = pl.vehicle ? pl.vehicle.m.len / 2 + 1.4 : 1.8;
    const nearCop = this.officers().some((o) => !o.dead && !o.down && Math.hypot(o.x - pl.x, o.z - pl.z) < reach && Math.abs(o.y - pl.y) < 2);
    if (slow && (nearCar || nearCop)) this.bust += dt; else this.bust = Math.max(0, this.bust - dt * 2);
    if (this.bust > (pl.vehicle ? 2.6 : 1.4)) {
      this.bust = 0;
      w.emit({ type: 'arrested' });
    }
  }
}
