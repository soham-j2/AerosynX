
import os
import random
import numpy as np
import pandas as pd


# ============================================================
# AEROSYNX - SYNTHETIC ENGINE DATA GENERATOR
# ============================================================

random.seed(42)
np.random.seed(42)


# ============================================================
# FILE PATHS
# ============================================================

OUTPUT_DIR = "data"

OUTPUT_FILE = os.path.join(
    OUTPUT_DIR,
    "engine_data.csv"
)

os.makedirs(
    OUTPUT_DIR,
    exist_ok=True
)


# ============================================================
# NORMAL OPERATING RANGES
# ============================================================

RANGES = {

    "rpm": (
        4800,
        5300
    ),

    "cht_c": (
        95,
        125
    ),

    "egt_c": (
        620,
        720
    ),

    "oil_press_bar": (
        2.5,
        4.2
    ),

    "oil_temp_c": (
        85,
        105
    ),

    "fuel_flow_lph": (
        14,
        18
    ),

    "vibration_g": (
        0.05,
        0.15
    ),

    "battery_v": (
        13.8,
        14.4
    ),

    "injection_deg": (
        20,
        25
    )
}


# ============================================================
# FAULT TYPES
# ============================================================

FAULTS = [

    "healthy",

    "misfire",

    "injector_abnormality",

    "coking_degradation",

    "lubrication_issue",

    "sensor_drift",

    "combustion_instability",

    "overheating",

    "abnormal_vibration",

    "battery_alternator_health",

    "injection_timing_issue"
]


# ============================================================
# GENERATE NORMAL VALUE
# ============================================================

def normal_value(field):

    low, high = RANGES[field]

    return random.uniform(
        low,
        high
    )


# ============================================================
# EXPECTED ENGINE VALUES
# ============================================================

def calculate_expected_values(
    rpm,
    fuel_flow
):

    # --------------------------------------------------------
    # Expected CHT
    # --------------------------------------------------------

    expected_cht = (

        95

        + 0.04 * (
            rpm - 4800
        )

        + 0.10 * (
            fuel_flow - 14
        ) * 10
    )

    expected_cht = np.clip(
        expected_cht,
        95,
        125
    )


    # --------------------------------------------------------
    # Expected EGT
    # --------------------------------------------------------

    expected_egt = (

        620

        + 0.18 * (
            rpm - 4800
        )

        + 2.0 * (
            fuel_flow - 14
        )
    )

    expected_egt = np.clip(
        expected_egt,
        620,
        720
    )


    # --------------------------------------------------------
    # Expected Oil Pressure
    # --------------------------------------------------------

    expected_oil_press = (

        2.7

        + 0.0025 * (
            rpm - 4800
        )
    )

    expected_oil_press = np.clip(
        expected_oil_press,
        2.5,
        4.2
    )


    # --------------------------------------------------------
    # Expected Vibration
    # --------------------------------------------------------

    expected_vibration = (

        0.06

        + 0.00008 * abs(
            rpm - 5000
        )
    )

    expected_vibration = np.clip(
        expected_vibration,
        0.05,
        0.15
    )


    return {

        "cht_c":
            expected_cht,

        "egt_c":
            expected_egt,

        "oil_press_bar":
            expected_oil_press,

        "vibration_g":
            expected_vibration
    }


# ============================================================
# GENERATE ONE ENGINE SAMPLE
# ============================================================

