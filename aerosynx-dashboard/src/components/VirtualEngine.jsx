import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";

/**
 * VirtualEngine
 *
 * 3D visualization + telemetry engine.
 *
 * DATA FLOW:
 *
 * LIVE HARDWARE / MOCK DATA
 *          ↓
 *    telemetry object
 *          ↓
 *     Fault Injection
 *          ↓
 *     Virtual Engine
 *          ↓
 *     Render API
 *          ↓
 * Prediction Dashboard
 */

// ==========================================================
// RENDER TELEMETRY API
// ==========================================================

const TELEMETRY_API =
  "http://localhost:5000/api/telemetry";

const TELEMETRY_SEND_INTERVAL = 200;

// ==========================================================
// REFERENCE RANGES
// ==========================================================

const BASELINE = {
  rpm: [4800, 5300],
  cht_c: [95, 125],
  egt_c: [620, 720],
  oil_press_bar: [2.5, 4.2],
  oil_temp_c: [85, 105],
  fuel_flow_lph: [14, 18],
  vibration_g: [0.05, 0.15],
  battery_v: [13.8, 14.4],
  injection_deg: [20, 25],
};

// ==========================================================
// FAULT TYPES
// ==========================================================

const FAULT_TYPES = [
  { id: "none", label: "Normal" },
  { id: "misfire", label: "Misfire" },
  { id: "injector_abnormality", label: "Injector Fault" },
  { id: "coking", label: "Coking / Degradation" },
  { id: "lubrication", label: "Lubrication" },
  { id: "sensor_drift", label: "Sensor Drift" },
  {
    id: "combustion_instability",
    label: "Combustion Instability",
  },
  { id: "overheating", label: "Overheating" },
  { id: "abnormal_vibration", label: "Abnormal Vibration" },
  {
    id: "battery_alternator_health",
    label: "Battery / Alternator",
  },
];

// ==========================================================
// MISSION PROFILES
// ==========================================================

const MISSION_PROFILES = [
  { id: "normal_cruise", label: "Normal Cruise" },
  { id: "high_altitude", label: "High Altitude" },
  { id: "hot_weather", label: "Hot Weather" },
  { id: "rapid_throttle", label: "Rapid Throttle" },
];

// ==========================================================
// HARDWARE DATA SOURCE
// ==========================================================

const DEFAULT_HARDWARE_MODE = "mock";

const WS_URL = "ws://esp32-sensor.local:81";

// ==========================================================
// HARDWARE FIELD CONFIG
// ==========================================================

const HARDWARE_FIELD_CONFIG = {
  vibration_g: {
    available: true,
    sensor: "MPU6050 (accelerometer, high-frequency component)",
  },
  roll_deg: {
    available: true,
    sensor: "MPU6050 (accelerometer, tilt/gravity vector)",
  },
  pitch_deg: {
    available: true,
    sensor: "MPU6050 (accelerometer, tilt/gravity vector)",
  },
  yaw_deg: {
    available: true,
    sensor:
      "MPU6050 (gyroscope, integrated -- drifts over time, no magnetometer to correct it)",
  },
  rpm: {
    available: true,
    sensor: "IR Wide Optical Slot Sensor (pulse counting on a slotted disc)",
  },
  cht_c: {
    available: true,
    sensor: "LM35 (analog temperature sensor)",
  },
};

const HARDWARE_FIELDS = Object.entries(HARDWARE_FIELD_CONFIG)
  .filter(([, cfg]) => cfg.available)
  .map(([field]) => field);

// ==========================================================
// RAW HARDWARE -> REALISTIC UAV RANGE MAPPING
// ==========================================================

const RAW_HARDWARE_RANGE = {
  rpm: [0, 9000],
  cht_c: [10, 300],
  vibration_g: [0.0306, 1.13],
};

const MAPPED_TARGET_RANGE = {
  rpm: [0, 5500],
  cht_c: [95, 150],
  vibration_g: [0.05, 0.3],
};

const RAW_TO_REALISTIC_FIELDS = [
  "rpm",
  "cht_c",
  "vibration_g",
];

function mapRawToRealistic(value, rawRange, targetRange) {
  const [rawLo, rawHi] = rawRange;
  const [targetLo, targetHi] = targetRange;

  if (typeof value !== "number" || Number.isNaN(value)) {
    return targetLo;
  }

  const clamped = Math.max(rawLo, Math.min(rawHi, value));

  const t =
    rawHi - rawLo === 0
      ? 0
      : (clamped - rawLo) / (rawHi - rawLo);

  return targetLo + t * (targetHi - targetLo);
}

function toFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
  }

  return null;
}

function pickNumberFromPacket(msg, keys) {
  if (!msg || typeof msg !== "object") {
    return null;
  }

  const layers = [
    msg,
    msg.reading,
    msg.data,
    msg.telemetry,
    msg.sensors,
  ].filter((layer) => layer && typeof layer === "object");

  for (const layer of layers) {
    for (const key of keys) {
      const n = toFiniteNumber(layer[key]);
      if (n !== null) {
        return n;
      }
    }
  }

  return null;
}

// ==========================================================
// DESIGN COLORS
// ==========================================================

const COLORS = {
  bg: "#06090e",
  panel: "#0f151d",
  panelBorder: "rgba(255, 255, 255, 0.08)",
  panelBorderLit: "rgba(234, 179, 8, 0.35)",
  textPrimary: "#f8fafc",
  textMuted: "#94a3b8",
  cyan: "#38bdf8",
  violet: "#a855f7",
  green: "#22c55e",
  amber: "#eab308",
  red: "#ef4444",
  gold: "#eab308",
};

// ==========================================================
// HELPERS
// ==========================================================

function randIn([lo, hi]) {
  return lo + Math.random() * (hi - lo);
}

function gaussianNoise() {
  const u1 = Math.random() || 1e-6;
  const u2 = Math.random();

  return (
    Math.sqrt(-2 * Math.log(u1)) *
    Math.cos(2 * Math.PI * u2)
  );
}

function baseReading() {
  const r = {};

  for (const [k, band] of Object.entries(BASELINE)) {
    r[k] = randIn(band);
  }

  return r;
}

// ==========================================================
// MISSION PROFILE
// ==========================================================

function applyMissionProfile(r, profile) {
  switch (profile) {
    case "high_altitude":
      r.cht_c += 12;
      r.egt_c += 20;
      r.oil_press_bar -= 0.3;
      break;

    case "hot_weather":
      r.cht_c += 15;
      r.oil_temp_c += 12;
      break;

    case "rapid_throttle":
      r.rpm += gaussianNoise() * 250;
      r.vibration_g += Math.abs(
        gaussianNoise() * 0.08
      );
      break;

    default:
      break;
  }

  return r;
}

// ==========================================================
// FINAL FAULT TELEMETRY
//
// IMPORTANT:
// This function is deliberately applied AFTER:
//
// 1. Base simulation
// 2. Mission profile
// 3. Hardware/mock data
// 4. Raw hardware -> realistic mapping
//
// Therefore these values are FINAL.
//
// This guarantees that, for example, Misfire RPM can NEVER
// be overwritten by the hardware mapping afterward.
// ==========================================================

function applyFinalFaultTelemetry(r, fault) {
  switch (fault) {
    // ======================================================
    // MISFIRE
    // ======================================================

    case "misfire":
      r.rpm = randIn([4400, 4750]);
      r.cht_c = randIn([100, 135]);
      r.egt_c = randIn([540, 620]);
      r.vibration_g = randIn([0.18, 0.40]);
      break;

    // ======================================================
    // INJECTOR ABNORMALITY
    // ======================================================

    case "injector_abnormality":
      r.rpm = randIn([4650, 5150]);
      r.fuel_flow_lph = randIn([9, 13]);
      r.egt_c = randIn([730, 820]);
      r.vibration_g = randIn([0.12, 0.25]);
      break;

    // ======================================================
    // COKING / DEGRADATION
    // ======================================================

    case "coking":
      r.cht_c = randIn([130, 165]);
      r.egt_c = randIn([730, 820]);
      r.oil_temp_c = randIn([105, 125]);
      r.fuel_flow_lph = randIn([17, 21]);
      r.vibration_g = randIn([0.10, 0.20]);
      break;

    // ======================================================
    // LUBRICATION ISSUE
    // ======================================================

    case "lubrication":
      r.oil_press_bar = randIn([0.8, 2.2]);
      r.oil_temp_c = randIn([110, 145]);
      r.vibration_g = randIn([0.14, 0.30]);
      r.cht_c = randIn([110, 145]);
      break;

    // ======================================================
    // SENSOR DRIFT
    // ======================================================

    case "sensor_drift":
      r.cht_c = randIn([140, 175]);
      break;

    // ======================================================
    // COMBUSTION INSTABILITY
    // ======================================================

    case "combustion_instability":
      r.rpm = randIn([4350, 5550]);
      r.egt_c = randIn([550, 850]);
      r.vibration_g = randIn([0.20, 0.45]);
      r.fuel_flow_lph = randIn([12, 21]);
      break;

    // ======================================================
    // OVERHEATING
    // ======================================================

    case "overheating":
      r.cht_c = randIn([135, 170]);
      r.egt_c = randIn([730, 830]);
      r.oil_temp_c = randIn([108, 135]);
      r.vibration_g = randIn([0.10, 0.22]);
      break;

    // ======================================================
    // ABNORMAL VIBRATION
    // ======================================================

    case "abnormal_vibration":
      r.vibration_g = randIn([0.20, 0.50]);
      r.rpm = randIn([4550, 5450]);
      r.cht_c = randIn([100, 135]);
      r.egt_c = randIn([610, 750]);
      break;

    // ======================================================
    // BATTERY / ALTERNATOR HEALTH
    // ======================================================

    case "battery_alternator_health":
      r.battery_v = randIn([11.5, 13.2]);
      r.vibration_g = randIn([0.06, 0.18]);
      break;

    default:
      break;
  }

  return r;
}

// ==========================================================
// NORMALIZE
// ==========================================================

function normalize(val, [lo, hi]) {
  return Math.max(
    0,
    Math.min(1, (val - lo) / (hi - lo))
  );
}

// ==========================================================
// RANDOM WALK
// ==========================================================

function stepWalk(prev, band, stepScale = 0.06) {
  const [lo, hi] = band;
  const range = hi - lo;

  const next =
    prev +
    (Math.random() - 0.5) *
    range *
    stepScale;

  return Math.max(
    lo - range * 0.15,
    Math.min(hi + range * 0.15, next)
  );
}

// ==========================================================
// ACCELEROMETER HELPERS
// ==========================================================

function computeTiltFromAccel(ax, ay, az) {
  const roll_deg =
    (Math.atan2(ay, az) * 180) / Math.PI;

  const pitch_deg =
    (Math.atan2(
      -ax,
      Math.sqrt(ay * ay + az * az)
    ) *
      180) /
    Math.PI;

  return {
    roll_deg,
    pitch_deg,
  };
}

function computeVibrationFromAccelBuffer(
  accelSamples
) {
  if (!accelSamples.length) return 0;

  const magnitudes = accelSamples.map(
    ({ ax, ay, az }) =>
      Math.sqrt(
        ax * ax +
        ay * ay +
        az * az
      )
  );

  const withoutGravity = magnitudes.map(
    (m) => Math.abs(m - 1.0)
  );

  const mean =
    withoutGravity.reduce(
      (a, b) => a + b,
      0
    ) / withoutGravity.length;

  return mean;
}

// ==========================================================
// COLOR INTERPOLATION
// ==========================================================

function lerpColor(c1, c2, t) {
  const a = new THREE.Color(c1);
  const b = new THREE.Color(c2);

  return a.lerp(
    b,
    Math.max(0, Math.min(1, t))
  );
}

// ==========================================================
// SEND TELEMETRY TO RENDER
// ==========================================================

async function sendTelemetryToServer(
  telemetry,
  metadata = {}
) {
  try {
    const payload = {
      ...telemetry,

      data_source:
        metadata.data_source ||
        "unknown",

      fault:
        metadata.fault ||
        "none",

      mission_profile:
        metadata.mission_profile ||
        "normal_cruise",

      anomaly_score:
        typeof metadata.anomaly_score ===
          "number"
          ? Number(
            metadata.anomaly_score.toFixed(
              4
            )
          )
          : 0,

      status:
        metadata.status ||
        "Normal",

      timestamp:
        new Date().toISOString(),
    };

    const response = await fetch(
      TELEMETRY_API,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      console.error(
        "Telemetry API error:",
        response.status
      );
    }
  } catch (error) {
    console.error(
      "Could not send telemetry to Render:",
      error
    );
  }
}

// ==========================================================
// MAIN COMPONENT
// ==========================================================

