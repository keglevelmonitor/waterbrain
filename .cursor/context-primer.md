# WaterBrain — Context Primer for New Agents

Read this at the start of any new chat about this project. It captures
non-obvious conventions accumulated across sessions — following these
will save the user (Cole) from having to re-explain them.

---

## Project shape

- **What it is:** a pure-JS standalone brew-day water calculator that
  runs entirely client-side in the browser. Deploys as a static site
  on GitHub Pages at <https://keglevelmonitor.github.io/waterbrain/>.
  No build step, no `npm install`, no server, no CORS proxy, no
  external API dependencies.
- **What it does:** two stateless calculators bolted together —
  1. **Water Requirements** — strike / sparge volumes, strike
     temperature, mash volume, pre-boil volume, total brew water
     from grain weight, temperatures, boil-off, absorption, and mash
     thickness.
  2. **Water Chemistry** — gypsum, calcium chloride, Epsom, canning
     salt, slaked lime, and lactic-acid doses required to hit any
     target Ca / Mg / Na / Cl / SO4 profile starting from RO water.
- **What it isn't:** a Streamlit app any more. v0.3.0 was a full
  rewrite from Python + Streamlit to pure browser JS. The original
  Streamlit code is preserved on the `streamlit-legacy` branch of
  this repo for provenance only — do not port improvements back to
  it, and do not port ITS math back to here (the current `main` is
  the ground truth).
- **User environment:** Windows / PowerShell. All shell examples in
  docs and scripts must be PowerShell-compatible. `.ps1` scripts
  must be ASCII-only (no smart quotes, no em-dashes) — that's a
  repo-wide rule inherited from the FermVaultPico project.

## Deploy / ship workflow

- **`.\local.ps1`** — starts a local static-file server via
  `npx serve` for browser preview. Typically binds to 3000, but
  will step up (3001, 3002, ...) if the port is taken. Recent
  sessions have parked it on **3007** because 3000-3006 were held
  by other projects.
- **`.\ship.ps1 "note 1" "note 2"`** — one-command ship. Bumps
  `changelog.json` (patch by default; `-Minor` or `-Major` for
  bigger bumps), prepends a new entry with the notes, then does
  `git add . && git commit && git push` in one shot. Pages
  redeploys automatically on push via
  `.github/workflows/pages.yml`.
- **`.\ship.ps1`** with no args — prompts interactively for change
  notes, one per line, blank line to finish.
- **`.\ship.ps1 -DryRun "note"`** — bumps `changelog.json` only,
  no git operations. Useful for previewing the version bump.
- **After a push, Pages redeploy takes ~30-60 s.** Watch progress at
  <https://github.com/keglevelmonitor/waterbrain/actions>. First-time
  activation of Pages on a repo takes an extra ~30-60 s for CDN warm-
  up; on subsequent pushes the site updates promptly.

### First-time deploy gotcha (documented in case anyone re-bootstraps)

The `actions/configure-pages@v5` step in
`.github/workflows/pages.yml` will fail with "Not Found" on the first
push if Pages has not yet been enabled on the repository. Fix:

1. Open `https://github.com/<owner>/<repo>/settings/pages`
2. Set **Source** to **"GitHub Actions"** (not "Deploy from a
   branch"). No Save button — the choice sticks immediately.
3. Re-run the failed workflow (or push an empty commit to
   re-trigger).

The workflow is otherwise unchanged from FermTrend's — it just
copies the runtime files (`index.html`, `style.css`, `app.js`,
`brewmath.js`, `profiles.js`, `changelog.json`, `LICENSE`,
`README.md`) into a `_site` staging dir and uploads that as the
Pages artifact. No Jekyll processing, no `_config.yml`.

## File layout

```
WaterBrain/
├── index.html               # single-page shell, 4 tabs, all markup
├── style.css                # dark theme + amber accent
├── app.js                   # UI wiring, tab switching, form state,
│                            #   localStorage, event handlers
├── brewmath.js              # PURE FUNCTIONS: calculateWater(),
│                            #   calculateChemistry(). No DOM.
├── profiles.js              # 26 built-in target water profiles
│                            #   (BUILTIN_PROFILES const)
├── changelog.json           # version history rendered in ABOUT tab
├── LICENSE                  # MIT
├── README.md                # public-facing project doc
├── local.ps1                # local dev server
├── ship.ps1                 # one-command version bump + push
├── .gitignore
├── .github/workflows/
│   └── pages.yml            # GitHub Actions Pages deployment
└── .cursor/                 # AI agent handoff docs (this folder)
    ├── context-primer.md    # <-- you are here
    ├── todos.md
    └── rules/
        └── project-orientation.mdc
```

`brewmath.js` is intentionally pure — no `window`, no `document`, no
`localStorage` inside it. That lets it be exercised from Node for
regression testing without a browser (see "Regression testing" below).

## Mash pH model — the big story (v0.3.0 → v0.3.2)

**Read this section carefully before touching `brewmath.js`.** The
mash pH / lactic-acid math has been through three calibration
rounds against Brewer's Friend's reference calculator, and the
current constants LOOK physically wrong on paper but are empirically
correct against BF for typical RO-based recipes.

### The model

Each grain row carries `{weight, unit, category, color}`. Categories
are `base`, `crystal`, `roasted`, `acidulated`. Each non-acidulated
category anchors a DI-mash-pH-vs-color curve (v0.3.1 calibration
against Kai Troester's per-malt data):

- Base Malt:    `DI = 5.77 - 0.025 * L`   (typical L 1-15)
- Crystal:      `DI = 5.45 - 0.006 * L`   (typical L 10-120)
- Roasted:      `DI = 4.75 - 0.0004 * L`  (typical L 200-600)

Buffer capacities (Kai's central estimates):

- Base:    35 mEq/kg/pH
- Crystal: 40 mEq/kg/pH
- Roasted: 55 mEq/kg/pH
- Acidulated: 40 mEq/kg/pH (contributes to buffer but not to DI avg)

The mash pH estimator is:

```
DI       = sum(kg_i * diFn_i(L_i)) / sum(kg_i)         # weighted by mass
buffer   = sum(kg_i * buffer_i)                        # mEq of acid per pH
acid_amalt_mEq = sum(kg_amalt * pct_lactic * 111)      # acid from acid malt
est_mash_pH = DI - saltPhDrop + limePhRise
              - acid_amalt_mEq / buffer
acid_mL_88_lactic = max(0, (est_mash_pH - target) * buffer) / 11.82
                  + gLime * LIME_ACID_ML_PER_G
```

### THE calibration trap (v0.3.2)

`SALT_PH_DROP_PER_MEQ_CA`, `SALT_PH_DROP_PER_MEQ_MG`, and
`LIME_EFFECTIVENESS_FACTOR` are ALL set to `0.0` in v0.3.2. This is
physically wrong (Palmer, Troester, and Bru'n Water all report
non-zero values for these) but empirically correct against BF for
the recipes we tested.

**Why:** we discovered in v0.3.2 that BF's mash pH estimator returns
the SAME pre-acid mash pH (5.65 for our reference recipe) for two
Ca-50 recipes with different amounts of slaked lime (0.71 g vs
1.11 g), and its pre-acid pH sits ~0.13 above our Palmer-flavored
"DI minus Ca/Mg drop" number. That means BF's estimator effectively
lumps Ca/Mg salt acidification and lime alkalization into the noise
floor of its grain-bill DI curve.

**v0.3.1 was subtly broken:** it had `SALT_PH_DROP_PER_MEQ_CA = 0.040`
and full lime neutralization. For the Amber Balanced case (0.71 g
lime) the two errors CANCELLED and we matched BF within 0.05 mL —
which fooled us into shipping. For the Brown Malty case (1.11 g
lime) they no longer cancelled and we over-dosed by ~1 mL.

**v0.3.2 fix:** zero those three constants. Model becomes:

```
acid_mL = max(0, (DI_mash_pH - target_pH) * buffer_mEq_per_pH) / 11.82
```

with acidulated malt subtracted from `DI_mash_pH` via
`acidulatedPhDrop`. Matches BF within ~0.03 mL for every recipe
we've tested.

### If a user reports a mismatch against BF (or Bru'n Water)

**Debug protocol:**

1. Ask for the exact grain bill (weight + unit + category + color
   per row), the exact water profile ions (Ca / Mg / Na / SO4 / Cl
   as ppm), target mash pH, and total brew water (gal).
2. Ask what the other calculator says for lactic-acid dose to hit
   target 5.40.
3. Reproduce it in a Node one-liner against `brewmath.js` (import,
   call `calculateChemistry` with the reported inputs, print the
   result).
4. If our number is HIGH: the issue is probably the same trap as
   v0.3.1 — some accidental re-introduction of salt drop or lime
   neutralization. Or a new grain category whose buffer is too high.
5. If our number is LOW: the DI curve for one of the grains is too
   low. Check `GRAIN_CATEGORIES[cat].diFn(color)` for each row.
6. If BF and WaterBrain agree on `pre_acid_mash_pH` but disagree on
   dose, our buffer is off.

### If you want to re-introduce Palmer-flavored physics

Raise `SALT_PH_DROP_PER_MEQ_CA` toward `0.04-0.05` and
`LIME_EFFECTIVENESS_FACTOR` toward `0.3-0.5`. Expect the calibration
against BF to drift by ~1 mL for lime-heavy recipes but the model to
become more conservative (i.e., dose LESS acid) for hard water
(Ca > 150 ppm). Document the trade-off in the changelog if you make
that choice.

## Salt-addition math (unchanged since v0.1.0)

`brewmath.js` `calculateChemistry(...)` computes gypsum / CaCl2 /
Epsom / canning salt / slaked lime in exactly the order the original
Streamlit app did:

1. Meet Mg target with Epsom (records SO4 supplied as a side
   effect).
2. Meet Na target with canning salt (records Cl side-effect).
3. Meet remaining SO4 target with gypsum (records Ca side-effect).
4. Meet remaining Cl target with CaCl2 dihydrate (records Ca
   side-effect).
5. Meet remaining Ca target with slaked lime.

**Reverse Osmosis assumption:** starting water has zero alkalinity
and zero background ions. Sparge water is assumed treated at the
same concentration as the mash (all salts added to total brew water,
not just the mash liquor).

Do NOT reorder these steps or refactor into a "solve as system"
approach. The waterfall order is deliberate — later steps see how
much Cl / SO4 / Ca has already been supplied by earlier salts and
only fill the gap. Reordering will change what the app recommends
for identical inputs, breaking every saved recipe of every user.

## localStorage schema

- `waterbrain.units` — string, `"us"` or `"metric"`.
- `waterbrain.method` — string, `"sparge"` or `"no_sparge"`.
- `waterbrain.profile` — string, name of the last-selected built-in
  profile.
- `waterbrain.inputs.v3` — JSON blob with every CALCULATOR-tab
  input plus the grain bill array. The `.v3` suffix is the schema
  version.

**Bump the version suffix any time the input schema changes.** Old
saved payloads are silently ignored if the version doesn't match
the current `LS_INPUTS` constant in `app.js`, so users get fresh
defaults instead of a corrupted / crashing state. History:

- `.v1` — pre-grain-bill (original port of Streamlit inputs).
- `.v2` — added three fixed grain-bill fields (base / crystal /
  roasted).
- `.v3` — replaced the three fixed fields with a dynamic
  `grainBill: [{weight, unit, category, color}, ...]` array
  (Brewer's Friend-style table).

The next schema change should bump to `.v4`.

## UI conventions

- **Four tabs:** CALCULATOR / PROFILES / SETTINGS / ABOUT. Same
  visual language as FermTrend.
- **US ↔ Metric toggle** in the header, always visible. Unit
  switching is lossless: 9 lb Pale becomes 4.082 kg Pale (not a
  fresh 4.0 kg default). See `convertGrainRowUnits` in `app.js`.
- **Category switch is smart:** if a row's color still matches the
  previous category's default, switching category snaps color to the
  new category's default. Custom colors are preserved. See
  `onGrainRowChange` in `app.js`.
- **Salt additions rendered as a 2x3 grid,** in this order:
  Gypsum | Epsom | Canning Salt on row 1, Calcium Chloride |
  Slaked Lime | Lactic Acid on row 2. Do not reorder without asking.
- **pH diagnostic strip** at top of Salt Additions card. In v0.3.2
  this is a 2-cell layout (was 3-cell in v0.3.0/v0.3.1):
  `Est. Mash pH → Target Mash pH`. The middle "With Salts" cell was
  dropped because at BF-calibrated constants it just duplicated the
  first cell. If you re-introduce non-zero salt-drop coefficients,
  put the middle cell back.
- **Est. Mash pH cell** folds in acidulated malt's contribution — so
  a 3% acid-malt-heavy bill correctly shows a lower pre-lactic
  estimate. The note under it flips from "from grain bill" to
  "grain bill + X.XX mL acid-malt effect" when acid malt is present.
- **Style rules:** dark background (`#0e1116`), amber accent
  (`#e5a13a` primary CTA), muted text (`#8b93a7`), same as
  FermTrend / FermVault dashboards. Use CSS variables in
  `style.css` rather than hardcoded hex when adding new UI.

## Reference recipes for regression testing

If you touch `brewmath.js`, re-run these against Node before
shipping. All should match within ~0.1 mL of the reported target.

### 1. USER REFERENCE (BF-calibrated, primary regression case)

```
Grain bill:
  7 lb Base Malt @ 2.5 L  (Maris Otter Pale)
  2 lb Base Malt @ 3.8 L  (BEST Vienna)
  6 oz Roasted / Dark @ 600 L  (Roasted Barley)
  4 oz Crystal / Caramel @ 75 L  (Medium Crystal)
Water: 8 gal
Target mash pH: 5.40
```

- Amber Balanced (Ca 50, Mg 10, Na 15, SO4 75, Cl 63):
  BF → 3.10 mL 88% lactic. v0.3.2 → **3.13 mL**.
- Brown Malty (Ca 50, Mg 10, Na 15, SO4 55, Cl 65):
  BF → 3.10 mL. v0.3.2 → **3.13 mL** (same, matching BF's
  behavior of not differentiating on lime addition).

### 2. Pilsner SMASH (light-color sanity)

10 lb Pilsner @ 2 L, 8 gal, Amber Balanced, target 5.40 →
**4.30 mL**. (Not verified against BF, but reasonable for a
pale beer starting near 5.6 DI.)

### 3. Stout (dark-color sanity — should be low or zero)

5 lb Base @ 2.5 + 1 lb Crystal @ 60 + 1 lb Roasted @ 500, 8 gal,
Amber Balanced, target 5.40 → **0.56 mL**. Starts naturally
acidic; only a small pH-drop needed. If this ever recommends a
LOT of acid, something regressed.

### 4. With acidulated malt (semantic-of-est-pH check)

User reference bill + 3 oz Acidulated @ 3.0 → **0.80 mL**
(down from 3.13 without acid malt). `est_mash_ph` should drop
from 5.64 to ~5.46. Confirms acidulated malt reduces both the
recommendation AND the shown pre-acid estimate.

### Node one-liner for quick verification

```powershell
node --input-type=module -e "
import('./brewmath.js').then(m => {
  const c = m.calculateChemistry({
    waterVol: 8, targetPh: 5.4,
    grainRows: [
      { weight: 7, unit: 'lb', category: 'base',    color: 2.5 },
      { weight: 2, unit: 'lb', category: 'base',    color: 3.8 },
      { weight: 6, unit: 'oz', category: 'roasted', color: 600 },
      { weight: 4, unit: 'oz', category: 'crystal', color: 75  },
    ],
    tgtCa: 50, tgtMg: 10, tgtNa: 15, tgtSo4: 75, tgtCl: 63,
    isMetric: false,
  });
  console.log('acid: ' + c.acid.toFixed(2) + ' mL  (BF: 3.10)');
});
"
```

## Where to tune what (cheat sheet)

| Symptom | File | What to change |
|---|---|---|
| Dose too high vs BF for typical recipes | `brewmath.js` | Verify `SALT_PH_DROP_PER_MEQ_*` and `LIME_EFFECTIVENESS_FACTOR` are still `0.0`. Someone may have re-introduced Palmer physics. |
| Dose too low vs BF for typical recipes | `brewmath.js` | Check `GRAIN_CATEGORIES[cat].diFn` for the grains in question. DI mash pH curves may be too low. |
| Pilsner mash pH looks wrong | `brewmath.js` | Base malt `diFn`: `5.77 - 0.025 * L`. At L = 1.6 → 5.73. |
| Very dark base malt (Munich) looks wrong | `brewmath.js` | Same base curve. At L = 10 → 5.52. Steepen slope if maltster data disagrees. |
| Wanted more conservative acid for hard water | `brewmath.js` | Raise `SALT_PH_DROP_PER_MEQ_CA` toward 0.04. Expect drift vs BF. |
| Salt-addition amounts look wrong | `brewmath.js` | Waterfall order in `calculateChemistry`: Mg → Na → SO4 → Cl → Ca. Do not reorder. |
| Diagnostic strip shows redundant "With Salts" | `index.html` + `app.js` | v0.3.2 collapsed to 2 cells. If salt drop is re-enabled, restore the middle cell. |
| Add a new grain category | `brewmath.js` + `app.js` + `index.html` | Extend `GRAIN_CATEGORIES` map; extend the `<select>` options; may need to touch `defaultGrainBill`. |
| Add a new water profile | `profiles.js` | Append to `BUILTIN_PROFILES`. Order matters for the dropdown. |
| Add a new input field | `index.html` + `app.js` | Bump `LS_INPUTS` to `.v4` so old saved payloads are cleanly ignored. |
| Change UI copy in tab bodies | `index.html` | Everything is inline in the SPA — no framework, no templates. |
| Change theme colors | `style.css` | CSS variables at top of file. Match FermTrend's palette. |

## Common pitfalls

- **PowerShell curl vs curl.exe:** `curl` is aliased to
  `Invoke-WebRequest` in PowerShell and doesn't accept the `-s`
  flag. Use `curl.exe -s ...` or `Invoke-WebRequest -UseBasicParsing`
  when scripting.
- **`localStorage` sticky across sessions:** dev testing frequently
  leaves old saved inputs in localStorage that don't match your
  new schema. If the app looks wrong on your machine but fine on a
  clean browser, clear localStorage for `localhost:3007` (or
  whatever your dev port is) or bump `LS_INPUTS` version.
- **Hard-refresh vs soft-refresh:** browsers cache ES modules
  aggressively. When testing a change to `brewmath.js` or
  `app.js`, use `Ctrl+F5` (or `Ctrl+Shift+R`) to bypass the module
  cache. `F5` alone may serve the previous version.
- **Pages first-deploy 404:** see "First-time deploy gotcha" above.
  If a fresh clone deploys 404, the fix is enabling Pages source =
  GitHub Actions on the repo, not a code change.
- **`.mpy` shadow trap is a FermVaultPico thing, not a WaterBrain
  thing** — WaterBrain has no compiled bytecode, ships plain JS.
  Ignore any advice from FermVaultPico's primer about `.py` vs
  `.mpy`.

## Update discipline

If a session discovers a new gotcha, a new convention, or a
non-obvious architectural choice, add it here so the next agent
doesn't have to re-derive it. Section titles are load-bearing —
future agents grep for keywords. Prefer adding a new subsection
over burying a fact in prose.
