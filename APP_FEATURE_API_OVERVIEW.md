# Dorm Power 项目主要功能与接口说明（面向后续优化）

## 1. 项目结构总览
- `web/back_end`: FastAPI 后端，负责设备状态、命令、遥测、AI 报告、WebSocket 推送。
- `web/dorm-power-console`: Web 管理控制台（Next.js）。
- `app/app`: 学生端 PWA（本次优化目标），纯前端静态页面（`index.html + main.js`）。

## 2. App（PWA）核心功能
- 登录：账号密码登录，拿到 token 后进入主应用。
- 设备视图：
- 设备列表加载与切换。
- 当前设备状态查看（在线、总功率、电压、电流、插孔状态）。
- 插孔控制：
- 单插孔开关控制。
- 全开/全关批量控制（逐插孔串行下发）。
- 快捷模式：断电、睡眠、节能模式。
- 遥测展示：
- 可选时间范围功率曲线（1h/24h/7d/30d）。
- 粗略日用电、周用电估算。
- 告警中心：
- 离线/控制失败等告警聚合。
- 支持全部、未处理、今日、本周筛选。
- 连接稳定性：
- WebSocket 实时更新 + HTTP 轮询兜底。
- 离线提示、自动重连。
- PWA 基础能力：
- Service Worker 缓存 App Shell。
- Manifest 支持安装。

## 3. 后端 REST 接口（App 已对接）

## 3.1 健康检查
- `GET /health`
- 作用：检查后端、MQTT、数据库状态。
- 典型响应：
```json
{
  "ok": true,
  "mqtt_enabled": true,
  "mqtt_connected": true,
  "database_url": "sqlite:///..."
}
```

## 3.2 登录
- `POST /api/auth/login`
- 请求体：
```json
{
  "account": "admin",
  "password": "admin123"
}
```
- 响应体：
```json
{
  "ok": true,
  "token": "xxxx",
  "user": {
    "username": "admin",
    "email": "admin@dorm.local",
    "role": "admin"
  }
}
```

## 3.3 设备列表
- `GET /api/devices`
- 响应体（数组）：
```json
[
  {
    "id": "A-302 strip01",
    "name": "strip01",
    "room": "A-302",
    "online": true,
    "lastSeen": "2026-03-10T01:23:45Z"
  }
]
```

## 3.4 设备状态
- `GET /api/devices/{device_id}/status`
- 响应体：
```json
{
  "ts": 1741570000,
  "online": true,
  "total_power_w": 75.3,
  "voltage_v": 220.1,
  "current_a": 0.34,
  "sockets": [
    { "id": 1, "on": true, "power_w": 20.1, "device": "Laptop", "pendingId": null }
  ]
}
```

## 3.5 遥测曲线
- `GET /api/telemetry?device={device_id}&range={range}`
- `range` 支持：`60s | 1h | 24h | 7d | 30d`
- 响应为时间序列点（`ts`, `power_w`）。

## 3.6 下发命令
- `POST /api/strips/{device_id}/cmd`
- 请求体（常见）：
```json
{
  "socket": 1,
  "action": "on",
  "mode": null,
  "duration": null,
  "payload": {}
}
```
- 响应体：
```json
{
  "ok": true,
  "cmdId": "cmd_xxx",
  "stripId": "A-302 strip01",
  "acceptedAt": 1741570000
}
```
- 说明：命令是否最终成功，要继续用 WS ACK 或 `/api/cmd/{cmdId}` 查询。

## 3.7 查询命令结果
- `GET /api/cmd/{cmd_id}`
- 响应体：
```json
{
  "cmdId": "cmd_xxx",
  "state": "success",
  "updatedAt": 1741570001,
  "message": "",
  "durationMs": 120
}
```
- `state`：`pending | success | failed | timeout | cancelled`

## 3.8 房间 AI 报告（当前 App 未使用）
- `GET /api/rooms/{room_id}/ai_report?period=7d|30d`

## 3.9 学生管理接口（管理员使用）
- `GET /api/admin/students`
- `GET /api/admin/students/{username}`
- `POST /api/admin/students`（创建/更新学生 + 绑定设备）
- `POST /api/admin/students/{username}/bindings`
- `POST /api/admin/students/{username}/reset_password`
- `DELETE /api/admin/students/{username}`

## 4. WebSocket 实时事件（`/ws`）
- `DEVICE_STATUS`
- 设备状态更新。
- `TELEMETRY`
- 遥测点推送。
- `CMD_ACK`
- 命令回执，包含 `cmdId/state/updatedAt/message`。
- `DEVICE_OFFLINE`（App 兼容处理）
- 设备离线通知。

## 5. App 中命令确认机制（关键流程）
1. `POST /api/strips/{id}/cmd` 提交命令并拿到 `cmdId`。
2. 优先等待 WebSocket `CMD_ACK`（低延迟）。
3. 若超时未收到 ACK，轮询 `GET /api/cmd/{cmdId}` 兜底。
4. 更新 UI 状态与告警提示。

该策略可兼容 WS 瞬断、MQTT 抖动、后端延迟。

## 5.1 用户设备权限（新增）
- 登录后使用 `Authorization: Bearer <token>` 访问业务接口。
- 后端对设备相关接口执行权限校验。
- `admin`：可访问全部设备。
- `student`：只可访问 `USER_DEVICE_SCOPE` 中配置的设备。
- 配置示例（`.env`）：
```env
USER_DEVICE_SCOPE=alice=strip01,strip02;bob=A-302 strip01
```

## 6. 本次已完成的 App 优化（2026-03-10）
- 修复学生端页面与 manifest 的乱码文案。
- 重构 `main.js`：提升可读性和状态一致性。
- 加入设备选择与告警筛选本地持久化。
- 强化网络层（请求超时、网络异常标准化报错）。
- WebSocket 重连改为指数退避，避免抖动下频繁重连。
- 轮询优化：页面隐藏/离线时暂停轮询，恢复时自动刷新。
- 增强离线提示和在线恢复逻辑。
- 改进 Service Worker，加入 App Shell 缓存与旧缓存清理。

## 7. 下一轮优化建议（优先级）
1. 增加 token 真正鉴权（后端目前登录 token 未做服务端校验）。
2. 为 App 增加 E2E/集成测试（登录、命令提交、WS 断连恢复）。
3. 将遥测图迁移为可复用组件并支持 24h/7d 切换。
4. 增加“命令历史”与“失败原因追踪”页面。
5. 增加 SW 版本提示（检测新版本后引导用户刷新）。
