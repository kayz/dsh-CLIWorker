# Task 034 - 配置明文拒载与凭据后端失败处理

## 目标

只验收 AC-033（unit、integration），以同目录 design.md 为准。brief 未给基准 commit SHA 或既有验收报告路径。本稿等待 attention.json 裁决及 T-013 真实接口补全；以下为实现完成后的验收要求，当前没有执行或通过记录。

## 约束

在仓库根 C:/git/dsh-CLIWorker/.collab/worktrees/034，使用 PowerShell 7 执行。每条命令独立运行，不依赖其他命令的产物；原生命令结束后检查 $LASTEXITCODE。每条均须同时满足退出码 0 与该条期望输出；测试缺失、零用例、失败、跳过、todo 均不能算通过。命令及测试不得访问真实 keyring、真实登录或网络。

## 建议验收方向

- 命令：`node --test --test-reporter=tap test/unit/inline-secret.test.mjs`
- 期望输出：退出码 0；TAP 汇总 tests 大于 0、pass 等于 tests、fail 0、cancelled 0、skipped 0、todo 0。实际通过的 [AC-033] 测试覆盖无 schema/v1/v2；敏感键大小写及既有分隔写法；根对象、嵌套对象、数组内对象和混合嵌套；字符串（含空串）与既有非字符串拒载；合法 SecretRef、null 占位、普通文本放行；SecretRef 旁夹带明文不能绕过；v2 secrets 字符串条目不能放行；原配置内容不变。经 loadConfig 拒载断言 code=E_CONFIG_SECRET_INLINE，并通过既有 CLI 断言退出码 3 与共享错误体，合成秘密不出现在错误、stdout 或 stderr。

- 命令：`node --test --test-reporter=tap test/integration/secret-backend-failure.test.mjs`
- 期望输出：退出码 0；TAP 汇总 tests 大于 0、pass 等于 tests、fail 0、cancelled 0、skipped 0、todo 0。实际通过的 [AC-033] 测试调用 T-013 生产后端与真实凭据状态入口，覆盖 secret-tool/security/pwsh 的注入 ENOENT、非零退出及读写失败；错误为 E_SECRET_BACKEND，共享错误体 retryable=false、retry_after=null、退出码 3；state_dir 文件名及内容前后一致，写入探针无明文写入；失败不能伪装 unset/set，正常状态仅暴露 set/unset，所有输出及错误均无合成秘密。三个平台使用模拟上下文在同一次运行中全部覆盖。依赖尚缺时必须明确失败，不能跳过、只测错误构造器或用测试自建后端替代。

- 命令：`node --test test/unit/inline-secret.test.mjs test/integration/secret-backend-failure.test.mjs`
- 期望输出：退出码 0；两个文件均实际运行，汇总 tests 大于 0、pass 等于 tests、fail 0、cancelled 0、skipped 0、todo 0；同时满足上述明文拒载、后端失败、凭据状态三项断言。这是 brief 指定的 AC-033 总验收命令。

- 命令：`node --test --test-reporter=tap test/unit/config.test.mjs test/unit/config-v2.test.mjs`
- 期望输出：退出码 0；TAP 汇总 tests 大于 0、pass 等于 tests、fail 0、cancelled 0、skipped 0、todo 0。保留现有示例拒载、E_CONFIG、内存迁移、源文件不变、state_dir 与 draft 兼容行为，不将未执行的回归视为通过。

- 命令：`pwsh -NoProfile -File scripts/check-fast.ps1`
- 期望输出：退出码 0 且输出包含 `check-fast: ok`。这是下游获授权阶段的项目完成检查；本 design 阶段禁止执行 git 或创建其他文件，因此未运行。若环境缺少 PowerShell 7、检查失败或有依赖未交付，记录为未通过，不越界修复，也不据此宣称 AC-033 已通过。
