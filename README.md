# Dorm Power 学生端（PWA）

## 目录说明
- `index.html`: 页面骨架（4 个 Tab）。
- `main.js`: 页面渲染、状态管理、命令流程、WebSocket 处理。
- `api.js`: REST 接口封装（支持 API/WS 地址配置）。
- `store.js`: 前端状态存储与本地持久化。
- `styles.css`: 移动端样式。
- `manifest.webmanifest` / `sw.js`: PWA 配置与离线缓存。
- `APP_FEATURE_API_OVERVIEW.md`: 项目主要功能与接口说明。

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
- `POST /api/strips/{id}/cmd`
- `GET /api/cmd/{cmdId}`
- `GET /health`
- `WS /ws`
