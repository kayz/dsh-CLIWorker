# Task 030 — 发布门禁与全流程完整性：baseline 来源、real-smoke 映射、豁免单列、skip 不算通过、追踪全部 covered

## 目标

来自 Blueprint 任务图 T-030（M5）。给定 CI 产物、smoke 报告、AC 索引、追踪分片与豁免文件，发布门禁能对每条 AC 判出「放行 / 阻断 / 豁免」并给出可核对理由：baseline 只来自 AC 索引；CI 基线按 OS 取 `files-executed.json` 与 reporter 结果；real-smoke 基线只认 `mode:'real'`、`redacted:true`、版本等于 `package.json` 且报告中声明该 AC 的步骤为 pass；dry-run 报告永远不满足 real-smoke；豁免文件里版本匹配的 real-smoke AC 单列为 waived（不算 pass），对非 real-smoke AC 的豁免条目直接阻断；skip 从不折算为 pass，有 planned 的 AC 阻断，real 报告缺失且无豁免时阻断，mandatory 冒烟步骤为 skip 时阻断。全流程步骤集合必须完整且顺序正确，`introduced_by` 与产出任务一致，整条流程在同一哨兵下 leak-scan 0 命中、令牌只出现在 env。交付：
- `scripts/release-gate.mjs`
- `release/waivers.json`（初始为空列表）
- `test/unit/release-gate.test.mjs`、`test/fixtures/release-gate/**`
- `test/integration/flow-complete.test.mjs`

## 约束

- 只允许写入以下路径（write_scope，来自 task-graph）：
  - `scripts/release-gate.mjs`
  - `release/**`
  - `test/unit/release-gate.test.mjs`
  - `test/fixtures/release-gate/**`
  - `test/integration/flow-complete.test.mjs`
  - `test/traceability/T-030.json`
- 仓库级硬约束：不得修改 `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`；新增 CLI 命令一律通过 `export const route = { cmd, sub }` 自注册（本任务不新增命令）。
- `contracts/spec/ac-index.json`、`contracts/registry.snapshot.json`、`test/flows/steps/**`、其他任务的追踪分片与新 `.github/workflows/**` 只读；本任务只聚合与判定，不改产出物。
- 验收必须能被 `node scripts/check-acceptance.mjs` 通过（`## AC-0xx` 小节 + 可执行命令 + `<AC-id> OK` 哨兵）。
- `release/waivers.json` 初始必须为空；不得为了让门禁通过而写入任何豁免条目，豁免只能由人审批后新增。
- 门禁必须离线可运行（不联网、不读 CI 服务），输入全部来自命令行给定的目录与文件；缺文件要显式阻断而不是静默通过。
- 所有阻断规则都要有夹具覆盖；不要用「警告」代替非 0 退出，也不要把 skip、planned、waived 混同为 pass。
- 零第三方运行时依赖，Node 20+ / ESM；不改 `.collab/blueprint/**`、其他任务目录；`acceptance.md` 由 design 阶段产出。

## 建议验收方向

由 designer 决定命令形态，以下是必须成立的可观察结论（AC 号与层级取自任务图）。
- AC-070（levels: unit）：夹具逐条证明——全部通过时放行；任一 fail 阻断；某条 AC 在索引声明的 baseline 上只有 skip 时阻断；CI 基线按 OS 取 `files-executed.json` 与 reporter 结果；real-smoke 基线只认 `mode:'real'`、`redacted:true`、版本等于 package 版本的报告中声明该 AC 的 pass 步骤，dry-run 报告不能满足；`release/waivers.json` 中版本匹配的 real-smoke AC 单列为 waived，对非 real-smoke AC 的豁免条目导致阻断；mandatory 冒烟步骤为 skip 时阻断；存在 planned 的 AC 时阻断；real 报告缺失且无豁免时阻断。
- AC-071（levels: integration）：flows 发现的步骤集合恰为 auth、doctor、discover、enumerate、probe、select、run、http-select、http-admin，每个步骤的 `introduced_by` 与产出任务一致，整条流程在同一个哨兵下 leak-scan 0 命中，令牌只出现在 env 中。
- M5 收口：属主里程碑 ≤ M5 的 AC 全部 covered 且在完整运行中通过，11 条已登记缺陷都具备 `[fixed]` 部分（由既有里程碑门检查，本任务不重复实现规则）。

## 非目标

- 不实现冒烟本身（T-029）、不改 AC 索引与追踪分片的属主规则（T-001）、不写 CI 工作流。
- 不发布 npm 包、不做签名/供应链校验、不做性能门禁（p95 只报告不阻断）。
- 不修改 `test/flows/steps/**` 与 traceability 分片来让门禁通过。

## 验收格式（生成 acceptance.md 时必须遵守，否则 CI 解析失败）

- 每个 AC 一个二级标题：`## AC-<三位数字> <标题>`；**同一 AC 的多条检查放进同一小节**，不要重复同一个 id
- 小节内必须包含可执行命令：`- 命令:` 行，或 ```pwsh 代码块
- 命令成功时必须在 stdout 打印 `<AC-id> OK` 作为哨兵，runner 按此判定通过
- 判据只断言可观察结果（退出码 / stdout 子串 / 文件状态），不要断言测试标题、函数名、行号
- 每条任务额外保留一条回归门禁：`node --test "test/unit/*.test.mjs"` 全绿

自检：`node scripts/check-acceptance.mjs .collab/tasks/030/acceptance.md`
