// On-screen interface: cash, heat, clock, speed, weapon, crosshair, minimap, full map,
// objectives and subtitles.
import { LAND, CANAL, PIERS, POND, HALF_ROAD, N, line, DISTRICT_NAMES, isWater } from './city.js';
import { SURFACE_COLORS } from './render/cityMesh.js';
import { SHOP_COLORS, shopGlyph } from './render/markers.js';

const $ = (id) => document.getElementById(id);

// Weapon silhouettes for the HUD, in a 64 x 24 box.
export const WEAPON_ICONS = {
  fist: 'M22 6h16a4 4 0 0 1 4 4v6a6 6 0 0 1-6 6H26a6 6 0 0 1-6-6V9a3 3 0 0 1 2-3zM26 6v6M31 6v6M36 6v6',
  pistol: 'M12 6h34v7H30l-3 10h-8l3-10H12z',
  smg: 'M8 7h38v7h-8v4l2 5h-5l-3-9h-6l-3 7h-6l3-7H8zM46 9h8v3h-8z',
  shotgun: 'M2 9h18v4l-7 7H3zM20 7h40v4H20zM30 11h16v5H30z',
  rifle: 'M2 8h14v5l-6 7H3zM16 7h28v6H16zM26 13h5l3 8h-5zM44 9h17v2H44zM30 4h6v3h-6z',
  bat: 'M4 11h22l27-4.5a5.5 5.5 0 0 1 0 11L26 13H4z',
  sniper: 'M2 9h12v5l-5 7H3zM14 9h28v5H14zM42 10.5h20v2H42zM20 3h16v4H20zM24 7h2v2h-2zM31 7h2v2h-2zM27 14h4l2 6h-4z',
  launcher: 'M4 8h46v8H4zM50 6.5l11 5.5-11 5.5zM18 16h5l2 6h-5zM32 16h4l1 4h-4zM24 3h8v5h-8z',
  grenade: 'M23 14a9 9 0 1 0 18 0a9 9 0 1 0-18 0zM28 2h8v5h-8zM36 3l8-2v3l-8 2z',
};
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const MAP = { x0: LAND.x0 - 60, z0: LAND.z0 - 60, x1: LAND.x1 + 60, z1: 660, s: 1 };

