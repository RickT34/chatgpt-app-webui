# 修改记录

## 2026-10-08 · 0.1.0

### 原 App 复用

- 检查版本 `26.930.21537` 的 `webview/index.html`、`.vite/build/preload.js` 和原启动入口。
- 生成脚本复制 Electron 可执行文件、链接原依赖资源、重建本地 ASAR 索引；追加适配代码，不修改系统安装包。
- 新入口先启动 HTTP / WebSocket / IPC 桥接，再运行原入口。
- 普通 preload 调用、worker 消息及 capnweb MessagePort 均经过原 App 后端。
- 用结构化编码保留二进制、undefined、BigInt、Date、Map/Set 等值。
- 独立 profile 必须同时使用 `--user-data-dir`；只设置环境变量对该版本太晚。独立 profile 并不隔离宿主机 Codex 存储。
- 使用运行锁、原包校验值和追加生成记录支持升级复用。

### 加载问题修复

- 原 preload 合成消息的 source 为 null；不能只接受 source === window，否则初始化响应会被丢弃。
- 原头像浮窗也暴露桥接接口。将中继固定到首次主 renderer，防止辅助窗口替换连接而触发 Startup renderer is unavailable。
- 保留原 CSP；App 内侧用 IPC，浏览器端只加入配置的 WebSocket 源。
- 已验证网页首页、项目列表、会话列表显示；使用者报告基本功能测试正常。

### 宿主机目录选择

- 主进程接管目录类型的原生 showOpenDialog 请求，以 Web UI 弹窗选择宿主机路径。
- 支持路径输入、主目录、上一级、隐藏目录、目录符号链接；不提供目录创建或任意文件内容接口。
- 返回前验证真实目录，将路径按原生对话框结果结构交回原项目流程。
- 取消和断线释放待完成请求，过期请求 ID 无法操作新选择窗口。
- 选择窗口必须挂到原项目 dialog 内部，避免 Radix 把目录点击识别为 outside-click；同时隔离点击、焦点和 Escape，关闭后恢复原焦点。
- 使用者已手动确认目录选择和创建项目流程成功。

### 开源整理

- 命名为 chatgpt-webui，增加 MIT 许可，仅覆盖新增适配代码。
- README 加入脱敏截图、功能、运行方法、限制与升级流程。
- 默认随机令牌；支持 CHATGPT_WEB_ACCESS_TOKEN 固定令牌及 CHATGPT_WEB_AUTH=none。
- 配置 CHATGPT_WEB_ORIGIN 统一登录 URL、CSP、WebSocket Origin 校验与 Secure Cookie。
- 登录令牌与会话 Cookie 分离，重启轮换 Cookie；令牌使用常量时间比较。
- 增加 Nginx HTTPS / WebSocket 模板；关闭该站点访问日志，避免记录登录令牌。
- 仅进行本地 Git 提交；未创建远程仓库或公开发布。

## 升级检查点

1. 原启动入口、preload 必需接口、HTML 模块入口是否改变。
2. 新 ASAR 是否仍能用原运行时启动；资源目录是否变化。
3. 主窗口和辅助窗口的启动顺序是否变化。
4. capnweb 协议、新增同步调用或可转移对象是否需要适配。
5. 原生目录对话框及项目弹窗结构是否变化。
6. 三种认证模式、Origin 和反代 WebSocket 是否通过测试。
7. 新截图逐区域审查，不能提交原始截图、个人 profile 或会话记录。

## 自动化启动与仓库内安装

- `start.sh` 先检测可用 Python；缺少时经确认用官方 uv 安装器将 uv/Python 安装到 `.deps`，不修改 shell 配置。
- `bootstrap.py` 检查 Node/npm、App、动态库和依赖，逐项确认下载；`--yes` 提供明确预授权，`--check` 不下载，`--setup-only` 不启动。
- 固定 App 26.930.21537 的 amd64/arm64 包和 SHA-256；Node 从官方 Node 22 LTS 清单解析具体版本并校验；不静默切换到新 App 版本。
- 仅抽取 `.deb` 的 usr/lib/chatgpt 子树，不运行系统安装脚本；安全 tar 过滤防止目录穿越和外部符号链接。
- 引导脚本使用 fcntl 锁，并把同一个锁 FD 传给 prepare，最后由 App 持有；移除启动对 flock 命令的依赖。
- 自动识别副本过期并重建；切换系统 App 与本地 App 时刷新资源符号链接。
- `.deps/install-history.jsonl` 记录新下载的 URL、实际 SHA-256 和是否匹配预期校验；Python 构建路径保留具体版本。
- 不能安全下载替代的系统图形库和 libc 只列出缺失项并停止，不修改系统。

## 客户端与宿主机附件

