// Flying: the Skylark helicopter and the Gull light plane. Pure simulation, stepped by the world in
// place of the car physics. Same conventions as cars: heading h with forward = (sin h, cos h),
// positive pitch is nose up, positive roll puts the right side down (and turns right).
import { clamp, forwardOf, rightOf, wrapAngle } from './util.js';
import { GRAVITY, collideVehicleStatic, circleContact } from './physics.js';
import { heightAt } from './citygen.js';
import { WATER_Y } from './city.js';

export const BOUNDS = 1300; // past this far from the middle of the city, aircraft are turned back
const HELI_CEILING = 300, PLANE_CEILING = 650;
const scratch = [];

// What there is to stand or land on at (x, z): the ground, or the top of a building or a stack of
// containers no higher than y + step. null over open water.
export function floorAt(city, grid, x, z, y = Infinity, step = 0.6) {
  let f = heightAt(city, x, z);
  scratch.length = 0;
  grid.query(x, z, x, z, scratch);
  for (const c of scratch) {
    if (c.type !== 'box' || c.broken || c.kind === 'rail' || c.h > y + step) continue;
    if (x >= c.x0 && x <= c.x1 && z >= c.z0 && z <= c.z1 && (f === null || c.h > f)) f = c.h;
  }
  return f;
}

export function stepAircraft(v, dt, city, grid, events = []) {
  if (v.sinking) return sink(v, dt);
  if (v.m.air === 'heli') stepHeli(v, dt, city, grid, events);
  else stepPlane(v, dt, city, grid, events);
  // a long way out to sea: swing back towards the city
  const d = Math.hypot(v.x, v.z);
  if (d > BOUNDS && !v.grounded) {
    const home = Math.atan2(-v.x, -v.z);
    v.h += clamp(wrapAngle(home - v.h), -1, 1) * Math.min(1, (d - BOUNDS) / 150) * 0.8 * dt;
    v.turnBack = true;
  } else v.turnBack = false;
  v.alt = v.y - (floorAt(city, grid, v.x, v.z) ?? WATER_Y);
  return events;
}

function sink(v, dt) {
  v.sinking += dt;
  v.rotor = Math.max(0, v.rotor - dt);
  v.vx *= Math.exp(-2.5 * dt); v.vz *= Math.exp(-2.5 * dt);
  v.vy = -1.2;
  v.x += v.vx * dt; v.z += v.vz * dt;
  v.y = Math.max(WATER_Y - 3, v.y + v.vy * dt);
  v.speed = Math.hypot(v.vx, v.vz);
}

function ditch(v, events) {
  v.sinking = 0.001;
  v.grounded = false;
  events.push({ type: 'splash', v });
}

// Hitting the ground or water from the air. Returns true if it touched down.
function touchdown(v, fl, events, soft) {
  if (fl === null) {
    if (v.y <= WATER_Y + 0.4) { v.y = WATER_Y + 0.4; ditch(v, events); return true; }
    return false;
  }
  if (v.y > fl) return false;
  v.y = fl;
  if (!v.grounded) {
    v.grounded = true;
    const hard = soft(-v.vy);
    if (hard > 0) {
      v.health -= hard / v.m.tough;
      events.push({ type: 'crash', v, impact: Math.min(40, hard * 0.4 + 4), x: v.x, z: v.z });
    }
  }
  if (v.vy < 0) v.vy = 0;
  return true;
}

