import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, heightAt, signalState } from '../js/citygen.js';
import { onRoad, isWater, CURB } from '../js/city.js';

const city = generateCity();

test('generation is deterministic', () => {
  const again = generateCity();
  assert.equal(again.buildings.length, city.buildings.length);
  assert.deepEqual(again.buildings[10], city.buildings[10]);
  assert.ok(city.buildings.length > 800, `only ${city.buildings.length} buildings`);
});

test('every junction can reach every other one and there are no dead ends', () => {
  const alive = city.nodes.filter((n) => n.alive);
  const seen = new Set([alive[0].id]);
  const queue = [alive[0].id];
  while (queue.length) for (const l of city.nodes[queue.shift()].links) if (!seen.has(l.to)) { seen.add(l.to); queue.push(l.to); }
  assert.equal(seen.size, alive.length);
  for (const n of alive) assert.ok(n.links.length >= 2, `node ${n.i},${n.j} is a dead end`);
});

const samples = (b) => {
  const pts = [];
  for (const u of [0.02, 0.5, 0.98]) for (const v of [0.02, 0.5, 0.98]) pts.push([b.x0 + (b.x1 - b.x0) * u, b.z0 + (b.z1 - b.z0) * v]);
  return pts;
};

test('no building stands on a road or in the water', () => {
  for (const b of city.buildings) {
    for (const [x, z] of samples(b)) {
      assert.ok(!onRoad(city, x, z), `building at ${x.toFixed(0)},${z.toFixed(0)} is on a road`);
      assert.ok(!isWater(x, z), `building at ${x.toFixed(0)},${z.toFixed(0)} is in the water`);
    }
  }
});

test('buildings do not overlap each other', () => {
  const bs = city.buildings;
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j];
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
      assert.ok(ox <= 0.01 || oz <= 0.01, `buildings ${i} and ${j} overlap`);
    }
  }
});

test('places used by the story are next to a road', () => {
  for (const id of ['garage', 'police', 'hospital', 'hotel', 'mansion', 'warehouse', 'ferry', 'arena', 'lighthouse']) {
    const p = city.pois[id];
    assert.ok(p, `missing ${id}`);
    assert.ok(heightAt(city, p.road.x, p.road.z) !== null, `${id} road point is in the water`);
    if (id !== 'ferry') assert.ok(onRoad(city, p.road.x, p.road.z), `${id} road point is not on a road`);
  }
});

test('ramps rise from the ground and parked cars keep clear of them', () => {
  for (const rp of city.ramps) {
    const f = { x: Math.sin(rp.h), z: Math.cos(rp.h) };
    const low = heightAt(city, rp.x + f.x * 0.1, rp.z + f.z * 0.1);
    const high = heightAt(city, rp.x + f.x * (rp.len - 0.1), rp.z + f.z * (rp.len - 0.1));
    assert.ok(Math.abs(low - CURB) < 0.1, `${rp.name} low end`);
    assert.ok(high > rp.height, `${rp.name} high end`);
  }
});

test('traffic lights never show green both ways', () => {
  const n = city.nodes.find((x) => x.signal);
  for (let t = 0; t < 48; t += 0.5) {
    const a = signalState(city, n.id, 'x', t), b = signalState(city, n.id, 'z', t);
    assert.ok(!(a !== 'r' && b !== 'r'), `both open at t=${t}`);
  }
});
