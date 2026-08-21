/* WaterBrain -- brew-day math.
 *
 * Two stateless functions:
 *   calculateWater(...)      water volumes + strike temp
 *   calculateChemistry(...)  salt additions + estimated lactic acid
 *
 * The water math is a byte-for-byte port of the original Streamlit
 * app's BrewMath.calculate_water and is not scientifically novel --
 * just standard brew-day arithmetic.
 *
 * The chemistry math (as of v0.3.0) is fully grain-bill-driven,
 * inspired by Kai Troester's mash pH research and the Brewer's
 * Friend grist model.  Each grain row carries its own weight, unit,
 * category (base / crystal / roasted / acidulated), and Lovibond
 * color (or % lactic acid content for acidulated malt).  The model
 * computes a weight-and-color-weighted DI mash pH, subtracts any
 * lactic acid supplied by acidulated malt, and returns the residual
 * lactic-acid dose required to hit the target mash pH.
 *
 * As of v0.3.2 the salt-induced pH drop (Ca/Mg acidification) and
 * lime-induced pH rise are both zeroed out for BF-calibration
 * reasons -- see the SALT_PH_DROP_* / LIME_EFFECTIVENESS_FACTOR
 * comment block below.  The math is still parameterised so it can
 * be tuned back toward Palmer / Bru'n Water in one place if
 * priorities change.  Results are approximate without per-malt
 * buffering data -- compare with Brewer's Friend / Bru'n Water
 * before betting a brew day on the numbers.
 *
 * Assumptions (from the sidebar of the original app):
 *   1. Starting water is Reverse Osmosis: neutral pH, zero
 *      alkalinity, zero background ions.
 *   2. Sparge calculations assume full-volume water treatment --
 *      salts are added to the total brew water, not just the mash.
 *   3. pH math is approximate; values are best-effort estimates.
 */

/* ---------------------------------------------------------------------------
 * calculate_water -- unchanged from v0.1.0.
 * ------------------------------------------------------------------------- */

/**
 * @param {Object} p
 * @param {number} p.grainWt        total grain weight (lb or kg)
 * @param {number} p.grainTemp      grain temperature (F or C)
 * @param {number} p.mashTemp       target mash temperature (F or C)
 * @param {number} p.targetVol      volume into fermenter (gal or L)
 * @param {number} p.trubLoss       trub / whirlpool loss (gal or L)
 * @param {number} p.boilTime       boil duration (minutes)
 * @param {number} p.boiloffRate    boil-off rate (gal/hr or L/hr)
 * @param {number} p.absRate        grain absorption rate (qt/lb or L/kg)
 * @param {string} p.method         "Sparge" | anything-else (no-sparge)
 * @param {number} p.thickness      mash thickness (qt/lb or L/kg), Sparge only
 * @param {boolean} p.isMetric      true = kg/L/C, false = lb/gal/F
 * @returns {{strikeVol:number, strikeTemp:number, spargeVol:number,
 *            totalMashVol:number, preBoilVol:number, totalWater:number}}
 */
export function calculateWater({
  grainWt, grainTemp, mashTemp, targetVol, trubLoss,
  boilTime, boiloffRate, absRate, method, thickness, isMetric,
}) {
  const postBoilVol   = targetVol + trubLoss;
  const totalBoiloff  = boiloffRate * (boilTime / 60.0);
  const preBoilVol    = postBoilVol + totalBoiloff;

  const totalAbs = isMetric
    ? (grainWt * absRate)
    : (grainWt * absRate) / 4.0;

  const totalWater = preBoilVol + totalAbs;

  let strikeVol;
  let spargeVol;
  if (method === "Sparge") {
    const rawStrike = isMetric
      ? (grainWt * thickness)
      : (grainWt * thickness) / 4.0;
    strikeVol = Math.min(rawStrike, totalWater);
    spargeVol = totalWater - strikeVol;
  } else {
    strikeVol = totalWater;
    spargeVol = 0.0;
  }

  const grainDisp    = grainWt * (isMetric ? 0.67 : 0.08);
  const totalMashVol = strikeVol + grainDisp;

  let strikeTemp = mashTemp;
  if (grainWt > 0 && strikeVol > 0) {
    if (isMetric) {
      const ratio = strikeVol / grainWt;
      strikeTemp = mashTemp + (0.41 / ratio) * (mashTemp - grainTemp);
    } else {
      const ratio = (strikeVol * 4.0) / grainWt;
      strikeTemp = mashTemp + (0.2 / ratio) * (mashTemp - grainTemp);
    }
  }

  return {
    strikeVol,
    strikeTemp,
    spargeVol,
    totalMashVol,
    preBoilVol,
    totalWater,
  };
}

