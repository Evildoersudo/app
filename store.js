export const store = {
  token: localStorage.getItem("dp_token") || "",
  user: null,
  selectedDeviceId: "A-302-strip01",
  devices: [],
  deviceStatus: null,
  telemetry: [],
  wsConnected: false,
  wsClient: null,
  events: [],
  alerts: [],
  pendingCmdByTarget: new Map(),
  debugMode: localStorage.getItem("dp_debug_mode") === "1",
};

export function addEvent(type, detail, level = "info") {
  store.events.unshift({
    id: `${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
    ts: Date.now(),
    type,
    detail,
    level,
  });
  store.events = store.events.slice(0, 50);
}

export function addAlert(type, detail, level = "warn") {
  store.alerts.unshift({
    id: `${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
    ts: Date.now(),
    type,
    detail,
    level,
    resolved: false,
  });
  store.alerts = store.alerts.slice(0, 100);
}

export function setToken(token) {
  store.token = token || "";
  if (store.token) {
    localStorage.setItem("dp_token", store.token);
  } else {
    localStorage.removeItem("dp_token");
  }
}

export function setDebugMode(enabled) {
  store.debugMode = Boolean(enabled);
  localStorage.setItem("dp_debug_mode", store.debugMode ? "1" : "0");
}
