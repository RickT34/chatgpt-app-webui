# 验收清单

## 自动化

- `npm test`：三种认证模式、配置校验、Secure Cookie、Origin、消息结构化编码、preload 合成事件、目录浏览及取消。
- `npm run test:integration`：HTTP 认证、原 HTML/CSP、共享对象响应回传、真实 App-host 握手、startup.whenReady 与 appInfo.get。
- 无令牌测试需设置 `CHATGPT_WEB_AUTH=none`；代理测试需设置 `CHATGPT_WEB_URL` 为实际 HTTPS 地址。

## 页面与人工反馈

- 已在真实浏览器看到原版首页、项目列表、会话列表和输入框。
- 使用者已报告基本功能测试正常。
- 使用者已确认目录窗口可选宿主机目录，且修复嵌套弹窗冲突后能完成项目操作。
- 每次更新仍应检查：项目创建、目录取消、刷新恢复、消息与审批、连接断开提示。
- 语音、视频、原生拖放、内嵌浏览器、MCP App 沙箱尚未完整验收。

截图 `docs/images/screenshot.png` 的项目、会话和当前项目名称已用不透明区域及示例文字替换；原始图片不入库。用于再生成该图的脚本坐标只对应已审查的固定尺寸截图，不是通用自动脱敏工具。

## 0.1.0 本机集成结果

- 实际生成的 App 分别以 random、custom、none 模式启动，HTTP 认证和 WebSocket Origin 检查全部通过。
- 停止服务后可运行 `node scripts/verify-modes.cjs` 重做三种模式测试；使用临时本机端口，结束后停止测试 App。
- 临时 Nginx + 本地测试证书完成 HTTPS 登录、Secure Cookie、WSS 和真实 App-host RPC 测试。测试仅将临时 CA 提供给 Node 测试进程，未关闭 TLS 校验。
- Nginx 模板部署时仍需替换自己的域名与有效证书，并运行 `nginx -t`；测试不等于已部署到用户域名。

## 自动引导安装验收

- 8 项 Python 回归测试覆盖架构选择、询问/拒绝/非交互模式、SHA-256 失败、缓存复用、tar 越界、Debian 包选择性解包、无效显式路径和原生库缺失。
- 使用已有官方 x64 `.deb` 缓存实测固定 SHA-256 校验和仅 App 文件解包；包下载器的实际 HTTPS 路径通过 Node 下载验证，未重复消耗数百 MB 下载同一 App 包。
- 实际从 nodejs.org 下载 Node 22 LTS、校验并执行成功。
- 隔离 PATH 去掉系统 Python/Node 后，成功通过官方 uv 安装器下载 uv 与 Python 3.12，再使用仓库内 Node 和 App 完成依赖安装、生成副本与启动；uv 校验路径也已复验。
- 仓库内运行时启动后，真实 App-host RPC、preload 返回事件和运行锁检查通过。
- `--check` 在环境完整时成功，在缺失或副本过期时明确退出且不下载。
- ARM64 只实现架构分派及固定包校验信息，尚未在 ARM 硬件实测。

## 附件协议及手动验收

自动测试：

- `npm test` 覆盖宿主机多选/过滤、二进制上传、路径越界、大小限制、连接归属、取消中的上传清理，以及拖放映射和单次重放。
- `node scripts/smoke-attachments.cjs` 使用原 App 的 `vscode://codex/pick-files` 协议，验证宿主机文件、客户端上传后路径、字节一致性和取消结果。不自动操作网页、不发送模型请求。

请手动验证：

1. 原“添加文件”入口选择“客户端文件”，选中文名文本或图片，点击“添加所选文件”，确认附件出现在输入框中。
2. 改选“宿主机文件”，浏览目录、多选文件并确认；文件路径应属于宿主机。
3. 从文件管理器拖入文件到对话输入框，确认上传后附件出现且没有重复。
4. 取消选择或上传，确认不新增附件；超过 32 MiB 的客户端文件应显示错误。
5. 发送一条包含测试附件的消息，确认模型能读取；刷新后检查会话附件引用。

本轮网页与模型读取效果由使用者验收，未将协议测试作为 UI 全链路通过的证据。

## PDF 预览

服务启动后运行：

