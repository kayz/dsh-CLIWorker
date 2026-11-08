本轮仍未完成 T-025，不能声明 AC-062、AC-063 或 AC-077 已完整通过。

在上轮基础上，`lib/index.js` 通过宿主 exact 注册提供真实 UI 资源，并在守卫和请求体校验后优先调用注入 handler；`lib/http/snapshot.mjs` 从目录、探测缓存、额度池和用量账本读取并投影；`lib/http/jobs.mjs` 为受保护的作业创建具体查询路由并调度现有命令；`lib/http/issues-api.mjs` 提供显式记录的合并和筛选辅助函数。UI 保持问题为首标签，缺少问题来源时明确提示；模型展示保留过期数值并显示 stale。这样接线是为了使常规读取不调用 CLI，且不把不存在的问题来源伪装成空问题列表。

已补充单元及真实入口集成测试：验证实际静态资源、loopback 与会话守卫、session 后读取快照、受控时钟下会话过期重签、作业具体路径、实例隔离，以及无历史数据时作业失败显示 unknown。测试未覆盖验收要求的全部场景。尤其作业失败当前按整体快照处理，尚未完成受影响项隔离及并发作业覆盖保护的完整验证；问题筛选和详情仅有辅助函数测试，未接入实际页面交互；来源缺失与脱敏边界、注册失败、写请求重放、资源越界等也缺少完整验收。UI fixture 与追踪分片尚未交付，不能用现有测试通过冒充完整覆盖。

自测：`node --test test/unit/ui-render.test.mjs` 退出 0（3 项）；`node --test test/integration/ui-snapshot.test.mjs` 退出 0（4 项）；两文件组合运行退出 0（7 项）。全 unit 回归退出 0（483 项通过、1 项跳过）；`node scripts/check-acceptance.mjs .collab/tasks/025/acceptance.md` 退出 0（acs=3 commands=5，warnings=0），只是格式检查。`node scripts/check-fast.mjs` 退出 1：`check-pack.mjs` 报 `npm pack failed (exit 4294963248)`，因此未运行后续步骤。上一轮称报告必然写在仓库内不准确：测试运行器默认报告目录位于系统临时目录。

本环境找不到 `pwsh`，无法按要求执行 PowerShell 7 验收块或 `scripts/check-fast.ps1`。本轮初始工具调用请求了 `pwsh`，但事后发现执行器实际使用了 Windows PowerShell 5.1；发现后改用命令解释器直接运行上述 Node 检查。上述 Node 测试退出码不替代完整验收判据。
