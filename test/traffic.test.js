import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, signalState } from '../js/citygen.js';
import { World } from '../js/world.js';
import { Traffic } from '../js/traffic.js';

const city = generateCity();
const DT = 1 / 60;

function setup() {
  const world = new World(city);
  const traffic = new Traffic(world, 1);
  traffic.target = 0;
  world.spawnPlayer(0, 0, 0);
  world.player.health = 1e9;
  return { world, traffic };
}

function step(world, traffic, follow) {
  if (follow) { world.player.x = follow.x + 40; world.player.z = follow.z + 40; }
  traffic.update(DT);
  world.stepVehicles(DT);
  world.time += DT;
  world.events.length = 0;
}

test('a car follows its lanes through junctions for two minutes', () => {
  const { world, traffic } = setup();
  const lane = traffic.net.lanes.find((l) => l.axis === 'x' && l.from < l.to);
  const v = world.addVehicle('meridian', lane.sx, lane.sz, Math.atan2(lane.dx, lane.dz), { driver: 'npc' });
  traffic.attach(v, lane, 0);
  let travelled = 0, maxOff = 0, px = v.x, pz = v.z;
  const lanesSeen = new Set();
  for (let t = 0; t < 120; t += DT) {
    step(world, traffic, v);
    travelled += Math.hypot(v.x - px, v.z - pz); px = v.x; pz = v.z;
    const ai = v.ai;
    assert.ok(ai, `lost its driver at t=${t.toFixed(1)}`);
    lanesSeen.add(ai.lane.id);
    const q = ai.pts[ai.i - 1], n = ai.pts[ai.i];
    if (q && n && !n.turn && !q.turn) {
      const sx = n.x - q.x, sz = n.z - q.z, l = Math.hypot(sx, sz) || 1;
      maxOff = Math.max(maxOff, Math.abs(((v.x - q.x) * sz - (v.z - q.z) * sx) / l));
    }
  }
  assert.ok(travelled > 600, `only travelled ${travelled.toFixed(0)} m`);
  assert.ok(lanesSeen.size >= 5, `only used ${lanesSeen.size} lanes`);
  assert.ok(maxOff < 2, `strayed ${maxOff.toFixed(2)} m from its lane`);
  assert.ok(v.health > 95, 'crashed into something');
});

test('a car waits at a red light and goes on green', () => {
  const { world, traffic } = setup();
  const lane = traffic.net.lanes.find((l) => city.nodes[l.to].signal && l.len > 80);
  // start when this approach has just turned red
  let t0 = 0;
  while (!(signalState(city, lane.to, lane.axis, t0) === 'r' && signalState(city, lane.to, lane.axis, t0 - 0.5) !== 'r')) t0 += 0.25;
  world.time = t0;
  const v = world.addVehicle('corso', lane.sx, lane.sz, Math.atan2(lane.dx, lane.dz), { driver: 'npc' });
  traffic.attach(v, lane, 0.3);
  let stoppedAt = null;
  for (let t = 0; t < 11; t += DT) {
    step(world, traffic, v);
    if (v.speed < 0.3 && stoppedAt === null && t > 2) stoppedAt = { x: v.x, z: v.z };
  }
  assert.ok(stoppedAt, 'never stopped');
  const beyond = (stoppedAt.x - lane.ex) * lane.dx + (stoppedAt.z - lane.ez) * lane.dz;
  assert.ok(beyond < 0.5 && beyond > -12, `stopped ${beyond.toFixed(1)} m from the line`);
  for (let t = 0; t < 16; t += DT) step(world, traffic, v);
  assert.ok(v.speed > 3 || v.ai.lane.id !== lane.id, 'did not move off on green');
});

test('a queue of cars does not crash into each other', () => {
  const { world, traffic } = setup();
  const lane = traffic.net.lanes.find((l) => city.nodes[l.to].signal && l.len > 80);
  const cars = [];
  for (let k = 0; k < 4; k++) {
    const v = world.addVehicle('meridian', 0, 0, Math.atan2(lane.dx, lane.dz), { driver: 'npc' });
    const t = 0.05 + k * 0.17;
    v.x = lane.sx + (lane.ex - lane.sx) * t; v.z = lane.sz + (lane.ez - lane.sz) * t;
    traffic.attach(v, lane, t);
    cars.push(v);
  }
  for (let t = 0; t < 60; t += DT) step(world, traffic, cars[0]);
  for (const v of cars) assert.ok(v.health > 90, `a car took ${(100 - v.health).toFixed(0)} damage`);
});
