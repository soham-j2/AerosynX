from pathlib import Path

import joblib
import pandas as pd
import shap


MODEL_DIR = Path(
    "models"
)


class SHAPExplainer:

    def __init__(self):

        self.model = joblib.load(

            MODEL_DIR
            / "fault_model.pkl"
        )

        self.encoder = joblib.load(

            MODEL_DIR
            / "fault_encoder.pkl"
        )

        self.features = joblib.load(

            MODEL_DIR
            / "features.pkl"
        )

        self.explainer = shap.TreeExplainer(
            self.model
        )

    def explain(
        self,
        data,
        top_n=8
    ):

        X = pd.DataFrame(

            [data],

            columns=self.features
        )

        predicted_id = (
            self.model.predict(X)[0]
        )

        predicted_fault = (

            self.encoder
            .inverse_transform(
                [predicted_id]
            )[0]
        )

        shap_values = (
            self.explainer.shap_values(X)
        )

        # Handle different SHAP versions

        if isinstance(
            shap_values,
            list
        ):

            values = (
                shap_values[
                    predicted_id
                ][0]
            )

        else:

            values = (
                shap_values[0]
            )

        result = pd.DataFrame({

            "feature":
                self.features,

            "shap_value":
                values,

            "importance":
                abs(values)
        })

        result = result.sort_values(

            "importance",

            ascending=False
        ).head(
            top_n
        )

        return {

            "predicted_fault":
                predicted_fault,

            "top_features":
                result[
                    [
                        "feature",
                        "shap_value",
                        "importance"
                    ]
                ].to_dict(
                    "records"
                )
        }