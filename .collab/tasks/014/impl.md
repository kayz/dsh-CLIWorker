# 实现记录

本阶段尚未完成 AC-034。新增 `test/fixtures/config/v1.json`，使用合成数据覆盖百分比、tokens、可换算和不可换算 credits、USD 及同一 provider 同时持有 credits 和 USD，供后续迁移测试使用。尚未创建人工期望数据、迁移实现、CLI 路由、测试或追踪分片；不能将夹具视为验收通过。

交班单记录上一候选没有实现产物；保留其列出的任务状态现场，未继承任何代码改动。用户禁止执行 Git 命令，因此没有执行 Git diff 或回滚。仓库中未发现 T-013 的 SecretRef 检测实现，后续实现须补足设计要求的秘密检查，不能透传明文。

`check-fast.ps1` 的检查链包含调用 Git 的 `check-write-scope.mjs`，受禁止执行 Git 命令的约束未运行。

本次保留已有合成 `v1.json` 作为后续测试输入，并新增无 schema 的合成夹具 `test/fixtures/config/v1-no-schema.json`。交班单未列出候选 #1 的实现代码，未继承其代码改动；其列出的任务状态文件保持原样。受 Git 禁令限制，无法独立核实完整工作区差异。

本次执行 acceptance.md 的 AC-034 命令，退出 1，首个失败为缺少 `test/unit/config-v2.test.mjs`；再次执行 M2 gate，AC-031 至 AC-035 仍为 planned。工具实际启动了 Windows PowerShell 5.1，且 `pwsh` 不在 PATH；首次尝试以 `utf8NoBOM` 写夹具失败，未产生文件，随后使用补丁工具创建。迁移实现、CLI 路由、人工期望数据、目标测试和追踪分片仍未完成。

本轮保留已有两份合成 v1 夹具，因为它们分别提供显式版本和无 schema 的迁移输入。交班单没有列出候选 #1 的代码变更；受 Git 命令禁令限制，未能独立核对 diff。新增 `test/unit/config-v2.test.mjs`，分别检查两种输入经公开加载器迁移为 v2、携带警告且源文件不变。这只是验收测试的起点，并未覆盖完整设计。

自测 `node --test test/unit/config-v2.test.mjs` 退出 1：两例均因加载器尚未迁移至 v2 而失败。迁移实现、CLI 路由、完整测试、期望数据及追踪分片仍未完成，AC-034 未通过。未运行 `node scripts/check-fast.mjs` 或其 PowerShell 包装：完整测试链包含 `test/unit/gitignore.test.mjs` 和 `test/contract/spec-tracked.test.mjs`，会执行用户禁止的 Git 命令；也未运行验收命令或 M2 gate，不能声称通过。

本次保留已有两份合成夹具和起步单测，以继续使用显式 v1 与无 schema 输入；交班单未列出候选 #1 的代码改动，且禁止 Git 命令，无法核实 diff。新增初步迁移模块，将模型、provider 和额度映射到 v2，加载时附加警告并提供非枚举兼容属性；接入 config migrate，使用独占创建避免覆盖输出。加载器加入初步秘密检查并避免解析错误回显内容。

自测 `node --test test/unit/config-v2.test.mjs` 两例通过；再与 config、paths、select 和 select-draft 回归一起运行共 30 例通过。上述测试不足以证明 AC-034。尚缺完整 v2 校验、完整 SecretRef 检查、从 pools 重建兼容 quotas、人工期望数据、详细迁移和 CLI 测试、追踪分片以及完整验收；当前实现不可视为完成。未运行 `node scripts/check-fast.mjs`：其检查链及完整测试会调用 Git，与用户禁止执行 Git 命令冲突；也未运行会产生额外仓库文件的 M2 gate。

本轮继续保留现场已有的迁移模块、加载器接入、CLI 路由、合成夹具与起步测试：它们提供了继续实现所需的基础。交班单没有列出候选 #1 的代码改动，禁止执行 Git，因此无法独立确认哪些文件由该候选修改，也未改动交班单列出的状态文件。

从 v2 pools 重建不可枚举的旧额度视图：单一百分比或可换算容量可供现有选模消费，多个池或不可换算余额保留未知；修正等级回退规则以与现有选模一致。增加独立池数值及未知 forecast 断言，并通过真实 CLI 检查跨目录迁移、状态目录、源文件与完整 draft 等价。

自测：配置、路径和选模回归连同当时的三条本任务测试共 31 例通过；新增 CLI 测试后本任务四例通过；`run-tests.mjs --ac AC-034` 当时发现一个文件、三例通过。M2 gate 退出 1，报告 AC-031 至 AC-035 均为 planned。没有运行 check-fast：其检查链执行 Git，与用户禁令冲突。

AC-034 仍未完成：原生 v2 的完整 schema 校验、SecretRef 完整检查、人工期望夹具、冻结映射逐项断言、各种失败分支与追踪分片等仍缺失；未运行 acceptance.md 的完整命令，不能声称验收通过。现有秘密检查未经充分验证，不应将实现用于处理真实凭据。
