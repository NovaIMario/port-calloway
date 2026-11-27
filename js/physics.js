// Arcade vehicle physics and collision. Pure logic: no rendering. Cars use a bicycle model
// with a lateral-grip term, so lifting the grip (handbrake) lets the car slide. Bodies collide
// with the city's boxes and circles via a spatial grid; cars are approximated by three circles.
import { clamp, forwardOf, rightOf, SpatialGrid } from './util.js';
import { heightAt } from './citygen.js';
import { WATER_Y } from './city.js';

export const GRAVITY = 18; // stronger than real gravity, so jumps feel weighty rather than floaty

export const MODELS = {
  corso: { name: 'Corso', kind: 'hatch', len: 3.9, wid: 1.78, hgt: 1.45, accel: 8, top: 44, brake: 24, grip: 7.5, steer: 0.62, wb: 2.4, tough: 0.9 },
  meridian: { name: 'Meridian', kind: 'sedan', len: 4.7, wid: 1.86, hgt: 1.42, accel: 8, top: 48, brake: 24, grip: 7, steer: 0.58, wb: 2.8, tough: 1 },
  cab: { name: 'Calloway Cab', kind: 'taxi', len: 4.7, wid: 1.86, hgt: 1.42, accel: 8, top: 46, brake: 24, grip: 7, steer: 0.58, wb: 2.8, tough: 1 },
  ranger: { name: 'Ranger', kind: 'suv', len: 4.8, wid: 2.0, hgt: 1.8, accel: 7.5, top: 45, brake: 22, grip: 6.5, steer: 0.56, wb: 2.9, tough: 1.3 },
  tasker: { name: 'Tasker', kind: 'pickup', len: 5.3, wid: 2.0, hgt: 1.75, accel: 7, top: 42, brake: 20, grip: 6, steer: 0.55, wb: 3.2, tough: 1.4 },
  haulmark: { name: 'Haulmark', kind: 'van', len: 5.6, wid: 2.1, hgt: 2.6, accel: 5.5, top: 36, brake: 18, grip: 5.5, steer: 0.5, wb: 3.4, tough: 1.8 },
  vireo: { name: 'Vireo GT', kind: 'sports', len: 4.4, wid: 1.96, hgt: 1.18, accel: 12.5, top: 64, brake: 30, grip: 9, steer: 0.55, wb: 2.6, tough: 0.8 },
  // supercars: the Strand Motors range
  halcyon: { name: 'Halcyon GT', kind: 'gt', len: 4.75, wid: 1.98, hgt: 1.25, accel: 13.5, top: 70, brake: 31, grip: 9.4, steer: 0.55, wb: 2.85, tough: 0.95 },
  vantor: { name: 'Vantor S', kind: 'super', len: 4.55, wid: 2.04, hgt: 1.12, accel: 16, top: 80, brake: 34, grip: 10.5, steer: 0.56, wb: 2.7, tough: 0.85 },
  volantis: { name: 'Volantis X', kind: 'hyper', len: 4.7, wid: 2.08, hgt: 1.08, accel: 19, top: 92, brake: 38, grip: 11.5, steer: 0.56, wb: 2.75, tough: 0.9 },
  interceptor: { name: 'Interceptor', kind: 'police', len: 4.9, wid: 1.92, hgt: 1.45, accel: 10.5, top: 58, brake: 28, grip: 8, steer: 0.58, wb: 2.9, tough: 1.6 },
  armored: { name: 'Strongbox', kind: 'armored', len: 6.0, wid: 2.3, hgt: 2.7, accel: 5, top: 34, brake: 16, grip: 5.5, steer: 0.48, wb: 3.6, tough: 4 },
  // aircraft (see aircraft.js): accel is m/s² of forward speed, steer the turn rate in rad/s
  skylark: { name: 'Skylark', kind: 'heli', air: 'heli', len: 9.4, wid: 2.3, hgt: 3.1, accel: 7, top: 42, steer: 1.4, wb: 3, tough: 1.1 },
  // thrust is m/s² at full throttle, stall the speed below which the wings stop flying, vr the
  // take-off speed; wingY is the height of the (high) wing
  gull: { name: 'Gull', kind: 'plane', air: 'plane', len: 7.6, wid: 1.6, hgt: 2.6, top: 72, thrust: 6, stall: 24, vr: 22, span: 10.6, wingY: 2.05, wb: 2, tough: 0.9 },
};

