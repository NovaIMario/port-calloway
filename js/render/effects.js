// Particles (smoke, fire, sparks, splashes) and tyre marks.
import * as THREE from 'three';

const MAX = 1800;

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
    // brief light for explosions
    let best = null;
    for (const f of this.flashes) { f.t -= dt; if (!best || f.t > best.t) best = f; }
    this.flashes = this.flashes.filter((f) => f.t > 0);
    if (best && best.t > 0) { this.light.position.set(best.x, best.y, best.z); this.light.intensity = best.t * 400; }
    else this.light.intensity = 0;
  }
}
