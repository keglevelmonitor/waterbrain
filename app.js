/* WaterBrain main app shell.
 *
 * Responsibilities:
 *   - Tab switching (calculator / profiles / settings / about).
 *   - Unit-system toggle in the header (US <-> Metric).  Swaps input
 *     defaults + input-unit labels; results are always g / mL.
 *   - Water requirements form + results.
 *   - Chemistry form + results (with 26 built-in profiles).
 *   - Profiles tab: browse-and-load surface.
 *   - Settings tab: unit-system radios + reset-inputs.
 *   - Changelog fetch (About tab + header version pill).
 *
 * Everything runs client-side.  Persistence is limited to a couple of
 * localStorage keys for the unit system and the last-used inputs so a
 * refresh doesn't wipe the user's brew-day sheet.
 */

import {
  calculateWater,
  calculateChemistry,
  GRAIN_CATEGORIES,
  grainRowToKg,
  totalGrainKg,
} from "./brewmath.js";
import { BUILTIN_PROFILES, findProfile } from "./profiles.js";

/* ---------------------------------------------------------------------------
 * App state (in-memory)
 * ------------------------------------------------------------------------- */

const app = {
  isMetric:      false,
  method:        "no_sparge",   // "sparge" | "no_sparge"
  selectedProfile: BUILTIN_PROFILES[0].name,
  grainBill:     [],            // Array of {weight, unit, category, color}
  waterRes:      null,
  chemRes:       null,
};

const LS_UNITS  = "waterbrain.units";     // "us" | "metric"
const LS_INPUTS = "waterbrain.inputs.v3"; // v3 = per-row grain-bill schema
const LS_METHOD = "waterbrain.method";    // "sparge" | "no_sparge"
const LS_PROFILE = "waterbrain.profile";  // selected profile name

/* ---------------------------------------------------------------------------
 * Default inputs -- kept in a single place so the "Reset" button and
 * the unit-toggle can both draw from them.
 * ------------------------------------------------------------------------- */

function defaultInputs(isMetric) {
  return isMetric
    ? {
        grainTemp: 21,
        mashTemp:  67,
        boilTime:  60,
        boiloff:   3.8,
        trub:      1.0,
        abs:       1.04,
        ferm:      21.0,
        thickness: 3.0,
        targetPh:  5.4,
      }
    : {
        grainTemp: 70,
        mashTemp:  152,
        boilTime:  60,
        boiloff:   1.0,
        trub:      0.25,
        abs:       0.5,
        ferm:      5.5,
        thickness: 1.5,
        targetPh:  5.4,
      };
}

/* Default grain bill -- a plain pale ale in the active unit system.
 * Two rows: 9 lb pale + 1 lb C40 (or 4.0 kg + 0.5 kg in metric).
 * Users can add / remove rows freely; the first row cannot be
 * deleted so the calculator always has at least one grain input. */
function defaultGrainBill(isMetric) {
  return isMetric
    ? [
        { weight: 4.0, unit: "kg", category: "base",    color: 2   },
        { weight: 0.5, unit: "kg", category: "crystal", color: 40  },
      ]
    : [
        { weight: 9,   unit: "lb", category: "base",    color: 2   },
        { weight: 1,   unit: "lb", category: "crystal", color: 40  },
      ];
}

/* Unit label pairs.  Applied to every <span class="u-*"> in the HTML. */
function unitLabels(isMetric) {
  return isMetric
    ? { wt: "kg", temp: "\u00b0C", vol: "L",   thick: "L/kg",  abs: "L/kg"  }
    : { wt: "lb", temp: "\u00b0F", vol: "gal", thick: "qt/lb", abs: "qt/lb" };
}

const $  = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