export default function VirtualEngine({ externalFault, onTelemetryUpdate, onFaultChange, externalMission, onMissionChange }) {
  const mountRef = useRef(null);

  const threeRef = useRef({});

  const simRef = useRef({
    activeFault: "none",
    missionProfile: "normal_cruise",
    faultStartTime: null,
    anomalyScore: 0,
    scoreHistory: [],
    reading: baseReading(),
  });

  // ========================================================
  // RAW HARDWARE VALUES
  // These are kept completely separate from the mapped
  // telemetry values shown in the main telemetry panel.
  // ========================================================

  const hardwareRef = useRef({
    rpm: randIn(BASELINE.rpm),
    vibration_g: randIn(
      BASELINE.vibration_g
    ),
    cht_c: randIn(BASELINE.cht_c),

    roll_deg: 0,
    pitch_deg: 0,
    yaw_deg: 0,
  });

  const accelBufferRef = useRef([]);

  const [hardwareMode, setHardwareMode] =
    useState(
      DEFAULT_HARDWARE_MODE
    );

  const hardwareModeRef = useRef(hardwareMode);

  useEffect(() => {
    hardwareModeRef.current = hardwareMode;
  }, [hardwareMode]);

  const [
    dataSourceStatus,
    setDataSourceStatus,
  ] = useState(
    DEFAULT_HARDWARE_MODE === "mock"
      ? "Mock hardware (manual mock mode)"
      : "Connecting to ESP32..."
  );

  const [telemetry, setTelemetry] =
    useState(
      simRef.current.reading
    );

  const [anomalyScore, setAnomalyScore] =
    useState(0);

  const [status, setStatus] =
    useState("Normal");

  const [reliability, setReliability] =
    useState(
      "Stable, no degradation trend detected"
    );

  const [activeFault, setActiveFault] =
    useState("none");

  const [missionProfile, setMissionProfile] =
    useState("normal_cruise");

  const [paused, setPaused] =
    useState(false);

  const [soundOn, setSoundOn] =
    useState(false);

  const [engineRunning, setEngineRunning] =
    useState(true);

  const engineRunningRef = useRef(true);

  useEffect(() => {
    engineRunningRef.current = engineRunning;
  }, [engineRunning]);

  const [showSIHGuide, setShowSIHGuide] =
    useState(false);

  const toggleEngineKillSwitch = useCallback(() => {
    setEngineRunning((prev) => {
      const nextState = !prev;
      engineRunningRef.current = nextState;
      if (threeRef.current && threeRef.current.latest) {
        threeRef.current.latest.engineRunning = nextState;
      }
      return nextState;
    });
  }, []);

  const soundOnRef = useRef(false);
  const audioReadyRef = useRef(false); // tracks if AudioContext was created

  useEffect(() => {
    soundOnRef.current =
      soundOn;
  }, [soundOn]);

  const audioRef = useRef({});

  // ========================================================
  // AUDIO
  // ========================================================

  const initAudio = useCallback(() => {
    if (audioRef.current.ctx) return;

    const ctx =
      new (window.AudioContext ||
        window.webkitAudioContext)();

    const engineOsc =
      ctx.createOscillator();

    engineOsc.type = "sawtooth";

    const subOsc =
      ctx.createOscillator();

    subOsc.type = "square";

    const filter =
      ctx.createBiquadFilter();

    filter.type = "lowpass";
    filter.frequency.value = 400;

    const engineGain =
      ctx.createGain();

    engineGain.gain.value =
      0.0001;

    engineOsc.connect(filter);
    subOsc.connect(filter);

    filter.connect(engineGain);
    engineGain.connect(
      ctx.destination
    );

    engineOsc.start();
    subOsc.start();

    const alertOsc =
      ctx.createOscillator();

    alertOsc.type = "sine";
    alertOsc.frequency.value = 880;

    const alertGain =
      ctx.createGain();

    alertGain.gain.value = 0;

    alertOsc.connect(alertGain);

    alertGain.connect(
      ctx.destination
    );

    alertOsc.start();

    audioRef.current = {
      ctx,
      engineOsc,
      subOsc,
      filter,
      engineGain,
      alertOsc,
      alertGain,
      beepPhase: 0,
    };
  }, []);

  // ========================================================
  // TOGGLE SOUND
  // Browser requires a user gesture before AudioContext can play.
  // initAudio() is called on the first click anywhere, OR when toggling.
  // ========================================================

  const toggleSound = useCallback(() => {
    initAudio();
    audioReadyRef.current = true;

    const a = audioRef.current;
    if (a.ctx?.state === "suspended") a.ctx.resume();

    setSoundOn(prev => {
      const nextOn = !prev;
      soundOnRef.current = nextOn;
      if (a.engineGain && a.ctx) {
        a.engineGain.gain.cancelScheduledValues(a.ctx.currentTime);
        a.engineGain.gain.setTargetAtTime(
          nextOn ? 0.12 : 0.0001,
          a.ctx.currentTime,
          0.12
        );
      }
      return nextOn;
    });
  }, [initAudio]);

  // NOTE: AudioContext is intentionally NOT initialised on first gesture.
  // It is created only when the user explicitly clicks the sound toggle button.
  // This prevents the browser from showing the "Access other apps and services"
  // permission prompt on page load.

  // ========================================================
  // FAULT SELECTION
  // ========================================================

  const setFault =
    useCallback((id) => {
      simRef.current.activeFault =
        id;

      simRef.current.faultStartTime =
        id === "none"
          ? null
          : Date.now();

      if (id === "none") {
        simRef.current.anomalyScore = 0;
        simRef.current.scoreHistory =
          [];
      }

      if (onFaultChange) {
        onFaultChange(id);
      }

      setActiveFault(id);
    }, [onFaultChange]);

  useEffect(() => {
    if (externalFault && externalFault !== simRef.current.activeFault) {
      setFault(externalFault);
    }
  }, [externalFault, setFault]);


  // ========================================================
  // MISSION SELECTION
  // ========================================================

  const setMission =
    useCallback((id) => {
      simRef.current.missionProfile =
        id;

      if (onMissionChange) {
         onMissionChange(id);
      }
      setMissionProfile(id);
    }, [onMissionChange]);

  useEffect(() => {
    if (externalMission && externalMission !== simRef.current.missionProfile) {
      setMission(externalMission);
    }
  }, [externalMission, setMission]);


  // ========================================================
  // HARDWARE DATA SOURCE
  // ========================================================

  useEffect(() => {
    if (hardwareMode === "mock") {
      setDataSourceStatus(
        "Mock hardware (manual mock mode)"
      );

      const walk =
        setInterval(() => {
          const h =
            hardwareRef.current;

          h.rpm = stepWalk(
            h.rpm,
            BASELINE.rpm
          );

          h.vibration_g =
            Math.max(
              0,
              stepWalk(
                h.vibration_g,
                BASELINE.vibration_g,
                0.15
              )
            );

          h.cht_c = stepWalk(
            h.cht_c,
            BASELINE.cht_c
          );

          h.roll_deg =
            Math.max(
              -25,
              Math.min(
                25,
                h.roll_deg +
                (Math.random() -
                  0.5) *
                2
              )
            );

          h.pitch_deg =
            Math.max(
              -25,
              Math.min(
                25,
                h.pitch_deg +
                (Math.random() -
                  0.5) *
                2
              )
            );

          h.yaw_deg =
            (h.yaw_deg +
              (Math.random() -
                0.5) *
              3 +
              360) %
            360;
        }, 200);

      return () =>
        clearInterval(walk);
    }

    let ws;
    let reconnectTimer;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;

      setDataSourceStatus(
        "Connecting to ESP32..."
      );

      try {
        ws = new WebSocket(
          WS_URL
        );

        ws.onopen = () => {
          setDataSourceStatus(
            "Live -- ESP32 connected"
          );
        };

        ws.onmessage = (
          evt
        ) => {
          try {
            const msg =
              JSON.parse(
                evt.data
              );

            const parsedRpm = pickNumberFromPacket(
              msg,
              ["rpm", "RPM", "engine_rpm", "engineRpm"]
            );
            if (parsedRpm !== null) {
              hardwareRef.current.rpm = parsedRpm;
            }

            for (const field of HARDWARE_FIELDS) {
              if (field === "rpm") {
                continue;
              }

              const parsed = pickNumberFromPacket(msg, [field]);
              if (parsed !== null) {
                hardwareRef.current[field] = parsed;
              }
            }

            if (
              typeof msg.ax ===
              "number" &&
              typeof msg.ay ===
              "number" &&
              typeof msg.az ===
              "number"
            ) {
              accelBufferRef.current.push(
                {
                  ax: msg.ax,
                  ay: msg.ay,
                  az: msg.az,
                }
              );

              if (
                accelBufferRef
                  .current
                  .length > 20
              ) {
                accelBufferRef.current.shift();
              }

              const tilt =
                computeTiltFromAccel(
                  msg.ax,
                  msg.ay,
                  msg.az
                );

              if (
                !HARDWARE_FIELD_CONFIG
                  .roll_deg
                  .available
              ) {
                hardwareRef.current.roll_deg =
                  tilt.roll_deg;
              }

              if (
                !HARDWARE_FIELD_CONFIG
                  .pitch_deg
                  .available
              ) {
                hardwareRef.current.pitch_deg =
                  tilt.pitch_deg;
              }

              if (
                !HARDWARE_FIELD_CONFIG
                  .vibration_g
                  .available
              ) {
                hardwareRef.current.vibration_g =
                  computeVibrationFromAccelBuffer(
                    accelBufferRef.current
                  );
              }
            }
          } catch {
            // Ignore malformed packets
          }
        };

        ws.onclose = () => {
          if (cancelled) return;

          setDataSourceStatus(
            "Signal lost -- reconnecting... (showing last known values)"
          );

          reconnectTimer =
            setTimeout(
              connect,
              1500
            );
        };

        ws.onerror = () => {
          if (ws) {
            ws.close();
          }
        };
      } catch {
        setDataSourceStatus(
          "ESP32 connection failed -- retrying..."
        );

        reconnectTimer =
          setTimeout(
            connect,
            1500
          );
      }
    };

    connect();

    return () => {
      cancelled = true;

      clearTimeout(
        reconnectTimer
      );

      if (ws) {
        ws.close();
      }
    };
  }, [hardwareMode]);

  // ========================================================
  // SIMULATION + TELEMETRY TRANSMISSION
  // ========================================================

  useEffect(() => {
    if (paused) return;

    const interval =
      setInterval(() => {
        const s =
          simRef.current;

        let r;
        let score = 0;
        let reliabilityText = "Stable, no degradation trend detected";
        let newStatus = "Normal";

        if (!engineRunningRef.current) {
          r = {
            rpm: 0,
            cht_c: 25,
            egt_c: 25,
            oil_press_bar: 0,
            oil_temp_c: 25,
            fuel_flow_lph: 0,
            vibration_g: 0,
            battery_v: 12.0,
            injection_deg: 0,
            roll_deg: hardwareMode === "live" ? (hardwareRef.current.roll_deg || 0) : 0,
            pitch_deg: hardwareMode === "live" ? (hardwareRef.current.pitch_deg || 0) : 0,
            yaw_deg: hardwareMode === "live" ? (hardwareRef.current.yaw_deg || 0) : 0,
          };
          s.anomalyScore = 0;
          score = 0;
          reliabilityText = "Engine Off — Ignition cut by Kill Switch";
          newStatus = "Killed";
        } else {
          // --------------------------------------------------
          // BASE SIMULATION
          // --------------------------------------------------

          r = baseReading();

          // --------------------------------------------------
          // MISSION PROFILE
          // --------------------------------------------------

          r = applyMissionProfile(
            r,
            s.missionProfile
          );

          // --------------------------------------------------
          // HARDWARE / MOCK DATA
          // --------------------------------------------------

          for (const field of HARDWARE_FIELDS) {
            if (
              hardwareMode ===
              "live" &&
              RAW_TO_REALISTIC_FIELDS.includes(
                field
              )
            ) {
              r[field] =
                mapRawToRealistic(
                  hardwareRef
                    .current[
                  field
                  ],
                  RAW_HARDWARE_RANGE[
                  field
                  ],
                  MAPPED_TARGET_RANGE[
                  field
                  ]
                );
            } else {
              r[field] =
                hardwareRef.current[
                field
                ];
            }
          }

          // --------------------------------------------------
          // FINAL FAULT INJECTION
          // --------------------------------------------------

          r =
            applyFinalFaultTelemetry(
              r,
              s.activeFault
            );

          // --------------------------------------------------
          // ANOMALY SCORE
          // --------------------------------------------------

          let target = 0;

          if (
            s.activeFault !==
            "none"
          ) {
            const egtMid =
              (BASELINE.egt_c[0] +
                BASELINE.egt_c[1]) /
              2;

            const vibMid =
              (BASELINE.vibration_g[0] +
                BASELINE.vibration_g[1]) /
              2;

            const egtDev =
              Math.abs(
                r.egt_c -
                egtMid
              ) / 100;

            const vibDev =
              Math.abs(
                r.vibration_g -
                vibMid
              ) / 0.3;

            target =
              Math.min(
                1,
                (egtDev +
                  vibDev) /
                2
              );
          }

          s.anomalyScore +=
            (target -
              s.anomalyScore) *
            0.15;

          score =
            Math.max(
              0,
              Math.min(
                1,
                s.anomalyScore
              )
            );

          // --------------------------------------------------
          // SCORE HISTORY
          // --------------------------------------------------

          const now =
            Date.now();

          s.scoreHistory.push({
            t: now,
            score,
          });

          while (
            s.scoreHistory.length &&
            now -
            s.scoreHistory[0]
              .t >
            4000
          ) {
            s.scoreHistory.shift();
          }

          // --------------------------------------------------
          // RELIABILITY
          // --------------------------------------------------

          if (score >= 0.95) {
            reliabilityText =
              "Critical -- immediate attention";
          } else if (
            score >= 0.15 &&
            s.scoreHistory.length >
            1
          ) {
            const t0 =
              s.scoreHistory[0]
                .t;

            const xs =
              s.scoreHistory.map(
                (p) =>
                  (p.t - t0) /
                  1000
              );

            const ys =
              s.scoreHistory.map(
                (p) =>
                  p.score
              );

            const n =
              xs.length;

            const mx =
              xs.reduce(
                (a, b) =>
                  a + b,
                0
              ) / n;

            const my =
              ys.reduce(
                (a, b) =>
                  a + b,
                0
              ) / n;

            let num = 0;
            let den = 0;

            for (
              let i = 0;
              i < n;
              i++
            ) {
              num +=
                (xs[i] - mx) *
                (ys[i] - my);

              den +=
                (xs[i] - mx) **
                2;
            }

            const rate =
              den > 0
                ? num / den
                : 0;

            if (
              rate > 0.01 &&
              (now - t0) /
              1000 >=
              2.5
            ) {
              const remaining =
                (0.95 - score) /
                rate;

              if (
                remaining >=
                0 &&
                remaining <=
                3600
              ) {
                reliabilityText =
                  remaining < 60
                    ? "Estimated <1 min to critical threshold at current degradation rate"
                    : `Estimated ~${Math.round(
                      remaining /
                      60
                    )} min to critical threshold at current degradation rate`;
              }
            }
          }

          // --------------------------------------------------
          // STATUS
          // --------------------------------------------------

          newStatus =
            score < 0.3
              ? "Normal"
              : score < 0.65
                ? "Warning"
                : "Critical";
        }

        // --------------------------------------------------
        // SAVE READING
        // --------------------------------------------------

        s.reading = r;

        threeRef.current.latest =
        {
          reading: r,
          score,
          fault:
            s.activeFault,
          mission:
            s.missionProfile,
          engineRunning:
            engineRunningRef.current,
        };

        setTelemetry({
          ...r,
        });

        setAnomalyScore(
          score
        );

        setStatus(
          newStatus
        );

        setReliability(
          reliabilityText
        );

        // --------------------------------------------------
        // SEND FINAL TELEMETRY TO RENDER
        // --------------------------------------------------

        sendTelemetryToServer(
          r,
          {
            data_source:
              hardwareMode ===
                "live"
                ? "live_hardware"
                : "mock_data",

            fault:
              s.activeFault,

            mission_profile:
              s.missionProfile,

            anomaly_score:
              score,

            status:
              newStatus,
          }
        );

        if (onTelemetryUpdate) {
            onTelemetryUpdate({
                reading: r,
                score,
                fault: s.activeFault,
                mission: s.missionProfile,
                status: newStatus,
                reliability: reliabilityText,
                dataSource: hardwareMode === "live" ? "live_hardware" : "mock_data"
            });
        }

        // --------------------------------------------------
        // AUDIO
        // --------------------------------------------------

        const a =
          audioRef.current;

        if (
          a.ctx &&
          soundOnRef.current
        ) {
          const t0 =
            a.ctx.currentTime;

          if (!engineRunningRef.current) {
            a.engineGain.gain.setTargetAtTime(
              0,
              t0,
              0.05
            );

            a.alertGain.gain.setTargetAtTime(
              0,
              t0,
              0.05
            );
          } else {
            const rpmFrac =
              r.rpm / 5500;

            // Base frequency: 55Hz at idle up to 160Hz at max RPM
            const baseFreq =
              55 +
              rpmFrac * 105;

            a.engineOsc.frequency.setTargetAtTime(
              baseFreq,
              t0,
              0.08
            );

            a.subOsc.frequency.setTargetAtTime(
              baseFreq * 1.5,
              t0,
              0.08
            );

            a.filter.frequency.setTargetAtTime(
              500 +
              r.vibration_g *
              3500,
              t0,
              0.1
            );

            // Gain: 0.12 base + vibration bump, clearly audible
            a.engineGain.gain.setTargetAtTime(
              0.12 +
              Math.min(
                r.vibration_g,
                0.5
              ) *
              0.10,
              t0,
              0.2
            );

            a.beepPhase +=
              0.2;

            const beepRate =
              newStatus ===
                "Critical"
                ? 0.28
                : newStatus ===
                  "Warning"
                  ? 0.65
                  : null;

            const beepOn =
              beepRate &&
              a.beepPhase %
              beepRate <
              0.12;

            a.alertGain.gain.setTargetAtTime(
              beepOn
                ? newStatus ===
                  "Critical"
                  ? 0.06
                  : 0.035
                : 0,
              t0,
              0.02
            );

            a.alertOsc.frequency.setTargetAtTime(
              newStatus ===
                "Critical"
                ? 1046
                : 880,
              t0,
              0.1
            );
          }
        }
      }, TELEMETRY_SEND_INTERVAL);

    return () =>
      clearInterval(
        interval
      );
  }, [
    paused,
    hardwareMode,
  ]);

  // ========================================================
  // THREE.JS SCENE
  // ========================================================

  useEffect(() => {
    const mount =
      mountRef.current;

    if (!mount) return;

    const width =
      mount.clientWidth || window.innerWidth || 800;

    const height =
      mount.clientHeight || window.innerHeight || 600;

    const scene =
      new THREE.Scene();

    scene.background =
      new THREE.Color(
        COLORS.bg
      );

    scene.fog =
      new THREE.Fog(
        COLORS.bg,
        18,
        38
      );

    const camera =
      new THREE.PerspectiveCamera(
        42,
        width / height,
        0.1,
        100
      );

    let camTheta = 0.50;
    let camPhi = 1.20;
    let camRadius = 10.5;

    const updateCamera =
      () => {
        camera.position.set(
          camRadius *
          Math.sin(camPhi) *
          Math.sin(camTheta),

          camRadius *
          Math.cos(camPhi),

          camRadius *
          Math.sin(camPhi) *
          Math.cos(camTheta)
        );

        camera.lookAt(
          0.2,
          0.1,
          0
        );
      };

    updateCamera();

    const renderer =
      new THREE.WebGLRenderer({
        antialias: true,
      });

    renderer.setSize(
      width,
      height
    );
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    renderer.setPixelRatio(
      Math.min(
        window.devicePixelRatio,
        2
      )
    );

    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    mount.appendChild(
      renderer.domElement
    );

    // High-resolution Studio Render Lighting Setup (Exact match to studio photo)
    scene.add(
      new THREE.AmbientLight(0xffffff, 1.35)
    );

    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(7, 10, 6);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xe8f0fb, 1.2);
    fill.position.set(-8, 5, 6);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xffffff, 0.9);
    rim.position.set(0, 8, -7);
    scene.add(rim);



    // ======================================================
    // ======================================================
    // MATERIALS — Exact replica palette from studio reference image
    // ======================================================

    // ======================================================
    // HIGH-CONTRAST VISUAL DETAILING PALETTE
    // Distinct material colors for clear component separation & detailing
    // ======================================================

    // Crankcase main block — Machined Satin Silver Aluminum
    const aluminumMat = new THREE.MeshStandardMaterial({
      color: 0xd0dae2, metalness: 0.90, roughness: 0.18,
    });
    // Cylinder head & structural ribs — Matte Steel / Darker Cast
    const castAlMat = new THREE.MeshStandardMaterial({
      color: 0x8694a0, metalness: 0.78, roughness: 0.32,
    });
    // Fasteners & dark trim — Gunmetal Dark Metallic
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x222a34, metalness: 0.85, roughness: 0.30,
    });
    // Valve cover — Deep Titanium Black with crisp sheen
    const blackMat = new THREE.MeshStandardMaterial({
      color: 0x0f141a, metalness: 0.50, roughness: 0.35,
    });
    // Shared exhaust manifold pipe
    const exhaustMat = new THREE.MeshStandardMaterial({
      color: 0x4a5460, metalness: 0.88, roughness: 0.20,
      emissive: new THREE.Color(0x000000),
    });
    // Hoses / rubber boots — Dark Charcoal Matte
    const hoseMat = new THREE.MeshStandardMaterial({
      color: 0x181d22, metalness: 0.05, roughness: 0.95,
    });
    // Red injection caps — High-Gloss Crimson Red
    const redPortMat = new THREE.MeshStandardMaterial({
      color: 0xff1e1e,
      metalness: 0.25, roughness: 0.15,
      emissive: new THREE.Color(0x770808),
      emissiveIntensity: 0.7,
    });
    // Propeller Blades — Ultra-Gloss White Composite (matches reference photo)
    const propMat = new THREE.MeshStandardMaterial({
      color: 0xf5f8ff, metalness: 0.30, roughness: 0.04,
      envMapIntensity: 1.8,
    });
    // Spinner Cone — High-Reflectivity Chrome / Polished Aluminum
    const spinnerMat = new THREE.MeshStandardMaterial({
      color: 0xe6eef6, metalness: 0.95, roughness: 0.12,
    });
    // Sump pan — Muted Slate Grey
    const sumpMat = new THREE.MeshStandardMaterial({
      color: 0x6e7b88, metalness: 0.70, roughness: 0.40,
      emissive: new THREE.Color(0x000000),
    });
    // Gold / Anodized Brass for Fuel Rails & Injector Lines (High detail visibility)
    const brassFuelMat = new THREE.MeshStandardMaterial({
      color: 0xdfa038, metalness: 0.85, roughness: 0.22,
    });
    // Polished Chrome for Moving Piston Rods & Pins (Ultra high visibility)
    const pistonRodMat = new THREE.MeshStandardMaterial({
      color: 0xf0f4f8, metalness: 0.98, roughness: 0.08,
    });
    const pistonCapMat = new THREE.MeshStandardMaterial({
      color: 0xff3b3b, metalness: 0.40, roughness: 0.15,
    });

    // ======================================================
    // AEROSYNX EXACT 3D GOLD & SILVER METALLIC LOGO EMBLEM
    // Replicates exact uploaded image: 3D Gold reticle ring, brushed silver 'A', gold star, dual gold/silver jet swoosh, silver 'AEROSYN' & 3D Gold 'X'
    // ======================================================
    const createAeroSynxExactTextures = () => {
      // 1. COLOR MAP
      const cvs = document.createElement("canvas");
      cvs.width = 1024;
      cvs.height = 1024;
      const ctx = cvs.getContext("2d");

      // 2. BUMP MAP for physical 3D depth
      const bCvs = document.createElement("canvas");
      bCvs.width = 1024;
      bCvs.height = 1024;
      const bCtx = bCvs.getContext("2d");

      // Background: Dark brushed gunmetal steel disc
      const bgGrad = ctx.createRadialGradient(512, 512, 30, 512, 512, 510);
      bgGrad.addColorStop(0, "#222a36");
      bgGrad.addColorStop(0.65, "#121820");
      bgGrad.addColorStop(1, "#0a0d12");
      ctx.fillStyle = bgGrad;
      ctx.beginPath(); ctx.arc(512, 512, 505, 0, Math.PI * 2); ctx.fill();

      bCtx.fillStyle = "#808080"; // neutral bump baseline
      bCtx.beginPath(); bCtx.arc(512, 512, 505, 0, Math.PI * 2); bCtx.fill();

      // Lathe brushed micro grooves
      ctx.strokeStyle = "rgba(255,255,255,0.035)";
      ctx.lineWidth = 1;
      for (let r = 30; r < 500; r += 5) {
        ctx.beginPath(); ctx.arc(512, 512, r, 0, Math.PI * 2); ctx.stroke();
      }

      // Outer 3D Gold Bevel Ring
      const goldGrad = ctx.createLinearGradient(150, 100, 850, 700);
      goldGrad.addColorStop(0, "#fef08a");
      goldGrad.addColorStop(0.25, "#eab308");
      goldGrad.addColorStop(0.5, "#ca8a04");
      goldGrad.addColorStop(0.75, "#eab308");
      goldGrad.addColorStop(1, "#854d0e");

      ctx.strokeStyle = goldGrad;
      ctx.lineWidth = 20;
      ctx.shadowColor = "rgba(234, 179, 8, 0.5)";
      ctx.shadowBlur = 15;
      ctx.beginPath(); ctx.arc(512, 410, 310, 0, Math.PI * 2); ctx.stroke();

      bCtx.strokeStyle = "#ffffff";
      bCtx.lineWidth = 20;
      bCtx.beginPath(); bCtx.arc(512, 410, 310, 0, Math.PI * 2); bCtx.stroke();

      // Inner Silver Steel Ring
      ctx.shadowBlur = 0;
      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(512, 410, 275, 0, Math.PI * 2); ctx.stroke();

      // Dashed Gold Inner Arc
      ctx.strokeStyle = "#eab308";
      ctx.lineWidth = 4;
      ctx.setLineDash([14, 12]);
      ctx.beginPath(); ctx.arc(512, 410, 250, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);

      // Gold Crosshairs (+)
      ctx.strokeStyle = goldGrad;
      ctx.lineWidth = 6;
      ctx.shadowBlur = 10;
      ctx.shadowColor = "#eab308";
      ctx.beginPath(); ctx.moveTo(512, 70); ctx.lineTo(512, 105); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(512, 715); ctx.lineTo(512, 750); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(170, 410); ctx.lineTo(205, 410); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(819, 410); ctx.lineTo(854, 410); ctx.stroke();

      // 3D Brushed Silver 'A'
      ctx.shadowBlur = 20;
      ctx.shadowColor = "rgba(255,255,255,0.7)";
      const silverGrad = ctx.createLinearGradient(320, 160, 700, 620);
      silverGrad.addColorStop(0, "#ffffff");
      silverGrad.addColorStop(0.3, "#e2e8f0");
      silverGrad.addColorStop(0.65, "#94a3b8");
      silverGrad.addColorStop(1, "#334155");
      ctx.fillStyle = silverGrad;

      ctx.beginPath();
      ctx.moveTo(512, 160);
      ctx.lineTo(280, 580);
      ctx.lineTo(380, 580);
      ctx.lineTo(512, 320);
      ctx.lineTo(644, 580);
      ctx.lineTo(744, 580);
      ctx.closePath();
      ctx.fill();

      bCtx.fillStyle = "#ffffff";
      bCtx.beginPath();
      bCtx.moveTo(512, 160);
      bCtx.lineTo(280, 580);
      bCtx.lineTo(380, 580);
      bCtx.lineTo(512, 320);
      bCtx.lineTo(644, 580);
      bCtx.lineTo(744, 580);
      bCtx.closePath();
      bCtx.fill();

      // Center 3D Gold Star
      ctx.fillStyle = goldGrad;
      ctx.shadowColor = "#eab308";
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.moveTo(512, 375);
      ctx.lineTo(523, 405);
      ctx.lineTo(555, 405);
      ctx.lineTo(529, 422);
      ctx.lineTo(539, 452);
      ctx.lineTo(512, 432);
      ctx.lineTo(485, 452);
      ctx.lineTo(495, 422);
      ctx.lineTo(469, 405);
      ctx.lineTo(501, 405);
      ctx.closePath();
      ctx.fill();

      // Dual Swoosh Arc (Gold Outer + Silver Inner)
      ctx.shadowBlur = 18;
      ctx.shadowColor = "#ca8a04";
      ctx.fillStyle = goldGrad;
      ctx.beginPath();
      ctx.moveTo(200, 560);
      ctx.bezierCurveTo(230, 450, 420, 310, 770, 230);
      ctx.bezierCurveTo(620, 290, 310, 440, 245, 585);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = silverGrad;
      ctx.beginPath();
      ctx.moveTo(225, 555);
      ctx.bezierCurveTo(250, 465, 430, 335, 755, 260);
      ctx.bezierCurveTo(625, 315, 330, 455, 265, 575);
      ctx.closePath();
      ctx.fill();

      // Supersonic 3D Fighter Jet Aircraft
      const jetGrad = ctx.createLinearGradient(660, 300, 840, 190);
      jetGrad.addColorStop(0, "#cbd5e1");
      jetGrad.addColorStop(0.5, "#ffffff");
      jetGrad.addColorStop(1, "#475569");
      ctx.fillStyle = jetGrad;

      ctx.beginPath();
      ctx.moveTo(840, 190);
      ctx.lineTo(775, 315);
      ctx.lineTo(760, 270);
      ctx.lineTo(715, 295);
      ctx.lineTo(740, 255);
      ctx.lineTo(675, 265);
      ctx.closePath();
      ctx.fill();

      // Gold under-wing trim on jet
      ctx.fillStyle = goldGrad;
      ctx.beginPath();
      ctx.moveTo(760, 270);
      ctx.lineTo(775, 315);
      ctx.lineTo(745, 290);
      ctx.closePath();
      ctx.fill();

      // 3D Metallic Text "AEROSYN" (Brushed Silver) + "X" (3D Gold)
      ctx.shadowBlur = 15;
      ctx.shadowColor = "rgba(255,255,255,0.6)";
      ctx.font = "900 90px system-ui, sans-serif";
      ctx.textAlign = "left";

      // Draw AEROSYN in Silver
      ctx.fillStyle = silverGrad;
      ctx.fillText("AEROSYN", 125, 830);

      // Draw X in Gold
      ctx.fillStyle = goldGrad;
      ctx.shadowColor = "#eab308";
      ctx.shadowBlur = 20;
      ctx.fillText("X", 745, 830);

      bCtx.font = "900 90px system-ui, sans-serif";
      bCtx.textAlign = "left";
      bCtx.fillStyle = "#ffffff";
      bCtx.fillText("AEROSYN", 125, 830);
      bCtx.fillText("X", 745, 830);

      const colorTex = new THREE.CanvasTexture(cvs);
      colorTex.colorSpace = THREE.SRGBColorSpace;

      const bumpTex = new THREE.CanvasTexture(bCvs);

      return { colorTex, bumpTex };
    };

    const { colorTex: aeroSynxTexture, bumpTex: aeroSynxBumpTexture } =
      createAeroSynxExactTextures();

    const metallicLogoMat = new THREE.MeshStandardMaterial({
      map: aeroSynxTexture,
      bumpMap: aeroSynxBumpTexture,
      bumpScale: 0.03,
      metalness: 0.80,
      roughness: 0.20,
      opacity: 1.0,
      transparent: false,
      emissive: new THREE.Color(0x222222),
    });

    const coilMats = []; // red port materials for RPM pulsing

    // ======================================================
    // ENGINE GROUP  (engine axis = X, prop on RIGHT = +X side)
    // ======================================================

    const engine = new THREE.Group();
    scene.add(engine);
    engine.position.set(0.2, 0.3, 0);

    // ======================================================
    // CRANKCASE BODY — long horizontal rectangular block
    // ======================================================

    const crankcase = new THREE.Mesh(
      new THREE.BoxGeometry(4.0, 0.80, 1.50),
      aluminumMat
    );
    crankcase.position.set(0.3, 0, 0);
    engine.add(crankcase);

    // Front conical nose housing tapering down toward propeller (Exact replica of photo)
    const noseHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.85, 0.95, 32),
      aluminumMat
    );
    noseHousing.rotation.z = -Math.PI / 2;
    noseHousing.position.set(2.40, 0.02, 0);
    engine.add(noseHousing);

    // Front nose bolt ring flange
    const noseFlange = new THREE.Mesh(
      new THREE.TorusGeometry(0.78, 0.05, 12, 32),
      castAlMat
    );
    noseFlange.rotation.y = Math.PI / 2;
    noseFlange.position.set(2.05, 0.02, 0);
    engine.add(noseFlange);

    // Bolt heads on nose flange
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const bHead = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.10, 8),
        darkMat
      );
      bHead.position.set(2.05, Math.sin(ang) * 0.78, Math.cos(ang) * 0.78);
      bHead.rotation.z = Math.PI / 2;
      engine.add(bHead);
    }

    // Bolt flange ribs along X — characteristic feature visible in images
    for (let i = 0; i < 9; i++) {
      const rib = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.90, 1.60),
        castAlMat
      );
      rib.position.set(-1.70 + i * 0.48, 0.02, 0);
      engine.add(rib);
    }

    // Bottom crankcase pan (sump)
    const sump = new THREE.Mesh(
      new THREE.BoxGeometry(3.60, 0.50, 1.38),
      sumpMat
    );
    sump.position.set(0.30, -0.65, 0);
    engine.add(sump);

    // Sump drain bolts row
    for (let i = 0; i < 6; i++) {
      const bolt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.09, 8),
        darkMat
      );
      bolt.position.set(-1.2 + i * 0.50, -0.92, 0);
      engine.add(bolt);
    }

    // ======================================================
    // CYLINDER HEAD BLOCK — sits on top of crankcase
    // ======================================================

    const cylHead = new THREE.Mesh(
      new THREE.BoxGeometry(3.90, 0.45, 1.44),
      castAlMat
    );
    cylHead.position.set(0.30, 0.62, 0);
    engine.add(cylHead);

    // ======================================================
    // VALVE COVER — Rounded black composite valve cover (Exact replica from reference image)
    // Smooth curved top dome instead of sharp box edges
    // ======================================================

    const valveCoverGroup = new THREE.Group();
    valveCoverGroup.position.set(0.30, 1.05, 0);

    // Curved main dome (horizontal cylinder sliced / smoothed)
    const vcDome = new THREE.Mesh(
      new THREE.CylinderGeometry(0.68, 0.68, 3.70, 32),
      blackMat
    );
    vcDome.rotation.z = Math.PI / 2;
    valveCoverGroup.add(vcDome);

    // Front & rear rounded end caps for valve cover
    for (const xEnd of [-1.85, 1.85]) {
      const endCap = new THREE.Mesh(
        new THREE.SphereGeometry(0.68, 24, 24, 0, Math.PI * 2, 0, Math.PI * 0.5),
        blackMat
      );
      endCap.rotation.z = xEnd < 0 ? -Math.PI / 2 : Math.PI / 2;
      endCap.position.x = xEnd;
      valveCoverGroup.add(endCap);
    }
    engine.add(valveCoverGroup);

    // Valve cover perimeter bolt details
    for (let i = 0; i < 8; i++) {
      for (const side of [-1, 1]) {
        const blt = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.035, 0.08, 8),
          darkMat
        );
        blt.rotation.x = Math.PI / 2;
        blt.position.set(-1.58 + i * 0.46, 1.08, side * 0.72);
        engine.add(blt);
      }
    }

    // 6 Red oval injection caps on valve cover
    for (let i = 0; i < 6; i++) {
      const portGroup = new THREE.Group();
      portGroup.position.set(-1.12 + i * 0.46, 1.34, 0.56);
      portGroup.rotation.x = 0.55;

      const portFrame = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.14, 0.06, 24),
        blackMat
      );
      portGroup.add(portFrame);

      const redPort = new THREE.Mesh(
        new THREE.CylinderGeometry(0.11, 0.11, 0.07, 24),
        redPortMat
      );
      portGroup.add(redPort);
      engine.add(portGroup);
      coilMats.push(redPortMat);
    }

    // ======================================================
    // FUEL INJECTION MANIFOLD RAIL & S-CURVED INJECTOR LINES (Exact replica from reference photo)
    // ======================================================

    // Main horizontal metallic fuel rail bar running under the 6 red caps
    const fuelRail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 3.40, 16),
      brassFuelMat
    );
    fuelRail.rotation.z = Math.PI / 2;
    fuelRail.position.set(0.15, 0.96, 0.68);
    engine.add(fuelRail);

    // 6 S-curved stainless steel fuel injector lines branching into each red port
    for (let i = 0; i < 6; i++) {
      const posX = -1.12 + i * 0.46;

      // Vertical injector nozzle valve body
      const valveBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.032, 0.032, 0.16, 12),
        brassFuelMat
      );
      valveBody.position.set(posX, 1.10, 0.64);
      engine.add(valveBody);

      // Curved steel pipe feeding from fuel rail to injector body
      const lineBend = new THREE.Mesh(
        new THREE.TorusGeometry(0.08, 0.016, 8, 16, Math.PI * 0.65),
        brassFuelMat
      );
      lineBend.position.set(posX + 0.04, 1.02, 0.66);
      lineBend.rotation.z = -Math.PI / 4;
      lineBend.rotation.y = Math.PI / 2;
      engine.add(lineBend);
    }

    // High-pressure oil line serpentine pipe routing along lower crankcase
    const mainOilPipe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, 2.80, 12),
      brassFuelMat
    );
    mainOilPipe.rotation.z = Math.PI / 2;
    mainOilPipe.position.set(0.10, -0.22, 0.78);
    engine.add(mainOilPipe);

    // Vertical oil feed elbow dropping to sump
    const oilElbow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 0.48, 12),
      brassFuelMat
    );
    oilElbow.position.set(-0.25, -0.46, 0.78);
    engine.add(oilElbow);

    // Additional smaller studs on valve cover sides
    for (let i = 0; i < 7; i++) {
      for (const zSide of [-0.72, 0.72]) {
        const stud = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.025, 0.06, 6),
          darkMat
        );
        stud.rotation.z = Math.PI / 2;
        stud.position.set(-1.35 + i * 0.45, 1.14, zSide);
        engine.add(stud);
      }
    }

    // ======================================================
    // ANIMATED PISTONS & CONNECTING RODS (6 Cylinders)
    // Sits inside the head/block assembly & moves vertically with crank angle
    // ======================================================
    const pistons = [];
    const conRods = [];

    for (let i = 0; i < 6; i++) {
      const pistonGroup = new THREE.Group();
      const posX = -1.12 + i * 0.46;
      pistonGroup.position.set(posX, 0.45, 0);

      // Piston Head (Machined metallic cylinder)
      const pistonHead = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.22, 16),
        pistonRodMat
      );
      pistonGroup.add(pistonHead);

      // Piston Ring grooves (visual details)
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.181, 0.01, 8, 16),
        darkMat
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.06;
      pistonGroup.add(ring);

      // Connecting Rod
      const rod = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 0.38, 0.05),
        castAlMat
      );
      rod.position.y = -0.22;
      pistonGroup.add(rod);

      engine.add(pistonGroup);
    }

    // ======================================================
    // CYLINDER HEAD MATERIALS array for CHT animation
    // ======================================================
    const cylMats = [];
    cylMats.push(aluminumMat); // crankcase
    cylMats.push(castAlMat);   // cylinder head

    // ======================================================
    // EXHAUST RUNNERS — along front face (+Z side), curved downward
    // ======================================================

    // Main exhaust collector pipe
    const exhCollector = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 3.60, 14),
      exhaustMat
    );
    exhCollector.rotation.z = Math.PI / 2;
    exhCollector.position.set(0.30, 0.26, 0.88);
    engine.add(exhCollector);

    // ======================================================
    // 6 PROMINENT SIDE PISTON RODS (High-visibility animation on front face)
    // ======================================================
    for (let i = 0; i < 6; i++) {
      const pistonGroup = new THREE.Group();
      const posX = -1.12 + i * 0.46;

      // Piston cylinder rod — Thick Polished Chrome shaft
      const rodMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.065, 0.065, 0.72, 20),
        pistonRodMat
      );
      pistonGroup.add(rodMesh);

      // Piston pin head cap — Large Vibrant Red Cap
      const capMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 0.16, 20),
        pistonCapMat
      );
      capMesh.position.y = 0.36;
      pistonGroup.add(capMesh);

      pistonGroup.position.set(posX, 0.45, 0.86);
      engine.add(pistonGroup);

      pistons.push({
        group: pistonGroup,
        phase: (i / 6) * Math.PI * 2, // 6-cylinder firing sequence phase offset
        baseY: 0.45
      });
    }

    // Rear exhaust collector
    const exhCollectorR = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 3.40, 12),
      exhaustMat
    );
    exhCollectorR.rotation.z = Math.PI / 2;
    exhCollectorR.position.set(0.30, 0.18, -0.88);
    engine.add(exhCollectorR);

    // ======================================================
    // COOLANT / OIL TUBES — curved metal tubes on front
    // ======================================================

    const tubeMat = new THREE.MeshStandardMaterial({
      color: 0x4a5660, metalness: 0.80, roughness: 0.28,
    });



    // ======================================================
    // REAR SUPERCHARGER & INTAKE MANIFOLD HOUSING (Exact match to reference photo rear)
    // Multi-stage centrifugal blower, elbow intake duct, and accessory pumps
    // ======================================================

    const superchargerGroup = new THREE.Group();
    superchargerGroup.position.set(-2.55, 0, 0);

    // Main supercharger impeller housing drum
    const scHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(1.05, 1.05, 0.65, 36),
      castAlMat
    );
    scHousing.rotation.z = Math.PI / 2;
    superchargerGroup.add(scHousing);

    // AEROSYNX Metallic Logo Emblem on rear circular endplate (Exact surface from user image)
    const scEmblem = new THREE.Mesh(
      new THREE.CircleGeometry(0.68, 64),
      metallicLogoMat
    );
    scEmblem.rotation.y = -Math.PI / 2;
    scEmblem.position.set(-0.332, 0, 0);
    superchargerGroup.add(scEmblem);

    // Perimeter bolt flange ring around supercharger
    const scFlange = new THREE.Mesh(
      new THREE.TorusGeometry(1.08, 0.05, 10, 36),
      castAlMat
    );
    scFlange.rotation.y = Math.PI / 2;
    superchargerGroup.add(scFlange);

    for (let i = 0; i < 18; i++) {
      const ang = (i / 18) * Math.PI * 2;
      const bHead = new THREE.Mesh(
        new THREE.CylinderGeometry(0.038, 0.038, 0.08, 8),
        darkMat
      );
      bHead.position.set(0, Math.sin(ang) * 1.08, Math.cos(ang) * 1.08);
      bHead.rotation.z = Math.PI / 2;
      superchargerGroup.add(bHead);
    }

    // Large curved intake pipe elbow running from supercharger top into valve cover rear
    const intakeElbow = new THREE.Mesh(
      new THREE.TorusGeometry(0.75, 0.16, 16, 24, Math.PI * 0.55),
      aluminumMat
    );
    intakeElbow.position.set(0.40, 0.72, 0);
    intakeElbow.rotation.y = Math.PI / 2;
    intakeElbow.rotation.x = Math.PI;
    superchargerGroup.add(intakeElbow);

    // Downward air intake pipe elbow at supercharger rear base
    const rearIntakeDuct = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.28, 0.85, 20),
      castAlMat
    );
    rearIntakeDuct.position.set(-0.55, -0.65, 0);
    superchargerGroup.add(rearIntakeDuct);

    // Accessory gearbox & fuel pump stacked below supercharger
    const auxPumpBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.65, 0.55),
      darkMat
    );
    auxPumpBox.position.set(-0.55, -1.15, 0);
    superchargerGroup.add(auxPumpBox);

    engine.add(superchargerGroup);

    // Radial gear teeth around circumference (very characteristic)
    const TOOTH_COUNT = 24;
    for (let i = 0; i < TOOTH_COUNT; i++) {
      const ang = (i / TOOTH_COUNT) * Math.PI * 2;
      const tooth = new THREE.Mesh(
        new THREE.BoxGeometry(0.84, 0.10, 0.10),
        castAlMat
      );
      tooth.position.set(
        -2.42,
        Math.sin(ang) * 0.96,
        Math.cos(ang) * 0.96
      );
      tooth.rotation.x = ang;
      engine.add(tooth);
    }

    // Gear housing bolt flange ring
    const gearFlange = new THREE.Mesh(
      new THREE.TorusGeometry(0.97, 0.065, 8, 36),
      castAlMat
    );
    gearFlange.rotation.y = Math.PI / 2;
    gearFlange.position.set(-2.83, -0.02, 0);
    engine.add(gearFlange);

    // Bolt heads around gear flange
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2;
      const bolt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.048, 0.048, 0.12, 8),
        darkMat
      );
      bolt.position.set(
        -2.84,
        Math.sin(ang) * 0.96,
        Math.cos(ang) * 0.96
      );
      bolt.rotation.z = Math.PI / 2;
      engine.add(bolt);
    }

    // Flywheel / magneto disc behind gear housing
    const flywheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.72, 0.72, 0.20, 32),
      aluminumMat
    );
    flywheel.rotation.z = Math.PI / 2;
    flywheel.position.set(-2.00, -0.02, 0);
    engine.add(flywheel);

    // Flywheel cooling holes
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const hole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 0.22, 10),
        darkMat
      );
      hole.rotation.z = Math.PI / 2;
      hole.position.set(
        -2.00,
        Math.sin(ang) * 0.46,
        Math.cos(ang) * 0.46
      );
      engine.add(hole);
    }

    // ======================================================
    // AUXILIARY HOUSINGS — cascading below gear housing
    // Oil pump + fuel pump + magneto boxes
    // ======================================================

    // Upper aux housing (oil pump)
    const auxHousing1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 0.58, 0.68),
      castAlMat
    );
    auxHousing1.position.set(-2.42, -0.90, 0.20);
    engine.add(auxHousing1);

    // Lower aux housing (fuel pump/magneto)
    const auxHousing2 = new THREE.Mesh(
      new THREE.CylinderGeometry(0.40, 0.40, 0.58, 18),
      castAlMat
    );
    auxHousing2.rotation.z = Math.PI / 2;
    auxHousing2.position.set(-2.42, -0.90, -0.28);
    engine.add(auxHousing2);

    // Large bottom accessory box
    const auxBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.70, 0.52, 1.10),
      castAlMat
    );
    auxBase.position.set(-2.42, -1.40, 0);
    engine.add(auxBase);



    // ======================================================
    // ======================================================
    // ======================================================
    // PROPELLER — 3-blade with smooth aerodynamic tapered blades & conical spinner (Ditto match to reference photo)
    // ======================================================

    const propGroup = new THREE.Group();
    propGroup.position.set(2.55, -0.02, 0);
    engine.add(propGroup);

    // Central Propeller Mounting Hub Disc (Machined Stainless Steel)
    const propHub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.26, 0.18, 32),
      pistonRodMat
    );
    propHub.rotation.z = Math.PI / 2;
    propGroup.add(propHub);

    // Polished Conical Spinner Nose Cone — Gloss White Composite Cone
    const spinner = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 0.78, 36),
      propMat
    );
    spinner.rotation.z = Math.PI / 2;  // points along +X
    spinner.position.set(0.39, 0, 0);
    propGroup.add(spinner);

    // Spinner Backplate Disc (Polished Chrome)
    const spinnerBack = new THREE.Mesh(
      new THREE.CylinderGeometry(0.29, 0.29, 0.09, 36),
      pistonRodMat
    );
    spinnerBack.rotation.z = Math.PI / 2;
    spinnerBack.position.set(0.04, 0, 0);
    propGroup.add(spinnerBack);

    // Hub Shaft Extension Collar
    const shaftCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.14, 24),
      aluminumMat
    );
    shaftCollar.rotation.z = Math.PI / 2;
    shaftCollar.position.set(-0.06, 0, 0);
    propGroup.add(shaftCollar);

    // 6 Hex Head Hub Mounting Bolts
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const hBolt = new THREE.Mesh(
        new THREE.CylinderGeometry(0.028, 0.028, 0.08, 8),
        darkMat
      );
      hBolt.position.set(0.04, Math.sin(ang) * 0.20, Math.cos(ang) * 0.20);
      hBolt.rotation.z = Math.PI / 2;
      propGroup.add(hBolt);
    }

    // ======================================================
    // PROPELLER — 3 wide curved blades, glossy white composite
    // Matching reference: wide planform, smooth bezier curves, red tip stripes
    // ======================================================

    // Shared blade planform shape — built ONCE, used for all 3 blades
    // Shape is in the XY plane: X=chord (leading edge negative), Y=span (0=root, 2.2=tip)
    const bladeShape = new THREE.Shape();

    // Root entry (narrow, attaches to root collar)
    bladeShape.moveTo(-0.04, 0.12);

    // Leading edge: sweeps out from root to wide midspan, then tapers to rounded tip
    bladeShape.bezierCurveTo(
      -0.10, 0.32,
      -0.28, 0.62,
      -0.32, 0.95   // midspan leading edge (widest point)
    );
    bladeShape.bezierCurveTo(
      -0.34, 1.30,
      -0.30, 1.65,
      -0.16, 1.98   // near-tip leading edge
    );
    // Rounded tip
    bladeShape.bezierCurveTo(
      -0.10, 2.10,
       0.00, 2.16,
       0.00, 2.16
    );
    // Trailing edge: mirrors leading, back to root
    bladeShape.bezierCurveTo(
       0.00, 2.16,
       0.10, 2.10,
       0.16, 1.98   // near-tip trailing edge
    );
    bladeShape.bezierCurveTo(
       0.28, 1.65,
       0.30, 1.30,
       0.28, 0.95   // midspan trailing edge
    );
    bladeShape.bezierCurveTo(
       0.24, 0.62,
       0.09, 0.32,
       0.04, 0.12   // root trailing edge
    );
    bladeShape.closePath();

    // Extrude to create airfoil thickness with polished bevel
    const bladeGeomShared = new THREE.ExtrudeGeometry(bladeShape, {
      depth: 0.055,        // airfoil thickness
      bevelEnabled: true,
      bevelThickness: 0.010,
      bevelSize: 0.008,
      bevelSegments: 4,
      steps: 1,
    });
    // Center along extrude (thickness) axis
    bladeGeomShared.translate(0, 0, -0.0275);

    // Red diagonal stripe shape for tip markings
    const stripeShape = new THREE.Shape();
    stripeShape.moveTo(-0.28, 0);
    stripeShape.lineTo( 0.28, 0);
    stripeShape.lineTo( 0.28, 0.07);
    stripeShape.lineTo(-0.28, 0.07);
    stripeShape.closePath();
    const stripeGeom = new THREE.ExtrudeGeometry(stripeShape, {
      depth: 0.058,
      bevelEnabled: false,
    });
    // stripeGeom also needs same rotation applied
    stripeGeom.translate(0, 0, -0.029);
    // Rotate both geometries -90° around Y so the blade chord (originally X)
    // maps to the world-Z (tangential) direction — making blades WIDE and visible
    // from the default front-angled camera instead of appearing as thin strips
    bladeGeomShared.rotateY(-Math.PI / 2);
    stripeGeom.rotateY(-Math.PI / 2);

    for (let i = 0; i < 3; i++) {
      const bladeAngle = (i / 3) * Math.PI * 2;
      const bladePivot = new THREE.Group();
      bladePivot.rotation.x = bladeAngle;

      // Matte black root collar / shank sleeve
      const rootCollar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.105, 0.50, 20),
        blackMat
      );
      rootCollar.position.y = 0.36;
      bladePivot.add(rootCollar);

      // Root clamp ring
      const rootClamp = new THREE.Mesh(
        new THREE.TorusGeometry(0.108, 0.022, 8, 24),
        darkMat
      );
      rootClamp.rotation.x = Math.PI / 2;
      rootClamp.position.y = 0.16;
      bladePivot.add(rootClamp);

      // MAIN BLADE — glossy white, wide curved planform
      const blade = new THREE.Mesh(bladeGeomShared, propMat);
      // Pitch twist: rotate around Y (span) axis for propeller pitch angle
      blade.rotation.y = 0.24;
      bladePivot.add(blade);

      // Red diagonal tip stripes — two bands near blade tip
      for (const stripeY of [1.82, 1.95]) {
        const stripe = new THREE.Mesh(stripeGeom, redPortMat);
        stripe.position.y = stripeY;
        stripe.rotation.y = 0.24; // match blade pitch
        bladePivot.add(stripe);
      }

      propGroup.add(bladePivot);
    }





    // ======================================================
    // CAMERA CONTROLS
    // ======================================================

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (e) => {
      dragging = true;

      lastX = e.clientX;
      lastY = e.clientY;
    };

    const onUp = () => {
      dragging = false;
    };

    const onMove = (e) => {
      if (!dragging) return;

      const dx =
        e.clientX - lastX;

      const dy =
        e.clientY - lastY;

      camTheta -=
        dx * 0.006;

      camPhi = Math.max(
        0.35,
        Math.min(
          1.5,
          camPhi -
          dy * 0.006
        )
      );

      lastX = e.clientX;
      lastY = e.clientY;

      updateCamera();
    };

    renderer.domElement.addEventListener(
      "pointerdown",
      onDown
    );

    window.addEventListener(
      "pointerup",
      onUp
    );

    window.addEventListener(
      "pointermove",
      onMove
    );

    // ======================================================
    // RESIZE & LAYOUT RECOVERY
    // ======================================================

    const onResize = () => {
      if (!mount) return;
      const w = mount.clientWidth || mount.parentElement?.clientWidth || window.innerWidth || 800;
      const h = mount.clientHeight || mount.parentElement?.clientHeight || window.innerHeight || 600;

      if (w > 0 && h > 0) {
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
      }
    };

    onResize();

    window.addEventListener("resize", onResize);
    const resizeObs = new ResizeObserver(() => onResize());
    resizeObs.observe(mount);
    if (mount.parentElement) {
      resizeObs.observe(mount.parentElement);
    }

    // ======================================================
    // THREE REFS
    // ======================================================

    threeRef.current = {
      scene,
      camera,
      renderer,
      engine,
      cylMats,
      exhaustMat,
      sumpMat,
      flywheel,
      propGroup,
      coilMats,
      pistons,

      latest: {
        reading:
          simRef.current
            .reading,

        score: 0,

        fault: "none",

        mission:
          "normal_cruise",

        engineRunning: true,
      },
    };

    // ======================================================
    // ANIMATION
    // ======================================================

    let raf;

    const clock =
      new THREE.Clock();

    const animate = () => {
      raf =
        requestAnimationFrame(
          animate
        );

      const dt =
        clock.getDelta();

      const latestData = threeRef.current.latest || {};
      const reading = latestData.reading || simRef.current.reading || baseReading();
      const score = latestData.score || 0;
      const fault = latestData.fault || "none";
      const mission = latestData.mission || "normal_cruise";

      const t = threeRef.current;

      t.flightT =
        (t.flightT || 0) +
        dt;

      const ft =
        t.flightT;

      // Kill switch wins immediately. Do not treat RPM 0 as "missing".
      const isEngineOn = engineRunningRef.current !== false;
      if (!isEngineOn) {
        t.runFactor = 0;
      } else {
        t.runFactor = THREE.MathUtils.lerp(t.runFactor ?? 1, 1, dt * 5.0);
      }
      const rf = t.runFactor;

      let bobAmp = 0.05;
      let bobSpeed = 0.6;
      let bankAmp = 0.03;
      let pitchAmp = 0.02;
      let driftSpeed = 0.5;

      if (
        mission ===
        "high_altitude"
      ) {
        bobAmp = 0.03;
        bobSpeed = 0.35;
        bankAmp = 0.015;
      } else if (
        mission ===
        "hot_weather"
      ) {
        bobAmp = 0.11;
        bobSpeed = 0.9;
        bankAmp = 0.05;
      } else if (
        mission ===
        "rapid_throttle"
      ) {
        bobAmp = 0.06;
        bobSpeed = 1.6;
        bankAmp = 0.09;
        pitchAmp = 0.06;
        driftSpeed = 1.3;
      }

      const flyY =
        Math.sin(
          ft * bobSpeed
        ) * bobAmp;

      const flyBank =
        Math.sin(
          ft *
          driftSpeed *
          0.7
        ) * bankAmp;

      const flyPitch =
        Math.cos(
          ft *
          driftSpeed *
          0.5
        ) * pitchAmp;

      if (t.engine) {
        t.engine.rotation.z = flyBank * rf;
        t.engine.rotation.x = flyPitch * rf;
        t.engine.position.y = 0.3 + flyY * rf;
      }

      // ====================================================
      // CHT VISUAL
      // ====================================================

      const chtT =
        normalize(
          reading.cht_c || 100,
          [100, 150]
        );

      const chtColor =
        lerpColor(
          "#6b7684",
          "#ff5b5b",
          chtT
        );

      const idleGlow =
        new THREE.Color(
          0x2a1a10
        );

      if (t.cylMats) {
        t.cylMats.forEach(
          (m) => {
            const heatColor = lerpColor(
              "#8e9fae",
              "#e06030",
              chtT
            );
            if (m && m.color) m.color.copy(heatColor);
            if (m && m.emissive) {
              m.emissive
                .copy(idleGlow)
                .lerp(
                  heatColor,
                  Math.max(0, chtT - 0.3)
                )
                .multiplyScalar(
                  chtT * 0.4
                );
            }
          }
        );
      }

      // ====================================================
      // EGT VISUAL
      // ====================================================

      const egtT =
        normalize(
          reading.egt_c || 650,
          [650, 850]
        );

      const egtColor =
        lerpColor(
          "#3a3f45",
          "#ff7a3c",
          egtT
        );

      if (t.exhaustMat) {
        if (t.exhaustMat.color) t.exhaustMat.color.copy(egtColor);
        if (t.exhaustMat.emissive) {
          t.exhaustMat.emissive
            .copy(egtColor)
            .multiplyScalar(
              egtT * 0.9
            );
        }
      }

      // ====================================================
      // OIL VISUAL
      // ====================================================

      const oilPressT =
        1 -
        normalize(
          reading.oil_press_bar || 2.5,
          [1.0, 3.0]
        );

      const oilColor =
        lerpColor(
          "#2f5f8a",
          "#ffb648",
          oilPressT
        );

      if (t.sumpMat) {
        if (t.sumpMat.color) t.sumpMat.color.copy(oilColor);
        if (t.sumpMat.emissive) {
          t.sumpMat.emissive
            .copy(oilColor)
            .multiplyScalar(
              oilPressT * 0.5
            );
        }
      }

      // ====================================================
      // RPM VISUAL — live shaft speed tracks sensor RPM;
      // kill switch forces 0 so the model actually stops.
      // ====================================================

      let gaugeRpm = 0;
      if (isEngineOn) {
        if (hardwareModeRef.current === "live") {
          const liveRpm = toFiniteNumber(hardwareRef.current.rpm);
          gaugeRpm =
            liveRpm === null
              ? 0
              : mapRawToRealistic(
                  liveRpm,
                  RAW_HARDWARE_RANGE.rpm,
                  MAPPED_TARGET_RANGE.rpm
                );
        } else {
          const simRpm = toFiniteNumber(reading.rpm);
          gaugeRpm = simRpm === null ? 0 : Math.max(0, simRpm);
        }
      }

      const effectiveRpm = Math.max(0, gaugeRpm) * rf;
      const rpmFrac = effectiveRpm / 5500;
      // Shaft speed is proportional to the RPM gauge (0 RPM = stopped).
      const shaftRadPerSec = rpmFrac * 30;
      const flywheelRadPerSec = rpmFrac * 14;
      const crankRadPerSec = rpmFrac * 20;

      if (t.flywheel) {
        t.flywheel.rotation.x += flywheelRadPerSec * dt;
      }

      if (t.propGroup) {
        t.propGroup.rotation.x += shaftRadPerSec * dt;
      }

      // ====================================================
      // PISTONS ANIMATION — 6 side rods reciprocating with crank angle
      // ====================================================
      if (t.pistons) {
        const crankAngle = (t.crankAngle || 0) + crankRadPerSec * dt;
        t.crankAngle = crankAngle;

        const STROKE_AMP = 0.45 * rf;
        t.pistons.forEach((p) => {
          if (p && p.group) {
            const pAngle = crankAngle + p.phase;
            p.group.position.y = p.baseY + Math.sin(pAngle) * STROKE_AMP;
          }
        });
      }

      // ====================================================
      // IGNITION COIL PULSE — red caps flash with RPM
      // ====================================================

      const coilPulse =
        (0.4 +
          0.6 *
          Math.abs(
            Math.sin(
              ft * rpmFrac * 28
            )
          )) * rf;

      if (t.coilMats) {
        t.coilMats.forEach((m) => {
          if (m) {
            m.emissiveIntensity =
              coilPulse * (0.3 + rpmFrac * 0.7);
          }
        });
      }

      // ====================================================
      // VIBRATION VISUAL
      // ====================================================

      const vib =
        (reading.vibration_g || 0.1) * rf;

      if (t.engine) {
        t.engine.position.x =
          (Math.random() -
            0.5) *
          vib *
          1.2;

        t.engine.position.z =
          (Math.random() -
            0.5) *
          vib *
          1.2;

        t.engine.position.y =
          flyY * rf +
          0.2 +
          (Math.random() -
            0.5) *
          vib *
          0.5;
      }

      renderer.render(
        scene,
        camera
      );
    };

    animate();

    // ======================================================
    // CLEANUP
    // ======================================================

    return () => {
      cancelAnimationFrame(
        raf
      );

      renderer.domElement.removeEventListener(
        "pointerdown",
        onDown
      );

      window.removeEventListener(
        "pointerup",
        onUp
      );

      window.removeEventListener(
        "pointermove",
        onMove
      );

      window.removeEventListener(
        "resize",
        onResize
      );
      resizeObs.disconnect();

      renderer.dispose();

      if (
        mount.contains(
          renderer.domElement
        )
      ) {
        mount.removeChild(
          renderer.domElement
        );
      }

      if (audioRef.current && audioRef.current.ctx && audioRef.current.ctx.state !== "closed") {
        try {
          audioRef.current.ctx.close();
        } catch (e) {
          // ignore already closed
        }
        audioRef.current.ctx = null;
      }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ========================================================
  // STATUS COLOR
  // ========================================================

  const statusColor =
    status === "Normal"
      ? COLORS.green
      : status === "Warning"
        ? COLORS.amber
        : COLORS.red;

  // ========================================================
  // RAW HARDWARE DISPLAY
  //
  // IMPORTANT:
  // These values are NOT sent to the API.
  //
  // They are only displayed locally for transparency.
  // ========================================================

  const rawHardware =
    hardwareRef.current;

  // ========================================================
  // UI
  // ========================================================

  return (
    <div style={styles.wrap}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600;700&display=swap');

        html, body, #root {
          margin: 0;
          padding: 0;
          height: 100%;
          width: 100%;
          max-width: none;
          text-align: left;
          overflow: hidden;
        }

        * {
          box-sizing: border-box;
        }

        .egdt-btn {
          font-family: 'Inter', sans-serif;
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.03em;
          padding: 6px 12px;
          border-radius: 6px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          background: linear-gradient(180deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%);
          color: ${COLORS.textMuted};
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          white-space: nowrap;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
          backdrop-filter: blur(8px);
        }

        .egdt-btn:hover {
          border-color: rgba(234, 179, 8, 0.4);
          color: ${COLORS.textPrimary};
          background: linear-gradient(180deg, rgba(40, 53, 72, 0.9) 0%, rgba(20, 30, 45, 0.95) 100%);
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
        }

        .egdt-btn.active {
          background: linear-gradient(135deg, #eab308 0%, #ca8a04 100%);
          color: #0f172a;
          border-color: #fef08a;
          font-weight: 700;
          box-shadow: 0 0 14px rgba(234, 179, 8, 0.45);
        }

        .egdt-btn.fault-active {
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
          color: #ffffff;
          border-color: #fca5a5;
          font-weight: 700;
          box-shadow: 0 0 14px rgba(239, 68, 68, 0.5);
        }

        .egdt-tooltip-wrapper {
          position: relative;
        }

        .egdt-tooltip-box {
          position: fixed;
          z-index: 999999;
          width: 250px;
          padding: 10px 12px;
          background: rgba(10, 15, 26, 0.96);
          border: 1px solid rgba(234, 179, 8, 0.4);
          border-radius: 8px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6), 0 0 15px rgba(234, 179, 8, 0.15);
          backdrop-filter: blur(12px);
          pointer-events: none;
          animation: tooltipFadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
          font-family: 'Inter', sans-serif;
          text-align: left;
        }

        @keyframes tooltipFadeIn {
          from { opacity: 0; transform: scale(0.97); }
          to { opacity: 1; transform: scale(1); }
        }

        .egdt-tooltip-box.fixed-pos-top {
          transform: translate(-50%, -100%);
        }

        .egdt-tooltip-box.fixed-pos-bottom {
          transform: translate(-50%, 0);
        }

        .egdt-tooltip-box.fixed-pos-left {
          transform: translate(-100%, -50%);
        }

        .egdt-tooltip-box.fixed-pos-right {
          transform: translate(0, -50%);
        }

        .egdt-tooltip-cat {
          font-size: 8.5px;
          font-weight: 700;
          letter-spacing: 0.1em;
          color: #eab308;
          text-transform: uppercase;
          margin-bottom: 3px;
        }

        .egdt-tooltip-title {
          font-size: 11px;
          font-weight: 700;
          color: #f8fafc;
          margin-bottom: 4px;
        }

        .egdt-tooltip-text {
          font-size: 10px;
          line-height: 1.45;
          color: #94a3b8;
        }

        .sih-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 10000;
          background: rgba(4, 8, 15, 0.85);
          backdrop-filter: blur(12px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          animation: fadeIn 0.2s ease-out;
        }

        .sih-modal-content {
          background: radial-gradient(ellipse at 50% 0%, #151d2a 0%, #0a0e17 100%);
          border: 1px solid rgba(234, 179, 8, 0.4);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8), 0 0 40px rgba(234, 179, 8, 0.2);
          border-radius: 12px;
          max-width: 720px;
          width: 100%;
          max-height: 90vh;
          overflow-y: auto;
          color: #f8fafc;
          font-family: 'Inter', sans-serif;
          padding: 24px;
        }

        .sih-modal-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 1px solid rgba(255, 255, 255, 0.1);
          padding-bottom: 14px;
          margin-bottom: 16px;
        }

        .sih-modal-eyebrow {
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: 0.12em;
          color: #38bdf8;
          margin-bottom: 4px;
        }

        .sih-modal-title {
          font-size: 18px;
          font-weight: 700;
          color: #f8fafc;
          margin: 0;
        }

        .sih-modal-close {
          background: transparent;
          border: none;
          color: #94a3b8;
          font-size: 20px;
          cursor: pointer;
          padding: 4px 8px;
          border-radius: 4px;
          transition: color 0.2s;
        }

        .sih-modal-close:hover {
          color: #ef4444;
        }

        .sih-intro-text {
          font-size: 12px;
          color: #94a3b8;
          line-height: 1.5;
          margin-bottom: 18px;
        }

        .sih-pillars-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
          margin-bottom: 18px;
        }

        .sih-pillar-card {
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 8px;
          padding: 12px 14px;
        }

        .sih-pillar-icon {
          font-size: 20px;
          margin-bottom: 6px;
        }

        .sih-pillar-card h4 {
          font-size: 12px;
          font-weight: 700;
          color: #eab308;
          margin: 0 0 4px 0;
        }

        .sih-pillar-card p {
          font-size: 10px;
          color: #94a3b8;
          line-height: 1.45;
          margin: 0;
        }

        .sih-instructions-box {
          background: rgba(234, 179, 8, 0.1);
          border: 1px solid rgba(234, 179, 8, 0.3);
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 11px;
          color: #fef08a;
          line-height: 1.45;
        }

        .sih-modal-footer {
          display: flex;
          justify-content: flex-end;
          margin-top: 20px;
          padding-top: 14px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
      `}</style>

      {/* ====================================================
          HEADER
      ==================================================== */}

      <div style={styles.header}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {/* AeroSynx 3D Gold & Silver Metallic Brand Badge */}
          <Tooltip
            title="AeroSynX Digital Twin Platform"
            text="3D Kinematic Piston Engine Digital Twin with real-time IoT sensor telemetry & predictive AI anomaly detection."
            category="SIH PROJECT BRAND"
            position="bottom"
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                background: "radial-gradient(circle at 35% 35%, #334155 0%, #1e293b 65%, #0f172a 100%)",
                border: "2px solid #eab308",
                boxShadow: "0 0 16px rgba(234, 179, 8, 0.45), inset 0 1px 3px rgba(255,255,255,0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 900,
                fontSize: 22,
                color: "#f8fafc",
                letterSpacing: "-1px",
                cursor: "pointer",
              }}
            >
              A<span style={{ color: "#eab308" }}>X</span>
            </div>
          </Tooltip>

          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#f8fafc", letterSpacing: "0.08em" }}>
              <span style={{ color: "#eab308", fontWeight: 900 }}>AeroSynX</span> AeroPiston Engine - Live Telemetry
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* SIH GUIDE TOGGLE BUTTON */}
          <Tooltip
            title="SIH Evaluator Component Guide"
            text="Click to open interactive SIH Evaluator UI Guide detailing the 4 core technical pillars of Virtual Engine."
            category="PORTAL HELP"
            position="bottom"
          >
            <button
              className="egdt-btn active"
              onClick={() => setShowSIHGuide(true)}
              style={{
                background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
                color: "#ffffff",
                borderColor: "#38bdf8",
                fontWeight: 700,
                boxShadow: "0 0 12px rgba(56, 189, 248, 0.4)",
              }}
            >
              ❓UI Explainer
            </button>
          </Tooltip>

          {/* SYSTEM HEALTH STATUS BADGE */}
          <Tooltip
            title="Engine Diagnostic Health Rating"
            text="Real-time system health rating calculated from multi-sensor AI anomaly score threshold (NORMAL < 0.30, WARNING < 0.65, CRITICAL > 0.65)."
            category="DIAGNOSTIC STATUS"
            position="bottom"
          >
            <div
              style={{
                ...styles.statusBadge,
                borderColor: engineRunning ? statusColor : COLORS.red,
                color: engineRunning ? statusColor : COLORS.red,
                background: engineRunning ? "transparent" : "rgba(239, 68, 68, 0.15)",
                cursor: "help",
              }}
            >
              <span
                style={{
                  ...styles.statusDot,
                  background: engineRunning ? statusColor : COLORS.red,
                }}
              />

              {engineRunning ? status.toUpperCase() : "ENGINE KILLED"}
            </div>
          </Tooltip>
        </div>
      </div>

      {/* ====================================================
          MAIN
      ==================================================== */}

      <div style={styles.main}>
        <div
          ref={mountRef}
          style={styles.viewport}
        />

        {/* 3D Viewport Controls Hint */}
        <div style={{ position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 10, pointerEvents: "none" }}>
          <Tooltip
            title="Interactive 3D Three.js Engine Twin"
            text="Drag with Left-Click to rotate view, Right-Click to pan, and Scroll wheel to zoom in on engine components."
            category="3D VIEWPORT CONTROLS"
            position="bottom"
          >
            <div style={{
              background: "rgba(11, 16, 25, 0.88)",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              borderRadius: 20,
              padding: "5px 14px",
              fontSize: 9.5,
              color: "#94a3b8",
              fontFamily: "'JetBrains Mono', monospace",
              backdropFilter: "blur(12px)",
              pointerEvents: "auto",
              cursor: "help",
              boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
            }}>
              🎮 3D Controls: Drag to Rotate | Scroll to Zoom
            </div>
          </Tooltip>
        </div>

        {/* ==================================================
            RAW HARDWARE INPUT
            Bottom-left of engine viewport
            NOT SENT TO API
        ================================================== */}

        <Tooltip
          title="Unmapped ESP32 Raw Sensor Feed"
          text="Direct raw sensor inputs from physical hardware: MPU6050 3-axis accelerometer/gyro (vibration/tilt), optical slot pulse RPM counter, and LM35 temperature sensor."
          category="HARDWARE IOT INTEGRATION"
          position="top"
          style={{ position: "absolute", left: 16, bottom: 14, zIndex: 5 }}
        >
          <div style={{ ...styles.rawHardwareBox, position: "static", cursor: "help" }}>
            <div style={styles.rawHardwareTitle}>
              UNMAPPED RAW HARDWARE INPUT
            </div>

            <div style={styles.rawHardwareRow}>
              <span>RPM</span>
              <span>
                {typeof rawHardware.rpm === "number"
                  ? rawHardware.rpm.toFixed(0)
                  : "--"}
              </span>
            </div>

            <div style={styles.rawHardwareRow}>
              <span>CHT</span>
              <span>
                {typeof rawHardware.cht_c === "number"
                  ? rawHardware.cht_c.toFixed(1)
                  : "--"}{" "}
                °C
              </span>
            </div>

            <div style={styles.rawHardwareRow}>
              <span>Vibration</span>
              <span>
                {typeof rawHardware.vibration_g === "number"
                  ? rawHardware.vibration_g.toFixed(3)
                  : "--"}{" "}
                g
              </span>
            </div>

            <div style={styles.rawHardwareNote}>
              Display only · not sent to API
            </div>
          </div>
        </Tooltip>

        {/* ==================================================
            SIDEBAR
        ================================================== */}

        <div style={styles.sidebar}>
          <Tooltip
            title="IoT Telemetry Source Status"
            text="Indicates whether telemetry stream is live from physical ESP32 WebSocket (ws://esp32-sensor.local:81) or synthetic simulation walk."
            category="HARDWARE PIPELINE"
            position="left"
            style={{ width: "100%", display: "block", marginBottom: 5 }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
                cursor: "help",
              }}
            >
              <div style={styles.panelLabel}>
                DATA SOURCE
              </div>

              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: "0.06em",
                  color:
                    hardwareMode === "live"
                      ? COLORS.green
                      : COLORS.amber,
                }}
              >
                {hardwareMode === "mock"
                  ? "● MOCK"
                  : dataSourceStatus.startsWith("Live")
                    ? "● LIVE"
                    : dataSourceStatus.startsWith("Signal lost")
                      ? "● SIGNAL LOST"
                      : "● CONNECTING"}
              </span>
            </div>

            <div
              style={{
                fontSize: 9,
                color: "#4a5665",
                marginTop: 2,
              }}
            >
              {dataSourceStatus}
            </div>
          </Tooltip>

          <div
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 8,
            }}
          >
            <Tooltip
              title="Live ESP32 Hardware Mode"
              text="Connects over WebSocket (ws://esp32-sensor.local:81) to physical sensors on the test bench."
              category="DATA SOURCE MODE"
              position="left"
              style={{ flex: 1 }}
            >
              <button
                className={`egdt-btn${hardwareMode === "live" ? " active" : ""}`}
                style={{ width: "100%" }}
                onClick={() => setHardwareMode("live")}
              >
                Live Hardware
              </button>
            </Tooltip>

            <Tooltip
              title="Synthetic Mock Data Mode"
              text="Generates mathematical random walk telemetry for off-line testing without physical ESP32 board."
              category="DATA SOURCE MODE"
              position="left"
              style={{ flex: 1 }}
            >
              <button
                className={`egdt-btn${hardwareMode === "mock" ? " active" : ""}`}
                style={{ width: "100%" }}
                onClick={() => setHardwareMode("mock")}
              >
                Mock Data
              </button>
            </Tooltip>
          </div>

          <div style={styles.panelLabel}>
            TELEMETRY
          </div>

          <TelemetryRow
            label="RPM"
            value={telemetry.rpm?.toFixed(0)}
            unit=""
            limit="5500 max"
            source={HARDWARE_FIELDS.includes("rpm") ? "HW" : "SIM"}
            tooltipTitle="Crankshaft RPM"
            tooltipText="Revolutions per minute of crankshaft & propeller. Sourced from optical slot sensor or simulator (5500 limit)."
          />

          <TelemetryRow
            label="CHT"
            value={telemetry.cht_c?.toFixed(1)}
            unit="°C"
            limit="150 max"
            source={HARDWARE_FIELDS.includes("cht_c") ? "HW" : "SIM"}
            tooltipTitle="Cylinder Head Temp (CHT)"
            tooltipText="Thermal level of engine cylinder head. Sourced from LM35 sensor (150°C limit)."
          />

          <TelemetryRow
            label="EGT"
            value={telemetry.egt_c?.toFixed(1)}
            unit="°C"
            limit="900 max"
            source="SIM"
            tooltipTitle="Exhaust Gas Temp (EGT)"
            tooltipText="Temperature of combustion exhaust gases. Key indicator of lean/rich air-fuel ratio (900°C limit)."
          />

          <TelemetryRow
            label="Oil Press"
            value={telemetry.oil_press_bar?.toFixed(2)}
            unit="bar"
            limit="2.0-5.0"
            source="SIM"
            tooltipTitle="Oil Pressure"
            tooltipText="Pressure of engine oil lubrication system (2.0 to 5.0 bar limit)."
          />

          <TelemetryRow
            label="Oil Temp"
            value={telemetry.oil_temp_c?.toFixed(1)}
            unit="°C"
            limit="150 max"
            source="SIM"
            tooltipTitle="Oil Temperature"
            tooltipText="Temperature of crankcase oil sump (150°C max limit)."
          />

          <TelemetryRow
            label="Fuel Flow"
            value={telemetry.fuel_flow_lph?.toFixed(1)}
            unit="L/h"
            limit="ref."
            source="SIM"
            tooltipTitle="Fuel Consumption Rate"
            tooltipText="Liters per hour fuel flow rate into engine cylinders."
          />

          <TelemetryRow
            label="Vibration"
            value={telemetry.vibration_g?.toFixed(3)}
            unit="g"
            limit="ref."
            source={HARDWARE_FIELDS.includes("vibration_g") ? "HW" : "SIM"}
            tooltipTitle="Engine Vibration (g)"
            tooltipText="High-frequency mechanical vibration in G-force sourced from MPU6050 3-axis accelerometer."
          />

          <TelemetryRow
            label="Roll"
            value={telemetry.roll_deg?.toFixed(1)}
            unit="°"
            limit="±25 typical"
            source={HARDWARE_FIELDS.includes("roll_deg") ? "HW" : "SIM"}
            tooltipTitle="UAV Roll Tilt (°)"
            tooltipText="Bank angle of engine assembly derived from MPU6050 accelerometer gravity vector."
          />

          <TelemetryRow
            label="Pitch"
            value={telemetry.pitch_deg?.toFixed(1)}
            unit="°"
            limit="±25 typical"
            source={HARDWARE_FIELDS.includes("pitch_deg") ? "HW" : "SIM"}
            tooltipTitle="UAV Pitch Angle (°)"
            tooltipText="Inclination angle of engine assembly calculated from MPU6050 pitch vector."
          />

          <TelemetryRow
            label="Yaw"
            value={telemetry.yaw_deg?.toFixed(1)}
            unit="°"
            limit="drifts, gyro-only"
            source={HARDWARE_FIELDS.includes("yaw_deg") ? "HW" : "SIM"}
            tooltipTitle="UAV Yaw Heading (°)"
            tooltipText="Heading rotation integrated from MPU6050 z-axis gyroscope angular velocity."
          />

          <TelemetryRow
            label="Battery"
            value={telemetry.battery_v?.toFixed(2)}
            unit="V"
            limit="13.8-14.4"
            source="SIM"
            tooltipTitle="Electrical Bus Voltage"
            tooltipText="DC voltage output of engine alternator & battery system (13.8V - 14.4V normal)."
          />

          {/* ==================================================
              ANOMALY SCORE
          ================================================== */}

          <Tooltip
            title="AI Anomaly Score Meter"
            text="Continuous anomaly score (0.0 to 1.0) derived by evaluating multi-sensor parameter vectors against baseline flight envelopes."
            category="AI DIAGNOSTICS"
            position="left"
            style={{ width: "100%", display: "block" }}
          >
            <div style={{ cursor: "help" }}>
              <div style={{ ...styles.panelLabel, marginTop: 12 }}>
                ANOMALY SCORE
              </div>

              <div style={styles.scoreBarTrack}>
                <div
                  style={{
                    ...styles.scoreBarFill,
                    width: `${anomalyScore * 100}%`,
                    background: statusColor,
                  }}
                />
              </div>

              <div
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  color: statusColor,
                  marginTop: 3,
                }}
              >
                {anomalyScore.toFixed(3)}
              </div>
            </div>
          </Tooltip>

          {/* ==================================================
              RELIABILITY
          ================================================== */}

          <Tooltip
            title="Predictive Mission Reliability"
            text="Estimates Remaining Operational Life (ROL) until critical breakdown threshold using linear degradation slope estimation."
            category="PREDICTIVE MAINTAINABILITY"
            position="left"
            style={{ width: "100%", display: "block" }}
          >
            <div style={{ cursor: "help" }}>
              <div style={{ ...styles.panelLabel, marginTop: 12 }}>
                MISSION RELIABILITY
              </div>

              <div
                style={{
                  ...styles.reliabilityText,
                  color:
                    reliability.startsWith("Estimated") ||
                      reliability.startsWith("Critical")
                      ? COLORS.violet
                      : COLORS.textMuted,
                }}
              >
                {reliability}
              </div>
            </div>
          </Tooltip>
        </div>
      </div>

      {/* ====================================================
          CONTROLS
      ==================================================== */}

      <div style={styles.controls}>
        <div style={styles.controlGroup}>
          <Tooltip
            title="Flight Mission Context"
            text="Select atmospheric flight profiles to simulate environmental stress (e.g. High Altitude, Hot Ambient Temp, Transient Throttle)."
            category="ENVIRONMENT SUITE"
            position="top"
          >
            <div style={{ ...styles.controlLabel, cursor: "help" }}>
              MISSION PROFILE
            </div>
          </Tooltip>

          <div style={styles.btnRow}>
            {MISSION_PROFILES.map((m) => {
              const info = MISSION_TOOLTIPS[m.id] || { title: m.label, text: "Mission profile simulation." };
              return (
                <Tooltip
                  key={m.id}
                  title={info.title}
                  text={info.text}
                  category="MISSION ENVIRONMENT"
                  position="top"
                >
                  <button
                    className={`egdt-btn ${missionProfile === m.id ? "active" : ""}`}
                    onClick={() => setMission(m.id)}
                  >
                    {m.label}
                  </button>
                </Tooltip>
              );
            })}
          </div>
        </div>

        <div style={styles.controlGroup}>
          <Tooltip
            title="Predictive AI Fault Simulator"
            text="Inject real-time failure anomalies (Misfires, Injector restricts, Coking, Overheating) to demonstrate predictive AI capabilities."
            category="SIMULATION SUITE"
            position="top"
          >
            <div style={{ ...styles.controlLabel, cursor: "help" }}>
              FAULT INJECTION (LIVE DEMO)
            </div>
          </Tooltip>

          <div style={styles.btnRow}>
            {FAULT_TYPES.map((f) => {
              const info = FAULT_TOOLTIPS[f.id] || { title: f.label, text: "Injects fault telemetry into simulation pipeline." };
              return (
                <Tooltip
                  key={f.id}
                  title={info.title}
                  text={info.text}
                  category="FAULT INJECTION DEMO"
                  position="top"
                >
                  <button
                    className={`egdt-btn ${activeFault === f.id
                      ? f.id === "none"
                        ? "active"
                        : "fault-active"
                      : ""
                      }`}
                    onClick={() => setFault(f.id)}
                  >
                    {f.label}
                  </button>
                </Tooltip>
              );
            })}

            <Tooltip
              title="WebAudio Engine Synthesizer"
              text="Click to enable/disable live acoustic engine audio synthesized via WebAudio API — frequency modulated by telemetry RPM and vibration."
              category="AUDIO SYNTHESIZER"
              position="top"
            >
              <button
                className={`egdt-btn ${soundOn ? "active" : ""}`}
                style={soundOn ? {
                  background: "linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)",
                  borderColor: "#a78bfa",
                  color: "#ffffff",
                  fontWeight: 700,
                  boxShadow: "0 0 14px rgba(124, 58, 237, 0.55)",
                } : {}}
                onClick={toggleSound}
              >
                {soundOn ? "🔊 Sound: On" : "🔇 Enable Sound"}
              </button>
            </Tooltip>

            {/* ENGINE KILL / START-STOP SWITCH */}
            <Tooltip
              title="Emergency Engine Kill Switch"
              text="Instantly cuts ignition, halts 3D piston rotation, and triggers emergency alert status."
              category="SAFETY SWITCH"
              position="top"
            >
              <button
                className={`egdt-btn ${engineRunning ? "fault-active" : "active"}`}
                style={{
                  background: engineRunning
                    ? "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)"
                    : "linear-gradient(135deg, #22c55e 0%, #15803d 100%)",
                  borderColor: engineRunning ? "#fca5a5" : "#86efac",
                  color: "#ffffff",
                  fontWeight: 700,
                  boxShadow: engineRunning
                    ? "0 0 16px rgba(239, 68, 68, 0.6)"
                    : "0 0 16px rgba(34, 197, 94, 0.6)",
                }}
                onClick={toggleEngineKillSwitch}
              >
                {engineRunning ? "🛑 KILL ENGINE" : "⚡ START ENGINE"}
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* SIH EVALUATOR GUIDE MODAL */}
      {showSIHGuide && (
        <SIHGuideModal onClose={() => setShowSIHGuide(false)} />
      )}
    </div>
  );
}

// ==========================================================
// MISSION TOOLTIPS DICTIONARY
// ==========================================================

const MISSION_TOOLTIPS = {
  normal_cruise: {
    title: "Normal Cruise Profile",
    text: "Standard flight baseline at 70% nominal power. Telemetry stays within standard Rotax 912 operational limits.",
  },
  high_altitude: {
    title: "High Altitude Profile",
    text: "Simulates flight at 10,000+ ft. Decreased air density raises CHT (+12°C) and EGT (+20°C) while reducing oil pressure.",
  },
  hot_weather: {
    title: "Hot Weather Profile",
    text: "High ambient temperature conditions (38°C+). Increases cylinder head heat (+15°C) and oil temperature (+12°C).",
  },
  rapid_throttle: {
    title: "Rapid Throttle Transients",
    text: "Simulates sudden throttle adjustments causing RPM fluctuations (±250 RPM) and transient vibration spikes.",
  },
};

// ==========================================================
// FAULT TOOLTIPS DICTIONARY
// ==========================================================

const FAULT_TOOLTIPS = {
  none: {
    title: "Clear Fault Injection",
    text: "Restores normal baseline telemetry and clears active fault state.",
  },
  misfire: {
    title: "Cylinder Misfire Fault",
    text: "Simulates spark plug or ignition failure: drops RPM (4400-4750) and causes severe vibration spikes (0.18-0.40g).",
  },
  injector_abnormality: {
    title: "Fuel Injector Abnormality",
    text: "Simulates fuel line restriction: drops fuel flow (9-13 L/h) and spikes Exhaust Gas Temp (EGT 730-820°C).",
  },
  coking: {
    title: "Carbon Coking & Thermal Degradation",
    text: "Simulates carbon buildup on valves & piston crowns: increases CHT (130-165°C), EGT, and oil temp.",
  },
  lubrication: {
    title: "Lubrication System Failure",
    text: "Simulates oil pump or line pressure drop: oil pressure plummets (0.8-2.2 bar) and oil temp spikes up to 145°C.",
  },
  sensor_drift: {
    title: "Thermal Sensor Drift",
    text: "Simulates sensor degradation: produces erroneous high CHT readings (140-175°C) despite normal engine operation.",
  },
  combustion_instability: {
    title: "Combustion Instability",
    text: "Simulates erratic flame front & knock: violent RPM swings (4350-5550) and high vibration (0.20-0.45g).",
  },
  overheating: {
    title: "Cooling Radiator Overheat",
    text: "Simulates cooling fan/radiator failure: CHT spikes to 135-170°C and oil temp to 135°C.",
  },
  abnormal_vibration: {
    title: "Mechanical Unbalance / Vibration",
    text: "Simulates crankshaft bearing or propeller blade damage: produces continuous high vibration (0.20-0.50g).",
  },
  battery_alternator_health: {
    title: "Electrical Bus / Alternator Failure",
    text: "Simulates alternator drop: bus voltage drops from 14.1V down to 11.5-13.2V battery drain.",
  },
};

// ==========================================================
// TOOLTIP COMPONENT
// ==========================================================

function Tooltip({ children, title, text, category, position = "top", style = {} }) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, effectivePos: position });
  const wrapperRef = useRef(null);

  const updatePosition = () => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    const boxW = 260; // max tooltip box width
    const boxH = 110; // approx tooltip height
    const margin = 12;

    let effPos = position;
    // Auto flip position if near screen edge
    if (position === "top" && rect.top < boxH + margin + 50) {
      effPos = "bottom";
    } else if (position === "bottom" && window.innerHeight - rect.bottom < boxH + margin) {
      effPos = "top";
    } else if (position === "left" && rect.left < boxW + margin) {
      effPos = "right";
    } else if (position === "right" && window.innerWidth - rect.right < boxW + margin) {
      effPos = "left";
    }

    let top = 0;
    let left = 0;

    if (effPos === "top") {
      top = Math.max(margin, rect.top - 8);
      left = Math.max(boxW / 2 + margin, Math.min(window.innerWidth - boxW / 2 - margin, rect.left + rect.width / 2));
    } else if (effPos === "bottom") {
      top = Math.min(window.innerHeight - boxH - margin, rect.bottom + 8);
      left = Math.max(boxW / 2 + margin, Math.min(window.innerWidth - boxW / 2 - margin, rect.left + rect.width / 2));
    } else if (effPos === "left") {
      top = Math.max(boxH / 2 + margin, Math.min(window.innerHeight - boxH / 2 - margin, rect.top + rect.height / 2));
      left = Math.max(boxW + margin, rect.left - 8);
    } else if (effPos === "right") {
      top = Math.max(boxH / 2 + margin, Math.min(window.innerHeight - boxH / 2 - margin, rect.top + rect.height / 2));
      left = Math.min(window.innerWidth - boxW - margin, rect.right + 8);
    }

    setCoords({ top, left, effectivePos: effPos });
  };

  const handleMouseEnter = () => {
    updatePosition();
    setVisible(true);
  };

  const handleMouseLeave = () => {
    setVisible(false);
  };

  return (
    <div
      ref={wrapperRef}
      className="egdt-tooltip-wrapper"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ display: "inline-flex", ...style }}
    >
      {children}
      {visible && (
        <div
          className={`egdt-tooltip-box fixed-pos-${coords.effectivePos || position}`}
          style={{
            top: coords.top,
            left: coords.left,
            zIndex: 99999999,
          }}
        >
          {category && <div className="egdt-tooltip-cat">{category}</div>}
          {title && <div className="egdt-tooltip-title">{title}</div>}
          <div className="egdt-tooltip-text">{text}</div>
        </div>
      )}
    </div>
  );
}

// ==========================================================
// SIH EVALUATOR GUIDE MODAL
// ==========================================================

function SIHGuideModal({ onClose }) {
  return (
    <div className="sih-modal-backdrop" onClick={onClose}>
      <div className="sih-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="sih-modal-header">
          <div>
            <div className="sih-modal-eyebrow">SMART INDIA HACKATHON (SIH) PORTAL EVALUATION GUIDE</div>
            <h2 className="sih-modal-title">🛩️ AeroSynX Virtual Engine — 3D Twin & AI Telemetry Architecture</h2>
          </div>
          <button className="sih-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="sih-modal-body">
          <p className="sih-intro-text">
            Welcome SIH Evaluator! This platform presents a high-fidelity 3D Digital Twin and Predictive Telemetry Architecture designed for UAV Piston Engines (Rotax 912 ULS baseline). Below is the breakdown of the core features:
          </p>

          <div className="sih-pillars-grid">
            <div className="sih-pillar-card">
              <div className="sih-pillar-icon">📡</div>
              <h4>1. Hardware IoT Sensor Suite</h4>
              <p>Streams physical telemetry over WebSocket from ESP32 using MPU6050 (Vibration & UAV Tilt), IR Slot sensor (RPM), and LM35 heat sensors.</p>
            </div>

            <div className="sih-pillar-card">
              <div className="sih-pillar-icon">🛩️</div>
              <h4>2. 3D Kinematic Digital Twin</h4>
              <p>Three.js rendered Rotax 912 engine featuring real-time piston kinematics, rotating crankshaft synced to telemetry RPM, and thermal heat shaders.</p>
            </div>

            <div className="sih-pillar-card">
              <div className="sih-pillar-icon">🧠</div>
              <h4>3. Anomaly & Predictive Health</h4>
              <p>Evaluates multi-sensor telemetry against normal operational envelopes to calculate an Anomaly Score (0–1.0) and Remaining Flight Life (RFL).</p>
            </div>

            <div className="sih-pillar-card">
              <div className="sih-pillar-icon">⚡</div>
              <h4>4. Live Fault Injection Demo</h4>
              <p>Simulates 10 realistic engine failure modes (Misfires, Injector faults, Coking, Overheating, Lubrication) to demonstrate predictive AI capabilities.</p>
            </div>
          </div>

          <div className="sih-instructions-box">
            💡 <strong>Evaluation Tip:</strong> Hover over ANY button, metric, 3D viewport, sensor box, or control in this interface to view instant technical tooltips explaining its physical role!
          </div>
        </div>

        <div className="sih-modal-footer">
          <button className="egdt-btn active" style={{ padding: "8px 22px", fontSize: 12 }} onClick={onClose}>
            Start Exploring Virtual Engine UI
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================================
// TELEMETRY ROW
// ==========================================================

function TelemetryRow({
  label,
  value,
  unit,
  limit,
  source,
  tooltipTitle,
  tooltipText,
  tooltipCategory = "TELEMETRY METRIC",
}) {
  const content = (
    <div style={styles.telRow}>
      <span style={styles.telLabel}>
        {label}{" "}
        <span
          style={{
            fontSize: 8,
            fontWeight: 700,
            padding: "1px 4px",
            borderRadius: 3,
            color: source === "HW" ? COLORS.green : COLORS.textMuted,
            border: `1px solid ${source === "HW" ? COLORS.green : "#2a3542"}`,
          }}
        >
          {source}
        </span>
      </span>

      <span style={styles.telValue}>
        {value}{" "}
        <span style={styles.telUnit}>{unit}</span>
      </span>

      <span style={styles.telLimit}>{limit}</span>
    </div>
  );

  if (tooltipText) {
    return (
      <Tooltip
        title={tooltipTitle || label}
        text={tooltipText}
        category={tooltipCategory}
        position="left"
        style={{ width: "100%", display: "block" }}
      >
        {content}
      </Tooltip>
    );
  }

  return content;
}

// ==========================================================
// STYLES
// ==========================================================

const styles = {
  wrap: {
    fontFamily: "'Inter', sans-serif",
    background: "radial-gradient(ellipse at 50% 0%, #0d1520 0%, #06090e 100%)",
    color: COLORS.textPrimary,
    border: `1px solid ${COLORS.panelBorder}`,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "calc(100vh - 110px)",
    maxHeight: "calc(100vh - 110px)",
  },

  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "10px 20px",
    borderBottom: "1px solid rgba(234, 179, 8, 0.25)",
    background: "rgba(10, 15, 23, 0.92)",
    backdropFilter: "blur(16px)",
    boxShadow: "0 4px 20px rgba(0, 0, 0, 0.4)",
    flexShrink: 0,
  },

  eyebrow: {
    fontSize: 9.5,
    letterSpacing: "0.12em",
    color: COLORS.cyan,
    fontWeight: 600,
    marginBottom: 2,
  },

  title: {
    fontSize: 15,
    fontWeight: 700,
    color: COLORS.textPrimary,
    letterSpacing: "-0.01em",
  },

  subtitle: {
    fontSize: 9,
    color: "#64748b",
    marginTop: 2,
    fontFamily: "'JetBrains Mono', monospace",
  },

  statusBadge: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    border: "1px solid",
    borderRadius: 20,
    padding: "5px 12px",
    boxShadow: "0 2px 10px rgba(0,0,0,0.3)",
    backdropFilter: "blur(8px)",
  },

  statusDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    boxShadow: "0 0 8px currentColor",
  },

  main: {
    display: "flex",
    flex: 1,
    minHeight: 0,
    overflow: "hidden",
    position: "relative",
  },

  viewport: {
    flex: 1,
    minWidth: 0,
    position: "relative",
    cursor: "grab",
  },

  // ========================================================
  // SMALL RAW HARDWARE BOX
  // ========================================================

  rawHardwareBox: {
    position: "absolute",
    left: 16,
    bottom: 14,
    width: 190,
    padding: "10px 12px",
    background: "rgba(11, 16, 25, 0.88)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: 8,
    zIndex: 5,
    pointerEvents: "none",
    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
    backdropFilter: "blur(14px)",
  },

  rawHardwareTitle: {
    fontSize: 8.5,
    fontWeight: 700,
    letterSpacing: "0.08em",
    color: COLORS.cyan,
    marginBottom: 6,
  },

  rawHardwareRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "2px 0",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 9,
    color: COLORS.textMuted,
  },

  rawHardwareNote: {
    marginTop: 6,
    paddingTop: 5,
    borderTop: "1px solid rgba(255, 255, 255, 0.08)",
    fontSize: 7.5,
    color: "#64748b",
    lineHeight: 1.35,
  },

  sidebar: {
    width: 235,
    padding: "14px 16px",
    borderLeft: "1px solid rgba(255, 255, 255, 0.08)",
    background: "rgba(13, 19, 28, 0.88)",
    backdropFilter: "blur(16px)",
    overflowY: "auto",
    minHeight: 0,
    boxShadow: "-4px 0 24px rgba(0, 0, 0, 0.3)",
  },

  panelLabel: {
    fontSize: 10,
    letterSpacing: "0.12em",
    color: "#64748b",
    fontWeight: 700,
    marginBottom: 8,
  },

  telRow: {
    display: "grid",
    gridTemplateColumns: "62px 1fr 54px",
    alignItems: "baseline",
    padding: "4px 0",
    borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
  },

  telLabel: {
    fontSize: 10.5,
    color: COLORS.textMuted,
    fontWeight: 500,
  },

  telValue: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    color: COLORS.textPrimary,
    fontWeight: 600,
    textAlign: "right",
  },

  telUnit: {
    fontSize: 9,
    color: COLORS.textMuted,
  },

  telLimit: {
    fontSize: 8.5,
    color: "#475569",
    textAlign: "right",
  },

  scoreBarTrack: {
    width: "100%",
    height: 5,
    borderRadius: 3,
    background: "rgba(255, 255, 255, 0.08)",
    overflow: "hidden",
  },

  scoreBarFill: {
    height: "100%",
    transition: "width 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
  },

  reliabilityText: {
    fontSize: 10.5,
    color: COLORS.textMuted,
    lineHeight: 1.45,
  },

  controls: {
    borderTop: "1px solid rgba(255, 255, 255, 0.08)",
    background: "rgba(10, 15, 23, 0.92)",
    backdropFilter: "blur(16px)",
    padding: "10px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    flexShrink: 0,
    boxShadow: "0 -4px 20px rgba(0,0,0,0.3)",
  },

  controlGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
  },

  controlLabel: {
    fontSize: 9,
    letterSpacing: "0.12em",
    color: "#64748b",
    fontWeight: 700,
  },

  btnRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
};
