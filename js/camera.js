// Third-person camera: a chase camera in vehicles, an orbit camera on foot, and an
// over-the-shoulder view while aiming. It pulls in when a building is between it and the player.
import * as THREE from 'three';
import { clamp, wrapAngle, forwardOf, rightOf } from './util.js';

const MODES = [
  { dist: 7.2, height: 2.4, look: 1.3 },
  { dist: 11, height: 3.6, look: 1.5 },
  { dist: 4.6, height: 1.7, look: 1.1 },
];

const lerpAngle = (a, b, t) => a + wrapAngle(b - a) * t;

export class CameraRig {
  constructor(camera, grid) {
    this.camera = camera;
    this.grid = grid;
    this.yaw = 0;
    this.pitch = 0.32;
    this.mode = 0;
    this.manual = 0;
    this.idle = 10;
    this.pos = new THREE.Vector3(0, 30, 0);
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.scratch = [];
    this.aimPitch = 0;
    this.dir = new THREE.Vector3();
  }

  snap() { this.snapNext = true; }

  // Where the middle of the screen points: what a free-aimed shot hits.
  aimRay(device = 'keyboard') {
    const d = this.camera.getWorldDirection(this.dir), o = this.camera.position;
    return { o: { x: o.x, y: o.y, z: o.z }, d: { x: d.x, y: d.y, z: d.z }, free: device === 'keyboard' };
  }

  update(dt, player, c) {
    const v = player.vehicle;
    const desired = new THREE.Vector3(), look = new THREE.Vector3();
    const hasLook = Math.abs(c.lookX) + Math.abs(c.lookY) > 0.0005;
    if (hasLook) this.idle = 0; else this.idle += dt;
    let clipFrom = look, rate = v ? 12 : 14, lookRate = 18;
    if (v) {
      const M = MODES[this.mode];
      if (hasLook) { this.manual = wrapAngle(this.manual - c.lookX); this.pitch = clamp(this.pitch + c.lookY, -0.1, 0.9); }
      // shooting out of the window: the camera stays where you point it
      if (this.idle > 1.2 && !player.driveAim) { this.manual *= Math.exp(-3 * dt); this.pitch += (0.2 - this.pitch) * (1 - Math.exp(-2 * dt)); }
      let base = v.h;
      const vl = v.vx * Math.sin(v.h) + v.vz * Math.cos(v.h);
      if (v.speed > 4 && vl > 0) base = lerpAngle(v.h, Math.atan2(v.vx, v.vz), 0.45);
      const target = base + this.manual + (c.lookBack ? Math.PI : 0);
      this.yaw = c.lookBack || this.snapNext ? target : lerpAngle(this.yaw, target, 1 - Math.exp(-5 * dt));
      const dist = M.dist * (1 + Math.min(v.speed, 60) / 160) + v.m.len * 0.35;
      const f = forwardOf(this.yaw);
      const ph = this.pitch;
      desired.set(v.x - f.x * dist * Math.cos(ph * 0.6), v.y + M.height + dist * Math.sin(ph * 0.6) * 0.6, v.z - f.z * dist * Math.cos(ph * 0.6));
      look.set(v.x + f.x * 2.5, v.y + M.look + v.m.hgt * 0.3, v.z + f.z * 2.5);
      const fov = 64 + Math.min(14, v.speed * 0.28);
      if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3); this.camera.updateProjectionMatrix(); }
    } else {
      if (hasLook) { this.yaw = wrapAngle(this.yaw - c.lookX); this.pitch = clamp(this.pitch + c.lookY, -0.5, 1.2); }
      const moving = Math.abs(c.moveX) + Math.abs(c.moveY) > 0 && player.speed > 1;
      let fov = 62;
      if (player.aiming) {
        // over the right shoulder, looking where the gun points
        const ap = (this.aimPitch = clamp(this.pitch - 0.3, -0.75, 0.85));
        const f = forwardOf(this.yaw), rt = rightOf(this.yaw);
        const dir = this.dir.set(f.x * Math.cos(ap), -Math.sin(ap), f.z * Math.cos(ap));
        const shoulder = new THREE.Vector3(player.x + rt.x * 0.85, player.y + 1.72, player.z + rt.z * 0.85);
        desired.copy(shoulder).addScaledVector(dir, -2.9);
        look.copy(shoulder).addScaledVector(dir, 12);
        clipFrom = shoulder;
        rate = 26; lookRate = 40; fov = 55;
      } else {
        if (this.idle > 2 && moving && c.moveY >= 0) this.yaw = lerpAngle(this.yaw, player.h, 1 - Math.exp(-1.2 * dt));
        const dist = 4.6;
        const f = forwardOf(this.yaw);
        desired.set(
          player.x - f.x * dist * Math.cos(this.pitch),
          player.y + 1.6 + dist * Math.sin(this.pitch),
          player.z - f.z * dist * Math.cos(this.pitch),
        );
        look.set(player.x, player.y + 1.45, player.z);
      }
      if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * (player.aiming ? 10 : 3)); this.camera.updateProjectionMatrix(); }
    }
    this.clip(clipFrom, desired);
    if (desired.y < -1) desired.y = -1;
    if (this.snapNext) { this.pos.copy(desired); this.look.copy(look); this.snapNext = false; }
    this.pos.lerp(desired, 1 - Math.exp(-rate * dt));
    this.look.lerp(look, 1 - Math.exp(-lookRate * dt));
    this.camera.position.copy(this.pos);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 2);
    }
    this.camera.lookAt(this.look);
  }

  // Shorten the camera ray if it passes through a building.
  clip(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const list = this.scratch;
    list.length = 0;
    this.grid.query(Math.min(from.x, to.x) - 1, Math.min(from.z, to.z) - 1, Math.max(from.x, to.x) + 1, Math.max(from.z, to.z) + 1, list);
    let best = 1;
    for (const c of list) {
      if (c.type !== 'box' || c.h < 2.5) continue;
      let t0 = 0, t1 = 1, ok = true;
      for (const [o, d, lo, hi] of [[from.x, dx, c.x0 - 0.3, c.x1 + 0.3], [from.y, dy, -10, c.h + 0.3], [from.z, dz, c.z0 - 0.3, c.z1 + 0.3]]) {
        if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { ok = false; break; } continue; }
        let a = (lo - o) / d, b = (hi - o) / d;
        if (a > b) [a, b] = [b, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        if (t0 > t1) { ok = false; break; }
      }
      if (ok && t0 < best) best = t0;
    }
    if (best < 1) {
      const t = Math.max(0.08, best - 0.04);
      to.set(from.x + dx * t, from.y + dy * t, from.z + dz * t);
    }
  }
}
