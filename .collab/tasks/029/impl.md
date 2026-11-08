# 实现记录

本轮补充 `scripts/smoke-real.mjs`：编排七步、报告与 AC 映射、开关检查、输出文件、临时环境、泄漏扫描和清理。dry-run 通过既有 discover、fake CLI 和 flow 步骤执行；real 分支调用系统 WSL，比较发行版集合并在发行版内运行 discover。flow 步骤在子进程中执行，并对超时进行处理。

`test/smoke/` 增加端到端、错误报告、开关、重复运行、写入失败、步骤失败、超时和泄漏 canary 检查；补充发布清单和 T-029 追踪分片。追踪状态表示测试覆盖登记，不是 real-smoke 基线证据。

已运行：

- `node --test test/smoke/smoke-dry-run.test.mjs test/smoke/wsl-discover.test.mjs`：7 通过。
- `node --test test/unit/*.test.mjs`：485 通过、1 跳过、0 失败。
- `node scripts/check-acceptance.mjs .collab/tasks/029/acceptance.md` 和 `node scripts/check-traceability.mjs`：通过。
- `node scripts/check-fast.mjs`：前置检查运行至 `check-pack.mjs`；该步的 `npm pack` 返回 4294963248，快速检查未通过。PowerShell 7 的 `pwsh` 不可用，未能执行指定的 `scripts/check-fast.ps1` 入口。

尚不能声明任务验收完成：没有执行维护者 Windows/WSL 真机验收，也未证明 WSL 超时后发行版内进程以及 Windows 进程树在 `taskkill` 不可用时均被回收；扫描实际采集量和发行版集合变化的完整失败样本仍需补充。默认夹具通过不构成 AC-038 的 real-smoke 证据。
