// Civilian traffic. Cars drive on the right along a lane graph built from the road network,
// steer with pure pursuit, stop at red lights and keep their distance from whatever is ahead.
// They use the same physics as the player's car, so they can be rammed, shoved and stolen.
import { HALF_ROAD, LANE } from './city.js';
import { signalState } from './citygen.js';
import { clamp, forwardOf, rightOf, mulberry32, pick } from './util.js';
import { CIVILIAN_MODELS, SUPERCARS, paintFor } from './world.js';

export function buildLanes(city) {
  const lanes = [];
  const out = new Map(); // node id -> lanes leaving it
  for (const s of city.segments) {
    for (const [from, to] of [[s.a, s.b], [s.b, s.a]]) {
      const A = city.nodes[from], B = city.nodes[to];
      const dx = Math.sign(B.x - A.x), dz = Math.sign(B.z - A.z);
      const rx = -dz, rz = dx; // right of the travel direction
      const lane = {
        id: lanes.length, from, to, axis: s.axis, dx, dz,
        sx: A.x + dx * (HALF_ROAD + 1) + rx * LANE, sz: A.z + dz * (HALF_ROAD + 1) + rz * LANE,
        ex: B.x - dx * (HALF_ROAD + 1.5) + rx * LANE, ez: B.z - dz * (HALF_ROAD + 1.5) + rz * LANE,
      };
      lane.len = Math.hypot(lane.ex - lane.sx, lane.ez - lane.sz);
      lanes.push(lane);
      if (!out.has(from)) out.set(from, []);
      out.get(from).push(lane);
    }
  }
  return { lanes, out };
}

// Points of a quadratic curve from the end of one lane to the start of the next.
export function turnPoints(a, b) {
  const pts = [];
  let cx, cz;
  const straight = a.dx * b.dx + a.dz * b.dz > 0.9;
  if (straight) { cx = (a.ex + b.sx) / 2; cz = (a.ez + b.sz) / 2; }
  else if (a.dx !== 0) { cx = b.sx; cz = a.ez; }
  else { cx = a.ex; cz = b.sz; }
  // right turns are tight, left turns cross the junction on a wider arc, U-turns are tightest
  const right = b.dx === -a.dz && b.dz === a.dx;
  const uturn = a.dx * b.dx + a.dz * b.dz < -0.9;
  const turn = straight ? 0 : uturn ? 3 : right ? 4.5 : 6.5;
  for (let k = 1; k <= 5; k++) {
    const t = k / 6, u = 1 - t;
    pts.push({ x: u * u * a.ex + 2 * u * t * cx + t * t * b.sx, z: u * u * a.ez + 2 * u * t * cz + t * t * b.sz, turn });
  }
  return pts;
}

export function nextLane(net, lane, r) {
  const options = (net.out.get(lane.to) || []).filter((l) => l.to !== lane.from);
  if (!options.length) return net.out.get(lane.to).find((l) => l.to === lane.from);
  // going straight on is the most common choice
  const straight = options.find((l) => l.dx === lane.dx && l.dz === lane.dz);
  if (straight && r() < 0.5) return straight;
  return pick(r, options);
}