/* ---------------------------------------------------------------------------
 * Init
 * ------------------------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", init);

function init() {
  // Restore persisted preferences first, then wire everything up.
  try {
    const u = localStorage.getItem(LS_UNITS);
    if (u === "metric") app.isMetric = true;
  } catch (_) {}
  try {
    const m = localStorage.getItem(LS_METHOD);
    if (m === "sparge" || m === "no_sparge") app.method = m;
  } catch (_) {}
  try {
    const p = localStorage.getItem(LS_PROFILE);
    if (p && findProfile(p)) app.selectedProfile = p;
  } catch (_) {}

  wireTabs();
  wireUnitToggle();
  wireCalculator();
  wireProfilesTab();
  wireSettings();

  populateProfileDropdown();
  applyUnitSystem();  // paints labels + loads defaults into the form
  restoreInputsIfAny();
  syncMethodButtons();
  renderProfilesList();

  loadChangelog().catch(err =>
    console.warn("[changelog] load failed:", err && err.message));
}

/* ---------------------------------------------------------------------------
 * Tabs
 * ------------------------------------------------------------------------- */

function wireTabs() {
  for (const btn of $$(".nav-btn")) {
    btn.addEventListener("click", () => {
      const t = btn.getAttribute("data-tab");
      for (const b of $$(".nav-btn")) b.classList.toggle("active", b === btn);
      for (const el of $$(".tab")) {
        el.classList.toggle("hidden", el.id !== "tab-" + t);
      }
    });
  }
}

/* ---------------------------------------------------------------------------
 * Unit system
 * ------------------------------------------------------------------------- */

function wireUnitToggle() {
  $("#unit-pill").addEventListener("click", () => setUnitSystem(!app.isMetric));
  $("#btn-unit-us").addEventListener("click",     () => setUnitSystem(false));
  $("#btn-unit-metric").addEventListener("click", () => setUnitSystem(true));
}

function setUnitSystem(metric) {
  if (metric === app.isMetric) return;
  app.isMetric = !!metric;
  try { localStorage.setItem(LS_UNITS, metric ? "metric" : "us"); } catch (_) {}
  applyUnitSystem();
  // Results computed under the old unit system don't survive the flip.
  app.waterRes = null;
  app.chemRes  = null;
  $("#water-results").classList.add("hidden");
  $("#chem-results").classList.add("hidden");
  setMsg("#chem-msg", "", "");
}

function applyUnitSystem() {
  const u = unitLabels(app.isMetric);
  for (const el of $$(".u-wt"))    el.textContent = u.wt;
  for (const el of $$(".u-temp"))  el.textContent = u.temp;
  for (const el of $$(".u-vol"))   el.textContent = u.vol;
  for (const el of $$(".u-thick")) el.textContent = u.thick;
  for (const el of $$(".u-abs"))   el.textContent = u.abs;

  const pill = $("#unit-pill");
  pill.textContent = app.isMetric ? "METRIC" : "US";
  pill.className   = "status-pill " + (app.isMetric ? "unit-metric" : "unit-us");
  pill.title       = app.isMetric
    ? "Metric (kg / L / \u00b0C).  Click to switch to US Standard."
    : "US Standard (lb / gal / \u00b0F).  Click to switch to Metric.";

  // Load defaults for the new unit system so numbers are sane.
  populateInputsForm(defaultInputs(app.isMetric));

  // Convert any existing grain-bill rows to the new unit system.
  // Weight is preserved (by conversion) so a 9 lb Pale becomes
  // 4.08 kg Pale, not a defaulted 4.0 kg Pale.  Users who never
  // touched the grain bill get the fresh defaults.
  if (app.grainBill.length === 0) {
    app.grainBill = defaultGrainBill(app.isMetric);
  } else {
    app.grainBill = app.grainBill.map((r) => convertGrainRowUnits(r, app.isMetric));
  }
  renderGrainBill();
}

/* ---------------------------------------------------------------------------
 * Calculator: form <-> state
 * ------------------------------------------------------------------------- */

function populateInputsForm(vals) {
  $("#in-grain-temp").value = vals.grainTemp;
  $("#in-mash-temp").value  = vals.mashTemp;
  $("#in-boil-time").value  = vals.boilTime;
  $("#in-boiloff").value    = vals.boiloff;
  $("#in-trub").value       = vals.trub;
  $("#in-abs").value        = vals.abs;
  $("#in-ferm").value       = vals.ferm;
  $("#in-thickness").value  = vals.thickness;
  $("#in-target-ph").value  = vals.targetPh;

  loadProfileIntoIonFields(app.selectedProfile);
}

