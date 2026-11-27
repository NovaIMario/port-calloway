import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../js/citygen.js';
import { onRoad } from '../js/city.js';
import { World } from '../js/world.js';
import { Traffic } from '../js/traffic.js';
import { Police, levelFor, LEVELS } from '../js/police.js';

const city = generateCity();
const DT = 1 / 60;
const IDLE = { moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, handbrake: false, sprint: false, jump: false, enter: false };

function setup(x, z) {
  const world = new World(city);
  const traffic = new Traffic(world, 1);
  traffic.target = 0;
  const police = new Police(world, traffic, 3);
  world.systems.push(traffic, police);
  world.spawnPlayer(x, z, 0);
  return { world, police };
}

test('heat levels follow the points table', () => {
  assert.equal(levelFor(0), 0);
  assert.equal(levelFor(1), 1);
  assert.equal(levelFor(LEVELS[3]), 3);
  assert.equal(levelFor(1e6), 5);
});

test('police drive through the streets to a player on foot and arrest them', () => {
  const { world, police } = setup(3, 50);
  assert.ok(onRoad(city, 3, 50));
  police.setLevel(2);
  let arrested = null, closest = Infinity;
  for (let t = 0; t < 90 && arrested === null; t += DT) {
    world.update(DT, IDLE, 0);
    for (const v of police.units()) closest = Math.min(closest, Math.hypot(v.x - world.player.x, v.z - world.player.z));
    for (const e of world.events) if (e.type === 'arrested') arrested = t;
    world.events.length = 0;
  }
  assert.ok(arrested !== null, `no arrest; closest unit got to ${closest.toFixed(1)} m`);
});

test('at three bars officers get out of their cars and open fire', () => {
  const { world, police } = setup(3, 50);
  // one car, just up the avenue
  assert.ok(onRoad(city, 3, 90));
  police.spawnUnit = () => null;
  const v = world.addVehicle('interceptor', 3, 90, Math.PI, { driver: 'npc', locked: true });
  v.ai = { kind: 'police', pts: [], i: 1, cruise: 30, replan: 0, stuck: 0, reverse: 0 };
  police.setLevel(3);
  let shots = 0, hits = 0, out = 0;
  for (let t = 0; t < 30 && hits < 2; t += DT) {
    world.update(DT, IDLE, 0);
    for (const e of world.events) {
      if (e.type === 'copsOut') out++;
      if (e.type === 'shot' && e.by?.cop) shots++;
      if (e.type === 'playerHurt') hits++;
      if (e.type === 'arrested') police.bust = 0;
    }
    world.events.length = 0;
  }
  assert.ok(out > 0, 'nobody got out');
  assert.ok(shots > 0 && hits > 0, `${shots} shots, ${hits} hits`);
  assert.ok(world.player.health < 100);
  // the car waits where it stopped while its crew is out
  assert.ok(v.ai.deployed);
  const x = v.x, z = v.z;
  for (let t = 0; t < 10; t += DT) { world.player.health = 100; world.update(DT, IDLE, 0); world.events.length = 0; }
  assert.ok(Math.hypot(v.x - x, v.z - z) < 1, `the empty police car rolled ${Math.hypot(v.x - x, v.z - z).toFixed(1)} m`);
});

test('violence in front of the police brings armed officers at two bars', () => {
  const { world, police } = setup(3, 50);
  const v = world.addVehicle('interceptor', 3, 75, Math.PI, { driver: 'npc' });
  v.ai = { kind: 'patrol' };
  const victim = { x: 3, z: 58, cop: false };
  police.report({ type: 'gunfire', by: world.player, x: 3, z: 50 });
  police.report({ type: 'pedKilled', by: world.player, ped: victim });
  assert.ok(police.level >= 2, `level ${police.level}`);
  assert.ok(police.armed());
  police.clear();
  assert.equal(police.level, 0);
  assert.ok(!police.armed());
});

test('out of sight for long enough, the heat drops away', () => {
  const { world, police } = setup(3, 50);
  police.setLevel(1);
  police.spawnUnit = () => null; // nobody comes looking
  let t = 0;
  for (; t < 30 && police.level > 0; t += DT) { world.update(DT, IDLE, 0); world.events.length = 0; }
  assert.equal(police.level, 0);
  assert.ok(t > 8 && t < 12, `lost the heat after ${t.toFixed(1)} s`);
});
