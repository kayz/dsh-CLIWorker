# 平台差异

Windows、macOS、Linux 和 WSL 均按配置路径隔离状态。配置路径优先取显式参数、`CLIWORKER_CONFIG`，再取 `CLIWORKER_HOME` 下的配置；默认 home 为用户目录下的 `.cliworker`。显式状态目录相对配置目录解析；否则状态目录由配置路径哈希决定。Windows 计算隔离标识前将配置路径转为小写。

Windows 可探测 WSL，设置 `discovery.wsl` 为 false 可关闭该探测。Linux 中通过 `WSL_DISTRO_NAME` 或 `/proc/version` 识别 WSL。Windows 的 Node shim 优先解析为直接运行脚本；回退执行批处理时参数必须符合安全字符限制，危险路径或参数会被拒绝。调用超时时会终止进程树。

环境变量引用只读；session 引用保存在当前上下文内存中。系统密钥后端在 Windows 使用当前用户 DPAPI 和 PowerShell 7，在 macOS 使用 `security`，在 Linux 使用 `secret-tool` 和可用的系统服务。后端不可用时返回 `E_SECRET_BACKEND`。离线夹具不代表真机验证。
