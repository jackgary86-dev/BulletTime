# Material look checklist (#229)

Visual review only, not numbers. Each material has a replay link that fires the setup and parks the replay at a set time after first contact (`at`, in `us`, `ms` or seconds; added in #230), a baseline screenshot in `docs/screenshots/`, and what a reviewer should see. Open a link on the dev server (for example `http://localhost:5173/` + the query) and compare with the screenshot. The reference sheet `docs/material-reference/index.html` has the animated measured side views these looks come from.

If a change moves a look on purpose, retake the screenshot (same link, same time) and say why in the commit.

| Material | Replay link | Baseline | What to see |
|---|---|---|---|
| Pine | `?mode=bullet&bullet=308-sp&medium=pine&at=1ms` | `material-pine.jpg` | Dark core hole, splinter fan, radial grain cracks. |
| Drywall | `?mode=bullet&bullet=308-sp&medium=drywall&at=1ms` | `material-drywall.jpg` | Clean front hole, paper torn into petals and white dust at the back. |
| Car-door steel (sheet metal) | `?mode=bullet&bullet=308-sp&medium=sheet-metal&at=0.5ms` | `material-car-steel.jpg` | Rifle round: round perforation with a petalled rim, bright side chips, dark debris string behind the bullet. Pistol rounds dent or pit. |
| Glass | `?mode=bullet&bullet=9mm-fmj&medium=glass&at=0.5ms` | `material-glass.jpg` | Central crater, radial plus concentric cracks, shards flying. |
| AR500 | `?mode=bullet&bullet=9mm-fmj&medium=steel-ar500&at=0.5ms` | `material-ar500.jpg` | Pistol round splashes: polished dent with lead splash, no perforation, dark blow-back cloud. |
| Concrete (C35) | `?mode=bullet&bullet=308-sp&medium=concrete-c35&at=3ms` | `material-concrete.jpg` | Pale spall crater in front, much larger scab behind, a heavy dust cloud and angular chips thrown with the scab. |
| Large RHA plate (Artillery) | `?mode=artillery&bullet=76mm-ap&medium=rha-plate&at=1ms` | `material-rha-plate.jpg` | Hole, bright chips and flash sized to a 76 mm shot, not a bullet; back face dishes wide. Baseline: round hole with a ragged dark rim, bright chips and flash; the back face is not in shot at this camera. |
| Large mild plate (Artillery) | `?mode=artillery&bullet=122mm-ap&medium=mild-plate&at=1ms` | `material-mild-plate.jpg` | 20 mm plate holed by the shell, petalled rim, large chips. Baseline: 20 mm plate holed with a bent petalled rim, large flash and sparks. |
| Large AR500 plate (Missile) | `?mode=missile&medium=ar500-plate&at=1ms` | `material-ar500-plate.jpg` | Painted face blasted bare in a wide disc, no floating decals. Baseline: missile body at the face with a bare, ragged disc round the burst; the face reads as a glossy reflective sheet rather than paint. |
| Large cast iron plate (Artillery) | `?mode=artillery&bullet=76mm-ap&medium=cast-iron-plate&at=1ms` | `material-cast-iron-plate.jpg` | Brittle failure, heavy spall. Baseline (#296): matte grey plate, dark cracks radiating from the hit, a flash and, a few ms later, a cloud of dark angular chunks. |
| Reinforced concrete wall (Artillery) | `?mode=artillery&bullet=122mm-ap&medium=reinforced-concrete&at=3ms` | `material-reinforced-concrete.jpg` | Crater and spall on the face, scab and dust behind; shell-scale chunks. Baseline: crater and angular chunks on the face, spall thrown from the block; the block is small beside a 155 mm shell. |
| Packed earth berm (Artillery) | `?mode=artillery&bullet=122mm-ap&medium=packed-earth&at=3ms` | `material-packed-earth.jpg` | Soil column thrown up, long soft stop, no hole through. Baseline (#296): a sloped, lumpy earth mound with a flat struck face, a flash, and clods thrown up and back off the face. |
| Tank hull side (Artillery) | `?mode=artillery&bullet=76mm-ap&medium=tank-hull&at=1ms` | _pending_ | Hull side struck above the tracks; AP holes it, HE only marks it. |
| Turret roof (Missile) | `?mode=missile&medium=turret-roof&at=1ms` | _pending_ | Thin roof plate holed by a shaped charge from above. |
| Hull floor (Missile) | `?mode=missile&medium=hull-floor&at=1ms` | _pending_ | Thin floor plate. |
| Bunker wall (Artillery) | `?mode=artillery&bullet=122mm-ap&medium=bunker-wall&at=3ms` | _pending_ | Crater and spall on a 5 x 3 m concrete wall. |
| Block house front wall (Artillery) | `?mode=artillery&bullet=122mm-ap&medium=block-house-wall&at=3ms` | _pending_ | 300 mm wall cratered or breached. |
| Brick wall (Artillery) | `?mode=artillery&bullet=122mm-ap&medium=brick-wall-full&at=3ms` | _pending_ | Breach with brick and mortar thrown out. |
| Earth berm (Artillery) | `?mode=artillery&bullet=122mm-ap&medium=earth-berm-full&at=3ms` | _pending_ | Soil column, long soft stop. |

Figures behind these rows, and whether each is published, an engine constant or illustrative, are in `large-targets.md` (data in `src/data/largeTargetReference.ts`, #262). Baselines for the large targets were captured at 800x600, Medium quality, side camera, from a dev server. They record what the build draws today; where a row's note says a look is missing, it is still to do. Check at close and three-quarter range for clipping.


The new sheet rows end in `&view=closeup`: from the default side camera a thin sheet is a few pixels across and every material looks alike, so their links park the camera in the close-up.

Steel effects that are in the model (#219-#221): a dark blow-back cone and two droplet sheets on entry, a plug chip, an axis debris string, about ten bright side chips and 3 to 8 petals on exit, and the back face bulging about 0.3 bullet diameters before it opens. Concrete (#223-#226): hourglass footprints sized from the measured panels, a scab that lets go 1.8 / 2.2 / 2.8 ms after impact (C35 / C75 / C110), and a bullet that is a crushed stub by about 0.4 ms.

The baselines are 800x600 captures of the whole screen in the browser pane at Medium quality, side camera. The camera eases in, so small framing differences are not a regression; look at the marks.

Sheet and plate materials added in #261. Each is checked at its thinnest and its thickest stock thickness (replay links below, with `thickness` in metres). Baseline screenshots for these are _pending_: at the default side camera the plate is a few pixels across and the materials look alike, so a close-up capture (the Close preset, or a new camera link) is needed first.

| Material | Thinnest stock | Thickest stock | Baselines | What to see |
|---|---|---|---|---|
| Stainless steel (304) | `?mode=bullet&bullet=308-sp&medium=steel-stainless&thickness=0.0005&at=0.5ms&view=closeup` | `?mode=bullet&bullet=308-sp&medium=steel-stainless&thickness=0.025&at=0.5ms&view=closeup` | `material-steel-stainless-thin.jpg`, `material-steel-stainless-thick.jpg` | Bright polished dent and a clean petalled hole; slightly stronger than mild steel. |
| Galvanised steel | `?mode=bullet&bullet=308-sp&medium=steel-galvanised&thickness=0.0005&at=0.5ms&view=closeup` | `?mode=bullet&bullet=308-sp&medium=steel-galvanised&thickness=0.006&at=0.5ms&view=closeup` | `material-steel-galvanised-thin.jpg`, `material-steel-galvanised-thick.jpg` | Pale spangled sheet, clean hole, bright chips. |
| Titanium (Ti-6Al-4V) | `?mode=bullet&bullet=308-sp&medium=titanium&thickness=0.001&at=0.5ms&view=closeup` | `?mode=bullet&bullet=308-sp&medium=titanium&thickness=0.025&at=0.5ms&view=closeup` | `material-titanium-thin.jpg`, `material-titanium-thick.jpg` | Dark grey metal; stops a .308 at the thick end, bright splash. |
| Aluminium 3003 (soft) | `?mode=bullet&bullet=9mm-fmj&medium=aluminum-3003&thickness=0.0005&at=0.5ms&view=closeup` | `?mode=bullet&bullet=9mm-fmj&medium=aluminum-3003&thickness=0.025&at=0.5ms&view=closeup` | `material-aluminum-3003-thin.jpg`, `material-aluminum-3003-thick.jpg` | Soft pale sheet, a pistol round goes through all but the thickest. |
| Copper | `?mode=bullet&bullet=308-sp&medium=copper&thickness=0.0005&at=0.5ms&view=closeup` | `?mode=bullet&bullet=308-sp&medium=copper&thickness=0.012&at=0.5ms&view=closeup` | `material-copper-thin.jpg`, `material-copper-thick.jpg` | Copper-coloured sheet; soft, round hole. |
| Brass | `?mode=bullet&bullet=308-sp&medium=brass&thickness=0.0005&at=0.5ms&view=closeup` | `?mode=bullet&bullet=308-sp&medium=brass&thickness=0.012&at=0.5ms&view=closeup` | `material-brass-thin.jpg`, `material-brass-thick.jpg` | Yellow-gold sheet; clean round hole. |
| Lead | `?mode=bullet&bullet=308-sp&medium=lead-sheet&thickness=0.0008&at=0.5ms&view=closeup` | `?mode=bullet&bullet=308-sp&medium=lead-sheet&thickness=0.012&at=0.5ms&view=closeup` | `material-lead-sheet-thin.jpg`, `material-lead-sheet-thick.jpg` | Matt dark grey; the metal flows round the bullet. |
| Polycarbonate | `?mode=bullet&bullet=9mm-fmj&medium=polycarbonate&thickness=0.003&at=0.5ms&view=closeup` | `?mode=bullet&bullet=9mm-fmj&medium=polycarbonate&thickness=0.025&at=0.5ms&view=closeup` | `material-polycarbonate-thin.jpg`, `material-polycarbonate-thick.jpg` | Clear sheet that tears and stretches, no shatter; a pistol round is stopped at the thick end. |
| MDF | `?mode=bullet&bullet=308-sp&medium=mdf&thickness=0.006&at=0.5ms&view=closeup` | `?mode=bullet&bullet=308-sp&medium=mdf&thickness=0.025&at=0.5ms&view=closeup` | `material-mdf-thin.jpg`, `material-mdf-thick.jpg` | Pale board, dust and fine splinters. |
| OSB | `?mode=bullet&bullet=308-sp&medium=osb&thickness=0.0095&at=0.5ms&view=closeup` | `?mode=bullet&bullet=308-sp&medium=osb&thickness=0.018&at=0.5ms&view=closeup` | `material-osb-thin.jpg`, `material-osb-thick.jpg` | Strand board, ragged exit. |
| Cement board | `?mode=bullet&bullet=308-sp&medium=cement-board&thickness=0.006&at=0.5ms&view=closeup` | `?mode=bullet&bullet=308-sp&medium=cement-board&thickness=0.0127&at=0.5ms&view=closeup` | `material-cement-board-thin.jpg`, `material-cement-board-thick.jpg` | Grey board, cracks and grey dust. |
| Fibreglass | `?mode=bullet&bullet=308-sp&medium=fibreglass&thickness=0.002&at=0.5ms&view=closeup` | `?mode=bullet&bullet=308-sp&medium=fibreglass&thickness=0.01&at=0.5ms&view=closeup` | `material-fibreglass-thin.jpg`, `material-fibreglass-thick.jpg` | Pale sheet, splits and fuzzes at the exit. |
| Kevlar panel | `?mode=bullet&bullet=9mm-fmj&medium=kevlar&thickness=0.004&at=0.5ms&view=closeup` | `?mode=bullet&bullet=9mm-fmj&medium=kevlar&thickness=0.024&at=0.5ms&view=closeup` | `material-kevlar-thin.jpg`, `material-kevlar-thick.jpg` | Dark panel; a pistol round is caught at 8 mm and above, a thin one goes through. |
| Ceramic tile | `?mode=bullet&bullet=9mm-fmj&medium=ceramic-tile&thickness=0.006&at=0.5ms&view=closeup` | `?mode=bullet&bullet=9mm-fmj&medium=ceramic-tile&thickness=0.012&at=0.5ms&view=closeup` | `material-ceramic-tile-thin.jpg`, `material-ceramic-tile-thick.jpg` | Brittle: breaks into sharp pieces round the hit. |

> The Artillery rows in the large-target table were captured with the 155 mm HE shell, which has since left the catalogue (Artillery and Missile are armour-piercing and penetrator rounds only). Their links now fire the 122 mm AP shot; re-capture those baselines with it.
