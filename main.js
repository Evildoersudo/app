import {
  getApiBase,
  getWsBase,
  setApiBase,
  setWsBase,
  login,
  getDevices,
  getDeviceStatus,
  getTelemetry,
  sendCmd,
  getCmd,
  getHealth,
} from "./api.js";
import {
  store,
  setToken,
  addEvent,
  addAlert,
  setDebugMode,
  setSelectedDeviceId,
  setTelemetryRange,
} from "./store.js";

const POWER_ALERT_THRESHOLD = 120;
const STATUS_POLL_INTERVAL_MS = 8000;
const TELEMETRY_REFRESH_INTERVAL_MS = 12000;
const LOGO_LONG_PRESS_MS = 5000;
const ALLOWED_RANGES = ["1h", "24h", "7d", "30d"];
const RANGE_LABELS = { "1h": "1小时", "24h": "24小时", "7d": "7天", "30d": "30天" };
const DEVICE_TYPE_OPTIONS = [
  { value: "DeskLamp", label: "台灯" },
  { value: "Monitor", label: "显示器" },
  { value: "PC", label: "台式电脑" },
  { value: "Laptop", label: "笔记本电脑" },
  { value: "Router", label: "路由器" },
  { value: "Fan", label: "风扇" },
  { value: "Charger", label: "充电器" },
  { value: "Phone", label: "手机充电" },
  { value: "Kettle", label: "热水壶" },
  { value: "HairDryer", label: "吹风机" },
  { value: "Heater", label: "取暖器" },
  { value: "AirConditioner", label: "空调" },
  { value: "Fridge", label: "冰箱" },
  { value: "Printer", label: "打印机" },
  { value: "Projector", label: "投影仪" },
  { value: "Speaker", label: "音箱" },
  { value: "Other", label: "其他（自定义）" },
];
const DEVICE_TYPE_LABEL_MAP = DEVICE_TYPE_OPTIONS.reduce((acc, item) => {
  acc[item.value] = item.label;
  return acc;
}, {});
const TAB_META = {
  home: {
    label: "概览",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.8 12 4l9 7.8v8.2a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1z"/></svg>`,
  },
  device: {
    label: "插排",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10a3 3 0 0 1 3 3v6a7 7 0 1 1-14 0V6a3 3 0 0 1 3-3m0 3v5h2V6zm8 0v5h2V6z"/></svg>`,
  },
  alerts: {
    label: "告警",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 1.9 20.5A1 1 0 0 0 2.8 22h18.4a1 1 0 0 0 .9-1.5zM11 9h2v6h-2zm0 8h2v2h-2z"/></svg>`,
  },
  me: {
    label: "我的",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5m0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5"/></svg>`,
  },
};

const app = document.getElementById("app");
const offlineBanner = document.getElementById("offlineBanner");
const onlineBadge = document.getElementById("onlineBadge");
const toastNode = document.getElementById("toast");
const tabs = [...document.querySelectorAll(".tab")];
const topLogo = document.querySelector(".top-logo");

let currentTab = "home";
let alertFilter = localStorage.getItem("dp_alert_filter") || "all";
let wsRetryTimer = null;
let wsRetryDelay = 1500;
let statusPollTimer = null;
let statusPolling = false;
let lastTelemetryRefreshAt = 0;
let toastTimer = null;
let logoPressTimer = null;
let globalBusy = false;
let bootstrapSeq = 0;

const cmdWaiters = new Map();

if (!ALLOWED_RANGES.includes(store.telemetryRange)) {
  setTelemetryRange("1h");
}

tabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentTab = btn.dataset.tab;
    tabs.forEach((b) => b.classList.toggle("active", b === btn));
    render();
  });
});

if (topLogo) {
  const startPress = () => {
    logoPressTimer = setTimeout(() => {
      setDebugMode(!store.debugMode);
      showToast(store.debugMode ? "已开启调试模式" : "已关闭调试模式");
      render();
    }, LOGO_LONG_PRESS_MS);
  };
  const clearPress = () => {
    if (logoPressTimer) clearTimeout(logoPressTimer);
    logoPressTimer = null;
  };
  topLogo.addEventListener("pointerdown", startPress);
  topLogo.addEventListener("pointerup", clearPress);
  topLogo.addEventListener("pointerleave", clearPress);
  topLogo.addEventListener("pointercancel", clearPress);
}

function formatTime(ts) {
  return new Date(ts).toLocaleString("zh-CN");
}

function selectedDevice() {
  return store.devices.find((x) => x.id === store.selectedDeviceId) || null;
}

function isOnline() {
  return Boolean(store.deviceStatus?.online);
}

function setBanner(msg) {
  if (!msg) {
    offlineBanner.classList.add("hidden");
    offlineBanner.textContent = "";
    return;
  }
  offlineBanner.textContent = msg;
  offlineBanner.classList.remove("hidden");
}

function showToast(msg, duration = 1800) {
  toastNode.textContent = msg;
  toastNode.classList.remove("hidden");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastNode.classList.add("hidden"), duration);
}

