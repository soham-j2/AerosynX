import random
import time


# ============================================================
# AEROSYNC TELEMETRY SIMULATOR
# Generates realistic values using the ranges from the
# project telemetry requirements.
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

    "injection_deg": (20, 25),

    "roll_deg": (-25, 25),

    "pitch_deg": (-25, 25)
}


def generate_normal_value(field):

    low, high = NORMAL_RANGES[field]

    return round(
        random.uniform(low, high),
        3
    )


def generate_fault_value(field, fault):

    # --------------------------------------------------------
    # MISFIRE
    # RPM drops + EGT abnormal + vibration increases
    # --------------------------------------------------------

    if fault == "misfire":

        values = {

            "rpm":
                random.uniform(4000, 4700),

            "cht_c":
                random.uniform(100, 130),

            "egt_c":
                random.uniform(500, 610),

            "oil_press_bar":
                random.uniform(2.8, 4.0),

            "oil_temp_c":
                random.uniform(85, 105),

            "fuel_flow_lph":
                random.uniform(14, 18),

            "vibration_g":
                random.uniform(0.20, 0.50),

            "battery_v":
                random.uniform(13.8, 14.4),

            "injection_deg":
                random.uniform(20, 25),

            "roll_deg":
                random.uniform(-25, 25),

            "pitch_deg":
                random.uniform(-25, 25)
        }

        return round(values[field], 3)


    # --------------------------------------------------------
    # INJECTOR ABNORMALITY
    # --------------------------------------------------------

    elif fault == "injector_abnormality":

        values = {

            "rpm":
                random.uniform(4700, 5200),

            "cht_c":
                random.uniform(100, 135),

            "egt_c":
                random.uniform(580, 780),

            "oil_press_bar":
                random.uniform(2.5, 4.2),

            "oil_temp_c":
                random.uniform(85, 105),

            "fuel_flow_lph":
                random.uniform(9, 13),

            "vibration_g":
                random.uniform(0.08, 0.20),

            "battery_v":
                random.uniform(13.8, 14.4),

            "injection_deg":
                random.choice([
                    random.uniform(10, 18),
                    random.uniform(27, 35)
                ]),

            "roll_deg":
                random.uniform(-25, 25),

            "pitch_deg":
                random.uniform(-25, 25)
        }

        return round(values[field], 3)


    # --------------------------------------------------------
    # COKING DEGRADATION
    # CHT and EGT gradually become high
    # --------------------------------------------------------

    elif fault == "coking_degradation":

        values = {

            "rpm":
                random.uniform(4800, 5300),

            "cht_c":
                random.uniform(135, 180),

            "egt_c":
                random.uniform(740, 850),

            "oil_press_bar":
                random.uniform(2.5, 4.2),

            "oil_temp_c":
                random.uniform(95, 115),

            "fuel_flow_lph":
                random.uniform(17, 22),

            "vibration_g":
                random.uniform(0.08, 0.18),

            "battery_v":
                random.uniform(13.8, 14.4),

            "injection_deg":
                random.uniform(20, 25),

            "roll_deg":
                random.uniform(-25, 25),

            "pitch_deg":
                random.uniform(-25, 25)
        }

        return round(values[field], 3)


    # --------------------------------------------------------
    # LUBRICATION ISSUE
    # --------------------------------------------------------

    elif fault == "lubrication_issue":

        values = {

            "rpm":
                random.uniform(4700, 5200),

            "cht_c":
                random.uniform(105, 140),

            "egt_c":
                random.uniform(620, 740),

            "oil_press_bar":
                random.uniform(0.8, 2.3),

            "oil_temp_c":
                random.uniform(110, 150),

            "fuel_flow_lph":
                random.uniform(14, 18),

            "vibration_g":
                random.uniform(0.15, 0.35),

            "battery_v":
                random.uniform(13.8, 14.4),

            "injection_deg":
                random.uniform(20, 25),

            "roll_deg":
                random.uniform(-25, 25),

            "pitch_deg":
                random.uniform(-25, 25)
        }

        return round(values[field], 3)


    # --------------------------------------------------------
    # SENSOR DRIFT
    # One sensor changes but other values remain mostly normal
    # --------------------------------------------------------

    elif fault == "sensor_drift":

        if field == "cht_c":

            return round(
                random.uniform(145, 180),
                3
            )

        return generate_normal_value(field)


    # --------------------------------------------------------
    # COMBUSTION INSTABILITY
    # High fluctuations in RPM, EGT and vibration
    # --------------------------------------------------------

    elif fault == "combustion_instability":

        values = {

            "rpm":
                random.uniform(4300, 5600),

            "cht_c":
                random.uniform(100, 145),

            "egt_c":
                random.uniform(550, 850),

            "oil_press_bar":
                random.uniform(2.5, 4.2),

            "oil_temp_c":
                random.uniform(85, 110),

            "fuel_flow_lph":
                random.uniform(12, 21),

            "vibration_g":
                random.uniform(0.18, 0.45),

            "battery_v":
                random.uniform(13.8, 14.4),

            "injection_deg":
                random.uniform(18, 28),

            "roll_deg":
                random.uniform(-25, 25),

            "pitch_deg":
                random.uniform(-25, 25)
        }

        return round(values[field], 3)


    # Normal condition

    return generate_normal_value(field)


def simulate_missing_value(field, fault="none"):

    if fault == "none":

        return generate_normal_value(field)

    return generate_fault_value(
        field,
        fault
    )