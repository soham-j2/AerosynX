function FaultInjection({
  onInject,
  onClear,
  currentFault
}) {

  const faults = [

    {
      id: "none",
      name: "Normal Operation",
      description:
        "Healthy engine operating condition",
    },

    {
      id: "misfire",
      name: "Misfire",
      description:
        "Abnormal combustion / RPM fluctuation",
    },

    {
      id: "injector_abnormality",
      name: "Injector Abnormality",
      description:
        "Fuel delivery or injection timing issue",
    },

    {
      id: "coking_degradation",
      name: "Coking / Overheating",
      description:
        "Increasing CHT and EGT",
    },

    {
      id: "lubrication_issue",
      name: "Lubrication Issue",
      description:
        "Low oil pressure and high oil temperature",
    },

    {
      id: "sensor_drift",
      name: "Sensor Drift",
      description:
        "Single measurement deviates abnormally",
    },

    {
      id: "combustion_instability",
      name: "Combustion Instability",
      description:
        "Unstable RPM, EGT and vibration",
    },

  ];


  return (

    <section className="fault-page">

      <div className="page-heading">

        <div>

          <span className="eyebrow">
            DIGITAL TWIN TEST LAB
          </span>

          <h1>
            Fault Injection
          </h1>

          <p>
            Inject controlled engine faults into
            the virtual telemetry stream and observe
            the AI response.
          </p>

        </div>

      </div>


      <div className="fault-grid">

        {faults.map((fault) => (

          <button
            key={fault.id}
            className={
              currentFault === fault.id
                ? "fault-card selected"
                : "fault-card"
            }
            onClick={() => {

              if (fault.id === "none") {

                onClear();

              } else {

                onInject(
                  fault.id
                );

              }

            }}
          >

            <div className="fault-card-icon">
              {fault.id === "none"
                ? "✓"
                : "⚠"}
            </div>

            <h3>
              {fault.name}
            </h3>

            <p>
              {fault.description}
            </p>

            {currentFault === fault.id && (

              <span className="selected-label">
                ACTIVE
              </span>

            )}

          </button>

        ))}

      </div>

    </section>

  );

}


export default FaultInjection;