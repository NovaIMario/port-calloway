// The simulation: the player on foot or driving, every vehicle, and the systems that hang off
// them (traffic, pedestrians, police, missions). No rendering here.
import { buildStaticGrid, createVehicle, stepVehicle, collideVehicles, circleContact, GRAVITY } from './physics.js';
import { heightAt } from './citygen.js';
import { clamp, wrapAngle, forwardOf, rightOf, hash2, dist2 } from './util.js';
import { areaName } from './city.js';

export const CIVILIAN_MODELS = ['corso', 'corso', 'meridian', 'meridian', 'meridian', 'ranger', 'tasker', 'haulmark', 'cab', 'vireo'];
export const CAR_PAINT = [0xc8ccd2, 0x2b2f36, 0xf2f2ef, 0x9c1f24, 0x1f4e8c, 0x5a6b4a, 0x8a8f98, 0xd7a43b, 0x3c6e71, 0x6d2e46, 0xe0dccf, 0x23395b];
export const paintFor = (model, k) => (model === 'cab' ? 0xf2c230 : model === 'interceptor' ? 0xf4f4f4 : model === 'armored' ? 0x3f4a3a : CAR_PAINT[Math.floor(k * CAR_PAINT.length) % CAR_PAINT.length]);

const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;

export class World {
  constructor(city) {
    this.city = city;
    this.grid = buildStaticGrid(city);
    this.vehicles = [];
    this.peds = [];
    this.events = [];
    this.time = 0;
    this.tod = 17.6;
    this.daySpeed = 24 / (16 * 60); // a full day takes 16 minutes
    this.spawnedSpots = new Map();
    this.streamTimer = 0;
    this.systems = [];
    this.player = {
      x: 0, y: 0, z: 0, h: 0, vx: 0, vz: 0, vy: 0, speed: 0, grounded: true, vehicle: null,
      health: 100, swing: 0, phase: 0, down: 0, downTime: 0, hidden: false, cash: 0, area: '', bail: 0,
    };
    this.messages = [];
  }

  spawnPlayer(x, z, h) {
    const p = this.player;
    Object.assign(p, { x, z, h, vx: 0, vz: 0, vy: 0, y: heightAt(this.city, x, z) ?? 0, vehicle: null, hidden: false, down: 0, health: 100 });
  }

  addVehicle(model, x, z, h, opts = {}) {
    const v = createVehicle(model, x, z, h, { y: heightAt(this.city, x, z) ?? 0, ...opts });
    this.vehicles.push(v);
    this.emit({ type: 'vehicleAdded', v });
    return v;
  }

  removeVehicle(v) {
    const i = this.vehicles.indexOf(v);
    if (i < 0) return;
    this.vehicles.splice(i, 1);
    if (v.spot !== undefined) this.spawnedSpots.delete(v.spot);
    this.emit({ type: 'vehicleRemoved', v });
  }

  emit(e) { this.events.push(e); }
  say(text, seconds = 3) { this.emit({ type: 'notice', text, seconds }); }

  update(dt, c, camYaw) {
    this.time += dt;
    this.tod = (this.tod + dt * this.daySpeed) % 24;
    const p = this.player;
    if (c.enter) this.toggleVehicle();
    if (p.vehicle) this.drive(p.vehicle, c);
    else this.walk(dt, c, camYaw);
    for (const s of this.systems) s.update?.(dt, c);
    this.stepVehicles(dt);
    if (p.vehicle) {
      p.x = p.vehicle.x; p.z = p.vehicle.z; p.y = p.vehicle.y; p.h = p.vehicle.h; p.speed = p.vehicle.speed;
      if (p.vehicle.sinking > 1.2) this.escapeWater(p.vehicle);
    }
    this.streamTimer -= dt;
    if (this.streamTimer <= 0) { this.streamTimer = 0.7; this.streamParked(); p.area = areaName(this.city, p.x, p.z); }
  }

  drive(v, c) {
    v.input.throttle = c.throttle;
    v.input.brake = c.brake;
    v.input.steer = c.steer;
    v.input.handbrake = c.handbrake;
    v.horn = c.horn;
  }

