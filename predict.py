
from __future__ import annotations

import os
from typing import Any, Dict, List, Optional

import joblib
import numpy as np
import pandas as pd

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "models")

MODEL_PATHS = {
    "anomaly_model": os.path.join(MODEL_DIR, "anomaly_model.pkl"),
    "fault_model": os.path.join(MODEL_DIR, "fault_model.pkl"),
    "rul_model": os.path.join(MODEL_DIR, "rul_model.pkl"),
    "fault_encoder": os.path.join(MODEL_DIR, "fault_encoder.pkl"),
    "features": os.path.join(MODEL_DIR, "features.pkl"),
}

FEATURE_ALIASES = {
    "rpm": ["rpm"],
    "load": ["load", "load_percent", "engine_load"],
    "ambient_temp": ["ambient_temp", "ambient_temperature"],
    "altitude": ["altitude", "altitude_ft"],
    "throttle": ["throttle", "throttle_percent"],
    "cht_c": ["cht_c", "cht", "cylinder_head_temperature"],
    "egt_c": ["egt_c", "egt", "exhaust_gas_temperature"],
    "oil_press_bar": [
        "oil_press_bar",
        "oil_pressure",
        "oil_pressure_bar",
    ],
    "oil_temp_c": [
        "oil_temp_c",
        "oil_temp",
        "oil_temperature",
    ],
    "fuel_flow_lph": [
        "fuel_flow_lph",
        "fuel_flow",
        "fuel_flow_rate",
    ],
    "vibration_g": [
        "vibration_g",
        "vibration",
        "vibration_level",
    ],
    "battery_v": [
        "battery_v",
        "battery",
        "voltage",
    ],
    "injection_deg": [
        "injection_deg",
        "injection",
        "injection_timing",
    ],
    "current_a": [
        "current_a",
        "current",
        "motor_current",
    ],
    "cht_residual": ["cht_residual"],
    "egt_residual": ["egt_residual"],
    "oil_pressure_residual": [
        "oil_pressure_residual",
        "oil_press_residual",
    ],
    "oil_temp_residual": ["oil_temp_residual"],
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


def _load_model(path: str) -> Any:
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"Model file not found: {path}"
        )
    return joblib.load(path)


class ModelBundle:

    def __init__(self) -> None:
        self.anomaly_model = None
        self.fault_model = None
        self.rul_model = None
        self.fault_encoder = None
        self.features: List[str] = []
        self.loaded = False
        self.load_error: Optional[str] = None
        self._load_models()

    def _load_models(self) -> None:
        try:
            self.anomaly_model = _load_model(
                MODEL_PATHS["anomaly_model"]
            )

            self.fault_model = _load_model(
                MODEL_PATHS["fault_model"]
            )

            self.rul_model = _load_model(
                MODEL_PATHS["rul_model"]
            )

            self.fault_encoder = _load_model(
                MODEL_PATHS["fault_encoder"]
            )

            self.features = _load_model(
                MODEL_PATHS["features"]
            )

            if not isinstance(
                self.features,
                (list, tuple)
            ):
                raise TypeError(
                    "features.pkl must contain a list or tuple"
                )

            self.features = list(self.features)
            self.loaded = True
            self.load_error = None

        except Exception as exc:
            self.loaded = False
            self.load_error = (
                f"{type(exc).__name__}: {exc}"
            )

    def reload(self) -> None:
        self.__init__()


MODELS = ModelBundle()


def _safe_float(
    value: Any,
) -> Optional[float]:

    try:
        if value is None:
            return None

        result = float(value)

        if not np.isfinite(result):
            return None

        return result

    except Exception:
        return None


def _aliases_for_feature(
    feature: str,
) -> List[str]:

    aliases = FEATURE_ALIASES.get(
        feature,
        [],
    )

    if feature not in aliases:
        aliases = [
            feature,
            *aliases,
        ]

    return aliases


def _find_value(
    data: Dict[str, Any],
    feature: str,
) -> Optional[float]:

    for key in _aliases_for_feature(feature):

        if key in data:

            value = _safe_float(
                data[key]
            )

            if value is not None:
                return value

    return None


