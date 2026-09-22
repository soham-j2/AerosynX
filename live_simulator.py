import time

from data_fusion import DataFusion
from ai_digital_twin import AIDigitalTwin


fusion = DataFusion(
    seed=42
)

twin = AIDigitalTwin()


def line(char="=", length=80):
    print(char * length)


def safe(value, default="N/A"):
    if value is None:
        return default

    try:
        return float(value)

    except Exception:
        return value


def print_section(title):

    print()
    print("-" * 80)
    print(title)
    print("-" * 80)


def print_current_data(result):

    reading = result.get(
        "current_state",
        {}
    )

    source = result.get(
        "source",
        {}
    )

    print_section(
        "1. UNIFIED TELEMETRY"
    )

    fields = [
        ("rpm", "RPM"),
        ("load", "%"),
        ("cht_c", "°C"),
        ("egt_c", "°C"),
        ("oil_press_bar", "bar"),
        ("oil_temp_c", "°C"),
        ("fuel_flow_lph", "L/h"),
        ("vibration_g", "g"),
        ("battery_v", "V"),
        ("injection_deg", "°"),
        ("current_a", "A"),
        ("altitude", "ft"),
        ("ambient_temp", "°C"),
        ("throttle", "%"),
    ]

    for field, unit in fields:

        if field not in reading:
            continue

        value = safe(
            reading[field]
        )

        src = source.get(
            field,
            "UNKNOWN"
        )

        if isinstance(
            value,
            float
        ):

            print(
                f"{field:<20} "
                f"{value:>10.2f} "
                f"{unit:<5} "
                f"[{src}]"
            )

        else:

            print(
                f"{field:<20} "
                f"{value} "
                f"{unit:<5} "
                f"[{src}]"
            )


def print_digital_twin(result):

    expected = result.get(
        "expected_state",
        {}
    )

    residuals = result.get(
        "residuals",
        {}
    )

    health = result.get(
        "health_score"
    )

    print_section(
        "2. PHYSICS-INFORMED DIGITAL TWIN"
    )

    print(
        f"Engine Health Score : "
        f"{safe(health):.2f}/100"
    )

    print()
    print(
        f"{'Parameter':<25}"
        f"{'Expected':>12}"
        f"{'Residual':>15}"
    )

    mapping = [
        (
            "cht_c",
            "CHT",
            "cht_residual"
        ),
        (
            "egt_c",
            "EGT",
            "egt_residual"
        ),
        (
            "oil_press_bar",
            "Oil Pressure",
            "oil_press_residual"
        ),
        (
            "oil_temp_c",
            "Oil Temperature",
            "oil_temp_residual"
        ),
        (
            "fuel_flow_lph",
            "Fuel Flow",
            "fuel_flow_residual"
        ),
        (
            "vibration_g",
            "Vibration",
            "vibration_residual"
        ),
        (
            "battery_v",
            "Battery",
            "battery_residual"
        ),
        (
            "injection_deg",
            "Injection",
            "injection_residual"
        ),
    ]

    for key, label, residual_key in mapping:

        expected_value = expected.get(
            key
        )

        residual_value = residuals.get(
            residual_key
        )

        if expected_value is None:
            continue

        print(
            f"{label:<25}"
            f"{float(expected_value):>12.3f}"
            f"{float(residual_value or 0):>15.3f}"
        )


def print_ai(result):

    ai = result.get(
        "ai_prediction",
        {}
    )

    print_section(
        "3. AI / ML DIAGNOSTICS"
    )

    print(
        "Isolation Forest"
    )

    print(
        f"  Anomaly detected : "
        f"{ai.get('anomaly_detected')}"
    )

    print(
        f"  Anomaly score    : "
        f"{ai.get('anomaly_score')}"
    )

    print()
    print(
        "Random Forest Fault Classifier"
    )

    print(
        f"  Fault            : "
        f"{ai.get('predicted_fault')}"
    )

    print(
        f"  Confidence       : "
        f"{ai.get('fault_confidence')}"
    )

    print()
    print(
        "RUL Model"
    )

    print(
        f"  Predicted RUL    : "
        f"{ai.get('predicted_rul_hours')} hours"
    )

    print(
        f"  Decision         : "
        f"{ai.get('decision')}"
    )

    print(
        f"  Recommendation   : "
        f"{ai.get('maintenance_recommendation')}"
    )


def print_temporal(result):

    temporal = result.get(
        "temporal_analysis",
        {}
    )

    print_section(
        "4. TEMPORAL DEGRADATION ENGINE"
    )

    print(
        f"History length     : "
        f"{temporal.get('history_length')}"
    )

    print(
        f"Trajectory         : "
        f"{temporal.get('trajectory')}"
    )

    print(
        f"Degradation score  : "
        f"{temporal.get('degradation_score')}"
    )

    print(
        f"Confidence         : "
        f"{temporal.get('confidence')}%"
    )

    print(
        f"Message            : "
        f"{temporal.get('message')}"
    )

    print()
    print(
        "Future Engine State"
    )

    future = temporal.get(
        "future_state",
        {}
    )

    if not future:

        print(
            "  Waiting for enough "
            "ordered telemetry..."
        )

        return

    for minutes, state in future.items():

        print(
            f"\n  +{minutes} minutes"
        )

        for key, value in state.items():

            print(
                f"    {key:<25}"
                f"{value}"
            )


def print_summary(result):

    ai = result.get(
        "ai_prediction",
        {}
    )

    temporal = result.get(
        "temporal_analysis",
        {}
    )

    line("=")

    print(
        "AEROSYNX ENGINE INTELLIGENCE SUMMARY"
    )

    line("=")

    print(
        f"Health       : "
        f"{result.get('health_score')}"
    )

    print(
        f"Anomaly      : "
        f"{ai.get('anomaly_detected')}"
    )

    print(
        f"Fault        : "
        f"{ai.get('predicted_fault')}"
    )

    print(
        f"RUL          : "
        f"{ai.get('predicted_rul_hours')} hours"
    )

    print(
        f"Trajectory   : "
        f"{temporal.get('trajectory')}"
    )

    print(
        f"Degradation  : "
        f"{temporal.get('degradation_score')}"
    )

    line("=")


# ============================================================
# MAIN LOOP
# ============================================================

print()
line("=")

print(
    "AEROSYNX — AI ENGINE DIGITAL TWIN"
)

print(
    "CONTINUOUS BACKEND SIMULATION"
)

line("=")

print()
print(
    "Pipeline:"
)

print(
    "Telemetry → Digital Twin → "
    "Isolation Forest → Random Forest → "
    "RUL → Temporal Degradation → "
    "Future Engine State"
)

print()
print(
    "Press CTRL+C to stop."
)

try:

    while True:

        # -----------------------------------------------
        # Generate hybrid telemetry
        # -----------------------------------------------

        telemetry = fusion.fuse()

        # -----------------------------------------------
        # AI processing
        # -----------------------------------------------

        result = twin.process(
            telemetry
        )

        # -----------------------------------------------
        # Terminal output
        # -----------------------------------------------

        line("=")

        print(
            f"TIMESTAMP: "
            f"{telemetry['timestamp']}"
        )

        print_current_data(
            result
        )

        print_digital_twin(
            result
        )

        print_ai(
            result
        )

        print_temporal(
            result
        )

        print_summary(
            result
        )

        time.sleep(1)

except KeyboardInterrupt:

    print()
    line("=")

    print(
        "AEROSYNX SIMULATION STOPPED"
    )

    line("=")