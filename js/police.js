// Heat and the police. Crimes add heat; police cars route towards the player along the lanes,
// then chase directly once they can see them. Out of sight for long enough, the heat drops a
// level at a time. Boxed in and stationary next to a police car means arrest.
import { clamp, forwardOf, rightOf, mulberry32, wrapAngle } from './util.js';
import { followPath } from './traffic.js';

export const LEVELS = [0, 1, 120, 260, 450, 700]; // heat points needed for each level
const UNITS = [0, 2, 3, 4, 5, 6];
const LOSE_TIME = [0, 9, 12, 15, 18, 22];

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
  }

  units() { return this.world.vehicles.filter((v) => v.ai?.kind === 'police'); }
  watchers() { return this.world.vehicles.filter((v) => v.ai?.kind === 'police' || v.ai?.kind === 'patrol'); }

  // severity in heat points; witnessed crimes count in full, unwitnessed ones may be phoned in
  crime(severity, x, z, opts = {}) {
    if (this.disabled) return;
    const witnessed = opts.force || this.canSee(x, z, 70);
    if (!witnessed && this.r() > (opts.callChance ?? 0.35)) return;
    this.add(witnessed ? severity : severity * 0.6);
    if (witnessed) this.unseen = 0;
  }

  add(points) {
    const before = this.level;
    this.points = Math.min(LEVELS[5] + 100, Math.max(this.points, LEVELS[this.level]) + points);
    this.level = Math.max(this.level, levelFor(this.points));
    if (this.level > before) this.world.emit({ type: 'heat', level: this.level, rising: true });
  }

  setLevel(level) {
    this.points = Math.max(this.points, LEVELS[level] + 1);
    const before = this.level;
    this.level = Math.max(this.level, level);
    if (this.level > before) this.world.emit({ type: 'heat', level: this.level, rising: true });
  }

  clear() {
    this.points = 0; this.level = 0; this.unseen = 0; this.bust = 0;
    for (const v of this.units()) this.toPatrol(v);
  }

  // Line of sight from any police car to a point, blocked by buildings.
  canSee(x, z, range = 90) {
    for (const v of this.watchers()) {
      if (v.wrecked) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < range && this.clearLine(v.x, v.z, x, z)) return true;
    }
    return false;
  }

  clearLine(x0, z0, x1, z1) {
    const list = this.world.grid.query(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1));
    const dx = x1 - x0, dz = z1 - z0;
    for (const c of list) {
      if (c.type !== 'box' || c.h < 3) continue;
      let t0 = 0, t1 = 1, hit = true;
      for (const [o, d, lo, hi] of [[x0, dx, c.x0, c.x1], [z0, dz, c.z0, c.z1]]) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { hit = false; break; } continue; }
        let a = (lo - o) / d, b = (hi - o) / d;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        if (t0 > t1) { hit = false; break; }
      }
      if (hit) return false;
    }
    return true;
  }

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
          if (this.level === 0) for (const v of units) this.toPatrol(v);
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
    if (this.level === 0) { this.toPatrol(v); return; }
    if (d > 380) { w.removeVehicle(v); return; }
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

  arrestCheck(dt) {
    const w = this.world, pl = w.player;
    if (this.level === 0 || pl.down) { this.bust = Math.max(0, this.bust - dt); return; }
    const slow = pl.vehicle ? pl.vehicle.speed < 1.5 : pl.speed < 2.5;
    const near = this.units().some((v) => !v.wrecked && Math.hypot(v.x - pl.x, v.z - pl.z) < (pl.vehicle ? 7.5 : 5.5) && v.speed < 6);
    if (slow && near) this.bust += dt; else this.bust = Math.max(0, this.bust - dt * 2);
    if (this.bust > (pl.vehicle ? 2.6 : 1.4)) {
      this.bust = 0;
      w.emit({ type: 'arrested' });
    }
  }
}
