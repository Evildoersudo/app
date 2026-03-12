const DEFAULT_API_BASE = "http://127.0.0.1:8000";
const DEFAULT_WS_BASE = "ws://127.0.0.1:8000/ws";

let apiBase = normalizeApiBase(localStorage.getItem("dp_api_base") || DEFAULT_API_BASE);
let wsBase = normalizeWsBase(localStorage.getItem("dp_ws_base") || DEFAULT_WS_BASE);

export function getApiBase() {
  return apiBase;
}

export function getWsBase() {
  return wsBase;
}

export function setApiBase(nextBase) {
  apiBase = normalizeApiBase(nextBase);
  localStorage.setItem("dp_api_base", apiBase);
}

export function setWsBase(nextBase) {
  wsBase = normalizeWsBase(nextBase);
  localStorage.setItem("dp_ws_base", wsBase);
}

export async function apiFetch(path, { method = "GET", body, token, timeoutMs = 10000 } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiBase}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
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
  } catch (err) {
    if (err.name === "AbortError") {
      const timeoutErr = new Error("request timeout");
      timeoutErr.status = 408;
      throw timeoutErr;
    }
    if (err instanceof TypeError) {
      const networkErr = new Error("network unavailable");
      networkErr.status = 0;
      throw networkErr;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
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

export async function getTelemetry(deviceId, range = "1h", token) {
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

export async function getPushPublicKey(token) {
  return apiFetch("/api/push/public_key", { token });
}

export async function subscribePush(subscription, token) {
  return apiFetch("/api/push/subscribe", {
    method: "POST",
    body: subscription,
    token,
  });
}

export async function unsubscribePush(endpoint, token) {
  return apiFetch(`/api/push/subscribe?endpoint=${encodeURIComponent(endpoint)}`, {
    method: "DELETE",
    token,
  });
}

function normalizeApiBase(value) {
  return String(value || DEFAULT_API_BASE).trim().replace(/\/+$/, "");
}

function normalizeWsBase(value) {
  return String(value || DEFAULT_WS_BASE).trim().replace(/\/+$/, "");
}
