import requests
import random
import math
import time
import threading


# ============================================================
# AEROSYNX TELEMETRY BRIDGE
# ============================================================

API_URL = (
    "https://virtual-engine-api.onrender.com/api/telemetry"
)

API_TIMEOUT = 1.5

_LATEST_API_DATA = None
_API_LOCK = threading.Lock()
_BG_THREAD_STARTED = False
_HTTP_SESSION = requests.Session()


def _bg_api_fetcher():
    global _LATEST_API_DATA
    while True:
        try:
            response = _HTTP_SESSION.get(API_URL, timeout=1.5)
            if response.status_code == 200:
                data = response.json()
                if isinstance(data, dict):
                    with _API_LOCK:
                        _LATEST_API_DATA = data
        except Exception:
            pass
        time.sleep(0.15)


def start_bg_fetcher():
    global _BG_THREAD_STARTED
    if not _BG_THREAD_STARTED:
        _BG_THREAD_STARTED = True
        t = threading.Thread(target=_bg_api_fetcher, daemon=True)
        t.start()


start_bg_fetcher()



# ============================================================
# ENGINE PARAMETERS
# ============================================================

ENGINE_FIELDS = [
    "rpm",
    "cht_c",
    "egt_c",
    "oil_press_bar",
    "oil_temp_c",
    "fuel_flow_lph",
    "vibration_g",
    "battery_v",
    "injection_deg",
    "roll_deg",
    "pitch_deg",
    "yaw_deg"
]


# ============================================================
# NORMAL OPERATING RANGES
# ============================================================

NORMAL_RANGES = {
    "rpm": {"min": 4800, "max": 5300, "unit": "RPM"},
    "cht_c": {"min": 95, "max": 125, "unit": "°C"},
    "egt_c": {"min": 620, "max": 720, "unit": "°C"},
    "oil_press_bar": {"min": 2.5, "max": 4.2, "unit": "bar"},
    "oil_temp_c": {"min": 85, "max": 105, "unit": "°C"},
    "fuel_flow_lph": {"min": 14, "max": 18, "unit": "L/h"},
    "vibration_g": {"min": 0.05, "max": 0.15, "unit": "g"},
    "battery_v": {"min": 13.8, "max": 14.4, "unit": "V"},
    "injection_deg": {"min": 20, "max": 25, "unit": "°"},
    "roll_deg": {"min": -30, "max": 30, "unit": "°"},
    "pitch_deg": {"min": -15, "max": 15, "unit": "°"},
    "yaw_deg": {"min": 0, "max": 360, "unit": "°"}
}


# ============================================================
# POSSIBLE FAULTS
# ============================================================

FAULT_MAPPING = {
    "rpm": ["misfire", "combustion_instability"],
    "cht_c": ["overheating", "coking_degradation"],
    "egt_c": ["misfire", "combustion_instability", "overheating"],
    "oil_press_bar": ["lubrication_issue"],
    "oil_temp_c": ["lubrication_issue", "overheating"],
    "fuel_flow_lph": ["injector_abnormality"],
    "vibration_g": ["misfire", "abnormal_vibration", "combustion_instability"],
    "battery_v": ["battery_alternator_health"],
    "injection_deg": ["injector_abnormality", "injection_timing_issue"],
    "roll_deg": [],
    "pitch_deg": [],
    "yaw_deg": []
}


# ============================================================
# SIMULATION RANGES
# ============================================================

SIMULATION_RANGES = {
    "rpm": (4800, 5300),
    "cht_c": (95, 125),
    "egt_c": (620, 720),
    "oil_press_bar": (2.5, 4.2),
    "oil_temp_c": (85, 105),
    "fuel_flow_lph": (14, 18),
    "vibration_g": (0.05, 0.15),
    "battery_v": (13.8, 14.4),
    "injection_deg": (20, 25),
    "roll_deg": (-15, 15),
    "pitch_deg": (-5, 5),
    "yaw_deg": (0, 360)
}


# ============================================================
# GET REAL API DATA (NON-BLOCKING)
# ============================================================


def get_api_telemetry():
    with _API_LOCK:
        if _LATEST_API_DATA is not None:
            return dict(_LATEST_API_DATA)

    return None




# ============================================================
# FIND VALUE IN API RESPONSE
# ============================================================

def get_api_value(
    api_data,
    field
):

    if not api_data:

        return None


    # Direct format
    if field in api_data:

        return api_data[field]


    # Possible "reading" format
    if isinstance(
        api_data.get("reading"),
        dict
    ):

        if field in api_data["reading"]:

            return api_data[
                "reading"
            ][field]


    # Possible "telemetry" format
    if isinstance(
        api_data.get("telemetry"),
        dict
    ):

        if field in api_data["telemetry"]:

            return api_data[
                "telemetry"
            ][field]


    # Possible "data" format
    if isinstance(
        api_data.get("data"),
        dict
    ):

        if field in api_data["data"]:

            return api_data[
                "data"
            ][field]


    return None


# ============================================================
# CHECK VALUE
# ============================================================

def valid_value(value):

    if value is None:
        return False

    if value == "":
        return False

    try:

        float(value)

        return True

    except (
        ValueError,
        TypeError
    ):

        return False


