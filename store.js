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
  user: readJson("dp_user", null),
  selectedDeviceId: localStorage.getItem("dp_selected_device_id") || "",
  telemetryRange: localStorage.getItem("dp_telemetry_range") || "1h",
  devices: [],
  deviceStatus: null,
  telemetry: [],
  dailyCheckup: null,
  behaviorEvents: [],
  behaviorOverview: null,
  habitProfiles: [],
  selectedHabitProfileId: null,
  habitDetail: null,
  behaviorSessions: [],
  sessionCursor: null,
  sessionSocketFilter: "",
  behaviorLoading: false,
  behaviorError: "",
  behaviorLastUpdatedAt: 0,
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

const BEHAVIOR_DB_NAME = "dorm-power-pwa";
const BEHAVIOR_DB_VERSION = 1;
const BEHAVIOR_STORE_NAME = "behavior_snapshots";
const BEHAVIOR_CACHE_SCHEMA = 1;

function behaviorCacheKey(username, deviceId) {
  return `dp_behavior_cache:${String(username || "anonymous")}:${String(deviceId || "none")}`;
}

function openBehaviorDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in globalThis)) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(BEHAVIOR_DB_NAME, BEHAVIOR_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BEHAVIOR_STORE_NAME)) {
        db.createObjectStore(BEHAVIOR_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });
}

async function readBehaviorDb(key) {
  const db = await openBehaviorDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(BEHAVIOR_STORE_NAME, "readonly").objectStore(BEHAVIOR_STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("IndexedDB read failed"));
    });
  } finally {
    db.close();
  }
}

async function writeBehaviorDb(record) {
  const db = await openBehaviorDb();
  try {
    await new Promise((resolve, reject) => {
      const request = db.transaction(BEHAVIOR_STORE_NAME, "readwrite").objectStore(BEHAVIOR_STORE_NAME).put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error("IndexedDB write failed"));
    });
  } finally {
    db.close();
  }
}

async function deleteBehaviorDbPrefix(prefix) {
  const db = await openBehaviorDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(BEHAVIOR_STORE_NAME, "readwrite");
      const storeRef = transaction.objectStore(BEHAVIOR_STORE_NAME);
      const request = storeRef.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (String(cursor.key).startsWith(prefix)) cursor.delete();
        cursor.continue();
      };
      request.onerror = () => reject(request.error || new Error("IndexedDB cursor failed"));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB delete failed"));
    });
  } finally {
    db.close();
  }
}

export function setCurrentUser(user) {
  store.user = user || null;
  if (store.user) localStorage.setItem("dp_user", JSON.stringify(store.user));
  else localStorage.removeItem("dp_user");
}

export async function loadBehaviorCache(username, deviceId) {
  const key = behaviorCacheKey(username, deviceId);
  let cached = null;
  try {
    const record = await readBehaviorDb(key);
    if (record?.schemaVersion === BEHAVIOR_CACHE_SCHEMA) cached = record.payload;
  } catch {
    // Older browsers continue using the localStorage fallback.
  }
  if (!cached) {
    cached = readJson(key, null);
    if (cached) {
      writeBehaviorDb({ key, schemaVersion: BEHAVIOR_CACHE_SCHEMA, payload: cached, savedAt: cached.savedAt || Date.now() })
        .then(() => localStorage.removeItem(key))
        .catch(() => undefined);
    }
  }
  if (!cached) return false;
  store.behaviorOverview = cached.overview || null;
  store.habitProfiles = Array.isArray(cached.overview?.profiles) ? cached.overview.profiles : [];
  store.selectedHabitProfileId = cached.selectedHabitProfileId ?? store.habitProfiles[0]?.profileId ?? null;
  store.habitDetail = cached.habitDetail || null;
  store.behaviorSessions = Array.isArray(cached.sessions) ? cached.sessions : [];
  store.sessionCursor = cached.sessionCursor ?? null;
  store.behaviorLastUpdatedAt = Number(cached.savedAt || 0);
  return true;
}

export async function saveBehaviorCache(username, deviceId) {
  if (!username || !deviceId) return;
  const key = behaviorCacheKey(username, deviceId);
  const payload = {
    overview: store.behaviorOverview,
    selectedHabitProfileId: store.selectedHabitProfileId,
    habitDetail: store.habitDetail,
    sessions: store.behaviorSessions.slice(0, 40),
    sessionCursor: store.sessionCursor,
    savedAt: Date.now(),
  };
  try {
    await writeBehaviorDb({ key, schemaVersion: BEHAVIOR_CACHE_SCHEMA, payload, savedAt: payload.savedAt });
    localStorage.removeItem(key);
  } catch {
    localStorage.setItem(key, JSON.stringify(payload));
  }
}

export async function clearBehaviorCache(username = "") {
  const prefix = username ? `dp_behavior_cache:${String(username)}:` : "dp_behavior_cache:";
  Object.keys(localStorage).forEach((key) => {
    if (key.startsWith(prefix)) localStorage.removeItem(key);
  });
  store.behaviorOverview = null;
  store.habitProfiles = [];
  store.selectedHabitProfileId = null;
  store.habitDetail = null;
  store.behaviorSessions = [];
  store.sessionCursor = null;
  store.sessionSocketFilter = "";
  store.behaviorLoading = false;
  store.behaviorError = "";
  store.behaviorLastUpdatedAt = 0;
  try {
    await deleteBehaviorDbPrefix(prefix);
  } catch {
    // localStorage cleanup still provides a safe fallback.
  }
}

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

export function addAssistantMessage(role, content, metadata = {}) {
  const text = String(content || "").trim();
  if (!text) return;
  store.assistantMessages = [
    ...store.assistantMessages,
    {
      id: `${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
      role,
      content: text,
      ts: Date.now(),
      sources: Array.isArray(metadata.sources) ? metadata.sources.slice(0, 4) : [],
      usedTools: Array.isArray(metadata.usedTools) ? metadata.usedTools.slice(0, 3) : [],
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