function updateBadge() {
  onlineBadge.className = "status-pill";
  if (!navigator.onLine) {
    onlineBadge.innerHTML = '<span class="pulse-dot err"></span>网络离线';
    return;
  }
  if (globalBusy) {
    onlineBadge.innerHTML = '<span class="pulse-dot warn"></span>处理中';
    return;
  }
  if (!store.wsConnected) {
    onlineBadge.innerHTML = '<span class="pulse-dot warn"></span>WS离线';
    return;
  }
  if (isOnline()) {
    onlineBadge.innerHTML = '<span class="pulse-dot ok"></span>设备在线';
  } else {
    onlineBadge.innerHTML = '<span class="pulse-dot err"></span>设备离线';
  }
}

function updateTopDeviceInfo() {
  const node = document.getElementById("topDeviceInfo");
  if (!node) return;
  const d = selectedDevice();
  node.textContent = d ? `${d.room || "-"} / ${d.name || d.id}` : "请选择设备";
}

function updateTabLabels() {
  const unresolvedCount = store.alerts.filter((a) => !a.resolved).length;
  tabs.forEach((tab) => {
    const id = tab.dataset.tab;
    const meta = TAB_META[id];
    if (!meta) return;
    const badge =
      id === "alerts" && unresolvedCount > 0
        ? `<span class="tab-badge">${unresolvedCount > 99 ? "99+" : unresolvedCount}</span>`
        : "";
    tab.innerHTML = `
      <span class="tab-inner">
        <span class="tab-icon">${meta.icon}</span>
        <span class="tab-label">${meta.label}</span>
        ${badge}
      </span>
    `;
    tab.setAttribute("aria-label", id === "alerts" && unresolvedCount > 0 ? `告警，${unresolvedCount}条未处理` : meta.label);
  });
}

function setGlobalBusy(next) {
  globalBusy = Boolean(next);
  updateBadge();
}

function clearSessionAndRender(tip = "登录已过期，请重新登录") {
  setToken("");
  store.user = null;
  store.wsConnected = false;
  store.deviceStatus = null;
  store.telemetry = [];
  store.devices = [];
  store.selectedDeviceId = "";
  try {
    if (store.wsClient) store.wsClient.close();
  } catch {
    // noop
  }
  setBanner(tip);
  showToast(tip);
  render();
}

function handleAuthExpired(error, tip = "登录已过期，请重新登录") {
  if (!error || error.status !== 401 || !store.token) return false;
  clearSessionAndRender(tip);
  return true;
}

async function refreshTelemetryIfNeeded(force = false) {
  if (!store.token || !store.selectedDeviceId) return;
  const now = Date.now();
  if (!force && now - lastTelemetryRefreshAt < TELEMETRY_REFRESH_INTERVAL_MS) return;
  const telemetry = await getTelemetry(store.selectedDeviceId, store.telemetryRange, store.token);
  store.telemetry = Array.isArray(telemetry) ? telemetry : [];
  lastTelemetryRefreshAt = now;
}

async function bootstrapData() {
  if (!store.token) return;
  const seq = ++bootstrapSeq;
  try {
    const devices = await getDevices(store.token);
    if (seq !== bootstrapSeq) return;
    store.devices = Array.isArray(devices) ? devices : [];

    const exists = store.devices.some((x) => x.id === store.selectedDeviceId);
    if (!exists) {
      setSelectedDeviceId(store.devices[0]?.id || "");
    }

    if (store.selectedDeviceId) {
      const status = await getDeviceStatus(store.selectedDeviceId, store.token);
      if (seq !== bootstrapSeq) return;
      store.deviceStatus = status || null;
      await refreshTelemetryIfNeeded(true);
    } else {
      store.deviceStatus = null;
      store.telemetry = [];
    }

    if (!navigator.onLine) {
      setBanner("当前网络不可用，请检查连接后重试");
    } else if (!isOnline()) {
      setBanner("设备离线");
    } else {
      setBanner("");
    }
  } catch (e) {
    if (handleAuthExpired(e)) return;
    addAlert("SYSTEM", `初始化失败：${e.message}`, "err");
    setBanner(`初始化失败：${e.message}`);
  } finally {
    if (seq === bootstrapSeq) render();
  }
}

function scheduleReconnect() {
  if (wsRetryTimer || !store.token) return;
  wsRetryTimer = setTimeout(() => {
    wsRetryTimer = null;
    connectWs();
  }, wsRetryDelay);
}

function connectWs() {
  if (!store.token) return;

  try {
    if (store.wsClient) store.wsClient.close();
  } catch {
    // noop
  }

  const wsUrl = getWsBase();
  const ws = new WebSocket(wsUrl);
  store.wsClient = ws;

  ws.onopen = () => {
    store.wsConnected = true;
    wsRetryDelay = 1500;
    addEvent("SYSTEM", "WebSocket 已连接");
    updateBadge();
    render();
  };

  ws.onerror = () => {
    store.wsConnected = false;
    updateBadge();
  };

  ws.onclose = () => {
    store.wsConnected = false;
    wsRetryDelay = Math.min(15000, Math.floor(wsRetryDelay * 1.8));
    updateBadge();
    scheduleReconnect();
  };

  ws.onmessage = (evt) => {
    try {
      onWsMessage(JSON.parse(evt.data));
    } catch {
      // ignore non-JSON messages
    }
  };
}

