# Task 028 — 文档：AgentLine 集成（只含契约与错误语义）、迁移（含语义变更与映射）、界面与会话、平台、宿主契约

## 目标

来自 Blueprint 任务图 T-028（M5）。读者只读仓库文档就能接上 CLIWorker：AgentLine 集成文档只讲 `level`、`count`、`usage`、`importance`、按顺序执行 `calls`、再申请、错误码与流程状态，不泄露内部实现词；迁移文档对注册表里每个 `semantic_change` 都有对应段落，并覆盖 `migration-map` 中 draft→v1 与 config v1→v2 的每个映射项；界面与会话、平台差异、宿主契约各自成篇。README 与 docs 中标为可运行的命令能被 `check-docs` 在夹具配置下真正跑通；README 里不再出现会被静默忽略的字段。交付：
- `README.md`、`docs/agentline-integration.md`、`docs/migration.md`、`docs/ui.md`、`docs/platforms.md`、`docs/host-contract.md`
- `scripts/check-docs.mjs`
- `test/integration/docs.test.mjs`、`test/unit/agentline-doc.test.mjs`

## 约束

- 只允许写入以下路径（write_scope，来自 task-graph）：
  - `README.md`
  - `docs/agentline-integration.md`
  - `docs/migration.md`
  - `docs/ui.md`
  - `docs/platforms.md`
  - `docs/host-contract.md`
  - `scripts/check-docs.mjs`
  - `test/integration/docs.test.mjs`
  - `test/unit/agentline-doc.test.mjs`
  - `test/traceability/T-028.json`
- 仓库级硬约束：不得修改 `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`；新增 CLI 命令一律通过 `export const route = { cmd, sub }` 自注册（本任务不新增命令）。
- 不得为了迁就文档改代码：`contracts/registry.snapshot.json`、`contracts/spec/**` 只读；文档与实现不一致时以注册表与实现为准并改文档。
- 不得修改 `package.json` 与 `contracts/**`；文档中的 `bin`、版本、路径以现状为准，不写死绝对路径。
- 验收必须能被 `node scripts/check-acceptance.mjs` 通过（`## AC-0xx` 小节 + 可执行命令 + `<AC-id> OK` 哨兵）。
- `check-no-collab`：文档与脚本不得出现 `.collab`、蓝图编号或其他仓库内部引用。
- 不得出现令牌、真实用户名、本机绝对路径；配置示例引用 `config/cliworker.example.json`，密钥只写 env/SecretRef 形式。
- 文档中每条标为可运行的命令必须能由 `check-docs` 在夹具配置与 `fake-cli` 环境下离线执行；不可运行或需要真机的片段明确标注，不要伪装成可运行。
- 零第三方运行时依赖，Node 20+ / ESM；不改 `.collab/blueprint/**`、其他任务目录；`acceptance.md` 由 design 阶段产出。

## 建议验收方向

由 designer 决定命令形态，以下是必须成立的可观察结论（AC 号与层级取自任务图）。
- AC-067（levels: integration）：`check-docs` 针对夹具配置执行 README 与 docs 中标为可运行的命令，全部成功；README 中没有会被忽略的字段（例如 `role` 这类只产生 `W_FIELD_IGNORED` 的字段不应再作为推荐写法出现）；`docs/migration.md` 为 `contracts/registry.snapshot.json` 中每个 `semantic_change` 项都有对应段落，并包含 `contracts/spec/migration-map.json` 中 draft→v1 与 config v1→v2 的每个映射项。
- AC-068（levels: unit）：`docs/agentline-integration.md` 只描述 `level`、`count`、`usage`、`importance`、按顺序执行 `calls`、再申请、错误码与流程状态；用 `contracts/agentline-forbidden.json` 的键表对它做整词扫描，0 命中。

## 非目标

- 不写发布检查清单（`docs/release-checklist.md` 属 T-029）与冒烟说明；不改 `docs/contract.md`（由 T-004 生成）。
- 不新建站点、博客、i18n 或图示资源；不做文档版本化与发布自动化。
- 不修改任何代码、命令行为、注册表或迁移映射来让文档「自洽」。

## 验收格式（生成 acceptance.md 时必须遵守，否则 CI 解析失败）

- 每个 AC 一个二级标题：`## AC-<三位数字> <标题>`；**同一 AC 的多条检查放进同一小节**，不要重复同一个 id
- 小节内必须包含可执行命令：`- 命令:` 行，或 ```pwsh 代码块
- 命令成功时必须在 stdout 打印 `<AC-id> OK` 作为哨兵，runner 按此判定通过
- 判据只断言可观察结果（退出码 / stdout 子串 / 文件状态），不要断言测试标题、函数名、行号
- 每条任务额外保留一条回归门禁：`node --test "test/unit/*.test.mjs"` 全绿

自检：`node scripts/check-acceptance.mjs .collab/tasks/028/acceptance.md`
