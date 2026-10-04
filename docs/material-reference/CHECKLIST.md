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
| Large RHA plate (Artillery) | `?mode=artillery&bullet=76mm-ap&medium=rha-plate&at=1ms` | _pending_ | Hole, bright chips and flash sized to a 76 mm shot, not a bullet; back face dishes wide. |
| Large mild plate (Artillery) | `?mode=artillery&bullet=155mm-he&medium=mild-plate&at=1ms` | _pending_ | 20 mm plate holed by the shell, petalled rim, large chips. |
| Large AR500 plate (Missile) | `?mode=missile&medium=ar500-plate&at=1ms` | _pending_ | Painted face blasted bare in a wide disc, no floating decals. |
| Large cast iron plate (Artillery) | `?mode=artillery&bullet=76mm-ap&medium=cast-iron-plate&at=1ms` | _pending_ | Brittle failure, heavy spall. |

Baselines for the large plates are _pending_: they need the dev server and a browser capture (#234). Check at close and three-quarter range for clipping.


Steel effects that are in the model (#219-#221): a dark blow-back cone and two droplet sheets on entry, a plug chip, an axis debris string, about ten bright side chips and 3 to 8 petals on exit, and the back face bulging about 0.3 bullet diameters before it opens. Concrete (#223-#226): hourglass footprints sized from the measured panels, a scab that lets go 1.8 / 2.2 / 2.8 ms after impact (C35 / C75 / C110), and a bullet that is a crushed stub by about 0.4 ms.

The baselines are 800x600 captures of the whole screen in the browser pane at Medium quality, side camera. The camera eases in, so small framing differences are not a regression; look at the marks.
