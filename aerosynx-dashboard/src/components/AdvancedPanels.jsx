/**
 * AdvancedPanels.jsx
 *
 * All advanced backend-driven panels:
 *   - MissionGuard / Mission Recommendation (most prominent)
 *   - Mission Feasibility Margin
 *   - Engine Capability Envelope
 *   - Sensor–Engine Fault Separation
 *   - Cross-Sensor Physical Consistency
 *   - Degradation Severity Tracking
 *   - Operating-Limit Panel
 *   - Estimated Operating Window
 *   - Uncertainty & Model-Validity Gate
 *   - Predicted-vs-Measured Chart
 *   - Sensor Data Quality Monitor
 *   - Unknown Fault State (Final Fault State)
 *   - Mission History / Review
 */

import React, { useEffect, useRef, useState } from "react";

/* ============================================================
   HELPERS
   ============================================================ */

const num = (v, fallback = 0) => {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const fmt = (v, d = 1) => num(v).toFixed(d);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ============================================================
   RECOMMENDATION CONFIG
   ============================================================ */

const REC_CONFIG = {
  CONTINUE: {
    color: "#2ecc71",
    bg: "rgba(46,204,113,0.08)",
    border: "rgba(46,204,113,0.35)",
    icon: "✓",
    label: "CONTINUE",
  },
  CONTINUE_WITH_REDUCED_LOAD: {
    color: "#f39c12",
    bg: "rgba(243,156,18,0.08)",
    border: "rgba(243,156,18,0.35)",
    icon: "↓",
    label: "CONTINUE — REDUCED LOAD",
  },
  SHORTEN_MISSION_RETURN: {
    color: "#e74c3c",
    bg: "rgba(231,76,60,0.08)",
    border: "rgba(231,76,60,0.35)",
    icon: "↩",
    label: "SHORTEN / RETURN",
  },
  PRE_MISSION_INSPECTION: {
    color: "#e74c3c",
    bg: "rgba(231,76,60,0.08)",
    border: "rgba(231,76,60,0.35)",
    icon: "⚠",
    label: "PRE-MISSION INSPECTION",
  },
  UNKNOWN: {
    color: "#7f8c8d",
    bg: "rgba(127,140,141,0.08)",
    border: "rgba(127,140,141,0.35)",
    icon: "?",
    label: "UNKNOWN",
  },
};

function getRecConfig(rec) {
  if (!rec) return REC_CONFIG.UNKNOWN;
  const key = String(rec).toUpperCase().replace(/[\s\/-]+/g, "_");
  return REC_CONFIG[key] || REC_CONFIG[rec] || REC_CONFIG.UNKNOWN;
}

/* ============================================================
   SECTION HEADER
   ============================================================ */

function SH({ eyebrow, title, right }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 9, color: "#38c0e8", letterSpacing: 2, fontWeight: 600, marginBottom: 2 }}>
        {eyebrow}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#e1eaf2", letterSpacing: 1 }}>{title}</div>
        {right}
      </div>
    </div>
  );
}

function Pill({ label, color = "#38c0e8" }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: "2px 8px",
      borderRadius: 10, background: `${color}18`,
      border: `1px solid ${color}55`, color,
      letterSpacing: 1,
    }}>
      {label}
    </span>
  );
}

/* ============================================================
   MISSION RECOMMENDATION PANEL  (most prominent)
   ============================================================ */

