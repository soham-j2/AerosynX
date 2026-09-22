
import time
import random
import requests

from telemetry_bridge import (
    create_hybrid_reading
)

from digital_twin import (
    EngineDigitalTwin
)

from predict import (
    predict_engine
)


# ============================================================
# AEROSYNX REAL-TIME HYBRID DIGITAL TWIN
# ============================================================

twin = EngineDigitalTwin()


# ============================================================
# HARDWARE / REAL-TIME API
# ============================================================

API_URL = (
    "https://virtual-engine-api.onrender.com/api/telemetry"
)


# ============================================================
# ENGINE PARAMETERS
#
# These are the parameters required by AeroSynX.
#
# API/HARDWARE = PRIMARY
# SIMULATION    = FALLBACK
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

    "injection_deg"
]


# ============================================================
# NORMAL OPERATING RANGES
# ============================================================

NORMAL_RANGES = {

    "rpm": (4800, 5300),

    "cht_c": (95, 125),

    "egt_c": (620, 720),

    "oil_press_bar": (2.5, 4.2),

    "oil_temp_c": (85, 105),

    "fuel_flow_lph": (14, 18),

    "vibration_g": (0.05, 0.15),

    "battery_v": (13.8, 14.4),

    "injection_deg": (20, 25)
}


# ============================================================
# FAULT MAPPING
#
# Used for engineering/range-based fault indication.
# ============================================================

FAULT_MAPPING = {

    "rpm": [
        "misfire",
        "combustion_instability"
    ],

    "cht_c": [
        "overheating",
        "coking_degradation"
    ],

    "egt_c": [
        "misfire",
        "combustion_instability",
        "overheating"
    ],

    "oil_press_bar": [
        "lubrication_issue"
    ],

    "oil_temp_c": [
        "lubrication_issue",
        "overheating"
    ],

    "fuel_flow_lph": [
        "injector_abnormality"
    ],

    "vibration_g": [
        "misfire",
        "abnormal_vibration",
        "combustion_instability"
    ],

    "battery_v": [
        "battery/alternator_health"
    ],

    "injection_deg": [
        "injector_abnormality",
        "injection_timing_issue"
    ]
}


# ============================================================
# SIMULATED OPERATING CONDITIONS
# ============================================================

def generate_operating_context():

    return {

        "load":
            random.uniform(
                40,
                80
            ),

        "altitude":
            random.uniform(
                3000,
                12000
            ),

        "ambient_temp":
            random.uniform(
                15,
                40
            ),

        "throttle":
            random.uniform(
                40,
                85
            )
    }


# ============================================================
# SIMULATED ENGINE DATA
#
# IMPORTANT:
# These values are ONLY used when the API does not provide
# the required parameter.
# ============================================================

def generate_simulated_data():

    return {

        "rpm":
            random.uniform(
                4800,
                5300
            ),

        "cht_c":
            random.uniform(
                95,
                125
            ),

        "egt_c":
            random.uniform(
                620,
                720
            ),

        "oil_press_bar":
            random.uniform(
                2.5,
                4.2
            ),

        "oil_temp_c":
            random.uniform(
                85,
                105
            ),

        "fuel_flow_lph":
            random.uniform(
                14,
                18
            ),

        "vibration_g":
            random.uniform(
                0.05,
                0.15
            ),

        "battery_v":
            random.uniform(
                13.8,
                14.4
            ),

        "injection_deg":
            random.uniform(
                20,
                25
            )
    }


# ============================================================
# FETCH REAL HARDWARE DATA FROM API
# ============================================================

def fetch_hardware_data():

    try:

        response = requests.get(
            API_URL,
            timeout=5
        )

        response.raise_for_status()

        data = response.json()

        # ----------------------------------------------------
        # Some APIs return:
        #
        # {
        #     "rpm": ...,
        #     "cht_c": ...
        # }
        #
        # Others may return:
        #
        # {
        #     "data": {
        #         "rpm": ...
        #     }
        # }
        # ----------------------------------------------------

        if isinstance(data, dict):

            if isinstance(
                data.get("data"),
                dict
            ):

                data = data["data"]

            elif isinstance(
                data.get("telemetry"),
                dict
            ):

                data = data["telemetry"]

            elif isinstance(
                data.get("reading"),
                dict
            ):

                data = data["reading"]


        if not isinstance(data, dict):

            print(
                "API returned unexpected data format."
            )

            return {}


        hardware_data = {}


        # ----------------------------------------------------
        # Extract only the parameters AeroSynX needs.
        # ----------------------------------------------------

        for field in ENGINE_FIELDS:

            if field in data:

                value = data[field]

                # Ignore null values

                if value is not None:

                    try:

                        hardware_data[field] = float(
                            value
                        )

                    except (
                        ValueError,
                        TypeError
                    ):

                        pass


        return hardware_data


    except requests.exceptions.RequestException as error:

        print(
            f"API unavailable: {error}"
        )

        return {}


    except Exception as error:

        print(
            f"API data error: {error}"
        )

        return {}


