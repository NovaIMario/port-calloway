// Game glue: runs the systems around the world simulation (traffic, pedestrians, police,
// combat, shops, missions) and turns world events into crimes, stunts, particles, sound and
// HUD messages.
import { Traffic } from './traffic.js';
import { Peds } from './peds.js';
import { Police } from './police.js';
import { Combat, WEAPONS, GUNS, ARMS, blast } from './combat.js';
import { shopItems, purchase } from './shops.js';
import { MissionRunner, MISSIONS } from './missions.js';
import { JobContext } from './jobs.js';
import { Effects } from './render/effects.js';
import { Markers } from './render/markers.js';
import { GameAudio } from './audio.js';
import { heightAt, rampHeight } from './citygen.js';
import { MODELS } from './physics.js';
import { forwardOf, rightOf } from './util.js';

const SAVE_KEY = 'port-calloway-save-1';
const SHOP_REACH = 1.3; // how close to a shop door you walk to go in

// What the controls are for the aircraft you just climbed into, on the device being used.
function flightHelp(m, device) {
  const k = (s) => `<kbd>${s}</kbd>`;
  const heli = m.air === 'heli';
  if (device === 'gamepad') return heli
    ? `${m.name}: ${k('RT')} climb · ${k('LT')} descend · left stick flies and turns. ${k('Y')} jumps out.`
    : `${m.name}: ${k('RT')} throttle · ${k('LT')} slow down · left stick: pull back to climb, sideways to bank. Lift off at about 80 km/h.`;
  if (device === 'touch') return heli
    ? `${m.name}: Up and Down climb and descend; the stick flies and turns.`
    : `${m.name}: Up is the throttle, Down slows you; the stick climbs, dives and banks. Lift off at about 80 km/h.`;
  return heli
    ? `${m.name}: ${k('Space')} climb · ${k('Shift')} descend · ${k('W')}${k('S')} forward and back · ${k('A')}${k('D')} turn. ${k('F')} jumps out: high up, a parachute opens.`
    : `${m.name}: ${k('W')} throttle · ${k('S')} slow down and brake · ${k('A')}${k('D')} bank · ${k('Space')} nose up · ${k('Shift')} nose down. Lift off at about 80 km/h.`;
}

export class Game {
  constructor({ world, hud, rig, gfx, props, meshes, input }) {
    Object.assign(this, { world, hud, rig, gfx, props, meshes, input });
    this.sensitivity = 1;
    this.traffic = new Traffic(world);
    this.police = new Police(world, this.traffic);
    this.peds = new Peds(world);
    world.systems.push(this.traffic, this.police, this.peds);
    this.combat = new Combat(world);
    this.jobs = new JobContext(this);
    this.missions = new MissionRunner(this.jobs);
    this.effects = new Effects(gfx.scene);
    this.markers = new Markers(gfx.scene);
    this.audio = new GameAudio();
    this.stunts = new Set();
    this.timer = null;
    this.respawn = 0;
    this.saveTimer = 20;
    this.titleAngle = 0;
    this.shop = null;      // the shop the player is in, if any
    this.shopLatch = null; // the door just left, so walking back out does not reopen it
    this.closedUntil = {}; // shops shut after a hold-up
    this.gunfireReport = 0;
    this.device = 'keyboard';
    this.save = this.loadSave();
    this.hasSave = !!this.save;
  }

