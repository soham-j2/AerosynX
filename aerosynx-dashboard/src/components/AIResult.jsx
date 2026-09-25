function AIResult({
  data,
  fullPage = false
}) {

  const ai =
    data?.ai_prediction || {};


  const fault =
    ai.predicted_fault ||
    "healthy";


  const anomaly =
    ai.anomaly_status ||
    "NORMAL";


  const confidence =
    Number(
      ai.confidence ?? 0
    );


  return (

    <section
      className={
        fullPage
          ? "panel ai-page"
          : "panel"
      }
    >

      <div className="panel-header">

        <div>

          <span className="eyebrow">
            AI / ML ENGINE
          </span>

          <h2>
            Intelligent Diagnostics
          </h2>

        </div>

        <span className="ai-badge">
          AI ACTIVE
        </span>

      </div>


      <div className="ai-status">

        <div
          className={
            anomaly === "NORMAL"
              ? "ai-state normal"
              : "ai-state danger"
          }
        >

          <span>

            {anomaly === "NORMAL"
              ? "✓"
              : "!"}

          </span>

          <div>

            <small>
              ANOMALY STATUS
            </small>

            <strong>
              {anomaly}
            </strong>

          </div>

        </div>


        <div className="ai-fault">

          <small>
            PREDICTED FAULT
          </small>

          <strong>
            {fault}
          </strong>

        </div>

      </div>


      <div className="confidence">

        <div>

          <span>
            Prediction Confidence
          </span>

          <strong>
            {(confidence * 100).toFixed(1)}%
          </strong>

        </div>


        <div className="confidence-bar">

          <div
            style={{
              width: `${confidence * 100}%`,
            }}
          />

        </div>

      </div>


      <div className="ai-details">

        <div>

          <span>
            Anomaly Score
          </span>

          <strong>
            {Number(
              ai.anomaly_score ?? 0
            ).toFixed(3)}
          </strong>

        </div>


        <div>

          <span>
            Estimated RUL
          </span>

          <strong>
            {ai.estimated_rul ?? "--"} hrs
          </strong>

        </div>

      </div>


      <div className="recommendation">

        <span>
          MAINTENANCE ADVISORY
        </span>

        <p>
          {ai.maintenance_recommendation ||
            "Continue monitoring engine telemetry."}
        </p>

      </div>

    </section>

  );

}


export default AIResult;