# ============================================================
# PARAMETER-LEVEL HYBRID DATA
#
# Hardware/API value is used when available.
#
# If a parameter is missing from the API,
# simulation supplies ONLY that parameter.
# ============================================================

def create_parameter_level_hybrid_data(
    hardware_data,
    simulated_data
):

    final_data = {}

    source = {}

    for field in ENGINE_FIELDS:

        # ----------------------------------------------------
        # PRIMARY SOURCE = HARDWARE/API
        # ----------------------------------------------------

        if (

            hardware_data
            and field in hardware_data
            and hardware_data[field] is not None

        ):

            final_data[field] = (
                hardware_data[field]
            )

            source[field] = "REAL HARDWARE/API"


        # ----------------------------------------------------
        # FALLBACK = SIMULATION
        # ----------------------------------------------------

        else:

            final_data[field] = (
                simulated_data[field]
            )

            source[field] = "SIMULATION FALLBACK"


    return final_data, source


# ============================================================
# ENGINEERING RANGE ANALYSIS
# ============================================================

def analyze_engineering_ranges(
    sensor_data
):

    range_status = {}

    possible_faults = set()


    for field in ENGINE_FIELDS:

        value = sensor_data[field]

        low, high = NORMAL_RANGES[field]


        if low <= value <= high:

            range_status[field] = {

                "status": "NORMAL",

                "value": value,

                "normal_range": (
                    low,
                    high
                ),

                "possible_faults": []

            }


        else:

            faults = FAULT_MAPPING.get(
                field,
                []
            )


            for fault in faults:

                possible_faults.add(
                    fault
                )


            range_status[field] = {

                "status": "OUT_OF_RANGE",

                "value": value,

                "normal_range": (
                    low,
                    high
                ),

                "possible_faults": faults

            }


    return {

        "range_status":
            range_status,

        "possible_faults":
            sorted(
                possible_faults
            )

    }


# ============================================================
# DISPLAY TELEMETRY
# ============================================================

def display_telemetry(
    sensor_data,
    source
):

    print()

    print(
        "TELEMETRY SOURCE"
    )

    print(
        "-" * 80
    )


    for field in ENGINE_FIELDS:

        value = sensor_data[field]

        field_source = source[field]


        print(

            f"{field:<25} "

            f"{value:<12.3f} "

            f"[{field_source}]"

        )


# ============================================================
# DISPLAY RANGE ANALYSIS
# ============================================================

def display_range_analysis(
    range_analysis
):

    print()

    print(
        "ENGINEERING RANGE ANALYSIS"
    )

    print(
        "-" * 80
    )


    range_status = (
        range_analysis[
            "range_status"
        ]
    )


    for field, result in range_status.items():

        status = result["status"]


        if status == "NORMAL":

            print(

                f"{field:<25} "

                f"[NORMAL]"

            )


        else:

            low, high = (
                result[
                    "normal_range"
                ]
            )


            print(

                f"{field:<25} "

                f"[OUT OF RANGE]"

            )


            print(

                f"   Value: "
                f"{result['value']:.3f}"

            )


            print(

                f"   Normal range: "
                f"{low} - {high}"

            )


            if result[
                "possible_faults"
            ]:

                print(

                    "   Possible fault(s): "
                    +
                    ", ".join(
                        result[
                            "possible_faults"
                        ]
                    )

                )


    possible_faults = (
        range_analysis[
            "possible_faults"
        ]
    )


    print()


    if possible_faults:

        print(
            "⚠ POSSIBLE FAULTS FROM "
            "ENGINEERING LIMITS:"
        )


        for fault in possible_faults:

            print(
                f"   • {fault}"
            )


    else:

        print(
            "ENGINEERING STATUS: "
            "ALL PARAMETERS NORMAL"
        )


# ============================================================
# DISPLAY DIGITAL TWIN
# ============================================================