```sh
node --experimental-vm-modules scripts/smoke-pdf.cjs
```

验证原 PDF Worker 返回 JavaScript MIME、保留 nosniff、内容与原 ASAR 完全一致、模块语法有效且 CSP 允许同源 Worker。此检查不代替实际页面渲染；请手动重新打开 PDF 预览，检查页面内容、翻页和缩放。

## 下载代理

- Python 回归测试覆盖大小写优先级、ALL_PROXY、NO_PROXY、显式覆盖/禁用、日志凭据隐藏，以及 KDE/GNOME 手动代理读取。
- `python scripts/smoke-proxy.py` 启动回环 HTTPS 服务和 CONNECT 代理，检查真实下载器、npm ping、uv dry-run 下载及 NO_PROXY 绕过。
- 临时证书只供测试进程信任，不关闭 TLS 验证、不访问外部站点、不实际安装测试 wheel。

## 客户端剪贴板、菜单、保存和资源

`node scripts/smoke-native.cjs` 不操作网页，使用模拟的客户端剪贴板接入真实 App-host，再验证 workspaceFiles.saveCopy 和原 save-file 生成下载，检查文件字节、认证、Range 和资源 CSP。

手动验收：

1. 复制消息/代码/分享链接，在客户端其他应用中粘贴；若出现确认窗口，点击“复制”，再测试取消不会显示成功。
2. 在文件、项目、消息等位置打开右键菜单，检查菜单出现在网页，并验证可用操作。
3. 另存为、保存副本、导出日志，选择文件名，检查客户端收到完整文件；自动下载被拦截时使用下载链接。
4. 检查原 app://fs 或 /@fs 路径的图标、图片及资源加载，确认此前 RPC 预览仍正常。

以上为优先四项的验收范围，不代表 webview/MCP、外部应用、拖出文件或音视频已适配。

## Docker 部署验证（2026-10-09）

- 在 Linux amd64 上实际构建 Node 22 / Debian Trixie 镜像，Python 3.13.5 安全解包接口检查通过，原 App 动态库检查通过。
- 本机 Docker 默认构建网络无法访问 Debian 源，使用 `docker build --network=host -t chatgpt-webui:local .` 完成构建；README 提供该备选命令。
- 使用独立 Compose 项目 `chatgpt-webui-check`、18766 端口和全新命名卷。首次解包复用本机已下载的官方 `.deb`，bootstrap 重新校验固定 SHA-256；未重复下载 454 MiB 安装包，未导入个人 profile 或 Codex 凭据。
- 实际进程 UID/GID 为 1000:1000，端口映射仅绑定宿主机 127.0.0.1，健康检查达到 healthy。
- 随机令牌、固定令牌、无令牌模式分别通过 smoke.cjs：HTTP 认证、原 HTML/CSP、preload 响应回传、真实 App-host MessagePort、startup.whenReady 和 appInfo.get（128 项服务，App 26.930.21537）。
- 强制重建容器后，/workspace 和 /data/home/.codex 中的测试标记仍存在，固定令牌配置生效。测试结束仅删除独立测试项目的容器、网络及卷，保留构建镜像。
- `npm test`（10 个测试文件）、Python unittest（13 项）、Compose 配置解析、入口 shell 语法与双语 README 示例一致性检查通过。
- 未验证 ARM64 实机、设备授权登录、网页交互或模型请求；不将协议检查当作这些功能的端到端验收。

## 压缩与缓存验证（2026-10-09）

- 本机 `npm test` 24 项通过，包括真实临时 HTTP 服务上的 Brotli/gzip 解压字节一致性、编码协商、HEAD、ETag/304、内容变化失效、并发压缩及缓存淘汰。临时 HTTP 监听需允许本机网络权限。
- Python unittest 13 项通过；main.cjs、static.cjs、smoke-static.cjs 语法检查通过。
- 安装包内 app-initial/app-shared 的 JS/CSS 静态测量：原始 20,404,265 字节；gzip level 6 为 5,986,620 字节；Brotli quality 4 为 5,626,049 字节。该结果是资源压缩大小，不是页面加载时间或首屏总流量。
- 已提供 `node scripts/smoke-static.cjs` 用于真实服务的认证、304、压缩与动态接口 no-store 检查，本轮未执行该真实 App 集成脚本。
- 按用户要求停止 Docker 验证并清理独立测试容器/卷；不进行网页交互测试。正在运行的用户服务未重启，需重启加载补丁。

