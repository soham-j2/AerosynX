import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import UAVNewModel from "./components/newmodel";
import {
  MissionRecommendationPanel,
  MissionFeasibilityPanel,
  EngineCapabilityPanel,
  SensorEngineFaultPanel,
  CrossSensorConsistencyPanel,
  DegradationPanel,
  OperatingLimitsPanel,
  FinalFaultStatePanel,
  ModelValidityPanel,
  PredictedVsMeasuredChart,
  SensorQualityPanel,
  MissionGuardSimulator,
  MissionPhaseTimeline,
  MissionHistoryPanel,
  EnergyToMissionMarginPanel,
} from "./components/AdvancedPanels";
import { MissionShadowGraph } from "./components/MissionShadowGraph";
import { MissionReplayReview } from "./components/MissionReplayReview";
import { BaseStationRepairPanel } from "./components/BaseStationRepairPanel";
import VirtualEngine from "./components/VirtualEngine";
import "./App.css";

import {
  ToastContainer,
  toast,
} from "react-toastify";

import "react-toastify/dist/ReactToastify.css";

/* ============================================================
   AEROSYNX UAV DIGITAL TWIN COMMAND CENTER
   ============================================================

   BACKEND
      |
      | WebSocket
      v
   ws://localhost:8080/telemetry
      |
      v
   App.jsx
      |
      v
   UAVNewModel

   FAULT INJECTION
      |
      | POST
      v
   /api/fault/inject

   FAULT CLEAR
      |
      | POST
      v
   /api/fault/clear
   ============================================================ */


/* ============================================================
   CONFIGURATION
   ============================================================ */

const WS_URL =
  import.meta.env.VITE_WS_URL ||
  "ws://localhost:8080/telemetry";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:5001";

const FAULT_INJECT_URL =
  `${API_BASE}/api/fault/inject`;

const FAULT_CLEAR_URL =
  `${API_BASE}/api/fault/clear`;


/* ============================================================
   DEFAULT TELEMETRY
   ============================================================ */

const DEFAULT_READING = {
  rpm: 0,
  cht_c: 25,
  egt_c: 25,
  oil_press_bar: 0,
  oil_temp_c: 25,
  fuel_flow_lph: 0,
  vibration_g: 0,
  battery_v: 12,
  injection_deg: 0,
  roll_deg: 0,
  pitch_deg: 0,
  yaw_deg: 0,
};

const DEFAULT_PACKET = {
  reading: DEFAULT_READING,

  source: {},

  range_status: {},

  possible_faults: [],

  context: {
    active_fault: "none",
    mission_profile: "normal_cruise",
  },

  api: {
    connected: false,
  },
};


/* ============================================================
   FAULT DEFINITIONS
   ============================================================ */

const FAULTS = [
  {
    id: "none",
    name: "No Fault",
    short: "NOMINAL",
    description: "Normal engine operation",
    severity: "normal",
  },

  {
    id: "misfire",
    name: "Misfire",
    short: "MISFIRE",
    description:
      "Combustion interruption / unstable firing",
    severity: "critical",
  },

  {
    id: "injector_abnormality",
    name: "Injector Abnormality",
    short: "INJECTOR",
    description:
      "Fuel injection abnormality",
    severity: "warning",
  },

  {
    id: "coking_degradation",
    name: "Coking Degradation",
    short: "COKING",
    description:
      "Deposit / thermal degradation",
    severity: "warning",
  },

  {
    id: "lubrication_issue",
    name: "Lubrication Issue",
    short: "LUBRICATION",
    description:
      "Low oil pressure / high oil temperature",
    severity: "critical",
  },

  {
    id: "sensor_drift",
    name: "Sensor Drift",
    short: "SENSOR DRIFT",
    description:
      "Sensor output deviation",
    severity: "warning",
  },

  {
    id: "combustion_instability",
    name: "Combustion Instability",
    short: "COMBUSTION",
    description:
      "Unstable combustion process",
    severity: "critical",
  },

  {
    id: "battery_alternator_health",
    name: "Battery / Alternator Health",
    short: "ELECTRICAL",
    description:
      "Charging system abnormality",
    severity: "warning",
  },

  {
    id: "injection_timing_issue",
    name: "Injection Timing Issue",
    short: "TIMING",
    description:
      "Injection timing outside expected range",
    severity: "critical",
  },
];


/* ============================================================
   MISSION PROFILES
   ============================================================ */

const MISSION_PROFILES = [
  {
    id: "normal_cruise",
    name: "Normal Cruise",
    icon: "✦",
  },

  {
    id: "high_altitude",
    name: "High Altitude",
    icon: "◈",
  },

  {
    id: "hot_weather",
    name: "Hot Weather",
    icon: "☀",
  },

  {
    id: "rapid_throttle",
    name: "Rapid Throttle",
    icon: "⚡",
  },
];


/* ============================================================
   ENGINE OPERATING RANGES
   ============================================================ */