def _make_frame(
    data: Dict[str, Any],
) -> pd.DataFrame:

    values: Dict[str, float] = {}
    missing: List[str] = []

    for feature in MODELS.features:

        value = _find_value(
            data,
            feature,
        )

        if value is None:
            missing.append(feature)
        else:
            values[feature] = value

    if missing:
        raise ValueError(
            "Missing model features: "
            + ", ".join(missing)
        )

    frame = pd.DataFrame(
        [
            [
                values[feature]
                for feature in MODELS.features
            ]
        ],
        columns=MODELS.features,
    )

    for column in frame.columns:
        frame[column] = pd.to_numeric(
            frame[column],
            errors="coerce",
        )

    if frame.isna().any().any():

        bad_columns = frame.columns[
            frame.isna().any()
        ].tolist()

        raise ValueError(
            "NaN detected in model input: "
            + ", ".join(bad_columns)
        )

    return frame


def _decode_fault_class(
    value: Any,
) -> str:

    try:

        if MODELS.fault_encoder is None:
            return str(value)

        decoded = (
            MODELS.fault_encoder
            .inverse_transform(
                np.asarray(
                    [int(value)],
                    dtype=int,
                )
            )
        )

        return str(decoded[0])

    except Exception:
        return f"UNKNOWN_CLASS_{value}"


def _fault_probabilities(
    frame: pd.DataFrame,
) -> Dict[str, float]:

    if MODELS.fault_model is None:
        return {}

    try:

        probabilities = (
            MODELS.fault_model
            .predict_proba(frame)[0]
        )

        classes = getattr(
            MODELS.fault_model,
            "classes_",
            None,
        )

        if (
            classes is None
            and hasattr(
                MODELS.fault_model,
                "named_steps",
            )
        ):

            final_model = (
                MODELS.fault_model
                .named_steps
                .get("model")
            )

            if final_model is not None:

                classes = getattr(
                    final_model,
                    "classes_",
                    None,
                )

        if classes is None:
            return {}

        result: Dict[str, float] = {}

        for cls, probability in zip(
            classes,
            probabilities,
        ):

            label = _decode_fault_class(cls)

            result[label] = float(
                probability
            )

        return result

    except Exception:
        return {}


def engineering_check(
    reading: Dict[str, Any],
    context: Optional[Dict[str, Any]] = None,
) -> List[str]:

    context = context or {}

    data = {
        **context,
        **reading,
    }

    violations: List[str] = []

    rpm = _find_value(data, "rpm")
    cht = _find_value(data, "cht_c")
    egt = _find_value(data, "egt_c")
    oil_pressure = _find_value(
        data,
        "oil_press_bar",
    )
    oil_temp = _find_value(
        data,
        "oil_temp_c",
    )
    vibration = _find_value(
        data,
        "vibration_g",
    )
    battery = _find_value(
        data,
        "battery_v",
    )
    injection = _find_value(
        data,
        "injection_deg",
    )

    if rpm is not None:

        if rpm < 500:
            violations.append("LOW_RPM")

        if rpm > 7000:
            violations.append("HIGH_RPM")

    if cht is not None and cht > 180:
        violations.append("HIGH_CHT")

    if egt is not None and egt > 850:
        violations.append("HIGH_EGT")

    if (
        oil_pressure is not None
        and oil_pressure < 1.5
    ):
        violations.append(
            "LOW_OIL_PRESSURE"
        )

    if oil_temp is not None and oil_temp > 130:
        violations.append(
            "HIGH_OIL_TEMPERATURE"
        )

    if vibration is not None and vibration > 0.5:
        violations.append(
            "HIGH_VIBRATION"
        )

    if battery is not None and battery < 10.5:
        violations.append("LOW_BATTERY")

    if (
        injection is not None
        and (float(injection) < 15 or float(injection) > 30)
    ):
        violations.append(
            "ABNORMAL_INJECTION_TIMING"
        )

    return violations