## 启动与失效连接验证（2026-10-09）

- 本机 `npm test` 共 29 项通过。
- 本机测试覆盖：fetch 不响应及忽略 AbortSignal、响应体不结束、503 重试、401 立即失败、WebSocket 建连超时/提前关闭、握手等待超时、pong 心跳及失效连接清理、主 frame 导航/失败/崩溃/销毁区分。
- 原 capnweb 回调/剪贴板回归测试增加 adapter.ready()，确认 services 与 startup.whenReady 经过真实 MessagePort RPC 完成。
- Node 语法检查和 Python unittest 13 项通过。未测试 Docker、未进行网页自动交互，未重启正在运行的用户服务。
- 手动验收：低速网络下观察阶段变化；关闭网络后确认失败提示；恢复网络点击重新加载；登录失效重新打开访问链接；宿主重启后确认旧页面提示重试。还需检查正常登录页/聊天页出现后提示层消失。

### App 服务握手监测修正

此前的 adapter.ready() 测试仅使用立即返回的 startup.whenReady，未覆盖原生窗口长期未就绪。本次改为永不完成的原生就绪方法，断言监测器不调用它、不会提前读取 services，且原前端取得 services 后观察 Promise 正常完成。29 项本机测试通过；这不等于已验证用户现场恢复。

### 网页首屏判断与原生窗口等待修正

- 完整原有 29 项本机测试通过；新增首屏状态测试后，定向运行 startup/native-rpc 两个测试文件通过。
- 用原生 whenReady 永不完成的服务验证网页适配方法可返回，isSentryEnabled/reach 仍到达原服务，first_content_visible 回调到达客户端。
- Node 中的状态测试确认静态 loading 节点移除和 renderer_ready 不会让提示消失；first_content_visible 才会取消超时并结束提示。不将这项测试当作真实浏览器验收。

## 2026-10-10 · 启动优化验证

- `npm test`：33 项通过；`python3 -m unittest discover -s tests -p 'test_*.py'`：13 项通过。HTTP 测试在允许本机回环监听的环境运行；沙箱内监听返回 EPERM。
- 新增回归覆盖：准确替换 app://fs 常量、保持普通文本、复用未变压缩对象、App 访问源/桥接内容变化后版本失效、首屏依赖预加载、根路由 base/CSP/脚本顺序、各编码解压后的准确字节、404/406、immutable 与未带版本缓存策略、正文不存在时 304/HEAD 仍不读取正文。
- 实际准备 App 26.930.21537：19,852 个静态资源，缓存对象内容约 693 MiB。一次已有缓存的 `start.sh --setup-only` 检查约 0.333 秒；该数字不包含 Electron 启动或网页加载，也不是跨机器性能保证。
- 使用独立临时 profile、本机 headless Electron、随机令牌认证运行 `scripts/smoke-static.cjs`、`scripts/smoke.cjs`、`scripts/smoke-pdf.cjs`，全部通过；没有操作用户原 profile 或网页。检查版本与未版本 URL、过期版本拒绝、未认证请求拒绝、HEAD/304、原 preload 消息、128 项真实 App-host 服务及 PDF Worker 的字节/MIME/模块语法。
- 该临时 profile 的一次宿主就绪时间约 1.255 秒，rendererReadyMs 为 1114。它仅表示桥接 snapshot 已可用，不表示已登录或浏览器首屏完成。临时进程/profile 已清理。
- 本地响应管线微基准（4 个 app-initial/app-shared JS/CSS，Brotli，输出到 Writable sink）：旧路径首次处理约 256.78 ms，预压缩路径约 6.81 ms；后续正文请求均值约 23.97 → 3.46 ms；条件校验均值约 21.75 → 0.03 ms。旧路径模拟原来的读文件、JS 字符串检查、哈希和内存压缩缓存；不含 ASAR 读取差异、网络或浏览器，未控制 OS 文件缓存。不能把这些数字解释为页面首屏提速比例。
- 按要求未进行 Docker 测试。浏览器冷缓存/热缓存首屏仍由使用者手动验收：正常重启后首次打开、再次打开，比较 Network 面板的传输与缓存命中以及 `window.chatgptWebStartup.timings`；确认实际登录/聊天页面出现、附件/PDF 可用，更新后获取新版本资源。

