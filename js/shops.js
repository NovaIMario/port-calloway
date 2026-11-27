// What the shops sell and what buying does. Pure rules on the player's state, so they are easy
// to test; the game applies the side effects (delivering a car, changing clothes, the police).
import { WEAPONS, GUNS } from './combat.js';
import { MODELS } from './physics.js';

export const SHOP_INFO = {
  guns: { title: 'Gunwale Arms', tag: 'Firearms and body armour. Cash only, no questions.' },
  food: { title: 'Night Owl', tag: 'Open all night. Food puts you back on your feet.' },
  clothes: { title: 'Threadline', tag: 'Clothes for every occasion. Anything you own is free to change into.' },
  cars: { title: 'Strand Motors', tag: 'Performance cars, delivered to the forecourt. Kept at Bea\'s lock-up.' },
  garage: { title: "Bea's lock-up", tag: 'Your cars, kept safe. Bea will respray them too.' },
};

export const PRICES = { bat: 80, pistol: 450, smg: 1400, shotgun: 2100, rifle: 3800, sniper: 5200, launcher: 9500, grenade: 300 };
export const AMMO_PRICES = { pistol: 60, smg: 110, shotgun: 90, rifle: 160, sniper: 150, launcher: 450, grenade: 300 };
export const AMMO_CAP = { pistol: 240, smg: 480, shotgun: 96, rifle: 480, sniper: 60, launcher: 12, grenade: 25 };
export const ARMOUR_PRICE = 300;
export const RESPRAY_PRICE = 150;
export const ROBBERY_CLOSES = 240; // seconds a robbed shop stays shut

export const FOOD = [
  { id: 'snack', name: 'Crisps and a fizzy drink', desc: '+20 health', heal: 20, price: 12 },
  { id: 'pie', name: 'Hot pie and a tea', desc: '+50 health', heal: 50, price: 30 },
  { id: 'firstaid', name: 'First aid kit', desc: 'Back to full health', heal: 100, price: 110 },
];

export const OUTFITS = [
  { id: 'harbour', name: 'Harbour jacket', desc: 'Teal work jacket, the one you came home in.', price: 0, look: { shirt: 0x2a8f8a, trousers: 0x23262e, accent: 0xe0703a } },
  { id: 'beach', name: 'Beach shirt', desc: 'Loud yellow shirt and chinos.', price: 90, look: { shirt: 0xf2c230, trousers: 0xd8cfb8, accent: 0x4ab0b5 } },
  { id: 'track', name: 'Tracksuit', desc: 'Purple, with a gold stripe.', price: 120, look: { shirt: 0x5b3c99, trousers: 0x5b3c99, accent: 0xf2c230 } },
  { id: 'night', name: 'Night shift', desc: 'All black. Hard to spot after dark.', price: 180, look: { shirt: 0x1b1d22, trousers: 0x141518, accent: 0xb8456a } },
  { id: 'sunday', name: 'Sunday best', desc: 'White shirt, navy trousers, red tie.', price: 240, look: { shirt: 0xf2efe6, trousers: 0x2b3445, accent: 0x9c1f24 } },
  { id: 'racing', name: 'Racing overalls', desc: 'For the supercar crowd.', price: 400, look: { shirt: 0xd23c2c, trousers: 0xd23c2c, accent: 0xf4f4f4 } },
];

export const CARS = [
  { model: 'vireo', price: 5500, desc: 'Light and twitchy. The car you learned to drive fast in.', colors: [0xe0703a, 0x1f4e8c, 0xf2f2ef, 0x15171c] },
  { model: 'halcyon', price: 9800, desc: 'A long-nosed grand tourer. Fast, comfortable, stable.', colors: [0x23395b, 0x6d2e46, 0xe0dccf, 0x2b2f36] },
  { model: 'vantor', price: 16500, desc: 'Mid-engined supercar with a rear wing. Very quick.', colors: [0xf2c230, 0xe0703a, 0x3c6e71, 0xf4f4f4] },
  { model: 'volantis', price: 29000, desc: 'The fastest car in Port Calloway. Grips like glue.', colors: [0x9c1f24, 0x15171c, 0x4ab0b5, 0xb8456a] },
];

