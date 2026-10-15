# 实验性 Shisa 供应商

[English](README.md) | 中文

## 使用方式

将本插件与 DSH authorization、credentials、LLM 和 Typert 服务一起挂载；挂载 shisa-ui 后，可在浏览器 Settings → Models → Shisa 中登录。两个包均不依赖 Jouzu。真实设备授权使用 client_id jouzu，显示批准地址和用户码，并先存储授权再确认领取。未确认领取仍为错误；重启时先尝试确认已有授权，再加载模型。取消会停止轮询。密钥只保留在 Host。

## 模型与凭据

授权后，插件请求返回的 model_catalog_url，将模型 offerings 注册为 shisa 路由，使用 PiAiAdapter 和返回的 openai_base_url。请求解析已保存授权，不依赖环境中的其他凭据。目录及请求失败会报告；目录不可用时不编造模型。初始集成使用文本输入和 OpenAI Chat Completions；供应商专属能力元数据需要进一步验证。

插件通过 SHISA_API_KEY 凭据引用向显式配置的外部消费者提供 API key。Jouzu 可为其子进程解析该引用；供应商认证不选择 Agent 预设。Jouzu 自动消费 DSH 所有的供应商凭据仍需通过通用供应商接口接入。凭据引用变化会终止绑定该凭据的进程，绝不静默重启或恢复。退出登录先请求服务端撤销，仅在确认后清除本地凭据；撤销失败时保留凭据供重试。

## 配置

gateway 默认为 https://gateway.shisa.ai requestTimeoutMs 默认为 30000，maxResponseBytes 默认为 1048576。clientVersion 标识 DSH 集成，client_id 保持 jouzu。网关地址必须使用 HTTPS，不含用户凭据、查询或片段。安装身份只生成一次并保存在独立 DSH 凭据记录中。绝不修改 Jouzu 安装文件或 auth.json。

## 模型体验

授权和目录发现不添加提示词。模型请求复用现有 pi-ai 适配器的流、工具及用量转换。API key 和 link token 不进入 Session 事件或工具输出。

## 已知限制与后续工作

已在真实浏览器验证设备码发放及取消，未批准账号。用户批准、已认证目录兼容性及真实模型推理仍需账号参与验收。返回的 HTTPS 服务端点按已配置 Shisa 网关的委托信任。授权记录与导出的凭据引用分两次存储；引用发布失败会报告，不会认为 Jouzu 已就绪。已有 Jouzu 进程不自动获取新授权。自定义部署网关需要对应的 Jouzu 目录配置。跨标签页授权由 Host 共享；关闭账号视图不会取消授权，需要显式点击取消。

## 官方包预览版

本插件在隔离的 LLM/authorization 作用域中组合已发布的 pi-ai 插件，通过公开 LLM 服务注册适配器，不导入内部辅助函数、不要求增加宿主导出。Models 目录和设备授权仍由 Shisa 插件管理。更换账号前须退出登录。当前预览针对官方 DSH 0.2.1-alpha.2 验证，不代表 latest 标签兼容性。

## Independent authorization and model discovery

授权会提交收到的凭据并立即报告已登录。组织元数据、语音端点与模型端点不是登录前提。模型发现以 `catalogPhase`/`catalogError` 独立运行；端点安全检查在访问模型之前发生。`refreshModels` 重试失败的目录而不再次授权。已存储的登录会被恢复，无需等待目录请求。回执确认失败与已保存登录分开记录。

账户 Remote 暴露一个不含密钥的目录快照（模型 ID/名称、声明的上限、委派的端点 URL 与刷新时间戳）。刷新总是获取实时目录，包括已存在某个 generation 时。候选适配器在替换注册之前构造；构造失败则保留正在服务的适配器。先前的 generation 作用域一直保留到登出/卸载，因此已准备的调用仍持有其原始适配器。此预览不支持编辑端点与模型覆盖；网关仍是权威。