const RANGES = {
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


/* ============================================================
   HELPERS
   ============================================================ */

function number(value, fallback = 0) {
  const n = Number(value);

  return Number.isFinite(n)
    ? n
    : fallback;
}


function format(value, digits = 1) {
  return number(value).toFixed(digits);
}


function clamp(value, min, max) {
  return Math.max(
    min,
    Math.min(max, value)
  );
}


function normalize(value, min, max) {
  if (max === min) return 0;

  return clamp(
    (number(value) - min) /
    (max - min),
    0,
    1
  );
}


function rangeStatus(field, value) {
  if (!RANGES[field]) {
    return "unknown";
  }

  const [min, max] =
    RANGES[field];

  const n = number(value);

  if (
    n < min ||
    n > max
  ) {
    return "danger";
  }

  const span = max - min;

  const warningMargin =
    span * 0.12;

  if (
    n <= min + warningMargin ||
    n >= max - warningMargin
  ) {
    return "warning";
  }

  return "normal";
}


function faultDetails(id) {
  return (
    FAULTS.find(
      (fault) =>
        fault.id === id
    ) || FAULTS[0]
  );
}


function prettyFault(id) {
  if (
    !id ||
    id === "none"
  ) {
    return "NOMINAL";
  }

  return id
    .replaceAll("_", " ")
    .toUpperCase();
}


/* ============================================================
   TELEMETRY NORMALIZATION
   ============================================================ */

function normalizePacket(raw) {
  if (
    !raw ||
    typeof raw !== "object"
  ) {
    return DEFAULT_PACKET;
  }

  const ENGINE_KEYS = ['rpm', 'cht_c', 'egt_c', 'oil_press_bar', 'oil_temp_c', 'fuel_flow_lph', 'vibration_g', 'battery_v', 'injection_deg', 'roll_deg', 'pitch_deg', 'yaw_deg', 'current_a', 'motor_temp_c'];
  const flatFromRaw = {};
  ENGINE_KEYS.forEach(k => { if (raw[k] !== undefined && raw[k] !== null) flatFromRaw[k] = raw[k]; });

  const reading = {
    ...DEFAULT_READING,
    ...flatFromRaw,
    ...(raw.reading || raw.current_state || {}),
  };

  const ai_prediction = raw.ai_prediction || raw.ai || {};

  const context = {
    active_fault:
      raw.context?.active_fault ??
      raw.active_fault ??
      ai_prediction.predicted_fault ??
      "none",

    mission_profile:
      raw.context?.mission_profile ??
      raw.mission_profile ??
      "normal_cruise",
  };

  return {
    ...DEFAULT_PACKET,

    ...raw,

    reading,

    current_state: raw.current_state || reading,

    source:
      raw.field_sources || raw.source || {},

    range_status:
      raw.range_status || {},

    possible_faults:
      raw.possible_faults || raw.engineering_faults || [],

    ai_prediction,

    temporal_analysis:
      raw.temporal_analysis || {},

    sensor_engine_fault:
      raw.sensor_engine_fault || {},

    cross_sensor_consistency:
      raw.cross_sensor_consistency || {},

    context,
  };
}


/* ============================================================
   SECTION HEADER
   ============================================================ */

function SectionHeader({
  eyebrow,
  title,
  right,
}) {
  return (
    <div className="section-header">

      <div>

        <div className="section-eyebrow">
          {eyebrow}
        </div>

        <div className="section-title">
          {title}
        </div>

      </div>

      {right && (
        <div className="section-right">
          {right}
        </div>
      )}

    </div>
  );
}


/* ============================================================
   TELEMETRY CARD
   ============================================================ */

function TelemetryCard({
  label,
  value,
  unit,
  field,
  icon,
  compact = false,
  digits,
}) {
  const status =
    rangeStatus(
      field,
      value
    );

  const displayDigits = digits !== undefined ? digits : (field === "vibration_g" ? 4 : 1);

  return (
    <div
      className={`
        telemetry-card
        telemetry-${status}
        ${compact ? "telemetry-compact" : ""}
      `}
    >

      <div className="telemetry-card-top">

        <span className="telemetry-icon">
          {icon}
        </span>

        <span className="telemetry-label">
          {label}
        </span>

        <span
          className={`
            telemetry-dot
            dot-${status}
          `}
        />

      </div>

      <div className="telemetry-value">
        {format(value, displayDigits)}
      </div>

      <div className="telemetry-unit">
        {unit}
      </div>

      <div className="telemetry-mini-bar">

        <div
          style={{
            width: `${normalize(
              value,
              ...(RANGES[field] || [
                0,
                100,
              ])
            ) * 100
              }%`,
          }}
        />

      </div>

    </div>
  );
}


/* ============================================================
   SOURCE BADGE
   ============================================================ */

function SourceBadge({
  value,
}) {
  const isHardware =
    value === "HW" ||
    value === "REAL HARDWARE" ||
    value ===
    "REAL HARDWARE / API";

  return (
    <span
      className={`
        source-badge
        ${isHardware
          ? "source-hw"
          : "source-sim"
        }
      `}
    >
      {isHardware
        ? "HW"
        : "SIM"}
    </span>
  );
}


/* ============================================================
   HEALTH RING
   ============================================================ */

function HealthRing({
  health,
}) {
  const radius = 52;

  const circumference =
    2 * Math.PI * radius;

  const offset =
    circumference -
    (clamp(
      health,
      0,
      100
    ) /
      100) *
    circumference;

  let state = "HEALTHY";

  if (health < 70) {
    state = "CAUTION";
  }

  if (health < 45) {
    state = "CRITICAL";
  }

  return (
    <div className="health-ring-wrapper">

      <svg
        className="health-ring"
        width="134"
        height="134"
        viewBox="0 0 134 134"
      >

        <circle
          className="health-ring-bg"
          cx="67"
          cy="67"
          r={radius}
        />

        <circle
          className={`
            health-ring-progress
            health-${state.toLowerCase()}
          `}
          cx="67"
          cy="67"
          r={radius}
          strokeDasharray={
            circumference
          }
          strokeDashoffset={
            offset
          }
        />

      </svg>

      <div className="health-ring-content">

        <strong>
          {Math.round(health)}
        </strong>

        <span>
          %
        </span>

      </div>

      <div className="health-ring-label">
        {state}
      </div>

    </div>
  );
}


/* ============================================================
   LIVE GRAPH
   ============================================================ */

function LiveGraph({
  data,
  min,
  max,
}) {
  const width = 420;
  const height = 100;

  const points = data
    .slice(-40)
    .map(
      (
        value,
        index,
        arr
      ) => {
        const x =
          arr.length <= 1
            ? 0
            : (index /
              (arr.length - 1)) *
            width;

        const y =
          height -
          normalize(
            value,
            min,
            max
          ) *
          (height - 10) -
          5;

        return `${x},${y}`;
      }
    )
    .join(" ");

  return (
    <svg
      className="live-graph"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
    >

      <line
        x1="0"
        y1="25"
        x2={width}
        y2="25"
        className="graph-grid"
      />

      <line
        x1="0"
        y1="50"
        x2={width}
        y2="50"
        className="graph-grid"
      />

      <line
        x1="0"
        y1="75"
        x2={width}
        y2="75"
        className="graph-grid"
      />

      {points && (
        <polyline
          points={points}
          fill="none"
          className="graph-line"
        />
      )}

    </svg>
  );
}


/* ============================================================
   FAULT INJECTION PANEL
   ============================================================ */

function FaultInjection({
  selectedFault,
  setSelectedFault,
  selectedProfile,
  setSelectedProfile,
  onInject,
  onClear,
  injecting,
}) {
  const selected =
    faultDetails(
      selectedFault
    );

  return (
    <div className="fault-panel">

      <SectionHeader
        eyebrow="SCENARIO CONTROL"
        title="FAULT INJECTION"
        right={
          <span className="simulation-chip">
            SIMULATION
          </span>
        }
      />

      <div className="fault-warning">

        <div className="fault-warning-icon">
          !
        </div>

        <div>

          <strong>
            DIGITAL TWIN TEST MODE
          </strong>

          <p>
            Inject a controlled
            engine fault and
            observe the
            corresponding
            virtual engine
            response.
          </p>

        </div>

      </div>


      <div className="control-label">
        SELECT FAILURE MODE
      </div>


      <select
        className="fault-select"
        value={selectedFault}
        onChange={(e) =>
          setSelectedFault(
            e.target.value
          )
        }
      >

        {FAULTS.map(
          (fault) => (
            <option
              key={fault.id}
              value={fault.id}
            >
              {fault.name}
            </option>
          )
        )}

      </select>


      <div className="fault-description">

        <div
          className={`
            severity-marker
            severity-${selected.severity}
          `}
        />

        <div>

          <strong>
            {selected.name}
          </strong>

          <span>
            {selected.description}
          </span>

        </div>

      </div>


      <div className="control-label">
        MISSION PROFILE
      </div>


      <div className="profile-grid">

        {MISSION_PROFILES.map(
          (profile) => (
            <button
              type="button"
              key={profile.id}
              className={`
                profile-button
                ${selectedProfile ===
                  profile.id
                  ? "profile-active"
                  : ""
                }
              `}
              onClick={() =>
                setSelectedProfile(
                  profile.id
                )
              }
            >

              <span>
                {profile.icon}
              </span>

              {profile.name}

            </button>
          )
        )}

      </div>


      <div className="fault-actions">

        <button
          type="button"
          className="inject-button"
          onClick={onInject}
          disabled={injecting}
        >

          <span className="inject-icon">
            {injecting
              ? "◌"
              : "⚠"}
          </span>

          {injecting
            ? "INJECTING..."
            : "INJECT FAULT"}

        </button>


        <button
          type="button"
          className="clear-button"
          onClick={onClear}
          disabled={injecting}
        >
          CLEAR
        </button>

      </div>

    </div>
  );
}


/* ============================================================
   APP
   ============================================================ */

export default function App() {

  const [
    packet,
    setPacket,
  ] = useState(
    DEFAULT_PACKET
  );


  const [
    connected,
    setConnected,
  ] = useState(false);


  const [
    lastUpdate,
    setLastUpdate,
  ] = useState(null);


  const [
    selectedFault,
    setSelectedFault,
  ] = useState("none");


  const [
    selectedProfile,
    setSelectedProfile,
  ] = useState(
    "normal_cruise"
  );


  const [
    injecting,
    setInjecting,
  ] = useState(false);


  const [
    alarmActive,
    setAlarmActive,
  ] = useState(false);


  const [
    rpmHistory,
    setRpmHistory,
  ] = useState([]);


  const [
    egtHistory,
    setEgtHistory,
  ] = useState([]);

  const socketRef = useRef(null);
  const reconnectRef = useRef(null);
  const alarmTimerRef = useRef(null);
  const lastReceiveTimeRef = useRef(null);


  const [activeTab, setActiveTab] = useState(() => {
    try {
      return localStorage.getItem("aerosynx_active_tab") || "overview";
    } catch (e) {
      return "overview";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("aerosynx_active_tab", activeTab);
    } catch (e) { }
  }, [activeTab]);

  const [activeMission, setActiveMission] = useState(() => {
    try {
      const saved = localStorage.getItem("aerosynx_active_mission");
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (activeMission) {
        localStorage.setItem("aerosynx_active_mission", JSON.stringify(activeMission));
      } else {
        localStorage.removeItem("aerosynx_active_mission");
      }
    } catch (e) { }
  }, [activeMission]);

  const [missionResult, setMissionResult] = useState(null);
  const [missionRuns, setMissionRuns] = useState(() => {
    try {
      const saved = localStorage.getItem("aerosynx_recorded_missions");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [simulatingMission, setSimulatingMission] = useState(false);
  const [selectedReplayId, setSelectedReplayId] = useState(null);
  const [replayData, setReplayData] = useState(null);

  const fetchMissionGuardLatest = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/missionguard/latest`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.status !== "NO_MISSION_SIMULATION") {
          setMissionResult(data);
        }
      }
    } catch (e) {
      // Ignore
    }
  }, []);

  const fetchMissionRuns = useCallback(async () => {
    let localSaved = [];
    try {
      localSaved = JSON.parse(localStorage.getItem("aerosynx_recorded_missions") || "[]");
    } catch (e) { }

    try {
      const res = await fetch(`${API_BASE}/api/mission/runs`);
      if (res.ok) {
        const data = await res.json();
        if (data && data.missions) {
          const combined = [...localSaved];
          data.missions.forEach((m) => {
            if (m.samples && m.samples.length > 0 && !combined.some((c) => c.mission_id === m.mission_id)) {
              combined.push(m);
            }
          });
          setMissionRuns(combined);
          return;
        }
      }
    } catch (e) { }

    setMissionRuns(localSaved);
  }, []);

  useEffect(() => {
    const handleUpdate = () => {
      fetchMissionRuns();
    };
    window.addEventListener("aerosynx_mission_updated", handleUpdate);
    window.addEventListener("storage", handleUpdate);
    return () => {
      window.removeEventListener("aerosynx_mission_updated", handleUpdate);
      window.removeEventListener("storage", handleUpdate);
    };
  }, [fetchMissionRuns]);

  const handleSimulateMission = async (formValues) => {
    setSimulatingMission(true);
    try {
      const customName = (formValues.name || "PATROL MISSION DELTA - 01").toUpperCase();

      try {
        const response = await fetch(`${API_BASE}/api/missionguard/simulate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(formValues),
        });
        if (response.ok) {
          const data = await response.json();
          setMissionResult(data);
        }
      } catch (e) { }

      toast.success(`Created ideal shadow mission profile "${customName}"`, {
        position: "top-right",
        autoClose: 3500,
        theme: "dark",
      });
    } catch (err) {
      // Ignore
    } finally {
      setSimulatingMission(false);
    }
  };

  const handleReplayMission = async (missionId) => {
    try {
      const response = await fetch(`${API_BASE}/api/mission/replay/${missionId}`);
      if (response.ok) {
        const data = await response.json();
        setReplayData(data);
        setSelectedReplayId(missionId);
        toast.info(`Loaded replay for mission ${missionId}`, {
          position: "top-right",
          autoClose: 3000,
          theme: "dark",
        });
      }
    } catch (err) {
      toast.error("Failed to load mission replay", {
        position: "top-right",
        autoClose: 3500,
        theme: "dark",
      });
    }
  };



  const reading =
    packet.reading ||
    DEFAULT_READING;


  const context =
    packet.context ||
    {};


  const activeFault =
    context.active_fault ||
    "none";


  const missionProfile =
    context.mission_profile ||
    "normal_cruise";


  const activeFaultInfo =
    faultDetails(
      activeFault
    );


  const engineRunning =
    number(reading.rpm) >
    200;


  /* ==========================================================
     HEALTH CALCULATION
     ========================================================== */

  const health = useMemo(() => {

    let score = 100;

    const checks = [

      [
        "rpm",
        reading.rpm,
      ],

      [
        "cht_c",
        reading.cht_c,
      ],

      [
        "egt_c",
        reading.egt_c,
      ],

      [
        "oil_press_bar",
        reading.oil_press_bar,
      ],

      [
        "oil_temp_c",
        reading.oil_temp_c,
      ],

      [
        "fuel_flow_lph",
        reading.fuel_flow_lph,
      ],

      [
        "vibration_g",
        reading.vibration_g,
      ],

      [
        "battery_v",
        reading.battery_v,
      ],

      [
        "injection_deg",
        reading.injection_deg,
      ],
    ];


    checks.forEach(
      ([field, value]) => {

        const status =
          rangeStatus(
            field,
            value
          );

        if (
          status ===
          "danger"
        ) {
          score -= 8;
        }

        if (
          status ===
          "warning"
        ) {
          score -= 2;
        }

      }
    );


    if (
      activeFault !==
      "none"
    ) {

      const info =
        faultDetails(
          activeFault
        );

      if (
        info.severity ===
        "critical"
      ) {
        score -= 20;
      } else {
        score -= 10;
      }

    }


    return clamp(
      score,
      0,
      100
    );

  }, [
    reading,
    activeFault,
  ]);


  /* ==========================================================
     UNIFIED TELEMETRY HANDLER
     ========================================================== */

  const handleIncomingData = useCallback((raw) => {
    try {
      const normalized = normalizePacket(raw);
      lastReceiveTimeRef.current = Date.now();
      setPacket(normalized);
      setConnected(true);
      setLastUpdate(new Date());

      const r = normalized.reading;
      if (r) {
        setRpmHistory((prev) =>
          [...prev, number(r.rpm)].slice(-50)
        );
        setEgtHistory((prev) =>
          [...prev, number(r.egt_c)].slice(-50)
        );
      }
    } catch (error) {
      console.warn("[AeroSynX] Invalid telemetry packet:", error);
    }
  }, []);


  const [globalFault, setGlobalFault] = useState("none");
  const [globalMission, setGlobalMission] = useState("normal_cruise");

  const handleVirtualEngineTelemetry = useCallback((data) => {
    // Update readings directly from VirtualEngine
    handleIncomingData({
      reading: data.reading,
      source: { data_source: data.dataSource || "virtual_engine" },
      context: {
        active_fault: data.fault,
        mission_profile: data.mission
      },
      ai_prediction: {
        predicted_fault: data.fault
      }
    });
  }, [handleIncomingData]);

  // Also poll the AI backend to get enriched diagnostics data
  // The VirtualEngine provides live readings; the Python server provides AI analysis
  useEffect(() => {
    let isFetching = false;
    const fetchAIEnrichedTelemetry = async () => {
      if (isFetching) return;
      isFetching = true;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 400);

      try {
        const response = await fetch(`${API_BASE}/api/telemetry?t=${Date.now()}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (response.ok) {
          const raw = await response.json();
          setConnected(true);
          setLastUpdate(new Date());

          setPacket(prev => {
            const prevReading = prev?.reading || {};
            const rawReading = raw?.reading || raw?.current_state || {};
            const mergedReading = { ...prevReading, ...rawReading };

            return {
              ...prev,
              ...raw,
              reading: mergedReading,
              current_state: raw.current_state || mergedReading,
              ai_prediction: raw.ai_prediction || raw.ai || prev.ai_prediction || {},
              temporal_analysis: raw.temporal_analysis || prev.temporal_analysis || {},
              sensor_engine_fault: raw.sensor_engine_fault || prev.sensor_engine_fault || {},
              cross_sensor_consistency: raw.cross_sensor_consistency || prev.cross_sensor_consistency || {},
              possible_faults: raw.possible_faults || raw.engineering_faults || prev.possible_faults || [],
              range_status: raw.range_status || prev.range_status || {},
              operating_limits: raw.operating_limits || raw.operating_limit_panel || prev.operating_limits || {},
              model_validity: raw.model_validity || raw.uncertainty_model_validity_gate || prev.model_validity || {},
              sensor_quality: raw.sensor_quality || raw.sensor_data_quality || prev.sensor_quality || {},
              flight_envelope: raw.flight_envelope || prev.flight_envelope || {},
            };
          });
        }
      } catch {
        // Backend offline or timeout; VirtualEngine provides smooth fallback
      } finally {
        clearTimeout(timeoutId);
        isFetching = false;
      }
    };

    fetchMissionGuardLatest();
    fetchMissionRuns();

    fetchAIEnrichedTelemetry();
    const pollInterval = setInterval(fetchAIEnrichedTelemetry, 250);
    const slowPollInterval = setInterval(() => {
      fetchMissionGuardLatest();
      fetchMissionRuns();
    }, 2000);

    return () => {
      clearInterval(pollInterval);
      clearInterval(slowPollInterval);
      if (alarmTimerRef.current) {
        clearTimeout(alarmTimerRef.current);
      }
    };
  }, [handleIncomingData, fetchMissionGuardLatest, fetchMissionRuns]);




  /* ==========================================================
     FAULT ALARM
     ========================================================== */

  useEffect(() => {

    if (
      activeFault &&
      activeFault !==
      "none"
    ) {

      setAlarmActive(
        true
      );


      if (
        alarmTimerRef.current
      ) {

        clearTimeout(
          alarmTimerRef.current
        );

      }


      alarmTimerRef.current =
        setTimeout(() => {

          setAlarmActive(
            false
          );

        }, 10000);

    } else {

      setAlarmActive(
        false
      );

    }

  }, [
    activeFault,
  ]);


  /* ==========================================================
     AUDIO ALARM
     ========================================================== */

  const playAlarm =
    useCallback(() => {

      try {

        const AudioContext =
          window.AudioContext ||
          window.webkitAudioContext;


        if (
          !AudioContext
        ) {
          return;
        }


        const audio =
          new AudioContext();


        const start =
          audio.currentTime;


        for (
          let i = 0;
          i < 10;
          i++
        ) {

          const oscillator =
            audio.createOscillator();


          const gain =
            audio.createGain();


          oscillator.type =
            "square";


          oscillator.frequency.value =
            i % 2 === 0
              ? 880
              : 660;


          gain.gain.setValueAtTime(
            0.0001,
            start + i
          );


          gain.gain.exponentialRampToValueAtTime(
            0.16,
            start + i + 0.02
          );


          gain.gain.exponentialRampToValueAtTime(
            0.0001,
            start + i + 0.35
          );


          oscillator.connect(
            gain
          );

          gain.connect(
            audio.destination
          );


          oscillator.start(
            start + i
          );


          oscillator.stop(
            start + i + 0.4
          );

        }


        setTimeout(() => {

          audio.close();

        }, 11000);

      } catch (error) {

        console.warn(
          "Audio alarm unavailable",
          error
        );

      }

    }, []);


  const injectFault = async () => {
    setInjecting(true);
    try {
      setGlobalFault(selectedFault);
      setGlobalMission(selectedProfile);

      if (selectedFault === "none") {
        toast.success("Engine returned to nominal state", {
          position: "top-right",
          autoClose: 3000,
          theme: "dark",
        });
      } else {
        toast.error(`${prettyFault(selectedFault)} injected successfully`, {
          position: "top-right",
          autoClose: 4000,
          theme: "dark",
        });
      }

      setAlarmActive(selectedFault !== "none");
      if (selectedFault !== "none") {
        playAlarm();
      }
    } finally {
      setInjecting(false);
    }
  };


  const clearFault = async () => {
    setInjecting(true);
    try {
      setGlobalFault("none");

      toast.success("Fault cleared — engine returning to nominal state", {
        position: "top-right",
        autoClose: 3500,
        theme: "dark",
      });

      setAlarmActive(false);
    } finally {
      setInjecting(false);
    }
  };


  /* ==========================================================
     SOURCE
     ========================================================== */

  const source =
    packet.source || {};


  /* ==========================================================
     TIME
     ========================================================== */

  const updateText =
    lastUpdate
      ? lastUpdate.toLocaleTimeString()
      : "--:--:--";


  /* ==========================================================
     RENDER
     ========================================================== */

  return (
    <div className="aerosynx-app">

      {/* ======================================================
          TOP COMMAND BAR
          ====================================================== */}

      <header className="top-command-bar">

        <div className="brand-block" style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <img
            src="/logo.png"
            alt="AeroSynX Logo"
            style={{
              height: "54px",
              width: "54px",
              objectFit: "cover",
              borderRadius: "50%",
              background: "#000000",
              border: "2px solid #eab308",
              boxShadow: "0 0 12px rgba(234, 179, 8, 0.4)",
              display: "block"
            }}
          />
          <div>
            <div className="brand-name" style={{ fontSize: "16px", fontWeight: "900", letterSpacing: "2px" }}>
              AEROSYNX
            </div>
            <div className="brand-subtitle" style={{ fontSize: "8.5px", color: "#627d94", letterSpacing: "1px" }}>
              IDEAS TODAY • DEFENCE TOMORROW
            </div>
          </div>
        </div>

        <div className="mission-identity">
          <span className="identity-label">

          </span>
          <strong>

          </strong>
          <span className="identity-divider">

          </span>
          <span>

          </span>
        </div>


        <div className="top-status">

          <div className="top-status-item">

            <span className="status-light green" />

            <div>

              <small>
                DIGITAL TWIN
              </small>

              <strong>
                ONLINE
              </strong>

            </div>

          </div>


          <div className="top-status-item">

            <span
              className={`
                status-light
                ${connected
                  ? "green"
                  : "red"
                }
              `}
            />

            <div>

              <small>
                TELEMETRY
              </small>

              <strong>
                {connected
                  ? "LIVE"
                  : "OFFLINE"}
              </strong>

            </div>

          </div>


          <div className="utc-clock">
            {updateText}
          </div>

          {/* Source Virtual Engine Action Button */}
          <button
            type="button"
            onClick={() => {
              setActiveTab("virtualengine");
              setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
            }}
            style={{
              background: activeTab === "virtualengine"
                ? "linear-gradient(135deg, #00d69d, #009968)"
                : "linear-gradient(135deg, #0f1c2b, #162a3f)",
              color: activeTab === "virtualengine" ? "#031710" : "#38c0e8",
              border: `1px solid ${activeTab === "virtualengine" ? "#00d69d" : "#24405a"}`,
              borderRadius: "8px",
              padding: "7px 14px",
              fontSize: "10.5px",
              fontWeight: "900",
              letterSpacing: "1px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              boxShadow: "0 2px 12px rgba(0, 214, 157, 0.15)",
              transition: "all 0.2s ease"
            }}
          >
            <span>⚙️</span> SOURCE / DIGITAL TWIN
          </button>

        </div>

      </header>


      {/* ======================================================
          COMMAND NAVIGATION TABS
          ====================================================== */}
      <nav style={{
        display: "flex",
        gap: "6px",
        padding: "0 18px",
        background: "#080d14",
        borderBottom: "1px solid #17212c",
        overflowX: "auto",
        flexShrink: 0
      }}>
        {[
          { id: "overview", label: "OVERVIEW & DIGITAL TWIN", icon: "⌂" },
          { id: "missionguard", label: "MISSIONGUARD & FEASIBILITY", icon: "🛡" },
          { id: "diagnostics", label: "AI DIAGNOSTICS & ENVELOPE", icon: "◈" },
          { id: "history", label: "MISSION REPLAY", icon: "🕒" },
          { id: "simulation", label: "BASE STATION REPAIR & MITIGATION", icon: "🛠️" },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "11px 18px",
              background: activeTab === tab.id ? "rgba(0, 214, 157, 0.12)" : "transparent",
              border: "none",
              borderBottom: activeTab === tab.id ? "2px solid #00d69d" : "2px solid transparent",
              color: activeTab === tab.id ? "#00d69d" : "#71899c",
              fontSize: "11px",
              fontWeight: "800",
              letterSpacing: "1.2px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              whiteSpace: "nowrap",
              transition: "all 0.2s ease"
            }}
          >
            <span style={{ fontSize: "14px" }}>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </nav>


      {/* ======================================================
          MAIN GRID (OVERVIEW TAB)
          ====================================================== */}

      {activeTab === "overview" && (
        <main style={{ overflowY: "auto", height: "calc(100vh - 110px)" }}>
          <div className="dashboard-grid">
            {/* ====================================================
            LEFT COLUMN
            ==================================================== */}

            <section className="left-column">


              {/* ENGINE READINESS */}

              <div className="panel readiness-panel">

                <SectionHeader
                  eyebrow="SYSTEM MONITOR"
                  title="ENGINE READINESS"
                  right={
                    <span className="live-chip">
                      ● LIVE
                    </span>
                  }
                />


                <div className="readiness-content">

                  <HealthRing
                    health={health}
                  />


                  <div className="readiness-stats">

                    <div className="readiness-row">

                      <span>
                        ENGINE STATE
                      </span>

                      <strong
                        className={
                          engineRunning
                            ? "text-green"
                            : "text-red"
                        }
                      >
                        {engineRunning
                          ? "RUNNING"
                          : "OFFLINE"}
                      </strong>

                    </div>


                    <div className="readiness-row">

                      <span>
                        HEALTH INDEX
                      </span>

                      <strong>
                        {Math.round(
                          health
                        )}
                        /100
                      </strong>

                    </div>


                    <div className="readiness-row">

                      <span>
                        ACTIVE SCENARIO
                      </span>

                      <strong
                        className={
                          activeFault ===
                            "none"
                            ? "text-green"
                            : "text-danger"
                        }
                      >
                        {prettyFault(
                          activeFault
                        )}
                      </strong>

                    </div>


                    <div className="readiness-row">

                      <span>
                        PROFILE
                      </span>

                      <strong>
                        {missionProfile
                          .replaceAll(
                            "_",
                            " "
                          )
                          .toUpperCase()}
                      </strong>

                    </div>

                  </div>

                </div>


                <div className="system-bars">

                  <div className="system-bar-row">

                    <span>
                      ENGINE CORE
                    </span>

                    <div className="progress-track">

                      <div
                        style={{
                          width:
                            `${health}%`,
                        }}
                      />

                    </div>

                    <b>
                      {Math.round(
                        health
                      )}
                      %
                    </b>

                  </div>


                  <div className="system-bar-row">

                    <span>
                      SENSOR LINK
                    </span>

                    <div className="progress-track">

                      <div
                        style={{
                          width:
                            connected
                              ? "100%"
                              : "15%",
                        }}
                      />

                    </div>

                    <b>
                      {connected
                        ? "100%"
                        : "15%"}
                    </b>

                  </div>


                  <div className="system-bar-row">

                    <span>
                      DATA FUSION
                    </span>

                    <div className="progress-track">

                      <div
                        style={{
                          width:
                            "92%",
                        }}
                      />

                    </div>

                    <b>
                      92%
                    </b>

                  </div>

                </div>

              </div>


              {/* ENGINE TELEMETRY */}

              <div className="panel">

                <SectionHeader
                  eyebrow="REAL-TIME DIAGNOSTICS"
                  title="ENGINE TELEMETRY"
                />


                <div className="telemetry-grid">

                  <TelemetryCard
                    label="RPM"
                    value={
                      reading.rpm
                    }
                    unit="REV/MIN"
                    field="rpm"
                    icon="◉"
                  />


                  <TelemetryCard
                    label="CHT"
                    value={
                      reading.cht_c
                    }
                    unit="°C"
                    field="cht_c"
                    icon="♨"
                  />


                  <TelemetryCard
                    label="EGT"
                    value={
                      reading.egt_c
                    }
                    unit="°C"
                    field="egt_c"
                    icon="♨"
                  />


                  <TelemetryCard
                    label="OIL PRESS"
                    value={
                      reading.oil_press_bar
                    }
                    unit="BAR"
                    field="oil_press_bar"
                    icon="◌"
                  />


                  <TelemetryCard
                    label="OIL TEMP"
                    value={
                      reading.oil_temp_c
                    }
                    unit="°C"
                    field="oil_temp_c"
                    icon="◇"
                  />


                  <TelemetryCard
                    label="FUEL FLOW"
                    value={
                      reading.fuel_flow_lph
                    }
                    unit="L/H"
                    field="fuel_flow_lph"
                    icon="⇩"
                  />


                  <TelemetryCard
                    label="VIBRATION"
                    value={
                      reading.vibration_g
                    }
                    unit="G"
                    field="vibration_g"
                    icon="⌁"
                  />


                  <TelemetryCard
                    label="BATTERY"
                    value={
                      reading.battery_v
                    }
                    unit="V"
                    field="battery_v"
                    icon="▣"
                  />


                  <TelemetryCard
                    label="INJECTION"
                    value={
                      reading.injection_deg
                    }
                    unit="DEG BTDC"
                    field="injection_deg"
                    icon="◈"
                  />

                </div>

              </div>




            </section>


            {/* ====================================================
            CENTER COLUMN
            ==================================================== */}

            <section className="center-column">


              {/* VIRTUAL ENGINE */}

              <div
                className={`
              panel
              twin-panel
              ${activeFault !==
                    "none"
                    ? "twin-fault-active"
                    : ""
                  }
            `}
              >

                <div className="twin-header">

                  <div>

                    <div className="section-eyebrow">
                      VIRTUAL ENGINE
                    </div>

                    <div className="twin-title">
                      3D DIGITAL TWIN
                    </div>

                  </div>


                  <div className="twin-header-right">

                    <div className="twin-mode">

                      <span className="status-light green" />

                      REACTIVE MODEL

                    </div>


                    <div className="twin-mode">

                      {connected
                        ? "200 MS"
                        : "--"}

                    </div>

                  </div>

                </div>


                {/* FAULT ALERT */}

                {activeFault !==
                  "none" && (

                    <div className="twin-fault-banner">

                      <div className="fault-pulse">
                        !
                      </div>

                      <div>

                        <strong>
                          {prettyFault(
                            activeFault
                          )}
                        </strong>

                        <span>
                          FAULT DETECTED •
                          VIRTUAL ENGINE
                          RESPONSE ACTIVE
                        </span>

                      </div>


                      {alarmActive && (

                        <div className="alarm-badge">
                          ALARM
                        </div>

                      )}

                    </div>

                  )}


                {/* 3D MODEL */}

                <div className="twin-view">

                  <UAVNewModel
                    packet={
                      packet
                    }
                    showOverlay={
                      false
                    }
                    width="100%"
                    height="100%"
                  />


                  <div className="twin-corner top-left">
                    AX / DT-01
                  </div>


                  <div className="twin-corner top-right">

                    {engineRunning
                      ? "ENGINE LIVE"
                      : "ENGINE OFF"}

                  </div>


                  <div className="twin-corner bottom-left">
                    DRAG TO ORBIT
                  </div>


                  <div className="twin-corner bottom-right">

                    PITCH{" "}
                    {format(
                      reading.pitch_deg
                    )}
                    °{"  "}

                    YAW{" "}
                    {format(
                      reading.yaw_deg
                    )}
                    °

                  </div>


                  {/* ENGINE HOTSPOTS */}

                  <div className="engine-hotspots">

                    <div
                      className={`
                    hotspot
                    ${rangeStatus(
                        "cht_c",
                        reading.cht_c
                      )
                        }
                  `}
                    >

                      <span />

                      CYLINDER HEAD

                    </div>


                    <div
                      className={`
                    hotspot
                    ${rangeStatus(
                        "egt_c",
                        reading.egt_c
                      )
                        }
                  `}
                    >

                      <span />

                      EXHAUST

                    </div>


                    <div
                      className={`
                    hotspot
                    ${rangeStatus(
                        "oil_press_bar",
                        reading.oil_press_bar
                      )
                        }
                  `}
                    >

                      <span />

                      OIL SYSTEM

                    </div>


                    <div
                      className={`
                    hotspot
                    ${rangeStatus(
                        "injection_deg",
                        reading.injection_deg
                      )
                        }
                  `}
                    >

                      <span />

                      INJECTOR

                    </div>

                  </div>

                </div>


                {/* ENGINE FOOTER */}

                <div className="twin-footer">

                  <div className="twin-stat">

                    <span>
                      RPM
                    </span>

                    <strong>
                      {format(
                        reading.rpm,
                        0
                      )}
                    </strong>

                  </div>


                  <div className="twin-stat">

                    <span>
                      CHT
                    </span>

                    <strong>
                      {format(
                        reading.cht_c
                      )}
                      °C
                    </strong>

                  </div>


                  <div className="twin-stat">

                    <span>
                      EGT
                    </span>

                    <strong>
                      {format(
                        reading.egt_c
                      )}
                      °C
                    </strong>

                  </div>


                  <div className="twin-stat">

                    <span>
                      VIB
                    </span>

                    <strong>
                      {format(
                        reading.vibration_g,
                        3
                      )}
                      G
                    </strong>

                  </div>


                  <div className="twin-stat">

                    <span>
                      OIL
                    </span>

                    <strong>
                      {format(
                        reading.oil_press_bar
                      )}
                      {" "}
                      BAR
                    </strong>

                  </div>

                </div>

              </div>




            </section>


            {/* ====================================================
            RIGHT COLUMN
            ==================================================== */}

            <section className="right-column">


              {/* FAULT STATUS */}

              <div
                className={`
              panel
              fault-status-panel
              ${activeFault !==
                    "none"
                    ? "fault-status-active"
                    : ""
                  }
            `}
              >

                <SectionHeader
                  eyebrow="DIAGNOSTIC ENGINE"
                  title="FAULT STATUS"
                  right={

                    <span
                      className={`
                    status-pill
                    ${activeFault ===
                          "none"
                          ? "pill-green"
                          : "pill-red"
                        }
                  `}
                    >

                      {activeFault ===
                        "none"
                        ? "CLEAR"
                        : "ACTIVE"}

                    </span>

                  }
                />


                <div className="fault-status-main">

                  <div
                    className={`
                  fault-status-icon
                  ${activeFault ===
                        "none"
                        ? "icon-normal"
                        : "icon-fault"
                      }
                `}
                  >

                    {activeFault ===
                      "none"
                      ? "✓"
                      : "!"}

                  </div>


                  <div>

                    <strong>

                      {activeFault ===
                        "none"
                        ? "SYSTEM NOMINAL"
                        : prettyFault(
                          activeFault
                        )}

                    </strong>


                    <span>

                      {activeFault ===
                        "none"
                        ? "No active engine fault"
                        : activeFaultInfo.description}

                    </span>

                  </div>

                </div>


                {(() => {
                  const rawFaults = [...(packet.possible_faults || [])];
                  const aiPredicted = packet.ai?.predicted_fault;

                  if (aiPredicted && aiPredicted !== "none") {
                    const idx = rawFaults.indexOf(aiPredicted);
                    if (idx > -1) {
                      rawFaults.splice(idx, 1);
                    }
                    rawFaults.unshift(aiPredicted);
                  }

                  const displayFaults = rawFaults.slice(0, 2);

                  if (displayFaults.length === 0) return null;

                  return (
                    <div className="possible-faults">

                      <div className="mini-label">
                        POSSIBLE FAULT SIGNATURES (MAX 2)
                      </div>

                      {displayFaults.map((fault, index) => (

                        <div
                          className="possible-fault"
                          key={fault}
                        >

                          <i className="fault-icon">!</i>


                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                            <span>
                              {fault.replaceAll("_", " ")}
                            </span>

                            {index === 0 && (
                              <span style={{
                                fontSize: '7px',
                                fontWeight: '600',
                                padding: '1px 5px',
                                borderRadius: '3px',
                                background: 'rgba(255, 170, 0, 0.12)',
                                border: '1px solid rgba(255, 170, 0, 0.3)',
                                color: '#d9a04e',
                                textTransform: 'uppercase',
                                width: 'auto',
                                height: 'auto',
                                boxShadow: 'none'
                              }}>
                                MOST PROBABLE
                              </span>
                            )}
                          </div>

                        </div>

                      ))}

                    </div>
                  );
                })()}


              </div>


              {/* ELECTRICAL SYSTEM & PROGNOSTICS (POWER, CHARGING & ENERGY-TO-MISSION MARGIN) */}

              <div className="panel" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>

                <SectionHeader
                  eyebrow="ELECTRICAL SYSTEM & PROGNOSTICS"
                  title="POWER, CHARGING & ENERGY MARGIN"
                  right={
                    <span style={{
                      fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 4,
                      background: "rgba(0,214,157,0.12)", border: "1px solid rgba(0,214,157,0.3)",
                      color: "#00d69d"
                    }}>
                      ⚡
                    </span>
                  }
                />


                <div className="electrical-display">

                  <div className="battery-visual">

                    <div className="battery-body">

                      <div
                        className="battery-fill"
                        style={{
                          width:
                            `${clamp(
                              normalize(
                                reading.battery_v,
                                11,
                                15
                              ) * 100,
                              0,
                              100
                            )}%`,
                        }}
                      />


                      <div className="battery-cells">

                        <i />
                        <i />
                        <i />
                        <i />

                      </div>

                    </div>


                    <div className="battery-terminal" />

                  </div>


                  <div className="battery-value">

                    <strong>
                      {format(
                        reading.battery_v,
                        2
                      )}
                    </strong>

                    <span>
                      VOLTS
                    </span>

                  </div>

                </div>


                <div className="metric-list">

                  <div>

                    <span>
                      BATTERY STATUS
                    </span>

                    <strong
                      className={
                        rangeStatus(
                          "battery_v",
                          reading.battery_v
                        ) ===
                          "danger"
                          ? "text-danger"
                          : "text-green"
                      }
                    >

                      {rangeStatus(
                        "battery_v",
                        reading.battery_v
                      ) ===
                        "danger"
                        ? "ABNORMAL"
                        : "NOMINAL"}

                    </strong>

                  </div>


                  <div>

                    <span>
                      SENSOR SOURCE
                    </span>

                    <SourceBadge
                      value={
                        source.battery_v
                      }
                    />

                  </div>

                </div>

                {/* ── MERGED PROGNOSTICS RESEARCH: ENERGY-TO-MISSION MARGIN ── */}
                {(() => {
                  const battV = number(reading.battery_v, 14.1);
                  const battPct = clamp(((battV - 11.5) / (14.2 - 11.5)) * 100, 0, 100);
                  const totalEnduranceMin = Math.round(38 + (battPct / 100) * 8); // e.g. 42 min
                  const remainingMissionMin = 31; // e.g. 31 min
                  const energyMargin = totalEnduranceMin - remainingMissionMin; // e.g. +11 min

                  const isSufficient = energyMargin >= 5;
                  const isMarginal = energyMargin >= 0 && energyMargin < 5;
                  const statusColor = isSufficient ? "#2ecc71" : isMarginal ? "#f39c12" : "#e74c3c";
                  const statusText = isSufficient ? "Sufficient Energy" : isMarginal ? "Marginal Reserve" : "Insufficient Energy";
                  const statusIcon = isSufficient ? "✓" : isMarginal ? "⚠️" : "🚨";

                  return (
                    <div style={{
                      marginTop: "4px",
                      padding: "10px 12px",
                      background: "rgba(11, 21, 32, 0.95)",
                      border: `1px solid ${statusColor}44`,
                      borderRadius: 10,
                      display: "flex",
                      flexDirection: "column",
                      gap: 6
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 8, fontWeight: 800, color: "#38c0e8", letterSpacing: "1.2px" }}>
                          PROGNOSTICS RESEARCH • ENERGY-TO-MISSION MARGIN
                        </span>
                        <span style={{
                          fontSize: 8, fontWeight: 800, padding: "2px 6px", borderRadius: 4,
                          background: `${statusColor}18`, border: `1px solid ${statusColor}44`, color: statusColor
                        }}>
                          {statusText.toUpperCase()}
                        </span>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <div>
                          <div style={{ fontSize: 17, fontWeight: 900, fontFamily: "monospace", color: statusColor, display: "flex", alignItems: "baseline", gap: 6 }}>
                            <span>{energyMargin >= 0 ? `+${energyMargin}` : energyMargin} min</span>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#e1eaf2" }}>— {statusText}</span>
                          </div>
                          <div style={{ fontSize: 8, color: "#627d94", marginTop: 2 }}>
                            Est. Endurance ({totalEnduranceMin} min) − Remaining Mission ({remainingMissionMin} min)
                          </div>
                        </div>

                        <div style={{
                          width: 30, height: 30, borderRadius: "50%",
                          background: `${statusColor}22`, border: `1.5px solid ${statusColor}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 13, fontWeight: 900, color: statusColor, flexShrink: 0
                        }}>
                          {statusIcon}
                        </div>
                      </div>

                      <div style={{ fontSize: 8, color: "#8faec0", background: "#060d15", padding: "5px 8px", borderRadius: 6, border: "1px solid #142436", lineHeight: 1.3 }}>
                        💡 <em>UAV Battery Prognostics Insight:</em> Answers whether remaining energy is sufficient for this specific mission rather than relying only on battery percentage.
                      </div>
                    </div>
                  );
                })()}

              </div>


              {/* ATTITUDE */}

              <div className="panel attitude-panel">

                <SectionHeader
                  eyebrow="FLIGHT DYNAMICS"
                  title="ATTITUDE"
                />


                <div className="attitude-display">

                  <div className="attitude-circle">

                    <div
                      className="attitude-horizon"
                      style={{
                        transform: `rotate(${-number(reading.roll_deg)}deg) translateY(${number(reading.pitch_deg) * 1.8}px)`,
                      }}
                    >
                      <div className="attitude-sky" />
                      <div className="attitude-horizon-line" />
                      <div className="attitude-ground" />
                    </div>

                    <div className="attitude-aircraft">
                      <span />
                      <b />
                      <i />
                    </div>

                    <div className="attitude-crosshair">
                      +
                    </div>

                  </div>


                  <div className="attitude-values">

                    <div>

                      <span>
                        ROLL
                      </span>

                      <strong>
                        {format(
                          reading.roll_deg
                        )}
                        °
                      </strong>

                    </div>


                    <div>

                      <span>
                        PITCH
                      </span>

                      <strong>
                        {format(
                          reading.pitch_deg
                        )}
                        °
                      </strong>

                    </div>


                    <div>

                      <span>
                        YAW
                      </span>

                      <strong>
                        {format(
                          reading.yaw_deg
                        )}
                        °
                      </strong>

                    </div>

                  </div>

                </div>

              </div>




            </section>

          </div>
        </main>
      )}

      {/* ======================================================
          MISSIONGUARD & FEASIBILITY TAB
          ====================================================== */}
      {activeTab === "missionguard" && (
        <main style={{
          padding: "0",
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          height: "calc(100vh - 110px)",
          boxSizing: "border-box",
          background: "linear-gradient(180deg, #0d1117 0%, #0a0f1a 100%)"
        }}>

          {/* ── Live Backend Status Bar ── */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "8px 20px",
            background: connected ? "rgba(0,214,157,0.06)" : "rgba(224,82,82,0.06)",
            borderBottom: `1px solid ${connected ? "rgba(0,214,157,0.2)" : "rgba(224,82,82,0.2)"}`,
            flexShrink: 0
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: connected ? "#00d69d" : "#e05252",
              boxShadow: connected ? "0 0 8px #00d69d" : "0 0 8px #e05252",
              animation: connected ? "pulse 1.5s infinite" : "none",
              flexShrink: 0
            }} />
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: connected ? "#00d69d" : "#e05252", letterSpacing: "0.08em" }}>
              {connected ? "BACKEND CONNECTED — AI ANALYSIS LIVE" : "BACKEND OFFLINE — Reconnecting..."}
            </span>
            <span style={{ marginLeft: "auto", fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: "#3a4558" }}>
              {lastUpdate ? `LAST UPDATE: ${lastUpdate.toLocaleTimeString()}` : "—"}
            </span>
          </div>

          <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "16px" }}>

            {/* ── ROW 1: UNIFIED MISSION SHADOW TRAJECTORY (HERO FEATURE — IMMEDIATELY VISIBLE!) ── */}
            <MissionShadowGraph missionResult={missionResult} packet={packet} />

            {/* ── ROW 2: Simulator + Recommendation + Feasibility ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", alignItems: "stretch" }}>
              <MissionGuardSimulator onSimulate={handleSimulateMission} loading={simulatingMission} />
              <MissionRecommendationPanel missionResult={missionResult} />
              <MissionFeasibilityPanel missionResult={missionResult} />
            </div>

            {/* ── ROW 3: Energy-to-Mission Margin + Capability + Limits + Phase Timeline ── */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", alignItems: "stretch" }}>
              <EnergyToMissionMarginPanel packet={packet} missionResult={missionResult} />
              <EngineCapabilityPanel missionResult={missionResult} aiResult={packet} />
              <OperatingLimitsPanel aiResult={packet} missionResult={missionResult} />
            </div>

          </div>
        </main>
      )}

      {/* ======================================================
          AI DIAGNOSTICS & CAPABILITY TAB
          ====================================================== */}
      {activeTab === "diagnostics" && (
        <main style={{
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          height: "calc(100vh - 110px)",
          boxSizing: "border-box",
          background: "linear-gradient(180deg, #0d1117 0%, #0a0f1a 100%)"
        }}>

          {/* ── Live Backend Status Bar ── */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "8px 20px",
            background: connected ? "rgba(0,214,157,0.06)" : "rgba(224,82,82,0.06)",
            borderBottom: `1px solid ${connected ? "rgba(0,214,157,0.2)" : "rgba(224,82,82,0.2)"}`,
            flexShrink: 0
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: "50%",
              background: connected ? "#00d69d" : "#e05252",
              boxShadow: connected ? "0 0 8px #00d69d" : "0 0 8px #e05252",
              animation: connected ? "pulse 1.5s infinite" : "none",
              flexShrink: 0
            }} />
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: connected ? "#00d69d" : "#e05252", letterSpacing: "0.08em" }}>
              {connected ? "AI ENGINE ONLINE — Anomaly Detection & Fault Prediction Active (500ms API)" : "AI ENGINE OFFLINE — Waiting for backend..."}
            </span>
            <span style={{ marginLeft: "auto", fontFamily: "'IBM Plex Mono', monospace", fontSize: 9, color: "#3a4558" }}>
              {lastUpdate ? `LAST UPDATE: ${lastUpdate.toLocaleTimeString()} | ` : ""}SRC: VIRTUAL ENGINE + AI STACK
            </span>
          </div>

          <div style={{ padding: "16px 20px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", alignContent: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <SensorEngineFaultPanel aiResult={packet} />
              <ModelValidityPanel aiResult={packet} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <CrossSensorConsistencyPanel aiResult={packet} />
              <DegradationPanel aiResult={packet} />
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <PredictedVsMeasuredChart aiResult={packet} />
              <SensorQualityPanel aiResult={packet} />
            </div>
          </div>
        </main>
      )}

      {/* ======================================================
          MISSION REVIEW & HISTORY TAB
          ====================================================== */}
      {activeTab === "history" && (
        <main style={{ overflowY: "auto", height: "calc(100vh - 110px)" }}>
          <MissionReplayReview
            completedMissions={missionRuns}
            onNavigateToMissionGuard={() => setActiveTab("missionguard")}
          />
        </main>
      )}

      {/* ======================================================
          BASE STATION REPAIR & MITIGATION TAB
          ====================================================== */}
      {activeTab === "simulation" && (
        <main style={{ padding: "14px", maxWidth: "1800px", margin: "0 auto", overflowY: "auto", height: "calc(100vh - 110px)", boxSizing: "border-box" }}>
          <BaseStationRepairPanel packet={packet} currentFault={globalFault} onClearFault={clearFault} />
        </main>
      )}

      {/* ======================================================
          SOURCE / DIGITAL TWIN TAB
          ====================================================== */}
      <main style={{ padding: "0", height: "calc(100vh - 110px)", width: "100%", background: "#06090e", overflowY: "auto", display: activeTab === "virtualengine" ? "block" : "none" }}>
        <VirtualEngine
          externalFault={globalFault}
          externalMission={globalMission}
          onTelemetryUpdate={handleVirtualEngineTelemetry}
          onFaultChange={setGlobalFault}
          onMissionChange={setGlobalMission}
        />
      </main>


      {/* ======================================================
          BOTTOM STATUS BAR
          ====================================================== */}

      <footer className="bottom-status">

        <div className="bottom-left">

          <span className="status-light green" />

          AEROSYNX DIGITAL TWIN

          <span className="bottom-divider">
            |
          </span>

          ENGINE DT-01

        </div>


        <div className="bottom-center">

          <span>
            TELEMETRY:
          </span>

          <strong
            className={
              connected
                ? "text-green"
                : "text-danger"
            }
          >

            {connected
              ? "CONNECTED"
              : "DISCONNECTED"}

          </strong>

          <span>
            •
          </span>

          <span>
            UPDATE:
          </span>

          <strong>
            {updateText}
          </strong>

        </div>


        <div className="bottom-right">

          <span>
            PROFILE
          </span>

          <strong>
            {missionProfile
              .replaceAll(
                "_",
                " "
              )
              .toUpperCase()}
          </strong>

        </div>

      </footer>


      {/* ======================================================
          FULL SCREEN FAULT ALARM
          ====================================================== */}

      {alarmActive &&
        activeFault !==
        "none" && (

          <div className="alarm-overlay">

            <div className="alarm-content">

              <div className="alarm-symbol">
                !
              </div>

              <div>

                <strong>
                  ENGINE FAULT
                </strong>

                <span>
                  {prettyFault(
                    activeFault
                  )}
                </span>

              </div>

            </div>

          </div>

        )}


      {/* ======================================================
          REACT TOASTIFY CONTAINER
          ====================================================== */}

      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="dark"
      />

    </div>
  );
}