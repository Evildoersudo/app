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
import { store, setToken, addEvent, addAlert, setDebugMode } from "./store.js";

const POWER_ALERT_THRESHOLD = 120;
const app = document.getElementById("app");
const offlineBanner = document.getElementById("offlineBanner");
const onlineBadge = document.getElementById("onlineBadge");
const toastNode = document.getElementById("toast");
const tabs = [...document.querySelectorAll(".tab")];
const topLogo = document.querySelector(".top-logo");

let currentTab = "home";
let wsRetryTimer = null;
let toastTimer = null;
let logoPressTimer = null;
let globalBusy = false;
let alertFilter = "all";

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
      showToast(store.debugMode ? "调试模式已开启" : "调试模式已关闭");
      render();
    }, 5000);
  };
  const clearPress = () => {
    if (logoPressTimer) clearTimeout(logoPressTimer);
    logoPressTimer = null;
  };
  topLogo.addEventListener("mousedown", startPress);
  topLogo.addEventListener("touchstart", startPress);
  topLogo.addEventListener("mouseup", clearPress);
  topLogo.addEventListener("mouseleave", clearPress);
  topLogo.addEventListener("touchend", clearPress);
}

function formatTime(ts) {
  return new Date(ts).toLocaleString();
}

function isOnline() {
  return Boolean(store.deviceStatus?.online);
}

function selectedDevice() {
  return store.devices.find((x) => x.id === store.selectedDeviceId) || null;
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
  if (globalBusy) {
    onlineBadge.innerHTML = `<span class="pulse-dot warn"></span>执行中`;
    return;
  }
  if (!store.wsConnected) {
    onlineBadge.innerHTML = `<span class="pulse-dot warn"></span>WS离线`;
    return;
  }
  if (isOnline()) {
    onlineBadge.innerHTML = `<span class="pulse-dot ok"></span>在线`;
  } else {
    onlineBadge.innerHTML = `<span class="pulse-dot err"></span>离线`;
  }
}

function updateTopDeviceInfo() {
  const node = document.getElementById("topDeviceInfo");
  if (!node) return;
  const d = selectedDevice();
  node.textContent = d ? `${d.room || "-"} / ${d.name || d.id}` : "无设备";
}

function updateTabLabels() {
  const alertCount = store.alerts.filter((a) => !a.resolved).length;
  const labels = {
    home: "概览",
    device: "插排",
    alerts: `告警${alertCount ? `(${alertCount})` : ""}`,
    me: "我的",
  };
  tabs.forEach((tab) => {
    const id = tab.dataset.tab;
    tab.textContent = labels[id] || tab.textContent;
  });
}

async function bootstrapData() {
  try {
    store.devices = await getDevices(store.token);
    if (store.devices.length && !store.devices.find((x) => x.id === store.selectedDeviceId)) {
      store.selectedDeviceId = store.devices[0].id;
    }
    if (store.selectedDeviceId) {
      store.deviceStatus = await getDeviceStatus(store.selectedDeviceId, store.token);
      store.telemetry = await getTelemetry(store.selectedDeviceId, "60s", store.token);
    }
    const d = selectedDevice();
    setBanner(d?.offlineReason ? `离线原因：${d.offlineReason}` : "");
  } catch (e) {
    addAlert("SYSTEM", `初始化失败：${e.message}`, "err");
    setBanner(`初始化失败：${e.message}`);
  } finally {
    render();
  }
}

function scheduleReconnect() {
  if (wsRetryTimer) return;
  wsRetryTimer = setTimeout(() => {
    wsRetryTimer = null;
    connectWs();
  }, 1500);
}

function connectWs() {
  if (!store.token) return;
  try {
    if (store.wsClient) store.wsClient.close();
  } catch {
    // noop
  }
  const ws = new WebSocket(getWsBase());
  store.wsClient = ws;
  ws.onopen = () => {
    store.wsConnected = true;
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
    updateBadge();
    scheduleReconnect();
  };
  ws.onmessage = (evt) => {
    try {
      onWsMessage(JSON.parse(evt.data));
    } catch {
      // ignore
    }
  };
}

