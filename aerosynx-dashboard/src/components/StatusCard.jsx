function StatusCard({
  title,
  value,
  unit,
  icon
}) {

  return (

    <div className="status-card">

      <div className="status-card-top">

        <span className="status-icon">
          {icon}
        </span>

        <span className="card-title">
          {title}
        </span>

      </div>


      <div className="status-value">

        {value}

        {unit && (
          <small>
            {unit}
          </small>
        )}

      </div>

    </div>

  );

}


export default StatusCard;