- 文件选择请求继续使用原 App 的 `pick-files` / `showOpenDialog` 流程。目录请求仍交给项目目录选择器，文件请求显示双来源附件窗口。
- 宿主机文件支持目录浏览、隐藏项、多选、原始扩展名过滤及普通文件校验。
- 客户端文件使用带认证和 Origin 检查的 HTTP 上传，不将文件字节塞进 WebSocket JSON。文件名检查防止越界，写入独立 UUID 目录，单文件上限 32 MiB。
- 上传批次绑定当前浏览器连接；取消批次及断线清理未提交上传，已交给原 App 的附件保留在 `.uploads/`。
- 拖放先上传客户端 File，再提供同步 getPathForFile 映射并只重放一次 drop；保留原文件对象与字节，原 App 决定最终附件处理方式。
- 页面已切换、目录拖入和上传失败会提示错误。普通文字拖拽不被拦截。
- 文件窗口沿用嵌套弹窗、焦点与 Escape 隔离，避免关闭底层对话框。
- 根据使用者要求，本轮不做网页自动交互。后端/协议验证通过，手动验收步骤见 VALIDATION.md。

## PDF 预览修复

- 原 PDF.js 使用 `pdf.worker.*.mjs` 模块 Worker。静态服务此前没有 `.mjs` 映射，返回 application/octet-stream，导致浏览器拒绝加载。
- 为 `.mjs` 返回 text/javascript，同时补齐 `.pdf` 的 application/pdf。继续保留 nosniff 和原 CSP。
- 新增 `scripts/smoke-pdf.cjs`：直接检查实际 HTTP Worker 响应类型、与原 ASAR 的字节一致性、模块语法及 worker-src CSP。
- 协议检查通过；按使用者要求不执行网页自动交互，PDF 实际渲染由使用者验收。

## 自动依赖下载代理修复

- 在 Python/uv 引导之前加载 `scripts/proxy.sh`，规范代理变量的大小写、ALL_PROXY 回退和 NO_PROXY，并传递给 npm。
- 优先使用显式 CHATGPT_WEB_PROXY，其次环境变量，再读取 KDE/GNOME 手动代理；空值可禁用自动发现。配置内容按数据读取，不执行桌面配置文件。
- 大文件下载优先使用 curl，代理凭据通过环境传递；保留 HTTPS、重定向协议限制和 SHA-256 校验。没有 curl 时显式构造 urllib HTTP 代理，SOCKS/HTTPS 代理提示安装 curl。
- 不在来源提示中输出代理地址或认证信息，不写入 npmrc 或系统配置。
- 不执行 PAC；GNOME 代理认证凭据需通过显式环境变量提供。

## 2026-10-09 · 客户端日常操作适配

- 使用 capnweb 的两端 RPC 中继替换 App-host clipboard 服务为客户端实现，其他服务和原前端回调继续双向转发；不依赖私有 RPC 导出表编号。
- 原前端必须使用 RpcPromise 暴露异步属性，不能直接返回原生 Promise。回归测试覆盖文本写入、读取、拒绝传播和其他服务/回调转发。
- 不再暴露 electronBridge.showContextMenu，让原前端的 disable-native 分支使用既有网页菜单。
- 接管 showSaveDialog，使用网页文件名窗口；仅对本适配器发出的中转路径，在 writeFile/copyFile/rename 或输出流完成后宣布可下载。普通工作区文件写入不触发下载。
- 增加受原登录认证保护的下载和 /@fs 资源接口，支持字节范围与 HEAD。下载使用 Content-Disposition attachment；本地资源带 sandbox CSP、nosniff，HTML/JS 作为普通文本提供。
- 对原静态模块的 app://fs 源常量及 RPC 中的完整资源 URL 做转换。不改变普通文字中引用该协议的句子，不转换二进制消息。
- capnweb 从开发依赖调整为运行依赖；新增代码随自动准备流程写入副本。
- 真实原 App 协议测试已通过：workspaceFiles.saveCopy、save-file、客户端下载字节、未登录资源拒绝和 Range 响应。未自动操作网页。
- 后续范围：webview/MCP、媒体、辅助窗口、拖出文件、多连接及重连仍保留已知限制。

## 2026-10-09 · Docker 部署

- 新增 Dockerfile、compose.yaml 和容器入口，继续调用原 start.sh/bootstrap.py；镜像不包含原 App，首次启动使用固定版本及 SHA-256 下载/解包。
- 基础镜像为 Node 22 / Debian Trixie，构建时安装 Electron 动态库及 Python，并检查安全 tar 解包 API。进程默认以 UID/GID 1000:1000 运行。
- /app 下的运行数据路径链接到 /data 命名卷；HOME 与 CODEX_HOME 也位于该卷。/workspace 使用独立项目卷，可通过 compose.override.yaml 改为宿主目录挂载。
- 新增 CHATGPT_WEB_HOST：本机仍默认 127.0.0.1，容器内为 0.0.0.0；公开访问源继续由 CHATGPT_WEB_ORIGIN 控制。Compose 默认仅发布宿主机回环端口。
- Compose 使用 init、1 GiB 共享内存、HTTP 健康检查及自动重启；转发认证和代理变量，未设置的令牌保持缺省，避免空字符串破坏随机令牌模式。
- 默认 headless、disable-gpu、no-sandbox、password-store=basic，无 privileged、Docker socket 或桌面挂载。Chromium 沙箱与密码存储选择在双语 README 中说明。
- .dockerignore 使用允许列表，构建上下文排除安装包、原版资源、账号、会话、日志和用户文件；本地 Compose override 不入 Git。
- 更新：重新构建镜像并 recreate，保留命名卷；回滚：检出旧代码并重建，由原校验机制重建 App 副本。不用 down -v 做普通停止。

