const DEFAULT_API_BASE =
  typeof window !== "undefined" ? resolveDefaultApiBase() : "http://127.0.0.1:8000";
const DEFAULT_WS_BASE =
  typeof window !== "undefined" ? resolveDefaultWsBase() : "ws://127.0.0.1:8000/ws";

let apiBase = normalizeApiBase(resolveStoredBase("dp_api_base", DEFAULT_API_BASE));
let wsBase = normalizeWsBase(resolveStoredBase("dp_ws_base", DEFAULT_WS_BASE));

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

export async function getDailyCheckup(roomId, deviceId, token) {
  const qs = deviceId ? `?device=${encodeURIComponent(deviceId)}` : "";
  return apiFetch(`/api/rooms/${encodeURIComponent(roomId)}/daily-checkup${qs}`, { token });
}

export async function getBehaviorEvents({ deviceId = "", roomId = "", limit = 50 } = {}, token) {
  const params = new URLSearchParams();
  if (deviceId) params.set("device", deviceId);
  if (roomId) params.set("room", roomId);
  params.set("limit", String(limit));
  return apiFetch(`/api/behavior-events?${params.toString()}`, { token });
}

export async function getAppBehaviorOverview(deviceId, token) {
  const params = new URLSearchParams({ deviceId });
  return apiFetch(`/api/v1/app/behavior/overview?${params.toString()}`, { token });
}

export async function getAppHabit(deviceId, profileId, token) {
  const params = new URLSearchParams({ deviceId });
  return apiFetch(`/api/v1/app/behavior/habits/${encodeURIComponent(profileId)}?${params.toString()}`, { token });
}

export async function getBehaviorSessions({ deviceId, socketId = "", limit = 20, cursor = "" }, token) {
  const params = new URLSearchParams({ deviceId, limit: String(limit) });
  if (socketId !== "") params.set("socketId", String(socketId));
  if (cursor !== "") params.set("cursor", String(cursor));
  return apiFetch(`/api/v1/behavior/sessions?${params.toString()}`, { token });
}

export async function postAgentQuery({ message, roomId = "", deviceId = "", page = "pwa", period = "7d", recentMessages = [] }, token) {
  return apiFetch("/api/agent/query", {
    method: "POST",
    body: {
      message,
      roomId,
      period,
      context: {
        page,
        roomId,
        deviceId,
        timeRange: period,
        recentMessages,
      },
    },
    token,
    timeoutMs: 30000,
  });
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

export async function getMailSetting(token) {
  return apiFetch("/api/mail/setting", { token });
}

export async function updateMailSetting(enabled, token) {
  return apiFetch("/api/mail/setting", {
    method: "POST",
    body: { enabled },
    token,
  });
}

function resolveStoredBase(storageKey, fallback) {
  if (typeof window === "undefined") return fallback;

  const saved = String(localStorage.getItem(storageKey) || "").trim();
  if (!saved) return fallback;

  const debugMode = localStorage.getItem("dp_debug_mode") === "1";
  if (debugMode) return saved;

  try {
    const savedUrl = new URL(saved);
    if (savedUrl.origin === window.location.origin) return saved;
  } catch {
    // Ignore malformed stored values and fall back to current origin.
  }

  localStorage.removeItem(storageKey);
  return fallback;
}

function isLocalStaticDev() {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return (host === "127.0.0.1" || host === "localhost") && window.location.port && window.location.port !== "8000";
}

function resolveDefaultApiBase() {
  if (isLocalStaticDev()) return `${window.location.protocol}//${window.location.hostname}:8000`;
  return window.location.origin;
}

function resolveDefaultWsBase() {
  if (isLocalStaticDev()) return `ws://${window.location.hostname}:8000/ws`;
  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
}

function normalizeApiBase(value) {
  return String(value || DEFAULT_API_BASE).trim().replace(/\/+$/, "");
}

function normalizeWsBase(value) {
  return String(value || DEFAULT_WS_BASE).trim().replace(/\/+$/, "");
}
