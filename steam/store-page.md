# Steam store page draft

Copy for the Steamworks store page. Edit freely; nothing here is read by the build.

## Short description (up to 300 characters)

Watch rounds, shells, missiles and explosions hit gel, steel, concrete, wood and glass in slow motion up to 1/100,000x, then scrub through every moment. Four simulators, one lab.

## About this game

BulletTime is a slow-motion impact lab. Pick something to fire or detonate, pick what it hits, press **Fire**, and watch the physics play out one microsecond at a time.

**Four simulators**

- **Bullet:** .22 LR up to a 20 mm cannon shell. Watch bullets yaw, expand and fragment, the temporary cavity balloon through ballistic gel, glass crack, concrete crater and steel spark.
- **Artillery:** about 30 shells from 20 mm to 240 mm: AP, APFSDS, HE, HEAT, HESH, APHE and delay-fuzed shells from autocannon, anti-tank guns, naval guns, mortars, recoilless rifles, howitzers and tank guns, against armour plate, reinforced concrete and packed earth.
- **Missile:** five basic missiles, each fitted with any of five warheads: shaped charge, tandem, blast-fragmentation, kinetic penetrator or thermobaric.
- **Explosion:** a test bed of seven charges at a stand-off you choose. Glass shatters, drywall and wood fail, concrete cracks and steel holds, all driven by the blast pressure that reaches each panel.

**Features**

- Layered targets: stack up to four layers with air gaps.
- Lab-style targets: ballistic gel, water, wood, drywall, concrete, steel, sandbags, glass, ice, bowling balls, a watermelon and a clinical test dummy.
- Scrub back and forth through any moment, compare two setups side by side, and read the numbers: speed, energy, penetration, overpressure.
- An optional reduced-gore setting shows blood as a clear blue simulant.
- Runs offline. No accounts, no network.

The physics is plausible and tuned to look right; it is **not** a validated engineering model.

## Tags

Simulation, Physics, Sandbox, Educational, Singleplayer, Realistic, Relaxing, Casual

## Mature content survey

- Frequent violence or gore: yes (simulated blood and human-shaped ballistic test dummies, with a reduced-gore option).
- Content descriptors to enter: firearms, artillery, missiles and explosions shown as lab tests; no real people, no real-world targets and no instructions for building anything.
- A content warning is shown on first launch, and the game is aimed at ages 17 and over.

## Screenshots (at least 5, 1920x1080)

`npm run screenshots:steam` takes all six into `steam/screenshots/` (add `-- --only 2,3` to retake some). The PNGs are about 2 MB each, so they are git-ignored; run the command to regenerate them. The scenes are in `electron/screenshots.cjs`; adjust a scene's `t` (how far through the shot to scrub) if the physics changes, and retake them before the store page goes live. The Steamworks upload still needs your own pick of the final set.

1. The launcher with all four simulators.
2. A 9 mm hollow point in gel, side camera, mid-cavity.
3. A 155 mm HE shell bursting on reinforced concrete.
4. A shaped-charge missile boring through armour plate, with the results chart.
5. A demolition block going off in front of a plywood panel, shock distortion visible.
6. Compare mode: two setups side by side.

## Trailer

30 to 60 seconds: one shot from each simulator at full speed, then the same shot at 1/10,000x, ending on the launcher.
