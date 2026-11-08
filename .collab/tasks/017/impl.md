# T-017 实现记录

当前未完成实现。工作树缺少 T-015 的 11 个已知 CLI 夹具及 T-016 的发现规则和公开接口；设计要求消费这些实际交付，并禁止猜测名称、执行方式和枚举策略，因此无法实现或验证 AC-041 的完整覆盖。没有将追踪状态标为 covered，也没有声称验收通过。AC-042 的检查器和测试尚未实现。

自测：运行 node scripts/run-tests.mjs --ac AC-041 和 node scripts/run-tests.mjs --ac AC-042，均退出 1，分别报告 FAIL run.no_match AC-041 和 FAIL run.no_match AC-042。未运行 scripts/check-fast.ps1：其自动执行的 scripts/check-write-scope.mjs 会调用 git，而本任务禁止执行 git 命令。另外当前环境找不到 pwsh。

需要先提供 T-015/T-016 的实际交付，之后按设计完成枚举器及其验收；AC-042 仍需独立实现和测试。

第 1 轮续接：核对当前 lib/cli.mjs，动态路由已通过 collectRoutes 和 matchRoute 接入，与既有设计一致，无需修改分发器。当前仍无 lib/discovery、T-015 的 CLI 夹具及 T-016 追踪分片，未发现消除上述依赖缺失的交付。本轮未修改实现代码，未重复运行上轮已失败的验收命令。
