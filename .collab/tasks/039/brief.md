# Task 039 — discover 补 flow 步骤

## 目标

`test/flows/steps/` 下有 auth/doctor/enumerate/probe/select/run/http-* 八个步骤，但**没有 discover 步骤**，因此 flow 的端到端链路不覆盖发现层。本任务补上该步骤，让 `runFlow` 真实调用 discover 并断言产物。

可观察结果：flow 跑起来时 discover 步骤被执行且通过；它产出的 `inventory.json` 与 CLI stdout 同源（`generated_at` 一致）。

## 约束

- 写域：`test/flows/steps/discover.mjs`、`test/flows/flow.test.mjs`、`test/traceability/T-039.json`
- **不要修改** `lib/` 下任何文件（本任务只补测试基础设施）
- 共享 flow fixture 是 legacy `cliworker.config/v1`；若 discover 需要 v2 配置，请参照 `test/flows/steps/enumerate.mjs` 的做法在 `flow.root` 下写自己的 v2 配置，**不要**改共享 fixture
- 不放宽既有断言

## 建议验收方向

AC-082（integration）：flow 发现并执行 discover 步骤；该步骤在 v2 配置下真实调用 CLI、断言 `cliworker.inventory/v1` 与落盘文件同源。`flow.test.mjs` 的步骤列表断言改为从磁盘派生（不写死列表）。

## 非目标

不改变 flow 的执行框架本身

## 验收格式

- 每个 AC 一个二级标题：`## AC-<三位数字> <标题>`；同一 AC 的多条检查放进同一小节
- 小节内必须包含可执行命令：`- 命令:` 行，或 ```pwsh 代码块
- 命令成功时必须在 stdout 打印 `<AC-id> OK` 作为哨兵
- 判据只断言可观察结果（退出码 / stdout 子串 / 文件状态），不要断言测试标题、函数名、行号
- 额外保留一条回归门禁：`node --test "test/unit/*.test.mjs"` 全绿

自检：`node scripts/check-acceptance.mjs .collab/tasks/<NNN>/acceptance.md`