## 2026-10-09 · 静态资源压缩与缓存

- 新增 bridge/static.cjs，随 prepare.py 写入 App 副本；仅处理原 App 静态资源、桥接脚本及 HTML，不压缩或缓存会话接口、附件上传、下载中转和宿主文件。
- 按 Accept-Encoding 协商 Brotli/gzip/identity，遵循 q 值及禁用项；设置 Vary: Accept-Encoding、Content-Length 和 nosniff，支持 HEAD。
- 使用异步 zlib（Brotli quality 4、gzip level 6）；相同内容的并发压缩复用同一 Promise，压缩结果采用 64 MiB 上限的 LRU 缓存，不在主线程同步压缩大文件。
- 静态响应使用 private, no-cache 和内容 SHA-256 弱 ETag。浏览器可存储但每次需校验，未变更时返回 304；内容哈希在地址替换和 HTML 注入后计算，保证补丁、访问源或 App 升级后失效。
- 未采用永久 immutable 缓存：原 App 的哈希文件名不包含适配补丁版本，同名 JS 的内容可能随适配代码变化。
- 认证检查先于缓存校验，登录响应和未认证响应显式 no-store；保持动态接口与宿主资源 no-store。
- 新增静态资源 HTTP 单元测试与 scripts/smoke-static.cjs，后者用于已启动服务的只读压缩/缓存检查。更新双语说明和验证记录。
- 生效方式：停止当前服务后重新运行 start.sh，自动检测补丁变化并重建副本。无需新增依赖或修改 Nginx；回滚代码后同样重启即可。

## 2026-10-09 · 启动卡住与连接失效处理

- 增加 startup.js，在其他桥接脚本之前以内联脚本运行；CSP 只加入该文件内容的 SHA-256，不启用 unsafe-inline 脚本。提示层可在 body 尚未解析时显示，避免后续资源下载阻塞时只看到加载动画。
- 显示下载页面资源、等待宿主 App、连接宿主机、桥接模块、原界面模块、App 服务及界面初始化阶段；失败显示明确原因和手动重新加载按钮。原模块动态 import 现在捕获异常及超时。
- bootstrap 使用 60 秒总期限、请求 10 秒期限和 AbortController；仅对 503 重试，401 直接提示登录过期。WebSocket 建连期限 15 秒，模块/界面期限 120 秒，App-host 服务握手期限 60 秒。
- RPC 适配器共享 services 获取结果，并暴露 ready() 等待原服务 startup.whenReady；启动完成需同时满足入口执行、服务就绪和原启动占位界面移除。
- WebSocket 在模块下载期间提前接收并排队消息，避免注册正式处理器之前丢失状态事件。失败和 pagehide 关闭连接，释放 RPC、选择器和普通请求；不自动重放操作。
- 服务端 15 秒发送 ping 和应用心跳，45 秒未收到 pong 终止失效连接；客户端 60 秒未收到消息提示重试。close 清理先核对连接身份，避免旧连接清除新连接。
- 监听宿主主 frame 导航、加载失败、render-process-gone 和 destroyed，清除 snapshot/peer 并关闭客户端；重载保留主 renderer 所属 ID，防止辅助窗口抢占。异步注入失败按代数判定，避免过期回调清除新状态。
- /bridge/status 增加 rendererState 供只读诊断；新增异常路径测试。重新运行 start.sh 自动重建副本后生效。

## 2026-10-09 · 修正 App 服务握手监测

- 用户反馈新增阶段停在“等待 App 服务”，最终出现握手超时。检查发现监测器主动获取 services 并额外调用 startup.whenReady()；原 App 的该方法等待原生窗口内容就绪，原前端本身也会调用它，不等同于桥接服务握手。
- 撤回主动探测和共享上游 services Promise，恢复原前端触发的服务获取路径。ready() 只观察该请求成功或失败，不调用任何额外 App 生命周期方法；连接关闭时拒绝尚未完成的等待。
- 回归测试把原生 startup.whenReady 设为永不完成，验证桥接握手仍完成、没有额外生命周期调用、上游服务只按原前端请求获取一次，其他 RPC 和剪贴板仍可用。
- 本机 29 项测试通过；未测试网页交互或 Docker，未修改 README。实际页面恢复情况仍需重启服务后手动确认。

