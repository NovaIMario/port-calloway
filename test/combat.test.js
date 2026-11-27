import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, heightAt } from '../js/citygen.js';
import { onRoad } from '../js/city.js';
import { World } from '../js/world.js';
import { Peds, makePerson } from '../js/peds.js';
import { Combat, castRay, hurtPlayer, WEAPONS } from '../js/combat.js';
import { mulberry32 } from '../js/util.js';

const city = generateCity();
const DT = 1 / 60;
const NONE = { fire: false, fireHit: false, aim: false };
const CLICK = { fire: true, fireHit: true };

// The player on the north-south avenue at x = 0, facing north (+z).
function setup(x = 3, z = 50) {
  const world = new World(city);
  world.spawnPlayer(x, z, 0);
  const combat = new Combat(world, 1);
  return { world, combat, p: world.player };
}

const rng = mulberry32(3);
function person(world, x, z, extra = {}) {
  const q = makePerson(rng, x, z, heightAt(city, x, z), { state: 'idle', ...extra });
  world.peds.push(q);
  return q;
}

function run(combat, seconds) {
  for (let t = 0; t < seconds; t += DT) combat.update(DT, NONE, null);
}
// Let the gun come up (or the last shot cycle), then pull the trigger once.
// The events from that one step are left in world.events.
function shoot(world, combat, c = CLICK, aim = null) {
  run(combat, 0.5);
  world.events.length = 0;
  combat.update(DT, c, aim);
}

test('bullets hit people and cars, and buildings stop them', () => {
  const { world, p } = setup();
  assert.ok(onRoad(city, 3, 60) && onRoad(city, 3, 75));
  const o = { x: 3, y: 1.4, z: 50 }, d = { x: 0, y: 0, z: 1 };
  const q = person(world, 3, 60);
  let hit = castRay(world, o, d, 100, p);
  assert.equal(hit.kind, 'ped');
  assert.ok(Math.abs(hit.t - (10 - 0.34)) < 0.01, `hit at ${hit.t}`);
  // without being told to ignore them, a ray starting inside the shooter hits the shooter
  assert.equal(castRay(world, o, d, 100).kind, 'player');
  world.peds.length = 0;
  const v = world.addVehicle('meridian', 3, 75, 0);
  hit = castRay(world, o, d, 100, p);
  assert.equal(hit.kind, 'vehicle');
  assert.equal(hit.target, v);
  assert.ok(Math.abs(hit.t - (25 - v.m.len / 2)) < 0.01);

  // someone standing behind a building is safe from a shot fired at the front of it
  const b = city.buildings.find((b) => b.h > 6 && b.x1 - b.x0 > 12 && b.z1 - b.z0 > 12);
  const mz = (b.z0 + b.z1) / 2;
  const behind = person(world, b.x1 + 1.5, mz);
  hit = castRay(world, { x: b.x0 - 4, y: 1.4, z: mz }, { x: 1, y: 0, z: 0 }, 200, p);
  assert.equal(hit.kind, 'static');
  assert.ok(hit.t <= 4.01);
  assert.notEqual(hit.target, behind);
  assert.equal(q.health, 100);
});

test('three pistol shots kill a pedestrian, who stays down', () => {
  const { world, combat, p } = setup();
  const peds = new Peds(world, 1);
  peds.target = 0;
  combat.give('pistol');
  assert.deepEqual(p.arms.pistol, { mag: 12, ammo: 24 });
  combat.select('pistol');
  const q = person(world, 3, 58);
  shoot(world, combat);
  shoot(world, combat);
  assert.ok(!q.dead && q.health > 0 && q.health < 50, `health ${q.health}`);
  shoot(world, combat);
  assert.ok(world.events.some((e) => e.type === 'pedKilled' && e.ped === q));
  assert.ok(q.dead);
  assert.equal(p.arms.pistol.mag, 9);
  for (let t = 0; t < 10; t += DT) peds.update(DT);
  assert.ok(q.dead && q.down === 1, 'got back up');
});

test('a click while the gun is not quite ready still fires', () => {
  const { combat, p } = setup();
  combat.give('pistol');
  combat.select('pistol'); // the gun takes 0.2 s to come up
  combat.update(DT, CLICK, null);
  assert.equal(p.arms.pistol.mag, 12);
  run(combat, 0.2);
  assert.equal(p.arms.pistol.mag, 11);
  run(combat, 1);
  assert.equal(p.arms.pistol.mag, 11, 'fired twice for one click');
});

