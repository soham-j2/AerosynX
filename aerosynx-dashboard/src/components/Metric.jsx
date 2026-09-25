import React from "react";

export default function Metric({
  label,
  value,
  unit,
  status = "normal",
  icon: Icon,
}) {
  return (
    <div className={`metric metric-${status}`}>
      <div className="metric-head">
        <span>
          {Icon && <Icon size={13} />}
          {label}
        </span>

        <i />
      </div>

      <div className="metric-value">
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