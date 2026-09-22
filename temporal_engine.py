"""
AeroSynX Temporal Degradation and Future Engine-State Layer.

This layer intentionally does NOT replace:
    Isolation Forest
    Random Forest fault classifier
    existing RUL Random Forest

It adds time-awareness around those models.

Because the supplied engine_data.csv is mostly tabular and does not contain
a true timestamp/sequence identifier, this implementation does NOT pretend
that an LSTM/Transformer was trained on real degradation trajectories.

Instead it performs:
    1. rolling history
    2. exponential smoothing
    3. robust trend/slope estimation
    4. residual-trend analysis
    5. degradation direction
    6. short-horizon future-state projection

Once genuine time-ordered engine runs are available, this class can be
replaced/extended with a trained temporal model without changing the
AIDigitalTwin API.
"""

from __future__ import annotations

import math
import time
from collections import deque
from typing import Any, Dict, List, Optional

import numpy as np


TRACKED_FIELDS = [
    "rpm",
    "cht_c",
    "egt_c",
    "oil_press_bar",
    "oil_temp_c",
    "fuel_flow_lph",
    "vibration_g",
    "battery_v",
    "injection_deg",
    "current_a",
]

RESIDUAL_FIELDS = [
    "cht_residual",
    "egt_residual",
    "oil_pressure_residual",
    "oil_temp_residual",
    "fuel_flow_residual",
    "vibration_residual",
    "battery_residual",
    "injection_residual",
]

# Scale values are prototype normalization constants, not certified limits.
RESIDUAL_SCALE = {
    "cht_residual": 25.0,
    "egt_residual": 100.0,
    "oil_pressure_residual": 1.5,
    "oil_temp_residual": 25.0,
    "fuel_flow_residual": 5.0,
    "vibration_residual": 0.20,
    "battery_residual": 1.0,
    "injection_residual": 5.0,
}

# For these channels, a negative residual is generally the concerning
# direction rather than a positive residual.
NEGATIVE_IS_WORSE = {
    "oil_pressure_residual",
    "battery_residual",
}


