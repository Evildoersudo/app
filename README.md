# Dorm Power 学生端原型（app 目录）

## 文件说明
- `index.html`：页面骨架（4 Tab）。
- `main.js`：页面渲染、状态管理、命令闭环、WS 事件处理。
- `api.js`：后端接口封装（REST + 地址配置）。
- `store.js`：前端状态存储。
- `styles.css`：移动端样式。
- `manifest.webmanifest` / `sw.js`：PWA 基础配置。

## 本地预览
在 `E:\embedding_competition\app` 执行：

```powershell
python -m http.server 5173
```

浏览器访问：
- `http://127.0.0.1:5173`

## 联调前置
1. 启动后端（默认 `http://127.0.0.1:8000`）。
2. 后端需提供：
   - `POST /api/auth/login`
   - `GET /api/devices`
   - `GET /api/devices/{id}/status`
   - `GET /api/telemetry`
   - `POST /api/strips/{id}/cmd`
   - `GET /api/cmd/{cmdId}`
   - `GET /health`
   - `WS /ws`

## 当前实现能力
- 4 Tab：概览 / 插排 / 告警 / 我的。
- 命令双通道确认：
  - 先等 WS ACK（1.8s）
  - 再轮询 `/api/cmd/{cmdId}`（500ms，最多 5s）
- 409 冲突提示（支持兼容 `pendingCmdId` 查询）。
- 收到 `DEVICE_OFFLINE` 时全局禁控并展示离线原因。
- `deviceId` 请求路径统一 `encodeURIComponent`。
- 设备切换与手动刷新。
- 迷你功率曲线增加阈值线（120W）与图例。
- `全部开启 / 全部关闭` 改为逐插孔批量下发，兼容仅支持 socket 控制的后端。
- 轻量 toast 反馈（登录、命令结果、批量执行进度）。
- 我的页支持修改 API / WS 地址并即时重连。
- 顶部状态头支持在线/离线/命令中三态可视化（含呼吸点）。
- 首页新增产品化层级：今日用电强卡、状态卡、快捷操作卡、事件卡。
- 插排页插孔卡支持强状态视觉（ON/OFF/PENDING/高功率）。
- 批量操作加入确认与进度提示（逐插孔执行）。
- 告警页新增筛选（全部/未处理/今日/本周）与人话化文案。
- Debug 配置已隐藏：长按顶部 `Dorm Power` 5 秒切换 Debug 模式。
