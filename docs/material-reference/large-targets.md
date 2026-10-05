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
| Tank (hull side) | Density, yield, Brinell, Rt | RHA figures from `src/armor/materials.ts` | published |
| Tank (hull side) | Default thickness (70 mm) | chosen so shells separate; not a real vehicle | illustrative |
| Turret roof plate | Density, yield, Brinell, Rt | RHA figures; default 40 mm is illustrative | published / illustrative |
| Hull floor plate | Density, yield, Brinell, Rt | RHA figures; default 20 mm is illustrative | published / illustrative |
| Bunker wall (full size) | Density | 2400 kg/m³ | published |
| Bunker wall (full size) | Resistance | 750 MPa | model |
| Bunker wall (full size) | Crater, spall and scab at shell scale | scaled from bullet-scale panels | illustrative |
| Block house (front wall) | Density; resistance | 2400 kg/m³ published; 750 MPa model | published / model |
| Brick wall (full size) | Density | 1900 kg/m³ | published |
| Brick wall (full size) | Resistance | 120 MPa | model |
| Brick wall (full size) | Breach spray | drawn for the look | illustrative |
| Earth berm (full size) | Density | 1800 kg/m³ | published |
| Earth berm (full size) | Resistance | 25 MPa | model |
| Earth berm (full size) | Soil column and crater | drawn for the look | illustrative |

## Not yet covered

Animated side views at set timestamps and contact sheets, as in the bullet-scale `index.html`, are not built yet; the three-quarter range camera they need is now in.
