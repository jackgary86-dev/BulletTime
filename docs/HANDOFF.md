# Handoff notes

For whoever picks this project up next (a person or another agent). Written 4 October 2026. Read the README first; this covers what it does not: where things stand, how the pieces fit, and the traps.

## What this is

BulletTime is a slow-motion impact and blast lab in the browser (Vite, TypeScript, three.js) with an Electron wrapper for desktop and Steam. Repo: https://github.com/jackgary86-dev/BulletTime. Live site (GitHub Pages, deploys on every push to `main`): https://jackgary86-dev.github.io/BulletTime/.

The game opens on a launcher with five cards:

| Card | What it is | Where it lives |
|---|---|---|
| Bullet | .22 LR up to 20 mm shells, the original game | `src/data/bullets.ts` |
| Artillery | about 36 shells, 20 to 240 mm, class groups | `src/data/artillery.ts` |
| Missile | 5 airframes x 5 warheads, launch run and trail | `src/data/missiles.ts` |
| Explosion | 7 charges in a test bed, per-layer blast response | `src/data/explosives.ts`, `src/sim/blastResponse.ts` |
| Armor lab | 2D teaching cross-section of plate defeat | `src/armor/`, `src/ui/armorLab.ts` |

The first four share one engine (`src/sim/engine.ts`) and one material catalogue (`src/data/media.ts`). The Armor lab is separate: its own models; its 3D view (#172) has its own renderer in `src/armor/view3d.ts`.

## Commands

```sh
npm install
npm run dev -- --port 5291 --strictPort   # ports 5173 and 5180 may be taken by other projects; .claude/launch.json uses 5291
npx tsc --noEmit                          # type check
npx vitest run                            # all tests (about 400, a few seconds)
npm run build && npm run build:itch       # production build and the itch.io zip
```

Playback has an impact beat (#238, `src/sim/impactBeat.ts`): the clock eases to a tenth of the chosen rate just before each impact or detonation, holds for a millisecond, ramps back over three, and never goes below the slowest preset. It is a warp of real time only; scrubbing, stepping and replay links see true sim time. The "Slow down at impact" toggle in the controls panel is remembered (`src/ui/beatSetting.ts`); the Armor lab honours the same setting with a beat scaled to its playback length. Sounds at the target stretch with the beat (`cueStretch` in `src/audio/cues.ts`, `playSound(id, rate)`); the muzzle report does not.

While a shot plays, only the camera HUD's timecode and speed sit over the scene: the results panel and the shot panel's own readout step aside (`shot-playing` on the overlay, set from the render loop) and come back when playback stops or is paused (#239).

Visual regression (#243): `npm run visual` builds the site, serves it with `vite preview` and compares one frame per shot (tests/visual/visual.spec.ts) with tests/visual/references, in software WebGL at 1280×720 and Low quality; `npm run visual:update` rewrites the references after an intended change. Pages are opened with `?clean&still`: `?still` (src/scene/still.ts) freezes the film grain and rocket-trail flicker and snaps the camera, and the app sets `document.body.dataset.ready` once the scene is built and any replay link is parked. `@playwright/test` is pinned to an exact version so local references match CI's Chromium. The `visual` job in quality.yml uploads actual/diff images on failure. A full run takes about 10 minutes; a frame with a large burst can take a minute or more to render in software.

URL shortcuts: `?mode=bullet|artillery|missile|explosion|armor` skips the launcher; `?ultra` raises quality.

CI: `deploy.yml` (test, build, Pages), `quality.yml` (type check, tests, `npm audit`, gzipped-bundle budget of 600 KB), `release.yml` (installers on `v*` tags, with a launcher smoke test). Dependabot is on.

## How the simulators fit together

- A shot is simulated once into a `Timeline` (`src/sim/types.ts`): tracks, events, cavity samples, a `ShotSummary`. Playback, camera, sounds, results and every effect only read it, so all of it scrubs.
- A round is a `BulletSpec` (`src/data/bullets.ts`). Explosive rounds carry a `BlastSpec` (yield, fragments, jets, delay fuze, HESH spall); missiles have a `launch` run; armour-piercing shot is `hardCore`. `getBullet(id)` finds any round, including generated missile combinations (`missile:<airframe>:<warhead>`).
- `src/data/modes.ts` says what each simulator lists and how the camera frames it (`framingReach`).
- Effects are in `src/fx/`; blast effects are `blastEffect.ts` (fireball, ground ring, debris, panels that vanish or topple). The pure rules for what a blast does to a layer are in `src/sim/blastResponse.ts`.
- Sounds are synthesised in `src/audio/sounds.ts`; `src/audio/cues.ts` picks which sound goes with which event.

## The Armor lab (epic #157)

The contract is `src/armor/model.ts`: every penetration model takes an `ArmorShot` and returns an `ArmorTimeline` (frames, events with captions, a result). The display reads only that shape, never a model's internals. `simulate.ts` picks the model by family.

Split of work between the two sessions that were running:

- **Physics (the other session):** `fullBore.ts` (De Marre, plugging), `longRod.ts` (Alekseevskii-Tate), `jet.ts` (density law, debris cone) are done. Open: #164 HESH, #165 ricochet and obliquity, #166 field models (temperature, stress, pressure, energy), #170 HE fragments, #171 layered plates, #169 validation suite.
- **Display (done here):** `section.ts` (pure geometry: layout, crater outline, bulge, penetrator), `sectionDraw.ts` (canvas painting, heat glow, the `OVERLAYS` list), `src/ui/armorLab.ts` (controls, canvas, playback, results, explainer), `src/ui/armorDiagrams.ts` (one labelled SVG per family), the launcher card, CSS at the end of `src/style.css`. Tests: `src/armor/section.test.ts`.

What display work is left:

- **#167, overlays:** only the Energy overlay works. Temperature, stress and pressure show as disabled buttons. When #166 lands, add the field data to the timeline (an optional `fields` on `ArmorFrame`, agreed with whoever owns #166), draw it in `sectionDraw.ts`, add legends with units, and flip `ready: true` in `OVERLAYS`.
- **#172, 3D sectioned plate:** done. `section3d.ts` (pure: the plate, crater and bulge as profiles revolved half a turn, the cut-face outline, the round and the pieces in metres) and `view3d.ts` (three.js: the lab studio, a steel bench, the cut face painted with the 2D section drawing so the overlays match, emissive crater wall, fragment meshes). The "2D section / 3D view" toggle in `armorLab.ts` shares the playback clock; the 3D view is created on first use and falls back to the section without WebGL. Tests: `src/armor/section3d.test.ts`. Not done: post-processing (no bloom in the 3D view), and the plate radius follows the fragment room, so a shot wider than the plate is thin (the room sizing in `fragments.ts` is the thing to fix).
- **#173, classroom mode:** not started. `ArmorLabHandle.preset({...})` in `armorLab.ts` already sets the controls and fires, so a lesson is a list of presets with captions. Also wanted: a range stage and store screenshots.
- The explainer diagrams for HESH and HE fragments exist but those families have no model yet; the lab shows a notice ("not modelled yet") until #164 and #170 land.
- Un-modelled families throw from `simulateArmor`; the screen catches that and shows the message.

## Ticket state

Epic #186 (3 versions x 4 modes). Everything for the four simulators is closed. Still open there:

- #183 Web, #184 Desktop, #185 Steam, #207 Steam page: need the owner's itch.io page, Steamworks account, signing certificates and real screenshots/trailer. Drafts and scripts are in `steam/store-page.md`, `docs/code-signing.md`, `scripts/steam-screenshots.mjs`.
- #204 integrate Armor lab models into Artillery and Missile: waits on the Armor lab physics.
- #218 to #230 (material accuracy): built. Concrete grades, footprints, debris timeline, velocity tail, crush (`src/fx/concreteDamage.ts`, `src/sim/crush.ts`), steel blow-back, exit debris and rear dishing (`src/fx/hardEffect.ts`, `src/fx/plateDish*.ts`), results rows (`src/sim/accounting.ts`), gel reference tracks (`src/data/gelReference.ts`), the reference sheet under test and the `?at=` replay link (`src/ui/replayLink.ts`, `docs/material-reference/CHECKLIST.md`). Known gaps, pinned with wide tolerances rather than retuned: C35 speed at 0.5 ms is about 7 m/s over the trace; C110 at 155 m/s sits at its own ballistic limit, where the measured residuals scatter, so the model stops it harder than the 50 m/s trace; the model absorbs about 74% of a 160 m/s round in C35 where the sections show 84-92%; the gel temporary cavity peaks in the first 5-7% of the track, not mid-track; the TAP and black-powder stand-in rounds are tuned per round, not from a general break-up model.
- PR #178 is an older, longer take on the long-rod model; `main` already has its own version. Compare before closing.
- Seven Dependabot PRs (#211 to #217), including TypeScript 5.9 to 7.0. None reviewed; the TypeScript bump may break the build.

## Traps

- **Two sessions share this folder.** Commit small and often, `git pull --rebase --autostash origin main` before pushing, never `git checkout` or `git stash` files you did not edit, and check `git status` for untracked files that are not yours before assuming they are junk. An earlier session lost uncommitted edits to this; another overwrote a file within seconds of it being written.
- **Tests run in node, with no DOM.** Anything a test imports must not pull in three.js textures or `document` (that is why `debrisScale` lives in `src/sim/blastResponse.ts`, not in an effect file). Keep logic in pure modules and drawing in thin ones.
- **Line endings.** Files are mixed LF and CRLF and git warns on every add. Edit scripts should read and write with `newline=''` and keep whichever the file uses.
- **Shell heredocs with apostrophes** broke in the Bash tool; write files with the file tools or a script file instead.
- **Particles and effects must be pure functions of sim time** so scrubbing works. Do not keep state that advances per frame.
- **The browser pane only renders frames while a screenshot is being taken.** After firing in the dev server, take a screenshot before reading scene state; click the scrubber to reach a moment of the replay.
- **Do not publish or post without asking.** GitHub Pages was enabled with the owner's say-so; issues, comments and closes were all requested. The owner wants a ticket for everything and a short comment on each close.
- Commit messages end with the `Co-Authored-By: Claude ...` trailer given in the session.

## Where the numbers came from

Everything is a plausible game value, not engineering data: penetration is tuned to within about 2x of public muzzle figures for AP shot, 4 to 5 calibres for shaped charges, free-air overpressure uses the Mills fit, materials follow rough published strengths. The README and About text say so. Explosive content stays at yield, stand-off and fireball type with no construction detail; keep it that way.