## 2026-10-11 · 宿主内存优化验证

- `npm test`：34 项通过；Python unittest：14 项通过。新增 worker 取消订阅/重新订阅、重复断线清理、端口关闭、minimal 专属 shared-object 清理/离线分块确认，以及宿主模式变更导致自动重新准备的回归。
- `python3 scripts/smoke-memory.py` 在实际 App 26.930.21537 上完成 full/minimal 各两次运行。每次使用新的临时 Electron profile 和相同 headless/disable-gpu 参数；采集时后端仍使用本机配置。就绪后等待 5 秒采集空闲 PSS；协议检查结束再等待 5 秒采集 PSS。范围为宿主进程及其存活后代，包括后端和插件，不包含客户端浏览器。

| 模式 | 轮次 | 空闲 PSS（MiB） | 协议检查后 PSS（MiB） | rendererReadyMs |
| --- | --- | ---: | ---: | ---: |
| full | 1 | 1835.60 | 1853.71 | 1017 |
| full | 2 | 1817.25 | 1875.71 | 1038 |
| minimal | 1 | 947.45 | 974.28 | 829 |
| minimal | 2 | 957.72 | 983.58 | 828 |

- 空闲平均 1826.43 → 952.59 MiB，降低约 48%；协议检查后平均 1864.71 → 978.93 MiB，降低约 47.5%。这是同一台机器的两轮短时进程树 PSS 对比，不是长期泄漏测试，也不代表浏览器连接后、已加载大量会话或模型任务运行中的总内存。
- 每次均通过 smoke.cjs、smoke-native.cjs、smoke-static.cjs、smoke-pdf.cjs：原 preload 消息、128 项 App-host 服务及原生 startup.whenReady、浏览器 RPC 剪贴板适配、两条下载路径、资源认证/Range、版本缓存和 PDF Worker 字节/MIME/语法。
- 直接检查 ASAR：minimal 宿主页不含 script/link；full 宿主页与原包逐字节一致；两种模式保留的浏览器 HTML 均与原包一致，浏览器静态资源版本相同。
- 额外清理逻辑的单元测试通过；真实大消息中途断线和长时间重连循环仍未做压力测试。没有以强制 GC 或限制堆大小制造内存下降。
- 未运行 Docker，未自动操作网页。手动验收仍需确认实际页面、发送消息与流式响应、切换会话、附件及断开后重新进入。若功能依赖宿主完整桌面生命周期，可按 OPERATIONS.md 切回 full。

## 2026-10-12 · 26.1007.21434 更新准备检查

- 官方稳定软件源中 amd64/arm64 的版本均为 26.1007.21434；本机 amd64 安装包 SHA-256 校验通过。
- Python unittest 14 项通过。现有 prepare.py 的入口/preload 检查、minimal 副本生成及 prepare-static.cjs 的原 HTML 入口解析和静态资源准备成功。
- 以现有 run.sh 的访问源运行 `--setup-only` 和 `--check` 成功；prepare-manifest.json 确认为新版来源、版本 26.1007.21434 和 minimal 模式，旧版安装目录仍在。
- 本次仅验证下载、准备及环境检查，不沿用旧版的原生协议/PSS 数据作为新版证据。未启动账号会话，未进行网页或 Docker 测试；实际兼容性待使用者验收。

## 2026-10-12 · 等待宿主 AbortError 排查