def display_twin(
    twin_result
):

    print()

    print(
        "DIGITAL TWIN CURRENT STATE"
    )

    print(
        "-" * 80
    )


    current = (
        twin_result[
            "current_state"
        ]
    )


    print(
        f"RPM              : "
        f"{current['rpm']:.2f}"
    )

    print(
        f"CHT              : "
        f"{current['cht_c']:.2f} °C"
    )

    print(
        f"EGT              : "
        f"{current['egt_c']:.2f} °C"
    )

    print(
        f"Oil Pressure     : "
        f"{current['oil_press_bar']:.2f} bar"
    )

    print(
        f"Oil Temperature  : "
        f"{current['oil_temp_c']:.2f} °C"
    )

    print(
        f"Fuel Flow        : "
        f"{current['fuel_flow_lph']:.2f} L/h"
    )

    print(
        f"Vibration        : "
        f"{current['vibration_g']:.3f} g"
    )

    print(
        f"Battery          : "
        f"{current['battery_v']:.2f} V"
    )

    print(
        f"Injection Timing : "
        f"{current['injection_deg']:.2f}°"
    )


# ============================================================
# DISPLAY EXPECTED STATE
# ============================================================

def display_expected_state(
    twin_result
):

    print()

    print(
        "DIGITAL TWIN EXPECTED STATE"
    )

    print(
        "-" * 80
    )


    expected = (
        twin_result[
            "expected_state"
        ]
    )


    print(
        f"Expected CHT          : "
        f"{expected['cht_c']:.2f} °C"
    )

    print(
        f"Expected EGT          : "
        f"{expected['egt_c']:.2f} °C"
    )

    print(
        f"Expected Oil Pressure : "
        f"{expected['oil_press_bar']:.2f} bar"
    )

    print(
        f"Expected Oil Temp     : "
        f"{expected['oil_temp_c']:.2f} °C"
    )

    print(
        f"Expected Vibration    : "
        f"{expected['vibration_g']:.3f} g"
    )


# ============================================================
# DISPLAY RESIDUALS
# ============================================================

def display_residuals(
    twin_result
):

    print()

    print(
        "DIGITAL TWIN RESIDUALS"
    )

    print(
        "-" * 80
    )


    residuals = (
        twin_result[
            "residuals"
        ]
    )


    print(
        f"CHT Residual          : "
        f"{residuals['cht_residual']:.2f}"
    )

    print(
        f"EGT Residual          : "
        f"{residuals['egt_residual']:.2f}"
    )

    print(
        f"Oil Pressure Residual : "
        f"{residuals['oil_pressure_residual']:.2f}"
    )

    print(
        f"Vibration Residual    : "
        f"{residuals['vibration_residual']:.3f}"
    )


# ============================================================
# DISPLAY AI RESULT
# ============================================================

def display_ai_result(
    ai_result
):

    print()

    print(
        "AI / ML ANALYSIS"
    )

    print(
        "-" * 80
    )


    print(
        f"Anomaly Status      : "
        f"{ai_result['anomaly_status']}"
    )

    print(
        f"Anomaly Score       : "
        f"{ai_result['anomaly_score']}"
    )

    print(
        f"Predicted Fault     : "
        f"{ai_result['predicted_fault']}"
    )

    print(
        f"Fault Confidence    : "
        f"{ai_result['fault_confidence']}"
    )

    print(
        f"Estimated RUL       : "
        f"{ai_result['rul_hours']} hours"
    )

    print(
        f"Decision            : "
        f"{ai_result['decision']}"
    )

    print(
        f"Recommendation      : "
        f"{ai_result['maintenance_recommendation']}"
    )


# ============================================================
# MAIN
# ============================================================

