# chatgpt-webui

**简体中文** | [English](README.en.md)

在浏览器中远程使用 ChatGPT Desktop 的原版界面，管理宿主机上的 Codex 项目和会话。支持Docker中运行。

项目复用已安装 App 的 HTML、JavaScript、CSS 和原后端，通过 WebSocket 适配 Electron 通信。

> 非官方实验项目，与 OpenAI 无隶属关系。

## 运行效果

![chatgpt-webui 原版界面](docs/images/screenshot.png)


## 功能

- 在浏览器使用原版项目侧栏、会话列表和聊天界面。
- 保留原 App 后端及本机 Codex 配置、工具和会话存储。
- 用网页弹窗浏览**宿主机**文件夹并添加项目，支持路径输入、上一级、主目录和隐藏目录。
- 将普通 IPC、worker 消息和 App-host MessagePort 通信转发到浏览器。
- 支持随机访问令牌、固定访问令牌和无令牌模式。
- 支持 SSH 转发或 Nginx HTTPS / WebSocket 反向代理。
- 用脚本生成可撤销的 App 副本，保留源版本及补丁校验记录，方便升级后重新应用。

## 浏览器端操作桥接

- **网页链接打开位置**：原“默认浏览器”改为“客户端浏览器（新标签页）”，HTTP(S) 链接在访问 WebUI 的浏览器中打开；内置浏览器选项继续在 WebUI 内打开。若客户端拦截弹窗，页面会显示可手动点击的链接。本地 URL 中的 `localhost` 指客户端自身。修改后重启 WebUI 并刷新页面生效。

- **对话附件上传** 在对话中使用原来的“添加文件”入口，可选上传文件或使用宿主机本地文件。
- **复制文字/链接**：App-host 的文本剪贴板服务改为浏览器 Clipboard API。
- **右键菜单**：启用原前端自带的网页菜单。
- **另存为/保存副本**：保存窗口在网页中选择下载文件名。原 App 完成写入后提供客户端下载；浏览器阻止自动下载时，可点击保留的下载链接。

静态页面、脚本和样式支持 Brotli/gzip 压缩。浏览器保留私有缓存，每次访问用 ETag 校验；未变化的资源返回 `304`，无需重新传输内容。补丁或 App 更新导致内容变化时会重新下载。登录、会话接口、上传、下载中转和宿主机文件不缓存。压缩在首次请求时异步进行，结果缓存在进程内（最多 64 MiB），重启后重新生成；无需额外配置 Nginx 压缩。

## 环境要求

- Linux。
- ChatGPT Desktop：可复用已安装版本；未安装时会询问并下载到仓库。
- 当前适配版本：`chatgpt-desktop 26.930.21537-1`。
- Node.js 22+/npm 与 Python 3.11+：启动脚本自动检测，缺失时询问并本地安装。
- 首次自动下载建议至少 3 GiB 空间；基本引导工具为 POSIX shell、curl 或 wget、tar、sha256sum，以及 Linux `ldd`。
- 宿主系统须具备 Electron 所需的 glibc、GTK、NSS 等原生库；启动前会检测缺失项。

## 快速开始

下载本仓库并进入目录：

```sh
scripts/start.sh --ozone-platform=headless --disable-gpu
```

首次启动会依次检查 Python、Node/npm、App、原生动态库和项目依赖。需要下载时会显示来源、版本与目标路径，并询问 `Continue [y/N]`；直接回车或输入 `n` 会停止。

```sh
# 仅检查环境
scripts/start.sh --check

# 完成环境安装和副本准备，但不启动 App
scripts/start.sh --setup-only

# 明确同意所有仓库内下载，适合无交互环境
scripts/start.sh --yes --setup-only
scripts/start.sh --yes --ozone-platform=headless --disable-gpu
```

`--help` 查看入口选项，其他参数原样传递给 Electron。

自动安装范围：