  loadSave() {
    try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; }
  }

  writeSave() {
    const p = this.world.player;
    const data = {
      cash: p.cash, done: [...this.missions.done], stunts: [...this.stunts], tod: this.world.tod,
      arms: p.arms, weapon: p.weapon, armour: p.armour, garage: p.garage, outfits: p.outfits, outfit: p.outfit,
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* private mode */ }
  }

  start() {
    const w = this.world, f = w.city.pois.ferry, p = w.player;
    w.spawnPlayer(f.x, f.z, Math.PI);
    this.starter = w.addVehicle('corso', f.x + 6, f.z - 22, Math.PI, { color: 0x2a8f8a, owned: true });
    const s = this.save;
    if (s) {
      p.cash = s.cash || 0;
      for (const id of s.done || []) this.missions.done.add(id);
      for (const st of s.stunts || []) this.stunts.add(st);
      w.tod = s.tod ?? w.tod;
      // guns, armour, cars and clothes (saves from before they existed simply have none)
      for (const id of ARMS) if (s.arms?.[id]) p.arms[id] = { mag: s.arms[id].mag | 0, ammo: s.arms[id].ammo | 0 };
      p.weapon = WEAPONS[s.weapon] && (s.weapon === 'fist' || p.arms[s.weapon]) ? s.weapon : 'fist';
      p.armour = Math.max(0, Math.min(100, s.armour || 0));
      p.garage = (s.garage || []).filter((g) => MODELS[g.model]);
      p.outfits = s.outfits?.length ? s.outfits : ['harbour'];
      p.outfit = p.outfits.includes(s.outfit) ? s.outfit : 'harbour';
      if (this.missions.done.has('homecoming')) {
        const g = w.city.pois.garage;
        w.spawnPlayer(g.x + 6, g.z + 2, 0);
        this.starter.x = g.road.x + 10; this.starter.z = g.road.z; this.starter.h = Math.PI / 2;
      }
    }
    // things lying about the city
    for (const k of w.city.pickupSpots) w.pickups.push({ ...k, spot: true });
    this.rig.yaw = p.h;
  }

  // ---- shops ----
  shopAt(kind) { return this.world.city.shops.find((s) => s.kind === kind); }
  shopClosed(s) { return (this.closedUntil[s.id] || 0) > this.world.time; }

  checkShops() {
    const w = this.world, p = w.player;
    if (this.shopLatch) {
      if (Math.hypot(p.x - this.shopLatch.x, p.z - this.shopLatch.z) < 2.4) return;
      this.shopLatch = null;
    }
    if (p.vehicle || p.down || p.health <= 0 || this.respawn > 0) return;
    for (const s of w.city.shops) {
      if (Math.abs(s.x - p.x) > SHOP_REACH || Math.abs(s.z - p.z) > SHOP_REACH || Math.hypot(s.x - p.x, s.z - p.z) > SHOP_REACH) continue;
      this.shopLatch = s;
      if (this.police.level > 0) this.hud.notice(`${s.name} keeps the door locked while the police are after you.`, 3);
      else if (this.shopClosed(s)) this.hud.notice(`${s.name} is shut after the hold-up. Come back later.`, 3);
      else this.openShop(s);
      return;
    }
  }

  openShop(s) {
    const p = this.world.player;
    this.shop = s;
    p.vx = p.vz = 0; p.speed = 0; p.swing = 0;
    this.onShop?.show(s);
    this.audio.door();
  }

  closeShop() {
    this.shop = null;
    this.input.requestLock();
    this.gfx.renderer.domElement.focus();
  }

  shopRows() { return this.shop ? shopItems(this.shop, this.world.player, { closed: this.shopClosed(this.shop) }) : []; }

  buy(id) {
    const s = this.shop, w = this.world, p = w.player;
    const r = purchase(s, id, p, { closed: this.shopClosed(s) });
    if (!r.ok) { this.audio.dry(); return r; }
    if (r.give) {
      this.combat.give(r.give.id, r.give.rounds);
      if (p.weapon === 'fist') this.combat.select(r.give.id);
    }
    if (r.look) this.onLook?.(r.look);
    if (r.deliver) this.deliverCar(r.deliver);
    this.audio.cash();
    if (r.rob) {
      // the clerk hands it over and hits the alarm
      this.closedUntil[s.id] = w.time + r.close;
      this.onShop?.close();
      this.hud.banner('Hold-up', `+$${r.rob.toLocaleString('en-GB')}`, 2.5, 'bad');
      this.police.report({ type: 'robbery', x: s.x, z: s.z });
      this.peds.scare(s.x, s.z, 30);
      this.audio.siren();
    }
    this.writeSave();
    return r;
  }

  // Park a car you own outside the dealer or the lock-up. You only ever have one of each.
  deliverCar(g) {
    const w = this.world, p = w.player;
    const at = (g.at === 'dealer' ? this.shopAt('cars') : this.shopAt('garage')).deliver;
    for (const v of [...w.vehicles]) {
      if (v === p.vehicle || v.mission) continue;
      if ((v.personal && v.model === g.model) || Math.hypot(v.x - at.x, v.z - at.z) < 5.5) w.removeVehicle(v);
    }
    const v = w.addVehicle(g.model, at.x, at.z, at.h, { color: g.color, owned: true });
    v.personal = true;
    return v;
  }

  // ---- the frame ----
  // What the weapon controls mean right now.
  combatControls(c) {
    const p = this.world.player;
    if (this.respawn > 0 || this.shop) return { slot: 0 };
    return { ...c, reload: c.reload && !p.vehicle };
  }

  newGame() {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    location.reload();
  }

  restartMission() {
    const a = this.missions.active;
    if (!a) return;
    const m = a.m;
    this.missions.fail('Restarted.');
    const s = this.jobs.point(m.start);
    const w = this.world;
    if (w.player.vehicle) w.exitVehicle();
    w.player.x = s.x; w.player.z = s.z + 6; w.player.y = heightAt(w.city, s.x, s.z + 6) ?? 0;
    this.police.clear();
  }

  fillProgress(el) {
    const done = MISSIONS.filter((m) => this.missions.done.has(m.id)).length;
    el.innerHTML = `Story: ${done} of ${MISSIONS.length} jobs<br>Stunt jumps: ${this.stunts.size} of ${this.world.city.ramps.length}<br>Cash: $${this.world.player.cash.toLocaleString('en-GB')}`;
    document.getElementById('restart-mission').hidden = !this.missions.active;
  }

  update(dt, c) {
    const w = this.world, p = w.player;
    w.cameraYaw = this.rig.yaw;
    this.device = c.device;
    if (this.respawn > 0) {
      this.respawn -= dt;
      c = { ...c, throttle: 0, brake: 0, steer: 0, moveX: 0, moveY: 0, enter: false, jump: false, fire: false, fireHit: false, aim: false };
      if (this.respawn <= 0) this.finishRespawn();
    }
    w.update(dt, c, this.rig.yaw);
    this.combat.update(dt, this.combatControls(c), this.rig.aimRay(c.device));
    this.gunfireReport -= dt;
    this.jobs.update(dt);
    this.missions.update(dt);
    if (!this.missions.active && this.respawn <= 0) {
      const m = this.missions.startable(p.x, p.z);
      if (m) this.missions.start(m);
    }
    this.handleEvents();
    this.checkShops();
    if (p.health <= 0 && this.respawn <= 0) {
      // shot or beaten on foot: fall where you stand
      if (!p.vehicle && !p.down) { p.down = 1; p.downTime = 5; p.vx = p.vz = 0; }
      this.knockout('Hospitalised', 'hospital', 0.1);
    }
    if (c.radio && p.vehicle) this.audio.nextStation();
    this.garageRespray();
    this.emitEffects(dt);
    this.saveTimer -= dt;
    if (this.saveTimer <= 0) { this.saveTimer = 20; this.writeSave(); }
  }

  garageRespray() {
    const p = this.world.player, g = this.world.city.pois.garage;
    if (!p.vehicle || this.police.level === 0 || this.police.level > 2 || this.police.seen) return;
    if (Math.hypot(p.x - g.road.x, p.z - g.road.z) > 7 || p.vehicle.speed > 3 || p.cash < 100) return;
    this.police.clear();
    p.cash -= 100;
    p.vehicle.health = Math.max(p.vehicle.health, 100);
    this.hud.notice('Bea gives the car a quick respray and the police lose interest. −$100', 4);
    this.audio.cash();
  }

  knockout(title, where, fine) {
    const w = this.world, p = w.player;
    const lose = Math.min(p.cash, Math.max(100, Math.round(p.cash * fine)));
    p.cash -= lose;
    this.hud.banner(title, lose ? `−$${lose.toLocaleString('en-GB')}` : '', 3, 'bad');
    if (this.missions.active) this.missions.fail(title === 'Arrested' ? 'You were arrested.' : 'You were hospitalised.');
    this.respawn = 2.6;
    this.respawnAt = where;
    // body armour does not survive either; the police also keep half your spare ammunition
    p.armour = 0;
    if (title === 'Arrested') {
      let kept = false;
      for (const id of GUNS) { const a = p.arms[id]; if (a && a.ammo > 1) { a.ammo = Math.floor(a.ammo / 2); kept = true; } }
      if (kept) this.hud.notice('The police kept half of your spare ammunition.', 4);
    }
  }

  finishRespawn() {
    const w = this.world, p = w.player;
    if (p.vehicle) w.exitVehicle();
    const poi = w.city.pois[this.respawnAt];
    w.spawnPlayer(poi.x, poi.z, poi.h ?? 0);
    p.y = heightAt(w.city, poi.x, poi.z) ?? 0;
    p.down = 0; p.downTime = 0;
    p.reloadT = 0;
    this.police.clear();
    this.rig.yaw = p.h;
    this.rig.snap();
  }

  handleEvents() {
    const w = this.world, p = w.player, pol = this.police;
    const mine = (v) => v && v === p.vehicle;
    const byMe = (b) => b === p || mine(b);
    for (const e of w.events) {
      switch (e.type) {
        // ---- fights ----
        case 'shot':
          if (e.tracer) this.effects.tracer(e.x0, e.y0, e.z0, e.x1, e.y1, e.z1);
          this.effects.impact(e.x1, e.y1, e.z1, e.kind);
          if (e.by === p) { if (e.kind === 'ped' || e.kind === 'vehicle') this.hud.hitMark('hit'); }
          else {
            // a police officer firing: one event per shot
            this.effects.muzzle(e.x0, e.y0, e.z0);
            this.audio.gun(e.weapon, this.near({ x: e.x0, z: e.z0 }));
            this.peds.scare(e.x0, e.z0, 30);
          }
          break;
        case 'gunfire': // the player pulled the trigger
          this.effects.muzzle(e.mx ?? e.x, e.my ?? p.y + 1.4, e.mz ?? e.z);
          this.audio.gun(e.weapon, 1);
          this.peds.scare(e.x, e.z, 45);
          if (this.gunfireReport <= 0) { this.gunfireReport = 1.5; pol.report(e); }
          break;
        case 'blast': // a rocket or a grenade (a car going up is handled by explode)
          if (e.weapon !== 'car') {
            this.effects.explosion(e.x, e.y, e.z);
            this.audio.boom(this.near(e));
            this.rig.shake = Math.max(this.rig.shake, 0.9 * this.near(e) + 0.1);
            if (byMe(e.by)) pol.report(e);
          }
          this.peds.scare(e.x, e.z, 45);
          break;
        case 'throw': this.audio.punch(false); this.peds.scare(e.x, e.z, 12); break;
        case 'plop': this.effects.splash(e.x, -2.2, e.z, 12); this.audio.splash(this.near(e) * 0.5); break;
        case 'punch':
          this.audio.punch(e.hit, 1, e.weapon === 'bat');
          if (e.hit) { pol.report(e); this.peds.scare(e.x, e.z, 10); this.hud.hitMark('hit'); }
          break;
        case 'npcPunch': this.audio.punch(true, this.near(e.ped)); break;
        case 'pedHurt':
          this.peds.onHurt(e.ped, e.by, e.weapon);
          if (byMe(e.by)) pol.report(e);
          break;
        case 'pedKilled':
          if (byMe(e.by)) { pol.report(e); if (e.by === p) this.hud.hitMark('kill'); }
          this.peds.scare(e.ped.x, e.ped.z, 25);
          break;
        case 'carShot': if (e.by === p) pol.report(e); break;
        case 'playerHurt':
          this.hud.hurt(e.dmg);
          this.rig.shake = Math.max(this.rig.shake, 0.12);
          break;
        case 'pickup': {
          const k = e.k;
          if (k.kind === 'cash') { this.audio.cash(); if (k.amount >= 100) this.hud.notice(`Found $${k.amount.toLocaleString('en-GB')}.`, 2.5); break; }
          this.audio.pickup();
          if (k.kind === 'weapon' || k.kind === 'ammo') {
            const W = WEAPONS[k.weapon];
            this.hud.notice(W.melee ? `Picked up a ${W.name.toLowerCase()}.` : `${W.name}: +${k.amount ?? W.start} ${W.ammoName ?? 'rounds'}`, 2.5);
          }
          else this.hud.notice(k.kind === 'armour' ? 'Body armour on.' : 'Patched up.', 2);
          break;
        }
        case 'dry': this.audio.dry(); break;
        case 'reload': this.audio.reload(WEAPONS[e.id].reload); break;
        case 'weapon': this.audio.blip(0.25); break;
        case 'copsOut': this.audio.door(); break;
        case 'vehicleAdded': this.onVehicle?.add(e.v); break;
        case 'vehicleRemoved': this.onVehicle?.remove(e.v); break;
        case 'notice': this.hud.notice(e.text, e.seconds); break;
        case 'prop':
          this.props.knock(e.c, e.v.vx / (e.v.speed || 1), e.v.vz / (e.v.speed || 1));
          this.audio.clang(this.near(e.v));
          break;
        case 'crash':
          this.effects.sparks(e.x, e.v.y + 0.6, e.z, Math.min(30, e.impact * 2));
          this.audio.crash(e.impact, this.near(e.v));
          if (mine(e.v)) this.rig.shake = Math.min(0.6, e.impact * 0.03);
          this.peds.scare(e.x, e.z, 12);
          break;
        case 'carHit': {
          this.effects.sparks(e.x, 0.8, e.z, Math.min(30, e.impact * 2));
          this.audio.crash(e.impact, this.near(e.a));
          const other = mine(e.a) ? e.b : mine(e.b) ? e.a : null;
          if (other) {
            this.rig.shake = Math.min(0.6, e.impact * 0.03);
            if (other.model === 'interceptor') pol.crime(70, e.x, e.z, { force: true });
            else if (e.impact > 6) pol.crime(25, e.x, e.z, { callChance: 0.15 });
          }
          for (const v of [e.a, e.b]) if (v.ai?.kind === 'civilian' && e.impact > 2) v.ai.shock = 1.2;
          this.peds.scare(e.x, e.z, 14);
          break;
        }
        case 'knock':
          this.audio.thud(this.near(e.who));
          if (e.who === p) { this.rig.shake = 0.4; break; }
          if (e.by && mine(e.by)) pol.crime(55, e.who.x, e.who.z, { callChance: 0.5 });
          break;
        case 'jack': {
          pol.crime(40, e.v.x, e.v.z, { callChance: 0.2 });
          const rt = rightOf(e.v.h);
          this.peds.make(e.v.x - rt.x * 2, e.v.z - rt.z * 2, { state: 'flee', fleeT: 5, fx: p.x, fz: p.z, armsUp: true });
          this.audio.door();
          break;
        }
        case 'bail': {
          const rt = rightOf(e.v.h);
          this.peds.make(e.v.x - rt.x * 2, e.v.z - rt.z * 2, { state: 'flee', fleeT: 6, fx: p.x, fz: p.z });
          break;
        }
        case 'steal':
          if (!e.v.mission) pol.crime(20, e.v.x, e.v.z, { callChance: 0 });
          if (e.v.model !== 'corso' || !e.v.owned) e.v.alarm = 3;
          this.audio.door();
          break;
        case 'enter':
          this.audio.door();
          if (e.v.m.air && mine(e.v)) this.hud.notice(flightHelp(e.v.m, this.device), 9);
          break;
        case 'exit': this.audio.door(); break;
        case 'chute':
          this.audio.whoosh(1);
          this.hud.notice('Parachute open. Steer it with the movement keys.', 3);
          break;
        case 'chuteLand': this.audio.thud(0.5); break;
        case 'swim': this.hud.notice('You came down in the water and swam ashore.', 3); break;
        case 'fire': this.audio.whoosh(this.near(e.v)); break;
        case 'explode': this.explode(e.v); break;
        case 'sunk': if (mine(e.v) || e.v.everDriven) this.hud.notice(`Splash. The ${e.v.m.air === 'heli' ? 'helicopter' : e.v.m.air ? 'plane' : 'car'} is at the bottom of the harbour now.`, 3); break;
        case 'splash': this.effects.splash(e.v.x, -2, e.v.z); this.audio.splash(this.near(e.v)); if (mine(e.v)) this.stunt(e, true); break;
        case 'land':
          if (e.hard > 6) this.effects.dust(e.v.x, e.v.y, e.v.z, 6);
          if (mine(e.v)) this.stunt(e, false);
          if (e.hard > 8) this.audio.crash(e.hard * 0.6, this.near(e.v));
          break;
        case 'heat':
          if (e.rising) this.audio.siren();
          if (!e.rising && e.level === 0) this.hud.notice('You lost the police.', 3);
          break;
        case 'arrested': this.knockout('Arrested', 'police', 0.1); break;
      }
    }
    w.events.length = 0;
  }

  near(o) {
    const p = this.world.player;
    return Math.max(0, 1 - Math.hypot(o.x - p.x, o.z - p.z) / 120);
  }

  explode(v) {
    const w = this.world, p = w.player;
    this.effects.explosion(v.x, v.y, v.z);
    this.audio.boom(this.near(v));
    this.rig.shake = 0.8 * this.near(v) + 0.1;
    if (p.vehicle === v) p.health = 0;
    // the same blast as a rocket's, a little weaker: cars nearby can go up too
    blast(w, v.x, v.y + 0.8, v.z, 9, 75, null, 'car');
    if (v.model === 'interceptor') this.police.crime(120, v.x, v.z, { force: true });
    else if (v.everDriven || Math.hypot(p.x - v.x, p.z - v.z) < 40) this.police.crime(40, v.x, v.z, { callChance: 0.5 });
  }

  stunt(e, splash) {
    const from = e.from;
    if (!from) return;
    const ramp = this.world.city.ramps.find((rp) => {
      const f = forwardOf(rp.h);
      const ex = rp.x + f.x * rp.len, ez = rp.z + f.z * rp.len;
      return Math.hypot(from.x - ex, from.z - ez) < rp.width;
    });
    if (!ramp || e.airTime < 0.7) return;
    const v = e.v;
    const dist = Math.round(Math.hypot(v.x - from.x, v.z - from.z));
    if (splash && !ramp.splash) { this.hud.notice(`${ramp.name}: not quite. Splash!`, 3); return; }
    const first = !this.stunts.has(ramp.name);
    const cash = first ? 200 + dist * 4 : 40 + dist;
    this.stunts.add(ramp.name);
    this.world.player.cash += cash;
    this.hud.banner(first ? `Stunt: ${ramp.name}` : ramp.name, `${dist} m · ${e.airTime.toFixed(1)} s in the air · +$${cash}`, 3.5, 'good');
    this.audio.cash();
    if (first) this.writeSave();
  }

  onMissionDone(m) {
    this.writeSave();
    if (m.id === 'lastorders') {
      setTimeout(() => this.hud.banner('Port Calloway', 'Thanks for playing. The city is yours.', 6, 'good'), 4500);
    }
  }

  emitEffects(dt) {
    const w = this.world, p = w.player, fx = this.effects;
    this.fxClock = (this.fxClock || 0) + dt;
    const tick = this.fxClock > 0.06;
    if (tick) this.fxClock = 0;
    for (const k of w.projectiles) if (k.kind === 'rocket') fx.trail(k.x - k.dx * 0.7, k.y - k.dy * 0.7, k.z - k.dz * 0.7);
    for (const v of w.vehicles) {
      if (Math.abs(v.x - p.x) > 160 || Math.abs(v.z - p.z) > 160) continue;
      const f = forwardOf(v.h), rt = rightOf(v.h);
      // rotor wash: dust thrown up off the ground under a low helicopter
      if (v.m.air === 'heli' && tick && v.rotor > 0.5 && v.alt < 14 && !v.sinking && v.y - v.alt > -1) {
        const gy = v.y - v.alt;
        for (let k = 0; k < 2; k++) {
          const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 4;
          fx.dust(v.x + Math.cos(a) * r, gy, v.z + Math.sin(a) * r, 1);
        }
      }
      if (tick && (v.health < 45 || v.burning) && !v.sinking) {
        const hx = v.x + f.x * v.m.len * 0.35, hz = v.z + f.z * v.m.len * 0.35;
        fx.smoke(hx, v.y + v.m.hgt * 0.8, hz, v.burning || v.wrecked ? 0.95 : 1 - v.health / 60);
        if (v.burning) for (let k = 0; k < 3; k++) fx.fire(hx, v.y + v.m.hgt * 0.7, hz);
      }
      if (!v.airborne && v.y < 0.3 && (v.slip > 3.2 || (v.input.brake > 0.8 && v.speed > 9) || (v.input.handbrake && v.speed > 4))) {
        v.markAcc = (v.markAcc || 0) + v.speed * dt;
        if (v.markAcc > 0.7) {
          v.markAcc = 0;
          for (const s of [-1, 1]) {
            const ox = rt.x * s * (v.m.wid / 2 - 0.2) - f.x * v.m.wb / 2, oz = rt.z * s * (v.m.wid / 2 - 0.2) - f.z * v.m.wb / 2;
            fx.skid(v.x + ox, v.z + oz, v.y, Math.atan2(v.vx, v.vz));
          }
          if (v.slip > 5 && tick) fx.dust(v.x - f.x * 1.5, v.y, v.z - f.z * 1.5, 1);
        }
      } else if (tick && !v.airborne && !(v.m.air && !v.grounded) && v.speed > 12 && v.y > 0.1 && v.y < 0.5 && Math.random() < 0.3) {
        fx.dust(v.x - f.x * 2, v.y, v.z - f.z * 2, 1);
      }
      if (v.alarm > 0) v.alarm -= dt;
    }
  }

  prompt() {
    const w = this.world, p = w.player;
    if (p.vehicle || p.down || this.respawn > 0) return null;
    const v = w.nearestEnterable();
    if (v) return v.driver ? `<kbd>F</kbd> pull the driver out of the ${v.m.name}` : `<kbd>F</kbd> get in the ${v.m.name}`;
    const s = w.city.shops.find((q) => Math.abs(q.x - p.x) < 5 && Math.abs(q.z - p.z) < 5);
    if (s && s !== this.shopLatch) return `Walk into the doorway to go into ${s.name}`;
    return null;
  }

  blips(full = false) {
    const out = this.jobs.blips();
    if (!this.missions.active) {
      for (const m of this.missions.available()) {
        const s = this.jobs.point(m.start);
        out.push({ x: s.x, z: s.z, kind: 'mission', big: true, label: full ? m.title : null });
      }
    }
    if (this.police.level > 0) {
      for (const v of this.police.units()) out.push({ x: v.x, z: v.z, kind: 'police' });
      for (const o of this.police.officers()) if (!o.dead) out.push({ x: o.x, z: o.z, kind: 'police', small: true });
    }
    for (const v of this.world.vehicles) if (v.personal && !v.wrecked && v !== this.world.player.vehicle) out.push({ x: v.x, z: v.z, kind: 'friend' });
    for (const s of this.world.city.shops) out.push({ x: s.x, z: s.z, kind: s.kind, shop: true, label: full ? s.name : null });
    for (const id of ['heliport', 'airstrip']) { const q = this.world.city.pois[id]; out.push({ x: q.x, z: q.z, kind: 'air', local: true, label: full ? q.name : null }); }
    if (full) {
      for (const rp of this.world.city.ramps) if (!this.stunts.has(rp.name)) out.push({ x: rp.x, z: rp.z, kind: 'stunt', label: rp.name });
      for (const id of ['garage', 'hospital', 'police']) { const q = this.world.city.pois[id]; out.push({ x: q.x, z: q.z, kind: 'poi', label: q.name }); }
    }
    return out;
  }

  // After dark the player's vehicle throws a beam down the road ahead.
  headlights(env) {
    const v = this.world.player.vehicle, hl = this.gfx.head;
    if (!hl) return;
    if (!v || v.wrecked || v.sinking || env.night < 0.15) { hl.intensity = 0; return; }
    const f = forwardOf(v.h), nose = v.m.len / 2;
    hl.position.set(v.x + f.x * nose, v.y + 0.85, v.z + f.z * nose);
    hl.target.position.set(v.x + f.x * (nose + 26), v.y - 0.6, v.z + f.z * (nose + 26));
    hl.intensity = env.night * 140;
  }

  // The person a hip-fired (or gamepad-aimed) shot would go to, as a point on screen.
  targetMark() {
    const p = this.world.player, W = WEAPONS[p.weapon];
    if (p.vehicle || W.melee || p.health <= 0 || p.down || !p.arms[p.weapon]) return null;
    if (p.aiming && this.device === 'keyboard') return null; // free aim: the crosshair says it all
    const t = this.combat.autoTarget(this.rig.yaw, W.range * 0.85, p.aiming ? 0.3 : 0.55);
    if (!t) return null;
    const v = (this.tv ||= this.gfx.camera.position.clone()).set(t.who.x, t.who.y + 2.15, t.who.z).project(this.gfx.camera);
    if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return null;
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, cop: !!t.who.cop };
  }

  idle(dt) {
    this.titleAngle += dt * 0.05;
    const cam = this.gfx.camera;
    cam.position.set(Math.sin(this.titleAngle) * 420, 160, Math.cos(this.titleAngle) * 420);
    cam.lookAt(0, 20, 0);
  }

  render(dt, c) {
    const w = this.world, p = w.player;
    this.handleEvents();
    if (c) {
      if (c.camera) this.rig.mode = (this.rig.mode + 1) % 3;
      this.rig.update(dt, p, c);
    }
    const env = this.gfx.setTime(w.tod, p);
    for (const m of this.meshes.night) m.emissiveIntensity = env.night * env.night * 1.0;
    for (const m of this.props.lampMats) m.emissiveIntensity = env.night * 2;
    this.props.pools.opacity = env.night * 0.7;
    this.headlights(env);
    this.props.updateSignals(w.time);
    this.meshes.water.material.map.offset.set(w.time * 0.004, w.time * 0.0025);
    this.effects.update(dt);
    const ground = (x, z) => heightAt(w.city, x, z);
    const marks = this.jobs.marks.map((m) => (m.vehicle ? { ...m, y: m.y ?? 0 } : m));
    this.markers.set(marks, w.time, ground);
    const beacons = this.missions.active ? [] : this.missions.available().filter((m) => m.giver).map((m) => ({ ...this.jobs.point(m.start), letter: m.giver[0] }));
    this.markers.setBeacons(beacons, w.time, ground);
    this.markers.setShops(w.city.shops, w.time, ground, p, (s) => this.shopClosed(s));
    this.pickupView?.update(w.pickups, w.time, p);
    this.projectileView?.update(w.projectiles, w.time);
    this.audio.update(dt, w, this.police, env);
    if (c) {
      const W = WEAPONS[p.weapon], a = p.arms[p.weapon];
      const showWeapon = p.health > 0 && (!p.vehicle || (W.driveBy && a));
      this.hud.update(dt, w, {
        prompt: this.prompt(), heat: this.police.level, heatSeen: this.police.seen, blips: this.blips(), yaw: this.rig.yaw,
        timer: this.timer, radio: this.audio.stationName(), radioShow: this.audio.showName > 0 && !!p.vehicle,
        weapon: showWeapon ? { id: W.id, name: W.name, melee: !!W.melee, thrown: !!W.thrown, mag: a?.mag ?? 0, ammo: a?.ammo ?? 0, reloading: p.reloadT > 0 } : null,
        crosshair: p.health > 0 && !p.scoped && (p.aiming || p.driveAim) ? 'aim' : null,
        scope: p.health > 0 && p.scoped,
        target: this.targetMark(),
      });
    }
  }
}
