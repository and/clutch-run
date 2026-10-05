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
| L | Headlights on / off |
| − / = | Volume down / up (also a slider and mute button under the minimap, and on the start and pause screens) |

To play in public, mute with the Sound button on the start screen, the speaker button in the game, or M. The game remembers it.

## Road, time and weather

The start screen picks the **road**: the hill loop, with lap times, or the **endless road**, which is built ahead of you as you drive (hills, bends, gravel stretches, villages and traffic) and keeps going for as long as you do; it counts distance instead of laps. The **time** follows your own clock by default, so it's dark at night and the sky turns orange at dusk, or you can pick morning, midday, evening or night. The **weather** can be clear, cloudy, rainy (the road grips less) or foggy. Time and weather can also be changed from the pause screen. Turn the **headlights** on with L, or the light button on a phone.

## On a phone

Hold the phone upright or sideways: upright, the road view sits on top with the dashboard and controls under it. Tilt the phone like a steering wheel to steer, or drag sideways on the road if tilt isn't available. The accelerator and brake are analog: press higher up a pedal to press harder. An H-pattern gear lever sits under the other thumb (1 3 5 on top, 2 4 R below, as in most Indian hatchbacks): drag the knob through the gate, and back to the middle rail for neutral. On Android phones each gear change clicks with a short vibration, and a refused gear grinds with a double buzz (iPhones don't let web pages vibrate). Engine, View, Road, pause, headlight and mute buttons sit above. The start screen asks for right-hand drive (gears on the left, as in India) or left-hand drive (mirrored). The clutch is automatic on phones. Automatic mode, chosen on the start screen, swaps the lever for a P R N D selector and changes gear by itself in D: lay the phone flat to coast, lift its top edge to accelerate (fully by about 55 degrees). P and R, and D after reversing, need the car stopped; P holds it still. Add `?touch` to the URL to try the phone controls on a computer.

## How it works

- `src/drivetrain.js` models the engine (torque curve, idle, stalling), the clutch and a 5-speed gearbox, with the same gear ratios as the car in [Reading the Rev Counter](https://and.github.io/cars/rev-counter/).
- `src/world.js` builds the terrain, the road loop, the village and trees in code, so there are no model files.
- `src/audio.js` synthesises the engine, tyres, crashes and gear grinds with the Web Audio API, so there are no sound files.
- `src/endless.js` builds the endless road: road ahead, land tiles around the car, villages and signs, all cleared away behind.
- `src/sky.js` sets the sky, sun, fog, stars and rain from the time of day and the weather.
- `src/touch.js` handles the phone controls: tilt steering, the analog pedals and the buttons.
- `src/hud.js` draws the rev counter, speedometer, gear, pedals and minimap.
- `lib/three.module.min.js` is [three.js](https://threejs.org) r160 (MIT licence).

No build step: serve the folder with any static server, for example `python3 -m http.server`.
