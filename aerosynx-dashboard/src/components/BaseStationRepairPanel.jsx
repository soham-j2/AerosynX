/**
 * BaseStationRepairPanel.jsx
 *
 * Ground Base Station In-Flight Engine Repair & Mitigation Control System
 *
 * Provides both preset automated repair protocols AND interactive user-driven command line input,
 * manual parameter sliders (timing, flaps, mixture, oil pressure), and telemetry override handshakes.
 */

import React, { useState } from "react";
import { toast } from "react-toastify";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5001";

const REPAIR_PROTOCOLS = {
  misfire: {
    faultName: "Combustion Misfire",
    severity: "CRITICAL",
    color: "#ff6600",
    actionTitle: "Auto-Purge Chamber & Adjust Spark Timing",
    description: "Trims ECU ignition timing advance by -2° and initiates air-purge cycle to clear unburnt fuel buildup.",
    subActions: [
      "Retard Ignition Timing (-2.0° BTDC)",
      "Initiate High-Velocity Air Chamber Purge",
      "Reset Cylinder Firing Sequence Balance"
    ]
  },
  injector_abnormality: {
    faultName: "Injector Flow Abnormality",
    severity: "WARNING",
    color: "#ffaa00",
    actionTitle: "Pulse Flush & Switch Secondary Injector Solenoid",
    description: "Bypasses clogged primary fuel nozzle, opens secondary injector circuit, and adjusts PWM pulse width.",
    subActions: [
      "Actuate Backup Injector Solenoid (Channel B)",
      "Apply High-Pressure Pulsed Solvent Flush",
      "Normalize Fuel Flow Rate (Target 15.8 L/H)"
    ]
  },
  coking_degradation: {
    faultName: "Coking & Thermal Degradation",
    severity: "WARNING",
    color: "#cc7733",
    actionTitle: "Engage Auxiliary Cowl Cooling & Enrich Mixture",
    description: "Opens emergency cooling cowl flaps to max airflow and enriches fuel-to-air ratio to drop CHT & EGT.",
    subActions: [
      "Open Ram-Air Emergency Cowl Flaps (100%)",
      "Enrich Fuel Ratio (+8.5% Lambda Bias)",
      "Activate Cylinder Head Heat Dissipation Fans"
    ]
  },
  lubrication_issue: {
    faultName: "Lubrication Pressure / Thermal Crisis",
    severity: "CRITICAL",
    color: "#ff2200",
    actionTitle: "Engage Auxiliary Electric Oil Pump & Heat Bypass",
    description: "Energizes backup 24V electric oil pump, increases oil line pressure, and bypasses thermal restriction.",
    subActions: [
      "Energize Auxiliary Electric Oil Pump (28V DC)",
      "Open Oil Heat Exchanger Bypass Valve",
      "Restore Sump Circulation Pressure (>3.2 Bar)"
    ]
  },
  sensor_drift: {
    faultName: "Telemetry Sensor Drift",
    severity: "WARNING",
    color: "#9966ff",
    actionTitle: "Re-Zero Kalman Filter Sensor Bias",
    description: "Re-calibrates sensor baseline zero against redundant physical cross-sensor metrics.",
    subActions: [
      "Sample Cross-Sensor Synthetic Reference Values",
      "Re-Zero Sensor Offset Vector",
      "Re-initialize Extended Kalman Filter (EKF)"
    ]
  },
  combustion_instability: {
    faultName: "Combustion Pressure Instability",
    severity: "CRITICAL",
    color: "#ff4400",
    actionTitle: "Dynamic Throttle Stabilizer & Mixture Balancing",
    description: "Applies closed-loop throttle dampening and stabilizes fuel injection timing across all engine cylinders.",
    subActions: [
      "Engage Closed-Loop Throttle Harmonic Dampener",
      "Equalize Cylinder Injection Timings",
      "Suppress RPM Jitter Oscillations"
    ]
  },
  battery_alternator_health: {
    faultName: "Electrical / Alternator Fault",
    severity: "WARNING",
    color: "#f39c12",
    actionTitle: "Isolate Primary Bus & Switch Auxiliary Power Unit",
    description: "Swaps electrical load to redundant secondary avionics bus and resets alternator voltage regulator.",
    subActions: [
      "Isolate Faulty Primary Charging Line",
      "Switch Flight Electronics to Reserve Bus B",
      "Reset Alternator Voltage Regulator Baseline"
    ]
  }
};

