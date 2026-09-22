
from __future__ import annotations

import os
import threading
import time
import uuid
from copy import deepcopy
from typing import Any, Dict, List, Optional

try:
    from pymongo import MongoClient, ASCENDING, DESCENDING
except ImportError:
    MongoClient = None
    ASCENDING = 1
    DESCENDING = -1


class MissionHistory:
    """
    Mission Replay + Evidence Timeline + Recommendation Reason.

    MongoDB collections:
        mission_runs
        mission_timeline

    The recorder stores:
        - mission start/end
        - periodic engine snapshots
        - recommendation changes
        - fault events
        - degradation events
        - operating-limit events
        - recommendation reasons
        - data provenance
    """

    def __init__(
        self,
        mongo_uri: Optional[str] = None,
        database_name: Optional[str] = None,
        snapshot_interval_seconds: float = 1.0,
    ):
        self.mongo_uri = (
            mongo_uri
            or os.getenv(
                "AEROSYNX_MONGO_URI",
                "mongodb://localhost:27017",
            )
        )

        self.database_name = (
            database_name
            or os.getenv(
                "AEROSYNX_MONGO_DB",
                "AeroSynX",
            )
        )

        self.snapshot_interval_seconds = max(
            0.2,
            float(snapshot_interval_seconds),
        )

        self.lock = threading.RLock()

        self.active_mission_id: Optional[str] = None
        self.active_mission: Dict[str, Any] = {}
        self.active_started_at: Optional[float] = None

        self.last_snapshot_time: float = 0.0
        self.last_state: Dict[str, Any] = {}

        self.client = None
        self.db = None
        self.mission_runs = None
        self.mission_timeline = None

        self._connect()

    # ============================================================
    # DATABASE
    # ============================================================

    def _connect(self) -> None:
        if MongoClient is None:
            raise RuntimeError(
                "pymongo is not installed. "
                "Run: pip install pymongo"
            )

        self.client = MongoClient(
            self.mongo_uri,
            serverSelectionTimeoutMS=3000,
        )

        # Force connection test.
        self.client.admin.command("ping")

        self.db = self.client[self.database_name]

        self.mission_runs = self.db["mission_runs"]
        self.mission_timeline = self.db["mission_timeline"]

        # Useful indexes for replay.
        self.mission_runs.create_index(
            [("mission_id", ASCENDING)],
            unique=True,
        )

        self.mission_runs.create_index(
            [("started_at", DESCENDING)]
        )

        self.mission_timeline.create_index(
            [
                ("mission_id", ASCENDING),
                ("timestamp", ASCENDING),
            ]
        )

        self.mission_timeline.create_index(
            [
                ("mission_id", ASCENDING),
                ("event_type", ASCENDING),
            ]
        )

        print(
            "[MissionHistory] MongoDB connected:"
            f" {self.database_name}"
        )

    # ============================================================
    # BASIC HELPERS
    # ============================================================

    @staticmethod
    def _num(
        value: Any,
        default: Optional[float] = None,
    ) -> Optional[float]:
        try:
            if value is None:
                return default

            if isinstance(value, bool):
                return float(value)

            return float(value)

        except (TypeError, ValueError):
            return default

    @staticmethod
    def _text(
        value: Any,
        default: str = "",
    ) -> str:
        if value is None:
            return default

        return str(value)

    @staticmethod
    def _safe_copy(
        value: Any,
    ) -> Any:
        try:
            return deepcopy(value)
        except Exception:
            return value

    @staticmethod
    def _normal_fault(
        value: Any,
    ) -> bool:
        text = str(value or "").strip().lower()

        return text in {
            "",
            "none",
            "normal",
            "healthy",
            "no_fault",
            "no fault",
            "no-fault",
            "unknown",
            "null",
            "nan",
        }

    # ============================================================
    # RECOMMENDATION REASON
    # ============================================================

    def build_recommendation_reason(
        self,
        mission_result: Optional[Dict[str, Any]],
        ai_result: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Generate Recommendation Reason from actual measurable
        MissionGuard / AI outputs.

        No fabricated evidence is created.

        Only a reason is added when the corresponding value
        actually exists.
        """

        if not isinstance(mission_result, dict):
            mission_result = {}

        if not isinstance(ai_result, dict):
            ai_result = {}

        recommendation = self._text(
            mission_result.get(
                "recommendation",
                "UNKNOWN",
            ),
            "UNKNOWN",
        )

        recommendation_details = mission_result.get(
            "recommendation_details",
            {},
        )

        if not isinstance(
            recommendation_details,
            dict,
        ):
            recommendation_details = {}

        reasons: List[Dict[str, Any]] = []

        # ========================================================
        # 1. THERMAL MARGIN
        # ========================================================

        thermal_margin = self._find_thermal_margin(
            mission_result
        )

        if thermal_margin is not None:
            if thermal_margin < 0:
                reasons.append(
                    {
                        "type": "THERMAL_MARGIN",
                        "message": (
                            "Thermal margin is negative."
                        ),
                        "value": round(
                            thermal_margin,
                            2,
                        ),
                        "unit": "°C",
                        "severity": "CRITICAL",
                        "source": "MISSIONGUARD",
                    }
                )
            elif thermal_margin == 0:
                reasons.append(
                    {
                        "type": "THERMAL_MARGIN",
                        "message": (
                            "Thermal margin has reached zero."
                        ),
                        "value": 0.0,
                        "unit": "°C",
                        "severity": "WARNING",
                        "source": "MISSIONGUARD",
                    }
                )

        # ========================================================
        # 2. LOAD CAPABILITY VS REQUIRED LOAD
        # ========================================================

        load_data = self._find_load_capability(
            mission_result
        )

        if load_data is not None:
            available = load_data["available"]
            required = load_data["required"]

            if (
                available is not None
                and required is not None
                and available < required
            ):
                reasons.append(
                    {
                        "type": "LOAD_CAPABILITY",
                        "message": (
                            "Load capability is below "
                            "mission requirement."
                        ),
                        "available": round(
                            available,
                            2,
                        ),
                        "required": round(
                            required,
                            2,
                        ),
                        "unit": "%",
                        "severity": "WARNING",
                        "source": "ENGINE_CAPABILITY",
                    }
                )

        # ========================================================
        # 3. MISSION REMAINING
        # ========================================================

        mission_remaining = (
            self._find_mission_remaining(
                mission_result
            )
        )

        if mission_remaining is not None:
            reasons.append(
                {
                    "type": "MISSION_REMAINING",
                    "message": (
                        "Mission remaining duration "
                        "is measurable."
                    ),
                    "value": round(
                        mission_remaining,
                        2,
                    ),
                    "unit": "minutes",
                    "severity": "INFO",
                    "source": "MISSION_INPUT",
                }
            )

        # ========================================================
        # 4. OPERATING WINDOW
        # ========================================================

        operating_window = (
            self._find_operating_window(
                mission_result,
                ai_result,
            )
        )

        if operating_window is not None:
            estimated = operating_window.get(
                "estimated",
            )

            remaining = operating_window.get(
                "remaining",
            )

            margin = operating_window.get(
                "margin",
            )

            if (
                estimated is not None
                and remaining is not None
            ):
                if estimated < remaining:
                    reasons.append(
                        {
                            "type": "OPERATING_WINDOW",
                            "message": (
                                "Estimated operating "
                                "window is shorter than "
                                "mission remaining duration."
                            ),
                            "estimated_window_minutes": round(
                                estimated,
                                2,
                            ),
                            "mission_remaining_minutes": round(
                                remaining,
                                2,
                            ),
                            "margin_minutes": (
                                round(
                                    margin,
                                    2,
                                )
                                if margin is not None
                                else None
                            ),
                            "severity": "CRITICAL",
                            "source": (
                                "MODEL_DERIVED"
                            ),
                        }
                    )

        # ========================================================
        # 5. FEASIBILITY MARGIN
        # ========================================================

        feasibility = mission_result.get(
            "feasibility_margin",
            {},
        )

        if isinstance(
            feasibility,
            dict,
        ):
            feasibility_value = self._num(
                feasibility.get(
                    "value"
                )
            )

            if (
                feasibility_value is not None
                and feasibility_value < 0
            ):
                reasons.append(
                    {
                        "type": "FEASIBILITY_MARGIN",
                        "message": (
                            "Overall mission "
                            "feasibility margin is negative."
                        ),
                        "value": round(
                            feasibility_value,
                            2,
                        ),
                        "severity": "CRITICAL",
                        "source": "MISSIONGUARD",
                    }
                )

        # ========================================================
        # 6. FAULT EVIDENCE
        # ========================================================

        fault = self._find_fault(
            mission_result,
            ai_result,
        )

        if fault is not None:
            fault_state = fault.get(
                "state",
                "UNKNOWN",
            )

            if str(
                fault_state
            ).upper() in {
                "ENGINE_FAULT",
                "SENSOR_FAULT",
            }:
                reasons.append(
                    {
                        "type": "FAULT_EVIDENCE",
                        "message": (
                            f"{fault.get('display_label', fault_state)} "
                            "is supported by the available analysis."
                        ),
                        "fault_state": fault_state,
                        "confidence_percent": fault.get(
                            "confidence_percent"
                        ),
                        "severity": "WARNING",
                        "source": "AI_AND_ENGINEERING",
                    }
                )

        # ========================================================
        # 7. DEGRADATION EVIDENCE
        # ========================================================

        degradation = self._find_degradation(
            mission_result,
            ai_result,
        )

        if degradation is not None:
            score = degradation.get(
                "score"
            )

            trajectory = degradation.get(
                "trajectory"
            )

            if (
                score is not None
                and score >= 60
            ):
                reasons.append(
                    {
                        "type": "DEGRADATION",
                        "message": (
                            "Degradation score has "
                            "reached the configured "
                            "warning region."
                        ),
                        "value": round(
                            score,
                            2,
                        ),
                        "unit": "score",
                        "trajectory": trajectory,
                        "severity": "WARNING",
                        "source": "TEMPORAL_ENGINE",
                    }
                )

        # ========================================================
        # HUMAN-READABLE SUMMARY
        # ========================================================

        display_lines = []

        recommendation_label = (
            self._recommendation_label(
                recommendation
            )
        )

        if recommendation in {
            "SHORTEN_MISSION_RETURN",
            "RETURN",
            "RETURN_ADVISORY",
        }:
            prefix = (
                "Return advisory because:"
            )
        elif recommendation in {
            "CONTINUE_WITH_REDUCED_LOAD",
            "REDUCED_LOAD",
        }:
            prefix = (
                "Reduced-load recommendation because:"
            )
        elif recommendation in {
            "PRE_MISSION_INSPECTION",
        }:
            prefix = (
                "Pre-mission inspection recommended because:"
            )
        elif recommendation == "UNKNOWN":
            prefix = (
                "Recommendation is unknown because:"
            )
        else:
            prefix = (
                f"{recommendation_label} because:"
            )

        display_lines.append(prefix)

        for item in reasons:
            display_lines.append(
                "• "
                + self._reason_to_text(
                    item
                )
            )

        if not reasons:
            display_lines.append(
                "• No specific measurable "
                "constraint was identified."
            )

        summary = "\n".join(
            display_lines
        )

        return {
            "recommendation": recommendation,
            "recommendation_label": recommendation_label,
            "summary": summary,
            "reasons": reasons,
            "evidence_count": len(reasons),
            "has_actionable_evidence": any(
                item.get("severity")
                in {
                    "WARNING",
                    "CRITICAL",
                }
                for item in reasons
            ),
            "provenance": (
                "MODEL_DERIVED"
            ),
            "disclaimer": (
                "Recommendation reasons are generated "
                "from current MissionGuard and AI "
                "model outputs. They are decision-support "
                "evidence, not certified flight limits."
            ),
        }

    # ============================================================
    # FIND THERMAL MARGIN
    # ============================================================

    def _find_thermal_margin(
        self,
        result: Dict[str, Any],
    ) -> Optional[float]:

        candidates = [
            result.get(
                "thermal_margin"
            ),
            result.get(
                "engine_capability_envelope",
                {},
            ).get(
                "thermal_margin"
            )
            if isinstance(
                result.get(
                    "engine_capability_envelope",
                    {},
                ),
                dict,
            )
            else None,
            result.get(
                "feasibility_margin",
                {},
            ).get(
                "thermal_margin"
            )
            if isinstance(
                result.get(
                    "feasibility_margin",
                    {},
                ),
                dict,
            )
            else None,
        ]

        for value in candidates:
            number = self._num(value)
            if number is not None:
                return number

        # Derive from critical thermal parameters when
        # a direct thermal margin is not provided.
        critical = result.get(
            "critical_parameters",
            [],
        )

        if isinstance(
            critical,
            list,
        ):
            margins = []

            for item in critical:
                if not isinstance(
                    item,
                    dict,
                ):
                    continue

                parameter = str(
                    item.get(
                        "parameter",
                        "",
                    )
                ).lower()

                if (
                    "cht" in parameter
                    or "egt" in parameter
                    or "temp" in parameter
                ):
                    margin = self._num(
                        item.get(
                            "margin"
                        )
                    )

                    if margin is not None:
                        margins.append(
                            margin
                        )

            if margins:
                return min(
                    margins
                )

        return None

    # ============================================================
    # FIND LOAD CAPABILITY
    # ============================================================

    def _find_load_capability(
        self,
        result: Dict[str, Any],
    ) -> Optional[Dict[str, float]]:

        envelope = result.get(
            "engine_capability_envelope",
            {},
        )

        if not isinstance(
            envelope,
            dict,
        ):
            envelope = {}

        mission_input = result.get(
            "mission_input",
            {},
        )

        if not isinstance(
            mission_input,
            dict,
        ):
            mission_input = {}

        available = None
        required = None

        # Common capability names.
        for key in [
            "max_sustainable_load",
            "maximum_sustainable_load",
            "load_capability",
            "available_load",
            "max_load_percent",
        ]:
            value = self._num(
                envelope.get(key)
            )

            if value is not None:
                available = value
                break

        # Nested capability fields.
        capability = envelope.get(
            "capability",
            {},
        )

        if (
            available is None
            and isinstance(
                capability,
                dict,
            )
        ):
            for key in [
                "load",
                "load_capability",
                "max_load_percent",
            ]:
                value = self._num(
                    capability.get(key)
                )

                if value is not None:
                    available = value
                    break

        for key in [
            "required_load",
            "required_load_percent",
            "load",
        ]:
            value = self._num(
                mission_input.get(key)
            )

            if value is not None:
                required = value
                break

        if (
            available is None
            or required is None
        ):
            return None

        return {
            "available": available,
            "required": required,
        }

    # ============================================================
    # FIND MISSION REMAINING
    # ============================================================

    def _find_mission_remaining(
        self,
        result: Dict[str, Any],
    ) -> Optional[float]:

        direct_keys = [
            "mission_remaining_minutes",
            "remaining_mission_minutes",
            "mission_remaining_duration_minutes",
        ]

        for key in direct_keys:
            value = self._num(
                result.get(key)
            )

            if value is not None:
                return max(
                    0.0,
                    value,
                )

        mission_input = result.get(
            "mission_input",
            {},
        )

        if not isinstance(
            mission_input,
            dict,
        ):
            mission_input = {}

        for key in direct_keys:
            value = self._num(
                mission_input.get(key)
            )

            if value is not None:
                return max(
                    0.0,
                    value,
                )

        duration = self._num(
            mission_input.get(
                "duration_min"
            )
        )

        elapsed = self._num(
            mission_input.get(
                "elapsed_min",
                mission_input.get(
                    "mission_elapsed_minutes"
                ),
            )
        )

        if duration is not None:
            elapsed = (
                elapsed
                if elapsed is not None
                else 0.0
            )

            return max(
                0.0,
                duration - elapsed,
            )

        return None

    # ============================================================
    # FIND OPERATING WINDOW
    # ============================================================

    def _find_operating_window(
        self,
        result: Dict[str, Any],
        ai_result: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:

        candidates = [
            result.get(
                "estimated_operating_window"
            ),
            ai_result.get(
                "estimated_operating_window"
            ),
        ]

        for candidate in candidates:
            if not isinstance(
                candidate,
                dict,
            ):
                continue

            estimated = self._num(
                candidate.get(
                    "estimated_operating_window_minutes"
                )
            )

            remaining = self._num(
                candidate.get(
                    "mission_remaining_minutes"
                )
            )

            if remaining is None:
                remaining = self._find_mission_remaining(
                    result
                )

            margin = self._num(
                candidate.get(
                    "remaining_window_margin_minutes"
                )
            )

            if (
                margin is None
                and estimated is not None
                and remaining is not None
            ):
                margin = (
                    estimated
                    - remaining
                )

            if (
                estimated is not None
                or remaining is not None
            ):
                return {
                    "estimated": estimated,
                    "remaining": remaining,
                    "margin": margin,
                }

        return None

    # ============================================================
    # FIND FAULT
    # ============================================================

    def _find_fault(
        self,
        result: Dict[str, Any],
        ai_result: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:

        final_fault = result.get(
            "final_fault_state"
        )

        if isinstance(
            final_fault,
            dict,
        ):
            return final_fault

        fault = ai_result.get(
            "predicted_fault"
        )

        if (
            fault is not None
            and not self._normal_fault(
                fault
            )
        ):
            return {
                "state": "ENGINE_FAULT",
                "display_label": "Predicted Fault",
                "confidence_percent": ai_result.get(
                    "fault_confidence"
                ),
            }

        return None

    # ============================================================
    # FIND DEGRADATION
    # ============================================================

    def _find_degradation(
        self,
        result: Dict[str, Any],
        ai_result: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:

        temporal = result.get(
            "temporal_analysis",
            {},
        )

        if not isinstance(
            temporal,
            dict,
        ):
            temporal = {}

        score = self._num(
            temporal.get(
                "degradation_score"
            )
        )

        if score is None:
            score = self._num(
                result.get(
                    "degradation_score"
                )
            )

        trajectory = temporal.get(
            "trajectory",
            result.get(
                "trajectory",
                "UNKNOWN",
            ),
        )

        if (
            score is None
            and trajectory is None
        ):
            return None

        return {
            "score": score,
            "trajectory": trajectory,
        }

    # ============================================================
    # REASON TEXT
    # ============================================================

    def _reason_to_text(
        self,
        item: Dict[str, Any],
    ) -> str:

        reason_type = item.get(
            "type"
        )

        if reason_type == "THERMAL_MARGIN":
            return (
                f"Thermal margin is "
                f"{item.get('value')}°C."
            )

        if reason_type == "LOAD_CAPABILITY":
            return (
                "Load capability is "
                f"{item.get('available')}%, "
                "below the required "
                f"{item.get('required')}%."
            )

        if reason_type == "MISSION_REMAINING":
            return (
                "Mission requires "
                f"{item.get('value')} more minutes."
            )

        if reason_type == "OPERATING_WINDOW":
            return (
                "Estimated operating window is "
                f"{item.get('estimated_window_minutes')} "
                "minutes, while "
                f"{item.get('mission_remaining_minutes')} "
                "minutes remain."
            )

        if reason_type == "FEASIBILITY_MARGIN":
            return (
                "Overall feasibility margin is "
                f"{item.get('value')}."
            )

        if reason_type == "FAULT_EVIDENCE":
            return item.get(
                "message",
                "Fault evidence is present.",
            )

        if reason_type == "DEGRADATION":
            return (
                "Degradation score is "
                f"{item.get('value')} and the "
                f"trajectory is {item.get('trajectory')}."
            )

        return item.get(
            "message",
            "Measurable evidence is present.",
        )

    # ============================================================
    # RECOMMENDATION LABEL
    # ============================================================

    @staticmethod
    def _recommendation_label(
        recommendation: str,
    ) -> str:

        labels = {
            "CONTINUE": "Continue",
            "CONTINUE_WITH_REDUCED_LOAD": (
                "Continue With Reduced Load"
            ),
            "SHORTEN_MISSION_RETURN": (
                "Shorten Mission / Return"
            ),
            "PRE_MISSION_INSPECTION": (
                "Pre-Mission Inspection"
            ),
            "UNKNOWN": "Unknown",
        }

        return labels.get(
            recommendation,
            recommendation.replace(
                "_",
                " ",
            ).title(),
        )

    # ============================================================
    # START MISSION
    # ============================================================

    def start_mission(
        self,
        mission: Optional[Dict[str, Any]] = None,
        mission_id: Optional[str] = None,
    ) -> Dict[str, Any]:

        mission = (
            deepcopy(mission)
            if isinstance(
                mission,
                dict,
            )
            else {}
        )

        with self.lock:

            # Stop previous mission if necessary.
            if self.active_mission_id:
                self.stop_mission(
                    reason="NEW_MISSION_STARTED"
                )

            mission_id = (
                mission_id
                or mission.get(
                    "mission_id"
                )
                or (
                    "MISSION-"
                    + uuid.uuid4().hex[:10].upper()
                )
            )

            now = time.time()

            self.active_mission_id = (
                mission_id
            )

            self.active_mission = (
                deepcopy(mission)
            )

            self.active_mission[
                "mission_id"
            ] = mission_id

            self.active_started_at = now
            self.last_snapshot_time = 0.0
            self.last_state = {}

            document = {
                "mission_id": mission_id,
                "name": mission.get(
                    "name",
                    mission.get(
                        "mission_name",
                        mission_id,
                    ),
                ),
                "status": "RUNNING",
                "started_at": now,
                "ended_at": None,
                "duration_min": self._num(
                    mission.get(
                        "duration_min"
                    )
                ),
                "mission_input": deepcopy(
                    mission
                ),
                "initial_recommendation": None,
                "final_recommendation": None,
                "event_count": 0,
                "snapshot_count": 0,
                "created_at": now,
                "updated_at": now,
            }

            self.mission_runs.replace_one(
                {
                    "mission_id": mission_id
                },
                document,
                upsert=True,
            )

            self._insert_event(
                mission_id=mission_id,
                event_type="MISSION_STARTED",
                timestamp=now,
                payload={
                    "mission": deepcopy(
                        mission
                    )
                },
            )

            return {
                "mission_id": mission_id,
                "status": "RUNNING",
                "started_at": now,
            }

    # ============================================================
    # RECORD CURRENT STATE
    # ============================================================

    def record_state(
        self,
        ai_result: Optional[Dict[str, Any]],
        mission_result: Optional[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:

        with self.lock:

            if not self.active_mission_id:
                return None

            now = time.time()

            if (
                now - self.last_snapshot_time
                < self.snapshot_interval_seconds
            ):
                return None

            ai_result = (
                ai_result
                if isinstance(
                    ai_result,
                    dict,
                )
                else {}
            )

            mission_result = (
                mission_result
                if isinstance(
                    mission_result,
                    dict,
                )
                else {}
            )

            recommendation_reason = (
                self.build_recommendation_reason(
                    mission_result,
                    ai_result,
                )
            )

            recommendation = self._text(
                mission_result.get(
                    "recommendation",
                    "UNKNOWN",
                ),
                "UNKNOWN",
            )

            engine_snapshot = (
                mission_result.get(
                    "engine_snapshot",
                    {},
                )
            )

            if not isinstance(
                engine_snapshot,
                dict,
            ):
                engine_snapshot = {}

            current_state = ai_result.get(
                "current_state",
                {},
            )

            if not isinstance(
                current_state,
                dict,
            ):
                current_state = {}

            final_fault = ai_result.get(
                "final_fault_state",
                {},
            )

            if not isinstance(
                final_fault,
                dict,
            ):
                final_fault = {}

            temporal = ai_result.get(
                "temporal_analysis",
                {},
            )

            if not isinstance(
                temporal,
                dict,
            ):
                temporal = {}

            degradation = self._num(
                temporal.get(
                    "degradation_score",
                    ai_result.get(
                        "degradation_score"
                    ),
                )
            )

            fault_state = self._text(
                final_fault.get(
                    "state",
                    "UNKNOWN",
                ),
                "UNKNOWN",
            )

            snapshot = {
                "mission_id": (
                    self.active_mission_id
                ),
                "timestamp": now,
                "elapsed_seconds": max(
                    0.0,
                    now
                    - (
                        self.active_started_at
                        or now
                    ),
                ),
                "engine": {
                    "current_state": deepcopy(
                        current_state
                    ),
                    "expected_state": deepcopy(
                        ai_result.get(
                            "expected_state",
                            {},
                        )
                    ),
                    "residuals": deepcopy(
                        ai_result.get(
                            "residuals",
                            {},
                        )
                    ),
                    "health_score": self._num(
                        engine_snapshot.get(
                            "health_score",
                            ai_result.get(
                                "health_score"
                            ),
                        )
                    ),
                    "degradation_score": (
                        degradation
                    ),
                    "trajectory": temporal.get(
                        "trajectory",
                        ai_result.get(
                            "trajectory",
                            "UNKNOWN",
                        ),
                    ),
                    "rul_hours": self._num(
                        engine_snapshot.get(
                            "rul_hours",
                            ai_result.get(
                                "ai_prediction",
                                {},
                            ).get(
                                "rul_hours"
                            )
                            if isinstance(
                                ai_result.get(
                                    "ai_prediction",
                                    {},
                                ),
                                dict,
                            )
                            else None,
                        )
                    ),
                },
                "fault": {
                    "state": fault_state,
                    "display_label": final_fault.get(
                        "display_label",
                        "Unknown",
                    ),
                    "confidence_percent": (
                        final_fault.get(
                            "confidence_percent"
                        )
                    ),
                    "predicted_fault": (
                        engine_snapshot.get(
                            "predicted_fault",
                            "UNKNOWN",
                        )
                    ),
                },
                "mission": {
                    "recommendation": (
                        recommendation
                    ),
                    "recommendation_label": (
                        recommendation_reason[
                            "recommendation_label"
                        ]
                    ),
                    "recommendation_reason": (
                        recommendation_reason
                    ),
                    "feasibility_margin": (
                        deepcopy(
                            mission_result.get(
                                "feasibility_margin",
                                {},
                            )
                        )
                    ),
                    "engine_capability": (
                        deepcopy(
                            mission_result.get(
                                "engine_capability_envelope",
                                {},
                            )
                        )
                    ),
                    "operating_window": (
                        deepcopy(
                            ai_result.get(
                                "estimated_operating_window",
                                {},
                            )
                        )
                    ),
                },
                "provenance": {
                    "hardware": "HARDWARE",
                    "simulated": "SIMULATED",
                    "digital_twin": "DIGITAL_TWIN",
                    "model_derived": "MODEL_DERIVED",
                },
            }

            # Save the periodic snapshot.
            self.mission_timeline.insert_one(
                {
                    "mission_id": (
                        self.active_mission_id
                    ),
                    "timestamp": now,
                    "event_type": "SNAPSHOT",
                    "is_event": False,
                    "data": snapshot,
                }
            )

            self.last_snapshot_time = now

            # Detect meaningful events.
            events = self._detect_events(
                previous=self.last_state,
                current=snapshot,
            )

            for event in events:
                self._insert_event(
                    mission_id=(
                        self.active_mission_id
                    ),
                    event_type=event[
                        "event_type"
                    ],
                    timestamp=now,
                    payload=event.get(
                        "payload",
                        {},
                    ),
                )

            self.last_state = snapshot

            self.mission_runs.update_one(
                {
                    "mission_id": (
                        self.active_mission_id
                    )
                },
                {
                    "$set": {
                        "updated_at": now,
                        "latest_recommendation": (
                            recommendation
                        ),
                        "latest_recommendation_reason": (
                            recommendation_reason
                        ),
                        "latest_timestamp": now,
                    },
                    "$inc": {
                        "snapshot_count": 1,
                        "event_count": len(events),
                    },
                },
            )

            return snapshot

    # ============================================================
    # EVENT DETECTION
    # ============================================================

    def _detect_events(
        self,
        previous: Dict[str, Any],
        current: Dict[str, Any],
    ) -> List[Dict[str, Any]]:

        if not previous:
            return []

        events = []

        prev_mission = previous.get(
            "mission",
            {},
        )

        curr_mission = current.get(
            "mission",
            {},
        )

        prev_fault = previous.get(
            "fault",
            {},
        )

        curr_fault = current.get(
            "fault",
            {},
        )

        prev_engine = previous.get(
            "engine",
            {},
        )

        curr_engine = current.get(
            "engine",
            {},
        )

        # --------------------------------------------------------
        # Recommendation changed
        # --------------------------------------------------------

        old_rec = prev_mission.get(
            "recommendation"
        )

        new_rec = curr_mission.get(
            "recommendation"
        )

        if (
            old_rec
            and new_rec
            and old_rec != new_rec
        ):
            events.append(
                {
                    "event_type": (
                        "RECOMMENDATION_CHANGED"
                    ),
                    "payload": {
                        "previous": old_rec,
                        "current": new_rec,
                        "reason": (
                            curr_mission.get(
                                "recommendation_reason",
                                {},
                            )
                        ),
                    },
                }
            )

        # --------------------------------------------------------
        # Fault detected
        # --------------------------------------------------------

        old_fault = str(
            prev_fault.get(
                "state",
                "UNKNOWN",
            )
        ).upper()

        new_fault = str(
            curr_fault.get(
                "state",
                "UNKNOWN",
            )
        ).upper()

        if (
            new_fault
            in {
                "ENGINE_FAULT",
                "SENSOR_FAULT",
            }
            and new_fault != old_fault
        ):
            events.append(
                {
                    "event_type": "FAULT_DETECTED",
                    "payload": {
                        "fault_state": new_fault,
                        "display_label": (
                            curr_fault.get(
                                "display_label"
                            )
                        ),
                        "confidence_percent": (
                            curr_fault.get(
                                "confidence_percent"
                            )
                        ),
                    },
                }
            )

        # --------------------------------------------------------
        # Degradation detected
        # --------------------------------------------------------

        old_deg = self._num(
            prev_engine.get(
                "degradation_score"
            )
        )

        new_deg = self._num(
            curr_engine.get(
                "degradation_score"
            )
        )

        if (
            old_deg is not None
            and new_deg is not None
            and old_deg < 60.0
            and new_deg >= 60.0
        ):
            events.append(
                {
                    "event_type": (
                        "DEGRADATION_THRESHOLD_CROSSED"
                    ),
                    "payload": {
                        "previous_score": old_deg,
                        "current_score": new_deg,
                        "threshold": 60.0,
                    },
                }
            )

        # --------------------------------------------------------
        # Operating limit crossed
        # --------------------------------------------------------

        old_state = prev_engine.get(
            "current_state",
            {},
        )

        new_state = curr_engine.get(
            "current_state",
            {},
        )

        if not isinstance(
            old_state,
            dict,
        ):
            old_state = {}

        if not isinstance(
            new_state,
            dict,
        ):
            new_state = {}

        limits = {
            "rpm": 7000.0,
            "temperature": 100.0,
            "vibration_g": 2.5,
            "current_a": 10.0,
            "load": 100.0,
        }

        for parameter, limit in limits.items():

            old_value = self._num(
                old_state.get(
                    parameter
                )
            )

            new_value = self._num(
                new_state.get(
                    parameter
                )
            )

            if (
                old_value is None
                or new_value is None
            ):
                continue

            if (
                old_value <= limit
                and new_value > limit
            ):
                events.append(
                    {
                        "event_type": (
                            "OPERATING_LIMIT_CROSSED"
                        ),
                        "payload": {
                            "parameter": parameter,
                            "previous_value": old_value,
                            "current_value": new_value,
                            "limit": limit,
                        },
                    }
                )

        return events

    # ============================================================
    # INSERT EVENT
    # ============================================================

    def _insert_event(
        self,
        mission_id: str,
        event_type: str,
        timestamp: float,
        payload: Optional[Dict[str, Any]] = None,
    ) -> None:

        document = {
            "mission_id": mission_id,
            "timestamp": timestamp,
            "event_type": event_type,
            "is_event": True,
            "data": (
                deepcopy(payload)
                if isinstance(
                    payload,
                    dict,
                )
                else {}
            ),
        }

        self.mission_timeline.insert_one(
            document
        )

    # ============================================================
    # STOP MISSION
    # ============================================================

    def stop_mission(
        self,
        reason: str = "MISSION_ENDED",
    ) -> Dict[str, Any]:

        with self.lock:

            if not self.active_mission_id:
                return {
                    "status": "NO_ACTIVE_MISSION"
                }

            mission_id = (
                self.active_mission_id
            )

            now = time.time()

            self._insert_event(
                mission_id=mission_id,
                event_type="MISSION_ENDED",
                timestamp=now,
                payload={
                    "reason": reason,
                },
            )

            latest = self.last_state

            final_recommendation = (
                latest.get(
                    "mission",
                    {},
                ).get(
                    "recommendation",
                    "UNKNOWN",
                )
                if isinstance(
                    latest,
                    dict,
                )
                else "UNKNOWN"
            )

            self.mission_runs.update_one(
                {
                    "mission_id": mission_id
                },
                {
                    "$set": {
                        "status": "COMPLETED",
                        "ended_at": now,
                        "final_recommendation": (
                            final_recommendation
                        ),
                        "updated_at": now,
                    },
                    "$inc": {
                        "event_count": 1,
                    },
                },
            )

            result = {
                "mission_id": mission_id,
                "status": "COMPLETED",
                "ended_at": now,
                "final_recommendation": (
                    final_recommendation
                ),
            }

            self.active_mission_id = None
            self.active_mission = {}
            self.active_started_at = None
            self.last_snapshot_time = 0.0
            self.last_state = {}

            return result

    # ============================================================
    # ACTIVE MISSION
    # ============================================================

    def get_active_mission(
        self,
    ) -> Dict[str, Any]:

        with self.lock:

            if not self.active_mission_id:
                return {
                    "active": False
                }

            return {
                "active": True,
                "mission_id": (
                    self.active_mission_id
                ),
                "mission": deepcopy(
                    self.active_mission
                ),
                "started_at": (
                    self.active_started_at
                ),
            }

    # ============================================================
    # REPLAY
    # ============================================================

    def get_replay(
        self,
        mission_id: str,
    ) -> Dict[str, Any]:

        mission = self.mission_runs.find_one(
            {
                "mission_id": mission_id
            },
            {
                "_id": 0
            },
        )

        if not mission:
            return {
                "available": False,
                "message": (
                    "Mission was not found."
                ),
                "mission_id": mission_id,
            }

        cursor = self.mission_timeline.find(
            {
                "mission_id": mission_id
            },
            {
                "_id": 0
            },
        ).sort(
            "timestamp",
            ASCENDING,
        )

        timeline = list(cursor)

        snapshots = [
            item
            for item in timeline
            if item.get(
                "event_type"
            ) == "SNAPSHOT"
        ]

        events = [
            item
            for item in timeline
            if item.get(
                "is_event",
                False,
            )
        ]

        recommendations = []

        last_recommendation = None

        for snapshot in snapshots:

            recommendation = (
                snapshot.get(
                    "data",
                    {},
                )
                .get(
                    "mission",
                    {},
                )
                .get(
                    "recommendation"
                )
            )

            if (
                recommendation
                and recommendation
                != last_recommendation
            ):
                recommendations.append(
                    {
                        "timestamp": snapshot.get(
                            "timestamp"
                        ),
                        "recommendation": (
                            recommendation
                        ),
                        "recommendation_label": (
                            snapshot.get(
                                "data",
                                {},
                            )
                            .get(
                                "mission",
                                {},
                            )
                            .get(
                                "recommendation_label"
                            )
                        ),
                        "reason": (
                            snapshot.get(
                                "data",
                                {},
                            )
                            .get(
                                "mission",
                                {},
                            )
                            .get(
                                "recommendation_reason",
                                {},
                            )
                        ),
                    }
                )

                last_recommendation = (
                    recommendation
                )

        return {
            "available": True,
            "mission": mission,
            "timeline": timeline,
            "snapshots": snapshots,
            "events": events,
            "recommendations": recommendations,
            "timeline_start": (
                timeline[0]["timestamp"]
                if timeline
                else None
            ),
            "timeline_end": (
                timeline[-1]["timestamp"]
                if timeline
                else None
            ),
        }

    # ============================================================
    # LIST MISSIONS
    # ============================================================

    def list_missions(
        self,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:

        limit = max(
            1,
            min(
                int(limit),
                100,
            ),
        )

        cursor = self.mission_runs.find(
            {},
            {
                "_id": 0
            },
        ).sort(
            "started_at",
            DESCENDING,
        ).limit(
            limit
        )

        return list(cursor)