function readInputsForm() {
  return {
    grainTemp: parseFloat($("#in-grain-temp").value) || 0,
    mashTemp:  parseFloat($("#in-mash-temp").value)  || 0,
    boilTime:  parseFloat($("#in-boil-time").value)  || 0,
    boiloff:   parseFloat($("#in-boiloff").value)    || 0,
    trub:      parseFloat($("#in-trub").value)       || 0,
    abs:       parseFloat($("#in-abs").value)        || 0,
    ferm:      parseFloat($("#in-ferm").value)       || 0,
    thickness: parseFloat($("#in-thickness").value)  || 0,
    targetPh:  parseFloat($("#in-target-ph").value)  || 5.4,
    ca:        parseFloat($("#in-ca").value)         || 0,
    mg:        parseFloat($("#in-mg").value)         || 0,
    na:        parseFloat($("#in-na").value)         || 0,
    so4:       parseFloat($("#in-so4").value)        || 0,
    cl:        parseFloat($("#in-cl").value)         || 0,
  };
}

/* ---------------------------------------------------------------------------
 * Grain bill: state <-> table rendering.
 *
 * app.grainBill is the single source of truth.  Every user-facing
 * mutation (add row, delete row, weight edit, unit change, category
 * change, color edit) flows through onGrainRowChange() /
 * addGrainRow() / deleteGrainRow(), which update the array and then
 * re-render the affected bits.  Rendering is a wholesale
 * innerHTML-replace; the tables are small (typically <10 rows) so
 * the naive approach is faster to reason about than a diff.
 * ------------------------------------------------------------------------- */

/** Return the unit options valid in the current unit system. */
function grainUnitOptions() {
  return app.isMetric ? ["kg", "g"] : ["lb", "oz"];
}

/** Convert a grain row's weight to the closest sensible unit in the
 *  target system.  lb->kg, oz->g, kg->lb, g->oz.  Preserves mass. */
function convertGrainRowUnits(row, toMetric) {
  const kg = grainRowToKg(row);
  if (toMetric) {
    if (row.unit === "lb" || row.unit === "oz") {
      // lb -> kg (whole quantities), oz -> g (small quantities).
      if (row.unit === "oz") return { ...row, weight: +(kg * 1000).toFixed(1), unit: "g" };
      return { ...row, weight: +kg.toFixed(3), unit: "kg" };
    }
    return row;
  } else {
    if (row.unit === "kg" || row.unit === "g") {
      if (row.unit === "g") return { ...row, weight: +(kg / 0.0283495).toFixed(2), unit: "oz" };
      return { ...row, weight: +(kg / 0.453592).toFixed(2), unit: "lb" };
    }
    return row;
  }
}

/** Rebuild the grain-bill table body from app.grainBill. */
function renderGrainBill() {
  const tbody = $("#grain-bill-rows");
  if (!tbody) return;
  tbody.innerHTML = "";
  app.grainBill.forEach((row, idx) => tbody.appendChild(renderGrainRow(row, idx)));
  updateGrainTotal();
}

function renderGrainRow(row, idx) {
  const tr = document.createElement("tr");
  tr.dataset.idx = String(idx);

  const unitOpts = grainUnitOptions().map(
    (u) => `<option value="${u}"${row.unit === u ? " selected" : ""}>${u}</option>`
  ).join("");

  const catOpts = Object.entries(GRAIN_CATEGORIES).map(
    ([key, cat]) =>
      `<option value="${key}"${row.category === key ? " selected" : ""}>${cat.label}</option>`
  ).join("");

  const canDelete = app.grainBill.length > 1;

  tr.innerHTML = `
    <td><input type="number" step="0.01" min="0" class="grain-weight" value="${row.weight}"/></td>
    <td><select class="grain-unit">${unitOpts}</select></td>
    <td><select class="grain-cat">${catOpts}</select></td>
    <td><input type="number" step="0.1" min="0" class="grain-color" value="${row.color}"/></td>
    <td><button type="button" class="grain-del" title="Remove grain"${canDelete ? "" : " disabled"}>&times;</button></td>
  `;

  tr.querySelector(".grain-weight").addEventListener("input",  () => onGrainRowChange(idx, "weight"));
  tr.querySelector(".grain-unit"  ).addEventListener("change", () => onGrainRowChange(idx, "unit"));
  tr.querySelector(".grain-cat"   ).addEventListener("change", () => onGrainRowChange(idx, "category"));
  tr.querySelector(".grain-color" ).addEventListener("input",  () => onGrainRowChange(idx, "color"));
  tr.querySelector(".grain-del"   ).addEventListener("click",  () => deleteGrainRow(idx));

  return tr;
}

