// Entry point: builds the city, wires the simulation to the renderer, runs the loop.
import { generateCity } from './citygen.js';
import { createScene } from './render/scene.js';
import { buildCityMeshes } from './render/cityMesh.js';
import { buildProps } from './render/props.js';
import { createVehicleMesh, updateVehicleMesh } from './render/vehicles.js';
import { CrowdRenderer, PlayerView } from './render/people.js';
import { PickupView } from './render/pickups.js';
import { World } from './world.js';
import { CameraRig } from './camera.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { ShopUI } from './shopui.js';
import { lookOf } from './shops.js';

const $ = (id) => document.getElementById(id);
const canvas = $('game');

async function boot() {
  await new Promise((r) => setTimeout(r, 30)); // let the loading text paint
  const city = generateCity();
  const gfx = createScene(canvas);
  const meshes = buildCityMeshes(city, gfx.scene);
  const props = buildProps(city, gfx.scene);
  const world = new World(city);
  const input = new Input(canvas);
  const rig = new CameraRig(gfx.camera, world.grid);
  const hud = new Hud(city);
  const crowd = new CrowdRenderer(gfx.scene, 110);
  const playerView = new PlayerView(gfx.scene, { skin: 0xc68a5e, hair: 0x1c1512, ...lookOf('harbour') });
  const views = new Map();
  const game = new Game({ world, hud, rig, gfx, props, meshes, input });
  const shopUI = new ShopUI(game);
  game.pickupView = new PickupView(gfx.scene);

  const addView = (v) => { const view = createVehicleMesh(v); gfx.scene.add(view.root); views.set(v, view); };
  const dropView = (v) => { const view = views.get(v); if (view) { gfx.scene.remove(view.root); views.delete(v); } };
  game.onVehicle = { add: addView, remove: dropView };
  game.onShop = shopUI;
  game.onLook = (look) => playerView.setLook(look);

  game.start();
  playerView.setLook(lookOf(world.player.outfit));
  rig.yaw = world.player.h;
  rig.snap();
  window.portCalloway = game; // handy in the console
  $('loading').hidden = true;
  $('menu').hidden = false;
  if (game.hasSave) { $('play').textContent = 'Continue'; $('newgame').hidden = false; }

  let running = false, paused = false, mapOpen = false;
  const begin = (fresh) => {
    if (fresh) game.newGame();
    $('title').hidden = true;
    $('hud').hidden = false;
    running = true;
    game.audio?.resume();
    input.requestLock();
    canvas.focus();
  };
  $('play').onclick = () => begin(false);
  $('newgame').onclick = () => begin(true);
  const setPaused = (on) => {
    paused = on;
    $('pause').hidden = !on;
    if (on) { document.exitPointerLock?.(); game.fillProgress($('progress')); }
    else { input.requestLock(); canvas.focus(); }
    game.audio?.setPaused(on);
  };
  $('resume').onclick = () => setPaused(false);
  $('restart-mission').onclick = () => { game.restartMission(); setPaused(false); };
  canvas.addEventListener('click', () => { if (running && !paused) input.requestLock(); });
  $('vol-music').oninput = (e) => game.audio?.setVolume('music', +e.target.value);
  $('vol-sfx').oninput = (e) => game.audio?.setVolume('sfx', +e.target.value);
  $('sens').oninput = (e) => { game.sensitivity = +e.target.value; };
  $('shadows').onchange = (e) => { gfx.renderer.shadowMap.enabled = e.target.checked; gfx.scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); };
  setupTouch(input);

  const STEP = 1 / 60;
  let acc = 0, last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const c = input.read(game.sensitivity, !world.player.vehicle);
    const inShop = shopUI.open;
    if (running && inShop) {
      // the shop has the keyboard; Escape (from outside the dialog) or B on a pad leaves
      if (c.pause) shopUI.close();
      shopUI.pad(c.ui);
    } else if (running) {
      if (c.pause && !mapOpen) setPaused(!paused);
      if ((c.map || (c.pause && mapOpen)) && !paused) {
        mapOpen = !mapOpen;
        $('mapview').hidden = !mapOpen;
        if (mapOpen) hud.drawBigMap(world, game.blips(true));
      }
    }
    const live = running && !paused && !mapOpen && !inShop;
    if (live) {
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 5) {
        game.update(STEP, c);
        // one-shot presses count once, however many steps this frame runs
        c.enter = c.jump = c.radio = c.camera = c.fireHit = c.reload = c.nextWeapon = c.prevWeapon = false;
        c.slot = 0;
        acc -= STEP;
        steps++;
        if (shopUI.open) break; // walked into a shop
      }
      if (steps === 5) acc = 0;
    } else if (!running) {
      // slow orbit behind the title screen
      game.idle(dt);
    } else acc = 0;
    game.render(dt, live ? c : null);
    input.endFrame();
    for (const [v, view] of views) updateVehicleMesh(view, v, world.time);
    playerView.update(world.player);
    crowd.update(world.peds);
    gfx.renderer.render(gfx.scene, gfx.camera);
  }
  requestAnimationFrame(frame);
}

function setupTouch(input) {
  if (!('ontouchstart' in window)) return;
  $('touch').hidden = false;
  const stick = $('stick'), knob = $('knob');
  const t = input.touch;
  const move = (e) => {
    const r = stick.getBoundingClientRect();
    const p = e.touches ? [...e.touches].find((x) => x.target === stick || stick.contains(x.target)) : e;
    if (!p) return;
    const x = (p.clientX - r.left - r.width / 2) / (r.width / 2), y = (p.clientY - r.top - r.height / 2) / (r.height / 2);
    const l = Math.max(1, Math.hypot(x, y));
    t.x = x / l; t.y = -y / l; t.active = true;
    knob.style.transform = `translate(${(t.x * 40).toFixed(0)}px, ${(-t.y * 40).toFixed(0)}px)`;
    e.preventDefault();
  };
  const end = () => { t.x = t.y = 0; t.active = false; knob.style.transform = ''; };
  stick.addEventListener('touchstart', move, { passive: false });
  stick.addEventListener('touchmove', move, { passive: false });
  stick.addEventListener('touchend', end);
  for (const b of document.querySelectorAll('.tbtns button')) {
    const k = b.dataset.t;
    b.addEventListener('touchstart', (e) => { t.buttons.add(k); t.hits.add(k); e.preventDefault(); }, { passive: false });
    b.addEventListener('touchend', () => t.buttons.delete(k));
  }
}

boot().catch((e) => {
  console.error(e);
  $('loading').textContent = 'Something went wrong while building the city: ' + e.message;
});