// Shared driving brain: follow ai.pts with pure pursuit, slowing for turns, lights and obstacles.
// opts.overtake lets a car swing into the other lane to get past something slow (police, racers);
// ai.yieldT makes a civilian pull over to the kerb for a siren.
export function followPath(world, v, ai, dt, opts = {}) {
  const pts = ai.pts;
  // advance past waypoints we have reached
  while (ai.i < pts.length) {
    const p = pts[ai.i], q = pts[ai.i - 1] || { x: v.x, z: v.z };
    const sx = p.x - q.x, sz = p.z - q.z;
    const along = (v.x - q.x) * sx + (v.z - q.z) * sz;
    // a stop line only counts as reached once the car is past it
    if (along >= sx * sx + sz * sz - 0.01 || (!p.stop && Math.hypot(p.x - v.x, p.z - v.z) < 2.5)) ai.i++;
    else break;
  }
  if (ai.i >= pts.length) return false;
  const speed = v.speed;
  const f = forwardOf(v.h), rt = rightOf(v.h);

  // what is in the way, and should we go round it?
  let gap = null, shift = 0;
  if (!opts.ignoreObstacles && !(ai.impatient > 0)) {
    const range = Math.max(10, speed * 2.2 + 8);
    gap = obstacleAhead(world, v, f, rt, range, 0);
    if (opts.overtake && gap !== null && gap < 30) {
      const alt = obstacleAhead(world, v, f, rt, range, 5.5);
      if (alt === null || alt > gap + 10) { shift = 5.5; gap = alt; }
    }
  }
  if (ai.yieldT > 0) { ai.yieldT -= dt; shift = -1.9; }
  ai.shift = (ai.shift || 0) + (shift - (ai.shift || 0)) * (1 - Math.exp(-2.5 * dt));

  // look-ahead point along the path, measured from the car's projection onto the current segment
  const Ld = clamp(3 + speed * 0.4, 4, 15);
  let tx = pts[ai.i].x, tz = pts[ai.i].z, left = Ld;
  const q0 = pts[ai.i - 1] || { x: v.x, z: v.z };
  const segx = pts[ai.i].x - q0.x, segz = pts[ai.i].z - q0.z, seg2 = segx * segx + segz * segz || 1;
  const u = clamp(((v.x - q0.x) * segx + (v.z - q0.z) * segz) / seg2, 0, 1);
  let px = q0.x + segx * u, pz = q0.z + segz * u;
  for (let k = ai.i; k < pts.length; k++) {
    const d = Math.hypot(pts[k].x - px, pts[k].z - pz);
    if (d >= left) { const t = left / d; tx = px + (pts[k].x - px) * t; tz = pz + (pts[k].z - pz) * t; break; }
    left -= d; px = pts[k].x; pz = pts[k].z; tx = px; tz = pz;
  }
  if (Math.abs(ai.shift) > 0.05) {
    const sl = Math.sqrt(seg2);
    tx += (segz / sl) * ai.shift; tz -= (segx / sl) * ai.shift; // positive shift = to the left
  }
  const dx = tx - v.x, dz = tz - v.z;
  const lat = dx * rt.x + dz * rt.z, ld2 = Math.max(4, dx * dx + dz * dz);
  const vl = v.vx * f.x + v.vz * f.z;
  const angle = Math.atan((2 * lat * v.m.wb) / ld2);
  v.input.steer = clamp((angle * (1 + Math.abs(vl) * 0.03)) / v.m.steer, -1, 1);

  // target speed: cruise, slower into bends, stop for lights and obstacles
  let target = ai.yieldT > 0 ? Math.min(ai.cruise, 3) : ai.cruise;
  let dist = Math.hypot(pts[ai.i].x - v.x, pts[ai.i].z - v.z);
  const decel = opts.decel ?? 3.5, horizon = 40 + speed * 2.5;
  for (let k = ai.i; k < Math.min(pts.length, ai.i + 12) && dist < horizon; k++) {
    const p = pts[k];
    if (p.turn) {
      const vt = p.turn * (opts.turnScale ?? 1);
      target = Math.min(target, Math.sqrt(vt * vt + 2 * decel * Math.max(0, dist - 2)));
      break;
    }
    if (p.stop && !opts.ignoreLights) {
      const st = signalState(world.city, p.node, p.axis, world.time);
      if (st === 'r' || (st === 'y' && dist > 9)) { target = Math.min(target, dist < 1.5 ? 0 : Math.sqrt(2 * 3 * Math.max(0, dist - 1.5))); break; }
    }
    if (k + 1 < pts.length) dist += Math.hypot(pts[k + 1].x - p.x, pts[k + 1].z - p.z);
  }
  if (gap !== null) target = Math.min(target, Math.max(0, (gap - 3) * 0.9));
  if (!opts.ignoreObstacles) {
    if (gap !== null && gap < 6 && speed < 0.5) ai.blocked = (ai.blocked || 0) + dt; else ai.blocked = 0;
    if (ai.blocked > 5) { ai.impatient = 1.5; ai.blocked = 0; v.horn = 0.6; }
  }
  if (ai.impatient > 0) ai.impatient -= dt;
  const err = target - vl;
  v.input.throttle = err > 0 ? clamp(err * 0.45, 0, opts.maxThrottle ?? 0.85) : 0;
  v.input.brake = err < -0.2 ? clamp(-err * 0.6, 0, 1) : 0;
  if (target < 0.3 && speed < 1.2) v.input.brake = 1;
  v.input.handbrake = false;
  return true;
}

// Distance to the nearest thing in this car's path, or null.
// shift moves the corridor that many metres to the left (for checking an overtaking line).
function obstacleAhead(world, v, f, rt, range, shift = 0) {
  let best = null;
  const half = v.m.len / 2;
  const check = (x, z, size, width) => {
    const dx = x - v.x, dz = z - v.z;
    const fwd = dx * f.x + dz * f.z;
    if (fwd <= 0 || fwd > range + size) return;
    const lat = Math.abs(dx * rt.x + dz * rt.z + shift);
    if (lat > width + 0.6 + fwd * 0.04) return;
    const gap = fwd - half - size;
    if (best === null || gap < best) best = gap;
  };
  for (const o of world.vehicles) {
    if (o === v || Math.abs(o.x - v.x) > range + 6 || Math.abs(o.z - v.z) > range + 6) continue;
    check(o.x, o.z, o.m.len / 2, 1.4 + o.m.wid / 2);
  }
  for (const p of world.peds) {
    if (p.down || Math.abs(p.x - v.x) > range || Math.abs(p.z - v.z) > range) continue;
    check(p.x, p.z, 0.4, 1.3);
  }
  const pl = world.player;
  if (!pl.vehicle) check(pl.x, pl.z, 0.4, 1.3);
  return best;
}

