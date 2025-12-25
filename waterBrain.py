# developer's note 
# to run locally on pi: activate venv, navigate to src/, bash streamlit run waterBrain.py

import streamlit as st
import json

# --- INTEGRATED BREWMATH LOGIC ---
class BrewMath:
    @staticmethod
    def calculate_water(grain_wt, grain_temp, mash_temp, target_vol, trub_loss, 
                        boil_time, boiloff_rate, abs_rate, method, thickness, is_metric):
        # Post Boil = Fermenter + Trub
        post_boil_vol = target_vol + trub_loss
        total_boiloff = boiloff_rate * (boil_time / 60.0)
        pre_boil_vol = post_boil_vol + total_boiloff
        
        # Absorption Calculation
        if is_metric:
            # Input is L/kg, result is L
            total_abs = grain_wt * abs_rate
        else:
            # Input is qt/lb, convert to gallons (qt / 4)
            # Result is gallons
            total_abs = (grain_wt * abs_rate) / 4.0
        
        total_water_needed = pre_boil_vol + total_abs
        
        # Strike / Sparge Split
        if method == "Sparge":
            strike_vol = (grain_wt * thickness) if is_metric else (grain_wt * thickness) / 4.0
            strike_vol = min(strike_vol, total_water_needed)
            sparge_vol = total_water_needed - strike_vol
        else:
            strike_vol = total_water_needed
            sparge_vol = 0.0
        
        # Mash Volume & Strike Temp
        grain_disp = grain_wt * (0.67 if is_metric else 0.08)
        total_mash_vol = strike_vol + grain_disp
        
        strike_temp = mash_temp
        if grain_wt > 0 and strike_vol > 0:
            if is_metric:
                ratio = strike_vol / grain_wt
                strike_temp = mash_temp + (0.41 / ratio) * (mash_temp - grain_temp)
            else:
                ratio = (strike_vol * 4.0) / grain_wt
                strike_temp = mash_temp + (0.2 / ratio) * (mash_temp - grain_temp)

        return {
            "strike_vol": strike_vol, "strike_temp": strike_temp, "sparge_vol": sparge_vol,
            "total_mash_vol": total_mash_vol, "pre_boil_vol": pre_boil_vol, "total_water": total_water_needed
        }

    @staticmethod
    def calculate_chemistry(water_vol, srm, target_ph, grain_wt, 
                            tgt_ca, tgt_mg, tgt_na, tgt_so4, tgt_cl, is_metric):
        if water_vol <= 0: return {k: 0.0 for k in ["gypsum", "cacl2", "epsom", "salt", "lime", "acid", "acid_g"]}

        # Normalize to Liters and Kg for chemistry math
        vol_L = water_vol if is_metric else water_vol * 3.78541
        grain_kg = grain_wt if is_metric else grain_wt * 0.453592

        # Salts
        g_epsom = (tgt_mg * vol_L) / 98.6
        added_so4_epsom = (g_epsom * 1000 * 0.39) / vol_L
        g_salt = (tgt_na * vol_L) / 393.0
        added_cl_salt = (g_salt * 1000 * 0.607) / vol_L
        
        rem_so4 = max(0, tgt_so4 - added_so4_epsom)
        g_gypsum = (rem_so4 * vol_L) / 558.0 
        added_ca_gypsum = (g_gypsum * 1000 * 0.233) / vol_L
        
        rem_cl = max(0, tgt_cl - added_cl_salt)
        g_cacl2 = (rem_cl * vol_L) / 482.0    
        added_ca_cacl2 = (g_cacl2 * 1000 * 0.272) / vol_L
        
        total_ca_salts = added_ca_gypsum + added_ca_cacl2
        rem_ca = max(0, tgt_ca - total_ca_salts)
        g_lime = (rem_ca * vol_L) / 540.0 if rem_ca > 0.1 else 0.0
        
        # Acid Calculation
        # Base pH intercept 5.70 aligned with RO water
        base_mash_ph = 5.70 - (0.018 * srm)
        meq_ca = (total_ca_salts + rem_ca) / 20.0  
        meq_mg = tgt_mg / 12.15
        salt_ph_drop = (meq_ca * 0.04) + (meq_mg * 0.03)
        est_mash_ph = base_mash_ph - salt_ph_drop
        
        ml_acid_base = (est_mash_ph - target_ph) * grain_kg * 3.0 if grain_kg > 0 else 0.0
        total_acid = max(0, ml_acid_base + (g_lime * 2.3))
        
        return {
            "gypsum": g_gypsum, "cacl2": g_cacl2, "epsom": g_epsom, "salt": g_salt,
            "lime": g_lime, "acid": total_acid, "acid_g": total_acid * 1.21
        }

# --- DATA LOADING ---
def load_profiles():
    try:
        with open('target_water_profiles.json', 'r') as f:
            return json.load(f)
    except:
        return [{"name": "Default", "ca": 50, "mg": 10, "na": 10, "so4": 50, "cl": 50}]

profiles = load_profiles()
profile_names = [p['name'] for p in profiles]

# --- STREAMLIT UI ---
st.set_page_config(page_title="waterBrain", layout="wide")
st.title("waterBrain Brew Day Calculator")

if 'water_res' not in st.session_state: st.session_state.water_res = None
if 'chem_res' not in st.session_state: st.session_state.chem_res = None