test('an empty magazine reloads from the reserve, which takes time', () => {
  const { world, combat, p } = setup();
  combat.give('pistol');
  combat.select('pistol');
  for (let k = 0; k < 12; k++) shoot(world, combat);
  assert.equal(p.arms.pistol.mag, 0);
  shoot(world, combat); // click: starts the reload
  assert.ok(p.reloadT > 1);
  assert.equal(p.arms.pistol.mag, 0);
  run(combat, WEAPONS.pistol.reload + 0.1);
  assert.deepEqual(p.arms.pistol, { mag: 12, ammo: 12 });
  // R tops up a half-empty magazine
  shoot(world, combat);
  combat.update(DT, { reload: true }, null);
  run(combat, WEAPONS.pistol.reload + 0.1);
  assert.deepEqual(p.arms.pistol, { mag: 12, ammo: 11 });
  // a gun with nothing left clicks and swaps back to fists
  p.arms.pistol = { mag: 0, ammo: 0 };
  shoot(world, combat);
  assert.ok(world.events.some((e) => e.type === 'dry'));
  assert.equal(p.weapon, 'fist');
});

test('a shotgun is deadly up close and weak across the street', () => {
  const { world, combat } = setup();
  combat.give('shotgun', 30);
  combat.select('shotgun');
  const near = person(world, 3, 54);
  shoot(world, combat);
  assert.ok(near.dead, `near target on ${near.health.toFixed(0)}`);
  world.peds.length = 0;
  const far = person(world, 3, 82);
  shoot(world, combat);
  assert.ok(!far.dead && far.health > 40, `far target on ${far.health.toFixed(0)}`);
});

test('free aim goes where the crosshair points, and a headshot hurts more', () => {
  const { world, combat } = setup();
  combat.give('pistol');
  combat.select('pistol');
  const q = person(world, 3, 62);
  // the camera is behind the player and the crosshair is on the target's head
  const o = { x: 3, y: 1.9, z: 46 };
  const ray = (x, y, z) => { const d = { x: x - o.x, y: y - o.y, z: z - o.z }, l = Math.hypot(d.x, d.y, d.z); return { o, d: { x: d.x / l, y: d.y / l, z: d.z / l }, free: true }; };
  shoot(world, combat, { ...CLICK, aim: true }, ray(3, q.y + 1.72, 62));
  assert.ok(Math.abs(q.health - (100 - WEAPONS.pistol.dmg * 2.2)) < 0.01, `health ${q.health}`);
  assert.ok(world.events.some((e) => e.type === 'pedHurt' && e.head));
  // the chest of someone off to the side
  const r = person(world, -3, 62);
  shoot(world, combat, { ...CLICK, aim: true }, ray(-3, r.y + 1.1, 62));
  assert.ok(Math.abs(r.health - (100 - WEAPONS.pistol.dmg)) < 0.01, `health ${r.health}`);
  assert.equal(q.health, 100 - WEAPONS.pistol.dmg * 2.2, 'the first target was hit again');
});

test('fists: five punches put someone down for good', () => {
  const { world, combat, p } = setup();
  const q = person(world, 3, 51);
  for (let k = 0; k < 5; k++) {
    q.down = 0; q.x = 3; q.z = 51; // stand them back up in reach each time
    shoot(world, combat);
    assert.ok(world.events.some((e) => e.type === 'punch' && e.hit));
  }
  assert.ok(q.dead, `health ${q.health}`);
  assert.equal(p.weapon, 'fist');
});

test('shooting a car damages it and makes the driver bail out', () => {
  const { world, combat } = setup();
  combat.give('smg', 300);
  combat.select('smg');
  run(combat, 0.3);
  const v = world.addVehicle('meridian', 3, 62, Math.PI, { driver: 'npc' });
  v.ai = { kind: 'civilian' };
  for (let t = 0; t < 1.5; t += DT) combat.update(DT, { fire: true, fireHit: t === 0 }, null);
  assert.ok(v.health < 85, `health ${v.health.toFixed(1)}`);
  assert.ok(v.ai.shot);
});

test('pickups: cash, guns and armour; spots come back later', () => {
  const { world, combat, p } = setup();
  world.pickups.push({ kind: 'cash', amount: 40, x: p.x + 0.5, y: p.y, z: p.z });
  world.pickups.push({ kind: 'weapon', weapon: 'smg', amount: 60, x: p.x, y: p.y, z: p.z + 0.5, spot: true, respawn: 30 });
  world.pickups.push({ kind: 'armour', amount: 100, x: p.x, y: p.y, z: p.z - 0.5 });
  world.pickups.push({ kind: 'cash', amount: 99, x: p.x + 8, y: p.y, z: p.z }); // out of reach
  run(combat, 0.1);
  assert.equal(p.cash, 40);
  assert.ok(p.arms.smg && p.weapon === 'smg');
  assert.equal(p.arms.smg.mag + p.arms.smg.ammo, 60);
  assert.equal(p.armour, 100);
  assert.equal(world.pickups.length, 2, 'the spot stays, waiting');
  assert.ok(world.pickups.find((k) => k.spot).wait > 29);
  // armour soaks up damage before health does
  hurtPlayer(world, 30);
  assert.equal(p.armour, 70);
  assert.equal(p.health, 100);
  hurtPlayer(world, 90);
  assert.equal(p.armour, 0);
  assert.equal(p.health, 80);
});
