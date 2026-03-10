let apiBase = localStorage.getItem("dp_api_base") || "http://127.0.0.1:8000";
let wsBase = localStorage.getItem("dp_ws_base") || "ws://127.0.0.1:8000/ws";

export function getApiBase() {
  return apiBase;
}

export function getWsBase() {
  return wsBase;
}

export function setApiBase(nextBase) {
  apiBase = String(nextBase || "").replace(/\/$/, "");
  localStorage.setItem("dp_api_base", apiBase);
}

export function setWsBase(nextBase) {
  wsBase = String(nextBase || "");
  localStorage.setItem("dp_ws_base", wsBase);
}

export async function apiFetch(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? safeJson(text) : {};
  if (!res.ok) {
    const err = new Error(data.message || data.detail || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function login(account, password) {
  return apiFetch("/api/auth/login", { method: "POST", body: { account, password } });
}

export async function getDevices(token) {
  return apiFetch("/api/devices", { token });
}

export async function getDeviceStatus(deviceId, token) {
  return apiFetch(`/api/devices/${encodeURIComponent(deviceId)}/status`, { token });
}

export async function getTelemetry(deviceId, range = "60s", token) {
  return apiFetch(`/api/telemetry?device=${encodeURIComponent(deviceId)}&range=${encodeURIComponent(range)}`, { token });
}

export async function sendCmd(deviceId, payload, token) {
  return apiFetch(`/api/strips/${encodeURIComponent(deviceId)}/cmd`, {
    method: "POST",
    body: payload,
    token,
  });
}

export async function getCmd(cmdId, token) {
  return apiFetch(`/api/cmd/${encodeURIComponent(cmdId)}`, { token });
}

export async function getHealth() {
  return apiFetch("/health");
}