const SURFACE_GRIP = { road: 1, curb: 0.95, grass: 0.7, sand: 0.55 };

let nextId = 1;
export function createVehicle(model, x, z, h, opts = {}) {
  const m = MODELS[model];
  return {
    id: nextId++, model, m, x, z, y: opts.y ?? 0, h, vx: 0, vz: 0, vy: 0, spin: 0, steer: 0,
    health: 100, airborne: false, airTime: 0, sinking: 0, pitch: 0, roll: 0, slip: 0, speed: 0,
    input: { throttle: 0, brake: 0, steer: 0, handbrake: false, fwd: 0, yaw: 0, lift: 0, bank: 0, pitch: 0 },
    color: opts.color ?? 0xb0b0b0, driver: null, siren: false, alarm: 0, wheelSpin: 0,
    ...(m.air ? { grounded: true, rotor: 0, blade: 0, thr: 0, s: 0, w: 0, alt: 0 } : {}),
    ...opts,
  };
}

// The circles used to collide a car: centre offsets along its length.
export function vehicleCircles(v) {
  const r = v.m.wid * 0.5, o = v.m.len * 0.5 - r;
  const f = forwardOf(v.h);
  return [
    { x: v.x + f.x * o, z: v.z + f.z * o, r, ox: f.x * o, oz: f.z * o },
    { x: v.x, z: v.z, r, ox: 0, oz: 0 },
    { x: v.x - f.x * o, z: v.z - f.z * o, r, ox: -f.x * o, oz: -f.z * o },
  ];
}

export function buildStaticGrid(city) {
  const grid = new SpatialGrid(20);
  for (const c of city.colliders) {
    if (c.type === 'box') grid.insert(c, c.x0, c.z0, c.x1, c.z1);
    else grid.insert(c, c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r);
  }
  return grid;
}

// Push a circle out of a static collider. Returns {nx, nz, depth} or null.
export function circleContact(px, pz, r, c) {
  if (c.type === 'circle') {
    const dx = px - c.x, dz = pz - c.z, d2 = dx * dx + dz * dz, rr = r + c.r;
    if (d2 >= rr * rr) return null;
    const d = Math.sqrt(d2) || 1e-6;
    return { nx: dx / d, nz: dz / d, depth: rr - d };
  }
  const cx = clamp(px, c.x0, c.x1), cz = clamp(pz, c.z0, c.z1);
  const dx = px - cx, dz = pz - cz, d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-9) { const d = Math.sqrt(d2); return { nx: dx / d, nz: dz / d, depth: r - d }; }
  const l = px - c.x0, rgt = c.x1 - px, t = pz - c.z0, b = c.z1 - pz, m = Math.min(l, rgt, t, b);
  if (m === l) return { nx: -1, nz: 0, depth: l + r };
  if (m === rgt) return { nx: 1, nz: 0, depth: rgt + r };
  if (m === t) return { nx: 0, nz: -1, depth: t + r };
  return { nx: 0, nz: 1, depth: b + r };
}