with st.sidebar:
    st.header("Assumptions")
    st.write("(1) Starting water is processed with Reverse Osmosis, is neutral pH, and has no alkalinity.")
    st.write("(2) For Sparge calculations, full volume water treatment is assumed. This is a free and simple calculator.")
    st.write("(3) Use at your own risk. Compare results with other calculators.")
    st.markdown("<br><hr>", unsafe_allow_html=True)
    st.header("Global Settings")
    unit_system = st.radio("Select Unit System", ["US Standard (lb/Gal/°F)", "Metric (kg/L/°C)"], index=0)
    is_metric = (unit_system == "Metric (kg/L/°C)")
    
    # Define Units
    # u_abs set to 'qt/lb' for US or 'L/kg' for Metric
    u_wt, u_temp, u_vol, u_thick, u_abs = ("kg", "°C", "L", "L/kg", "L/kg") if is_metric else ("lb", "°F", "gal", "qt/lb", "qt/lb")

col_in, col_out = st.columns([1, 1], gap="large")

with col_in:
    st.subheader("1. Water Requirements Inputs")
    with st.container(border=True):
        method = st.radio("Mash Method", ["No Sparge (BIAB)", "Sparge"], horizontal=True)
        c1, c2 = st.columns(2)
        grain_wt = c1.number_input(f"Grain Weight ({u_wt})", min_value=0.1, value=10.0 if not is_metric else 4.5)
        boil_time = c1.number_input("Boil Time (min)", value=60)
        grain_temp = c2.number_input(f"Grain Temp ({u_temp})", value=70 if not is_metric else 21)
        mash_temp = c2.number_input(f"Target Mash Temp ({u_temp})", value=152 if not is_metric else 67)
        c3, c4 = st.columns(2)
        boiloff = c3.number_input(f"Boiloff Rate ({u_vol}/hr)", value=1.0 if not is_metric else 3.8)
        
        # Swapped: Abs Rate moved to c3
        absorption_rate = c3.number_input(f"Grain Abs. Rate ({u_abs})", value=1.04 if is_metric else 0.5, step=0.01)

        trub_vol = c4.number_input(f"Trub Volume\n({u_vol})", value=0.25 if not is_metric else 1.0)
        
        # Swapped: Ferm Volume moved to c4
        ferm_vol = c4.number_input(f"Volume into Fermenter ({u_vol})", value=5.5 if not is_metric else 21.0)

        thickness = c4.number_input(f"Mash Thickness ({u_thick})", value=1.5 if not is_metric else 3.0) if method == "Sparge" else 3.0
        
        if st.button("CALCULATE WATER VOLUMES", type="primary", use_container_width=True):
            res = BrewMath.calculate_water(grain_wt, grain_temp, mash_temp, ferm_vol, trub_vol, 
                                          boil_time, boiloff, absorption_rate, "Sparge" if method == "Sparge" else "no_sparge", 
                                          thickness, is_metric)
            st.session_state.water_res = res
            st.session_state.chem_res = None

    st.subheader("2. Chemistry & Profile Inputs")
    with st.container(border=True):
        selected_prof_name = st.selectbox("Load Target Profile", profile_names)
        prof = next(p for p in profiles if p['name'] == selected_prof_name)
        c5, c6 = st.columns(2)
        srm = c5.number_input("Beer SRM", min_value=1, max_value=40, value=5)
        target_ph = c6.number_input("Target pH", min_value=4.5, max_value=6.5, value=5.4, step=0.1)
        t_ca = st.number_input("Calcium (Ca)", value=int(prof['ca']))
        t_mg = st.number_input("Magnesium (Mg)", value=int(prof['mg']))
        t_na = st.number_input("Sodium (Na)", value=int(prof['na']))
        t_so4 = st.number_input("Sulfate (SO4)", value=int(prof['so4']))
        t_cl = st.number_input("Chloride (Cl)", value=int(prof['cl']))

        if st.button("CALCULATE SALTS", type="primary", use_container_width=True):
            if st.session_state.water_res:
                w = st.session_state.water_res
                st.session_state.chem_res = BrewMath.calculate_chemistry(w['total_water'], srm, target_ph, grain_wt, 
                                                                       t_ca, t_mg, t_na, t_so4, t_cl, is_metric)
            else: st.error("Calculate Volumes first!")

with col_out:
    st.subheader("Brew Day Results")
    if st.session_state.water_res:
        w = st.session_state.water_res
        st.info("### 💧 Water Requirements")
        m1, m2 = st.columns(2)
        m1.metric("Strike Water", f"{w['strike_vol']:.2f} {u_vol}")
        m1.metric("Sparge Water", f"{w['sparge_vol']:.2f} {u_vol}")
        m2.metric("Strike Temp", f"{w['strike_temp']:.1f} {u_temp}")
        m2.metric("Pre-Boil Volume", f"{w['pre_boil_vol']:.2f} {u_vol}")
        st.write(f"**Total Mash Volume:** {w['total_mash_vol']:.2f} {u_vol}")
        st.warning("Ensure your Mash Tun is large enough to hold the total mash volume.")
        st.divider()
        if st.session_state.chem_res:
            s = st.session_state.chem_res
            st.success("### 🧂 Salt Additions")
            r1, r2 = st.columns(2)
            r1.metric("Gypsum", f"{s['gypsum']:.2f} g"); r1.metric("CaCl2", f"{s['cacl2']:.2f} g"); r1.metric("Epsom", f"{s['epsom']:.2f} g")
            r2.metric("Salt", f"{s['salt']:.2f} g"); r2.metric("Lime", f"{s['lime']:.2f} g")
            r2.metric("Lactic (88%)", f"{s['acid']:.2f} ml", delta=f"{s['acid_g']:.2f} g", delta_color="off")
        else: st.warning("Water calculated. Click 'Calculate Salts' to see additions.")