## 2026-10-09 · 网页窗口启动门槛及首屏信号

- 用户反馈提示层消失后仍停在原 App loading。上一轮仅移除监测器的额外调用，原 React 前端仍调用 startup.whenReady()，并通过 Suspense 等待它；原 App 方法依赖宿主 primaryWindowContentReady，受宿主启动关键路径影响。
- 在浏览器 RPC 适配器中增加 Startup 服务：whenReady 表示已取得浏览器所需服务，不再等待隐藏的原生窗口；isSentryEnabled 和 reach 保持转发。保留 native stub 的独立引用并在适配目标销毁时释放。
- 原前端的静态 startup-loader 会被 React loading fallback 替换，不能用 DOM 占位节点消失证明界面可用。改为监听原前端实际调用 startup.reach('first_content_visible')，并与入口执行/服务握手一起决定关闭提示层。
- 未到 first_content_visible 时保留初始化超时和重试，不主动伪造该信号，不改变原界面业务初始化。
- 回归覆盖原生 whenReady 永不完成、网页 whenReady 正常返回、阶段回调及原方法转发；状态测试覆盖“旧 loading DOM 消失、React 已挂载”仍保持等待，到实际首屏信号才结束。
- 未修改 README，未测试 Docker 或浏览器交互；需重启服务生成新副本，再手动确认现场恢复。

## 2026-10-10 · 启动资源并行加载与磁盘预压缩

- 保留原 App 界面、后端与 renderer relay。首屏模块使用 modulepreload 提前下载/解析，原入口仍等待 chatgptWebReady 后执行；不提前调用原 App 服务，也不伪造 first_content_visible。
- 桥接 classic scripts 改为按顺序 defer；RPC adapter 在 bootstrap/WebSocket 等待期间并行导入。预加载范围来自原入口直接列出的 JS 依赖，不递归预加载整个 App。页面 base 仍为 `/`，不改变原路由。
- 新增 `scripts/prepare-static.cjs`：准备阶段读取副本 ASAR，将静态资源写入 `.runtime/web-static/objects`，提前完成 app://fs 常量替换、SHA-256、Brotli/gzip 压缩。按内容寻址复用未变资源，最后发布 manifest 并清理旧对象；准备过程沿用启动锁。
- 新资源 URL 为 `/static/<version>/...`。版本覆盖原 App、桥接补丁和访问源，模块的相对导入继承该版本。版本资源使用 `private, max-age=31536000, immutable`；旧的未带版本 URL 仍可访问，使用 `private, no-cache`。未知版本返回 404/no-store，必须刷新页面，不能把新代码放到旧的 immutable URL 下。
- 静态响应按 manifest 直接流式读取磁盘；304/HEAD 不读取正文、不重新计算哈希、不压缩。HTML 在进程启动时生成一次，仍需校验；bootstrap/status、上传、下载及宿主文件维持原认证与 no-store 策略。
- 首次准备或更新需要额外处理时间与磁盘空间。本次 App 的缓存对象内容约 693 MiB（实际磁盘占用还包括文件系统开销）；后续正常启动复用 manifest，不重复压缩。修改访问源时自动重建版本，内容未变的压缩对象复用。
- 更新/启动：停止现有服务后，继续使用原启动命令与环境变量（例如现有 `run.sh`）；`start.sh` 自动重建。也可先在相同环境下运行 `sh scripts/start.sh --setup-only`，把准备工作提前完成。`--check` 只检查，不生成资源。
- 恢复缺失的缓存对象：停止服务后删除 `.runtime/web-static/manifest.json`，再按原环境运行 `--setup-only`；缺失的内容文件会重新生成。若怀疑已有对象内容损坏，删除整个 `.runtime/web-static` 后重新准备。该目录只保存可重建的 App 静态资源，没有 profile/聊天记录。
- 回滚：恢复上一版代码并按原命令重启，原 manifest 校验会重建 App 副本；无需清理 `.profile`。旧代码不使用新增的磁盘缓存，可在服务停止后删除 `.runtime/web-static` 回收空间。
- 启动诊断：网页控制台的 `window.chatgptWebStartup.timings` 与 `chatgpt-web:*` Performance marks 记录阶段时间，真正就绪时输出一次汇总；认证后的 `/bridge/status` 增加 staticVersion、uptimeMs 和 rendererReadyMs。后两者从桥接主模块开始执行计时，不含 setup。

## 2026-10-11 · 最小宿主 renderer 与订阅清理

