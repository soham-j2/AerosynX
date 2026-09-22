import json
import math
import os


class EngineDigitalTwin:

    def __init__(self):
        self.flight_hours = 0.0

        self.state_file = "digital_twin_state.json"

        self.load_state()

    # =====================================================
    # STATE
    # =====================================================

    def load_state(self):

        if not os.path.exists(
            self.state_file
        ):
            return

        try:
            with open(
                self.state_file,
                "r",
                encoding="utf-8"
            ) as file:

                data = json.load(file)

            self.flight_hours = float(
                data.get(
                    "flight_hours",
                    0.0
                )
            )

        except Exception:
            self.flight_hours = 0.0

    def save_state(self):

        try:

            with open(
                self.state_file,
                "w",
                encoding="utf-8"
            ) as file:

                json.dump(
                    {
                        "flight_hours":
                            self.flight_hours
                    },
                    file,
                    indent=2
                )

        except Exception:
            pass

    # =====================================================
    # AIR DENSITY
    # =====================================================

    def air_density(
        self,
        altitude,
        ambient_temp
    ):

        temperature_k = (
            ambient_temp + 273.15
        )

        pressure = (
            101325.0
            * math.exp(
                -altitude / 8500.0
            )
        )

        return pressure / (
            287.05 * temperature_k
        )

    # =====================================================
    # EXPECTED CHT
    # =====================================================

    def expected_cht(
        self,
        rpm,
        load,
        altitude,
        ambient_temp,
        airspeed=35.0
    ):

        density = self.air_density(
            altitude,
            ambient_temp
        )

        cooling = (
            0.004
            * density
            * airspeed
        )

        heat = (
            95.0
            + 0.30 * load
            + 0.006 * (rpm - 4800)
            + 0.25 * (
                ambient_temp - 20
            )
        )

        cht = heat - cooling

        return max(
            90.0,
            min(140.0, cht)
        )

    # =====================================================
    # EXPECTED EGT
    # =====================================================

    def expected_egt(
        self,
        rpm,
        load,
        altitude,
        ambient_temp,
        throttle
    ):

        density = self.air_density(
            altitude,
            ambient_temp
        )

        density_factor = (
            1.225 / max(
                density,
                0.2
            )
        )

        egt = (
            610.0
            + 1.1 * load
            + 0.055 * (rpm - 4800)
            + 0.35 * (
                throttle - 50
            )
            + 3.0 * (
                density_factor - 1
            )
        )

        return max(
            580.0,
            min(800.0, egt)
        )

    # =====================================================
    # EXPECTED OIL PRESSURE
    # =====================================================

    def expected_oil_pressure(
        self,
        rpm,
        load,
        oil_temp
    ):

        pressure = (
            2.8
            + 0.0015 * (
                rpm - 4800
            )
            - 0.002 * max(
                load - 60,
                0
            )
            - 0.004 * max(
                oil_temp - 95,
                0
            )
        )

        return max(
            2.0,
            min(4.5, pressure)
        )

    # =====================================================
    # EXPECTED OIL TEMPERATURE
    # =====================================================

    def expected_oil_temp(
        self,
        load,
        ambient_temp
    ):

        return (
            70.0
            + 0.35 * load
            + 0.45 * (
                ambient_temp - 20
            )
        )

    # =====================================================
    # EXPECTED VIBRATION
    # =====================================================

    def expected_vibration(
        self,
        rpm,
        load
    ):

        return (
            0.055
            + abs(rpm - 5100)
            / 50000.0
            + load * 0.00035
        )

    # =====================================================
    # EXPECTED FUEL FLOW
    # =====================================================

    def expected_fuel_flow(
        self,
        rpm,
        load
    ):

        return (
            11.5
            + 0.085 * load
            + 0.001 * (
                rpm - 4800
            )
        )

    # =====================================================
    # EXPECTED BATTERY
    # =====================================================

    def expected_battery(
        self,
        load
    ):

        return (
            14.25
            - max(
                load - 70,
                0
            ) * 0.003
        )

    # =====================================================
    # EXPECTED INJECTION
    # =====================================================

    def expected_injection(
        self,
        load,
        throttle
    ):

        return (
            22.0
            + 0.01 * (
                throttle - 50
            )
            + 0.005 * (
                load - 60
            )
        )

    # =====================================================
    # EXPECTED STATE
    # =====================================================

    def expected_state(
        self,
        rpm,
        load,
        altitude,
        ambient_temp,
        throttle,
        oil_temp,
        airspeed
    ):

        return {
            "cht_c": self.expected_cht(
                rpm,
                load,
                altitude,
                ambient_temp,
                airspeed
            ),

            "egt_c": self.expected_egt(
                rpm,
                load,
                altitude,
                ambient_temp,
                throttle
            ),

            "oil_press_bar":
                self.expected_oil_pressure(
                    rpm,
                    load,
                    oil_temp
                ),

            "oil_temp_c":
                self.expected_oil_temp(
                    load,
                    ambient_temp
                ),

            "vibration_g":
                self.expected_vibration(
                    rpm,
                    load
                ),

            "fuel_flow_lph":
                self.expected_fuel_flow(
                    rpm,
                    load
                ),

            "battery_v":
                self.expected_battery(
                    load
                ),

            "injection_deg":
                self.expected_injection(
                    load,
                    throttle
                )
        }

    # =====================================================
    # RESIDUALS
    # =====================================================

    def calculate_residuals(
        self,
        current,
        expected
    ):

        mappings = {
            "cht_c": "cht_c",
            "egt_c": "egt_c",
            "oil_press_bar":
                "oil_press_bar",
            "oil_temp_c":
                "oil_temp_c",
            "fuel_flow_lph":
                "fuel_flow_lph",
            "vibration_g":
                "vibration_g",
            "battery_v":
                "battery_v",
            "injection_deg":
                "injection_deg",
        }

        residuals = {}

        for actual_key, expected_key in mappings.items():

            actual = current.get(
                actual_key
            )

            expected_value = expected.get(
                expected_key
            )

            if actual is None:
                continue

            if expected_value is None:
                continue

            try:

                actual = float(actual)
                expected_value = float(
                    expected_value
                )

                residuals[
                    actual_key.replace(
                        "_c",
                        ""
                    ).replace(
                        "_bar",
                        ""
                    )
                    + "_residual"
                ] = (
                    actual
                    - expected_value
                )

            except Exception:
                continue

        return residuals

    # =====================================================
    # HEALTH
    # =====================================================

    def calculate_health(
        self,
        residuals
    ):

        if not residuals:
            return 100.0

        penalties = []

        limits = {
            "cht_residual": 25.0,
            "egt_residual": 100.0,
            "oil_press_residual": 1.2,
            "oil_temp_residual": 25.0,
            "fuel_flow_residual": 4.0,
            "vibration_residual": 0.15,
            "battery_residual": 0.6,
            "injection_residual": 5.0,
        }

        for name, residual in residuals.items():

            limit = limits.get(
                name,
                10.0
            )

            normalized = abs(
                float(residual)
            ) / limit

            penalties.append(
                min(
                    normalized,
                    2.0
                )
            )

        average_penalty = (
            sum(penalties)
            / len(penalties)
        )

        health = (
            100.0
            - average_penalty * 35.0
        )

        return max(
            0.0,
            min(100.0, health)
        )

    # =====================================================
    # UPDATE
    # =====================================================

    def update(
        self,
        telemetry
    ):

        data = dict(
            telemetry or {}
        )

        rpm = float(
            data.get(
                "rpm",
                5100
            )
        )

        load = float(
            data.get(
                "load",
                60
            )
        )

        altitude = float(
            data.get(
                "altitude",
                5000
            )
        )

        ambient_temp = float(
            data.get(
                "ambient_temp",
                30
            )
        )

        throttle = float(
            data.get(
                "throttle",
                65
            )
        )

        airspeed = float(
            data.get(
                "airspeed",
                35
            )
        )

        oil_temp = float(
            data.get(
                "oil_temp_c",
                95
            )
        )

        expected = self.expected_state(
            rpm,
            load,
            altitude,
            ambient_temp,
            throttle,
            oil_temp,
            airspeed
        )

        current = dict(data)

        residuals = (
            self.calculate_residuals(
                current,
                expected
            )
        )

        health = self.calculate_health(
            residuals
        )

        return {
            "current_state": current,
            "expected_state": expected,
            "residuals": residuals,
            "health_score": round(
                health,
                2
            ),
            "flight_hours": self.flight_hours,
            "physics": {
                "air_density": round(
                    self.air_density(
                        altitude,
                        ambient_temp
                    ),
                    4
                )
            }
        }