| 组件 | 来源及版本 | 仓库内位置 |
| --- | --- | --- |
| ChatGPT Desktop | [官方 Linux 分发源](https://learn.chatgpt.com/docs/linux/linux-app)，固定已适配的 `26.930.21537`，按 x64 / ARM64 选择| `.deps/chatgpt-<版本>-<架构>/` |
| Node.js + npm | [nodejs.org](https://nodejs.org/dist/latest-v22.x/)，安装时解析 Node 22 LTS 当前版本| `.deps/node/` |
| Python | [Astral uv](https://docs.astral.sh/uv/guides/install-python/) 获取 Python 3.12 standalone 构建| `.deps/python/`、`.deps/uv/` |
| npm 依赖 | `package-lock.json`，执行 `npm ci --ignore-scripts` | `node_modules/`，缓存 `.deps/cache/` |

App 的 `.deb` **仅解包 App 文件，不需要 sudo**。

打开终端输出的登录链接，例如 `http://127.0.0.1:18765/login?token=...`。当前链接也保存在 `.logs/access-url`。

默认监听 `127.0.0.1:18765`。`Ctrl+C` 停止服务。不带 headless 参数时会显示本机 App 窗口，可用于首次登录：

```sh
scripts/start.sh
```

登录后停止窗口版本，再按需启动 headless 版本。

### 三种访问令牌模式

**默认：每次启动生成随机令牌**

```sh
scripts/start.sh --ozone-platform=headless --disable-gpu
```

服务重启后旧链接及旧 Cookie 失效，请重新打开 `.logs/access-url` 中的链接。

**自定义固定令牌**

```sh
export CHATGPT_WEB_ACCESS_TOKEN='replace-with-a-long-random-secret'
scripts/start.sh --ozone-platform=headless --disable-gpu
```

至少 16 个字符，建议使用 `openssl rand -hex 32` 生成的随机值。

**不使用访问令牌**

```sh
unset CHATGPT_WEB_ACCESS_TOKEN
CHATGPT_WEB_AUTH=none scripts/start.sh --ozone-platform=headless --disable-gpu
```

直接访问 `http://127.0.0.1:18765/`。此模式允许能访问服务的人操作宿主机 App，仅用于可信本机、私有隧道，或已有独立认证的反向代理。**不要将无认证入口直接暴露到公网**。

### 配置项

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `CHATGPT_APP_DIR` | 自动发现 | 指定已安装或手动解包的 App 目录 |
| `CHATGPT_WEB_PROXY` | 环境/桌面手动代理 | 统一下载代理；空值禁用代理 |
| `CHATGPT_WEB_PYTHON` | 系统或本地 Python | 显式指定引导 Python 路径 |
| `CHATGPT_WEB_SETUP_YES` | `0` | `1` 等同 `--yes`，同意仓库内安装 |
| `CHATGPT_WEB_HOST` | `127.0.0.1`；容器 `0.0.0.0` | 服务监听 IP，与浏览器访问源独立 |
| `CHATGPT_WEB_PORT` | `18765` | 本机监听端口 |
| `CHATGPT_WEB_AUTH` | `token` | `token` 或 `none` |
| `CHATGPT_WEB_ACCESS_TOKEN` | 随机生成 | 自定义访问令牌；不要与 `none` 同时设置 |
| `CHATGPT_WEB_ORIGIN` | `http://127.0.0.1:<端口>` | 浏览器实际访问的完整源，如 `https://chatgpt.example.com` |

更改安装目录或端口的例子：

```sh
CHATGPT_APP_DIR=/path/to/chatgpt scripts/start.sh --setup-only
CHATGPT_WEB_PORT=18766 scripts/start.sh --ozone-platform=headless --disable-gpu
```

## Docker 部署

安装 Docker Engine 和 Compose 插件后，在仓库目录执行：

```sh
docker compose up -d --build
docker compose logs -f chatgpt-webui
```

首次启动自动下载已适配的 App，Compose 启动即同意仓库内自动下载。支持 Linux amd64/arm64。

获取当前登录链接：

```sh
docker compose exec chatgpt-webui cat /app/.logs/access-url
```

默认仅发布到宿主机 `127.0.0.1:18765`，可沿用下方 SSH 隧道或宿主机 Nginx 模板。若本机已有服务占用该端口，或使用外部域名，启动前设置：

```sh
export CHATGPT_WEB_PUBLISH_PORT=18766
export CHATGPT_WEB_ORIGIN=http://127.0.0.1:18766
# HTTPS 反代时改为浏览器实际访问的源：
# export CHATGPT_WEB_ORIGIN=https://chatgpt.example.com
docker compose up -d
```

固定令牌用 `export CHATGPT_WEB_ACCESS_TOKEN='replace-with-a-long-random-secret'`；无令牌用 `unset CHATGPT_WEB_ACCESS_TOKEN` 后 `export CHATGPT_WEB_AUTH=none`，再执行 `docker compose up -d`。下载代理可通过 `CHATGPT_WEB_PROXY` 或常规代理环境变量传入。

如果 Linux 上的 Docker 构建网络无法访问软件源，可先用宿主机网络构建，再启动已构建的镜像：

```sh
docker build --network=host -t chatgpt-webui:local .
docker compose up -d --no-build
```

### 登录、项目和持久化

容器是独立的执行环境，**不会自动读取宿主机的登录信息、Codex 会话或文件**。Codex 可使用内置 CLI 的设备授权登录（需要账号允许设备授权），按终端提示在客户端浏览器完成授权：

```sh
docker compose exec chatgpt-webui /app/.runtime/resources/codex login --device-auth
docker compose restart chatgpt-webui
```

- `data` 持久卷保存 App 下载、副本、Electron profile、Codex 配置/会话、附件、下载中转及日志。容器内路径为 `/data`，Codex 数据在 `/data/home/.codex`。
- `projects` 持久卷挂载到 `/workspace`，可在网页项目选择器中选择该路径。

```yaml
services:
  chatgpt-webui:
    volumes:
      - /absolute/path/to/projects:/workspace
```

## 远程访问

### SSH 隧道

在访问端执行：

```sh
ssh -N -L 18765:127.0.0.1:18765 user@target-machine
```

然后打开目标机器 `.logs/access-url` 中的链接。若本地端口不同，宿主机启动时将 `CHATGPT_WEB_ORIGIN` 设置为浏览器访问的地址和端口。

### Nginx 反向代理

完整模板：[deploy/nginx.conf](deploy/nginx.conf)。适用于 Nginx 与 Web UI 在同一台机器，通过独立域名的根路径提供服务。

1. 将模板中的 `chatgpt.example.com` 和 TLS 证书路径换为自己的配置。
2. 将模板放到 Nginx `http {}` 包含的配置目录，如 `/etc/nginx/conf.d/`。
3. 用对应的外部地址启动 App：

```sh
export CHATGPT_WEB_ORIGIN=https://chatgpt.example.com
export CHATGPT_WEB_ACCESS_TOKEN='replace-with-a-long-random-secret'
scripts/start.sh --ozone-platform=headless --disable-gpu
```

4. 执行 `sudo nginx -t`，通过后再重新加载 Nginx。
5. 打开终端输出的 **HTTPS** 登录链接。

应确保 `CHATGPT_WEB_ORIGIN` 与浏览器地址完全一致。

## 更新、回滚和数据位置

更新 App 后，先停止 Web UI，再执行：

```sh
scripts/start.sh --ozone-platform=headless --disable-gpu
```

启动时会检查原 ASAR 与补丁的校验值，仅在缺失或变化时重新生成副本；切换来源时同步更新资源链接。

数据位置：

| 路径 | 内容 |
| --- | --- |
| `.deps/` | 本地工具、App 下载、缓存及安装记录，不入库 |
| `.runtime/` | 可重新生成的 App 副本及资源链接 |
| `.downloads/` | 客户端下载中转文件；下载链接在服务重启后失效 |
| `.uploads/` | 已交给 App 的客户端附件，仍被会话引用时应保留 |
| `.profile/` | 独立 Electron 登录、偏好和缓存，升级时保留 |
| `.logs/access-url` | 当前访问入口，包含令牌时属于凭据 |
| `prepare-manifest.json` | 本次源 App 版本、SHA-256 和补丁 SHA-256 |
| `.logs/prepare-history.jsonl` | 每次生成操作的追加记录 |

以上路径均被 Git 忽略。

目前仅允许一个浏览器 WebSocket 连接。遇到连接冲突时，关闭其他已连接标签页再重试。

## 开发与验证

```sh
npm test
python3 -m unittest discover -s tests -p 'test_*.py'
# App 已启动且浏览器连接已关闭时：
npm run test:integration
# 附件协议测试，不自动操作网页：
node scripts/smoke-attachments.cjs
# 剪贴板 RPC、保存副本和本地资源协议检查：
node scripts/smoke-native.cjs
# 静态资源压缩与缓存协议检查：
node scripts/smoke-static.cjs
# PDF Worker 资源检查：
node --experimental-vm-modules scripts/smoke-pdf.cjs
# 无令牌模式的集成检查：
CHATGPT_WEB_AUTH=none npm run test:integration
```

反代环境测试时同时设置 `CHATGPT_WEB_URL=https://chatgpt.example.com`。测试会读取 `.logs/access-url`，只做目录和 App 信息读取，不创建会话、不发送模型请求。

```text
原版网页 → electronBridge / MessagePort 适配 → WebSocket
       → 原 Electron 主进程 → 原 renderer / preload → 原 App 服务
```

[修改记录](docs/OPERATIONS.md) · [MIT License](LICENSE)

MIT 许可仅适用于本仓库新增代码。ChatGPT 名称、界面和安装资源属于其各自权利人，不随本项目授权或分发。
