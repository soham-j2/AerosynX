from __future__ import annotations

from typing import Any, Dict, List, Optional
import math


class CrossSensorConsistencyEngine:
    """
    Checks whether physically related engine parameters behave
    consistently with each other.

    This is a diagnostic layer.

    It does NOT replace:
        - Isolation Forest
        - Random Forest fault classifier
        - RUL model
        - Digital Twin

    It provides additional evidence about whether telemetry is
    physically believable.
    """

    def __init__(self) -> None:

        # ---------------------------------------------------------
        # Thresholds
        # ---------------------------------------------------------
        #
        # These are engineering screening thresholds for the
        # prototype. They should be calibrated later using real
        # engine/test data.
        #

        self.thresholds = {

            # RPM-load relationship
            "rpm_load_low": 0.55,
            "rpm_load_high": 1.45,

            # CHT-EGT relationship
            "cht_egt_min_gap": 430.0,
            "cht_egt_max_gap": 720.0,

            # Vibration-current relationship
            "vibration_current_ratio_low": 0.015,
            "vibration_current_ratio_high": 0.20,

            # General sudden change screening
            "rpm_min": 500.0,
            "rpm_max": 7000.0,

            "load_min": 0.0,
            "load_max": 100.0,

            "cht_min": 70.0,
            "cht_max": 220.0,

            "egt_min": 400.0,
            "egt_max": 950.0,

            "vibration_min": 0.0,
            "vibration_max": 1.5,

            "current_min": 0.0,
            "current_max": 50.0,
        }

    # ============================================================
    # SAFE FLOAT
    # ============================================================

    def _float(
        self,
        value: Any,
    ) -> Optional[float]:

        try:

            if value is None:
                return None

            result = float(value)

            if not math.isfinite(result):
                return None

            return result

        except Exception:
            return None

    # ============================================================
    # GET VALUE
    # ============================================================

    def _get(
        self,
        data: Dict[str, Any],
        *names: str,
    ) -> Optional[float]:

        for name in names:

            if name in data:

                value = self._float(
                    data[name]
                )

                if value is not None:
                    return value

        return None

    # ============================================================
    # RPM - LOAD CONSISTENCY
    # ============================================================

    def check_rpm_load(
        self,
        data: Dict[str, Any],
    ) -> Dict[str, Any]:

        rpm = self._get(
            data,
            "rpm",
        )

        load = self._get(
            data,
            "load",
            "load_percent",
            "engine_load",
        )

        result = {
            "status": "UNKNOWN",
            "score": None,
            "reason": "RPM or load unavailable",
            "values": {
                "rpm": rpm,
                "load": load,
            },
        }

        if rpm is None or load is None:
            return result

        if rpm <= 0:
            result["status"] = "INCONSISTENT"
            result["score"] = 0.0
            result["reason"] = "RPM is zero or negative"
            return result

        # --------------------------------------------------------
        # Normalize RPM around the nominal operating range.
        #
        # This is a screening relationship rather than a complete
        # engine torque model.
        # --------------------------------------------------------

        load_fraction = max(
            0.05,
            min(
                load / 100.0,
                1.0,
            ),
        )

        rpm_ratio = rpm / 5100.0

        expected_ratio = (
            0.78
            + 0.35 * load_fraction
        )

        deviation = abs(
            rpm_ratio - expected_ratio
        )

        if deviation < 0.12:

            status = "CONSISTENT"
            score = 100.0
            reason = (
                "RPM and load are physically consistent"
            )

        elif deviation < 0.25:

            status = "CAUTION"
            score = 70.0
            reason = (
                "RPM-load relationship shows moderate deviation"
            )

        else:

            status = "INCONSISTENT"
            score = 30.0
            reason = (
                "RPM is not behaving consistently with engine load"
            )

        result.update(
            {
                "status": status,
                "score": score,
                "reason": reason,
                "calculated": {
                    "rpm_ratio": round(
                        rpm_ratio,
                        4,
                    ),
                    "expected_ratio": round(
                        expected_ratio,
                        4,
                    ),
                    "deviation": round(
                        deviation,
                        4,
                    ),
                },
            }
        )

        return result

    # ============================================================
    # CHT - EGT CONSISTENCY
    # ============================================================

    def check_cht_egt(
        self,
        data: Dict[str, Any],
    ) -> Dict[str, Any]:

        cht = self._get(
            data,
            "cht_c",
            "cht",
        )

        egt = self._get(
            data,
            "egt_c",
            "egt",
        )

        result = {
            "status": "UNKNOWN",
            "score": None,
            "reason": "CHT or EGT unavailable",
            "values": {
                "cht_c": cht,
                "egt_c": egt,
            },
        }

        if cht is None or egt is None:
            return result

        gap = egt - cht

        min_gap = self.thresholds[
            "cht_egt_min_gap"
        ]

        max_gap = self.thresholds[
            "cht_egt_max_gap"
        ]

        # --------------------------------------------------------
        # EGT should normally remain significantly above CHT.
        # --------------------------------------------------------

        if min_gap <= gap <= max_gap:

            status = "CONSISTENT"
            score = 100.0
            reason = (
                "CHT and EGT relationship is physically consistent"
            )

        elif (
            gap >= min_gap - 80
            and gap <= max_gap + 80
        ):

            status = "CAUTION"
            score = 70.0
            reason = (
                "CHT-EGT relationship shows moderate deviation"
            )

        else:

            status = "INCONSISTENT"
            score = 25.0
            reason = (
                "CHT and EGT relationship is physically inconsistent"
            )

        result.update(
            {
                "status": status,
                "score": score,
                "reason": reason,
                "calculated": {
                    "temperature_gap": round(
                        gap,
                        2,
                    ),
                    "expected_gap_range": [
                        min_gap,
                        max_gap,
                    ],
                },
            }
        )

        return result

    # ============================================================
    # VIBRATION - CURRENT CONSISTENCY
    # ============================================================

    def check_vibration_current(
        self,
        data: Dict[str, Any],
    ) -> Dict[str, Any]:

        vibration = self._get(
            data,
            "vibration_g",
            "vibration",
        )

        current = self._get(
            data,
            "current_a",
            "current",
            "motor_current",
        )

        result = {
            "status": "UNKNOWN",
            "score": None,
            "reason": (
                "Vibration or current unavailable"
            ),
            "values": {
                "vibration_g": vibration,
                "current_a": current,
            },
        }

        if vibration is None or current is None:
            return result

        if current <= 0:

            if vibration > 0.25:

                result["status"] = "INCONSISTENT"
                result["score"] = 20.0
                result["reason"] = (
                    "High vibration is present while current is near zero"
                )

            else:

                result["status"] = "CAUTION"
                result["score"] = 65.0
                result["reason"] = (
                    "Current is too low to establish a strong vibration relationship"
                )

            return result

        ratio = vibration / current

        low = self.thresholds[
            "vibration_current_ratio_low"
        ]

        high = self.thresholds[
            "vibration_current_ratio_high"
        ]

        if low <= ratio <= high:

            status = "CONSISTENT"
            score = 100.0
            reason = (
                "Vibration and current are behaving consistently"
            )

        elif (
            ratio >= low * 0.5
            and ratio <= high * 1.5
        ):

            status = "CAUTION"
            score = 70.0
            reason = (
                "Vibration-current relationship shows moderate deviation"
            )

        else:

            status = "INCONSISTENT"
            score = 25.0
            reason = (
                "Vibration is not behaving consistently with current"
            )

        result.update(
            {
                "status": status,
                "score": score,
                "reason": reason,
                "calculated": {
                    "vibration_current_ratio": round(
                        ratio,
                        5,
                    ),
                    "expected_ratio_range": [
                        low,
                        high,
                    ],
                },
            }
        )

        return result

    # ============================================================
    # GENERAL RANGE CHECK
    # ============================================================

    def check_sensor_ranges(
        self,
        data: Dict[str, Any],
    ) -> Dict[str, Any]:

        checks = []

        ranges = {

            "rpm": (
                self.thresholds["rpm_min"],
                self.thresholds["rpm_max"],
            ),

            "load": (
                self.thresholds["load_min"],
                self.thresholds["load_max"],
            ),

            "cht_c": (
                self.thresholds["cht_min"],
                self.thresholds["cht_max"],
            ),

            "egt_c": (
                self.thresholds["egt_min"],
                self.thresholds["egt_max"],
            ),

            "vibration_g": (
                self.thresholds["vibration_min"],
                self.thresholds["vibration_max"],
            ),

            "current_a": (
                self.thresholds["current_min"],
                self.thresholds["current_max"],
            ),
        }

        for parameter, (
            minimum,
            maximum,
        ) in ranges.items():

            value = self._get(
                data,
                parameter,
            )

            if value is None:
                continue

            if value < minimum or value > maximum:

                checks.append(
                    {
                        "parameter": parameter,
                        "value": value,
                        "allowed_range": [
                            minimum,
                            maximum,
                        ],
                    }
                )

        if checks:

            return {
                "status": "INCONSISTENT",
                "score": 25.0,
                "violations": checks,
            }

        return {
            "status": "CONSISTENT",
            "score": 100.0,
            "violations": [],
        }

    # ============================================================
    # OVERALL ANALYSIS
    # ============================================================

    def analyze(
        self,
        data: Dict[str, Any],
    ) -> Dict[str, Any]:

        if not isinstance(data, dict):
            data = {}

        rpm_load = self.check_rpm_load(
            data
        )

        cht_egt = self.check_cht_egt(
            data
        )

        vibration_current = (
            self.check_vibration_current(
                data
            )
        )

        sensor_ranges = (
            self.check_sensor_ranges(
                data
            )
        )

        relationships = {
            "rpm_load": rpm_load,
            "cht_egt": cht_egt,
            "vibration_current": vibration_current,
        }

        scores = []

        for result in relationships.values():

            score = result.get("score")

            if score is not None:
                scores.append(
                    float(score)
                )

        if sensor_ranges.get(
            "score"
        ) is not None:

            scores.append(
                float(
                    sensor_ranges[
                        "score"
                    ]
                )
            )

        if scores:

            overall_score = (
                sum(scores)
                / len(scores)
            )

        else:

            overall_score = None

        inconsistent = [
            name
            for name, result
            in relationships.items()
            if result.get("status")
            == "INCONSISTENT"
        ]

        caution = [
            name
            for name, result
            in relationships.items()
            if result.get("status")
            == "CAUTION"
        ]

        if not scores:

            overall_status = "UNKNOWN"

        elif len(inconsistent) >= 2:

            overall_status = "INCONSISTENT"

        elif len(inconsistent) == 1:

            overall_status = "INCONSISTENT"

        elif len(caution) >= 2:

            overall_status = "CAUTION"

        else:

            overall_status = "CONSISTENT"

        # --------------------------------------------------------
        # Diagnostic interpretation
        # --------------------------------------------------------

        if overall_status == "CONSISTENT":

            interpretation = (
                "Connected engine parameters are physically consistent"
            )

        elif overall_status == "CAUTION":

            interpretation = (
                "Some cross-sensor relationships show moderate deviation; "
                "additional telemetry and temporal evidence are recommended"
            )

        elif overall_status == "INCONSISTENT":

            interpretation = (
                "One or more connected parameters behave inconsistently; "
                "the anomaly may represent abnormal engine behavior or unreliable sensor data"
            )

        else:

            interpretation = (
                "Insufficient telemetry to determine cross-sensor consistency"
            )

        return {

            "status": overall_status,

            "score": (
                round(
                    overall_score,
                    2,
                )
                if overall_score is not None
                else None
            ),

            "interpretation": interpretation,

            "relationships": relationships,

            "range_check": sensor_ranges,

            "inconsistent_relationships": inconsistent,

            "caution_relationships": caution,

            "checks_performed": [
                "RPM-load",
                "CHT-EGT",
                "Vibration-current",
            ],

        }


def cross_sensor_consistency(
    data: Dict[str, Any],
) -> Dict[str, Any]:

    engine = CrossSensorConsistencyEngine()

    return engine.analyze(data)


if __name__ == "__main__":

    test_data = {

        "rpm": 5100,
        "load": 65,

        "cht_c": 110,
        "egt_c": 720,

        "vibration_g": 0.12,
        "current_a": 2.5,

    }

    result = cross_sensor_consistency(
        test_data
    )

    print("=" * 70)
    print("CROSS-SENSOR PHYSICAL CONSISTENCY")
    print("=" * 70)

    print(
        "Overall status :",
        result["status"],
    )

    print(
        "Overall score  :",
        result["score"],
    )

    print(
        "Interpretation :",
        result["interpretation"],
    )

    print("\nRelationships:")

    for name, value in (
        result[
            "relationships"
        ].items()
    ):

        print(
            f"\n{name}"
        )

        print(
            "  Status :",
            value["status"],
        )

        print(
            "  Score  :",
            value["score"],
        )

        print(
            "  Reason :",
            value["reason"],
        )