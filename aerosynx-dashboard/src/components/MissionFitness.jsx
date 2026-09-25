import { useState } from "react";


function MissionFitness({
  result,
  onEvaluate
}) {

  const [mission, setMission] = useState({

    altitude: 12000,

    duration: 10,

    load: 70,

    type: "High-Altitude ISR",

  });


  const handleChange = (event) => {

    const {
      name,
      value
    } = event.target;


    setMission((previous) => ({

      ...previous,

      [name]: value,

    }));

  };


  return (

    <section className="mission-page">

      <div className="page-heading">

        <div>

          <span className="eyebrow">
            MISSION DECISION SUPPORT
          </span>

          <h1>
            Mission Fitness
          </h1>

          <p>
            Evaluate whether the current engine
            condition is suitable for the selected
            mission profile.
          </p>

        </div>

      </div>


      <div className="mission-grid">

        <div className="panel">

          <div className="panel-header">

            <h2>
              Mission Parameters
            </h2>

          </div>


          <label>
            Mission Type

            <select
              name="type"
              value={mission.type}
              onChange={handleChange}
            >

              <option>
                High-Altitude ISR
              </option>

              <option>
                Endurance Mission
              </option>

              <option>
                Maritime Surveillance
              </option>

              <option>
                Communication Relay
              </option>

            </select>

          </label>


          <label>
            Altitude (ft)

            <input
              name="altitude"
              type="number"
              value={mission.altitude}
              onChange={handleChange}
            />

          </label>


          <label>
            Duration (hours)

            <input
              name="duration"
              type="number"
              value={mission.duration}
              onChange={handleChange}
            />

          </label>


          <label>
            Engine Load (%)

            <input
              name="load"
              type="number"
              value={mission.load}
              onChange={handleChange}
            />

          </label>


          <button
            className="primary-button"
            onClick={() =>
              onEvaluate(mission)
            }
          >
            Evaluate Mission
          </button>

        </div>


        <div className="panel mission-result">

          <span className="eyebrow">
            RESULT
          </span>

          <div
            className={
              result?.status === "SAFE"
                ? "mission-status safe"
                : result?.status === "CAUTION"
                ? "mission-status caution"
                : "mission-status critical"
            }
          >

            {result?.status ||
              "NOT EVALUATED"}

          </div>


          <p>
            {result?.reason ||
              "Enter mission parameters and evaluate the current engine condition."}
          </p>


          {result && (

            <div className="mission-metrics">

              <div>

                <span>
                  Health
                </span>

                <strong>
                  {result.health_score}
                </strong>

              </div>


              <div>

                <span>
                  RUL
                </span>

                <strong>
                  {result.rul} hrs
                </strong>

              </div>

            </div>

          )}

        </div>

      </div>

    </section>

  );

}


export default MissionFitness;