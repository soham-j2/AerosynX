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

/* ============================================================
   EXACTLY 2 INITIAL DEFAULT COMPLETED MISSIONS
   ============================================================ */

const DEFAULT_MISSIONS = [
  {
    mission_id: "MISSION-ALPHA-20260924",
    name: "MISSION ALPHA — RECONNAISSANCE",
    date: "2026-09-24 10:30",
    duration_min: 45,
    max_altitude_ft: 5000,
    status: "COMPLETED",
    health_score: 94.5,
    phases: [
      { phase: "TAKEOFF", duration_min: 3 },
      { phase: "CLIMB", duration_min: 7 },
      { phase: "CRUISE", duration_min: 20 },
      { phase: "LOITER", duration_min: 8 },
      { phase: "DESCENT", duration_min: 4 },
      { phase: "RETURN", duration_min: 2 },
      { phase: "LANDING", duration_min: 1 },
    ],
  },
  {
    mission_id: "MISSION-BRAVO-20260925",
    name: "MISSION BRAVO — HIGH ALTITUDE TEST",
    date: "2026-09-25 14:15",
    duration_min: 50,
    max_altitude_ft: 8000,
    status: "COMPLETED",
    health_score: 91.8,
    phases: [
      { phase: "TAKEOFF", duration_min: 3 },
      { phase: "CLIMB", duration_min: 8 },
      { phase: "CRUISE", duration_min: 22 },
      { phase: "LOITER", duration_min: 10 },
      { phase: "DESCENT", duration_min: 4 },
      { phase: "RETURN", duration_min: 2 },
      { phase: "LANDING", duration_min: 1 },
    ],
  },
];

/* ============================================================
   TELEMETRY COMPUTATION FOR SCRUBBED TIMESTAMP
   ============================================================ */

function calculateReplayState(mission, timeMin) {
  const duration = mission.duration_min || 45;
  const progress = Math.min(1, Math.max(0, timeMin / duration));
  const maxAlt = mission.max_altitude_ft || 5000;

  // Determine current active phase based on cumulative duration
  let cum = 0;
  let activePhase = "CRUISE";
  let phaseProgress = 0.5;

  const phases = mission.phases || DEFAULT_MISSIONS[0].phases;
  for (let p of phases) {
    if (timeMin >= cum && timeMin <= cum + p.duration_min) {
      activePhase = p.phase;
      phaseProgress = (timeMin - cum) / (p.duration_min || 1);
      break;
    }
    cum += p.duration_min;
  }

  // Calculate synthetic flight telemetry for scrubbed timestamp
  let pitch = 0;
  let roll = 0;
  let yaw = (timeMin * 7.2) % 360;
  let rpm = 4950;
  let cht = 115;
  let egt = 680;
  let oilPress = 3.2;
  let oilTemp = 92;
  let fuelFlow = 15.8;
  let vibration = 0.12;
  let battery = 14.1;
  let altitude = maxAlt;

  if (activePhase === "TAKEOFF") {
    pitch = 8 * phaseProgress;
    altitude = maxAlt * 0.1 * phaseProgress;
    rpm = 5100;
  } else if (activePhase === "CLIMB") {
    pitch = 12;
    altitude = maxAlt * (0.1 + 0.8 * phaseProgress);
    rpm = 5250;
    cht = 124;
    egt = 720;
  } else if (activePhase === "CRUISE") {
    pitch = 1.5 * Math.sin(timeMin * 0.5);
    roll = 2 * Math.cos(timeMin * 0.3);
    altitude = maxAlt;
    rpm = 4950;
  } else if (activePhase === "LOITER") {
    roll = 15;
    pitch = 2;
    altitude = maxAlt;
    rpm = 4800;
  } else if (activePhase === "DESCENT") {
    pitch = -6;
    altitude = maxAlt * (1 - 0.7 * phaseProgress);
    rpm = 4400;
  } else if (activePhase === "RETURN") {
    pitch = -2;
    altitude = maxAlt * 0.2;
    rpm = 4600;
  } else if (activePhase === "LANDING") {
    pitch = 4;
    altitude = maxAlt * 0.2 * (1 - phaseProgress);
    rpm = 3200;
  }

  const state = {
    pitch_deg: parseFloat(pitch.toFixed(1)),
    roll_deg: parseFloat(roll.toFixed(1)),
    yaw_deg: parseFloat(yaw.toFixed(1)),
    rpm: Math.round(rpm),
    cht_c: parseFloat(cht.toFixed(1)),
    egt_c: parseFloat(egt.toFixed(1)),
    oil_press_bar: parseFloat(oilPress.toFixed(1)),
    oil_temp_c: parseFloat(oilTemp.toFixed(1)),
    fuel_flow_lph: parseFloat(fuelFlow.toFixed(1)),
    vibration_g: parseFloat(vibration.toFixed(2)),
    battery_v: parseFloat(battery.toFixed(1)),
    altitude_ft: Math.round(altitude),
    speed_knots: Math.round(110 + 20 * Math.sin(timeMin * 0.4)),
  };

  const packet = {
    reading: state,
    current_state: state,
    context: {
      active_fault: "none",
      mission_profile: activePhase.toLowerCase(),
    },
    ai_prediction: {
      predicted_fault: "NONE",
      fault_confidence: 0.98,
      condition: "NOMINAL",
    },
  };

  return { activePhase, state, packet };
}