export class Traffic {
  constructor(world, seed = 42) {
    this.world = world;
    this.net = buildLanes(world.city);
    this.r = mulberry32(seed);
    this.timer = 0;
    this.target = 30;
  }

  nearestNode(x, z) {
    let best = null, bd = Infinity;
    for (const n of this.world.city.nodes) {
      if (!n.alive) continue;
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  // Shortest lane sequence between two junctions (every road segment is the same length).
  routeLanes(fromId, toId, avoidLane = null) {
    const prev = new Map([[fromId, null]]);
    const q = [fromId];
    while (q.length && !prev.has(toId)) {
      const id = q.shift();
      for (const l of this.net.out.get(id) || []) {
        if (l === avoidLane || prev.has(l.to)) continue;
        prev.set(l.to, l);
        q.push(l.to);
      }
    }
    const lanes = [];
    for (let id = toId; prev.get(id); id = prev.get(id).from) lanes.unshift(prev.get(id));
    return lanes;
  }

  // Waypoints for a list of lanes, with turn curves between them.
  pathFromLanes(lanes) {
    const pts = [];
    lanes.forEach((l, k) => {
      if (k > 0) pts.push(...turnPoints(lanes[k - 1], l));
      pts.push(...this.laneWaypoints(l));
    });
    return pts;
  }

  // A route through a list of road points, as lanes. Used by racers and by Halloran.
  routeThrough(x, z, h, points) {
    const f = forwardOf(h);
    const start = this.nearestNode(x + f.x * 60, z + f.z * 60);
    let lanes = [], node = start.id;
    for (const [px, pz] of points) {
      const target = this.nearestNode(px, pz).id;
      if (target === node) continue;
      const seg = this.routeLanes(node, target, lanes[lanes.length - 1] ? this.reverseOf(lanes[lanes.length - 1]) : null);
      lanes = lanes.concat(seg.length ? seg : this.routeLanes(node, target));
      node = target;
    }
    return lanes;
  }

  reverseOf(l) { return this.net.lanes.find((o) => o.from === l.to && o.to === l.from); }

  // The lane a car is driving along, if it is on one and facing the right way.
  laneOf(v) {
    const f = forwardOf(v.h);
    let best = null, bd = 5;
    for (const l of this.net.lanes) {
      if (l.dx * f.x + l.dz * f.z < 0.6) continue;
      const t = ((v.x - l.sx) * l.dx + (v.z - l.sz) * l.dz) / l.len;
      if (t < -0.15 || t > 1.05) continue;
      const u = clamp(t, 0, 1);
      const d = Math.hypot(l.sx + (l.ex - l.sx) * u - v.x, l.sz + (l.ez - l.sz) * u - v.z);
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }

  // Waypoints from wherever a car is now to a junction, following lanes and turn curves.
  pathTo(v, toId) {
    const L = this.laneOf(v);
    if (L) {
      let rest = L.to === toId ? [] : this.routeLanes(L.to, toId, this.reverseOf(L));
      if (L.to !== toId && !rest.length) rest = this.routeLanes(L.to, toId);
      return this.pathFromLanes([L, ...rest]).slice(1); // the lane's start is behind the car
    }
    const f = forwardOf(v.h);
    const start = this.nearestNode(v.x + f.x * 12, v.z + f.z * 12);
    return this.pathFromLanes(start.id === toId ? [] : this.routeLanes(start.id, toId));
  }

  laneWaypoints(lane) {
    return [
      { x: lane.sx, z: lane.sz },
      { x: lane.ex, z: lane.ez, stop: true, node: lane.to, axis: lane.axis, lane },
    ];
  }

  extend(ai) {
    while (ai.pts.length - ai.i < 8) {
      const nl = nextLane(this.net, ai.lane, this.r);
      ai.pts.push(...turnPoints(ai.lane, nl), ...this.laneWaypoints(nl));
      ai.lane = nl;
    }
    if (ai.i > 30) { ai.pts.splice(0, ai.i - 1); ai.i = 1; }
  }

  attach(v, lane, t = 0) {
    const x = lane.sx + (lane.ex - lane.sx) * t, z = lane.sz + (lane.ez - lane.sz) * t;
    const ai = { kind: 'civilian', lane, pts: [{ x, z }, ...this.laneWaypoints(lane).slice(1)], i: 1, cruise: 11 + this.r() * 4.5 };
    v.ai = ai;
    this.extend(ai);
    return ai;
  }

  // Snap a shoved car back onto the nearest lane that points roughly the way it faces.
  reattach(v) {
    const f = forwardOf(v.h);
    let best = null, bd = 12;
    for (const l of this.net.lanes) {
      if (l.dx * f.x + l.dz * f.z < 0.5) continue;
      const t = clamp(((v.x - l.sx) * l.dx + (v.z - l.sz) * l.dz) / l.len, 0, 1);
      const x = l.sx + (l.ex - l.sx) * t, z = l.sz + (l.ez - l.sz) * t;
      const d = Math.hypot(x - v.x, z - v.z);
      if (d < bd) { bd = d; best = { l, t }; }
    }
    if (!best) return false;
    const cruise = v.ai?.cruise ?? 12;
    this.attach(v, best.l, Math.min(0.98, best.t + 6 / best.l.len));
    v.ai.cruise = cruise;
    return true;
  }

  update(dt) {
    const w = this.world, p = w.player;
    this.timer -= dt;
    if (this.timer <= 0) { this.timer = 0.5; this.stream(); }
    const sirens = w.vehicles.filter((v) => v.siren && v.ai?.kind === 'police' && v.speed > 4);
    for (const v of w.vehicles) {
      const ai = v.ai;
      if (!ai || ai.kind !== 'civilian' || v.driver === 'player') continue;
      for (const s of sirens) {
        const dx = s.x - v.x, dz = s.z - v.z;
        if (Math.abs(dx) > 40 || Math.abs(dz) > 40) continue;
        const f = forwardOf(v.h);
        if (dx * f.x + dz * f.z < -3 && forwardOf(s.h).x * f.x + forwardOf(s.h).z * f.z > 0.5) ai.yieldT = 1.5;
      }
      if (v.wrecked || v.health < 30 || v.sinking || ai.shot) { this.abandon(v); continue; }
      if (ai.shock > 0) {
        ai.shock -= dt;
        v.input.throttle = 0; v.input.brake = 0.4; v.input.steer = 0;
        if (ai.shock <= 0 && !this.reattach(v)) this.abandon(v);
        continue;
      }
      if (!followPath(w, v, ai, dt)) this.extend(ai);
      else this.extend(ai);
      // pushed far off the path (by a crash): stop for a moment, then find a lane again
      const q = ai.pts[ai.i - 1], n = ai.pts[ai.i];
      if (q && n) {
        const sx = n.x - q.x, sz = n.z - q.z, l = Math.hypot(sx, sz) || 1;
        const off = Math.abs(((v.x - q.x) * sz - (v.z - q.z) * sx) / l);
        if (off > 5) ai.shock = 1.2;
      }
    }
  }

  abandon(v) {
    if (v.ai?.kind !== 'civilian') return;
    v.ai = null;
    v.input.throttle = 0; v.input.brake = 0.5; v.input.steer = 0;
    if (v.driver === 'npc') { v.driver = null; this.world.emit({ type: 'bail', v }); }
  }

  stream() {
    const w = this.world, p = w.player;
    const cars = w.vehicles.filter((v) => v.ai?.kind === 'civilian');
    for (const v of cars) {
      const d = Math.hypot(v.x - p.x, v.z - p.z);
      if (d > 250 && !v.mission) w.removeVehicle(v);
    }
    if (cars.length >= this.target) return;
    // spawn on a nearby lane, out of sight where possible
    const cf = forwardOf(w.cameraYaw ?? p.h);
    const near = this.net.lanes.filter((l) => Math.abs((l.sx + l.ex) / 2 - p.x) < 230 && Math.abs((l.sz + l.ez) / 2 - p.z) < 230);
    let spawned = 0;
    for (let tries = 0; tries < 30 && near.length; tries++) {
      const lane = near[Math.floor(this.r() * near.length)];
      const t = 0.1 + this.r() * 0.6;
      const x = lane.sx + (lane.ex - lane.sx) * t, z = lane.sz + (lane.ez - lane.sz) * t;
      const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
      if (d < 45 || d > 210) continue;
      if (d < 140 && (dx * cf.x + dz * cf.z) / d > 0.2) continue;
      if (w.vehicles.some((o) => Math.abs(o.x - x) < 14 && Math.abs(o.z - z) < 14)) continue;
      const model = this.r() < 0.025 ? pick(this.r, SUPERCARS) : CIVILIAN_MODELS[Math.floor(this.r() * CIVILIAN_MODELS.length)];
      const v = w.addVehicle(model, x, z, Math.atan2(lane.dx, lane.dz), { color: paintFor(model, this.r()), driver: 'npc' });
      this.attach(v, lane, t);
      const s = v.ai.cruise * 0.8;
      v.vx = lane.dx * s; v.vz = lane.dz * s;
      if (++spawned >= 3 || cars.length + spawned >= this.target) break;
    }
  }
}
