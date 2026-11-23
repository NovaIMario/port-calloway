// The story and the engine that runs it. A mission is a list of steps; the runner advances
// through them using a small context object supplied by the game (spawn a car, set the heat,
// show a subtitle...), which keeps this file free of rendering and easy to test.

const BEA = 'Bea', MO = 'Mo', HAL = 'Halloran', RUIZ = 'Det. Ruiz', ASH = 'Ash';

// Race and errand routes, as road points (x, z). All of them are on carriageways.
export const ROAD_TEST = [[-400, 3], [-197, 100], [-3, 200], [100, 397], [3, 300], [-200, 203], [-297, 100], [-350, 103]];
export const GRAND_PRIX = [[100, -497], [297, -300], [403, -100], [497, 100], [300, 197], [103, 300], [-100, 297], [-197, 0], [0, -197], [100, -497]];

export const MISSIONS = [
  {
    id: 'homecoming', title: 'Homecoming', giver: null, start: 'ferry', reward: 250,
    intro: [[BEA, "Ash! You made it. I left the old Corso by the pier for you, keys are in it."], [BEA, 'Come straight to the shop in Old Town. We need to talk.']],
    steps: [
      { type: 'useVehicle', key: 'starter', text: 'Get in the teal Corso by the pier.' },
      { type: 'goto', at: 'garage', radius: 6, inVehicle: true, text: "Drive to Bea's Body & Paint in Old Town." },
      { type: 'say', lines: [[BEA, "Look at you. Taller, worse haircut."], [BEA, 'Here is the trouble: I borrowed twenty grand from Halloran to keep this place open.'], [BEA, "He owns the docks, half the police, and now he wants the garage. I need money, fast."], [ASH, "Then let's make some."]] },
    ],
  },
  {
    id: 'roadtest', title: 'Road Test', giver: BEA, start: 'garage', reward: 600, needs: ['homecoming'],
    intro: [[BEA, "A customer's Vireo GT needs a road test before I hand it back."], [BEA, 'Hit every checkpoint and bring it back in one piece. One piece, Ash.']],
    steps: [
      { type: 'spawn', key: 'vireo', model: 'vireo', at: { x: -335, z: 118, h: Math.PI }, color: 0xd23c2c },
      { type: 'useVehicle', key: 'vireo', text: 'Get in the red Vireo GT.' },
      { type: 'checkpoints', points: ROAD_TEST, time: 150, vehicle: 'vireo', maxDamage: 45, text: 'Road test: drive through the checkpoints.' },
      { type: 'goto', at: 'garage', radius: 6, inVehicle: 'vireo', text: 'Bring the Vireo back to the garage.' },
      { type: 'say', lines: [[BEA, 'Not a scratch. Well, not many. The owner paid in cash.']] },
    ],
  },
  {
    id: 'spareparts', title: 'Spare Parts', giver: BEA, start: 'garage', reward: 900, needs: ['roadtest'],
    intro: [[BEA, "Mrs Lindqvist up in Hillside has owed me for a gearbox since spring."], [BEA, "Her Ranger is sitting in her drive. Bring it here and we're even. Mind the alarm."]],
    steps: [
      { type: 'spawn', key: 'ranger', model: 'ranger', at: { poi: 'mansion' }, color: 0x2f5d50 },
      { type: 'useVehicle', key: 'ranger', text: "Take Mrs Lindqvist's green Ranger from her drive in Hillside." },
      { type: 'heat', level: 1, say: [BEA, "That'll be the alarm. Lose the police before you come back here."] },
      { type: 'loseHeat', text: 'Lose the police.' },
      { type: 'goto', at: 'garage', radius: 6, inVehicle: 'ranger', noHeat: true, text: 'Drive the Ranger to the garage.' },
      { type: 'say', lines: [[BEA, "Lovely. Leave it there, I'll have it in pieces by tea time."]] },
    ],
  },
  {
    id: 'delivery', title: 'Special Delivery', giver: MO, start: 'garage', reward: 1500, needs: ['spareparts'],
    intro: [[MO, "Ash, right? I'm Mo. Bea's apprentice. Also her driver. Also her accountant."], [MO, "Halloran's warehouse needs a van run to the Hotel Marisol. Pays well. Don't ask what's in it."]],
    steps: [
      { type: 'goto', at: 'warehouse', radius: 7, text: 'Go to Halloran & Sons at the docks.' },
      { type: 'spawn', key: 'van', model: 'haulmark', at: { x: -155, z: 403, h: Math.PI / 2 }, color: 0x6b5a3e },
      { type: 'useVehicle', key: 'van', text: 'Get in the brown Haulmark van.' },
      { type: 'timer', seconds: 170 },
      { type: 'goto', at: { x: 300, z: 300 }, radius: 14, inVehicle: 'van', text: 'Deliver the van to the Hotel Marisol on the Strand.', silent: true },
      { type: 'heat', level: 2, say: [MO, 'Someone tipped off the police. Keep going, the hotel is close!'] },
      { type: 'goto', at: 'hotel', radius: 7, inVehicle: 'van', text: 'Deliver the van to the Hotel Marisol.' },
      { type: 'stopTimer' },
      { type: 'leaveVehicle', text: 'Get out of the van.' },
      { type: 'loseHeat', text: 'Lose the police.' },
      { type: 'say', lines: [[MO, 'Someone at the docks talks too much. I have a feeling it was a test.']] },
    ],
  },
  {
    id: 'grandprix', title: 'Grand Prix', giver: MO, start: 'garage', reward: 2000, needs: ['delivery'],
    intro: [[MO, "Street race tonight, Midtown to the Strand and back. Entry's free, the prize isn't."], [MO, "Take the Vireo. And Ash? Win."]],
    steps: [
      { type: 'spawn', key: 'car', model: 'vireo', at: { x: 85, z: -497, h: Math.PI / 2 }, color: 0x1f4e8c },
      { type: 'goto', at: { x: 85, z: -497 }, radius: 8, text: 'Get to the start line in Midtown.' },
      { type: 'useVehicle', key: 'car', text: 'Get in the blue Vireo.' },
      { type: 'race', vehicle: 'car', points: GRAND_PRIX, racers: 3, text: 'Win the race!' },
      { type: 'say', lines: [[MO, 'First place! I may have bet on you. I may have bet the rent.']] },
    ],
  },
  {
    id: 'tail', title: 'Follow the Money', giver: BEA, start: 'garage', reward: 1200, needs: ['grandprix'],
    intro: [[BEA, "Halloran keeps his books somewhere outside the docks. If we find them, we find leverage."], [BEA, "He leaves the warehouse every night. Follow him. Not too close."]],
    steps: [
      { type: 'goto', at: { x: -60, z: 395 }, radius: 10, text: 'Go to the docks and wait for Halloran.' },
      { type: 'spawn', key: 'hal', model: 'meridian', at: { x: -155, z: 397, h: Math.PI / 2 }, color: 0x15171c, driver: 'npc' },
      { type: 'follow', key: 'hal', to: 'lighthouse', near: 14, far: 140, text: "Follow Halloran's black Meridian. Don't get too close." },
      { type: 'say', lines: [[ASH, 'The lighthouse at Gull Point. And an armoured truck parked out front.'], [BEA, "That truck never leaves his sight. That's where the books are."]] },
    ],
  },
  {
    id: 'lastorders', title: 'Last Orders', giver: BEA, start: 'garage', reward: 5000, needs: ['tail'],
    intro: [[BEA, "I called Detective Ruiz. She's the one cop Halloran never managed to buy."], [BEA, 'Bring that truck to Police HQ with his ledger inside and this is over.']],
    steps: [
      { type: 'spawn', key: 'truck', model: 'armored', at: { x: 530, z: -500, h: -Math.PI / 2 }, color: 0x3f4a3a },
      { type: 'goto', at: { x: 530, z: -500 }, radius: 14, text: 'Go to the lighthouse at Gull Point.' },
      { type: 'useVehicle', key: 'truck', text: "Take Halloran's armoured truck." },
      { type: 'heat', level: 3, say: [HAL, "That's my truck. Every cop in my pocket is coming for you."] },
      { type: 'goto', at: 'police', radius: 9, inVehicle: 'truck', text: 'Drive the truck to Police HQ downtown.', clearsHeat: true },
      { type: 'say', lines: [[RUIZ, "Halloran's ledger. Every bribe, every name. This is going to be a long week."], [RUIZ, "I didn't see you, by the way. Go home."], [BEA, "The loan's void, the garage is ours. Come home, Ash. I'm making dinner."]] },
    ],
  },
];

