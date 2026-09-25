import React from "react";

export default function Sparkline({ values = [], height = 70 }) {
  const width = 520;
  const padding = 5;

  if (!values.length) {
    return <div className="spark-empty" />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values
    .map((value, index) => {
      const x =
        padding +
        (index / Math.max(1, values.length - 1)) * (width - padding * 2);

      const y =
        height -
        padding -
        ((value - min) / range) * (height - padding * 2);

      return `${x},${y}`;
    })
    .join(" ");

  const area = `${padding},${height} ${points} ${width - padding},${height}`;

  return (
    <svg
      className="spark"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="rgba(0,229,170,.30)" />
          <stop offset="100%" stopColor="rgba(0,229,170,0)" />
        </linearGradient>
      </defs>

      <polygon points={area} fill="url(#sparkFill)" />

      <polyline
        points={points}
        fill="none"
        stroke="#00E5AA"
        strokeWidth="2.5"
      />
    </svg>
  );
}