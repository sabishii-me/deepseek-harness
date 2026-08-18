# `@deepseek-ai/dsh-base`

[English](README.md) | 中文

以 profile 组合包形式交付的共享 dsh 核心：[`cordis.patch.yml`](cordis.patch.yml) 在空的 profile 根之上插入全部基础插件行——模型适配器、共享的 [`agent-default-model`](../../core/agent-default-model/README.md) 选择、工具、持久化、策略、settings／credentials、遥测与宿主级 subagent provider——作为每个 profile 的 `dsh.profile.bundles` 列表中的第一层。这个 bundle 既不依赖也不挂载可选的 Codex 与 Claude Code provider；选择产品集成的 Profile 会安装目标 provider 并在 host plane（宿主平面）挂载一次，Agent Preset 则决定自己的 agent 是否获得对应的面向模型委派工具。后续的组合包层（例如 [`dsh-web-app`](../web-app/README.md)）和用户 profile 的 `cordis.patch.yml` 按 id 覆盖这些行；patch 会替换目标行的整个 `config`，因此模式专属的值放在各模式组合包中，而不是这里。该包没有运行时 API；profile 组合器通过 manifest（元数据清单）的 `dsh.bundle.patch` 字段解析 patch，绝不通过代码。

patch 在所有平台交付 Bash 栈：`bash-sandbox`/`tool-bash` 保持启用，其 `pwsh-sandbox`/`tool-pwsh` 孪生行仍然可用但默认禁用，部署可通过后续 patch 选择 PowerShell。在 Windows 上，`dsh-bash-local` 解析 Git for Windows 或显式配置的 Bash 可执行文件，sandbox provider 再通过 Windows ACL 受限令牌 runner（`dsh-sandbox-local` 的 win32 链 → `@deepseek-ai/dsh-sandbox-windows-acl`）隔离它。权限面在各平台保持一致：`sandbox`/`sandbox-policy`、权限切换、approval 与 `fs-sandbox` 均保持启用。

行集合及其设计依据以行内注释写在 patch 文件里；[生成的组合图](../../../apps/cli/composition.md)负责渲染它。

## 模型体验

通过插入的行间接产生影响：该组合包选定了随发行版交付的无 persona 提示词基座、工具集合与 DeepSeek 适配器，供各模式组合包进一步特化；它自身不贡献任何模型可见文本。

#### KV Cache 影响

无直接影响；每条插入行的影响由其所属的包负责。

## 已知限制与暂缓事项

- **patch 会替换整行 `config`**：profile 覆盖必须重述该行需要保留的每个字段；不存在深度合并层。
- **Windows 的临时目录授权是按会话的私有子目录**——`workspace-write` 把写入限制在工作区与会话自己的 temp 子目录（`<temp>\dsh-<hash>`，受限子进程的 TMP/TEMP 被改写）；`read-only` 不授予任何临时目录写入权限。见 `@deepseek-ai/dsh-sandbox-windows-acl`。
