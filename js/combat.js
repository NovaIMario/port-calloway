// Weapons and fights: what each gun does, hitscan bullets against people, cars and the city,
// fists, loot and pickups, and the player's loadout. Pure simulation with no rendering, so it
// runs and is tested in Node.
import { clamp, forwardOf, rightOf, mulberry32 } from './util.js';

export const WEAPONS = {
  fist: { id: 'fist', slot: 1, name: 'Fists', melee: true, dmg: 20, rate: 0.42, range: 1.6 },
  pistol: { id: 'pistol', slot: 2, name: 'Pistol', model: 'Kestrel 9 mm', dmg: 34, rate: 0.2, mag: 12, reload: 1.2, spread: 0.012, range: 90, start: 36, pack: 24, driveBy: true },
  smg: { id: 'smg', slot: 3, name: 'SMG', model: 'Squall', dmg: 19, rate: 0.085, auto: true, mag: 30, reload: 1.6, spread: 0.04, range: 70, start: 90, pack: 60, driveBy: true },
  shotgun: { id: 'shotgun', slot: 4, name: 'Shotgun', model: 'Breaker pump-action', dmg: 15, pellets: 8, rate: 0.8, mag: 6, reload: 2.1, spread: 0.075, range: 38, start: 18, pack: 12, twoHand: true },
  rifle: { id: 'rifle', slot: 5, name: 'Carbine', model: 'Gannet', dmg: 40, rate: 0.12, auto: true, mag: 30, reload: 1.9, spread: 0.016, range: 140, start: 90, pack: 60, twoHand: true },
};
export const WEAPON_ORDER = ['fist', 'pistol', 'smg', 'shotgun', 'rifle'];
export const GUNS = WEAPON_ORDER.filter((id) => !WEAPONS[id].melee);

const EPS = 1e-9;
const norm = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return { x: x / l, y: y / l, z: z / l }; };

// ---- rays ----

// Distance along a ray to an axis-aligned box, or -1. Starting inside counts as a hit at 0.
export function rayBox(o, d, x0, y0, z0, x1, y1, z1, maxT) {
  let t0 = 0, t1 = maxT, a, b, s;
  if (Math.abs(d.x) < EPS) { if (o.x < x0 || o.x > x1) return -1; } else {
    a = (x0 - o.x) / d.x; b = (x1 - o.x) / d.x; if (a > b) { s = a; a = b; b = s; }
    if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return -1;
  }
  if (Math.abs(d.y) < EPS) { if (o.y < y0 || o.y > y1) return -1; } else {
    a = (y0 - o.y) / d.y; b = (y1 - o.y) / d.y; if (a > b) { s = a; a = b; b = s; }
    if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return -1;
  }
  if (Math.abs(d.z) < EPS) { if (o.z < z0 || o.z > z1) return -1; } else {
    a = (z0 - o.z) / d.z; b = (z1 - o.z) / d.z; if (a > b) { s = a; a = b; b = s; }
    if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) return -1;
  }
  return t0;
}

// Distance along a ray to an upright cylinder (people, trees, lamp posts), or -1.
export function rayCylinder(o, d, cx, cz, r, y0, y1, maxT) {
  const ox = o.x - cx, oz = o.z - cz;
  const a = d.x * d.x + d.z * d.z;
  let tIn, tOut;
  if (a < EPS) {
    if (ox * ox + oz * oz > r * r) return -1;
    tIn = 0; tOut = maxT;
  } else {
    const b = ox * d.x + oz * d.z, c = ox * ox + oz * oz - r * r;
    const disc = b * b - a * c;
    if (disc < 0) return -1;
    const s = Math.sqrt(disc);
    tIn = (-b - s) / a; tOut = (-b + s) / a;
    if (tOut < 0) return -1;
  }
  if (Math.abs(d.y) < EPS) { if (o.y < y0 || o.y > y1) return -1; } else {
    let ya = (y0 - o.y) / d.y, yb = (y1 - o.y) / d.y;
    if (ya > yb) { const s = ya; ya = yb; yb = s; }
    if (ya > tIn) tIn = ya; if (yb < tOut) tOut = yb;
    if (tIn > tOut) return -1;
  }
  if (tIn < 0) tIn = 0;
  return tIn <= maxT ? tIn : -1;
}

// A standing person is a cylinder; someone lying down is a low, wide one round their middle.
export function rayPerson(o, d, p, maxT) {
  if (p.down > 0.5) {
    const f = forwardOf(p.h);
    return rayCylinder(o, d, p.x - f.x * 0.85, p.z - f.z * 0.85, 0.55, p.y - 0.1, p.y + 0.45, maxT);
  }
  return rayCylinder(o, d, p.x, p.z, 0.34, p.y, p.y + 1.85, maxT);
}

