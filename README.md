# BulletTime

A slow-motion bullet impact simulator in the browser. Pick a round and a target, press **Fire**, and watch the shot at up to 1/100,000× speed. You can see the bullet yaw, expand or fragment, the temporary cavity balloon through ballistic gel, glass crack, concrete crater and steel spark. Scrub back and forth through any moment of it.

**Live app:** https://jackgary86-dev.github.io/BulletTime/

![A .308 soft point opening a cavity in 10% ballistic gel, high-speed lighting](docs/screenshots/gel-308-highspeed.png)

> BulletTime is an entertainment and education tool. Its physics is plausible and tuned to published reference numbers, but it is a simplified model, **not** a validated engineering or forensic one. See *About* in the app.

## Features

- **12 rounds** from .22 LR to .50 BMG: FMJ, hollow points, soft points, a fragmenting 5.56, buckshot, a slug, and a 20 mm HEI shell just for fun. Each has a true-scale 3D model and real-world data.
- **Targets:**
  - 10% ballistic gel and a water tank.
  - Pine and oak boards and drywall.
  - A concrete block and a hollow cinder block.
  - Mild and AR500 steel plate, a sandbag, glass and ice.
  - Organic lab targets: gel with blood packs, MythBusters style, and a clinical **ballistic test dummy** with bone, brain, lung and organ simulants.
- **Layered targets:** stack up to four layers with air gaps, for example a wall, a wooden fence, a car door, auto glass or a cinder block in front of a gel block.
- **Physics:** a precomputed timeline at 1 µs steps. It models drag and material resistance, yaw, expansion, fragmentation, ricochet, shells of hollow targets, and the temporary and permanent wound cavity in gel.
- **Effects for each material:**
  - Gel and water: the cavity, splash and bubbles.
  - Wood: splinters and exit spall.
  - Concrete: craters and dust.
  - Steel: sparks and splatter.
  - Glass: radial and concentric cracks, and shards.
  - Organic targets: bursting blood packs and bone fragments.
- **Playback:** slow-motion presets, frame stepping and a scrubber with event markers.
- **Camera presets:** auto, side, tracking, close-up and free orbit.
- **Lighting:** lab and high-speed (back-lit) modes.
- **Multiple shots:** aim anywhere on the face and fire single shots, groups or bursts. Each new shot meets the damage already in the target.
- **Results:** impact speed and energy, penetration, exit speed, the bullet's final state, peak cavity, energy into the target, a velocity-vs-depth chart, and per-layer and blood-pack details.
- **Compare:** two setups side by side on one synced clock.
- **Quality:** Low, Medium and High, for laptops and tablets.

| Layered and hollow targets | Clinical test dummy |
| --- | --- |
| ![Cinder block](docs/screenshots/cinder-block.png) | ![Test dummy](docs/screenshots/test-dummy.png) |
| **Side-by-side comparison** | **Results panel** |
| ![Compare mode](docs/screenshots/compare.png) | ![Results](docs/screenshots/results.png) |

## Running it

You need Node 20.15 or newer.

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest physics suite
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
npm run build:itch # itch.io upload: release/bullettime-web-<version>.zip
```

Every push to `main` is tested, built and published to GitHub Pages by `.github/workflows/deploy.yml`. Production builds use the base path `/BulletTime/`. Set `VITE_BASE=/` when building for a custom domain.

## Publishing on itch.io

`npm run build:itch` builds with relative paths into `dist-itch/` and zips it to `release/bullettime-web-<version>.zip`, with `index.html` at the root of the zip. CI also attaches that zip to every `main` build as the `bullettime-web-itch` artifact. The game makes no external requests, so it works inside itch.io's iframe.

On itch.io (needs your account):

1. **Create new project** → Kind of project: **HTML**.
2. Upload the zip and tick **This file will be played in the browser**.
3. Embed options: viewport **1600 × 900**, tick **Fullscreen button** and **Automatically start on page load** off (the content warning shows first anyway).
4. Under **Content**, tick the mature content box (simulated blood and human-shaped targets) and set the age rating questionnaire answers to match.
5. Set **Pricing** (paid, or "No payments" for a free demo) and publish.

## How it fits together

```
src/
  data/      catalogue and tuning: bullets.ts, media.ts, physics.ts, stacks.ts, organic.ts, dummy.ts
  sim/       engine.ts (the physics), session.ts (multi-shot), playback.ts, *.test.ts
  models/    procedural 3D: bullet.ts, targets.ts, dummy.ts, textures.ts
  fx/        impact effects, all pure functions of sim time so they scrub
  scene/     renderer, studio, camera director, post-processing, quality levels
  ui/        the panels
  lane.ts    one shooting lane (scene + target + shots); compare mode runs two
  main.ts    wires it all together
