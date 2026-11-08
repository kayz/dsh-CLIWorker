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