// A car is a box turned to its heading.
export function rayVehicle(o, d, v, maxT) {
  const f = forwardOf(v.h), rt = rightOf(v.h);
  const ox = o.x - v.x, oz = o.z - v.z;
  const lo = { x: ox * rt.x + oz * rt.z, y: o.y - v.y, z: ox * f.x + oz * f.z };
  const ld = { x: d.x * rt.x + d.z * rt.z, y: d.y, z: d.x * f.x + d.z * f.z };
  const hw = v.m.wid / 2, hl = v.m.len / 2;
  return rayBox(lo, ld, -hw, 0.2, -hl, hw, v.m.hgt, hl, maxT);
}

const scratch = [];
// The first thing a bullet meets: a person, a car, a building or prop, or the ground.
// Returns { t, kind, target, x, y, z } with kind null when it flies clear.
export function castRay(world, o, d, maxT, ignore = null, ignore2 = null) {
  let best = maxT, kind = null, target = null;
  const ex = o.x + d.x * maxT, ez = o.z + d.z * maxT;
  scratch.length = 0;
  world.grid.query(Math.min(o.x, ex), Math.min(o.z, ez), Math.max(o.x, ex), Math.max(o.z, ez), scratch);
  for (const c of scratch) {
    if (c.broken) continue;
    const t = c.type === 'box' ? rayBox(o, d, c.x0, -1, c.z0, c.x1, c.h, c.z1, best) : rayCylinder(o, d, c.x, c.z, c.r, -1, c.h, best);
    if (t >= 0 && t < best) { best = t; kind = 'static'; target = c; }
  }
  if (d.y < -EPS) {
    const t = (0.05 - o.y) / d.y;
    if (t >= 0 && t < best) { best = t; kind = 'ground'; target = null; }
  }
  for (const v of world.vehicles) {
    if (v === ignore || v === ignore2 || v.sinking > 1) continue;
    // cheap reject: how far the car is from the ray's line
    const vx = v.x - o.x, vz = v.z - o.z, along = vx * d.x + vz * d.z;
    if (along < -4 || along > best + 4) continue;
    const t = rayVehicle(o, d, v, best);
    if (t >= 0 && t < best) { best = t; kind = 'vehicle'; target = v; }
  }
  for (const p of world.peds) {
    if (p === ignore || p === ignore2) continue;
    const t = rayPerson(o, d, p, best);
    if (t >= 0 && t < best) { best = t; kind = 'ped'; target = p; }
  }
  const pl = world.player;
  if (pl !== ignore && pl !== ignore2 && !pl.hidden) {
    const t = rayPerson(o, d, pl, best);
    if (t >= 0 && t < best) { best = t; kind = 'player'; target = pl; }
  }
  return { t: best, kind, target, x: o.x + d.x * best, y: o.y + d.y * best, z: o.z + d.z * best };
}

// Is the straight line between two points at street level clear of buildings?
export function lineClear(world, x0, z0, x1, z1) {
  scratch.length = 0;
  world.grid.query(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), scratch);
  const o = { x: x0, y: 1.2, z: z0 };
  const len = Math.hypot(x1 - x0, z1 - z0) || 1;
  const d = { x: (x1 - x0) / len, y: 0, z: (z1 - z0) / len };
  for (const c of scratch) {
    if (c.type !== 'box' || c.h < 3) continue;
    if (rayBox(o, d, c.x0, -1, c.z0, c.x1, c.h, c.z1, len) >= 0) return false;
  }
  return true;
}

// ---- damage ----

// Hurt the player: body armour soaks up damage first.
export function hurtPlayer(world, dmg, by = null) {
  const p = world.player;
  if (p.health <= 0) return;
  const soak = Math.min(p.armour || 0, dmg);
  p.armour = (p.armour || 0) - soak;
  p.health -= dmg - soak;
  p.hurtT = 0;
  world.emit({ type: 'playerHurt', dmg, armour: soak, by });
}

// Hurt a person. At zero health they fall and stay down.
export function hurtPed(world, ped, dmg, dir, by = null, opts = {}) {
  if (ped.dead) { ped.vx += dir.x * 0.5; ped.vz += dir.z * 0.5; return; }
  ped.health -= dmg;
  ped.hitT = 0.3;
  if (ped.health <= 0) {
    Object.assign(ped, { health: 0, dead: true, down: Math.max(ped.down, 0.05), downTime: Infinity, state: 'dead', armsUp: false, aim: false, armed: false, punchT: 0 });
    ped.vx = dir.x * 1.8; ped.vz = dir.z * 1.8; ped.vy = 0.8;
    world.emit({ type: 'pedKilled', ped, by, weapon: opts.weapon, head: !!opts.head });
    return;
  }
  if (opts.knock) {
    ped.down = 1; ped.downTime = opts.knock;
    ped.vx = dir.x * 2.5; ped.vz = dir.z * 2.5; ped.vy = 2;
  }
  world.emit({ type: 'pedHurt', ped, by, weapon: opts.weapon, head: !!opts.head });
}