- 用户进一步确认错误发生在“正在等待宿主 App”。按现有 run.sh 启动诊断宿主后，本机 `/bridge/bootstrap` 返回 HTTP 200、22,713 字节，单次响应约 3.2 ms。`/bridge/status` 确认 minimal renderer ready；未发起模型请求。
- 不携带外层认证访问域名时，nginx 返回 401；用户确认浏览器已完成额外登录。因此该未认证探测不用于解释浏览器故障，公网已认证链路仍未自动验证。
- `npm test` 36 项、Python unittest 14 项通过。新增验证：abort 同步拒绝 fetch 时仍保留 TimeoutError；首个请求超时、502、网络 TypeError 后可以重试成功；响应体超时重试；403 不重试；内联脚本提前发起一次 bootstrap 且不影响真实首屏完成门槛。
- REA 对新版 ASAR 的分析受到超时/资源限制，仅有部分静态证据（`ev_b45b3df509cdf78344d6c99eb18ba5a478aaa56e671ba10d3313d79583364c37`），未据此宣称完整兼容性或定位网络超时根因。本次修复依据桥接源码、定向回归与本机 HTTP 实测。
- 未做 Docker 或浏览器交互测试。修复后需在用户已登录的域名页面刷新验证；若仍失败，以新的具体阶段及错误区分网络、网关、认证和宿主未就绪。

## 2026-10-12 · 新版真实本地页面验收

- 用户随后明确授权本地浏览器测试。使用独立 localhost Origin，在内置 Chromium 浏览器打开 26.1007.21434 minimal 服务，首次访问与刷新均进入真实主页，项目/会话列表、原输入框和发送按钮可见，启动提示消失；没有发送模型消息或更改账号设置。
- 补充资源路径诊断并重建后，再次用新标签验证主页和输入框正常出现。截图保存于 `.logs/localhost-page.jpg`（不入 Git）。测试标签关闭以释放单客户端连接，localhost 服务保留供使用者测试。
- `npm test` 37 项通过，新增回归验证具体资源路径、阶段归类及 URL 凭据/查询参数不泄漏。
- 未复现用户公网页面的“页面资源下载失败”，不能宣称其根因已修复。若再次出现，应使用新提示中的具体失败路径继续检查。未进行 Docker 测试。
- 浏览器控制台仍有 Sentry Electron 连接警告和 Statsig 请求的 `owned payload shouldn't contain raw ReadableStreams` RPC 错误；本次它们未阻止主页显示。完整流式 RPC 功能兼容性仍未验证，不把首屏成功当作全部功能通过。

## 2026-10-13 · nginx 模板实测

- `node scripts/smoke-nginx.cjs` 在本机 nginx 1.30.5 上通过：使用模板派生的临时配置、独立回环端口和自签测试证书，客户端使用 CA 校验，未关闭证书验证。
- nginx -t 通过；六次顺序 HTTP/1.1 请求复用同一个上游 socket，未向上游发送 Connection: close；两个上游时延响应头正常。
- 经 nginx 的 HTTP/1.1 大文件响应和六条并发 HTTP/2 流均完整收到同一份大于 4 MiB 的 gzip 响应，Content-Length、Content-Encoding 和内容哈希正确；ALPN 实际协商为 h2。
- WebSocket 经相同配置完成 Upgrade 和双向消息回传。测试进程及临时配置清理；没有重载生产 nginx，没有做 Docker 测试。
- 这是配置功能/传输完整性验证，不是用户公网环境的端到端时延基准，也未证明连接复用就是卡顿的唯一根因。实际站点部署后的时延仍需用响应头与浏览器 Timing 验证。

## 2026-10-13 · 图标与固定标题验证

- `npm test` 38 项通过；新增验证覆盖自定义中文标题、空白归一化、HTML/属性字符转义、替换文本中的 `$&`、默认值、图标版本地址及 identity.js 的执行顺序。
- 用 `CHATGPT_WEB_TITLE=我的工作台` 启动本地原 App 页面：启动阶段、主页显示、打开已有“优化启动速度”会话后，浏览器实际 title 均为“我的工作台”，会话区域可见。未发送模型消息。
- 实际 HTTP 获取 favicon：200、image/svg+xml，响应字节与项目 SVG 文件完全一致；页面 link 指向对应版本的本地图标。
- 测试标签和临时本地宿主已关闭。未测试 Docker，也未改变用户的域名反向代理配置。

## 2026-10-13 · httpFetch 流式修复回归