function onGrainRowChange(idx, field) {
  const tr = $(`#grain-bill-rows tr[data-idx="${idx}"]`);
  if (!tr) return;
  const className = field === "category" ? "grain-cat" : `grain-${field}`;
  const el = tr.querySelector(`.${className}`);
  if (!el) return;
  const raw = el.value;

  if (field === "weight" || field === "color") {
    app.grainBill[idx][field] = parseFloat(raw) || 0;
    updateGrainTotal();
  } else if (field === "category") {
    const prev = app.grainBill[idx].category;
    app.grainBill[idx].category = raw;
    // If the color still matches the old category's default, snap it
    // to the new category's default so brewers switching from Base
    // to Roasted don't leave a 2 L "chocolate" behind by accident.
    const prevDefault = GRAIN_CATEGORIES[prev]?.defaultColor;
    const nextDefault = GRAIN_CATEGORIES[raw]?.defaultColor;
    if (Math.abs((app.grainBill[idx].color || 0) - (prevDefault || 0)) < 0.01) {
      app.grainBill[idx].color = nextDefault;
      // Re-render just the color input for this row.
      const colorInput = tr.querySelector(".grain-color");
      if (colorInput) colorInput.value = nextDefault;
    }
  } else {
    app.grainBill[idx][field] = raw;
  }

  persistInputs();
}

function addGrainRow() {
  const defaults = GRAIN_CATEGORIES.base;
  app.grainBill.push({
    weight: 1.0,
    unit:   grainUnitOptions()[0],
    category: "base",
    color:  defaults.defaultColor,
  });
  renderGrainBill();
  persistInputs();
}

function deleteGrainRow(idx) {
  if (app.grainBill.length <= 1) return;    // keep at least one row
  app.grainBill.splice(idx, 1);
  renderGrainBill();
  persistInputs();
}

/** Live-update the "Total: X.XX lb" hint from app.grainBill. */
function updateGrainTotal() {
  const el = $("#grain-total");
  if (!el) return;
  const kg = totalGrainKg(app.grainBill);
  const display = app.isMetric ? kg : kg / 0.453592;
  el.textContent = display.toFixed(2);
}

function persistInputs() {
  try {
    const payload = {
      units:     app.isMetric ? "metric" : "us",
      grainBill: app.grainBill,
      ...readInputsForm(),
    };
    localStorage.setItem(LS_INPUTS, JSON.stringify(payload));
  } catch (_) {}
}

function restoreInputsIfAny() {
  let saved = null;
  try {
    const raw = localStorage.getItem(LS_INPUTS);
    if (raw) saved = JSON.parse(raw);
  } catch (_) {}
  if (!saved) return;
  const wantUnits = app.isMetric ? "metric" : "us";
  if (saved.units !== wantUnits) return;

  const vals = { ...defaultInputs(app.isMetric), ...saved };
  populateInputsForm(vals);

  if (saved.ca != null)  $("#in-ca").value  = saved.ca;
  if (saved.mg != null)  $("#in-mg").value  = saved.mg;
  if (saved.na != null)  $("#in-na").value  = saved.na;
  if (saved.so4 != null) $("#in-so4").value = saved.so4;
  if (saved.cl != null)  $("#in-cl").value  = saved.cl;

  if (Array.isArray(saved.grainBill) && saved.grainBill.length > 0) {
    app.grainBill = saved.grainBill.filter(
      (r) => r && typeof r === "object" && GRAIN_CATEGORIES[r.category]
    );
    if (app.grainBill.length === 0) app.grainBill = defaultGrainBill(app.isMetric);
    renderGrainBill();
  }
}

/* ---------------------------------------------------------------------------
 * Calculator wiring: buttons, method toggle, profile dropdown
 * ------------------------------------------------------------------------- */

