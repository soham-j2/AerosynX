function SensorGrid({ data }) {

  const reading =
    data?.reading ||
    data?.current_state ||
    {};

  const source =
    data?.source ||
    {};


  const sensors = [

    {
      key: "rpm",
      name: "Engine RPM",
      unit: "RPM",
      icon: "↻",
    },

    {
      key: "cht_c",
      name: "Cylinder Head Temp",
      unit: "°C",
      icon: "🌡",
    },

    {
      key: "egt_c",
      name: "Exhaust Gas Temp",
      unit: "°C",
      icon: "🔥",
    },

    {
      key: "oil_press_bar",
      name: "Oil Pressure",
      unit: "bar",
      icon: "◉",
    },

    {
      key: "oil_temp_c",
      name: "Oil Temperature",
      unit: "°C",
      icon: "🌡",
    },

    {
      key: "fuel_flow_lph",
      name: "Fuel Flow",
      unit: "L/h",
      icon: "⛽",
    },

    {
      key: "vibration_g",
      name: "Vibration",
      unit: "g",
      icon: "〽",
    },

    {
      key: "battery_v",
      name: "Battery",
      unit: "V",
      icon: "▣",
    },

    {
      key: "injection_deg",
      name: "Injection Timing",
      unit: "°",
      icon: "◌",
    },

  ];


  return (

    <section className="panel sensor-panel">

      <div className="panel-header">

        <div>

          <span className="eyebrow">
            TELEMETRY
          </span>

          <h2>
            Live Engine Readings
          </h2>

        </div>

        <span className="live-badge">
          ● LIVE
        </span>

      </div>


      <div className="sensor-grid">

        {sensors.map((sensor) => (

          <div
            className="sensor-card"
            key={sensor.key}
          >

            <div className="sensor-top">

              <span className="sensor-icon">
                {sensor.icon}
              </span>

              <span
                className={
                  source[sensor.key] === "HW"
                    ? "source hw"
                    : "source sim"
                }
              >

                {source[sensor.key] || "SIM"}

              </span>

            </div>


            <div className="sensor-name">
              {sensor.name}
            </div>


            <div className="sensor-value">

              {reading[sensor.key] !== undefined
                ? Number(
                    reading[sensor.key]
                  ).toFixed(
                    sensor.key === "vibration_g"
                      ? 4
                      : 1
                  )
                : "--"
              }

              <small>
                {sensor.unit}
              </small>

            </div>

          </div>

        ))}

      </div>

    </section>

  );

}


export default SensorGrid;