```

A shot is simulated once, up front, into a `Timeline`. That timeline holds the projectile tracks (keyframes), events (impact, enter, exit, expand, ricochet and so on) and cavity samples. Playback, the camera and every effect just read that timeline at the current sim time.

## Adding a round

Add an entry to `BULLETS` in `src/data/bullets.ts`. The selector, 3D model and physics all read from that list.

```ts
{
  id: '40sw-jhp',                 // unique, used in URLs and tests
  name: '.40 S&W',
  type: 'JHP',
  description: 'One or two sentences shown under the data card.',
  caliberMm: 10.16,
  lengthMm: 15.2,
  massGrains: 165,
  muzzleVelocityMs: 340,
  behaviour: 'expand',            // intact | expand | fragment | shot | explosive
  shape: 'hollowPoint',           // picks the procedural model (see models/bullet.ts)
  noseDragFactor: 1.0,            // 1 = blunt cylinder; lower for pointed noses
  expansionRatio: 1.7,            // 'expand': final / original diameter
  expansionThresholdMs: 260,      // 'expand': minimum impact speed to open
}
```

Other optional fields are `fragmentThresholdMs` (for `fragment`), `pellets` and `spreadPerMetre` (for `shot`), and `yawNeckM` (where a pointed FMJ starts to tumble in gel). Each field is documented in `BulletSpec`.

Then:

1. Run `npm run dev`, fire the new round into 10% gel, and compare its depth with a published gel test.
2. Run `npm test`. The **tuning baseline** in `src/sim/baseline.test.ts` checks that every catalogue round has a row, so add one. The quickest way is to copy the values the new round actually produces once you are happy with them.

## Adding a medium

Add an entry to `MEDIA` in `src/data/media.ts`:

```ts
{
  id: 'plywood',
  name: 'Plywood (18 mm)',
  description: 'Shown under the target picker.',
  behaviour: 'wood',              // which physics and effect family: gel, water, wood, drywall,
                                  // concrete, steel, sand, glass, ice, bone
  look: 'pine',                   // which procedural model builds it (models/targets.ts)
  density: 600,                   // kg/m³
  thickness: { min: 0.009, max: 0.036, default: 0.018 },
  heightM: 0.6,
  widthM: 0.6,
  angleAdjustable: true,
  dragCoefficient: 0.9,
  resistancePa: 30e6,             // material strength × frontal area slows the bullet
  hardness: 0.2,                  // 0 soft … 1 hardened steel: deformation and ricochet
  ricochetAngleDeg: 80,           // omit if it never ricochets
  yawNeckScale: 0.5,
  allowsExpansion: false,
}
```

- `behaviour` decides the physics rules and the impact effects. A new medium that behaves like an existing family needs no code.
- `look` decides the 3D model. A new appearance means adding a case to `buildBody` in `src/models/targets.ts`.
- Gel-like media also take `cavityPressurePa`, which sets the cavity size. Hollow targets take `shellM`.

Tune `resistancePa` and `dragCoefficient` until a reference round behaves as published. Then run `npm test` and add the medium to the barrier table in `baseline.test.ts` if you want it pinned.

## Choices made where the brief was open

- **Realistic, not stylised:** PBR materials, a dark lab studio with a measurement board, and an optional bright "high-speed camera" look.
- **Organic targets are lab simulants only:** gel with blood packs (MythBusters style) and a clinical gel test dummy with synthetic bone and organ simulants. There are no realistic people or animals. The dummy is drawn as a cutaway so the wound channel stays visible from the side.
- **Precomputed physics:** the whole shot is simulated on Fire, which makes scrubbing, replays and comparison exact and cheap. The model is empirical: drag plus a material-strength term, with thresholds for expansion, yaw, fragmentation and ricochet. It is tuned so 9mm FMJ goes about 65 cm in gel, 9mm JHP about 35 cm and .22 LR about 28 cm.
- **Layered targets are slabs:** each layer is infinite across the shot line in the physics, so aiming is kept within each target's face. In the test dummy, the aim stays within a few centimetres of each region's centre. Ribs other than the sternum are visual only.
- **Multiple shots** remember the damage in the target. A later round down an existing channel meets much less resistance.
- **Compare mode** fires both setups fresh from t = 0 on every Fire, so they stay in step.
- **The 20 mm HEI shell** is in the list as a clearly-marked fun option.
- **Deployment:** GitHub Pages from `main`, with one pull request per ticket.

## License

BulletTime is proprietary: all rights reserved, see [LICENSE](LICENSE). The open-source parts it ships with (three.js, MIT; the Inter, Barlow Condensed and JetBrains Mono fonts, SIL OFL 1.1) keep their own licenses, listed in [THIRD_PARTY_LICENSES.txt](public/THIRD_PARTY_LICENSES.txt) and in the in-game About dialog.
