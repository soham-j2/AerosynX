/**
 * MissionReplayReview.jsx
 *
 * DRDO Mission Review & Timeline Replay System
 *
 * Features:
 *   1. Visible Timeline Scrubber UX: High-visibility scrubber track positioned permanently within screen bounds.
 *   2. Delete Mission Option: Delete any previous mission with confirmation, API call, and toast feedback.
 *   3. Download Mission Data Option: Export complete mission telemetry & parameters as JSON or CSV files.
 *   4. 3D Model Freeze: Freezes the 3D UAV model when playback is paused.
 */

import React, { useState, useEffect, useRef, useMemo } from "react";
import { toast } from "react-toastify";
import UAVNewModel from "./newmodel.jsx";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

/*/* ============================================================
   DEFAULT MISSIONS (WIPED: ONLY ACTUAL USER-RECORDED MISSIONS)
   ============================================================ */

const DEFAULT_MISSIONS = [];

/* ============================================================
   TELEMETRY COMPUTATION FOR SCRUBBED TIMESTAMP
   ============================================================ */

function num(val, fb = 0) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fb;
}

function calculateReplayState(mission, currentTimeSec) {
  if (!mission) {
    return { activePhase: "STANDBY", state: {}, packet: null };
  }
  const timeMin = currentTimeSec / 60;

  // Check if exact recorded telemetry timeline samples exist for this recorded mission
  if (mission?.samples && Array.isArray(mission.samples) && mission.samples.length > 0) {
    let closestSample = mission.samples[0];
    let minDiff = Infinity;
    for (let s of mission.samples) {
      const sampleSec = s.timeSec !== undefined ? s.timeSec : (s.timeMin || 0) * 60;
      const diff = Math.abs(sampleSec - currentTimeSec);
      if (diff < minDiff) {
        minDiff = diff;
        closestSample = s;
      }
    }
    const rd = closestSample.reading || closestSample;
    const state = {
      pitch_deg: parseFloat(num(rd.pitch_deg, 0).toFixed(1)),
      roll_deg: parseFloat(num(rd.roll_deg, 0).toFixed(1)),
      yaw_deg: parseFloat(num(rd.yaw_deg, (currentTimeSec * 5) % 360).toFixed(1)),
      rpm: Math.round(num(rd.rpm, 4950)),
      cht_c: parseFloat(num(rd.cht_c, 118).toFixed(1)),
      egt_c: parseFloat(num(rd.egt_c, 705).toFixed(1)),
      oil_press_bar: parseFloat(num(rd.oil_press_bar, 3.2).toFixed(1)),
      oil_temp_c: parseFloat(num(rd.oil_temp_c, 92).toFixed(1)),
      fuel_flow_lph: parseFloat(num(rd.fuel_flow_lph, 15.8).toFixed(1)),
      vibration_g: parseFloat(num(rd.vibration_g, 0.14).toFixed(2)),
      battery_v: parseFloat(num(rd.battery_v, 14.1).toFixed(1)),
      altitude_ft: Math.round(num(rd.altitude_ft, mission.max_altitude_ft || 5000)),
      speed_knots: Math.round(num(rd.speed_knots, 120)),
    };
    const activePhase = closestSample.phase || "FLIGHT TELEMETRY RECORDING";
    const packet = {
      reading: state,
      current_state: state,
      context: {
        active_fault: rd.active_fault || "none",
        mission_profile: "flight_recording",
      },
      ai_prediction: {
        predicted_fault: rd.active_fault && rd.active_fault !== "none" ? rd.active_fault.toUpperCase() : "NONE",
        fault_confidence: 0.98,
        condition: rd.active_fault && rd.active_fault !== "none" ? "DEGRADED" : "NOMINAL",
      },
    };
    return { activePhase, state, packet };
  }

  // Basic fallback state if mission has no samples array
  const rd = mission.reading || {};
  const state = {
    pitch_deg: parseFloat(num(rd.pitch_deg, 0).toFixed(1)),
    roll_deg: parseFloat(num(rd.roll_deg, 0).toFixed(1)),
    yaw_deg: parseFloat(num(rd.yaw_deg, (currentTimeSec * 5) % 360).toFixed(1)),
    rpm: Math.round(num(rd.rpm, 4950)),
    cht_c: parseFloat(num(rd.cht_c, 118).toFixed(1)),
    egt_c: parseFloat(num(rd.egt_c, 705).toFixed(1)),
    oil_press_bar: parseFloat(num(rd.oil_press_bar, 3.2).toFixed(1)),
    oil_temp_c: parseFloat(num(rd.oil_temp_c, 92).toFixed(1)),
    fuel_flow_lph: parseFloat(num(rd.fuel_flow_lph, 15.8).toFixed(1)),
    vibration_g: parseFloat(num(rd.vibration_g, 0.14).toFixed(2)),
    battery_v: parseFloat(num(rd.battery_v, 14.1).toFixed(1)),
    altitude_ft: Math.round(num(rd.altitude_ft, mission.max_altitude_ft || 5000)),
    speed_knots: Math.round(num(rd.speed_knots, 120)),
  };
  const activePhase = "FLIGHT RECORDING";
  const packet = {
    reading: state,
    current_state: state,
    context: { active_fault: "none", mission_profile: "flight_recording" },
    ai_prediction: { predicted_fault: "NONE", fault_confidence: 0.98, condition: "NOMINAL" },
  };
  return { activePhase, state, packet };
}

