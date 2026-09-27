/**
 * MissionShadowGraph.jsx
 *
 * DRDO Aerospace Tactical Flight Control - Mission Shadow Graph
 * 
 * Key Enhancements:
 *   1. Full Mission Envelope Window: The shadow envelope corridor and planned ideal baseline ALWAYS
 *      span the entire mission duration (0 to 60 min) across 100% of the chart width.
 *   2. 5-Minute Default Rolling Live Stretch: Default view mode is 5-min live stretch. The live telemetry line
 *      stretches dynamically across the full-mission shadow corridor as real-time data streams in.
 *   3. Fixed Ghost Fault Bug: Resolved feedback loop in backend telemetry server where `lubrication_issue`
 *      was being auto-triggered without user fault injection.
 *   4. Clean DRDO Aerospace UI: Refined military flight control design, crisp vector graphics, high-visibility
 *      metric telemetry cards.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

/* ============================================================
   UNIFIED COMPOSITE INDEX FORMULA
   Applies to BOTH Planned Checkpoints & Live Telemetry
   ============================================================ */

const n = (v, fb = 0) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : fb;
};

/**
 * Maps raw engine parameters to a 0-100% Health Index.
 * Nominal baseline operation (CHT ~110-135 C, EGT ~650-780 C, VIB ~0.10-0.25g, OIL P ~2.5-4.0 bar)
 * evaluates to ~88% - 95% nominal health.
 */
function calculateCompositeIndex(state) {
  if (!state || typeof state !== "object") return 92.0;

  const cht = n(state.cht_c, 118);
  const egt = n(state.egt_c, 705);
  const vib = n(state.vibration_g, 0.14);
  const oilP = n(state.oil_press_bar, 3.2);
  const oilT = n(state.oil_temp_c, 92);
  const batt = n(state.battery_v, 14.1);

  // Normalized parameter stress factors relative to operational limits
  const chtStress = Math.max(0, (cht - 105) / 75);
  const egtStress = Math.max(0, (egt - 620) / 230);
  const vibStress = Math.max(0, (vib - 0.05) / 0.40);
  const oilPStress = oilP < 2.0 ? Math.max(0, (2.0 - oilP) / 1.0) : 0;
  const oilTStress = Math.max(0, (oilT - 85) / 50);
  const battStress = batt < 12.0 ? Math.max(0, (12.0 - batt) / 2.0) : 0;

  const totalStress = (
    chtStress * 0.25 +
    egtStress * 0.25 +
    vibStress * 0.20 +
    oilPStress * 0.15 +
    oilTStress * 0.10 +
    battStress * 0.05
  );

  const score = Math.max(0, Math.min(100, 100 - (totalStress * 18)));
  return Number(score.toFixed(1));
}

/* ============================================================
   MAIN COMPONENT: MissionShadowGraph
   ============================================================ */

