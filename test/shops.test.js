import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCity, heightAt } from '../js/citygen.js';
import { onRoad } from '../js/city.js';
import { World } from '../js/world.js';
import { Combat } from '../js/combat.js';
import { shopItems, purchase, PRICES, ARMOUR_PRICE, CARS, RESPRAY_PRICE } from '../js/shops.js';

const city = generateCity();
const shopOf = (kind) => city.shops.find((s) => s.kind === kind);

function setup(cash) {
  const world = new World(city);
  world.spawnPlayer(3, 50, 0);
  const combat = new Combat(world, 1);
  world.player.cash = cash;
  return { world, combat, p: world.player };
}

test('every shop door is on open pavement beside a road', () => {
  for (const kind of ['guns', 'food', 'clothes', 'cars', 'garage']) assert.ok(shopOf(kind), `no ${kind} shop`);
  for (const s of city.shops) {
    assert.ok(heightAt(city, s.x, s.z) !== null, `${s.id} door is in the water`);
    assert.ok(onRoad(city, s.road.x, s.road.z), `${s.id} is not next to a road`);
    const blocked = city.colliders.find((c) => (c.type === 'box' ? s.x > c.x0 - 0.4 && s.x < c.x1 + 0.4 && s.z > c.z0 - 0.4 && s.z < c.z1 + 0.4 : Math.hypot(c.x - s.x, c.z - s.z) < c.r + 0.5));
    assert.ok(!blocked, `${s.id} door is blocked by a ${blocked?.kind}`);
  }
  for (const k of city.pickupSpots) assert.ok(heightAt(city, k.x, k.z) !== null, `${k.kind} pickup is in the water`);
  // bought cars are parked where a car fits: not in a wall, a tree or another car's space
  for (const s of city.shops.filter((q) => q.deliver)) {
    const d = s.deliver;
    assert.ok(heightAt(city, d.x, d.z) !== null, `${s.id} delivers into the water`);
    const wall = city.colliders.find((c) => (c.type === 'box' ? d.x > c.x0 - 2.6 && d.x < c.x1 + 2.6 && d.z > c.z0 - 2.6 && d.z < c.z1 + 2.6 : Math.hypot(c.x - d.x, c.z - d.z) < c.r + 2.6));
    assert.ok(!wall, `${s.id} delivers into a ${wall?.kind}`);
    const spot = city.parking.find((q) => Math.hypot(q.x - d.x, q.z - d.z) < 6);
    assert.ok(!spot, `${s.id} delivers onto a parking space`);
  }
});

test('a gun shop sells guns, then ammo for them, and body armour', () => {
  const { combat, p } = setup(1000);
  const shop = shopOf('guns');
  const r = purchase(shop, 'buy:pistol', p);
  assert.ok(r.ok, r.msg);
  assert.equal(p.cash, 1000 - PRICES.pistol);
  combat.give(r.give.id, r.give.rounds);
  assert.deepEqual(p.arms.pistol, { mag: 12, ammo: 24 });
  assert.ok(!shopItems(shop, p).some((x) => x.id === 'buy:pistol'));
  const ammo = purchase(shop, 'ammo:pistol', p);
  assert.ok(ammo.ok);
  combat.give(ammo.give.id, ammo.give.rounds);
  assert.equal(p.arms.pistol.ammo, 48);
  // not enough money for the carbine: nothing changes
  const cash = p.cash;
  const no = purchase(shop, 'buy:rifle', p);
  assert.ok(!no.ok);
  assert.equal(p.cash, cash);
  p.cash = 500;
  assert.ok(purchase(shop, 'armour', p).ok);
  assert.equal(p.armour, 100);
  assert.equal(p.cash, 500 - ARMOUR_PRICE);
  assert.ok(!purchase(shop, 'armour', p).ok, 'sold armour twice');
});

test('a corner shop heals you, and can be held up with a gun in your hand', () => {
  const { combat, p } = setup(200);
  const shop = shopOf('food');
  p.health = 40;
  assert.ok(purchase(shop, 'pie', p).ok);
  assert.equal(p.health, 90);
  assert.ok(purchase(shop, 'firstaid', p).ok);
  assert.equal(p.health, 100);
  assert.ok(!purchase(shop, 'snack', p).ok, 'sold food at full health');
  // no gun: no robbery
  assert.ok(!purchase(shop, 'rob', p).ok);
  combat.give('pistol');
  combat.select('pistol');
  const before = p.cash;
  const r = purchase(shop, 'rob', p, { rand: () => 0.5 });
  assert.ok(r.ok && r.rob > 0 && r.close > 0);
  assert.equal(p.cash, before + r.rob);
  assert.ok(shopItems(shop, p, { closed: true }).every((x) => x.disabled));
});

test('clothes: buy once, then change for free', () => {
  const { p } = setup(500);
  const shop = shopOf('clothes');
  const r = purchase(shop, 'wear:night', p);
  assert.ok(r.ok && r.look && r.fresh);
  assert.equal(p.outfit, 'night');
  const cash = p.cash;
  assert.ok(purchase(shop, 'wear:harbour', p).ok);
  assert.ok(purchase(shop, 'wear:night', p).ok);
  assert.equal(p.cash, cash, 'charged twice for the same clothes');
});

test('cars: bought at the dealer, kept at the lock-up, resprayed there', () => {
  const { p } = setup(20000);
  const dealer = shopOf('cars'), lockup = shopOf('garage');
  const vantor = CARS.find((c) => c.model === 'vantor');
  assert.ok(!purchase(dealer, 'car:volantis', p).ok, 'sold a car we cannot afford');
  const r = purchase(dealer, 'car:vantor', p);
  assert.ok(r.ok);
  assert.equal(r.deliver.at, 'dealer');
  assert.equal(p.cash, 20000 - vantor.price);
  assert.ok(!purchase(dealer, 'car:vantor', p).ok, 'sold the same car twice');
  const out = purchase(lockup, 'out:vantor', p);
  assert.ok(out.ok && out.deliver.at === 'lockup');
  const paint = purchase(lockup, 'paint:vantor', p);
  assert.ok(paint.ok);
  assert.notEqual(p.garage[0].color, vantor.colors[0]);
  assert.equal(p.cash, 20000 - vantor.price - RESPRAY_PRICE);
});

test('the gun shop also has a bat, a sniper rifle, a launcher and grenades', () => {
  const { p, combat } = setup(30000);
  const s = shopOf('guns');
  const ids = shopItems(s, p).map((r) => r.id);
  for (const id of ['buy:bat', 'buy:sniper', 'buy:launcher', 'buy:grenade']) assert.ok(ids.includes(id), id);
  let r = purchase(s, 'buy:grenade', p);
  assert.ok(r.ok);
  assert.deepEqual(r.give, { id: 'grenade', rounds: 5 });
  combat.give(r.give.id, r.give.rounds);
  const more = shopItems(s, p).find((q) => q.id === 'ammo:grenade');
  assert.equal(more.name, 'Grenades ×5');
  assert.equal(more.desc, 'You have 5 grenades.');
  r = purchase(s, 'buy:bat', p);
  assert.ok(r.ok);
  combat.give('bat');
  assert.ok(!shopItems(s, p).some((q) => q.id.endsWith(':bat')), 'a bat you own is not on sale again');
  assert.equal(p.cash, 30000 - PRICES.grenade - PRICES.bat);
});