const scratch = [];
// Resolve a vehicle against the static world. Calls onHit(collider, impactSpeed) for each contact.
export function collideVehicleStatic(v, grid, onHit) {
  for (let pass = 0; pass < 2; pass++) {
    for (const s of vehicleCircles(v)) {
      scratch.length = 0;
      grid.query(s.x - s.r, s.z - s.r, s.x + s.r, s.z + s.r, scratch);
      for (const c of scratch) {
        if (c.broken || v.y > c.h - 0.2) continue;
        const k = circleContact(s.x, s.z, s.r, c);
        if (!k) continue;
        const vn = v.vx * k.nx + v.vz * k.nz;
        if ((c.kind === 'lamp' || c.kind === 'signal') && -vn > 4) {
          c.broken = true;
          v.vx *= 0.88; v.vz *= 0.88;
          onHit?.(c, -vn);
          continue;
        }
        v.x += k.nx * k.depth; v.z += k.nz * k.depth;
        s.x += k.nx * k.depth; s.z += k.nz * k.depth;
        if (vn < 0) {
          const e = 0.25, j = -(1 + e) * vn;
          v.vx += j * k.nx; v.vz += j * k.nz;
          // friction along the wall and a spin from off-centre hits
          const tx = -k.nz, tz = k.nx, vt = v.vx * tx + v.vz * tz;
          v.vx -= tx * vt * 0.12; v.vz -= tz * vt * 0.12;
          const ox = s.ox - k.nx * s.r, oz = s.oz - k.nz * s.r;
          v.spin += ((oz * j * k.nx - ox * j * k.nz) * 6) / (v.m.len * v.m.len + v.m.wid * v.m.wid);
          if (pass === 0) onHit?.(c, -vn);
        }
      }
    }
  }
}

// Car-on-car collision with mass-weighted impulses. Returns impact speed (0 if none).
export function collideVehicles(a, b) {
  if (Math.abs(a.y - b.y) > 1.6) return 0;
  let impact = 0;
  const ma = a.m.tough * a.m.len, mb = b.m.tough * b.m.len;
  for (const s of vehicleCircles(a)) {
    for (const t of vehicleCircles(b)) {
      const dx = s.x - t.x, dz = s.z - t.z, d2 = dx * dx + dz * dz, rr = s.r + t.r;
      if (d2 >= rr * rr) continue;
      const d = Math.sqrt(d2) || 1e-6, nx = dx / d, nz = dz / d, depth = rr - d;
      const wa = mb / (ma + mb), wb = ma / (ma + mb);
      a.x += nx * depth * wa; a.z += nz * depth * wa;
      b.x -= nx * depth * wb; b.z -= nz * depth * wb;
      const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
      if (rel < 0) {
        const j = -1.3 * rel;
        a.vx += nx * j * wa; a.vz += nz * j * wa;
        b.vx -= nx * j * wb; b.vz -= nz * j * wb;
        a.spin += (s.oz * nx - s.ox * nz) * j * wa * 0.08;
        b.spin -= (t.oz * nx - t.ox * nz) * j * wb * 0.08;
        impact = Math.max(impact, -rel);
      }
    }
  }
  return impact;
}

export function surfaceKind(city, x, z, y) {
  if (y < 0.05) return 'road';
  const s = city.surfaceAt?.(x, z);
  return s === 'grass' ? 'grass' : s === 'sand' ? 'sand' : 'curb';
}

