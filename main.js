import {
  getApiBase,
  getWsBase,
  setApiBase,
  setWsBase,
  login,
  getDevices,
  getDeviceStatus,
  getTelemetry,
  getDailyCheckup,
  getBehaviorEvents,
  getAppBehaviorOverview,
  getAppHabit,
  getBehaviorSessions,
  postAgentQuery,
  sendCmd,
  getCmd,
  getMailSetting,
  updateMailSetting,
} from "./api.js?v=20260809b";
import {
  store,
  setToken,
  setCurrentUser,
  addEvent,
  addAlert,
  addAssistantMessage,
  clearAssistantMessages,
  setDebugMode,
  setSelectedDeviceId,
  setTelemetryRange,
  setAlertPref,
  setQuickActionState,
  clearQuickActionStates,
  loadBehaviorCache,
  saveBehaviorCache,
  clearBehaviorCache,
} from "./store.js?v=20260809b";

const STATUS_POLL_CONNECTED_MS = 60000;
const STATUS_POLL_DISCONNECTED_MS = 8000;
const TELEMETRY_REFRESH_CONNECTED_MS = 60000;
const TELEMETRY_REFRESH_DISCONNECTED_MS = 12000;
const SUPPLEMENT_REFRESH_INTERVAL_MS = 20000;
const BEHAVIOR_OVERVIEW_REFRESH_INTERVAL_MS = 60000;
const HABIT_REFRESH_INTERVAL_MS = 300000;
const LOGO_LONG_PRESS_MS = 5000;
const ALLOWED_RANGES = ["1h", "24h", "7d", "30d"];
const RANGE_LABELS = { "1h": "1小时", "24h": "24小时", "7d": "7天", "30d": "30天" };

const BEHAVIOR_META = {
  normal: { title: "正常用电", desc: "当前没有明显风险", tone: "ok" },
  standby_waste: { title: "低功率待机", desc: "设备长时间低功率运行，可能存在待机耗电", tone: "warn" },
  unknown_high_power: { title: "未知高功率", desc: "设备尚未识别且功率较高，需要确认类型", tone: "danger" },
  long_high_power: { title: "长时间高负载", desc: "功率持续偏高，建议关注接入设备", tone: "danger" },
  frequent_switching: { title: "频繁启停", desc: "插孔短时间内多次开关，可能存在异常操作", tone: "warn" },
  protected_cutoff: { title: "保护断电", desc: "端侧已执行保护动作，请先确认现场情况", tone: "danger" },
};

const LEVEL_META = {
  low: { title: "正常", tone: "ok" },
  medium: { title: "需要关注", tone: "warn" },
  high: { title: "高风险", tone: "danger" },
};

const REASON_BITS = [
  [0x0001, "设备未识别或处于待学习状态"],
  [0x0002, "当前功率达到高负载判断条件"],
  [0x0004, "对应行为持续时间达到阈值"],
  [0x0008, "低功率待机持续时间较长"],
  [0x0010, "短时间内开关变化次数较多"],
  [0x0020, "功率出现明显跳变"],
  [0x0040, "策略允许并已执行保护断电"],
];

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
    label: "首页",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.8 12 4l9 7.8v8.2a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1z"/></svg>`,
  },
  device: {
    label: "插孔",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h10a3 3 0 0 1 3 3v6a7 7 0 1 1-14 0V6a3 3 0 0 1 3-3m0 3v5h2V6zm8 0v5h2V6z"/></svg>`,
  },
  habit: {
    label: "习惯",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16v2H4zm1-3h3V8H5zm5 0h4V3h-4zm6 0h3v-6h-3z"/></svg>`,
  },
  alerts: {
    label: "提醒",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 1.9 20.5A1 1 0 0 0 2.8 22h18.4a1 1 0 0 0 .9-1.5zM11 9h2v6h-2zm0 8h2v2h-2z"/></svg>`,
  },
  me: {
    label: "我的",
    icon: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5m0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5"/></svg>`,
  },
};

const ASSISTANT_QUESTIONS = [
  "今天用电正常吗？",
  "为什么提醒我？",
  "为什么显示 Unknown？",
  "为什么插座被保护断电？",
  "哪些插孔可以关闭省电？",
  "设备离线怎么办？",
];

const app = document.getElementById("app");
const offlineBanner = document.getElementById("offlineBanner");
const onlineBadge = document.getElementById("onlineBadge");
const toastNode = document.getElementById("toast");
const updateBanner = document.getElementById("updateBanner");
const applyUpdateBtn = document.getElementById("applyUpdateBtn");
const tabs = [...document.querySelectorAll(".tab")];
const topLogo = document.querySelector(".top-logo");

let currentTab = "home";
let alertFilter = localStorage.getItem("dp_alert_filter") || "all";
let wsRetryTimer = null;
let wsRetryDelay = 1500;
let statusPollTimer = null;
let statusPolling = false;
let statusPollFailureCount = 0;
let lastStatusRefreshAt = 0;
let lastTelemetryRefreshAt = 0;
let lastSupplementRefreshAt = 0;
let lastBehaviorOverviewRefreshAt = 0;
let lastHabitRefreshAt = 0;
let toastTimer = null;
let logoPressTimer = null;
let globalBusy = false;
let bootstrapSeq = 0;
let mailPreference = { enabled: false, serviceEnabled: false, smtpConfigured: false, email: "", loaded: false };
const customTypeDraftBySocket = new Map();
const cmdWaiters = new Map();
let deferredRender = false;
let assistantInteractionActive = false;
let assistantInteractionTimer = null;
let habitInteractionActive = false;
let habitInteractionTimer = null;
let behaviorCacheDeviceId = "";
let selectedHabitSlot = null;
let selectedHabitHour = null;
let habitViewFilter = "all";
let lastRenderedAssistantMessageCount = 0;
let pendingServiceWorker = null;
let serviceWorkerReloading = false;
let deferredInstallPrompt = null;

if (!ALLOWED_RANGES.includes(store.telemetryRange)) {
  setTelemetryRange("1h");
}

tabs.forEach((btn) => {
  btn.addEventListener("click", async () => {
    currentTab = btn.dataset.tab;
    tabs.forEach((b) => b.classList.toggle("active", b === btn));
    render();
    if (currentTab === "habit") await enterHabitTab();
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

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMarkdownInline(text) {
  const parts = String(text || "").split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts
    .map((part) => {
      if (part.startsWith("`") && part.endsWith("`")) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      if (part.startsWith("**") && part.endsWith("**")) {
        return `<strong>${escapeHtml(part.slice(2, -2))}</strong>`;
      }
      return escapeHtml(part);
    })
    .join("");
}

function normalizeAssistantMarkdown(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+(-\s+\*\*[^*]+?\*\*)/g, "\n$1")
    .replace(/\s+(\d+\.\s+\*\*[^*]+?\*\*)/g, "\n$1")
    .trim();
}

function renderMarkdown(text) {
  const lines = normalizeAssistantMarkdown(text).split("\n");
  const html = [];
  let bulletItems = [];
  let orderedItems = [];
  let codeLines = [];
  let inCode = false;

  const flushBullets = () => {
    if (!bulletItems.length) return;
    html.push(`<ul>${bulletItems.map((item) => `<li>${renderMarkdownInline(item)}</li>`).join("")}</ul>`);
    bulletItems = [];
  };
  const flushOrdered = () => {
    if (!orderedItems.length) return;
    html.push(`<ol>${orderedItems.map((item) => `<li>${renderMarkdownInline(item)}</li>`).join("")}</ol>`);
    orderedItems = [];
  };
  const flushCode = () => {
    if (!codeLines.length) return;
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeLines = [];
  };

  lines.forEach((rawLine) => {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      flushBullets();
      flushOrdered();
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        inCode = true;
      }
      return;
    }

    if (inCode) {
      codeLines.push(rawLine);
      return;
    }

    if (!trimmed) {
      flushBullets();
      flushOrdered();
      return;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushBullets();
      flushOrdered();
      const level = Math.min(heading[1].length, 4);
      html.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
      return;
    }

    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flushOrdered();
      bulletItems.push(bullet[1]);
      return;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.*)$/);
    if (ordered) {
      flushBullets();
      orderedItems.push(ordered[1]);
      return;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushBullets();
      flushOrdered();
      html.push(`<blockquote>${renderMarkdownInline(quote[1])}</blockquote>`);
      return;
    }

    flushBullets();
    flushOrdered();
    html.push(`<p>${renderMarkdownInline(trimmed)}</p>`);
  });

  flushBullets();
  flushOrdered();
  flushCode();
  return html.join("");
}