def predict_engine(
    data: Dict[str, Any],
    engineering_faults: Optional[List[str]] = None,
) -> Dict[str, Any]:

    engineering_faults = (
        engineering_faults or []
    )

    result: Dict[str, Any] = {

        "success": False,

        "anomaly": "UNKNOWN",
        "anomaly_prediction": None,
        "anomaly_score": None,

        "predicted_fault": "UNKNOWN",
        "fault_confidence": 0.0,
        "fault_probabilities": {},

        "rul_hours": None,
        "predicted_rul_hours": None,

        "engineering_faults":
            engineering_faults,

        "condition": "UNKNOWN",

        "features_used":
            MODELS.features,

        "canonicalized_features": {},

        "stage_errors": {},
    }

    if not MODELS.loaded:

        result["error"] = MODELS.load_error
        return result

    try:

        frame = _make_frame(data)

        result[
            "canonicalized_features"
        ] = {
            column: float(
                frame.iloc[0][column]
            )
            for column in frame.columns
        }

    except Exception as exc:

        result["error"] = (
            f"INPUT_ERROR: "
            f"{type(exc).__name__}: {exc}"
        )

        return result

    result["model_input_shape"] = list(
        frame.shape
    )

    result["model_input_columns"] = list(
        frame.columns
    )

    try:

        anomaly_prediction = (
            MODELS.anomaly_model
            .predict(frame)[0]
        )

        anomaly_score = (
            MODELS.anomaly_model
            .decision_function(frame)[0]
        )

        anomaly_prediction = int(
            anomaly_prediction
        )

        result["anomaly"] = (
            "ANOMALY"
            if anomaly_prediction == -1
            else "NORMAL"
        )

        result[
            "anomaly_prediction"
        ] = anomaly_prediction

        result[
            "anomaly_score"
        ] = float(anomaly_score)

    except Exception as exc:

        result[
            "stage_errors"
        ]["isolation_forest"] = (
            f"{type(exc).__name__}: {exc}"
        )

    try:

        fault_prediction = (
            MODELS.fault_model
            .predict(frame)[0]
        )

        result[
            "predicted_fault"
        ] = _decode_fault_class(
            fault_prediction
        )

        probabilities = (
            _fault_probabilities(frame)
        )

        result[
            "fault_probabilities"
        ] = probabilities

        if probabilities:

            result[
                "fault_confidence"
            ] = float(
                max(
                    probabilities.values()
                )
            )

    except Exception as exc:

        result[
            "stage_errors"
        ]["fault_classifier"] = (
            f"{type(exc).__name__}: {exc}"
        )

    try:

        rul_prediction = (
            MODELS.rul_model
            .predict(frame)[0]
        )

        rul_prediction = max(
            0.0,
            float(rul_prediction),
        )

        result[
            "rul_hours"
        ] = rul_prediction

        result[
            "predicted_rul_hours"
        ] = rul_prediction

    except Exception as exc:

        result[
            "stage_errors"
        ]["rul_model"] = (
            f"{type(exc).__name__}: {exc}"
        )

    if engineering_faults:

        result[
            "condition"
        ] = "ENGINEERING_WARNING"

    elif result["anomaly"] == "ANOMALY":

        result[
            "condition"
        ] = "ANOMALOUS"

    elif (
        result["predicted_fault"] != "UNKNOWN"
        and result["predicted_fault"].lower()
        not in {
            "healthy",
            "normal",
            "none",
            "no_fault",
        }
    ):

        result[
            "condition"
        ] = "FAULT_DETECTED"

    elif result["predicted_fault"] != "UNKNOWN":

        result[
            "condition"
        ] = "HEALTHY"

    else:

        result[
            "condition"
        ] = "PARTIAL_ML_RESULT"

    successful_models = 0

    if result["anomaly"] != "UNKNOWN":
        successful_models += 1

    if result["predicted_fault"] != "UNKNOWN":
        successful_models += 1

    if result["predicted_rul_hours"] is not None:
        successful_models += 1

    result[
        "successful_model_count"
    ] = successful_models

    result["success"] = (
        successful_models > 0
    )

    if result["stage_errors"]:

        errors = []

        for stage, error in (
            result["stage_errors"].items()
        ):

            errors.append(
                f"{stage}: {error}"
            )

        result["error"] = " | ".join(
            errors
        )

    return result