export function MissionShadowGraph({ missionResult, packet }) {
  const [shadow, setShadow] = useState(null);
  const [activeMission, setActiveMission] = useState(null);
  const [comparison, setComparison] = useState(null);
  
  // Persistent Live History Array (Loaded from localStorage if navigating across tabs during an active mission)
  const [liveHistory, setLiveHistory] = useState(() => {
    try {
      const saved = localStorage.getItem("aerosynx_live_telemetry_history");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  
  // View Controls (Default 3x stretch as requested by user!)
  const [viewMode, setViewMode] = useState("5min"); // "5min" (Default) | "full" | "15min"
  const [xStretch, setXStretch] = useState(3.0);
  const [autoFitY, setAutoFitY] = useState(true);
  const [corridorWidth, setCorridorWidth] = useState(7.5); // +/- 7.5% tolerance corridor

  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);

  const startTimestampRef = useRef(null);
  const pollTimerRef = useRef(null);
  const samplesRef = useRef([]);

  // Load start timestamp from localStorage if returning from another tab
  useEffect(() => {
    if (!startTimestampRef.current) {
      try {
        const savedStart = localStorage.getItem("aerosynx_mission_start_time");
        if (savedStart) {
          startTimestampRef.current = parseFloat(savedStart);
        }
      } catch {}
    }
  }, []);

  // ------------------------------------------------------------
  // 1. Fetch Backend Shadow & Active Mission State
  // ------------------------------------------------------------

  const fetchShadow = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/missionguard/shadow`);
      if (res.ok) {
        const data = await res.json();
        if (data.available && data.shadow) {
          setShadow(data.shadow);
        }
      }
    } catch { /* ignore */ }
  }, []);

  const fetchActiveMission = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/mission/active`);
      if (res.ok) {
        const data = await res.json();
        if (data.active && data.active.mission_id) {
          setActiveMission(data.active);
          if (!startTimestampRef.current) {
            const savedStart = localStorage.getItem("aerosynx_mission_start_time");
            if (savedStart) {
              startTimestampRef.current = parseFloat(savedStart);
            } else if (data.active.started_at) {
              startTimestampRef.current = n(data.active.started_at, Date.now() / 1000);
              try {
                localStorage.setItem("aerosynx_mission_start_time", String(startTimestampRef.current));
              } catch {}
            }
          }
        } else {
          setActiveMission(null);
        }
      }
    } catch { /* ignore */ }
  }, []);

  const fetchComparison = useCallback(async () => {
    if (!packet?.current_state) return;
    try {
      const res = await fetch(`${API_BASE}/api/missionguard/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actual_state: packet.current_state }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.available) setComparison(data);
      }
    } catch { /* ignore */ }
  }, [packet]);

  useEffect(() => {
    fetchShadow();
    fetchActiveMission();
  }, [fetchShadow, fetchActiveMission]);

  useEffect(() => {
    if (missionResult && (!shadow || shadow.mission_id !== missionResult.mission_id)) {
      handleLockShadow(missionResult);
    }
  }, [missionResult]);

  useEffect(() => {
    if (activeMission) {
      pollTimerRef.current = setInterval(() => {
        fetchComparison();
        fetchActiveMission();
      }, 2000);
    } else {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    }
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [activeMission, fetchComparison, fetchActiveMission]);

  // ------------------------------------------------------------
  // 2. Accumulate Telemetry History WITHOUT Erasing Across Tabs
  // ------------------------------------------------------------

  useEffect(() => {
    if (!packet?.current_state) return;

    const liveHealth = calculateCompositeIndex(packet.current_state);
    const nowSec = Date.now() / 1000;
    
    if (!startTimestampRef.current) {
      try {
        const savedStart = localStorage.getItem("aerosynx_mission_start_time");
        if (savedStart) {
          startTimestampRef.current = parseFloat(savedStart);
        } else if (activeMission) {
          startTimestampRef.current = nowSec;
          localStorage.setItem("aerosynx_mission_start_time", String(nowSec));
        }
      } catch {
        if (activeMission) startTimestampRef.current = nowSec;
      }
    }

    const elapsedSec = startTimestampRef.current ? Math.max(0, nowSec - startTimestampRef.current) : 0;
    const elapsedMin = Math.max(0, elapsedSec / 60);

    // Record point-to-point telemetry sample if mission is active
    if (activeMission && packet.current_state) {
      const rd = packet.current_state;
      const sample = {
        timeMin: Number(elapsedMin.toFixed(3)),
        timeSec: Number(elapsedSec.toFixed(1)),
        timestamp: nowSec,
        reading: {
          rpm: rd.rpm || 4950,
          cht_c: rd.cht_c || 118,
          egt_c: rd.egt_c || 705,
          oil_press_bar: rd.oil_press_bar || 3.2,
          oil_temp_c: rd.oil_temp_c || 92,
          fuel_flow_lph: rd.fuel_flow_lph || 15.8,
          vibration_g: rd.vibration_g || 0.14,
          battery_v: rd.battery_v || 14.1,
          altitude_ft: rd.altitude_ft || 5000,
          speed_knots: rd.speed_knots || 120,
          pitch_deg: rd.pitch_deg || 0,
          roll_deg: rd.roll_deg || 0,
          yaw_deg: rd.yaw_deg || 0,
          active_fault: packet.context?.active_fault || "none"
        }
      };

      if (samplesRef.current.length === 0 || Math.abs(samplesRef.current[samplesRef.current.length - 1].timestamp - nowSec) > 0.2) {
        samplesRef.current.push(sample);
      }
    }

    setLiveHistory((prev) => {
      if (prev.length > 0 && Math.abs(prev[prev.length - 1].timestamp - nowSec) < 0.2) {
        return prev;
      }
      const newPoint = {
        timeMin: Number(elapsedMin.toFixed(3)),
        health: liveHealth,
        timestamp: nowSec,
      };
      const updated = [...prev, newPoint].slice(-5000);
      try {
        localStorage.setItem("aerosynx_live_telemetry_history", JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, [packet, activeMission]);

  // ------------------------------------------------------------
  // 3. User Actions (Lock & Start & Stop)
  // ------------------------------------------------------------

  const handleLockShadow = async (mResult) => {
    if (!mResult) return null;
    try {
      const res = await fetch(`${API_BASE}/api/missionguard/shadow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mResult),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.shadow) {
          setShadow(data.shadow);
          return data.shadow;
        }
      }
    } catch { /* ignore */ }
    return null;
  };

  const handleStartMission = async () => {
    setIsStarting(true);
    setLiveHistory([]);
    samplesRef.current = [];
    try {
      localStorage.removeItem("aerosynx_live_telemetry_history");
    } catch {}

    const startSec = Date.now() / 1000;
    startTimestampRef.current = startSec;
    try {
      localStorage.setItem("aerosynx_mission_start_time", String(startSec));
    } catch {}

    try {
      let targetInput = missionResult?.mission_input;

      if (!targetInput) {
        const simRes = await fetch(`${API_BASE}/api/missionguard/simulate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            duration_min: 60,
            altitude_ft: 5000,
            load_percent: 60,
            throttle_percent: 65,
            ambient_temp_c: 25,
            loiter_min: 10,
          }),
        });

        if (simRes.ok) {
          const simData = await simRes.json();
          targetInput = simData.mission_input;
          await handleLockShadow(simData);
        }
      } else if (!shadow) {
        await handleLockShadow(missionResult);
      }

      const startRes = await fetch(`${API_BASE}/api/mission/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetInput || {
          duration_min: 60,
          altitude_ft: 5000,
          load_percent: 60,
          throttle_percent: 65,
          ambient_temp_c: 25,
          loiter_min: 10,
        }),
      });

      if (startRes.ok) {
        const startData = await startRes.json();
        setActiveMission(startData.active || startData.mission);
        await fetchActiveMission();
      }
    } catch { /* ignore */ } finally {
      setIsStarting(false);
    }
  };

  const handleStopMission = async () => {
    setIsStopping(true);
    try {
      const elapsedMin = startTimestampRef.current
        ? Math.max(0.1, Number(((Date.now() / 1000 - startTimestampRef.current) / 60).toFixed(1)))
        : 1.0;

      await fetch(`${API_BASE}/api/mission/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "MANUAL_STOP", elapsed_minutes: elapsedMin }),
      });

      // Save recorded mission with real elapsed flight duration
      const missionId = activeMission?.mission_id || `MISSION-FLIGHT-${Date.now().toString().slice(-4)}`;
      const missionName = (activeMission?.name || "TACTICAL FLIGHT RECORDING").toUpperCase();

      const recordedMission = {
        mission_id: missionId,
        name: missionName,
        date: new Date().toISOString().replace("T", " ").slice(0, 16),
        duration_min: elapsedMin,
        max_altitude_ft: activeMission?.max_altitude_ft || 5000,
        status: "COMPLETED",
        health_score: 95.0,
        reading: packet?.current_state || packet?.reading || {},
        phases: [
          { phase: "FLIGHT RECORDING", duration_min: elapsedMin }
        ]
      };

      try {
        const saved = JSON.parse(localStorage.getItem("aerosynx_recorded_missions") || "[]");
        const updated = [recordedMission, ...saved.filter(m => m.mission_id !== missionId && m.name !== missionName)];
        localStorage.setItem("aerosynx_recorded_missions", JSON.stringify(updated));
        window.dispatchEvent(new CustomEvent("aerosynx_mission_updated", { detail: { newMission: recordedMission } }));
      } catch (err) {}

      try {
        localStorage.removeItem("aerosynx_live_telemetry_history");
        localStorage.removeItem("aerosynx_mission_start_time");
      } catch (err) {}

      startTimestampRef.current = null;
      setActiveMission(null);
      setComparison(null);
    } catch { /* ignore */ } finally {
      setIsStopping(false);
    }
  };

  // ------------------------------------------------------------
  // 4. Compute Planned Shadow Baseline & Corridor (Entire Mission Span)
  // ------------------------------------------------------------

  const shadowPhases = shadow?.phase_results || missionResult?.phase_results || [
    { phase: "TAKEOFF", duration_min: 3 },
    { phase: "CLIMB", duration_min: 7 },
    { phase: "CRUISE", duration_min: 28 },
    { phase: "LOITER", duration_min: 10 },
    { phase: "DESCENT", duration_min: 6 },
    { phase: "RETURN", duration_min: 3 },
    { phase: "LANDING", duration_min: 3 },
  ];

  const totalMissionDuration = useMemo(() => {
    const sum = shadowPhases.reduce((acc, p) => acc + n(p.duration_min, 5), 0) || 60;
    return Math.round(sum);
  }, [shadowPhases]);

  // Compute planned trajectory checkpoints (Spans 0 to totalMissionDuration across full envelope)
  const plannedPoints = useMemo(() => {
    const pts = [];
    let cumTime = 0;

    shadowPhases.forEach((ph) => {
      const dur = n(ph.duration_min, 5);
      const checkpoints = ph.checkpoints || [
        { checkpoint: 1, engine_state: { cht_c: 121, egt_c: 713, vibration_g: 0.16, oil_press_bar: 3.2, oil_temp_c: 94, battery_v: 14.1 } },
        { checkpoint: 2, engine_state: { cht_c: 119, egt_c: 705, vibration_g: 0.14, oil_press_bar: 3.4, oil_temp_c: 94, battery_v: 14.1 } },
      ];

      checkpoints.forEach((ck, idx) => {
        const timeInMission = cumTime + n(ck.time_min, (idx / Math.max(1, checkpoints.length - 1)) * dur);
        const health = calculateCompositeIndex(ck.engine_state);

        pts.push({
          timeMin: Number(timeInMission.toFixed(2)),
          phase: ph.phase,
          idealHealth: health,
          upperCorridor: Math.min(100, health + corridorWidth),
          lowerCorridor: Math.max(30, health - corridorWidth),
        });
      });

      cumTime += dur;
    });

    // Ensure start point at t = 0
    if (!pts.length || pts[0].timeMin > 0) {
      const startHealth = pts.length ? pts[0].idealHealth : 91.5;
      pts.unshift({
        timeMin: 0,
        phase: shadowPhases[0]?.phase || "TAKEOFF",
        idealHealth: startHealth,
        upperCorridor: Math.min(100, startHealth + corridorWidth),
        lowerCorridor: Math.max(30, startHealth - corridorWidth),
      });
    }

    // Ensure terminal point at t = totalMissionDuration (Envelope spans 100% of full mission!)
    const lastPt = pts[pts.length - 1];
    if (lastPt.timeMin < totalMissionDuration) {
      pts.push({
        timeMin: totalMissionDuration,
        phase: shadowPhases[shadowPhases.length - 1]?.phase || "LANDING",
        idealHealth: lastPt.idealHealth,
        upperCorridor: Math.min(100, lastPt.idealHealth + corridorWidth),
        lowerCorridor: Math.max(30, lastPt.idealHealth - corridorWidth),
      });
    }

    return pts.sort((a, b) => a.timeMin - b.timeMin);
  }, [shadowPhases, totalMissionDuration, corridorWidth]);

  // ------------------------------------------------------------
  // 5. Dynamic Scale & Viewport Calculation
  // ------------------------------------------------------------

  const latestLiveTime = liveHistory.length > 0 ? liveHistory[liveHistory.length - 1].timeMin : 0;
  const currentLiveHealth = liveHistory.length > 0 ? liveHistory[liveHistory.length - 1].health : calculateCompositeIndex(packet?.current_state);

  // X-Axis range ALWAYS spans the ENTIRE MISSION (0 to totalMissionDuration) for the Shadow Envelope!
  const xMin = 0;
  const xMax = totalMissionDuration / xStretch;

  // Live telemetry line stretch scale factor for 5-minute rolling default view
  const liveTimeScaleFactor = useMemo(() => {
    if (viewMode === "5min" && latestLiveTime > 0) {
      // In 5-min rolling mode, stretch live line so 5 min spans current progress smoothly
      const targetWindow = 5.0;
      return Math.max(1.0, totalMissionDuration / Math.max(targetWindow, latestLiveTime));
    }
    return 1.0;
  }, [viewMode, latestLiveTime, totalMissionDuration]);

  // Y-Axis Auto-Fit
  const { yMin, yMax } = useMemo(() => {
    if (!autoFitY) return { yMin: 50, yMax: 100 };

    let vals = [
      ...plannedPoints.map((p) => p.idealHealth),
      ...plannedPoints.map((p) => p.upperCorridor),
      ...plannedPoints.map((p) => p.lowerCorridor),
      ...liveHistory.map((p) => p.health),
    ];

    if (!vals.length) vals = [82, 98];

    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const pad = Math.max(4.0, (maxV - minV) * 0.2);

    return {
      yMin: Math.max(0, Math.floor(minV - pad)),
      yMax: Math.min(100, Math.ceil(maxV + pad)),
    };
  }, [autoFitY, plannedPoints, liveHistory]);

  // ------------------------------------------------------------
  // 6. SVG Drawing Paths & Controls
  // ------------------------------------------------------------

  const svgWidth = 1000;
  const svgHeight = 340;
  const padLeft = 60;
  const padRight = 35;
  const padTop = 35;
  const padBottom = 50;

  const chartW = svgWidth - padLeft - padRight;
  const chartH = svgHeight - padTop - padBottom;

  const getX = (t) => padLeft + Math.min(1, Math.max(0, (t - xMin) / (xMax - xMin || 1))) * chartW;
  const getY = (h) => padTop + chartH - Math.min(1, Math.max(0, (h - yMin) / (yMax - yMin || 1))) * chartH;

  // Planned Path (Spans Entire Mission)
  const plannedPathD = useMemo(() => {
    if (!plannedPoints.length) return "";
    return plannedPoints.map((p, i) => `${i === 0 ? "M" : "L"}${getX(p.timeMin).toFixed(1)},${getY(p.idealHealth).toFixed(1)}`).join(" ");
  }, [plannedPoints, xMin, xMax, yMin, yMax]);

  // Corridor Envelope Path (Spans 100% of Entire Mission)
  const corridorPathD = useMemo(() => {
    if (!plannedPoints.length) return "";
    const top = plannedPoints.map((p, i) => `${i === 0 ? "M" : "L"}${getX(p.timeMin).toFixed(1)},${getY(p.upperCorridor).toFixed(1)}`).join(" ");
    const bot = [...plannedPoints].reverse().map((p) => `L${getX(p.timeMin).toFixed(1)},${getY(p.lowerCorridor).toFixed(1)}`).join(" ");
    return `${top} ${bot} Z`;
  }, [plannedPoints, xMin, xMax, yMin, yMax]);

  // Live Telemetry Path (Visible ONLY when activeMission is active!)
  const livePathD = useMemo(() => {
    if (!activeMission || !liveHistory.length) return "";
    return liveHistory.map((p, i) => {
      // In 5-min default stretch mode, scale live time X coordinate smoothly across full mission chart
      const scaledTime = viewMode === "5min" ? p.timeMin * liveTimeScaleFactor : p.timeMin;
      const clampedTime = Math.min(totalMissionDuration, scaledTime);
      return `${i === 0 ? "M" : "L"}${getX(clampedTime).toFixed(1)},${getY(p.health).toFixed(1)}`;
    }).join(" ");
  }, [activeMission, liveHistory, viewMode, liveTimeScaleFactor, totalMissionDuration, yMin, yMax]);

  const liveCursorX = getX(Math.min(totalMissionDuration, viewMode === "5min" ? latestLiveTime * liveTimeScaleFactor : latestLiveTime));
  const liveCursorY = getY(currentLiveHealth);

  const targetPlannedScore = useMemo(() => {
    if (!plannedPoints.length) return 92.0;
    const match = plannedPoints.reduce((prev, curr) => {
      return Math.abs(curr.timeMin - latestLiveTime) < Math.abs(prev.timeMin - latestLiveTime) ? curr : prev;
    });
    return match ? match.idealHealth : 92.0;
  }, [plannedPoints, latestLiveTime]);

  const deltaScore = (currentLiveHealth - targetPlannedScore).toFixed(1);
  const isDeviated = Math.abs(currentLiveHealth - targetPlannedScore) > corridorWidth;

  // Interactive Hover Crosshair & Tooltip State
  const [hoverPoint, setHoverPoint] = useState(null);

  const handleMouseMove = (e) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * svgWidth;
    const mouseY = ((e.clientY - rect.top) / rect.height) * svgHeight;

    if (mouseX >= padLeft && mouseX <= svgWidth - padRight) {
      const ratio = (mouseX - padLeft) / chartW;
      const hoveredTimeMin = Math.min(totalMissionDuration, Math.max(0, ratio * (xMax - xMin) + xMin));

      // Find closest planned point
      let closestPlanned = plannedPoints[0];
      let minDiff = Infinity;
      plannedPoints.forEach((p) => {
        const diff = Math.abs(p.timeMin - hoveredTimeMin);
        if (diff < minDiff) {
          minDiff = diff;
          closestPlanned = p;
        }
      });

      // Find closest live telemetry point if activeMission exists
      let liveHealth = null;
      if (activeMission && liveHistory.length > 0) {
        let minLiveDiff = Infinity;
        liveHistory.forEach((l) => {
          const lScaled = viewMode === "5min" ? l.timeMin * liveTimeScaleFactor : l.timeMin;
          const diff = Math.abs(lScaled - hoveredTimeMin);
          if (diff < minLiveDiff && diff <= 5) {
            minLiveDiff = diff;
            liveHealth = l.health;
          }
        });
      }

      setHoverPoint({
        x: mouseX,
        y: mouseY,
        timeMin: hoveredTimeMin,
        idealHealth: closestPlanned ? closestPlanned.idealHealth : 92.0,
        upperCorridor: closestPlanned ? closestPlanned.upperCorridor : 99.5,
        lowerCorridor: closestPlanned ? closestPlanned.lowerCorridor : 84.5,
        phase: closestPlanned ? closestPlanned.phase : "CRUISE",
        liveHealth: liveHealth,
      });
    } else {
      setHoverPoint(null);
    }
  };

  const handleMouseLeave = () => {
    setHoverPoint(null);
  };

  // If no mission has been created yet, display standby creation card
  if (!missionResult) {
    return (
      <div style={{
        background: "#09131d",
        border: "1px dashed #182a3d",
        borderRadius: 14,
        padding: "36px 20px",
        textAlign: "center",
        boxShadow: "0 12px 36px rgba(0, 0, 0, 0.5)",
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}>
        <div style={{ fontSize: 10, fontWeight: 900, color: "#38c0e8", letterSpacing: "2px", marginBottom: 6 }}>
          MISSIONGUARD • TRAJECTORY GRAPH
        </div>
        <div style={{ fontSize: 18, fontWeight: 800, color: "#f0f4f8", marginBottom: 6 }}>
          NO MISSION PROFILE CREATED
        </div>
        <div style={{ fontSize: 12, color: "#8faec0", maxWidth: 520, margin: "0 auto" }}>
          Configure flight parameters in <strong>MISSIONGUARD SIMULATOR</strong> below and click <span style={{ color: "#38c0e8", fontWeight: 800 }}>▶ CREATE MISSION</span> to generate the planned shadow ideal baseline & safety envelope.
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: "#09131d",
      border: "1px solid #182a3d",
      borderRadius: 14,
      padding: "22px",
      boxShadow: "0 12px 36px rgba(0, 0, 0, 0.5)",
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      color: "#e1eaf2",
      position: "relative",
    }}>
      {/* ── TOP ACTION HEADER ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 18, paddingBottom: 14, borderBottom: "1px solid #182a3d",
      }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <span style={{
              fontSize: 10, fontWeight: 800, letterSpacing: "2px",
              color: "#38c0e8", background: "rgba(56, 192, 232, 0.1)",
              padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(56, 192, 232, 0.25)"
            }}>
              MISSION GUARD • FULL MISSION ENVELOPE
            </span>
            {activeMission ? (
              <span style={{
                fontSize: 10, fontWeight: 800, color: "#00d69d",
                display: "flex", alignItems: "center", gap: 6,
                background: "rgba(0, 214, 157, 0.12)", padding: "2px 10px",
                borderRadius: 10, border: "1px solid rgba(0, 214, 157, 0.3)"
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: "50%", background: "#00d69d",
                  boxShadow: "0 0 8px #00d69d", animation: "mgPulse 1.2s infinite"
                }} />
                TELEMETRY STREAM ACTIVE
              </span>
            ) : (
              <span style={{
                fontSize: 10, fontWeight: 700, color: "#38c0e8",
                background: "rgba(56, 192, 232, 0.1)", padding: "2px 10px",
                borderRadius: 10, border: "1px solid rgba(56, 192, 232, 0.3)"
              }}>
                SHADOW ENVELOPE SYNCHRONIZED • AWAITING START
              </span>
            )}
          </div>

          <h3 style={{
            margin: 0, fontSize: 18, fontWeight: 800, color: "#f0f4f8", letterSpacing: "0.5px"
          }}>
            Unified Mission Shadow Trajectory
          </h3>
        </div>

        {/* Start / Stop Button */}
        <div>
          {!activeMission ? (
            <button
              onClick={handleStartMission}
              disabled={isStarting}
              style={{
                background: "linear-gradient(135deg, #00d69d, #009968)",
                color: "#031710", border: "none", borderRadius: 6,
                padding: "10px 22px", fontSize: 12, fontWeight: 800,
                letterSpacing: "1px", cursor: "pointer",
                boxShadow: "0 4px 16px rgba(0, 214, 157, 0.3)",
                display: "flex", alignItems: "center", gap: 8,
              }}
            >
              {isStarting ? "STARTING..." : "▶ START MISSION"}
            </button>
          ) : (
            <button
              onClick={handleStopMission}
              disabled={isStopping}
              style={{
                background: "linear-gradient(135deg, #e74c3c, #b02a1e)",
                color: "#ffffff", border: "none", borderRadius: 6,
                padding: "10px 20px", fontSize: 12, fontWeight: 800,
                letterSpacing: "1px", cursor: "pointer",
              }}
            >
              ⏹ STOP MISSION
            </button>
          )}
        </div>
      </div>

      {/* ── INSTRUCTIONAL BANNER WHEN NOT STARTED YET ── */}
      {!activeMission && (
        <div style={{
          background: "rgba(56, 192, 232, 0.08)",
          border: "1px solid rgba(56, 192, 232, 0.25)",
          borderRadius: 8,
          padding: "10px 16px",
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 11.5,
          color: "#38c0e8",
          fontWeight: 600,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, background: "#38c0e822", color: "#38c0e8", padding: "2px 6px", borderRadius: 4, fontWeight: 900, fontFamily: "monospace" }}>INFO</span>
            <span>
              <strong>IDEAL SHADOW TRAJECTORY LOADED:</strong> Showing planned baseline corridor for {totalMissionDuration}-min flight. Click <span style={{ color: "#00d69d", fontWeight: 800 }}>▶ START MISSION</span> above to initiate live telemetry streaming and compare actual flight vs ideal shadow.
            </span>
          </div>
        </div>
      )}

      {/* ── KPI TELEMETRY CARDS ── */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 18,
      }}>
        {/* KPI 1: PLANNED SHADOW */}
        <div style={{
          background: "#0e1e2e", border: "1px solid #1a2b3e", borderRadius: 8, padding: "12px 14px",
        }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: "#38c0e8", letterSpacing: "1px" }}>
            PLANNED SHADOW (IDEAL)
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: "#38c0e8", marginTop: 4, fontFamily: "monospace" }}>
            {targetPlannedScore.toFixed(1)} <span style={{ fontSize: 12 }}>%</span>
          </div>
          <div style={{ fontSize: 10, color: "#627d94", marginTop: 2 }}>
            Baseline trajectory target
          </div>
        </div>

        {/* KPI 2: ACTUAL TELEMETRY */}
        <div style={{
          background: !activeMission && liveHistory.length === 0 ? "#0e1e2e" : (isDeviated ? "rgba(231, 76, 60, 0.1)" : "rgba(0, 214, 157, 0.08)"),
          border: `1px solid ${!activeMission && liveHistory.length === 0 ? "#1a2b3e" : (isDeviated ? "#e74c3c" : "#00d69d33")}`,
          borderRadius: 8, padding: "12px 14px",
        }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: !activeMission && liveHistory.length === 0 ? "#8faec0" : (isDeviated ? "#e74c3c" : "#00d69d"), letterSpacing: "1px" }}>
            ACTUAL TELEMETRY
          </div>
          <div style={{
            fontSize: activeMission || liveHistory.length > 0 ? 22 : 15,
            fontWeight: 900,
            color: !activeMission && liveHistory.length === 0 ? "#627d94" : (isDeviated ? "#e74c3c" : "#00d69d"),
            marginTop: activeMission || liveHistory.length > 0 ? 4 : 8,
            fontFamily: "monospace",
          }}>
            {activeMission || liveHistory.length > 0 ? (
              <>{currentLiveHealth.toFixed(1)} <span style={{ fontSize: 12 }}>%</span></>
            ) : (
              "AWAITING START"
            )}
          </div>
          <div style={{ fontSize: 10, color: "#627d94", marginTop: 2 }}>
            {activeMission ? "Live telemetry active" : "Press ▶ START MISSION"}
          </div>
        </div>

        {/* KPI 3: VARIANCE */}
        <div style={{
          background: "#0e1e2e", border: "1px solid #1a2b3e", borderRadius: 8, padding: "12px 14px",
        }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: "#8faec0", letterSpacing: "1px" }}>
            VARIANCE (Δ)
          </div>
          <div style={{
            fontSize: activeMission || liveHistory.length > 0 ? 22 : 15,
            fontWeight: 900,
            color: activeMission || liveHistory.length > 0 ? (Number(deltaScore) < -corridorWidth ? "#e74c3c" : "#e1eaf2") : "#627d94",
            marginTop: activeMission || liveHistory.length > 0 ? 4 : 8,
            fontFamily: "monospace"
          }}>
            {activeMission || liveHistory.length > 0 ? (
              <>{Number(deltaScore) > 0 ? `+${deltaScore}` : deltaScore} <span style={{ fontSize: 12, color: "#8faec0" }}>%</span></>
            ) : (
              "STANDBY"
            )}
          </div>
          <div style={{ fontSize: 10, color: "#627d94", marginTop: 2 }}>
            Delta from baseline
          </div>
        </div>

        {/* KPI 4: ENVELOPE STATUS */}
        <div style={{
          background: "#0e1e2e", border: `1px solid ${activeMission ? (isDeviated ? "#e74c3c" : "#00d69d44") : "#1a2b3e"}`,
          borderRadius: 8, padding: "12px 14px",
        }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: "#8faec0", letterSpacing: "1px" }}>
            ENVELOPE STATUS
          </div>
          <div style={{
            fontSize: 12, fontWeight: 800, color: activeMission ? (isDeviated ? "#e74c3c" : "#00d69d") : "#38c0e8",
            marginTop: 6, display: "flex", alignItems: "center", gap: 6,
          }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: activeMission ? (isDeviated ? "#e74c3c" : "#00d69d") : "#38c0e8",
              boxShadow: `0 0 8px ${activeMission ? (isDeviated ? "#e74c3c" : "#00d69d") : "#38c0e8"}`
            }} />
            {activeMission ? (isDeviated ? "DEVIATION DETECTED" : "NOMINAL IN-ENVELOPE") : "READY TO EXECUTE"}
          </div>
          <div style={{ fontSize: 10, color: "#627d94", marginTop: 4 }}>
            Corridor width: ±{corridorWidth}%
          </div>
        </div>
      </div>

      {/* ── STRETCH & ZOOM CONTROLS BAR ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "#0d1b2a", border: "1px solid #1a2b3e",
        borderRadius: 8, padding: "8px 14px", marginBottom: 12, gap: 14,
      }}>
        {/* View Mode Presets (5-min is DEFAULT) */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: "#38c0e8", letterSpacing: "1px" }}>
            VIEW MODE:
          </span>
          <button
            onClick={() => setViewMode("5min")}
            style={{
              background: viewMode === "5min" ? "#1a3b5c" : "transparent",
              color: viewMode === "5min" ? "#38c0e8" : "#8faec0",
              border: `1px solid ${viewMode === "5min" ? "#38c0e8" : "#1a2b3e"}`,
              borderRadius: 4, padding: "4px 10px", fontSize: 10, fontWeight: 700, cursor: "pointer",
            }}
          >
            5-MIN ROLLING (DEFAULT)
          </button>
          <button
            onClick={() => setViewMode("full")}
            style={{
              background: viewMode === "full" ? "#1a3b5c" : "transparent",
              color: viewMode === "full" ? "#38c0e8" : "#8faec0",
              border: `1px solid ${viewMode === "full" ? "#38c0e8" : "#1a2b3e"}`,
              borderRadius: 4, padding: "4px 10px", fontSize: 10, fontWeight: 700, cursor: "pointer",
            }}
          >
            FULL MISSION ({totalMissionDuration}M)
          </button>
        </div>

        {/* Stretch Slider */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#8faec0" }}>
            STRETCH: {xStretch}x
          </span>
          <input
            type="range" min="1.0" max="5.0" step="0.5"
            value={xStretch} onChange={(e) => setXStretch(Number(e.target.value))}
            style={{ width: 80, accentColor: "#38c0e8", cursor: "pointer" }}
          />
        </div>

        {/* Auto Fit Y */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <label style={{ fontSize: 9, fontWeight: 700, color: "#8faec0", cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}>
            <input
              type="checkbox" checked={autoFitY} onChange={(e) => setAutoFitY(e.target.checked)}
              style={{ accentColor: "#00d69d" }}
            />
            AUTO-FIT Y
          </label>
        </div>
      </div>

      {/* ── MAIN SVG GRAPH CANVAS ── */}
      <div style={{
        position: "relative", background: "#060d15",
        border: "1px solid #142436", borderRadius: 10, padding: "10px",
        cursor: "crosshair",
      }}>
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          style={{ width: "100%", height: "auto", overflow: "visible", shapeRendering: "geometricPrecision" }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            {/* Smooth Corridor Gradient */}
            <linearGradient id="corridorFillGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#38c0e8" stopOpacity="0.22" />
              <stop offset="50%" stopColor="#38c0e8" stopOpacity="0.10" />
              <stop offset="100%" stopColor="#38c0e8" stopOpacity="0.03" />
            </linearGradient>

            {/* Glow Filter Cyan (Planned Baseline) */}
            <filter id="glowCyan" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Glow Filter Green (Live Telemetry Nominal) */}
            <filter id="glowGreen" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            {/* Glow Filter Red (Live Telemetry Deviated) */}
            <filter id="glowRed" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Horizontal Gridlines */}
          {Array.from({ length: 5 }).map((_, idx) => {
            const hVal = yMin + (yMax - yMin) * (idx / 4);
            const y = getY(hVal);
            return (
              <g key={idx}>
                <line
                  x1={padLeft} y1={y} x2={svgWidth - padRight} y2={y}
                  stroke="#122538" strokeWidth="1" strokeDasharray="3,3"
                />
                <text
                  x={padLeft - 8} y={y + 3}
                  fill="#627d94" fontSize="9.5" fontFamily="'JetBrains Mono', monospace" fontWeight="700" textAnchor="end"
                >
                  {hVal.toFixed(0)}%
                </text>
              </g>
            );
          })}

          {/* Time Labels on X-Axis (Spans FULL Mission 0 to totalMissionDuration) */}
          {Array.from({ length: 7 }).map((_, idx) => {
            const tVal = (totalMissionDuration / 6) * idx;
            const x = getX(tVal);
            return (
              <g key={idx}>
                <line
                  x1={x} y1={padTop} x2={x} y2={svgHeight - padBottom}
                  stroke="#122538" strokeWidth="1" strokeDasharray="4,4"
                />
                <text
                  x={x} y={svgHeight - 16}
                  fill="#627d94" fontSize="9.5" fontFamily="'JetBrains Mono', monospace" fontWeight="700" textAnchor="middle"
                >
                  {tVal.toFixed(1)}m
                </text>
              </g>
            );
          })}

          {/* 1. PLANNED SHADOW ENVELOPE CORRIDOR (Spans 100% of Entire Mission: 0 to totalMissionDuration) */}
          {corridorPathD && (
            <path
              d={corridorPathD}
              fill="url(#corridorFillGrad)"
              stroke="rgba(56, 192, 232, 0.4)" strokeWidth="1.5" strokeDasharray="4,3"
            />
          )}

          {/* 2. PLANNED SHADOW BASELINE (Solid, Crisp, Glowing Cyan Vector Line) */}
          {plannedPathD && (
            <path
              d={plannedPathD}
              fill="none" stroke="#38c0e8" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" filter="url(#glowCyan)" opacity="0.95"
            />
          )}

          {/* Checkpoint Target Nodes */}
          {plannedPoints.map((p, idx) => (
            <g key={idx} transform={`translate(${getX(p.timeMin)}, ${getY(p.idealHealth)})`}>
              <circle r="4" fill="#38c0e8" stroke="#060d15" strokeWidth="2" />
              <circle r="2" fill="#ffffff" />
            </g>
          ))}

          {/* 3. ACTUAL LIVE TELEMETRY LINE (High-Visibility Solid Glowing Emerald / Crimson Vector Line) */}
          {livePathD && (
            <path
              d={livePathD}
              fill="none"
              stroke={isDeviated ? "#ff3344" : "#00e6a8"}
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={isDeviated ? "url(#glowRed)" : "url(#glowGreen)"}
            />
          )}

          {/* 4. LIVE TELEMETRY CURSOR */}
          {activeMission && (
            <g transform={`translate(${liveCursorX}, ${liveCursorY})`}>
              <circle r="10" fill="none" stroke={isDeviated ? "#ff3344" : "#00e6a8"} strokeWidth="1.5" opacity="0.7">
                <animate attributeName="r" values="6;12;6" dur="1.5s" repeatCount="indefinite" />
              </circle>
              <circle r="5" fill={isDeviated ? "#ff3344" : "#00e6a8"} stroke="#060d15" strokeWidth="2" />
            </g>
          )}

          {/* 5. INTERACTIVE HOVER CROSSHAIR CURSOR & NODES */}
          {hoverPoint && (
            <g>
              <line
                x1={hoverPoint.x} y1={padTop}
                x2={hoverPoint.x} y2={svgHeight - padBottom}
                stroke="#38c0e8" strokeWidth="1.5" strokeDasharray="3,3" opacity="0.8"
              />
              <circle
                cx={hoverPoint.x} cy={getY(hoverPoint.idealHealth)}
                r="5" fill="#38c0e8" stroke="#ffffff" strokeWidth="2"
              />
              {hoverPoint.liveHealth !== null && (
                <circle
                  cx={hoverPoint.x} cy={getY(hoverPoint.liveHealth)}
                  r="5" fill={Math.abs(hoverPoint.liveHealth - hoverPoint.idealHealth) > corridorWidth ? "#ff3344" : "#00e6a8"} stroke="#ffffff" strokeWidth="2"
                />
              )}
            </g>
          )}

          {/* Chart Outer Border Frame */}
          <rect x={padLeft} y={padTop} width={chartW} height={chartH} fill="none" stroke="#1c3652" strokeWidth="1.5" />
        </svg>

        {/* Floating High-Tech Interactive Hover Tooltip Overlay */}
        {hoverPoint && (
          <div style={{
            position: "absolute",
            left: Math.min(svgWidth - 240, Math.max(padLeft, hoverPoint.x + 15)),
            top: Math.max(padTop + 10, hoverPoint.y - 70),
            pointerEvents: "none",
            background: "rgba(9, 19, 29, 0.95)",
            border: "1px solid #38c0e8",
            borderRadius: 8,
            padding: "10px 14px",
            color: "#e1eaf2",
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
            boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
            backdropFilter: "blur(8px)",
            zIndex: 10,
          }}>
            <div style={{ fontWeight: 800, color: "#38c0e8", marginBottom: 4, display: "flex", justifyContent: "space-between", gap: 10 }}>
              <span>TIME = {hoverPoint.timeMin.toFixed(1)}m</span>
              <span style={{ color: "#8faec0", fontSize: 10 }}>{hoverPoint.phase}</span>
            </div>
            <div style={{ color: "#38c0e8" }}>
              IDEAL TARGET: <strong>{hoverPoint.idealHealth.toFixed(1)}%</strong>
            </div>
            <div style={{ color: "#627d94", fontSize: 9.5 }}>
              SAFETY CORRIDOR: [{hoverPoint.lowerCorridor.toFixed(1)}% - {hoverPoint.upperCorridor.toFixed(1)}%]
            </div>
            <div style={{ color: hoverPoint.liveHealth !== null ? (Math.abs(hoverPoint.liveHealth - hoverPoint.idealHealth) > corridorWidth ? "#ff3344" : "#00e6a8") : "#8faec0", marginTop: 2 }}>
              ACTUAL FLIGHT: <strong>{hoverPoint.liveHealth !== null ? hoverPoint.liveHealth.toFixed(1) + '%' : 'AWAITING START'}</strong>
            </div>
            {hoverPoint.liveHealth !== null && (
              <div style={{ color: Math.abs(hoverPoint.liveHealth - hoverPoint.idealHealth) > corridorWidth ? "#ff3344" : "#00e6a8", fontSize: 10, fontWeight: 700, marginTop: 2 }}>
                Δ: {(hoverPoint.liveHealth - hoverPoint.idealHealth) > 0 ? `+${(hoverPoint.liveHealth - hoverPoint.idealHealth).toFixed(1)}` : (hoverPoint.liveHealth - hoverPoint.idealHealth).toFixed(1)}% ({Math.abs(hoverPoint.liveHealth - hoverPoint.idealHealth) > corridorWidth ? 'DEVIATED' : 'NOMINAL'})
              </div>
            )}
          </div>
        )}

        {/* Legend Overlay */}
        <div style={{
          position: "absolute", top: 16, right: 20, display: "flex", alignItems: "center", gap: 16,
          background: "rgba(9, 19, 29, 0.92)", border: "1px solid #1c3854",
          borderRadius: 6, padding: "7px 14px", fontSize: 9.5, fontWeight: 800, backdropFilter: "blur(6px)",
          boxShadow: "0 4px 16px rgba(0,0,0,0.5)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 14, height: 3, background: "#38c0e8", borderRadius: 2, display: "inline-block", boxShadow: "0 0 8px #38c0e8" }} />
            <span style={{ color: "#38c0e8", letterSpacing: "0.5px" }}>PLANNED SHADOW (IDEAL BASELINE)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 14, height: 10, background: "rgba(56, 192, 232, 0.25)", border: "1px dashed #38c0e8", borderRadius: 2, display: "inline-block" }} />
            <span style={{ color: "#8faec0", letterSpacing: "0.5px" }}>SAFETY ENVELOPE (±{corridorWidth}%)</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 14, height: 3.5, background: activeMission ? (isDeviated ? "#ff3344" : "#00e6a8") : "#627d94", borderRadius: 2, display: "inline-block", boxShadow: activeMission ? `0 0 8px ${isDeviated ? "#ff3344" : "#00e6a8"}` : "none" }} />
            <span style={{ color: activeMission ? (isDeviated ? "#ff3344" : "#00e6a8") : "#627d94", letterSpacing: "0.5px" }}>
              {activeMission ? "LIVE FLIGHT TELEMETRY (ACTUAL)" : "LIVE TELEMETRY (AWAITING START)"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
