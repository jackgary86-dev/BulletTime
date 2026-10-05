# Large-target reference (#262)

The targets the Artillery and Missile modes shoot at. The data is in `src/data/largeTargetReference.ts` and is checked against `src/data/media.ts` and `src/armor/materials.ts` by `largeTargetReference.test.ts`, so this sheet cannot drift from the catalogue. Replay links and baselines are in `CHECKLIST.md`.

**Nothing here is measured by this project.** Each figure is one of:

- **published**: a rounded handbook or standard figure, with its source;
- **model**: a constant tuned for the engine, not a measurement;
- **illustrative**: drawn for the look only, with no data behind it.

| Target | Figure | Value | Kind |
|---|---|---|---|
| Large RHA plate | Density, yield, Brinell (about 300 HB), target resistance Rt | from `src/armor/materials.ts` (`rha`) | published |
| Large mild steel plate | Density, yield, Brinell (about 130 HB), Rt | from `src/armor/materials.ts` (`mild-steel`) | published |
| Large cast iron plate | Density, yield, Brinell (about 200 HB), Rt | from `src/armor/materials.ts` (`cast-iron`) | published |
| Large AR500 plate | Density; nominal 500 HB (the grade name) | 7850 kg/m³; 500 HB | published |
| Large AR500 plate | Resistance | 3.2 GPa | model |
| Reinforced concrete wall | Density | 2400 kg/m³ | published |
| Reinforced concrete wall | Resistance | 750 MPa | model |
| Reinforced concrete wall | Spall and scab shape at shell scale | scaled from the bullet-scale panels | illustrative |
| Packed earth berm | Density | 1800 kg/m³ | published |
| Packed earth berm | Resistance | 25 MPa | model |
| Packed earth berm | Soil column and crater | drawn for the look | illustrative |

## Not yet covered

Tank hull, turret and side armour, and brick masonry walls: they join the catalogue with the proving-ground targets (#231). Animated side views at set timestamps and contact sheets, as in the bullet-scale `index.html`, need that three-quarter range camera to be useful and are not built yet.
