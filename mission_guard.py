
# mission_guard.py

import json
import math
import os
import time
from copy import deepcopy
from typing import Any, Dict, List, Optional

from digital_twin import EngineDigitalTwin


class MissionGuard:
    """
    MissionGuard
    ------------

    Converts current/future engine condition into mission-level
    feasibility, engine capability and operational recommendation.

    Recommendation states:
        1. CONTINUE
        2. CONTINUE_WITH_REDUCED_LOAD
        3. SHORTEN_MISSION_RETURN
        4. PRE_MISSION_INSPECTION
        5. UNKNOWN

    Important:
        Engine capability values generated here are prototype/model-derived
        estimates. They are NOT certified aircraft-engine operating limits.
    """

    # =========================================================
    # ENGINE SAFETY LIMITS
    # =========================================================

    PARAMETER_LIMITS = {
        "cht_c": {
            "warning": 165.0,
            "critical": 180.0,
            "direction": "HIGH",
            "unit": "°C",
        },
        "egt_c": {
            "warning": 780.0,
            "critical": 850.0,
            "direction": "HIGH",
            "unit": "°C",
        },
        "oil_press_bar": {
            "warning": 2.0,
            "critical": 1.5,
            "direction": "LOW",
            "unit": "bar",
        },
        "oil_temp_c": {
            "warning": 120.0,
            "critical": 130.0,
            "direction": "HIGH",
            "unit": "°C",
        },
        "vibration_g": {
            "warning": 0.30,
            "critical": 0.50,
            "direction": "HIGH",
            "unit": "g",
        },
        "battery_v": {
            "warning": 11.5,
            "critical": 10.5,
            "direction": "LOW",
            "unit": "V",
        },
    }

    # =========================================================
    # ENGINE CAPABILITY REFERENCE LIMITS
    # =========================================================
    #
    # These are PROTOTYPE REFERENCE values.
    #
    # Do not call these certified engine limits unless they are
    # replaced by validated engine/manufacturer data.
    #
    # =========================================================

    ENGINE_CAPABILITY_LIMITS = {
        "max_rpm": 6000.0,
        "max_load_percent": 100.0,
    }

    PHASES = [
        "TAKEOFF",
        "CLIMB",
        "CRUISE",
        "LOITER",
        "DESCENT",
        "RETURN",
        "LANDING",
    ]

    def __init__(
        self,
        shadow_file: str = "mission_guard_shadow.json",
    ):
        self.twin = EngineDigitalTwin()

        self.shadow_file = shadow_file

        # Stores the latest saved mission shadow.
        self.shadow: Dict[str, Any] = {}

        self.load_shadow()

    # =========================================================
    # BASIC HELPERS
    # =========================================================

    @staticmethod
    def _num(
        value: Any,
        default: float = 0.0,
    ) -> float:
        """
        Safely convert a value to float.
        """
        try:
            if value is None:
                return default

            if isinstance(value, bool):
                return float(value)

            return float(value)

        except (TypeError, ValueError):
            return default

    @staticmethod
    def _clip(
        value: float,
        minimum: float,
        maximum: float,
    ) -> float:
        return max(
            minimum,
            min(maximum, value),
        )

    # =========================================================
    # DATA SOURCE / PROVENANCE
    # =========================================================

    def _get_source(
        self,
        current_ai_result: Optional[Dict[str, Any]],
    ) -> str:
        """
        Determine the overall provenance of the current engine state.

        Returns one of:
            HARDWARE
            SIMULATED
            DIGITAL_TWIN
            MIXED
            UNKNOWN

        A source mapping/dictionary is never converted to a Python
        dictionary string. This keeps provenance readable and safe
        for dashboard/API consumers.
        """
        if not isinstance(current_ai_result, dict):
            return "UNKNOWN"

        def normalize(value: Any) -> str:
            if value is None:
                return ""

            if isinstance(value, dict):
                values = set()
                for item in value.values():
                    item_text = str(item).strip().upper()
                    if item_text in {
                        "HARDWARE",
                        "SIMULATED",
                        "DIGITAL_TWIN",
                    }:
                        values.add(item_text)

                if len(values) == 1:
                    return next(iter(values))

                if len(values) > 1:
                    return "MIXED"

                return ""

            value_text = str(value).strip().upper()

            if value_text in {
                "HARDWARE",
                "SIMULATED",
                "DIGITAL_TWIN",
                "MIXED",
            }:
                return value_text

            return ""

        source = normalize(
            current_ai_result.get("source")
        )

        if source:
            return source

        current_state = current_ai_result.get(
            "current_state",
            {},
        )

        if isinstance(current_state, dict):
            source = normalize(
                current_state.get("source")
            )

            if source:
                return source

        field_sources = current_ai_result.get(
            "field_sources",
            {},
        )

        if isinstance(field_sources, dict):
            detected = set()

            for item in field_sources.values():
                normalized = normalize(item)
                if normalized in {
                    "HARDWARE",
                    "SIMULATED",
                    "DIGITAL_TWIN",
                }:
                    detected.add(normalized)

            if len(detected) == 1:
                return next(iter(detected))

            if len(detected) > 1:
                return "MIXED"

        return "UNKNOWN"

    def _field_source(
        self,
        field: str,
        current_state: Dict[str, Any],
        current_ai_result: Optional[Dict[str, Any]],
    ) -> str:
        """
        Identify provenance of an individual parameter.

        Priority:
            1. Explicit field_sources metadata
            2. Explicit overall source
            3. Hardware-field inference when the source is MIXED
            4. SIMULATED for present non-hardware fields in a MIXED state
            5. DIGITAL_TWIN when no live value exists
        """
        field_sources = {}

        if isinstance(current_ai_result, dict):
            field_sources = current_ai_result.get(
                "field_sources",
                {},
            )

        if isinstance(field_sources, dict):
            source = field_sources.get(
                field,
                None,
            )

            if source:
                source_text = str(source).strip().upper()

                if source_text in {
                    "HARDWARE",
                    "SIMULATED",
                    "DIGITAL_TWIN",
                }:
                    return source_text

        hardware_fields = {
            "rpm",
            "vibration_g",
            "motor_temp_c",
            "temperature_c",
            "current",
            "current_a",
            "voltage",
            "battery_v",
        }

        source = self._get_source(
            current_ai_result
        )

        if source == "HARDWARE":
            return "HARDWARE"

        if source == "SIMULATED":
            return "SIMULATED"

        if source == "DIGITAL_TWIN":
            return "DIGITAL_TWIN"

        if source == "MIXED":
            if field in hardware_fields and field in current_state:
                return "HARDWARE"

            if field in current_state:
                return "SIMULATED"

            return "DIGITAL_TWIN"

        # If there is no explicit provenance and the field is a known
        # hardware prototype signal, only call it HARDWARE when it is
        # actually present in current_state.
        if field in hardware_fields and field in current_state:
            return "HARDWARE"

        return "DIGITAL_TWIN"

    def _phase_durations(
        self,
        mission: Dict[str, Any],
    ) -> Dict[str, float]:
        """
        Calculate approximate duration of each mission phase.

        Duration is in minutes.

        Important:
            The returned phase durations always sum to the requested
            mission duration. RETURN is allocated from the same
            remaining-time budget as CRUISE/LOITER, so it cannot
            accidentally make the simulated mission longer than
            the requested mission.
        """
        total_duration = self._num(
            mission.get("duration_min", 60),
            60,
        )

        total_duration = max(
            total_duration,
            5.0,
        )

        requested_loiter = self._num(
            mission.get("loiter_min", 0),
            0,
        )

        requested_loiter = max(
            requested_loiter,
            0.0,
        )

        takeoff = min(
            3.0,
            total_duration * 0.05,
        )

        climb = min(
            8.0,
            total_duration * 0.12,
        )

        descent = min(
            6.0,
            total_duration * 0.10,
        )

        landing = min(
            3.0,
            total_duration * 0.05,
        )

        fixed_duration = (
            takeoff
            + climb
            + descent
            + landing
        )

        available = max(
            total_duration - fixed_duration,
            0.0,
        )

        # Allocate RETURN from the same available budget.
        # At least one minute is reserved when time permits.
        return_duration = min(
            max(available * 0.08, 1.0),
            available,
        )

        remaining_after_return = max(
            available - return_duration,
            0.0,
        )

        loiter = min(
            requested_loiter,
            remaining_after_return,
        )

        cruise = max(
            remaining_after_return - loiter,
            0.0,
        )

        durations = {
            "TAKEOFF": takeoff,
            "CLIMB": climb,
            "CRUISE": cruise,
            "LOITER": loiter,
            "DESCENT": descent,
            "RETURN": return_duration,
            "LANDING": landing,
        }

        # Correct any floating-point residue so the total is exactly
        # the requested duration.
        phase_total = sum(durations.values())
        residue = total_duration - phase_total

        if abs(residue) > 1e-9:
            durations["CRUISE"] = max(
                durations["CRUISE"] + residue,
                0.0,
            )

        return durations

    def _phase_conditions(
        self,
        mission: Dict[str, Any],
        phase: str,
        progress: float,
    ) -> Dict[str, float]:
        """
        Generate environmental/operational conditions for
        the selected mission phase.
        """

        base_altitude = self._num(
            mission.get("altitude_ft", 8000),
            8000,
        )

        ambient_temp = self._num(
            mission.get("ambient_temp_c", 30),
            30,
        )

        load = self._num(
            mission.get("load_percent", 65),
            65,
        )

        throttle = self._num(
            mission.get("throttle_percent", 70),
            70,
        )

        altitude = base_altitude

        phase_load = load
        phase_throttle = throttle

        if phase == "TAKEOFF":
            altitude = max(
                500,
                base_altitude * 0.15,
            )

            phase_load = min(
                load + 15,
                100,
            )

            phase_throttle = min(
                throttle + 20,
                100,
            )

        elif phase == "CLIMB":
            altitude = (
                base_altitude
                * (0.35 + 0.65 * progress)
            )

            phase_load = min(
                load + 10,
                100,
            )

            phase_throttle = min(
                throttle + 10,
                100,
            )

        elif phase == "CRUISE":
            altitude = base_altitude
            phase_load = load
            phase_throttle = throttle

        elif phase == "LOITER":
            altitude = base_altitude

            phase_load = max(
                load - 10,
                20,
            )

            phase_throttle = max(
                throttle - 10,
                20,
            )

        elif phase == "DESCENT":
            altitude = base_altitude * max(
                0.25,
                1.0 - progress * 0.75,
            )

            phase_load = max(
                load - 15,
                20,
            )

            phase_throttle = max(
                throttle - 15,
                20,
            )

        elif phase == "RETURN":
            altitude = base_altitude * 0.60

            phase_load = max(
                load - 5,
                30,
            )

            phase_throttle = max(
                throttle - 5,
                30,
            )

        elif phase == "LANDING":
            altitude = 500

            phase_load = max(
                load - 25,
                15,
            )

            phase_throttle = max(
                throttle - 30,
                15,
            )

        return {
            "altitude_ft": max(
                0.0,
                altitude,
            ),
            "ambient_temp_c": ambient_temp,
            "load_percent": self._clip(
                phase_load,
                0,
                100,
            ),
            "throttle_percent": self._clip(
                phase_throttle,
                0,
                100,
            ),
        }

    # =========================================================
    # ENGINE SIMULATION
    # =========================================================

    def _simulate_engine_state(
        self,
        conditions: Dict[str, float],
        current_state: Dict[str, Any],
        degradation_score: float,
        phase: str,
        progress: float,
    ) -> Dict[str, float]:
        """
        Estimate engine condition under mission conditions.

        The digital twin provides expected engine values.
        Degradation and mission stress are then applied.
        """

        altitude = conditions["altitude_ft"]
        ambient_temp = conditions["ambient_temp_c"]
        load = conditions["load_percent"]
        throttle = conditions["throttle_percent"]

        # -----------------------------------------------------
        # Expected physics-based state.
        # -----------------------------------------------------

        try:
            expected = self.twin.expected_state(
                load=load,
                ambient_temp=ambient_temp,
                altitude=altitude,
                throttle=throttle,
            )

        except TypeError:

            try:
                expected = self.twin.expected_state(
                    {
                        "load": load,
                        "ambient_temp": ambient_temp,
                        "altitude": altitude,
                        "throttle": throttle,
                    }
                )

            except Exception:
                expected = {}

        if not isinstance(expected, dict):
            expected = {}

        # -----------------------------------------------------
        # Get values from current engine state if available.
        # Otherwise use expected values.
        # -----------------------------------------------------

        def value(
            key: str,
            fallback: float = 0.0,
        ) -> float:

            if key in current_state:
                return self._num(
                    current_state.get(key),
                    fallback,
                )

            return self._num(
                expected.get(key),
                fallback,
            )

        # -----------------------------------------------------
        # Degradation
        # -----------------------------------------------------

        degradation = self._clip(
            self._num(
                degradation_score,
                0,
            ),
            0,
            100,
        )

        degradation_factor = (
            degradation / 100.0
        )

        # -----------------------------------------------------
        # Mission stress
        # -----------------------------------------------------

        altitude_stress = self._clip(
            altitude / 12000.0,
            0,
            1.5,
        )

        temperature_stress = self._clip(
            (ambient_temp - 25.0) / 25.0,
            0,
            1.5,
        )

        load_stress = self._clip(
            (load - 60.0) / 40.0,
            0,
            1.5,
        )

        throttle_stress = self._clip(
            (throttle - 60.0) / 40.0,
            0,
            1.5,
        )

        phase_stress = 0.0

        if phase in (
            "TAKEOFF",
            "CLIMB",
        ):
            phase_stress += 0.15

        if phase == "LOITER":
            phase_stress += 0.05

        if phase == "RETURN":
            phase_stress += 0.10

        stress = (
            altitude_stress * 0.20
            + temperature_stress * 0.20
            + load_stress * 0.30
            + throttle_stress * 0.20
            + phase_stress
        )

        stress = max(
            0.0,
            stress,
        )

        # -----------------------------------------------------
        # Produce predicted mission state.
        # -----------------------------------------------------

        result = {
            "rpm": value(
                "rpm",
                self._num(
                    expected.get("rpm"),
                    0,
                ),
            ),

            "cht_c": value(
                "cht_c",
                self._num(
                    expected.get("cht_c"),
                    150,
                ),
            ),

            "egt_c": value(
                "egt_c",
                self._num(
                    expected.get("egt_c"),
                    700,
                ),
            ),

            "oil_press_bar": value(
                "oil_press_bar",
                self._num(
                    expected.get(
                        "oil_press_bar"
                    ),
                    2.5,
                ),
            ),

            "oil_temp_c": value(
                "oil_temp_c",
                self._num(
                    expected.get(
                        "oil_temp_c"
                    ),
                    95,
                ),
            ),

            "vibration_g": value(
                "vibration_g",
                self._num(
                    expected.get(
                        "vibration_g"
                    ),
                    0.15,
                ),
            ),

            "battery_v": value(
                "battery_v",
                self._num(
                    expected.get(
                        "battery_v"
                    ),
                    12.2,
                ),
            ),

            "fuel_flow": value(
                "fuel_flow",
                self._num(
                    expected.get(
                        "fuel_flow"
                    ),
                    1.0,
                ),
            ),
        }

        # -----------------------------------------------------
        # Apply degradation.
        # -----------------------------------------------------

        result["cht_c"] += (
            degradation_factor * 18.0
            + stress * 8.0
        )

        result["egt_c"] += (
            degradation_factor * 70.0
            + stress * 30.0
        )

        result["oil_press_bar"] -= (
            degradation_factor * 0.80
            + stress * 0.30
        )

        result["oil_temp_c"] += (
            degradation_factor * 15.0
            + stress * 8.0
        )

        result["vibration_g"] += (
            degradation_factor * 0.18
            + stress * 0.10
        )

        result["battery_v"] -= (
            degradation_factor * 0.70
            + stress * 0.20
        )

        result["fuel_flow"] *= (
            1.0
            + degradation_factor * 0.15
            + stress * 0.05
        )

        # -----------------------------------------------------
        # Never allow physically impossible negative values.
        # -----------------------------------------------------

        result["oil_press_bar"] = max(
            result["oil_press_bar"],
            0.0,
        )

        result["battery_v"] = max(
            result["battery_v"],
            0.0,
        )

        result["vibration_g"] = max(
            result["vibration_g"],
            0.0,
        )

        return result

    # =========================================================
    # PARAMETER ASSESSMENT
    # =========================================================

    def _assess_parameter(
        self,
        parameter: str,
        value: float,
    ) -> Dict[str, Any]:
        """
        Determine whether a parameter is normal,
        warning or critical.
        """

        limits = self.PARAMETER_LIMITS.get(
            parameter
        )

        if not limits:
            return {
                "parameter": parameter,
                "value": value,
                "warning": False,
                "critical": False,
                "margin": 0.0,
            }

        warning_limit = limits["warning"]
        critical_limit = limits["critical"]
        direction = limits["direction"]

        if direction == "HIGH":

            warning = (
                value >= warning_limit
            )

            critical = (
                value >= critical_limit
            )

            margin = (
                critical_limit - value
            )

        else:

            warning = (
                value <= warning_limit
            )

            critical = (
                value <= critical_limit
            )

            margin = (
                value - critical_limit
            )

        return {
            "parameter": parameter,
            "value": round(
                value,
                3,
            ),
            "warning_limit": warning_limit,
            "critical_limit": critical_limit,
            "direction": direction,
            "unit": limits["unit"],
            "warning": warning,
            "critical": critical,
            "margin": round(
                margin,
                3,
            ),
        }

    # =========================================================
    # AI RESULT EXTRACTION
    # =========================================================

    def _extract_current_state(
        self,
        current_ai_result: Optional[
            Dict[str, Any]
        ],
    ) -> Dict[str, Any]:

        if not isinstance(
            current_ai_result,
            dict,
        ):
            return {}

        current_state = (
            current_ai_result.get(
                "current_state",
                {},
            )
        )

        if not isinstance(
            current_state,
            dict,
        ):
            return {}

        return current_state

    def _extract_degradation(
        self,
        current_ai_result: Optional[
            Dict[str, Any]
        ],
    ) -> float:
        """
        Supports both:

            result["degradation_score"]

        and:

            result["temporal_analysis"]["degradation_score"]
        """

        if not isinstance(
            current_ai_result,
            dict,
        ):
            return 0.0

        value = current_ai_result.get(
            "degradation_score",
            None,
        )

        if value is not None:
            return self._clip(
                self._num(
                    value,
                    0,
                ),
                0,
                100,
            )

        temporal = (
            current_ai_result.get(
                "temporal_analysis",
                {},
            )
        )

        if isinstance(
            temporal,
            dict,
        ):

            value = temporal.get(
                "degradation_score",
                0,
            )

            return self._clip(
                self._num(
                    value,
                    0,
                ),
                0,
                100,
            )

        return 0.0

    def _extract_trajectory(
        self,
        current_ai_result: Optional[
            Dict[str, Any]
        ],
    ) -> str:

        if not isinstance(
            current_ai_result,
            dict,
        ):
            return "UNKNOWN"

        trajectory = (
            current_ai_result.get(
                "trajectory",
                None,
            )
        )

        if trajectory:
            return str(
                trajectory
            )

        temporal = (
            current_ai_result.get(
                "temporal_analysis",
                {},
            )
        )

        if isinstance(
            temporal,
            dict,
        ):

            trajectory = (
                temporal.get(
                    "trajectory",
                    "UNKNOWN",
                )
            )

            return str(
                trajectory
            )

        return "UNKNOWN"

    def _extract_health_score(
        self,
        current_ai_result: Optional[
            Dict[str, Any]
        ],
    ) -> float:

        if not isinstance(
            current_ai_result,
            dict,
        ):
            return 0.0

        return self._clip(
            self._num(
                current_ai_result.get(
                    "health_score",
                    0,
                ),
                0,
            ),
            0,
            100,
        )

    # =========================================================
    # MISSION RECOMMENDATION
    # =========================================================

    def _generate_mission_recommendation(
        self,
        mission: Dict[str, Any],
        current_ai_result: Optional[
            Dict[str, Any]
        ],
        mission_margin: float,
        critical_parameters: List[
            Dict[str, Any]
        ],
        earliest_problem: Optional[
            Dict[str, Any]
        ],
        most_stressful_phase: Optional[str],
    ) -> Dict[str, Any]:

        # -----------------------------------------------------
        # UNKNOWN CHECK
        # -----------------------------------------------------

        if not isinstance(
            current_ai_result,
            dict,
        ):

            return {
                "code": "UNKNOWN",
                "label": "Unknown",
                "severity": "UNKNOWN",
                "reason": (
                    "Current engine AI result "
                    "is not available."
                ),
                "evidence": [
                    "No valid current engine analysis was received."
                ],
                "action": (
                    "Do not make an automated mission decision. "
                    "Collect valid telemetry and rerun the analysis."
                ),
            }

        current_state = (
            self._extract_current_state(
                current_ai_result
            )
        )

        if not current_state:

            return {
                "code": "UNKNOWN",
                "label": "Unknown",
                "severity": "UNKNOWN",
                "reason": (
                    "Current engine telemetry "
                    "is unavailable."
                ),
                "evidence": [
                    "The current_state object is empty or missing."
                ],
                "action": (
                    "Collect valid engine telemetry before "
                    "making a mission decision."
                ),
            }

        # -----------------------------------------------------
        # AI MODEL STATUS
        # -----------------------------------------------------

        model_status = (
            current_ai_result.get(
                "model_status",
                {},
            )
        )

        if isinstance(
            model_status,
            dict,
        ):

            load_error = (
                model_status.get(
                    "load_error",
                    None,
                )
            )

            loaded = (
                model_status.get(
                    "loaded",
                    None,
                )
            )

            if load_error:

                return {
                    "code": "UNKNOWN",
                    "label": "Unknown",
                    "severity": "UNKNOWN",
                    "reason": (
                        "AI model reliability "
                        "could not be confirmed."
                    ),
                    "evidence": [
                        f"Model error: {load_error}"
                    ],
                    "action": (
                        "Verify the AI models and rerun "
                        "engine analysis before the mission."
                    ),
                }

            if loaded is False:

                return {
                    "code": "UNKNOWN",
                    "label": "Unknown",
                    "severity": "UNKNOWN",
                    "reason": (
                        "Required AI model is not loaded."
                    ),
                    "evidence": [
                        "model_status.loaded = False"
                    ],
                    "action": (
                        "Load/verify the required AI models "
                        "before relying on MissionGuard."
                    ),
                }

        # -----------------------------------------------------
        # AI STAGE ERRORS
        # -----------------------------------------------------

        ai_prediction = (
            current_ai_result.get(
                "ai_prediction",
                {},
            )
        )

        if not isinstance(
            ai_prediction,
            dict,
        ):
            ai_prediction = {}

        stage_errors = (
            ai_prediction.get(
                "stage_errors",
                {},
            )
        )

        if (
            isinstance(
                stage_errors,
                dict,
            )
            and stage_errors
        ):

            return {
                "code": "UNKNOWN",
                "label": "Unknown",
                "severity": "UNKNOWN",
                "reason": (
                    "One or more AI analysis "
                    "stages reported errors."
                ),
                "evidence": [
                    f"{key}: {value}"
                    for key, value
                    in stage_errors.items()
                ],
                "action": (
                    "Resolve the AI analysis error and rerun "
                    "the mission simulation."
                ),
            }

        # -----------------------------------------------------
        # Extract AI information
        # -----------------------------------------------------

        degradation_score = (
            self._extract_degradation(
                current_ai_result
            )
        )

        trajectory = (
            self._extract_trajectory(
                current_ai_result
            )
        )

        health_score = (
            self._extract_health_score(
                current_ai_result
            )
        )

        predicted_fault = (
            ai_prediction.get(
                "predicted_fault",
                current_ai_result.get(
                    "predicted_fault",
                    "UNKNOWN",
                ),
            )
        )

        if predicted_fault is None:
            predicted_fault = "UNKNOWN"

        predicted_fault_text = str(
            predicted_fault
        ).strip()

        fault_confidence = self._num(
            ai_prediction.get(
                "fault_confidence",
                current_ai_result.get(
                    "fault_confidence",
                    0,
                ),
            ),
            0,
        )

        if fault_confidence > 1.0:
            fault_confidence /= 100.0

        fault_confidence = self._clip(
            fault_confidence,
            0,
            1,
        )

        normal_faults = {
            "unknown",
            "normal",
            "none",
            "no fault",
            "no_fault",
            "healthy",
        }

        is_non_normal_fault = (
            predicted_fault_text.lower()
            not in normal_faults
        )

        # -----------------------------------------------------
        # 1. CRITICAL MISSION CONDITION
        # -----------------------------------------------------

        if (
            len(critical_parameters) > 0
            or mission_margin < 0
        ):

            evidence = []

            if mission_margin < 0:
                evidence.append(
                    "Mission margin is negative "
                    f"({mission_margin:.2f})."
                )

            for item in critical_parameters[:5]:

                evidence.append(
                    f"{item['parameter']} = "
                    f"{item['value']} "
                    f"{item.get('unit', '')}"
                )

            if most_stressful_phase:
                evidence.append(
                    "Highest stress phase: "
                    f"{most_stressful_phase}"
                )

            return {
                "code": (
                    "SHORTEN_MISSION_RETURN"
                ),
                "label": (
                    "Shorten Mission / Return"
                ),
                "severity": "CRITICAL",
                "reason": (
                    "The predicted engine condition "
                    "crosses a critical limit during "
                    "the mission."
                ),
                "evidence": evidence,
                "action": (
                    "Shorten the mission, reduce mission "
                    "exposure and initiate return before "
                    "the engine reaches an unsafe condition."
                ),
            }

        # -----------------------------------------------------
        # 2. PRE-MISSION INSPECTION
        # -----------------------------------------------------

        inspection_reasons = []

        if degradation_score >= 70:

            inspection_reasons.append(
                "High degradation score: "
                f"{degradation_score:.1f}/100"
            )

        if (
            is_non_normal_fault
            and fault_confidence >= 0.75
        ):

            inspection_reasons.append(
                "Predicted fault: "
                f"{predicted_fault_text} "
                f"(confidence "
                f"{fault_confidence * 100:.1f}%)"
            )

        if (
            trajectory
            and trajectory.upper()
            in {
                "DEGRADING",
                "RAPIDLY_DEGRADING",
                "UNSTABLE",
                "WORSENING",
            }
        ):

            inspection_reasons.append(
                "Engine degradation trajectory: "
                f"{trajectory}"
            )

        if (
            health_score > 0
            and health_score < 45
        ):

            inspection_reasons.append(
                "Low engine health score: "
                f"{health_score:.1f}/100"
            )

        if inspection_reasons:

            return {
                "code": (
                    "PRE_MISSION_INSPECTION"
                ),
                "label": (
                    "Pre-Mission Inspection"
                ),
                "severity": "HIGH",
                "reason": (
                    "The engine may still be mission-capable, "
                    "but its predicted condition requires "
                    "inspection before mission execution."
                ),
                "evidence": inspection_reasons,
                "action": (
                    "Inspect the engine and relevant systems "
                    "before mission launch. Re-run MissionGuard "
                    "after inspection."
                ),
            }

        # -----------------------------------------------------
        # 3. REDUCED LOAD
        # -----------------------------------------------------

        reduced_load_reasons = []

        if mission_margin < 10:

            reduced_load_reasons.append(
                "Low mission margin: "
                f"{mission_margin:.2f}"
            )

        if earliest_problem:

            if earliest_problem.get(
                "warning",
                False,
            ):

                parameter = (
                    earliest_problem.get(
                        "parameter",
                        "parameter",
                    )
                )

                value = (
                    earliest_problem.get(
                        "value",
                        0,
                    )
                )

                unit = (
                    earliest_problem.get(
                        "unit",
                        "",
                    )
                )

                reduced_load_reasons.append(
                    "Warning-level "
                    f"{parameter}: "
                    f"{value} {unit}"
                )

        if (
            trajectory
            and trajectory.upper()
            in {
                "DEGRADING",
                "WORSENING",
            }
        ):

            reduced_load_reasons.append(
                "Degradation trajectory: "
                f"{trajectory}"
            )

        if reduced_load_reasons:

            return {
                "code": (
                    "CONTINUE_WITH_REDUCED_LOAD"
                ),
                "label": (
                    "Continue with Reduced Load"
                ),
                "severity": "CAUTION",
                "reason": (
                    "The mission is currently feasible, "
                    "but available engine margin is limited."
                ),
                "evidence": reduced_load_reasons,
                "action": (
                    "Continue only with reduced engine "
                    "load/throttle where operationally "
                    "possible and monitor engine telemetry "
                    "continuously."
                ),
            }

        # -----------------------------------------------------
        # 4. CONTINUE
        # -----------------------------------------------------

        return {
            "code": "CONTINUE",
            "label": "Continue",
            "severity": "NORMAL",
            "reason": (
                "No critical engine or mission constraint "
                "was identified in the simulated mission."
            ),
            "evidence": [
                f"Mission margin: {mission_margin:.2f}",
                f"Engine health: {health_score:.1f}/100",
                f"Degradation: {degradation_score:.1f}/100",
            ],
            "action": (
                "Continue the planned mission while "
                "monitoring live engine telemetry."
            ),
        }

    # =========================================================
    # ENGINE CAPABILITY ENVELOPE
    # =========================================================

    def _capability_margin_percent(
        self,
        parameter: str,
        value: float,
    ) -> float:
        """
        Convert a parameter's distance from its critical limit into
        a 0-100 normalized margin.

        HIGH direction:
            100 = value is near the lower/zero end of the scale
            0   = critical limit reached/exceeded

        LOW direction:
            100 = value is at/above the warning threshold
            0   = critical limit reached/exceeded

        This intentionally uses the critical limit for HIGH-direction
        parameters instead of returning 100 for every value below the
        warning threshold. That makes the dashboard margin reflect
        actual distance to the critical boundary.
        """
        limits = self.PARAMETER_LIMITS.get(
            parameter
        )

        if not limits:
            return 100.0

        warning = self._num(
            limits.get("warning"),
            0,
        )

        critical = self._num(
            limits.get("critical"),
            0,
        )

        direction = str(
            limits.get(
                "direction",
                "HIGH",
            )
        ).upper()

        if direction == "HIGH":
            if value >= critical:
                return 0.0

            if critical <= 0:
                return 0.0

            # Distance from the current value to the critical limit,
            # normalized against the full critical scale.
            margin = (
                (critical - value)
                / critical
            ) * 100.0

        else:
            if value <= critical:
                return 0.0

            span = warning - critical

            if span <= 0:
                return 0.0

            if value >= warning:
                return 100.0

            margin = (
                (value - critical)
                / span
            ) * 100.0

        return round(
            self._clip(
                margin,
                0,
                100,
            ),
            2,
        )

    def _get_capability_baseline_state(
        self,
        mission: Dict[str, Any],
        current_state: Dict[str, Any],
    ) -> Dict[str, float]:
        """
        Build the state used by the Engine Capability Envelope.

        Priority:

        1. Actual current telemetry
        2. Digital Twin expected state

        This prevents missing CHT/EGT/oil values from being
        incorrectly interpreted as zero.
        """

        base_conditions = {
            "load": self._num(
                mission.get(
                    "load_percent",
                    65,
                ),
                65,
            ),
            "ambient_temp": self._num(
                mission.get(
                    "ambient_temp_c",
                    30,
                ),
                30,
            ),
            "altitude": self._num(
                mission.get(
                    "altitude_ft",
                    8000,
                ),
                8000,
            ),
            "throttle": self._num(
                mission.get(
                    "throttle_percent",
                    70,
                ),
                70,
            ),
        }

        # -----------------------------------------------------
        # Digital Twin baseline
        # -----------------------------------------------------

        try:

            expected = self.twin.expected_state(
                load=base_conditions["load"],
                ambient_temp=(
                    base_conditions[
                        "ambient_temp"
                    ]
                ),
                altitude=(
                    base_conditions[
                        "altitude"
                    ]
                ),
                throttle=(
                    base_conditions[
                        "throttle"
                    ]
                ),
            )

        except TypeError:

            try:

                expected = self.twin.expected_state(
                    base_conditions
                )

            except Exception:
                expected = {}

        except Exception:
            expected = {}

        if not isinstance(
            expected,
            dict,
        ):
            expected = {}

        state = {}

        capability_fields = [
            "rpm",
            "cht_c",
            "egt_c",
            "oil_press_bar",
            "oil_temp_c",
            "vibration_g",
            "battery_v",
            "fuel_flow",
        ]

        # -----------------------------------------------------
        # Current telemetry has priority.
        # -----------------------------------------------------

        for field in capability_fields:

            if field in current_state:

                state[field] = self._num(
                    current_state.get(
                        field
                    ),
                    self._num(
                        expected.get(
                            field
                        ),
                        0,
                    ),
                )

            elif field in expected:

                state[field] = self._num(
                    expected.get(
                        field
                    ),
                    0,
                )

        return state

    def _build_engine_capability_envelope(
        self,
        mission: Dict[str, Any],
        current_state: Dict[str, Any],
        current_ai_result: Optional[
            Dict[str, Any]
        ],
        phase_results: List[
            Dict[str, Any]
        ],
        parameter_assessments: List[
            Dict[str, Any]
        ],
        health_score: float,
        degradation_score: float,
        trajectory: str,
        rul_hours: Optional[float],
    ) -> Dict[str, Any]:
        """
        Build the Engine Capability Envelope.

        The envelope answers:

            "What can the engine currently support?"

        It is intentionally different from:

            Engine Health
            Mission Requirement
            Mission Feasibility

        It provides interpretable operating margins.

        IMPORTANT:
            Values are prototype/model-derived and must not be
            treated as certified engine operating limits.
        """

        # -----------------------------------------------------
        # Baseline state
        # -----------------------------------------------------

        baseline = (
            self._get_capability_baseline_state(
                mission,
                current_state,
            )
        )

        source = self._get_source(
            current_ai_result
        )

        # -----------------------------------------------------
        # Current operating conditions
        # -----------------------------------------------------

        current_rpm = self._num(
            baseline.get(
                "rpm",
                0,
            ),
            0,
        )

        current_load = self._num(
            mission.get(
                "load_percent",
                65,
            ),
            65,
        )

        current_cht = self._num(
            baseline.get(
                "cht_c",
                0,
            ),
            0,
        )

        current_egt = self._num(
            baseline.get(
                "egt_c",
                0,
            ),
            0,
        )

        current_oil_temp = self._num(
            baseline.get(
                "oil_temp_c",
                0,
            ),
            0,
        )

        current_vibration = self._num(
            baseline.get(
                "vibration_g",
                0,
            ),
            0,
        )

        # -----------------------------------------------------
        # Reference limits
        # -----------------------------------------------------

        reference_max_rpm = self._num(
            self.ENGINE_CAPABILITY_LIMITS.get(
                "max_rpm",
                6000,
            ),
            6000,
        )

        maximum_load = self._num(
            self.ENGINE_CAPABILITY_LIMITS.get(
                "max_load_percent",
                100,
            ),
            100,
        )

        reference_max_rpm = max(
            reference_max_rpm,
            1,
        )

        maximum_load = self._clip(
            maximum_load,
            1,
            100,
        )

        # -----------------------------------------------------
        # Current thermal margins
        # -----------------------------------------------------

        cht_limit = self._num(
            self.PARAMETER_LIMITS[
                "cht_c"
            ]["critical"],
            180,
        )

        egt_limit = self._num(
            self.PARAMETER_LIMITS[
                "egt_c"
            ]["critical"],
            850,
        )

        oil_temp_limit = self._num(
            self.PARAMETER_LIMITS[
                "oil_temp_c"
            ]["critical"],
            130,
        )

        vibration_limit = self._num(
            self.PARAMETER_LIMITS[
                "vibration_g"
            ]["critical"],
            0.50,
        )

        cht_margin = (
            cht_limit - current_cht
        )

        egt_margin = (
            egt_limit - current_egt
        )

        oil_temp_margin = (
            oil_temp_limit
            - current_oil_temp
        )

        vibration_margin = (
            vibration_limit
            - current_vibration
        )

        # -----------------------------------------------------
        # Convert thermal margins to normalized percentages.
        # -----------------------------------------------------

        cht_margin_percent = (
            self._capability_margin_percent(
                "cht_c",
                current_cht,
            )
        )

        egt_margin_percent = (
            self._capability_margin_percent(
                "egt_c",
                current_egt,
            )
        )

        oil_temp_margin_percent = (
            self._capability_margin_percent(
                "oil_temp_c",
                current_oil_temp,
            )
        )

        thermal_margin_percent = (
            cht_margin_percent * 0.40
            + egt_margin_percent * 0.40
            + oil_temp_margin_percent * 0.20
        )

        thermal_margin_percent = round(
            self._clip(
                thermal_margin_percent,
                0,
                100,
            ),
            2,
        )

        # -----------------------------------------------------
        # Vibration margin
        # -----------------------------------------------------

        vibration_margin_percent = (
            self._capability_margin_percent(
                "vibration_g",
                current_vibration,
            )
        )

        # -----------------------------------------------------
        # RPM capability
        # -----------------------------------------------------
        #
        # This does NOT claim that the engine is certified to
        # 6000 RPM. It is a prototype reference envelope.
        # -----------------------------------------------------

        rpm_utilization = (
            current_rpm
            / reference_max_rpm
            * 100.0
        )

        rpm_margin_percent = (
            100.0
            - rpm_utilization
        )

        rpm_margin_percent = self._clip(
            rpm_margin_percent,
            0,
            100,
        )

        # -----------------------------------------------------
        # Health/degradation reserve
        # -----------------------------------------------------

        degradation_reserve = (
            100.0
            - self._clip(
                degradation_score,
                0,
                100,
            )
        )

        health_reserve = (
            self._clip(
                health_score,
                0,
                100,
            )
            if health_score > 0
            else degradation_reserve
        )

        # -----------------------------------------------------
        # Current operating condition factor
        # -----------------------------------------------------

        condition_factor = min(
            thermal_margin_percent,
            vibration_margin_percent,
            degradation_reserve,
            health_reserve,
            100.0,
        )

        condition_factor = (
            self._clip(
                condition_factor,
                0,
                100,
            )
            / 100.0
        )

        # -----------------------------------------------------
        # Model-estimated allowable load
        # -----------------------------------------------------
        #
        # This is a heuristic prototype relationship.
        # It is deliberately labelled model-derived.
        # -----------------------------------------------------

        allowable_load = (
            maximum_load
            * (
                0.55
                + 0.45 * condition_factor
            )
        )

        # The allowable load should never be below the
        # current load without identifying a restriction.
        if (
            current_load <= maximum_load
            and condition_factor >= 0.50
        ):
            allowable_load = max(
                allowable_load,
                current_load,
            )

        allowable_load = self._clip(
            allowable_load,
            0,
            maximum_load,
        )

        load_margin = (
            allowable_load
            - current_load
        )

        load_margin_percent = (
            (
                load_margin
                / max(
                    allowable_load,
                    1,
                )
            )
            * 100.0
        )

        load_margin_percent = self._clip(
            load_margin_percent,
            0,
            100,
        )

        # -----------------------------------------------------
        # Allowable RPM
        # -----------------------------------------------------
        #
        # Degradation and thermal condition slightly reduce
        # the model-estimated usable RPM envelope.
        # -----------------------------------------------------

        allowable_rpm = (
            reference_max_rpm
            * (
                0.80
                + 0.20 * condition_factor
            )
        )

        allowable_rpm = max(
            allowable_rpm,
            0,
        )

        rpm_to_allowable_margin = (
            allowable_rpm
            - current_rpm
        )

        rpm_to_allowable_margin_percent = (
            (
                rpm_to_allowable_margin
                / max(
                    allowable_rpm,
                    1,
                )
            )
            * 100.0
        )

        rpm_to_allowable_margin_percent = (
            self._clip(
                rpm_to_allowable_margin_percent,
                0,
                100,
            )
        )

        # -----------------------------------------------------
        # Mission duration / endurance
        # -----------------------------------------------------

        mission_duration_hours = (
            self._num(
                mission.get(
                    "duration_min",
                    60,
                ),
                60,
            )
            / 60.0
        )

        valid_rul = None

        if rul_hours is not None:

            try:

                valid_rul = max(
                    float(rul_hours),
                    0.0,
                )

            except (
                TypeError,
                ValueError,
            ):

                valid_rul = None

        if valid_rul is not None:

            remaining_after_mission = (
                valid_rul
                - mission_duration_hours
            )

            endurance_margin_percent = (
                (
                    remaining_after_mission
                    / max(
                        valid_rul,
                        0.001,
                    )
                )
                * 100.0
            )

            endurance_margin_percent = (
                self._clip(
                    endurance_margin_percent,
                    -100,
                    100,
                )
            )

        else:

            remaining_after_mission = None
            endurance_margin_percent = None

        # -----------------------------------------------------
        # Degradation level
        # -----------------------------------------------------

        if degradation_score < 20:
            degradation_level = "LOW"

        elif degradation_score < 50:
            degradation_level = "MODERATE"

        elif degradation_score < 70:
            degradation_level = "HIGH"

        else:
            degradation_level = "SEVERE"

        # -----------------------------------------------------
        # Current overall capability
        # -----------------------------------------------------

        capability_components = [
            rpm_margin_percent,
            load_margin_percent,
            thermal_margin_percent,
            vibration_margin_percent,
            degradation_reserve,
        ]

        overall_capability = (
            sum(capability_components)
            / len(
                capability_components
            )
        )

        # Blend AI health when available.
        if health_score > 0:

            overall_capability = (
                overall_capability * 0.80
                + health_score * 0.20
            )

        overall_capability = round(
            self._clip(
                overall_capability,
                0,
                100,
            ),
            2,
        )

        # -----------------------------------------------------
        # Capability status
        # -----------------------------------------------------

        if (
            thermal_margin_percent < 20
            or vibration_margin_percent < 20
            or rpm_margin_percent < 10
            or load_margin_percent < 5
        ):

            capability_status = "LIMITED"

        elif overall_capability < 50:

            capability_status = "RESTRICTED"

        elif overall_capability < 70:

            capability_status = (
                "AVAILABLE_WITH_MARGIN"
            )

        else:

            capability_status = (
                "HEALTHY_MARGIN"
            )

        # -----------------------------------------------------
        # Mission-constrained envelope
        # -----------------------------------------------------
        #
        # This looks across the simulated mission rather than
        # only the present operating point.
        # -----------------------------------------------------

        mission_cht_margin_percent = 100.0
        mission_egt_margin_percent = 100.0
        mission_oil_temp_margin_percent = 100.0
        mission_vibration_margin_percent = 100.0

        mission_min_load_margin = float(
            "inf"
        )

        mission_min_rpm_margin = float(
            "inf"
        )

        mission_worst_checkpoint = None

        for assessment in (
            parameter_assessments
        ):

            parameter = assessment.get(
                "parameter"
            )

            value = self._num(
                assessment.get(
                    "value"
                ),
                0,
            )

            phase = assessment.get(
                "phase"
            )

            checkpoint = assessment.get(
                "checkpoint"
            )

            margin_percent = (
                self._capability_margin_percent(
                    parameter,
                    value,
                )
            )

            if parameter == "cht_c":

                mission_cht_margin_percent = (
                    min(
                        mission_cht_margin_percent,
                        margin_percent,
                    )
                )

            elif parameter == "egt_c":

                mission_egt_margin_percent = (
                    min(
                        mission_egt_margin_percent,
                        margin_percent,
                    )
                )

            elif parameter == "oil_temp_c":

                mission_oil_temp_margin_percent = (
                    min(
                        mission_oil_temp_margin_percent,
                        margin_percent,
                    )
                )

            elif parameter == "vibration_g":

                mission_vibration_margin_percent = (
                    min(
                        mission_vibration_margin_percent,
                        margin_percent,
                    )
                )

            if (
                mission_worst_checkpoint
                is None
                or margin_percent
                < mission_worst_checkpoint[
                    "margin_percent"
                ]
            ):

                mission_worst_checkpoint = {
                    "phase": phase,
                    "checkpoint": checkpoint,
                    "parameter": parameter,
                    "value": round(
                        value,
                        3,
                    ),
                    "margin_percent": round(
                        margin_percent,
                        2,
                    ),
                }

        mission_thermal_margin = (
            mission_cht_margin_percent * 0.40
            + mission_egt_margin_percent * 0.40
            + mission_oil_temp_margin_percent * 0.20
        )

        mission_thermal_margin = round(
            self._clip(
                mission_thermal_margin,
                0,
                100,
            ),
            2,
        )

        mission_condition_factor = min(
            mission_thermal_margin,
            mission_vibration_margin_percent,
            degradation_reserve,
            health_reserve,
            100.0,
        )

        mission_condition_factor = (
            self._clip(
                mission_condition_factor,
                0,
                100,
            )
            / 100.0
        )

        mission_allowable_load = (
            maximum_load
            * (
                0.55
                + 0.45
                * mission_condition_factor
            )
        )

        mission_allowable_load = self._clip(
            mission_allowable_load,
            0,
            maximum_load,
        )

        mission_load_margin = (
            mission_allowable_load
            - current_load
        )

        mission_load_margin_percent = (
            (
                mission_load_margin
                / max(
                    mission_allowable_load,
                    1,
                )
            )
            * 100.0
        )

        mission_load_margin_percent = (
            self._clip(
                mission_load_margin_percent,
                0,
                100,
            )
        )

        mission_allowable_rpm = (
            reference_max_rpm
            * (
                0.80
                + 0.20
                * mission_condition_factor
            )
        )

        mission_rpm_margin = (
            mission_allowable_rpm
            - current_rpm
        )

        mission_rpm_margin_percent = (
            (
                mission_rpm_margin
                / max(
                    mission_allowable_rpm,
                    1,
                )
            )
            * 100.0
        )

        mission_rpm_margin_percent = (
            self._clip(
                mission_rpm_margin_percent,
                0,
                100,
            )
        )

        mission_components = [
            mission_rpm_margin_percent,
            mission_load_margin_percent,
            mission_thermal_margin,
            mission_vibration_margin_percent,
            degradation_reserve,
        ]

        mission_capability = (
            sum(mission_components)
            / len(
                mission_components
            )
        )

        if health_score > 0:

            mission_capability = (
                mission_capability * 0.80
                + health_score * 0.20
            )

        mission_capability = round(
            self._clip(
                mission_capability,
                0,
                100,
            ),
            2,
        )

        if (
            mission_thermal_margin < 20
            or mission_vibration_margin_percent < 20
            or mission_rpm_margin_percent < 10
            or mission_load_margin_percent < 5
        ):

            mission_capability_status = (
                "LIMITED"
            )

        elif mission_capability < 50:

            mission_capability_status = (
                "RESTRICTED"
            )

        elif mission_capability < 70:

            mission_capability_status = (
                "AVAILABLE_WITH_MARGIN"
            )

        else:

            mission_capability_status = (
                "HEALTHY_MARGIN"
            )

        # -----------------------------------------------------
        # Final envelope
        # -----------------------------------------------------

        return {
            "available_rpm": {
                "current": round(
                    current_rpm,
                    2,
                ),
                "reference_max": round(
                    reference_max_rpm,
                    2,
                ),
                "allowable": round(
                    allowable_rpm,
                    2,
                ),
                "utilization_percent": round(
                    rpm_utilization,
                    2,
                ),
                "margin_to_allowable_percent": round(
                    rpm_to_allowable_margin_percent,
                    2,
                ),
                "source": (
                    self._field_source(
                        "rpm",
                        current_state,
                        current_ai_result,
                    )
                    if "rpm"
                    in current_state
                    else "DIGITAL_TWIN"
                ),
                "basis": (
                    "Prototype reference RPM limit "
                    "combined with current engine condition."
                ),
            },

            "allowable_load": {
                "current_percent": round(
                    current_load,
                    2,
                ),
                "allowable_percent": round(
                    allowable_load,
                    2,
                ),
                "margin_percent": round(
                    load_margin_percent,
                    2,
                ),
                "condition_factor_percent": round(
                    condition_factor * 100,
                    2,
                ),
                "source": "MODEL_DERIVED",
                "basis": (
                    "Heuristic prototype relationship using "
                    "thermal margin, vibration margin, "
                    "health and degradation reserve."
                ),
            },

            "thermal_margin": {
                "cht": {
                    "current": round(
                        current_cht,
                        2,
                    ),
                    "limit": round(
                        cht_limit,
                        2,
                    ),
                    "margin": round(
                        cht_margin,
                        2,
                    ),
                    "margin_percent": round(
                        cht_margin_percent,
                        2,
                    ),
                    "source": (
                        self._field_source(
                            "cht_c",
                            current_state,
                            current_ai_result,
                        )
                    ),
                },

                "egt": {
                    "current": round(
                        current_egt,
                        2,
                    ),
                    "limit": round(
                        egt_limit,
                        2,
                    ),
                    "margin": round(
                        egt_margin,
                        2,
                    ),
                    "margin_percent": round(
                        egt_margin_percent,
                        2,
                    ),
                    "source": (
                        self._field_source(
                            "egt_c",
                            current_state,
                            current_ai_result,
                        )
                    ),
                },

                "oil_temperature": {
                    "current": round(
                        current_oil_temp,
                        2,
                    ),
                    "limit": round(
                        oil_temp_limit,
                        2,
                    ),
                    "margin": round(
                        oil_temp_margin,
                        2,
                    ),
                    "margin_percent": round(
                        oil_temp_margin_percent,
                        2,
                    ),
                    "source": (
                        self._field_source(
                            "oil_temp_c",
                            current_state,
                            current_ai_result,
                        )
                    ),
                },

                "overall_percent": (
                    thermal_margin_percent
                ),
                "basis": (
                    "Weighted critical-limit margin: "
                    "CHT 40%, EGT 40%, oil temperature 20%."
                ),
                "margin_semantics": (
                    "Percentage represents normalized distance "
                    "from the critical limit; it is not a "
                    "certified operating limit or warning-threshold score."
                ),
            },

            "vibration_margin": {
                "current_g": round(
                    current_vibration,
                    3,
                ),
                "limit_g": round(
                    vibration_limit,
                    3,
                ),
                "margin_g": round(
                    vibration_margin,
                    3,
                ),
                "margin_percent": round(
                    vibration_margin_percent,
                    2,
                ),
                "margin_semantics": (
                    "Normalized distance from the critical vibration limit."
                ),
                "source": (
                    self._field_source(
                        "vibration_g",
                        current_state,
                        current_ai_result,
                    )
                ),
            },

            "predicted_endurance": {
                "rul_hours": (
                    round(
                        valid_rul,
                        2,
                    )
                    if valid_rul is not None
                    else None
                ),
                "mission_duration_hours": round(
                    mission_duration_hours,
                    2,
                ),
                "remaining_after_mission_hours": (
                    round(
                        remaining_after_mission,
                        2,
                    )
                    if remaining_after_mission
                    is not None
                    else None
                ),
                "endurance_margin_percent": (
                    round(
                        endurance_margin_percent,
                        2,
                    )
                    if endurance_margin_percent
                    is not None
                    else None
                ),
                "source": (
                    "AI_RUL_MODEL"
                    if valid_rul is not None
                    else "UNAVAILABLE"
                ),
                "basis": (
                    "Predicted Remaining Useful Life "
                    "from the existing AI RUL model."
                ),
            },

            "degradation": {
                "score": round(
                    degradation_score,
                    2,
                ),
                "level": degradation_level,
                "trajectory": trajectory,
                "reserve_percent": round(
                    degradation_reserve,
                    2,
                ),
                "source": "AI_TEMPORAL_ANALYSIS",
            },

            "overall_capability_percent": (
                overall_capability
            ),

            "status": capability_status,

            "mission_constrained": {
                "allowable_rpm": round(
                    mission_allowable_rpm,
                    2,
                ),
                "rpm_margin_percent": round(
                    mission_rpm_margin_percent,
                    2,
                ),
                "allowable_load_percent": round(
                    mission_allowable_load,
                    2,
                ),
                "load_margin_percent": round(
                    mission_load_margin_percent,
                    2,
                ),
                "thermal_margin_percent": round(
                    mission_thermal_margin,
                    2,
                ),
                "vibration_margin_percent": round(
                    mission_vibration_margin_percent,
                    2,
                ),
                "capability_percent": (
                    mission_capability
                ),
                "status": (
                    mission_capability_status
                ),
                "worst_checkpoint": (
                    mission_worst_checkpoint
                ),
            },

            "provenance": {
                "current_engine_source": source,
                "source_semantics": (
                    "MIXED means the current engine state contains "
                    "multiple provenance classes; inspect each "
                    "parameter source separately."
                ),
                "hardware_parameters": [
                    "rpm",
                    "vibration_g",
                    "motor_temp_c",
                    "current",
                    "voltage",
                ],
                "digital_twin_parameters": [
                    "cht_c",
                    "egt_c",
                    "oil_press_bar",
                    "oil_temp_c",
                    "fuel_flow",
                ],
                "model_derived_parameters": [
                    "allowable_rpm",
                    "allowable_load_percent",
                    "thermal_margin_percent",
                    "vibration_margin_percent",
                    "overall_capability_percent",
                ],
            },

            "basis": (
                "Prototype engine capability envelope derived "
                "from current telemetry, Digital Twin estimates, "
                "AI health/degradation and predicted endurance."
            ),

            "certification_note": (
                "Prototype/model-derived estimate. "
                "Not a certified engine operating envelope. "
                "Reference RPM/load limits must be replaced "
                "with validated engine-specific data before "
                "operational use."
            ),
        }

    # =========================================================
    # MISSION SIMULATION
    # =========================================================

    def simulate_mission(
        self,
        mission: Dict[str, Any],
        current_ai_result: Optional[
            Dict[str, Any]
        ] = None,
    ) -> Dict[str, Any]:

        if not isinstance(
            mission,
            dict,
        ):
            mission = {}

        current_state = (
            self._extract_current_state(
                current_ai_result
            )
        )

        degradation_score = (
            self._extract_degradation(
                current_ai_result
            )
        )

        health_score = (
            self._extract_health_score(
                current_ai_result
            )
        )

        trajectory = (
            self._extract_trajectory(
                current_ai_result
            )
        )

        ai_prediction = {}

        if isinstance(
            current_ai_result,
            dict,
        ):

            ai_prediction = (
                current_ai_result.get(
                    "ai_prediction",
                    {},
                )
            )

            if not isinstance(
                ai_prediction,
                dict,
            ):
                ai_prediction = {}

        predicted_fault = (
            ai_prediction.get(
                "predicted_fault",
                "UNKNOWN",
            )
        )

        rul_hours = (
            ai_prediction.get(
                "rul_hours",
                current_ai_result.get(
                    "rul_hours",
                    None,
                )
                if isinstance(
                    current_ai_result,
                    dict,
                )
                else None,
            )
        )

        # -----------------------------------------------------
        # Mission inputs
        # -----------------------------------------------------

        mission_id = mission.get(
            "mission_id",
            f"MISSION-{int(time.time())}",
        )

        duration_min = max(
            self._num(
                mission.get(
                    "duration_min",
                    60,
                ),
                60,
            ),
            5,
        )

        loiter_min = max(
            self._num(
                mission.get(
                    "loiter_min",
                    0,
                ),
                0,
            ),
            0,
        )

        normalized_mission = deepcopy(
            mission
        )

        normalized_mission[
            "mission_id"
        ] = mission_id

        normalized_mission[
            "duration_min"
        ] = duration_min

        normalized_mission[
            "loiter_min"
        ] = loiter_min

        # -----------------------------------------------------
        # Phase durations
        # -----------------------------------------------------

        phase_durations = (
            self._phase_durations(
                normalized_mission
            )
        )

        phase_results = []

        all_margins = []

        all_parameter_assessments = []

        all_critical = []

        all_warning = []

        earliest_problem = None

        most_stressful_phase = None

        highest_stress = -1.0

        # -----------------------------------------------------
        # Simulate each phase
        # -----------------------------------------------------

        for phase in self.PHASES:

            phase_duration = (
                phase_durations.get(
                    phase,
                    0,
                )
            )

            if phase_duration <= 0:
                continue

            checkpoints = 3

            checkpoint_results = []

            phase_min_margin = (
                float("inf")
            )

            phase_stress_score = 0.0

            for checkpoint in range(
                1,
                checkpoints + 1,
            ):

                progress = (
                    checkpoint
                    / checkpoints
                )

                conditions = (
                    self._phase_conditions(
                        normalized_mission,
                        phase,
                        progress,
                    )
                )

                simulated_state = (
                    self._simulate_engine_state(
                        conditions,
                        current_state,
                        degradation_score,
                        phase,
                        progress,
                    )
                )

                parameter_assessments = []

                for parameter in (
                    self.PARAMETER_LIMITS
                ):

                    value = self._num(
                        simulated_state.get(
                            parameter,
                            0,
                        ),
                        0,
                    )

                    assessment = (
                        self._assess_parameter(
                            parameter,
                            value,
                        )
                    )

                    parameter_assessments.append(
                        assessment
                    )

                    all_margins.append(
                        assessment[
                            "margin"
                        ]
                    )

                    all_parameter_assessments.append(
                        {
                            "phase": phase,
                            "checkpoint": checkpoint,
                            **assessment,
                        }
                    )

                    phase_min_margin = min(
                        phase_min_margin,
                        assessment[
                            "margin"
                        ],
                    )

                    if assessment[
                        "critical"
                    ]:

                        all_critical.append(
                            {
                                "phase": phase,
                                "checkpoint": checkpoint,
                                **assessment,
                            }
                        )

                    elif assessment[
                        "warning"
                    ]:

                        all_warning.append(
                            {
                                "phase": phase,
                                "checkpoint": checkpoint,
                                **assessment,
                            }
                        )

                    if (
                        assessment[
                            "critical"
                        ]
                        or assessment[
                            "warning"
                        ]
                    ):

                        if (
                            earliest_problem
                            is None
                        ):

                            earliest_problem = {
                                "phase": phase,
                                "checkpoint": checkpoint,
                                **assessment,
                            }

                # -------------------------------------------------
                # Stress score
                # -------------------------------------------------

                altitude = conditions[
                    "altitude_ft"
                ]

                load = conditions[
                    "load_percent"
                ]

                ambient = conditions[
                    "ambient_temp_c"
                ]

                throttle = conditions[
                    "throttle_percent"
                ]

                stress_score = (
                    self._clip(
                        altitude / 12000,
                        0,
                        1.5,
                    )
                    * 25
                    + self._clip(
                        load / 100,
                        0,
                        1,
                    )
                    * 35
                    + self._clip(
                        throttle / 100,
                        0,
                        1,
                    )
                    * 25
                    + self._clip(
                        (ambient - 20) / 30,
                        0,
                        1,
                    )
                    * 15
                )

                phase_stress_score += (
                    stress_score
                )

                checkpoint_results.append(
                    {
                        "checkpoint": checkpoint,
                        "progress": round(
                            progress,
                            3,
                        ),
                        "conditions": {
                            key: round(
                                value,
                                3,
                            )
                            for key, value
                            in conditions.items()
                        },
                        "engine_state": {
                            key: round(
                                self._num(
                                    value
                                ),
                                3,
                            )
                            for key, value
                            in simulated_state.items()
                        },
                        "parameters": (
                            parameter_assessments
                        ),
                        "stress_score": round(
                            stress_score,
                            2,
                        ),
                    }
                )

            phase_avg_stress = (
                phase_stress_score
                / checkpoints
            )

            if (
                phase_avg_stress
                > highest_stress
            ):

                highest_stress = (
                    phase_avg_stress
                )

                most_stressful_phase = (
                    phase
                )

            phase_results.append(
                {
                    "phase": phase,
                    "duration_min": round(
                        phase_duration,
                        2,
                    ),
                    "checkpoints": (
                        checkpoint_results
                    ),
                    "minimum_margin": round(
                        phase_min_margin,
                        3,
                    ),
                    "stress_score": round(
                        phase_avg_stress,
                        2,
                    ),
                }
            )

        # -----------------------------------------------------
        # Mission Feasibility Margin
        # -----------------------------------------------------

        feasibility_margin = (
            self._build_feasibility_margin(
                mission=normalized_mission,
                parameter_assessments=(
                    all_parameter_assessments
                ),
                health_score=health_score,
                degradation_score=(
                    degradation_score
                ),
                critical_parameters=(
                    all_critical
                ),
            )
        )

        mission_margin = self._num(
            feasibility_margin.get(
                "value",
                0,
            ),
            0,
        )

        # -----------------------------------------------------
        # Raw diagnostic margin
        # -----------------------------------------------------

        raw_parameter_margin = (
            self._mission_margin(
                all_margins
            )
        )

        # -----------------------------------------------------
        # Feasibility
        # -----------------------------------------------------

        feasible = (
            mission_margin >= 0
            and len(all_critical) == 0
            and feasibility_margin.get(
                "status"
            ) != "NEGATIVE"
        )

        # -----------------------------------------------------
        # ENGINE CAPABILITY ENVELOPE
        # -----------------------------------------------------

        engine_capability_envelope = (
            self._build_engine_capability_envelope(
                mission=normalized_mission,
                current_state=current_state,
                current_ai_result=(
                    current_ai_result
                ),
                phase_results=phase_results,
                parameter_assessments=(
                    all_parameter_assessments
                ),
                health_score=health_score,
                degradation_score=(
                    degradation_score
                ),
                trajectory=trajectory,
                rul_hours=rul_hours,
            )
        )

        # -----------------------------------------------------
        # Mission recommendation
        # -----------------------------------------------------

        recommendation_details = (
            self._generate_mission_recommendation(
                mission=normalized_mission,
                current_ai_result=(
                    current_ai_result
                ),
                mission_margin=mission_margin,
                critical_parameters=(
                    all_critical
                ),
                earliest_problem=(
                    earliest_problem
                ),
                most_stressful_phase=(
                    most_stressful_phase
                ),
            )
        )

        recommendation = (
            recommendation_details[
                "code"
            ]
        )

        # -----------------------------------------------------
        # Final result
        # -----------------------------------------------------

        result = {

            "mission_id": mission_id,

            "mission_input": (
                normalized_mission
            ),

            "engine_snapshot": {
                "health_score": round(
                    health_score,
                    2,
                ),
                "degradation_score": round(
                    degradation_score,
                    2,
                ),
                "trajectory": trajectory,
                "predicted_fault": (
                    predicted_fault
                ),
                "rul_hours": rul_hours,
            },

            # =================================================
            # NEW ENGINE CAPABILITY ENVELOPE
            # =================================================

            "engine_capability_envelope": (
                engine_capability_envelope
            ),

            "phase_results": phase_results,

            "most_stressful_phase": (
                most_stressful_phase
            ),

            "earliest_problem": (
                earliest_problem
            ),

            "critical_parameters": (
                all_critical
            ),

            "warning_parameters": (
                all_warning
            ),

            # =================================================
            # MISSION FEASIBILITY
            # =================================================

            "mission_margin": round(
                mission_margin,
                2,
            ),

            "feasibility_margin": (
                feasibility_margin
            ),

            "raw_parameter_margin": round(
                raw_parameter_margin,
                3,
            ),

            "feasible": feasible,

            # =================================================
            # RECOMMENDATION
            # =================================================

            "recommendation": (
                recommendation
            ),

            "recommendation_details": (
                recommendation_details
            ),

            # FEATURE 21: evidence-based explanation for the
            # recommendation. Values are derived from the actual
            # MissionGuard result and current AI state.
            "recommendation_reason": (
                self.build_recommendation_reason(
                    mission_result={
                        "mission_id": mission_id,
                        "mission_input": normalized_mission,
                        "engine_snapshot": {
                            "health_score": round(health_score, 2),
                            "degradation_score": round(degradation_score, 2),
                            "trajectory": trajectory,
                            "predicted_fault": predicted_fault,
                            "rul_hours": rul_hours,
                        },
                        "engine_capability_envelope": engine_capability_envelope,
                        "mission_margin": round(mission_margin, 2),
                        "feasibility_margin": feasibility_margin,
                        "feasible": feasible,
                        "recommendation": recommendation,
                        "recommendation_details": recommendation_details,
                        "critical_parameters": all_critical,
                        "warning_parameters": all_warning,
                        "earliest_problem": earliest_problem,
                    },
                    current_ai_result=current_ai_result,
                )
            ),

            "simulation_method": (
                "Digital Twin + AI Engine State "
                "+ Mission Stress Analysis "
                "+ Engine Capability Envelope"
            ),

            "note": (
                "Prototype mission simulation. "
                "Hardware, simulated, digital-twin "
                "and model-derived data provenance "
                "should be displayed separately by "
                "the dashboard."
            ),

            "timestamp": time.time(),
        }

        return result

    # =========================================================
    # FEATURE 21 — RECOMMENDATION REASON
    # =========================================================

    def build_recommendation_reason(
        self,
        mission_result: Dict[str, Any],
        current_ai_result: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Build an evidence-based explanation of the current MissionGuard
        recommendation.

        This method intentionally does not invent values. A reason is
        included only when the corresponding value exists in the current
        MissionGuard/AI result.
        """
        if not isinstance(mission_result, dict):
            mission_result = {}

        recommendation = str(
            mission_result.get("recommendation", "UNKNOWN")
        )

        reasons: List[Dict[str, Any]] = []

        def add_reason(
            reason_type: str,
            message: str,
            severity: str = "INFO",
            **values: Any,
        ) -> None:
            item: Dict[str, Any] = {
                "type": reason_type,
                "message": message,
                "severity": severity,
            }
            for key, value in values.items():
                if value is not None:
                    item[key] = value
            reasons.append(item)

        capability = mission_result.get(
            "engine_capability_envelope",
            {},
        )
        if not isinstance(capability, dict):
            capability = {}

        constrained = capability.get(
            "mission_constrained",
            {},
        )
        if not isinstance(constrained, dict):
            constrained = {}

        # -----------------------------------------------------
        # Thermal evidence
        # -----------------------------------------------------
        thermal_margin_percent = constrained.get(
            "thermal_margin_percent"
        )

        thermal_candidates: List[Dict[str, Any]] = []
        current_state = (
            self._extract_current_state(current_ai_result)
        )

        for parameter in (
            "cht_c",
            "egt_c",
            "oil_temp_c",
        ):
            if parameter in current_state:
                limits = self.PARAMETER_LIMITS.get(parameter, {})
                if limits:
                    value = self._num(
                        current_state.get(parameter),
                        0,
                    )
                    direction = str(
                        limits.get("direction", "HIGH")
                    ).upper()
                    critical = self._num(
                        limits.get("critical"),
                        0,
                    )
                    if direction == "HIGH":
                        margin = critical - value
                    else:
                        margin = value - critical
                    thermal_candidates.append(
                        {
                            "parameter": parameter,
                            "value": round(value, 2),
                            "margin": round(margin, 2),
                            "unit": limits.get("unit", ""),
                        }
                    )

        if thermal_candidates:
            worst_thermal = min(
                thermal_candidates,
                key=lambda x: self._num(x.get("margin"), 0),
            )
            margin = self._num(
                worst_thermal.get("margin"),
                0,
            )
            label = str(
                worst_thermal.get("parameter", "thermal")
            ).upper()
            unit = worst_thermal.get("unit", "")
            if margin < 0:
                add_reason(
                    "THERMAL_MARGIN",
                    f"{label} is {abs(margin):.2f} {unit} beyond the prototype critical boundary.",
                    "CRITICAL",
                    parameter=worst_thermal.get("parameter"),
                    value=worst_thermal.get("value"),
                    margin=round(margin, 2),
                    unit=unit,
                    source="CURRENT_ENGINE_STATE",
                )
            elif margin < 10:
                add_reason(
                    "THERMAL_MARGIN",
                    f"{label} has only {margin:.2f} {unit} margin to the prototype critical boundary.",
                    "WARNING",
                    parameter=worst_thermal.get("parameter"),
                    value=worst_thermal.get("value"),
                    margin=round(margin, 2),
                    unit=unit,
                    source="CURRENT_ENGINE_STATE",
                )
        elif thermal_margin_percent is not None:
            thermal_pct = self._num(
                thermal_margin_percent,
                0,
            )
            if thermal_pct < 0:
                add_reason(
                    "THERMAL_MARGIN",
                    "Mission thermal margin is negative.",
                    "CRITICAL",
                    margin_percent=round(thermal_pct, 2),
                    unit="%",
                    source="ENGINE_CAPABILITY_ENVELOPE",
                )

        # -----------------------------------------------------
        # Load capability evidence
        # -----------------------------------------------------
        allowable_load = None
        load_block = capability.get("allowable_load", {})
        if isinstance(load_block, dict):
            allowable_load = load_block.get("allowable_percent")

        mission_input = mission_result.get(
            "mission_input",
            {},
        )
        if not isinstance(mission_input, dict):
            mission_input = {}

        required_load = mission_input.get("load_percent")
        if required_load is None:
            required_load = mission_input.get("required_load_percent")

        if allowable_load is not None and required_load is not None:
            available = self._num(allowable_load, 0)
            required = self._num(required_load, 0)
            load_margin = available - required
            if load_margin < 0:
                add_reason(
                    "LOAD_CAPABILITY",
                    "Available load capability is below the mission load requirement.",
                    "CRITICAL",
                    available_percent=round(available, 2),
                    required_percent=round(required, 2),
                    margin_percent=round(load_margin, 2),
                    source="ENGINE_CAPABILITY_ENVELOPE",
                )
            elif load_margin < 10:
                add_reason(
                    "LOAD_CAPABILITY",
                    "Available load capability is close to the mission requirement.",
                    "WARNING",
                    available_percent=round(available, 2),
                    required_percent=round(required, 2),
                    margin_percent=round(load_margin, 2),
                    source="ENGINE_CAPABILITY_ENVELOPE",
                )

        # -----------------------------------------------------
        # Mission remaining time
        # -----------------------------------------------------
        remaining = None
        for key in (
            "remaining_duration_min",
            "mission_remaining_duration_minutes",
            "remaining_mission_duration_minutes",
            "mission_remaining_minutes",
            "remaining_mission_minutes",
        ):
            if mission_input.get(key) is not None:
                remaining = self._num(
                    mission_input.get(key),
                    0,
                )
                break

        if remaining is not None:
            add_reason(
                "MISSION_REMAINING",
                f"{remaining:.1f} minutes remain in the mission.",
                "INFO",
                value=round(remaining, 2),
                unit="minutes",
                source="MISSION_INPUT",
            )

        # -----------------------------------------------------
        # Estimated operating window
        # -----------------------------------------------------
        window = None
        if isinstance(current_ai_result, dict):
            window_data = current_ai_result.get(
                "estimated_operating_window",
                {},
            )
            if isinstance(window_data, dict):
                window = window_data.get(
                    "estimated_operating_window_minutes"
                )
                if window is None:
                    window = window_data.get("estimate_minutes")

        if window is not None and remaining is not None:
            window_value = self._num(window, 0)
            margin = window_value - remaining
            if margin < 0:
                add_reason(
                    "OPERATING_WINDOW",
                    "Estimated operating window is shorter than the remaining mission duration.",
                    "CRITICAL",
                    estimated_window_minutes=round(window_value, 2),
                    mission_remaining_minutes=round(remaining, 2),
                    margin_minutes=round(margin, 2),
                    source="MODEL_DERIVED",
                )
            else:
                add_reason(
                    "OPERATING_WINDOW",
                    "Estimated operating window covers the remaining mission duration.",
                    "INFO",
                    estimated_window_minutes=round(window_value, 2),
                    mission_remaining_minutes=round(remaining, 2),
                    margin_minutes=round(margin, 2),
                    source="MODEL_DERIVED",
                )

        # -----------------------------------------------------
        # Feasibility margin
        # -----------------------------------------------------
        feasibility = mission_result.get(
            "feasibility_margin",
            {},
        )
        if isinstance(feasibility, dict):
            margin_value = feasibility.get("value")
            if margin_value is not None:
                margin_value = self._num(margin_value, 0)
                if margin_value < 0:
                    add_reason(
                        "FEASIBILITY_MARGIN",
                        "Overall mission feasibility margin is negative.",
                        "CRITICAL",
                        value=round(margin_value, 2),
                        source="MISSIONGUARD",
                    )
                elif margin_value < 10:
                    add_reason(
                        "FEASIBILITY_MARGIN",
                        "Overall mission feasibility margin is limited.",
                        "WARNING",
                        value=round(margin_value, 2),
                        source="MISSIONGUARD",
                    )

        # -----------------------------------------------------
        # Fault evidence
        # -----------------------------------------------------
        critical_parameters = mission_result.get(
            "critical_parameters",
            [],
        )
        warning_parameters = mission_result.get(
            "warning_parameters",
            [],
        )

        if critical_parameters:
            first = critical_parameters[0]
            if isinstance(first, dict):
                add_reason(
                    "CRITICAL_PARAMETER",
                    "A mission parameter crossed its prototype critical boundary.",
                    "CRITICAL",
                    parameter=first.get("parameter"),
                    value=first.get("value"),
                    unit=first.get("unit"),
                    source="MISSIONGUARD",
                )

        fault_state = {}
        if isinstance(current_ai_result, dict):
            fault_state = current_ai_result.get(
                "final_fault_state",
                {},
            )
        if isinstance(fault_state, dict):
            fault_type = str(
                fault_state.get("type", "")
                or fault_state.get("classification", "")
                or fault_state.get("fault_type", "")
            )
            if fault_type and fault_type.upper() not in {
                "NONE",
                "NORMAL",
                "UNKNOWN",
            }:
                add_reason(
                    "FAULT_EVIDENCE",
                    f"Current fault analysis reports {fault_type}.",
                    "CRITICAL" if critical_parameters else "WARNING",
                    fault_state=fault_state,
                    source="AI_FAULT_ANALYSIS",
                )

        # -----------------------------------------------------
        # Degradation evidence
        # -----------------------------------------------------
        snapshot = mission_result.get("engine_snapshot", {})
        if isinstance(snapshot, dict):
            degradation = snapshot.get("degradation_score")
            trajectory = str(
                snapshot.get("trajectory", "UNKNOWN")
            ).upper()
            if degradation is not None:
                degradation_value = self._num(degradation, 0)
                if degradation_value >= 60:
                    add_reason(
                        "DEGRADATION",
                        f"Degradation score is {degradation_value:.1f}/100, inside the configured warning region.",
                        "CRITICAL",
                        degradation_score=round(degradation_value, 2),
                        source="AI_TEMPORAL_ANALYSIS",
                    )
                elif trajectory in {"DEGRADING", "WORSENING"}:
                    add_reason(
                        "DEGRADATION",
                        f"Degradation trajectory is {trajectory}.",
                        "WARNING",
                        degradation_score=round(degradation_value, 2),
                        trajectory=trajectory,
                        source="AI_TEMPORAL_ANALYSIS",
                    )

        # -----------------------------------------------------
        # Summary
        # -----------------------------------------------------
        if not reasons:
            summary = (
                "No additional measurable constraint was available "
                "to explain the recommendation beyond the current "
                "MissionGuard result."
            )
            actionable = False
        else:
            critical_count = sum(
                1
                for item in reasons
                if item.get("severity") == "CRITICAL"
            )
            if critical_count:
                summary = (
                    f"{recommendation} is supported by "
                    f"{critical_count} critical and "
                    f"{len(reasons) - critical_count} additional "
                    f"evidence item(s)."
                )
            else:
                summary = (
                    f"{recommendation} is supported by "
                    f"{len(reasons)} measurable evidence item(s)."
                )
            actionable = True

        return {
            "recommendation": recommendation,
            "summary": summary,
            "reasons": reasons,
            "evidence_count": len(reasons),
            "has_actionable_evidence": actionable,
            "provenance": "MODEL_DERIVED",
            "disclaimer": (
                "Recommendation reasons are derived from the prototype "
                "MissionGuard, AI and Digital Twin outputs. They are "
                "not certified flight-safety advice."
            ),
        }

    # =========================================================
    # MISSION MARGIN
    # =========================================================

    def _mission_margin(
        self,
        margins: List[float],
    ) -> float:

        if not margins:
            return 0.0

        return min(
            self._num(
                margin,
                0,
            )
            for margin in margins
        )

    # =========================================================
    # MISSION FEASIBILITY MARGIN
    # =========================================================

    def _parameter_capability_score(
        self,
        parameter: str,
        value: float,
    ) -> float:
        """
        Convert a safety parameter into a normalized
        capability score from 0 to 100.

        100 = healthy operating headroom
        0   = critical limit reached

        Prototype/model-derived only.
        """

        limits = self.PARAMETER_LIMITS.get(
            parameter
        )

        if not limits:
            return 100.0

        warning = self._num(
            limits.get("warning"),
            0,
        )

        critical = self._num(
            limits.get("critical"),
            0,
        )

        direction = limits.get(
            "direction",
            "HIGH",
        )

        if direction == "HIGH":

            if value <= warning:
                return 100.0

            if value >= critical:
                return 0.0

            span = (
                critical - warning
            )

            if span <= 0:
                return 0.0

            score = (
                (critical - value)
                / span
            ) * 100.0

        else:

            if value >= warning:
                return 100.0

            if value <= critical:
                return 0.0

            span = (
                warning - critical
            )

            if span <= 0:
                return 0.0

            score = (
                (value - critical)
                / span
            ) * 100.0

        return round(
            self._clip(
                score,
                0.0,
                100.0,
            ),
            2,
        )

    def _engine_capability_score(
        self,
        parameter_assessments: List[
            Dict[str, Any]
        ],
        health_score: float,
        degradation_score: float,
    ) -> float:
        """
        Estimate engine capability available
        for the selected mission.

        50% -> parameter operating capability
        30% -> AI engine health
        20% -> degradation reserve

        Prototype/model-derived only.
        """

        parameter_scores = []

        for assessment in (
            parameter_assessments
        ):

            parameter = (
                assessment.get(
                    "parameter"
                )
            )

            value = self._num(
                assessment.get(
                    "value"
                ),
                0,
            )

            if (
                parameter
                not in self.PARAMETER_LIMITS
            ):
                continue

            score = (
                self._parameter_capability_score(
                    parameter,
                    value,
                )
            )

            parameter_scores.append(
                score
            )

        if parameter_scores:

            parameter_capability = min(
                parameter_scores
            )

        else:

            parameter_capability = 100.0

        health_component = self._clip(
            self._num(
                health_score,
                0,
            ),
            0,
            100,
        )

        degradation_component = (
            100.0
            - self._clip(
                self._num(
                    degradation_score,
                    0,
                ),
                0,
                100,
            )
        )

        capability = (
            parameter_capability * 0.50
            + health_component * 0.30
            + degradation_component * 0.20
        )

        return round(
            self._clip(
                capability,
                0,
                100,
            ),
            2,
        )

    def _mission_requirement_score(
        self,
        mission: Dict[str, Any],
    ) -> float:
        """
        Estimate how demanding the selected mission is.

        0   = very low mission demand
        100 = very high mission demand
        """

        altitude = self._num(
            mission.get(
                "altitude_ft",
                8000,
            ),
            8000,
        )

        load = self._num(
            mission.get(
                "load_percent",
                65,
            ),
            65,
        )

        throttle = self._num(
            mission.get(
                "throttle_percent",
                70,
            ),
            70,
        )

        ambient_temp = self._num(
            mission.get(
                "ambient_temp_c",
                30,
            ),
            30,
        )

        duration = self._num(
            mission.get(
                "duration_min",
                60,
            ),
            60,
        )

        loiter = self._num(
            mission.get(
                "loiter_min",
                0,
            ),
            0,
        )

        altitude_demand = (
            self._clip(
                altitude / 12000.0,
                0,
                1,
            )
            * 100.0
        )

        load_demand = (
            self._clip(
                load / 100.0,
                0,
                1,
            )
            * 100.0
        )

        throttle_demand = (
            self._clip(
                throttle / 100.0,
                0,
                1,
            )
            * 100.0
        )

        temperature_demand = (
            self._clip(
                (ambient_temp - 15.0)
                / 35.0,
                0,
                1,
            )
            * 100.0
        )

        duration_demand = (
            self._clip(
                duration / 600.0,
                0,
                1,
            )
            * 100.0
        )

        loiter_ratio = (
            loiter
            / max(
                duration,
                1.0,
            )
        )

        loiter_demand = (
            self._clip(
                loiter_ratio,
                0,
                1,
            )
            * 100.0
        )

        requirement = (
            altitude_demand * 0.20
            + load_demand * 0.30
            + throttle_demand * 0.20
            + temperature_demand * 0.15
            + duration_demand * 0.10
            + loiter_demand * 0.05
        )

        return round(
            self._clip(
                requirement,
                0,
                100,
            ),
            2,
        )

    def _build_feasibility_margin(
        self,
        mission: Dict[str, Any],
        parameter_assessments: List[
            Dict[str, Any]
        ],
        health_score: float,
        degradation_score: float,
        critical_parameters: List[
            Dict[str, Any]
        ],
    ) -> Dict[str, Any]:
        """
        Calculate MissionGuard's unified feasibility margin.

        Feasibility Margin =
            Engine Capability - Mission Requirement
        """

        engine_capability = (
            self._engine_capability_score(
                parameter_assessments,
                health_score,
                degradation_score,
            )
        )

        mission_requirement = (
            self._mission_requirement_score(
                mission
            )
        )

        margin = (
            engine_capability
            - mission_requirement
        )

        if (
            critical_parameters
            and margin >= 0
        ):

            margin = -max(
                1.0,
                min(
                    20.0,
                    len(
                        critical_parameters
                    )
                    * 5.0,
                ),
            )

        margin = self._clip(
            margin,
            -100.0,
            100.0,
        )

        if margin >= 10.0:

            status = "POSITIVE"
            label = "Positive"

        elif margin >= 0.0:

            status = "BORDERLINE"
            label = "Borderline"

        else:

            status = "NEGATIVE"
            label = "Negative"

        return {
            "value": round(
                margin,
                2,
            ),
            "unit": "score points",
            "status": status,
            "label": label,

            "engine_capability": round(
                engine_capability,
                2,
            ),

            "mission_requirement": round(
                mission_requirement,
                2,
            ),

            "headroom": round(
                max(
                    engine_capability
                    - mission_requirement,
                    0,
                ),
                2,
            ),

            "basis": (
                "Prototype normalized "
                "engine-capability versus "
                "mission-requirement model"
            ),
        }

    # =========================================================
    # MISSION RESCUE
    # =========================================================

    def rescue_mission(
        self,
        mission: Dict[str, Any],
        current_ai_result: Optional[
            Dict[str, Any]
        ] = None,
    ) -> Dict[str, Any]:

        baseline = self.simulate_mission(
            mission,
            current_ai_result,
        )

        if baseline.get(
            "feasible"
        ):

            return {
                "baseline": baseline,
                "rescue_found": False,
                "message": (
                    "Baseline mission is already feasible."
                ),
                "alternatives": [],
            }

        alternatives = []

        rescue_tests = [
            {
                "name": "Reduce load by 5%",
                "field": "load_percent",
                "change": -5,
                "cost": 5,
            },
            {
                "name": "Reduce altitude by 1000 ft",
                "field": "altitude_ft",
                "change": -1000,
                "cost": 6,
            },
            {
                "name": "Reduce duration by 10 min",
                "field": "duration_min",
                "change": -10,
                "cost": 7,
            },
            {
                "name": "Reduce loiter by 10 min",
                "field": "loiter_min",
                "change": -10,
                "cost": 8,
            },
            {
                "name": "Reduce load by 10%",
                "field": "load_percent",
                "change": -10,
                "cost": 10,
            },
            {
                "name": "Reduce altitude by 2000 ft",
                "field": "altitude_ft",
                "change": -2000,
                "cost": 12,
            },
            {
                "name": "Reduce duration by 20 min",
                "field": "duration_min",
                "change": -20,
                "cost": 14,
            },
            {
                "name": "Reduce loiter by 20 min",
                "field": "loiter_min",
                "change": -20,
                "cost": 15,
            },
        ]

        for test in rescue_tests:

            candidate = deepcopy(
                mission
            )

            old_value = self._num(
                candidate.get(
                    test["field"],
                    0,
                ),
                0,
            )

            new_value = (
                old_value
                + test["change"]
            )

            if test["field"] in {
                "load_percent",
                "throttle_percent",
            }:

                new_value = self._clip(
                    new_value,
                    0,
                    100,
                )

            elif test["field"] == (
                "altitude_ft"
            ):

                new_value = max(
                    new_value,
                    0,
                )

            elif test["field"] in {
                "duration_min",
                "loiter_min",
            }:

                new_value = max(
                    new_value,
                    0,
                )

            candidate[
                test["field"]
            ] = new_value

            simulation = (
                self.simulate_mission(
                    candidate,
                    current_ai_result,
                )
            )

            alternatives.append(
                {
                    "name": test["name"],
                    "mission": candidate,
                    "feasible": simulation.get(
                        "feasible",
                        False,
                    ),
                    "mission_margin": simulation.get(
                        "mission_margin",
                        0,
                    ),
                    "recommendation": simulation.get(
                        "recommendation",
                        "UNKNOWN",
                    ),
                    "recommendation_details": (
                        simulation.get(
                            "recommendation_details",
                            {},
                        )
                    ),
                    "cost": test["cost"],
                }
            )

        feasible_alternatives = [
            item
            for item in alternatives
            if item["feasible"]
        ]

        feasible_alternatives.sort(
            key=lambda item: (
                item["cost"],
                -item["mission_margin"],
            )
        )

        best = (
            feasible_alternatives[0]
            if feasible_alternatives
            else None
        )

        return {
            "baseline": baseline,
            "rescue_found": (
                best is not None
            ),
            "best_rescue": best,
            "alternatives": alternatives,
            "message": (
                "A minimum-change feasible "
                "mission alternative was found."
                if best
                else
                "No tested rescue modification "
                "produced a feasible mission."
            ),
        }

    # =========================================================
    # SHADOW MISSION
    # =========================================================

    def create_shadow(
        self,
        mission_result: Dict[str, Any],
    ) -> Dict[str, Any]:

        shadow = {
            "created_at": time.time(),

            "mission_id": mission_result.get(
                "mission_id"
            ),

            "mission_input": deepcopy(
                mission_result.get(
                    "mission_input",
                    {},
                )
            ),

            "mission_margin": mission_result.get(
                "mission_margin",
                0,
            ),

            "recommendation": mission_result.get(
                "recommendation",
                "UNKNOWN",
            ),

            "recommendation_details": deepcopy(
                mission_result.get(
                    "recommendation_details",
                    {},
                )
            ),

            "engine_capability_envelope": (
                deepcopy(
                    mission_result.get(
                        "engine_capability_envelope",
                        {},
                    )
                )
            ),

            "phase_results": deepcopy(
                mission_result.get(
                    "phase_results",
                    [],
                )
            ),
        }

        self.shadow = shadow

        self.save_shadow()

        return shadow

    def save_shadow(
        self,
    ) -> None:

        try:

            directory = os.path.dirname(
                os.path.abspath(
                    self.shadow_file
                )
            )

            os.makedirs(
                directory,
                exist_ok=True,
            )

            with open(
                self.shadow_file,
                "w",
                encoding="utf-8",
            ) as file:

                json.dump(
                    self.shadow,
                    file,
                    indent=2,
                )

        except Exception as error:

            print(
                "[MissionGuard] "
                f"Shadow save error: {error}"
            )

    def load_shadow(
        self,
    ) -> None:

        if not os.path.exists(
            self.shadow_file
        ):

            self.shadow = {}
            return

        try:

            with open(
                self.shadow_file,
                "r",
                encoding="utf-8",
            ) as file:

                data = json.load(file)

            if isinstance(
                data,
                dict,
            ):

                self.shadow = data

            else:

                self.shadow = {}

        except Exception as error:

            print(
                "[MissionGuard] "
                f"Shadow load error: {error}"
            )

            self.shadow = {}

    def get_shadow(
        self,
    ) -> Dict[str, Any]:

        return deepcopy(
            self.shadow
        )

    # =========================================================
    # SHADOW COMPARISON
    # =========================================================

    def compare_with_shadow(
        self,
        actual_state: Dict[str, Any],
        timestamp: Optional[float] = None,
    ) -> Dict[str, Any]:

        if not self.shadow:

            return {
                "available": False,
                "message": (
                    "No shadow mission is available."
                ),
            }

        if not isinstance(
            actual_state,
            dict,
        ):

            return {
                "available": False,
                "message": (
                    "Invalid actual engine state."
                ),
            }

        timestamp = (
            timestamp
            if timestamp is not None
            else time.time()
        )

        phase_results = (
            self.shadow.get(
                "phase_results",
                [],
            )
        )

        if not phase_results:

            return {
                "available": False,
                "message": (
                    "Shadow mission has no phase data."
                ),
            }

        # -----------------------------------------------------
        # Find closest shadow checkpoint.
        # -----------------------------------------------------

        all_checkpoints = []

        for phase in phase_results:

            phase_name = phase.get(
                "phase",
                "UNKNOWN",
            )

            for checkpoint in phase.get(
                "checkpoints",
                [],
            ):

                all_checkpoints.append(
                    {
                        "phase": phase_name,
                        **checkpoint,
                    }
                )

        if not all_checkpoints:

            return {
                "available": False,
                "message": (
                    "Shadow mission has no checkpoints."
                ),
            }

        target = all_checkpoints[0]

        # -----------------------------------------------------
        # Actual vs predicted
        # -----------------------------------------------------

        predicted_state = target.get(
            "engine_state",
            {},
        )

        thresholds = {
            "cht_c": 8.0,
            "egt_c": 25.0,
            "oil_press_bar": 0.35,
            "oil_temp_c": 8.0,
            "vibration_g": 0.08,
            "battery_v": 0.35,
        }

        deviations = []

        deviation_score = 0.0

        for parameter, threshold in (
            thresholds.items()
        ):

            actual = self._num(
                actual_state.get(
                    parameter,
                    0,
                ),
                0,
            )

            predicted = self._num(
                predicted_state.get(
                    parameter,
                    0,
                ),
                0,
            )

            difference = (
                actual - predicted
            )

            absolute_difference = abs(
                difference
            )

            normalized = (
                absolute_difference
                / threshold
                if threshold > 0
                else 0
            )

            parameter_score = min(
                normalized * 20,
                100,
            )

            deviation_score += (
                parameter_score
            )

            deviations.append(
                {
                    "parameter": parameter,
                    "actual": round(
                        actual,
                        3,
                    ),
                    "predicted": round(
                        predicted,
                        3,
                    ),
                    "difference": round(
                        difference,
                        3,
                    ),
                    "threshold": threshold,
                    "exceeded": (
                        absolute_difference
                        > threshold
                    ),
                }
            )

        if thresholds:

            deviation_score /= len(
                thresholds
            )

        exceeded = [
            item
            for item in deviations
            if item["exceeded"]
        ]

        deviation_flag = (
            len(exceeded) > 0
            and deviation_score >= 25
        )

        return {
            "available": True,

            "timestamp": timestamp,

            "shadow_mission_id": (
                self.shadow.get(
                    "mission_id"
                )
            ),

            "reference_phase": (
                target.get(
                    "phase"
                )
            ),

            "deviation_score": round(
                deviation_score,
                2,
            ),

            "deviation_flag": (
                deviation_flag
            ),

            "deviations": deviations,

            "message": (
                "Actual telemetry is deviating "
                "from the shadow trajectory."
                if deviation_flag
                else
                "Actual telemetry remains close "
                "to the shadow trajectory."
            ),
        }

    # =========================================================
    # RESIMULATE REMAINING MISSION
    # =========================================================

    def resimulate_remaining_mission(
        self,
        original_mission: Dict[str, Any],
        actual_state: Dict[str, Any],
        remaining_duration_min: float,
        current_ai_result: Optional[
            Dict[str, Any]
        ] = None,
    ) -> Dict[str, Any]:

        updated_ai_result = deepcopy(
            current_ai_result
            if isinstance(
                current_ai_result,
                dict,
            )
            else {}
        )

        updated_ai_result[
            "current_state"
        ] = deepcopy(
            actual_state
        )

        updated_mission = deepcopy(
            original_mission
        )

        updated_mission[
            "duration_min"
        ] = max(
            self._num(
                remaining_duration_min,
                0,
            ),
            5,
        )

        return self.simulate_mission(
            updated_mission,
            updated_ai_result,
        )