- `npm test` 共 44 项通过。新增 6 项通过真实 MessageChannel、两端 capnweb RPC 和项目 JSON codec 验证，未模拟跳过序列化路径。
- 原来失败的 `{response: Response}` 可在正文尚未结束时返回，按顺序读取首块、后续块及 EOF；HTTP 状态、状态文本、headers、二进制请求体、上传进度回调均保留。
- 覆盖 204 无正文、错误结果及抛出异常；响应头前取消使调用方失败，迟到响应释放；按原 App 正文包装器的完成逻辑转发 cancel；正文错误导致读取失败。
- 覆盖关闭适配器时终止活动读取、宿主侧 RPC 会话关闭后释放服务，以及取消一个并发请求不会中断另一个。
- 原剪贴板、Startup 与双向回调测试继续通过。本次按用户要求不进行浏览器、真实账号会话或 Docker 测试；没有以协议回归通过代替用户现场首屏验收。

## 2026-10-13 · 预热与日志改造验证

- `npm test`：46 项通过；Python unittest：18 项通过。新增预热/三次客户端会话复用、活动回调路由、状态快照补发、三层 RPC 中流式响应、原生连接故障提示、日志去重/轮转/权限、SIGTERM 转发和单实例锁释放验证。
- 真实 App 26.1007.21434 使用独立临时 Electron profile 和本机随机端口运行 `python3 scripts/smoke-warm-host.py`。四次协议连接完成后 status 为 browserConnections=4、nativeHostConnections=1、persistentHost=true；每次取服务及 appInfo 约 19/14/13/10 ms。服务在浏览器连接前预热完成。
- 改造前同一协议检查为 23/16/11/11 ms，四次连接阶段宿主进程树累计 CPU 约 0.10 秒；最终版本约 0.06 秒。此工作负载很小，差异不能外推为真实网页或低配服务器的首屏提速比例。最关键的已验证行为是后续连接不再重建原生 AppHost，而不是这些毫秒数。
- 同一测试中继续通过真实 App 的客户端剪贴板替换、workspaceFiles.saveCopy、legacy save-file、下载字节和资源认证/Range/CSP 检查。前一个基线记录出现 4 次关闭连接后的 AppView 注册失败；复用连接后该记录为 0。
- 对本次真实原生输出应用默认日志规则，40 行收敛为 4 行状态输出；原文不丢弃，详细日志仍可查看。保留可处理网络/配置错误及异常退出提示。没有把 MaxListenersExceededWarning 隐藏后当作“已证明不存在泄漏”。
- 本机 nginx/systemd 实例未修改。`systemd-analyze --user verify deploy/chatgpt-web.service` 通过，仅校验模板，没有安装或 enable。没有测试 Docker 或自动操作真实网页，目标服务器完整首屏仍由使用者验收。
- 测试报告：`.logs/warm-baseline.json`、`.logs/warm-final.json`；精简输出示例：`.logs/normal-console-preview.txt`。测试子进程及临时 profile 已关闭。

## 2026-10-14 · 完整页面初始化与配置缓存

- `npm test`：53 项通过。新增大响应块传输、TypedArray/DataView 边界、无原生 Base64 API 的浏览器回退、配置缓存跨实例恢复、加载期间修改、配额和存储故障回退、SDK 关闭存储时不访问新缓存等验证。
- 在当前 ARM 机器上使用独立宿主和浏览器进程加载真实原版页面。修改前每次出现 5 次 Statsig 缓存 QuotaExceededError；最终版三次加载均为 0，同一浏览器重新打开的宿主出站桥接消息从约 36.0 MB 降到 6.8 MB。
- 完整首屏仍为 21–31 秒，不能宣称已经实现任意浏览器快速打开。样本方法、阶段定义、数据及限制见 [启动调查](STARTUP_ANALYSIS.md)。临时进程和 profile 已清理，原运行服务继续使用旧准备副本，未做 Docker 测试。

## 2026-10-14 · 宿主配置、文件摘要与当前快照