/* ---------------------------------------------------------------------------
 * Grain categories -- the table of malt "personalities" used by the
 * mash pH model.  Each entry supplies:
 *   diFn(L)        DI mash pH as a function of Lovibond color, or
 *                  null for categories that don't contribute to the
 *                  weighted DI average (e.g. acidulated malt).
 *   buffer         Buffering capacity in mEq acid per kg per pH unit.
 *   defaultColor   Sensible default for a fresh row in this category
 *                  (Lovibond, or % lactic acid for acidulated).
 *   isAcidSource   True if the "color" column is really % lactic acid
 *                  and the malt should contribute an acid dose
 *                  instead of a DI pH.
 *   label          UI text for the dropdown.
 *
 * Formulas re-calibrated in v0.3.1 against Kai Troester's per-malt
 * distilled-water mash pH measurements, cross-checked against a
 * Brewer's Friend recipe (Maris Otter + Vienna + Roasted Barley +
 * C75 -> 3.1 mL of 88% lactic to hit 5.40 in an 8 gal Amber Balanced
 * mash), which is the reference case our model now reproduces to
 * within ~0.1 mL.  Approximate agreement with published values:
 *   Base:    Pilsner 5.75, MO 5.71, Vienna 5.68, Munich 5.52
 *   Crystal: C20 5.33,   C40 5.21,  C80 4.97,  C120 4.73
 *   Roasted: Choc 4.61,  RB 4.55,   Black 4.51
 * They are still NOT calibrated per-malt.  Extreme values (base malt
 * above 20 L, crystal below 10 L, roasted below 200 L) will drift.
 *
 * Buffer capacities are Kai's central estimates: base ~35 mEq/kg/pH,
 * crystal ~40, roasted ~55.  If you re-tune these, adjust the salt
 * pH-drop constants below in tandem -- they are two ends of the same
 * lever.
 * ------------------------------------------------------------------------- */

export const GRAIN_CATEGORIES = {
  base: {
    label: "Base Malt",
    diFn: (L) => 5.77 - 0.025 * L,
    buffer: 35,
    defaultColor: 2.0,
    isAcidSource: false,
  },
  crystal: {
    label: "Crystal / Caramel",
    diFn: (L) => 5.45 - 0.006 * L,
    buffer: 40,
    defaultColor: 40,
    isAcidSource: false,
  },
  roasted: {
    label: "Roasted / Dark",
    diFn: (L) => 4.75 - 0.0004 * L,
    buffer: 55,
    defaultColor: 350,
    isAcidSource: false,
  },
  acidulated: {
    label: "Acidulated Malt",
    diFn: null,
    buffer: 40,
    defaultColor: 3.0,      // % lactic acid content
    isAcidSource: true,
  },
};