- 默认 `CHATGPT_WEB_HOST_RENDERER=minimal`。仅在可重建的 App 副本中将宿主 `webview/index.html` 替换为无脚本、无样式依赖的空文档；保留原窗口 URL、原 preload、IPC 信任校验和 MessagePort。宿主不再运行第二份完整 React 界面。
- 原 HTML 单独保存为 `.vite/build/web-original.html`，HTTP 页面使用它；静态准备直接读取原安装包资源。浏览器仍运行原界面，后端服务与桥接架构不变。切换宿主模式不改变浏览器静态资源版本。
- 最后一个浏览器 worker 订阅退出时，立即停止对应宿主监听；断线后关闭端口和 worker，并在 minimal 模式释放该浏览器注册的 shared-object 订阅。full 模式的原界面共享同一窗口订阅，因此不批量取消 shared-object 订阅。
- minimal 模式在没有浏览器接收方时确认被丢弃的原生分块消息，释放发送方的流控等待；有连接时仍由真实浏览器消费并确认。不保存离线消息队列，不伪造浏览器首屏信号。
- 生效：停止服务后，按原启动命令重启，准备流程自动检测模式并重建副本。`/bridge/status` 的 `hostRenderer` 可确认实际准备模式。
- 兼容回退：在原启动命令前增加 `CHATGPT_WEB_HOST_RENDERER=full`，例如 `CHATGPT_WEB_HOST_RENDERER=full sh run.sh`（若原来使用该脚本）。需要先停止现有服务；保留原访问源、认证、profile 及其他参数。恢复 minimal 时移除该变量或显式设为 minimal，然后重启。
- 行为边界：宿主不再自行运行完整桌面界面及其 UI 生命周期；renderer_ready、first_content_visible、background_ready 仍由浏览器原界面实际触发。依赖这些阶段的后台工作可能要等浏览器首次初始化；需要原桌面初始化行为时使用 full。宿主自身不会提供原桌面聊天界面。
- 内存复现：停止 Web 宿主后运行 `python3 scripts/smoke-memory.py`。脚本为 full/minimal 各启动两次临时 Electron profile，采集进程树 PSS，执行只读服务查询及临时文件下载检查，退出后清理测试进程/profile 并恢复调用者环境的准备模式。它会重建副本，不能与正在运行的 Web 宿主并行使用。
- 该脚本仍使用本机原后端配置，临时 Electron profile 不等于隔离所有 Codex 全局配置或插件。测试不发起模型任务、不操作网页、不运行 Docker；结果在 `.logs/memory-check.json`，原生日志在 `.logs/memory-*.log`，均不纳入 Git。

## 2026-10-12 · 更新官方稳定版至 26.1007.21434

- 从官方稳定软件源 `https://persistent.oaistatic.com/codex-app-prod/linux/deb/dists/stable/main/binary-amd64/Packages` 及对应 `binary-arm64/Packages` 核对当前版本，更新 bootstrap.py 的固定版本与两种架构 SHA-256。
- amd64：`276b5341c3d74b261d3ad52106f7fa7edde06841e4767fe2a40cb54099b1f3ed`；arm64：`55fae1e3fb1d6069a90620e9e70737dcf8bf2255604d157e282cc6748a1baf49`。本机只下载、校验和解包 amd64；不将读取 ARM64 校验值视作 ARM64 运行验证。
- 新包保存在 `.deps/chatgpt-26.1007.21434-amd64`，保留旧 `.deps/chatgpt-26.930.21537-amd64`。未修改系统安装包和用户 profile，未启动账号会话。
- 已按现有 run.sh 的访问源 `https://archchat.rickt.cn` 与无令牌配置执行 `--setup-only`，生成 minimal 副本和新版静态资源缓存。使用者继续执行 `sh run.sh` 即可启动新版。
- 回退旧版：停止 Web 宿主后，在项目目录执行 `CHATGPT_APP_DIR="$PWD/.deps/chatgpt-26.930.21537-amd64/usr/lib/chatgpt" sh run.sh`；脚本按原包重新准备。该操作仅回退二进制/适配副本，不恢复新版实际运行后可能迁移的数据。
- 新版网页兼容性由使用者测试；本次不进行浏览器交互、原生会话运行或 Docker 验证。若出现问题，保留启动阶段提示和相关错误，以便针对新版接口继续适配。

## 2026-10-12 · 等待宿主阶段的超时处理

- 用户报告停在“正在等待宿主 App”，随后显示 `This operation was aborted`。该阶段尚未进入 WebSocket/原界面初始化，对应 `/bridge/bootstrap` 请求。
- 修正 wait 的超时竞争：先以明确的 TimeoutError 拒绝等待，再取消底层请求，避免 AbortController 的通用 AbortError 抢先覆盖实际超时原因。
- 内联 startup 脚本立即发出 bootstrap 请求，早于 deferred 桥接脚本及后续大模块预加载；浏览器显式使用 same-origin 凭据和 high 请求优先级。client 复用同一个 Promise，不重复查询。
- 请求与读取响应体均受单次 10 秒和总计 60 秒期限约束。503、502/504、网络失败及请求中止在总期限内重试；401/403 立即提示重新验证反向代理或服务登录，其他 HTTP 错误不盲目重试。
- 本机接口正常不代表公网已登录浏览器链路正常；不关闭 nginx 认证、不绕过 TLS，不将 Statsig/GCM 日志单独认定为网页失败根因。

