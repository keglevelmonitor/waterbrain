# WaterBrain

Standalone browser app for brew-day water calculations. Strike / sparge
volumes, strike temperature, and the exact salt additions to hit any
target water profile — all from a single form, no install, no server,
no Python.

This is the pure-JS rewrite of the older Streamlit-based WaterBrain.
Same math, same 26 style-targeted profiles, but delivered as a static
site with the same dark-and-amber look-and-feel as
[FermTrend](https://github.com/keglevelmonitor/fermtrend) and the
FermVault Brain dashboard.

## Try it

<https://keglevelmonitor.github.io/waterbrain/>

1. On the **CALCULATOR** tab, build your **grain bill**: one row per
   grain, each with its own weight, unit (lb/oz in US mode, kg/g in
   Metric), malt category, and Lovibond color. Click **+ Add Grain**
   to add a row, the **×** to delete one. Four categories are
   supported: Base Malt, Crystal / Caramel, Roasted / Dark, and
   Acidulated Malt (where the Color column means % lactic acid
   content, typical 3.0).
2. Fill in temperatures, boil-off, absorption rate, fermenter volume,
   and trub loss.
3. Pick **No Sparge (BIAB)** or **Sparge** (with a mash-thickness input).
4. Click **Calculate Water Volumes** — get strike volume, strike
   temperature, sparge volume, pre-boil volume, mash volume, and total
   brew water.
5. Pick a **Target Profile** (or edit the Ca/Mg/Na/SO4/Cl fields by
   hand), set your target mash pH, then click **Calculate Salt
   Additions** to get gypsum, calcium chloride, Epsom, canning salt,
   slaked lime, and a lactic-acid dose (mL and g). The **pH
   diagnostic strip** at the top shows DI mash pH (from grain bill)
   → post-salts pH → target pH, plus a breakdown of where the acid
   dose is going (pH drop vs slaked-lime neutralization). Adding
   Acidulated Malt to the grain bill reduces the lactic dose by the
   amount of acid the malt supplies.

Click the **US / METRIC** pill in the header any time to switch unit
systems; inputs, defaults, and labels swap live.

## Repo layout

```
WaterBrain/
  index.html            single-page app entry
  style.css             dark theme, same palette as FermTrend / FermVault Brain
  app.js                app shell, tab routing, form wiring, unit toggle
  brewmath.js           JS port of the original BrewMath calculator
  profiles.js           26 built-in target water profiles (ES module)
  changelog.json        revision history (drives version pill + About tab)
  local.ps1             local preview server (npx serve)
  ship.ps1              one-command bump + commit + push
  .github/workflows/    GitHub Pages auto-deploy on push to main
```

No build step, no `npm install`, no CORS proxy — WaterBrain is a pure
calculator with no external data dependencies. Every ingredient it
needs lives in the repo.

## Local preview

```powershell
.\local.ps1
```

Opens the site on `http://localhost:3000`.

## Shipping a change

```powershell
.\ship.ps1 "note about what changed"
```

Bumps the patch version in `changelog.json`, prepends a new entry with
the note, commits, and pushes. GitHub Pages redeploys automatically
(~30 s).

Use `-Minor` / `-Major` to bump the second / first component instead:

```powershell
.\ship.ps1 -Minor "new feature"
.\ship.ps1 -Major "breaking change"
```

`-DryRun` bumps `changelog.json` locally without committing so you can
inspect the change before shipping.

## Relationship to FermTrend and FermVault Brain

Three siblings in the same product line:

- **FermVault Brain** — private Raspberry Pi Pico 2 W firmware +
  browser dashboard for temperature-controlled fermentation.
- **FermTrend** — standalone browser SG-trend + FG-stability analyzer,
  same visual language.
- **WaterBrain** — this repo. Brew-day water math, same visual
  language.

Shared visual vocabulary: dark background (`#0a0a0a`), card surfaces
(`#161616`) with `#262626` borders, amber accent (`#ffa500`) for
active state and primary buttons, tabs across the top, monospaced
tabular numbers in strip cells, `.btn-primary` / `.btn-secondary` /
`.btn-danger` for actions.

## Assumptions (do not tune casually)

1. Starting water is Reverse Osmosis: neutral pH, zero alkalinity,
   zero background ions.
2. Sparge calculations assume full-volume water treatment: salts are
   added to the total brew water, not split across strike / sparge.
3. The pH and salt math is empirical / approximate. Compare with
   Brewer's Friend / Bru'n Water before betting a brew day on them.

Salt-addition math (gypsum / CaCl2 / Epsom / canning salt / slaked
lime) is a byte-for-byte port of the original Streamlit app. The
mash pH / lactic acid math was rewritten in v0.3.0 around a
per-grain, color-driven model inspired by Kai Troester's mash pH
research and Brewer's Friend's grist workflow, then calibrated
against a real BF reference recipe over v0.3.1 - v0.3.2 (final
agreement within ~0.03 mL for both a low-lime and a high-lime case
using the same grain bill). Each grain row carries its own
Lovibond color, which anchors that grain's distilled-water mash pH
along a category-specific curve:

- Base Malt: `DI = 5.77 - 0.025·L` (typical L 1-15)
- Crystal / Caramel: `DI = 5.45 - 0.006·L` (typical L 10-120)
- Roasted / Dark: `DI = 4.75 - 0.0004·L` (typical L 200-600)

The estimated pre-lactic mash pH is a mass-weighted average across
the grain bill (with acidulated malt folded in as an acid source).
As of v0.3.2 the model does NOT subtract a Ca/Mg salt-induced pH
drop and does NOT dose extra lactic to neutralize the slaked-lime
addition -- both terms are parameterised but zeroed to match BF's
observed mash pH estimator (which behaves this way empirically).
The residual lactic-acid dose is computed against a fixed buffering
capacity (35 mEq/kg/pH for base malt, 40 for crystal, 55 for
roasted). Acidulated Malt is a first-class grain: entering it as a
row with a % lactic acid value in the Color column lowers the
pre-lactic estimate directly (~28 mL of 88% lactic equivalent per
kg of 3% acid malt). See `brewmath.js` for the full constant table
and derivations.

Palmer / Bru'n Water predict noticeably more acidification for very
hard water (Ca > 150 ppm) and more lime-neutralization for high-RA
mashes. If you want that behavior back, raise
`SALT_PH_DROP_PER_MEQ_CA` and `LIME_EFFECTIVENESS_FACTOR` in
`brewmath.js` -- the calibration against BF will drift but the
model becomes more conservative for hard-water outliers. Without
per-malt buffering data the model still averages within each
category, so dark beers made mostly of roasted malts, or unusually
acidic base malts, will drift from the model's predictions. Cross-
check against Brewer's Friend / Bru'n Water before betting a brew
day on the numbers.

## License

MIT — see `LICENSE`.
