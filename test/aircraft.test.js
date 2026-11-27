import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, RUNWAY, HELIPADS } from '../js/citygen.js';
import { World } from '../js/world.js';
import { floorAt } from '../js/aircraft.js';
import { wrapAngle } from '../js/util.js';

const city = generateCity();
const DT = 1 / 60;
const ZC = (RUNWAY.z0 + RUNWAY.z1) / 2;
const C = (o = {}) => ({ moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, handbrake: false, lift: 0, ...o });

// Step the world with the same controls held; returns every event on the way.
function run(world, secs, c = {}, until = null) {
  const events = [];
  for (let t = 0; t < secs; t += DT) {
    world.update(DT, C(c), 0);
    events.push(...world.events);
    world.events.length = 0;
    if (until?.()) break;
  }
  return events;
}

// Walk up to one of the aircraft waiting at (x, z) and climb in.
function board(world, model, x, z) {
  world.spawnPlayer(x, z + 4, 0);
  world.streamParked();
  const v = world.vehicles.find((q) => q.model === model && Math.hypot(q.x - x, q.z - z) < 1);
  run(world, DT, { enter: true });
  return v;
}

// Put the player at the controls of an aircraft that is already in the air.
function airborne(world, model, x, z, extra) {
  world.spawnPlayer(x, z, 0);
  run(world, DT); // let the parked cars round here appear first
  const v = world.addVehicle(model, x, z, extra.h ?? 0, { grounded: false, rotor: 1, ...extra });
  Object.assign(world.player, { vehicle: v, hidden: true, y: v.y });
  v.driver = 'player';
  return v;
}

test('planes wait at the airstrip and helicopters at the heliport, unlocked and in the clear', () => {
  const world = new World(city);
  world.spawnPlayer(RUNWAY.x0, ZC + 10, 0);
  world.streamParked();
  const planes = world.vehicles.filter((v) => v.model === 'gull');
  assert.equal(planes.length, 2);
  for (const v of planes) {
    assert.ok(!v.locked && v.grounded);
    assert.ok(Math.abs(v.h - Math.PI / 2) < 1e-9, 'lined up with the runway');
  }
  // nothing a wing tip could catch on the apron and the runway
  for (const c of city.colliders) {
    const x0 = c.type === 'box' ? c.x0 : c.x - c.r, x1 = c.type === 'box' ? c.x1 : c.x + c.r;
    const z0 = c.type === 'box' ? c.z0 : c.z - c.r, z1 = c.type === 'box' ? c.z1 : c.z + c.r;
    const clear = x1 < RUNWAY.x0 - 45 || x0 > RUNWAY.x1 || z1 < RUNWAY.z0 - 6 || z0 > RUNWAY.z1 + 6;
    assert.ok(clear, `${c.kind} by the runway at ${x0.toFixed(0)},${z0.toFixed(0)}`);
  }
  for (let x = RUNWAY.x0 - 40; x <= RUNWAY.x1; x += 5) assert.equal(floorAt(city, world.grid, x, ZC), 0.15);
  world.spawnPlayer(HELIPADS[0].x, HELIPADS[0].z + 12, 0);
  world.streamParked();
  const helis = world.vehicles.filter((v) => v.model === 'skylark');
  assert.equal(helis.length, 2);
  assert.ok(helis.every((v) => !v.locked && v.grounded));
});

test('the helicopter runs up its rotor, climbs, hovers, flies and sets down gently', () => {
  const world = new World(city);
  const pad = HELIPADS[0];
  const heli = board(world, 'skylark', pad.x, pad.z);
  assert.equal(world.player.vehicle, heli);
  run(world, 1, { lift: 1 });
  assert.ok(heli.grounded && heli.rotor < 0.6, 'it only lifts off once the rotor is up to speed');
  run(world, 7, { lift: 1 });
  assert.ok(!heli.grounded && heli.y > 30, `climbed to ${heli.y.toFixed(1)} m`);
  const y = heli.y;
  run(world, 2);
  assert.ok(Math.abs(heli.y - y) < 4, 'holds its height with nothing pressed');
  const z0 = heli.z;
  run(world, 6, { moveY: 1 }); // it faces the city, to the north
  assert.ok(heli.speed > 35 && heli.z < z0 - 100, `speed ${heli.speed.toFixed(1)}, ${(z0 - heli.z).toFixed(0)} m`);
  const h = heli.h;
  run(world, 1, { steer: 1 });
  assert.ok(wrapAngle(heli.h - h) < -0.5, 'D turns it to the right');
  run(world, 4);
  assert.ok(heli.speed < 15, 'it slows down when you let go');
  const down = run(world, 30, { lift: -1 }, () => heli.grounded);
  assert.ok(heli.grounded);
  assert.equal(heli.health, 100, 'holding descend all the way down still lands softly');
  assert.ok(!down.some((e) => e.type === 'crash'));
  run(world, DT, { enter: true });
  const p = world.player;
  assert.equal(p.vehicle, null);
  assert.ok(Math.abs(p.y - heli.y) < 0.7 && Math.hypot(p.x - heli.x, p.z - heli.z) < 6.5, 'stepped out beside it');
});

