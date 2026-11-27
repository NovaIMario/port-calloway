# Port Calloway

An open-world driving and action game that runs in the browser. You play Ash, back in the harbour town of Port Calloway to help Auntie Bea pay off a loan to Halloran, the dock boss who wants her garage.

**Play it:** https://novaimario.github.io/port-calloway/

Everything is original and generated in code: the city, the cars, the people, the textures, the sound effects and the music on the car radio. The game uses no image or audio files.

## What's in it

- **A procedural city** of about 1.1 km × 1.1 km with eight districts: Downtown, Midtown, Old Town, the docks, Hillside, the Strand, Westgate Works and the Ferry Piers. It also has a canal with bridges, a park with a pond, an arena, a lighthouse and piers.
- **Arcade driving physics** with a bicycle model, grip and drift, handbrake slides, jumps off six stunt ramps, damage, fires and explosions, and cars that sink in the harbour. There are twelve vehicle models, from the Corso hatchback to the Strongbox armoured truck.
- **Supercars.** The Halcyon GT, the winged Vantor S and the Volantis X hypercar. Now and then one turns up in traffic or parked on the street. Otherwise you can buy one.
- **Nine weapons.** Fists, a baseball bat, a pistol, an SMG, a pump shotgun, a carbine, a scoped sniper rifle, a rocket launcher and grenades. Hip fire locks on to whoever is in front of you. Hold aim for an over-the-shoulder view where you aim with the mouse; with the sniper rifle, aiming looks down the scope. Headshots do more damage. Rockets and grenades explode: they knock people flat, wreck cars and set off the cars around them. You can shoot a pistol or SMG out of a car window. Guns reload by themselves when the magazine runs dry. Body armour soaks up damage before your health does.
- **A helicopter and a plane.** Two Skylark helicopters wait at the Pier Heliport on the west pier, and two Gull light planes at the North Shore Airstrip. Anyone can take one up. The helicopter can land anywhere flat, rooftops included, and you can get out and walk about up there. The plane takes off from the runway at about 80 km/h; fly too slowly and it stalls. Jump out high up and a parachute opens. A long fall opens one too.
- **Shops.** Walk into a lit doorway to go in:
  - **Gunwale Arms** (two of them) sells every weapon except fists, plus ammo and armour.
  - **Night Owl** corner shops (three) sell food that heals you. Show a gun and you can rob the till instead.
  - **Threadline** sells outfits.
  - **Strand Motors** sells performance cars.
  - Bea's **lock-up** keeps every car you buy and resprays them.
- **Pickups.** Guns, ammo, armour and cash are hidden around the city and come back after a while. Downed officers drop their pistols and passers-by drop cash. Dropped items vanish after 45 seconds.
- **Traffic AI.** Cars drive on the right along a lane graph, stop at red lights, queue, honk when stuck and pull over for sirens. If you shoot at a car, the driver gets out and runs.
- **Pedestrians** walk around each block, cross at corners, scatter from danger and get knocked over. If you punch one, they might hit back.
- **Police.** Crimes raise your heat on a five-bar meter. Units route through the streets to you, overtake traffic and chase you once they have line of sight. Stay out of sight long enough and the heat drops. If they box you in, you're arrested.
  - When a car pulls up close, the officers get out and come for you on foot.
  - From three bars, or sooner if you get violent in front of them, the officers shoot.
  - Shops won't serve you while you're wanted.
  - Bea's garage will respray your car to clear low heat.
- **Seven story jobs:** a road test against the clock, stealing back a debt, a van delivery that goes wrong, a street race against three rivals, tailing Halloran, and a heist finale.
- **Day and night** with a sky shader, lit windows, street lamps and moonlight.
- **Three radio stations** that compose music as you drive (pop, lo-fi and house), plus a synthesised engine, tyre screech, sirens and crashes.
- A minimap and a full city map showing shops and your cars. Your money, guns, cars and clothes are autosaved. Gamepads and touch screens are supported.

## Controls

| Key | Action |
| --- | --- |
| W A S D | drive or walk |
| Space | handbrake, or jump on foot |
| Shift | sprint |
| F | get in or out of a car, helicopter or plane |
| Mouse | look around |
| Left click | shoot or punch |
| Right click (hold) | aim; in a car, lean out to shoot |
| 1–8, mouse wheel, Tab | change weapon (1 fists or bat, 2 pistol, 3 SMG, 4 shotgun, 5 carbine, 6 sniper rifle, 7 launcher, 8 grenades) |
| R | reload on foot, or change radio station in a car |
| C | camera distance |
| H | horn |
| M | map |
| Esc | pause, or leave a shop |

**Flying.**

| Key | Helicopter | Plane |
| --- | --- | --- |
| W / S | forward / back | throttle up / slow down (brakes on the ground) |
| A / D | turn | bank left / right |
| Space | climb | nose up |
| Shift | descend | nose down |

Let go of everything and the helicopter hovers; the plane keeps flying at cruise power.

**Gamepad.** On foot, LT aims, RT shoots, X reloads, and RB or the d-pad changes weapon. In a car, hold B to aim and press X to shoot. In a helicopter, RT climbs, LT descends and the left stick flies it. In a plane, RT is the throttle, LT slows down, and the left stick pitches (pull back to climb) and banks.

**Touch.** Use the fire button to shoot. The gun button changes weapon. When flying, the Brake and Horn buttons become Up and Down.

## How it's built

- Plain ES modules with no build step. [three.js](https://threejs.org/) r170 is loaded from a CDN through an import map.
- The simulation runs at a fixed 60 Hz, separate from rendering. That code is pure JavaScript with no three.js imports, so it runs and is tested in Node:
  - `city.js` / `citygen.js`: road grid, districts, buildings, props, colliders
  - `physics.js`: vehicle dynamics and collisions against a spatial grid
  - `aircraft.js`: helicopter and plane flight, landings and crashes
  - `traffic.js`, `peds.js`, `police.js`: AI
  - `combat.js`: weapons, ray casts against people, cars and buildings, damage and pickups
  - `shops.js`: what each shop sells and what buying does. `shopui.js` draws the shop menu.
  - `missions.js`: data-driven story runner. `jobs.js` connects it to the game.
- Rendering (`js/render/`) merges the city into a few hundred draw calls, instances the props and crowds, and uses canvas-generated textures.
- Audio (`audio.js`) is Web Audio synthesis only.

## Tests

```
node --test
```

There are 52 tests. They cover:

- city generation: connectivity, no overlaps, places next to roads
- driving physics
- traffic following lanes and obeying lights
- police chases, arrests and officers on foot
- combat: ray hits, damage, reloads, shotguns, headshots, armour, the bat, rockets, grenades and the sniper scope
- flying: take-off, hovering, landing on roofs, parachutes, plane landings and crashes
- shops: purchases, robberies, cars and where things are placed
- missions playing through to completion or failure

CI runs them on every push, then deploys the game to GitHub Pages.

## Running locally

Serve the folder with any static server and open it, for example:

```
python -m http.server 8000
```
