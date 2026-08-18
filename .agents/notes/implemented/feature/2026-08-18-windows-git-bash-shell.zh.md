# Agent Note：Windows Git Bash shell 栈

Status: implemented

[English](2026-08-18-windows-git-bash-shell.md) | 中文

## 问题

交付 profile 在 Windows 上禁用 `tool-bash`，改为暴露独立的 PowerShell 方言。编码提示词与既有自动化经常生成 Bash 语法，因此即使 Git for Windows 已提供兼容的 Bash 可执行文件，Git pipeline 等原本可移植的命令也无法在 Windows 上使用同一工具约定。`dsh-bash-local` 还硬编码了裸 `bash` 命令，从不解析 Git for Windows 安装位置。

## 决策

交付的 base 与 agent preset 在所有平台暴露 Bash 执行器和 `bash` 工具。PowerShell 执行器与工具仍作为可用 package 保留，但在交付组合中禁用；部署可通过自己的 patch 层选择它们。

`dsh-bash-local` 拥有 Bash 可执行文件解析。在 Windows 上，它依次解析显式 `bashPath`、`ProgramFiles` 与 `ProgramFiles(x86)` 下的 Git for Windows，然后解析 PATH 条目中的 `bash.exe`。找不到 Bash 时在执行器激活阶段失败，而不是等到模型第一次调用工具。其他平台仍使用裸 `bash`。沙盒执行器现在隔离本地执行器选定的精确 argv，不再自行重建 `['bash', '-c', command]`，因此 Windows Git Bash 与非隔离执行共享同一可执行文件事实。

这不宣称 Git Bash 具有 POSIX 进程组语义。普通子进程的进程树终止仍归 `dsh-subprocess-local` 所有，它在 Windows 上使用 `taskkill /T /F`；Bash 提供命令解析与 Unix 命令行工具，而 Bash 内可见路径遵循其 MSYS 约定。

Minimal preset 使用 persistent Bash terminal，而不是普通的单次执行器。在 Tauri desktop 部署中，`ctx.subprocess.spawnTerminal()` 会选择私有 Rust terminal transport，而不加载 `node-pty`：Tauri 进程创建 ConPTY、启动 Git Bash、通过每次启动认证的 loopback channel 传输 terminal byte、处理 resize 与 Ctrl-C，并报告退出。Cordis 仍拥有 terminal readiness、sandbox policy、approval 和模型可见工具约定。非 desktop 部署保留既有 subprocess provider 路径。

## 备选方案

**保持 PowerShell 为 Windows 默认值，并让模型翻译命令。**否决：这会保留两种模型可见方言，使 Bash 密集型编码流程继续依赖平台。

**在 bundle patch 中解析 Bash。**否决：可执行文件发现属于真正 spawn 它的执行器，还必须覆盖直接消费方，并需要类型化配置覆盖。

**执行 `where bash.exe` 并采用第一项。**否决：Windows 应用执行别名与旧版 WSL `bash.exe` 可能排在 Git Bash 前面。先检查确定性的 Git 安装根目录，再检查 PATH。

## 后果

编码 agent 提示词与自动化在受支持宿主上使用同一 Bash 工具约定，Windows 安装获得确定性的 Git Bash 路径和显式覆盖。偏好 PowerShell 的部署必须通过组合主动选择。Git Bash 保留 MSYS 路径约定，Windows 进程树行为仍不同于 POSIX 进程组。

Desktop persistent-terminal 路径不再依赖 Bun 对 `node-pty` 的兼容性。当前 Rust 实现是已实现的开发 checkpoint，而不是最终的进程归属保证：release closure 仍需要 Windows Job Object 归属、完整后代核算、严格 signal 语义、protocol backpressure 和断线 teardown 测试。

## 验证

执行器 suite 覆盖显式选择、非 Windows 行为、Git for Windows 优先级、PATH 候选输入和找不到时直接失败。既有真实执行器与工具集成 suite 覆盖命令输出、Git 兼容进程执行、取消、后台任务和 sandbox handoff。base bundle 测试固定交付组合中 Bash 启用、PowerShell 禁用。

Desktop Rust suite 会打开真实 Windows ConPTY、启动 Git for Windows Bash、等待 transport、写入 `printf 'rust-conpty-ok\\n'`、观察输出并终止 terminal。手工验收还恢复了一个既有 minimal-preset session，并在 Host 持续运行于 Bun 时成功执行其 persistent Bash 命令。