function wireCalculator() {
  for (const btn of $$(".radio-btn[data-method]")) {
    btn.addEventListener("click", () => {
      const m = btn.getAttribute("data-method");
      if (m !== "sparge" && m !== "no_sparge") return;
      app.method = m;
      try { localStorage.setItem(LS_METHOD, m); } catch (_) {}
      syncMethodButtons();
    });
  }

  $("#in-profile").addEventListener("change", (e) => {
    const name = e.target.value;
    app.selectedProfile = name;
    try { localStorage.setItem(LS_PROFILE, name); } catch (_) {}
    loadProfileIntoIonFields(name);
  });

  $("#btn-calc-water").addEventListener("click", runWaterCalc);
  $("#btn-calc-chem").addEventListener("click",  runChemistryCalc);
  $("#btn-add-grain").addEventListener("click",  addGrainRow);

  // Persist inputs on any change so refresh doesn't wipe a brew-day
  // sheet.  Grain-bill rows have their own change wiring inside
  // renderGrainRow() -- this only covers the fixed fields.
  for (const el of $$(".form-field input, .form-field select, .ion-field input")) {
    el.addEventListener("change", persistInputs);
  }
}

function syncMethodButtons() {
  for (const btn of $$(".radio-btn[data-method]")) {
    btn.classList.toggle("active", btn.getAttribute("data-method") === app.method);
  }
  // Grey the thickness field when it's not going to be used.
  const wrap = $("#thickness-field");
  const inThick = $("#in-thickness");
  const isSparge = app.method === "sparge";
  wrap.style.opacity = isSparge ? "1" : "0.4";
  inThick.disabled   = !isSparge;
}

function populateProfileDropdown() {
  const sel = $("#in-profile");
  sel.innerHTML = "";
  for (const p of BUILTIN_PROFILES) {
    const opt = document.createElement("option");
    opt.value = p.name;
    opt.textContent = p.name;
    if (p.name === app.selectedProfile) opt.selected = true;
    sel.appendChild(opt);
  }
}

function loadProfileIntoIonFields(name) {
  const p = findProfile(name);
  if (!p) return;
  $("#in-ca").value  = p.ca;
  $("#in-mg").value  = p.mg;
  $("#in-na").value  = p.na;
  $("#in-so4").value = p.so4;
  $("#in-cl").value  = p.cl;
  $("#profile-desc").textContent = p.description || "";
}

/* ---------------------------------------------------------------------------
 * Calculator: run + render
 * ------------------------------------------------------------------------- */

function runWaterCalc() {
  const v = readInputsForm();
  const totalKg = totalGrainKg(app.grainBill);
  if (!(totalKg > 0)) {
    setMsg("#chem-msg", "", "");
    flashPrimary("btn-calc-water", "Grain bill must have weight > 0");
    return;
  }
  // Convert the summed kg back into the global unit system for the
  // (mostly-arithmetic) water calc.
  const totalGrain = app.isMetric ? totalKg : totalKg / 0.453592;

  const method = app.method === "sparge" ? "Sparge" : "no_sparge";
  const res = calculateWater({
    grainWt:   totalGrain,
    grainTemp: v.grainTemp,
    mashTemp:  v.mashTemp,
    targetVol: v.ferm,
    trubLoss:  v.trub,
    boilTime:  v.boilTime,
    boiloffRate: v.boiloff,
    absRate:   v.abs,
    method,
    thickness: v.thickness,
    isMetric:  app.isMetric,
  });

  app.waterRes = res;
  // Recalculating water invalidates the previous chemistry result --
  // total_water changes, so salt doses would change too.
  app.chemRes  = null;
  $("#chem-results").classList.add("hidden");
  renderWaterResults();
  persistInputs();
}

function runChemistryCalc() {
  if (!app.waterRes) {
    setMsg("#chem-msg", "Calculate water volumes first \u2014 chemistry uses total brew water.", "warn");
    return;
  }
  setMsg("#chem-msg", "", "");

  const v = readInputsForm();
  const res = calculateChemistry({
    waterVol:  app.waterRes.totalWater,
    targetPh:  v.targetPh,
    grainRows: app.grainBill,
    tgtCa:     v.ca,
    tgtMg:     v.mg,
    tgtNa:     v.na,
    tgtSo4:    v.so4,
    tgtCl:     v.cl,
    isMetric:  app.isMetric,
  });

  app.chemRes = res;
  renderChemResults();
  persistInputs();
}