## 2026-10-12 · 本地浏览器验收与资源错误定位

- 用户授权直接启动本地页面测试。使用 `CHATGPT_WEB_AUTH=none CHATGPT_WEB_ORIGIN=http://127.0.0.1:18765 sh scripts/start.sh --ozone-platform=headless --disable-gpu`，不调用 run.sh，不经过域名/反向代理。
- 资源 error 事件现在标明失败 SCRIPT/LINK 的 pathname，并将错误归入“下载页面资源”，避免沿用之前的“等待宿主”阶段而误判。路径不包含 URL 用户名、密码或查询参数。
- 本地测试服务的 Origin 是 localhost 地址；若恢复域名访问，需要先停止该服务，再用原 run.sh 启动，不能直接用公网域名访问 Origin 不匹配的测试服务。

## 2026-10-13 · nginx 连接复用与时延诊断

- 用户确认使用 deploy/nginx.conf。原模板已设置 proxy_buffering off；没有证据把暂停下载归因于 nginx 响应缓冲。原模板的普通请求发送 Connection: close，且没有上游连接池或显式启用 HTTP/2。
- 新模板定义 chatgpt_webui_backend 上游和 keepalive 16，普通请求清空 Connection 头，WebSocket 请求仍使用 upgrade；前端开启 HTTP/2，减少多模块加载的连接排队机会。保留原 Host、Origin、反代头、认证边界和不记录访问日志的策略。
- 使用 http2 on，要求 nginx >= 1.25.1 且编译了 ngx_http_v2_module。更新实际站点时合并这些改动，保留原证书、域名和用户额外设置的 auth_basic 等认证指令；先 nginx -t，再由站点维护者 reload。仓库修改本身不会改变运行中的 nginx。
- 响应头 X-WebUI-Upstream-Connect-Time 和 X-WebUI-Upstream-Header-Time 的单位是秒，分别来自 upstream_connect_time/upstream_header_time；失败或未转发的请求可能没有有效数值。连接时间高应检查 nginx 到宿主的连接路径；连接快但首字节慢应检查上游处理。两者都低而页面仍停顿时，继续看浏览器 Timing 的 Queueing/Stalled、下载阶段及 Performance 主线程，不能直接断言是宿主慢。
- 可用 `node scripts/smoke-nginx.cjs` 在独立端口验证模板，不修改系统 nginx、不访问外部网站、不使用 Docker。测试需要本机 nginx（HTTP/2、TLS 模块）及 openssl，自动生成只供测试客户端信任的临时证书并清理测试进程/文件。

## 2026-10-13 · 网页图标和自定义固定标题

- 新增随项目提供的 SVG favicon：`bridge/favicon.svg`，经现有版本化静态资源路径提供，不访问外部图标服务。
- 使用 `CHATGPT_WEB_TITLE` 配置浏览器标签标题，默认 `ChatGPT Web`；空字符串/全空白使用默认值，连续空白折叠为空格。标题按 HTML 文本/属性转义，不作为脚本执行。
- 例如先 `export CHATGPT_WEB_TITLE='我的工作台'`，再执行原启动命令（保留原域名、认证等环境和 Electron 参数）。Compose 同样转发此变量。该配置对该服务的所有浏览器生效，不是每个浏览器各自的设置。
- HTML 初始标题和后续标题保持一致；identity.js 在原界面前运行，监听 title 变化并恢复固定名称，进入或切换会话时不显示会话内容。应用内会话名称不受影响。
- 修改标题后重启宿主并刷新网页生效；只修改标题不需要重新压缩静态资源。首次更新本补丁仍由原准备流程自动生成 identity.js 和图标缓存。移除该变量恢复默认标题。

## 2026-10-13 · httpFetch 流式 RPC 转发修复

- 在 rpc-client.mjs 中为原 App 的 httpFetch 服务增加显式 RpcTarget，转发 fetch/cancel；其他服务继续使用既有路径。解决原服务 stub 跨两个 capnweb 会话直接转发 Response 时触发的 `owned payload shouldn't contain raw ReadableStreams`。
- 返回带流的 Response 时逐块读取并重新导出本地 ReadableStream，保留 status/statusText/headers；不等待整个正文下载、不将正文整体缓存到内存。上游结果及 RPC 调用引用保留到 EOF、错误、取消或断线后释放。
- cancel 按原请求 ID 转发，并终止本地等待/读取；关闭适配器时清理活动请求与服务引用。沿用原 App 的消费约定：Cxn 包装器在正文完成/取消时调用 httpFetch.cancel 并 dispose 返回结果。关闭 WebSocket 时原 relay 仍负责关闭宿主侧 RPC 端口。
- 没有禁用 Statsig、修改配置值或提高其超时，也没有修改 capnweb 依赖版本。运行旧版本时若没有 httpFetch 服务，不安装这个适配器。
- 按原命令重启服务并刷新页面即可自动生成新副本及静态资源版本。实际 Statsig 请求与首屏时间由使用者验证；若仍出现超时，需要继续检查宿主到上游的网络路径。

