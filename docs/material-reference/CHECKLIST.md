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
| Large mild plate (Artillery) | `?mode=artillery&bullet=155mm-he&medium=mild-plate&at=1ms` | `material-mild-plate.jpg` | 20 mm plate holed by the shell, petalled rim, large chips. Baseline: 20 mm plate holed with a bent petalled rim, large flash and sparks. |
| Large AR500 plate (Missile) | `?mode=missile&medium=ar500-plate&at=1ms` | `material-ar500-plate.jpg` | Painted face blasted bare in a wide disc, no floating decals. Baseline: missile body at the face with a bare, ragged disc round the burst; the face reads as a glossy reflective sheet rather than paint. |
| Large cast iron plate (Artillery) | `?mode=artillery&bullet=76mm-ap&medium=cast-iron-plate&at=1ms` | `material-cast-iron-plate.jpg` | Brittle failure, heavy spall. Baseline shows only a flash and sparks: no visible brittle failure or spall at 1 ms. The look does not yet match the model. |
| Reinforced concrete wall (Artillery) | `?mode=artillery&bullet=155mm-he&medium=reinforced-concrete&at=3ms` | `material-reinforced-concrete.jpg` | Crater and spall on the face, scab and dust behind; shell-scale chunks. Baseline: crater and angular chunks on the face, spall thrown from the block; the block is small beside a 155 mm shell. |
| Packed earth berm (Artillery) | `?mode=artillery&bullet=155mm-he&medium=packed-earth&at=3ms` | `material-packed-earth.jpg` | Soil column thrown up, long soft stop, no hole through. Baseline: a sandbag-shaped bag with a small debris puff; no soil column and no berm shape. The look does not yet match the model. |

Figures behind these rows, and whether each is published, an engine constant or illustrative, are in `large-targets.md` (data in `src/data/largeTargetReference.ts`, #262). Baselines for the large targets were captured at 800x600, Medium quality, side camera, from a dev server. They record what the build draws today, which for the cast iron plate and the packed earth berm is not yet what the "What to see" column asks for: those two rows say so. Check at close and three-quarter range for clipping.


Steel effects that are in the model (#219-#221): a dark blow-back cone and two droplet sheets on entry, a plug chip, an axis debris string, about ten bright side chips and 3 to 8 petals on exit, and the back face bulging about 0.3 bullet diameters before it opens. Concrete (#223-#226): hourglass footprints sized from the measured panels, a scab that lets go 1.8 / 2.2 / 2.8 ms after impact (C35 / C75 / C110), and a bullet that is a crushed stub by about 0.4 ms.

The baselines are 800x600 captures of the whole screen in the browser pane at Medium quality, side camera. The camera eases in, so small framing differences are not a regression; look at the marks.
