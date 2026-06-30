function readJson(storageKey, fallback) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    localStorage.removeItem(storageKey);
    return fallback;
  }
}

export const store = {
  token: localStorage.getItem("dp_token") || "",
  user: null,
  selectedDeviceId: localStorage.getItem("dp_selected_device_id") || "",
  telemetryRange: localStorage.getItem("dp_telemetry_range") || "1h",
  devices: [],
  deviceStatus: null,
  telemetry: [],
  dailyCheckup: null,
  behaviorEvents: [],
  assistantMessages: readJson("dp_pwa_assistant_messages", []),
  assistantBusy: false,
  alertPrefs: readJson("dp_alert_prefs", {}),
  quickActionStates: readJson("dp_quick_action_states", {}),
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

export function setSelectedDeviceId(deviceId) {
  store.selectedDeviceId = deviceId || "";
  if (store.selectedDeviceId) {
    localStorage.setItem("dp_selected_device_id", store.selectedDeviceId);
  } else {
    localStorage.removeItem("dp_selected_device_id");
  }
}

export function setTelemetryRange(range) {
  store.telemetryRange = range || "1h";
  localStorage.setItem("dp_telemetry_range", store.telemetryRange);
}

export function setAlertPref(key, enabled) {
  store.alertPrefs = { ...store.alertPrefs, [key]: Boolean(enabled) };
  localStorage.setItem("dp_alert_prefs", JSON.stringify(store.alertPrefs));
}

export function addAssistantMessage(role, content) {
  const text = String(content || "").trim();
  if (!text) return;
  store.assistantMessages = [
    ...store.assistantMessages,
    {
      id: `${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
      role,
      content: text,
      ts: Date.now(),
    },
  ].slice(-30);
  localStorage.setItem("dp_pwa_assistant_messages", JSON.stringify(store.assistantMessages));
}

export function clearAssistantMessages() {
  store.assistantMessages = [];
  localStorage.removeItem("dp_pwa_assistant_messages");
}

export function setQuickActionState(actionKey, state) {
  store.quickActionStates = {
    ...store.quickActionStates,
    [actionKey]: {
      state,
      ts: Date.now(),
    },
  };
  localStorage.setItem("dp_quick_action_states", JSON.stringify(store.quickActionStates));
}

export function clearQuickActionStates(actionKeys = []) {
  const next = { ...store.quickActionStates };
  actionKeys.forEach((key) => {
    delete next[key];
  });
  store.quickActionStates = next;
  localStorage.setItem("dp_quick_action_states", JSON.stringify(store.quickActionStates));
}