function renderWaterResults() {
  const r = app.waterRes;
  if (!r) { $("#water-results").classList.add("hidden"); return; }
  const u = unitLabels(app.isMetric);

  $("#out-strike-vol").textContent  = `${fmt2(r.strikeVol)} ${u.vol}`;
  $("#out-strike-temp").textContent = `${fmt1(r.strikeTemp)} ${u.temp}`;
  $("#out-sparge-vol").textContent  = `${fmt2(r.spargeVol)} ${u.vol}`;
  $("#out-preboil-vol").textContent = `${fmt2(r.preBoilVol)} ${u.vol}`;
  $("#out-mash-vol").textContent    = `${fmt2(r.totalMashVol)} ${u.vol}`;
  $("#out-total-water").textContent = `${fmt2(r.totalWater)} ${u.vol}`;

  $("#water-results").classList.remove("hidden");
}

function renderChemResults() {
  const s = app.chemRes;
  if (!s) { $("#chem-results").classList.add("hidden"); return; }

  $("#out-gypsum").textContent = fmt2(s.gypsum);
  $("#out-cacl2").textContent  = fmt2(s.cacl2);
  $("#out-epsom").textContent  = fmt2(s.epsom);
  $("#out-salt").textContent   = fmt2(s.salt);
  $("#out-lime").textContent   = fmt2(s.lime);
  $("#out-acid").textContent   = fmt2(s.acid);
  $("#out-acid-sub").textContent = `mL  (\u2248 ${fmt2(s.acid_g)} g)`;

  // pH diagnostic strip: pre-lactic mash pH estimate on the left
  // (grain bill + acidulated malt, matching what BF's "Mash pH"
  // indicator shows before any acid is added), target on the right,
  // acid dose in the subtitle.
  const targetPh = parseFloat($("#in-target-ph").value) || 5.4;
  $("#out-est-ph").textContent = s.est_mash_ph != null ? s.est_mash_ph.toFixed(2) : "\u2014";
  $("#out-target-ph").textContent = targetPh.toFixed(2);

  // Update the note under Est. Mash pH so the user knows whether
  // acid malt is folded in.  Otherwise "from grain bill" is fine.
  const acidMalt = s.acid_from_acidulated_ml || 0;
  const diNote = $("#out-di-note");
  if (diNote) {
    diNote.textContent = acidMalt > 0.005
      ? `grain bill + ${fmt2(acidMalt)} mL acid-malt effect`
      : "from grain bill";
  }

  const ph = s.acid_for_ph_ml || 0;
  const lm = s.acid_for_lime_ml || 0;   // 0 at current calibration
  let split;
  if (ph > 0.005 && lm > 0.005) {
    split = `${fmt2(ph)} mL for pH + ${fmt2(lm)} mL for lime`;
  } else if (ph > 0.005) {
    split = `${fmt2(ph)} mL of 88% lactic`;
  } else if (lm > 0.005) {
    split = `${fmt2(lm)} mL to neutralize lime`;
  } else {
    split = "no acid needed";
  }
  $("#out-acid-split").textContent = split;

  $("#chem-results").classList.remove("hidden");
}

function fmt1(n) { return (Number.isFinite(n) ? n : 0).toFixed(1); }
function fmt2(n) { return (Number.isFinite(n) ? n : 0).toFixed(2); }

/* Ephemeral label swap on a primary button -- three-second flash back
   to the original text.  Used for inline validation so we don't have
   to carve out a permanent error slot next to every button. */
function flashPrimary(id, message) {
  const btn = document.getElementById(id);
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = message;
  setTimeout(() => { btn.textContent = original; }, 3000);
}

/* ---------------------------------------------------------------------------
 * Profiles tab (browse-and-load surface)
 * ------------------------------------------------------------------------- */

function wireProfilesTab() {
  // Nothing to wire eagerly; renderProfilesList attaches handlers.
}

