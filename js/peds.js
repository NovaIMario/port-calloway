// Pedestrians walk loops around each block's pavement, cross at corners, scatter when
// something dangerous happens nearby, get knocked flying by cars, and sometimes punch back.
import { HALF_ROAD } from './city.js';
import { heightAt } from './citygen.js';
import { GRAVITY } from './physics.js';
import { hurtPlayer } from './combat.js';
import { mulberry32, pick, clamp, wrapAngle, forwardOf, rightOf } from './util.js';
import { SKIN, SHIRTS, TROUSERS, HAIR } from './looks.js';

const INSET = 2.3; // walking line, metres in from the kerb
const MAX_BODIES = 24;
const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;

function loopOf(g) {
  const x0 = g.x0 + INSET, z0 = g.z0 + INSET, x1 = g.x1 - INSET, z1 = g.z1 - INSET;
  return { x0, z0, x1, z1, w: x1 - x0, d: z1 - z0, P: 2 * (x1 - x0 + z1 - z0) };
}

// Point on a loop at distance s (clockwise from the north-west corner).
export function loopPoint(L, s) {
  s = ((s % L.P) + L.P) % L.P;
  if (s < L.w) return { x: L.x0 + s, z: L.z0 };
  s -= L.w;
  if (s < L.d) return { x: L.x1, z: L.z0 + s };
  s -= L.d;
  if (s < L.w) return { x: L.x1 - s, z: L.z1 };
  s -= L.w;
  return { x: L.x0, z: L.z1 - s };
}

function nearestS(L, x, z) {
  const cx = clamp(x, L.x0, L.x1), cz = clamp(z, L.z0, L.z1);
  const dl = Math.abs(cx - L.x0), dr = Math.abs(L.x1 - cx), dt = Math.abs(cz - L.z0), db = Math.abs(L.z1 - cz);
  const m = Math.min(dl, dr, dt, db);
  if (m === dt) return cx - L.x0;
  if (m === dr) return L.w + (cz - L.z0);
  if (m === db) return L.w + L.d + (L.x1 - cx);
  return L.w * 2 + L.d + (L.z1 - cz);
}

// A person in random clothes. `extra` overrides anything (a police uniform, a state).
export function makePerson(r, x, z, y, extra = {}) {
  return {
    x, z, y, h: r() * 6.28, vx: 0, vz: 0, vy: 0, speed: 0,
    skin: pick(r, SKIN), shirt: pick(r, SHIRTS), trousers: pick(r, TROUSERS), hair: pick(r, HAIR), sleeves: r() < 0.6,
    swing: 0, phase: r() * 6, down: 0, downTime: 0, health: 100, walk: 1.1 + r() * 0.5, state: 'walk', dir: r() < 0.5 ? 1 : -1,
    hitT: 0, punchT: 0,
    ...extra,
  };
}

export class Peds {
  constructor(world, seed = 9) {
    this.world = world;
    this.r = mulberry32(seed);
    this.loops = world.city.regions.map((g) => ({ g, L: loopOf(g) }));
    this.timer = 0;
    this.target = 55;
  }

  regionAt(x, z) {
    return this.loops.find((o) => x >= o.g.x0 && x <= o.g.x1 && z >= o.g.z0 && z <= o.g.z1);
  }

  make(x, z, extra = {}) {
    const p = makePerson(this.r, x, z, heightAt(this.world.city, x, z) ?? 0, extra);
    this.world.peds.push(p);
    return p;
  }

  // Something scary happened at (x, z): people within `radius` run away from it.
  scare(x, z, radius = 25, from = null) {
    for (const p of this.world.peds) {
      if (p.down || p.cop || p.dead || p.state === 'flee') continue;
      const d = Math.hypot(p.x - x, p.z - z);
      if (d < radius) this.flee(p, x, z, 3 + this.r() * 3);
    }
    if (from) from.scared = true;
  }

  flee(p, x, z, seconds = 4) {
    p.state = 'flee';
    p.fleeT = seconds;
    p.fx = x; p.fz = z;
    p.armsUp = this.r() < 0.4;
  }

  // Someone was hurt but is still standing: most run, a few punched people swing back.
  onHurt(p, by, weapon) {
    if (p.dead || p.cop || p.state === 'fight') return;
    if (by === this.world.player && weapon === 'fist' && this.r() < 0.35) {
      p.state = 'fight'; p.fightT = 10; p.swingT = 0.5; p.armsUp = false;
      return;
    }
    this.flee(p, by?.x ?? p.x, by?.z ?? p.z, 5 + this.r() * 3);
    p.armsUp = false;
  }