## 2026-10-13 · 宿主预热、跨浏览器连接复用与启动日志

- 默认 minimal 模式现在在服务器启动阶段建立一个原生 App-host RPC 会话，取得服务集合，等待原生 startup.whenReady 并读取 appInfo，完成后才发布 bootstrap snapshot。浏览器未连接时服务集合也保留；后续连接借用同一集合，不再创建和注册新的原生 AppHost。
- 每个浏览器仍有独立 RPC 会话、httpFetch 请求和回调。关闭浏览器会释放这些对象，保留宿主连接与服务。宿主回调路由到当前连接，下载/更新的最新状态以有界快照补发；不重放操作、不代替用户审批。原生连接失效会撤销 ready 状态并明确提示重启。
- `full` 仍是原桌面生命周期兼容模式，沿用旧连接路径。若之前设置了 `CHATGPT_WEB_HOST_RENDERER=full`，要使用本次预热复用请改成 `minimal` 或删除该覆盖值。
- `/bridge/status` 增加 persistentHost、browserConnections、nativeHostConnections。新启动的 minimal 服务在多次浏览器连接后，browserConnections 增加而 nativeHostConnections 应保持 1；原生 renderer 重载/服务重启属于新的生命周期。首次冷启动 bootstrap 等待上限为 180 秒，正常热连接不额外等待该期限。
- 这复用了宿主服务初始化，不是把浏览器 React/JavaScript 实例跨设备保存。浏览器仍需执行界面代码、读取当前业务状态；完整首屏性能需要在目标服务器验收。
- 启动输出默认 `CHATGPT_WEB_LOG_LEVEL=normal`：终端显示启动、预热、就绪、访问地址，以及去重后的可处理错误；可选远程控制未登录、GCM 注册和运行时弃用/监听器提示保留在详细日志。未知运行错误和异常退出仍提示，不按 failed 字样一律丢弃。
- 原始 stdout/stderr 保存到 `.logs/host.log`，权限 0600，20 MiB 轮转，保留 3 个历史文件。`CHATGPT_WEB_LOG_LEVEL=debug` 同时向终端输出原始日志；排障时可查看该文件。原始日志可能包含账号/会话信息及登录链接，不应未经脱敏对外发布。
- 启动器保持单实例锁、子进程退出码，并将 Ctrl-C/SIGTERM 传给自己启动的进程组。没有启用新服务，也没有修改机器上的 nginx 或 systemd 配置。
- 若需要脱离终端常驻，可使用 `deploy/chatgpt-web.service` 用户服务模板：把 WorkingDirectory 改为实际仓库路径，将原域名/认证/标题等变量写入 `~/.config/chatgpt-web.env`（权限 600），首次先手动运行 `scripts/start.sh --setup-only` 完成准备，然后安装到 `~/.config/systemd/user/` 并执行 `systemctl --user daemon-reload`、`systemctl --user enable --now chatgpt-web.service`。用户服务无需登录就随机器启动还取决于该用户的 linger 设置，由服务器管理员按部署方式配置。已有 Docker 等进程托管可继续使用。
- 生效：按原配置重新启动一次。若回退代码，同样停止服务后重启，准备流程会根据补丁哈希重新生成副本。

## 2026-10-14 · 二进制桥接与浏览器配置缓存

- 修复大响应块被展开成 JSON 数字数组的问题，改用 Base64，并兼容旧二进制格式的解码。
- Statsig 的配置缓存通过 SDK 自带的 storageProvider 接口迁到 IndexedDB，解决超过 localStorage 配额后每次重新初始化的问题。最多缓存 4 项、约 16 MiB；SDK 关闭存储时不会打开数据库，存储故障时本页退回内存缓存。账号和配置更新规则由原 SDK 保留。
- 官方 App 升级后需验证配置工厂的注入位置；找不到唯一匹配会明确停止资源准备。没有修改原始安装包或配置开关值。
- 按原命令重启服务会重新准备资源，首次打开建立缓存。完整首屏和全新浏览器仍有初始化开销，详见 [调查与复测](STARTUP_ANALYSIS.md)。

## 2026-10-14 · 继续减少重复初始化

