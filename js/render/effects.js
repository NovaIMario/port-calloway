// Particles (smoke, fire, sparks, splashes), tyre marks, bullet tracers and muzzle flashes.
import * as THREE from 'three';

const MAX = 1800;
const TRACERS = 128;

export class Effects {
  constructor(scene) {
    this.scene = scene;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 4);
    this.size = new Float32Array(MAX);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { scale: { value: 600 } },
      vertexShader: `attribute float size; attribute vec4 color; varying vec4 vCol; uniform float scale;
        void main(){ vCol = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying vec4 vCol; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d); if (r > 0.25) discard; gl_FragColor = vec4(vCol.rgb, vCol.a * (1.0 - r * 4.0)); }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.parts = [];
    this.flashes = [];
    this.light = new THREE.PointLight(0xffa040, 0, 60, 1.6);
    scene.add(this.light);

    // tyre marks: a ring buffer of dark quads lying on the road
    this.markMax = 1500;
    this.marks = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.28, 0.9).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), this.markMax);
    this.marks.count = 0;
    this.marks.frustumCulled = false;
    this.markNext = 0;
    scene.add(this.marks);
    this.dummy = new THREE.Object3D();

    // tracers: short-lived line segments, bright at the gun end
    const tg = new THREE.BufferGeometry();
    this.tPos = new Float32Array(TRACERS * 6);
    this.tCol = new Float32Array(TRACERS * 8);
    tg.setAttribute('position', new THREE.BufferAttribute(this.tPos, 3).setUsage(THREE.DynamicDrawUsage));
    tg.setAttribute('color', new THREE.BufferAttribute(this.tCol, 4).setUsage(THREE.DynamicDrawUsage));
    this.tracerLines = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false }));
    this.tracerLines.frustumCulled = false;
    this.tracerLines.renderOrder = 6;
    scene.add(this.tracerLines);
    this.tracers = [];
  }

  tracer(x0, y0, z0, x1, y1, z1) {
    if (this.tracers.length >= TRACERS) this.tracers.shift();
    // start a little way out of the barrel so it reads as a streak, not a line from the hand
    const l = Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 1, s = Math.min(0.6, l * 0.3) / l;
    this.tracers.push({ x0: x0 + (x1 - x0) * s, y0: y0 + (y1 - y0) * s, z0: z0 + (z1 - z0) * s, x1, y1, z1, age: 0, life: 0.07 });
  }

  muzzle(x, y, z) {
    this.emit(x, y, z, { life: 0.06, size: 0.55, grow: -2, r: 1, g: 0.85, b: 0.45, a: 1 });
    this.emit(x, y, z, { vy: 0.4, life: 0.5, size: 0.25, grow: 0.8, r: 0.7, g: 0.7, b: 0.7, a: 0.25, drag: 2 });
    this.flashes.push({ x, y, z, t: 0.05, k: 600 });
  }

  // Where a bullet lands: dust off walls and the road, sparks off cars, a red puff off people.
  impact(x, y, z, kind) {
    if (kind === 'vehicle') { this.sparks(x, y, z, 5); return; }
    if (kind === 'ped' || kind === 'player') {
      for (let i = 0; i < 4; i++) this.emit(x, y, z, { vx: (Math.random() - 0.5) * 1.5, vy: Math.random() * 1.2, vz: (Math.random() - 0.5) * 1.5, life: 0.35, size: 0.22, grow: 0.4, r: 0.55, g: 0.06, b: 0.06, a: 0.8, grav: 6 });
      return;
    }
    if (!kind) return; // flew off into the distance
    for (let i = 0; i < 3; i++) this.emit(x, y, z, { vx: (Math.random() - 0.5) * 1.2, vy: 0.4 + Math.random(), vz: (Math.random() - 0.5) * 1.2, life: 0.6, size: 0.3, grow: 0.9, r: 0.72, g: 0.69, b: 0.63, a: 0.5, drag: 2 });
    if (kind === 'static') this.sparks(x, y, z, 2);
  }

  emit(x, y, z, opts) {
    if (this.parts.length >= MAX) this.parts.shift();
    this.parts.push({
      x, y, z, vx: opts.vx ?? 0, vy: opts.vy ?? 0, vz: opts.vz ?? 0,
      life: opts.life ?? 1, age: 0, size: opts.size ?? 1, grow: opts.grow ?? 0, r: opts.r, g: opts.g, b: opts.b,
      a: opts.a ?? 1, drag: opts.drag ?? 1, grav: opts.grav ?? 0, fade: opts.fade ?? 1,
    });
  }

  smoke(x, y, z, dark = 0.5, n = 1) {
    for (let i = 0; i < n; i++) {
      const c = 0.75 - dark * 0.6;
      this.emit(x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6, {
        vx: (Math.random() - 0.5) * 0.6, vy: 1.5 + Math.random(), vz: (Math.random() - 0.5) * 0.6,
        life: 2 + Math.random() * 1.5, size: 1.2, grow: 1.8, r: c, g: c, b: c, a: 0.55, drag: 0.5,
      });
    }
  }

  fire(x, y, z) {
    this.emit(x + (Math.random() - 0.5), y, z + (Math.random() - 0.5), {
      vy: 2.5 + Math.random() * 2, life: 0.5 + Math.random() * 0.4, size: 1.3, grow: -0.8, r: 1, g: 0.45 + Math.random() * 0.35, b: 0.1, a: 0.9,
    });
  }

  sparks(x, y, z, n = 12) {
    for (let i = 0; i < n; i++) {
      this.emit(x, y, z, {
        vx: (Math.random() - 0.5) * 9, vy: Math.random() * 5, vz: (Math.random() - 0.5) * 9,
        life: 0.35 + Math.random() * 0.3, size: 0.18, r: 1, g: 0.8, b: 0.35, grav: 14,
      });
    }
  }

  splash(x, y, z, n = 40) {
    for (let i = 0; i < n; i++) {
      this.emit(x + (Math.random() - 0.5) * 3, y, z + (Math.random() - 0.5) * 3, {
        vx: (Math.random() - 0.5) * 6, vy: 4 + Math.random() * 7, vz: (Math.random() - 0.5) * 6,
        life: 1.1, size: 0.7, grow: 0.5, r: 0.85, g: 0.93, b: 1, a: 0.85, grav: 14,
      });
    }
  }

  dust(x, y, z, n = 3) {
    for (let i = 0; i < n; i++) {
      this.emit(x + (Math.random() - 0.5), y + 0.2, z + (Math.random() - 0.5), {
        vx: (Math.random() - 0.5), vy: 0.6, vz: (Math.random() - 0.5), life: 1.2, size: 1, grow: 1.5, r: 0.75, g: 0.72, b: 0.66, a: 0.35, drag: 1.5,
      });
    }
  }

  explosion(x, y, z) {
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, s = 4 + Math.random() * 10;
      this.emit(x, y + 1, z, {
        vx: Math.cos(a) * s, vy: 2 + Math.random() * 10, vz: Math.sin(a) * s,
        life: 0.6 + Math.random() * 0.7, size: 2.4, grow: 1.5, r: 1, g: 0.35 + Math.random() * 0.4, b: 0.08, a: 1, drag: 2.2, grav: -1,
      });
    }
    for (let i = 0; i < 25; i++) this.smoke(x, y + 2, z, 0.9);
    this.sparks(x, y + 1, z, 40);
    this.flashes.push({ x, y: y + 3, z, t: 0.6 });
  }

  skid(x, z, y, h) {
    this.dummy.position.set(x, y + 0.02, z);
    this.dummy.rotation.set(0, h, 0);
    this.dummy.updateMatrix();
    this.marks.setMatrixAt(this.markNext, this.dummy.matrix);
    this.markNext = (this.markNext + 1) % this.markMax;
    this.marks.count = Math.min(this.markMax, this.marks.count + 1);
    this.marks.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    let n = 0;
    const keep = [];
    for (const p of this.parts) {
      p.age += dt;
      if (p.age >= p.life) continue;
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vz *= k; p.vy = p.vy * k - p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.size = Math.max(0.05, p.size + p.grow * dt);
      keep.push(p);
      const t = p.age / p.life;
      this.pos[n * 3] = p.x; this.pos[n * 3 + 1] = p.y; this.pos[n * 3 + 2] = p.z;
      this.col[n * 4] = p.r; this.col[n * 4 + 1] = p.g; this.col[n * 4 + 2] = p.b; this.col[n * 4 + 3] = p.a * (1 - t);
      this.size[n] = p.size;
      n++;
    }
    this.parts = keep;
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    for (const a of ['position', 'color', 'size']) g.attributes[a].needsUpdate = true;
    // brief light for explosions and gunshots (the brightest one wins)
    let best = null;
    for (const f of this.flashes) { f.t -= dt; if (f.t > 0 && (!best || f.t * (f.k ?? 400) > best.t * (best.k ?? 400))) best = f; }
    this.flashes = this.flashes.filter((f) => f.t > 0);
    if (best) { this.light.position.set(best.x, best.y, best.z); this.light.intensity = best.t * (best.k ?? 400); }
    else this.light.intensity = 0;
    // tracers fade out in a few frames
    let k = 0;
    this.tracers = this.tracers.filter((t) => (t.age += dt) < t.life);
    for (const t of this.tracers) {
      const a = 1 - t.age / t.life;
      this.tPos.set([t.x0, t.y0, t.z0, t.x1, t.y1, t.z1], k * 6);
      this.tCol.set([1, 0.93, 0.6, 0.95 * a, 1, 0.75, 0.35, 0.15 * a], k * 8);
      k++;
    }
    const tg = this.tracerLines.geometry;
    tg.setDrawRange(0, k * 2);
    tg.attributes.position.needsUpdate = true;
    tg.attributes.color.needsUpdate = true;
  }
}