  walk(dt, c, camYaw) {
    const p = this.player, city = this.city;
    if (p.down > 0) {
      p.downTime -= dt;
      if (p.downTime <= 0) p.down = Math.max(0, p.down - dt * 2.5);
      p.vx *= Math.exp(-3 * dt); p.vz *= Math.exp(-3 * dt);
    } else {
      const f = forwardOf(camYaw), r = rightOf(camYaw);
      let mx = f.x * c.moveY + r.x * c.moveX, mz = f.z * c.moveY + r.z * c.moveX;
      const len = Math.hypot(mx, mz);
      if (len > 1) { mx /= len; mz /= len; }
      const top = c.sprint ? 7.4 : 3.3;
      const k = 1 - Math.exp(-(p.grounded ? 12 : 2) * dt);
      p.vx += (mx * top - p.vx) * k;
      p.vz += (mz * top - p.vz) * k;
      if (len > 0.1) p.h = lerpAngle(p.h, Math.atan2(mx, mz), 1 - Math.exp(-14 * dt));
      if (c.jump && p.grounded) { p.vy = 6.2; p.grounded = false; }
    }
    // Move one axis at a time so walls and water edges can be slid along.
    for (const axis of ['x', 'z']) {
      const nx = axis === 'x' ? p.x + p.vx * dt : p.x, nz = axis === 'z' ? p.z + p.vz * dt : p.z;
      const g = heightAt(city, nx, nz);
      if (g === null || g > p.y + 0.6) { if (axis === 'x') p.vx = 0; else p.vz = 0; continue; }
      p.x = nx; p.z = nz;
    }
    const g = heightAt(city, p.x, p.z) ?? p.y;
    p.vy -= GRAVITY * dt;
    p.y += p.vy * dt;
    if (p.y <= g) { p.y = g; p.vy = 0; p.grounded = true; } else if (p.y > g + 0.05) p.grounded = false;
    const near = this.grid.query(p.x - 1, p.z - 1, p.x + 1, p.z + 1);
    for (const col of near) {
      if (col.broken || p.y > col.h) continue;
      const hit = circleContact(p.x, p.z, 0.35, col);
      if (hit) { p.x += hit.nx * hit.depth; p.z += hit.nz * hit.depth; }
    }
    // Vehicles: get pushed out of parked ones, knocked down by moving ones.
    for (const v of this.vehicles) {
      if (Math.abs(v.y - p.y) > 2 || dist2(v.x, v.z, p.x, p.z) > 16) continue;
      const f = forwardOf(v.h), rt = rightOf(v.h);
      const dx = p.x - v.x, dz = p.z - v.z;
      const u = dx * f.x + dz * f.z, s = dx * rt.x + dz * rt.z;
      const hl = v.m.len / 2 + 0.35, hw = v.m.wid / 2 + 0.35;
      if (Math.abs(u) > hl || Math.abs(s) > hw) continue;
      const rel = Math.hypot(v.vx - p.vx, v.vz - p.vz);
      if (rel > 4.5 && p.down === 0) this.knockDown(p, v.vx, v.vz, rel, v);
      const pu = hl - Math.abs(u), ps = hw - Math.abs(s);
      if (pu < ps) { p.x += f.x * Math.sign(u) * pu; p.z += f.z * Math.sign(u) * pu; }
      else { p.x += rt.x * Math.sign(s) * ps; p.z += rt.z * Math.sign(s) * ps; }
    }
    p.speed = Math.hypot(p.vx, p.vz);
    p.phase += p.speed * dt * 2.3;
    p.swing = Math.sin(p.phase) * Math.min(1, p.speed / 3) * 0.75;
  }

  knockDown(who, vx, vz, impact, by = null) {
    who.down = 1;
    who.downTime = 1.3 + impact * 0.05;
    who.vx = vx * 0.7; who.vz = vz * 0.7;
    who.vy = Math.min(7, impact * 0.35);
    who.grounded = false;
    who.health -= impact * 3.5;
    this.emit({ type: 'knock', who, impact, by });
  }

  nearestEnterable(maxDist = 3.6) {
    const p = this.player;
    let best = null, bd = Infinity;
    for (const v of this.vehicles) {
      if (v.wrecked || v.sinking || v.locked) continue;
      const d = Math.hypot(v.x - p.x, v.z - p.z) - v.m.len * 0.35;
      if (d < maxDist && d < bd && Math.abs(v.y - p.y) < 2) { bd = d; best = v; }
    }
    return best;
  }

  toggleVehicle() {
    const p = this.player;
    if (p.vehicle) return this.exitVehicle();
    if (p.down > 0) return;
    const v = this.nearestEnterable();
    if (!v) return;
    if (v.driver && v.driver !== 'player') {
      const d = v.driver;
      v.driver = null;
      this.emit({ type: 'jack', v, driver: d });
    } else if (v.parked && !v.owned) this.emit({ type: 'steal', v });
    v.driver = 'player';
    v.parked = false;
    v.ai = null;
    v.everDriven = true;
    p.vehicle = v;
    p.hidden = true;
    this.emit({ type: 'enter', v });
  }

  exitVehicle() {
    const p = this.player, v = p.vehicle;
    const rt = rightOf(v.h);
    const off = v.m.wid / 2 + 0.7;
    let placed = false;
    for (const side of [-1, 1]) {
      const x = v.x + rt.x * off * side, z = v.z + rt.z * off * side;
      const g = heightAt(this.city, x, z);
      if (g === null) continue;
      const blocked = this.grid.query(x - 0.5, z - 0.5, x + 0.5, z + 0.5).some((c) => !c.broken && c.h > g + 0.5 && circleContact(x, z, 0.35, c));
      if (blocked) continue;
      p.x = x; p.z = z; p.y = g; placed = true;
      break;
    }
    if (!placed) { p.x = v.x; p.z = v.z; p.y = v.y + v.m.hgt; }
    p.h = v.h;
    p.vx = v.vx * 0.6; p.vz = v.vz * 0.6; p.vy = 0;
    if (v.speed > 8) this.knockDown(p, v.vx * 0.6, v.vz * 0.6, Math.min(v.speed * 0.5, 9));
    v.driver = null;
    v.input.throttle = v.input.brake = v.input.steer = 0;
    v.input.handbrake = false;
    v.horn = false;
    p.vehicle = null;
    p.hidden = false;
    this.emit({ type: 'exit', v });
  }

