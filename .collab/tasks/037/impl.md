# Task 037 实现说明

在 discovery 规则中逐项声明 11 个 CLI 和统一的版本探针参数。扫描时 Windows 的未知候选模式同时匹配去掉可执行文件后缀的名称，以支持 `*-cli` 匹配 `.cmd` 等文件。缓存复用前核对当前候选的 id 和识别状态；历史条目不再因过时的识别状态进入可发现集合。保留现有 inventory/v1 字段、保守认证状态、探针证据及历史处理。

新增 AC-080 集成测试及合成夹具，通过真实 CLI 子进程和受控上下文检查 11 项识别、契约、版本证据、未知候选、缓存、消失处理和平台扫描行为。临时文件在系统临时目录创建并清理。

自测结果：AC-080 测试 4 项通过；验收中的内存契约及 AC-080 筛选运行均通过；既有 discovery 集成测试 16 项通过；`node scripts/check-no-model-table.mjs` 通过。`node --test "test/unit/*.test.mjs"` 执行 532 项，其中 526 通过、5 失败、1 跳过；5 项均为 AC-070 release-gate 的 `index.count`，跳过项需要 PowerShell 7。当前环境找不到 `pwsh`，故指定的 PowerShell 7 check-fast 命令无法启动；直接运行 `node scripts/check-fast.mjs` 时，前面的检查通过，但 `check-pack.mjs` 中 `npm pack` 以 4294963248 退出，完整门禁未通过。单元测试中的既有测试还间接调用了 git，未直接运行 git 命令。