def model_status() -> Dict[str, Any]:

    return {
        "loaded": MODELS.loaded,
        "load_error": MODELS.load_error,
        "models": {
            "anomaly_model":
                MODELS.anomaly_model is not None,
            "fault_model":
                MODELS.fault_model is not None,
            "rul_model":
                MODELS.rul_model is not None,
            "fault_encoder":
                MODELS.fault_encoder is not None,
            "features":
                MODELS.features is not None,
        },
        "features": MODELS.features,
        "feature_count": len(
            MODELS.features
        ),
        "model_directory": MODEL_DIR,
    }


if __name__ == "__main__":

    print("=" * 70)
    print("AEROSYNX AI MODEL STATUS")
    print("=" * 70)

    status = model_status()

    print(
        "Models loaded :",
        status["loaded"],
    )

    print(
        "Load error    :",
        status["load_error"],
    )

    print(
        "Feature count :",
        status["feature_count"],
    )

    print(
        "Features      :",
        status["features"],
    )

    print("\nModel files:")

    for name, path in MODEL_PATHS.items():

        print(
            f"{name:20} : "
            f"{'FOUND' if os.path.exists(path) else 'MISSING'}"
        )

    if not MODELS.loaded:
        raise SystemExit(1)

    test_data = {

        "rpm": 5100,
        "load": 65,
        "ambient_temp": 30,
        "altitude": 8000,
        "throttle": 70,

        "cht_c": 110,
        "egt_c": 720,
        "oil_press_bar": 3.2,
        "oil_temp_c": 92,
        "fuel_flow_lph": 18,
        "vibration_g": 0.12,
        "battery_v": 12.4,
        "injection_deg": 5,
        "current_a": 2.5,

        "cht_residual": -8,
        "egt_residual": 10,
        "oil_pressure_residual": -0.1,
        "oil_temp_residual": 4,
        "fuel_flow_residual": 0.5,
        "vibration_residual": 0.03,
        "battery_residual": -0.1,
        "injection_residual": 0.2,
    }

    engineering_faults = engineering_check(
        test_data
    )

    result = predict_engine(
        test_data,
        engineering_faults,
    )

    print("\n" + "=" * 70)
    print("MODEL INPUT")
    print("=" * 70)

    for key, value in (
        result[
            "canonicalized_features"
        ].items()
    ):

        print(
            f"{key:30} : {value}"
        )

    print("\n" + "=" * 70)
    print("MODEL RESULTS")
    print("=" * 70)

    print(
        "Anomaly        :",
        result["anomaly"],
    )

    print(
        "Anomaly score  :",
        result["anomaly_score"],
    )

    print(
        "Fault          :",
        result["predicted_fault"],
    )

    print(
        "Confidence     :",
        f"{result['fault_confidence'] * 100:.2f}%",
    )

    print(
        "RUL            :",
        result["predicted_rul_hours"],
        "hours",
    )

    print(
        "Condition      :",
        result["condition"],
    )

    print(
        "Successful     :",
        result[
            "successful_model_count"
        ],
        "/ 3",
    )

    if result["stage_errors"]:

        print(
            "\n" + "=" * 70
        )

        print(
            "MODEL STAGE ERRORS"
        )

        print(
            "=" * 70
        )

        for stage, error in (
            result["stage_errors"].items()
        ):

            print(
                f"{stage:25} : {error}"
            )

    else:

        print(
            "\n" + "=" * 70
        )

        print(
            "ALL THREE ML MODELS EXECUTED SUCCESSFULLY"
        )

        print(
            "=" * 70
        )

    if result.get("error"):

        print(
            "\nERROR:",
            result["error"],
        )

