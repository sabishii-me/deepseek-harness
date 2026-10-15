# 实验性 Jouzu 后端

[English](README.md) | 中文

## Status

开发中：本包提供可选的 `ctx.jouzuBackend` Cordis 服务，用于长驻的原生 Jouzu RPC 会话。独立预览 UI 已移除。当 Agent 与投影服务已挂载时，本插件向既有生命周期 factory 注册 `jouzu` Agent 驱动。既有预设菜单可创建 Jouzu 支撑的 Session；原生 DSH 仍是默认值。DSH 默认设置不变。目标：官方 Jouzu 0.1.18 / 随附 Pi 0.87.1。

## Configuration and consumption

与 subprocess 提供方一起挂载本服务。`argv` 是必需的可执行前缀，例如 `["node", "/absolute/path/to/jouzu/dist/cli.js"]`；服务会追加 `pi --mode rpc` 以及可选的 `--session` 文件。Windows 上直接使用 npm `.cmd` 启动器不受支持；请显式选择 Node 与 CLI 入口。原生 Jouzu 设置、扩展、认证与权限仍是权威；DSH 权限不支配 Jouzu 的工具。显式 `env` 条目扩展 subprocess 服务的已清理环境。

上限默认为每条 JSON 记录 8 MiB、32 个待确认命令、30 秒确认期限、6 秒 EOF 宽限与 3 秒子进程终止宽限。它们都是插件配置字段。确认期限不是轮次超时：超时会终止会话，因为命令是否被接受可能未知，且绝不重试提示词。

宿主消费方以绝对路径与同步 `event` / `failure` 回调调用 `open({ cwd, sessionFile? }, sink)`。sink 在启动前安装。返回的 conversation 暴露初次成功的 `get_state` 响应、`request(command, fields?)`、`respond(extensionResponse)`，以及幂等的异步 `dispose()`。命令成功仅表示已确认。远端拒绝后传输仍可用；输出格式错误、缺少响应、流失败或事件消费方抛错会停止它。释放会关闭准入、请求 EOF，再升级并加入子进程区间。插件卸载会释放其拥有的 conversation。

## Jouzu feature presentation

原生通知、带键状态条目、文本 widget 与最新 Flow 上下文汇入一个有界的 Session 投影，供可选的 jouzu-ui dock 消费。展示快照使用可忽略的 plugin:jouzu-backend/ui 记录，绝不进入模型历史。uiEntryLimit 默认保留 128 个状态/widget 键；uiTextLimit 默认每个快照 262144 个 JSON 字符。非法或超限展示会让原生事件消费方失败，而不是静默丢弃状态。终端组件工厂仍不受 Pi RPC 支持。

inspectFlow 只读取已在运行的进程，校验 flow 扩展命令，并提交官方无参数的 /flow 命令。它在原生轮次活动期间仍可用，共享并发的检查请求，且不获取维护窗口、不写历史检查点。它不发送模型输入、不重开已存的原生会话、不恢复自动化、不取消任务。原生 select/input/editor/confirm 对话框使用既有 DSH 问题应答器；空闲对话框现在跟随进程生命周期，而不是已结束的轮次。前台中止与后台取消仍然不同。

## Model Experience

本插件只发送调用方提供的原生命令。提示词构造、模型令牌与 KV 缓存行为由 Jouzu 负责。传输层不添加任何 DSH 模型工具、提示词或模型调用。

## Known Limitations and Deferred Work

- 复用既有 DSH 转录与可选 Session dock；不附带独立预览面板。
- 原生对话框与文本展示已集成；后台任务专用控件与组件 widget 仍不可用。
- 调用方必须自行解释原生命令结果并保持原生会话身份。仅有文件参数不能证明成功恢复了目标会话。
- Schema 校验目前覆盖 RPC 信封，而非每个原生事件或命令载荷。不要把任意命令暴露为未认证的浏览器端点。
- 包单元测试用模拟对端覆盖分帧与生命周期；真实 Loader/profile 组装与录制的前端快照仍是发布前必需项。
- 独立的官方发行版冒烟验证覆盖无密钥启动／get_state／EOF，而非本插件对真实模型或后台任务的运行。

## Native Agent integration in progress

`jouzu` 驱动消费共享的持久 inbox，并发出标准 user、assistant、tool、turn 与 step Session 事件，以及既有实时 assistant 流。它不创建独立聊天控制器。factory 保留 Session 发布与持久化所有权。`agent/backend` 记录不可变的执行所有权；`jouzu/binding` 在派发提示词前记录原生 id 与文件。重新附加会校验 Jouzu 返回的原生身份并拒绝不匹配。持久绑定不是对账协议：宿主崩溃后遗漏的原生输出仍是未解决的恢复限制。

驱动目前接受纯文本的普通排队消息。转向与注入的 DSH 上下文显式拒绝。原生对话框与自主轮次现在使用下文描述的标准问题与轮次生命周期。这些限制使本插件在普通 Jouzu 使用上仍不完整；不要把它当作可投产的可选后端暴露。工具与消息转换仍需穷尽的原生 schema／usage／error 覆盖、录制的前端快照，以及真实进程的恢复／取消测试。

