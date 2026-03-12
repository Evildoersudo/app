## **全栈 PWA + Nginx 生产环境部署与维护标准手册（SOP）》**

---

### 🏛️ 一、 最终的完美架构总览

现在的服务器流量走向是非常标准且安全的企业级架构：

1. **外部流量**只能通过 **443 端口 (HTTPS)** 访问 Nginx。
2. **静态页面请求**（如 HTML/JS/CSS）：Nginx 直接去 `/var/www/pwa_app` 拿文件给用户。
3. **API 请求**（普通 HTTP）：Nginx 转发给本机的 `127.0.0.1:8000` (FastAPI)。
4. **长连接请求**（WebSocket）：Nginx 携带 `Upgrade` 协议头，安全地转发给后端的 `/ws` 通道。
5. **后端骨干**（8000 端口）被隐藏在防火墙后，完全不对外暴露。

---

### ⚙️ 二、 Nginx 新增/修改网站标准流程

如果以后你要加新网站，或者修改配置，请严格遵循以下流程：

**1. 编写配置：** 在 `sites-available` 写好配置文件。

```bash
sudo nano /etc/nginx/sites-available/你的域名.conf

```

**2. 建立软链接（“上架”）：** 必须把它链接到 `sites-enabled`，否则 Nginx 当它不存在。

```bash
sudo ln -s /etc/nginx/sites-available/你的域名.conf /etc/nginx/sites-enabled/

```

**3. 语法检查（极其重要）：** 每次重启前必做！

```bash
sudo nginx -t

```

**4. 重载配置：** 让 Nginx 平滑读取新配置，不断开现有用户的连接。

```bash
sudo systemctl reload nginx

```

---

### 🔒 三、 HTTPS 小绿锁配置与续期

我们使用了 Let's Encrypt + Certbot 自动化配置。

* **初次申请并自动配置（一键魔法）：**
```bash
sudo certbot --nginx -d 你的域名1 -d 你的域名2

```


*(前提是域名已经解析到 IP，且 Nginx 里已经有了对应的 server_name)*
* **以后怎么续期？**
其实不需要你管，Certbot 已经在后台加上了定时任务，快过期时会自动续期。如果有问题，可以手动测试续期：
```bash
sudo certbot renew --dry-run

```



---

### 📁 四、 前端 PWA 代码更新指南（安全规范）

为了彻底避开 `Permission denied` (13) 和 500 错误，前端静态文件的更新请遵循“展厅模式”：

1. **工作区（拉代码）：** 在 `/home/ubuntu/...` 目录下使用 `git pull` 更新你的代码，然后进行 `npm run build`（如果有的话）。
2. **发布到展厅（核心）：** 把最终产物（HTML/JS 等）复制到系统专用的前台目录。
```bash
sudo cp -r /home/ubuntu/.../app/* /var/www/pwa_app/

```


3. **重置权限（防患未然）：** 确保 Nginx 拥有读取权限。
```bash
sudo chown -R www-data:www-data /var/www/pwa_app

```



---

### 🔌 五、 WebSocket (WS) 核心避坑指南

这是全栈交互的命脉，以后如果 WS 连不上，先查这三个地方：

1. **Nginx 必须开“绿灯”：** 必须包含 `Upgrade` 协议头。
```nginx
location /ws {
    proxy_pass http://127.0.0.1:8000; # ⚠️ 注意：结尾绝对不要加斜杠！
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}

```


2. **前端地址必须加密：** 在 HTTPS 环境下，代码里必须写成 `wss://...`。
3. **警惕 PWA 顽固缓存：** 如果改了前端代码里的 WS 地址但没生效，记得：
* **电脑端：** F12 -> Console -> `localStorage.clear()` -> `Ctrl + F5` 强制刷新。
* **手机端：** 删除桌面图标 -> 清理浏览器缓存 -> 重新访问并添加到主屏幕。



---

### 🛡️ 六、 防火墙（云安全组）规范

为了防止后端被绕过代理直接攻击，只留必要的门：

* **开启（允许公开）：** 443 (HTTPS), 80 (HTTP), 1883 (MQTT 设备连入)。
* **开启（限制来源）：** 22 (SSH 登录，最好限制你自己的 IP), 18083 (EMQX 后台，必须限制特定 IP)。
* **坚决关闭（删除规则）：** 8000 等后端应用的直连端口。

---

### 🚑 七、 终极排错两板斧

以后遇到任何 `502 Bad Gateway` 或 `500 Internal Error`，不要慌，敲下面这两个命令，真凶直接浮出水面：

**1. 查 Nginx 报错日志（排查权限、路径、死循环）：**

```bash
sudo tail -n 20 /var/log/nginx/error.log

```

**2. 查后端服务死活（排查 502）：**

```bash
curl -I http://127.0.0.1:8000

```

*(如果返回 Connection refused，说明你的 Python 后端挂了，去检查后端的报错日志即可)*

---
