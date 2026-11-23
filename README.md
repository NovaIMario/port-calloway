# Port Calloway

An open-world driving game that runs in the browser. You play Ash, back in the harbour town of Port Calloway to help Auntie Bea pay off a loan to Halloran, the dock boss who wants her garage.

**Play it:** https://novaimario.github.io/port-calloway/

Everything is original and generated in code: the city, the cars, the people, the textures, the sound effects and the music on the car radio. The game uses no image or audio files.

## What's in it

- **A procedural city** of about 1.1 km × 1.1 km with eight districts: Downtown, Midtown, Old Town, the docks, Hillside, the Strand, Westgate Works and the Ferry Piers. It also has a canal with bridges, a park with a pond, an arena, a lighthouse and piers.
- **Arcade driving physics** with a bicycle model, grip and drift, handbrake slides, jumps off six stunt ramps, damage, fires and explosions, and cars that sink in the harbour. There are nine vehicle models, from the Corso hatchback to the Strongbox armoured truck.
- **Traffic AI.** Cars drive on the right along a lane graph, stop at red lights, queue, honk when stuck and pull over for sirens.
- **Pedestrians** walk around each block, cross at corners, scatter from danger and get knocked over.
- **Police.** Crimes raise your heat on a five-bar meter. Units route through the streets to you, overtake traffic and chase you once they have line of sight. Stay out of sight long enough and the heat drops. If they box you in, you're arrested. Bea's garage will respray your car to clear low heat.
- **Seven story jobs:** a road test against the clock, stealing back a debt, a van delivery that goes wrong, a street race against three rivals, tailing Halloran, and a heist finale.
- **Day and night** with a sky shader, lit windows, street lamps and moonlight.
- **Three radio stations** that compose music as you drive (pop, lo-fi and house), plus a synthesised engine, tyre screech, sirens and crashes.
- A minimap, a full city map, autosave, and support for gamepads and touch screens.

## Controls

| Key | Action |
| --- | --- |
| W A S D | drive or walk |
| Space | handbrake, or jump on foot |
| Shift | sprint |
| F | get in or out of a car |
| Mouse | look around |
| R | change radio station |
| C | camera distance |
| H | horn |
| M | map |
| Esc | pause |

## How it's built

- Plain ES modules with no build step. [three.js](https://threejs.org/) r170 is loaded from a CDN through an import map.
- The simulation runs at a fixed 60 Hz, separate from rendering. That code is pure JavaScript with no three.js imports, so it runs and is tested in Node:
  - `city.js` / `citygen.js`: road grid, districts, buildings, props, colliders
  - `physics.js`: vehicle dynamics and collisions against a spatial grid
  - `traffic.js`, `peds.js`, `police.js`: AI
  - `missions.js`: data-driven story runner. `jobs.js` connects it to the game.
- Rendering (`js/render/`) merges the city into a few hundred draw calls, instances the props and crowds, and uses canvas-generated textures.
- Audio (`audio.js`) is Web Audio synthesis only.

## Tests

```
node --test
```

There are 23 tests covering city generation (connectivity, no overlaps, places next to roads), driving physics, traffic following lanes and obeying lights, police chases and arrests, and missions playing through to completion or failure. CI runs them on every push, then deploys the game to GitHub Pages.

## Running locally

Serve the folder with any static server and open it, for example:

```
python -m http.server 8000
```
