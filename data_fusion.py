
import math
import random
import time


class DataFusion:

    HARDWARE_PARAMETERS = [
        "rpm",
        "vibration_g",
        "battery_v",
        "current_a",
        "motor_temp_c",
    ]

    SIMULATED_PARAMETERS = [
        "cht_c",
        "egt_c",
        "oil_press_bar",
        "oil_temp_c",
        "fuel_flow_lph",
        "injection_deg",
    ]

    CONTEXT_PARAMETERS = [
        "load",
        "altitude",
        "ambient_temp",
        "throttle",
        "airspeed",
    ]

    NORMAL_RANGES = {
        "rpm": (4800.0, 5300.0),
        "vibration_g": (0.05, 0.15),
        "battery_v": (13.8, 14.4),
        "current_a": (1.5, 4.0),
        "motor_temp_c": (35.0, 85.0),
        "cht_c": (95.0, 125.0),
        "egt_c": (620.0, 720.0),
        "oil_press_bar": (2.5, 4.2),
        "oil_temp_c": (85.0, 105.0),
        "fuel_flow_lph": (14.0, 18.0),
        "injection_deg": (20.0, 25.0),
    }

    def __init__(self, seed=42):
        self.random = random.Random(seed)

        self.previous = {
            "rpm": 5100.0,
            "load": 60.0,
            "ambient_temp": 30.0,
            "altitude": 5000.0,
            "throttle": 65.0,
            "airspeed": 35.0,
        }

        self.degradation = 0.0
        self.active_fault = "none"

    def canonicalize_fault(self, fault_name):
        if not fault_name:
            return "none"
        s = str(fault_name).strip().lower()
        if "abnormal" not in s and any(x in s for x in ["none", "normal", "healthy", "clear"]):
            return "none"
        if "injector" in s:
            return "injector_abnormality"
        if "injection" in s:
            return "injection_timing_issue"
        if "misfire" in s:
            return "misfire"
        if "coking" in s or "degradation" in s:
            return "coking_degradation"
        if "lubric" in s or "oil" in s:
            return "lubrication_issue"
        if "drift" in s:
            return "sensor_drift"
        if "combust" in s or "instab" in s:
            return "combustion_instability"
        if "overheat" in s or "hot" in s:
            return "overheating"
        if "vibrat" in s:
            return "abnormal_vibration"
        if "battery" in s or "alternat" in s or "volt" in s:
            return "battery_alternator_health"
        return s

    def set_active_fault(self, fault_name):
        self.active_fault = self.canonicalize_fault(fault_name)

    @staticmethod
    def valid(value):
        if value is None:
            return False

        try:
            numeric_value = float(value)
            return math.isfinite(numeric_value)
        except (TypeError, ValueError):
            return False

    def _random_value(self, field):
        low, high = self.NORMAL_RANGES[field]
        return self.random.uniform(low, high)

    def _simulate_context(self):
        self.previous["load"] += self.random.uniform(-1.5, 1.5)
        self.previous["load"] = max(
            35.0,
            min(90.0, self.previous["load"])
        )

        self.previous["throttle"] += self.random.uniform(-1.5, 1.5)
        self.previous["throttle"] = max(
            35.0,
            min(90.0, self.previous["throttle"])
        )

        self.previous["altitude"] += self.random.uniform(-50.0, 50.0)
        self.previous["altitude"] = max(
            1000.0,
            min(12000.0, self.previous["altitude"])
        )

        self.previous["ambient_temp"] += self.random.uniform(-0.2, 0.2)
        self.previous["ambient_temp"] = max(
            10.0,
            min(45.0, self.previous["ambient_temp"])
        )

        self.previous["airspeed"] += self.random.uniform(-0.5, 0.5)
        self.previous["airspeed"] = max(
            20.0,
            min(55.0, self.previous["airspeed"])
        )

        return dict(self.previous)

    def _simulate_engine(self, context):
        load = float(context["load"])
        altitude = float(context["altitude"])
        ambient = float(context["ambient_temp"])
        throttle = float(context["throttle"])

        target_rpm = (
            4600.0
            + throttle * 7.0
            + load * 2.0
        )

        rpm = target_rpm + self.random.uniform(-80.0, 80.0)

        rpm = max(
            4800.0,
            min(5300.0, rpm)
        )

        self.degradation += 0.0008
        self.degradation = min(0.30, self.degradation)

        degradation = self.degradation

        cht = (
            88.0
            + 0.28 * load
            + 0.008 * (rpm - 4800.0)
            + 0.35 * (ambient - 20.0)
            - 0.0015 * altitude
            + degradation * 55.0
            + self.random.uniform(-1.5, 1.5)
        )

        cht = max(
            90.0,
            min(180.0, cht)
        )

        egt = (
            585.0
            + 1.45 * load
            + 0.08 * (rpm - 4800.0)
            + 0.8 * (throttle - 50.0)
            + degradation * 90.0
            + self.random.uniform(-4.0, 4.0)
        )

        egt = max(
            580.0,
            min(850.0, egt)
        )

        oil_pressure = (
            2.6
            + 0.0018 * (rpm - 4800.0)
            - 0.0025 * max(load - 60.0, 0.0)
            - degradation * 0.8
            + self.random.uniform(-0.08, 0.08)
        )

        oil_pressure = max(
            1.5,
            min(4.5, oil_pressure)
        )

        oil_temp = (
            82.0
            + 0.25 * load
            + 0.35 * (ambient - 20.0)
            + degradation * 30.0
            + self.random.uniform(-1.5, 1.5)
        )

        oil_temp = max(
            80.0,
            min(145.0, oil_temp)
        )

        fuel_flow = (
            11.5
            + load * 0.085
            + throttle * 0.015
            + degradation * 3.0
            + self.random.uniform(-0.25, 0.25)
        )

        fuel_flow = max(
            12.0,
            min(23.0, fuel_flow)
        )

        vibration = (
            0.055
            + (rpm - 4800.0) / 10000.0
            + load * 0.0005
            + degradation * 0.20
            + self.random.uniform(-0.008, 0.008)
        )

        vibration = max(
            0.04,
            min(0.40, vibration)
        )

        battery = (
            14.15
            - degradation * 0.5
            + self.random.uniform(-0.08, 0.08)
        )

        battery = max(
            13.3,
            min(14.5, battery)
        )

        injection = (
            22.5
            + degradation * 2.0
            + self.random.uniform(-0.4, 0.4)
        )

        injection = max(
            18.0,
            min(28.0, injection)
        )

        current = (
            1.5
            + load * 0.025
            + self.random.uniform(-0.08, 0.08)
        )

        motor_temp = (
            ambient
            + 18.0
            + load * 0.20
            + degradation * 20.0
        )

        if hasattr(self, "active_fault") and self.active_fault and self.active_fault != "none":
            fault = self.active_fault
            if fault == "misfire":
                vibration += 0.45
                rpm -= 550.0
                egt += 110.0
            elif fault == "injector_abnormality":
                fuel_flow -= 4.5
                egt += 75.0
            elif fault == "coking_degradation":
                cht += 48.0
                oil_temp += 22.0
            elif fault == "lubrication_issue":
                oil_pressure -= 1.8
                oil_temp += 32.0
            elif fault == "sensor_drift":
                battery -= 3.2
            elif fault == "combustion_instability":
                vibration += 0.38
                rpm += self.random.uniform(-300.0, 300.0)
            elif fault == "battery_alternator_health":
                battery = 10.6
            elif fault == "injection_timing_issue":
                injection = 32.5
            elif fault == "overheating":
                cht += 55.0
                egt += 95.0
            elif fault == "abnormal_vibration":
                vibration += 0.26

        return {
            "rpm": rpm,
            "cht_c": cht,
            "egt_c": egt,
            "oil_press_bar": oil_pressure,
            "oil_temp_c": oil_temp,
            "fuel_flow_lph": fuel_flow,
            "vibration_g": vibration,
            "battery_v": battery,
            "injection_deg": injection,
            "current_a": current,
            "motor_temp_c": motor_temp,
        }

    def fuse(
        self,
        hardware_data=None,
        operating_conditions=None,
        simulated_data=None
    ):
        if not isinstance(hardware_data, dict):
            hardware_data = {}

        if not isinstance(operating_conditions, dict):
            operating_conditions = {}

        if not isinstance(simulated_data, dict):
            simulated_data = {}

        context = self._simulate_context()

        for parameter in self.CONTEXT_PARAMETERS:
            value = operating_conditions.get(parameter)

            if self.valid(value):
                context[parameter] = float(value)

        generated = self._simulate_engine(context)

        final_data = {}
        source = {}
        quality = {}

        all_parameters = (
            self.HARDWARE_PARAMETERS
            + self.SIMULATED_PARAMETERS
        )

        for parameter in all_parameters:
            if self.active_fault != "none" and parameter in generated:
                sim_val = generated[parameter]
                norm_min, norm_max = self.NORMAL_RANGES.get(parameter, (None, None))
                if norm_min is not None and (sim_val < norm_min or sim_val > norm_max):
                    final_data[parameter] = float(sim_val)
                    source[parameter] = "SIMULATED_FAULT"
                    quality[parameter] = "GENERATED"
                    continue

            hardware_value = hardware_data.get(parameter)

            if self.valid(hardware_value):
                final_data[parameter] = float(hardware_value)
                source[parameter] = "HARDWARE"
                quality[parameter] = "LIVE"
                continue

            simulated_value = simulated_data.get(parameter)

            if self.valid(simulated_value):
                final_data[parameter] = float(simulated_value)
                source[parameter] = "SIMULATED"
                quality[parameter] = "GENERATED"
                continue

            final_data[parameter] = float(
                generated[parameter]
            )

            source[parameter] = "SIMULATED"
            quality[parameter] = "GENERATED"

        for parameter in self.CONTEXT_PARAMETERS:
            final_data[parameter] = float(
                context[parameter]
            )

            source[parameter] = "OPERATING_CONTEXT"
        context["active_fault"] = getattr(self, "active_fault", "none")
        timestamp = int(time.time() * 1000)

        return {
            "timestamp": timestamp,
            "reading": final_data,
            "source": source,
            "quality": quality,
            "context": context,
            "hardware_connected": bool(hardware_data),
            "hardware_status": (
                "CONNECTED"
                if hardware_data
                else "SIMULATION_ONLY"
            ),
            "packet_loss_pct": 0.0,
            "latency_ms": 0.0,
            "injected_faults": [],
        }


if __name__ == "__main__":
    print("=" * 70)
    print("AEROSYNX DATA FUSION TEST")
    print("=" * 70)

    fusion = DataFusion()
    result = fusion.fuse()

    print("\nTIMESTAMP:")
    print(result["timestamp"])

    print("\nHARDWARE STATUS:")
    print(result["hardware_status"])

    print("\nENGINE TELEMETRY:")
    print("-" * 70)

    for key, value in result["reading"].items():
        source_name = result["source"].get(
            key,
            "UNKNOWN"
        )

        print(
            f"{key:<20} "
            f"{float(value):>10.2f} "
            f"[{source_name}]"
        )

    print("\nOPERATING CONTEXT:")
    print("-" * 70)

    for key, value in result["context"].items():
        print(
            f"{key:<20} "
            f"{float(value):>10.2f}"
        )

    print("\n" + "=" * 70)
    print("DATA FUSION TEST COMPLETED")
    print("=" * 70)

