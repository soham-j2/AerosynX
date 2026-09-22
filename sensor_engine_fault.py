"""
Sensor–Engine Fault Separation
--------------------------------

Determines whether an abnormal engine parameter is more likely caused by:

    NORMAL
    SENSOR_FAULT_LIKELY
    ENGINE_FAULT_LIKELY
    UNKNOWN

This is a prototype diagnostic layer.

It does NOT claim certified aircraft-engine fault diagnosis.
It combines:
    1. Digital Twin residuals
    2. Cross-sensor consistency
    3. Parameter correlation
    4. Sensor plausibility
    5. Persistence
"""

from __future__ import annotations

from typing import Any, Dict, Optional
import math


class SensorEngineFaultSeparator:

    # ---------------------------------------------------------
    # Configuration
    # ---------------------------------------------------------

    PARAMETER_CONFIG = {

        "cht_c": {
            "warning": 165.0,
            "critical": 180.0,
            "direction": "HIGH",

            # Parameters that should normally support a genuine
            # thermal engine problem.
            "correlated": [
                "egt_c",
                "oil_temp_c",
                "vibration_g",
            ],

            "sensor_weight": 1.0,
            "engine_weight": 1.0,
        },

        "egt_c": {
            "warning": 780.0,
            "critical": 850.0,
            "direction": "HIGH",

            "correlated": [
                "cht_c",
                "oil_temp_c",
                "fuel_flow",
            ],

            "sensor_weight": 1.0,
            "engine_weight": 1.0,
        },

        "oil_press_bar": {
            "warning": 2.0,
            "critical": 1.5,
            "direction": "LOW",

            "correlated": [
                "oil_temp_c",
                "vibration_g",
                "rpm",
            ],

            "sensor_weight": 1.0,
            "engine_weight": 1.0,
        },

        "oil_temp_c": {
            "warning": 120.0,
            "critical": 130.0,
            "direction": "HIGH",

            "correlated": [
                "cht_c",
                "egt_c",
                "oil_press_bar",
            ],

            "sensor_weight": 1.0,
            "engine_weight": 1.0,
        },

        "vibration_g": {
            "warning": 0.30,
            "critical": 0.50,
            "direction": "HIGH",

            "correlated": [
                "rpm",
                "cht_c",
                "egt_c",
            ],

            "sensor_weight": 1.0,
            "engine_weight": 1.0,
        },

        "rpm": {
            "warning": 4800.0,
            "critical": 4200.0,
            "direction": "LOW",

            "correlated": [
                "load",
                "throttle",
                "vibration_g",
                "fuel_flow",
            ],

            "sensor_weight": 1.0,
            "engine_weight": 1.0,
        },

        "fuel_flow": {
            "warning": 1.20,
            "critical": 1.50,
            "direction": "HIGH",

            "correlated": [
                "egt_c",
                "cht_c",
                "throttle",
                "load",
            ],

            "sensor_weight": 1.0,
            "engine_weight": 1.0,
        },
    }

    # Hardware sensors available in your current prototype.
    HARDWARE_PARAMETERS = {
        "rpm",
        "vibration_g",
        "motor_temp_c",
        "current",
        "current_a",
        "voltage",
        "battery_v",
    }

    # ---------------------------------------------------------
    # Constructor
    # ---------------------------------------------------------

    def __init__(
        self,
        residual_threshold: float = 0.10,
        strong_residual_threshold: float = 0.20,
    ):
        self.residual_threshold = residual_threshold
        self.strong_residual_threshold = strong_residual_threshold

    # ---------------------------------------------------------
    # Public API
    # ---------------------------------------------------------

    def analyze(
        self,
        current_state: Optional[Dict[str, Any]] = None,
        expected_state: Optional[Dict[str, Any]] = None,
        residuals: Optional[Dict[str, Any]] = None,
        context: Optional[Dict[str, Any]] = None,
        source: Optional[Any] = None,
    ) -> Dict[str, Any]:

        current_state = current_state or {}
        expected_state = expected_state or {}
        residuals = residuals or {}
        context = context or {}

        observations = []

        # -----------------------------------------------------
        # Analyze each parameter
        # -----------------------------------------------------

        for parameter, config in self.PARAMETER_CONFIG.items():

            current = self._get_value(current_state, parameter)

            if current is None:
                continue

            expected = self._get_value(expected_state, parameter)

            residual = self._get_residual(
                residuals,
                parameter,
                current,
                expected,
            )

            observation = self._analyze_parameter(
                parameter=parameter,
                current=current,
                expected=expected,
                residual=residual,
                current_state=current_state,
                expected_state=expected_state,
                context=context,
            )

            observations.append(observation)

        # -----------------------------------------------------
        # Determine overall diagnosis
        # -----------------------------------------------------

        overall = self._determine_overall_diagnosis(
            observations
        )

        # -----------------------------------------------------
        # Build result
        # -----------------------------------------------------

        return {
            "status": overall["status"],

            "display_label": self._display_label(
                overall["status"]
            ),

            "confidence_percent": round(
                overall["confidence"],
                2,
            ),

            "reason": overall["reason"],

            "sensor_fault_likely": (
                overall["status"] == "SENSOR_FAULT_LIKELY"
            ),

            "engine_fault_likely": (
                overall["status"] == "ENGINE_FAULT_LIKELY"
            ),

            "abnormal_parameters": [
                item["parameter"]
                for item in observations
                if item["abnormal"]
            ],

            "sensor_suspects": [
                item["parameter"]
                for item in observations
                if item["diagnosis"] == "SENSOR_FAULT_LIKELY"
            ],

            "engine_suspects": [
                item["parameter"]
                for item in observations
                if item["diagnosis"] == "ENGINE_FAULT_LIKELY"
            ],

            "observations": observations,

            "method": {
                "name": "Sensor–Engine Fault Separation",
                "version": "1.0",
                "basis": [
                    "Digital Twin residual",
                    "Cross-sensor consistency",
                    "Parameter correlation",
                    "Physical plausibility",
                    "Multi-parameter agreement",
                ],
            },

            "provenance": {
                "current_state": self._normalize_source(source),
                "expected_state": "DIGITAL_TWIN",
                "diagnosis": "MODEL_DERIVED",
            },
        }

    # ---------------------------------------------------------
    # Parameter analysis
    # ---------------------------------------------------------

    def _analyze_parameter(
        self,
        parameter: str,
        current: float,
        expected: Optional[float],
        residual: Optional[float],
        current_state: Dict[str, Any],
        expected_state: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Dict[str, Any]:

        config = self.PARAMETER_CONFIG[parameter]

        abnormal_limit = self._is_abnormal(
            current,
            config,
        )

        residual_strength = self._residual_strength(
            current,
            expected,
            residual,
        )

        correlated_support = self._correlated_support(
            parameter,
            current_state,
            expected_state,
        )

        plausibility = self._plausibility_score(
            parameter,
            current,
            context,
        )

        # -----------------------------------------------------
        # Sensor-fault score
        # -----------------------------------------------------

        sensor_score = 0.0

        # Abnormal sensor + weak residual / no physical support
        # is suspicious.
        if abnormal_limit:

            if residual_strength < 0.25:
                sensor_score += 35.0

            elif residual_strength < 0.50:
                sensor_score += 20.0

            # If correlated engine parameters remain normal,
            # isolated sensor failure becomes more likely.
            if correlated_support < 0.30:
                sensor_score += 40.0

            elif correlated_support < 0.50:
                sensor_score += 20.0

            sensor_score += plausibility

        # -----------------------------------------------------
        # Engine-fault score
        # -----------------------------------------------------

        engine_score = 0.0

        if abnormal_limit:

            if residual_strength >= 0.50:
                engine_score += 30.0

            elif residual_strength >= 0.25:
                engine_score += 20.0

            # Other engine parameters support the abnormality.
            if correlated_support >= 0.70:
                engine_score += 45.0

            elif correlated_support >= 0.50:
                engine_score += 30.0

            elif correlated_support >= 0.30:
                engine_score += 15.0

            # Strong physical deviation.
            if residual_strength >= 0.75:
                engine_score += 20.0

        # -----------------------------------------------------
        # Final parameter diagnosis
        # -----------------------------------------------------

        if not abnormal_limit:

            diagnosis = "NORMAL"

        elif sensor_score >= engine_score + 20:

            diagnosis = "SENSOR_FAULT_LIKELY"

        elif engine_score >= sensor_score + 20:

            diagnosis = "ENGINE_FAULT_LIKELY"

        else:

            diagnosis = "UNKNOWN"

        confidence = max(
            sensor_score,
            engine_score,
        )

        confidence = min(
            confidence,
            100.0,
        )

        return {
            "parameter": parameter,

            "current": self._safe_round(current),

            "expected": (
                self._safe_round(expected)
                if expected is not None
                else None
            ),

            "residual": (
                self._safe_round(residual)
                if residual is not None
                else None
            ),

            "abnormal": abnormal_limit,

            "residual_strength": round(
                residual_strength,
                3,
            ),

            "correlated_engine_support": round(
                correlated_support,
                3,
            ),

            "plausibility_score": round(
                plausibility,
                3,
            ),

            "sensor_fault_score": round(
                sensor_score,
                2,
            ),

            "engine_fault_score": round(
                engine_score,
                2,
            ),

            "diagnosis": diagnosis,

            "confidence_percent": round(
                confidence,
                2,
            ),
        }

    # ---------------------------------------------------------
    # Abnormality
    # ---------------------------------------------------------

    def _is_abnormal(
        self,
        value: float,
        config: Dict[str, Any],
    ) -> bool:

        warning = config["warning"]
        direction = config["direction"]

        if direction == "HIGH":
            return value >= warning

        if direction == "LOW":
            return value <= warning

        return False

    # ---------------------------------------------------------
    # Residual
    # ---------------------------------------------------------

    def _residual_strength(
        self,
        current: float,
        expected: Optional[float],
        residual: Optional[float],
    ) -> float:

        # Prefer supplied Digital Twin residual.
        if residual is not None:

            try:
                return min(
                    abs(float(residual)),
                    1.0,
                )
            except (TypeError, ValueError):
                pass

        # Otherwise calculate normalized deviation.
        if expected is None:
            return 0.0

        try:

            expected = float(expected)

            if abs(expected) < 1e-9:
                return 0.0

            deviation = abs(
                float(current) - expected
            ) / abs(expected)

            return min(
                deviation,
                1.0,
            )

        except (TypeError, ValueError):

            return 0.0

    # ---------------------------------------------------------
    # Correlated parameter support
    # ---------------------------------------------------------

    def _correlated_support(
        self,
        parameter: str,
        current_state: Dict[str, Any],
        expected_state: Dict[str, Any],
    ) -> float:

        config = self.PARAMETER_CONFIG.get(
            parameter,
            {},
        )

        correlated = config.get(
            "correlated",
            [],
        )

        if not correlated:
            return 0.0

        scores = []

        for other in correlated:

            current = self._get_value(
                current_state,
                other,
            )

            expected = self._get_value(
                expected_state,
                other,
            )

            if current is None:
                continue

            if expected is None:
                continue

            try:

                deviation = abs(
                    float(current) -
                    float(expected)
                ) / max(
                    abs(float(expected)),
                    1e-9,
                )

            except (TypeError, ValueError):

                continue

            # Convert deviation into engine-support score.
            #
            # 0% deviation -> 0 support
            # 10% deviation -> moderate
            # 20%+ deviation -> strong

            if deviation >= 0.20:
                score = 1.0

            elif deviation >= 0.10:
                score = 0.70

            elif deviation >= 0.05:
                score = 0.40

            else:
                score = 0.0

            scores.append(score)

        if not scores:
            return 0.0

        return sum(scores) / len(scores)

    # ---------------------------------------------------------
    # Physical plausibility
    # ---------------------------------------------------------

    def _plausibility_score(
        self,
        parameter: str,
        value: float,
        context: Dict[str, Any],
    ) -> float:

        """
        Returns a score representing how suspicious the value
        is from a sensor-quality perspective.

        This is deliberately conservative.
        """

        config = self.PARAMETER_CONFIG.get(
            parameter
        )

        if not config:
            return 0.0

        warning = config["warning"]
        critical = config["critical"]
        direction = config["direction"]

        try:

            value = float(value)

        except (TypeError, ValueError):

            return 0.0

        # Extreme values are more likely to be physically
        # suspicious and therefore increase sensor suspicion.
        if direction == "HIGH":

            if value > critical * 1.20:
                return 35.0

            if value > critical * 1.10:
                return 20.0

        elif direction == "LOW":

            if value < critical * 0.70:
                return 35.0

            if value < critical * 0.85:
                return 20.0

        return 10.0

    # ---------------------------------------------------------
    # Overall diagnosis
    # ---------------------------------------------------------

    def _determine_overall_diagnosis(
        self,
        observations,
    ) -> Dict[str, Any]:

        abnormal = [
            item
            for item in observations
            if item["abnormal"]
        ]

        if not abnormal:

            return {
                "status": "NORMAL",
                "confidence": 100.0,
                "reason": (
                    "No monitored parameter is currently "
                    "outside its prototype warning region."
                ),
            }

        sensor_score = sum(
            item["sensor_fault_score"]
            for item in abnormal
        )

        engine_score = sum(
            item["engine_fault_score"]
            for item in abnormal
        )

        # -----------------------------------------------------
        # Multiple independent engine abnormalities
        # are strong evidence against an isolated sensor fault.
        # -----------------------------------------------------

        engine_suspects = [
            item
            for item in abnormal
            if item["engine_fault_score"]
            >= item["sensor_fault_score"] + 10
        ]

        sensor_suspects = [
            item
            for item in abnormal
            if item["sensor_fault_score"]
            >= item["engine_fault_score"] + 10
        ]

        # -----------------------------------------------------
        # Engine diagnosis
        # -----------------------------------------------------

        if (
            len(engine_suspects) >= 2
            and engine_score >= sensor_score
        ):

            return {
                "status": "ENGINE_FAULT_LIKELY",
                "confidence": min(
                    100.0,
                    55.0 + engine_score * 0.20,
                ),
                "reason": (
                    "Multiple engine-related parameters "
                    "show abnormal behavior that is "
                    "supported by correlated parameters."
                ),
            }

        # -----------------------------------------------------
        # Sensor diagnosis
        # -----------------------------------------------------

        if (
            len(sensor_suspects) >= 1
            and engine_score < sensor_score
        ):

            return {
                "status": "SENSOR_FAULT_LIKELY",
                "confidence": min(
                    100.0,
                    55.0 + sensor_score * 0.20,
                ),
                "reason": (
                    "An abnormal parameter is not sufficiently "
                    "supported by correlated engine parameters, "
                    "suggesting a possible sensor problem."
                ),
            }

        # -----------------------------------------------------
        # Single isolated abnormality
        # -----------------------------------------------------

        if len(abnormal) == 1:

            item = abnormal[0]

            if (
                item["sensor_fault_score"]
                >= item["engine_fault_score"] + 20
            ):

                return {
                    "status": "SENSOR_FAULT_LIKELY",
                    "confidence": min(
                        100.0,
                        60.0 +
                        item["sensor_fault_score"] * 0.20,
                    ),
                    "reason": (
                        f"{item['parameter']} is abnormal, "
                        "but correlated engine parameters "
                        "remain largely normal."
                    ),
                }

            if (
                item["engine_fault_score"]
                >= item["sensor_fault_score"] + 20
            ):

                return {
                    "status": "ENGINE_FAULT_LIKELY",
                    "confidence": min(
                        100.0,
                        60.0 +
                        item["engine_fault_score"] * 0.20,
                    ),
                    "reason": (
                        f"{item['parameter']} shows a strong "
                        "deviation from its Digital Twin expectation."
                    ),
                }

        # -----------------------------------------------------
        # Cannot separate reliably
        # -----------------------------------------------------

        return {
            "status": "UNKNOWN",
            "confidence": 50.0,
            "reason": (
                "The available sensor and Digital Twin evidence "
                "does not provide enough separation between "
                "sensor abnormality and genuine engine degradation."
            ),
        }

    # ---------------------------------------------------------
    # Utilities
    # ---------------------------------------------------------

    @staticmethod
    def _get_value(
        data: Dict[str, Any],
        parameter: str,
    ) -> Optional[float]:

        if not isinstance(data, dict):
            return None

        aliases = {
            "cht_c": ["cht_c", "CHT", "cht"],
            "egt_c": ["egt_c", "EGT", "egt"],
            "oil_press_bar": [
                "oil_press_bar",
                "oil_pressure",
                "oil_pressure_bar",
            ],
            "oil_temp_c": [
                "oil_temp_c",
                "oil_temperature",
                "oil_temperature_c",
            ],
            "vibration_g": [
                "vibration_g",
                "vibration",
            ],
            "rpm": [
                "rpm",
                "RPM",
            ],
            "fuel_flow": [
                "fuel_flow",
                "fuel_flow_lph",
            ],
        }

        for key in aliases.get(
            parameter,
            [parameter],
        ):

            if key in data:

                try:
                    value = float(data[key])

                    if math.isfinite(value):
                        return value

                except (
                    TypeError,
                    ValueError,
                ):
                    pass

        return None

    @staticmethod
    def _get_residual(
        residuals: Dict[str, Any],
        parameter: str,
        current: Optional[float],
        expected: Optional[float],
    ) -> Optional[float]:

        if not isinstance(residuals, dict):
            residuals = {}

        aliases = [
            parameter,
            f"{parameter}_residual",
        ]

        for key in aliases:

            if key in residuals:

                try:

                    value = float(
                        residuals[key]
                    )

                    if math.isfinite(value):

                        return abs(value)

                except (
                    TypeError,
                    ValueError,
                ):
                    pass

        if current is not None and expected is not None:

            try:

                if abs(float(expected)) > 1e-9:

                    return min(
                        abs(
                            float(current) -
                            float(expected)
                        ) / abs(float(expected)),
                        1.0,
                    )

            except (
                TypeError,
                ValueError,
            ):
                pass

        return None

    @staticmethod
    def _normalize_source(
        source: Any,
    ) -> str:

        if isinstance(source, dict):

            values = set()

            for value in source.values():

                if value is None:
                    continue

                value = str(value).upper()

                if value in {
                    "HARDWARE",
                    "SIMULATED",
                    "DIGITAL_TWIN",
                    "MODEL_DERIVED",
                }:
                    values.add(value)

            if len(values) == 1:
                return next(iter(values))

            if len(values) > 1:
                return "MIXED"

            return "UNKNOWN"

        if source is None:
            return "UNKNOWN"

        value = str(source).upper()

        if value in {
            "HARDWARE",
            "SIMULATED",
            "DIGITAL_TWIN",
            "MODEL_DERIVED",
        }:
            return value

        return "UNKNOWN"

    @staticmethod
    def _display_label(
        status: str,
    ) -> str:

        labels = {
            "NORMAL": "Normal",
            "SENSOR_FAULT_LIKELY": "Sensor Fault Likely",
            "ENGINE_FAULT_LIKELY": "Engine Fault Likely",
            "UNKNOWN": "Unknown",
        }

        return labels.get(
            status,
            "Unknown",
        )

    @staticmethod
    def _safe_round(
        value: Optional[float],
        digits: int = 4,
    ):

        if value is None:
            return None

        try:
            return round(
                float(value),
                digits,
            )
        except (
            TypeError,
            ValueError,
        ):
            return None


# -------------------------------------------------------------
# Convenience function
# -------------------------------------------------------------

def separate_sensor_engine_fault(
    current_state: Optional[Dict[str, Any]] = None,
    expected_state: Optional[Dict[str, Any]] = None,
    residuals: Optional[Dict[str, Any]] = None,
    context: Optional[Dict[str, Any]] = None,
    source: Optional[Any] = None,
) -> Dict[str, Any]:

    separator = SensorEngineFaultSeparator()

    return separator.analyze(
        current_state=current_state,
        expected_state=expected_state,
        residuals=residuals,
        context=context,
        source=source,
    )