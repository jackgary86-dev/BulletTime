<#
.SYNOPSIS
  Posts the Armor lab status comments and closes the finished tickets (#157 epic).

.DESCRIPTION
  Safe to re-run: a ticket that is already closed is skipped, and a comment is
  not posted twice (it carries a hidden marker). Needs the GitHub CLI (gh),
  signed in. Run it from anywhere inside the repo.

  Closing a ticket whose commit is not on origin/main yet is refused unless you
  pass -AllowUnpushed, so a close never points at code nobody can see.

.EXAMPLE
  .\scripts\update-armor-tickets.ps1 -DryRun      # show what it would do
  .\scripts\update-armor-tickets.ps1              # do it
#>
[CmdletBinding()]
param(
  [string]$Repo = 'jackgary86-dev/BulletTime',
  [switch]$DryRun,
  [switch]$AllowUnpushed
)

$ErrorActionPreference = 'Stop'
Set-Location (git rev-parse --show-toplevel)

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw 'The GitHub CLI (gh) is not installed or not on PATH.' }
git fetch origin main --quiet

function Test-Pushed([string]$sha) {
  git merge-base --is-ancestor $sha origin/main 2>$null
  return ($LASTEXITCODE -eq 0)
}

function Commit-Link([string]$sha) {
  return "[$sha](https://github.com/$Repo/commit/$sha)"
}