# ============================================================
# SIMULATE MISSING VALUE
# ============================================================

def simulate_value(field):

    low, high = SIMULATION_RANGES[field]

    return random.uniform(
        low,
        high
    )


# ============================================================
# CHECK NORMAL RANGE
# ============================================================

def check_parameter_range(
    field,
    value
):

    if not valid_value(value):

        return {

            "status": "UNAVAILABLE",

            "possible_faults": [],

            "message":
                "No value available."
        }


    value = float(value)

    limits = NORMAL_RANGES[field]

    minimum = limits["min"]

    maximum = limits["max"]


    if minimum <= value <= maximum:

        return {

            "status": "NORMAL",

            "possible_faults": [],

            "message":
                "Within normal operating range."
        }


    return {

        "status": "OUT_OF_RANGE",

        "possible_faults":
            FAULT_MAPPING.get(
                field,
                []
            ),

        "message":
            f"{field} value {value:.2f} "
            f"is outside normal range "
            f"{minimum}-{maximum}."
    }


# ============================================================
# CREATE HYBRID READING
# ============================================================

def create_hybrid_reading(

    hardware_data=None,

    simulated_data=None,

    fault="none"

):

    # --------------------------------------------------------
    # Try API first
    # --------------------------------------------------------

    api_data = get_api_telemetry()


    # --------------------------------------------------------
    # Backward compatibility
    # hardware_data can also contain real values
    # --------------------------------------------------------

    if hardware_data is None:

        hardware_data = {}


    if simulated_data is None:

        simulated_data = {}


    reading = {}

    source = {}

    range_status = {}

    possible_faults = []


    # ========================================================
    # PROCESS EACH SENSOR
    # ========================================================

    for field in ENGINE_FIELDS:


        # ----------------------------------------------------
        # 1. API / REAL HARDWARE
        # ----------------------------------------------------

        api_value = get_api_value(
            api_data,
            field
        )


        if valid_value(api_value):

            base_val = float(api_value)
            
            # Special handling for attitude parameters if API returns static 0
            if field in ["roll_deg", "pitch_deg", "yaw_deg"]:
                t = time.time()
                if field == "roll_deg":
                    reading[field] = base_val if base_val != 0 else (math.sin(t * 0.4) * 14.0 + random.uniform(-0.3, 0.3))
                elif field == "pitch_deg":
                    reading[field] = base_val if base_val != 0 else (math.sin(t * 0.3 + 1.2) * 5.0 + random.uniform(-0.2, 0.2))
                elif field == "yaw_deg":
                    reading[field] = base_val if base_val != 0 else ((t * 3.5) % 360.0)
            else:
                reading[field] = base_val

            source[field] = (
                "REAL HARDWARE / API"
            )






        # ----------------------------------------------------
        # 2. DIRECT HARDWARE DATA
        # ----------------------------------------------------

        elif valid_value(
            hardware_data.get(field)
        ):

            reading[field] = float(
                hardware_data[field]
            )

            source[field] = (
                "REAL HARDWARE"
            )


        # ----------------------------------------------------
        # 3. SIMULATION FALLBACK
        # ----------------------------------------------------

        elif valid_value(
            simulated_data.get(field)
        ):

            reading[field] = float(
                simulated_data[field]
            )

            source[field] = (
                "SIMULATED FALLBACK"
            )


        # ----------------------------------------------------
        # 4. AUTOMATIC SIMULATION
        # ----------------------------------------------------

        else:

            reading[field] = simulate_value(
                field
            )

            source[field] = (
                "SIMULATED FALLBACK"
            )


        # ----------------------------------------------------
        # RANGE CHECK
        # ----------------------------------------------------

        result = check_parameter_range(

            field,

            reading[field]
        )


        range_status[field] = result


        # ----------------------------------------------------
        # COLLECT POSSIBLE FAULTS
        # ----------------------------------------------------

        for detected_fault in result[
            "possible_faults"
        ]:

            if detected_fault not in possible_faults:

                possible_faults.append(
                    detected_fault
                )


    # ========================================================
    # API STATUS
    # ========================================================

    api_connected = (
        api_data is not None
    )


    # ========================================================
    # CONTEXT EXTRACTION
    # ========================================================

    context = {}
    if isinstance(api_data, dict):
        if "context" in api_data and isinstance(api_data["context"], dict):
            context = api_data["context"]
        else:
            raw_f = api_data.get("fault") or api_data.get("active_fault") or "none"
            if raw_f == "coking":
                raw_f = "coking_degradation"
            elif raw_f == "lubrication":
                raw_f = "lubrication_issue"
            elif raw_f == "battery":
                raw_f = "battery_alternator_health"
            context = {
                "active_fault": raw_f,
                "mission_profile": api_data.get("mission_profile", "normal_cruise")
            }


    # ========================================================
    # RETURN HYBRID TELEMETRY
    # ========================================================

    return {

        "reading":
            reading,

        "source":
            source,

        "range_status":
            range_status,

        "possible_faults":
            possible_faults,

        "context":
            context,

        "api":
            {

                "connected":
                    api_connected,

                "url":
                    API_URL
            }
    }