function renderProfilesList() {
  const host = $("#profiles-list");
  host.innerHTML = "";
  for (const p of BUILTIN_PROFILES) {
    const row = document.createElement("div");
    row.className = "profile-row" + (p.name === app.selectedProfile ? " active" : "");

    const title = document.createElement("div");
    title.className = "profile-title";
    title.textContent = p.name;
    row.appendChild(title);

    const ions = document.createElement("div");
    ions.className = "profile-ions";
    ions.innerHTML = `
      <span><span class="ion-key">Ca</span>${p.ca}</span>
      <span><span class="ion-key">Mg</span>${p.mg}</span>
      <span><span class="ion-key">Na</span>${p.na}</span>
      <span><span class="ion-key">SO4</span>${p.so4}</span>
      <span><span class="ion-key">Cl</span>${p.cl}</span>
    `;
    row.appendChild(ions);

    if (p.description) {
      const d = document.createElement("div");
      d.className = "profile-desc";
      d.textContent = p.description;
      row.appendChild(d);
    }

    row.addEventListener("click", () => {
      app.selectedProfile = p.name;
      try { localStorage.setItem(LS_PROFILE, p.name); } catch (_) {}
      // Reflect in the dropdown on the calculator tab.
      const sel = $("#in-profile");
      if (sel) sel.value = p.name;
      loadProfileIntoIonFields(p.name);
      renderProfilesList();
      // Jump to the calculator so the user sees the load land.
      document.querySelector('.nav-btn[data-tab="calculator"]').click();
    });

    host.appendChild(row);
  }
}

/* ---------------------------------------------------------------------------
 * Settings tab (unit toggle buttons + reset)
 * ------------------------------------------------------------------------- */

function wireSettings() {
  $("#btn-reset-inputs").addEventListener("click", () => {
    populateInputsForm(defaultInputs(app.isMetric));
    loadProfileIntoIonFields(app.selectedProfile);
    app.waterRes = null;
    app.chemRes  = null;
    $("#water-results").classList.add("hidden");
    $("#chem-results").classList.add("hidden");
    setMsg("#chem-msg", "", "");
    try { localStorage.removeItem(LS_INPUTS); } catch (_) {}
    setMsg("#reset-msg", "Inputs reset to defaults.", "ok");
    setTimeout(() => setMsg("#reset-msg", "", ""), 3000);
  });
}

/* ---------------------------------------------------------------------------
 * Changelog / version display
 * ------------------------------------------------------------------------- */

async function loadChangelog() {
  const resp = await fetch(`changelog.json?t=${Date.now()}`, { cache: "no-cache" });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const log = await resp.json();

  const label = $("#version-label");
  if (label && log.current) label.textContent = `v${log.current}`;

  const host = $("#rev-history");
  if (!host) return;
  host.innerHTML = "";

  const entries = Array.isArray(log.entries) ? log.entries : [];
  if (!entries.length) {
    host.innerHTML = `<div class="rev-empty">No history yet.</div>`;
    return;
  }

  entries.forEach((e, idx) => {
    const wrap = document.createElement("div");
    wrap.className = "rev-entry";

    const head = document.createElement("div");
    head.className = "rev-entry-head";

    const v = document.createElement("span");
    v.className   = "rev-version";
    v.textContent = `v${e.version || "?"}`;
    head.appendChild(v);

    if (e.date) {
      const d = document.createElement("span");
      d.className   = "rev-date";
      d.textContent = e.date;
      head.appendChild(d);
    }

    if (idx === 0) {
      const tag = document.createElement("span");
      tag.className   = "rev-latest-tag";
      tag.textContent = "latest";
      head.appendChild(tag);
    }

    wrap.appendChild(head);

    const notes = Array.isArray(e.notes) ? e.notes : [];
    if (notes.length) {
      const ul = document.createElement("ul");
      ul.className = "rev-notes";
      for (const n of notes) {
        const li = document.createElement("li");
        li.textContent = n;
        ul.appendChild(li);
      }
      wrap.appendChild(ul);
    }

    host.appendChild(wrap);
  });
}

/* ---------------------------------------------------------------------------
 * Message helper
 * ------------------------------------------------------------------------- */

function setMsg(sel, text, kind) {
  const el = typeof sel === "string" ? $(sel) : sel;
  if (!el) return;
  el.textContent = text;
  el.className   = "msg" + (kind ? " " + kind : "");
}