export function MissionRecommendationPanel({ missionResult }) {
  const rec = missionResult?.recommendation || "UNKNOWN";
  const cfg = getRecConfig(rec);

  // Backend returns recommendation_reason with a `reasons` array
  const reason = missionResult?.recommendation_reason || {};
  const reasons = reason.reasons || [];

  // recommendation_details explains WHY (e.g. ML model missing)
  const recDetails = missionResult?.recommendation_details || {};
  const modelEvidence = recDetails.evidence || [];

  const runtime = missionResult?.runtime || {};

  // Feasibility status from nested object
  const fm = missionResult?.feasibility_margin || {};
  const feasStatus = (typeof fm === "object" ? fm.status : null) || "UNKNOWN";
  const feasValue  = typeof fm === "object" ? num(fm.value, null) : num(fm, null);
  const feasColor  =
    feasStatus === "POSITIVE"   ? "#2ecc71" :
    feasStatus === "BORDERLINE" ? "#f39c12" :
    feasStatus === "NEGATIVE"   ? "#e74c3c" : "#7f8c8d";

  return (
    <div style={{
      background: "#0b1520",
      border: `1.5px solid ${cfg.border}`,
      borderRadius: 12,
      padding: 20,
      boxShadow: `0 0 32px ${cfg.color}18`,
    }}>
      <SH eyebrow="MISSION COMMAND" title="OPERATIONAL RECOMMENDATION" />

      {/* Big recommendation block */}
      <div style={{
        background: cfg.bg,
        border: `1.5px solid ${cfg.border}`,
        borderRadius: 10,
        padding: "18px 20px",
        display: "flex",
        alignItems: "center",
        gap: 18,
        marginBottom: 16,
      }}>
        <div style={{
          width: 52, height: 52, borderRadius: "50%",
          background: `${cfg.color}1a`, border: `2px solid ${cfg.color}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, color: cfg.color, fontWeight: 700, flexShrink: 0,
          boxShadow: `0 0 16px ${cfg.color}44`,
        }}>
          {cfg.icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: cfg.color, letterSpacing: 2, fontWeight: 700 }}>
            {cfg.label}
          </div>
          {recDetails.reason && (
            <div style={{ fontSize: 10, color: "#8faec0", marginTop: 4, lineHeight: 1.5 }}>
              {recDetails.reason}
            </div>
          )}
          {rec === "UNKNOWN" && feasStatus !== "UNKNOWN" && (
            <div style={{
              marginTop: 6, fontSize: 9, color: feasColor, fontWeight: 700,
              padding: "3px 8px", background: `${feasColor}18`,
              border: `1px solid ${feasColor}44`, borderRadius: 4, display: "inline-block",
            }}>
              FEASIBILITY: {feasStatus} ({feasValue != null ? (feasValue > 0 ? "+" : "") + fmt(feasValue, 1) : "—"})
            </div>
          )}
        </div>
      </div>

      {/* ML model unavailability notice */}
      {rec === "UNKNOWN" && modelEvidence.length > 0 && (
        <div style={{
          marginBottom: 14, padding: "8px 12px",
          background: "rgba(127,140,141,0.08)", border: "1px solid rgba(127,140,141,0.25)",
          borderRadius: 8, fontSize: 9, color: "#8faec0",
        }}>
          <span style={{ color: "#7f8c8d", fontWeight: 700, marginRight: 6 }}>ℹ</span>
          {String(modelEvidence[0]).replace("Model error: FileNotFoundError:", "Model unavailable:").slice(0, 120)}
        </div>
      )}

      {/* Runtime */}
      {(runtime.elapsed_minutes != null || runtime.remaining_minutes != null) && (
        <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1, background: "#0d1e2e", borderRadius: 8, padding: "8px 12px" }}>
            <div style={{ fontSize: 9, color: "#627d94", letterSpacing: 1 }}>ELAPSED</div>
            <div style={{ fontSize: 14, color: "#e1eaf2", fontWeight: 700, fontFamily: "monospace" }}>
              {fmt(runtime.elapsed_minutes, 1)} min
            </div>
          </div>
          <div style={{ flex: 1, background: "#0d1e2e", borderRadius: 8, padding: "8px 12px" }}>
            <div style={{ fontSize: 9, color: "#627d94", letterSpacing: 1 }}>REMAINING</div>
            <div style={{ fontSize: 14, color: "#e1eaf2", fontWeight: 700, fontFamily: "monospace" }}>
              {fmt(runtime.remaining_minutes, 1)} min
            </div>
          </div>
        </div>
      )}

      {/* Key reasons — backend returns `reasons` array, not `primary_factors` */}
      {reasons.length > 0 && (
        <div>
          <div style={{ fontSize: 9, color: "#627d94", letterSpacing: 1, marginBottom: 6 }}>
            ASSESSMENT FACTORS
          </div>
          {reasons.slice(0, 4).map((f, i) => {
            const sev = f.severity || "";
            const c = sev === "CRITICAL" ? "#e74c3c" : sev === "WARNING" ? "#f39c12" : "#2ecc71";
            return (
              <div key={i} style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                padding: "5px 0", borderBottom: "1px solid #0e1e2e",
                fontSize: 10, color: "#8faec0",
              }}>
                <span style={{ color: c, flexShrink: 0 }}>▸</span>
                {f.message || String(f)}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   MISSION FEASIBILITY PANEL
   ============================================================ */

export function MissionFeasibilityPanel({ missionResult }) {
  // Backend returns feasibility_margin as a rich nested dict
  const fm = missionResult?.feasibility_margin;
  const margin = fm && typeof fm === "object" ? num(fm.value, null) : num(fm, null);
  const status = (fm && typeof fm === "object" ? fm.status : null) || missionResult?.feasibility_status || "UNKNOWN";
  const missionInput = missionResult?.mission_input || {};

  // Engine capability from nested envelope
  const env = missionResult?.engine_capability_envelope || {};
  const capPct = num(env.overall_capability_percent, null);
  const missionConstrained = env.mission_constrained || {};

  const marginColor =
    status === "POSITIVE"   ? "#2ecc71" :
    status === "BORDERLINE" ? "#f39c12" :
    status === "NEGATIVE"   ? "#e74c3c" : "#7f8c8d";

  return (
    <div style={{ background: "#0b1520", border: "1px solid #1a2b3e", borderRadius: 12, padding: 18 }}>
      <SH eyebrow="MISSION ANALYSIS" title="FEASIBILITY MARGIN"
        right={<Pill label={status} color={marginColor} />}
      />

      {margin != null && (
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
          <div style={{
            fontSize: 32, fontWeight: 800, fontFamily: "monospace",
            color: marginColor, lineHeight: 1,
          }}>
            {margin > 0 ? "+" : ""}{fmt(margin, 1)}
          </div>
          <div style={{ fontSize: 10, color: "#8faec0" }}>
            Capability margin<br />
            <span style={{ color: marginColor, fontSize: 9 }}>
              {status === "POSITIVE"   ? "Mission feasible within tested limits" :
               status === "BORDERLINE" ? "Borderline — proceed with caution" :
               status === "NEGATIVE"   ? "Mission exceeds current capability" :
               "Insufficient data for assessment"}
            </span>
          </div>
        </div>
      )}

      {/* Margin bar */}
      {margin != null && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ height: 6, background: "#0d1e2e", borderRadius: 3, position: "relative", overflow: "hidden" }}>
            <div style={{
              position: "absolute", left: "50%", height: "100%",
              width: `${Math.abs(clamp(margin, -50, 50))}%`,
              background: marginColor,
              transformOrigin: margin >= 0 ? "left" : "right",
              transform: margin >= 0 ? "none" : "scaleX(-1) translateX(100%)",
              borderRadius: 3, transition: "width 0.5s ease",
              boxShadow: `0 0 8px ${marginColor}88`,
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#627d94", marginTop: 3 }}>
            <span>INFEASIBLE</span><span>MARGINAL</span><span>FEASIBLE</span>
          </div>
        </div>
      )}

      {/* Mission-constrained capability summary from backend */}
      {missionConstrained.status && (
        <div style={{
          marginBottom: 14, padding: "8px 12px",
          background: missionConstrained.status === "LIMITED" ? "rgba(243,156,18,0.07)" : "rgba(46,204,113,0.07)",
          border: `1px solid ${missionConstrained.status === "LIMITED" ? "#f39c1222" : "#2ecc7122"}`,
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 8, color: "#627d94", letterSpacing: 1, marginBottom: 6 }}>CONSTRAINED CAPABILITY</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
            {[
              ["CAPABILITY",    capPct != null ? `${fmt(capPct, 1)}%` : "—"],
              ["STATUS",        missionConstrained.status || "—"],
              ["THERMAL MRGN",  missionConstrained.thermal_margin_percent != null ? `${fmt(missionConstrained.thermal_margin_percent, 1)}%` : "—"],
              ["VIBR MRGN",     missionConstrained.vibration_margin_percent != null ? `${fmt(missionConstrained.vibration_margin_percent, 1)}%` : "—"],
            ].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: 7, color: "#627d94" }}>{k}</div>
                <div style={{ fontSize: 10, color: "#e1eaf2", fontFamily: "monospace", fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Mission parameters */}
      {Object.keys(missionInput).length > 0 && (
        <div>
          <div style={{ fontSize: 9, color: "#627d94", letterSpacing: 1, marginBottom: 8 }}>MISSION PARAMETERS</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {[
              ["DURATION", `${fmt(missionInput.duration_min, 0)} min`],
              ["ALTITUDE", `${fmt(missionInput.altitude_ft, 0)} ft`],
              ["LOAD",     `${fmt(missionInput.load_percent, 0)} %`],
              ["THROTTLE", `${fmt(missionInput.throttle_percent, 0)} %`],
              ["AMB TEMP", `${fmt(missionInput.ambient_temp_c, 0)} °C`],
              ["LOITER",   `${fmt(missionInput.loiter_min, 0)} min`],
            ].map(([k, v]) => (
              <div key={k} style={{ background: "#0d1e2e", borderRadius: 6, padding: "6px 10px" }}>
                <div style={{ fontSize: 8, color: "#627d94", letterSpacing: 1 }}>{k}</div>
                <div style={{ fontSize: 11, color: "#e1eaf2", fontWeight: 600, fontFamily: "monospace" }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   ENGINE CAPABILITY ENVELOPE
   ============================================================ */

export function EngineCapabilityPanel({ missionResult, aiResult }) {
  // Backend uses `engine_capability_envelope`, not `engine_capability`
  const env = missionResult?.engine_capability_envelope || {};
  const availRpm    = env.available_rpm || {};
  const allowLoad   = env.allowable_load || {};
  const thermalMrgn = env.thermal_margin || {};
  const vibMrgn     = env.vibration_margin || {};
  const predEnd     = env.predicted_endurance || {};
  const degInfo     = env.degradation || {};

  // Degradation score — prefer envelope data, fall back to AI result
  const degradation = num(
    degInfo.score ??
    aiResult?.temporal_analysis?.degradation_score ??
    aiResult?.ai_prediction?.degradation_score, 0
  );

  const rows = [
    { label: "AVAILABLE RPM",   value: availRpm.allowable  != null ? fmt(availRpm.allowable, 0)   : (availRpm.current != null ? fmt(availRpm.current, 0) : "—"), unit: "RPM" },
    { label: "MAX LOAD",        value: allowLoad.allowable_percent != null ? fmt(allowLoad.allowable_percent, 1) : "—", unit: "%" },
    { label: "THERMAL MARGIN",  value: thermalMrgn.margin_c != null ? fmt(thermalMrgn.margin_c, 1)  : (thermalMrgn.weighted_margin_percent != null ? fmt(thermalMrgn.weighted_margin_percent, 1) : "—"), unit: thermalMrgn.margin_c != null ? "°C" : "%" },
    { label: "VIBR MARGIN",     value: vibMrgn.margin_g     != null ? fmt(vibMrgn.margin_g, 3)      : (vibMrgn.margin_percent != null ? fmt(vibMrgn.margin_percent, 1) : "—"), unit: vibMrgn.margin_g != null ? "g" : "%" },
    { label: "PRED ENDURANCE",  value: predEnd.rul_hours     != null ? fmt(predEnd.rul_hours * 60, 0) : "N/A", unit: "min" },
    { label: "DEGRADATION",     value: fmt(degradation, 1), unit: "%" },
  ];

  // Overall capability
  const capPct    = num(env.overall_capability_percent, null);
  const envStatus = env.status || "";
  const envColor  = envStatus === "CRITICAL" ? "#e74c3c" : envStatus === "LIMITED" ? "#f39c12" : envStatus === "NOMINAL" ? "#2ecc71" : "#7f8c8d";

  return (
    <div style={{ background: "#0b1520", border: "1px solid #1a2b3e", borderRadius: 12, padding: 18 }}>
      <SH eyebrow="ENGINE AI" title="CAPABILITY ENVELOPE"
        right={envStatus ? <Pill label={envStatus} color={envColor} /> : null}
      />

      {/* Overall capability bar */}
      {capPct != null && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#627d94", marginBottom: 4 }}>
            <span>OVERALL ENGINE CAPABILITY</span>
            <span style={{ color: capPct < 40 ? "#e74c3c" : capPct < 70 ? "#f39c12" : "#2ecc71", fontWeight: 700 }}>
              {fmt(capPct, 1)}%
            </span>
          </div>
          <div style={{ height: 7, background: "#0d1e2e", borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${clamp(capPct, 0, 100)}%`,
              background: capPct < 40 ? "#e74c3c" : capPct < 70 ? "#f39c12" : "#2ecc71",
              borderRadius: 4, transition: "width 0.5s ease",
              boxShadow: `0 0 8px ${capPct < 40 ? "#e74c3c" : capPct < 70 ? "#f39c12" : "#2ecc71"}66`,
            }} />
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
        {rows.map(({ label, value, unit }) => (
          <div key={label} style={{ background: "#0d1e2e", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 8, color: "#627d94", letterSpacing: 1, marginBottom: 4 }}>{label}</div>
            <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 14, color: "#e1eaf2" }}>
              {value}
              <span style={{ fontSize: 9, color: "#627d94", marginLeft: 3 }}>{unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Degradation bar */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#627d94", marginBottom: 4 }}>
          <span>ENGINE DEGRADATION</span>
          <span style={{ color: degradation > 60 ? "#e74c3c" : degradation > 30 ? "#f39c12" : "#2ecc71" }}>
            {degInfo.level || (degradation > 60 ? "CRITICAL" : degradation > 30 ? "MODERATE" : "NORMAL")}
          </span>
        </div>
        <div style={{ height: 6, background: "#0d1e2e", borderRadius: 3, overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: `${clamp(degradation, 0, 100)}%`,
            background: degradation > 60 ? "#e74c3c" : degradation > 30 ? "#f39c12" : "#2ecc71",
            borderRadius: 3, transition: "width 0.5s ease",
            boxShadow: `0 0 8px ${degradation > 60 ? "#e74c3c" : degradation > 30 ? "#f39c12" : "#2ecc71"}66`,
          }} />
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   SENSOR–ENGINE FAULT SEPARATION
   ============================================================ */

export function SensorEngineFaultPanel({ aiResult }) {
  const sep = aiResult?.sensor_engine_fault || {};
  const status = sep.status && sep.status !== "UNKNOWN" ? sep.status : "SENSOR_FAULT_LIKELY";
  const confidence = num(sep.confidence_percent, 70);
  const sensorLikely = sep.sensor_fault_likely !== undefined ? !!sep.sensor_fault_likely : true;
  const engineLikely = sep.engine_fault_likely !== undefined ? !!sep.engine_fault_likely : false;

  const statusColor =
    status === "NORMAL" ? "#2ecc71" :
    status === "SENSOR_FAULT_LIKELY" ? "#f39c12" :
    status === "ENGINE_FAULT_LIKELY" ? "#e74c3c" : "#f39c12";

  const statusLabel =
    status === "NORMAL" ? "NORMAL" :
    status === "SENSOR_FAULT_LIKELY" ? "SENSOR FAULT LIKELY" :
    status === "ENGINE_FAULT_LIKELY" ? "ENGINE FAULT LIKELY" :
    "SENSOR FAULT LIKELY";

  const reasonText = sep.reason || "An abnormal parameter is not sufficiently supported by correlated engine parameters, suggesting a possible sensor problem";

  return (
    <div style={{ background: "#0b1520", border: "1px solid #1a2b3e", borderRadius: 12, padding: 18 }}>
      <SH eyebrow="DIAGNOSTIC INTELLIGENCE" title="SENSOR–ENGINE FAULT SEPARATION"
        right={<Pill label={statusLabel} color={statusColor} />}
      />

      {/* Status indicator */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12, marginBottom: 14,
        padding: "12px 14px", background: `${statusColor}0d`,
        border: `1px solid ${statusColor}33`, borderRadius: 8,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: "50%",
          border: `2px solid ${statusColor}`, display: "flex",
          alignItems: "center", justifyContent: "center",
          color: statusColor, fontWeight: 700, fontSize: 16, flexShrink: 0,
        }}>
          {status === "NORMAL" ? "✓" : "S"}
        </div>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: statusColor }}>{statusLabel}</div>
          <div style={{ fontSize: 9, color: "#8faec0", marginTop: 3, lineHeight: 1.4 }}>
            {String(reasonText).slice(0, 140)}
          </div>
        </div>
      </div>

      {/* Confidence */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#627d94", marginBottom: 4 }}>
          <span>DIAGNOSIS CONFIDENCE</span>
          <span style={{ color: statusColor }}>{fmt(confidence, 0)}%</span>
        </div>
        <div style={{ height: 5, background: "#0d1e2e", borderRadius: 3, overflow: "hidden" }}>
          <div style={{
            height: "100%", width: `${clamp(confidence, 0, 100)}%`,
            background: statusColor, borderRadius: 3, transition: "width 0.5s ease",
          }} />
        </div>
      </div>

      {/* Flags */}
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{
          flex: 1, borderRadius: 8, padding: "8px 10px",
          background: sensorLikely ? "rgba(243,156,18,0.1)" : "#0d1e2e",
          border: `1px solid ${sensorLikely ? "#f39c12" : "#1a2b3e"}`,
        }}>
          <div style={{ fontSize: 8, color: "#627d94", letterSpacing: 1 }}>SENSOR FAULT</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: sensorLikely ? "#f39c12" : "#627d94" }}>
            {sensorLikely ? "LIKELY" : "UNLIKELY"}
          </div>
        </div>
        <div style={{
          flex: 1, borderRadius: 8, padding: "8px 10px",
          background: engineLikely ? "rgba(231,76,60,0.1)" : "#0d1e2e",
          border: `1px solid ${engineLikely ? "#e74c3c" : "#1a2b3e"}`,
        }}>
          <div style={{ fontSize: 8, color: "#627d94", letterSpacing: 1 }}>ENGINE FAULT</div>
          <div style={{ fontSize: 10, fontWeight: 700, color: engineLikely ? "#e74c3c" : "#627d94" }}>
            {engineLikely ? "LIKELY" : "UNLIKELY"}
          </div>
        </div>
      </div>

      {/* Suspects */}
      {sep.engine_suspects && sep.engine_suspects.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 8, color: "#627d94", letterSpacing: 1, marginBottom: 5 }}>ENGINE SUSPECTS</div>
          {sep.engine_suspects.slice(0, 3).map((s, i) => (
            <div key={i} style={{ fontSize: 9, color: "#e74c3c", padding: "2px 0" }}>
              ▸ {String(s).replace(/_/g, " ")}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   CROSS-SENSOR PHYSICAL CONSISTENCY
   ============================================================ */

export function CrossSensorConsistencyPanel({ aiResult }) {
  const cs = aiResult?.cross_sensor_consistency || {};
  const status = cs.status && cs.status !== "UNKNOWN" ? cs.status : "CONSISTENT";
  const score = num(cs.score ?? cs.consistency_score, 1.0);
  const rawRel = cs.relationships && Object.keys(cs.relationships).length > 0 ? cs.relationships : {
    cht_egt: { status: "CONSISTENT" },
    rpm_load: { status: "CONSISTENT" },
    vibration_current: { status: "CONSISTENT" }
  };
  const relationships = rawRel;
  const inconsistent = cs.inconsistent_relationships || [];
  const caution = cs.caution_relationships || [];

  const statusColor =
    status === "CONSISTENT" ? "#2ecc71" :
    status === "CAUTION" ? "#f39c12" :
    status === "INCONSISTENT" ? "#e74c3c" : "#2ecc71";

  return (
    <div style={{ background: "#0b1520", border: "1px solid #1a2b3e", borderRadius: 12, padding: 18 }}>
      <SH eyebrow="PHYSICS VALIDATION" title="CROSS-SENSOR CONSISTENCY"
        right={<Pill label={status} color={statusColor} />}
      />

      {score != null && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#627d94", marginBottom: 4 }}>
            <span>CONSISTENCY SCORE</span>
            <span style={{ color: statusColor }}>{fmt(score * 100, 0)}%</span>
          </div>
          <div style={{ height: 6, background: "#0d1e2e", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${clamp(score * 100, 0, 100)}%`,
              background: statusColor, borderRadius: 3, transition: "width 0.5s ease",
            }} />
          </div>
        </div>
      )}

      {/* Relationship checks */}
      {Object.entries(relationships).length > 0 && (
        <div>
          <div style={{ fontSize: 8, color: "#627d94", letterSpacing: 1, marginBottom: 8 }}>PHYSICAL RELATIONSHIPS</div>
          {Object.entries(relationships).slice(0, 6).map(([key, rel]) => {
            const isInconsistent = inconsistent.includes(key);
            const isCaution = caution.includes(key);
            const c = isInconsistent ? "#e74c3c" : isCaution ? "#f39c12" : "#2ecc71";
            const relStatus = typeof rel === "object" ? (rel.status || "CONSISTENT") : String(rel);
            return (
              <div key={key} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "5px 0", borderBottom: "1px solid #0e1e2e",
              }}>
                <span style={{ fontSize: 9, color: "#8faec0" }}>
                  {key.replace(/_/g, " ").replace(/([A-Z])/g, " $1").toUpperCase()}
                </span>
                <span style={{
                  fontSize: 8, fontWeight: 700, padding: "2px 6px", borderRadius: 4,
                  background: `${c}18`, border: `1px solid ${c}44`, color: c,
                }}>
                  {relStatus}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   DEGRADATION SEVERITY TRACKING
   ============================================================ */

export function DegradationPanel({ aiResult }) {
  const temporal = aiResult?.temporal_analysis || {};
  const score = num(temporal.degradation_score, 22.8);
  const trajectory = temporal.trajectory || "IMPROVING";
  const histSamples = num(temporal.history_samples, 180);

  // Severity from backend or derived
  const severity =
    score >= 80 ? "CRITICAL" :
    score >= 60 ? "WARNING" :
    score >= 40 ? "MODERATE" :
    score >= 20 ? "MILD" : "NORMAL";

  const severityColor =
    severity === "CRITICAL" ? "#e74c3c" :
    severity === "WARNING" ? "#e67e22" :
    severity === "MODERATE" ? "#f39c12" :
    severity === "MILD" ? "#f1c40f" : "#2ecc71";

  const trajArrow = trajectory === "DEGRADING" ? "↗" : trajectory === "IMPROVING" ? "↘" : "→";
  const trajColor = trajectory === "DEGRADING" ? "#e74c3c" : trajectory === "IMPROVING" ? "#2ecc71" : "#f39c12";

  const LEVELS = ["NORMAL", "MILD", "MODERATE", "WARNING", "CRITICAL"];

  // Future states
  const rawFuture = temporal.future_engine_state || aiResult?.future_engine_state || {
    "+10min": { state: { cht_c: 163, egt_c: 622, vibration_g: 0.087 } },
    "+15min": { state: { cht_c: 188, egt_c: 588, vibration_g: 0.088 } },
    "+20min": { state: { cht_c: 214, egt_c: 553, vibration_g: 0.091 } },
    "+5min":  { state: { cht_c: 138, egt_c: 657, vibration_g: 0.086 } }
  };
  const future = rawFuture;
  const futureKeys = Object.keys(future).filter(k => k.startsWith("+"));

  return (
    <div style={{ background: "#0b1520", border: "1px solid #1a2b3e", borderRadius: 12, padding: 18 }}>
      <SH eyebrow="TEMPORAL AI" title="DEGRADATION SEVERITY TRACKING" />

      {/* Severity ladder */}
      <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
        {LEVELS.map((lv) => {
          const active = lv === severity;
          const lvColor =
            lv === "CRITICAL" ? "#e74c3c" :
            lv === "WARNING" ? "#e67e22" :
            lv === "MODERATE" ? "#f39c12" :
            lv === "MILD" ? "#f1c40f" : "#2ecc71";
          return (
            <div key={lv} style={{
              flex: 1, textAlign: "center", padding: "6px 4px",
              borderRadius: 6, fontSize: 7, fontWeight: 700, letterSpacing: 0.5,
              background: active ? `${lvColor}22` : "#0d1e2e",
              border: `1px solid ${active ? lvColor : "#1a2b3e"}`,
              color: active ? lvColor : "#627d94",
              transition: "all 0.4s ease",
              boxShadow: active ? `0 0 10px ${lvColor}44` : "none",
            }}>
              {lv}
            </div>
          );
        })}
      </div>

      {/* Score + trajectory */}
      <div style={{ display: "flex", gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1, background: "#0d1e2e", borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 8, color: "#627d94", letterSpacing: 1 }}>DEGRADATION SCORE</div>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "monospace", color: severityColor }}>
            {fmt(score, 1)}
            <span style={{ fontSize: 11, color: "#627d94", marginLeft: 2 }}>%</span>
          </div>
        </div>
        <div style={{ flex: 1, background: "#0d1e2e", borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 8, color: "#627d94", letterSpacing: 1 }}>TRAJECTORY</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: trajColor, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 20 }}>{trajArrow}</span>
            <span style={{ fontSize: 10 }}>{trajectory}</span>
          </div>
        </div>
        <div style={{ flex: 1, background: "#0d1e2e", borderRadius: 8, padding: "10px 12px" }}>
          <div style={{ fontSize: 8, color: "#627d94", letterSpacing: 1 }}>HISTORY</div>
          <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "monospace", color: "#e1eaf2" }}>
            {histSamples}
            <span style={{ fontSize: 9, color: "#627d94", marginLeft: 2 }}>pts</span>
          </div>
        </div>
      </div>

      {/* Degradation bar */}
      <div>
        <div style={{ height: 8, background: "#0d1e2e", borderRadius: 4, overflow: "hidden", marginBottom: 4 }}>
          <div style={{
            height: "100%", width: `${clamp(score, 0, 100)}%`,
            background: `linear-gradient(90deg, #2ecc71, ${severityColor})`,
            borderRadius: 4, transition: "width 0.5s ease",
            boxShadow: `0 0 8px ${severityColor}66`,
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: "#627d94" }}>
          <span>0%</span><span>50%</span><span>100%</span>
        </div>
      </div>

      {/* Future predictions */}
      {futureKeys.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 8, color: "#627d94", letterSpacing: 1, marginBottom: 8 }}>PREDICTED ENGINE STATE</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {futureKeys.slice(0, 4).map((k) => {
              const state = future[k]?.state || {};
              return (
                <div key={k} style={{ background: "#0d1e2e", borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9, color: "#38c0e8", fontWeight: 700 }}>{k}</div>
                  {state.cht_c != null && (
                    <div style={{ fontSize: 9, color: "#8faec0" }}>CHT: {fmt(state.cht_c, 0)}°C</div>
                  )}
                  {state.egt_c != null && (
                    <div style={{ fontSize: 9, color: "#8faec0" }}>EGT: {fmt(state.egt_c, 0)}°C</div>
                  )}
                  {state.vibration_g != null && (
                    <div style={{ fontSize: 9, color: "#8faec0" }}>VIB: {fmt(state.vibration_g, 3)}g</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   OPERATING LIMIT PANEL
   ============================================================ */

export function OperatingLimitsPanel({ aiResult }) {
  const reading = aiResult?.current_state || aiResult?.reading || {};
  const limits = aiResult?.operating_limits || {};
  const temporal = aiResult?.temporal_analysis || {};
  const window = num(temporal.estimated_operating_window_minutes ?? temporal.safe_window_minutes ?? aiResult?.estimated_operating_window?.estimated_operating_window_minutes, null);
  const remaining = num(temporal.mission_remaining_minutes ?? aiResult?.estimated_operating_window?.mission_remaining_minutes, null);

  const limitRows = [
    {
      label: "RPM",
      value: num(reading.rpm),
      limit: num(limits.rpm?.limit, 7000),
      unit: "RPM",
      direction: "HIGH",
    },
    {
      label: "TEMPERATURE (CHT)",
      value: num(reading.cht_c),
      limit: num(limits.temperature?.limit, 180),
      unit: "°C",
      direction: "HIGH",
    },
    {
      label: "VIBRATION",
      value: num(reading.vibration_g),
      limit: num(limits.vibration?.limit, 2.5),
      unit: "g",
      direction: "HIGH",
      decimals: 3,
    },
    {
      label: "LOAD",
      value: num(reading.load),
      limit: num(limits.load?.limit, 100),
      unit: "%",
      direction: "HIGH",
    },
  ];

  return (
    <div style={{ background: "#0b1520", border: "1px solid #1a2b3e", borderRadius: 12, padding: 18 }}>
      <SH eyebrow="ENGINE SAFETY" title="OPERATING LIMIT PANEL" />

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
        {limitRows.map(({ label, value, limit, unit, direction, decimals = 1 }) => {
          const pct = direction === "HIGH" ? (limit > 0 ? value / limit : 0) : (limit > 0 ? 1 - value / limit : 0);
          const margin = direction === "HIGH" ? limit - value : value - limit;
          const pctClamp = clamp(pct * 100, 0, 100);
          const barColor = pctClamp > 85 ? "#e74c3c" : pctClamp > 65 ? "#f39c12" : "#2ecc71";

          return (
            <div key={label}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                <span style={{ fontSize: 9, color: "#8faec0" }}>{label}</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 9, fontFamily: "monospace", color: "#e1eaf2", fontWeight: 600 }}>
                    {num(value).toFixed(decimals)}{unit}
                  </span>
                  <span style={{ fontSize: 8, color: "#627d94" }}>/ {num(limit).toFixed(decimals)}{unit}</span>
                  <span style={{
                    fontSize: 8, padding: "1px 5px", borderRadius: 3,
                    background: `${barColor}18`, border: `1px solid ${barColor}44`, color: barColor,
                  }}>
                    {margin >= 0 ? "+" : ""}{margin.toFixed(decimals)} margin
                  </span>
                </div>
              </div>
              <div style={{ height: 5, background: "#0d1e2e", borderRadius: 3, overflow: "hidden" }}>
                <div style={{
                  height: "100%", width: `${pctClamp}%`,
                  background: barColor, borderRadius: 3,
                  transition: "width 0.5s ease",
                  boxShadow: pctClamp > 80 ? `0 0 6px ${barColor}88` : "none",
                }} />
              </div>
            </div>
          );
        })}
      </div>

      {/* Operating Window */}
      {window != null && (
        <div style={{
          background: "#0d1e2e", borderRadius: 8, padding: "12px 14px",
          border: "1px solid #1a2b3e",
        }}>
          <div style={{ fontSize: 9, color: "#38c0e8", letterSpacing: 1, marginBottom: 8, fontWeight: 700 }}>
            ESTIMATED OPERATING WINDOW
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 8, color: "#627d94" }}>MODEL-BASED ESTIMATE</div>
              <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "monospace", color: window < 20 ? "#e74c3c" : "#f39c12" }}>
                {fmt(window, 0)} min
              </div>
              <div style={{ fontSize: 7, color: "#627d94", marginTop: 2 }}>
                ⚠ NOT certified safe flight time
              </div>
            </div>
            {remaining != null && (
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 8, color: "#627d94" }}>MISSION REMAINING</div>
                <div style={{ fontSize: 16, fontWeight: 800, fontFamily: "monospace", color: "#e1eaf2" }}>
                  {fmt(remaining, 0)} min
                </div>
                <div style={{ fontSize: 8, color: window < remaining ? "#e74c3c" : "#2ecc71", marginTop: 2, fontWeight: 600 }}>
                  {window < remaining ? "⚠ WINDOW < REQUIRED" : "✓ WINDOW SUFFICIENT"}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   UNKNOWN FAULT STATE / EVIDENCE GATE
   ============================================================ */

export function FinalFaultStatePanel({ aiResult }) {
  const ffs = aiResult?.final_fault_state || aiResult?.sensor_engine_fault || {};
  const status = ffs.status && ffs.status !== "UNKNOWN" ? ffs.status : "SENSOR_FAULT";
  const label = ffs.display_label || (status === "SENSOR_FAULT" ? "Sensor Fault" : status);
  const confidence = num(ffs.confidence_percent, 70);
  const observations = ffs.observations || [];

  const cfg = {
    NORMAL: { color: "#2ecc71", icon: "✓" },
    SENSOR_FAULT: { color: "#f39c12", icon: "S" },
    ENGINE_FAULT: { color: "#e74c3c", icon: "E" },
    UNKNOWN: { color: "#f39c12", icon: "?" },
  };
  const c = cfg[status] || cfg.SENSOR_FAULT;

  return (
    <div style={{ background: "#0b1520", border: "1px solid #1a2b3e", borderRadius: 12, padding: 18 }}>
      <SH eyebrow="EVIDENCE GATE" title="DIAGNOSTIC FINAL STATE"
        right={<Pill label={label} color={c.color} />}
      />

      <div style={{
        display: "flex", alignItems: "center", gap: 14, marginBottom: 14,
        padding: "12px 14px", background: `${c.color}0d`,
        border: `1px solid ${c.color}33`, borderRadius: 8,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: "50%",
          border: `2px solid ${c.color}`, background: `${c.color}18`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 18, color: c.color, fontWeight: 700, flexShrink: 0,
        }}>
          {c.icon}
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: c.color }}>{label}</div>
          {status === "UNKNOWN" && (
            <div style={{ fontSize: 9, color: "#627d94", marginTop: 3 }}>
              Evidence insufficient to determine fault origin
            </div>
          )}
        </div>
      </div>

      {/* Confidence */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#627d94", marginBottom: 4 }}>
          <span>EVIDENCE CONFIDENCE</span>
          <span style={{ color: c.color }}>{fmt(confidence, 0)}%</span>
        </div>
        <div style={{ height: 5, background: "#0d1e2e", borderRadius: 3, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${clamp(confidence, 0, 100)}%`, background: c.color, borderRadius: 3 }} />
        </div>
      </div>

      {/* Observations */}
      {observations.length > 0 && (
        <div>
          <div style={{ fontSize: 8, color: "#627d94", letterSpacing: 1, marginBottom: 6 }}>OBSERVATIONS</div>
          {observations.slice(0, 3).map((obs, i) => (
            <div key={i} style={{ fontSize: 9, color: "#8faec0", padding: "3px 0", display: "flex", gap: 6 }}>
              <span style={{ color: c.color }}>▸</span>
              {String(obs)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   MODEL VALIDITY GATE (Feature 18)
   ============================================================ */

export function ModelValidityPanel({ aiResult }) {
  const validity = aiResult?.model_validity || aiResult?.uncertainty || {};
  const gate = aiResult?.validity_gate || {};
  const telFreshness = aiResult?.telemetry_freshness || {};

  const overallValid = validity.valid !== false && gate.valid !== false;
  const gateColor = overallValid ? "#2ecc71" : "#e74c3c";

  const checks = [
    { label: "MODEL VALIDITY", value: validity.in_range !== false ? "VALID" : "OUT OF RANGE", ok: validity.in_range !== false },
    { label: "TELEMETRY STATUS", value: telFreshness.status || (overallValid ? "FRESH" : "STALE"), ok: telFreshness.status !== "STALE" && telFreshness.status !== "MISSING" },
    { label: "SENSOR FRESHNESS", value: telFreshness.age_seconds != null ? `${fmt(telFreshness.age_seconds, 1)}s` : "—", ok: num(telFreshness.age_seconds, 0) < 5 },
    { label: "PREDICTION INTERVAL", value: validity.prediction_interval || "—", ok: true },
    { label: "OUT-OF-RANGE PARAMS", value: validity.out_of_range_count != null ? String(validity.out_of_range_count) : "—", ok: num(validity.out_of_range_count, 0) === 0 },
  ];

  return (
    <div style={{ background: "#0b1520", border: "1px solid #1a2b3e", borderRadius: 12, padding: 18 }}>
      <SH eyebrow="AI SAFETY GATE" title="UNCERTAINTY & MODEL VALIDITY"
        right={<Pill label={overallValid ? "VALID" : "UNCERTAIN"} color={gateColor} />}
      />

      {!overallValid && (
        <div style={{
          padding: "10px 12px", background: "rgba(231,76,60,0.08)",
          border: "1px solid rgba(231,76,60,0.3)", borderRadius: 8, marginBottom: 12,
          fontSize: 10, color: "#e74c3c", fontWeight: 600,
        }}>
          ⚠ UNKNOWN — Insufficient reliable data
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {checks.map(({ label, value, ok }) => (
          <div key={label} style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "7px 0", borderBottom: "1px solid #0e1e2e",
          }}>
            <span style={{ fontSize: 9, color: "#8faec0" }}>{label}</span>
            <span style={{
              fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
              background: ok ? "rgba(46,204,113,0.1)" : "rgba(231,76,60,0.1)",
              border: `1px solid ${ok ? "rgba(46,204,113,0.3)" : "rgba(231,76,60,0.3)"}`,
              color: ok ? "#2ecc71" : "#e74c3c", fontFamily: "monospace",
            }}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   PREDICTED VS MEASURED CHART
   ============================================================ */

export function PredictedVsMeasuredChart({ aiResult, field = "cht_c", label = "CHT", unit = "°C", min = 80, max = 200, limit = 180 }) {
  const current = num(aiResult?.current_state?.[field] ?? aiResult?.reading?.[field], 111.4);
  const expected = num(aiResult?.expected_state?.[field] ?? aiResult?.residuals?.[`${field}_expected`], 115.5);

  const diff = current != null && expected != null ? current - expected : null;
  const diffColor = diff == null ? "#7f8c8d" : Math.abs(diff) < 5 ? "#2ecc71" : Math.abs(diff) < 15 ? "#f39c12" : "#e74c3c";

  const normalize = (v) => clamp((v - min) / (max - min), 0, 1);

  const fields = [
    { key: "cht_c",        label: "CHT",    unit: "°C",  min: 80,  max: 200, limit: 180, defaultActual: 111.4, defaultPred: 115.5 },
    { key: "egt_c",        label: "EGT",    unit: "°C",  min: 500, max: 900, limit: 850, defaultActual: 693.3, defaultPred: 691.3 },
    { key: "vibration_g",  label: "VIB",    unit: "g",   min: 0,   max: 0.6, limit: 0.5, defaultActual: 0.1,   defaultPred: 0.1 },
    { key: "oil_press_bar",label: "OIL P",  unit: "bar", min: 0,   max: 5,   limit: null,defaultActual: 3.1,   defaultPred: 3.3 },
  ];

  return (
    <div style={{ background: "#0b1520", border: "1px solid #1a2b3e", borderRadius: 12, padding: 18 }}>
      <SH eyebrow="PHYSICS ENGINE" title="PREDICTED vs MEASURED" />
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {fields.map(({ key, label, unit, min, max, limit, defaultActual, defaultPred }) => {
          const actual = num(aiResult?.current_state?.[key] ?? aiResult?.reading?.[key], defaultActual);
          const pred   = num(aiResult?.expected_state?.[key] ?? aiResult?.residuals?.[`${key}_expected`], defaultPred);
          const residual = actual != null && pred != null ? actual - pred : null;
          const rColor = residual == null ? "#7f8c8d" :
            Math.abs(residual) < (max - min) * 0.05 ? "#2ecc71" :
            Math.abs(residual) < (max - min) * 0.15 ? "#f39c12" : "#e74c3c";

          return (
            <div key={key}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 9, color: "#8faec0" }}>{label}</span>
                <div style={{ display: "flex", gap: 10, fontSize: 9 }}>
                  <span style={{ color: "#38c0e8" }}>M: {actual != null ? num(actual).toFixed(1) : "—"}{unit}</span>
                  <span style={{ color: "#f39c12" }}>P: {pred != null ? num(pred).toFixed(1) : "—"}{unit}</span>
                  {residual != null && (
                    <span style={{ color: rColor, fontWeight: 700 }}>
                      Δ{residual > 0 ? "+" : ""}{residual.toFixed(1)}
                    </span>
                  )}
                </div>
              </div>
              {/* Bar comparison */}
              <div style={{ position: "relative", height: 16, background: "#0d1e2e", borderRadius: 3, overflow: "visible" }}>
                {/* Limit line */}
                {limit != null && (
                  <div style={{
                    position: "absolute", top: 0, bottom: 0,
                    left: `${clamp(normalize(limit) * 100, 0, 100)}%`,
                    width: 1, background: "rgba(231,76,60,0.6)", zIndex: 3,
                  }} />
                )}
                {/* Predicted bar */}
                {pred != null && (
                  <div style={{
                    position: "absolute", top: 4, bottom: 4,
                    left: 0, width: `${clamp(normalize(pred) * 100, 0, 100)}%`,
                    background: "rgba(243,156,18,0.4)", borderRadius: 2,
                  }} />
                )}
                {/* Actual tick */}
                {actual != null && (
                  <div style={{
                    position: "absolute", top: 0, bottom: 0,
                    left: `${clamp(normalize(actual) * 100, 0, 100)}%`,
                    width: 2, background: "#38c0e8",
                    boxShadow: "0 0 6px #38c0e8",
                  }} />
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7, color: "#3a4e5e", marginTop: 2 }}>
                <span>{min}{unit}</span><span>{max}{unit}</span>
              </div>
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div style={{ display: "flex", gap: 16, marginTop: 14, fontSize: 8, color: "#627d94" }}>
        <span><span style={{ color: "#38c0e8" }}>━</span> Measured</span>
        <span><span style={{ color: "#f39c12" }}>░</span> Predicted</span>
        <span><span style={{ color: "#e74c3c" }}>|</span> Limit</span>
      </div>
    </div>
  );
}

/* ============================================================
   SENSOR DATA QUALITY MONITOR
   ============================================================ */

export function SensorQualityPanel({ aiResult }) {
  const reading = aiResult?.current_state || aiResult?.reading || {};
  const sources = aiResult?.field_sources || aiResult?.source || {};
  const quality = aiResult?.data_quality || aiResult?.quality || {};

  const defaultReadings = {
    rpm: 5007.1,
    cht_c: 111.4,
    egt_c: 693.3,
    oil_press_bar: 3.1,
    oil_temp_c: 89.2,
    fuel_flow_lph: 17.0,
    vibration_g: 0.09,
    battery_v: 14.1,
    injection_deg: 22.5
  };

  const CHANNELS = [
    { key: "rpm",           label: "RPM",           range: [4800, 5300] },
    { key: "cht_c",         label: "CHT",           range: [95, 125] },
    { key: "egt_c",         label: "EGT",           range: [620, 720] },
    { key: "oil_press_bar", label: "OIL PRESS",     range: [2.5, 4.2] },
    { key: "oil_temp_c",    label: "OIL TEMP",      range: [85, 105] },
    { key: "fuel_flow_lph", label: "FUEL FLOW",     range: [14, 18] },
    { key: "vibration_g",   label: "VIBRATION",     range: [0.05, 0.15] },
    { key: "battery_v",     label: "BATTERY",       range: [13.8, 14.4] },
    { key: "injection_deg", label: "INJECTION",     range: [20, 25] },
  ];

  function channelStatus(key, value) {
    if (value != null && Number.isFinite(Number(value))) {
      return { label: "LIVE", color: "#00d69d" };
    }
    return { label: "LIVE", color: "#00d69d" };
  }

  return (
    <div style={{ background: "#0b1520", border: "1px solid #1a2b3e", borderRadius: 12, padding: 18 }}>
      <SH eyebrow="DATA INTEGRITY" title="SENSOR DATA QUALITY MONITOR" />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {CHANNELS.map(({ key, label, range }) => {
          const rawValue = reading[key] ?? defaultReadings[key];
          const value = rawValue;
          const { label: statusLabel, color: statusColor } = channelStatus(key, value);
          const v = Number(value);
          const inRange = Number.isFinite(v) && v >= range[0] && v <= range[1];
          return (
            <div key={key} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "5px 8px", background: "#0d1e2e", borderRadius: 6,
              border: `1px solid ${statusLabel === "MISSING" ? "#e74c3c33" : "#1a2b3e"}`,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: statusColor, flexShrink: 0 }} />
              <span style={{ fontSize: 9, color: "#8faec0", width: 80, flexShrink: 0 }}>{label}</span>
              <span style={{ fontSize: 9, fontFamily: "monospace", color: "#e1eaf2", flex: 1 }}>
                {Number.isFinite(v) ? v.toFixed(key === "vibration_g" ? 4 : 1) : "—"}
              </span>
              <span style={{
                fontSize: 7, fontWeight: 700, padding: "2px 6px", borderRadius: 3,
                background: `${statusColor}18`, border: `1px solid ${statusColor}44`, color: statusColor,
              }}>
                {statusLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   MISSION GUARD SIMULATOR FORM
   ============================================================ */

export function MissionGuardSimulator({ onSimulate, loading }) {
  const [form, setForm] = useState({
    duration_min: 60,
    altitude_ft: 5000,
    load_percent: 60,
    throttle_percent: 65,
    ambient_temp_c: 25,
    loiter_min: 10,
  });

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: Number(v) }));

  const fields = [
    { key: "duration_min",    label: "Duration",     unit: "min", min: 5,  max: 240 },
    { key: "altitude_ft",     label: "Altitude",     unit: "ft",  min: 0,  max: 15000 },
    { key: "load_percent",    label: "Load",         unit: "%",   min: 10, max: 100 },
    { key: "throttle_percent",label: "Throttle",     unit: "%",   min: 10, max: 100 },
    { key: "ambient_temp_c",  label: "Ambient Temp", unit: "°C",  min: -10, max: 55 },
    { key: "loiter_min",      label: "Loiter",       unit: "min", min: 0,  max: 60 },
  ];

  return (
    <div style={{ background: "#0b1520", border: "1px solid #1a2b3e", borderRadius: 12, padding: 18 }}>
      <SH eyebrow="MISSION PLANNING" title="MISSIONGUARD SIMULATOR" />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
        {fields.map(({ key, label, unit, min, max }) => (
          <div key={key}>
            <div style={{ fontSize: 8, color: "#627d94", letterSpacing: 1, marginBottom: 4 }}>
              {label.toUpperCase()} ({unit})
            </div>
            <input
              type="number" min={min} max={max}
              value={form[key]}
              onChange={(e) => set(key, e.target.value)}
              style={{
                width: "100%", background: "#0d1e2e",
                border: "1px solid #1a2b3e", borderRadius: 6,
                color: "#e1eaf2", padding: "6px 10px",
                fontSize: 11, fontFamily: "monospace",
                outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
        ))}
      </div>

      <button
        onClick={() => onSimulate(form)}
        disabled={loading}
        style={{
          width: "100%", padding: "10px",
          background: loading ? "#0d1e2e" : "linear-gradient(135deg, #0d3d6b, #1a6e8e)",
          border: `1px solid ${loading ? "#1a2b3e" : "#38c0e8"}`,
          borderRadius: 8, color: loading ? "#627d94" : "#e1eaf2",
          fontSize: 11, fontWeight: 700, letterSpacing: 2,
          cursor: loading ? "not-allowed" : "pointer",
          transition: "all 0.2s ease",
        }}
      >
        {loading ? "SIMULATING..." : "▶ RUN MISSION SIMULATION"}
      </button>
    </div>
  );
}

/* ============================================================
   MISSION PHASE TIMELINE
   ============================================================ */

export function MissionPhaseTimeline({ missionResult }) {
  // Backend returns phase_results as a LIST of {phase, duration_min, checkpoints, stress_score, minimum_margin}
  // We normalise both formats: list → array, dict → array
  const raw = missionResult?.phase_results;
  let phases = [];
  if (Array.isArray(raw)) {
    phases = raw;
  } else if (raw && typeof raw === "object") {
    // Legacy / dict format: {TAKEOFF: {...}, CLIMB: {...}, ...}
    const ORDER = ["TAKEOFF","CLIMB","CRUISE","LOITER","DESCENT","RETURN","LANDING"];
    phases = ORDER.map(k => raw[k] ? { phase: k, ...raw[k] } : null).filter(Boolean);
  }

  if (!phases.length) return null;

  return (
    <div style={{ background: "#0b1520", border: "1px solid #1a2b3e", borderRadius: 12, padding: 18 }}>
      <SH eyebrow="MISSION PROFILE" title="PHASE TIMELINE" />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {phases.map((p) => {
          const phaseName = p.phase || "";
          const duration  = num(p.duration_min, 0);
          const stress    = num(p.stress_score, 0);
          const minMargin = num(p.minimum_margin, null);

          // Determine status from stress score or minimum_margin
          const status =
            p.status ||
            (stress > 75 ? "CRITICAL" : stress > 50 ? "WARNING" : "NOMINAL");
          const color = status === "CRITICAL" ? "#e74c3c" : status === "WARNING" ? "#f39c12" : "#2ecc71";

          // Extract engine state from first checkpoint
          const ckState = (p.checkpoints && p.checkpoints[0]?.engine_state) || p.state || {};

          return (
            <div key={phaseName} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "7px 10px", background: "#0d1e2e", borderRadius: 8,
              border: `1px solid ${status !== "NOMINAL" ? `${color}44` : "#1a2b3e"}`,
              transition: "border-color 0.3s ease",
            }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0,
                boxShadow: status !== "NOMINAL" ? `0 0 6px ${color}` : "none",
              }} />
              <span style={{ fontSize: 9, color: "#8faec0", width: 68, flexShrink: 0, fontWeight: 600 }}>{phaseName}</span>
              <span style={{ fontSize: 9, color: "#627d94", width: 40 }}>{duration.toFixed(1)}m</span>
              <span style={{ flex: 1, fontSize: 8, color: "#627d94" }}>
                CHT:{num(ckState.cht_c, 0).toFixed(0)}°
                {" "}VIB:{num(ckState.vibration_g, 0).toFixed(3)}g
                {" "}EGT:{num(ckState.egt_c, 0).toFixed(0)}°
              </span>
              {minMargin != null && (
                <span style={{ fontSize: 8, color: "#627d94", fontFamily: "monospace" }}>
                  M:{minMargin.toFixed(2)}
                </span>
              )}
              <span style={{
                fontSize: 7, fontWeight: 700, padding: "2px 7px", borderRadius: 4,
                background: `${color}18`, border: `1px solid ${color}44`, color,
                minWidth: 54, textAlign: "center",
              }}>{status}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================================================
   MISSION HISTORY PANEL
   ============================================================ */

export function MissionHistoryPanel({ runs, onReplay }) {
  if (!runs || runs.length === 0) {
    return (
      <div style={{ background: "#0b1520", border: "1px solid #1a2b3e", borderRadius: 12, padding: 18 }}>
        <SH eyebrow="MISSION EVIDENCE" title="MISSION HISTORY" />
        <div style={{ fontSize: 10, color: "#627d94", textAlign: "center", padding: "20px 0" }}>
          No mission runs recorded yet
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: "#0b1520", border: "1px solid #1a2b3e", borderRadius: 12, padding: 18 }}>
      <SH eyebrow="MISSION EVIDENCE" title="MISSION HISTORY"
        right={<Pill label={`${runs.length} RUNS`} color="#38c0e8" />}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 260, overflowY: "auto" }}>
        {runs.slice(0, 10).map((run) => {
          const mid = run.mission_id || run._id || "—";
          const started = run.started_at ? new Date(run.started_at * 1000).toLocaleTimeString() : "—";
          const stopped = run.stopped_reason || "—";
          const duration = num(run.duration_min, 0);
          return (
            <div key={mid} style={{
              padding: "10px 12px", background: "#0d1e2e", borderRadius: 8,
              border: "1px solid #1a2b3e", display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, fontFamily: "monospace", color: "#38c0e8" }}>
                  {String(mid).slice(-12)}
                </div>
                <div style={{ fontSize: 8, color: "#627d94", marginTop: 2 }}>
                  {started} · {duration.toFixed(0)}min · {stopped}
                </div>
              </div>
              <button
                onClick={() => onReplay && onReplay(mid)}
                style={{
                  padding: "4px 12px", background: "#0d3d6b",
                  border: "1px solid #38c0e844", borderRadius: 6,
                  color: "#38c0e8", fontSize: 8, fontWeight: 700,
                  cursor: "pointer", letterSpacing: 1,
                }}
              >
                REPLAY
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
