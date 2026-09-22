from __future__ import annotations

import time
from typing import Any, Dict

from digital_twin import EngineDigitalTwin

from predict import (
    engineering_check,
    model_status,
    predict_engine,
)

from sensor_engine_fault import SensorEngineFaultSeparator

from cross_sensor_consistency import (
    CrossSensorConsistencyEngine,
)

from temporal_engine import TemporalDegradationEngine


class AIDigitalTwin:

    def __init__(self):

        # --------------------------------------------------------
        # SENSOR–ENGINE FAULT SEPARATOR
        # --------------------------------------------------------

        self.sensor_engine_separator = (
            SensorEngineFaultSeparator()
        )

        # --------------------------------------------------------
        # CROSS-SENSOR PHYSICAL CONSISTENCY
        # --------------------------------------------------------

        self.cross_sensor_engine = (
            CrossSensorConsistencyEngine()
        )

        # --------------------------------------------------------
        # DIGITAL TWIN
        # --------------------------------------------------------

        self.twin = EngineDigitalTwin()

        # --------------------------------------------------------
        # TEMPORAL DEGRADATION ENGINE
        # --------------------------------------------------------

        self.temporal = TemporalDegradationEngine(
            max_history=180,
            min_history=8,
            future_minutes=[
                5.0,
                10.0,
                15.0,
                20.0,
            ],
        )

        # --------------------------------------------------------
        # DEGRADATION SEVERITY TRACKING
        # --------------------------------------------------------

        self._last_degradation_score = None
        self._last_degradation_timestamp = None
        self._last_degradation_severity_level = None

        # --------------------------------------------------------
        # FEATURE 15
        # OPERATING-LIMIT PANEL
        # --------------------------------------------------------
        #
        # IMPORTANT:
        # These are prototype/demo limits.
        #
        # They are NOT claimed to be real DRDO engine limits.
        #
        # Replace them with validated engine-specific limits
        # when such limits are available.
        #
        # All values are upper operating limits.
        # --------------------------------------------------------

        self.operating_limits = {

            "rpm": {
                "limit": 7000.0,
                "unit": "RPM",
                "parameter_label": "RPM",
            },

            "temperature": {
                "limit": 100.0,
                "unit": "°C",
                "parameter_label": "Temperature",
            },

            "vibration": {
                "limit": 2.5,
                "unit": "g",
                "parameter_label": "Vibration",
            },

            "current": {
                "limit": 10.0,
                "unit": "A",
                "parameter_label": "Current",
            },

            "load": {
                "limit": 100.0,
                "unit": "%",
                "parameter_label": "Load",
            },
        }

        # --------------------------------------------------------
        # FEATURE 16
        # ESTIMATED OPERATING WINDOW
        # --------------------------------------------------------
        #
        # This threshold represents the configured degradation
        # warning boundary used by the temporal severity engine.
        #
        # IMPORTANT:
        # This is NOT a certified aircraft-engine operating limit.
        #
        # It is used only to estimate how long the current
        # model-predicted degradation trajectory can remain below
        # the configured warning region.
        # --------------------------------------------------------

        self.operating_window_warning_threshold = 60.0

        # Maximum estimate we are willing to display.
        #
        # This prevents an extremely small degradation rate from
        # producing unrealistic "thousands of hours" estimates.
        #
        # This is a UI/model-estimation cap, NOT a safety limit.
        self.operating_window_max_minutes = 24.0 * 60.0

        # --------------------------------------------------------
        # FEATURE 18
        # UNCERTAINTY AND MODEL-VALIDITY GATE
        # --------------------------------------------------------
        #
        # These ranges represent the prototype/model operating
        # region currently used by the project.
        #
        # IMPORTANT:
        #
        # These are MODEL-VALIDITY / TEST-RANGE checks.
        #
        # They are NOT:
        #
        #     - certified aircraft limits
        #     - manufacturer limits
        #     - DRDO-approved limits
        #     - safe-flight boundaries
        #
        # Replace these with actual validated training/test
        # distributions when available.
        # --------------------------------------------------------

        self.model_validity_ranges = {

            "load": {
                "min": 40.0,
                "max": 80.0,
                "unit": "%",
            },

            "altitude": {
                "min": 3000.0,
                "max": 12000.0,
                "unit": "ft",
            },

            "ambient_temp": {
                "min": 15.0,
                "max": 40.0,
                "unit": "°C",
            },

            "throttle": {
                "min": 40.0,
                "max": 85.0,
                "unit": "%",
            },
        }

        # --------------------------------------------------------
        # FEATURE 18
        # TELEMETRY FRESHNESS
        # --------------------------------------------------------
        #
        # A stale telemetry packet must not silently produce an
        # optimistic mission recommendation.
        #
        # These values are configurable prototype thresholds.
        # --------------------------------------------------------

        self.telemetry_max_age_seconds = 5.0

        # Maximum future timestamp tolerance.
        #
        # A packet slightly ahead because of clock differences is
        # tolerated. A significantly future timestamp is invalid.
        self.telemetry_future_tolerance_seconds = 2.0

        # --------------------------------------------------------
        # FEATURE 18
        # MINIMUM DATA REQUIREMENTS
        # --------------------------------------------------------
        #
        # At least one physical telemetry value should normally
        # exist before calling the system valid.
        #
        # Hardware values expected in the current prototype:
        #
        #     RPM
        #     vibration
        #     motor temperature
        #     current
        #     voltage
        #
        # The rest can be simulated/model-derived.
        # --------------------------------------------------------

        self.minimum_reliable_hardware_fields = [
            "rpm",
            "vibration_g",
            "current_a",
            "voltage",
            "motor_temp_c",
        ]

    # ============================================================
    # RESIDUAL NORMALIZATION
    # ============================================================

    def _normalize_residuals(
        self,
        residuals: Dict[str, Any],
    ) -> Dict[str, float]:

        aliases = {

            "cht_residual": [
                "cht_residual",
            ],

            "egt_residual": [
                "egt_residual",
            ],

            "oil_pressure_residual": [
                "oil_pressure_residual",
                "oil_press_residual",
            ],

            "oil_temp_residual": [
                "oil_temp_residual",
            ],

            "fuel_flow_residual": [
                "fuel_flow_residual",
                "fuel_flow_lph_residual",
            ],

            "vibration_residual": [
                "vibration_residual",
                "vibration_g_residual",
            ],

            "battery_residual": [
                "battery_residual",
                "battery_v_residual",
            ],

            "injection_residual": [
                "injection_residual",
                "injection_deg_residual",
            ],
        }

        normalized = {}

        for standard_name, possible_names in aliases.items():

            for name in possible_names:

                if name not in residuals:
                    continue

                try:

                    value = float(
                        residuals[name]
                    )

                    normalized[
                        standard_name
                    ] = value

                except (
                    TypeError,
                    ValueError,
                ):
                    pass

                break

        return normalized

    # ============================================================
    # TIMESTAMP NORMALIZATION
    # ============================================================

    def _normalize_timestamp(
        self,
        timestamp: Any,
    ) -> float:

        if timestamp is None:
            return time.time()

        try:

            value = float(
                timestamp
            )

        except (
            TypeError,
            ValueError,
        ):

            return time.time()

        # DataFusion may provide milliseconds.
        # Temporal engine expects seconds.

        if value > 100_000_000_000:
            value = value / 1000.0

        return value

    # ============================================================
    # SENSOR ALIAS NORMALIZATION
    # ============================================================

    def _normalize_sensor_names(
        self,
        data: Dict[str, Any],
    ) -> Dict[str, Any]:

        result = dict(data)

        aliases = {

            "cht_c": [
                "cht",
            ],

            "egt_c": [
                "egt",
            ],

            "oil_press_bar": [
                "oil_pressure",
                "oil_press",
            ],

            "oil_temp_c": [
                "oil_temp",
            ],

            "fuel_flow_lph": [
                "fuel_flow",
            ],

            "vibration_g": [
                "vibration",
            ],

            "battery_v": [
                "battery",
                "voltage",
            ],

            "injection_deg": [
                "injection",
                "injection_timing",
            ],

            "current_a": [
                "current",
                "motor_current",
            ],
        }

        for standard_name, possible_names in aliases.items():

            if standard_name in result:
                continue

            for name in possible_names:

                if name in result:

                    result[
                        standard_name
                    ] = result[name]

                    break

        return result

    # ============================================================
    # SENSOR–ENGINE FAULT SEPARATION
    # ============================================================

    def _analyze_sensor_engine_fault(
        self,
        current_state: Dict[str, Any],
        expected_state: Dict[str, Any],
        raw_residuals: Dict[str, Any],
        normalized_residuals: Dict[str, Any],
        context: Dict[str, Any],
        source: Any,
    ) -> Dict[str, Any]:

        """
        Determines whether an abnormal parameter is more likely
        related to:

            NORMAL
            SENSOR_FAULT_LIKELY
            ENGINE_FAULT_LIKELY
            UNKNOWN

        Random Forest:
            What engine fault may be present?

        Sensor–Engine Separation:
            Is the abnormality more likely sensor-side or
            engine-side?
        """

        separation_residuals = {
            **raw_residuals,
            **normalized_residuals,
        }

        try:

            result = (
                self.sensor_engine_separator.analyze(

                    current_state=current_state,

                    expected_state=expected_state,

                    residuals=separation_residuals,

                    context=context,

                    source=source,

                )
            )

            if isinstance(
                result,
                dict,
            ):

                return result

            return {

                "status": "UNKNOWN",

                "display_label": "Unknown",

                "confidence_percent": 0.0,

                "reason": (
                    "Sensor–engine fault separation "
                    "returned an invalid result."
                ),

                "sensor_fault_likely": False,

                "engine_fault_likely": False,

                "abnormal_parameters": [],

                "sensor_suspects": [],

                "engine_suspects": [],

                "observations": [],

                "provenance": {
                    "diagnosis": "MODEL_DERIVED",
                },
            }

        except Exception as exc:

            return {

                "status": "UNKNOWN",

                "display_label": "Unknown",

                "confidence_percent": 0.0,

                "reason": (
                    "Sensor–engine fault separation "
                    "could not be completed."
                ),

                "sensor_fault_likely": False,

                "engine_fault_likely": False,

                "abnormal_parameters": [],

                "sensor_suspects": [],

                "engine_suspects": [],

                "observations": [],

                "error": str(exc),

                "provenance": {
                    "diagnosis": "MODEL_DERIVED",
                },
            }

    # ============================================================
    # CROSS-SENSOR PHYSICAL CONSISTENCY
    # ============================================================

    def _analyze_cross_sensor_consistency(
        self,
        current_state: Dict[str, Any],
        context: Dict[str, Any],
        normalized_residuals: Dict[str, Any],
    ) -> Dict[str, Any]:

        """
        Checks whether physically connected parameters behave
        consistently.

        Relationships checked:

            RPM ↔ Load
            CHT ↔ EGT
            Vibration ↔ Current

        This result is evidence for diagnosis.

        It should NOT independently declare an engine fault.
        """

        try:

            consistency_input = {
                **current_state,
                **context,
                **normalized_residuals,
            }

            result = (
                self.cross_sensor_engine.analyze(
                    consistency_input
                )
            )

            if isinstance(
                result,
                dict,
            ):

                return result

            return {

                "status": "UNKNOWN",

                "score": None,

                "interpretation": (
                    "Cross-sensor consistency "
                    "returned an invalid result."
                ),

                "relationships": {},

                "inconsistent_relationships": [],

                "caution_relationships": [],

                "checks_performed": [],
            }

        except Exception as exc:

            return {

                "status": "UNKNOWN",

                "score": None,

                "interpretation": (
                    "Cross-sensor physical consistency "
                    "could not be evaluated."
                ),

                "relationships": {},

                "inconsistent_relationships": [],

                "caution_relationships": [],

                "checks_performed": [],

                "error": str(exc),
            }

    # ============================================================
    # UNKNOWN FAULT STATE / EVIDENCE GATE
    # ============================================================

    def _determine_final_fault_state(
        self,
        sensor_engine_fault: Dict[str, Any],
        cross_sensor_consistency: Dict[str, Any],
        ai_result: Dict[str, Any],
        engineering_faults: Any,
        health_score: Any,
    ) -> Dict[str, Any]:

        """
        Final diagnostic evidence gate.

        Possible final states:

            NORMAL
            SENSOR_FAULT
            ENGINE_FAULT
            UNKNOWN

        IMPORTANT:

        This layer does NOT replace the Random Forest
        classifier.

        Instead, it combines independent evidence and
        prevents the system from forcing a diagnosis when
        evidence is weak or conflicting.
        """

        # --------------------------------------------------------
        # HEALTH SCORE
        # --------------------------------------------------------

        try:

            health = float(
                health_score
            )

        except (
            TypeError,
            ValueError,
        ):

            health = 0.0

        # --------------------------------------------------------
        # SAFELY NORMALIZE INPUTS
        # --------------------------------------------------------

        if not isinstance(
            sensor_engine_fault,
            dict,
        ):

            sensor_engine_fault = {}

        if not isinstance(
            cross_sensor_consistency,
            dict,
        ):

            cross_sensor_consistency = {}

        if not isinstance(
            ai_result,
            dict,
        ):

            ai_result = {}

        # --------------------------------------------------------
        # SENSOR–ENGINE EVIDENCE
        # --------------------------------------------------------

        separation_status = str(
            sensor_engine_fault.get(
                "status",
                "UNKNOWN",
            )
        ).upper()

        sensor_fault_likely = bool(
            sensor_engine_fault.get(
                "sensor_fault_likely",
                False,
            )
        )

        engine_fault_likely = bool(
            sensor_engine_fault.get(
                "engine_fault_likely",
                False,
            )
        )

        try:

            sensor_confidence = float(
                sensor_engine_fault.get(
                    "confidence_percent",
                    0.0,
                )
            )

        except (
            TypeError,
            ValueError,
        ):

            sensor_confidence = 0.0

        # --------------------------------------------------------
        # CROSS-SENSOR EVIDENCE
        # --------------------------------------------------------

        consistency_status = str(
            cross_sensor_consistency.get(
                "status",
                "UNKNOWN",
            )
        ).upper()

        consistency_score = (
            cross_sensor_consistency.get(
                "score",
                cross_sensor_consistency.get(
                    "consistency_score",
                    None,
                ),
            )
        )

        try:

            if consistency_score is not None:

                consistency_score = float(
                    consistency_score
                )

        except (
            TypeError,
            ValueError,
        ):

            consistency_score = None

        # --------------------------------------------------------
        # AI / RANDOM FOREST EVIDENCE
        # --------------------------------------------------------

        predicted_fault = None

        possible_fault_keys = [

            "predicted_fault",

            "fault",

            "fault_prediction",

            "prediction",

            "predicted_class",

            "fault_type",
        ]

        for key in possible_fault_keys:

            value = ai_result.get(
                key
            )

            if value is not None:

                if isinstance(
                    value,
                    str,
                ):

                    predicted_fault = value
                    break

                if isinstance(
                    value,
                    dict,
                ):

                    nested_value = (
                        value.get(
                            "predicted_fault",
                            value.get(
                                "fault",
                                value.get(
                                    "label",
                                    value.get(
                                        "class",
                                        None,
                                    ),
                                ),
                            ),
                        )
                    )

                    if nested_value is not None:

                        predicted_fault = (
                            str(
                                nested_value
                            )
                        )

                        break

        # --------------------------------------------------------
        # CHECK WHETHER AI REALLY DETECTED A FAULT
        # --------------------------------------------------------

        if predicted_fault is None:

            ai_fault_detected = False

        else:

            predicted_fault_lower = (
                str(
                    predicted_fault
                )
                .strip()
                .lower()
            )

            normal_labels = {
                "",
                "none",
                "normal",
                "healthy",
                "no_fault",
                "no fault",
                "no-fault",
                "unknown",
                "insufficient_evidence",
                "insufficient evidence",
                "nan",
                "null",
            }

            ai_fault_detected = (
                predicted_fault_lower
                not in normal_labels
            )

        # --------------------------------------------------------
        # MAKE SURE AI PREDICTION ACTUALLY SUCCEEDED
        # --------------------------------------------------------

        ai_success = ai_result.get(
            "success",
            True,
        )

        if ai_success is False:

            ai_fault_detected = False

        # --------------------------------------------------------
        # ENGINEERING RULE EVIDENCE
        # --------------------------------------------------------

        engineering_evidence = False

        if isinstance(
            engineering_faults,
            (list, tuple),
        ):

            engineering_evidence = (
                len(
                    engineering_faults
                ) > 0
            )

        elif isinstance(
            engineering_faults,
            dict,
        ):

            engineering_evidence = (
                len(
                    engineering_faults
                ) > 0
            )

        elif engineering_faults:

            engineering_evidence = True

        # --------------------------------------------------------
        # ENGINE HEALTH CONDITIONS
        # --------------------------------------------------------

        abnormal_engine_state = (
            health < 85.0
        )

        severe_engine_state = (
            health < 60.0
        )

        # ========================================================
        # EVIDENCE COUNTS
        # ========================================================

        engine_evidence_count = 0

        if engine_fault_likely:
            engine_evidence_count += 1

        if ai_fault_detected:
            engine_evidence_count += 1

        if engineering_evidence:
            engine_evidence_count += 1

        if (
            consistency_status == "NORMAL"
        ):

            if (
                consistency_score is None
                or consistency_score >= 60.0
            ):

                engine_evidence_count += 1

        # ========================================================
        # RULE 1 — CLEAR SENSOR FAULT
        # ========================================================

        if (

            separation_status
            == "SENSOR_FAULT_LIKELY"

            and sensor_fault_likely

            and sensor_confidence >= 65.0

        ):

            return {

                "state": "SENSOR_FAULT",

                "display_label": "Sensor Fault",

                "confidence_percent": round(
                    sensor_confidence,
                    2,
                ),

                "reason": (
                    "The abnormality is more consistent "
                    "with sensor-side behavior than "
                    "engine degradation."
                ),

                "safe_diagnostic": True,

                "evidence": {

                    "sensor_engine_separation": (
                        separation_status
                    ),

                    "sensor_confidence_percent": round(
                        sensor_confidence,
                        2,
                    ),

                    "cross_sensor_consistency": (
                        consistency_status
                    ),

                    "ai_fault_detected": (
                        ai_fault_detected
                    ),

                    "engineering_evidence": (
                        engineering_evidence
                    ),
                },
            }

        # ========================================================
        # RULE 2 — CLEAR ENGINE FAULT
        # ========================================================

        if (

            engine_fault_likely

            and (

                engine_evidence_count >= 2

                or (
                    severe_engine_state
                    and (
                        ai_fault_detected
                        or engineering_evidence
                    )
                )

            )

        ):

            confidence = min(
                95.0,
                50.0
                + (
                    engine_evidence_count
                    * 10.0
                ),
            )

            if severe_engine_state:

                confidence = max(
                    confidence,
                    75.0,
                )

            return {

                "state": "ENGINE_FAULT",

                "display_label": "Engine Fault",

                "confidence_percent": round(
                    confidence,
                    2,
                ),

                "reason": (
                    "Multiple independent indicators "
                    "support a genuine engine-side "
                    "abnormality."
                ),

                "safe_diagnostic": True,

                "evidence": {

                    "engine_evidence_count": (
                        engine_evidence_count
                    ),

                    "sensor_engine_separation": (
                        separation_status
                    ),

                    "cross_sensor_consistency": (
                        consistency_status
                    ),

                    "cross_sensor_score": (
                        consistency_score
                    ),

                    "ai_fault_detected": (
                        ai_fault_detected
                    ),

                    "predicted_fault": (
                        predicted_fault
                    ),

                    "engineering_evidence": (
                        engineering_evidence
                    ),

                    "health_score": round(
                        health,
                        2,
                    ),
                },
            }

        # ========================================================
        # RULE 3 — NORMAL
        # ========================================================

        if (

            health >= 90.0

            and not ai_fault_detected

            and not engine_fault_likely

            and not sensor_fault_likely

            and not engineering_evidence

            and (
                consistency_status
                in {
                    "NORMAL",
                    "UNKNOWN",
                }
            )

        ):

            return {

                "state": "NORMAL",

                "display_label": "Normal",

                "confidence_percent": 90.0,

                "reason": (
                    "No significant engine or sensor "
                    "abnormality is supported by the "
                    "available evidence."
                ),

                "safe_diagnostic": True,

                "evidence": {

                    "health_score": round(
                        health,
                        2,
                    ),

                    "sensor_engine_separation": (
                        separation_status
                    ),

                    "cross_sensor_consistency": (
                        consistency_status
                    ),

                    "ai_fault_detected": (
                        ai_fault_detected
                    ),

                    "engineering_evidence": (
                        engineering_evidence
                    ),
                },
            }

        # ========================================================
        # RULE 4 — UNKNOWN / INSUFFICIENT EVIDENCE
        # ========================================================

        unknown_reasons = []

        if (
            separation_status
            == "UNKNOWN"
        ):

            unknown_reasons.append(
                "sensor-engine separation "
                "is inconclusive"
            )

        if (
            consistency_status
            == "UNKNOWN"
        ):

            unknown_reasons.append(
                "cross-sensor evidence "
                "is insufficient"
            )

        if (
            consistency_status
            == "INCONSISTENT"
        ):

            unknown_reasons.append(
                "cross-sensor relationships "
                "are inconsistent"
            )

        if (
            ai_fault_detected
            and not engine_fault_likely
            and not sensor_fault_likely
        ):

            unknown_reasons.append(
                "AI predicted a fault but "
                "fault ownership is not established"
            )

        if (
            engineering_evidence
            and not engine_fault_likely
            and not sensor_fault_likely
        ):

            unknown_reasons.append(
                "engineering rule violation exists "
                "without clear fault ownership"
            )

        if not unknown_reasons:

            unknown_reasons.append(
                "available evidence does not match "
                "a sufficiently reliable diagnostic pattern"
            )

        return {

            "state": "UNKNOWN",

            "display_label": "Unknown",

            "confidence_percent": 0.0,

            "reason": (
                "Insufficient or conflicting evidence. "
                "The system will not force a sensor-fault "
                "or engine-fault diagnosis."
            ),

            "safe_diagnostic": True,

            "evidence": {

                "sensor_engine_separation": (
                    separation_status
                ),

                "sensor_confidence_percent": round(
                    sensor_confidence,
                    2,
                ),

                "cross_sensor_consistency": (
                    consistency_status
                ),

                "cross_sensor_score": (
                    consistency_score
                ),

                "ai_fault_detected": (
                    ai_fault_detected
                ),

                "predicted_fault": (
                    predicted_fault
                ),

                "engineering_evidence": (
                    engineering_evidence
                ),

                "health_score": round(
                    health,
                    2,
                ),

                "engine_evidence_count": (
                    engine_evidence_count
                ),
            },

            "unknown_reasons": (
                unknown_reasons
            ),
        }

    # ============================================================
    # DEGRADATION SEVERITY TRACKING
    # ============================================================

    def _update_degradation_severity(
        self,
        degradation_score: Any,
        degradation_delta: Any,
        trajectory: Any,
        timestamp: float,
    ) -> Dict[str, Any]:

        """
        Converts the temporal degradation score into a gradual
        severity state:

            NORMAL
            MILD
            MODERATE
            WARNING
            CRITICAL
        """

        thresholds = {
            "normal_max": 20.0,
            "mild_max": 40.0,
            "moderate_max": 60.0,
            "warning_max": 80.0,
        }

        warning_threshold = 60.0

        hysteresis_points = 2.0

        try:

            score = float(
                degradation_score
            )

        except (
            TypeError,
            ValueError,
        ):

            return {

                "state": "UNKNOWN",

                "severity_level": -1,

                "display_label": "Unknown",

                "degradation_value": None,

                "trend_direction": "UNKNOWN",

                "trend_rate_per_hour": None,

                "degradation_delta": None,

                "warning_threshold": (
                    warning_threshold
                ),

                "warning_time_hours": None,

                "warning_time_minutes": None,

                "warning_time_label": (
                    "Insufficient degradation data"
                ),

                "thresholds": thresholds,

                "hysteresis_points": (
                    hysteresis_points
                ),

                "history_available": False,

                "provenance": {

                    "severity": (
                        "TEMPORAL_DEGRADATION_DERIVED"
                    ),

                },

            }

        score = max(
            0.0,
            min(
                100.0,
                score,
            ),
        )

        previous_score = (
            self._last_degradation_score
        )

        previous_timestamp = (
            self._last_degradation_timestamp
        )

        previous_level = (
            self._last_degradation_severity_level
        )

        history_available = (
            previous_score is not None
            and previous_timestamp is not None
        )

        trend_rate_per_hour = None

        if history_available:

            try:

                dt_seconds = (
                    float(timestamp)
                    - float(previous_timestamp)
                )

                score_change = (
                    score
                    - float(previous_score)
                )

                if dt_seconds > 0:

                    dt_hours = (
                        dt_seconds
                        / 3600.0
                    )

                    trend_rate_per_hour = (
                        score_change
                        / dt_hours
                    )

            except (
                TypeError,
                ValueError,
                ZeroDivisionError,
            ):

                trend_rate_per_hour = None

        normalized_delta = None

        try:

            if degradation_delta is not None:

                normalized_delta = float(
                    degradation_delta
                )

        except (
            TypeError,
            ValueError,
        ):

            normalized_delta = None

        if trend_rate_per_hour is not None:

            if trend_rate_per_hour > 0.25:

                trend_direction = "WORSENING"

            elif trend_rate_per_hour < -0.25:

                trend_direction = "IMPROVING"

            else:

                trend_direction = "STABLE"

        elif normalized_delta is not None:

            if normalized_delta > 0.25:

                trend_direction = "WORSENING"

            elif normalized_delta < -0.25:

                trend_direction = "IMPROVING"

            else:

                trajectory_upper = str(
                    trajectory
                    if trajectory is not None
                    else "UNKNOWN"
                ).upper()

                if trajectory_upper in {
                    "DEGRADING",
                    "WORSENING",
                }:

                    trend_direction = "WORSENING"

                elif trajectory_upper in {
                    "IMPROVING",
                    "RECOVERING",
                }:

                    trend_direction = "IMPROVING"

                elif trajectory_upper == "STABLE":

                    trend_direction = "STABLE"

                else:

                    trend_direction = "UNKNOWN"

        else:

            trajectory_upper = str(
                trajectory
                if trajectory is not None
                else "UNKNOWN"
            ).upper()

            if trajectory_upper in {
                "DEGRADING",
                "WORSENING",
            }:

                trend_direction = "WORSENING"

            elif trajectory_upper in {
                "IMPROVING",
                "RECOVERING",
            }:

                trend_direction = "IMPROVING"

            elif trajectory_upper == "STABLE":

                trend_direction = "STABLE"

            else:

                trend_direction = "UNKNOWN"

        if score < 20.0:

            desired_level = 0

        elif score < 40.0:

            desired_level = 1

        elif score < 60.0:

            desired_level = 2

        elif score < 80.0:

            desired_level = 3

        else:

            desired_level = 4

        final_level = desired_level

        if previous_level is not None:

            try:

                previous_level = int(
                    previous_level
                )

            except (
                TypeError,
                ValueError,
            ):

                previous_level = None

        if previous_level is not None:

            if desired_level < previous_level:

                lower_boundaries = [
                    0.0,
                    20.0,
                    40.0,
                    60.0,
                    80.0,
                ]

                previous_lower_boundary = (
                    lower_boundaries[
                        previous_level
                    ]
                )

                downgrade_threshold = (
                    previous_lower_boundary
                    - hysteresis_points
                )

                if score >= downgrade_threshold:

                    final_level = previous_level

        severity_states = [
            "NORMAL",
            "MILD",
            "MODERATE",
            "WARNING",
            "CRITICAL",
        ]

        severity_labels = [
            "Normal",
            "Mild",
            "Moderate",
            "Warning",
            "Critical",
        ]

        state = severity_states[
            final_level
        ]

        display_label = severity_labels[
            final_level
        ]

        warning_time_hours = None
        warning_time_minutes = None

        if score >= 80.0:

            warning_time_hours = 0.0
            warning_time_minutes = 0.0

            warning_time_label = (
                "Critical level reached"
            )

        elif score >= warning_threshold:

            warning_time_hours = 0.0
            warning_time_minutes = 0.0

            warning_time_label = (
                "Warning threshold reached"
            )

        elif (
            trend_rate_per_hour is not None
            and trend_rate_per_hour > 0.0
        ):

            remaining_degradation = (
                warning_threshold
                - score
            )

            warning_time_hours = (
                remaining_degradation
                / trend_rate_per_hour
            )

            warning_time_minutes = (
                warning_time_hours
                * 60.0
            )

            warning_time_label = (
                "Estimated warning in "
                f"{warning_time_hours:.1f} h"
            )

        elif history_available:

            warning_time_label = (
                "No warning projected while "
                "degradation is stable/improving"
            )

        else:

            warning_time_label = (
                "Building degradation trend history"
            )

        self._last_degradation_score = score

        self._last_degradation_timestamp = (
            timestamp
        )

        self._last_degradation_severity_level = (
            final_level
        )

        return {

            "state": state,

            "severity_level": final_level,

            "display_label": display_label,

            "degradation_value": round(
                score,
                2,
            ),

            "trend_direction": trend_direction,

            "trend_rate_per_hour": (
                round(
                    trend_rate_per_hour,
                    4,
                )
                if trend_rate_per_hour is not None
                else None
            ),

            "degradation_delta": (
                round(
                    normalized_delta,
                    4,
                )
                if normalized_delta is not None
                else None
            ),

            "warning_threshold": (
                warning_threshold
            ),

            "warning_time_hours": (
                round(
                    warning_time_hours,
                    2,
                )
                if warning_time_hours is not None
                else None
            ),

            "warning_time_minutes": (
                round(
                    warning_time_minutes,
                    1,
                )
                if warning_time_minutes is not None
                else None
            ),

            "warning_time_label": (
                warning_time_label
            ),

            "thresholds": thresholds,

            "hysteresis_points": (
                hysteresis_points
            ),

            "history_available": (
                history_available
            ),

            "provenance": {

                "severity": (
                    "TEMPORAL_DEGRADATION_DERIVED"
                ),

                "trend": (
                    "TIMESTAMPED_SCORE_HISTORY"
                    if trend_rate_per_hour is not None
                    else "TEMPORAL_TRAJECTORY_OR_DELTA"
                ),
            },
        }

    # ============================================================
    # FEATURE 15
    # OPERATING-LIMIT PANEL
    # ============================================================

    def _calculate_operating_limits(
        self,
        reading: Dict[str, Any],
        context: Dict[str, Any],
        current_state: Dict[str, Any],
        source: Any,
    ) -> Dict[str, Any]:

        """
        Calculates the current operating margin of important
        engine parameters.

        IMPORTANT:

        These limits are prototype/configurable limits and
        must not be presented as certified engine limits.
        """

        if not isinstance(
            reading,
            dict,
        ):

            reading = {}

        if not isinstance(
            context,
            dict,
        ):

            context = {}

        if not isinstance(
            current_state,
            dict,
        ):

            current_state = {}

        # --------------------------------------------------------
        # SOURCE NORMALIZATION
        # --------------------------------------------------------

        default_source = str(
            source
            if source is not None
            else "SIMULATED"
        ).upper()

        if default_source not in {
            "HARDWARE",
            "SIMULATED",
            "DIGITAL_TWIN",
        }:

            default_source = "SIMULATED"

        # --------------------------------------------------------
        # SAFE FLOAT
        # --------------------------------------------------------

        def safe_float(value):

            try:

                numeric = float(
                    value
                )

                if numeric != numeric:
                    return None

                return numeric

            except (
                TypeError,
                ValueError,
            ):

                return None

        # --------------------------------------------------------
        # PARAMETER CALCULATION
        # --------------------------------------------------------

        def calculate_parameter(
            parameter_name: str,
            value: Any,
            provenance: str,
        ) -> Dict[str, Any]:

            config = self.operating_limits[
                parameter_name
            ]

            limit = float(
                config["limit"]
            )

            unit = config["unit"]

            label = config[
                "parameter_label"
            ]

            numeric_value = safe_float(
                value
            )

            normalized_provenance = str(
                provenance
                if provenance is not None
                else "SIMULATED"
            ).upper()

            if normalized_provenance not in {
                "HARDWARE",
                "SIMULATED",
                "DIGITAL_TWIN",
            }:

                normalized_provenance = (
                    "SIMULATED"
                )

            if numeric_value is None:

                return {

                    "current_value": None,

                    "unit": unit,

                    "limit": limit,

                    "remaining_margin": None,

                    "margin_percent": None,

                    "status": "UNKNOWN",

                    "display_label": "Unknown",

                    "provenance": (
                        normalized_provenance
                    ),

                    "reason": (
                        f"{label} value is unavailable."
                    ),
                }

            remaining_margin = (
                limit
                - numeric_value
            )

            margin_percent = (
                remaining_margin
                / limit
                * 100.0
                if limit > 0
                else None
            )

            if numeric_value > limit:

                status = "LIMIT_EXCEEDED"

                display_label = (
                    "Limit Exceeded"
                )

                reason = (
                    f"{label} exceeds the "
                    f"configured operating limit."
                )

            elif (
                margin_percent is not None
                and margin_percent <= 20.0
            ):

                status = "CAUTION"

                display_label = "Caution"

                reason = (
                    f"{label} is close to its "
                    f"configured operating limit."
                )

            else:

                status = "NORMAL"

                display_label = "Normal"

                reason = (
                    f"{label} is within the "
                    f"configured operating limit."
                )

            return {

                "current_value": round(
                    numeric_value,
                    3,
                ),

                "unit": unit,

                "limit": round(
                    limit,
                    3,
                ),

                "remaining_margin": round(
                    remaining_margin,
                    3,
                ),

                "margin_percent": (
                    round(
                        margin_percent,
                        2,
                    )
                    if margin_percent is not None
                    else None
                ),

                "status": status,

                "display_label": display_label,

                "provenance": (
                    normalized_provenance
                ),

                "reason": reason,
            }

        # --------------------------------------------------------
        # RPM
        # --------------------------------------------------------

        rpm_value = reading.get(
            "rpm",
            None,
        )

        rpm_provenance = default_source

        if rpm_value is None:

            rpm_value = current_state.get(
                "rpm",
                None,
            )

            if rpm_value is not None:

                rpm_provenance = (
                    "DIGITAL_TWIN"
                )

        # --------------------------------------------------------
        # TEMPERATURE
        # --------------------------------------------------------

        temperature_value = None

        temperature_provenance = (
            default_source
        )

        temperature_keys = [
            "motor_temp_c",
            "motor_temperature",
            "temperature",
            "temp_c",
            "engine_temp",
        ]

        for key in temperature_keys:

            if key in reading:

                temperature_value = (
                    reading.get(key)
                )

                break

        if temperature_value is None:

            for key in temperature_keys:

                if key in current_state:

                    temperature_value = (
                        current_state.get(key)
                    )

                    temperature_provenance = (
                        "DIGITAL_TWIN"
                    )

                    break

        # --------------------------------------------------------
        # VIBRATION
        # --------------------------------------------------------

        vibration_value = reading.get(
            "vibration_g",
            None,
        )

        vibration_provenance = (
            default_source
        )

        if vibration_value is None:

            vibration_value = reading.get(
                "vibration",
                None,
            )

        if vibration_value is None:

            vibration_value = current_state.get(
                "vibration_g",
                None,
            )

            if vibration_value is not None:

                vibration_provenance = (
                    "DIGITAL_TWIN"
                )

        # --------------------------------------------------------
        # CURRENT
        # --------------------------------------------------------

        current_value = reading.get(
            "current_a",
            None,
        )

        current_provenance = (
            default_source
        )

        if current_value is None:

            current_value = reading.get(
                "current",
                None,
            )

        if current_value is None:

            current_value = current_state.get(
                "current_a",
                None,
            )

            if current_value is not None:

                current_provenance = (
                    "DIGITAL_TWIN"
                )

        # --------------------------------------------------------
        # LOAD
        # --------------------------------------------------------

        load_value = reading.get(
            "load",
            None,
        )

        load_provenance = (
            default_source
        )

        if load_value is None:

            load_value = context.get(
                "load",
                None,
            )

            if load_value is not None:

                load_provenance = (
                    "SIMULATED"
                )

        # --------------------------------------------------------
        # BUILD PARAMETERS
        # --------------------------------------------------------

        parameters = {

            "rpm": calculate_parameter(
                "rpm",
                rpm_value,
                rpm_provenance,
            ),

            "temperature": calculate_parameter(
                "temperature",
                temperature_value,
                temperature_provenance,
            ),

            "vibration": calculate_parameter(
                "vibration",
                vibration_value,
                vibration_provenance,
            ),

            "current": calculate_parameter(
                "current",
                current_value,
                current_provenance,
            ),

            "load": calculate_parameter(
                "load",
                load_value,
                load_provenance,
            ),
        }

        valid_parameters = {

            name: data

            for name, data
            in parameters.items()

            if (
                data.get(
                    "margin_percent"
                )
                is not None
            )
        }

        # --------------------------------------------------------
        # OVERALL STATUS
        # --------------------------------------------------------

        exceeded_parameters = [

            name

            for name, data
            in parameters.items()

            if data.get(
                "status"
            ) == "LIMIT_EXCEEDED"
        ]

        caution_parameters = [

            name

            for name, data
            in parameters.items()

            if data.get(
                "status"
            ) == "CAUTION"
        ]

        if exceeded_parameters:

            overall_status = (
                "LIMIT_EXCEEDED"
            )

            overall_display_label = (
                "Operating Limit Exceeded"
            )

        elif caution_parameters:

            overall_status = (
                "CAUTION"
            )

            overall_display_label = (
                "Approaching Operating Limit"
            )

        elif valid_parameters:

            overall_status = (
                "WITHIN_LIMITS"
            )

            overall_display_label = (
                "Within Operating Limits"
            )

        else:

            overall_status = (
                "UNKNOWN"
            )

            overall_display_label = (
                "Operating Limit Status Unknown"
            )

        # --------------------------------------------------------
        # LIMITING PARAMETER
        # --------------------------------------------------------

        limiting_parameter = None

        overall_margin_percent = None

        if valid_parameters:

            limiting_parameter = min(
                valid_parameters,
                key=lambda name: (
                    valid_parameters[name].get(
                        "margin_percent"
                    )
                ),
            )

            overall_margin_percent = (
                valid_parameters[
                    limiting_parameter
                ].get(
                    "margin_percent"
                )
            )

        # --------------------------------------------------------
        # EVIDENCE
        # --------------------------------------------------------

        evidence = []

        if exceeded_parameters:

            for name in exceeded_parameters:

                parameter = parameters[name]

                value = parameter.get(
                    "current_value"
                )

                limit = parameter.get(
                    "limit"
                )

                unit = parameter.get(
                    "unit"
                )

                excess = (
                    float(value)
                    - float(limit)
                )

                evidence.append(
                    f"{name.upper()} exceeds the "
                    f"configured limit by "
                    f"{excess:.2f} {unit}."
                )

        elif caution_parameters:

            for name in caution_parameters:

                parameter = parameters[name]

                margin = parameter.get(
                    "margin_percent"
                )

                evidence.append(
                    f"{name.upper()} has only "
                    f"{margin:.1f}% remaining "
                    f"margin before the configured "
                    f"operating limit."
                )

        elif limiting_parameter is not None:

            evidence.append(
                f"{limiting_parameter.upper()} is "
                f"currently the closest parameter "
                f"to its configured operating limit."
            )

        else:

            evidence.append(
                "No valid operating-limit measurements "
                "are currently available."
            )

        # --------------------------------------------------------
        # PROVENANCE
        # --------------------------------------------------------

        provenance = {

            "panel": (
                "CONFIGURED_OPERATING_LIMIT_ANALYSIS"
            ),

            "limits": (
                "PROTOTYPE_CONFIGURABLE_LIMITS"
            ),

            "values": {
                name: data.get(
                    "provenance"
                )
                for name, data
                in parameters.items()
            },
        }

        return {

            "overall_status": (
                overall_status
            ),

            "overall_display_label": (
                overall_display_label
            ),

            "overall_margin_percent": (
                round(
                    overall_margin_percent,
                    2,
                )
                if overall_margin_percent is not None
                else None
            ),

            "limiting_parameter": (
                limiting_parameter
            ),

            "parameters": parameters,

            "exceeded_parameters": (
                exceeded_parameters
            ),

            "caution_parameters": (
                caution_parameters
            ),

            "evidence": evidence,

            "limits_basis": (
                "PROTOTYPE_CONFIGURABLE_OPERATING_LIMITS"
            ),

            "provenance": provenance,
        }

    # ============================================================
    # FEATURE 16
    # ESTIMATED OPERATING WINDOW
    # ============================================================

    def _calculate_estimated_operating_window(
        self,
        degradation_score: Any,
        trend_rate_per_hour: Any,
        trajectory: Any,
        mission_remaining_minutes: Any,
        degradation_history_available: bool,
    ) -> Dict[str, Any]:

        """
        Estimates how long the current model-based degradation
        trajectory can remain below the configured warning region.

        IMPORTANT:

        This is a MODEL-BASED ESTIMATE.

        It is NOT:
            - certified safe flight time
            - an aircraft type certificate limit
            - an engine manufacturer's approved operating limit
            - a guarantee of remaining engine life
        """

        def safe_float(value):

            try:

                numeric = float(
                    value
                )

                if numeric != numeric:
                    return None

                return numeric

            except (
                TypeError,
                ValueError,
            ):

                return None

        score = safe_float(
            degradation_score
        )

        rate_per_hour = safe_float(
            trend_rate_per_hour
        )

        mission_remaining = safe_float(
            mission_remaining_minutes
        )

        trajectory_upper = str(
            trajectory
            if trajectory is not None
            else "UNKNOWN"
        ).upper()

        warning_threshold = float(
            self.operating_window_warning_threshold
        )

        if (
            mission_remaining is not None
            and mission_remaining < 0.0
        ):

            mission_remaining = 0.0

        result = {

            "estimated_operating_window_minutes": None,

            "estimated_operating_window_hours": None,

            "mission_remaining_minutes": (
                round(
                    mission_remaining,
                    2,
                )
                if mission_remaining is not None
                else None
            ),

            "mission_remaining_hours": (
                round(
                    mission_remaining / 60.0,
                    2,
                )
                if mission_remaining is not None
                else None
            ),

            "remaining_window_margin_minutes": None,

            "remaining_window_margin_hours": None,

            "mission_within_estimated_window": None,

            "status": "UNKNOWN",

            "display_label": (
                "Operating Window Estimate Unavailable"
            ),

            "basis": (
                "MODEL_BASED_DEGRADATION_TREND"
            ),

            "warning_threshold": (
                warning_threshold
            ),

            "trajectory": trajectory_upper,

            "trend_rate_per_hour": (
                round(
                    rate_per_hour,
                    4,
                )
                if rate_per_hour is not None
                else None
            ),

            "degradation_score": (
                round(
                    score,
                    2,
                )
                if score is not None
                else None
            ),

            "history_available": bool(
                degradation_history_available
            ),

            "certification_status": (
                "NOT_CERTIFIED_SAFE_FLIGHT_TIME"
            ),

            "safety_label": (
                "MODEL-BASED ESTIMATE — "
                "NOT CERTIFIED SAFE FLIGHT TIME"
            ),

            "reason": (
                "Insufficient information to estimate "
                "the operating window."
            ),
        }

        if score is None:

            result["reason"] = (
                "Operating window cannot be estimated "
                "because the degradation score is unavailable."
            )

            return result

        if score >= warning_threshold:

            estimated_minutes = 0.0

            result[
                "estimated_operating_window_minutes"
            ] = estimated_minutes

            result[
                "estimated_operating_window_hours"
            ] = 0.0

            if mission_remaining is not None:

                result[
                    "remaining_window_margin_minutes"
                ] = round(
                    estimated_minutes
                    - mission_remaining,
                    2,
                )

                result[
                    "remaining_window_margin_hours"
                ] = round(
                    (
                        estimated_minutes
                        - mission_remaining
                    )
                    / 60.0,
                    2,
                )

                result[
                    "mission_within_estimated_window"
                ] = (
                    mission_remaining
                    <= estimated_minutes
                )

            result["status"] = (
                "WINDOW_REACHED"
            )

            result["display_label"] = (
                "Estimated Window Reached"
            )

            result["reason"] = (
                "The current degradation score has "
                "already reached or exceeded the "
                "configured warning boundary."
            )

            return result

        if (
            rate_per_hour is not None
            and rate_per_hour > 0.0
            and (
                trajectory_upper
                in {
                    "WORSENING",
                    "DEGRADING",
                }
                or rate_per_hour > 0.25
            )
        ):

            remaining_degradation = (
                warning_threshold
                - score
            )

            estimated_hours = (
                remaining_degradation
                / rate_per_hour
            )

            estimated_minutes = (
                estimated_hours
                * 60.0
            )

            estimated_minutes = max(
                0.0,
                min(
                    estimated_minutes,
                    float(
                        self.operating_window_max_minutes
                    ),
                ),
            )

            estimated_hours = (
                estimated_minutes
                / 60.0
            )

            result[
                "estimated_operating_window_minutes"
            ] = round(
                estimated_minutes,
                1,
            )

            result[
                "estimated_operating_window_hours"
            ] = round(
                estimated_hours,
                2,
            )

            if mission_remaining is not None:

                margin_minutes = (
                    estimated_minutes
                    - mission_remaining
                )

                result[
                    "remaining_window_margin_minutes"
                ] = round(
                    margin_minutes,
                    1,
                )

                result[
                    "remaining_window_margin_hours"
                ] = round(
                    margin_minutes / 60.0,
                    2,
                )

                if (
                    mission_remaining
                    <= estimated_minutes
                ):

                    result[
                        "mission_within_estimated_window"
                    ] = True

                    result["status"] = (
                        "WITHIN_ESTIMATED_WINDOW"
                    )

                    result["display_label"] = (
                        "Mission Within Estimated Window"
                    )

                    result["reason"] = (
                        "The remaining mission duration "
                        "is shorter than the current "
                        "model-based estimated operating "
                        "window."
                    )

                else:

                    result[
                        "mission_within_estimated_window"
                    ] = False

                    result["status"] = (
                        "MISSION_EXCEEDS_ESTIMATED_WINDOW"
                    )

                    result["display_label"] = (
                        "Mission Exceeds Estimated Window"
                    )

                    result["reason"] = (
                        "The remaining mission duration "
                        "extends beyond the current "
                        "model-based estimated operating "
                        "window."
                    )

            else:

                result["status"] = (
                    "WINDOW_ESTIMATED"
                )

                result["display_label"] = (
                    "Operating Window Estimated"
                )

                result["reason"] = (
                    "A model-based operating window was "
                    "estimated from the current degradation "
                    "score and timestamp-derived trend rate."
                )

            return result

        if (
            trajectory_upper
            in {
                "STABLE",
                "IMPROVING",
                "RECOVERING",
            }
            or (
                rate_per_hour is not None
                and rate_per_hour <= 0.25
            )
        ):

            result["status"] = (
                "NO_COUNTDOWN_PROJECTED"
            )

            result["display_label"] = (
                "No Degradation Countdown Projected"
            )

            result["reason"] = (
                "The current model does not show a "
                "sufficiently positive degradation rate "
                "to calculate a meaningful countdown. "
                "This does not mean unlimited safe operation."
            )

            return result

        result["status"] = (
            "INSUFFICIENT_TREND_DATA"
        )

        result["display_label"] = (
            "Building Operating Window Estimate"
        )

        result["reason"] = (
            "Additional timestamped degradation data "
            "is required before a reliable operating-window "
            "estimate can be produced."
        )

        return result

    # ============================================================
    # MISSION REMAINING DURATION EXTRACTION
    # ============================================================

    def _extract_mission_remaining_minutes(
        self,
        reading: Dict[str, Any],
        context: Dict[str, Any],
    ) -> Any:

        """
        Finds the remaining mission duration supplied by the
        mission layer/dashboard.
        """

        if not isinstance(
            reading,
            dict,
        ):

            reading = {}

        if not isinstance(
            context,
            dict,
        ):

            context = {}

        minute_keys = [

            "mission_remaining_minutes",

            "mission_remaining_duration_minutes",

            "remaining_mission_minutes",

            "remaining_mission_duration",

            "mission_time_remaining_minutes",
        ]

        for key in minute_keys:

            if key in reading:

                try:

                    value = float(
                        reading[key]
                    )

                    if value >= 0:

                        return value

                except (
                    TypeError,
                    ValueError,
                ):

                    pass

        for key in minute_keys:

            if key in context:

                try:

                    value = float(
                        context[key]
                    )

                    if value >= 0:

                        return value

                except (
                    TypeError,
                    ValueError,
                ):

                    pass

        second_keys = [

            "mission_remaining_seconds",

            "remaining_mission_seconds",
        ]

        for key in second_keys:

            if key in reading:

                try:

                    value = float(
                        reading[key]
                    )

                    if value >= 0:

                        return value / 60.0

                except (
                    TypeError,
                    ValueError,
                ):

                    pass

        for key in second_keys:

            if key in context:

                try:

                    value = float(
                        context[key]
                    )

                    if value >= 0:

                        return value / 60.0

                except (
                    TypeError,
                    ValueError,
                ):

                    pass

        return None

    # ============================================================
    # FEATURE 18
    # UNCERTAINTY AND MODEL-VALIDITY GATE
    # ============================================================

    def _calculate_model_validity_gate(
        self,
        telemetry: Dict[str, Any],
        reading: Dict[str, Any],
        context: Dict[str, Any],
        ai_result: Dict[str, Any],
        temporal_result: Dict[str, Any],
        operating_limits: Dict[str, Any],
        timestamp: float,
    ) -> Dict[str, Any]:

        """
        Determines whether the current telemetry/model state is
        reliable enough to support downstream recommendations.

        Checks:

            1. Model availability
            2. Telemetry freshness
            3. Required telemetry availability
            4. Model-range validity
            5. Out-of-range conditions
            6. Prediction interval availability
            7. Prediction confidence where available

        IMPORTANT:

        This is a decision-support validity gate.

        It does not certify flight safety.

        If reliability is insufficient, the gate explicitly
        blocks downstream recommendations.
        """

        if not isinstance(
            telemetry,
            dict,
        ):

            telemetry = {}

        if not isinstance(
            reading,
            dict,
        ):

            reading = {}

        if not isinstance(
            context,
            dict,
        ):

            context = {}

        if not isinstance(
            ai_result,
            dict,
        ):

            ai_result = {}

        if not isinstance(
            temporal_result,
            dict,
        ):

            temporal_result = {}

        if not isinstance(
            operating_limits,
            dict,
        ):

            operating_limits = {}

        # --------------------------------------------------------
        # SAFE FLOAT
        # --------------------------------------------------------

        def safe_float(value):

            try:

                numeric = float(
                    value
                )

                if numeric != numeric:

                    return None

                return numeric

            except (
                TypeError,
                ValueError,
            ):

                return None

        # --------------------------------------------------------
        # MODEL STATUS
        # --------------------------------------------------------

        try:

            current_model_status = model_status()

        except Exception as exc:

            current_model_status = {
                "status": "UNKNOWN",
                "error": str(exc),
            }

        model_status_text = str(
            current_model_status
            if current_model_status is not None
            else "UNKNOWN"
        )

        model_status_upper = (
            model_status_text.upper()
        )

        model_available = True

        if isinstance(
            current_model_status,
            dict,
        ):

            possible_status = str(
                current_model_status.get(
                    "status",
                    current_model_status.get(
                        "state",
                        current_model_status.get(
                            "model_status",
                            "UNKNOWN",
                        ),
                    ),
                )
            ).upper()

            if possible_status in {
                "ERROR",
                "FAILED",
                "UNAVAILABLE",
                "INVALID",
                "MISSING",
                "UNKNOWN",
            }:

                model_available = False

        elif model_status_upper in {
            "ERROR",
            "FAILED",
            "UNAVAILABLE",
            "INVALID",
            "MISSING",
            "UNKNOWN",
            "",
        }:

            model_available = False

        # --------------------------------------------------------
        # TELEMETRY TIMESTAMP / FRESHNESS
        # --------------------------------------------------------

        telemetry_timestamp_raw = telemetry.get(
            "timestamp",
            reading.get(
                "timestamp",
                None,
            ),
        )

        timestamp_available = (
            telemetry_timestamp_raw is not None
        )

        telemetry_timestamp = None

        if timestamp_available:

            telemetry_timestamp = (
                self._normalize_timestamp(
                    telemetry_timestamp_raw
                )
            )

        now = time.time()

        telemetry_age_seconds = None

        freshness_status = (
            "UNKNOWN"
        )

        freshness_label = (
            "Telemetry Freshness Unknown"
        )

        if telemetry_timestamp is None:

            freshness_status = (
                "TIMESTAMP_MISSING"
            )

            freshness_label = (
                "Telemetry Timestamp Missing"
            )

        else:

            telemetry_age_seconds = (
                now
                - telemetry_timestamp
            )

            if (
                telemetry_age_seconds
                < -self.telemetry_future_tolerance_seconds
            ):

                freshness_status = (
                    "FUTURE_TIMESTAMP"
                )

                freshness_label = (
                    "Telemetry Timestamp Invalid"
                )

            elif (
                telemetry_age_seconds
                > self.telemetry_max_age_seconds
            ):

                freshness_status = (
                    "STALE"
                )

                freshness_label = (
                    "Telemetry Stale"
                )

            else:

                freshness_status = (
                    "FRESH"
                )

                freshness_label = (
                    "Telemetry Fresh"
                )

        # --------------------------------------------------------
        # TELEMETRY QUALITY
        # --------------------------------------------------------

        quality = telemetry.get(
            "quality",
            {},
        )

        if not isinstance(
            quality,
            dict,
        ):

            quality = {}

        quality_status = str(
            quality.get(
                "status",
                quality.get(
                    "state",
                    "UNKNOWN",
                ),
            )
        ).upper()

        quality_invalid = quality_status in {
            "BAD",
            "INVALID",
            "FAILED",
            "STALE",
            "UNRELIABLE",
        }

        # --------------------------------------------------------
        # REQUIRED TELEMETRY
        # --------------------------------------------------------

        available_hardware_fields = []

        missing_hardware_fields = []

        for field in (
            self.minimum_reliable_hardware_fields
        ):

            aliases = {

                "rpm": [
                    "rpm",
                ],

                "vibration_g": [
                    "vibration_g",
                    "vibration",
                ],

                "current_a": [
                    "current_a",
                    "current",
                    "motor_current",
                ],

                "voltage": [
                    "voltage",
                    "battery_v",
                    "battery",
                ],

                "motor_temp_c": [
                    "motor_temp_c",
                    "motor_temperature",
                    "temperature",
                    "temp_c",
                ],
            }

            found = False

            for key in aliases.get(
                field,
                [field],
            ):

                if key in reading:

                    value = safe_float(
                        reading.get(key)
                    )

                    if value is not None:

                        found = True
                        break

            if found:

                available_hardware_fields.append(
                    field
                )

            else:

                missing_hardware_fields.append(
                    field
                )

        hardware_source = str(
            telemetry.get(
                "source",
                "SIMULATED",
            )
        ).upper()

        if hardware_source == "HARDWARE":

            telemetry_data_status = (
                "HARDWARE_TELEMETRY"
            )

        elif hardware_source == "SIMULATED":

            telemetry_data_status = (
                "SIMULATED_TELEMETRY"
            )

        elif hardware_source == "DIGITAL_TWIN":

            telemetry_data_status = (
                "DIGITAL_TWIN_DATA"
            )

        else:

            telemetry_data_status = (
                "MIXED_OR_UNKNOWN"
            )

        # --------------------------------------------------------
        # MODEL-RANGE VALIDITY
        # --------------------------------------------------------

        out_of_range_parameters = []

        in_range_parameters = []

        unavailable_range_parameters = []

        range_details = {}

        for parameter_name, config in (
            self.model_validity_ranges.items()
        ):

            minimum = safe_float(
                config.get(
                    "min"
                )
            )

            maximum = safe_float(
                config.get(
                    "max"
                )
            )

            unit = config.get(
                "unit",
                "",
            )

            value = None

            value_source = None

            # Reading takes priority.
            if parameter_name in reading:

                value = safe_float(
                    reading.get(
                        parameter_name
                    )
                )

                if value is not None:

                    value_source = "READING"

            # Then context.
            if value is None:

                if parameter_name in context:

                    value = safe_float(
                        context.get(
                            parameter_name
                        )
                    )

                    if value is not None:

                        value_source = "CONTEXT"

            # Try common aliases.
            if value is None:

                aliases = {

                    "ambient_temp": [
                        "ambient_temperature",
                        "ambient_temp_c",
                        "temperature_ambient",
                    ],

                    "altitude": [
                        "altitude_ft",
                        "height",
                    ],

                    "load": [
                        "engine_load",
                    ],

                    "throttle": [
                        "throttle_percent",
                    ],
                }

                for alias in aliases.get(
                    parameter_name,
                    [],
                ):

                    if alias in reading:

                        value = safe_float(
                            reading.get(
                                alias
                            )
                        )

                        if value is not None:

                            value_source = (
                                "READING_ALIAS"
                            )

                            break

                if value is None:

                    for alias in aliases.get(
                        parameter_name,
                        [],
                    ):

                        if alias in context:

                            value = safe_float(
                                context.get(
                                    alias
                                )
                            )

                            if value is not None:

                                value_source = (
                                    "CONTEXT_ALIAS"
                                )

                                break

            if value is None:

                unavailable_range_parameters.append(
                    parameter_name
                )

                range_details[
                    parameter_name
                ] = {

                    "value": None,

                    "minimum": minimum,

                    "maximum": maximum,

                    "unit": unit,

                    "status": "UNKNOWN",

                    "source": (
                        value_source
                        or "UNAVAILABLE"
                    ),

                }

                continue

            if (
                minimum is not None
                and value < minimum
            ):

                out_of_range_parameters.append(
                    parameter_name
                )

                range_status = (
                    "BELOW_MODEL_RANGE"
                )

            elif (
                maximum is not None
                and value > maximum
            ):

                out_of_range_parameters.append(
                    parameter_name
                )

                range_status = (
                    "ABOVE_MODEL_RANGE"
                )

            else:

                in_range_parameters.append(
                    parameter_name
                )

                range_status = (
                    "WITHIN_MODEL_RANGE"
                )

            range_details[
                parameter_name
            ] = {

                "value": round(
                    value,
                    3,
                ),

                "minimum": minimum,

                "maximum": maximum,

                "unit": unit,

                "status": range_status,

                "source": (
                    value_source
                    or "UNKNOWN"
                ),

            }

        # --------------------------------------------------------
        # PREDICTION INTERVAL EXTRACTION
        # --------------------------------------------------------
        #
        # Do not invent an uncertainty interval.
        #
        # If an existing model already returns one, expose it.
        # Otherwise explicitly mark it unavailable.
        # --------------------------------------------------------

        prediction_interval = None

        prediction_interval_source = (
            "UNAVAILABLE"
        )

        prediction_interval_candidates = [

            "prediction_interval",

            "confidence_interval",

            "rul_prediction_interval",

            "uncertainty_interval",

            "prediction_bounds",
        ]

        for key in prediction_interval_candidates:

            if key in ai_result:

                value = ai_result.get(
                    key
                )

                if value is not None:

                    prediction_interval = value

                    prediction_interval_source = (
                        f"AI_RESULT.{key}"
                    )

                    break

        # --------------------------------------------------------
        # SEARCH NESTED AI RESULTS
        # --------------------------------------------------------

        if prediction_interval is None:

            nested_candidates = [

                "rul",

                "rul_prediction",

                "prediction",

                "uncertainty",

                "model_prediction",
            ]

            for parent_key in nested_candidates:

                nested = ai_result.get(
                    parent_key
                )

                if not isinstance(
                    nested,
                    dict,
                ):

                    continue

                for key in prediction_interval_candidates:

                    if key in nested:

                        value = nested.get(
                            key
                        )

                        if value is not None:

                            prediction_interval = (
                                value
                            )

                            prediction_interval_source = (
                                f"AI_RESULT."
                                f"{parent_key}."
                                f"{key}"
                            )

                            break

                if prediction_interval is not None:
                    break

        # --------------------------------------------------------
        # TEMPORAL PREDICTION INTERVAL
        # --------------------------------------------------------

        if prediction_interval is None:

            temporal_candidates = [

                "prediction_interval",

                "confidence_interval",

                "future_prediction_interval",

                "uncertainty_interval",
            ]

            for key in temporal_candidates:

                if key in temporal_result:

                    value = temporal_result.get(
                        key
                    )

                    if value is not None:

                        prediction_interval = (
                            value
                        )

                        prediction_interval_source = (
                            f"TEMPORAL_RESULT.{key}"
                        )

                        break

        # --------------------------------------------------------
        # PREDICTION CONFIDENCE
        # --------------------------------------------------------

        prediction_confidence = None

        confidence_keys = [

            "prediction_confidence",

            "confidence",

            "confidence_percent",

            "model_confidence",

            "rul_confidence",
        ]

        for key in confidence_keys:

            if key in ai_result:

                value = safe_float(
                    ai_result.get(
                        key
                    )
                )

                if value is not None:

                    prediction_confidence = value
                    break

        if prediction_confidence is None:

            for key in confidence_keys:

                if key in temporal_result:

                    value = safe_float(
                        temporal_result.get(
                            key
                        )
                    )

                    if value is not None:

                        prediction_confidence = value
                        break

        # --------------------------------------------------------
        # FUTURE PROJECTION CONFIDENCE
        # --------------------------------------------------------

        future_projection_confidence = (
            safe_float(
                temporal_result.get(
                    "future_projection_confidence",
                    None,
                )
            )
        )

        # --------------------------------------------------------
        # DATA RELIABILITY EVIDENCE
        # --------------------------------------------------------

        blocking_reasons = []

        warnings = []

        if not model_available:

            blocking_reasons.append(
                "AI model status is unavailable or invalid."
            )

        if freshness_status in {
            "STALE",
            "TIMESTAMP_MISSING",
            "FUTURE_TIMESTAMP",
        }:

            blocking_reasons.append(
                f"Telemetry freshness is {freshness_status.lower()}."
            )

        if quality_invalid:

            blocking_reasons.append(
                "Telemetry quality is marked invalid or unreliable."
            )

        # --------------------------------------------------------
        # HARDWARE DATA CHECK
        # --------------------------------------------------------

        if hardware_source == "HARDWARE":

            if len(
                available_hardware_fields
            ) == 0:

                blocking_reasons.append(
                    "No reliable hardware telemetry fields "
                    "are currently available."
                )

            elif len(
                missing_hardware_fields
            ) >= len(
                self.minimum_reliable_hardware_fields
            ) - 1:

                warnings.append(
                    "Most expected hardware telemetry fields "
                    "are missing."
                )

        # --------------------------------------------------------
        # MODEL RANGE CHECK
        # --------------------------------------------------------

        if out_of_range_parameters:

            blocking_reasons.append(
                "One or more operating parameters are "
                "outside the configured model-validity range."
            )

        if unavailable_range_parameters:

            warnings.append(
                "Some model-validity parameters are unavailable."
            )

        # --------------------------------------------------------
        # PREDICTION INTERVAL WARNING
        # --------------------------------------------------------

        if prediction_interval is None:

            warnings.append(
                "No explicit prediction interval is available "
                "from the current prediction pipeline."
            )

        # --------------------------------------------------------
        # FUTURE CONFIDENCE WARNING
        # --------------------------------------------------------

        if (
            future_projection_confidence is not None
            and future_projection_confidence < 50.0
        ):

            warnings.append(
                "Future engine-state projection confidence "
                "is low."
            )

        # --------------------------------------------------------
        # MODEL VALIDITY STATE
        # --------------------------------------------------------

        if blocking_reasons:

            overall_status = (
                "INVALID"
            )

            display_label = (
                "Unknown — insufficient reliable data"
            )

            recommendation_allowed = False

            recommendation_gate = (
                "BLOCKED"
            )

        elif (
            len(warnings) > 0
            or prediction_interval is None
        ):

            overall_status = (
                "VALID_WITH_UNCERTAINTY"
            )

            display_label = (
                "Model Valid — Uncertainty Present"
            )

            recommendation_allowed = True

            recommendation_gate = (
                "CAUTION"
            )

        else:

            overall_status = (
                "VALID"
            )

            display_label = (
                "Model Valid"
            )

            recommendation_allowed = True

            recommendation_gate = (
                "CLEAR"
            )

        # --------------------------------------------------------
        # TELEMETRY STATUS
        # --------------------------------------------------------

        if freshness_status == "FRESH":

            telemetry_status = (
                "FRESH"
            )

            telemetry_display_label = (
                "Telemetry Fresh"
            )

        elif freshness_status == "STALE":

            telemetry_status = (
                "STALE"
            )

            telemetry_display_label = (
                "Telemetry Stale"
            )

        elif freshness_status == "TIMESTAMP_MISSING":

            telemetry_status = (
                "UNKNOWN"
            )

            telemetry_display_label = (
                "Telemetry Timestamp Missing"
            )

        elif freshness_status == "FUTURE_TIMESTAMP":

            telemetry_status = (
                "INVALID"
            )

            telemetry_display_label = (
                "Telemetry Timestamp Invalid"
            )

        else:

            telemetry_status = (
                "UNKNOWN"
            )

            telemetry_display_label = (
                "Telemetry Status Unknown"
            )

        # --------------------------------------------------------
        # OUT-OF-RANGE WARNING
        # --------------------------------------------------------

        if out_of_range_parameters:

            out_of_range_warning = (
                "YES"
            )

            out_of_range_display = (
                "Model operating range exceeded"
            )

        else:

            out_of_range_warning = (
                "NO"
            )

            out_of_range_display = (
                "No configured model-range violation"
            )

        # --------------------------------------------------------
        # PREDICTION INTERVAL DISPLAY
        # --------------------------------------------------------

        if prediction_interval is None:

            prediction_interval_display = (
                "Unavailable"
            )

        else:

            prediction_interval_display = (
                prediction_interval
            )

        # --------------------------------------------------------
        # DATA COMPLETENESS
        # --------------------------------------------------------

        expected_range_parameters = (
            len(
                self.model_validity_ranges
            )
        )

        available_range_parameters = (
            len(
                in_range_parameters
            )
            + len(
                out_of_range_parameters
            )
        )

        if expected_range_parameters > 0:

            data_completeness_percent = (
                available_range_parameters
                / expected_range_parameters
                * 100.0
            )

        else:

            data_completeness_percent = 0.0

        # --------------------------------------------------------
        # EVIDENCE SUMMARY
        # --------------------------------------------------------

        evidence = []

        evidence.append(
            f"Model status: "
            f"{'available' if model_available else 'unavailable'}."
        )

        evidence.append(
            f"Telemetry status: "
            f"{telemetry_status}."
        )

        if out_of_range_parameters:

            evidence.append(
                "Out-of-range parameters: "
                + ", ".join(
                    out_of_range_parameters
                )
                + "."
            )

        if prediction_interval is not None:

            evidence.append(
                "An explicit prediction interval "
                "is available from the prediction pipeline."
            )

        else:

            evidence.append(
                "An explicit prediction interval is "
                "not currently available."
            )

        if blocking_reasons:

            evidence.extend(
                blocking_reasons
            )

        # --------------------------------------------------------
        # FINAL SAFETY/VALIDITY REASON
        # --------------------------------------------------------

        if not recommendation_allowed:

            reason = (
                "The model-validity gate has blocked "
                "downstream recommendations because "
                "the current telemetry/model evidence "
                "is not sufficiently reliable."
            )

        elif overall_status == "VALID_WITH_UNCERTAINTY":

            reason = (
                "The current model can process the data, "
                "but uncertainty or incomplete evidence "
                "should be shown before using downstream "
                "mission recommendations."
            )

        else:

            reason = (
                "The current telemetry is fresh and "
                "within the configured model-validity "
                "region."
            )

        # --------------------------------------------------------
        # RETURN FEATURE 18
        # --------------------------------------------------------

        return {

            "overall_status": (
                overall_status
            ),

            "display_label": (
                display_label
            ),

            "recommendation_allowed": (
                recommendation_allowed
            ),

            "recommendation_gate": (
                recommendation_gate
            ),

            # ----------------------------------------------------
            # MODEL VALIDITY
            # ----------------------------------------------------

            "model_validity": {

                "status": (
                    "VALID"
                    if model_available
                    else "INVALID"
                ),

                "available": (
                    model_available
                ),

                "model_status": (
                    current_model_status
                ),

                "display_label": (
                    "Model Available"
                    if model_available
                    else "Model Unavailable"
                ),
            },

            # ----------------------------------------------------
            # TELEMETRY
            # ----------------------------------------------------

            "telemetry": {

                "status": (
                    telemetry_status
                ),

                "display_label": (
                    telemetry_display_label
                ),

                "source": (
                    hardware_source
                ),

                "data_status": (
                    telemetry_data_status
                ),

                "timestamp": (
                    telemetry_timestamp
                ),

                "age_seconds": (
                    round(
                        telemetry_age_seconds,
                        3,
                    )
                    if telemetry_age_seconds is not None
                    else None
                ),

                "max_allowed_age_seconds": (
                    self.telemetry_max_age_seconds
                ),

                "quality_status": (
                    quality_status
                ),

                "quality_invalid": (
                    quality_invalid
                ),
            },

            # ----------------------------------------------------
            # DATA AVAILABILITY
            # ----------------------------------------------------

            "data_availability": {

                "available_hardware_fields": (
                    available_hardware_fields
                ),

                "missing_hardware_fields": (
                    missing_hardware_fields
                ),

                "data_completeness_percent": round(
                    data_completeness_percent,
                    2,
                ),
            },

            # ----------------------------------------------------
            # MODEL RANGE
            # ----------------------------------------------------

            "model_range_check": {

                "status": (
                    "OUT_OF_RANGE"
                    if out_of_range_parameters
                    else "WITHIN_RANGE"
                ),

                "out_of_range_warning": (
                    out_of_range_warning
                ),

                "out_of_range_display": (
                    out_of_range_display
                ),

                "out_of_range_parameters": (
                    out_of_range_parameters
                ),

                "in_range_parameters": (
                    in_range_parameters
                ),

                "unavailable_parameters": (
                    unavailable_range_parameters
                ),

                "parameters": (
                    range_details
                ),

                "ranges_basis": (
                    "PROTOTYPE_MODEL_VALIDITY_RANGES"
                ),

                "certification_status": (
                    "NOT_CERTIFIED_OPERATING_LIMITS"
                ),
            },

            # ----------------------------------------------------
            # PREDICTION INTERVAL
            # ----------------------------------------------------

            "prediction_uncertainty": {

                "prediction_interval": (
                    prediction_interval
                ),

                "display_value": (
                    prediction_interval_display
                ),

                "available": (
                    prediction_interval is not None
                ),

                "source": (
                    prediction_interval_source
                ),

                "prediction_confidence": (
                    prediction_confidence
                ),

                "future_projection_confidence": (
                    future_projection_confidence
                ),

                "uncertainty_status": (
                    "AVAILABLE"
                    if prediction_interval is not None
                    else "UNAVAILABLE"
                ),
            },

            # ----------------------------------------------------
            # OPERATING LIMIT CROSS-CHECK
            # ----------------------------------------------------

            "operating_limit_status": (
                operating_limits.get(
                    "overall_status",
                    "UNKNOWN",
                )
            ),

            # ----------------------------------------------------
            # REASONS
            # ----------------------------------------------------

            "blocking_reasons": (
                blocking_reasons
            ),

            "warnings": (
                warnings
            ),

            "evidence": (
                evidence
            ),

            "reason": (
                reason
            ),

            # ----------------------------------------------------
            # IMPORTANT DISCLAIMER
            # ----------------------------------------------------

            "disclaimer": (
                "Model-validity ranges are prototype/model "
                "ranges and are not certified aircraft-engine "
                "operating limits. This gate is intended to "
                "prevent unsupported optimistic recommendations "
                "when data is stale, missing, uncertain or "
                "outside the model-validity region."
            ),

            # ----------------------------------------------------
            # PROVENANCE
            # ----------------------------------------------------

            "provenance": {

                "gate": (
                    "UNCERTAINTY_AND_MODEL_VALIDITY_ANALYSIS"
                ),

                "model_validity": (
                    "MODEL_STATUS"
                ),

                "telemetry": (
                    "TELEMETRY_TIMESTAMP_AND_QUALITY"
                ),

                "range_check": (
                    "CONFIGURED_MODEL_VALIDITY_RANGES"
                ),

                "prediction_uncertainty": (
                    prediction_interval_source
                ),
            },
        }

    # ============================================================
    # MAIN PROCESSING PIPELINE
    # ============================================================

    def process(
        self,
        telemetry: Dict[str, Any],
    ) -> Dict[str, Any]:

        # --------------------------------------------------------
        # 1. EXTRACT READING
        # --------------------------------------------------------

        if not isinstance(
            telemetry,
            dict,
        ):

            telemetry = {}

        reading = telemetry.get(
            "reading",
            telemetry,
        )

        if not isinstance(
            reading,
            dict,
        ):

            reading = {}

        context = telemetry.get(
            "context",
            {},
        )

        if not isinstance(
            context,
            dict,
        ):

            context = {}

        # --------------------------------------------------------
        # 2. NORMALIZE SENSOR NAMES
        # --------------------------------------------------------

        reading = self._normalize_sensor_names(
            reading
        )

        # --------------------------------------------------------
        # 3. OPERATING CONTEXT
        # --------------------------------------------------------

        load = reading.get(
            "load",
            context.get(
                "load",
                60.0,
            ),
        )

        altitude = reading.get(
            "altitude",
            context.get(
                "altitude",
                5000.0,
            ),
        )

        ambient_temp = reading.get(
            "ambient_temp",
            context.get(
                "ambient_temp",
                30.0,
            ),
        )

        throttle = reading.get(
            "throttle",
            context.get(
                "throttle",
                65.0,
            ),
        )

        airspeed = reading.get(
            "airspeed",
            context.get(
                "airspeed",
                35.0,
            ),
        )

        context = {
            **context,

            "load": load,

            "altitude": altitude,

            "ambient_temp": ambient_temp,

            "throttle": throttle,

            "airspeed": airspeed,
        }

        # --------------------------------------------------------
        # 4. DIGITAL TWIN
        # --------------------------------------------------------

        twin_input = {
            **reading,
            **context,
        }

        twin_result = self.twin.update(
            twin_input
        )

        if not isinstance(
            twin_result,
            dict,
        ):

            twin_result = {}

        current_state = twin_result.get(
            "current_state",
            {},
        )

        expected_state = twin_result.get(
            "expected_state",
            {},
        )

        raw_residuals = twin_result.get(
            "residuals",
            {},
        )

        health_score = twin_result.get(
            "health_score",
            0.0,
        )

        physics = twin_result.get(
            "physics",
            {},
        )

        # --------------------------------------------------------
        # 5. NORMALIZE DIGITAL-TWIN RESIDUALS
        # --------------------------------------------------------

        normalized_residuals = (
            self._normalize_residuals(
                raw_residuals
            )
        )

        residuals = {
            **raw_residuals,
            **normalized_residuals,
        }

        # --------------------------------------------------------
        # 6. PREPARE AI MODEL INPUT
        # --------------------------------------------------------

        ai_input = {
            **reading,
            **context,
            **normalized_residuals,
        }

        # --------------------------------------------------------
        # 7. ENGINEERING RULE CHECK
        # --------------------------------------------------------

        engineering_faults = engineering_check(
            ai_input,
            context,
        )

        # --------------------------------------------------------
        # 8. EXISTING AI PIPELINE
        # --------------------------------------------------------

        ai_result = predict_engine(
            ai_input,
            engineering_faults=engineering_faults,
        )

        if not isinstance(
            ai_result,
            dict,
        ):

            ai_result = {

                "success": False,

                "error": (
                    "AI prediction returned "
                    "invalid result"
                ),
            }

        # --------------------------------------------------------
        # 9. SENSOR–ENGINE FAULT SEPARATION
        # --------------------------------------------------------

        source = telemetry.get(
            "source",
            "SIMULATED",
        )

        sensor_engine_fault = (
            self._analyze_sensor_engine_fault(

                current_state=current_state,

                expected_state=expected_state,

                raw_residuals=raw_residuals,

                normalized_residuals=normalized_residuals,

                context=context,

                source=source,
            )
        )

        # --------------------------------------------------------
        # 10. CROSS-SENSOR PHYSICAL CONSISTENCY
        # --------------------------------------------------------

        cross_sensor_consistency = (
            self._analyze_cross_sensor_consistency(

                current_state=current_state,

                context=context,

                normalized_residuals=normalized_residuals,
            )
        )

        # --------------------------------------------------------
        # 11. UNKNOWN-STATE EVIDENCE GATE
        # --------------------------------------------------------

        final_fault_state = (
            self._determine_final_fault_state(

                sensor_engine_fault=(
                    sensor_engine_fault
                ),

                cross_sensor_consistency=(
                    cross_sensor_consistency
                ),

                ai_result=ai_result,

                engineering_faults=(
                    engineering_faults
                ),

                health_score=health_score,
            )
        )

        # --------------------------------------------------------
        # 12. TIMESTAMP
        # --------------------------------------------------------

        timestamp = self._normalize_timestamp(
            telemetry.get(
                "timestamp",
                time.time(),
            )
        )

        # --------------------------------------------------------
        # 13. TEMPORAL ENGINE INPUT
        # --------------------------------------------------------

        temporal_reading = {
            **reading,
            **context,
        }

        temporal_result = self.temporal.update(
            timestamp,
            temporal_reading,
            normalized_residuals,
        )

        if not isinstance(
            temporal_result,
            dict,
        ):

            temporal_result = {}

        # --------------------------------------------------------
        # 14. FUTURE ENGINE STATE
        # --------------------------------------------------------

        future_engine_state = (
            temporal_result.get(
                "future_engine_state",
                {},
            )
        )

        # --------------------------------------------------------
        # 15. TEMPORAL VALUES
        # --------------------------------------------------------

        trajectory = temporal_result.get(
            "trajectory",
            "UNKNOWN",
        )

        degradation_score = (
            temporal_result.get(
                "degradation_score",
                None,
            )
        )

        degradation_delta = (
            temporal_result.get(
                "degradation_delta",
                None,
            )
        )

        future_confidence = (
            temporal_result.get(
                "future_projection_confidence",
                0.0,
            )
        )

        # --------------------------------------------------------
        # 15A. DEGRADATION SEVERITY TRACKING
        # --------------------------------------------------------

        degradation_severity = (
            self._update_degradation_severity(

                degradation_score=(
                    degradation_score
                ),

                degradation_delta=(
                    degradation_delta
                ),

                trajectory=trajectory,

                timestamp=timestamp,
            )
        )

        # --------------------------------------------------------
        # 15B. OPERATING-LIMIT ANALYSIS
        # --------------------------------------------------------

        operating_limits = (
            self._calculate_operating_limits(

                reading=reading,

                context=context,

                current_state=current_state,

                source=source,
            )
        )

        # --------------------------------------------------------
        # 15C. FEATURE 16
        # ESTIMATED OPERATING WINDOW
        # --------------------------------------------------------

        mission_remaining_minutes = (
            self._extract_mission_remaining_minutes(

                reading=reading,

                context=context,
            )
        )

        trend_rate_per_hour = (
            degradation_severity.get(
                "trend_rate_per_hour",
                None,
            )
        )

        degradation_history_available = (
            degradation_severity.get(
                "history_available",
                False,
            )
        )

        estimated_operating_window = (
            self._calculate_estimated_operating_window(

                degradation_score=(
                    degradation_score
                ),

                trend_rate_per_hour=(
                    trend_rate_per_hour
                ),

                trajectory=trajectory,

                mission_remaining_minutes=(
                    mission_remaining_minutes
                ),

                degradation_history_available=(
                    degradation_history_available
                ),
            )
        )

        # --------------------------------------------------------
        # 15D. FEATURE 18
        # UNCERTAINTY AND MODEL-VALIDITY GATE
        # --------------------------------------------------------
        #
        # This MUST happen after the AI, temporal and operating
        # analyses because the gate needs their outputs.
        #
        # Most importantly:
        #
        #     recommendation_allowed
        #
        # becomes False when telemetry/model validity is
        # insufficient.
        # --------------------------------------------------------

        uncertainty_model_validity = (
            self._calculate_model_validity_gate(

                telemetry=telemetry,

                reading=reading,

                context=context,

                ai_result=ai_result,

                temporal_result=temporal_result,

                operating_limits=operating_limits,

                timestamp=timestamp,
            )
        )

        # --------------------------------------------------------
        # 16. FINAL RESULT
        # --------------------------------------------------------

        return {

            # ====================================================
            # TIME
            # ====================================================

            "timestamp": timestamp,

            # ====================================================
            # DIGITAL TWIN
            # ====================================================

            "current_state": current_state,

            "expected_state": expected_state,

            "residuals": residuals,

            "normalized_residuals": (
                normalized_residuals
            ),

            "health_score": health_score,

            "physics": physics,

            # ====================================================
            # AI
            # ====================================================

            "ai_prediction": ai_result,

            # ====================================================
            # SENSOR–ENGINE FAULT SEPARATION
            # ====================================================

            "sensor_engine_fault": (
                sensor_engine_fault
            ),

            # ====================================================
            # CROSS-SENSOR PHYSICAL CONSISTENCY
            # ====================================================

            "cross_sensor_consistency": (
                cross_sensor_consistency
            ),

            # ====================================================
            # FINAL FAULT STATE
            # ====================================================

            "final_fault_state": (
                final_fault_state
            ),

            # ====================================================
            # TEMPORAL
            # ====================================================

            "temporal_analysis": (
                temporal_result
            ),

            "trajectory": trajectory,

            "degradation_score": (
                degradation_score
            ),

            "degradation_delta": (
                degradation_delta
            ),

            # ====================================================
            # DEGRADATION SEVERITY TRACKING
            # ====================================================

            "degradation_severity": (
                degradation_severity
            ),

            # ====================================================
            # OPERATING-LIMIT PANEL
            # ====================================================

            "operating_limits": (
                operating_limits
            ),

            # ====================================================
            # FEATURE 16
            # ESTIMATED OPERATING WINDOW
            # ====================================================

            "estimated_operating_window": (
                estimated_operating_window
            ),

            # ====================================================
            # FEATURE 18
            # UNCERTAINTY AND MODEL-VALIDITY GATE
            # ====================================================

            "uncertainty_model_validity": (
                uncertainty_model_validity
            ),

            # ====================================================
            # FUTURE ENGINE STATE
            # ====================================================

            "future_engine_state": (
                future_engine_state
            ),

            # Backward-compatible alias

            "future_state": (
                future_engine_state
            ),

            "future_projection_confidence": (
                future_confidence
            ),

            # ====================================================
            # ENGINEERING
            # ====================================================

            "engineering_faults": (
                engineering_faults
            ),

            "engineering_violations": (
                engineering_faults
            ),

            # ====================================================
            # DATA SOURCE
            # ====================================================

            "source": source,

            "quality": telemetry.get(
                "quality",
                {},
            ),

            "context": context,

            # ====================================================
            # MODEL STATUS
            # ====================================================

            "model_status": model_status(),

            # ====================================================
            # PIPELINE DESCRIPTION
            # ====================================================

            "pipeline": [

                "Telemetry",

                "Digital Twin",

                "Residual Generation",

                "Isolation Forest Anomaly Detection",

                "Random Forest Fault Classification",

                "Random Forest RUL Prediction",

                "Sensor–Engine Fault Separation",

                "Cross-Sensor Physical Consistency",

                "Unknown-State Evidence Gate",

                "Temporal Degradation Analysis",

                "Degradation Severity Tracking",

                "Operating-Limit Analysis",

                "Estimated Operating Window",

                "Uncertainty and Model-Validity Gate",

                "Future Engine State Projection",
            ],
        }