// Advance one vehicle. `events` collects things the game reacts to (landings, splashes).
export function stepVehicle(v, dt, city, grid, events = []) {
  const m = v.m, inp = v.input;
  const f = forwardOf(v.h), rt = rightOf(v.h);
  let vl = v.vx * f.x + v.vz * f.z;
  let vs = v.vx * rt.x + v.vz * rt.z;
  const dead = v.health <= 0;
  v.steer += clamp(inp.steer - v.steer, -dt * 5, dt * 5);

  if (!v.airborne && !v.sinking) {
    const surf = SURFACE_GRIP[surfaceKind(city, v.x, v.z, v.y)];
    const thr = dead ? 0 : inp.throttle, brk = inp.brake;
    if (thr > 0) {
      if (vl < -0.5) vl += m.brake * thr * dt;
      else vl += m.accel * thr * Math.max(0, 1 - (vl / m.top) ** 2) * dt * (0.6 + 0.4 * surf);
    }
    if (brk > 0) {
      if (vl > 0.5) vl -= m.brake * brk * dt;
      else if (!dead) vl -= m.accel * 0.7 * brk * Math.max(0, 1 - (-vl / (m.top * 0.3)) ** 2) * dt;
    }
    const coast = thr === 0 && brk === 0 ? 1.2 : 0;
    const resist = (0.3 + coast + 0.0011 * vl * vl + (1 - surf) * 3) * dt;
    vl -= Math.sign(vl) * Math.min(Math.abs(vl), resist);
    if (inp.handbrake) vl -= Math.sign(vl) * Math.min(Math.abs(vl), 6 * dt);

    const angle = (-v.steer * m.steer) / (1 + Math.abs(vl) * 0.03);
    let yaw = (vl * Math.tan(angle)) / m.wb;
    if (inp.handbrake) yaw *= 1.45;
    const grip = (inp.handbrake ? m.grip * 0.16 : m.grip) * surf;
    vs *= Math.exp(-grip * dt);
    v.slip = Math.abs(vs);
    v.h += (yaw + v.spin) * dt;
  } else {
    v.h += v.spin * dt;
    v.slip = 0;
  }
  v.spin *= Math.exp(-(v.airborne ? 0.8 : 4) * dt);
  v.vx = f.x * vl + rt.x * vs;
  v.vz = f.z * vl + rt.z * vs;

  const ox = v.x, oz = v.z;
  v.x += v.vx * dt;
  v.z += v.vz * dt;
  let g = heightAt(city, v.x, v.z);

  if (!v.airborne && !v.sinking) {
    if (g !== null && g > v.y + 0.65) {
      // too tall to drive up (the side of a ramp): stop like a wall
      v.x = ox; v.z = oz; v.vx *= -0.2; v.vz *= -0.2;
      g = heightAt(city, v.x, v.z);
    }
    if (g === null || g < v.y - 0.35) {
      v.airborne = true;
      v.airTime = 0;
      v.launch = { x: v.x, z: v.z };
    } else {
      v.vy = clamp((g - v.y) / dt, -5, 30);
      v.y = g;
    }
  }
  if (v.airborne) {
    v.vy -= GRAVITY * dt;
    v.y += v.vy * dt;
    v.airTime += dt;
    if (g !== null && v.y <= g) {
      const hard = -v.vy;
      v.y = g; v.vy = 0; v.airborne = false;
      if (hard > 10) v.health -= (hard - 10) * 2 / m.tough;
      events.push({ type: 'land', v, airTime: v.airTime, hard, from: v.launch });
    } else if (g === null && v.y < WATER_Y) {
      v.airborne = false;
      v.sinking = 0.001;
      events.push({ type: 'splash', v, airTime: v.airTime, from: v.launch });
    }
  }
  if (v.sinking) {
    v.sinking += dt;
    v.vx *= Math.exp(-2.5 * dt); v.vz *= Math.exp(-2.5 * dt);
    v.vy = -1.2;
    v.y = Math.max(WATER_Y - 3, v.y + v.vy * dt);
  }

  collideVehicleStatic(v, grid, (c, impact) => {
    if (c.kind === 'lamp' || c.kind === 'signal') events.push({ type: 'prop', v, c, impact });
    else if (impact > 3) {
      v.health -= ((impact - 3) * 2.2) / m.tough;
      events.push({ type: 'crash', v, impact, x: v.x, z: v.z });
    }
  });
  v.speed = Math.hypot(v.vx, v.vz);
  v.wheelSpin += (vl / 0.36) * dt;

  // Visual pitch and roll from the ground and from cornering.
  if (!v.airborne) {
    const half = m.wb / 2;
    const gf = heightAt(city, v.x + f.x * half, v.z + f.z * half) ?? v.y;
    const gb = heightAt(city, v.x - f.x * half, v.z - f.z * half) ?? v.y;
    v.pitch += (Math.atan2(gf - gb, m.wb) - v.pitch) * Math.min(1, dt * 12);
  } else {
    v.pitch += (clamp(-v.vy * 0.03, -0.5, 0.4) - v.pitch) * Math.min(1, dt * 2);
  }
  v.roll += (clamp(vs * 0.03, -0.12, 0.12) - v.roll) * Math.min(1, dt * 8);
  return events;
}
