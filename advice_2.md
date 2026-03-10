一套**学生端 PWA（基于你现有 Next.js 15 App Router + React19 + TS + Antd5 + ECharts + dayjs）**的可落地方案：
包含 **路由结构、组件拆分、状态管理模型（含 WS 事件归一化）、接口封装**，并且对齐你文档里的事件类型：`DEVICE_STATUS / TELEMETRY / CMD_ACK / DEVICE_OFFLINE`。

> 目标：你把这套结构加进现有项目，就能开始把“随机数据”替换为后端真数据，并把手机端体验做成工程级。

---

## 1) 路由结构（App Router）

建议新增一个移动端分组路由：`/(m)`（不影响桌面端 dashboard）

```
app/
  (m)/
    layout.tsx              // Mobile Shell: TabBar + SafeArea + WS bootstrap
    page.tsx                // 重定向到 /m/home
    home/
      page.tsx              // 概览 Home
    device/
      page.tsx              // 插排（默认绑定设备）
      [deviceId]/
        page.tsx            // 可选：支持多个设备时用
    alerts/
      page.tsx              // 告警
    me/
      page.tsx              // 我的
  api/                      // (Next route handlers 可选，不必须)
src/
  mobile/
    components/
    hooks/
    stores/
    services/
    types/
```

### 为什么用 `(m)`？

* 保留你现有中后台页面不动
* 移动端有独立 Shell（TabBar/字体/间距/交互）
* 后期可独立发布成 PWA

---

## 2) Mobile Shell（布局与导航）

### app/(m)/layout.tsx

职责：

* 渲染底部 TabBar（Home/Device/Alerts/Me）
* 初始化“学生绑定设备”（默认 `A-302-strip01`，后期从 `/api/me` 拉）
* 启动 WS，并把 WS 事件灌进 store（归一化）
* 提供全局 Banner（离线/服务异常）

**Tab 建议：**

* Home：`/m/home`
* Device：`/m/device`
* Alerts：`/m/alerts`
* Me：`/m/me`

---

## 3) 组件拆分（可复用 & 工程化）

### Home 页面组件

* `DevicePicker`（顶部设备选择；学生端默认 1 台也可以隐藏）
* `StatusHeroCard`（在线/离线 + 总功率大字）
* `QuickActions`（一键断电/学习模式等）
* `MiniTelemetryChart`（最近 60s 折线）
* `EventFeed`（最近事件列表，来自 store 的 event buffer）

### Device 页面组件

* `DeviceHeaderBar`（在线状态、lastSeen、总功率）
* `SocketGrid`（2 列网格）
* `SocketCard`（开关+功率+标签+pending）
* `CmdToastCenter`（集中处理 cmd ack/timeout 提示，可选）

### Alerts 页面组件

* `AlertList`（未处理/已处理）
* `AlertCard`（类型、时间、建议动作、一键断电/确认）

### Me 页面组件

* `ProfileCard`（绑定信息、token 状态）
* `ServiceHealthCard`（/health 状态：mqtt/redis/db）

---

## 4) 状态管理模型（轻量但工程化）

你现有栈没指定 Zustand/Redux。为了最小引入、工程够用，我建议：
✅ **Zustand**（极适合 WS/实时状态、代码少、易维护）

### Store 拆分

* `useSessionStore`：token、user、boundDeviceId
* `useDeviceStore`：devices 列表、当前 device status、lastSeen、offlineReason
* `useTelemetryStore`：最近 60s ring buffer（按 deviceId + metric）
* `useCmdStore`：cmd 状态机（pending/success/failed/timeout）+ per socket lock
* `useEventStore`：事件流（最近 N 条），统一承接 WS 的事件

> 你后端已经有 409 冲突（同目标 pending 拒绝），cmdStore 必须支持“目标锁”。

---

## 5) WS 事件归一化（核心：一切走统一 Event Bus）

你的 WS 事件类型（按文档）：

* `DEVICE_STATUS`
* `TELEMETRY`
* `CMD_ACK`
* `DEVICE_OFFLINE`

### 统一格式（前端内部）

我们把 WS / REST 都归一化为：

```ts
type DomainEvent =
  | { type: 'DEVICE_STATUS'; deviceId: string; ts: number; payload: DeviceStatus }
  | { type: 'TELEMETRY'; deviceId: string; ts: number; payload: TelemetryPoint }
  | { type: 'CMD_ACK'; ts: number; payload: CmdAck }
  | { type: 'DEVICE_OFFLINE'; deviceId: string; ts: number; payload: { reason?: string } }
  | { type: 'SYSTEM'; ts: number; payload: { level:'info'|'warn'|'error'; message:string } }
```

然后一个 `dispatchEvent(evt)` 分发给各 store：

* `DEVICE_STATUS` → deviceStore.updateStatus
* `TELEMETRY` → telemetryStore.pushPoint
* `CMD_ACK` → cmdStore.resolveCmd + eventStore.add
* `DEVICE_OFFLINE` → deviceStore.setOffline + eventStore.add

> 这样你后期再加 `ALERT_NEW`、`EVENT_NEW` 也只需要加映射，不会散落到每个页面里。

---

## 6) 接口调用封装（services 层）

你文档里接口形态主要是：

* `POST /api/auth/login`
* `GET /api/devices`
* `GET /api/devices/{id}/status`
* `GET /api/telemetry?device=...&range=...`
* `POST /api/strips/{deviceId}/cmd`
* `GET /api/cmd/{cmdId}`
* `GET /health`
  以及 409 冲突与 WS 通道。

### 目录建议