function onWsMessage(raw) {
  const type = raw?.type;
  if (!type) return;

  if (type === "DEVICE_STATUS" && raw.deviceId === store.selectedDeviceId) {
    store.deviceStatus = { ...(store.deviceStatus || {}), ...(raw.payload || {}), online: true };
    setBanner("");
    addEvent("DEVICE_STATUS", "状态已更新");
  }
  if (type === "TELEMETRY" && raw.deviceId === store.selectedDeviceId) {
    const p = raw.payload;
    if (p && typeof p.power_w === "number") {
      store.telemetry.push({ ts: p.ts || Math.floor(Date.now() / 1000), power_w: p.power_w });
      if (store.telemetry.length > 120) store.telemetry.shift();
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
    addAlert("OFFLINE", `设备离线：${reason}`, "err");
    setBanner(`离线原因：${reason}`);
  }
  updateBadge();
  render();
}

const cmdWaiters = new Map();
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
      const r = await getCmd(cmdId, store.token);
      if (r?.state && r.state !== "pending") return r.state;
    } catch {
      // continue
    }
  }
  return "timeout";
}

function setGlobalBusy(next) {
  globalBusy = next;
  updateBadge();
}

async function executeCmd(payload, targetKey) {
  if (!isOnline()) {
    addAlert("CONTROL_FAIL", "设备离线", "warn");
    showToast("设备离线");
    return { state: "failed" };
  }
  if (store.pendingCmdByTarget.has(targetKey)) {
    addAlert("CONTROL_FAIL", "目标已有待执行命令", "warn");
    showToast("命令执行中");
    return { state: "failed" };
  }

  let submit;
  try {
    submit = await sendCmd(store.selectedDeviceId, payload, store.token);
  } catch (err) {
    if (err.status === 409) {
      addAlert("CONTROL_FAIL", "命令冲突", "warn");
      showToast("冲突：存在待确认命令");
      const pendingCmdId = err.data?.details?.pendingCmdId || err.data?.pendingCmdId || null;
      if (pendingCmdId) {
        const finalState = await pollCmdState(pendingCmdId);
        addEvent("CMD_CONFLICT_SYNC", `Conflict ${pendingCmdId} => ${finalState}`);
      }
    } else {
      addAlert("CONTROL_FAIL", "控制失败", "err");
      showToast("操作失败");
    }
    render();
    return { state: "failed" };
  }

  const cmdId = submit.cmdId;
  store.pendingCmdByTarget.set(targetKey, cmdId);
  render();

  const wsAck = await waitWsAck(cmdId, 3000);
  if (wsAck) {
    store.pendingCmdByTarget.delete(targetKey);
    addEvent("CMD_ACK", `Command ${cmdId} => ${wsAck}`);
    showToast(wsAck === "success" ? "执行成功" : "执行失败");
    render();
    return { state: wsAck, cmdId };
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

  const ok = window.confirm(`将逐个插孔执行 ${targets.length} 条命令，是否继续？`);
  if (!ok) return;

  setGlobalBusy(true);
  let successCount = 0;
  let failCount = 0;
  for (let i = 0; i < targets.length; i += 1) {
    showToast(`进度 ${i + 1}/${targets.length}`, 900);
    const s = targets[i];
    const key = `${store.selectedDeviceId}:${s.id}:switch`;
    const r = await executeCmd({ socket: s.id, action }, key);
    if (r.state === "success") successCount += 1;
    else failCount += 1;
  }
  setGlobalBusy(false);
  await bootstrapData();
  showToast(`批量完成：成功 ${successCount}，失败 ${failCount}`, 2500);
}

function calcTodayUsageKwh() {
  const points = store.telemetry;
  if (points.length < 2) return 0;
  const avgPower = points.reduce((sum, p) => sum + Number(p.power_w || 0), 0) / points.length;
  return Number((avgPower * 24 / 1000).toFixed(2));
}

function calcYesterdayDelta(todayKwh) {
  const yesterday = todayKwh * 0.88;
  if (!yesterday) return "0%";
  const delta = ((todayKwh - yesterday) / yesterday) * 100;
  return `${delta >= 0 ? "+" : ""}${delta.toFixed(0)}%`;
}

function telemetryChart() {
  const points = store.telemetry.slice(-40);
  if (!points.length) return "<div class='small'>暂无遥测数据</div>";
  const width = 320;
  const height = 100;
  const max = Math.max(POWER_ALERT_THRESHOLD + 20, ...points.map((p) => Number(p.power_w || 0)));
  const min = 0;
  const toX = (i) => (i / (points.length - 1 || 1)) * width;
  const toY = (v) => height - ((v - min) / (max - min || 1)) * height;
  const linePoints = points.map((p, i) => `${toX(i)},${toY(Number(p.power_w || 0))}`).join(" ");
  const areaPoints = `0,${height} ${linePoints} ${width},${height}`;
  const thresholdY = toY(POWER_ALERT_THRESHOLD);

  return `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="100" preserveAspectRatio="none">
        <defs>
          <linearGradient id="powerFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#60a5fa" stop-opacity="0.35"></stop>
            <stop offset="100%" stop-color="#60a5fa" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        <line x1="0" y1="${toY(0)}" x2="${width}" y2="${toY(0)}" stroke="#cbd5e1" stroke-width="1"></line>
        <line x1="0" y1="${toY(max / 2)}" x2="${width}" y2="${toY(max / 2)}" stroke="#e2e8f0" stroke-width="1"></line>
        <line x1="0" y1="${toY(max)}" x2="${width}" y2="${toY(max)}" stroke="#e2e8f0" stroke-width="1"></line>
        <line x1="0" y1="${thresholdY}" x2="${width}" y2="${thresholdY}" stroke="#F79009" stroke-width="1.5" stroke-dasharray="4 3"></line>
        <polygon points="${areaPoints}" fill="url(#powerFill)"></polygon>
        <polyline fill="none" stroke="#1677FF" stroke-width="2" points="${linePoints}"></polyline>
      </svg>
      <div class="chart-legend">
        <span><i class="legend-dot" style="background:#1677FF"></i>功率</span>
        <span><i class="legend-dot" style="background:#F79009"></i>阈值 ${POWER_ALERT_THRESHOLD}W</span>
        <span class="muted">最大 ${max.toFixed(1)}W</span>
      </div>
    </div>
  `;
}

function socketCardHtml(socket) {
  const targetKey = `${store.selectedDeviceId}:${socket.id}:switch`;
  const pending = store.pendingCmdByTarget.has(targetKey);
  const highPower = Number(socket.power_w || 0) >= POWER_ALERT_THRESHOLD;
  const status = pending ? "执行中" : socket.on ? "开启" : "关闭";
  return `
    <div class="socket-card ${socket.on ? "on" : "off"} ${pending ? "pending" : ""} ${highPower ? "high" : ""}">
      <div class="socket-title"><strong>插孔 ${socket.id}</strong><span class="socket-state">${status}</span></div>
      <div class="socket-power">${Number(socket.power_w || 0).toFixed(1)}<span>W</span></div>
      <div class="small">设备：${socket.device || "未命名"}</div>
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

function renderHome() {
  const d = selectedDevice();
  const currentPower = Number(store.deviceStatus?.total_power_w || 0).toFixed(1);
  const todayKwh = calcTodayUsageKwh();
  const yesterdayDelta = calcYesterdayDelta(todayKwh);
  const nightRate = `${Math.min(80, Math.max(10, Math.round((todayKwh * 13) % 50 + 20)))}%`;
  const peakTime = `${19 + (todayKwh > 1 ? 1 : 0)}:00`;

  return `
    ${deviceSelector()}
    <section class="card hero-card">
      <div class="hero-title">今日用电</div>
      <div class="hero-value">${todayKwh}<span>kWh</span></div>
      <div class="small">较昨日 ${yesterdayDelta} | 夜间占比 ${nightRate} | 峰值时段 ${peakTime}</div>
    </section>
    <section class="card">
      <div class="row">
        <div class="kpi"><div class="label">当前功率</div><div class="value">${currentPower}<span class="unit">W</span></div></div>
        <div class="kpi"><div class="label">未处理告警</div><div class="value">${store.alerts.filter((a) => !a.resolved).length}</div></div>
      </div>
      <div class="small">状态：${isOnline() ? "在线" : "离线"} | 原因：${d?.offlineReason || "无"}</div>
    </section>
    <section class="card">
      <div class="row">
        <button id="quickCutoff" class="btn danger" ${!isOnline() || globalBusy ? "disabled" : ""}>一键断电</button>
        <button id="quickSleep" class="btn" ${!isOnline() || globalBusy ? "disabled" : ""}>睡眠模式</button>
        <button id="quickEco" class="btn" ${!isOnline() || globalBusy ? "disabled" : ""}>节能模式</button>
      </div>
    </section>
    <section class="card">
      <h3>最近 60 秒功率</h3>
      ${telemetryChart()}
    </section>
    <section class="card">
      <h3>最近事件</h3>
      <div class="event-list">
        ${store.events.slice(0, 8).map((e) => `<div class="event-item"><strong>${eventTypeLabel(e.type)}</strong> ${e.detail}<div class="small">${formatTime(e.ts)}</div></div>`).join("") || "<div class='small'>暂无事件</div>"}
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
      <h3>告警中心</h3>
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
            </div>`,
          )
          .join("") || "<div class='small'>暂无告警</div>"}
      </div>
    </section>
  `;
}

function renderMe() {
  const d = selectedDevice();
  const todayKwh = calcTodayUsageKwh();
  const weeklyKwh = Number((todayKwh * 7).toFixed(1));
  const nightRate = `${Math.min(80, Math.max(10, Math.round((todayKwh * 13) % 50 + 20)))}%`;
  return `
    <section class="card">
      <h3>账户信息</h3>
      <p class="small">用户：${store.user?.username || "-"}</p>
      <p class="small">角色：${store.user?.role || "-"}</p>
    </section>
    <section class="card">
      <h3>宿舍绑定</h3>
      <p class="small">${d ? `${d.room || "-"} / ${d.name || d.id}` : "未绑定"}</p>
    </section>
    <section class="card">
      <h3>用电统计</h3>
      <p class="small">周用电量：${weeklyKwh} kWh</p>
      <p class="small">夜间占比：${nightRate}</p>
    </section>
    <section class="card">
      <h3>通知设置</h3>
      <label class="small"><input id="nightNotify" type="checkbox" checked /> 夜间提醒</label><br />
      <label class="small"><input id="overPowerNotify" type="checkbox" checked /> 超功率提醒</label>
    </section>
    ${store.debugMode ? `
    <section class="card">
      <h3>调试连接</h3>
      <label class="small" for="apiBaseInput">API 地址</label>
      <input id="apiBaseInput" class="input" value="${getApiBase()}" />
      <label class="small" for="wsBaseInput">WS 地址</label>
      <input id="wsBaseInput" class="input" value="${getWsBase()}" />
      <div class="row">
        <button id="saveConnBtn" class="btn primary">保存并重连</button>
      </div>
    </section>` : ""}
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
      store.selectedDeviceId = select.value;
      await bootstrapData();
    });
  }
  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) refreshBtn.onclick = () => bootstrapData();
}

function bindLogin() {
  const loginBtn = document.getElementById("loginBtn");
  if (!loginBtn) return;
  loginBtn.addEventListener("click", async () => {
    const account = document.getElementById("account").value.trim();
    const password = document.getElementById("password").value.trim();
    try {
      const result = await login(account, password);
      setToken(result.token);
      store.user = result.user || { username: account, role: "admin" };
      addEvent("LOGIN", `登录成功：${store.user.username}`);
      showToast("登录成功");
      connectWs();
      await bootstrapData();
    } catch (e) {
      addAlert("SYSTEM", `登录失败：${e.message}`, "err");
      setBanner(`登录失败：${e.message}`);
      render();
    }
  });
}

function bindActions() {
  bindDeviceSelectorAndRefresh();

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

  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      alertFilter = btn.dataset.filter;
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
      const a = store.alerts.find((x) => x.id === id);
      if (a) a.resolved = true;
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
      const apiVal = document.getElementById("apiBaseInput").value.trim();
      const wsVal = document.getElementById("wsBaseInput").value.trim();
      if (!apiVal || !wsVal) return;
      setApiBase(apiVal);
      setWsBase(wsVal);
      addEvent("CONFIG", `Updated connection: ${apiVal} / ${wsVal}`);
      showToast("配置已保存，正在重连");
      connectWs();
      await bootstrapData();
    };
  }

  const healthInfo = document.getElementById("healthInfo");
  if (healthInfo) {
    getHealth()
      .then((h) => {
        healthInfo.textContent = `服务=${h.ok ? "正常" : "异常"} | MQTT=${h.mqtt_connected ? "已连接" : "未连接"} | 数据库=${h.database_url || "-"}`;
      })
      .catch((e) => {
        healthInfo.textContent = `健康检查失败：${e.message}`;
      });
  }

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      setToken("");
      store.user = null;
      store.wsConnected = false;
      try {
        if (store.wsClient) store.wsClient.close();
      } catch {
        // noop
      }
      setBanner("");
      showToast("已退出登录");
      render();
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

async function init() {
  if (store.token) {
    connectWs();
    await bootstrapData();
  }
  render();
  setInterval(async () => {
    if (!store.token || !store.selectedDeviceId) return;
    try {
      store.deviceStatus = await getDeviceStatus(store.selectedDeviceId, store.token);
      updateBadge();
      render();
    } catch {
      // noop
    }
  }, 8000);
}

init();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => null);
  });
}
