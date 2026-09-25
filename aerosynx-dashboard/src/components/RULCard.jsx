function RULCard({ data }) {

  const ai =
    data?.ai_prediction || {};

  const rul =
    Number(
      ai.estimated_rul ?? 0
    );


  const maxRul = 500;

  const percentage =
    Math.min(
      100,
      Math.max(
        0,
        (rul / maxRul) * 100
      )
    );


  return (

    <section className="panel rul-panel">

      <div className="panel-header">

        <div>

          <span className="eyebrow">
            PREDICTIVE MAINTENANCE
          </span>

          <h2>
            Remaining Useful Life
          </h2>

        </div>

      </div>


      <div className="rul-main">

        <strong>
          {rul || "--"}
        </strong>

        <span>
          hours remaining
        </span>

      </div>


      <div className="rul-bar">

        <div
          style={{
            width: `${percentage}%`,
          }}
        />

      </div>


      <p className="muted">

        RUL is estimated from engine operating
        conditions, degradation indicators and
        historical AI model behavior.

      </p>

    </section>

  );

}


export default RULCard;