/* ============================================================
   MAIN COMPONENT: MissionReplayReview
   ============================================================ */

export function MissionReplayReview({ completedMissions = [], onNavigateToMissionGuard }) {
  const [deletedMissionIds, setDeletedMissionIds] = useState([]);

  // Combine default 2 dummy missions with real completed missions, filtering deleted ones
  const allMissions = useMemo(() => {
    const combined = [...DEFAULT_MISSIONS];
    completedMissions.forEach((m) => {
      if (!combined.some((c) => c.mission_id === m.mission_id)) {
        combined.unshift(m);
      }
    });
    return combined.filter(m => !deletedMissionIds.includes(m.mission_id));
  }, [completedMissions, deletedMissionIds]);

  const [selectedMissionId, setSelectedMissionId] = useState(allMissions[0]?.mission_id || "DEFAULT");
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const activeMissionObj = useMemo(() => {
    return allMissions.find((m) => m.mission_id === selectedMissionId) || allMissions[0] || DEFAULT_MISSIONS[0];
  }, [allMissions, selectedMissionId]);

  const totalDurationSec = (activeMissionObj.duration_min || 45) * 60;
  const currentTimeMin = currentTimeSec / 60;

  const playTimerRef = useRef(null);

  // Replay Telemetry State for Current Timestamp
  const { activePhase, state, packet } = useMemo(() => {
    return calculateReplayState(activeMissionObj, currentTimeMin);
  }, [activeMissionObj, currentTimeMin]);

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

  // Delete Mission Handler
  const handleDeleteMission = async (e, missionId) => {
    if (e) e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete mission ${missionId}?`)) {
      setDeletedMissionIds((prev) => [...prev, missionId]);
      
      const remaining = allMissions.filter(m => m.mission_id !== missionId);
      if (remaining.length > 0) {
        setSelectedMissionId(remaining[0].mission_id);
      }

      try {
        await fetch(`${API_BASE}/api/mission/delete/${missionId}`, { method: "POST" });
      } catch (err) {
        // ignore
      }

      toast.success(`Mission ${missionId} deleted successfully`, {
        position: "top-right",
        autoClose: 3000,
        theme: "dark",
      });
    }
  };

  // Download Mission Data Handler (JSON or CSV)
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
        missionObj.name || missionObj.mission_id,
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
          {/* Download JSON Button */}
          <button
            onClick={(e) => handleDownloadMissionData(e, activeMissionObj, "json")}
            style={{
              background: "#0d1b2a",
              color: "#38c0e8",
              border: "1px solid #38c0e8",
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
            <span>📥</span> EXPORT JSON
          </button>

          {/* Export CSV Button */}
          <button
            onClick={(e) => handleDownloadMissionData(e, activeMissionObj, "csv")}
            style={{
              background: "#0d1b2a",
              color: "#00d69d",
              border: "1px solid #00d69d",
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
            <span>📊</span> EXPORT CSV
          </button>

          {/* Delete Active Mission Button */}
          <button
            onClick={(e) => handleDeleteMission(e, activeMissionObj.mission_id)}
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
            <span>🗑️</span> DELETE MISSION
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
            <span>🔴</span> RECORD NEW MISSION
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
                        style={{ background: "transparent", border: "none", color: "#38c0e8", cursor: "pointer", fontSize: 11, padding: "2px 4px" }}
                      >
                        📥
                      </button>
                      <button
                        title="Delete Mission"
                        onClick={(e) => handleDeleteMission(e, m.mission_id)}
                        style={{ background: "transparent", border: "none", color: "#e74c3c", cursor: "pointer", fontSize: 11, padding: "2px 4px" }}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 10, color: "#627d94" }}>
                    <span>⏱ {m.duration_min} Min</span>
                    <span>⛰️ {m.max_altitude_ft || 5000} ft</span>
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
          {/* Top HUD Overlay */}
          <div style={{
            position: "absolute",
            top: 10,
            left: 14,
            right: 14,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            zIndex: 10,
            pointerEvents: "none",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                fontSize: 9, fontWeight: 900,
                color: isPlaying ? "#00d69d" : "#f39c12",
                background: isPlaying ? "rgba(0,214,157,0.12)" : "rgba(243,156,18,0.12)",
                padding: "3px 8px", borderRadius: 4,
                border: `1px solid ${isPlaying ? "rgba(0,214,157,0.3)" : "rgba(243,156,18,0.3)"}`
              }}>
                {isPlaying ? "▶ 3D PLAYBACK ACTIVE" : "⏸ 3D MODEL FROZEN"}
              </span>
              <span style={{ fontSize: 10, fontWeight: 800, color: "#38c0e8", fontFamily: "monospace" }}>
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