test('a helicopter can set you down on a roof, and you can walk about up there', () => {
  const world = new World(city);
  const roof = city.colliders.find((c) => c.kind === 'building' && c.type === 'box' && c.h > 20 && c.h < 60 && c.x1 - c.x0 > 26 && c.z1 - c.z0 > 26);
  const cx = (roof.x0 + roof.x1) / 2, cz = (roof.z0 + roof.z1) / 2;
  assert.equal(floorAt(city, world.grid, cx, cz), roof.h);
  const heli = airborne(world, 'skylark', cx, cz, { y: roof.h + 25 });
  run(world, 30, { lift: -1 }, () => heli.grounded);
  assert.ok(heli.grounded && Math.abs(heli.y - roof.h) < 1e-6 && heli.health === 100, `landed at ${heli.y.toFixed(2)}`);
  run(world, DT, { enter: true });
  const p = world.player;
  assert.ok(!p.vehicle && Math.abs(p.y - roof.h) < 1e-6, `standing at ${p.y.toFixed(2)}, the roof is at ${roof.h.toFixed(2)}`);
  run(world, 1.5, { moveY: 1 });
  assert.ok(p.grounded && Math.abs(p.y - roof.h) < 1e-6, 'still up on the roof after a walk');
});

test('jumping out high up opens a parachute: you float down unhurt, and the empty helicopter falls', () => {
  const world = new World(city);
  const heli = airborne(world, 'skylark', -40, -300, { y: 90 }); // over Ferris Park
  run(world, 0.5);
  run(world, DT, { enter: true });
  const p = world.player;
  assert.ok(!p.vehicle && p.chute > 0, 'the parachute opened');
  const events = run(world, 40, {}, () => p.grounded && !p.chute);
  assert.ok(p.grounded && !p.chute, 'down on the ground');
  assert.equal(p.health, 100);
  assert.ok(events.some((e) => e.type === 'chuteLand'));
  assert.ok(events.some((e) => e.type === 'crash' && e.v === heli), 'the helicopter came down hard');
  assert.ok(events.some((e) => e.type === 'explode' && e.v === heli), 'and went up');
});

test('a long fall opens the parachute by itself', () => {
  const world = new World(city);
  world.spawnPlayer(-40, -300, 0);
  Object.assign(world.player, { y: 70, grounded: false });
  const events = run(world, 30, {}, () => world.player.grounded);
  assert.ok(events.some((e) => e.type === 'chute'));
  assert.equal(world.player.health, 100);
});

test('the plane takes off from the airstrip, climbs and banks round', () => {
  const world = new World(city);
  const plane = board(world, 'gull', RUNWAY.x0 + 12, ZC);
  assert.equal(world.player.vehicle, plane);
  const x0 = plane.x;
  run(world, 10, { throttle: 1 }, () => plane.s > 21);
  assert.ok(plane.grounded && plane.s > 21, 'up to take-off speed');
  assert.ok(plane.x - x0 < 80, `a short take-off run: ${(plane.x - x0).toFixed(0)} m`);
  run(world, 1, { throttle: 1, lift: 1 });
  run(world, 8, { throttle: 1 });
  assert.ok(!plane.grounded && plane.y > 30 && plane.health === 100, `climbed to ${plane.y.toFixed(0)} m`);
  let turned = 0, prev = plane.h;
  for (let i = 0; i < 12; i++) {
    run(world, 0.25, { steer: 1 });
    turned += wrapAngle(plane.h - prev);
    prev = plane.h;
  }
  assert.ok(plane.roll > 0.6, 'banked');
  assert.ok(turned < -0.9 && turned > -2.5, `came round to the right by ${turned.toFixed(2)} rad in 3 s`);
  run(world, 3);
  assert.ok(Math.abs(plane.roll) < 0.15, 'the wings level out when you let go');
});

test('a gentle approach puts the plane down on the runway, and S brakes it to a stop', () => {
  const world = new World(city);
  const plane = airborne(world, 'gull', RUNWAY.x0 + 60, ZC, { h: Math.PI / 2, y: 9, s: 32, thr: 0.3, rotor: 0.6, pitch: -0.07 });
  const events = run(world, 12, {}, () => plane.grounded);
  assert.ok(plane.grounded, 'touched down');
  assert.equal(plane.health, 100);
  assert.ok(!events.some((e) => e.type === 'crash'));
  assert.ok(plane.x < RUNWAY.x1 - 100, `on the runway at x ${plane.x.toFixed(0)}`);
  run(world, 15, { brake: 1 }, () => plane.s < 0.05);
  assert.ok(plane.s < 0.05 && plane.grounded);
  assert.ok(plane.x < RUNWAY.x1 && Math.abs(plane.z - ZC) < 1, 'stopped before the end of the runway');
});

test('flying into a tower wrecks the plane', () => {
  const world = new World(city);
  const tower = city.colliders.find((c) => c.kind === 'building' && c.type === 'box' && c.h > 60);
  const z = (tower.z0 + tower.z1) / 2;
  const plane = airborne(world, 'gull', tower.x0 - 120, z, { h: Math.PI / 2, y: 30, s: 45, thr: 0.6, rotor: 0.6 });
  const events = run(world, 8, {}, () => plane.health <= 0);
  assert.ok(plane.health <= 0);
  assert.ok(events.some((e) => e.type === 'crash' && e.v === plane));
});