export const lookOf = (id) => (OUTFITS.find((o) => o.id === id) || OUTFITS[0]).look;
const money = (n) => `$${n.toLocaleString('en-GB')}`;
const hasGun = (p) => GUNS.some((id) => id === p.weapon && p.arms[id] && p.arms[id].mag + p.arms[id].ammo > 0);
const totalAmmo = (a) => (a ? a.mag + a.ammo : 0);

// The rows a shop shows: { id, name, desc, price, label, disabled, note }.
// ctx: { closed } for a shop shut after a robbery.
export function shopItems(shop, p, ctx = {}) {
  const rows = [];
  if (shop.kind === 'guns') {
    for (const id of ['bat', ...GUNS]) {
      const W = WEAPONS[id], a = p.arms[id];
      if (!a) rows.push({ id: `buy:${id}`, name: `${W.name}: ${W.model}`, desc: describe(W), price: PRICES[id], label: 'Buy' });
      else if (!W.melee) {
        const full = totalAmmo(a) >= AMMO_CAP[id], unit = W.ammoName ?? 'rounds';
        const name = W.thrown ? `${W.name} ×${W.pack}` : `${W.name} ${W.ammoName ?? 'ammo'} ×${W.pack}`;
        rows.push({ id: `ammo:${id}`, name, desc: `You have ${totalAmmo(a)} ${unit}.`, price: AMMO_PRICES[id], label: full ? 'Full' : 'Buy', disabled: full });
      }
    }
    rows.push({ id: 'armour', name: 'Body armour', desc: 'Soaks up 100 points of damage before your health.', price: ARMOUR_PRICE, label: p.armour >= 100 ? 'Wearing it' : 'Buy', disabled: p.armour >= 100 });
  } else if (shop.kind === 'food') {
    for (const f of FOOD) rows.push({ id: f.id, name: f.name, desc: f.desc, price: f.price, label: p.health >= 100 ? 'Not hungry' : 'Buy', disabled: p.health >= 100 });
    rows.push({ id: 'rob', name: 'Hold up the till', desc: hasGun(p) ? 'Take the takings at gunpoint. The police will come.' : 'You would need a gun in your hand.', price: null, label: 'Rob', disabled: !hasGun(p), danger: true });
  } else if (shop.kind === 'clothes') {
    for (const o of OUTFITS) {
      const own = p.outfits.includes(o.id), wearing = p.outfit === o.id;
      rows.push({ id: `wear:${o.id}`, name: o.name, desc: o.desc, price: own ? null : o.price, label: wearing ? 'Wearing' : own ? 'Wear' : 'Buy', disabled: wearing, swatch: o.look });
    }
  } else if (shop.kind === 'cars') {
    for (const c of CARS) {
      const own = p.garage.some((g) => g.model === c.model);
      rows.push({ id: `car:${c.model}`, name: MODELS[c.model].name, desc: c.desc + (own ? ' You own one: it is at the lock-up.' : ''), price: own ? null : c.price, label: own ? 'Owned' : 'Buy', disabled: own, stats: carStats(c.model), swatch: { shirt: c.colors[0] } });
    }
  } else if (shop.kind === 'garage') {
    if (!p.garage.length) rows.push({ id: 'none', name: 'No cars yet', desc: 'Strand Motors on the Strand sells them.', price: null, label: '', disabled: true });
    for (const g of p.garage) {
      const name = MODELS[g.model].name;
      rows.push({ id: `out:${g.model}`, name: `Bring out the ${name}`, desc: 'Parked outside, ready to go.', price: null, label: 'Bring out', swatch: { shirt: g.color } });
      rows.push({ id: `paint:${g.model}`, name: `Respray the ${name}`, desc: 'Bea picks the next colour.', price: RESPRAY_PRICE, label: 'Respray' });
    }
  }
  for (const r of rows) {
    if (ctx.closed) { r.disabled = true; r.label = 'Closed'; }
    else if (r.price && p.cash < r.price && !r.disabled) { r.disabled = true; r.note = 'Not enough cash'; }
  }
  return rows;
}

