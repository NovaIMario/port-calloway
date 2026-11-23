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

test('out of sight for long enough, the heat drops away', () => {
  const { world, police } = setup(3, 50);
  police.setLevel(1);
  police.spawnUnit = () => null; // nobody comes looking
  let t = 0;
  for (; t < 30 && police.level > 0; t += DT) { world.update(DT, IDLE, 0); world.events.length = 0; }
  assert.equal(police.level, 0);
  assert.ok(t > 8 && t < 12, `lost the heat after ${t.toFixed(1)} s`);
});
