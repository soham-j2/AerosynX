function LiveChart({ history }) {

  if (!history.length) {

    return (

      <section className="panel">

        <h2>
          Live Engine Trend
        </h2>

        <p className="muted">
          Waiting for telemetry...
        </p>

      </section>

    );

  }


  const maxRPM =
    Math.max(
      ...history.map(
        (item) => item.rpm
      ),
      5300
    );


  const minRPM =
    Math.min(
      ...history.map(
        (item) => item.rpm
      ),
      4000
    );


  const range =
    maxRPM - minRPM || 1;


  return (

    <section className="panel chart-panel">

      <div className="panel-header">

        <div>

          <span className="eyebrow">
            REAL-TIME TREND
          </span>

          <h2>
            Engine RPM History
          </h2>

        </div>

        <span className="chart-live">
          Last 30 samples
        </span>

      </div>


      <div className="simple-chart">

        {history.map((item, index) => {

          const height =
            ((item.rpm - minRPM) / range) *
            80 +
            10;


          return (

            <div
              key={index}
              className="chart-column"
              title={`${item.time} — ${item.rpm} RPM`}
            >

              <div
                className="chart-bar"
                style={{
                  height: `${height}%`,
                }}
              />

            </div>

          );

        })}

      </div>

    </section>

  );

}


export default LiveChart;