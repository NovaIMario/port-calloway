// Keyboard, mouse and gamepad, merged into one set of controls per frame.
import { clamp } from './util.js';

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);
const SLOTS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'];

export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.hits = new Set();
    this.mouse = new Set();
    this.clicks = new Set();
    this.wheel = 0;
    this.mdx = 0; this.mdy = 0;
    this.locked = false;
    this.pad = null;
    this.prevPad = [];
    this.prevTrigger = false;
    this.touch = { x: 0, y: 0, active: false, buttons: new Set(), hits: new Set() };
    window.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code) && (e.target === document.body || e.target === el)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.hits.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.clear(); });
    el.addEventListener('mousemove', (e) => {
      if (this.locked) { this.mdx += e.movementX; this.mdy += e.movementY; }
      else if (e.buttons & 1) { this.mdx += e.movementX; this.mdy += e.movementY; }
    });
    // left button shoots or punches, right button aims
    el.addEventListener('mousedown', (e) => { this.mouse.add(e.button); this.clicks.add(e.button); });
    window.addEventListener('mouseup', (e) => this.mouse.delete(e.button));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; });
  }

  requestLock() {
    try { this.el.requestPointerLock?.()?.catch?.(() => {}); } catch { /* not allowed here */ }
  }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return codes.some((c) => this.hits.has(c)); }

  // Collapse every device into one controls object. The mode ('foot', 'car', 'heli' or 'plane')
  // changes what a few buttons do. lift is up and down for a helicopter and the nose for a plane.
  read(sensitivity = 1, mode = 'foot') {
    const k = (...c) => (this.down(...c) ? 1 : 0);
    const onFoot = mode === 'foot';
    const slot = SLOTS.findIndex((s) => this.hits.has(s)) + 1;
    const c = {
      moveX: k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft'),
      moveY: k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown'),
      throttle: k('KeyW', 'ArrowUp'),
      brake: k('KeyS', 'ArrowDown'),
      steer: k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft'),
      handbrake: this.down('Space'),
      lift: k('Space') - k('ShiftLeft', 'ShiftRight'),
      sprint: this.down('ShiftLeft', 'ShiftRight'),
      jump: this.hit('Space'),
      enter: this.hit('KeyF', 'KeyE', 'Enter'),
      horn: this.down('KeyH'),
      radio: this.hit('KeyR'),
      map: this.hit('KeyM'),
      pause: this.hit('Escape', 'KeyP'),
      camera: this.hit('KeyC'),
      lookX: this.mdx * 0.0025 * sensitivity,
      lookY: this.mdy * 0.0025 * sensitivity,
      lookBack: this.down('KeyQ'),
      fire: this.mouse.has(0),
      fireHit: this.clicks.has(0),
      aim: this.mouse.has(2),
      reload: this.hit('KeyR'),
      slot: slot || 0,
      nextWeapon: this.hit('Tab') || this.wheel > 0,
      prevWeapon: this.wheel < 0,
      ui: { up: false, down: false, ok: false, back: false },
      device: 'keyboard',
    };
    this.readPad(c, mode);
    this.readTouch(c, mode);
    c.lift = clamp(c.lift, -1, 1);
    return c;
  }

  readPad(c, mode) {
    const onFoot = mode === 'foot';
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = [...pads].find((x) => x && x.connected);
    if (!p) return;
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    const b = (i) => p.buttons[i]?.value ?? 0;
    const pressed = (i) => (p.buttons[i]?.pressed ?? false);
    const edge = (i) => pressed(i) && !this.prevPad[i];
    const lx = dz(p.axes[0] ?? 0), ly = dz(p.axes[1] ?? 0), rx = dz(p.axes[2] ?? 0), ry = dz(p.axes[3] ?? 0);
    const used = lx || ly || rx || ry || p.buttons.some((x) => x.pressed);
    if (!used) { this.prevPad = p.buttons.map((x) => x.pressed); this.prevTrigger = false; return; }
    c.device = 'gamepad';
    c.moveX = clamp(c.moveX + lx, -1, 1);
    c.moveY = clamp(c.moveY - ly, -1, 1);
    c.steer = clamp(c.steer + lx, -1, 1);
    c.throttle = Math.max(c.throttle, b(7));
    c.brake = Math.max(c.brake, b(6));
    c.handbrake ||= pressed(0);
    c.jump ||= edge(0);
    c.sprint ||= pressed(1);
    c.enter ||= edge(3);
    c.camera ||= edge(4);
    c.map ||= edge(8);
    c.pause ||= edge(9);
    c.lookX += rx * 0.05;
    c.lookY += ry * 0.035;
    c.lookBack ||= pressed(10);
    if (mode === 'heli') {
      // RT climbs, LT descends; the left stick flies it forward and back and turns it
      c.lift += b(7) - b(6);
      c.radio ||= edge(5);
    } else if (mode === 'plane') {
      // RT throttle, LT slows down; left stick: pull back to climb, left and right to bank
      c.lift += ly;
      c.radio ||= edge(5);
    } else if (onFoot) {
      // LT aims, RT shoots, X reloads, RB and the d-pad change weapon
      const trigger = b(7) > 0.35;
      c.aim ||= b(6) > 0.35;
      c.fire ||= trigger;
      c.fireHit ||= trigger && !this.prevTrigger;
      this.prevTrigger = trigger;
      c.reload ||= edge(2);
      c.nextWeapon ||= edge(5) || edge(15);
      c.prevWeapon ||= edge(14);
    } else {
      // in a car the triggers drive: hold B to lean out and aim, X to shoot (and the horn otherwise)
      c.horn ||= pressed(2) && !pressed(1);
      c.radio ||= edge(5);
      c.aim ||= pressed(1);
      c.fire ||= pressed(1) && pressed(2);
      c.fireHit ||= pressed(1) && edge(2);
      c.nextWeapon ||= edge(15);
      c.prevWeapon ||= edge(14);
    }
    c.ui = { up: edge(12), down: edge(13), ok: edge(0), back: edge(1) };
    this.prevPad = p.buttons.map((x) => x.pressed);
  }

  readTouch(c, mode) {
    const t = this.touch, onFoot = mode === 'foot';
    if (!t.active && !t.buttons.size && !t.hits.size) return;
    c.device = 'touch';
    c.moveX = clamp(c.moveX + t.x, -1, 1);
    c.moveY = clamp(c.moveY + t.y, -1, 1);
    c.steer = clamp(c.steer + t.x, -1, 1);
    // flying, the Brake and Horn buttons become Up and Down (relabelled on screen)
    const up = t.buttons.has('brake') ? 1 : 0, dn = t.buttons.has('horn') ? 1 : 0;
    if (mode === 'heli') { c.lift += up - dn; return this.touchCommon(c, t); }
    if (mode === 'plane') {
      // the stick banks and pitches; Up opens the throttle, Down closes it
      c.lift += t.y;
      c.throttle = Math.max(c.throttle, up);
      c.brake = Math.max(c.brake, dn);
      return this.touchCommon(c, t);
    }
    if (t.y > 0.25) c.throttle = Math.max(c.throttle, Math.min(1, t.y * 1.4));
    if (t.y < -0.25) c.brake = Math.max(c.brake, Math.min(1, -t.y * 1.4));
    c.handbrake ||= t.buttons.has('brake');
    c.sprint ||= t.buttons.has('sprint') || Math.hypot(t.x, t.y) > 0.9;
    c.jump ||= t.hits.has('brake');
    c.enter ||= t.hits.has('enter');
    c.horn ||= t.buttons.has('horn');
    c.radio ||= t.hits.has('radio');
    c.map ||= t.hits.has('map');
    c.pause ||= t.hits.has('pause');
    c.fire ||= t.buttons.has('fire');
    c.fireHit ||= t.hits.has('fire');
    if (!onFoot && t.buttons.has('fire')) c.aim = true; // shooting from a car aims where the camera looks
    c.nextWeapon ||= t.hits.has('gun');
  }

  touchCommon(c, t) {
    c.enter ||= t.hits.has('enter');
    c.radio ||= t.hits.has('radio');
    c.map ||= t.hits.has('map');
    c.pause ||= t.hits.has('pause');
  }

  endFrame() {
    this.hits.clear();
    this.clicks.clear();
    this.wheel = 0;
    this.touch.hits.clear();
    this.mdx = 0; this.mdy = 0;
  }
}
