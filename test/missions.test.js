import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity } from '../js/citygen.js';
import { onRoad } from '../js/city.js';
import { MISSIONS, MissionRunner, ROAD_TEST, GRAND_PRIX } from '../js/missions.js';

const city = generateCity();

test('race and errand routes run along roads', () => {
  for (const [x, z] of [...ROAD_TEST, ...GRAND_PRIX]) assert.ok(onRoad(city, x, z), `(${x}, ${z}) is off the road`);
});

test('every mission start and destination exists', () => {
  for (const m of MISSIONS) {
    assert.ok(city.pois[m.start], m.start);
    for (const s of m.steps) if (typeof s.at === 'string') assert.ok(city.pois[s.at], s.at);
  }
});

// A stand-in for the game: the player teleports, cars are plain objects.
function fakeCtx() {
  const player = { x: 0, z: 0, vehicle: null };
  let heat = 0;
  const log = [];
  const car = (name) => ({ x: 0, z: 0, health: 100, m: { name } });
  const starter = car('Corso');
  return {
    player: () => player, log, starter,
    point: (id, road) => (typeof id === 'object' ? id : road ? city.pois[id].road : city.pois[id]),
    banner: (a, b) => log.push(`banner:${a}`), say() {}, objective() {}, markers() {}, timer() {}, checkpoint() {},
    reward: (c) => log.push(`reward:${c}`), completed: (m) => log.push(`done:${m.id}`), releaseVehicle() {}, endRace() {},
    spawnVehicle: (model, x, z) => Object.assign(car(model), { x, z }),
    setHeat: (l) => { heat = l; }, heat: () => heat, clearHeat: () => { heat = 0; },
    namedVehicle: (k) => (k === 'starter' ? starter : null),
    startRace() {}, racePlace: () => 1, raceFinishedBy: () => 0, startFollow() {}, followArrived: () => true,
  };
}

test('Homecoming and Road Test play through to the end', () => {
  const ctx = fakeCtx();
  const run = new MissionRunner(ctx);
  const p = ctx.player();
  const go = (x, z) => { p.x = x; p.z = z; if (p.vehicle) { p.vehicle.x = x; p.vehicle.z = z; } run.update(0.1); };
  const f = city.pois.ferry;
  p.x = f.x; p.z = f.z;
  run.start(run.startable(p.x, p.z));
  assert.equal(run.active.m.id, 'homecoming');
  p.vehicle = ctx.starter; run.update(0.1);
  const g = city.pois.garage.road;
  go(g.x, g.z);
  assert.ok(run.done.has('homecoming'));
  assert.deepEqual(run.available().map((m) => m.id), ['roadtest']);

  const gp = city.pois.garage;
  assert.equal(run.startable(gp.x, gp.z)?.id, 'roadtest');
  run.start(run.startable(gp.x, gp.z));
  p.vehicle = run.vehicle('vireo'); run.update(0.1);
  for (const [x, z] of ROAD_TEST) go(x, z);
  go(g.x, g.z);
  assert.ok(run.done.has('roadtest'), ctx.log.join(' '));
  assert.ok(ctx.log.includes('reward:600'));
});

test('a job fails when the timer runs out or the car is wrecked', () => {
  const ctx = fakeCtx();
  const run = new MissionRunner(ctx);
  run.done.add('homecoming');
  run.start(MISSIONS.find((m) => m.id === 'roadtest'));
  ctx.player().vehicle = run.vehicle('vireo'); run.update(0.1);
  for (let t = 0; t < 160 && run.active; t += 0.5) run.update(0.5);
  assert.equal(run.active, null);
  assert.ok(!run.done.has('roadtest'));

  run.start(MISSIONS.find((m) => m.id === 'roadtest'));
  run.vehicle('vireo').health = 0;
  run.update(0.1);
  assert.equal(run.active, null);
  assert.ok(ctx.log.includes('banner:Job failed'));
});