## Browser-verified development path

本地 overlay `.artifacts/jouzu/native.patch.yml` 挂载后端与一个空工具、`backend: jouzu` 的 Jouzu 预设。它是机器本地的，使用在此验证过的官方 0.1.18 安装。以 `pnpm dsh --profile web --patch .artifacts/jouzu/native.patch.yml --port 3000` 启动，然后从常规新建会话预设菜单选择 Jouzu。复用既有 composer、Chat、Trajectory、Session 列表与 Stop 控件；不挂载预览面板或额外聊天 API。

一次真实 Edge 浏览器运行完成了两次真实模型回复，重载了其历史，提交了后续原生 Bash 请求，在常规工具区显示运行中的 Bash 工具，并用 Stop generating 将其停止。模��控件现在使用后端自有的目录与选择操作；原生 DSH 权限选择器对外部后端 Session 仍然隐藏。这些观察不覆盖宿主崩溃对账、完整原生任务面板、所有工具渲染器或每个不受支持的控件。原生斜杠命令目前在准入前即拒绝；对话框请求与自主轮次显式失败，而不是静默完成。后端是实验性的，未达到完整 Jouzu 功能对等。

## Session model controls

标准 Session 模型 UI 通过 Agent 所有的模型控件读取 Jouzu 原生目录。显式加载目录可以启动原生进程而不提交提示词；重连不会自动请求外部目录。保留原生 provider ID。原生模型缺失时保持未选择，绝不用 DSH 全局默认替换。驱动排斥并发的轮次/控制操作，校验 set_model 与 get_state 响应，为当前模型暴露 get_available_thinking_levels，并在确认变更前记录 model/selection 与原生检查点。不写入 DSH 默认设置。多命令变更失败时停止原生准入，因为先前命令可能已提交。恢复仍使用精确匹配检查点。浏览器验收与完整变更/恢复竞态覆盖仍待完成。

## Native token accounting

完成的 assistant 消息把 Jouzu 用量带入标准 usage 流块与持久 assistant 事件。原生 input、output、cache-read、cache-write 计数器保留其单位；总量是它们的安全整数和。原生 `reasoning` 仅在作为有效计数且不大于 output 时成为 `reasoningTokens`，即 output 的子集。缺失 reasoning 表示未知，不是零，也不是文本长度估计。非法聚合用量被省略。此前保存的、无用量信息的消息不回填。

## Continuations, dialogs and terminal failures

原生自定义消息按标准 user-context 消息原样保留，带 `jouzu-extension` 归属，与 Pi 对模型可见用户上下文的转换一致。它们不是人类提示词、不是 assistant 回答，也不是由 DSH 再次执行的指令。自主原生运行获取标准 DSH 轮次/状态所有权；人工追问留在既有 inbox 中直到原生结算。专用的 flow/job/task 投影仍被推迟；仅保留上下文并不实现任务取消或进度控件。

扩展 select/input/editor/confirm 请求使用既有 `userQuestions.ask()` 应答器与 composer。回复保留原生请求 id；超时、轮次取消与插件释放绝不批准。此处的确认是扩展问题，不代表 DSH 授权了 Jouzu 的执行权限。完整对话框浏览器与重启验证仍待完成。

## Execution policy admission

启动要求确切所属 Session 和 DSH sandboxPolicy。解析后的 DSH 模式具有决定权：danger-full-access 使用原始 argv，报告无约束执行；read-only 和 workspace-write 必须对完整 argv 调用 sandbox.confine。保留提供方 full/partial 分类，不升级也不通过 Jouzu 额外策略拒绝。受限模式下缺少提供方或 runner 失败绝不无约束重试。部分和无约束执行通过宿主日志报告。

命令、对话回复和事件重查启动时策略。Session sandbox/mode 改变时，即使标准输出静默也撤销原生进程。启动取消等待未发布子进程，释放时移除策略监听。此行为遵循 DSH 文件效果词汇，不增加读取、凭据或网络隔离承诺。Windows ACL 保持 partial 及其已记录限制；full-access 是既有 DSH 授权，不是新的 Jouzu 绕过开关。真实受限 runner 验证仍待完成。

## Exact-match native recovery

观察到轮次结束后，驱动将 get_entries 历史的规范 SHA-256 摘要、条目数和当前 leaf id 记录为 jouzu/checkpoint，并刷新 Session。重新打开原生绑定后，必须确认无活动/排队工作，且检查点完全匹配，才发送新提示。缺少检查点、内容改变或分支移动时拒绝提交，不自动重放提示。这不导入遗漏原生历史，也不恢复缺少检查点的旧会话。获取检查点期间发生原生事件时，不将该观察认证为检查点，后续恢复安全拒绝而非猜测。完整真实进程恢复验证仍待完成。

## Official model bridge qualification

插件内的 `session-model` 读取官方 `model/selection` 事件，为每次模型请求捕获所选路由。`model-request` 校验文本及工具调用的 OpenAI 请求子集，再转换为 DSH 消息；图片及不支持的请求字段会被拒绝，不会静默丢弃。已用未修改的独立 Jouzu 进程与官方 DSH 包验证两个模型路由及实际 Jouzu echo 工具往返。此路径尚未接到浏览器的 Jouzu factory。现有后端入口仍依赖开发版宿主 driver API，不能作为兼容官方版本的后端预览安装。