// The helicopter: Space climbs and Shift descends (it holds its height otherwise), W and S tilt it
// forward and back, A and D turn it. The rotor takes a couple of seconds to run up to speed.
function stepHeli(v, dt, city, grid, events) {
  const m = v.m, inp = v.input;
  const crew = !!v.driver && v.health > 0;
  v.rotor = clamp(v.rotor + (crew ? 0.45 : -0.2) * dt, 0, 1);
  v.blade = (v.blade + v.rotor * 38 * dt) % (Math.PI * 2);
  const power = v.rotor * v.rotor; // share of full lift
  const ctl = crew ? clamp((v.rotor - 0.6) / 0.4, 0, 1) : 0; // the controls come alive as it spools up
  const fwd = clamp(inp.fwd || 0, -1, 1) * ctl, turn = clamp(inp.yaw || 0, -1, 1) * ctl, lift = clamp(inp.lift || 0, -1, 1) * ctl;
  const f = forwardOf(v.h), rt = rightOf(v.h);
  let vf = v.vx * f.x + v.vz * f.z, vs = v.vx * rt.x + v.vz * rt.z;

  const yawT = -turn * m.steer * (1 - 0.35 * Math.min(1, Math.abs(vf) / m.top));
  v.spin += (yawT - v.spin) * Math.min(1, dt * 4);
  v.h += v.spin * dt;

  // vertical: hold height, or climb and descend on command; without lift it drops. Close to the
  // ground (or a roof) the descent eases off, so holding descend still sets it down gently.
  let vyT = lift > 0 ? lift * 8 : lift * 9;
  if (v.y > HELI_CEILING - 40) vyT = Math.min(vyT, Math.max(0, (HELI_CEILING - v.y) / 40) * 8);
  const below = v.y - (floorAt(city, grid, v.x, v.z, v.y) ?? WATER_Y);
  if (vyT < 0) vyT = Math.max(vyT, -(1.6 + below * 0.75));
  v.vy += (power * (GRAVITY + 2.5 * (vyT - v.vy)) - GRAVITY) * dt;

  // horizontal: tilt to go forward or back; sideways drift dies away so turns carve
  if (!v.grounded) {
    const vfT = fwd * (fwd >= 0 ? m.top : m.top * 0.35);
    const a = (fwd !== 0 ? m.accel : m.accel * 0.6) * Math.max(0.2, power);
    vf += clamp(vfT - vf, -a * dt, a * dt);
    vs *= Math.exp(-1.5 * dt);
  } else {
    vf *= Math.exp(-6 * dt); vs *= Math.exp(-6 * dt);
  }
  v.vx = f.x * vf + rt.x * vs;
  v.vz = f.z * vf + rt.z * vs;
  v.x += v.vx * dt; v.z += v.vz * dt; v.y += v.vy * dt;

  // walls: a glancing knock hurts, flying into one at speed brings it down
  collideVehicleStatic(v, grid, (c, impact) => {
    if (c.kind === 'lamp' || c.kind === 'signal') { events.push({ type: 'prop', v, c, impact }); return; }
    if (impact > 4) {
      v.health -= ((impact - 4) * 6) / m.tough;
      events.push({ type: 'crash', v, impact, x: v.x, z: v.z });
    }
  });

  const fl = floorAt(city, grid, v.x, v.z, v.y);
  // a gentle landing is free; coming down faster than 6 m/s hurts, and on its side it is a wreck
  touchdown(v, fl, events, (sink) => Math.max(0, sink - 6) * 9 + (Math.abs(v.roll) > 0.6 ? 60 : 0));
  if (v.grounded && fl !== null && v.y > fl + 0.05) v.grounded = false;

  // looks: the nose dips to speed up and lifts to slow down; it banks into turns
  const vfT = fwd * (fwd >= 0 ? m.top : m.top * 0.35);
  const pitchT = v.grounded ? 0 : clamp(-0.14 * fwd - (vfT - vf) * 0.006, -0.38, 0.3);
  const rollT = v.grounded ? 0 : clamp(-v.spin * Math.min(1, Math.abs(vf) / 12) * 0.35 + vs * 0.02, -0.45, 0.45);
  v.pitch += (pitchT - v.pitch) * Math.min(1, dt * 3);
  v.roll += (rollT - v.roll) * Math.min(1, dt * 3);
  v.speed = Math.hypot(v.vx, v.vz);
  v.slip = 0;
}