export class MissionRunner {
  constructor(ctx) {
    this.ctx = ctx;
    this.done = new Set();
    this.active = null;
  }

  available() {
    return MISSIONS.filter((m) => !this.done.has(m.id) && (m.needs || []).every((n) => this.done.has(n)));
  }

  // The next mission waiting at a start point, if the player is standing on it.
  startable(x, z) {
    if (this.active) return null;
    for (const m of this.available()) {
      const p = this.ctx.point(m.start);
      if (Math.hypot(p.x - x, p.z - z) < 5) return m;
    }
    return null;
  }

  start(m) {
    this.active = { m, step: -1, vehicles: {}, t: 0, timer: null, state: {} };
    this.ctx.banner(m.title, m.giver ? `A job from ${m.giver}` : 'Port Calloway', 3, 'info');
    for (const [who, text] of m.intro || []) this.ctx.say(who, text, 4.5);
    this.next();
  }

  next() {
    const a = this.active;
    a.step++;
    a.t = 0;
    a.state = {};
    const s = a.m.steps[a.step];
    if (!s) return this.complete();
    this.ctx.objective(s.text || '');
    this.ctx.markers([]);
    switch (s.type) {
      case 'spawn': {
        const at = s.at.poi ? this.ctx.point(s.at.poi, true) : s.at;
        a.vehicles[s.key] = this.ctx.spawnVehicle(s.model, at.x, at.z, at.h ?? 0, { color: s.color, driver: s.driver, key: s.key });
        return this.next();
      }
      case 'heat':
        this.ctx.setHeat(s.level);
        if (s.say) this.ctx.say(s.say[0], s.say[1], 5);
        return this.next();
      case 'say':
        for (const [who, text] of s.lines) this.ctx.say(who, text, 4.5);
        return this.next();
      case 'timer': a.timer = s.seconds; return this.next();
      case 'stopTimer': a.timer = null; return this.next();
      case 'checkpoints': case 'race': a.state.k = 0; a.state.time = s.time ?? null; break;
      case 'follow': a.state.close = 0; a.state.far = 0; break;
    }
    if (s.type === 'race') this.ctx.startRace(s, a.vehicles[s.vehicle]);
    if (s.type === 'follow') this.ctx.startFollow(a.vehicles[s.key], this.ctx.point(s.to, true));
  }