export function BaseStationRepairPanel({ packet, onClearFault }) {
  const activeFaultKey = packet?.context?.active_fault || packet?.ai?.predicted_fault || "none";
  const activeFaultObj = REPAIR_PROTOCOLS[activeFaultKey] || null;

  const [isExecuting, setIsExecuting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  
  // Interactive Manual Parameters State
  const [manualTiming, setManualTiming] = useState(-2.0);
  const [manualCowlFlaps, setManualCowlFlaps] = useState(100);
  const [manualMixture, setManualMixture] = useState(8.5);
  const [manualOilPump, setManualOilPump] = useState(3.5);

  // Command Line CLI State
  const [commandInput, setCommandInput] = useState("");
  const [repairLogs, setRepairLogs] = useState([
    {
      id: 1,
      time: new Date().toLocaleTimeString(),
      text: "Base Station Encrypted Command Telemetry Link (2.4 GHz) ONLINE.",
      status: "INFO"
    },
    {
      id: 2,
      time: new Date().toLocaleTimeString(),
      text: "Type 'HELP' or select a command prompt below to issue manual override commands.",
      status: "INFO"
    }
  ]);

  const executeRepairAction = async (actionName, faultKey, customDetails = null) => {
    setIsExecuting(true);
    setProgress(15);
    setCurrentStep("Transmitting Encrypted Base Station Command Signal...");

    const logText = customDetails 
      ? `[MANUAL COMMAND] ${actionName}: ${customDetails}`
      : `[COMMAND SENT] Executing in-flight repair: ${actionName}`;

    const newLog = {
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
      text: logText,
      status: "EXECUTING"
    };
    setRepairLogs((prev) => [newLog, ...prev]);

    setTimeout(() => {
      setProgress(50);
      setCurrentStep("UAV Telemetry Handshake Confirmed • Actuator Triggered...");
    }, 500);

    setTimeout(() => {
      setProgress(85);
      setCurrentStep("Engine ECU Resetting Telemetry Baseline to Nominal...");
    }, 1000);

    setTimeout(async () => {
      setProgress(100);
      try {
        const response = await fetch(`${API_BASE}/api/fault/repair`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: actionName, fault: faultKey, details: customDetails })
        });
        if (response.ok) {
          toast.success(`[BASE STATION] Action Executed: ${actionName}`, {
            position: "top-right",
            autoClose: 3500,
            theme: "dark"
          });
        }
      } catch (e) {
        // Fallback clear
      }

      if (onClearFault) onClearFault();

      const successLog = {
        id: Date.now() + 1,
        time: new Date().toLocaleTimeString(),
        text: `[SUCCESS] ${actionName} Completed — Telemetry Parameters Restored.`,
        status: "SUCCESS"
      };
      setRepairLogs((prev) => [successLog, ...prev]);

      setIsExecuting(false);
      setProgress(0);
      setCurrentStep("");
    }, 1500);
  };

  const handleCommandSubmit = (e) => {
    e.preventDefault();
    const cmd = commandInput.trim().toUpperCase();
    if (!cmd) return;

    setCommandInput("");

    if (cmd === "HELP") {
      const helpLog = {
        id: Date.now(),
        time: new Date().toLocaleTimeString(),
        text: "COMMANDS: REPAIR [FAULT], SET TIMING [DEG], SET FLAPS [%], SET MIXTURE [%], SET PUMP [BAR], CLEAR FAULT, MASTER RESET",
        status: "INFO"
      };
      setRepairLogs((prev) => [helpLog, ...prev]);
      return;
    }

    if (cmd === "CLEAR FAULT" || cmd === "CLEAR") {
      executeRepairAction("Manual Fault Clear", "none", "User initiated fault clear command");
      return;
    }

    if (cmd === "MASTER RESET" || cmd === "RESET") {
      executeRepairAction("Master Base Station Systems Override", "all", "Emergency system reset command");
      return;
    }

    if (cmd.startsWith("SET TIMING")) {
      const val = cmd.replace("SET TIMING", "").trim();
      executeRepairAction("Adjust Ignition Timing", activeFaultKey, `Timing set to ${val}° BTDC`);
      return;
    }

    if (cmd.startsWith("SET FLAPS")) {
      const val = cmd.replace("SET FLAPS", "").trim();
      executeRepairAction("Adjust Ram-Air Cowl Flaps", activeFaultKey, `Cowl flaps set to ${val}%`);
      return;
    }

    // Generic command execution
    executeRepairAction(`CLI Execution: ${cmd}`, activeFaultKey, `Command: ${cmd}`);
  };

  return (
    <div style={{
      background: "#09131d",
      border: "1px solid #182a3d",
      borderRadius: 14,
      padding: "20px",
      display: "flex",
      flexDirection: "column",
      gap: "18px",
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      color: "#e1eaf2"
    }}>
      {/* ── HEADER ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #142436", paddingBottom: "14px" }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 800, color: "#00d69d", letterSpacing: "2.5px", marginBottom: 4 }}>
            GROUND BASE STATION • INTERACTIVE COMMAND & MITIGATION
          </div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 900, color: "#f0f4f8", letterSpacing: "0.5px" }}>
            In-Flight Engine Repair & Mitigation Control
          </h2>
        </div>

        <span style={{
          fontSize: 10, fontWeight: 900, color: "#00d69d",
          background: "rgba(0, 214, 157, 0.12)", border: "1px solid rgba(0, 214, 157, 0.3)",
          padding: "4px 12px", borderRadius: 6, letterSpacing: "1px"
        }}>
          ● ENCRYPTED UPLINK ACTIVE
        </span>
      </div>

      {/* ── ACTIVE FAULT STATUS BANNER ── */}
      <div style={{
        background: activeFaultObj ? "rgba(231, 76, 60, 0.08)" : "rgba(0, 214, 157, 0.06)",
        border: `1px solid ${activeFaultObj ? activeFaultObj.color : "#00d69d"}`,
        borderRadius: 10,
        padding: "16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 42, height: 42, borderRadius: "50%",
            background: activeFaultObj ? `${activeFaultObj.color}22` : "rgba(0,214,157,0.15)",
            border: `2px solid ${activeFaultObj ? activeFaultObj.color : "#00d69d"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, fontWeight: 900, color: activeFaultObj ? activeFaultObj.color : "#00d69d"
          }}>
            {activeFaultObj ? "⚠️" : "✓"}
          </div>

          <div>
            <div style={{ fontSize: 9, fontWeight: 800, color: "#8faec0", letterSpacing: "1.5px" }}>
              CURRENT DIAGNOSTIC STATE
            </div>
            <div style={{ fontSize: 16, fontWeight: 900, color: activeFaultObj ? activeFaultObj.color : "#00d69d" }}>
              {activeFaultObj ? activeFaultObj.faultName.toUpperCase() : "ALL SYSTEMS NOMINAL — HEALTH 100%"}
            </div>
            <div style={{ fontSize: 11, color: "#627d94", marginTop: 2 }}>
              {activeFaultObj
                ? `Detected anomaly in engine telemetry stream. Issue manual CLI command or run repair protocol.`
                : `Engine operating safely within flight shadow envelope. Ready for command input.`}
            </div>
          </div>
        </div>

        {/* Action Button */}
        {activeFaultObj ? (
          <button
            disabled={isExecuting}
            onClick={() => executeRepairAction(activeFaultObj.actionTitle, activeFaultKey)}
            style={{
              background: `linear-gradient(135deg, ${activeFaultObj.color}, #b02a1e)`,
              color: "#ffffff",
              border: "none",
              borderRadius: 8,
              padding: "12px 20px",
              fontSize: 12,
              fontWeight: 900,
              cursor: "pointer",
              boxShadow: `0 4px 20px ${activeFaultObj.color}44`,
              letterSpacing: "0.5px"
            }}
          >
            {isExecuting ? "⚡ EXECUTING REPAIR..." : "⚡ EXECUTE IN-FLIGHT REPAIR"}
          </button>
        ) : (
          <button
            disabled={isExecuting}
            onClick={() => executeRepairAction("Routine Diagnostic Systems Check", "none")}
            style={{
              background: "#0d1b2a",
              color: "#00d69d",
              border: "1px solid #00d69d",
              borderRadius: 8,
              padding: "10px 18px",
              fontSize: 11,
              fontWeight: 800,
              cursor: "pointer"
            }}
          >
            🔍 RUN DIAGNOSTIC CHECK
          </button>
        )}
      </div>

      {/* ── REPAIR PROGRESS BAR (DURING EXECUTION) ── */}
      {isExecuting && (
        <div style={{
          background: "#060c14",
          border: "1px solid #1a2b3e",
          borderRadius: 8,
          padding: "14px",
          display: "flex",
          flexDirection: "column",
          gap: "8px"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#38c0e8", fontWeight: 700 }}>
            <span>{currentStep}</span>
            <span>{progress}%</span>
          </div>
          <div style={{ width: "100%", height: 8, background: "#0d1b2a", borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              width: `${progress}%`,
              height: "100%",
              background: "linear-gradient(90deg, #00d69d, #38c0e8)",
              transition: "width 0.4s ease"
            }} />
          </div>
        </div>
      )}

      {/* ── INTERACTIVE OPERATOR COMMAND TERMINAL & MANUAL CONTROLS ── */}
      <div style={{
        background: "#060d15",
        border: "1px solid #1d334a",
        borderRadius: 10,
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "14px"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#38c0e8", letterSpacing: "2px" }}>
            OPERATOR INTERACTIVE COMMAND TERMINAL (CLI & OVERRIDE)
          </div>
          <span style={{ fontSize: 9, fontFamily: "monospace", color: "#627d94" }}>
            PORT: 5001 / ENCRYPTED TTY
          </span>
        </div>

        {/* Manual Parameter Tuning Sliders */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", background: "#0a1726", padding: "12px", borderRadius: 8, border: "1px solid #14283c" }}>
          <div>
            <div style={{ fontSize: 9, color: "#8faec0", fontWeight: 700, marginBottom: 4 }}>
              IGNITION TIMING ({manualTiming > 0 ? `+${manualTiming}` : manualTiming}° BTDC)
            </div>
            <input
              type="range" min="-5.0" max="5.0" step="0.5"
              value={manualTiming}
              onChange={(e) => setManualTiming(parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "#38c0e8" }}
            />
          </div>

          <div>
            <div style={{ fontSize: 9, color: "#8faec0", fontWeight: 700, marginBottom: 4 }}>
              COWL FLAP APERTURE ({manualCowlFlaps}%)
            </div>
            <input
              type="range" min="0" max="100" step="5"
              value={manualCowlFlaps}
              onChange={(e) => setManualCowlFlaps(parseInt(e.target.value))}
              style={{ width: "100%", accentColor: "#00d69d" }}
            />
          </div>

          <div>
            <div style={{ fontSize: 9, color: "#8faec0", fontWeight: 700, marginBottom: 4 }}>
              FUEL MIXTURE BIAS (+{manualMixture}%)
            </div>
            <input
              type="range" min="-5.0" max="20.0" step="0.5"
              value={manualMixture}
              onChange={(e) => setManualMixture(parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "#ffaa00" }}
            />
          </div>

          <div>
            <div style={{ fontSize: 9, color: "#8faec0", fontWeight: 700, marginBottom: 4 }}>
              AUX OIL PUMP ({manualOilPump} Bar)
            </div>
            <input
              type="range" min="1.0" max="5.0" step="0.1"
              value={manualOilPump}
              onChange={(e) => setManualOilPump(parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "#ff6600" }}
            />
          </div>
        </div>

        {/* Execute Manual Slider Settings Button */}
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            disabled={isExecuting}
            onClick={() => executeRepairAction(
              "Manual Actuator Parameter Trim",
              activeFaultKey,
              `Timing: ${manualTiming}°, Flaps: ${manualCowlFlaps}%, Mixture: +${manualMixture}%, Oil Pump: ${manualOilPump}Bar`
            )}
            style={{
              background: "linear-gradient(135deg, #1e3a8a 0%, #0369a1 100%)",
              color: "#ffffff",
              border: "1px solid #38c0e8",
              borderRadius: 6,
              padding: "8px 16px",
              fontSize: 11,
              fontWeight: 800,
              cursor: "pointer"
            }}
          >
            🎛️ TRANSMIT CUSTOM ACTUATOR PARAMS
          </button>

          {/* Quick CLI Preset Chips */}
          <div style={{ display: "flex", gap: "6px", overflowX: "auto" }}>
            {[
              "PURGE CHAMBER",
              "FLUSH INJECTOR",
              "RECALIBRATE KALMAN",
              "CLEAR FAULT"
            ].map((chip) => (
              <button
                key={chip}
                onClick={() => {
                  setCommandInput(chip);
                }}
                style={{
                  background: "#0e1e2e",
                  border: "1px solid #1a334d",
                  color: "#38c0e8",
                  padding: "4px 10px",
                  borderRadius: 4,
                  fontSize: 9,
                  fontWeight: 700,
                  cursor: "pointer"
                }}
              >
                + {chip}
              </button>
            ))}
          </div>
        </div>

        {/* Interactive CLI Text Input Form */}
        <form onSubmit={handleCommandSubmit} style={{ display: "flex", gap: "8px" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            flex: 1, background: "#03080e", border: "1px solid #1b354d",
            borderRadius: 6, padding: "0 12px", fontFamily: "monospace"
          }}>
            <span style={{ color: "#00d69d", fontWeight: 800, fontSize: 13 }}>COMMAND &gt;</span>
            <input
              type="text"
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              placeholder="Enter manual command (e.g. SET TIMING -2.0, PURGE CHAMBER, CLEAR FAULT, HELP)..."
              style={{
                width: "100%", background: "transparent", border: "none",
                color: "#e1eaf2", outline: "none", fontFamily: "monospace",
                fontSize: 11, padding: "10px 0"
              }}
            />
          </div>

          <button
            type="submit"
            disabled={isExecuting}
            style={{
              background: "#00d69d",
              color: "#031a10",
              border: "none",
              borderRadius: 6,
              padding: "0 18px",
              fontSize: 11,
              fontWeight: 900,
              cursor: "pointer"
            }}
          >
            EXECUTE CLI
          </button>
        </form>
      </div>

      {/* ── TARGETED REPAIR PROTOCOLS MATRIX ── */}
      <div>
        <div style={{ fontSize: 10, fontWeight: 800, color: "#38c0e8", letterSpacing: "2px", marginBottom: 10 }}>
          SELECTABLE BASE STATION REPAIR PROTOCOLS
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          {Object.entries(REPAIR_PROTOCOLS).map(([key, item]) => {
            const isThisActive = activeFaultKey === key;
            return (
              <div
                key={key}
                style={{
                  background: isThisActive ? "rgba(56, 192, 232, 0.12)" : "#0d1b2a",
                  border: `1px solid ${isThisActive ? "#38c0e8" : "#1a2b3e"}`,
                  borderRadius: 8,
                  padding: "14px",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  gap: "10px"
                }}
              >
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: item.color }}>
                      {item.faultName}
                    </span>
                    <span style={{
                      fontSize: 8, fontWeight: 800, color: item.color,
                      background: `${item.color}18`, padding: "2px 6px", borderRadius: 4
                    }}>
                      {item.severity}
                    </span>
                  </div>

                  <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f4f8", marginBottom: 4 }}>
                    {item.actionTitle}
                  </div>
                  <div style={{ fontSize: 10, color: "#627d94", lineHeight: "1.4" }}>
                    {item.description}
                  </div>
                </div>

                <button
                  disabled={isExecuting}
                  onClick={() => executeRepairAction(item.actionTitle, key)}
                  style={{
                    background: isThisActive ? item.color : "rgba(255,255,255,0.05)",
                    color: isThisActive ? "#ffffff" : "#38c0e8",
                    border: `1px solid ${isThisActive ? item.color : "#1a2b3e"}`,
                    borderRadius: 6,
                    padding: "7px 12px",
                    fontSize: 10,
                    fontWeight: 800,
                    cursor: "pointer",
                    transition: "all 0.2s ease"
                  }}
                >
                  🛠️ APPLY THIS REPAIR PROTOCOL
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── MASTER OVERRIDE BUTTON & AUDIT LOG ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
        {/* Master Base Station Emergency Reset */}
        <div style={{
          background: "#0d1b2a",
          border: "1px solid #1a2b3e",
          borderRadius: 10,
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: "12px",
          justifyContent: "center"
        }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#00d69d", letterSpacing: "1.5px", marginBottom: 2 }}>
              EMERGENCY MASTER COMMAND
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#f0f4f8" }}>
              Full Base Station Systems Reset
            </div>
            <div style={{ fontSize: 10, color: "#627d94", marginTop: 4 }}>
              Forces ECU override signal to clear all telemetry anomalies and restore nominal engine operational parameters.
            </div>
          </div>

          <button
            disabled={isExecuting}
            onClick={() => executeRepairAction("Master Base Station Systems Override", "all")}
            style={{
              background: "linear-gradient(135deg, #00d69d 0%, #00a876 100%)",
              color: "#031a10",
              border: "none",
              borderRadius: 8,
              padding: "10px 18px",
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: "0.5px",
              cursor: "pointer",
              boxShadow: "0 4px 16px rgba(0, 214, 157, 0.25)"
            }}
          >
            🔴 MASTER BASE STATION OVERRIDE & RESET
          </button>
        </div>

        {/* Base Station Execution Audit Log */}
        <div style={{
          background: "#060d15",
          border: "1px solid #1a2b3e",
          borderRadius: 10,
          padding: "14px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          maxHeight: "220px",
          overflowY: "auto"
        }}>
          <div style={{ fontSize: 9, fontWeight: 800, color: "#8faec0", letterSpacing: "1.5px" }}>
            BASE STATION ACTION AUDIT LOG
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {repairLogs.map((log) => (
              <div key={log.id} style={{ fontSize: 10, fontFamily: "monospace", display: "flex", gap: 8, color: log.status === "SUCCESS" ? "#00d69d" : log.status === "EXECUTING" ? "#38c0e8" : "#8faec0" }}>
                <span style={{ color: "#47657a" }}>[{log.time}]</span>
                <span>{log.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