function onWsMessage(raw) {
  const type = raw?.type;
  if (!type) return;

  if (type === "DEVICE_STATUS" && raw.deviceId === store.selectedDeviceId) {
    store.deviceStatus = { ...(store.deviceStatus || {}), ...(raw.payload || {}), online: true };
    setBanner("");
    addEvent("DEVICE_STATUS", "设备状态已更新");
  }

  if (type === "TELEMETRY" && raw.deviceId === store.selectedDeviceId) {
    const p = raw.payload || {};
    if (typeof p.power_w === "number" && store.telemetryRange === "1h") {
      store.telemetry.push({
        ts: p.ts || Math.floor(Date.now() / 1000),
        power_w: p.power_w,
      });
      if (store.telemetry.length > 240) store.telemetry.shift();
    }
  }

  if (type === "CMD_ACK") {
    const cmdId = raw.cmdId || raw.payload?.cmdId;
    const state = raw.state || raw.payload?.state;
    if (cmdId && state) resolvePendingCmd(cmdId, state);
  }

  if (type === "DEVICE_OFFLINE" && raw.deviceId === store.selectedDeviceId) {
    const reason = raw.payload?.reason || "未知";
    store.deviceStatus = { ...(store.deviceStatus || {}), online: false };
    addAlert("OFFLINE", `设备离线：${reason}`, "warn");
    setBanner(`离线原因：${reason}`);
  }

  updateBadge();
  render();
}

function resolvePendingCmd(cmdId, state) {
  const waiter = cmdWaiters.get(cmdId);
  if (!waiter) return;
  cmdWaiters.delete(cmdId);
  waiter(state);
}

function waitWsAck(cmdId, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cmdWaiters.delete(cmdId);
      resolve(null);
    }, timeoutMs);

    cmdWaiters.set(cmdId, (state) => {
      clearTimeout(timer);
      resolve(state);
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollCmdState(cmdId, maxMs = 5000, stepMs = 500) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    await sleep(stepMs);
    try {
      const result = await getCmd(cmdId, store.token);
      if (result?.state && result.state !== "pending") return result.state;
    } catch {
      // noop
    }
  }
  return "timeout";
}

async function executeCmd(payload, targetKey) {
  if (!isOnline()) {
    addAlert("CONTROL_FAIL", "设备离线", "warn");
    showToast("设备离线");
    return { state: "failed" };
  }
  if (store.pendingCmdByTarget.has(targetKey)) {
    addAlert("CONTROL_FAIL", "该目标已有待执行命令", "warn");
    showToast("命令处理中");
    return { state: "failed" };
  }

  let submit;
  try {
    submit = await sendCmd(store.selectedDeviceId, payload, store.token);
  } catch (err) {
    if (handleAuthExpired(err)) return { state: "failed" };

    if (err.status === 409) {
      addAlert("CONTROL_FAIL", "命令冲突", "warn");
      showToast("命令冲突：存在待执行命令");
      const pendingCmdId = err.data?.details?.pendingCmdId || err.data?.pendingCmdId || null;
      if (pendingCmdId) {
        const finalState = await pollCmdState(pendingCmdId);
        addEvent("CMD_CONFLICT_SYNC", `冲突命令 ${pendingCmdId} -> ${finalState}`);
      }
    } else {
      addAlert("CONTROL_FAIL", `控制失败：${err.message}`, "err");
      showToast("操作失败");
    }
    render();
    return { state: "failed" };
  }

  const cmdId = submit.cmdId;
  store.pendingCmdByTarget.set(targetKey, cmdId);
  render();

  const wsAckState = await waitWsAck(cmdId, 3000);
  if (wsAckState) {
    store.pendingCmdByTarget.delete(targetKey);
    addEvent("CMD_ACK", `命令 ${cmdId} -> ${wsAckState}`);
    showToast(wsAckState === "success" ? "执行成功" : "执行失败");
    render();
    return { state: wsAckState, cmdId };
  }

  const pollState = await pollCmdState(cmdId, 5000, 500);
  store.pendingCmdByTarget.delete(targetKey);
  if (pollState === "timeout") {
    addAlert("CONTROL_FAIL", "命令超时", "warn");
    showToast("执行超时");
  } else {
    showToast(pollState === "success" ? "执行成功" : "执行失败");
  }
  render();
  return { state: pollState, cmdId };
}

async function executeBulkSocketAction(action) {
  const sockets = store.deviceStatus?.sockets || [];
  if (!sockets.length) return;

  const desiredOn = action === "on";
  const targets = sockets.filter((s) => Boolean(s.on) !== desiredOn);
  if (!targets.length) {
    showToast("无需变更");
    return;
  }

  const ok = window.confirm(`将逐个插孔执行 ${targets.length} 条命令，确认继续吗？`);
  if (!ok) return;

  setGlobalBusy(true);
  let successCount = 0;
  let failCount = 0;
  for (let i = 0; i < targets.length; i += 1) {
    showToast(`进度 ${i + 1}/${targets.length}`, 900);
    const socket = targets[i];
    const key = `${store.selectedDeviceId}:${socket.id}:switch`;
    const result = await executeCmd({ socket: socket.id, action }, key);
    if (result.state === "success") successCount += 1;
    else failCount += 1;
  }
  setGlobalBusy(false);
  await bootstrapData();
  showToast(`批量完成：成功 ${successCount}，失败 ${failCount}`, 2600);
}