  escapeWater(v) {
    const p = this.player;
    this.exitVehicle();
    // swim to the nearest bit of land
    let best = null;
    for (let rr = 4; rr < 120 && !best; rr += 4) {
      for (let a = 0; a < 16; a++) {
        const x = v.x + Math.sin(a / 16 * Math.PI * 2) * rr, z = v.z + Math.cos(a / 16 * Math.PI * 2) * rr;
        const g = heightAt(this.city, x, z);
        if (g !== null) { best = { x, z, g }; break; }
      }
    }
    if (best) { p.x = best.x; p.z = best.z; p.y = best.g; p.down = 0; }
    v.wrecked = true;
    this.emit({ type: 'sunk', v });
  }

  stepVehicles(dt) {
    const vs = this.vehicles;
    for (const v of vs) {
      if (!v.driver && !v.ai && v.speed < 0.02 && !v.airborne && !v.sinking && !v.awake) continue;
      v.awake = false;
      if (!v.driver && !v.ai) { v.input.throttle = 0; v.input.brake = v.speed > 0.5 ? 0.15 : 0; v.input.steer = 0; v.input.handbrake = false; }
      stepVehicle(v, dt, this.city, this.grid, this.events);
      if (v.health <= 0 && !v.wrecked && !v.burning) { v.burning = 4.5; this.emit({ type: 'fire', v }); }
      if (v.burning) {
        v.burning -= dt;
        if (v.burning <= 0) { v.burning = 0; v.wrecked = true; v.health = 0; this.emit({ type: 'explode', v }); }
      }
    }
    for (let i = 0; i < vs.length; i++) {
      for (let j = i + 1; j < vs.length; j++) {
        const a = vs[i], b = vs[j];
        const reach = (a.m.len + b.m.len) / 2 + 0.5;
        if (Math.abs(a.x - b.x) > reach || Math.abs(a.z - b.z) > reach) continue;
        const impact = collideVehicles(a, b);
        if (impact > 0) {
          a.awake = b.awake = true;
          if (impact > 3) {
            const dmg = (impact - 3) * 2;
            a.health -= dmg / a.m.tough; b.health -= dmg / b.m.tough;
            this.emit({ type: 'carHit', a, b, impact, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 });
          }
        }
      }
    }
  }

  // Parked cars appear in car parks near the player and vanish when far away.
  streamParked() {
    const p = this.player;
    const R = 140, MAX_PARKED = 36;
    const wanted = [];
    this.city.parking.forEach((s, i) => {
      if (Math.abs(s.x - p.x) > R || Math.abs(s.z - p.z) > R) return;
      const k = hash2(Math.round(s.x), Math.round(s.z), 3);
      if (!s.police && !s.wreck && k > 0.33) return;
      wanted.push([Math.hypot(s.x - p.x, s.z - p.z), i, k]);
    });
    wanted.sort((a, b) => a[0] - b[0]);
    const keep = new Set(wanted.slice(0, MAX_PARKED).map((w) => w[1]));
    for (const [i, v] of this.spawnedSpots) {
      if (!keep.has(i) && v.parked && !v.everDriven && v !== p.vehicle && Math.hypot(v.x - p.x, v.z - p.z) > 60) this.removeVehicle(v);
    }
    wanted.slice(0, MAX_PARKED).forEach(([, i, k]) => {
      const s = this.city.parking[i];
      if (this.spawnedSpots.has(i)) return;
      const model = s.police ? 'interceptor' : CIVILIAN_MODELS[Math.floor(hash2(i, 7) * CIVILIAN_MODELS.length)];
      const v = this.addVehicle(model, s.x, s.z, s.h + (k - 0.25) * 0.1, { color: s.wreck ? 0x6b5a4a : paintFor(model, hash2(i, 11)), parked: true, spot: i });
      if (s.wreck) { v.health = 25; v.locked = true; }
      if (s.police) v.locked = true;
      this.spawnedSpots.set(i, v);
    });
    for (const v of [...this.vehicles]) {
      if (v === p.vehicle || v.mission || v.driver === 'player') continue;
      const far = Math.abs(v.x - p.x) > R + 80 || Math.abs(v.z - p.z) > R + 80;
      if (far && (v.parked || v.wrecked || (!v.driver && !v.ai))) this.removeVehicle(v);
    }
  }
}
