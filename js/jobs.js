// The context the mission runner talks to: spawning and releasing mission vehicles, races,
// tailing a car, markers and messages. Kept apart from game.js so the story logic stays small.
import { forwardOf, rightOf, clamp } from './util.js';
import { followPath } from './traffic.js';

export class JobContext {
  constructor(game) {
    this.g = game;
    this.racers = [];
    this.marks = [];
    this.finished = 0;
  }

  get world() { return this.g.world; }
  player() { return this.world.player; }
  point(id, road = false) {
    if (typeof id === 'object') return id;
    const p = this.world.city.pois[id];
    return road ? p.road : p;
  }
  heat() { return this.g.police.level; }
  setHeat(l) { this.g.police.setLevel(l); }
  clearHeat() { this.g.police.clear(); }
  say(who, text, s) { this.g.hud.subtitle(who, text, s); }
  objective(t) { this.g.hud.setObjective(t); }
  banner(a, b, s, tone) { this.g.hud.banner(a, b, s, tone); }
  timer(t) { this.g.timer = t; }
  markers(list) { this.marks = list; }
  checkpoint() { this.g.audio?.blip(); }
  reward(cash) { this.world.player.cash += cash; this.g.audio?.cash(); }
  completed(m) { this.g.onMissionDone(m); }

  namedVehicle(key) { return key === 'starter' ? this.g.starter : null; }

  spawnVehicle(model, x, z, h, opts) {
    const w = this.world;
    // clear the spot first
    for (const v of [...w.vehicles]) if (v !== w.player.vehicle && Math.hypot(v.x - x, v.z - z) < 7 && !v.mission) w.removeVehicle(v);
    const v = w.addVehicle(model, x, z, h, { color: opts.color ?? 0x888888, mission: true, owned: true, driver: opts.driver ?? null });
    v.mission = true;
    return v;
  }

  releaseVehicle(v, success) {
    v.mission = false;
    if (v.ai?.kind === 'scripted') { v.ai = null; v.driver = null; }
    if (v !== this.world.player.vehicle && !success && v.everDriven === undefined) this.world.removeVehicle(v);
  }

  // Race: rivals start beside the player and drive the same checkpoints.
  startRace(step, car) {
    const w = this.world, T = this.g.traffic;
    this.racers = [];
    this.finished = 0;
    const f = forwardOf(car.h), rt = rightOf(car.h);
    const grid = [[-2.8, -7], [2.8, -7], [0, -14]];
    const models = ['vireo', 'meridian', 'vireo'];
    const colors = [0xe0703a, 0x6d2e46, 0xd7a43b];
    for (let k = 0; k < step.racers; k++) {
      const [s, b] = grid[k];
      const x = car.x + rt.x * s + f.x * b, z = car.z + rt.z * s + f.z * b;
      const v = w.addVehicle(models[k], x, z, car.h, { color: colors[k], driver: 'npc', mission: true, locked: true });
      const lanes = T.routeThrough(x, z, car.h, step.points);
      v.ai = { kind: 'scripted', pts: [{ x, z }, ...T.pathFromLanes(lanes)], i: 1, cruise: [44, 36, 40][k], race: true, cp: 0, points: step.points, wait: 3 };
      this.racers.push(v);
    }
    this.g.hud.banner('3', '', 0.9, 'info');
    this.countdown = 3;
  }

  endRace() {
    for (const v of this.racers) { v.mission = false; v.ai = null; v.driver = null; }
    this.racers = [];
    this.follow = null;
  }

  racePlace(k, x, z) {
    const p = this.player();
    const mine = k - Math.min(1, Math.hypot(p.x - x, p.z - z) / 400);
    let ahead = 0;
    for (const v of this.racers) {
      const pts = v.ai?.points;
      if (!pts) continue;
      const c = Math.min(v.ai.cp, pts.length - 1);
      const theirs = v.ai.cp >= pts.length ? pts.length + 1 : v.ai.cp - Math.min(1, Math.hypot(v.x - pts[c][0], v.z - pts[c][1]) / 400);
      if (theirs > mine) ahead++;
    }
    return ahead + 1;
  }

  raceFinishedBy() { return this.finished; }

  startFollow(v, dest) {
    const T = this.g.traffic;
    const lanes = T.routeThrough(v.x, v.z, v.h, [[dest.x, dest.z]]);
    v.ai = { kind: 'scripted', pts: [{ x: v.x, z: v.z }, ...T.pathFromLanes(lanes), { x: dest.x, z: dest.z }], i: 1, cruise: 12.5, follow: true, wait: 4 };
    v.driver = 'npc';
    this.follow = v;
  }

  followArrived(v) { return v.ai && v.ai.i >= v.ai.pts.length - 1 && v.speed < 1; }

  update(dt) {
    const w = this.world;
    if (this.countdown > 0) {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const now = Math.ceil(this.countdown);
      if (now !== before) this.g.hud.banner(now > 0 ? String(now) : 'Go!', '', 0.9, now > 0 ? 'info' : 'good');
    }
    for (const v of w.vehicles) {
      const ai = v.ai;
      if (ai?.kind !== 'scripted') continue;
      if (ai.wait > 0) { ai.wait -= dt; v.input.throttle = 0; v.input.brake = 1; continue; }
      if (ai.race) {
        const pts = ai.points;
        if (ai.cp < pts.length && Math.hypot(v.x - pts[ai.cp][0], v.z - pts[ai.cp][1]) < 14) {
          ai.cp++;
          if (ai.cp >= pts.length) this.finished++;
        }
        // rubber band a little so races stay close
        const p = this.player();
        const d = Math.hypot(v.x - p.x, v.z - p.z);
        const behind = this.racePlace(this.g.missions.active?.state.k ?? 0, p.x, p.z) === 1;
        ai.cruise = clamp((ai.baseCruise ??= ai.cruise) * (behind ? 1 + Math.min(0.12, d / 1500) : 1 - Math.min(0.15, d / 1500)), 20, 60);
      }
      const ok = followPath(w, v, ai, dt, ai.race ? { ignoreLights: true, turnScale: 1.7, maxThrottle: 1, decel: 7, overtake: true } : {});
      if (!ok) { v.input.throttle = 0; v.input.brake = 1; }
    }
  }

  blips() {
    return this.marks.map((m) => ({ x: m.x, z: m.z, kind: m.vehicle ? 'target' : 'mission', big: !m.faint }));
  }
}