/* ---------------------------------------------------------------------------
 * Salt / acid physical constants.
 *
 * BF-calibration note (v0.3.2):
 *   The pair of constants below (SALT_PH_DROP_PER_MEQ_* and
 *   LIME_EFFECTIVENESS_FACTOR) are both set to zero, which is
 *   physically wrong but empirically correct against Brewer's Friend.
 *
 *   Two brewers-worth of side-by-side calibration against BF's mash
 *   pH estimator showed that BF returns the same estimated mash pH
 *   for two Ca 50 / Mg 10 recipes with different amounts of slaked
 *   lime (0.71 g vs 1.11 g), and its pre-acid mash pH sits ~0.13 pH
 *   above the Palmer / Troester "distilled DI minus Ca/Mg drop"
 *   number.  That means BF's estimator effectively lumps Ca/Mg salt
 *   acidification and lime alkalization into the noise floor of its
 *   grain-bill DI curve.  For a WaterBrain user comparing their
 *   dosages against BF, our previous model looked "over-dosing" by
 *   roughly the amount of extra acid we tacked on for lime
 *   neutralization.
 *
 *   Setting both constants to zero makes our model report:
 *     acid_mL = max(0, (DI_mash_pH - target_pH) * buffer_mEq/pH_per_kg
 *                    * total_kg / 11.82_mEq_per_mL_lactic)
 *   which matches BF's numbers to within ~0.1 mL for every recipe
 *   we've tested (light SMASH, mid-color amber, brown, stout).
 *
 *   Palmer / Bru'n Water models predict noticeably lower doses for
 *   very hard water (Ca > 150 ppm).  If you want that behavior back
 *   later, raise SALT_PH_DROP_PER_MEQ_CA toward 0.04-0.05 and
 *   LIME_EFFECTIVENESS_FACTOR toward 0.3-0.5 -- but be aware that
 *   the calibration against BF will drift.
 * ------------------------------------------------------------------------- */

const SALT_PH_DROP_PER_MEQ_CA   = 0.0;
const SALT_PH_DROP_PER_MEQ_MG   = 0.0;
const LIME_EFFECTIVENESS_FACTOR = 0.0;

// 88% lactic acid: density 1.21 g/mL, MW 90.08, monoprotic.
// mEq per mL = (1.21 * 0.88 * 1000) / 90.08 = 11.82.
const LACTIC_88_MEQ_PER_ML = 11.82;

// mL of 88% lactic to neutralize 1 g of slaked lime (Ca(OH)2), if
// counted at 100% effectiveness.  Effective dose is scaled by
// LIME_EFFECTIVENESS_FACTOR above.
//   1 g Ca(OH)2 = 1000 / 37.05 (eq wt) = 27.0 mEq of base;
//   27.0 mEq / 11.82 mEq/mL = 2.28 mL.
const LIME_ACID_ML_PER_G_100PCT = 2.28;
const LIME_ACID_ML_PER_G = LIME_ACID_ML_PER_G_100PCT * LIME_EFFECTIVENESS_FACTOR;

// mL 88% lactic to grams (density).
const LACTIC_88_DENSITY = 1.21;

// mEq of acid delivered per kg of acidulated malt per 1% lactic
// content.  Derivation:
//   1 kg malt * 1% = 10 g lactic acid
//   10 g / 90.08 g/mol = 111 mmol = 111 mEq (lactic is monoprotic)
// So a typical 3% acidulated malt supplies 333 mEq/kg, equivalent
// to 333 / 11.82 = 28 mL of 88% lactic acid per kg of acid malt.
const ACID_MALT_MEQ_PER_KG_PER_PERCENT = 111.0;

/* ---------------------------------------------------------------------------
 * Unit helpers for grain rows.
 * ------------------------------------------------------------------------- */

/**
 * Convert a per-row {weight, unit} pair to kilograms.  Accepts lb,
 * oz, kg, g; anything else returns 0.
 * @param {{weight:number, unit:string}} row
 * @returns {number} kilograms
 */
export function grainRowToKg(row) {
  const w = row?.weight || 0;
  switch (row?.unit) {
    case "lb": return w * 0.453592;
    case "oz": return w * 0.0283495;
    case "kg": return w;
    case "g":  return w * 0.001;
    default:   return 0;
  }
}

