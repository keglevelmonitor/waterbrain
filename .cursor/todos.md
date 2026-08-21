# WaterBrain — Open Todos

Living document. Update whenever a todo is added, resolved, or refined.
The agent should read this at the start of every new chat and mirror it
into its own in-chat todo list. When work completes, mark items done
here (and add follow-ups) so the next agent has ground truth.

Last updated: 2026-08-21 (v0.3.2 shipped: BF-calibrated mash pH,
handoff docs written; hco3-support scoped but deferred)

---

## Status

**No urgent pending work.** v0.3.2 ships a mash-pH / lactic-acid
model that matches Brewer's Friend within ~0.05 mL for every
recipe tested against the user's reference bill. The site is live
at <https://keglevelmonitor.github.io/waterbrain/>.

The items below are nice-to-haves and open design questions for
future sessions.

---

## Nice-to-haves (in rough priority order)

### hco3-support — Add Bicarbonate (HCO3) as a first-class ion

**Status:** scoped 2026-08-21, deferred. Cole brews with RO water
only and the app is single-user, so staying RO-only is the active
decision — not just a default. Do NOT build this speculatively.
Do the whole thing or none of it (half-adding it with an input
field but no math change is worse than not adding it).

**Why it matters:**

1. **Non-RO source water.** The moment a brewer uses tap or well
   water, HCO3 alkalinity is the single biggest driver of mash-pH
   resistance. Without it, our mash-pH estimate for a 150 ppm HCO3
   tap water would be ~0.3-0.5 pH high, and our lactic-acid
   recommendation would be 2-4x too low. This is the primary
   motivator.
2. **Baking soda / chalk additions.** Some brewers add NaHCO3 or
   CaCO3 to *raise* mash pH for very dark grists. WaterBrain has
   no way to do this today. Adding HCO3 to the palette naturally
   comes with adding one or both of those salts.
3. **Historic style-water fidelity.** Dublin, Burton, Dortmund,
   Munich (Boiled), and Vienna (Boiled) profiles in `profiles.js`
   are already misleading without HCO3. Real Dublin water is
   defined by ~200-330 ppm HCO3; the "(Boiled)" qualifier on
   Munich / Vienna is meaningless without an alkalinity number
   for boiling to reduce.
4. **Residual Alkalinity (RA) diagnostic.** Kolbach's
   `RA = alkalinity - (Ca/1.4 + Mg/1.7)` is the best water-to-
   beer-color match number and is surfaced by BF, Bru'n Water,
   and EZ Water. We can't compute it without alkalinity.

**Why it's a Real Feature (not a one-hour add):**

Scope, all-in:

1. **`profiles.js`** — add `hco3` field to all 26 built-in
   profiles with realistic historic values (Dublin ~280, Burton
   ~200, Dortmund ~180, raw Munich ~180, Munich (Boiled) ~40,
   raw Vienna ~120, Vienna (Boiled) ~30, Pilsen ~15, most
   generic style profiles ~50-100).
2. **`index.html` + `app.js`** — add a "Source Water" ion panel
   (Ca / Mg / Na / SO4 / Cl / HCO3, all starting at 0 for RO
   brewers). Add HCO3 to the target profile summary line, on the
   far right next to Cl.
3. **`brewmath.js`** — waterfall math changes from "compute salt
   to hit target from zero" to "compute salt to hit
   `target - source`" for each ion. Mechanical but everywhere.
   Bump `LS_INPUTS` to `.v4`.
4. **`brewmath.js`** — mash-pH model gets a real alkalinity term:
   `est_mash_pH += (source_HCO3_alkalinity_mEq / buffer)`.
   Requires another BF calibration pass, because BF *does*
   factor in source alkalinity for non-RO recipes.
5. **`brewmath.js`** — add baking soda (`NaHCO3`) to the salt
   palette. Probably skip chalk (`CaCO3`) — notoriously
   undissolvable and most brewers don't use it. Baking soda
   raises `est_mash_pH` per gram and contributes Na + HCO3.
6. **RA diagnostic** — add a Residual Alkalinity readout
   somewhere (SETTINGS, or under the salt additions card, or
   in the pH diagnostic strip).
7. **Docs** — update `context-primer.md` "Mash pH model" section
   with alkalinity term; refresh regression recipes to cover a
   tap-water case; update README.

**Rough size estimate:** about the same as v0.3.0 + v0.3.2
combined. Ship as `v0.4.0` (minor bump — new user-facing feature).

**Trigger to actually build it:** any of

- Cole wants to brew with tap water instead of RO.
- Cole wants baking soda for a dark beer that mashes below 5.2.
- A user requests it.

Until then it's a defensible design choice to stay RO-only. Adding
this speculatively adds UI clutter for the majority of users who
brew with RO.

**Before starting:** check `streamlit-legacy` branch's
`target_water_profiles.json` — if it already had HCO3 as a target
field, use those values as the starting point for the JS profiles
instead of re-deriving from historical references.

### calibration-breadth — Verify BF match across a broader recipe range

Currently we've calibrated against one grain bill (7 lb Maris Otter
+ 2 lb Vienna + 6 oz Roasted + 4 oz Crystal @ 8 gal) across two
Amber / Brown water profiles. The v0.3.2 constants match BF there,
but we haven't confirmed:

- A pale SMASH (Pilsner only) at Yellow Balanced water.
- A big stout (heavy roasted %) at Black Full profile.
- A wheat beer (base + wheat, no crystal).
- Any recipe with a HIGH-Ca water (200+ ppm) where our zeroed salt-
  drop constants may under-recommend acid vs BF.

Would strengthen confidence in the constants before promoting the
model to "trust for a brew day" in the README (currently qualified
as "cross-check against BF / Bru'n Water before betting a brew day
on the numbers").

### help-tooltips — Explain grain categories to first-time users

The "Type" column in the grain-bill table shows `base | crystal |
roasted | acidulated` — a brewer knows exactly what these mean, but
someone new to Brewer's-Friend-style entry may not know whether
Vienna is "base" (yes) or Munich is "base" (yes, up to L 10-12) or
where Special B lands (crystal, high L). Options:

- Tooltip on each option in the `<select>` showing "typical L range
  and examples."
- A one-line hint under the grain bill: "Vienna / Munich → Base.
  Caramel / Crystal → Crystal. Chocolate / Roast / Black → Roasted."
- A separate "Grain Categories" panel in the ABOUT tab.

Design open: which of these, or all.

### wheat-malt-category — Should wheat / rye / oat get their own bucket?

Currently a brewer would classify wheat as `base`. Kai Troester's
data suggests wheat malt DI mash pH is very close to Pilsner
(5.75-5.80), so lumping it in with base isn't terrible. But rye
runs slightly acidic (~5.65) and flaked adjuncts are lower still.
For high-percentage wheat / rye recipes, our current bucket may be
0.05 pH high on the DI estimate.

If added: extend `GRAIN_CATEGORIES` in `brewmath.js` and add a
select option in `index.html`. Bump `LS_INPUTS` to `.v4`.

### save-recipe-slots — Save / recall named recipes

`localStorage` currently persists only the LAST-USED inputs. Adding
"Save as..." / "Load..." slots (like FermTrend's watchlist) would
let a brewer keep 4-6 named recipes on hand. Would need:

- A "recipes" tab or a dropdown in the CALCULATOR header.
- Import / export JSON so recipes can move between browsers.

### units-per-row-remembered — Grain-bill unit toggle stickiness

When the user switches lb ↔ oz on one row, we currently do NOT
remember that as their "preferred" unit for that row when the
category changes. Minor UX polish; low priority.

### print-view — Brew-day print sheet

FermTrend has a compact "brew-day view" mode. Would be nice to have
a similar `?print=1` URL param that hides the calculator inputs and
shows a paper-friendly summary of "Water: 8 gal, Strike 172F, Add:
2.3 g gypsum, 1.2 g CaCl2, 3.13 mL lactic acid."

### fg-correction-hookup — Cross-app link with FermTrend

Would be neat if FermTrend's SG-trend view could deep-link to
WaterBrain with a water profile pre-loaded ("this beer style
typically wants Amber Balanced"). Very low priority — separate
apps, separate audiences, but they share aesthetic and Cole runs
both.

---

## Closed / resolved

### mash-ph-bf-calibration (v0.3.2, 2026-08-21) — CLOSED

Three-round calibration against Brewer's Friend for the lactic-acid
recommendation:

- v0.3.0: introduced Kai Troester-style grain-bill-driven DI mash
  pH model to replace the SRM-linear proxy that clipped to 0 for
  dark beers.
- v0.3.1: re-tuned DI curves / buffer capacities / salt-drop coefs
  after user reported over-dose. Matched BF within 0.05 mL for the
  Amber Balanced case but STILL over-dosed for lime-heavier bills.
- v0.3.2: discovered BF's estimator lumps Ca/Mg drop and lime
  neutralization into its DI curve noise floor. Zeroed
  `SALT_PH_DROP_PER_MEQ_CA`, `SALT_PH_DROP_PER_MEQ_MG`, and
  `LIME_EFFECTIVENESS_FACTOR`. Now matches BF within ~0.05 mL for
  every recipe we've thrown at it.

See `context-primer.md` "Mash pH model" section for the full
story and the "regression testing" section for the recipes we
verified against.

### grain-bill-per-row (v0.3.0, 2026-08-21) — CLOSED

Replaced three fixed grain-weight inputs with a Brewer's Friend-
style dynamic table (Add / Delete row, per-row weight + unit +
category + color). Bumped `LS_INPUTS` to `.v3`.

### acidulated-malt-support (v0.3.0, 2026-08-21) — CLOSED

Acidulated malt added as a fourth grain category. Contributes acid
directly (not to the weighted DI average) via
`ACID_MALT_MEQ_PER_KG_PER_PERCENT = 111.0`. Fixed a factor-of-10
bug (was `11.10`) that made 3 oz of 3% acid malt look like it added
0.24 mL of equivalent lactic when it should be ~2.4 mL.

### streamlit-to-js-rewrite (v0.1.0, 2026-08-21) — CLOSED

Full rewrite of the original Streamlit app to pure client-side JS
with four-tab UI (CALCULATOR / PROFILES / SETTINGS / ABOUT), US /
Metric toggle, and static Pages deploy. Original Streamlit code
preserved on `streamlit-legacy` branch.

### pages-deploy (2026-08-21) — CLOSED

First-time GitHub Pages activation required enabling Pages source =
"GitHub Actions" in repo settings before the workflow could deploy.
Fix documented in `context-primer.md` "First-time deploy gotcha."