// Draw the whole city once, one pixel per metre, for the minimap and the full map.
export function renderCityMap(city) {
  const w = Math.ceil(MAP.x1 - MAP.x0), h = Math.ceil(MAP.z1 - MAP.z0);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const X = (x) => x - MAP.x0, Z = (z) => z - MAP.z0;
  g.fillStyle = '#2f6a86'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#c9c4b6';
  g.fillRect(X(LAND.x0), Z(LAND.z0), LAND.x1 - LAND.x0, LAND.z1 - LAND.z0);
  for (const p of PIERS) g.fillRect(X(p.x0), Z(LAND.z1), p.x1 - p.x0, p.z1 - LAND.z1);
  for (const s of city.surfaces) {
    g.fillStyle = hex(SURFACE_COLORS[s.kind] ?? 0xcccccc);
    g.fillRect(X(s.x0), Z(s.z0), s.x1 - s.x0, s.z1 - s.z0);
  }
  g.fillStyle = '#2f6a86';
  g.fillRect(X(CANAL.x0), Z(LAND.z0 - 1), CANAL.x1 - CANAL.x0, LAND.z1 - LAND.z0 + 2);
  g.beginPath(); g.arc(X(POND.x), Z(POND.z), POND.r, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#8c8a86';
  for (const b of city.buildings) g.fillRect(X(b.x0), Z(b.z0), b.x1 - b.x0, b.z1 - b.z0);
  for (const o of city.round) { g.beginPath(); g.arc(X(o.x), Z(o.z), o.r, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#3d4046';
  for (const s of city.segments) {
    const a = city.nodes[s.a], b = city.nodes[s.b];
    if (s.axis === 'x') g.fillRect(X(a.x - HALF_ROAD), Z(a.z - HALF_ROAD), b.x - a.x + 2 * HALF_ROAD, 2 * HALF_ROAD);
    else g.fillRect(X(a.x - HALF_ROAD), Z(a.z - HALF_ROAD), 2 * HALF_ROAD, b.z - a.z + 2 * HALF_ROAD);
  }
  g.fillStyle = '#f2c230';
  for (const rp of city.ramps) g.fillRect(X(rp.x) - 3, Z(rp.z) - 3, 6, 6);
  return { canvas: c, ...MAP };
}

const BLIP = { mission: '#f2c230', target: '#ff5a4f', police: '#4f8cff', poi: '#ffffff', stunt: '#f2c230', friend: '#4fd18b', air: '#7fd3ff', ...SHOP_COLORS };

export class Hud {
  constructor(city) {
    this.city = city;
    this.map = renderCityMap(city);
    this.mini = $('minimap');
    this.mg = this.mini.getContext('2d');
    this.big = $('bigmap');
    this.notices = [];
    this.subs = [];
    this.bannerTime = 0;
    this.lastHeat = -1;
    this.lastCash = null;
    this.cashShown = 0;
    this.hurtLevel = 0;
    this.mark = { t: 0, kind: '' };
    this.lastWeapon = null;
  }

  // The red edge of the screen when you are hurt.
  hurt(dmg) { this.hurtLevel = Math.min(1, this.hurtLevel + 0.25 + dmg / 30); }

  // The crosshair flashes when a shot lands, and turns red for a kill.
  hitMark(kind) { if (kind === 'kill' || this.mark.kind !== 'kill' || this.mark.t <= 0) this.mark = { t: kind === 'kill' ? 0.35 : 0.15, kind }; }

  weapon(w, dt) {
    const el = $('weapon');
    el.hidden = !w;
    if (!w) return;
    if (this.lastWeapon !== w.id) {
      this.lastWeapon = w.id;
      $('weapon-icon').innerHTML = `<path d="${WEAPON_ICONS[w.id]}"${w.id === 'fist' ? ' fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"' : ''}/>`;
      $('weapon-name').textContent = w.name;
      el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap');
    }
    $('weapon-ammo').textContent = w.melee ? '' : w.thrown ? `× ${w.mag + w.ammo}` : w.reloading ? 'Reloading…' : `${w.mag} / ${w.ammo}`;
    $('weapon-ammo').classList.toggle('low', !w.melee && w.mag === 0);
  }

  setObjective(text) { $('objective').textContent = text || ''; $('objective').hidden = !text; }

  banner(title, sub = '', seconds = 3.5, tone = 'good') {
    $('banner-title').textContent = title;
    $('banner-sub').textContent = sub;
    const b = $('banner');
    b.dataset.tone = tone;
    b.hidden = false;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    this.bannerTime = seconds;
  }

  subtitle(who, text, seconds = 4) { this.subs.push({ who, text, seconds }); }
  notice(text, seconds = 3) { this.notices.push({ text, seconds }); }

  update(dt, world, extra) {
    const p = world.player;
    const v = p.vehicle;
    // money counts up rather than jumping
    this.cashShown += (p.cash - this.cashShown) * Math.min(1, dt * 6);
    if (Math.abs(p.cash - this.cashShown) < 1) this.cashShown = p.cash;
    $('cash').textContent = '$' + Math.round(this.cashShown).toLocaleString('en-GB');
    const hh = Math.floor(world.tod), mm = Math.floor((world.tod % 1) * 60);
    $('clock').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    $('area').textContent = p.area;
    const heat = extra.heat ?? 0;
    if (heat !== this.lastHeat) {
      this.lastHeat = heat;
      [...$('heat').children].forEach((el, i) => el.classList.toggle('on', i < heat));
      $('heat').classList.toggle('active', heat > 0);
    }
    $('heat').classList.toggle('flash', !!extra.heatSeen);
    $('car-panel').hidden = !v;
    if (v) {
      $('speed').textContent = Math.round(v.speed * 3.6);
      $('car-name').textContent = v.m.air ? `${v.m.name} · ${Math.max(0, Math.round(v.alt ?? 0))} m up` : v.m.name;
      $('car-health').style.width = Math.max(0, v.health) + '%';
      $('car-health').classList.toggle('low', v.health < 35);
    }
    $('player-health').style.width = Math.max(0, p.health) + '%';
    $('player-health').classList.toggle('low', p.health < 30);
    $('armour-bar').hidden = !(p.armour > 0);
    $('player-armour').style.width = Math.max(0, p.armour || 0) + '%';
    this.weapon(extra.weapon, dt);
    // crosshair: small while a gun is drawn, open while aiming
    const ch = $('crosshair');
    ch.hidden = !extra.crosshair;
    $('scope').hidden = !extra.scope;
    ch.classList.toggle('aim', extra.crosshair === 'aim');
    this.mark.t -= dt;
    ch.dataset.mark = this.mark.t > 0 ? this.mark.kind : '';
    // who a shot would go to, without free aim
    const tg = $('target'), t = extra.target;
    tg.hidden = !t;
    if (t) { tg.style.transform = `translate(${t.x.toFixed(0)}px, ${t.y.toFixed(0)}px)`; tg.classList.toggle('cop', t.cop); }
    this.hurtLevel = Math.max(0, this.hurtLevel - dt * 1.4);
    const low = p.health > 0 && p.health < 25 ? 0.35 + Math.sin(world.time * 5) * 0.1 : 0;
    $('hurt').style.opacity = Math.max(this.hurtLevel, low).toFixed(2);
    $('prompt').hidden = !extra.prompt;
    if (extra.prompt) $('prompt').innerHTML = extra.prompt;
    $('radio').textContent = extra.radio || '';
    $('radio').classList.toggle('show', !!extra.radioShow);

    if (this.bannerTime > 0) { this.bannerTime -= dt; if (this.bannerTime <= 0) $('banner').hidden = true; }
    this.queue(this.subs, 'subtitle', (s) => `<b>${s.who}</b>${s.text}`, dt);
    this.queue(this.notices, 'notice', (s) => s.text, dt);
    if (extra.timer != null) { $('timer').hidden = false; $('timer').textContent = fmtTime(extra.timer); $('timer').classList.toggle('low', extra.timer < 10); }
    else $('timer').hidden = true;
    this.drawMini(world, extra.blips || [], extra.yaw ?? p.h);
  }

  queue(list, id, fmt, dt) {
    const el = $(id);
    if (!list.length) { el.hidden = true; return; }
    const s = list[0];
    el.hidden = false;
    if (el.dataset.cur !== s.text) { el.innerHTML = fmt(s); el.dataset.cur = s.text; }
    s.seconds -= dt;
    if (s.seconds <= 0) list.shift();
  }

  drawMini(world, blips, yaw) {
    const g = this.mg, W = this.mini.width, H = this.mini.height, p = world.player;
    const scale = (p.vehicle ? 0.42 - Math.min(0.17, p.vehicle.speed * 0.004) : 0.6) * (W / 180);
    g.save();
    g.clearRect(0, 0, W, H);
    g.beginPath(); g.roundRect(0, 0, W, H, 18 * W / 180); g.clip();
    g.fillStyle = '#2f6a86'; g.fillRect(0, 0, W, H);
    g.translate(W / 2, H / 2);
    g.rotate(Math.PI + yaw);
    g.scale(scale, scale);
    g.drawImage(this.map.canvas, this.map.x0 - p.x, this.map.z0 - p.z);
    for (const b of blips) {
      const dx = b.x - p.x, dz = b.z - p.z;
      const max = (W / 2 - 10) / scale;
      const d = Math.hypot(dx, dz);
      if ((b.shop || b.local) && d > max) continue; // shops (and the like) only show when they are on the map
      const k = d > max ? max / d : 1;
      g.fillStyle = BLIP[b.kind] || '#fff';
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.lineWidth = 2 / scale;
      g.beginPath();
      if (b.shop) { const r = 6 / scale; g.roundRect(dx * k - r, dz * k - r, r * 2, r * 2, r * 0.4); }
      else g.arc(dx * k, dz * k, (b.big ? 7 : b.small ? 3.5 : 5) / scale, 0, Math.PI * 2);
      g.fill(); g.stroke();
    }
    g.restore();
    // the player arrow always points up
    g.save();
    g.translate(W / 2, H / 2);
    g.fillStyle = '#ffffff'; g.strokeStyle = '#111'; g.lineWidth = 2;
    g.rotate(yaw - p.h);
    g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3); g.lineTo(-6, 7); g.closePath();
    g.fill(); g.stroke();
    g.restore();
  }

  drawBigMap(world, blips) {
    const c = this.big, g = c.getContext('2d');
    const W = c.width = c.clientWidth * devicePixelRatio, H = c.height = c.clientHeight * devicePixelRatio;
    const m = this.map;
    const s = Math.min(W / m.canvas.width, H / m.canvas.height);
    const ox = (W - m.canvas.width * s) / 2, oy = (H - m.canvas.height * s) / 2;
    g.fillStyle = '#2f6a86'; g.fillRect(0, 0, W, H);
    g.drawImage(m.canvas, ox, oy, m.canvas.width * s, m.canvas.height * s);
    const P = (x, z) => [ox + (x - m.x0) * s, oy + (z - m.z0) * s];
    g.font = `600 ${Math.round(13 * devicePixelRatio)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    const labels = [
      ['hillside', -350, -350], ['oldtown', -350, 120], ['westgate', -270, 330], ['works', -400, 400], ['midtown', -150, -420],
      ['downtown', 0, -100], ['park', 0, -300], ['market', 0, 330], ['docks', 0, 470], ['canal', 250, -40],
      ['eastbank', 400, -300], ['arena', 400, 0], ['strand', 400, 300],
    ];
    for (const [k, x, z] of labels) {
      const [px, py] = P(x, z);
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.fillStyle = '#fff';
      g.strokeText(DISTRICT_NAMES[k], px, py); g.fillText(DISTRICT_NAMES[k], px, py);
    }
    for (const b of blips) {
      const [px, py] = P(b.x, b.z);
      g.fillStyle = BLIP[b.kind] || '#fff'; g.strokeStyle = '#111'; g.lineWidth = 2;
      if (b.shop) {
        // a rounded square with the shop's pictogram
        const r = 10 * devicePixelRatio;
        g.beginPath(); g.roundRect(px - r, py - r, r * 2, r * 2, r * 0.35); g.fill(); g.stroke();
        g.save(); g.translate(px - r * 0.8, py - r * 0.8); shopGlyph(g, b.kind, (r * 1.6) / 128); g.restore();
      } else { g.beginPath(); g.arc(px, py, (b.big ? 8 : 6) * devicePixelRatio, 0, Math.PI * 2); g.fill(); g.stroke(); }
      const ly = py - (b.shop ? 15 : 12) * devicePixelRatio;
      if (b.label) { g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 4; g.strokeText(b.label, px, ly); g.fillText(b.label, px, ly); }
    }
    const p = world.player, [px, py] = P(p.x, p.z);
    g.save(); g.translate(px, py); g.rotate(Math.PI - p.h);
    g.fillStyle = '#fff'; g.strokeStyle = '#111'; g.lineWidth = 2;
    const k = devicePixelRatio;
    g.beginPath(); g.moveTo(0, -11 * k); g.lineTo(7 * k, 8 * k); g.lineTo(0, 4 * k); g.lineTo(-7 * k, 8 * k); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
}

export function fmtTime(s) {
  s = Math.max(0, s);
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}
