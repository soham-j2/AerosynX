const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:5001") + "/api";

async function request(endpoint, options = {}) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      errorText || `API request failed: ${response.status}`
    );
  }

  return response.json();
}


// ============================================================
// LIVE ENGINE DATA & DIGITAL TWIN
// ============================================================

export async function getLiveEngineData() {
  return request("/dashboard");
}

export async function getDigitalTwin() {
  return request("/dashboard");
}

export async function getAIAnalysis() {
  return request("/dashboard");
}

export async function getEngineStatus() {
  return request("/dashboard");
}

export async function getHealth() {
  return request("/health");
}


// ============================================================
// FAULT INJECTION
// ============================================================

export async function injectFault(fault, profile = "normal_cruise") {
  return request("/fault/inject", {
    method: "POST",
    body: JSON.stringify({
      fault,
      mission_profile: profile,
    }),
  });
}

export async function clearFault() {
  return request("/fault/clear", {
    method: "POST",
    body: JSON.stringify({
      fault: "none",
    }),
  });
}


// ============================================================
// MISSIONGUARD & MISSION HISTORY
// ============================================================

export async function evaluateMission(mission) {
  return request("/missionguard/simulate", {
    method: "POST",
    body: JSON.stringify(mission),
  });
}

export async function getLatestMissionGuard() {
  return request("/missionguard/latest");
}

export async function rescueMission(mission) {
  return request("/missionguard/rescue", {
    method: "POST",
    body: JSON.stringify(mission),
  });
}

export async function startMissionHistory(mission) {
  return request("/mission/start", {
    method: "POST",
    body: JSON.stringify(mission),
  });
}

export async function stopMissionHistory(reason = "MANUAL_STOP") {
  return request("/mission/stop", {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function getMissionRuns() {
  return request("/mission/runs");
}

export async function getMissionReplay(missionId) {
  return request(`/mission/replay/${missionId}`);
}