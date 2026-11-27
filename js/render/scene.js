// Renderer, camera, sky and the day/night cycle.
import * as THREE from 'three';
import { clamp, lerp } from '../util.js';

// Keyframes by sun elevation (sine of the angle above the horizon).
const KEYS = [
  // night is moonlit blue rather than black: enough sky light to read streets, cars and people
  { e: -0.35, top: 0x0c1636, hor: 0x22305a, light: 0xa8b8f0, li: 0.9, hemi: 0x7088c8, gnd: 0x30343f, hi: 1.05, fog: 0x1d2848, night: 1 },
  { e: -0.08, top: 0x1d2a58, hor: 0x7a5670, light: 0xa0a8d8, li: 0.7, hemi: 0x6a74b0, gnd: 0x34323c, hi: 1.0, fog: 0x463c5c, night: 0.95 },
  { e: 0.03, top: 0x34508a, hor: 0xf09060, light: 0xff9a5c, li: 1.0, hemi: 0x8a90b8, gnd: 0x3a3030, hi: 0.8, fog: 0xc98a72, night: 0.55 },
  { e: 0.16, top: 0x4a84c6, hor: 0xffd3a4, light: 0xffd2a2, li: 2.2, hemi: 0xb8cce8, gnd: 0x5a5448, hi: 1.0, fog: 0xe8cfb0, night: 0 },
  { e: 0.5, top: 0x3a7bd2, hor: 0xcfe5f5, light: 0xfff8ee, li: 2.8, hemi: 0xc8dcf2, gnd: 0x5e5a50, hi: 1.1, fog: 0xc9dcea, night: 0 },
];

const ca = new THREE.Color(), cb = new THREE.Color();
function mix(key, e, out) {
  let i = 0;
  while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = clamp((e - a.e) / (b.e - a.e), 0, 1);
  if (typeof a[key] === 'number' && key !== 'li' && key !== 'hi' && key !== 'night' && key !== 'e') {
    return out.copy(ca.setHex(a[key])).lerp(cb.setHex(b[key]), t);
  }
  return lerp(a[key], b[key], t);
}

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(65, 1, 0.3, 4000);
  scene.fog = new THREE.Fog(0xc9dcea, 160, 950);

  const hemi = new THREE.HemisphereLight(0xc8dcf2, 0x5e5a50, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const S = 110;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 10, far: 900 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  // the player's headlights (or an aircraft's landing light) after dark
  const head = new THREE.SpotLight(0xfff0d8, 0, 95, 0.6, 0.55, 1.1);
  head.castShadow = false;
  scene.add(head, head.target);

  const sky = new THREE.Mesh(new THREE.SphereGeometry(3200, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() }, sunCol: { value: new THREE.Color() }, glow: { value: 1 } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform float glow; varying vec3 vDir;
      void main(){ float h = clamp(vDir.y, -0.2, 1.0); vec3 c = mix(hor, top, pow(max(h,0.0), 0.55));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += sunCol * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.25) * glow;
        gl_FragColor = vec4(c, 1.0); }`,
  }));
  sky.renderOrder = -1;
  scene.add(sky);

  const starGeo = new THREE.BufferGeometry();
  const pts = [];
  for (let i = 0; i < 1600; i++) {
    const u = Math.random() * Math.PI * 2, v = Math.random() * 0.9 + 0.08;
    const r = 3000;
    pts.push(Math.cos(u) * Math.sqrt(1 - v * v) * r, v * r, Math.sin(u) * Math.sqrt(1 - v * v) * r);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  const env = { night: 0, sunDir: new THREE.Vector3(), fogColor: new THREE.Color() };
  const tmpC = new THREE.Color();

  // hours: 0..24. focus: the point the shadow camera follows.
  function setTime(hours, focus) {
    const a = ((hours - 6) / 12) * Math.PI;
    const el = Math.sin(a);
    const dir = env.sunDir.set(Math.cos(a) * 0.85, el, 0.45 + 0.1 * Math.cos(a)).normalize();
    const e = dir.y;
    sky.material.uniforms.top.value.copy(mix('top', e, tmpC));
    sky.material.uniforms.hor.value.copy(mix('hor', e, tmpC));
    sky.material.uniforms.sunDir.value.copy(dir);
    sky.material.uniforms.sunCol.value.copy(mix('light', e, tmpC));
    sky.material.uniforms.glow.value = e > -0.05 ? 1 : 0;
    hemi.color.copy(mix('hemi', e, tmpC));
    hemi.groundColor.copy(mix('gnd', e, tmpC));
    hemi.intensity = mix('hi', e);
    sun.color.copy(mix('light', e, tmpC));
    sun.intensity = mix('li', e);
    scene.fog.color.copy(mix('fog', e, tmpC));
    env.fogColor.copy(scene.fog.color);
    env.night = mix('night', e);
    renderer.toneMappingExposure = 1.15 + 0.3 * env.night;
    starMat.opacity = clamp((env.night - 0.5) * 2, 0, 1);
    // When the sun is down, light comes from the moon on the other side of the sky.
    const lightDir = e > -0.02 ? dir : new THREE.Vector3(-dir.x, Math.max(0.35, -dir.y), -dir.z).normalize();
    const snap = 4;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    sun.target.position.set(fx, 0, fz);
    sun.position.set(fx + lightDir.x * 400, lightDir.y * 400, fz + lightDir.z * 400);
    sky.position.copy(camera.position);
    stars.position.copy(camera.position);
    return env;
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth, h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  return { renderer, scene, camera, sun, hemi, head, setTime, resize, env };
}