- 工具校验改为分块读取，并在常驻宿主内缓存最多 128 个文件摘要。每次仍检查文件身份、大小和修改时间；修改、替换或读取失败会重新校验，不跳过原来的安装完整性比较。缓存不保存文件正文。
- 新浏览器可通过原 SDK 的 bootstrap 接口使用宿主当前配置。要求 SDK key 与完整身份一致，配置在 10 分钟内且原 SDK 未关闭存储；首屏完成后再刷新。不同账号、设备身份、语言、版本、会话或过期配置仍走正常初始化。
- 每次打开页面读取当前共享状态和侧栏快照；侧栏直接使用原版 IPC，绕过隐藏窗口 preload 的永久缓存。读取失败会等待宿主恢复，不返回旧快照冒充当前状态。
- 网页不再启用 Electron Sentry IPC 通道，消除 `sentry-ipc://` 的无效请求；其他错误仍正常报告。原生宿主的上报设置不经过网页适配器。
- 按原命令重启一次即可生效。官方 App 升级后同时验证 SDK 工厂和运行时摘要函数的唯一匹配；不兼容时会在准备阶段明确报错。完整首屏改善有限，实际数据与限制见 [启动调查](STARTUP_ANALYSIS.md)。

## 2026-10-14 · 内置浏览器原生 WebView 承载

- 根因：原前端在普通浏览器中创建的 `<webview>` 只是 HTML 元素，不会触发 Electron 的 `will-attach-webview` / `did-attach-webview`。原生标签记录虽然存在，工具仍会在 15 秒后报告 `Timed out waiting for the Browser webview to attach`。
- 精简常驻 renderer 新增 `bridge/browser-host.mjs`，按需创建真正的 Electron WebView。继续通过原版 `browserHost` 的注册、会话隔离、页面持久化、权限和 preload；不替换浏览器控制工具，不修改能力开关。
- 将网页端注册请求映射到稳定的宿主 renderer 身份。同一页面在网页断线、刷新或换浏览器后复用；原生关闭/回收请求销毁对应 guest 并回执。浏览器工具的后台激活事件也能创建 guest，不依赖前端 React 挂载。
- 保持独立的浏览器截图尺寸；捕获尺寸优先于前端面板大小。只加载小型承载模块，正常聊天不启动额外 WebView，也不恢复完整宿主 UI。
- `prepare.py` 打包模块并核对原版注册协议标记；只调整宿主空白 HTML 的样式/初始 frame CSP，保留原生 guest 的安全设置。
- 生效方式：用原方式重启服务，启动脚本会自动重建准备副本，然后刷新网页。此次修改没有重启正式宿主，避免中断其持有的任务。
- 范围：修复原生浏览器工具所需的页面承载。普通网页内嵌面板的实时画面和鼠标/键盘转发尚未实现，不能把原生工具读取/截图通过等同于网页面板支持直接操作。

## 2026-10-14 · 手动接管浏览器连接

- 保持一个活动浏览器。新页面先读取已认证的 /bridge/status；若已有设备连接，暂停启动倒计时并显示“接管连接”，只在明确点击后发起接管。
- 新增 connections.cjs 为活动连接分配随机标识。WebSocket 接管参数必须匹配用户确认时的连接；两个页面同时确认时，过期确认返回冲突并重新询问，不会无提示挤掉刚接入的设备。原认证和 Origin 校验继续生效。
- 接管只在新 WebSocket 握手成功后执行。旧连接收到专用 4001 关闭码，页面显示“连接已被其他设备接管”，不自动重连；旧传输超时未关闭时强制释放。
- 先释放旧连接拥有的选择器、未保留上传、MessagePort 和订阅，再接入新连接；旧连接后到的 close 不会清理新连接。不发送停止会话/任务的指令，继续复用常驻原生服务。
- 中继的 RPC、MessagePort、worker 和可识别的 fetch 响应带连接归属，过滤旧连接延迟回复；下载完成通知保留发起者标识，不投递给新页面。确认可能停留很久，接入后重新读取当前侧栏与共享状态。
- 未发送草稿、未完成文件选择和上传不跨设备迁移。共享会话可在新页面继续查看。
- 接管模块随 prepare.py 打包；重启服务后生效。不修改 README，不进行 Docker 或网页交互测试，未重启正式服务。

## 2026-10-14 · 适配层弹窗关闭与非致命加载提示

- 启动进度、加载失败与接管确认提示增加“关闭”。关闭仅隐藏提示，不刷新页面；关闭接管确认会取消尚未执行的接管。关闭后本次启动的提示不随阶段更新重新弹出。
- 阶段计时器与全局前端异常改为可关闭的诊断提示，不再触发启动失败事件并切断已建立的连接。后续收到真实内容就绪信号仍正常完成启动；明确的资源下载、握手及连接错误继续保留失败处理。
- 宿主机文件夹、附件、复制确认与保存窗口增加右上角关闭按钮，沿用取消语义。下载就绪提示保留原关闭按钮；上传提示新增关闭，当前拖入任务的后续进度不会将其重新显示。
- 文件夹取消先关闭本地窗口，再异步通知宿主，避免网络无响应时无法关闭。附件正在提交时允许隐藏窗口，等待原提交结果；提交失败再清理遗留上传，避免误删正在附加的文件。
- 生效：按原方式重启服务以重新准备运行副本，然后刷新网页。本轮未重启正式服务、未更新 README、未测试 Docker 或网页交互。