function formatTime(ts) {
  const ms = Number(ts || 0) > 10_000_000_000 ? Number(ts) : Number(ts || 0) * 1000;
  return new Date(ms || Date.now()).toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(seconds) {
  const s = Math.max(0, Number(seconds || 0));
  if (s < 60) return `${Math.round(s)}秒`;
  if (s < 3600) return `${Math.round(s / 60)}分钟`;
  return `${(s / 3600).toFixed(1)}小时`;
}

function formatBeijingTime(timestamp, fallback = "--") {
  const value = Number(timestamp || 0);
  if (!value) return fallback;
  const shifted = new Date((value + 8 * 3600) * 1000);
  const pad = (part) => String(part).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

function useStateMeta(value, protectedCutoff = false) {
  if (protectedCutoff) return { title: "保护断电", tone: "danger" };
  if (value === "active") return { title: "使用中", tone: "ok" };
  if (value === "standby") return { title: "待机", tone: "warn" };
  return { title: "已关闭", tone: "neutral" };
}

function behaviorSocket(socketId) {
  return (store.behaviorOverview?.sockets || []).find((item) => Number(item.socketId) === Number(socketId)) || null;
}

function liveDurationText(live) {
  if (!live || live.useState === "off") return "";
  if (!live.timeTrusted || !live.sessionStartTimestamp) return "本次上线后状态，开始时间待同步";
  const serverNow = Number(store.behaviorOverview?.serverNow || Math.floor(Date.now() / 1000));
  const elapsed = Math.max(0, serverNow + Math.floor((Date.now() - store.behaviorLastUpdatedAt) / 1000) - Number(live.sessionStartTimestamp));
  return `已持续 ${formatDuration(elapsed)}`;
}

function selectedDevice() {
  return store.devices.find((x) => x.id === store.selectedDeviceId) || null;
}

function selectedRoomId() {
  return selectedDevice()?.room || "";
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

function behaviorMeta(tag) {
  return BEHAVIOR_META[tag] || { title: tag || "未知行为", desc: "端侧返回了新的行为标签，请以风险分和原因位为准", tone: "warn" };
}

function levelMeta(level) {
  return LEVEL_META[level] || LEVEL_META.low;
}

function socketBehavior(socket = {}) {
  return {
    tag: String(socket.bt || "normal"),
    score: Number(socket.bs || 0),
    level: String(socket.bl || "low"),
    reasonMask: Number(socket.bm || 0),
    standbySeconds: Number(socket.stb || 0),
    highPowerSeconds: Number(socket.hp || 0),
    unknownSeconds: Number(socket.unk || 0),
    switchCount: Number(socket.sw || 0),
  };
}

function rootBehavior() {
  const b = store.deviceStatus?.behavior || {};
  return {
    top: Number(b.top || 0),
    tag: String(b.tag || "normal"),
    risk: Number(b.risk || 0),
    level: String(b.level || "low"),
  };
}

function reasonTexts(mask, tag = "") {
  const reasons = REASON_BITS.filter(([bit]) => Number(mask || 0) & bit).map(([, text]) => text);
  if (!reasons.length) {
    if (tag === "standby_waste") reasons.push("设备处于低功率待机状态");
    if (tag === "unknown_high_power") reasons.push("设备未识别且功率较高");
    if (tag === "protected_cutoff") reasons.push("端侧已执行保护断电");
    if (tag === "long_high_power") reasons.push("高功率运行时间较长");
    if (tag === "frequent_switching") reasons.push("短时间内开关变化较多");
  }
  return reasons;
}

function focusSocket() {
  const sockets = store.deviceStatus?.sockets || [];
  const b = rootBehavior();
  if (b.top) return sockets.find((s) => Number(s.id) === b.top) || null;
  return sockets
    .slice()
    .sort((a, b2) => Number(b2.bs || 0) - Number(a.bs || 0))[0] || null;
}

function riskTone() {
  if (!isOnline()) return "offline";
  return levelMeta(rootBehavior().level).tone;
}

function statusTitle() {
  if (!store.selectedDeviceId) return "请选择设备";
  if (!isOnline()) return "设备离线";
  const b = rootBehavior();
  if (b.risk <= 0 && b.tag === "normal") return "当前用电正常";
  return `${levelMeta(b.level).title}：${behaviorMeta(b.tag).title}`;
}

function statusSubtitle() {
  if (!store.selectedDeviceId) return "登录后选择或绑定智能插排。";
  if (!isOnline()) return "暂时无法获取设备状态，0W 不代表设备已关闭。";
  const socket = focusSocket();
  if (!socket || Number(socket.bs || 0) <= 0) return "暂未发现需要立即处理的插孔。";
  return `插孔 ${socket.id} ${behaviorMeta(socket.bt).title}，风险分 ${Number(socket.bs || 0)}。`;
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

function unresolvedReminderCount() {
  const behaviorCount = (store.behaviorEvents || []).filter((e) => e.level === "medium" || e.level === "high").length;
  const localCount = store.alerts.filter((a) => !a.resolved).length;
  return behaviorCount + localCount;
}

function updateTabLabels() {
  const count = unresolvedReminderCount();
  tabs.forEach((tab) => {
    const id = tab.dataset.tab;
    const meta = TAB_META[id];
    if (!meta) return;
    const active = id === currentTab;
    tab.classList.toggle("active", active);
    if (active) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
    const badge =
      id === "alerts" && count > 0
        ? `<span class="tab-badge">${count > 99 ? "99+" : count}</span>`
        : "";
    tab.innerHTML = `
      <span class="tab-inner">
        <span class="tab-icon">${meta.icon}</span>
        <span class="tab-label">${meta.label}</span>
        ${badge}
      </span>
    `;
  });
}

function setGlobalBusy(next) {
  globalBusy = Boolean(next);
  updateBadge();
}

function isEditingInput() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || Boolean(el.isContentEditable);
}

function isAssistantChatTarget(target) {
  return target instanceof Element && Boolean(target.closest(".assistant-chat"));
}

function isHabitInteractionTarget(target) {
  return target instanceof Element && Boolean(target.closest(".habit-scroll, .habit-profile-tabs, .session-list"));
}

function holdAssistantInteraction() {
  assistantInteractionActive = true;
  if (assistantInteractionTimer) window.clearTimeout(assistantInteractionTimer);
}

function releaseAssistantInteraction(delayMs = 500) {
  if (assistantInteractionTimer) window.clearTimeout(assistantInteractionTimer);
  assistantInteractionTimer = window.setTimeout(() => {
    assistantInteractionActive = false;
    assistantInteractionTimer = null;
    flushDeferredRender();
  }, delayMs);
}

function holdHabitInteraction() {
  habitInteractionActive = true;
  if (habitInteractionTimer) window.clearTimeout(habitInteractionTimer);
}

function releaseHabitInteraction(delayMs = 700) {
  if (habitInteractionTimer) window.clearTimeout(habitInteractionTimer);
  habitInteractionTimer = window.setTimeout(() => {
    habitInteractionActive = false;
    habitInteractionTimer = null;
    flushDeferredRender();
  }, delayMs);
}

function captureHabitScroll() {
  if (currentTab !== "habit") return null;
  const timeline = document.querySelector(".habit-scroll");
  return { pageY: window.scrollY, timelineX: timeline?.scrollLeft || 0 };
}

function restoreHabitScroll(state) {
  if (!state || currentTab !== "habit") return;
  requestAnimationFrame(() => {
    window.scrollTo({ top: state.pageY, behavior: "instant" });
    const timeline = document.querySelector(".habit-scroll");
    if (timeline) timeline.scrollLeft = state.timelineX;
  });
}

function captureAssistantScroll() {
  const chat = document.querySelector(".assistant-chat");
  if (!chat) return null;
  return {
    scrollTop: chat.scrollTop,
    pinnedToBottom: chat.scrollHeight - chat.clientHeight - chat.scrollTop <= 24,
  };
}

function restoreAssistantScroll(scrollState, messageCountChanged) {
  const chat = document.querySelector(".assistant-chat");
  if (!chat) return;

  if (messageCountChanged && !assistantInteractionActive) {
    chat.scrollTop = chat.scrollHeight;
    return;
  }

  if (scrollState) {
    chat.scrollTop = scrollState.pinnedToBottom ? chat.scrollHeight : scrollState.scrollTop;
  }
}

function safeRender({ force = false } = {}) {
  if (!force && (isEditingInput() || assistantInteractionActive || habitInteractionActive)) {
    deferredRender = true;
    updateBadge();
    updateTopDeviceInfo();
    updateTabLabels();
    return;
  }
  deferredRender = false;
  render();
}

function flushDeferredRender() {
  if (!deferredRender) return;
  safeRender({ force: true });
}

function clearSessionAndRender(tip = "登录已过期，请重新登录") {
  const previousUsername = behaviorCacheUsername();
  setToken("");
  clearBehaviorCache(previousUsername);
  setCurrentUser(null);
  store.wsConnected = false;
  store.deviceStatus = null;
  store.telemetry = [];
  store.dailyCheckup = null;
  store.behaviorEvents = [];
  store.devices = [];
  store.selectedDeviceId = "";
  behaviorCacheDeviceId = "";
  lastBehaviorOverviewRefreshAt = 0;
  lastHabitRefreshAt = 0;
  clearAssistantMessages();
  mailPreference = { enabled: false, serviceEnabled: false, smtpConfigured: false, email: "", loaded: false };
  customTypeDraftBySocket.clear();
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

async function refreshMailPreference() {
  if (!store.token) {
    mailPreference = { enabled: false, serviceEnabled: false, smtpConfigured: false, email: "", loaded: false };
    return;
  }
  try {
    const result = await getMailSetting(store.token);
    mailPreference = {
      enabled: Boolean(result?.enabled),
      serviceEnabled: Boolean(result?.serviceEnabled),
      smtpConfigured: Boolean(result?.smtpConfigured),
      email: String(result?.email || store.user?.email || ""),
      loaded: true,
    };
  } catch (err) {
    if (handleAuthExpired(err)) return;
    mailPreference = {
      enabled: false,
      serviceEnabled: false,
      smtpConfigured: false,
      email: store.user?.email || "",
      loaded: true,
    };
  }
}

async function refreshTelemetryIfNeeded(force = false) {
  if (!store.token || !store.selectedDeviceId) return;
  const now = Date.now();
  const interval = store.wsConnected ? TELEMETRY_REFRESH_CONNECTED_MS : TELEMETRY_REFRESH_DISCONNECTED_MS;
  if (!force && now - lastTelemetryRefreshAt < interval) return;
  const deviceId = store.selectedDeviceId;
  const range = store.telemetryRange;
  const telemetry = await getTelemetry(deviceId, range, store.token);
  if (deviceId !== store.selectedDeviceId || range !== store.telemetryRange) return;
  store.telemetry = Array.isArray(telemetry) ? telemetry : [];
  lastTelemetryRefreshAt = now;
}

async function refreshSupplementIfNeeded(force = false) {
  if (!store.token || !store.selectedDeviceId) return;
  const now = Date.now();
  if (!force && now - lastSupplementRefreshAt < SUPPLEMENT_REFRESH_INTERVAL_MS) return;
  const roomId = selectedRoomId();
  const tasks = [
    getBehaviorEvents({ deviceId: store.selectedDeviceId, limit: 50 }, store.token)
      .then((events) => {
        store.behaviorEvents = Array.isArray(events) ? events : [];
      })
      .catch((err) => {
        if (!handleAuthExpired(err)) store.behaviorEvents = store.behaviorEvents || [];
      }),
  ];
  if (roomId) {
    tasks.push(
      getDailyCheckup(roomId, store.selectedDeviceId, store.token)
        .then((checkup) => {
          store.dailyCheckup = checkup || null;
        })
        .catch((err) => {
          if (!handleAuthExpired(err)) store.dailyCheckup = null;
        }),
    );
  }
  await Promise.all(tasks);
  lastSupplementRefreshAt = now;
}

function behaviorCacheUsername() {
  return store.user?.username || "student";
}

function persistBehaviorState() {
  if (!store.selectedDeviceId) return;
  saveBehaviorCache(behaviorCacheUsername(), store.selectedDeviceId).catch(() => undefined);
}

async function restoreBehaviorState(deviceId) {
  if (!deviceId || behaviorCacheDeviceId === deviceId) return;
  behaviorCacheDeviceId = deviceId;
  if (!(await loadBehaviorCache(behaviorCacheUsername(), deviceId))) {
    store.behaviorOverview = null;
    store.habitProfiles = [];
    store.selectedHabitProfileId = null;
    store.habitDetail = null;
    store.behaviorSessions = [];
    store.sessionCursor = null;
  }
}

async function refreshBehaviorOverview(force = false) {
  if (!store.token || !store.selectedDeviceId || !navigator.onLine) return;
  const now = Date.now();
  if (!force && now - lastBehaviorOverviewRefreshAt < BEHAVIOR_OVERVIEW_REFRESH_INTERVAL_MS) return;
  store.behaviorLoading = !store.behaviorOverview;
  try {
    const overview = await getAppBehaviorOverview(store.selectedDeviceId, store.token);
    if (overview?.device?.deviceId !== store.selectedDeviceId) return;
    store.behaviorOverview = overview;
    store.habitProfiles = Array.isArray(overview.profiles) ? overview.profiles : [];
    if (!store.habitProfiles.some((item) => Number(item.profileId) === Number(store.selectedHabitProfileId))) {
      store.selectedHabitProfileId = store.habitProfiles[0]?.profileId ?? null;
      store.habitDetail = null;
      lastHabitRefreshAt = 0;
    }
    store.behaviorError = "";
    store.behaviorLastUpdatedAt = now;
    lastBehaviorOverviewRefreshAt = now;
    persistBehaviorState();
  } catch (err) {
    if (handleAuthExpired(err)) return;
    store.behaviorError = err.message || "用电行为数据加载失败";
  } finally {
    store.behaviorLoading = false;
  }
}

async function refreshHabitDetail(force = false) {
  const profileId = store.selectedHabitProfileId;
  if (!store.token || !store.selectedDeviceId || profileId == null || !navigator.onLine) return;
  const now = Date.now();
  if (!force && now - lastHabitRefreshAt < HABIT_REFRESH_INTERVAL_MS) return;
  store.behaviorLoading = !store.habitDetail;
  try {
    const detail = await getAppHabit(store.selectedDeviceId, profileId, store.token);
    if (Number(detail?.profile?.profileId) !== Number(store.selectedHabitProfileId)) return;
    store.habitDetail = detail;
    store.behaviorError = "";
    store.behaviorLastUpdatedAt = now;
    lastHabitRefreshAt = now;
    persistBehaviorState();
  } catch (err) {
    if (handleAuthExpired(err)) return;
    store.behaviorError = err.message || "7天习惯加载失败";
  } finally {
    store.behaviorLoading = false;
  }
}

async function refreshBehaviorSessions({ reset = false } = {}) {
  if (!store.token || !store.selectedDeviceId || !navigator.onLine) return;
  const cursor = reset ? "" : store.sessionCursor ?? "";
  if (!reset && cursor === null) return;
  const deviceId = store.selectedDeviceId;
  const socketFilter = store.sessionSocketFilter;
  try {
    const result = await getBehaviorSessions(
      {
        deviceId,
        socketId: socketFilter,
        limit: 20,
        cursor,
      },
      store.token,
    );
    if (deviceId !== store.selectedDeviceId || socketFilter !== store.sessionSocketFilter) return;
    const incoming = Array.isArray(result?.items) ? result.items : [];
    if (reset) store.behaviorSessions = incoming;
    else {
      const known = new Set(store.behaviorSessions.map((item) => item.id));
      store.behaviorSessions = [...store.behaviorSessions, ...incoming.filter((item) => !known.has(item.id))];
    }
    store.sessionCursor = result?.nextCursor ?? null;
    persistBehaviorState();
  } catch (err) {
    if (handleAuthExpired(err)) return;
    store.behaviorError = err.message || "用电会话加载失败";
  }
}

async function enterHabitTab() {
  if (!store.token || !store.selectedDeviceId) return;
  store.behaviorLoading = true;
  safeRender();
  await refreshBehaviorOverview(false);
  await Promise.all([refreshHabitDetail(false), refreshBehaviorSessions({ reset: true })]);
  store.behaviorLoading = false;
  safeRender();
}

async function bootstrapData() {
  if (!store.token) return;
  const seq = ++bootstrapSeq;
  try {
    const devices = await getDevices(store.token);
    if (seq !== bootstrapSeq) return;
    store.devices = Array.isArray(devices) ? devices : [];

    const boundDeviceId = store.devices[0]?.id || "";
    if (store.selectedDeviceId !== boundDeviceId) {
      setSelectedDeviceId(boundDeviceId);
    }

    if (store.selectedDeviceId) {
      await restoreBehaviorState(store.selectedDeviceId);
      const status = await getDeviceStatus(store.selectedDeviceId, store.token);
      if (seq !== bootstrapSeq) return;
      store.deviceStatus = status || null;
      lastStatusRefreshAt = Date.now();
      await refreshTelemetryIfNeeded(true);
      await refreshSupplementIfNeeded(true);
      await refreshBehaviorOverview(true);
      if (currentTab === "habit") {
        await Promise.all([refreshHabitDetail(true), refreshBehaviorSessions({ reset: true })]);
      }
    } else {
      store.deviceStatus = null;
      store.telemetry = [];
      store.dailyCheckup = null;
      store.behaviorEvents = [];
      store.behaviorOverview = null;
      store.habitProfiles = [];
      store.habitDetail = null;
      store.behaviorSessions = [];
    }
    await refreshMailPreference();

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
    if (seq === bootstrapSeq) safeRender();
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

  const ws = new WebSocket(getWsBase());
  store.wsClient = ws;

  ws.onopen = async () => {
    if (store.wsClient !== ws) return;
    store.wsConnected = true;
    statusPollFailureCount = 0;
    wsRetryDelay = 1500;
    addEvent("SYSTEM", "WebSocket 已连接");
    updateBadge();
    scheduleStatusPolling(STATUS_POLL_CONNECTED_MS);
    safeRender();
    await refreshBehaviorOverview(true);
    if (currentTab === "habit") {
      await Promise.all([refreshHabitDetail(true), refreshBehaviorSessions({ reset: true })]);
    }
    safeRender();
  };

  ws.onerror = () => {
    if (store.wsClient !== ws) return;
    store.wsConnected = false;
    updateBadge();
  };

  ws.onclose = () => {
    if (store.wsClient !== ws) return;
    store.wsConnected = false;
    wsRetryDelay = Math.min(60000, Math.floor(wsRetryDelay * 1.8));
    updateBadge();
    scheduleStatusPolling(0);
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
    mergeBehaviorOverviewStatus(raw.payload || {});
    setBanner("");
    addEvent("DEVICE_STATUS", "设备状态已更新");
    lastStatusRefreshAt = Date.now();
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

  if (type === "behavior.session.created" && raw.deviceId === store.selectedDeviceId) {
    const item = raw.session;
    if (item && (store.sessionSocketFilter === "" || Number(store.sessionSocketFilter) === Number(item.socketId))) {
      store.behaviorSessions = [item, ...store.behaviorSessions.filter((row) => row.id !== item.id)];
    }
    lastBehaviorOverviewRefreshAt = 0;
    refreshBehaviorOverview(true).then(() => {
      persistBehaviorState();
      safeRender();
    }).catch(() => undefined);
  }

  if (String(type).startsWith("behavior.habit.") && raw.deviceId === store.selectedDeviceId) {
    lastHabitRefreshAt = 0;
    lastBehaviorOverviewRefreshAt = 0;
    Promise.all([refreshBehaviorOverview(true), refreshHabitDetail(true)]).then(() => safeRender()).catch(() => undefined);
  }

  updateBadge();
  if (type === "DEVICE_STATUS" || type === "TELEMETRY" || type === "DEVICE_OFFLINE") {
    updateRealtimeDom(type);
  } else {
    safeRender();
  }
}

function mergeBehaviorOverviewStatus(payload) {
  const overview = store.behaviorOverview;
  if (!overview) return;
  const previous = new Map((overview.sockets || []).map((item) => [Number(item.socketId), item]));
  const sockets = Array.isArray(payload.sockets) ? payload.sockets : [];
  overview.device = {
    ...overview.device,
    online: true,
    totalPowerW: Number(payload.total_power_w || 0),
  };
  overview.sockets = sockets.map((socket) => {
    const old = previous.get(Number(socket.id)) || {};
    const useState = ["off", "standby", "active"].includes(socket.useState) ? socket.useState : "off";
    const startedAt = Number(socket.sessionStartTimestamp || 0);
    return {
      ...old,
      socketId: Number(socket.id),
      device: socket.device || "Unknown",
      on: Boolean(socket.on),
      useState,
      powerW: Number(socket.power_w || 0),
      sessionStartTimestamp: startedAt,
      timeTrusted: Boolean(old.timeTrusted && ((useState === "off" && startedAt === 0) || (useState !== "off" && startedAt > 0))),
      protectedCutoff: socket.bt === "protected_cutoff",
    };
  });
  overview.counts = {
    active: overview.sockets.filter((item) => item.useState === "active").length,
    standby: overview.sockets.filter((item) => item.useState === "standby").length,
    off: overview.sockets.filter((item) => item.useState === "off").length,
    protectedCutoff: overview.sockets.filter((item) => item.protectedCutoff).length,
  };
  overview.serverNow = Math.floor(Date.now() / 1000);
  store.behaviorLastUpdatedAt = Date.now();
  if (store.habitDetail?.liveState?.socketId) {
    const current = overview.sockets.find((item) => item.socketId === Number(store.habitDetail.liveState.socketId));
    if (current) store.habitDetail.liveState = { ...store.habitDetail.liveState, ...current };
  }
  persistBehaviorState();
}

function updateHabitLiveOverlay() {
  if (currentTab !== "habit" || !store.habitDetail) return;
  const overlays = habitOverlayKeys(store.habitDetail);
  const liveState = store.habitDetail.liveState?.useState;
  document.querySelectorAll(".habit-slot[data-habit-date]").forEach((node) => {
    node.classList.remove("live-active", "live-standby");
    const date = Number(node.dataset.habitDate);
    const slot = Number(node.dataset.habitSlot);
    if (date !== 0 && overlays.has(`${date}:${slot}`) && (liveState === "active" || liveState === "standby")) {
      node.classList.add(`live-${liveState}`);
    }
  });
}

function updateRealtimeDom(type = "DEVICE_STATUS") {
  updateTopDeviceInfo();
  const online = isOnline();
  document.querySelectorAll("[data-live-status-title]").forEach((node) => {
    node.textContent = statusTitle();
  });
  document.querySelectorAll("[data-live-status-subtitle]").forEach((node) => {
    node.textContent = statusSubtitle();
  });
  document.querySelectorAll("[data-live-device-online]").forEach((node) => {
    node.className = `pill ${online ? "ok" : "neutral"}`;
    node.textContent = online ? "在线" : "离线";
  });
  document.querySelectorAll("[data-live-total-power]").forEach((node) => {
    node.textContent = `${currentPowerW().toFixed(1)}W`;
  });

  const sockets = store.deviceStatus?.sockets || [];
  sockets.forEach((socket) => {
    const id = Number(socket.id);
    const behavior = socketBehavior(socket);
    const live = behaviorSocket(id) || socket;
    const state = useStateMeta(live.useState, live.protectedCutoff || behavior.tag === "protected_cutoff");
    const name = readableDeviceType(socket.device);
    document.querySelectorAll(`[data-live-socket-name="${id}"]`).forEach((node) => {
      node.textContent = name;
    });
    document.querySelectorAll(`[data-live-socket-summary="${id}"]`).forEach((node) => {
      node.textContent = `${Number(socket.power_w || 0).toFixed(1)}W · ${state.title}`;
    });
    document.querySelectorAll(`[data-live-socket-power="${id}"]`).forEach((node) => {
      node.innerHTML = `${Number(socket.power_w || 0).toFixed(1)}<span>W</span>`;
    });
    document.querySelectorAll(`[data-live-socket-state="${id}"]`).forEach((node) => {
      node.className = `pill ${state.tone}`;
      node.textContent = state.title;
    });
  });

  const focus = focusSocket();
  if (focus) {
    document.querySelectorAll("[data-live-focus-socket]").forEach((node) => {
      node.textContent = `当前主要设备 · 插孔 ${focus.id || focus.socketId}`;
    });
    document.querySelectorAll("[data-live-focus-name]").forEach((node) => {
      node.textContent = readableDeviceType(focus.device);
    });
    document.querySelectorAll("[data-live-focus-power]").forEach((node) => {
      node.innerHTML = `${Number(focus.power_w ?? focus.powerW ?? 0).toFixed(1)}<span>W</span>`;
    });
  }

  if (type === "TELEMETRY") {
    const chart = document.getElementById("telemetryLiveRegion");
    if (chart) chart.innerHTML = telemetryChart({ compact: true });
  }
  updateHabitLiveOverlay();
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
    addAlert("CONTROL_FAIL", "设备离线，无法控制", "warn");
    showToast("设备离线，无法控制");
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
      showToast("存在待执行命令");
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

async function executeBulkSocketAction(action, { label = "", strong = false } = {}) {
  const sockets = store.deviceStatus?.sockets || [];
  if (!sockets.length) return { state: "failed" };

  const desiredOn = action === "on";
  const targets = sockets.filter((s) => {
    if (desiredOn && socketBehavior(s).tag === "protected_cutoff") return false;
    return Boolean(s.on) !== desiredOn;
  });
  if (!targets.length) {
    showToast("无需变更");
    return { state: "noop", successCount: 0, failCount: 0 };
  }

  const msg = label || `将逐个插孔执行 ${targets.length} 条命令，确认继续吗？`;
  const ok = strong ? window.confirm(`${msg}\n\n请确认现场安全后再继续。`) : window.confirm(msg);
  if (!ok) return { state: "cancelled" };

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
  showToast(`完成：成功 ${successCount}，失败 ${failCount}`, 2600);
  return { state: failCount > 0 ? "failed" : "success", successCount, failCount };
}

function quickActionState(actionKey) {
  const entry = store.quickActionStates?.[actionKey];
  const state = entry?.state || "idle";
  const ageMs = Date.now() - Number(entry?.ts || 0);
  const transientKeys = new Set(["quickAllOff", "quickCutoff", "allOn", "allOff"]);
  if (transientKeys.has(actionKey) && state !== "pending" && ageMs > 3000) return "idle";
  if ((actionKey === "quickSleep" || actionKey === "quickEco") && state !== "success" && state !== "pending" && ageMs > 3000) {
    return "idle";
  }
  return state;
}

function hasOpenSockets() {
  return (store.deviceStatus?.sockets || []).some((socket) => Boolean(socket.on));
}

function quickActionButton(actionKey, label, { tone = "neutral", disabled = false } = {}) {
  const state = quickActionState(actionKey);
  const statusText = {
    idle: "",
    pending: "执行中",
    success: "已执行",
    cancelled: "已取消",
    failed: "失败",
    noop: "无需变更",
  }[state] || "";
  const classes = ["btn", "quick-action", tone, state].filter(Boolean).join(" ");
  return `
    <button id="${actionKey}" class="${classes}" ${disabled || state === "pending" ? "disabled" : ""}>
      <span>${escapeHtml(label)}</span>
      ${statusText ? `<small>${escapeHtml(statusText)}</small>` : ""}
    </button>
  `;
}

function markQuickAction(actionKey, state) {
  setQuickActionState(actionKey, state);
  render();
}

function resetTransientQuickAction(actionKey, delayMs = 1600) {
  window.setTimeout(() => {
    if (quickActionState(actionKey) !== "pending") {
      clearQuickActionStates([actionKey]);
      safeRender();
    }
  }, delayMs);
}

function clearActiveModes() {
  clearQuickActionStates(["quickSleep", "quickEco"]);
}

function calcUsageKwhFromTelemetry() {
  const points = store.telemetry;
  if (points.length < 2) return 0;
  const sorted = points
    .map((p) => ({ ts: Number(p.ts || 0), power: Math.max(0, Number(p.power_w || 0)) }))
    .filter((p) => p.ts > 0)
    .sort((a, b) => a.ts - b.ts);
  let wh = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const dtHours = Math.min(Math.max(sorted[i].ts - sorted[i - 1].ts, 0), 3600) / 3600;
    wh += ((sorted[i].power + sorted[i - 1].power) / 2) * dtHours;
  }
  return Number((wh / 1000).toFixed(3));
}

function currentPowerW() {
  return Number(store.deviceStatus?.total_power_w || 0);
}

function telemetryChart({ compact = false } = {}) {
  const points = store.telemetry.slice(-240);
  if (!points.length) return "<div class='empty-state'>暂无遥测数据</div>";

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
  const height = compact ? 76 : 100;
  const toX = (i) => (i / (points.length - 1 || 1)) * width;
  const toY = (v) => height - ((v - min) / (max - min || 1)) * height;
  const linePoints = points.map((p, i) => `${toX(i)},${toY(Number(p.power_w || 0))}`).join(" ");
  const areaPoints = `0,${height} ${linePoints} ${width},${height}`;

  return `
    <div class="chart-wrap ${compact ? "compact" : ""}">
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none">
        <defs>
          <linearGradient id="powerFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0ea5e9" stop-opacity="0.35"></stop>
            <stop offset="100%" stop-color="#0ea5e9" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        <line x1="0" y1="${toY(min)}" x2="${width}" y2="${toY(min)}" stroke="#cbd5e1" stroke-width="1"></line>
        <line x1="0" y1="${toY((min + max) / 2)}" x2="${width}" y2="${toY((min + max) / 2)}" stroke="#e2e8f0" stroke-width="1"></line>
        <line x1="0" y1="${toY(max)}" x2="${width}" y2="${toY(max)}" stroke="#e2e8f0" stroke-width="1"></line>
        <polygon points="${areaPoints}" fill="url(#powerFill)"></polygon>
        <polyline fill="none" stroke="#0284c7" stroke-width="2.5" points="${linePoints}"></polyline>
      </svg>
      <div class="chart-legend">
        <span><i class="legend-dot" style="background:#0284c7"></i>功率</span>
        <span class="muted">Min ${valueMin.toFixed(1)}W</span>
        <span class="muted">Max ${valueMax.toFixed(1)}W</span>
      </div>
    </div>
  `;
}

function normalizeDeviceTypeName(input) {
  const raw = String(input || "").trim();
  if (!raw || raw === "Unknown") return "";
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
  if (!name || name === "Unknown" || name === "None") return "未识别设备";
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

function pill(text, tone = "neutral") {
  return `<span class="pill ${tone}">${escapeHtml(text)}</span>`;
}

function socketSummaryCard(socket) {
  const b = socketBehavior(socket);
  const meta = behaviorMeta(b.tag);
  const tone = b.score > 0 ? levelMeta(b.level).tone : socket.on ? "ok" : "neutral";
  const live = behaviorSocket(socket.id) || socket;
  const state = useStateMeta(live.useState, live.protectedCutoff || b.tag === "protected_cutoff");
  return `
    <button class="socket-mini ${tone}" data-go-socket="${socket.id}">
      <span class="socket-mini-top">插孔 ${socket.id}</span>
      <strong data-live-socket-name="${socket.id}">${escapeHtml(readableDeviceType(socket.device))}</strong>
      <span data-live-socket-summary="${socket.id}">${Number(socket.power_w || 0).toFixed(1)}W · ${escapeHtml(state.title)}</span>
    </button>
  `;
}

function learnPanelHtml(socket, disabled) {
  const currentType = String(socket.device || "Unknown");
  const unknownType = !currentType || currentType === "Unknown" || currentType === "None";
  const pendingId = Number.isFinite(Number(socket.pendingId)) ? Number(socket.pendingId) : null;
  if (!unknownType && pendingId === null) return "";
  const normalizedCurrentType = normalizeDeviceTypeName(currentType);
  const customDraft = String(customTypeDraftBySocket.get(socket.id) || "");
  return `
    <div class="learn-panel">
      <div class="learn-title">帮助系统识别这个设备</div>
      <p class="small">请选择实际接入的设备类型。提交后系统会在后续识别中减少误提醒。</p>
      <select class="input socket-type-select" data-socket="${socket.id}">
        ${typeSelectOptionsHtml(normalizedCurrentType)}
      </select>
      <input class="input socket-type-custom" data-socket="${socket.id}" value="${escapeHtml(customDraft)}" placeholder="自定义类型，如 Reading_Lamp" />
      <button data-socket-learn="${socket.id}" data-pending-id="${pendingId ?? ""}" class="btn primary socket-learn-submit" ${disabled ? "disabled" : ""}>提交设备类型</button>
    </div>
  `;
}

function socketCardHtml(socket) {
  const b = socketBehavior(socket);
  const meta = behaviorMeta(b.tag);
  const level = levelMeta(b.level);
  const targetKey = `${store.selectedDeviceId}:${socket.id}:switch`;
  const pending = store.pendingCmdByTarget.has(targetKey);
  const protectedCutoff = b.tag === "protected_cutoff";
  const reasons = reasonTexts(b.reasonMask, b.tag);
  const disabled = pending || !isOnline() || globalBusy || protectedCutoff;
  const canToggle = !protectedCutoff;
  const actionText = socket.on ? "关闭插孔" : "开启插孔";
  const live = behaviorSocket(socket.id) || socket;
  const useState = useStateMeta(live.useState, protectedCutoff || live.protectedCutoff);
  const liveDuration = liveDurationText(live);

  return `
    <article class="socket-card ${socket.on ? "on" : "off"} ${pending ? "pending" : ""} ${level.tone}" data-socket-card="${socket.id}">
      <div class="socket-title">
        <strong>插孔 ${socket.id}</strong>
        ${pending ? pill("执行中", "warn") : `<span class="pill ${useState.tone}" data-live-socket-state="${socket.id}">${escapeHtml(useState.title)}</span>`}
      </div>
      <div class="socket-main">
        <div>
          <div class="socket-power" data-live-socket-power="${socket.id}">${Number(socket.power_w || 0).toFixed(1)}<span>W</span></div>
          <div class="small">设备：<span data-live-socket-name="${socket.id}">${escapeHtml(readableDeviceType(socket.device))}</span></div>
        </div>
        <div class="socket-risk">
          ${pill(meta.title, level.tone)}
          ${b.score > 0 ? `<div class="risk-score">风险分 ${b.score}</div>` : ""}
        </div>
      </div>
      <p class="socket-desc">${escapeHtml(meta.desc)}</p>
      ${
        reasons.length
          ? `<ul class="reason-list">${reasons.slice(0, 4).map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>`
          : ""
      }
      <div class="socket-durations">
        ${liveDuration ? `<span>${escapeHtml(liveDuration)}</span>` : ""}
        ${b.standbySeconds ? `<span>待机 ${formatDuration(b.standbySeconds)}</span>` : ""}
        ${b.highPowerSeconds ? `<span>高负载 ${formatDuration(b.highPowerSeconds)}</span>` : ""}
        ${b.unknownSeconds ? `<span>未识别 ${formatDuration(b.unknownSeconds)}</span>` : ""}
        ${b.switchCount ? `<span>开关 ${b.switchCount} 次</span>` : ""}
      </div>
      ${protectedCutoff ? `<div class="notice danger">该插孔已进入保护断电。请先确认接入设备是否正常，必要时联系管理员处理。</div>` : ""}
      ${learnPanelHtml(socket, pending || !isOnline() || globalBusy)}
      <div class="socket-actions">
        <button data-socket-correct="${socket.id}" class="btn socket-correct" ${pending || !isOnline() || globalBusy ? "disabled" : ""}>重新识别</button>
        ${
          canToggle
            ? `<button data-socket="${socket.id}" data-action="${socket.on ? "off" : "on"}" class="btn ${socket.on ? "danger" : "primary"} socket-toggle" ${disabled ? "disabled" : ""}>${pending ? "执行中..." : actionText}</button>`
            : `<button class="btn" disabled>保护中不可直接开启</button>`
        }
      </div>
    </article>
  `;
}

function deviceSelector() {
  const d = selectedDevice();
  return `
    <section class="card compact-card bound-device-card">
      <div class="row row-center row-between">
        <div>
          <div class="small">当前绑定设备</div>
          <strong>${d ? `${escapeHtml(d.room || "-")} / ${escapeHtml(d.name || d.id)}` : "暂无绑定设备"}</strong>
        </div>
        <button id="refreshBtn" class="btn">刷新</button>
      </div>
    </section>
  `;
}

function telemetryRangeSelector() {
  return `
    <div class="range-row">
      ${ALLOWED_RANGES.map((r) => `<button data-range="${r}" class="btn range-btn ${store.telemetryRange === r ? "primary" : ""}">${RANGE_LABELS[r]}</button>`).join("")}
    </div>
  `;
}

function renderStatusHero() {
  const d = selectedDevice();
  const b = rootBehavior();
  const tone = riskTone();
  const todayKwh = calcUsageKwhFromTelemetry();
  return `
    <section class="card hero-card ${tone}">
      <div class="hero-top">
        <div>
          <div class="hero-title">${escapeHtml(d?.name || d?.id || "智能插排")}</div>
          <h2 data-live-status-title>${escapeHtml(statusTitle())}</h2>
        </div>
        <span class="pill ${isOnline() ? "ok" : "neutral"}" data-live-device-online>${isOnline() ? "在线" : "离线"}</span>
      </div>
      <p data-live-status-subtitle>${escapeHtml(statusSubtitle())}</p>
      <div class="hero-metrics">
        <div><span>当前功率</span><strong data-live-total-power>${currentPowerW().toFixed(1)}W</strong></div>
        <div><span>区间电量</span><strong>${todayKwh}kWh</strong></div>
        <div><span>风险分</span><strong>${b.risk}</strong></div>
      </div>
    </section>
  `;
}

function renderDailyCheckup() {
  const check = store.dailyCheckup;
  if (!check) {
    return `
      <section class="card">
        <div class="section-head">
          <h3>今日用电体检</h3>
          ${pill("待加载", "neutral")}
        </div>
        <div class="empty-state">暂未获取到体检结果，稍后刷新或检查后端接口。</div>
      </section>
    `;
  }
  const severity = levelMeta(check.severity || "low");
  const standbyHours = (check.standbyWaste || []).reduce((sum, item) => sum + Number(item.standbyHours || 0), 0);
  const alertCount = (check.events || []).length;
  const focus = check.highestRiskSocket;
  const suggestions = check.suggestions || [];
  return `
    <section class="card">
      <div class="section-head">
        <h3>今日用电体检</h3>
        ${pill(severity.title, severity.tone)}
      </div>
      <p>${escapeHtml(check.summary || "暂无明显异常。")}</p>
      <div class="kpi-row">
        <div class="kpi"><span>最高功率</span><strong>${Number(check.peakPowerW || 0).toFixed(1)}W</strong></div>
        <div class="kpi"><span>待机累计</span><strong>${standbyHours.toFixed(1)}h</strong></div>
        <div class="kpi"><span>提醒次数</span><strong>${alertCount}</strong></div>
      </div>
      ${
        focus
          ? `<div class="notice ${severity.tone}">重点关注：插孔 ${focus.socketId || focus.socket || "-"}，${escapeHtml(focus.title || focus.reason || "存在风险")}</div>`
          : ""
      }
      ${
        suggestions.length
          ? `<ul class="suggestion-list">${suggestions.slice(0, 2).map((s) => `<li>${escapeHtml(s.title || s.reason || s)}</li>`).join("")}</ul>`
          : ""
      }
    </section>
  `;
}

function renderSocketOverview() {
  const sockets = store.deviceStatus?.sockets || [];
  return `
    <section class="card">
      <div class="section-head">
        <h3>当前插孔摘要</h3>
        <button class="link-btn" data-go-tab="device">查看全部</button>
      </div>
      <div class="socket-mini-grid">
        ${sockets.map(socketSummaryCard).join("") || "<div class='empty-state'>暂无插孔数据</div>"}
      </div>
    </section>
  `;
}

function renderRecentReminders(limit = 3) {
  const items = mergedReminderItems().slice(0, limit);
  return `
    <section class="card">
      <div class="section-head">
        <h3>最近提醒</h3>
        <button class="link-btn" data-go-tab="alerts">全部提醒</button>
      </div>
      <div class="alert-list">
        ${items.map(reminderCardHtml).join("") || "<div class='empty-state'>暂无提醒</div>"}
      </div>
    </section>
  `;
}

function renderQuickActions() {
  const disabled = !isOnline() || globalBusy;
  const disableOffActions = disabled || !hasOpenSockets();
  return `
    <section class="card">
      <h3>快捷操作</h3>
      <div class="quick-grid">
        ${quickActionButton("quickAllOff", "全部关闭", { tone: "danger", disabled: disableOffActions })}
        ${quickActionButton("quickSleep", "睡眠模式", { tone: "primary", disabled })}
        ${quickActionButton("quickEco", "一键节能", { tone: "primary", disabled })}
        ${quickActionButton("quickCutoff", "紧急断电", { tone: "danger", disabled: disableOffActions })}
      </div>
    </section>
  `;
}

function renderAssistantCard() {
  const messages = store.assistantMessages || [];
  return `
    <section class="card assistant-card">
      <div class="section-head">
        <h3>智能助手</h3>
        ${store.assistantBusy ? pill("回复中", "warn") : pill("用户端", "neutral")}
      </div>
      <p class="small">只围绕你当前绑定的插排回答：用电状态、提醒原因、Unknown、待机浪费、保护断电和安全控制建议。</p>
      <div class="assistant-chat" aria-live="polite">
        ${
          messages.length
            ? messages
              .map(
                (msg) => `
          <div class="chat-message ${msg.role === "user" ? "user" : "assistant"}">
            <div class="chat-role">${msg.role === "user" ? "我" : "助手"}</div>
            <div class="chat-bubble markdown-body">${msg.role === "assistant" ? renderMarkdown(msg.content) : escapeHtml(msg.content)}</div>
            ${msg.role === "assistant" && Array.isArray(msg.sources) && msg.sources.length ? `
              <div class="assistant-sources">
                <strong>参考知识</strong>
                ${msg.sources.map((source) => `<div>${escapeHtml(source.title || "知识条目")}${source.excerpt ? `：${escapeHtml(source.excerpt)}` : ""}</div>`).join("")}
              </div>
            ` : ""}
          </div>
        `,
              )
              .join("")
            : "<div class='empty-state'>可以直接提问，例如“为什么提醒我？”或“哪些插孔可以省电？”</div>"
        }
      </div>
      <div class="assistant-questions">
        ${ASSISTANT_QUESTIONS.map((q) => `<button class="btn assistant-question" data-question="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join("")}
      </div>
      <form id="assistantForm" class="assistant-form">
        <input id="assistantInput" class="input" maxlength="500" placeholder="输入你的问题，例如：为什么插孔3被提醒？" ${store.assistantBusy ? "disabled" : ""} />
        <button class="btn primary" type="submit" ${store.assistantBusy ? "disabled" : ""}>发送</button>
      </form>
      <div class="assistant-footer">
        <button id="clearAssistantChat" class="link-btn" type="button">清空聊天</button>
      </div>
    </section>
  `;
}

function renderBehaviorSummary() {
  const overview = store.behaviorOverview;
  if (!overview) {
    return `
      <section class="card behavior-summary-card">
        <div class="section-head"><h3>我的用电状态</h3>${pill("学习中", "neutral")}</div>
        <div class="empty-state">正在学习你的用电习惯，产生真实会话后会在这里展示。</div>
      </section>
    `;
  }
  const sockets = overview.sockets || [];
  const focus = [...sockets].sort((a, b) => {
    const rank = { active: 2, standby: 1, off: 0 };
    return (rank[b.useState] || 0) - (rank[a.useState] || 0) || Number(b.powerW || 0) - Number(a.powerW || 0);
  })[0];
  const state = focus ? useStateMeta(focus.useState, focus.protectedCutoff) : useStateMeta("off");
  const stats = overview.sevenDayStats || {};
  const latest = overview.latestSession;
  return `
    <section class="card behavior-summary-card">
      <div class="section-head">
        <h3>我的用电状态</h3>
        ${pill(state.title, state.tone)}
      </div>
      ${focus ? `
        <div class="behavior-focus">
          <div><span class="small" data-live-focus-socket>当前主要设备 · 插孔 ${focus.socketId}</span><strong data-live-focus-name>${escapeHtml(readableDeviceType(focus.device))}</strong></div>
          <div class="behavior-focus-power" data-live-focus-power>${Number(focus.powerW || 0).toFixed(1)}<span>W</span></div>
        </div>
        ${liveDurationText(focus) ? `<p class="small">${escapeHtml(liveDurationText(focus))}</p>` : ""}
      ` : "<div class='empty-state'>暂未获取到插孔使用状态</div>"}
      <div class="behavior-stat-grid">
        <div><span>近7天会话</span><strong>${Number(stats.sessionCount || 0)}次</strong></div>
        <div><span>活动时长</span><strong>${formatDuration(stats.activeSec || 0)}</strong></div>
        <div><span>待机时长</span><strong>${formatDuration(stats.standbySec || 0)}</strong></div>
        <div><span>会话电量</span><strong>${(Number(stats.energyWh || 0) / 1000).toFixed(3)}kWh</strong></div>
      </div>
      ${latest ? `<div class="latest-session-line">最近记录：${escapeHtml(readableDeviceType(latest.device))} · 插孔 ${latest.socketId} · ${formatDuration(latest.durationSec)} · ${formatBeijingTime(latest.receivedAt)}</div>` : `<div class="small">暂无真实会话，系统会继续在本地设备端学习。</div>`}
      <button class="btn primary behavior-entry" data-go-tab="habit">查看用电习惯</button>
    </section>
  `;
}

function habitDateLabel(value) {
  const text = String(value || "");
  if (text.length !== 8) return "7日汇总";
  const date = new Date(Date.UTC(Number(text.slice(0, 4)), Number(text.slice(4, 6)) - 1, Number(text.slice(6, 8))));
  return `${text.slice(4, 6)}-${text.slice(6, 8)} 周${"日一二三四五六"[date.getUTCDay()]}`;
}

function habitSlotRange(slot) {
  const start = slot * 15;
  const label = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return `${label(start)}-${label(start + 15)}`;
}

function habitSlotTone(slot) {
  if (!slot || Number(slot.observedPct || 0) < 34) return "insufficient";
  if (Number(slot.activePct || 0) === 0 && Number(slot.standbyPct || 0) === 0) return "idle";
  if (Number(slot.standbyPct || 0) > Number(slot.activePct || 0)) return "standby";
  return Number(slot.activePct || 0) > 60 ? "active-high" : "active";
}

function habitSlotMatchesFilter(slot, index) {
  if (habitViewFilter === "all") return true;
  if (habitViewFilter === "evening") return index >= 72;
  const tone = habitSlotTone(slot);
  if (habitViewFilter === "active") return tone === "active" || tone === "active-high";
  if (habitViewFilter === "standby") return tone === "standby";
  return true;
}

function habitSlotToneLabel(slot) {
  const tone = habitSlotTone(slot);
  if (tone === "active" || tone === "active-high") return "活动";
  if (tone === "standby") return "待机";
  if (tone === "idle") return "未使用";
  return "观测不足";
}

function beijingDateSlot(timestamp, offsetMinutes = 480) {
  const date = new Date((Number(timestamp || 0) + offsetMinutes * 60) * 1000);
  return {
    date: date.getUTCFullYear() * 10000 + (date.getUTCMonth() + 1) * 100 + date.getUTCDate(),
    slot: Math.floor((date.getUTCHours() * 60 + date.getUTCMinutes()) / 15),
  };
}

function habitOverlayKeys(detail) {
  const keys = new Set();
  const live = detail?.liveState;
  if (!live?.matched || live.useState === "off") return keys;
  const elapsed = Math.max(0, Math.floor((Date.now() - store.behaviorLastUpdatedAt) / 1000));
  const end = Number(detail.serverNow || Math.floor(Date.now() / 1000)) + elapsed;
  const start = live.timeTrusted && live.sessionStartTimestamp ? Number(live.sessionStartTimestamp) : end;
  for (let cursor = Math.floor(start / 900) * 900; cursor <= end; cursor += 900) {
    const point = beijingDateSlot(cursor, detail.timezoneOffsetMin);
    keys.add(`${point.date}:${point.slot}`);
  }
  return keys;
}

function renderHabitTimeline(detail) {
  const hasData = (detail.days || []).some((day) => day.available);
  if (!hasData) return `<div class="empty-state">等待板端习惯数据，不会使用模拟数据填充。</div>`;
  const overlays = habitOverlayKeys(detail);
  const rows = [...detail.days, { date: 0, available: true, slots: detail.summarySlots || [] }];
  return `
    <div class="habit-scroll" aria-label="7天用电习惯时间带">
      <div class="habit-chart">
        <div class="habit-time-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
        ${rows.map((day) => {
          const summary = day.date === 0;
          const slots = new Map((day.slots || []).map((slot) => [Number(slot.slot), slot]));
          return `
            <div class="habit-row">
              <div class="habit-row-label">${habitDateLabel(day.date)}</div>
              <div class="habit-hour-grid">
                ${Array.from({ length: 24 }, (_, hour) => {
                  const selected = selectedHabitHour?.date === day.date && selectedHabitHour?.hour === hour;
                  const hourSummary = Array.from({ length: 4 }, (_, quarter) => {
                    const index = hour * 4 + quarter;
                    return `${habitSlotRange(index)} ${habitSlotToneLabel(slots.get(index))}`;
                  }).join("，");
                  return `<button class="habit-hour ${selected ? "selected" : ""}" data-habit-date="${day.date}" data-habit-hour="${hour}" aria-label="${habitDateLabel(day.date)}，${hourSummary}">
                    ${Array.from({ length: 4 }, (_, quarter) => {
                      const index = hour * 4 + quarter;
                      const slot = slots.get(index);
                      const live = !summary && overlays.has(`${day.date}:${index}`);
                      const muted = !habitSlotMatchesFilter(slot, index);
                      return `<span class="habit-slot ${habitSlotTone(slot)} ${live ? `live-${detail.liveState.useState}` : ""} ${muted ? "filter-muted" : ""}" data-habit-date="${day.date}" data-habit-slot="${index}"></span>`;
                    }).join("")}
                  </button>`;
                }).join("")}
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function selectedHabitSlotHtml(detail) {
  if (!selectedHabitHour) return `<p class="small">点击一个小时查看其中四个 15 分钟时间片。</p>`;
  const selectedDate = selectedHabitHour.date;
  const selectedHourStart = selectedHabitHour.hour * 4;
  if (!selectedHabitSlot || selectedHabitSlot.date !== selectedDate || Math.floor(selectedHabitSlot.slot / 4) !== selectedHabitHour.hour) {
    selectedHabitSlot = { date: selectedDate, slot: selectedHourStart };
  }
  const day = selectedHabitSlot.date === 0
    ? { slots: detail.summarySlots || [] }
    : (detail.days || []).find((item) => Number(item.date) === Number(selectedHabitSlot.date));
  const slot = day?.slots?.find((item) => Number(item.slot) === Number(selectedHabitSlot.slot));
  return `
    <div class="habit-slot-detail">
      <strong>${habitDateLabel(selectedDate)} · ${String(selectedHabitHour.hour).padStart(2, "0")}:00-${String(selectedHabitHour.hour + 1).padStart(2, "0")}:00</strong>
      <div class="habit-quarter-choices">
        ${Array.from({ length: 4 }, (_, quarter) => {
          const index = selectedHourStart + quarter;
          return `<button class="habit-quarter-choice ${selectedHabitSlot.slot === index ? "active" : ""}" data-habit-quarter="${index}">${habitSlotRange(index)}</button>`;
        }).join("")}
      </div>
      <div class="habit-quarter-values">
      <span>活动 ${Number(slot?.activePct || 0)}%</span>
      <span>待机 ${Number(slot?.standbyPct || 0)}%</span>
      <span>有效观测 ${Number(slot?.observedPct || 0)}%</span>
      </div>
    </div>
  `;
}

function renderSessionCard(item) {
  const state = item.finalUseState === "active"
    ? { title: "结束时活动", tone: "ok" }
    : item.finalUseState === "standby"
      ? { title: "结束时待机", tone: "warn" }
      : { title: "会话已结束", tone: "neutral" };
  return `
    <article class="session-item">
      <div class="session-head"><strong>${escapeHtml(readableDeviceType(item.device))}</strong>${pill(state.title, state.tone)}</div>
      <div class="small">插孔 ${item.socketId} · 上报于 ${formatBeijingTime(item.receivedAt)}</div>
      <div class="session-metrics">
        <span>总计 ${formatDuration(item.durationSec)}</span>
        <span>活动 ${formatDuration(item.activeSec)}</span>
        <span>待机 ${formatDuration(item.standbySec)}</span>
        <span>${Number(item.energyWh || 0).toFixed(2)}Wh</span>
      </div>
      <div class="small">平均 ${Number(item.avgPowerW || 0).toFixed(1)}W · 峰值 ${Number(item.peakPowerW || 0).toFixed(1)}W · 开关 ${Number(item.switchCount || 0)}次</div>
    </article>
  `;
}

function renderHabit() {
  const detail = store.habitDetail;
  const profiles = store.habitProfiles || [];
  const offlineCache = !navigator.onLine;
  return `
    ${deviceSelector()}
    ${offlineCache ? `<div class="notice warn">当前展示手机中最后保存的离线数据</div>` : ""}
    <section class="card habit-card">
      <div class="section-head">
        <div><h3>我的用电习惯</h3><p class="small">来自插排端侧的真实学习结果</p></div>
        <button id="refreshHabitBtn" class="btn" ${!navigator.onLine ? "disabled" : ""}>刷新</button>
      </div>
      ${profiles.length ? `
        <div class="habit-profile-tabs">
          ${profiles.map((item) => `<button class="habit-profile-tab ${Number(item.profileId) === Number(store.selectedHabitProfileId) ? "active" : ""}" data-habit-profile="${item.profileId}">${escapeHtml(readableDeviceType(item.device))}<small>${item.dataStatus === "ready" ? "已学习" : item.dataStatus === "error" ? "异常" : "学习中"}</small></button>`).join("")}
        </div>
      ` : `<div class="empty-state">还没有形成正式设备画像。你可以在“插孔”页提交实际设备类型，帮助系统继续学习。</div>`}
      ${store.behaviorError ? `<div class="notice warn">${escapeHtml(store.behaviorError)}</div>` : ""}
      ${detail ? `
        <div class="habit-title-row">
          <div><strong>${escapeHtml(readableDeviceType(detail.profile.device))}</strong><span class="small">常用时段：${escapeHtml(detail.profile.mainUsePeriod || "仍在学习")}</span></div>
          ${pill(detail.dataStatus === "ready" ? "数据已就绪" : detail.dataStatus === "error" ? "同步异常" : "持续学习中", detail.dataStatus === "ready" ? "ok" : detail.dataStatus === "error" ? "danger" : "warn")}
        </div>
        ${detail.associationStatus === "ambiguous" ? `<div class="notice warn">存在同名设备，真实会话暂时无法唯一归属到这个画像。</div>` : ""}
        <div class="behavior-stat-grid habit-stats">
          <div><span>会话次数</span><strong>${Number(detail.sessionStats?.sessionCount || 0)}次</strong></div>
          <div><span>活动时长</span><strong>${formatDuration(detail.sessionStats?.activeSec || 0)}</strong></div>
          <div><span>待机时长</span><strong>${formatDuration(detail.sessionStats?.standbySec || 0)}</strong></div>
          <div><span>会话电量</span><strong>${(Number(detail.sessionStats?.energyWh || 0) / 1000).toFixed(3)}kWh</strong></div>
        </div>
        <div class="habit-view-filters" aria-label="习惯时间带筛选">
          ${[["all", "全天"], ["active", "仅活动"], ["standby", "仅待机"], ["evening", "晚间"]].map(([value, label]) => `<button class="btn habit-view-filter ${habitViewFilter === value ? "primary" : ""}" data-habit-view="${value}">${label}</button>`).join("")}
        </div>
        ${renderHabitTimeline(detail)}
        ${selectedHabitSlotHtml(detail)}
        <div class="habit-legend"><span><i class="active-high"></i>活动</span><span><i class="standby"></i>待机</span><span><i class="idle"></i>未使用</span><span><i class="insufficient"></i>观测不足</span><span><i class="live"></i>当前运行</span></div>
        <p class="small habit-updated-at">数据更新：${formatBeijingTime(detail.updatedAt, "等待首次同步")}${offlineCache ? " · 离线缓存" : ""}</p>
      ` : profiles.length ? `<div class="empty-state">${store.behaviorLoading ? "正在加载 7 天习惯..." : "等待板端习惯数据"}</div>` : ""}
    </section>
    <section class="card">
      <div class="section-head"><h3>最近用电记录</h3>${pill(`${store.behaviorSessions.length}条`, "neutral")}</div>
      <div class="session-filter-row">
        ${["", 1, 2, 3, 4].map((value) => `<button class="btn session-filter ${String(store.sessionSocketFilter) === String(value) ? "primary" : ""}" data-session-socket="${value}">${value === "" ? "全部" : `插孔${value}`}</button>`).join("")}
      </div>
      <div class="session-list">${store.behaviorSessions.map(renderSessionCard).join("") || `<div class="empty-state">暂无真实用电会话</div>`}</div>
      ${store.sessionCursor != null ? `<button id="loadMoreSessions" class="btn behavior-load-more">加载更多</button>` : ""}
    </section>
  `;
}

function renderHome() {
  return `
    ${deviceSelector()}
    ${renderStatusHero()}
    ${renderBehaviorSummary()}
    ${renderDailyCheckup()}
    ${renderSocketOverview()}
    <section class="card">
      <div class="section-head">
        <h3>功率趋势</h3>
        <span class="small">${RANGE_LABELS[store.telemetryRange] || store.telemetryRange}</span>
      </div>
      ${telemetryRangeSelector()}
      <div id="telemetryLiveRegion">${telemetryChart({ compact: true })}</div>
    </section>
    ${renderRecentReminders(3)}
    ${renderQuickActions()}
    ${renderAssistantCard()}
  `;
}

function renderDevice() {
  const disabled = !isOnline() || globalBusy;
  const disableOffActions = disabled || !hasOpenSockets();
  return `
    ${deviceSelector()}
    <section class="card">
      <h3>安全控制</h3>
      <p class="small">普通操作可直接控制单个插孔；批量和高风险操作会要求确认。保护断电状态不会直接提供恢复供电按钮。</p>
      <div class="quick-grid">
        ${quickActionButton("allOff", "全部关闭", { tone: "danger", disabled: disableOffActions })}
        ${quickActionButton("allOn", "全部开启", { tone: "neutral", disabled })}
        ${quickActionButton("quickSleep", "睡眠模式", { tone: "primary", disabled })}
        ${quickActionButton("quickEco", "一键节能", { tone: "primary", disabled })}
      </div>
    </section>
    <section class="card">
      <div class="section-head">
        <h3>插孔状态</h3>
        ${pill(`${(store.deviceStatus?.sockets || []).length} 路`, "neutral")}
      </div>
      <div class="socket-grid">
        ${(store.deviceStatus?.sockets || []).map((s) => socketCardHtml(s)).join("") || "<div class='empty-state'>暂无插孔数据</div>"}
      </div>
    </section>
  `;
}

function reminderCategory(item) {
  if (item.kind === "local") {
    if (item.type === "OFFLINE") return "device";
    if (item.type === "CONTROL_FAIL") return "control";
    return "control";
  }
  if (item.tag === "protected_cutoff" || item.tag === "unknown_high_power") return "action";
  if (item.tag === "standby_waste" || item.tag === "long_high_power" || item.tag === "frequent_switching") return "usage";
  return "device";
}

function mergedReminderItems() {
  const behavior = (store.behaviorEvents || []).map((e) => ({
    kind: "behavior",
    id: `b-${e.id}`,
    ts: Number(e.receivedAt || 0) * 1000,
    ...e,
  }));
  const local = store.alerts.map((a) => ({ ...a, kind: "local" }));
  return [...behavior, ...local].sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
}

function reminderCardHtml(item) {
  if (item.kind === "local") {
    const tone = item.level === "err" ? "danger" : "warn";
    return `
      <article class="alert-item ${tone}">
        <div class="alert-title">${escapeHtml(humanizeAlert(item))}</div>
        <div class="small">${formatTime(item.ts)}</div>
        <div class="alert-actions">
          <button data-alert-id="${item.id}" class="btn retry-alert">重试</button>
          <button data-alert-id="${item.id}" class="btn resolve-alert">${item.resolved ? "已忽略" : "忽略"}</button>
        </div>
      </article>
    `;
  }

  const meta = behaviorMeta(item.tag);
  const level = levelMeta(item.level);
  const reasons = reasonTexts(item.reasonMask, item.tag);
  return `
    <article class="alert-item ${level.tone}">
      <div class="alert-head">
        <div>
          <div class="alert-title">${escapeHtml(meta.title)}</div>
          <div class="small">插孔 ${item.socketId || "-"} · ${formatTime(item.ts)}</div>
        </div>
        ${pill(level.title, level.tone)}
      </div>
      <p>${escapeHtml(meta.desc)}</p>
      <div class="small">设备：${escapeHtml(readableDeviceType(item.deviceName))} · 功率 ${Number(item.powerW || 0).toFixed(1)}W · 风险分 ${item.score}</div>
      ${reasons.length ? `<ul class="reason-list">${reasons.slice(0, 3).map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>` : ""}
      <div class="alert-actions">
        <button class="btn" data-go-socket="${item.socketId || ""}">查看插孔</button>
        ${item.tag === "unknown_high_power" ? `<button class="btn primary" data-go-socket="${item.socketId || ""}">标注设备</button>` : ""}
      </div>
    </article>
  `;
}

function filterReminders() {
  return mergedReminderItems().filter((item) => {
    if (item.kind === "local" && item.type === "OFFLINE" && !prefEnabled("offline")) return false;
    if (item.kind === "local" && item.type === "CONTROL_FAIL" && !prefEnabled("control")) return false;
    if (item.kind === "behavior" && item.tag === "standby_waste" && !prefEnabled("standby")) return false;
    if (item.kind === "behavior" && item.tag === "unknown_high_power" && !prefEnabled("unknown")) return false;
    if (alertFilter === "all") return true;
    return reminderCategory(item) === alertFilter;
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
  return alert.detail || "提醒";
}

function renderAlerts() {
  const list = filterReminders();
  const filters = [
    ["all", "全部"],
    ["action", "需要处理"],
    ["usage", "用电提醒"],
    ["device", "设备异常"],
    ["control", "控制记录"],
  ];
  return `
    ${deviceSelector()}
    <section class="card">
      <h3>提醒中心</h3>
      <div class="filter-row">
        ${filters.map(([key, label]) => `<button data-filter="${key}" class="btn filter-btn ${alertFilter === key ? "primary" : ""}">${label}</button>`).join("")}
      </div>
      <div class="alert-list">
        ${list.slice(0, 50).map(reminderCardHtml).join("") || "<div class='empty-state'>暂无提醒</div>"}
      </div>
      <div class="row">
        <button id="clearAlertsBtn" class="btn">清空本地提醒</button>
      </div>
    </section>
    ${renderAssistantCard()}
  `;
}

function prefEnabled(key) {
  return store.alertPrefs[key] !== false;
}

function renderPrefToggle(key, label, desc) {
  return `
    <label class="pref-row">
      <span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(desc)}</small></span>
      <input type="checkbox" class="pref-toggle" data-pref="${escapeHtml(key)}" ${prefEnabled(key) ? "checked" : ""} />
    </label>
  `;
}

function renderMe() {
  const d = selectedDevice();
  const sevenDayStats = store.behaviorOverview?.sevenDayStats || {};
  const installed = window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
  const mailStatus = !mailPreference.loaded
    ? "加载中..."
    : !mailPreference.smtpConfigured
      ? "后端未配置 SMTP"
      : !mailPreference.serviceEnabled
        ? "管理员已关闭邮件服务"
        : mailPreference.enabled
          ? "邮件提醒已开启"
          : "邮件提醒已关闭";

  return `
    <section class="card profile-card">
      <h3>账户与设备</h3>
      <p>用户名：${escapeHtml(store.user?.username || "-")}</p>
      <p class="small">角色：${escapeHtml(store.user?.role || "-")}</p>
      <p class="small">绑定设备：${d ? `${escapeHtml(d.room || "-")} / ${escapeHtml(d.name || d.id)}` : "未绑定"}</p>
    </section>
    <section class="card">
      <h3>通知设置</h3>
      <p class="small">接收邮箱：${escapeHtml(mailPreference.email || store.user?.email || "-")}</p>
      <p class="small">状态：${escapeHtml(mailStatus)}</p>
      <button id="toggleMailBtn" class="btn ${mailPreference.enabled ? "" : "primary"}" ${!mailPreference.loaded || !mailPreference.smtpConfigured ? "disabled" : ""}>
        ${mailPreference.enabled ? "关闭邮件提醒" : "开启邮件提醒"}
      </button>
    </section>
    <section class="card">
      <h3>提醒偏好</h3>
      ${renderPrefToggle("standby", "待机提醒", "设备长时间低功率运行时提醒我")}
      ${renderPrefToggle("unknown", "Unknown 设备提醒", "设备未识别且功率较高时提醒我")}
      ${renderPrefToggle("offline", "设备离线提醒", "插排离线时提醒我")}
      ${renderPrefToggle("control", "控制结果提醒", "控制失败或超时时提醒我")}
    </section>
    <section class="card">
      <h3>用电概览</h3>
      <p class="small">近 7 天真实会话：${Number(sevenDayStats.sessionCount || 0)} 次</p>
      <p class="small">活动 ${formatDuration(sevenDayStats.activeSec || 0)} · 待机 ${formatDuration(sevenDayStats.standbySec || 0)}</p>
      <p class="small">真实会话电量：${(Number(sevenDayStats.energyWh || 0) / 1000).toFixed(3)} kWh</p>
    </section>
    ${installed ? "" : `
      <section class="card install-card">
        <h3>安装到手机</h3>
        <p class="small">安装后可从桌面直接打开，并在离线时查看最后缓存的真实数据。</p>
        <button id="installPwaBtn" class="btn primary" ${deferredInstallPrompt ? "" : "disabled"}>${deferredInstallPrompt ? "安装 Dorm Power" : "请使用浏览器菜单添加到主屏幕"}</button>
      </section>
    `}
    <section class="card">
      <h3>帮助中心</h3>
      <details><summary>为什么显示 Unknown？</summary><p class="small">表示系统暂时无法确认接入设备类型。请确认设备是否正常，并在插孔页提交设备类型帮助系统学习。</p></details>
      <details><summary>为什么被保护断电？</summary><p class="small">protected_cutoff 表示端侧已经执行保护动作。请先检查现场设备，不建议直接恢复供电。</p></details>
      <details><summary>设备离线怎么办？</summary><p class="small">先检查插排电源和网络。离线时 0W 不代表设备已关闭，控制命令也无法可靠执行。</p></details>
      <details><summary>怎么减少待机耗电？</summary><p class="small">优先关闭长时间低功率待机的充电器、灯具和外设，睡前可使用睡眠模式或一键节能。</p></details>
    </section>
    ${store.debugMode
      ? `
      <section class="card">
        <h3>调试连接</h3>
        <label class="small" for="apiBaseInput">API 地址</label>
        <input id="apiBaseInput" class="input" value="${escapeHtml(getApiBase())}" />
        <label class="small" for="wsBaseInput">WS 地址</label>
        <input id="wsBaseInput" class="input" value="${escapeHtml(getWsBase())}" />
        <button id="saveConnBtn" class="btn primary">保存并重连</button>
      </section>
    `
      : ""
    }
    <section class="card">
      <h3>账户操作</h3>
      <p class="small">如需切换账号或重新绑定设备，请退出后重新登录。</p>
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
      <button id="loginBtn" class="btn primary">登录</button>
    </section>
  `;
}

function bindDeviceSelectorAndRefresh() {
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
      setCurrentUser(result.user || { username: account, role: "student" });
      addEvent("LOGIN", `登录成功：${store.user.username}`);
      showToast("登录成功");
      connectWs();
      await bootstrapData();
      scheduleStatusPolling();
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

async function submitAssistantQuestion(question) {
  const text = String(question || "").trim();
  if (!text || store.assistantBusy) return;

  addAssistantMessage("user", text);
  store.assistantBusy = true;
  render();

  try {
    const conversation = (store.assistantMessages || [])
      .slice(0, -1)
      .slice(-10)
      .map((msg) => ({ role: msg.role, content: String(msg.content || "").slice(0, 1500) }));
    const result = await postAgentQuery({
      message: text,
      roomId: selectedRoomId(),
      deviceId: store.selectedDeviceId,
      page: `pwa-user:${currentTab}`,
      period: "7d",
      conversation,
    }, store.token);
    addAssistantMessage("assistant", result?.reply || "暂时没有可用回答。", {
      sources: result?.sources || [],
      usedTools: result?.usedTools || [],
    });
  } catch (err) {
    if (handleAuthExpired(err)) return;
    addAssistantMessage("assistant", `助手暂时不可用：${err.message}`);
  } finally {
    store.assistantBusy = false;
    render();
  }
}

async function runBulkQuickAction(actionKey, action, options = {}) {
  markQuickAction(actionKey, "pending");
  const result = await executeBulkSocketAction(action, options);
  if (result?.state === "success") {
    if (action === "off") clearActiveModes();
    if (actionKey === "quickCutoff") {
      clearQuickActionStates(["quickAllOff", "quickSleep", "quickEco", "allOn", "allOff"]);
    }
    markQuickAction(actionKey, "success");
    resetTransientQuickAction(actionKey);
    return;
  }
  if (result?.state === "noop") {
    markQuickAction(actionKey, "noop");
    resetTransientQuickAction(actionKey);
    return;
  }
  markQuickAction(actionKey, result?.state || "cancelled");
  resetTransientQuickAction(actionKey);
}

async function runModeQuickAction(actionKey, mode, otherModeKey) {
  if (quickActionState(actionKey) === "success") {
    if (!window.confirm(`确认取消${mode === "sleep" ? "睡眠模式" : "一键节能"}？`)) {
      markQuickAction(actionKey, "success");
      return;
    }
    markQuickAction(actionKey, "pending");
    const result = await executeCmd({ action: "mode", mode: "normal" }, `${store.selectedDeviceId}:mode:normal`);
    markQuickAction(actionKey, result.state === "success" ? "cancelled" : "failed");
    resetTransientQuickAction(actionKey);
    await bootstrapData();
    return;
  }

  const label = mode === "sleep" ? "睡眠模式" : "一键节能";
  const message =
    mode === "sleep"
      ? "确认下发睡眠模式？系统会按端侧策略关闭非必要插孔。"
      : "确认下发一键节能？系统会优先处理待机浪费插孔。";
  if (!window.confirm(message)) {
    markQuickAction(actionKey, "cancelled");
    resetTransientQuickAction(actionKey);
    return;
  }

  clearQuickActionStates([otherModeKey]);
  markQuickAction(actionKey, "pending");
  const result = await executeCmd({ action: "mode", mode }, `${store.selectedDeviceId}:mode:${mode}`);
  if (result.state === "success") {
    clearQuickActionStates([otherModeKey]);
    markQuickAction(actionKey, "success");
    showToast(`${label}已开启`);
  } else {
    markQuickAction(actionKey, "failed");
    resetTransientQuickAction(actionKey);
  }
  await bootstrapData();
}

function bindActions() {
  bindDeviceSelectorAndRefresh();

  document.querySelectorAll(".range-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const nextRange = btn.dataset.range;
      if (!ALLOWED_RANGES.includes(nextRange)) return;
      setTelemetryRange(nextRange);
      lastTelemetryRefreshAt = 0;
      await refreshTelemetryIfNeeded(true);
      render();
    });
  });

  document.querySelectorAll("[data-go-tab]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      currentTab = btn.dataset.goTab;
      tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === currentTab));
      render();
      if (currentTab === "habit") await enterHabitTab();
    });
  });

  document.querySelectorAll(".habit-profile-tab").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const profileId = Number(btn.dataset.habitProfile);
      if (!Number.isFinite(profileId) || profileId === Number(store.selectedHabitProfileId)) return;
      store.selectedHabitProfileId = profileId;
      store.habitDetail = null;
      selectedHabitSlot = null;
      selectedHabitHour = null;
      lastHabitRefreshAt = 0;
      persistBehaviorState();
      render();
      await refreshHabitDetail(true);
      safeRender();
    });
  });

  document.querySelectorAll(".habit-hour").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedHabitHour = { date: Number(btn.dataset.habitDate), hour: Number(btn.dataset.habitHour) };
      selectedHabitSlot = { date: selectedHabitHour.date, slot: selectedHabitHour.hour * 4 };
      render();
    });
  });

  document.querySelectorAll(".habit-quarter-choice").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!selectedHabitHour) return;
      selectedHabitSlot = { date: selectedHabitHour.date, slot: Number(btn.dataset.habitQuarter) };
      render();
    });
  });

  document.querySelectorAll(".habit-view-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      habitViewFilter = btn.dataset.habitView || "all";
      render();
    });
  });

  document.querySelectorAll(".session-filter").forEach((btn) => {
    btn.addEventListener("click", async () => {
      store.sessionSocketFilter = btn.dataset.sessionSocket || "";
      store.behaviorSessions = [];
      store.sessionCursor = null;
      render();
      await refreshBehaviorSessions({ reset: true });
      safeRender();
    });
  });

  const loadMoreSessions = document.getElementById("loadMoreSessions");
  if (loadMoreSessions) {
    loadMoreSessions.addEventListener("click", async () => {
      loadMoreSessions.disabled = true;
      await refreshBehaviorSessions({ reset: false });
      safeRender();
    });
  }

  const refreshHabitBtn = document.getElementById("refreshHabitBtn");
  if (refreshHabitBtn) {
    refreshHabitBtn.addEventListener("click", async () => {
      lastBehaviorOverviewRefreshAt = 0;
      lastHabitRefreshAt = 0;
      await Promise.all([
        refreshBehaviorOverview(true),
        refreshHabitDetail(true),
        refreshBehaviorSessions({ reset: true }),
      ]);
      safeRender();
    });
  }

  document.querySelectorAll("[data-go-socket]").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentTab = "device";
      tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === currentTab));
      render();
      setTimeout(() => {
        const socketId = btn.dataset.goSocket;
        document.querySelector(`[data-socket-card="${socketId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 0);
    });
  });

  const quickAllOff = document.getElementById("quickAllOff");
  if (quickAllOff) {
    quickAllOff.onclick = () => runBulkQuickAction("quickAllOff", "off", { label: "确认关闭全部已开启插孔？" });
  }

  const quickCutoff = document.getElementById("quickCutoff");
  if (quickCutoff) {
    quickCutoff.onclick = () =>
      runBulkQuickAction("quickCutoff", "off", { label: "紧急断电会关闭全部已开启插孔，确认继续？", strong: true });
  }

  const quickSleep = document.getElementById("quickSleep");
  if (quickSleep) {
    quickSleep.onclick = () => runModeQuickAction("quickSleep", "sleep", "quickEco");
  }

  const quickEco = document.getElementById("quickEco");
  if (quickEco) {
    quickEco.onclick = () => runModeQuickAction("quickEco", "eco", "quickSleep");
  }

  const allOn = document.getElementById("allOn");
  if (allOn) {
    allOn.onclick = () => runBulkQuickAction("allOn", "on", { label: "全部开启属于中风险操作，确认继续？", strong: true });
  }

  const allOff = document.getElementById("allOff");
  if (allOff) {
    allOff.onclick = () => runBulkQuickAction("allOff", "off", { label: "确认关闭全部已开启插孔？" });
  }

  document.querySelectorAll(".socket-toggle").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const socketId = Number(btn.dataset.socket);
      const action = btn.dataset.action;
      const socket = (store.deviceStatus?.sockets || []).find((s) => Number(s.id) === socketId);
      const b = socketBehavior(socket);
      if (action === "on" && b.tag === "protected_cutoff") {
        showToast("保护断电状态不可直接开启");
        return;
      }
      if (b.level === "high" && !window.confirm(`插孔 ${socketId} 当前为高风险状态，确认${action === "off" ? "关闭" : "开启"}？`)) return;
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
        addEvent("CORRECT", `插孔${socketId} 已下发重新识别`);
      } else {
        addAlert("CONTROL_FAIL", `插孔${socketId} 重新识别失败`, "warn");
      }
      await bootstrapData();
    });
  });

  document.querySelectorAll(".socket-type-custom").forEach((input) => {
    input.addEventListener("input", () => {
      const socketId = Number(input.dataset.socket);
      if (!Number.isFinite(socketId)) return;
      customTypeDraftBySocket.set(socketId, input.value || "");
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
        customTypeDraftBySocket.delete(socketId);
        addEvent("LEARN", `插孔${socketId} 类型已提交: ${typeName}`);
        showToast("已提交，后续会减少误提醒");
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
      showToast("本地提醒已清空");
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

  document.querySelectorAll(".pref-toggle").forEach((input) => {
    input.addEventListener("change", () => {
      setAlertPref(input.dataset.pref, input.checked);
      showToast("提醒偏好已保存");
    });
  });

  document.querySelectorAll(".assistant-question").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const question = btn.dataset.question || btn.textContent || "";
      await submitAssistantQuestion(question);
    });
  });

  const assistantForm = document.getElementById("assistantForm");
  if (assistantForm) {
    assistantForm.addEventListener("submit", async (evt) => {
      evt.preventDefault();
      const input = document.getElementById("assistantInput");
      const question = input?.value || "";
      if (input) input.value = "";
      await submitAssistantQuestion(question);
    });
  }

  const clearAssistantChat = document.getElementById("clearAssistantChat");
  if (clearAssistantChat) {
    clearAssistantChat.addEventListener("click", () => {
      clearAssistantMessages();
      showToast("聊天已清空");
      render();
    });
  }

  const saveConnBtn = document.getElementById("saveConnBtn");
  if (saveConnBtn) {
    saveConnBtn.onclick = async () => {
      const apiVal = document.getElementById("apiBaseInput")?.value.trim() || "";
      const wsVal = document.getElementById("wsBaseInput")?.value.trim() || "";
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

  const toggleMailBtn = document.getElementById("toggleMailBtn");
  if (toggleMailBtn) {
    toggleMailBtn.onclick = async () => {
      if (!mailPreference.smtpConfigured) {
        showToast("后端未配置 SMTP");
        return;
      }
      try {
        const result = await updateMailSetting(!mailPreference.enabled, store.token);
        mailPreference = {
          enabled: Boolean(result?.enabled),
          serviceEnabled: Boolean(result?.serviceEnabled),
          smtpConfigured: Boolean(result?.smtpConfigured),
          email: String(result?.email || store.user?.email || ""),
          loaded: true,
        };
        addEvent("CONFIG", `邮件提醒已${mailPreference.enabled ? "开启" : "关闭"}`);
        showToast(mailPreference.enabled ? "邮件提醒已开启" : "邮件提醒已关闭");
        render();
      } catch (err) {
        if (handleAuthExpired(err)) return;
        showToast(`邮件提醒更新失败：${err.message}`);
      }
    };
  }

  const installPwaBtn = document.getElementById("installPwaBtn");
  if (installPwaBtn && deferredInstallPrompt) {
    installPwaBtn.onclick = async () => {
      const promptEvent = deferredInstallPrompt;
      deferredInstallPrompt = null;
      await promptEvent.prompt();
      const result = await promptEvent.userChoice;
      showToast(result.outcome === "accepted" ? "已开始安装" : "已取消安装");
      render();
    };
  }

  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) {
    logoutBtn.onclick = () => {
      clearSessionAndRender("已退出登录");
    };
  }
}

function render() {
  const assistantScrollState = captureAssistantScroll();
  const habitScrollState = captureHabitScroll();
  const assistantMessageCount = (store.assistantMessages || []).length;
  const assistantMessageCountChanged = assistantMessageCount !== lastRenderedAssistantMessageCount;
  try {
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
    if (currentTab === "habit") app.innerHTML = renderHabit();
    if (currentTab === "alerts") app.innerHTML = renderAlerts();
    if (currentTab === "me") app.innerHTML = renderMe();
    bindActions();
    restoreAssistantScroll(assistantScrollState, assistantMessageCountChanged);
    restoreHabitScroll(habitScrollState);
    lastRenderedAssistantMessageCount = assistantMessageCount;
  } catch (err) {
    console.error("Render failed:", err);
    app.innerHTML = `
      <section class="card">
        <h3>页面渲染失败</h3>
        <p class="small">原因：${escapeHtml(err?.message || "未知错误")}</p>
        <button id="resetAppBtn" class="btn danger">清除缓存并重试</button>
      </section>
    `;
    document.getElementById("resetAppBtn")?.addEventListener("click", async () => {
      await clearBehaviorCache();
      localStorage.clear();
      window.location.reload();
    });
  }
}

function statusPollDelay() {
  if (store.wsConnected) return STATUS_POLL_CONNECTED_MS;
  return Math.min(60000, STATUS_POLL_DISCONNECTED_MS * 2 ** Math.min(statusPollFailureCount, 3));
}

function scheduleStatusPolling(delayMs = statusPollDelay()) {
  if (statusPollTimer) window.clearTimeout(statusPollTimer);
  statusPollTimer = window.setTimeout(() => {
    statusPollTimer = null;
    runStatusPoll().catch(() => undefined);
  }, Math.max(0, delayMs));
}

async function runStatusPoll({ force = false } = {}) {
  if (!store.token || !store.selectedDeviceId || !navigator.onLine) return;
  if (statusPolling || document.hidden) {
    scheduleStatusPolling();
    return;
  }
  statusPolling = true;
  const deviceId = store.selectedDeviceId;
  try {
    const now = Date.now();
    if (force || now - lastStatusRefreshAt >= statusPollDelay()) {
      const status = await getDeviceStatus(deviceId, store.token);
      if (deviceId !== store.selectedDeviceId) return;
      store.deviceStatus = status;
      lastStatusRefreshAt = Date.now();
    }
    statusPollFailureCount = 0;
    await refreshTelemetryIfNeeded(force && !store.wsConnected);
    await refreshSupplementIfNeeded(false);
    await refreshBehaviorOverview(false);
    if (currentTab === "habit") await refreshHabitDetail(false);
    updateBadge();
    if (store.wsConnected) updateRealtimeDom("REST_CALIBRATION");
    else safeRender();
  } catch (err) {
    statusPollFailureCount += 1;
    if (handleAuthExpired(err)) return;
  } finally {
    statusPolling = false;
    if (store.token && store.selectedDeviceId && navigator.onLine) scheduleStatusPolling();
  }
}

function startStatusPolling() {
  scheduleStatusPolling(0);
}

function bindGlobalListeners() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    if (currentTab === "me") safeRender();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    showToast("Dorm Power 已安装");
    if (currentTab === "me") safeRender();
  });

  window.addEventListener("online", async () => {
    setBanner("");
    updateBadge();
    if (store.token) {
      connectWs();
      await bootstrapData();
      scheduleStatusPolling();
    }
  });

  window.addEventListener("offline", () => {
    setBanner("当前网络不可用，请检查连接");
    updateBadge();
    if (statusPollTimer) window.clearTimeout(statusPollTimer);
    statusPollTimer = null;
  });

  document.addEventListener("visibilitychange", async () => {
    if (!document.hidden && store.token && store.selectedDeviceId) {
      const stale = Date.now() - lastStatusRefreshAt >= statusPollDelay();
      await runStatusPoll({ force: stale });
      if (currentTab === "habit") {
        await Promise.all([refreshBehaviorOverview(false), refreshHabitDetail(false)]);
      }
    }
  });

  document.addEventListener("focusout", () => {
    window.setTimeout(flushDeferredRender, 0);
  });

  document.addEventListener("pointerdown", (evt) => {
    if (isAssistantChatTarget(evt.target)) holdAssistantInteraction();
    if (isHabitInteractionTarget(evt.target)) holdHabitInteraction();
  });

  document.addEventListener("pointerup", (evt) => {
    if (assistantInteractionActive || isAssistantChatTarget(evt.target)) {
      releaseAssistantInteraction();
    }
    if (habitInteractionActive || isHabitInteractionTarget(evt.target)) {
      releaseHabitInteraction();
    }
  });

  document.addEventListener("pointercancel", () => {
    if (assistantInteractionActive) releaseAssistantInteraction();
    if (habitInteractionActive) releaseHabitInteraction();
  });

  document.addEventListener("scroll", (evt) => {
    if (isAssistantChatTarget(evt.target)) {
      holdAssistantInteraction();
      releaseAssistantInteraction(700);
    }
    if (isHabitInteractionTarget(evt.target)) {
      holdHabitInteraction();
      releaseHabitInteraction(900);
    }
  }, true);

  document.addEventListener("keydown", (evt) => {
    if (evt.key === "Escape") {
      flushDeferredRender();
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
      <p class="small">原因：${escapeHtml(err?.message || "未知错误")}</p>
      <button id="resetAppBtn" class="btn danger">清除缓存并重试</button>
    </section>
  `;
  const resetBtn = document.getElementById("resetAppBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      try {
        await clearBehaviorCache();
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

function isLocalDevHost() {
  return window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
}

function showServiceWorkerUpdate(worker) {
  pendingServiceWorker = worker;
  updateBanner?.classList.remove("hidden");
}

applyUpdateBtn?.addEventListener("click", () => {
  if (!pendingServiceWorker) return;
  applyUpdateBtn.disabled = true;
  applyUpdateBtn.textContent = "正在更新...";
  pendingServiceWorker.postMessage({ type: "SKIP_WAITING" });
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    if (isLocalDevHost()) {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((reg) => reg.unregister())).catch(() => null);
      return;
    }
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (serviceWorkerReloading) return;
      serviceWorkerReloading = true;
      window.location.reload();
    });
    navigator.serviceWorker.register("./sw.js?v=20260809b").then((registration) => {
      if (registration.waiting) showServiceWorkerUpdate(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) showServiceWorkerUpdate(worker);
        });
      });
    }).catch(() => null);
  });
}