// Bullets dent cars; enough of them set one alight. A civilian under fire abandons the car.
export function shootVehicle(world, v, dmg, by = null) {
  v.health -= (dmg * 0.16) / v.m.tough;
  v.awake = true;
  if (v.ai?.kind === 'civilian' && by === world.player) v.ai.shot = true;
  world.emit({ type: 'carShot', v, by });
}

// Where a gun's muzzle is: in the right hand, held out in front.
export function muzzleOf(b) {
  const f = forwardOf(b.h), rt = rightOf(b.h);
  return { x: b.x + f.x * 0.55 + rt.x * 0.28, y: b.y + 1.42, z: b.z + f.z * 0.55 + rt.z * 0.28 };
}

// ---- the player's weapons ----

export class Combat {
  constructor(world, seed = 5) {
    this.world = world;
    this.r = mulberry32(seed);
    const p = world.player;
    Object.assign(p, { arms: p.arms || {}, weapon: p.weapon || 'fist', armour: p.armour || 0 });
    Object.assign(p, { fireT: 0, reloadT: 0, shotT: 0, punchT: 0, faceT: 0, faceH: 0, aiming: false, driveAim: false, hold: 0, hurtT: 99 });
  }

  owned() { const p = this.world.player; return WEAPON_ORDER.filter((id) => id === 'fist' || p.arms[id]); }

  // Add a gun (or rounds for one already owned). Returns the weapon's state.
  give(id, rounds) {
    const p = this.world.player, W = WEAPONS[id];
    const a = p.arms[id] || (p.arms[id] = { mag: 0, ammo: 0 });
    a.ammo += rounds ?? W.start;
    // an empty gun is loaded straight away (unless it is being reloaded right now)
    if (a.mag === 0 && !(p.weapon === id && p.reloadT > 0)) topUp(a, W);
    return a;
  }

  select(id) {
    const p = this.world.player;
    if (!id || (id !== 'fist' && !p.arms[id])) return false;
    if (p.weapon !== id) {
      p.weapon = id;
      p.reloadT = 0;
      p.fireT = Math.max(p.fireT, 0.2);
      this.world.emit({ type: 'weapon', id });
    }
    return true;
  }

  cycle(dir) {
    const list = this.owned(), p = this.world.player;
    const i = Math.max(0, list.indexOf(p.weapon));
    this.select(list[(i + dir + list.length) % list.length]);
  }

  reload() {
    const p = this.world.player, W = WEAPONS[p.weapon], a = p.arms[p.weapon];
    if (W.melee || !a || p.reloadT > 0 || a.mag >= W.mag || a.ammo <= 0) return false;
    p.reloadT = W.reload;
    this.world.emit({ type: 'reload', id: W.id });
    return true;
  }

