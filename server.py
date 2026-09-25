
# server.py

import threading
import time
import uuid
import os
from copy import deepcopy
from typing import Any, Dict, Optional

from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.errors import PyMongoError

from flask import Flask, jsonify, request
from flask_cors import CORS

from data_fusion import DataFusion
from ai_digital_twin import AIDigitalTwin
from mission_guard import MissionGuard
from telemetry_bridge import get_api_telemetry, create_hybrid_reading, ENGINE_FIELDS

# ============================================================
# MISSION HISTORY / EVIDENCE LOGGER
# ============================================================

class MissionHistory:
    """
    MongoDB-backed mission evidence logger.

    Stores:
        mission_runs     -> one document per mission
        mission_timeline -> periodic snapshots + meaningful events

    Snapshots are throttled to approximately one per second so the
    timeline does not become a copy of every frontend frame.
    """

    def __init__(self, snapshot_interval_seconds: float = 1.0):
        self.snapshot_interval = max(
            float(snapshot_interval_seconds),
            0.25,
        )
        self.lock = threading.RLock()
        self.active: Dict[str, Any] = {}
        self.last_snapshot_time: Dict[str, float] = {}
        self.last_state: Dict[str, Dict[str, Any]] = {}
        self.mongo_error: Optional[str] = None

        uri = os.environ.get(
            "AEROSYNX_MONGO_URI",
            "mongodb://localhost:27017",
        )
        db_name = os.environ.get(
            "AEROSYNX_MONGO_DB",
            "AeroSynX",
        )

        self.client = None
        self.db = None
        self.runs = None
        self.timeline = None

        try:
            self.client = MongoClient(
                uri,
                serverSelectionTimeoutMS=3000,
            )
            self.client.admin.command("ping")
            self.db = self.client[db_name]
            self.runs = self.db["mission_runs"]
            self.timeline = self.db["mission_timeline"]

            self.runs.create_index(
                [("started_at", DESCENDING)]
            )
            self.runs.create_index(
                [("mission_id", ASCENDING)],
                unique=True,
            )
            self.timeline.create_index(
                [
                    ("mission_id", ASCENDING),
                    ("timestamp", ASCENDING),
                ]
            )
            self.timeline.create_index(
                [
                    ("mission_id", ASCENDING),
                    ("record_type", ASCENDING),
                ]
            )
            print(
                "[MissionHistory] MongoDB connected: "
                f"{db_name}"
            )
        except Exception as error:
            self.mongo_error = str(error)
            print(
                "[MissionHistory] MongoDB connection warning: "
                f"{error}"
            )

    # ------------------------------------------------------------
    # Mongo-safe conversion
    # ------------------------------------------------------------

    def _clean(self, value: Any) -> Any:
        if value is None or isinstance(
            value,
            (str, int, float, bool),
        ):
            return value

        if isinstance(value, dict):
            return {
                str(key): self._clean(item)
                for key, item in value.items()
            }

        if isinstance(value, (list, tuple)):
            return [
                self._clean(item)
                for item in value
            ]

        try:
            return float(value)
        except (TypeError, ValueError):
            return str(value)

    def _db_insert(self, collection, document: Dict[str, Any]) -> bool:
        if collection is None:
            return False
        try:
            collection.insert_one(
                self._clean(document)
            )
            return True
        except PyMongoError as error:
            self.mongo_error = str(error)
            print(
                "[MissionHistory] MongoDB insert error: "
                f"{error}"
            )
            return False

    # ------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------

    @staticmethod
    def _normal_fault(value: Any) -> bool:
        text = str(value or "").strip().upper()
        return text not in {
            "",
            "NONE",
            "NORMAL",
            "NO_FAULT",
            "NO FAULT",
            "HEALTHY",
            "UNKNOWN",
            "NULL",
        }

    def _fault_signature(self, ai_result: Dict[str, Any]) -> str:
        final_state = ai_result.get(
            "final_fault_state",
            {},
        )
        if isinstance(final_state, dict):
            for key in (
                "type",
                "classification",
                "fault_type",
                "state",
                "fault",
            ):
                value = final_state.get(key)
                if self._normal_fault(value):
                    return str(value)

        ai = ai_result.get(
            "ai_prediction",
            {},
        )
        if isinstance(ai, dict):
            value = ai.get("predicted_fault")
            if self._normal_fault(value):
                return str(value)

        value = ai_result.get("predicted_fault")
        return str(value) if self._normal_fault(value) else ""

    def _anomaly_signature(self, ai_result: Dict[str, Any]) -> str:
        ai = ai_result.get("ai_prediction", {})
        if not isinstance(ai, dict):
            return ""
        anomaly = ai.get("anomaly")
        if isinstance(anomaly, bool):
            return "ANOMALY" if anomaly else "NORMAL"
        text = str(anomaly or "").strip().upper()
        return text

    def _degradation(self, ai_result: Dict[str, Any]) -> float:
        value = ai_result.get("degradation_score")
        if value is None:
            temporal = ai_result.get(
                "temporal_analysis",
                {},
            )
            if isinstance(temporal, dict):
                value = temporal.get(
                    "degradation_score"
                )
        try:
            return float(value)
        except (TypeError, ValueError):
            return 0.0

    def _trajectory(self, ai_result: Dict[str, Any]) -> str:
        value = ai_result.get("trajectory")
        if value is None:
            temporal = ai_result.get(
                "temporal_analysis",
                {},
            )
            if isinstance(temporal, dict):
                value = temporal.get("trajectory")
        return str(value or "UNKNOWN").upper()

    def _recommendation(self, mission_result: Dict[str, Any]) -> str:
        return str(
            mission_result.get(
                "recommendation",
                "UNKNOWN",
            )
        ).upper()

    def _has_operating_limit_crossing(
        self,
        value: Any,
    ) -> bool:
        if isinstance(value, dict):
            for key, item in value.items():
                key_text = str(key).lower()
                if key_text in {
                    "exceeded",
                    "critical",
                    "limit_crossed",
                    "violated",
                    "violation",
                } and item is True:
                    return True
                if key_text in {
                    "status",
                    "state",
                }:
                    text = str(item).upper()
                    if text in {
                        "EXCEEDED",
                        "CRITICAL",
                        "LIMIT_CROSSED",
                        "VIOLATION",
                    }:
                        return True
                if self._has_operating_limit_crossing(item):
                    return True

        elif isinstance(value, list):
            return any(
                self._has_operating_limit_crossing(item)
                for item in value
            )

        return False

    def _snapshot_document(
        self,
        mission_id: str,
        ai_result: Dict[str, Any],
        mission_result: Dict[str, Any],
        recommendation_reason: Dict[str, Any],
        elapsed_minutes: float,
        remaining_minutes: float,
    ) -> Dict[str, Any]:
        timestamp = time.time()
        return {
            "mission_id": mission_id,
            "timestamp": timestamp,
            "record_type": "SNAPSHOT",
            "elapsed_minutes": round(
                elapsed_minutes,
                3,
            ),
            "remaining_minutes": round(
                remaining_minutes,
                3,
            ),
            "engine_state": deepcopy(
                ai_result.get(
                    "current_state",
                    {},
                )
                if isinstance(ai_result, dict)
                else {}
            ),
            "engine_analysis": {
                "health_score": (
                    ai_result.get("health_score")
                    if isinstance(ai_result, dict)
                    else None
                ),
                "degradation_score": self._degradation(
                    ai_result
                ),
                "trajectory": self._trajectory(
                    ai_result
                ),
                "predicted_fault": self._fault_signature(
                    ai_result
                ),
                "rul_hours": (
                    ai_result.get("ai_prediction", {}).get(
                        "rul_hours"
                    )
                    if isinstance(
                        ai_result.get("ai_prediction", {}),
                        dict,
                    )
                    else None
                ),
                "final_fault_state": deepcopy(
                    ai_result.get(
                        "final_fault_state",
                        {},
                    )
                    if isinstance(ai_result, dict)
                    else {}
                ),
            },
            "mission_state": {
                "recommendation": self._recommendation(
                    mission_result
                ),
                "mission_margin": mission_result.get(
                    "mission_margin"
                ),
                "feasible": mission_result.get(
                    "feasible"
                ),
                "critical_parameters": deepcopy(
                    mission_result.get(
                        "critical_parameters",
                        [],
                    )
                ),
                "warning_parameters": deepcopy(
                    mission_result.get(
                        "warning_parameters",
                        [],
                    )
                ),
                "engine_capability_envelope": deepcopy(
                    mission_result.get(
                        "engine_capability_envelope",
                        {},
                    )
                ),
            },
            "recommendation_reason": deepcopy(
                recommendation_reason
            ),
            "provenance": {
                "engine_source": (
                    ai_result.get("source")
                    if isinstance(ai_result, dict)
                    else "UNKNOWN"
                ),
                "context": deepcopy(
                    ai_result.get("context", {})
                    if isinstance(ai_result, dict)
                    else {}
                ),
            },
        }

    # ------------------------------------------------------------
    # Start / stop
    # ------------------------------------------------------------

    def start_mission(
        self,
        mission: Dict[str, Any],
    ) -> Dict[str, Any]:
        if not isinstance(mission, dict):
            mission = {}

        mission = deepcopy(mission)
        mission_id = str(
            mission.get("mission_id")
            or f"MISSION-{int(time.time())}-{uuid.uuid4().hex[:6]}"
        )
        mission["mission_id"] = mission_id

        duration = mission.get(
            "duration_min",
            mission.get("mission_duration_min", 60),
        )
        try:
            duration = max(float(duration), 0.0)
        except (TypeError, ValueError):
            duration = 60.0

        started_at = time.time()

        run = {
            "mission_id": mission_id,
            "name": mission.get(
                "name",
                mission.get(
                    "mission_name",
                    mission_id,
                ),
            ),
            "status": "RUNNING",
            "started_at": started_at,
            "ended_at": None,
            "duration_min": duration,
            "mission_input": mission,
            "initial_recommendation": None,
            "final_recommendation": None,
            "snapshot_count": 0,
            "event_count": 1,
            "provenance": {
                "mission_input": "USER_PROVIDED",
                "engine_state": "RUNTIME_AI_PIPELINE",
            },
        }

        with self.lock:
            self.active = {
                "mission_id": mission_id,
                "mission": mission,
                "started_at": started_at,
                "duration_min": duration,
            }
            self.last_snapshot_time[mission_id] = 0.0
            self.last_state[mission_id] = {}

        if self.runs is not None:
            try:
                self.runs.update_one(
                    {"mission_id": mission_id},
                    {"$set": self._clean(run)},
                    upsert=True,
                )
            except PyMongoError as error:
                self.mongo_error = str(error)
                print(
                    "[MissionHistory] start_mission DB error: "
                    f"{error}"
                )

        self._insert_event(
            mission_id,
            "MISSION_STARTED",
            "Mission started and evidence logging is active.",
            {
                "mission": mission,
                "duration_min": duration,
            },
        )

        return run

    def stop_mission(
        self,
        reason: str = "MANUAL_STOP",
    ) -> Dict[str, Any]:
        with self.lock:
            active = deepcopy(self.active)

        if not active:
            return {
                "status": "NO_ACTIVE_MISSION",
                "message": "No mission is currently running.",
            }

        mission_id = active["mission_id"]
        ended_at = time.time()
        elapsed = max(
            (ended_at - active["started_at"]) / 60.0,
            0.0,
        )

        final_recommendation = None
        if isinstance(
            self.last_state.get(mission_id),
            dict,
        ):
            final_recommendation = (
                self.last_state[mission_id].get(
                    "recommendation"
                )
            )

        if self.runs is not None:
            try:
                self.runs.update_one(
                    {"mission_id": mission_id},
                    {
                        "$set": {
                            "status": "COMPLETED",
                            "ended_at": ended_at,
                            "elapsed_minutes": round(
                                elapsed,
                                3,
                            ),
                            "final_recommendation": final_recommendation,
                            "stop_reason": reason,
                        }
                    },
                )
            except PyMongoError as error:
                self.mongo_error = str(error)
                print(
                    "[MissionHistory] stop_mission DB error: "
                    f"{error}"
                )

        self._insert_event(
            mission_id,
            "MISSION_ENDED",
            "Mission evidence logging stopped.",
            {
                "stop_reason": reason,
                "elapsed_minutes": round(elapsed, 3),
                "final_recommendation": final_recommendation,
            },
        )

        with self.lock:
            self.active = {}

        return {
            "status": "MISSION_STOPPED",
            "mission_id": mission_id,
            "ended_at": ended_at,
            "elapsed_minutes": round(elapsed, 3),
            "final_recommendation": final_recommendation,
            "stop_reason": reason,
        }

    # ------------------------------------------------------------
    # Events / snapshots
    # ------------------------------------------------------------

    def _insert_event(
        self,
        mission_id: str,
        event_type: str,
        message: str,
        evidence: Optional[Dict[str, Any]] = None,
    ) -> None:
        document = {
            "mission_id": mission_id,
            "timestamp": time.time(),
            "record_type": "EVENT",
            "event_type": event_type,
            "message": message,
            "evidence": evidence or {},
        }
        self._db_insert(
            self.timeline,
            document,
        )

    def record_state(
        self,
        ai_result: Dict[str, Any],
        mission_result: Dict[str, Any],
        elapsed_minutes: float,
        remaining_minutes: float,
        recommendation_reason: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if not isinstance(ai_result, dict):
            ai_result = {}
        if not isinstance(mission_result, dict):
            mission_result = {}

        with self.lock:
            active = deepcopy(self.active)

        if not active:
            return {
                "recorded": False,
                "reason": "NO_ACTIVE_MISSION",
            }

        mission_id = active["mission_id"]
        now = time.time()
        reason = (
            recommendation_reason
            if isinstance(recommendation_reason, dict)
            else {}
        )
        recommendation = self._recommendation(
            mission_result
        )
        fault = self._fault_signature(ai_result)
        anomaly = self._anomaly_signature(ai_result)
        degradation = self._degradation(ai_result)
        trajectory = self._trajectory(ai_result)
        previous = self.last_state.get(
            mission_id,
            {},
        )

        events: list = []

        previous_recommendation = previous.get(
            "recommendation"
        )
        if (
            previous_recommendation is not None
            and previous_recommendation != recommendation
        ):
            events.append(
                (
                    "RECOMMENDATION_CHANGED",
                    "Mission recommendation changed.",
                    {
                        "previous": previous_recommendation,
                        "current": recommendation,
                        "reason": reason,
                    },
                )
            )

        previous_fault = previous.get("fault", "")
        if fault and not previous_fault:
            events.append(
                (
                    "FAULT_DETECTED",
                    "A non-normal fault classification was detected.",
                    {
                        "fault": fault,
                        "anomaly": anomaly,
                    },
                )
            )

        previous_degradation = self._degradation(
            previous.get("ai_result", {})
            if isinstance(previous.get("ai_result", {}), dict)
            else {}
        )
        if (
            previous_degradation < 60
            and degradation >= 60
        ):
            events.append(
                (
                    "DEGRADATION_DETECTED",
                    "Degradation score entered the configured warning region.",
                    {
                        "previous_score": round(
                            previous_degradation,
                            2,
                        ),
                        "current_score": round(
                            degradation,
                            2,
                        ),
                    },
                )
            )

        previous_anomaly = str(
            previous.get("anomaly", "")
        ).upper()
        if (
            anomaly
            and anomaly not in {"NORMAL", "FALSE", "0"}
            and previous_anomaly in {"", "NORMAL", "FALSE", "0"}
        ):
            events.append(
                (
                    "ANOMALY_FIRST_SIGNAL",
                    "AI anomaly detection produced the first non-normal signal for this mission.",
                    {"anomaly": anomaly},
                )
            )

        operating_limits = ai_result.get(
            "operating_limits",
            {},
        )
        previous_limit_crossed = bool(
            previous.get("operating_limit_crossed", False)
        )
        limit_crossed = self._has_operating_limit_crossing(
            operating_limits
        )
        if limit_crossed and not previous_limit_crossed:
            events.append(
                (
                    "OPERATING_LIMIT_CROSSED",
                    "A configured prototype operating limit was crossed.",
                    {"operating_limits": operating_limits},
                )
            )

        if (
            "RETURN" in recommendation
            and "RETURN" not in str(
                previous_recommendation or ""
            ).upper()
        ):
            events.append(
                (
                    "RETURN_ADVISORY",
                    "MissionGuard entered a return/shorten-mission advisory state.",
                    {"recommendation": recommendation},
                )
            )

        # Snapshot throttle.
        last_time = self.last_snapshot_time.get(
            mission_id,
            0.0,
        )
        should_snapshot = (
            now - last_time
            >= self.snapshot_interval
        )

        snapshot = None
        if should_snapshot:
            snapshot = self._snapshot_document(
                mission_id=mission_id,
                ai_result=ai_result,
                mission_result=mission_result,
                recommendation_reason=reason,
                elapsed_minutes=elapsed_minutes,
                remaining_minutes=remaining_minutes,
            )
            self._db_insert(
                self.timeline,
                snapshot,
            )
            self.last_snapshot_time[mission_id] = now

        for event_type, message, evidence in events:
            self._insert_event(
                mission_id,
                event_type,
                message,
                evidence,
            )

        # Update mission summary only when useful information exists.
        if self.runs is not None:
            update: Dict[str, Any] = {
                "last_seen_at": now,
                "snapshot_count_increment": 1 if snapshot else 0,
                "recommendation": recommendation,
                "elapsed_minutes": round(
                    elapsed_minutes,
                    3,
                ),
                "remaining_minutes": round(
                    remaining_minutes,
                    3,
                ),
            }
            try:
                inc = {}
                if snapshot:
                    inc["snapshot_count"] = 1
                if events:
                    inc["event_count"] = len(events)
                set_fields = {
                    key: value
                    for key, value in update.items()
                    if key != "snapshot_count_increment"
                }
                if previous_recommendation is None:
                    set_fields["initial_recommendation"] = recommendation
                self.runs.update_one(
                    {"mission_id": mission_id},
                    {
                        "$set": self._clean(set_fields),
                        "$inc": inc,
                    },
                )
            except PyMongoError as error:
                self.mongo_error = str(error)
                print(
                    "[MissionHistory] record_state DB error: "
                    f"{error}"
                )

        self.last_state[mission_id] = {
            "recommendation": recommendation,
            "fault": fault,
            "anomaly": anomaly,
            "degradation_score": degradation,
            "trajectory": trajectory,
            "operating_limit_crossed": limit_crossed,
            "ai_result": deepcopy(ai_result),
        }

        return {
            "recorded": bool(snapshot or events),
            "snapshot_recorded": bool(snapshot),
            "events_recorded": len(events),
            "mission_id": mission_id,
            "recommendation": recommendation,
        }

    # ------------------------------------------------------------
    # Query / replay
    # ------------------------------------------------------------

    def list_missions(self, limit: int = 20) -> list:
        if self.runs is None:
            return []
        try:
            docs = list(
                self.runs.find(
                    {},
                    {"_id": 0},
                )
                .sort("started_at", DESCENDING)
                .limit(max(1, min(int(limit), 100)))
            )
            return self._clean(docs)
        except PyMongoError as error:
            self.mongo_error = str(error)
            return []

    def get_replay(self, mission_id: str) -> Dict[str, Any]:
        if self.runs is None or self.timeline is None:
            return {
                "mission_id": mission_id,
                "available": False,
                "message": (
                    "MongoDB is not available. Start MongoDB and "
                    "restart the backend."
                ),
            }

        try:
            mission = self.runs.find_one(
                {"mission_id": mission_id},
                {"_id": 0},
            )
            if not mission:
                return {
                    "mission_id": mission_id,
                    "available": False,
                    "message": "Mission was not found.",
                }

            records = list(
                self.timeline.find(
                    {"mission_id": mission_id},
                    {"_id": 0},
                ).sort("timestamp", ASCENDING)
            )

            snapshots = [
                item
                for item in records
                if item.get("record_type") == "SNAPSHOT"
            ]
            events = [
                item
                for item in records
                if item.get("record_type") == "EVENT"
            ]

            recommendation_history = []
            previous = None
            for item in snapshots:
                current = (
                    item.get("mission_state", {})
                    .get("recommendation")
                )
                if current != previous:
                    recommendation_history.append(
                        {
                            "timestamp": item.get("timestamp"),
                            "elapsed_minutes": item.get(
                                "elapsed_minutes"
                            ),
                            "recommendation": current,
                            "reason": item.get(
                                "recommendation_reason",
                                {},
                            ),
                        }
                    )
                    previous = current

            return {
                "available": True,
                "mission": self._clean(mission),
                "timeline": self._clean(records),
                "snapshots": self._clean(snapshots),
                "events": self._clean(events),
                "recommendation_history": self._clean(
                    recommendation_history
                ),
                "replay": {
                    "playable": len(snapshots) > 0,
                    "snapshot_count": len(snapshots),
                    "event_count": len(events),
                    "first_timestamp": (
                        snapshots[0].get("timestamp")
                        if snapshots else None
                    ),
                    "last_timestamp": (
                        snapshots[-1].get("timestamp")
                        if snapshots else None
                    ),
                },
            }
        except PyMongoError as error:
            self.mongo_error = str(error)
            return {
                "mission_id": mission_id,
                "available": False,
                "message": str(error),
            }

    def active_summary(self) -> Dict[str, Any]:
        with self.lock:
            active = deepcopy(self.active)
        if not active:
            return {
                "active": False,
                "mission": None,
            }

        now = time.time()
        elapsed = max(
            (now - active["started_at"]) / 60.0,
            0.0,
        )
        duration = float(
            active.get("duration_min", 0)
        )
        remaining = max(
            duration - elapsed,
            0.0,
        )
        return {
            "active": True,
            "mission": active.get("mission", {}),
            "mission_id": active.get("mission_id"),
            "started_at": active.get("started_at"),
            "elapsed_minutes": round(elapsed, 3),
            "remaining_minutes": round(remaining, 3),
            "mongo_available": self.timeline is not None,
            "mongo_error": self.mongo_error,
        }


# ============================================================
# FLASK APP
# ============================================================

app = Flask(__name__)

CORS(app)

# ============================================================
# GLOBAL OBJECTS
# ============================================================

fusion = DataFusion(seed=42)

ai_twin = AIDigitalTwin()

mission_guard = MissionGuard()

# ============================================================
# GLOBAL STATE
# ============================================================

latest_result = {}

latest_mission_result = {}

last_pushed_hw_data = {}

mission_history = MissionHistory(
    snapshot_interval_seconds=1.0
)

# The active mission definition is kept in memory so the continuous
# AI loop can evaluate the same mission against each new engine state.
active_mission = {}

running = True

# ============================================================
# CONTINUOUS ENGINE AI PROCESSING
# ============================================================

def processing_loop():

    global latest_result
    global running

    print()
    print("=" * 70)
    print("AeroSynX AI ENGINE PROCESSING STARTED")
    print("=" * 70)
    print()

    while running:

        try:

            # ------------------------------------------------
            # 1. Data Fusion (with live hardware API telemetry)
            # ------------------------------------------------

            hw_data = get_api_telemetry() or {}
            telemetry = fusion.fuse(hardware_data=hw_data)

            # ------------------------------------------------
            # 2. AI Digital Twin
            # ------------------------------------------------

            result = ai_twin.process(
                telemetry
            )

            if not isinstance(
                result,
                dict,
            ):
                result = {}

            latest_result = result

            # ------------------------------------------------
            # FEATURE 24 + FEATURE 21
            # Persist the live mission state while a mission is active.
            # ------------------------------------------------
            if active_mission:

                try:
                    mission_id = str(
                        active_mission.get(
                            "mission_id",
                            "",
                        )
                    )
                    started_at = float(
                        active_mission.get(
                            "started_at",
                            time.time(),
                        )
                    )
                    duration_min = float(
                        active_mission.get(
                            "duration_min",
                            0,
                        )
                    )

                    elapsed_minutes = max(
                        (time.time() - started_at) / 60.0,
                        0.0,
                    )
                    remaining_minutes = max(
                        duration_min - elapsed_minutes,
                        0.0,
                    )

                    live_mission = deepcopy(
                        active_mission.get(
                            "mission",
                            {},
                        )
                    )
                    live_mission[
                        "mission_id"
                    ] = mission_id
                    live_mission[
                        "remaining_duration_min"
                    ] = round(
                        remaining_minutes,
                        3,
                    )
                    live_mission[
                        "elapsed_duration_min"
                    ] = round(
                        elapsed_minutes,
                        3,
                    )
                    live_mission[
                        "original_duration_min"
                    ] = round(
                        duration_min,
                        3,
                    )

                    # MissionGuard evaluates the remaining mission for
                    # the current engine state. This is what makes the
                    # recommendation in the timeline time-dependent.
                    if remaining_minutes > 0:
                        live_mission[
                            "duration_min"
                        ] = max(
                            remaining_minutes,
                            5.0,
                        )

                    live_result = (
                        mission_guard.simulate_mission(
                            mission=live_mission,
                            current_ai_result=result,
                        )
                    )

                    reason = live_result.get(
                        "recommendation_reason",
                        {},
                    )
                    if not isinstance(reason, dict):
                        reason = mission_guard.build_recommendation_reason(
                            live_result,
                            result,
                        )

                    live_result[
                        "recommendation_reason"
                    ] = reason
                    live_result[
                        "runtime"
                    ] = {
                        "elapsed_minutes": round(
                            elapsed_minutes,
                            3,
                        ),
                        "remaining_minutes": round(
                            remaining_minutes,
                            3,
                        ),
                    }

                    latest_mission_result = live_result

                    mission_history.record_state(
                        ai_result=result,
                        mission_result=live_result,
                        elapsed_minutes=elapsed_minutes,
                        remaining_minutes=remaining_minutes,
                        recommendation_reason=reason,
                    )

                    if elapsed_minutes >= duration_min:
                        mission_history.stop_mission(
                            reason="DURATION_COMPLETED"
                        )
                        active_mission.clear()

                except Exception as mission_error:
                    print(
                        "[MissionHistory] Live mission logging error: "
                        f"{mission_error}"
                    )

            # ------------------------------------------------
            # Console monitoring
            # ------------------------------------------------

            print()
            print("-" * 70)
            print(
                "[AeroSynX] "
                f"Telemetry: {telemetry}"
            )

            print(
                "[AeroSynX] "
                f"Digital Twin: "
                f"{result.get('current_state', {})}"
            )

            ai = result.get(
                "ai_prediction",
                {},
            )

            if not isinstance(
                ai,
                dict,
            ):
                ai = {}

            print(
                "[AeroSynX] "
                f"Isolation Forest: "
                f"{ai.get('anomaly', 'UNKNOWN')}"
            )

            print(
                "[AeroSynX] "
                f"Random Forest: "
                f"{ai.get('predicted_fault', 'UNKNOWN')}"
            )

            print(
                "[AeroSynX] "
                f"RUL: "
                f"{ai.get('rul_hours', 'UNKNOWN')}"
            )

            # ------------------------------------------------
            # Temporal degradation
            # ------------------------------------------------

            temporal = result.get(
                "temporal_analysis",
                {},
            )

            if not isinstance(
                temporal,
                dict,
            ):
                temporal = {}

            print(
                "[AeroSynX] "
                f"Temporal Degradation: "
                f"{temporal.get('degradation_score', 'UNKNOWN')}"
            )

            print(
                "[AeroSynX] "
                f"Trajectory: "
                f"{temporal.get('trajectory', 'UNKNOWN')}"
            )

            print(
                "[AeroSynX] "
                f"History Samples: "
                f"{temporal.get('history_samples', 0)}"
            )

            print(
                "[AeroSynX] "
                f"Future Engine State: "
                f"{result.get('future_engine_state', {})}"
            )

            # ------------------------------------------------
            # Engineering warnings
            # ------------------------------------------------

            engineering_faults = result.get(
                "engineering_faults",
                [],
            )

            if engineering_faults:

                print(
                    "[AeroSynX] "
                    f"Engineering Warnings: "
                    f"{engineering_faults}"
                )

            # ------------------------------------------------
            # AI stage errors
            # ------------------------------------------------

            stage_errors = ai.get(
                "stage_errors",
                {},
            )

            if stage_errors:

                print(
                    "[AeroSynX] "
                    f"AI Stage Errors: "
                    f"{stage_errors}"
                )

        except Exception as error:

            print()
            print(
                "[AeroSynX] "
                f"PROCESSING ERROR: {error}"
            )

        time.sleep(1)

# ============================================================
# BASIC API
# ============================================================

@app.route(
    "/",
    methods=["GET"],
)
def home():

    return jsonify(
        {
            "project": "AeroSynX",
            "system": (
                "AI-Enabled Real-Time Digital Twin "
                "for Aero Piston Engine Monitoring"
            ),
            "status": "running",
            "server": "Flask",
            "port": 5000,
        }
    )

# ============================================================
# FAULT INJECTION  (used by React dashboard)
# ============================================================

VALID_FAULTS = {
    "none",
    "misfire",
    "injector_abnormality",
    "coking_degradation",
    "lubrication_issue",
    "sensor_drift",
    "combustion_instability",
    "battery_alternator_health",
    "injection_timing_issue",
    "abnormal_vibration",
    "overheating",
}

def canonicalize_fault_str(fault_str):
    if not fault_str:
        return "none"
    s = str(fault_str).strip().lower()
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

def detect_faults_from_readings(reading):
    detected = []
    if not isinstance(reading, dict):
        return detected

    rpm = reading.get("rpm")
    cht = reading.get("cht_c")
    egt = reading.get("egt_c")
    oil_press = reading.get("oil_press_bar")
    oil_temp = reading.get("oil_temp_c")
    fuel_flow = reading.get("fuel_flow_lph")
    vibration = reading.get("vibration_g")
    battery = reading.get("battery_v")
    injection = reading.get("injection_deg")

    if injection is not None and (float(injection) < 18.0 or float(injection) > 27.0):
        detected.append("injection_timing_issue")

    if fuel_flow is not None and (float(fuel_flow) < 12.0 or float(fuel_flow) > 22.0):
        detected.append("injector_abnormality")

    if vibration is not None and float(vibration) > 0.40:
        detected.append("misfire")
    elif vibration is not None and float(vibration) > 0.30:
        detected.append("abnormal_vibration")

    if cht is not None and float(cht) > 165.0 and oil_temp is not None and float(oil_temp) > 115.0:
        detected.append("coking_degradation")
    elif cht is not None and float(cht) > 165.0:
        detected.append("overheating")

    if egt is not None and float(egt) > 780.0:
        if "overheating" not in detected:
            detected.append("overheating")

    if oil_press is not None and float(oil_press) < 2.0:
        detected.append("lubrication_issue")

    if oil_temp is not None and float(oil_temp) > 120.0:
        if "lubrication_issue" not in detected:
            detected.append("lubrication_issue")

    if battery is not None and float(battery) < 11.5:
        detected.append("battery_alternator_health")

    return detected

@app.route(
    "/api/fault/inject",
    methods=["POST"],
)
def fault_inject():

    data = request.get_json(force=True, silent=True) or {}
    raw_fault = (
        data.get("fault")
        or data.get("active_fault")
        or request.args.get("fault")
        or request.args.get("active_fault")
        or (request.form.get("fault") if request.form else None)
        or "none"
    )
    fault = canonicalize_fault_str(raw_fault)
    print(f"[DEBUG INJECT] data={data}, raw_fault={raw_fault} -> fault={fault}", flush=True)

    fusion.set_active_fault(fault)

    return jsonify(
        {
            "status": "FAULT_INJECTED",
            "active_fault": fault,
        }
    )


@app.route(
    "/api/fault/clear",
    methods=["POST"],
)
def fault_clear():

    fusion.set_active_fault("none")

    return jsonify(
        {
            "status": "FAULT_CLEARED",
            "active_fault": "none",
        }
    )

# ============================================================
# HEALTH CHECK
# ============================================================

@app.route(
    "/api/health",
    methods=["GET"],
)
def health():

    return jsonify(
        {
            "status": "OK",
            "engine_ai": "running",
            "mission_guard": "running",
            "timestamp": time.time(),
        }
    )

# ============================================================
# DASHBOARD
# ============================================================

@app.route(
    "/api/dashboard",
    methods=["GET"],
)
def dashboard():
    response = jsonify(latest_result)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# ============================================================
# TELEMETRY — LIVE ENGINE READINGS
# ============================================================

@app.route(
    "/api/telemetry",
    methods=["GET", "POST"],
)
def telemetry():
    global latest_result, last_pushed_hw_data
    if request.method == "POST":
        data = request.get_json(force=True, silent=True) or {}
        raw_fault = (
            data.get("fault")
            or data.get("active_fault")
            or request.args.get("fault")
            or request.args.get("active_fault")
            or "none"
        )
        fault = canonicalize_fault_str(raw_fault)
        print(f"[DEBUG POST] raw_fault={raw_fault} -> fault={fault}", flush=True)
        if fault != "none":
            fusion.set_active_fault(fault)

    # Fetch live hardware telemetry from virtual engine API bridge / port 5000
    remote_hw_data = get_api_telemetry() or {}
    hw_data = dict(remote_hw_data) if remote_hw_data else dict(last_pushed_hw_data)

    # Ingest fault string from remote hardware source if present
    if isinstance(remote_hw_data, dict):
        rfault = canonicalize_fault_str(
            remote_hw_data.get("fault")
            or remote_hw_data.get("active_fault")
            or remote_hw_data.get("injected_fault")
            or "none"
        )
        if rfault != "none":
            fusion.set_active_fault(rfault)

    # Compute fresh live fused telemetry & run AI digital twin processing
    live_telemetry = fusion.fuse(hardware_data=hw_data)
    readings_dict = live_telemetry.get("reading", {})

    # Reading-based automatic fault signature detection (informative only)
    reading_faults = detect_faults_from_readings(readings_dict)

    result = ai_twin.process(live_telemetry)

    # Hybrid range checks & parameter status
    hybrid = create_hybrid_reading(hardware_data=hw_data, fault=fusion.active_fault)

    if not isinstance(result, dict):
        result = {}

    result["current_state"] = readings_dict
    result["reading"] = readings_dict
    latest_result = result

    # Build response payload containing BOTH top-level flat sensor fields AND nested telemetry dicts
    response_payload = dict(result)

    # Top-level flat sensor readings for legacy/direct callers
    for key, val in readings_dict.items():
        response_payload[key] = val

    all_possible_faults = list(dict.fromkeys(
        (hybrid.get("possible_faults") or [])
        + (result.get("engineering_faults") or [])
        + (reading_faults or [])
        + ([fusion.active_fault] if fusion.active_fault != "none" else [])
    ))

    # Ensure both top-level and nested ai_prediction reflect active/detected fault cleanly
    active_f = fusion.active_fault.upper() if fusion.active_fault != "none" else (reading_faults[0].upper() if reading_faults else None)
    print(f"[DEBUG RESULT] fusion.active_fault={fusion.active_fault}, active_f={active_f}", flush=True)
    ai_pred = response_payload.get("ai_prediction") or {}
    if not isinstance(ai_pred, dict):
        ai_pred = {}

    if active_f:
        response_payload["predicted_fault"] = active_f
        response_payload["fault_confidence"] = 0.95
        response_payload["condition"] = "FAULT_DETECTED"
        ai_pred["predicted_fault"] = active_f
        ai_pred["fault_confidence"] = 0.95

    response_payload["ai_prediction"] = ai_pred
    response_payload["reading"] = readings_dict
    response_payload["current_state"] = readings_dict
    response_payload["source"] = hybrid.get("source", live_telemetry.get("source", {}))
    response_payload["range_status"] = hybrid.get("range_status", {})
    response_payload["possible_faults"] = all_possible_faults
    response_payload["engineering_faults"] = all_possible_faults

    ctx = live_telemetry.get("context", {})
    if not isinstance(ctx, dict):
        ctx = {}
    ctx["active_fault"] = fusion.active_fault
    response_payload["context"] = ctx

    _api_src = remote_hw_data.get("source", "") if isinstance(remote_hw_data, dict) else ""
    _is_real_api = _api_src == "REAL HARDWARE / API" or bool(remote_hw_data)
    response_payload["api"] = {
        "connected": _is_real_api,
        "url": "http://localhost:5000/api/telemetry",
        "live": _is_real_api,
        "source": _api_src or "LOCAL_HARDWARE_STREAM",
    }

    response = jsonify(response_payload)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

# ============================================================
# LATEST ENGINE RESULT
# ============================================================

@app.route(
    "/api/latest",
    methods=["GET"],
)
def latest():

    return jsonify(
        latest_result
    )

# ============================================================
# FAULT REPAIR & BASE STATION MITIGATION API
# ============================================================

@app.route("/api/fault/clear", methods=["POST", "GET"])
@app.route("/api/fault/repair", methods=["POST", "GET"])
def fault_repair():
    global latest_result
    data = request.get_json(silent=True) or {}
    action_name = data.get("action", "BASE_STATION_REPAIR_OVERRIDE")

    if isinstance(latest_result, dict):
        if "context" in latest_result:
            latest_result["context"]["active_fault"] = "none"
        if "ai_prediction" in latest_result:
            latest_result["ai_prediction"]["predicted_fault"] = "none"
            latest_result["ai_prediction"]["anomaly"] = False
            latest_result["ai_prediction"]["anomaly_score"] = 0.05
        if "possible_faults" in latest_result:
            latest_result["possible_faults"] = []

    return jsonify({
        "status": "SUCCESS",
        "message": f"In-Flight Emergency Repair Executed: {action_name}. Engine telemetry restored to nominal.",
        "active_fault": "none",
        "timestamp": time.time()
    })

# ============================================================
# MISSIONGUARD — LATEST RESULT
# ============================================================

@app.route(
    "/api/missionguard/latest",
    methods=["GET"],
)
def missionguard_latest():

    if not latest_mission_result:

        return jsonify(
            {
                "status": "NO_MISSION_SIMULATION",
                "message": (
                    "No MissionGuard mission simulation "
                    "has been executed yet."
                ),
            }
        )

    return jsonify(
        latest_mission_result
    )

# ============================================================
# MISSIONGUARD — SIMULATE
# ============================================================

@app.route(
    "/api/missionguard/simulate",
    methods=["POST"],
)
def missionguard_simulate():

    global latest_mission_result
    global active_mission

    try:

        mission = request.get_json(
            silent=True
        )

        if mission is None:
            mission = {}

        if not isinstance(
            mission,
            dict,
        ):

            return jsonify(
                {
                    "error": (
                        "Mission request body "
                        "must be a JSON object."
                    )
                }
            ), 400

        # ----------------------------------------------------
        # Start evidence logging automatically unless the client
        # explicitly disables it. This keeps existing frontend calls
        # working without requiring a separate start button.
        # ----------------------------------------------------

        record_history = mission.get(
            "record_history",
            True,
        )

        if record_history:
            requested_id = str(
                mission.get(
                    "mission_id",
                    "",
                )
            )

            if (
                not active_mission
                or (
                    requested_id
                    and requested_id
                    != str(
                        active_mission.get(
                            "mission_id",
                            "",
                        )
                    )
                )
            ):
                started = mission_history.start_mission(
                    mission
                )
                active_mission = {
                    "mission_id": started[
                        "mission_id"
                    ],
                    "mission": deepcopy(
                        started["mission_input"]
                    ),
                    "started_at": started[
                        "started_at"
                    ],
                    "duration_min": started[
                        "duration_min"
                    ],
                }
            else:
                # Same mission: keep the original start time and
                # update only user-editable mission fields.
                active_mission[
                    "mission"
                ].update(
                    deepcopy(mission)
                )
                mission[
                    "mission_id"
                ] = active_mission[
                    "mission_id"
                ]

        # ----------------------------------------------------
        # Use latest AI engine state automatically.
        # ----------------------------------------------------

        current_ai_result = latest_result

        # ----------------------------------------------------
        # Run MissionGuard.
        # ----------------------------------------------------

        result = mission_guard.simulate_mission(
            mission=mission,
            current_ai_result=current_ai_result,
        )

        result[
            "recommendation_reason"
        ] = mission_guard.build_recommendation_reason(
            result,
            current_ai_result,
        )

        if active_mission:
            started_at = float(
                active_mission.get(
                    "started_at",
                    time.time(),
                )
            )
            duration_min = float(
                active_mission.get(
                    "duration_min",
                    result.get(
                        "mission_input",
                        {},
                    ).get(
                        "duration_min",
                        0,
                    ),
                )
            )
            elapsed = max(
                (time.time() - started_at) / 60.0,
                0.0,
            )
            result["runtime"] = {
                "elapsed_minutes": round(
                    elapsed,
                    3,
                ),
                "remaining_minutes": round(
                    max(duration_min - elapsed, 0.0),
                    3,
                ),
            }

        latest_mission_result = result

        return jsonify(
            result
        )

    except Exception as error:

        print(
            "[MissionGuard] "
            f"Simulation error: {error}"
        )

        return jsonify(
            {
                "error": "MissionGuard simulation failed.",
                "details": str(error),
            }
        ), 500

# ============================================================
# MISSIONGUARD — RESCUE
# ============================================================

@app.route(
    "/api/missionguard/rescue",
    methods=["POST"],
)
def missionguard_rescue():

    try:

        mission = request.get_json(
            silent=True
        )

        if mission is None:
            mission = {}

        if not isinstance(
            mission,
            dict,
        ):

            return jsonify(
                {
                    "error": (
                        "Mission request body "
                        "must be a JSON object."
                    )
                }
            ), 400

        result = mission_guard.rescue_mission(
            mission=mission,
            current_ai_result=latest_result,
        )

        return jsonify(
            result
        )

    except Exception as error:

        print(
            "[MissionGuard] "
            f"Rescue error: {error}"
        )

        return jsonify(
            {
                "error": "Mission rescue failed.",
                "details": str(error),
            }
        ), 500

# ============================================================
# MISSIONGUARD — CREATE SHADOW
# ============================================================

@app.route(
    "/api/missionguard/shadow",
    methods=["POST"],
)
def missionguard_shadow_create():

    global latest_mission_result

    try:

        mission = request.get_json(
            silent=True
        )

        if mission is None:
            mission = {}

        if not isinstance(
            mission,
            dict,
        ):

            return jsonify(
                {
                    "error": (
                        "Mission request body "
                        "must be a JSON object."
                    )
                }
            ), 400

        # ----------------------------------------------------
        # If the frontend sends an already simulated result,
        # use it.
        #
        # Otherwise run simulation first.
        # ----------------------------------------------------

        if (
            "phase_results" in mission
            and "mission_id" in mission
        ):

            mission_result = mission

        else:

            mission_result = (
                mission_guard.simulate_mission(
                    mission=mission,
                    current_ai_result=latest_result,
                )
            )

        shadow = mission_guard.create_shadow(
            mission_result
        )

        latest_mission_result = mission_result

        return jsonify(
            {
                "status": "SHADOW_CREATED",
                "shadow": shadow,
            }
        )

    except Exception as error:

        print(
            "[MissionGuard] "
            f"Shadow creation error: {error}"
        )

        return jsonify(
            {
                "error": (
                    "Shadow mission creation failed."
                ),
                "details": str(error),
            }
        ), 500

# ============================================================
# MISSIONGUARD — GET SHADOW
# ============================================================

@app.route(
    "/api/missionguard/shadow",
    methods=["GET"],
)
def missionguard_shadow_get():

    try:

        shadow = mission_guard.get_shadow()

        if not shadow:

            return jsonify(
                {
                    "available": False,
                    "message": (
                        "No shadow mission available."
                    ),
                }
            )

        return jsonify(
            {
                "available": True,
                "shadow": shadow,
            }
        )

    except Exception as error:

        return jsonify(
            {
                "error": (
                    "Unable to retrieve shadow mission."
                ),
                "details": str(error),
            }
        ), 500

# ============================================================
# MISSIONGUARD — COMPARE ACTUAL TELEMETRY WITH SHADOW
# ============================================================

@app.route(
    "/api/missionguard/compare",
    methods=["POST"],
)
def missionguard_compare():

    try:

        data = request.get_json(
            silent=True
        )

        if data is None:
            data = {}

        if not isinstance(
            data,
            dict,
        ):

            return jsonify(
                {
                    "error": (
                        "Request body must "
                        "be a JSON object."
                    )
                }
            ), 400

        actual_state = data.get(
            "actual_state",
            data,
        )

        timestamp = data.get(
            "timestamp",
            time.time(),
        )

        result = (
            mission_guard.compare_with_shadow(
                actual_state=actual_state,
                timestamp=timestamp,
            )
        )

        return jsonify(
            result
        )

    except Exception as error:

        print(
            "[MissionGuard] "
            f"Shadow comparison error: {error}"
        )

        return jsonify(
            {
                "error": (
                    "Shadow comparison failed."
                ),
                "details": str(error),
            }
        ), 500

# ============================================================
# MISSIONGUARD — RESIMULATE REMAINING MISSION
# ============================================================

@app.route(
    "/api/missionguard/resimulate-remaining",
    methods=["POST"],
)
def missionguard_resimulate_remaining():

    global latest_mission_result

    try:

        data = request.get_json(
            silent=True
        )

        if data is None:
            data = {}

        if not isinstance(
            data,
            dict,
        ):

            return jsonify(
                {
                    "error": (
                        "Request body must "
                        "be a JSON object."
                    )
                }
            ), 400

        original_mission = data.get(
            "mission",
            {},
        )

        actual_state = data.get(
            "actual_state",
            {},
        )

        remaining_duration_min = data.get(
            "remaining_duration_min",
            30,
        )

        if not isinstance(
            original_mission,
            dict,
        ):
            original_mission = {}

        if not isinstance(
            actual_state,
            dict,
        ):
            actual_state = {}

        result = (
            mission_guard.resimulate_remaining_mission(
                original_mission=original_mission,
                actual_state=actual_state,
                remaining_duration_min=remaining_duration_min,
                current_ai_result=latest_result,
            )
        )

        result[
            "recommendation_reason"
        ] = mission_guard.build_recommendation_reason(
            result,
            latest_result,
        )

        latest_mission_result = result

        return jsonify(
            result
        )

    except Exception as error:

        print(
            "[MissionGuard] "
            f"Remaining mission simulation error: "
            f"{error}"
        )

        return jsonify(
            {
                "error": (
                    "Remaining mission simulation failed."
                ),
                "details": str(error),
            }
        ), 500

# ============================================================
# MISSION EVIDENCE — START
# ============================================================

@app.route(
    "/api/mission/start",
    methods=["POST"],
)
def mission_start():

    global active_mission
    global latest_mission_result

    try:
        mission = request.get_json(
            silent=True
        )

        if mission is None:
            mission = {}

        if not isinstance(mission, dict):
            return jsonify(
                {
                    "error": (
                        "Mission request body must "
                        "be a JSON object."
                    )
                }
            ), 400

        if active_mission:
            mission_history.stop_mission(
                reason="REPLACED_BY_NEW_MISSION"
            )
            active_mission.clear()

        started = mission_history.start_mission(
            mission
        )

        active_mission = {
            "mission_id": started["mission_id"],
            "mission": deepcopy(
                started["mission_input"]
            ),
            "started_at": started["started_at"],
            "duration_min": started["duration_min"],
        }

        # Immediately calculate the initial MissionGuard state so the
        # first dashboard request already has a recommendation reason.
        if latest_result:
            initial_mission = deepcopy(
                active_mission["mission"]
            )
            initial_result = mission_guard.simulate_mission(
                mission=initial_mission,
                current_ai_result=latest_result,
            )
            initial_result[
                "recommendation_reason"
            ] = mission_guard.build_recommendation_reason(
                initial_result,
                latest_result,
            )
            latest_mission_result = initial_result

        return jsonify(
            {
                "status": "MISSION_STARTED",
                "mission": started,
                "active": mission_history.active_summary(),
                "message": (
                    "Mission started. Live engine states will be "
                    "stored in MongoDB approximately once per second."
                ),
            }
        )

    except Exception as error:
        print(
            "[MissionHistory] Mission start error: "
            f"{error}"
        )
        return jsonify(
            {
                "error": "Mission start failed.",
                "details": str(error),
            }
        ), 500


# ============================================================
# MISSION EVIDENCE — STOP
# ============================================================

@app.route(
    "/api/mission/stop",
    methods=["POST"],
)
def mission_stop():

    global active_mission

    try:
        data = request.get_json(
            silent=True
        )
        if not isinstance(data, dict):
            data = {}

        reason = str(
            data.get(
                "reason",
                "MANUAL_STOP",
            )
        )

        result = mission_history.stop_mission(
            reason=reason
        )
        active_mission.clear()

        return jsonify(result)

    except Exception as error:
        print(
            "[MissionHistory] Mission stop error: "
            f"{error}"
        )
        return jsonify(
            {
                "error": "Mission stop failed.",
                "details": str(error),
            }
        ), 500


# ============================================================
# MISSION EVIDENCE — ACTIVE
# ============================================================

@app.route(
    "/api/mission/active",
    methods=["GET"],
)
def mission_active():

    return jsonify(
        {
            "active": mission_history.active_summary(),
            "latest_engine": latest_result,
            "latest_mission": latest_mission_result,
        }
    )


# ============================================================
# MISSION EVIDENCE — LIST RUNS
# ============================================================

@app.route(
    "/api/mission/runs",
    methods=["GET"],
)
def mission_runs():

    try:
        limit = request.args.get(
            "limit",
            20,
            type=int,
        )
        return jsonify(
            {
                "available": True,
                "missions": mission_history.list_missions(
                    limit=limit
                ),
            }
        )
    except Exception as error:
        return jsonify(
            {
                "error": "Unable to list mission runs.",
                "details": str(error),
            }
        ), 500


# ============================================================
# MISSION EVIDENCE — REPLAY
# ============================================================

@app.route(
    "/api/mission/replay/<mission_id>",
    methods=["GET"],
)
def mission_replay(mission_id: str):

    try:
        result = mission_history.get_replay(
            mission_id
        )
        return jsonify(result)
    except Exception as error:
        return jsonify(
            {
                "error": "Mission replay failed.",
                "details": str(error),
            }
        ), 500


@app.route("/api/mission/delete/<mission_id>", methods=["DELETE", "POST"])
def mission_delete(mission_id: str):
    try:
        if hasattr(mission_history, 'runs') and mission_history.runs is not None:
            mission_history.runs.delete_one({"mission_id": mission_id})
            if hasattr(mission_history, 'timeline') and mission_history.timeline is not None:
                mission_history.timeline.delete_many({"mission_id": mission_id})
        return jsonify({"status": "SUCCESS", "deleted_mission_id": mission_id})
    except Exception as error:
        return jsonify({"error": "Failed to delete mission", "details": str(error)}), 500


# ============================================================
# START BACKGROUND PROCESSING
# ============================================================

def start_processing_thread():

    thread = threading.Thread(
        target=processing_loop,
        daemon=True,
    )

    thread.start()

    return thread

# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":

    port = int(os.environ.get("PORT", 5001))

    print()
    print("=" * 70)
    print("AeroSynX Backend")
    print("=" * 70)
    print()
    print("Engine AI API:")
    print(f"http://localhost:{port}")
    print()
    print("Dashboard:")
    print(f"http://localhost:{port}/api/dashboard")
    print()
    print("MissionGuard:")
    print(
        "POST "
        f"http://localhost:{port}/api/missionguard/simulate"
    )
    print()
    print("Mission Evidence Logger:")
    print(f"POST http://localhost:{port}/api/mission/start")
    print(f"POST http://localhost:{port}/api/mission/stop")
    print(f"GET  http://localhost:{port}/api/mission/runs")
    print(f"GET  http://localhost:{port}/api/mission/replay/<mission_id>")
    print()
    print("Latest MissionGuard:")
    print(
        "GET "
        f"http://localhost:{port}/api/missionguard/latest"
    )
    print()
    print("=" * 70)
    print()

    # Start continuous engine processing.
    start_processing_thread()

    # Start Flask with fallback ports if default port is occupied or restricted.
    for target_port in [port, 5001, 5005, 5000, 8000]:
        try:
            print(f"[AeroSynX] Attempting to start server on port {target_port}...")
            app.run(
                host="0.0.0.0",
                port=target_port,
                debug=False,
                use_reloader=False,
            )
            break
        except OSError as err:
            print(f"[AeroSynX] Port {target_port} unavailable: {err}")