def generate_sample(fault):

    # ========================================================
    # HEALTHY BASE VALUES
    # ========================================================

    rpm = normal_value(
        "rpm"
    )

    cht = normal_value(
        "cht_c"
    )

    egt = normal_value(
        "egt_c"
    )

    oil_press = normal_value(
        "oil_press_bar"
    )

    oil_temp = normal_value(
        "oil_temp_c"
    )

    fuel_flow = normal_value(
        "fuel_flow_lph"
    )

    vibration = normal_value(
        "vibration_g"
    )

    battery = normal_value(
        "battery_v"
    )

    injection = normal_value(
        "injection_deg"
    )


    # ========================================================
    # FAULT: MISFIRE
    # ========================================================

    if fault == "misfire":

        rpm = random.uniform(
            4400,
            4750
        )

        cht = random.uniform(
            100,
            135
        )

        egt = random.uniform(
            540,
            620
        )

        vibration = random.uniform(
            0.18,
            0.40
        )

        fuel_flow = random.uniform(
            14,
            19
        )


    # ========================================================
    # FAULT: INJECTOR ABNORMALITY
    # ========================================================

    elif fault == "injector_abnormality":

        rpm = random.uniform(
            4650,
            5150
        )

        fuel_flow = random.uniform(
            9,
            13
        )

        egt = random.uniform(
            730,
            820
        )

        injection = random.choice([

            random.uniform(
                12,
                18
            ),

            random.uniform(
                27,
                34
            )
        ])

        vibration = random.uniform(
            0.12,
            0.25
        )


    # ========================================================
    # FAULT: COKING / DEGRADATION
    # ========================================================

    elif fault == "coking_degradation":

        cht = random.uniform(
            130,
            165
        )

        egt = random.uniform(
            730,
            820
        )

        oil_temp = random.uniform(
            105,
            125
        )

        fuel_flow = random.uniform(
            17,
            21
        )

        vibration = random.uniform(
            0.10,
            0.20
        )


    # ========================================================
    # FAULT: LUBRICATION ISSUE
    # ========================================================

    elif fault == "lubrication_issue":

        oil_press = random.uniform(
            0.8,
            2.2
        )

        oil_temp = random.uniform(
            110,
            145
        )

        vibration = random.uniform(
            0.14,
            0.30
        )

        cht = random.uniform(
            110,
            145
        )


    # ========================================================
    # FAULT: SENSOR DRIFT
    # ========================================================

    elif fault == "sensor_drift":

        cht = random.uniform(
            140,
            175
        )


    # ========================================================
    # FAULT: COMBUSTION INSTABILITY
    # ========================================================

    elif fault == "combustion_instability":

        rpm = random.uniform(
            4350,
            5550
        )

        egt = random.uniform(
            550,
            850
        )

        vibration = random.uniform(
            0.20,
            0.45
        )

        injection = random.uniform(
            17,
            29
        )

        fuel_flow = random.uniform(
            12,
            21
        )


    # ========================================================
    # FAULT: OVERHEATING
    # ========================================================

    elif fault == "overheating":

        cht = random.uniform(
            135,
            170
        )

        egt = random.uniform(
            730,
            830
        )

        oil_temp = random.uniform(
            108,
            135
        )

        vibration = random.uniform(
            0.10,
            0.22
        )


    # ========================================================
    # FAULT: ABNORMAL VIBRATION
    # ========================================================

    elif fault == "abnormal_vibration":

        vibration = random.uniform(
            0.20,
            0.50
        )

        rpm = random.uniform(
            4550,
            5450
        )

        cht = random.uniform(
            100,
            135
        )

        egt = random.uniform(
            610,
            750
        )


    # ========================================================
    # FAULT: BATTERY / ALTERNATOR HEALTH
    # ========================================================

    elif fault == "battery_alternator_health":

        battery = random.uniform(
            11.5,
            13.2
        )

        vibration = random.uniform(
            0.06,
            0.18
        )


    # ========================================================
    # FAULT: INJECTION TIMING ISSUE
    # ========================================================

    elif fault == "injection_timing_issue":

        injection = random.choice([

            random.uniform(
                10,
                18
            ),

            random.uniform(
                27,
                35
            )

        ])

        egt = random.uniform(
            700,
            820
        )

        vibration = random.uniform(
            0.12,
            0.25
        )

        fuel_flow = random.uniform(
            12,
            21
        )


    # ========================================================
    # EXPECTED ENGINE VALUES
    # ========================================================

    expected = calculate_expected_values(
        rpm,
        fuel_flow
    )


    # ========================================================
    # RESIDUALS
    # ========================================================

    cht_residual = (
        cht
        - expected["cht_c"]
    )

    egt_residual = (
        egt
        - expected["egt_c"]
    )

    oil_pressure_residual = (
        oil_press
        - expected["oil_press_bar"]
    )

    vibration_residual = (
        vibration
        - expected["vibration_g"]
    )


    # ========================================================
    # RESIDUAL PENALTY
    # ========================================================

    residual_penalty = (

        abs(
            cht_residual
        ) / 30

        +

        abs(
            egt_residual
        ) / 100

        +

        abs(
            oil_pressure_residual
        ) / 2

        +

        abs(
            vibration_residual
        ) / 0.2
    )


    # ========================================================
    # DEGRADATION
    # ========================================================

    degradation = np.clip(
        residual_penalty * 25,
        0,
        100
    )


    # Additional degradation
    # for faulty engine states

    if fault != "healthy":

        degradation += random.uniform(
            5,
            20
        )


    degradation = np.clip(
        degradation,
        0,
        100
    )


    # ========================================================
    # RUL
    # ========================================================

    base_rul = 500

    rul = (
        base_rul
        -
        degradation * 3.5
    )

    rul += random.uniform(
        -15,
        15
    )

    rul = np.clip(
        rul,
        10,
        500
    )


    # ========================================================
    # RETURN SAMPLE
    # ========================================================

    return {

        "rpm":
            round(
                rpm,
                3
            ),

        "cht_c":
            round(
                cht,
                3
            ),

        "egt_c":
            round(
                egt,
                3
            ),

        "oil_press_bar":
            round(
                oil_press,
                3
            ),

        "oil_temp_c":
            round(
                oil_temp,
                3
            ),

        "fuel_flow_lph":
            round(
                fuel_flow,
                3
            ),

        "vibration_g":
            round(
                vibration,
                4
            ),

        "battery_v":
            round(
                battery,
                3
            ),

        "injection_deg":
            round(
                injection,
                3
            ),

        "cht_residual":
            round(
                cht_residual,
                3
            ),

        "egt_residual":
            round(
                egt_residual,
                3
            ),

        "oil_pressure_residual":
            round(
                oil_pressure_residual,
                3
            ),

        "vibration_residual":
            round(
                vibration_residual,
                4
            ),

        "degradation":
            round(
                degradation,
                3
            ),

        "fault":
            fault,

        "rul":
            round(
                rul,
                2
            )
    }