  // c: this step's controls. aim: the camera's ray { o, d, free }, or null.
  update(dt, c, aim = null) {
    const w = this.world, p = w.player;
    for (const k of ['fireT', 'shotT', 'punchT', 'faceT']) p[k] = Math.max(0, p[k] - dt);
    p.hurtT += dt;
    // a little health comes back if you keep out of trouble
    if (p.hurtT > 6 && p.health > 0 && p.health < 50) p.health = Math.min(50, p.health + dt * 2);
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      if (p.reloadT <= 0) { p.reloadT = 0; const a = p.arms[p.weapon]; if (a) topUp(a, WEAPONS[p.weapon]); }
    }
    const alive = p.health > 0 && p.down === 0;
    if (alive) {
      if (c.slot) this.select(WEAPON_ORDER[c.slot - 1]);
      if (c.nextWeapon) this.cycle(1);
      if (c.prevWeapon) this.cycle(-1);
      if (c.reload) this.reload();
    }
    const W = WEAPONS[p.weapon];
    p.aiming = alive && !p.vehicle && !!c.aim && !W.melee;
    p.driveAim = alive && !!p.vehicle && !!c.aim && !!W.driveBy && !!p.arms[p.weapon];
    // semi-automatics fire once per click (a click just before the gun is ready still counts),
    // or slowly while the trigger is held
    p.hold = c.fire ? p.hold + dt : 0;
    p.queued = c.fireHit ? 0.25 : Math.max(0, (p.queued || 0) - dt);
    const pull = W.auto ? c.fire : p.queued > 0 || (c.fire && p.hold > W.rate * 2.2);
    if (alive && pull && p.fireT <= 0 && p.reloadT <= 0) {
      p.queued = 0;
      if (!p.vehicle) this.attack(aim);
      else if (p.driveAim) this.driveBy(aim);
    }
    this.loot();
    this.pickups(dt);
  }

  attack(aim) {
    const w = this.world, p = w.player, W = WEAPONS[p.weapon];
    const yaw = aim ? Math.atan2(aim.d.x, aim.d.z) : p.h;
    p.faceT = 0.7;
    if (W.melee) return this.punch(yaw);
    const a = p.arms[p.weapon];
    if (!this.ready(a)) return;
    a.mag--;
    p.fireT = W.rate; p.shotT = 0.6; p.hold = 0;
    let dir;
    if (aim && p.aiming && aim.free) {
      // free aim: shoot from the muzzle at whatever is under the crosshair
      p.h = p.faceH = yaw;
      const hit = castRay(w, aim.o, aim.d, W.range + 25, p);
      const m = muzzleOf(p);
      dir = norm(hit.x - m.x, hit.y - m.y, hit.z - m.z);
    } else {
      // aim assist: the best target roughly where the camera is pointing
      const tgt = this.autoTarget(yaw, W.range * 0.85, p.aiming ? 0.3 : 0.55);
      p.h = p.faceH = tgt ? Math.atan2(tgt.x - p.x, tgt.z - p.z) : yaw;
      const m = muzzleOf(p);
      dir = tgt ? norm(tgt.x - m.x, tgt.y - m.y, tgt.z - m.z) : norm(Math.sin(p.h), 0, Math.cos(p.h));
    }
    this.fire(W, muzzleOf(p), dir, p);
  }

  // Shooting out of a car window: pistol and SMG only, aimed through the crosshair.
  driveBy(aim) {
    const w = this.world, p = w.player, v = p.vehicle, W = WEAPONS[p.weapon], a = p.arms[p.weapon];
    if (!aim || !this.ready(a)) return;
    a.mag--;
    p.fireT = W.rate * 1.3; p.hold = 0;
    const hit = castRay(w, aim.o, aim.d, W.range + 25, v);
    const m = { x: v.x + aim.d.x * 0.6, y: v.y + v.m.hgt + 0.25, z: v.z + aim.d.z * 0.6 };
    this.fire(W, m, norm(hit.x - m.x, hit.y - m.y, hit.z - m.z), v, 1.8);
  }

  ready(a) {
    const w = this.world, p = w.player;
    if (a && a.mag > 0) return true;
    p.fireT = 0.3;
    if (a && a.ammo > 0) this.reload();
    else {
      // out of ammo: click, then switch to the best gun that still has some
      w.emit({ type: 'dry' });
      const next = [...GUNS].reverse().find((id) => { const s = p.arms[id]; return s && s.mag + s.ammo > 0; });
      this.select(next || 'fist');
    }
    return false;
  }

  fire(W, m, dir, ignore, spreadMul = 1) {
    const w = this.world, p = w.player;
    const spread = W.spread * spreadMul * (p.aiming ? 0.55 : 1) * (1 + Math.min(1.5, (p.vehicle ? p.vehicle.speed * 0.05 : p.speed * 0.25)));
    for (let k = 0; k < (W.pellets || 1); k++) {
      const d = norm(dir.x + (this.r() - 0.5) * 2 * spread, dir.y + (this.r() - 0.5) * 2 * spread, dir.z + (this.r() - 0.5) * 2 * spread);
      const hit = castRay(w, m, d, W.range, ignore, p);
      this.impact(hit, W, d);
      w.emit({ type: 'shot', by: p, weapon: W.id, x0: m.x, y0: m.y, z0: m.z, x1: hit.x, y1: hit.y, z1: hit.z, kind: hit.kind, tracer: k < 3 });
    }
    w.emit({ type: 'gunfire', by: p, weapon: W.id, x: p.x, z: p.z, mx: m.x, my: m.y, mz: m.z });
  }

  impact(hit, W, d) {
    const w = this.world;
    if (hit.kind === 'ped') {
      const ped = hit.target;
      const head = ped.down < 0.5 && hit.y > ped.y + 1.5;
      let dmg = W.dmg * (head ? 2.2 : 1);
      if (W.pellets) dmg *= clamp(1.3 - hit.t / W.range, 0.25, 1.1);
      hurtPed(w, ped, dmg, d, w.player, { weapon: W.id, head });
    } else if (hit.kind === 'vehicle') shootVehicle(w, hit.target, W.dmg, w.player);
  }

  punch(yaw) {
    const w = this.world, p = w.player;
    p.fireT = WEAPONS.fist.rate; p.punchT = 0.28;
    // turn to the nearest person in front, then swing
    const f = forwardOf(yaw);
    let best = null, bd = 1.9;
    for (const q of w.peds) {
      if (q.dead || q.down > 0.5 || Math.abs(q.y - p.y) > 1.2) continue;
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d > bd || d < 0.01 || (dx * f.x + dz * f.z) / d < 0.25) continue;
      best = q; bd = d;
    }
    p.h = p.faceH = best ? Math.atan2(best.x - p.x, best.z - p.z) : yaw;
    const reach = best && bd < WEAPONS.fist.range;
    w.emit({ type: 'punch', by: p, hit: !!reach, target: reach ? best : null, x: p.x, z: p.z });
    if (!reach) return;
    const dir = norm(best.x - p.x, 0, best.z - p.z);
    const knock = this.r() < 0.35 ? 1.4 : 0;
    hurtPed(w, best, WEAPONS.fist.dmg, dir, p, { weapon: 'fist', knock });
  }

  // The most sensible target near the middle of the screen with a clear line of fire.
  autoTarget(yaw, range, cone) {
    const w = this.world, p = w.player, f = forwardOf(yaw), minCos = Math.cos(cone);
    let best = null, bs = Infinity;
    for (const q of w.peds) {
      if (q.dead) continue;
      const dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz);
      if (d > range || d < 0.4) continue;
      const cos = (dx * f.x + dz * f.z) / d;
      if (cos < minCos) continue;
      const score = Math.acos(clamp(cos, -1, 1)) * 30 + d * (q.cop ? 0.4 : 1) - (q.aim ? 6 : 0) - (q.state === 'fight' ? 6 : 0);
      if (score < bs && lineClear(w, p.x, p.z, q.x, q.z)) { bs = score; best = q; }
    }
    return best ? { x: best.x, y: best.y + (best.down > 0.5 ? 0.3 : 1.25), z: best.z, who: best } : null;
  }

  // People who die drop what they had on them.
  loot() {
    const w = this.world;
    for (const e of w.events) {
      if (e.type !== 'pedKilled' || e.ped.looted) continue;
      const q = e.ped;
      q.looted = true;
      if (q.cop) w.pickups.push({ kind: 'weapon', weapon: 'pistol', amount: 12, x: q.x, y: q.y, z: q.z, life: 45 });
      else if (this.r() < 0.8) w.pickups.push({ kind: 'cash', amount: 5 + Math.floor(this.r() * 40), x: q.x, y: q.y, z: q.z, life: 45 });
    }
  }

  pickups(dt) {
    const w = this.world, p = w.player;
    for (let i = w.pickups.length - 1; i >= 0; i--) {
      const k = w.pickups[i];
      if (k.wait > 0) { k.wait -= dt; continue; }
      if (k.life !== undefined) { k.life -= dt; if (k.life <= 0) { w.pickups.splice(i, 1); continue; } }
      if (p.health <= 0 || (p.vehicle && k.kind !== 'cash')) continue;
      const reach = p.vehicle ? 2.6 : 1.3;
      if (Math.abs(k.x - p.x) > reach || Math.abs(k.z - p.z) > reach || Math.abs(k.y - p.y) > 2.2) continue;
      if (Math.hypot(k.x - p.x, k.z - p.z) > reach) continue;
      if (!this.collect(k)) continue;
      if (k.spot) k.wait = k.respawn ?? 120; else w.pickups.splice(i, 1);
    }
  }

  collect(k) {
    const w = this.world, p = w.player;
    if (k.kind === 'cash') p.cash += k.amount;
    else if (k.kind === 'weapon' || k.kind === 'ammo') {
      const had = !!p.arms[k.weapon];
      this.give(k.weapon, k.amount ?? WEAPONS[k.weapon].start);
      if (!had && p.weapon === 'fist') this.select(k.weapon);
    } else if (k.kind === 'armour') {
      if (p.armour >= 100) return false;
      p.armour = Math.min(100, p.armour + (k.amount ?? 100));
    } else if (k.kind === 'health') {
      if (p.health >= 100) return false;
      p.health = Math.min(100, p.health + (k.amount ?? 100));
    }
    w.emit({ type: 'pickup', k });
    return true;
  }
}

function topUp(a, W) {
  const n = Math.min(W.mag - a.mag, a.ammo);
  a.mag += n; a.ammo -= n;
}