function calcTodayUsageKwh() {
  const points = store.telemetry;
  if (points.length < 2) return 0;
  const avgPower = points.reduce((sum, p) => sum + Number(p.power_w || 0), 0) / points.length;

  if (store.telemetryRange === "1h") {
    return Number((avgPower / 1000).toFixed(2));
  }
  if (store.telemetryRange === "24h") {
    return Number((avgPower * 24 / 1000).toFixed(2));
  }
  if (store.telemetryRange === "7d") {
    return Number((avgPower * 24 * 7 / 1000).toFixed(2));
  }
  return Number((avgPower * 24 * 30 / 1000).toFixed(2));
}

function calcYesterdayDelta(todayKwh) {
  const yesterday = todayKwh * 0.88;
  if (!yesterday) return "0%";
  const delta = ((todayKwh - yesterday) / yesterday) * 100;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(0)}%`;
}

function telemetryChart() {
  const points = store.telemetry.slice(-240);
  if (!points.length) return "<div class='small'>暂无遥测数据</div>";

  const values = points.map((p) => Number(p.power_w || 0));
  const valueMin = Math.min(...values);
  const valueMax = Math.max(...values);
  const diff = valueMax - valueMin;
  const padding = Math.max(diff * 0.2, 3);
  let min = Math.max(0, valueMin - padding);
  let max = valueMax + padding;
  if (max - min < 8) {
    min = Math.max(0, min - 4);
    max += 4;
  }

  const width = 320;
  const height = 100;
  const toX = (i) => (i / (points.length - 1 || 1)) * width;
  const toY = (v) => height - ((v - min) / (max - min || 1)) * height;
  const linePoints = points.map((p, i) => `${toX(i)},${toY(Number(p.power_w || 0))}`).join(" ");
  const areaPoints = `0,${height} ${linePoints} ${width},${height}`;
  const thresholdY = toY(POWER_ALERT_THRESHOLD);
  const showThreshold = POWER_ALERT_THRESHOLD >= min && POWER_ALERT_THRESHOLD <= max;

  return `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="powerFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#60a5fa" stop-opacity="0.35"></stop>
            <stop offset="100%" stop-color="#60a5fa" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        <line x1="0" y1="${toY(min)}" x2="${width}" y2="${toY(min)}" stroke="#cbd5e1" stroke-width="1"></line>
        <line x1="0" y1="${toY((min + max) / 2)}" x2="${width}" y2="${toY((min + max) / 2)}" stroke="#e2e8f0" stroke-width="1"></line>
        <line x1="0" y1="${toY(max)}" x2="${width}" y2="${toY(max)}" stroke="#e2e8f0" stroke-width="1"></line>
        ${showThreshold ? `<line x1="0" y1="${thresholdY}" x2="${width}" y2="${thresholdY}" stroke="#f79009" stroke-width="1.5" stroke-dasharray="4 3"></line>` : ""}
        <polygon points="${areaPoints}" fill="url(#powerFill)"></polygon>
        <polyline fill="none" stroke="#1677ff" stroke-width="2" points="${linePoints}"></polyline>
      </svg>
      <div class="chart-legend">
        <span><i class="legend-dot" style="background:#1677ff"></i>功率</span>
        <span class="muted">Min ${valueMin.toFixed(1)}W</span>
        <span class="muted">Max ${valueMax.toFixed(1)}W</span>
      </div>
    </div>
  `;
}

function normalizeDeviceTypeName(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (raw === "Unknown") return "";

  const mapped = DEVICE_TYPE_OPTIONS.find((x) => x.value === raw || x.label === raw);
  if (mapped && mapped.value !== "Other") return mapped.value;

  const cleaned = raw
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!cleaned) return "";
  if (/^[A-Za-z]/.test(cleaned)) return cleaned;
  return `Device_${cleaned}`;
}

function readableDeviceType(device) {
  const name = String(device || "").trim();
  if (!name || name === "Unknown" || name === "None") return "未识别";
  return DEVICE_TYPE_LABEL_MAP[name] ? `${DEVICE_TYPE_LABEL_MAP[name]} (${name})` : name;
}

function typeSelectOptionsHtml(currentValue = "") {
  const normalizedCurrent = normalizeDeviceTypeName(currentValue);
  return DEVICE_TYPE_OPTIONS.map((item) => {
    const selected =
      (normalizedCurrent && item.value === normalizedCurrent) || (!normalizedCurrent && item.value === "Other");
    return `<option value="${item.value}" ${selected ? "selected" : ""}>${item.label} / ${item.value}</option>`;
  }).join("");
}

function socketCardHtml(socket) {
  const targetKey = `${store.selectedDeviceId}:${socket.id}:switch`;
  const pending = store.pendingCmdByTarget.has(targetKey);
  const highPower = Number(socket.power_w || 0) >= POWER_ALERT_THRESHOLD;
  const status = pending ? "执行中" : socket.on ? "开启" : "关闭";
  const currentType = String(socket.device || "Unknown");
  const unknownType = !currentType || currentType === "Unknown" || currentType === "None";
  const pendingId = Number.isFinite(Number(socket.pendingId)) ? Number(socket.pendingId) : null;
  const showLearnPanel = unknownType || pendingId !== null;
  const normalizedCurrentType = normalizeDeviceTypeName(currentType);

  return `
    <div class="socket-card ${socket.on ? "on" : "off"} ${pending ? "pending" : ""} ${highPower ? "high" : ""}">
      <div class="socket-title"><strong>插孔 ${socket.id}</strong><span class="socket-state">${status}</span></div>
      <div class="socket-power">${Number(socket.power_w || 0).toFixed(1)}<span>W</span></div>
      <div class="small">设备：${readableDeviceType(currentType)}</div>
      <div class="small">识别状态：${unknownType ? "未识别" : "已识别"}</div>
      <div class="row socket-ops">
        <button data-socket-correct="${socket.id}" class="btn socket-correct" ${pending || !isOnline() || globalBusy ? "disabled" : ""}>重识别</button>
      </div>
      ${
        showLearnPanel
          ? `
      <div class="learn-panel">
        <div class="small">设备类型提交${pendingId !== null ? `（pendingId: ${pendingId}）` : ""}</div>
        <select class="input socket-type-select" data-socket="${socket.id}">
          ${typeSelectOptionsHtml(normalizedCurrentType)}
        </select>
        <input class="input socket-type-custom" data-socket="${socket.id}" placeholder="自定义类型（如 Reading_Lamp）" />
        <button data-socket-learn="${socket.id}" data-pending-id="${pendingId ?? ""}" class="btn primary socket-learn-submit" ${pending || !isOnline() || globalBusy ? "disabled" : ""}>提交类型</button>
      </div>
      `
          : ""
      }
      <button data-socket="${socket.id}" data-action="${socket.on ? "off" : "on"}" class="btn ${socket.on ? "danger" : "primary"} socket-toggle" ${pending || !isOnline() || globalBusy ? "disabled" : ""}>
        ${pending ? "执行中..." : socket.on ? "关闭" : "开启"}
      </button>
    </div>
  `;
}

function filterAlerts() {
  const now = Date.now();
  return store.alerts.filter((a) => {
    if (alertFilter === "unresolved" && a.resolved) return false;
    if (alertFilter === "today" && now - a.ts > 24 * 3600 * 1000) return false;
    if (alertFilter === "week" && now - a.ts > 7 * 24 * 3600 * 1000) return false;
    return true;
  });
}

function eventTypeLabel(type) {
  const mapping = {
    SYSTEM: "系统",
    LOGIN: "登录",
    DEVICE_STATUS: "设备状态",
    CMD_ACK: "命令回执",
    CMD_CONFLICT_SYNC: "冲突同步",
    CONFIG: "配置",
    OFFLINE: "离线",
    CONTROL_FAIL: "控制失败",
    CORRECT: "重识别",
    LEARN: "类型提交",
  };
  return mapping[type] || type || "事件";
}

function humanizeAlert(alert) {
  if (alert.type === "OFFLINE") return "设备离线，请检查电源或网络。";
  if (alert.type === "CONTROL_FAIL") return "控制失败，请重试。";
  if (alert.type === "SYSTEM") return "系统异常，请稍后重试。";
  return alert.detail || "告警";
}

function deviceSelector() {
  if (store.user?.role === "student") {
    const d = selectedDevice();
    return `
      <section class="card">
        <div class="row row-center">
          <div class="small">${d ? `${d.room || "-"} / ${d.name || d.id}` : "暂无设备"}</div>
          <button id="refreshBtn" class="btn">刷新</button>
        </div>
      </section>
    `;
  }

  return `
    <section class="card">
      <div class="row row-center">
        <select id="deviceSelect" class="input">
          ${store.devices
      .map((d) => `<option value="${d.id}" ${d.id === store.selectedDeviceId ? "selected" : ""}>${d.room || "-"} / ${d.name || d.id}</option>`)
      .join("")}
        </select>
        <button id="refreshBtn" class="btn">刷新</button>
      </div>
    </section>
  `;
}

function telemetryRangeSelector() {
  return `
    <div class="row row-center">
      <label class="small" for="telemetryRange">时间范围</label>
      <select id="telemetryRange" class="input">
        ${ALLOWED_RANGES.map((r) => `<option value="${r}" ${store.telemetryRange === r ? "selected" : ""}>${RANGE_LABELS[r]}</option>`).join("")}
      </select>
    </div>
  `;
}

function renderHome() {
  const d = selectedDevice();
  const currentPower = Number(store.deviceStatus?.total_power_w || 0).toFixed(1);
  const usageKwh = calcTodayUsageKwh();
  const yesterdayDelta = calcYesterdayDelta(usageKwh);
  const nightRate = `${Math.min(80, Math.max(10, Math.round((usageKwh * 13) % 50 + 20)))}%`;
  const peakTime = `${19 + (usageKwh > 1 ? 1 : 0)}:00`;

  return `
    ${deviceSelector()}
    <section class="card hero-card">
      <div class="hero-title">区间用电</div>
      <div class="hero-value">${usageKwh}<span>kWh</span></div>
      <div class="small">较参考值 ${yesterdayDelta} | 夜间占比 ${nightRate} | 峰值时段 ${peakTime}</div>
    </section>
    <section class="card">
      <div class="row">
        <div class="kpi"><div class="label">当前功率</div><div class="value">${currentPower}<span class="unit">W</span></div></div>
        <div class="kpi"><div class="label">未处理告警</div><div class="value">${store.alerts.filter((a) => !a.resolved).length}</div></div>
      </div>
      <div class="small">状态：${isOnline() ? "在线" : "离线"} | 设备：${d ? `${d.room || "-"} / ${d.name || d.id}` : "请选择"}</div>
    </section>
    <section class="card">
      <div class="row">
        <button id="quickCutoff" class="btn danger" ${!isOnline() || globalBusy ? "disabled" : ""}>一键断电</button>
        <button id="quickSleep" class="btn" ${!isOnline() || globalBusy ? "disabled" : ""}>睡眠模式</button>
        <button id="quickEco" class="btn" ${!isOnline() || globalBusy ? "disabled" : ""}>节能模式</button>
      </div>
    </section>
    <section class="card">
      <h3>功率曲线（${RANGE_LABELS[store.telemetryRange] || store.telemetryRange}）</h3>
      ${telemetryRangeSelector()}
      ${telemetryChart()}
    </section>
    <section class="card">
      <h3>最近事件</h3>
      <div class="event-list">
        ${store.events
      .slice(0, 8)
      .map((e) => `<div class="event-item"><strong>${eventTypeLabel(e.type)}</strong> ${e.detail}<div class="small">${formatTime(e.ts)}</div></div>`)
      .join("") || "<div class='small'>暂无事件</div>"
    }
      </div>
    </section>
  `;
}

function renderDevice() {
  return `
    ${deviceSelector()}
    <section class="card">
      <div class="row">
        <button id="allOn" class="btn" ${!isOnline() || globalBusy ? "disabled" : ""}>全部开启</button>
        <button id="allOff" class="btn danger" ${!isOnline() || globalBusy ? "disabled" : ""}>全部关闭</button>
      </div>
      <p class="small">批量操作会逐个插孔下发命令并显示进度。</p>
    </section>
    <section class="card">
      <h3>插孔矩阵</h3>
      <div class="socket-grid">
        ${(store.deviceStatus?.sockets || []).map((s) => socketCardHtml(s)).join("") || "<div class='small'>暂无插孔数据</div>"}
      </div>
    </section>
  `;
}

function renderAlerts() {
  const list = filterAlerts();
  return `
    ${deviceSelector()}
    <section class="card">
      <div class="row">
        <button data-filter="all" class="btn filter-btn ${alertFilter === "all" ? "primary" : ""}">全部</button>
        <button data-filter="unresolved" class="btn filter-btn ${alertFilter === "unresolved" ? "primary" : ""}">未处理</button>
        <button data-filter="today" class="btn filter-btn ${alertFilter === "today" ? "primary" : ""}">今日</button>
        <button data-filter="week" class="btn filter-btn ${alertFilter === "week" ? "primary" : ""}">本周</button>
      </div>
      <div class="row">
        <button id="clearAlertsBtn" class="btn">清空</button>
      </div>
      <h3>告警列表</h3>
      <div class="alert-list">
        ${list
      .slice(0, 30)
      .map(
        (a) => `
            <div class="alert-item ${a.level === "err" ? "err" : "warn"}">
              <strong>${humanizeAlert(a)}</strong>
              <div class="small">${formatTime(a.ts)}</div>
              <div class="row">
                <button data-alert-id="${a.id}" class="btn retry-alert">重试</button>
                <button data-alert-id="${a.id}" class="btn resolve-alert">${a.resolved ? "已忽略" : "忽略"}</button>
              </div>
            </div>
          `,
      )
      .join("") || "<div class='small'>暂无告警</div>"
    }
      </div>
    </section>
  `;
}

function renderMe() {
  const d = selectedDevice();
  const usageKwh = calcTodayUsageKwh();
  const weeklyKwh = Number((usageKwh * 7).toFixed(1));
  const nightRate = `${Math.min(80, Math.max(10, Math.round((usageKwh * 13) % 50 + 20)))}%`;

  return `
    <section class="card">
      <h3>账户信息</h3>
      <p class="small">用户名：${store.user?.username || "-"}</p>
      <p class="small">角色：${store.user?.role || "-"}</p>
    </section>
    <section class="card">
      <h3>宿舍绑定</h3>
      <p class="small">${d ? `${d.room || "-"} / ${d.name || d.id}` : "未绑定"}</p>
    </section>
    <section class="card">
      <h3>用电统计</h3>
      <p class="small">近一周估算用电：${weeklyKwh} kWh</p>
      <p class="small">夜间占比：${nightRate}</p>
    </section>
    <section class="card">
      <h3>通知设置</h3>
      <label class="small"><input id="nightNotify" type="checkbox" checked /> 夜间提醒</label><br />
      <label class="small"><input id="overPowerNotify" type="checkbox" checked /> 超功率提醒</label>
    </section>
    ${store.debugMode
      ? `
      <section class="card">
        <h3>调试连接</h3>
        <label class="small" for="apiBaseInput">API 地址</label>
        <input id="apiBaseInput" class="input" value="${getApiBase()}" />
        <label class="small" for="wsBaseInput">WS 地址</label>
        <input id="wsBaseInput" class="input" value="${getWsBase()}" />
        <div class="row">
          <button id="saveConnBtn" class="btn primary">保存并重连</button>
        </div>
      </section>
    `
      : ""
    }
    <section class="card">
      <h3>系统健康</h3>
      <div id="healthInfo" class="small">加载中...</div>
      <div class="row"><button id="logoutBtn" class="btn">退出登录</button></div>
    </section>
  `;
}

function renderLogin() {
  return `
    <section class="card">
      <h3>登录</h3>
      <label class="small" for="account">账号</label>
      <input id="account" class="input" value="admin" />
      <label class="small" for="password">密码</label>
      <input id="password" class="input" type="password" value="admin123" />
      <div class="row">
        <button id="loginBtn" class="btn primary">登录</button>
      </div>
    </section>
  `;
}

function bindDeviceSelectorAndRefresh() {
  const select = document.getElementById("deviceSelect");
  if (select) {
    select.addEventListener("change", async () => {
      setSelectedDeviceId(select.value);
      await bootstrapData();
    });
  }

  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) refreshBtn.onclick = () => bootstrapData();
}

function bindLogin() {
  const loginBtn = document.getElementById("loginBtn");
  const passwordInput = document.getElementById("password");
  if (!loginBtn) return;

  const submit = async () => {
    const account = document.getElementById("account").value.trim();
    const password = document.getElementById("password").value.trim();
    try {
      const result = await login(account, password);
      setToken(result.token);
      store.user = result.user || { username: account, role: "student" };
      addEvent("LOGIN", `登录成功：${store.user.username}`);
      showToast("登录成功");
      connectWs();
      await bootstrapData();
    } catch (e) {
      if (handleAuthExpired(e)) return;
      addAlert("SYSTEM", `登录失败：${e.message}`, "err");
      setBanner(`登录失败：${e.message}`);
      render();
    }
  };

  loginBtn.addEventListener("click", submit);
  if (passwordInput) {
    passwordInput.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter") submit();
    });
  }
}

function bindActions() {
  bindDeviceSelectorAndRefresh();

  const telemetryRangeSelect = document.getElementById("telemetryRange");
  if (telemetryRangeSelect) {
    telemetryRangeSelect.addEventListener("change", async () => {
      const nextRange = telemetryRangeSelect.value;
      if (!ALLOWED_RANGES.includes(nextRange)) return;
      setTelemetryRange(nextRange);
      lastTelemetryRefreshAt = 0;
      await refreshTelemetryIfNeeded(true);
      render();
    });
  }

  const quickCutoff = document.getElementById("quickCutoff");
  if (quickCutoff) quickCutoff.onclick = () => executeBulkSocketAction("off");

  const quickSleep = document.getElementById("quickSleep");
  if (quickSleep) {
    quickSleep.onclick = async () => {
      await executeCmd({ action: "mode", mode: "sleep" }, `${store.selectedDeviceId}:mode:sleep`);
      showToast("已提交睡眠模式");
    };
  }

  const quickEco = document.getElementById("quickEco");
  if (quickEco) {
    quickEco.onclick = async () => {
      await executeCmd({ action: "mode", mode: "eco" }, `${store.selectedDeviceId}:mode:eco`);
      showToast("已提交节能模式");
    };
  }

  const allOn = document.getElementById("allOn");
  if (allOn) allOn.onclick = () => executeBulkSocketAction("on");

  const allOff = document.getElementById("allOff");
  if (allOff) allOff.onclick = () => executeBulkSocketAction("off");

  document.querySelectorAll(".socket-toggle").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const socketId = Number(btn.dataset.socket);
      const action = btn.dataset.action;
      const key = `${store.selectedDeviceId}:${socketId}:switch`;
      await executeCmd({ socket: socketId, action }, key);
      await bootstrapData();
    });
  });

  document.querySelectorAll(".socket-correct").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const socketId = Number(btn.dataset.socketCorrect);
      if (!Number.isFinite(socketId)) return;
      const key = `${store.selectedDeviceId}:${socketId}:correct`;
      const result = await executeCmd({ socket: socketId, action: "correct" }, key);
      if (result.state === "success") {
        addEvent("CORRECT", `插孔${socketId} 已下发重识别`);
        showToast(`插孔${socketId} 已下发重识别`);
      } else {
        addAlert("CONTROL_FAIL", `插孔${socketId} 重识别失败`, "warn");
      }
      await bootstrapData();
    });
  });

  document.querySelectorAll(".socket-learn-submit").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const socketId = Number(btn.dataset.socketLearn);
      if (!Number.isFinite(socketId)) return;

      const select = document.querySelector(`.socket-type-select[data-socket="${socketId}"]`);
      const customInput = document.querySelector(`.socket-type-custom[data-socket="${socketId}"]`);
      const pick = select ? String(select.value || "").trim() : "";
      const custom = customInput ? String(customInput.value || "").trim() : "";

      const typeName = pick === "Other" ? normalizeDeviceTypeName(custom) : normalizeDeviceTypeName(pick || custom);
      if (!typeName) {
        showToast("请先选择或输入设备类型");
        return;
      }

      const rawPendingId = btn.dataset.pendingId;
      const pendingId = Number.isFinite(Number(rawPendingId)) ? Number(rawPendingId) : null;
      const payload = pendingId !== null ? { pendingId, name: typeName } : { name: typeName };
      const key = `${store.selectedDeviceId}:${socketId}:learn_commit`;

      const result = await executeCmd({ socket: socketId, action: "learn_commit", payload }, key);
      if (result.state === "success") {
        addEvent("LEARN", `插孔${socketId} 类型已提交: ${typeName}`);
        showToast(`插孔${socketId} 已提交类型`);
      } else {
        addAlert("CONTROL_FAIL", `插孔${socketId} 提交类型失败`, "warn");
      }
      await bootstrapData();
    });
  });

  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      alertFilter = btn.dataset.filter || "all";
      localStorage.setItem("dp_alert_filter", alertFilter);
      render();
    });
  });

  const clearAlertsBtn = document.getElementById("clearAlertsBtn");
  if (clearAlertsBtn) {
    clearAlertsBtn.onclick = () => {
      store.alerts = [];
      showToast("告警已清空");
      render();
    };
  }

  document.querySelectorAll(".resolve-alert").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.alertId;
      const alert = store.alerts.find((x) => x.id === id);
      if (alert) alert.resolved = true;
      render();
    });
  });

  document.querySelectorAll(".retry-alert").forEach((btn) => {
    btn.addEventListener("click", async () => {
      showToast("开始重试");
      await bootstrapData();
    });
  });

  const saveConnBtn = document.getElementById("saveConnBtn");
  if (saveConnBtn) {
    saveConnBtn.onclick = async () => {
      const apiInput = document.getElementById("apiBaseInput");
      const wsInput = document.getElementById("wsBaseInput");
      const apiVal = apiInput?.value.trim() || "";
      const wsVal = wsInput?.value.trim() || "";

      if (!/^https?:\/\//i.test(apiVal)) {
        showToast("API 地址格式错误");
        return;
      }
      if (!/^wss?:\/\//i.test(wsVal)) {
        showToast("WS 地址格式错误");
        return;
      }

      setApiBase(apiVal);
      setWsBase(wsVal);
      addEvent("CONFIG", `连接地址已更新：${apiVal} / ${wsVal}`);
      showToast("配置已保存，正在重连");
      connectWs();
      await bootstrapData();
    };
  }

  const healthInfo = document.getElementById("healthInfo");
  if (healthInfo) {
    getHealth()
      .then((h) => {
        healthInfo.textContent = `后端=${h.ok ? "正常" : "异常"} | MQTT=${h.mqtt_connected ? "已连接" : "未连接"} | 数据库=${h.database_url || "-"}`;
      })
      .catch((e) => {
        healthInfo.textContent = `健康检查失败：${e.message}`;
      });
  }

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      clearSessionAndRender("已退出登录");
    };
  }
}

function render() {
  updateBadge();
  updateTopDeviceInfo();
  updateTabLabels();

  if (!store.token) {
    app.innerHTML = renderLogin();
    bindLogin();
    return;
  }

  if (currentTab === "home") app.innerHTML = renderHome();
  if (currentTab === "device") app.innerHTML = renderDevice();
  if (currentTab === "alerts") app.innerHTML = renderAlerts();
  if (currentTab === "me") app.innerHTML = renderMe();
  bindActions();
}

function startStatusPolling() {
  if (statusPollTimer) return;

  statusPollTimer = setInterval(async () => {
    if (!store.token || !store.selectedDeviceId || statusPolling) return;
    if (document.hidden || !navigator.onLine) return;
    statusPolling = true;
    try {
      store.deviceStatus = await getDeviceStatus(store.selectedDeviceId, store.token);
      await refreshTelemetryIfNeeded(false);
      updateBadge();
      render();
    } catch (err) {
      if (handleAuthExpired(err)) return;
    } finally {
      statusPolling = false;
    }
  }, STATUS_POLL_INTERVAL_MS);
}

function bindGlobalListeners() {
  window.addEventListener("online", async () => {
    setBanner("");
    updateBadge();
    if (store.token) {
      connectWs();
      await bootstrapData();
    }
  });

  window.addEventListener("offline", () => {
    setBanner("当前网络不可用，请检查连接");
    updateBadge();
  });

  document.addEventListener("visibilitychange", async () => {
    if (!document.hidden && store.token && store.selectedDeviceId) {
      await bootstrapData();
    }
  });
}

async function init() {
  render();
  bindGlobalListeners();
  startStatusPolling();

  if (store.token) {
    connectWs();
    await bootstrapData();
  }
  render();
}

init().catch((err) => {
  console.error("App init failed:", err);
  if (!app) return;
  app.innerHTML = `
    <section class="card">
      <h3>页面加载失败</h3>
      <p class="small">原因：${err?.message || "未知错误"}</p>
      <div class="row">
        <button id="resetAppBtn" class="btn danger">清除缓存并重试</button>
      </div>
    </section>
  `;
  const resetBtn = document.getElementById("resetAppBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      try {
        localStorage.clear();
        if ("serviceWorker" in navigator) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
        if (window.caches?.keys) {
          const keys = await window.caches.keys();
          await Promise.all(keys.map((k) => window.caches.delete(k)));
        }
      } finally {
        window.location.reload();
      }
    });
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js?v=20260310").catch(() => null);
  });
}