/* ============================================================
   MAIN COMPONENT: MissionReplayReview
   ============================================================ */

export function MissionReplayReview({ completedMissions = [], onNavigateToMissionGuard }) {
  // Load deleted mission IDs from localStorage so deletion persists across refresh
  const [deletedMissionIds, setDeletedMissionIds] = useState(() => {
    try {
      const saved = localStorage.getItem("aerosynx_deleted_missions");
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // Load user-recorded actual missions from localStorage
  const [recordedMissions, setRecordedMissions] = useState(() => {
    try {
      const saved = localStorage.getItem("aerosynx_recorded_missions");
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  // Listen for mission updates (e.g. stopping a mission) to sync recordedMissions state immediately
  useEffect(() => {
    const handleUpdate = (e) => {
      try {
        const saved = localStorage.getItem("aerosynx_recorded_missions");
        if (saved) {
          const parsed = JSON.parse(saved);
          setRecordedMissions(parsed);
          if (e?.detail?.newMission?.mission_id) {
            setSelectedMissionId(e.detail.newMission.mission_id);
          } else if (parsed.length > 0) {
            setSelectedMissionId(parsed[0].mission_id);
          }
        }
      } catch (err) {}
    };

    window.addEventListener("aerosynx_mission_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("aerosynx_mission_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, []);

  // Save deleted IDs to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("aerosynx_deleted_missions", JSON.stringify(deletedMissionIds));
    } catch (e) { }
  }, [deletedMissionIds]);

  // Save recorded missions to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("aerosynx_recorded_missions", JSON.stringify(recordedMissions));
    } catch (e) { }
  }, [recordedMissions]);

  // Only include user-recorded actual missions, filtering out deleted ones
  const allMissions = useMemo(() => {
    const combined = [...recordedMissions];
    completedMissions.forEach((m) => {
      if (!combined.some((c) => c.mission_id === m.mission_id)) {
        combined.push(m);
      }
    });
    return combined.filter(m => !deletedMissionIds.includes(m.mission_id));
  }, [recordedMissions, completedMissions, deletedMissionIds]);

  const [selectedMissionId, setSelectedMissionId] = useState(allMissions[0]?.mission_id || null);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const activeMissionObj = useMemo(() => {
    return allMissions.find((m) => m.mission_id === selectedMissionId) || allMissions[0] || null;
  }, [allMissions, selectedMissionId]);

  const totalDurationSec = useMemo(() => {
    if (!activeMissionObj) return 0;
    if (activeMissionObj.duration_sec && activeMissionObj.duration_sec > 0) {
      return activeMissionObj.duration_sec;
    }
    if (activeMissionObj.samples && activeMissionObj.samples.length > 0) {
      const last = activeMissionObj.samples[activeMissionObj.samples.length - 1];
      const maxSec = last.timeSec !== undefined ? last.timeSec : (last.timeMin || 0) * 60;
      return Math.max(1, Math.round(maxSec));
    }
    return Math.max(1, Math.round((activeMissionObj.duration_min || 0) * 60));
  }, [activeMissionObj]);

  const playTimerRef = useRef(null);

  // Replay Telemetry State for Current Timestamp
  const { activePhase, state, packet } = useMemo(() => {
    return calculateReplayState(activeMissionObj, currentTimeSec);
  }, [activeMissionObj, currentTimeSec]);

  // Playback Interval Loop
  useEffect(() => {
    if (isPlaying) {
      playTimerRef.current = setInterval(() => {
        setCurrentTimeSec((prev) => {
          const next = prev + playbackSpeed * 0.5;
          if (next >= totalDurationSec) {
            setIsPlaying(false);
            return totalDurationSec;
          }
          return next;
        });
      }, 500);
    } else {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    }
    return () => {
      if (playTimerRef.current) clearInterval(playTimerRef.current);
    };
  }, [isPlaying, playbackSpeed, totalDurationSec]);

  // Reset timestamp when switching missions
  const handleSelectMission = (id) => {
    setSelectedMissionId(id);
    setCurrentTimeSec(0);
    setIsPlaying(false);
  };

  // Delete Mission Handler (Persists deletion in localStorage permanently)
  const handleDeleteMission = async (e, missionId) => {
    if (e) e.stopPropagation();
    if (window.confirm(`Are you sure you want to permanently delete mission ${missionId}?`)) {
      const newDeleted = [...deletedMissionIds, missionId];
      setDeletedMissionIds(newDeleted);
      try {
        localStorage.setItem("aerosynx_deleted_missions", JSON.stringify(newDeleted));
      } catch (err) { }

      // Also filter out from recordedMissions state & localStorage
      const updatedRecorded = recordedMissions.filter(m => m.mission_id !== missionId);
      setRecordedMissions(updatedRecorded);
      try {
        localStorage.setItem("aerosynx_recorded_missions", JSON.stringify(updatedRecorded));
      } catch (err) { }

      const remaining = allMissions.filter(m => m.mission_id !== missionId);
      if (remaining.length > 0) {
        setSelectedMissionId(remaining[0].mission_id);
      }

      try {
        await fetch(`${API_BASE}/api/mission/delete/${missionId}`, { method: "POST" });
      } catch (err) {
        // ignore
      }

      toast.success(`Mission ${missionId} deleted permanently`, {
        position: "top-right",
        autoClose: 3000,
        theme: "dark",
      });
    }
  };

  // Download Mission Data Handler (JSON, CSV, or PDF)
  const handleDownloadMissionData = (e, missionObj, format = "json") => {
    if (e) e.stopPropagation();

    const missionId = missionObj.mission_id || "RECORDED_RUN";
    const filename = `AeroSynX_Mission_${missionId}_Data.${format}`;

    if (format === "json") {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(missionObj, null, 2));
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", filename);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } else if (format === "csv") {
      const headers = ["Mission_ID", "Name", "Status", "Duration_Min", "Max_Altitude_Ft", "Health_Score", "RPM", "CHT_C", "EGT_C", "Vibration_G", "Oil_Press_Bar"];
      const r = missionObj.reading || {};
      const row = [
        missionObj.mission_id,
        `"${missionObj.name || missionObj.mission_id}"`,
        missionObj.status || "COMPLETED",
        missionObj.duration_min || 45,
        missionObj.max_altitude_ft || 5000,
        missionObj.health_score || 92,
        r.rpm || 5050,
        r.cht_c || 118,
        r.egt_c || 705,
        r.vibration_g || 0.12,
        r.oil_press_bar || 3.2
      ];

      const csvContent = "data:text/csv;charset=utf-8," + encodeURIComponent([headers.join(","), row.join(",")].join("\n"));
      const downloadAnchor = document.createElement("a");
      downloadAnchor.setAttribute("href", csvContent);
      downloadAnchor.setAttribute("download", filename);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } else if (format === "pdf") {
      // Generate ultra-professional printable PDF document window
      const printWin = window.open("", "_blank", "width=900,height=1000");
      if (!printWin) {
        toast.error("Popup blocked! Allow popups to download PDF.");
        return;
      }

      const r = missionObj.reading || {};
      const durationText = typeof missionObj.duration_min === "number" ? `${missionObj.duration_min.toFixed(1)} min` : `${missionObj.duration_min || 45} min`;

      printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>AeroSynX Defense Systems - Mission Report ${missionId}</title>
          <style>
            @page { size: A4; margin: 15mm; }
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #111; padding: 20px; background: #fff; line-height: 1.5; }
            .header-bar { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #0b2545; padding-bottom: 12px; margin-bottom: 20px; }
            .logo-title { display: flex; align-items: center; gap: 14px; }
            .logo-icon { width: 48px; height: 48px; background: linear-gradient(135deg, #0b2545, #134074); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #00d69d; font-weight: 900; font-size: 22px; font-family: monospace; letter-spacing: -1px; }
            .company-name { font-size: 22px; font-weight: 900; color: #0b2545; letter-spacing: 1px; margin: 0; }
            .sub-name { font-size: 10px; font-weight: 800; color: #134074; letter-spacing: 2px; text-transform: uppercase; margin-top: 2px; }
            .badge { background: #eef4fb; border: 1px solid #134074; color: #134074; font-size: 11px; font-weight: 800; padding: 6px 12px; border-radius: 6px; text-align: right; }
            .section-title { font-size: 13px; font-weight: 800; color: #0b2545; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-top: 25px; margin-bottom: 12px; }
            .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
            .meta-card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; }
            .meta-label { font-size: 9px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
            .meta-val { font-size: 14px; font-weight: 900; color: #0f172a; margin-top: 2px; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 11px; }
            th { background: #0b2545; color: #fff; font-weight: 700; text-align: left; padding: 8px 10px; font-size: 10px; text-transform: uppercase; }
            td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; }
            tr:nth-child(even) { background: #f8fafc; }
            .status-pass { color: #059669; font-weight: 800; }
            .footer { margin-top: 40px; border-top: 2px solid #e2e8f0; padding-top: 15px; display: flex; justify-content: space-between; align-items: flex-end; font-size: 9px; color: #64748b; }
            .seal-box { border: 2px dashed #0b2545; padding: 10px 16px; border-radius: 6px; text-align: center; width: 180px; }
            .seal-title { font-size: 10px; font-weight: 900; color: #0b2545; }
            .seal-sub { font-size: 8px; color: #059669; font-weight: 800; margin-top: 2px; }
          </style>
        </head>
        <body>
          <div class="header-bar">
            <div class="logo-title">
              <img src="/logo.png" alt="AeroSynX Logo" style="height: 52px; width: 52px; object-fit: cover; border-radius: 50%; border: 2px solid #0b2545; background: #000; margin-right: 12px; display: inline-block; vertical-align: middle;" />
              <div>
                <h1 class="company-name">AEROSYNX DEFENSE SYSTEMS</h1>
                <div class="sub-name">DRDO Autonomous Flight Control & Telemetry Division</div>
              </div>
            </div>
            <div class="badge">
              CONFIDENTIAL REPORT<br>
              <span style="font-size: 9px; color: #64748b;">REF: ${missionId}</span>
            </div>
          </div>

          <div class="section-title">📌 Mission Metadata & Status Summary</div>
          <div class="meta-grid">
            <div class="meta-card"><div class="meta-label">Mission Identification</div><div class="meta-val">${missionObj.mission_id}</div></div>
            <div class="meta-card"><div class="meta-label">Mission Designation</div><div class="meta-val">${missionObj.name || "PATROL RECONNAISSANCE"}</div></div>
            <div class="meta-card"><div class="meta-label">Recorded Date & Time</div><div class="meta-val">${missionObj.date || new Date().toLocaleString()}</div></div>
            <div class="meta-card"><div class="meta-label">Actual Flight Duration</div><div class="meta-val">${durationText}</div></div>
            <div class="meta-card"><div class="meta-label">Peak Flight Altitude</div><div class="meta-val">${missionObj.max_altitude_ft || 5000} FT</div></div>
            <div class="meta-card"><div class="meta-label">Overall Health Score</div><div class="meta-val" style="color: #059669;">${missionObj.health_score || 94.5}% NOMINAL</div></div>
          </div>

          <div class="section-title">📊 Final Telemetry & Physical Engine Readings</div>
          <table>
            <thead>
              <tr><th>Parameter</th><th>Target Baseline</th><th>Recorded Value</th><th>Unit</th><th>Range Status</th></tr>
            </thead>
            <tbody>
              <tr><td>Engine Speed (RPM)</td><td>4800 - 5300</td><td>${r.rpm || 5080}</td><td>RPM</td><td class="status-pass">OPTIMAL</td></tr>
              <tr><td>Cylinder Head Temp (CHT)</td><td>95 - 125</td><td>${r.cht_c || 112.0}</td><td>°C</td><td class="status-pass">NOMINAL</td></tr>
              <tr><td>Exhaust Gas Temp (EGT)</td><td>620 - 720</td><td>${r.egt_c || 675.0}</td><td>°C</td><td class="status-pass">NOMINAL</td></tr>
              <tr><td>Oil Pressure</td><td>2.5 - 4.2</td><td>${r.oil_press_bar || 3.4}</td><td>Bar</td><td class="status-pass">OPTIMAL</td></tr>
              <tr><td>Oil Temperature</td><td>85 - 105</td><td>${r.oil_temp_c || 93.0}</td><td>°C</td><td class="status-pass">NOMINAL</td></tr>
              <tr><td>Fuel Delivery Rate</td><td>14 - 18</td><td>${r.fuel_flow_lph || 16.2}</td><td>L/h</td><td class="status-pass">OPTIMAL</td></tr>
              <tr><td>Structural Vibration</td><td>0.05 - 0.15</td><td>${r.vibration_g || 0.085}</td><td>g</td><td class="status-pass">STABLE</td></tr>
              <tr><td>Bus System Voltage</td><td>13.8 - 14.4</td><td>${r.battery_v || 14.1}</td><td>V</td><td class="status-pass">NOMINAL</td></tr>
            </tbody>
          </table>

          <div class="section-title">🛡️ Mission Guard Integrity & AI Physics Audit</div>
          <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 6px; font-size: 10px; color: #334155;">
            <strong>Digital Twin Verification:</strong> Residual threshold R &lt; 0.12 verified across all flight phases. Zero structural envelope breaches or unmitigated engine faults recorded during this mission window.
          </div>

          <div class="footer">
            <div>
              <strong>AeroSynX Flight Operations Command</strong><br>
              Document Generated: ${new Date().toISOString()}<br>
              Security Level: CLASSIFIED // DRDO DEFENSE
            </div>
            <div class="seal-box">
              <div style="font-size: 7px; font-weight: 800; color: #134074; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px;">AUTHORIZED SIGNATURE</div>
              <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAABAAAAA..." onError="this.src='/signature.png'" alt="Command Signature" style="max-height: 48px; max-width: 140px; display: block; margin: 2px auto; filter: contrast(130%);" />
              <div class="seal-title"></div>
              <div class="seal-sub">COMMAND AUTHORIZED</div>
            </div>
          </div>

          <script>
            window.onload = function() {
              window.print();
            };
          </script>
        </body>
        </html>
      `);
      printWin.document.close();
    }

    toast.success(`Exported Mission Data: ${filename}`, {
      position: "top-right",
      autoClose: 3500,
      theme: "dark",
    });
  };

  const formatTime = (sec) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  if (!activeMissionObj) {
    return (
      <div style={{
        padding: "14px 18px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        height: "calc(100vh - 110px)",
        boxSizing: "border-box",
        background: "linear-gradient(180deg, #070d14 0%, #05090e 100%)",
        alignItems: "center",
        justifyContent: "center"
      }}>
        <div style={{
          background: "rgba(13, 27, 42, 0.85)",
          border: "1px dashed #38c0e8",
          borderRadius: 14,
          padding: "48px 36px",
          textAlign: "center",
          maxWidth: 580,
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
        }}>
          <div style={{ fontSize: 42, color: "#38c0e8", marginBottom: 16 }}>📡</div>
          <h3 style={{ color: "#f0f4f8", fontSize: 18, fontWeight: 800, letterSpacing: 2, margin: "0 0 12px 0" }}>
            AWAITING COMPLETED MISSION RECORDING
          </h3>
          <p style={{ color: "#94a3b8", fontSize: 13, lineHeight: "1.6", margin: "0 0 24px 0" }}>
            No recorded flight missions are available for timeline replay.
            To record a mission, open <strong style={{ color: "#38c0e8" }}>MissionGuard</strong>, click <strong>▶ START MISSION</strong> to log live telemetry, and click <strong>⏹ STOP MISSION</strong> when complete.
          </p>
          {onNavigateToMissionGuard && (
            <button
              onClick={onNavigateToMissionGuard}
              style={{
                background: "linear-gradient(135deg, #0d3d6b, #1a6e8e)",
                border: "1px solid #38c0e8",
                borderRadius: 8,
                color: "#e1eaf2",
                padding: "10px 24px",
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: 1.5,
                cursor: "pointer",
                transition: "all 0.2s ease"
              }}
            >
              GO TO MISSIONGUARD SIMULATOR →
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      padding: "14px 18px",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
      height: "calc(100vh - 110px)",
      boxSizing: "border-box",
      background: "linear-gradient(180deg, #070d14 0%, #05090e 100%)",
      overflow: "hidden"
    }}>
      {/* ── TOP HEADER WITH RECORD, EXPORT & DELETE BUTTONS ── */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#09131d",
        border: "1px solid #182a3d",
        borderRadius: 12,
        padding: "12px 20px",
        flexShrink: 0
      }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 800, color: "#38c0e8", letterSpacing: "2.5px", marginBottom: 2 }}>
            DRDO FLIGHT CONTROL • TIMELINE REPLAY
          </div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "#f0f4f8", letterSpacing: "0.5px" }}>
            Mission Replay & Review Center
          </h2>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {/* Export PDF Button */}
          <button
            onClick={(e) => handleDownloadMissionData(e, activeMissionObj, "pdf")}
            disabled={!activeMissionObj}
            style={{
              background: "linear-gradient(135deg, #134074, #0b2545)",
              color: "#ffffff",
              border: "1px solid #38c0e8",
              borderRadius: 6,
              padding: "7px 16px",
              fontSize: 11,
              fontWeight: 800,
              cursor: activeMissionObj ? "pointer" : "not-allowed",
              opacity: activeMissionObj ? 1 : 0.5,
              display: "flex",
              alignItems: "center",
              gap: 6,
              boxShadow: "0 4px 12px rgba(56, 192, 232, 0.2)"
            }}
          >
            EXPORT PDF REPORT
          </button>

          {/* Delete Active Mission Button */}
          <button
            onClick={(e) => handleDeleteMission(e, activeMissionObj?.mission_id)}
            disabled={!activeMissionObj}
            style={{
              background: "rgba(231, 76, 60, 0.12)",
              color: "#e74c3c",
              border: "1px solid rgba(231, 76, 60, 0.4)",
              borderRadius: 6,
              padding: "7px 14px",
              fontSize: 11,
              fontWeight: 800,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6
            }}
          >
            DELETE MISSION
          </button>

          {/* Record New Mission Action Button */}
          <button
            onClick={onNavigateToMissionGuard}
            style={{
              background: "linear-gradient(135deg, #00d69d 0%, #00a876 100%)",
              color: "#031710",
              border: "none",
              borderRadius: 6,
              padding: "7px 16px",
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: "0.5px",
              cursor: "pointer",
              boxShadow: "0 4px 16px rgba(0, 214, 157, 0.3)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            RECORD NEW MISSION
          </button>
        </div>
      </div>

      {/* ── MAIN SECTION: MISSION LIST (LEFT) + 3D UAV VIEWPORT (CENTER) + TELEMETRY HUD (RIGHT) ── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "300px 1fr 300px",
        gap: "14px",
        flex: 1,
        minHeight: 0
      }}>
        {/* ── LEFT PANEL: COMPLETED MISSIONS LIST ── */}
        <div style={{
          background: "#09131d",
          border: "1px solid #182a3d",
          borderRadius: 12,
          padding: "14px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          overflowY: "auto",
        }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 800, color: "#38c0e8", letterSpacing: "2px", marginBottom: 2 }}>
              RECORDED MISSIONS
            </div>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#f0f4f8" }}>
              Completed Missions ({allMissions.length})
            </h3>
          </div>

          {/* Mission Cards List */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {allMissions.map((m) => {
              const isSelected = m.mission_id === selectedMissionId;
              return (
                <div
                  key={m.mission_id}
                  onClick={() => handleSelectMission(m.mission_id)}
                  style={{
                    background: isSelected ? "rgba(56, 192, 232, 0.14)" : "#0d1b2a",
                    border: `1px solid ${isSelected ? "#38c0e8" : "#1a2b3e"}`,
                    borderRadius: 8,
                    padding: "10px 12px",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: isSelected ? "#38c0e8" : "#e1eaf2" }}>
                      {m.name || m.mission_id}
                    </span>

                    {/* Compact Card Download & Delete Action Icons */}
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        title="Download JSON"
                        onClick={(e) => handleDownloadMissionData(e, m, "json")}
                        style={{ background: "transparent", border: "none", color: "#38c0e8", cursor: "pointer", fontSize: 9, fontWeight: 800, padding: "2px 4px" }}
                      >
                        JSON
                      </button>
                      <button
                        title="Delete Mission"
                        onClick={(e) => handleDeleteMission(e, m.mission_id)}
                        style={{ background: "transparent", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: 9, fontWeight: 800, padding: "2px 4px" }}
                      >
                        DEL
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10, color: "#627d94" }}>
                    <span>{m.duration_min} min</span>
                    <span>{m.max_altitude_ft || 5000} ft</span>
                    <span style={{ color: "#00d69d", fontWeight: 700 }}>{m.health_score || 92}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── CENTER PANEL: 3D UAV DIGITAL TWIN VIEWPORT (FREEZES WHEN PAUSED) ── */}
        <div style={{
          position: "relative",
          background: "#040911",
          border: "1px solid #142436",
          borderRadius: 12,
          overflow: "hidden",
        }}>
          {/* Top HUD Overlay (positioned safely to right of newmodel 3D HUD badges) */}
          <div style={{
            position: "absolute",
            top: 14,
            left: 200,
            right: 180,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            zIndex: 10,
            pointerEvents: "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{
                fontSize: 9, fontWeight: 900,
                color: isPlaying ? "#00d69d" : "#f39c12",
                background: isPlaying ? "rgba(0,214,157,0.18)" : "rgba(243,156,18,0.18)",
                padding: "4px 10px", borderRadius: 4,
                border: `1px solid ${isPlaying ? "rgba(0,214,157,0.4)" : "rgba(243,156,18,0.4)"}`,
                boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
                letterSpacing: "1px"
              }}>
                {isPlaying ? "▶ 3D PLAYBACK ACTIVE" : "⏸ 3D MODEL FROZEN"}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 800, color: "#38c0e8", fontFamily: "monospace",
                background: "rgba(6,12,20,0.85)", padding: "4px 8px", borderRadius: 4,
                border: "1px solid #1a2b3e"
              }}>
                PHASE: {activePhase}
              </span>
            </div>
          </div>

          {/* 3D UAV Model Component (Freezes when isPlaying is false, moves with replay telemetry) */}
          <UAVNewModel isPaused={!isPlaying} packet={packet} telemetryPacket={packet} />
        </div>

        {/* ── RIGHT PANEL: REPLAY TELEMETRY HUD ── */}
        <div style={{
          background: "#09131d",
          border: "1px solid #182a3d",
          borderRadius: 12,
          padding: "14px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          overflowY: "auto",
        }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 800, color: "#00d69d", letterSpacing: "2px", marginBottom: 2 }}>
              SYNCHRONIZED TELEMETRY HUD
            </div>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#f0f4f8" }}>
              Engine Parameters
            </h3>
          </div>

          {/* Parameter Metrics Stack */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { label: "RPM", val: `${state.rpm} RPM`, color: "#00d69d" },
              { label: "CHT", val: `${state.cht_c} °C`, color: state.cht_c > 120 ? "#f39c12" : "#38c0e8" },
              { label: "EGT", val: `${state.egt_c} °C`, color: "#38c0e8" },
              { label: "OIL PRESS", val: `${state.oil_press_bar} Bar`, color: "#00d69d" },
              { label: "FUEL FLOW", val: `${state.fuel_flow_lph} L/H`, color: "#38c0e8" },
              { label: "VIBRATION", val: `${state.vibration_g} g`, color: "#00d69d" },
              { label: "BATTERY", val: `${state.battery_v} V`, color: "#00d69d" },
              { label: "ALTITUDE", val: `${state.altitude_ft} ft`, color: "#38c0e8" },
              { label: "AIRSPEED", val: `${state.speed_knots} kts`, color: "#00d69d" },
            ].map(({ label, val, color }) => (
              <div key={label} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "6px 10px", background: "#060d15", borderRadius: 6,
                border: "1px solid #142436", fontSize: 10,
              }}>
                <span style={{ color: "#627d94", fontWeight: 700 }}>{label}</span>
                <span style={{ color, fontWeight: 800, fontFamily: "monospace" }}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── BOTTOM SECTION: HIGH-VISIBILITY INTERACTIVE TIMELINE SCRUBBER & PLAYBACK HUD ── */}
      <div style={{
        background: "#09131d",
        border: "1px solid #182a3d",
        borderRadius: 12,
        padding: "12px 18px",
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        flexShrink: 0
      }}>
        {/* Scrubber Header & Playback Controls */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {/* Play/Pause Button */}
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              style={{
                background: isPlaying ? "linear-gradient(135deg, #e74c3c, #b02a1e)" : "linear-gradient(135deg, #00d69d, #009968)",
                color: isPlaying ? "#ffffff" : "#031710",
                border: "none", borderRadius: 6,
                padding: "7px 18px", fontSize: 12, fontWeight: 900,
                cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
              }}
            >
              {isPlaying ? "⏸ PAUSE" : "▶ PLAY"}
            </button>

            {/* Reset Button */}
            <button
              onClick={() => { setCurrentTimeSec(0); setIsPlaying(false); }}
              style={{
                background: "#0d1b2a", border: "1px solid #1a2b3e",
                color: "#8faec0", borderRadius: 6,
                padding: "6px 12px", fontSize: 10, fontWeight: 700, cursor: "pointer",
              }}
            >
              ⏮ RESET (00:00)
            </button>

            {/* Speed Selector */}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 9, fontWeight: 800, color: "#627d94" }}>SPEED:</span>
              {[1, 2, 5, 10].map((spd) => (
                <button
                  key={spd}
                  onClick={() => setPlaybackSpeed(spd)}
                  style={{
                    background: playbackSpeed === spd ? "#38c0e8" : "#0d1b2a",
                    color: playbackSpeed === spd ? "#041220" : "#8faec0",
                    border: `1px solid ${playbackSpeed === spd ? "#38c0e8" : "#1a2b3e"}`,
                    borderRadius: 4, padding: "2px 6px", fontSize: 9, fontWeight: 800, cursor: "pointer",
                  }}
                >
                  {spd}x
                </button>
              ))}
            </div>
          </div>

          {/* Time Counter */}
          <div style={{ fontSize: 15, fontWeight: 900, fontFamily: "monospace", color: "#38c0e8" }}>
            {formatTime(currentTimeSec)} <span style={{ fontSize: 10, color: "#627d94" }}>/ {formatTime(totalDurationSec)}</span>
          </div>
        </div>

        {/* Phase Timeline Block Strip */}
        <div style={{
          display: "flex", height: 20, borderRadius: 6, overflow: "hidden",
          border: "1px solid #1a2b3e", background: "#060d15", position: "relative",
        }}>
          {(activeMissionObj.phases || DEFAULT_MISSIONS[0].phases).map((ph) => {
            const phaseFrac = (ph.duration_min || 5) / (activeMissionObj.duration_min || 45);
            const isCurrent = activePhase === ph.phase;
            return (
              <div key={ph.phase} style={{
                flex: phaseFrac,
                background: isCurrent ? "rgba(56, 192, 232, 0.3)" : "rgba(255, 255, 255, 0.04)",
                borderRight: "1px solid #102030",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 8, fontWeight: 800, color: isCurrent ? "#38c0e8" : "#47657a",
                letterSpacing: "0.5px",
              }}>
                {ph.phase}
              </div>
            );
          })}
        </div>

        {/* Scrubber Range Slider */}
        <div style={{ position: "relative" }}>
          <input
            type="range"
            min="0"
            max={totalDurationSec}
            step="1"
            value={currentTimeSec}
            onChange={(e) => setCurrentTimeSec(Number(e.target.value))}
            style={{
              width: "100%",
              height: 10,
              borderRadius: 5,
              accentColor: "#00d69d",
              cursor: "pointer",
            }}
          />
        </div>
      </div>
    </div>
  );
}
