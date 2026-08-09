# Dorm Power 学生端（PWA）

## 目录说明
- `index.html`: 页面骨架（首页、插孔、习惯、提醒、我的 5 个 Tab）。
- `main.js`: 页面渲染、状态管理、命令流程、WebSocket 处理。
- `api.js`: REST 接口封装（支持 API/WS 地址配置）。
- `store.js`: 前端状态存储与本地持久化。
- `styles.css`: 移动端样式。
- `manifest.webmanifest` / `sw.js`: PWA 配置与离线缓存。
- `APP_FEATURE_API_OVERVIEW.md`: 项目主要功能与接口说明。

## PWA 能力
- 使用 `logo.png` 生成普通、maskable 和 Apple Touch 图标。
- WebSocket 正常时每 60 秒进行一次 REST 状态校准，断开时每 8 秒校准。
- 行为总览、7 天习惯和真实会话按用户与设备缓存到 IndexedDB。
- Service Worker 提供应用壳离线缓存，并在新版本就绪时提示用户更新。
- 习惯时间轴按 24 个小时触控块展示，每小时保留 4 个 15 分钟真实微格。

## 本地预览
在 `e:\Embedded_competition\app\app` 执行：

```powershell
python -m http.server 5173
```

浏览器访问：`http://127.0.0.1:5173`

## 联调依赖
后端默认地址：
- API: `http://127.0.0.1:8000`
- WS: `ws://127.0.0.1:8000/ws`

支持的主要接口：
- `POST /api/auth/login`
- `GET /api/devices`
- `GET /api/devices/{id}/status`
- `GET /api/telemetry`
- `GET /api/v1/app/behavior/overview`
- `GET /api/v1/app/behavior/habits/{profileId}`
- `GET /api/v1/behavior/sessions`
- `POST /api/strips/{id}/cmd`
- `GET /api/cmd/{cmdId}`
- `GET /health`
- `WS /ws`
