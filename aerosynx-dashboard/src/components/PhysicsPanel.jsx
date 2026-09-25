function PhysicsPanel({ data }) {

  const current =
    data?.current_state || {};

  const expected =
    data?.expected_state || {};

  const rows = [

    {
      key: "cht_c",
      name: "CHT",
      unit: "°C",
    },

    {
      key: "egt_c",
      name: "EGT",
      unit: "°C",
    },

    {
      key: "oil_press_bar",
      name: "Oil Pressure",
      unit: "bar",
    },

    {
      key: "fuel_flow_lph",
      name: "Fuel Flow",
      unit: "L/h",
    },

  ];


  return (

    <section className="panel">

      <div className="panel-header">

        <div>

          <span className="eyebrow">
            PHYSICS ENGINE
          </span>

          <h2>
            Actual vs Expected
          </h2>

        </div>

        <span className="physics-badge">
          PHYSICS MODEL
        </span>

      </div>


      <div className="comparison-table">

        <div className="table-row table-head">

          <span>
            Parameter
          </span>

          <span>
            Actual
          </span>

          <span>
            Expected
          </span>

          <span>
            Δ
          </span>

        </div>


        {rows.map((row) => {

          const actual =
            Number(
              current[row.key] ?? 0
            );

          const exp =
            Number(
              expected[row.key] ?? 0
            );

          const difference =
            actual - exp;


          return (

            <div
              className="table-row"
              key={row.key}
            >

              <span>
                {row.name}
              </span>

              <strong>
                {actual.toFixed(2)}
                {row.unit}
              </strong>

              <span>
                {exp.toFixed(2)}
                {row.unit}
              </span>

              <span
                className={
                  Math.abs(difference) > 10
                    ? "danger"
                    : "normal"
                }
              >

                {difference >= 0
                  ? "+"
                  : ""}

                {difference.toFixed(2)}

              </span>

            </div>

          );

        })}

      </div>


      <div className="physics-explanation">

        <span>ƒ</span>

        <div>

          <strong>
            Physics-based state estimation
          </strong>

          <p>
            Expected engine behavior is calculated
            from operating conditions such as RPM,
            load, altitude, ambient temperature and
            cooling airflow. The AI receives the
            resulting deviations as diagnostic
            features.
          </p>

        </div>

      </div>

    </section>

  );

}


export default PhysicsPanel;