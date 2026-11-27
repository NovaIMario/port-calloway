import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../js/citygen.js';
import { createVehicle, stepVehicle, buildStaticGrid, MODELS } from '../js/physics.js';
import { SpatialGrid } from '../js/util.js';

const city = generateCity();
const grid = buildStaticGrid(city);
const empty = new SpatialGrid(20);
const DT = 1 / 60;

function run(v, seconds, input, g = empty, events = []) {
  Object.assign(v.input, input);
  for (let t = 0; t < seconds; t += DT) stepVehicle(v, DT, city, g, events);
  return events;
}

// The west ring road (x = -500) is a straight run of a kilometre.
const onRing = (model = 'meridian') => createVehicle(model, -500, -450, 0);

test('full throttle accelerates towards, but never past, top speed', () => {
  const v = onRing();
  run(v, 4, { throttle: 1 });
  assert.ok(v.speed > 20, `only ${v.speed.toFixed(1)} m/s after 4 s`);
  run(v, 20, { throttle: 1 });
  assert.ok(v.speed <= MODELS.meridian.top + 0.01);
  assert.ok(Math.abs(v.x + 500) < 0.5, 'drifted sideways on a straight road');
});

test('braking stops the car, then holding the brake reverses', () => {
  const v = onRing();
  run(v, 3, { throttle: 1 });
  const z0 = v.z;
  let stoppedAt = null;
  Object.assign(v.input, { throttle: 0, brake: 1 });
  for (let t = 0; t < 4; t += DT) {
    stepVehicle(v, DT, city, empty);
    if (stoppedAt === null && v.speed < 0.6) stoppedAt = v.z;
  }
  assert.ok(stoppedAt !== null && stoppedAt - z0 < 30, 'did not stop within 30 m');
  assert.ok(v.z < stoppedAt, 'did not reverse');
});

test('steering right turns right', () => {
  const v = onRing(); // facing +z, so its right is -x
  run(v, 1.5, { throttle: 1 });
  run(v, 1, { throttle: 0.5, steer: 1 });
  assert.ok(v.x < -500.5, `x=${v.x.toFixed(2)}`);
  assert.ok(v.h < 0);
});

test('the handbrake lets the back slide out', () => {
  const grip = onRing(), slide = onRing();
  for (const v of [grip, slide]) run(v, 3, { throttle: 1 });
  run(grip, 0.6, { throttle: 0, steer: 1 });
  run(slide, 0.6, { throttle: 0, steer: 1, handbrake: true });
  assert.ok(slide.slip > grip.slip * 2, `slip ${slide.slip.toFixed(2)} vs ${grip.slip.toFixed(2)}`);
});

test('a wall stops the car, pushes it out and damages it', () => {
  const g = new SpatialGrid(20);
  const wall = { type: 'box', x0: -510, x1: -490, z0: -400, z1: -390, h: 10, kind: 'building' };
  g.insert(wall, wall.x0, wall.z0, wall.x1, wall.z1);
  const v = onRing();
  const ev = run(v, 6, { throttle: 1 }, g);
  assert.ok(v.z < -400, `went through the wall: z=${v.z.toFixed(1)}`);
  assert.ok(v.health < 100);
  assert.ok(ev.some((e) => e.type === 'crash'));
});

test('the Canal Leap clears the water when fast and ends in a splash when slow', () => {
  const ramp = city.ramps.find((r) => r.name === 'Canal Leap');
  const attempt = (speed) => {
    const v = createVehicle('vireo', ramp.x - 60, ramp.z, Math.PI / 2);
    v.vx = speed;
    const ev = run(v, 6, { throttle: 1 }, grid);
    return ev.find((e) => e.type === 'land' || e.type === 'splash');
  };
  const fast = attempt(44);
  assert.equal(fast?.type, 'land');
  assert.ok(fast.v.x > 285, `landed at x=${fast.v.x.toFixed(0)}`);
  assert.ok(fast.airTime > 1);
  assert.equal(attempt(14)?.type, 'splash');
});

test('running into a parked car stops you; a moving car knocks you over', async () => {
  const { World } = await import('../js/world.js');
  const world = new World(city);
  const C = (o = {}) => ({ moveX: 0, moveY: 0, throttle: 0, brake: 0, steer: 0, handbrake: false, lift: 0, ...o });
  world.spawnPlayer(-500, -440, 0);
  const car = world.addVehicle('meridian', -500, -450, 0, {});
  const p = world.player;
  // sprint south (the camera faces -z) straight into the car's nose
  for (let t = 0; t < 2.5; t += DT) world.update(DT, C({ moveY: 1, sprint: true }), Math.PI);
  assert.equal(p.down, 0, 'still on your feet');
  assert.ok(p.z > car.z + car.m.len / 2, 'and stopped at the bumper');
  // now the car comes at you
  world.spawnPlayer(-500, -432, 0);
  Object.assign(car, { x: -500, z: -440, s: 12, speed: 12, vx: 0, vz: 12 });
  let knocked = false;
  for (let t = 0; t < 2 && !knocked; t += DT) { world.update(DT, C(), 0); knocked = p.down > 0; }
  assert.ok(knocked, 'a car at speed knocks you down');
});
