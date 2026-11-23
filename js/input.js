// Keyboard, mouse and gamepad, merged into one set of controls per frame.
import { clamp } from './util.js';

const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab']);

export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.hits = new Set();
    this.mdx = 0; this.mdy = 0;
    this.locked = false;
    this.pad = null;
    this.prevPad = [];
    this.touch = { x: 0, y: 0, active: false, buttons: new Set(), hits: new Set() };
    window.addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code) && e.target === document.body) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      this.hits.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    el.addEventListener('mousemove', (e) => {
      if (this.locked) { this.mdx += e.movementX; this.mdy += e.movementY; }
      else if (e.buttons & 1) { this.mdx += e.movementX; this.mdy += e.movementY; }
    });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === el; });
  }

  requestLock() {
    try { this.el.requestPointerLock?.()?.catch?.(() => {}); } catch { /* not allowed here */ }
  }

  down(...codes) { return codes.some((c) => this.keys.has(c)); }
  hit(...codes) { return codes.some((c) => this.hits.has(c)); }

  // Collapse every device into one controls object.
  read(sensitivity = 1) {
    const k = (...c) => (this.down(...c) ? 1 : 0);
    const c = {
      moveX: k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft'),
      moveY: k('KeyW', 'ArrowUp') - k('KeyS', 'ArrowDown'),
      throttle: k('KeyW', 'ArrowUp'),
      brake: k('KeyS', 'ArrowDown'),
      steer: k('KeyD', 'ArrowRight') - k('KeyA', 'ArrowLeft'),
      handbrake: this.down('Space'),
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
      device: 'keyboard',
    };
    this.readPad(c);
    this.readTouch(c);
    return c;
  }

  readPad(c) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = [...pads].find((x) => x && x.connected);
    if (!p) return;
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    const b = (i) => p.buttons[i]?.value ?? 0;
    const pressed = (i) => (p.buttons[i]?.pressed ?? false);
    const edge = (i) => pressed(i) && !this.prevPad[i];
    const lx = dz(p.axes[0] ?? 0), ly = dz(p.axes[1] ?? 0), rx = dz(p.axes[2] ?? 0), ry = dz(p.axes[3] ?? 0);
    const used = lx || ly || rx || ry || p.buttons.some((x) => x.pressed);
    if (!used) { this.prevPad = p.buttons.map((x) => x.pressed); return; }
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
    c.horn ||= pressed(2);
    c.radio ||= edge(5);
    c.camera ||= edge(4);
    c.map ||= edge(8);
    c.pause ||= edge(9);
    c.lookX += rx * 0.05;
    c.lookY += ry * 0.035;
    c.lookBack ||= pressed(10);
    this.prevPad = p.buttons.map((x) => x.pressed);
  }

  readTouch(c) {
    const t = this.touch;
    if (!t.active && !t.buttons.size && !t.hits.size) return;
    c.device = 'touch';
    c.moveX = clamp(c.moveX + t.x, -1, 1);
    c.moveY = clamp(c.moveY + t.y, -1, 1);
    c.steer = clamp(c.steer + t.x, -1, 1);
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
  }

  endFrame() {
    this.hits.clear();
    this.touch.hits.clear();
    this.mdx = 0; this.mdy = 0;
  }
}