function describe(W) {
  if (W.desc) return W.desc;
  const fire = W.pellets ? `${W.pellets} pellets a shot` : W.auto ? 'automatic' : 'semi-automatic';
  return `${fire}, ${W.mag}-round magazine, comes with ${W.start} rounds.`;
}

// Top speed and acceleration out of 10, for the dealer's list.
export function carStats(model) {
  const m = MODELS[model];
  return { speed: Math.round((m.top / 92) * 10), accel: Math.round((m.accel / 19) * 10), grip: Math.round((m.grip / 11.5) * 10) };
}

// Buy something. Returns { ok, msg, ...effects } and changes the player's state in place.
// Effects for the game: give (a gun to hand over), deliver (a car), look (new clothes), rob.
export function purchase(shop, id, p, ctx = {}) {
  const rows = shopItems(shop, p, ctx);
  const row = rows.find((r) => r.id === id);
  if (!row) return { ok: false, msg: 'That is not for sale here.' };
  if (row.disabled) return { ok: false, msg: row.note || (ctx.closed ? 'Closed.' : 'You cannot buy that right now.') };
  const pay = () => { if (row.price) p.cash -= row.price; };
  const [kind, arg] = id.split(':');
  switch (kind) {
    case 'buy': {
      pay();
      const W = WEAPONS[arg];
      return { ok: true, give: { id: arg, rounds: W.start }, msg: W.thrown ? `Bought ${W.start} ${W.name.toLowerCase()} for ${money(row.price)}.` : `Bought the ${W.name.toLowerCase()} for ${money(row.price)}.` };
    }
    case 'ammo': {
      pay();
      const a = p.arms[arg], W = WEAPONS[arg];
      const add = Math.min(W.pack, AMMO_CAP[arg] - totalAmmo(a));
      return { ok: true, give: { id: arg, rounds: add }, msg: W.thrown ? `${add} more ${W.ammoName}.` : `${add} ${W.ammoName ?? 'rounds'} for the ${W.name.toLowerCase()}.` };
    }
    case 'armour': pay(); p.armour = 100; return { ok: true, msg: 'Body armour on.' };
    case 'snack': case 'pie': case 'firstaid': {
      const f = FOOD.find((x) => x.id === kind);
      pay();
      p.health = Math.min(100, p.health + f.heal);
      return { ok: true, msg: `${f.name}. Health ${Math.round(p.health)}.` };
    }
    case 'rob': {
      const take = 180 + Math.floor((ctx.rand ?? Math.random)() * 340);
      p.cash += take;
      return { ok: true, rob: take, close: ROBBERY_CLOSES, msg: `The clerk empties the till: ${money(take)}. Run.` };
    }
    case 'wear': {
      const o = OUTFITS.find((x) => x.id === arg);
      const fresh = !p.outfits.includes(o.id);
      if (fresh) { pay(); p.outfits.push(o.id); }
      p.outfit = o.id;
      return { ok: true, look: o.look, fresh, msg: fresh ? `Bought the ${o.name.toLowerCase()} for ${money(o.price)}.` : `Changed into the ${o.name.toLowerCase()}.` };
    }
    case 'car': {
      const c = CARS.find((x) => x.model === arg);
      pay();
      const g = { model: c.model, color: c.colors[0] };
      p.garage.push(g);
      return { ok: true, deliver: { ...g, at: 'dealer' }, msg: `The ${MODELS[c.model].name} is yours. It is waiting on the forecourt.` };
    }
    case 'out': {
      const g = p.garage.find((x) => x.model === arg);
      return { ok: true, deliver: { ...g, at: 'lockup' }, msg: `Bea rolls out the ${MODELS[g.model].name}.` };
    }
    case 'paint': {
      const g = p.garage.find((x) => x.model === arg);
      const colors = CARS.find((x) => x.model === arg).colors;
      pay();
      g.color = colors[(colors.indexOf(g.color) + 1) % colors.length];
      return { ok: true, deliver: { ...g, at: 'lockup' }, msg: `Fresh paint on the ${MODELS[g.model].name}.` };
    }
  }
  return { ok: false, msg: 'Nothing happened.' };
}