  update(dt) {
    const w = this.world, pl = w.player;
    this.timer -= dt;
    if (this.timer <= 0) { this.timer = 0.6; this.stream(); }
    for (const p of w.peds) this.step(p, dt);
    // danger: a car going fast on the pavement or straight at people
    if (pl.vehicle && pl.vehicle.speed > 6 && pl.vehicle.y > 0.05) this.scare(pl.x, pl.z, 12);
  }

  step(p, dt) {
    const w = this.world, city = w.city;
    if (p.hitT > 0) p.hitT -= dt;
    if (p.punchT > 0) p.punchT -= dt;
    // cars hitting people
    for (const v of w.vehicles) {
      if (v.speed < 3.5 || Math.abs(v.x - p.x) > 4 || Math.abs(v.z - p.z) > 4 || p.down) continue;
      const f = forwardOf(v.h), rt = rightOf(v.h);
      const dx = p.x - v.x, dz = p.z - v.z;
      if (Math.abs(dx * f.x + dz * f.z) < v.m.len / 2 + 0.3 && Math.abs(dx * rt.x + dz * rt.z) < v.m.wid / 2 + 0.3 && Math.abs(v.y - p.y) < 1.8) {
        w.knockDown(p, v.vx * 1.1, v.vz * 1.1, v.speed, v);
        if (!p.cop && !p.dead) { p.state = 'flee'; p.fleeT = 5; p.fx = v.x; p.fz = v.z; }
        this.scare(p.x, p.z, 18);
      }
    }
    if (p.down > 0) {
      p.downTime -= dt;
      if (p.dead) p.down = Math.min(1, p.down + dt * 3.5); // crumple to the ground and stay there
      else if (p.downTime <= 0) p.down = Math.max(0, p.down - dt * 2);
      p.vy -= GRAVITY * dt;
      const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
      const g = heightAt(city, nx, nz);
      if (g !== null) { p.x = nx; p.z = nz; }
      p.y += p.vy * dt;
      const gg = heightAt(city, p.x, p.z) ?? p.y;
      if (p.y <= gg) { p.y = gg; p.vy = 0; p.vx *= Math.exp(-6 * dt); p.vz *= Math.exp(-6 * dt); }
      p.spin = p.down ? (p.spin || 0) : 0;
      p.swing = 0;
      return;
    }
    if (p.cop || p.dead) return; // the police move their own officers
    let tx, tz, speed;
    if (p.state === 'fight') {
      const pl = w.player;
      p.fightT -= dt;
      const dx = pl.x - p.x, dz = pl.z - p.z, d = Math.hypot(dx, dz);
      if (p.fightT <= 0 || d > 20 || pl.vehicle || pl.health <= 0) p.state = 'return';
      else if (d > 1.05) { tx = pl.x; tz = pl.z; speed = 4.4; }
      else {
        tx = p.x; tz = p.z; speed = 0;
        p.h = lerpAngle(p.h, Math.atan2(dx, dz), 1 - Math.exp(-10 * dt));
        p.swingT -= dt;
        if (p.swingT <= 0 && pl.down === 0) {
          p.swingT = 0.8 + this.r() * 0.5;
          p.punchT = 0.28;
          if (this.r() < 0.15) w.knockDown(pl, (dx / d) * 3, (dz / d) * 3, 2, null);
          else if (this.r() < 0.75) hurtPlayer(w, 6, p);
          w.emit({ type: 'npcPunch', ped: p });
        }
      }
    }
    if (p.state === 'flee') {
      p.fleeT -= dt;
      const dx = p.x - p.fx, dz = p.z - p.fz, d = Math.hypot(dx, dz) || 1;
      tx = p.x + (dx / d) * 5; tz = p.z + (dz / d) * 5;
      speed = 6.2;
      if (p.fleeT <= 0) { p.state = 'return'; p.armsUp = false; }
    } else if (p.state === 'cross') {
      tx = p.tx; tz = p.tz; speed = p.walk * 1.25;
      if (Math.hypot(tx - p.x, tz - p.z) < 0.8) { p.state = 'walk'; p.loop = p.nextLoop; p.s = nearestS(p.loop.L, p.x, p.z); }
    } else if (p.state !== 'fight') {
      if (!p.loop || p.state === 'return') {
        const o = this.regionAt(p.x, p.z) || this.nearestLoop(p.x, p.z);
        if (!o) return;
        p.loop = o; p.s = nearestS(o.L, p.x, p.z);
        const q = loopPoint(o.L, p.s);
        if (Math.hypot(q.x - p.x, q.z - p.z) > 1.5) { tx = q.x; tz = q.z; speed = p.walk; p.state = 'return'; }
        else p.state = 'walk';
      }
      if (p.state === 'walk') {
        const L = p.loop.L;
        const before = p.s;
        p.s += p.dir * p.walk * dt;
        // at a corner, maybe cross the road
        const corners = [0, L.w, L.w + L.d, 2 * L.w + L.d, L.P];
        for (const c of corners) {
          if ((before - c) * (p.s - c) <= 0 && this.r() < 0.4) { this.tryCross(p, loopPoint(L, c)); break; }
        }
        if (p.state === 'walk') { const q = loopPoint(L, p.s); tx = q.x; tz = q.z; speed = p.walk; }
        else { tx = p.tx; tz = p.tz; speed = p.walk; }
      }
    }
    const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d > 0.01) {
      const step = Math.min(d, speed * dt * (p.state === 'walk' ? 1.6 : 1));
      const nx = p.x + (dx / d) * step, nz = p.z + (dz / d) * step;
      const g = heightAt(city, nx, nz);
      if (g !== null) { p.x = nx; p.z = nz; p.y = g; }
      p.h = lerpAngle(p.h, Math.atan2(dx, dz), 1 - Math.exp(-10 * dt));
    }
    p.speed = speed;
    p.phase += speed * dt * 2.3;
    p.swing = Math.sin(p.phase) * Math.min(1, speed / 3) * 0.7;
  }

  tryCross(p, corner) {
    const L = p.loop.L;
    const span = 2 * HALF_ROAD + 2 * INSET;
    const options = [];
    const ox = corner.x === L.x0 ? -1 : 1, oz = corner.z === L.z0 ? -1 : 1;
    for (const [dx, dz] of [[ox, 0], [0, oz]]) {
      const x = corner.x + dx * span, z = corner.z + dz * span;
      const o = this.regionAt(x, z);
      if (o && heightAt(this.world.city, (corner.x + x) / 2, (corner.z + z) / 2) !== null) options.push({ x, z, o });
    }
    if (!options.length) return;
    const t = pick(this.r, options);
    p.state = 'cross'; p.tx = t.x; p.tz = t.z; p.nextLoop = t.o;
  }

  nearestLoop(x, z) {
    let best = null, bd = 60;
    for (const o of this.loops) {
      const cx = clamp(x, o.g.x0, o.g.x1), cz = clamp(z, o.g.z0, o.g.z1);
      const d = Math.hypot(cx - x, cz - z);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  stream() {
    const w = this.world, pl = w.player;
    const far = (p) => Math.hypot(p.x - pl.x, p.z - pl.z);
    w.peds = w.peds.filter((p) => far(p) < 135);
    // a lot of bodies about: tidy away the ones furthest off
    const dead = w.peds.filter((p) => p.dead);
    if (dead.length > MAX_BODIES) {
      dead.sort((a, b) => far(b) - far(a));
      const gone = new Set(dead.slice(0, dead.length - MAX_BODIES));
      w.peds = w.peds.filter((p) => !gone.has(p));
    }
    let alive = w.peds.filter((p) => !p.dead && !p.cop).length;
    if (alive >= this.target) return;
    const cf = forwardOf(w.cameraYaw ?? pl.h);
    const near = this.loops.filter((o) => Math.abs((o.g.x0 + o.g.x1) / 2 - pl.x) < 150 && Math.abs((o.g.z0 + o.g.z1) / 2 - pl.z) < 150);
    for (let k = 0; k < 10 && alive < this.target && near.length; k++) {
      const o = pick(this.r, near);
      const s = this.r() * o.L.P;
      const q = loopPoint(o.L, s);
      const dx = q.x - pl.x, dz = q.z - pl.z, d = Math.hypot(dx, dz);
      if (d < 22 || d > 105) continue;
      if (d < 55 && (dx * cf.x + dz * cf.z) / d > 0.3) continue;
      this.make(q.x, q.z, { loop: o, s });
      alive++;
    }
  }
}
