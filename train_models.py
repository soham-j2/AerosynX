"""
AeroSynX model training.

This replaces the previous training script while preserving the model roles:

    Isolation Forest        -> anomaly detection
    Random Forest Classifier-> fault classification
    Random Forest Regressor -> RUL estimation

Important fixes:
1. Supports the actual supplied dataset column names:
       cht, egt, oil_pressure, fuel_flow, vibration, current
2. Does not require all 11 historical fault labels to exist.
3. Saves the exact feature list used by the models.
4. Uses sklearn pipelines with median imputation.
5. Uses operating context (load/altitude/ambient/throttle) instead of
   throwing it away.
6. Does not use "degradation" as an input feature because that would leak
   target-like information into the model.
7. Reports the limitation when the dataset has no sequence/timestamp ID.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict, List

import joblib
import numpy as np
import pandas as pd

from sklearn.ensemble import (
    IsolationForest,
    RandomForestClassifier,
    RandomForestRegressor,
)
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    mean_absolute_error,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder


DATA_FILE = Path("data/engine_data.csv")
MODEL_DIR = Path("models")
MODEL_DIR.mkdir(parents=True, exist_ok=True)

RANDOM_STATE = 42


COLUMN_ALIASES = {
    "cht": "cht_c",
    "egt": "egt_c",
    "oil_pressure": "oil_press_bar",
    "fuel_flow": "fuel_flow_lph",
    "vibration": "vibration_g",
    "current": "current_a",
    "oil_temp": "oil_temp_c",
    "battery": "battery_v",
    "injection": "injection_deg",
}


# Prefer these features, but only features actually present in the dataset
# are selected. This is critical for your current CSV.
FEATURE_CANDIDATES = [
    # Operating context
    "rpm",
    "load",
    "ambient_temp",
    "altitude",
    "throttle",

    # Engine measurements
    "cht_c",
    "egt_c",
    "oil_press_bar",
    "oil_temp_c",
    "fuel_flow_lph",
    "vibration_g",
    "battery_v",
    "injection_deg",
    "current_a",

    # Physics residuals
    "cht_residual",
    "egt_residual",
    "oil_pressure_residual",
    "vibration_residual",
    "oil_temp_residual",
    "fuel_flow_residual",
    "battery_residual",
    "injection_residual",
]


def canonicalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    for old, new in COLUMN_ALIASES.items():
        if new not in df.columns and old in df.columns:
            df[new] = df[old]

    return df


def require_columns(df: pd.DataFrame) -> None:
    required = {"fault", "rul"}
    missing = required - set(df.columns)

    if missing:
        raise ValueError(
            "Dataset is missing required target columns: "
            + ", ".join(sorted(missing))
        )


def select_features(df: pd.DataFrame) -> List[str]:
    features = [
        feature
        for feature in FEATURE_CANDIDATES
        if feature in df.columns
    ]

    if len(features) < 6:
        raise ValueError(
            "Too few usable model features. Found: "
            + ", ".join(features)
        )

    return features


def clean_numeric(df: pd.DataFrame, features: List[str]) -> pd.DataFrame:
    out = df.copy()

    for feature in features:
        out[feature] = pd.to_numeric(
            out[feature],
            errors="coerce",
        )

    # Drop rows where every selected feature is missing.
    out = out.dropna(
        subset=features,
        how="all",
    )

    return out


def build_imputer() -> SimpleImputer:
    return SimpleImputer(
        strategy="median",
        add_indicator=True,
    )


def main() -> None:
    if not DATA_FILE.exists():
        raise FileNotFoundError(
            f"Dataset not found: {DATA_FILE}\n"
            "Expected: data/engine_data.csv"
        )

    df = pd.read_csv(DATA_FILE)
    df = canonicalize_columns(df)
    require_columns(df)

    features = select_features(df)
    df = clean_numeric(df, features)

    # Targets
    y_fault_raw = df["fault"].astype(str).str.strip()
    y_rul = pd.to_numeric(df["rul"], errors="coerce")

    valid_rul = y_rul.notna()
    df = df.loc[valid_rul].copy()
    y_fault_raw = y_fault_raw.loc[valid_rul]
    y_rul = y_rul.loc[valid_rul]

    X = df[features].copy()

    print("=" * 72)
    print("AEROSYNX AI / ML MODEL TRAINING")
    print("=" * 72)
    print(f"Dataset rows      : {len(df)}")
    print(f"Selected features : {len(features)}")
    print("Features:")
    for f in features:
        print(f"  - {f}")

    print("\nFault classes present in THIS dataset:")
    for fault, count in y_fault_raw.value_counts().items():
        print(f"  {fault:<30} {count}")

    if "timestamp" not in df.columns and "sequence_id" not in df.columns:
        print(
            "\nTEMPORAL-DATA LIMITATION:\n"
            "The supplied dataset has no timestamp/sequence_id. "
            "Therefore these models are trained as tabular state models. "
            "Temporal degradation is handled online by temporal_engine.py "
            "until real ordered engine-run data is available."
        )

    # ------------------------------------------------------------------
    # 1. Isolation Forest
    # ------------------------------------------------------------------
    print("\n[1/3] Training Isolation Forest...")

    healthy_mask = y_fault_raw.str.lower().eq("healthy")
    X_healthy = X.loc[healthy_mask]

    if len(X_healthy) < 50:
        raise ValueError(
            "Not enough healthy samples for Isolation Forest."
        )

    anomaly_model = Pipeline([
        ("imputer", build_imputer()),
        (
            "model",
            IsolationForest(
                n_estimators=300,
                contamination=0.05,
                max_samples="auto",
                random_state=RANDOM_STATE,
                n_jobs=-1,
            ),
        ),
    ])

    anomaly_model.fit(X_healthy)

    joblib.dump(
        anomaly_model,
        MODEL_DIR / "anomaly_model.pkl",
    )

    print(f"Healthy samples: {len(X_healthy)}")

    # ------------------------------------------------------------------
    # 2. Random Forest Fault Classifier
    # ------------------------------------------------------------------
    print("\n[2/3] Training Random Forest fault classifier...")

    encoder = LabelEncoder()
    y_encoded = encoder.fit_transform(y_fault_raw)

    # The supplied dataset contains only the classes it actually contains.
    # We do NOT invent missing fault classes.
    if len(encoder.classes_) < 2:
        raise ValueError(
            "Fault classifier requires at least 2 classes."
        )

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y_encoded,
        test_size=0.20,
        random_state=RANDOM_STATE,
        stratify=y_encoded,
    )

    fault_model = Pipeline([
        ("imputer", build_imputer()),
        (
            "model",
            RandomForestClassifier(
                n_estimators=400,
                max_depth=20,
                min_samples_leaf=2,
                class_weight="balanced_subsample",
                random_state=RANDOM_STATE,
                n_jobs=-1,
            ),
        ),
    ])

    fault_model.fit(X_train, y_train)

    predictions = fault_model.predict(X_test)
    accuracy = accuracy_score(y_test, predictions)

    print(f"Test accuracy: {accuracy * 100:.2f}%")
    print(
        classification_report(
            y_test,
            predictions,
            target_names=encoder.classes_,
            zero_division=0,
        )
    )

    joblib.dump(
        fault_model,
        MODEL_DIR / "fault_model.pkl",
    )
    joblib.dump(
        encoder,
        MODEL_DIR / "fault_encoder.pkl",
    )

    # ------------------------------------------------------------------
    # 3. Random Forest RUL
    # ------------------------------------------------------------------
    print("\n[3/3] Training Random Forest RUL regressor...")

    X_train_rul, X_test_rul, y_train_rul, y_test_rul = train_test_split(
        X,
        y_rul,
        test_size=0.20,
        random_state=RANDOM_STATE,
    )

    rul_model = Pipeline([
        ("imputer", build_imputer()),
        (
            "model",
            RandomForestRegressor(
                n_estimators=400,
                max_depth=20,
                min_samples_leaf=2,
                random_state=RANDOM_STATE,
                n_jobs=-1,
            ),
        ),
    ])

    rul_model.fit(X_train_rul, y_train_rul)

    rul_predictions = rul_model.predict(X_test_rul)
    rul_mae = mean_absolute_error(
        y_test_rul,
        rul_predictions,
    )

    print(f"RUL MAE: {rul_mae:.2f} hours")

    joblib.dump(
        rul_model,
        MODEL_DIR / "rul_model.pkl",
    )

    # ------------------------------------------------------------------
    # Save schema
    # ------------------------------------------------------------------
    joblib.dump(
        features,
        MODEL_DIR / "features.pkl",
    )

    model_info = {
        "model_name": "AeroSynX Hybrid Engine Health AI",
        "version": "3.0-temporal-ready",
        "feature_count": len(features),
        "features": features,
        "anomaly_model": "IsolationForest",
        "fault_model": "RandomForestClassifier",
        "rul_model": "RandomForestRegressor",
        "fault_classes": list(encoder.classes_),
        "fault_count": len(encoder.classes_),
        "fault_accuracy_random_split": float(accuracy),
        "rul_mae_hours_random_split": float(rul_mae),
        "training_samples": int(len(df)),
        "healthy_samples": int(len(X_healthy)),
        "temporal_training_available": bool(
            "timestamp" in df.columns or "sequence_id" in df.columns
        ),
        "warning": (
            "Metrics are dataset-dependent and do not represent "
            "validated aircraft-engine performance."
        ),
    }

    joblib.dump(
        model_info,
        MODEL_DIR / "model_info.pkl",
    )

    with open(
        MODEL_DIR / "model_info.json",
        "w",
        encoding="utf-8",
    ) as file:
        json.dump(
            model_info,
            file,
            indent=2,
        )

    print("\n" + "=" * 72)
    print("TRAINING COMPLETE")
    print("=" * 72)
    print("Created/updated:")
    print("  models/anomaly_model.pkl")
    print("  models/fault_model.pkl")
    print("  models/fault_encoder.pkl")
    print("  models/rul_model.pkl")
    print("  models/features.pkl")
    print("  models/model_info.pkl")
    print("  models/model_info.json")
    print("\nIMPORTANT:")
    print(
        "The current CSV contains only the fault labels that actually "
        "exist in the file. Missing historical fault classes are not "
        "invented by this trainer."
    )


if __name__ == "__main__":
    main()