```
src/mobile/services/
  http.ts              // fetch 封装：baseURL、token、timeout、错误映射
  auth.ts
  devices.ts
  telemetry.ts
  cmd.ts
  health.ts
src/mobile/ws/
  wsClient.ts          // connect/reconnect/heartbeat
  normalize.ts         // WS message → DomainEvent
```

---

## 7) 可直接放进项目的 TypeScript 骨架（关键文件）

> 下面是“结构与关键函数签名”，你可以直接粘进去开始填字段。
> （不写太大段落代码，避免你复制成本过高；但每个模块都能跑通。）

### 7.1 `src/mobile/services/http.ts`

```ts
export class ApiError extends Error {
  status?: number;
  code?: string;
  data?: any;
  constructor(message: string, opts?: { status?: number; code?: string; data?: any }) {
    super(message);
    this.status = opts?.status;
    this.code = opts?.code;
    this.data = opts?.data;
  }
}

const DEFAULT_TIMEOUT = 8000;

export async function apiFetch<T>(
  path: string,
  opts: RequestInit & { timeoutMs?: number; token?: string; baseUrl?: string } = {}
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT, token, baseUrl = process.env.NEXT_PUBLIC_API_BASE || '' } = opts;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {}),
      },
      signal: controller.signal,
    });

    const text = await res.text();
    const data = text ? safeJson(text) : null;

    if (!res.ok) {
      // 重点：409 冲突用来提示“已有指令执行中”
      throw new ApiError(data?.detail || res.statusText, { status: res.status, data });
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

function safeJson(text: string) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
```

### 7.2 `src/mobile/ws/normalize.ts`

把 WS 原始消息映射成 `DomainEvent`（对齐文档字段）

```ts
import type { DomainEvent } from '../types/domain';

export function normalizeWsMessage(raw: any): DomainEvent | null {
  // raw: {type: 'CMD_ACK', payload: {...}} 等
  const t = raw?.type;
  const ts = raw?.ts ?? Date.now();

  if (t === 'DEVICE_STATUS') {
    return { type: 'DEVICE_STATUS', deviceId: raw.deviceId, ts, payload: raw.payload };
  }
  if (t === 'TELEMETRY') {
    return { type: 'TELEMETRY', deviceId: raw.deviceId, ts, payload: raw.payload };
  }
  if (t === 'CMD_ACK') {
    return { type: 'CMD_ACK', ts, payload: raw.payload };
  }
  if (t === 'DEVICE_OFFLINE') {
    return { type: 'DEVICE_OFFLINE', deviceId: raw.deviceId, ts, payload: raw.payload || {} };
  }
  return null;
}
```

### 7.3 `src/mobile/ws/wsClient.ts`

```ts
export type WsHandlers = {
  onEvent: (evt: any) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (e: any) => void;
};

export function createWsClient(url: string, handlers: WsHandlers) {
  let ws: WebSocket | null = null;
  let retry = 0;
  let closedManually = false;

  const connect = () => {
    closedManually = false;
    ws = new WebSocket(url);

    ws.onopen = () => { retry = 0; handlers.onOpen?.(); };
    ws.onclose = () => {
      handlers.onClose?.();
      if (!closedManually) {
        retry += 1;
        const backoff = Math.min(5000, 500 * retry);
        setTimeout(connect, backoff);
      }
    };
    ws.onerror = (e) => handlers.onError?.(e);
    ws.onmessage = (e) => {
      try { handlers.onEvent(JSON.parse(e.data)); } catch { /* ignore */ }
    };
  };

  const close = () => { closedManually = true; ws?.close(); };
  const send = (obj: any) => { ws?.readyState === WebSocket.OPEN && ws.send(JSON.stringify(obj)); };

  return { connect, close, send };
}
```

---

## 8) Cmd 状态机（移动端“工程感”核心）

你文档里强调：

* cmdId 跟踪
* 409 冲突
* WS ACK + 轮询兜底
* timeout/offlineReason

### Cmd Store 规则（建议定死）

* 每个目标（deviceId + socketId + type）同一时刻只允许一个 pending
* pending 时：

  * UI 置灰
  * 2s 等 WS
  * 再 500ms 轮询一次 `/api/cmd/{cmdId}`，最多 5s
* 409：显示“已有指令执行中”，并维持 pending UI（或直接同步已有 cmd）

**你后端如果能在 409 的响应 body 里返回 `pendingCmdId` 会更丝滑；暂时没有也能做。**

---

## 9) 首屏加载与刷新策略（按你的时序图实现）

### Home 的加载顺序（必须这样才稳）

1. REST：`/api/devices`（拿 online、offlineReason、lastSeen）
2. REST：`/api/devices/{id}/status`
3. REST：`/api/telemetry?device={id}&range=60s`
4. WS connect：开始增量更新
5. 定时兜底刷新（弱轮询）：status 每 5~10s，避免 WS 中断时 UI 假死

---

## 10) PWA 必备配置（最小集）

* `app/manifest.ts`：name、icons、start_url=`/m/home`、display=standalone
* `next.config.js`：允许 HTTPS/缓存策略（可后期）
* iOS 安装提示（可选）

---

## 11) 你立刻可执行的落地清单（按顺序）

1. 新增 `(m)` 路由与 TabBar Shell
2. 把 API base 配成 `NEXT_PUBLIC_API_BASE`，移动端统一走服务端后端
3. 实现 `wsClient + normalize + dispatchEvent`
4. Home：先把在线/总功率/离线原因跑通
5. Device：把 SocketCard 的 cmd/ack 跑通（含 409/timeout）
6. Alerts：先把离线与 cmd fail/timeout 用 event buffer 做出来

---