# ============================================================
# GENERATE DATASET
# ============================================================

def generate_dataset(
    samples_per_fault=1000
):

    rows = []


    # Generate samples
    # for every fault class

    for fault in FAULTS:

        for _ in range(
            samples_per_fault
        ):

            rows.append(
                generate_sample(
                    fault
                )
            )


    # ========================================================
    # CREATE DATAFRAME
    # ========================================================

    df = pd.DataFrame(
        rows
    )


    # ========================================================
    # SHUFFLE DATASET
    # ========================================================

    df = df.sample(
        frac=1,
        random_state=42
    ).reset_index(
        drop=True
    )


    # ========================================================
    # SAVE DATASET
    # ========================================================

    df.to_csv(
        OUTPUT_FILE,
        index=False
    )


    # ========================================================
    # DISPLAY INFORMATION
    # ========================================================

    print()

    print("=" * 65)

    print(
        "AEROSYNX DATASET GENERATED"
    )

    print("=" * 65)

    print()

    print(
        f"File: {OUTPUT_FILE}"
    )

    print(
        f"Rows: {len(df)}"
    )

    print(
        f"Columns: {len(df.columns)}"
    )

    print()

    print(
        "Fault distribution:"
    )

    print(
        df["fault"].value_counts()
    )

    print()

    print(
        "Dataset preview:"
    )

    print(
        df.head()
    )

    print()

    print(
        "Normal operating ranges:"
    )

    for field, values in RANGES.items():

        print(
            f"{field:<25} "
            f"{values[0]} - {values[1]}"
        )

    print()

    print(
        "Dataset generation completed."
    )


# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":

    generate_dataset(
        samples_per_fault=1000
    )

