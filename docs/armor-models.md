# Armor lab model notes

Where each number in the Armor lab comes from, what each model leaves out, and how far to trust it. Written for the About dialog's link and for anyone changing a constant.

## Read this first: teaching approximations

Everything in the Armor lab is a **simplified teaching model of what happens at the plate**. It is the level of an undergraduate terminal-ballistics course or a textbook worked example, not an engineering or design tool.

- It models **impact outcomes only**: penetration, plugging, erosion, stress waves, spall, ricochet, heating. It does **not** model how any munition is designed or built. A round is described only by its state at the plate: material, diameter, length, mass, speed, and for a jet its tip and tail speed and length. Explosive content stays at that level.
- The equations are the classical ones from the open literature. Several constants and shapes (marked **lab heuristic** below) are chosen so the picture looks right and the outcome falls in a published range. They are not measured data.
- The fields (temperature, stress, pressure) are **analytic approximations driven by the penetration timeline**. They are not a finite-element solve, and the legend says so.
- Do not use any number for design, safety, legal or purchasing decisions.

`src/armor/validation.test.ts` pins the lab to the reference values below. Changing a key constant (a material's Rt, a family's speed, a model's exponent) makes at least one of those tests fail.

Trust levels used below: **Good** (the equation is standard and the numbers are within the published range), **Fair** (right trend, numbers within about a factor of two), **Illustrative** (shape and behaviour only).

## Shared pieces

### Plates (`materials.ts`)

Rounded handbook figures (ASM, MatWeb) and the target-resistance values used with the Tate model in the open literature.

| Plate | Density kg/m³ | Yield GPa | Rt GPa | Brinell | Spall strength GPa | Sound speed m/s | Melting °C | RHA thickness factor |
|---|---|---|---|---|---|---|---|---|
| RHA | 7,850 | 1.0 | 5.5 | 300 | 4.0 | 5,900 | 1,500 | 1.00 |
| Mild steel | 7,850 | 0.3 | 2.8 | 130 | 1.8 | 5,900 | 1,510 | 0.75 |
| Cast iron | 7,200 | 0.4 | 3.6 | 200 | 0.6 | 4,600 | 1,200 | 0.80 |
| Copper | 8,960 | 0.2 | 2.0 | 60 | 1.3 | 4,760 | 1,085 | 0.55 |
| Aluminium 5083 | 2,660 | 0.23 | 1.3 | 75 | 1.0 | 6,320 | 600 | 0.35 |

Rt is "several times yield" by construction; the RHA thickness factor (a plate of this material resists like factor × thickness of RHA) is a lab simplification. Trust: **Fair**.

### Munitions (`munitions.ts`)

Each family is its state at impact, scaled with the gun calibre (40 to 150 mm):

- **Full-bore AP shot:** steel, 7,850 kg/m³, mass 10.2 kg at 88 mm scaling with calibre³, 700 to 1,050 m/s.
- **APFSDS rod:** tungsten alloy, 17,600 kg/m³, yield 1.5 GPa, diameter 27/120 of the calibre, length-to-diameter 15 at 40 mm rising to 26 at 120 mm, 1,400 to 1,800 m/s.
- **HEAT jet:** copper, 8,960 kg/m³, cone 0.8 of the calibre, tip 8,000 m/s and tail 2,000 m/s, effective length chosen so the density law gives about six cone diameters into RHA.
- **HESH:** steel, 17 kg at 120 mm scaling with calibre³, 400 to 800 m/s.

Trust: **Fair**. Proportions are typical rounded open figures.

### The timeline contract (`model.ts`)

Every model returns the same `ArmorTimeline`: frames, events with captions, a result. The display, the fields and the stack read only that. Line-of-sight thickness is `T / cos θ` everywhere (`losThickness`).

## Full-bore AP shot (`fullBore.ts`, #161)

**Model.** De Marre's ballistic limit, then a constant-resistance dig and plugging.

- Ballistic limit: `v_bl = K · D^0.75 · T^0.7 / m^0.5`, solved for the RHA thickness a shot just gets through, `P = (v · m^0.5 / (K · D^0.75))^(1/0.7)`.
- Dig: Robins-Euler constant resistance, so `v²` falls linearly with depth and the shot stops after `2S / v0`.
- Plug: once the plate ahead of the nose is `PLUG_RATIO` (0.7) calibres thick, a plug shears out and shot and plug share momentum (Recht and Ipson, 1963).
- Shatter: steel shot on a plate of 250 HB or harder above 55° breaks up and gets 0.75 of its penetration.

**Parameters.** `K = 70,000` (SI), fitted so an 88 mm, 10.2 kg shot at 1,000 m/s gets through about 165 mm of RHA, the historical reference figure. Other plates divide P by their RHA thickness factor.

**Sources.** De Marre (1886); Backman and Goldsmith, "The mechanics of penetration of projectiles into targets", *Int. J. Engng Sci.* 16 (1978); Recht and Ipson, *J. Appl. Mech.* 30 (1963); Zukas et al., *Impact Dynamics* (1982).

**Lab heuristics.** Plug onset and width, the rear bulge, the shatter rule and its factor.

**Limits.** No petalling, no hardness-dependent nose failure, no strain-rate effects. The model is only calibrated for steel shot at 700 to 1,050 m/s. Slopes are clamped at 75° (beyond that the shot ricochets, see below).

**Validated against.** The 88 mm reference case within ±10%, the `v^(1/0.7)` scaling, line-of-sight thickness, the RHA thickness factor. Trust: **Good** for the reference case, **Fair** elsewhere.

## Long-rod APFSDS (`longRod.ts`, #162)

**Model.** Alekseevskii-Tate. With `v` the rod's tail speed, `u` the crater-bottom speed, `L` the remaining rod length and `P` the depth:

- interface: `½ρp(v − u)² + Yp = ½ρt·u² + Rt`
- rod: `dv/dt = −Yp / (ρp·L)`, `dL/dt = −(v − u)`
- penetration: `dP/dt = u`

Two special cases: a **rigid rod** when `Yp − Rt > ½ρt·v²` (digs without eroding), and **no penetration** when `½ρp·v² ≤ Rt − Yp`. In the hydrodynamic limit (strength negligible) `u = v / (1 + √(ρt/ρp))` and `P = L · √(ρp/ρt)`.

**Parameters.** `Yp` from `PENETRATOR_YIELD` (1.5 GPa for the tungsten alloy), `Rt` from the plate catalogue. The crater is `CRATER_DIAMETER_RATIO` (2) rod diameters wide at its mouth.

**Sources.** Alekseevskii (1966); Tate, *J. Mech. Phys. Solids* 15 (1967); Anderson and Walker, "An examination of long-rod penetration", *Int. J. Impact Eng.* 11 (1991); Zukas, *Impact Dynamics*.

**Lab heuristics.** Breakout when the crater is within one rod diameter of the rear face, the crater taper and head width, the rear bulge.

**Limits.** No rod bending or breakup, no yaw (a stack adds a simple yaw, see below), no plate-thickness or finite-target effects beyond breakout. Slopes are clamped at 70°.

**Validated against.** A 120 mm-class rod lands in 550 to 750 mm of RHA (about 600 mm at 1,650 m/s), penetration is below the hydrodynamic limit on any plate that resists more than the rod yields (`Rt > Yp`), rises with speed and saturates toward the limit, and the interface equation is satisfied. Note the limit **can be passed** when the rod is stronger than the plate resists (tungsten in aluminium), which Tate predicts and the model reproduces. Trust: **Good** for RHA, **Fair** for the other plates.

## Shaped-charge jet (`jet.ts`, #163)

**Model.** The density law. With the jet at speed `v` and the crater bottom at `u`, equal pressure at the interface gives `u = v / (1 + γ)`, `γ = √(ρt/ρj)`, and each length `dℓ` of jet consumed digs `dℓ / γ`. A jet of effective length `L` reaches `P = L · √(ρj/ρt)`. The jet has a linear velocity gradient from tip to tail, so in closed form `v(t) = v_tip · e^(−t/K)` with `K = ((1 + γ)/γ) · L/Δv`. The last 5% of the length (the slow tail slug) lodges in the hole.

**Parameters.** Tip 8,000 m/s, tail 2,000 m/s, `L` set so copper into RHA gives about six cone diameters. Hole entry diameter 0.25 and deep diameter 0.1 cone diameters.

**Sources.** Birkhoff, MacDougall, Pugh and Taylor, *J. Appl. Phys.* 19 (1948); Walters and Zukas, *Fundamentals of Shaped Charges* (1989); Zukas, *Impact Dynamics*.

**Lab heuristics.** The hole profile, the behind-armor debris cone (30° half-angle) and its spall, the unfuzed skid above 80°. Standoff, stretching and particulation are only drawn (a stack adds a simple gap efficiency, see below).

**Limits.** Strength of the plate is ignored (hydrodynamic). No jet breakup time, no off-axis drift.

**Validated against.** About 5 to 7 cone diameters into RHA, `√(ρj/ρt)` scaling across plates (aluminium about 1.7 times RHA). Trust: **Good** for the scaling, **Fair** for absolute depth.

## HESH squash head (`hesh.ts`, #164)

**Model.** A one-dimensional stress wave. The charge flattens into a contact patch of about one calibre and drives a triangular compression pulse of length `λ = 0.25 D` into the plate. It crosses at the plate's longitudinal sound speed, weakening with distance: `σ_rear = σ0 · cos θ / (1 + (x / (2.5 a))²)`. At the free rear face the pulse reflects inverted as tension. Where the tension beats the spall strength a scab tears off: thickness `x_s = λ · σ_spall / (2 · σ_rear)`, speed `2(σ_rear − σ_spall) / (ρ·c)`, radius about the contact patch.

**Parameters.** Contact stress `σ0 = 8 GPa`, a lab value set by the explosive and not by the calibre; spall strengths from the plate catalogue (cast iron 0.6 GPa against RHA 4 GPa).

**Sources.** The one-dimensional stress-wave and spall treatment in Meyers, *Dynamic Behavior of Materials* (1994), and Johnson, *Impact Strength of Materials* (1972); Zukas, *Impact Dynamics*.

**Lab heuristics.** The contact stress, the decay length, the pulse length ratio.

**Limits.** One-dimensional: no lateral release waves in the stress, no multiple spall layers, no cracking before the scab forms. Slopes are clamped at 70°.

**Validated against.** A thin RHA plate (about a calibre) spalls, plates over about a calibre and a half do not, cast iron spalls through more thickness than RHA, and a slope cuts the spall thickness. Trust: **Fair** (right behaviour, the 8 GPa is illustrative).

## Ricochet and obliquity (`ricochet.ts`, #165)

**Model.** Above a critical slope a kinetic round glances off. The critical slope is an empirical rule of thumb:

| Family | Base, RHA at default speed | Softer plate | Faster round |
|---|---|---|---|
| Full-bore shot | 65° | up to +8° (a plate of no hardness) | ±3° across the speed range |
| Long rod | 78° | up to +5° | ±2° across the speed range |

On RHA at default speed that gives about 68° for shot and 80° for a rod, inside the published ranges (shot 60 to 70°, rods 75 to 80°). The exit is a restitution-and-friction model: the speed into the plate keeps 0.3 of its size, the speed along it keeps 0.8; a gouge is cut about 0.3 calibres deep at the critical slope and shallows toward grazing. Full-bore steel shot on RHA also shatters.

A shaped-charge round does not ricochet: above 80° it fails to fuze and skids (`jet.ts`). A squash head sticks to the face.

**Sources.** The rules of thumb in Zukas, *Impact Dynamics*, and Rosenberg and Dekel, *Terminal Ballistics* (2012). The exit model is a lab model.

**Limits.** No rod bending, no spin, no dependence on nose shape. Rods and shot are clamped at 70° and 75° in their penetration models, so between the clamp and the threshold they behave as at the clamp.

**Validated against.** The threshold ranges per family, the softer-plate and the speed trends, never ricochet at 0°. Trust: **Illustrative** (the numbers are rules of thumb).

## Thrown pieces (`fragments.ts`, #165)

Plugs, scabs, jet and spall debris, the pieces of a shattered shot and a ricochet fly ballistically, tumble, and bounce off the floor and walls of a small test room, then slide to rest. Each flight is a list of closed-form constant-acceleration legs, so it is a pure function of time and scrubs. Restitution 0.35 (floor) and 0.4 (walls), friction 0.5, gravity 9.81 m/s². All **lab values**; the count and sizes of the debris pieces are illustrative. Trust: **Illustrative**.

## Fields (`fields.ts`, #166)

Analytic approximations of the picture, in real units:

- **Temperature.** Plastic work heats the metal round the crater wall: rise `= η · E / (ρ · c · V)` over a zone of width `0.6` crater radii with an exponential fall-off, `η = 0.9` (Taylor-Quinney; Taylor and Quinney, 1934). Conduction spreads it with the real diffusivity. A sheared plug leaves an adiabatic shear band round its edge. The metal never exceeds melting except in a flagged molten jet or rod interface, where the rise is concentrated 2.5 times (a lab value).
- **Stress over yield.** Highest at the penetrator's nose, about `Rt / Y`, falling with distance as `(r_n / (r_n + d))²`, switched off when the penetrator stops. At least 1 is the plastic zone.
- **Pressure.** A compression front at `c · t` from the impact, initial pressure about the plate's impedance times half the impact speed (a matched-impedance estimate, capped at 3 Rt), falling as `1/r`, reflecting off the rear face as tension (an image source). A squash head uses its own planar pulse.
- **Energy.** Remaining kinetic energy, plastic work, heat, thrown metal and the penetrator that gets through add up to the impact energy within 2% at every instant, which also checks that every model accounts for its energy.

**Sources.** Textbook stress-wave and adiabatic-heating treatments (Meyers, *Dynamic Behavior of Materials*; Zukas, *Impact Dynamics*). The shapes and the interface boost are lab choices.

**Limits.** Not a finite-element solve: no wave interaction with the crater, no shock heating, no phase change beyond the molten flag, no strain-rate hardening. **Validated against** the energy balance, the front at `c · t`, finiteness and continuity. Trust: **Illustrative** for absolute values, **Good** for the energy balance.

## Spaced and layered plates (`stack.ts`, #171)

A stack of up to four parallel plates with air gaps runs the single-plate models in turn and carries the round's state across:

- **Long rod:** arrives with the length it has left and the speed it got through with, yawed by a thin plate by up to 10° (`10° · e^(−t / 2D)` for a plate of thickness `t` and rod diameter `D`, a lab rule).
- **Jet:** arrives with what is left of it. Particulation and drift across a gap cut its effect by `1 / (1 + (gap / (8 · cone diameter))²)`, half at eight cone diameters (a lab rule). The first plate has no gap.
- **Full-bore shot:** arrives at its residual speed; a shot that shattered arrives as a piece a quarter of its mass.
- **Squash head:** spalls only the first plate; nothing behind it is engaged.
- A ricochet, a skid or a stopped round ends the stack at that plate.

Generic textbook arrangements only: homogeneous plates with air gaps. Real or proprietary armor packages are not modelled. **Limits:** only the last plate reached throws pieces; earlier plugs and scabs are not tracked across a gap; a gap's flight time is capped at 2 ms on the timeline. Trust: **Illustrative** for the carry-over rules, **Fair** for the trends (a jet loses penetration across a gap, a spaced plate costs a rod penetration).

## Not modelled

HE and fragmentation rounds against plate (#170), 3D views, composite or reactive armor, shock heating and phase change, strain-rate and temperature-dependent material strength, and anything about how a munition is built.

## Keeping this page honest

If you change a constant in `src/armor/`, run `npx vitest run src/armor/validation.test.ts`. If a test fails because the new value is better, update the test and this page together and say why; if it fails because the new value is outside the published range, the constant is wrong.