- `npm test` 63 项、Python unittest 18 项通过。新增并发文件摘要复用、文件修改/替换/删除与故障重试、完整 SDK 身份和新鲜度校验、首屏后刷新与离页取消、快照合并和宿主失效处理。侧栏测试显式模拟原版 getter 永久缓存，验证新路径读取当前 IPC 结果。
- 对 App 26.1007.21434 在独立目录执行完整 `scripts/prepare.py`，成功生成私有 ASAR 和 20,130 个静态资源；SDK 与原生摘要补丁均通过唯一匹配。未更改正在运行服务的副本。
- 两个独立 Electron 进程加载真实原界面，最后一组关闭 CPU profiler。首屏按原版 `first_content_visible` 记录：首次 24.0→24.2 秒，同一浏览器再次打开 23.4→21.5 秒，全新浏览器 20.5→19.6 秒。仅为少量顺序样本，不承诺固定提速比例或秒开。
- 第二、三次均命中宿主配置；运行时摘要读取量均为 0。此前一次完整首次采样观察到 4 个文件合计约 643 MB。网页 Sentry IPC 失败和配置配额错误均为 0；不是通过全局屏蔽错误实现。
- 记录位于 `.logs/startup-investigation/unprofiled-before/`、`unprofiled-after/`。临时进程、profile 与验证副本已清理。没有测试 Docker。

## 2026-10-14 · 内置浏览器挂载

- 修改前在实际运行服务调用 CUA `createBrowserTab`，复现约 15 秒 WebView attach 超时。原版日志只有 renderer 创建标签记录，没有 native runtime attach；真实宿主状态为 minimal / nativeHostConnections=1。
- 读取 App 26.1007.21434 的原版主进程及 renderer 代码，追踪注册、partition 身份、挂载、回收和同步策略。REA 对 3 个相关原版函数的提取片段完成静态分析；证据 `ev_cde8687b15a4cb7edc88bc5a93905b4b622aaf5fa15bd4999026bdc7364cf691` 仅覆盖这些片段，不代表完整应用语义或运行结果。
- 独立 Electron 宿主、独立 profile、本机随机端口：通过原版 browserHost 注册/导航路径挂载原生 guest；fixture 页面标题、正文正确，截图为 1280×720。断开 RPC/WebSocket 再连接，新 renderer 身份注册仍复用同一 guest ID；发送原版 close-tab 后，guest 被销毁且原生记录清理。
- 测试 fixture 必须补齐原界面正常发送的 ready、annotation API 初始化消息和 runtimeIntlConfig；否则空白独立 profile 的原版 preload 会等待策略初始化。仅在测试实例中初始化为关闭该可选 API，产品代码不更改此策略。
- 回归覆盖并发注册合并、原生准入拒绝及重试、注册期间关闭、后台激活、截图尺寸、重连时持久化校验、过期回收请求和真实 capnweb 适配器跨连接保留。保留了原有启动/流式 RPC 测试。
- 正式运行实例未热修改、未重启。本次没有在更新后的正式实例上完成 CUA 点击/输入验收，也没有验证网页面板的画面转发；需重启后测试。未做 Docker 测试。

手动验收：重启原服务并刷新网页，让 Codex 创建 example.com 标签、读取正文和截图；再在测试表单中输入并点击。刷新网页后绑定同一标签，确认不再出现挂载超时；关闭测试标签后确认不再列出它。

- 最终自动回归：Node 71 项、Python 18 项通过；`git diff --check` 通过。独立目录的完整 prepare 成功生成 App 26.1007.21434 的原生副本及 20,130 个资源。调查记录在 `.logs/browser-investigation/`；临时宿主、profile 和准备副本均已清理。

## 2026-10-14 · 手动接管验证

- 完整本机测试：78 项 JavaScript、18 项 Python 通过。
- 使用真实本机 HTTP/WebSocket 验证：第二客户端无确认被拒绝、确认接管关闭旧连接（4001）、新连接仍可收发、旧 close 不清理新连接、同时接管的过期确认被拒绝、缺少认证或错误 Origin 不能接管。
- 启动函数测试验证确认前不建立接管连接，以及竞争后会对新占用者重新询问。中继测试验证旧 RPC/port 结果保留旧归属；下载测试验证接管后才写完的文件仍通知原发起者。
- 按 review-testing 方法检查了测试的副作用覆盖，并补充旧响应投递和延迟下载通知断言。保留原常驻宿主跨浏览器复用测试，未新增停止任务调用。
- 没有执行真实网页点击、Docker 或正式宿主的接管；手动验收时在两台设备依次打开页面，第二台点击“接管连接”，确认旧页面明确提示被接管、新页面可操作及既有任务仍可查看。
