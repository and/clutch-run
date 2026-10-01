# Clutch Run

A 3D driving game that runs in the browser. You drive a manual hatchback round a hill loop (village streets, a steep climb, a gravel stretch and a long descent) and change the gears yourself. Keep the revs in the green, keep left, and don't hit the traffic.

Play it at **https://and.github.io/clutch-run/**

## Controls

Pick a layout on the start screen. **Standard** is below. **Pedals on arrows** puts the clutch, brake and accelerator on ← ↓ →, like a real car's pedals, with ↑ as the handbrake and A / D to steer.

| Keys | Action |
| --- | --- |
| W / S | Accelerate / brake |
| A / D (or arrows) | Steer |
| 1–5, R, N | Select a gear, reverse, neutral |
| E / Q | Change up / change down |
| Shift | Clutch pedal (full manual mode). Let go and it rises slowly through the bite point; tap to hold it there |
| Space | Handbrake |
| I | Switch the engine on or off (restarts it after a stall) |
| H / V / T | Horn / view (behind the car, driver's seat, bonnet) / back to the road |
| C / M / P | Clutch mode / sound / pause |
| − / = | Volume down / up (also a slider and mute button under the minimap, and on the start and pause screens) |

## How it works

- `src/drivetrain.js` models the engine (torque curve, idle, stalling), the clutch and a 5-speed gearbox, with the same gear ratios as the car in [Reading the Rev Counter](https://and.github.io/cars/rev-counter/).
- `src/world.js` builds the terrain, the road loop, the village and trees in code, so there are no model files.
- `src/audio.js` synthesises the engine, tyres, crashes and gear grinds with the Web Audio API, so there are no sound files.
- `src/hud.js` draws the rev counter, speedometer, gear, pedals and minimap.
- `lib/three.module.min.js` is [three.js](https://threejs.org) r160 (MIT licence).

No build step: serve the folder with any static server, for example `python3 -m http.server`.