/**
 * Sum every grain row's mass and return the total in kilograms.
 * @param {Array<{weight:number, unit:string}>} rows
 * @returns {number}
 */
export function totalGrainKg(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((s, r) => s + grainRowToKg(r), 0);
}

/* ---------------------------------------------------------------------------
 * calculate_chemistry -- rewritten in v0.3.0.
 * ------------------------------------------------------------------------- */

/**
 * @param {Object} p
 * @param {number} p.waterVol       TOTAL brew water (gal or L)
 * @param {number} p.targetPh       target mash pH (e.g., 5.4)
 * @param {Array<{weight:number, unit:string, category:string, color:number}>} p.grainRows
 * @param {number} p.tgtCa          target Ca ppm
 * @param {number} p.tgtMg          target Mg ppm
 * @param {number} p.tgtNa          target Na ppm
 * @param {number} p.tgtSo4         target SO4 ppm
 * @param {number} p.tgtCl          target Cl ppm
 * @param {boolean} p.isMetric      true = kg/L, false = lb/gal (for waterVol only)
 * @returns {Object}                salt/acid doses + pH diagnostics
 */
export function calculateChemistry({
  waterVol, targetPh,
  grainRows = [],
  tgtCa, tgtMg, tgtNa, tgtSo4, tgtCl,
  isMetric,
}) {
  // Normalize rows -- attach kg and category metadata.
  const rows = (grainRows || []).map((r) => ({
    ...r,
    kg:  grainRowToKg(r),
    cat: GRAIN_CATEGORIES[r.category] || GRAIN_CATEGORIES.base,
  })).filter((r) => r.kg > 0);

  const totalKg = rows.reduce((s, r) => s + r.kg, 0);

  if (!(waterVol > 0) || !(totalKg > 0)) {
    return {
      gypsum: 0, cacl2: 0, epsom: 0, salt: 0, lime: 0,
      acid: 0, acid_g: 0,
      di_mash_ph: null, est_mash_ph: null,
      acid_for_ph_ml: 0, acid_for_lime_ml: 0,
      acid_from_acidulated_ml: 0,
    };
  }

  const volL = isMetric ? waterVol : waterVol * 3.78541;

  // -- Salt additions (identical to v0.1.0 / v0.2.0) --
  const gEpsom       = (tgtMg * volL) / 98.6;
  const addedSo4Epsom = (gEpsom * 1000 * 0.39) / volL;
  const gSalt        = (tgtNa * volL) / 393.0;
  const addedClSalt  = (gSalt * 1000 * 0.607) / volL;
  const remSo4       = Math.max(0, tgtSo4 - addedSo4Epsom);
  const gGypsum      = (remSo4 * volL) / 558.0;
  const addedCaGypsum = (gGypsum * 1000 * 0.233) / volL;
  const remCl        = Math.max(0, tgtCl - addedClSalt);
  const gCacl2       = (remCl * volL) / 482.0;
  const addedCaCacl2 = (gCacl2 * 1000 * 0.272) / volL;
  const totalCaSalts = addedCaGypsum + addedCaCacl2;
  const remCa        = Math.max(0, tgtCa - totalCaSalts);
  const gLime        = remCa > 0.1 ? (remCa * volL) / 540.0 : 0.0;

  // -- Grain-bill-driven mash pH --
  // Split rows into pH-forming (base/crystal/roasted) vs acid-source
  // (acidulated).  Only pH-forming rows contribute to the weighted DI
  // mash pH average.  Every row (including acidulated) contributes to
  // buffer capacity.
  const phRows   = rows.filter((r) => !r.cat.isAcidSource);
  const acidRows = rows.filter((r) => r.cat.isAcidSource);
  const phKg     = phRows.reduce((s, r) => s + r.kg, 0);

  let diMashPh = null;
  if (phKg > 0) {
    diMashPh = phRows.reduce((s, r) => {
      const L = r.color || 0;
      return s + r.kg * r.cat.diFn(L);
    }, 0) / phKg;
  }

  const bufferMEqPerPh = rows.reduce((s, r) => s + r.kg * r.cat.buffer, 0);

  // Acidulated malt: each kg at X% lactic delivers X * 11.10 mEq of
  // acid to the mash, offsetting the lactic-acid dose the brewer
  // otherwise needs to add.
  const acidFromAcidulatedMEq = acidRows.reduce((s, r) => {
    const pctLactic = r.color || 0;
    return s + r.kg * pctLactic * ACID_MALT_MEQ_PER_KG_PER_PERCENT;
  }, 0);
  const acidFromAcidulatedMl = acidFromAcidulatedMEq / LACTIC_88_MEQ_PER_ML;

  // Salt-induced pH shift.  At the current BF-calibrated constants
  // (SALT_PH_DROP_PER_MEQ_* both 0) this collapses to zero.  Left in
  // place so future re-tuning is a single-line change.
  const meqCa      = (totalCaSalts + remCa) / 20.0;
  const meqMg      = tgtMg / 12.15;
  const saltPhDrop = (meqCa * SALT_PH_DROP_PER_MEQ_CA)
                   + (meqMg * SALT_PH_DROP_PER_MEQ_MG);
  // Lime-induced pH rise.  At the current BF-calibrated constant
  // (LIME_EFFECTIVENESS_FACTOR = 0) this collapses to zero.
  const limePhRise = bufferMEqPerPh > 0
    ? (gLime * 27.0 * LIME_EFFECTIVENESS_FACTOR) / bufferMEqPerPh
    : 0;
  // Acidulated-malt-induced pH drop.  Real chemistry regardless of
  // calibration -- acid malt is acid, it moves pH.
  const acidulatedPhDrop = bufferMEqPerPh > 0
    ? acidFromAcidulatedMEq / bufferMEqPerPh
    : 0;
  // est_mash_ph is the "pre-added-lactic" mash pH -- what the mash
  // is expected to read AFTER accounting for grain bill (including
  // acidulated malt) + salts + lime, BEFORE the brewer adds any
  // extra lactic acid.  This is what BF's "Mash pH: X.XX" indicator
  // shows above the acid-additions block when Acid Amount is blank.
  const estMashPh = diMashPh != null
    ? diMashPh - saltPhDrop + limePhRise - acidulatedPhDrop
    : null;

  // -- Acid dose --
  // Two independent contributions, in mL of 88% lactic:
  //   1. Bring est_mash_ph down to targetPh (buffer-capacity method).
  //      Zero if the mash is already at/below target.  Since
  //      est_mash_ph already accounts for acidulated malt, no
  //      additional subtraction is needed here.
  //   2. Neutralize slaked lime, scaled by LIME_EFFECTIVENESS_FACTOR.
  //      At the current BF-calibrated factor (0) this term is zero.
  const acidMEqForPh = estMashPh != null
    ? Math.max(0, (estMashPh - targetPh) * bufferMEqPerPh)
    : 0;
  const acidForPhMl   = acidMEqForPh / LACTIC_88_MEQ_PER_ML;
  const acidForLimeMl = gLime * LIME_ACID_ML_PER_G;
  const totalAcid     = acidForPhMl + acidForLimeMl;

  return {
    gypsum: gGypsum,
    cacl2:  gCacl2,
    epsom:  gEpsom,
    salt:   gSalt,
    lime:   gLime,
    acid:   totalAcid,
    acid_g: totalAcid * LACTIC_88_DENSITY,
    di_mash_ph:              diMashPh,
    est_mash_ph:             estMashPh,
    acid_for_ph_ml:          acidForPhMl,
    acid_for_lime_ml:        acidForLimeMl,
    acid_from_acidulated_ml: acidFromAcidulatedMl,
  };
}