def main():

    print()

    print(
        "=" * 80
    )

    print(
        "AEROSYNX REAL-TIME HYBRID DIGITAL TWIN"
    )

    print(
        "=" * 80
    )

    print()

    print(
        "REAL HARDWARE/API → PRIMARY SOURCE"
    )

    print(
        "SIMULATION → PARAMETER-LEVEL FALLBACK"
    )

    print()

    print(
        "API:"
    )

    print(
        API_URL
    )

    print()

    print(
        "Press CTRL+C to stop."
    )


    try:

        while True:

            # =================================================
            # 1. OPERATING CONTEXT
            # =================================================

            context = (
                generate_operating_context()
            )


            # =================================================
            # 2. GENERATE SIMULATION
            #
            # Simulation is always available as fallback.
            # =================================================

            simulated_data = (
                generate_simulated_data()
            )


            # =================================================
            # 3. GET REAL HARDWARE/API DATA
            # =================================================

            hardware_data = (
                fetch_hardware_data()
            )


            # =================================================
            # 4. HYBRID DATA FUSION
            #
            # Example:
            #
            # API:
            # rpm       → available
            # vibration → available
            # battery   → available
            #
            # Missing:
            # CHT       → simulation
            # EGT       → simulation
            #
            # Final reading contains both.
            # =================================================

            sensor_data, source = (
                create_parameter_level_hybrid_data(

                    hardware_data,

                    simulated_data

                )
            )


            # =================================================
            # 5. ENGINEERING RANGE ANALYSIS
            # =================================================

            range_analysis = (
                analyze_engineering_ranges(
                    sensor_data
                )
            )


            # =================================================
            # 6. DIGITAL TWIN
            # =================================================

            twin_result = twin.update(
                sensor_data
            )


            # =================================================
            # 7. RESIDUALS
            # =================================================

            residuals = (
                twin_result[
                    "residuals"
                ]
            )


            # =================================================
            # 8. AI INPUT
            #
            # IMPORTANT:
            # AI receives the FINAL HYBRID DATA.
            #
            # Therefore AI does NOT care whether a value came
            # from hardware or simulation.
            #
            # It receives the best available value.
            # =================================================

            ai_input = {

                "rpm":
                    sensor_data[
                        "rpm"
                    ],

                "cht_c":
                    sensor_data[
                        "cht_c"
                    ],

                "egt_c":
                    sensor_data[
                        "egt_c"
                    ],

                "oil_press_bar":
                    sensor_data[
                        "oil_press_bar"
                    ],

                "oil_temp_c":
                    sensor_data[
                        "oil_temp_c"
                    ],

                "fuel_flow_lph":
                    sensor_data[
                        "fuel_flow_lph"
                    ],

                "vibration_g":
                    sensor_data[
                        "vibration_g"
                    ],

                "battery_v":
                    sensor_data[
                        "battery_v"
                    ],

                "injection_deg":
                    sensor_data[
                        "injection_deg"
                    ],

                "cht_residual":
                    residuals[
                        "cht_residual"
                    ],

                "egt_residual":
                    residuals[
                        "egt_residual"
                    ],

                "oil_pressure_residual":
                    residuals[
                        "oil_pressure_residual"
                    ],

                "vibration_residual":
                    residuals[
                        "vibration_residual"
                    ]
            }


            # =================================================
            # 9. ENGINEERING FAULTS
            # =================================================

            engineering_faults = (
                range_analysis[
                    "possible_faults"
                ]
            )


            # =================================================
            # 10. AI / ML PREDICTION
            # =================================================

            ai_result = predict_engine(

                ai_input,

                engineering_faults=
                    engineering_faults

            )


            # =================================================
            # 11. DISPLAY
            # =================================================

            print()

            print(
                "=" * 80
            )

            print(
                "AEROSYNX"
            )

            print(
                "REAL-TIME ENGINE HEALTH MONITORING"
            )

            print(
                "=" * 80
            )


            # -------------------------------------------------
            # OPERATING CONTEXT
            # -------------------------------------------------

            print()

            print(
                "OPERATING CONTEXT"
            )

            print(
                "-" * 80
            )

            print(
                f"Load       : "
                f"{context['load']:.2f}%"
            )

            print(
                f"Altitude   : "
                f"{context['altitude']:.2f} m"
            )

            print(
                f"Ambient    : "
                f"{context['ambient_temp']:.2f} °C"
            )

            print(
                f"Throttle   : "
                f"{context['throttle']:.2f}%"
            )


            # -------------------------------------------------
            # API STATUS
            # -------------------------------------------------

            print()

            if hardware_data:

                print(
                    "API STATUS: CONNECTED"
                )

                print(
                    f"Hardware/API parameters received: "
                    f"{len(hardware_data)}/"
                    f"{len(ENGINE_FIELDS)}"
                )

            else:

                print(
                    "API STATUS: UNAVAILABLE"
                )

                print(
                    "Simulation fallback is being used."
                )


            # -------------------------------------------------
            # TELEMETRY
            # -------------------------------------------------

            display_telemetry(
                sensor_data,
                source
            )


            # -------------------------------------------------
            # RANGE ANALYSIS
            # -------------------------------------------------

            display_range_analysis(
                range_analysis
            )


            # -------------------------------------------------
            # DIGITAL TWIN
            # -------------------------------------------------

            display_twin(
                twin_result
            )


            display_expected_state(
                twin_result
            )


            display_residuals(
                twin_result
            )


            # -------------------------------------------------
            # HEALTH
            # -------------------------------------------------

            print()

            print(
                f"ENGINE HEALTH : "
                f"{twin_result['health_score']:.2f}/100"
            )


            # -------------------------------------------------
            # AI
            # -------------------------------------------------

            display_ai_result(
                ai_result
            )


            print()

            print(
                "=" * 80
            )


            # =================================================
            # NEXT READING
            # =================================================

            time.sleep(2)


    except KeyboardInterrupt:

        print()

        print(
            "AEROSYNX REAL-TIME SYSTEM STOPPED."
        )


# ============================================================
# START
# ============================================================

if __name__ == "__main__":

    main()