def _finite(value: Any) -> Optional[float]:
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def _clip(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


class TemporalDegradationEngine:
    def __init__(
        self,
        max_history: int = 180,
        min_history: int = 8,
        future_minutes: Optional[List[float]] = None,
    ) -> None:
        self.max_history = max_history
        self.min_history = min_history
        self.future_minutes = future_minutes or [5.0, 10.0, 15.0, 20.0]

        self.history: deque = deque(maxlen=max_history)
        self.last_timestamp: Optional[float] = None
        self.ema: Dict[str, float] = {}
        self.previous_degradation: Optional[float] = None

    def reset(self) -> None:
        self.history.clear()
        self.last_timestamp = None
        self.ema.clear()
        self.previous_degradation = None

    def _timestamp(self, timestamp: Any) -> float:
        if timestamp is None:
            return time.time()

        if isinstance(timestamp, (int, float)):
            return float(timestamp)

        # ISO timestamps such as 2026-09-20T10:30:00+05:30
        try:
            from datetime import datetime
            return datetime.fromisoformat(
                str(timestamp).replace("Z", "+00:00")
            ).timestamp()
        except Exception:
            return time.time()

    def _update_ema(self, field: str, value: float, alpha: float = 0.25) -> float:
        if field not in self.ema:
            self.ema[field] = value
        else:
            self.ema[field] = alpha * value + (1.0 - alpha) * self.ema[field]
        return self.ema[field]

    def _append(
        self,
        timestamp: Any,
        reading: Dict[str, Any],
        residuals: Dict[str, Any],
    ) -> None:
        ts = self._timestamp(timestamp)

        # Prevent duplicate/backward timestamps from corrupting slopes.
        if self.last_timestamp is not None and ts <= self.last_timestamp:
            ts = self.last_timestamp + 0.001

        self.last_timestamp = ts

        point = {"timestamp": ts}

        for field in TRACKED_FIELDS:
            value = _finite(reading.get(field))
            if value is not None:
                point[field] = self._update_ema(field, value)

        for field in RESIDUAL_FIELDS:
            value = _finite(residuals.get(field))
            if value is not None:
                point[field] = self._update_ema(field, value)

        self.history.append(point)

    def _slope_per_minute(self, field: str) -> Optional[float]:
        points = [
            (p["timestamp"], p[field])
            for p in self.history
            if field in p
        ]

        if len(points) < self.min_history:
            return None

        t = np.asarray([p[0] for p in points], dtype=float)
        y = np.asarray([p[1] for p in points], dtype=float)

        # Work in minutes and normalize time to avoid numerical issues.
        t = (t - t[-1]) / 60.0

        try:
            slope = float(np.polyfit(t, y, 1)[0])
            if not math.isfinite(slope):
                return None
            return slope
        except Exception:
            return None

    def _volatility(self, field: str) -> Optional[float]:
        values = [
            p[field]
            for p in self.history
            if field in p
        ]

        if len(values) < self.min_history:
            return None

        return float(np.std(values))

    def _trajectory_for_residual(
        self,
        residual_field: str,
        residual_value: Optional[float],
        slope: Optional[float],
    ) -> float:
        """
        Return a 0..1 deterioration contribution.

        0   -> little evidence of deterioration
        0.5 -> neutral
        1   -> strong evidence of worsening
        """
        scale = RESIDUAL_SCALE.get(residual_field, 1.0)

        if residual_value is None:
            magnitude = 0.5
        else:
            magnitude = min(abs(residual_value) / scale, 2.0) / 2.0

        if slope is None:
            trend = 0.5
        else:
            signed_slope = slope
            if residual_field in NEGATIVE_IS_WORSE:
                signed_slope = -signed_slope

            trend = 0.5 + 0.5 * math.tanh(
                signed_slope / max(scale * 0.15, 1e-9)
            )

        return _clip(0.65 * magnitude + 0.35 * trend, 0.0, 1.0)

    def _trajectory_summary(
        self,
        degradation_score: float,
        worsening_channels: int,
        improving_channels: int,
        volatility: float,
    ) -> str:
        if volatility > 0.65:
            return "VOLATILE"

        if worsening_channels >= max(2, improving_channels + 1):
            return "WORSENING"

        if improving_channels >= max(2, worsening_channels + 1):
            return "IMPROVING"

        if degradation_score >= 65:
            return "WORSENING"

        return "STABLE"

    def update(
        self,
        timestamp: Any,
        reading: Dict[str, Any],
        residuals: Dict[str, Any],
    ) -> Dict[str, Any]:

        self._append(timestamp, reading, residuals)

        sample_count = len(self.history)

        # Not enough history yet: do not fabricate a trend.
        if sample_count < self.min_history:
            return {
                "status": "INSUFFICIENT_HISTORY",
                "history_samples": sample_count,
                "trajectory": "UNKNOWN",
                "degradation_score": None,
                "degradation_delta": None,
                "channel_trends": {},
                "residual_trends": {},
                "future_engine_state": {},
                "future_projection_confidence": 0.0,
                "note": (
                    f"Collect at least {self.min_history} valid samples "
                    "before interpreting degradation trajectory."
                ),
            }

        channel_trends: Dict[str, Any] = {}
        residual_trends: Dict[str, Any] = {}

        worsening = 0
        improving = 0
        deterioration_contributions: List[float] = []

        for field in TRACKED_FIELDS:
            slope = self._slope_per_minute(field)
            vol = self._volatility(field)

            if slope is not None:
                channel_trends[field] = {
                    "slope_per_minute": round(slope, 6),
                    "ema_value": round(self.ema.get(field, 0.0), 6),
                    "volatility": round(vol or 0.0, 6),
                }

        for field in RESIDUAL_FIELDS:
            slope = self._slope_per_minute(field)
            latest = self.ema.get(field)

            if slope is not None:
                residual_trends[field] = {
                    "slope_per_minute": round(slope, 6),
                    "latest_residual": round(latest, 6) if latest is not None else None,
                    "scale": RESIDUAL_SCALE.get(field, 1.0),
                }

                contribution = self._trajectory_for_residual(
                    field,
                    latest,
                    slope,
                )
                deterioration_contributions.append(contribution)

                # Count only reasonably strong trend evidence.
                if contribution >= 0.65:
                    worsening += 1
                elif contribution <= 0.35:
                    improving += 1

        if deterioration_contributions:
            degradation_score = 100.0 * float(
                np.mean(deterioration_contributions)
            )
        else:
            degradation_score = 0.0

        # Smooth the overall score so one noisy sample does not flip the state.
        if self.previous_degradation is not None:
            degradation_score = (
                0.25 * degradation_score
                + 0.75 * self.previous_degradation
            )

        degradation_delta = (
            None
            if self.previous_degradation is None
            else degradation_score - self.previous_degradation
        )
        self.previous_degradation = degradation_score

        # Overall volatility from residual volatility.
        volatility_values = []
        for field in RESIDUAL_FIELDS:
            vol = self._volatility(field)
            scale = RESIDUAL_SCALE.get(field, 1.0)
            if vol is not None:
                volatility_values.append(min(vol / scale, 2.0) / 2.0)

        volatility = (
            float(np.mean(volatility_values))
            if volatility_values
            else 0.0
        )

        trajectory = self._trajectory_summary(
            degradation_score,
            worsening,
            improving,
            volatility,
        )

        # Future state is a short-horizon linear projection from smoothed data.
        future_engine_state = self._project_future(channel_trends)

        # Confidence increases with history but falls if volatility is high.
        history_confidence = min(
            1.0,
            sample_count / float(self.max_history),
        )
        confidence = _clip(
            history_confidence * (1.0 - 0.6 * volatility),
            0.0,
            1.0,
        )

        return {
            "status": "READY",
            "history_samples": sample_count,
            "trajectory": trajectory,
            "degradation_score": round(
                _clip(degradation_score, 0.0, 100.0),
                2,
            ),
            "degradation_delta": (
                round(degradation_delta, 3)
                if degradation_delta is not None
                else None
            ),
            "worsening_channels": worsening,
            "improving_channels": improving,
            "volatility_score": round(volatility, 3),
            "channel_trends": channel_trends,
            "residual_trends": residual_trends,
            "future_engine_state": future_engine_state,
            "future_projection_confidence": round(confidence, 3),
            "note": (
                "Future state is a modelled short-horizon trajectory "
                "from recent telemetry; it is not a certified failure-time prediction."
            ),
        }

    def _project_future(
        self,
        channel_trends: Dict[str, Any],
    ) -> Dict[str, Any]:

        latest = self.history[-1]

        result: Dict[str, Any] = {}

        for minutes in self.future_minutes:
            state = {}

            for field, info in channel_trends.items():
                current = latest.get(field)
                slope = info.get("slope_per_minute")

                if current is None or slope is None:
                    continue

                projected = float(current) + float(slope) * minutes

                # Basic physical non-negativity guard.
                if field in {
                    "rpm",
                    "oil_press_bar",
                    "oil_temp_c",
                    "fuel_flow_lph",
                    "vibration_g",
                    "battery_v",
                    "injection_deg",
                    "current_a",
                }:
                    projected = max(0.0, projected)

                state[field] = round(projected, 3)

            result[f"+{int(minutes)}min"] = {
                "minutes_ahead": minutes,
                "state": state,
                "method": "EMA + linear recent-trend projection",
            }

        return result