替代 factory 实现在插件内部（`external-factory.ts`）：取得官方 Session 持久化写句柄，装配尚未发布的外部 Agent，提交 setup，再进入全局注册表并发布事件。失败时释放作用域、持久化句柄和注册项；调用方或 factory 卸载时取消并等待驱动停止。`factory-router.ts` 用已有普通预设身份选择外部 factory，模型选择与执行模式分离。这些模块尚未接入包的旧入口。

## Portable preview composition

打包的 `config/jouzu.patch.yml` 使用包名而非开发源码路径。把 `DSH_JOUZU_CLI` 设为独立安装的 Jouzu `cli.js`，并把 `JOUZU_HOME` 交给后端按所属工作区推导。该目录必须在用户所选 DSH 权限模式下可写；overlay 不改变该模式。需要时另行加载 Shisa。预览会用显式新建会话执行选择器替换标准预设 UI，因此尚不提供完整预设设置/表头对等。既有草稿留在其原会话中。缺失必需设置会失败，而不是选择本地回退。所提供的 CLI 路径不是捆绑或修改过的 Pi 运行时。

模型桥接按收到顺序流式发送文本、推理与工具参数增量，等待响应背压，并在连接关闭时取消上游。它不再等待整个模型响应才返回首个文本。流中途失败会终止传输，且不发出成功完成标记。

## Tool argument stream settlement

模型桥接接受最终工具块，其完整 JSON 值与已流式发送的参数相等，即使提供方适配器规范化了空白或对象键顺序。它不发送重复的参数字节。工具身份、名称或 JSON 值发生变化仍会使请求失败。编码器回归与经由官方 LlmRuntime 的 HTTP 回归覆盖了规范化参数、终端工具完成与用量投递。

## DSH tool bridge implementation

`tool-bridge.ts` 暴露一个已认证的环回目录与执行器，绑定到单个 DSH Agent。显式准入清单与当前 Agent 作用域内的注册视图共同约束发现与执行。调用经公开 DSH 工具管线运行并带发起 Agent 归属；HTTP 断开取消执行，释放会排空已准入工作。重复调用 id 被拒绝而非重放。桥接本身不发出重复的 Session 工具回执：原生 Jouzu 执行事件仍是转录来源。

`tool-extension.ts` 是独立加载的公开 Pi 扩展。JouzuAgent 启动时会打开其作用域内的工具桥，后端启动则与模型桥一起加载该扩展。准入会快照当前可见的 DSH 名称；执行时重新校验可见性。扩展以 `dsh_` 别名注册被准入的工具，不触碰既有 Pi 工具，转发取消，并保留错误标志与展示元数据。它把结束性的工具结果映射为 Pi 终止。延迟文本上下文追加到原生工具结果，而不是作为独立的异步轮次提交；这改变了它从独立上下文到工具内容的角色，同时保留在原生历史与下一次模型请求中。原生工具事件仍是转录工具回执的唯一来源。目录刷新与图片/文件内容转换是后续集成工作。

一次隔离进程检查使用未修改的 Jouzu 0.2.0 与已安装的官方 DSH 包，配以确定性模型驱动：Jouzu 调用注册的 DSH 工具，官方工具管线执行一次，Jouzu 收到结果并完成下一步模型步骤。该检查独立于面向用户的安装，不在其中安装它的模型驱动。

后台观察同时接受 bg_task 与 bg_status 回执。完整的清单数组替换库存（包括空清单）；有界清单不替换。成功的 clear 移除已观察的终态任务。执行身份、开始时间与更新时间可防止过期回执回退终态或覆盖被复用的句柄。活动投影版本 4 从既有 Session 事件重建这些观察，包括抑制了完成唤醒的状态读取。

## Workspace Write interactive test mode

受限会话不再通过配置开关启用：任何受限策略（workspace-write / read-only）都自动经桥接暴露执行面，因为受限进程根本不能创建子进程（写限制令牌拒绝 CreateProcess，对 Git Bash、cmd、pwsh 与纯 node 均验证过）。可暴露的宿主工具为 `read`、`write`、`edit`、`glob`、`grep`，以及以 Jouzu 自身 `bash` 名暴露的宿主 `pwsh`。

`bg_task` 与 `subagent` 被排除，因为二者的实现会创建进程（后台任务是分离子进程；子代理是带 IPC 的 forked worker）。`schedule_prompt` 保留，因为其模型作业在进程内 AgentSession 中运行。`user_bash` 被明确拒绝，因此 shell 无法绕过桥接。

HTTP 执行器拒绝 `sandbox_permissions` 与后台参数。受限状态存放在所选工作区的 `.jouzu-dsh-state` 目录下。运行中的受限进程拒绝策略变更；请为不同模式新建会话。

Full-access Sessions 保留正常的原生工具集与既有执行路径。此边界不改变全局权限默认值，也不重写既有 Session 历史。