# Tickets: number, the commit that did the work (or $null), whether to close, and the comment.
$base = "https://github.com/$Repo/commit"
$tickets = @(
  @{ Number = 164; Sha = 'd5474a4'; Close = $true; Body = @'
Done in [d5474a4](COMMIT_URL): HESH stress-wave spall in `src/armor/hesh.ts`. The pulse crosses the plate at the sound speed and reflects inverted at the rear face, and the scab forms where the tension beats the spall strength. Covered by `hesh.test.ts`: a thin RHA plate (under about a calibre) spalls, plates over a calibre and a half do not, cast iron spalls more readily than RHA, and the scab grows with spall strength relative to the pulse.
'@ },
  @{ Number = 165; Sha = 'b5601d5'; Close = $true; Body = @'
Done in [b5601d5](COMMIT_URL): ricochet, line-of-sight dimension and bouncing fragments.
- `ricochet.ts`: critical slope by family, plate hardness and speed (full-bore shot about 68 deg and long rods about 80 deg on RHA; softer plates raise it), a shallow gouge, an exit at a shallow angle with reduced speed, and shatter of full-bore steel shot on RHA. Jets keep their skid rule and squash heads never ricochet.
- `fragments.ts`: plugs, scabs, jet and spall debris, shattered pieces and ricochets fly, tumble and bounce off the floor and walls of a test room with restitution and friction, then slide to rest. Precomputed, so it scrubs.
- Line-of-sight thickness (T / cos theta) is in the results and drawn as a dimension line; playback gets a log-time aftermath phase.
Known limit: the rod and full-bore models still clamp slopes at 70 and 75 deg.
'@ },
  @{ Number = 166; Sha = '6d7979e'; Close = $true; Body = @'
Done in [6d7979e](COMMIT_URL): `src/armor/fields.ts`, pure functions of a point in the plate and a time, in real units, each with a suggested legend range. Temperature (crater wall heat, conduction, shear band round a plug, flagged molten jet or rod interface), stress over yield (about Rt/Y at the nose), pressure (a front at c*t reflecting off the rear face as tension) and an energy account that adds up to the impact energy within 2% at every instant. Tests check finiteness, continuity, the melting cap, the front at c*t and the energy sum.
'@ },
  @{ Number = 167; Sha = '83cf8fb'; Close = $true; Body = @'
Done in [83cf8fb](COMMIT_URL): the Temperature, Stress and Pressure overlays draw on the cut-away section (inferno, viridis and a blue-red diverging map) with a legend in real units and a teaching-approximation note, plus an energy bar and a scale bar in mm. Not done from the original scope: per-family screenshots (they belong with #173).
'@ },
  @{ Number = 169; Sha = '1228565'; Close = $true; Body = @'
Done in [1228565](COMMIT_URL): `src/armor/validation.test.ts` pins each model to its reference behaviour - Tate (a 120 mm-class rod lands in 550 to 750 mm of RHA, about 600 mm at 1,650 m/s; below the hydrodynamic limit where Rt > Yp; the interface equation; the rigid and no-penetration regimes), De Marre (the 88 mm case within 10%, v^(1/0.7), line-of-sight thickness), the density law (5 to 7 cone diameters into RHA, sqrt(rho_j/rho_t) scaling), HESH (the spall boundary, cast iron over RHA), the energy balance and the pressure front, and the ricochet thresholds by family. Changing a key constant fails at least one test: checked by mutating RHA's Rt, De Marre K, the rod's default speed, the shot ricochet base, the jet tip speed and the HESH contact pressure.
`docs/armor-models.md` covers every model: equations, parameters with sources, limits and a trust level, with the teaching-approximation disclaimer. It is linked from the About dialog and the README.
Finding: a rod stronger than the plate resists (tungsten in aluminium) can pass the hydrodynamic limit, as Tate predicts; the comment on `hydrodynamicLimit` said strength only lowers it and is corrected.
'@ },
  @{ Number = 171; Sha = 'a5257df'; Close = $true; Body = @'
Done in [a5257df](COMMIT_URL): stacks of up to four plates with air gaps (`stack.ts`, `stackView.ts`), an arrangement picker with the three presets and editable plate rows in the lab. Rods carry their remaining length and are yawed by a thin plate; jets carry what is left and lose effect across a gap; full-bore shot carries its residual speed and arrives as a small piece if it shattered; HESH only spalls the first plate. The cross-section draws the whole stack with per-plate dimensions and gaps, and the results show a per-plate table. Limits: only the last plate reached throws fragments, the energy bar is single-plate only, and a gap's flight time is capped at 2 ms.
'@ },
  @{ Number = 172; Sha = $null; Close = $false; Seen = 'Scope note from the owner: the 3D plate'; Body = @'
Scope note from the owner: the 3D plate on a test stand (a tank or range-style scene) is dropped, because nothing can be seen on impact there. The armor is shown instead as layered plates in the cross-section, which is done in #171. Leaving this open for the owner to close or revive.
'@ },
  @{ Number = 173; Sha = $null; Close = $false; Seen = 'Scope note from the owner: drop the range'; Body = @'
Scope note from the owner: drop the range challenge stage (a tank or range-style scene hides the impact) in favour of the layered cross-section from #171. What remains here: classroom mode (including a layered-plate lesson, "jet across a gap"), PNG export of a frame, and the README section and store screenshots.
'@ },
  @{ Number = 157; Sha = $null; Close = $false; Seen = 'done and closed are #164 HESH, #165 ricochet and fragments, #166 field models, #167 overlays and legends, #169'; Body = @'
Armor lab progress, all on `main`: done and closed are #164 HESH, #165 ricochet and fragments, #166 field models, #167 overlays and legends, #169 validation suite and model notes, #171 spaced and layered stacks. Open: #170 HE fragments vs plate, #172 3D view (dropped per the owner, see its comment), #173 classroom mode, PNG export and docs (range stage dropped).
'@ }
)

foreach ($t in $tickets) {
  $n = $t.Number
  $info = gh issue view $n --repo $Repo --json state,comments | ConvertFrom-Json
  $marker = "<!-- armor-lab-status-$n -->"
  $already = $false
  foreach ($c in $info.comments) {
    if ($c.body -like "*$marker*") { $already = $true }
    # Comments posted by hand earlier carry no marker, so also look for their opening words.
    if ($t.Seen -and $c.body -like "*$($t.Seen)*") { $already = $true }
  }

  $closed = ($info.state -eq 'CLOSED')
  if ($closed -and $t.Close) { Write-Host "#$n already closed, skipping."; continue }

  if ($t.Close -and $t.Sha -and -not (Test-Pushed $t.Sha) -and -not $AllowUnpushed) {
    Write-Warning "#$n : commit $($t.Sha) is not on origin/main yet. Push first, or pass -AllowUnpushed. Skipping."
    continue
  }

  $body = $t.Body.Replace('COMMIT_URL', "$base/$($t.Sha)").Trim() + "`n`n$marker"
  if ($already) {
    Write-Host "#$n comment already posted."
  } elseif ($DryRun) {
    Write-Host "[dry run] would comment on #$n :"
    Write-Host ($t.Body.Trim().Split("`n")[0])
  } else {
    $file = New-TemporaryFile
    Set-Content -Path $file -Value $body -Encoding UTF8
    gh issue comment $n --repo $Repo --body-file $file | Out-Null
    Remove-Item $file
    Write-Host "#$n commented."
  }

  if ($t.Close -and -not $closed) {
    if ($DryRun) { Write-Host "[dry run] would close #$n" }
    else { gh issue close $n --repo $Repo | Out-Null; Write-Host "#$n closed." }
  }
}