// The plane: W opens the throttle and S closes it (and brakes on the ground); let go of both and it
// settles at cruise power in the air. A and D bank it into a turn, Space pulls the nose up and Shift
// pushes it down. It flies where it points, unless it is too slow, when the wings stall.
function stepPlane(v, dt, city, grid, events) {
  const m = v.m, inp = v.input;
  const crew = !!v.driver && v.health > 0;
  const thrT = !crew ? 0 : inp.throttle > 0 ? 1 : inp.brake > 0 ? 0 : v.grounded ? 0 : 0.55;
  v.thr += clamp(thrT - v.thr, -0.6 * dt, 0.6 * dt);
  v.rotor = crew ? Math.max(0.3, v.thr) : Math.max(0, v.rotor - 0.5 * dt);
  v.blade = (v.blade + v.rotor * 45 * dt) % (Math.PI * 2);
  const bank = crew ? clamp(inp.bank || 0, -1, 1) : 0, pull = crew ? clamp(inp.pitch || 0, -1, 1) : 0;
  const drag = m.thrust / (m.top * m.top);
  const flying = clamp((v.s / m.stall) ** 2, 0, 1); // share of the weight the wings carry
  const authority = clamp((v.s - 8) / (m.vr - 8), 0, 1); // the control surfaces need airflow

  if (v.grounded) {
    // rolling on its wheels: steer with the nose wheel, brake with S
    const rolling = surfaceDrag(city, v);
    v.s += (m.thrust * v.thr - drag * v.s * v.s - rolling - (inp.brake > 0 && crew ? 7 * inp.brake : 0)) * dt;
    v.s = Math.max(0, v.s);
    v.h += -bank * 0.9 * clamp(v.s / 5, 0, 1) / (1 + v.s / 20) * dt;
    v.roll += (0 - v.roll) * Math.min(1, dt * 6);
    // pull back once it is fast enough and the nose comes up
    if (pull > 0 && v.s > m.vr * 0.92) v.pitch = Math.min(0.3, v.pitch + pull * 0.35 * dt);
    else v.pitch += (0 - v.pitch) * Math.min(1, dt * 5);
    v.w = 0;
  } else {
    v.roll += (bank * 0.9 * Math.max(0.3, authority) - v.roll) * Math.min(1, dt * 2.2);
    v.h += (-GRAVITY * Math.tan(v.roll) * 1.15 / Math.max(v.s, 15)) * dt;
    let rate = pull * 0.45 * authority;
    // too slow: the nose drops and it sinks until it has the speed to fly again
    if (flying < 1) rate -= (1 - flying) * 0.9;
    if (v.y > PLANE_CEILING - 50) rate = Math.min(rate, (PLANE_CEILING - v.y) / 50 * 0.4);
    v.pitch = clamp(v.pitch + rate * dt, -1.3, 1.2);
    v.s += (m.thrust * v.thr - drag * v.s * v.s - GRAVITY * Math.sin(v.pitch)) * dt;
    v.s = Math.max(0, v.s);
    v.w = flying < 1 ? v.w - GRAVITY * (1 - flying) * dt : v.w * Math.exp(-2 * dt);
    v.w *= Math.exp(-0.3 * dt);
  }
  const f = forwardOf(v.h);
  const climb = v.grounded ? Math.max(0, v.pitch) : v.pitch;
  v.vx = f.x * v.s * Math.cos(climb);
  v.vz = f.z * v.s * Math.cos(climb);
  v.vy = v.grounded && v.pitch < 0.12 ? 0 : v.s * Math.sin(climb) + v.w;
  if (v.grounded && v.vy > 0.5) v.grounded = false; // off the ground
  v.x += v.vx * dt; v.z += v.vz * dt; v.y += v.vy * dt;

  // anything solid: the body, or a wing tip clipping a wall or a tree
  let hit = 0;
  collideVehicleStatic(v, grid, (c, impact) => {
    if (c.kind === 'lamp' || c.kind === 'signal') { events.push({ type: 'prop', v, c, impact }); return; }
    hit = Math.max(hit, impact);
  });
  const tip = wingStrike(v, grid);
  if (tip) hit = Math.max(hit, v.s * 0.8);
  if (hit > 3) {
    v.health -= hit > 14 ? 200 : (hit * 5) / m.tough;
    v.s *= hit > 14 ? 0.25 : 0.6;
    if (tip) v.spin += tip * 1.2;
    events.push({ type: 'crash', v, impact: hit, x: v.x, z: v.z });
  } else if (hit > 0) v.s *= 0.5; // nosing into a wall while taxiing
  v.h += v.spin * dt;
  v.spin *= Math.exp(-3 * dt);

  const fl = floorAt(city, grid, v.x, v.z, v.y);
  const wasFlying = !v.grounded, before = v.health;
  // a landing needs a gentle sink rate, wings level and the nose not pointing at the ground
  const landed = touchdown(v, fl, events, (sinkRate) => {
    const bad = Math.max(0, sinkRate - 4.5) * 10 + Math.max(0, Math.abs(v.roll) - 0.35) * 120 + Math.max(0, -v.pitch - 0.2) * 150;
    return bad > 0 ? bad + 15 : 0;
  });
  if (landed && wasFlying && !v.sinking) {
    v.pitch = Math.max(0, Math.min(v.pitch, 0.2)); v.w = 0;
    if (v.health < before) v.s *= 0.5; // a heavy landing
  }
  if (v.grounded && fl !== null && v.y > fl + 0.05) v.grounded = false;
  if (v.grounded) v.wheelSpin += (v.s / 0.3) * dt;
  v.speed = Math.hypot(v.vx, v.vy, v.vz);
  v.slip = 0;
}

function surfaceDrag(city, v) {
  const s = city.surfaceAt?.(v.x, v.z);
  return s === 'grass' ? 1.2 : s === 'sand' ? 2.5 : 0.35;
}

// A wing tip inside something taller than it is: -1 (left) or 1 (right), else 0.
function wingStrike(v, grid) {
  const rt = rightOf(v.h), half = v.m.span / 2;
  for (const side of [-1, 1]) {
    const x = v.x + rt.x * side * half * Math.cos(v.roll), z = v.z + rt.z * side * half * Math.cos(v.roll);
    const y = v.y + v.m.wingY - side * Math.sin(v.roll) * half;
    scratch.length = 0;
    grid.query(x - 0.5, z - 0.5, x + 0.5, z + 0.5, scratch);
    for (const c of scratch) {
      if (c.broken || c.h < y || c.kind === 'lamp' || c.kind === 'signal') continue;
      if (circleContact(x, z, 0.3, c)) return side;
    }
  }
  return 0;
}
