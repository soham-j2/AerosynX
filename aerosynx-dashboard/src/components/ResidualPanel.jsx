function ResidualPanel({ data }) {

  const residuals =
    data?.residuals || {};


  const items = [

    {
      key: "cht_residual",
      name: "CHT Residual",
      unit: "°C",
    },

    {
      key: "egt_residual",
      name: "EGT Residual",
      unit: "°C",
    },

    {
      key: "oil_pressure_residual",
      name: "Oil Pressure Residual",
      unit: "bar",
    },

    {
      key: "vibration_residual",
      name: "Vibration Residual",
      unit: "g",
    },

  ];


  return (

    <section className="panel">

      <div className="panel-header">

        <div>

          <span className="eyebrow">
            DEVIATION ANALYSIS
          </span>

          <h2>
            Digital Twin Residuals
          </h2>

        </div>

      </div>


      <div className="residual-list">

        {items.map((item) => {

          const value =
            Number(
              residuals[item.key] ?? 0
            );


          const percentage =
            Math.min(
              100,
              Math.abs(value) * 5
            );


          return (

            <div
              className="residual-item"
              key={item.key}
            >

              <div className="residual-info">

                <span>
                  {item.name}
                </span>

                <strong>
                  {value >= 0 ? "+" : ""}
                  {value.toFixed(2)}
                  {" "}
                  {item.unit}
                </strong>

              </div>


              <div className="residual-bar">

                <div
                  style={{
                    width: `${percentage}%`,
                  }}
                />

              </div>

            </div>

          );

        })}

      </div>

    </section>

  );

}


export default ResidualPanel;