  vehicle(key) { return this.active?.vehicles[key]; }

  fail(reason) {
    const a = this.active;
    if (!a) return;
    this.ctx.banner('Job failed', reason, 3.5, 'bad');
    this.cleanup();
    this.active = null;
    this.ctx.objective('');
    this.ctx.timer(null);
  }

  complete() {
    const a = this.active;
    this.done.add(a.m.id);
    this.ctx.reward(a.m.reward);
    this.ctx.banner('Job done', `+$${a.m.reward.toLocaleString('en-GB')}`, 4, 'good');
    this.cleanup(true);
    this.active = null;
    this.ctx.objective('');
    this.ctx.timer(null);
    this.ctx.completed(a.m);
  }

  cleanup(success = false) {
    this.ctx.endRace?.();
    for (const v of Object.values(this.active.vehicles)) this.ctx.releaseVehicle(v, success);
    this.ctx.markers([]);
  }

  update(dt) {
    const a = this.active;
    if (!a) return;
    const ctx = this.ctx, p = ctx.player();
    const s = a.m.steps[a.step];
    a.t += dt;
    if (a.timer !== null) {
      a.timer -= dt;
      ctx.timer(a.timer);
      if (a.timer <= 0) return this.fail('Out of time.');
    } else if (!['checkpoints', 'race'].includes(s.type)) ctx.timer(null);
    // a mission car that is wrecked or sunk ends the job
    for (const [key, v] of Object.entries(a.vehicles)) {
      if (v.wrecked || v.sinking || v.health <= 0) return this.fail(key === 'hal' ? 'Halloran got away.' : 'The vehicle was wrecked.');
    }
    const inCar = (key) => (key === true ? !!p.vehicle : p.vehicle && p.vehicle === a.vehicles[key]);
    switch (s.type) {
      case 'useVehicle': {
        const v = a.vehicles[s.key] || ctx.namedVehicle(s.key);
        if (v && !a.vehicles[s.key]) a.vehicles[s.key] = v;
        ctx.markers([{ x: v.x, z: v.z, kind: 'target', vehicle: true }]);
        if (p.vehicle === v) this.next();
        break;
      }
      case 'leaveVehicle':
        if (!p.vehicle) this.next();
        break;
      case 'goto': {
        const t = ctx.point(s.at, !!s.inVehicle);
        if (s.inVehicle && !inCar(s.inVehicle)) {
          const v = s.inVehicle === true ? null : a.vehicles[s.inVehicle];
          ctx.objective(v ? `Get back in the ${v.m.name}.` : 'Get a vehicle.');
          ctx.markers(v ? [{ x: v.x, z: v.z, kind: 'target', vehicle: true }] : []);
          break;
        }
        ctx.objective(s.noHeat && ctx.heat() > 0 ? 'Lose the police first.' : s.text);
        ctx.markers(s.silent ? [] : [{ x: t.x, z: t.z, kind: 'mission', r: s.radius }]);
        if (Math.hypot(p.x - t.x, p.z - t.z) < s.radius && !(s.noHeat && ctx.heat() > 0)) {
          if (s.clearsHeat) ctx.clearHeat();
          this.next();
        }
        break;
      }
      case 'loseHeat':
        if (ctx.heat() === 0) this.next();
        break;
      case 'checkpoints': {
        if (!inCar(s.vehicle)) { ctx.objective(`Get back in the ${a.vehicles[s.vehicle].m.name}.`); ctx.markers([{ ...a.vehicles[s.vehicle], kind: 'target', vehicle: true }]); break; }
        const v = a.vehicles[s.vehicle];
        if (s.maxDamage && 100 - v.health > s.maxDamage) return this.fail('You wrecked the customer\'s car.');
        if (a.state.time !== null) { a.state.time -= dt; ctx.timer(a.state.time); if (a.state.time <= 0) return this.fail('Too slow.'); }
        const [x, z] = s.points[a.state.k];
        const nxt = s.points[a.state.k + 1];
        ctx.objective(`${s.text} ${a.state.k + 1}/${s.points.length}`);
        ctx.markers([{ x, z, kind: 'mission', r: 7, checkpoint: true }, ...(nxt ? [{ x: nxt[0], z: nxt[1], kind: 'mission', r: 7, checkpoint: true, faint: true }] : [])]);
        if (Math.hypot(p.x - x, p.z - z) < 8) {
          ctx.checkpoint();
          a.state.k++;
          if (a.state.k >= s.points.length) this.next();
        }
        break;
      }
      case 'race': {
        const v = a.vehicles[s.vehicle];
        if (!inCar(s.vehicle)) { ctx.objective(`Get back in the ${v.m.name}!`); break; }
        const [x, z] = s.points[a.state.k];
        const place = ctx.racePlace(a.state.k, x, z);
        ctx.objective(`${s.text} Checkpoint ${a.state.k + 1}/${s.points.length} · Position ${place}/${s.racers + 1}`);
        ctx.markers([{ x, z, kind: 'mission', r: 8, checkpoint: true }]);
        if (Math.hypot(p.x - x, p.z - z) < 9) {
          ctx.checkpoint();
          a.state.k++;
          if (a.state.k >= s.points.length) {
            if (ctx.racePlace(a.state.k, x, z) === 1) this.next();
            else return this.fail('Someone beat you to the line.');
          }
        }
        if (ctx.raceFinishedBy() > 0 && a.state.k < s.points.length) return this.fail('Someone beat you to the line.');
        break;
      }
      case 'follow': {
        const v = a.vehicles[s.key];
        const d = Math.hypot(v.x - p.x, v.z - p.z);
        ctx.markers([{ x: v.x, z: v.z, kind: 'target', vehicle: true }]);
        a.state.close = d < s.near ? a.state.close + dt : Math.max(0, a.state.close - dt);
        a.state.far = d > s.far ? a.state.far + dt : 0;
        ctx.objective(d > s.far * 0.75 ? 'Catch up, you are losing him!' : d < s.near * 1.6 ? 'Back off, he will see you!' : s.text);
        if (a.state.close > 3) return this.fail('Halloran spotted you.');
        if (a.state.far > 6) return this.fail('You lost him.');
        if (ctx.followArrived(v)) this.next();
        break;
      }
      default:
        break;
    }
  }
}
