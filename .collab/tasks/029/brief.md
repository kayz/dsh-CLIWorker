# Task 029 — 发布前冒烟：smoke-real（步骤带 ac 映射，含 wsl-discover；real 模式由维护者真机运行，dry-run 在 CI 运行）

## 目标

来自 Blueprint 任务图 T-029（M5）。一条命令给出「这次能不能发」的冒烟证据：dry-run 在 `fake-cli` 环境里依次执行 discover、wsl-discover（夹具）、enumerate、probe、select、run（极小提示）、http-select，每个步骤声明自己的 `ac` 字段并全部 pass，产出的报告通过 `cliworker.smoke/v1` 校验（`mode:'dry-run'`、`redacted:true`），全程 leak-scan 0 命中；未设置 `CLIWORKER_SMOKE=1` 时尝试 real 模式返回 `E_SMOKE_DISABLED`。real 模式在装有 WSL 的 Windows 真机上运行，`wsl-discover` 为 mandatory 且真实枚举，结果与 `wsl.exe -l -q` 一致；dry-run 里同名步骤即使 pass 也不计入 real-smoke 基线。交付：
- `scripts/smoke-real.mjs`（步骤 discover、wsl-discover、enumerate、probe、select、run、http-select，各带 `ac`）
- `test/smoke/smoke-dry-run.test.mjs`、`test/smoke/wsl-discover.test.mjs`（报告条目校验）
- `docs/release-checklist.md`（real 模式与 wsl-discover 的真机要求）

## 约束

- 只允许写入以下路径（write_scope，来自 task-graph）：
  - `scripts/smoke-real.mjs`
  - `test/smoke/**`
  - `docs/release-checklist.md`
  - `test/traceability/T-029.json`
- 仓库级硬约束：不得修改 `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`；新增 CLI 命令一律通过 `export const route = { cmd, sub }` 自注册（本任务不新增命令，冒烟脚本只调用既有命令）。
- 不得修改 `test/flows/steps/**`（步骤由 T-012/T-013/T-020/T-024/T-036 产出）、`lib/discovery/wsl*`、`contracts/**`、`package.json`；WSL 枚举只消费既有实现。
- 验收必须能被 `node scripts/check-acceptance.mjs` 通过（`## AC-0xx` 小节 + 可执行命令 + `<AC-id> OK` 哨兵）。
- real 模式只能由维护者手动触发（必须同时满足 `CLIWORKER_SMOKE=1` 与装有 WSL 的 Windows 主机），CI 只跑 dry-run；dry-run 报告永远不得冒充 real。
- 报告版本取自 `package.json`、`redacted:true`，不含令牌、真实用户名与本机绝对路径；步骤失败要给出 reason，不允许把 skip 记成 pass。
- 冒烟不得用墙钟 sleep 等结果；轮询必须设上限。dry-run 不依赖机器上真实安装的 CLI 或已登录账号。
- 冒烟脚本可被反复运行：临时 state_dir、独立夹具 PATH，结束清理，不污染仓库与用户目录。
- 零第三方运行时依赖，Node 20+ / ESM；不改 `.collab/blueprint/**`、其他任务目录；`acceptance.md` 由 design 阶段产出。

## 建议验收方向

由 designer 决定命令形态，以下是必须成立的可观察结论（AC 号与层级取自任务图）。
- AC-038（levels: smoke，baseline `real-smoke`）：在 win32 且装有 WSL 的主机上以 real 模式运行 `wsl-discover` 步骤（`ac:['AC-038']`），列出的发行版与 `wsl.exe -l -q` 的结果一致，每个发行版都生成 `wsl:<d>` 条目，步骤状态为 pass；dry-run 中同名步骤使用夹具，其 pass 不计入 real-smoke 基线。没有该真机时只能经 `release/waivers.json` 显式豁免（由 T-030 单列）。
- AC-069（levels: smoke）：`smoke-real --dry-run` 在 `fake-cli` 环境下依次运行 discover、wsl-discover（夹具）、enumerate、probe、select、run 极小提示、http-select，每个步骤声明 `ac` 字段并全部 pass，生成通过 `cliworker.smoke/v1` 校验的报告（`mode:'dry-run'`），leak-scan 0 命中；未设置 `CLIWORKER_SMOKE=1` 时运行 real 模式返回 `E_SMOKE_DISABLED`。

## 非目标

- 不做发布门禁与豁免判定（T-030），不改 AC 索引与追踪规则。
- 不在 CI 中运行 real 模式，不做性能压测，不做真 provider 花费型调用。
- 不新增 CLI 命令或路由；不写 UI 冒烟（`http-select` 已覆盖 HTTP 读链路）。

## 验收格式（生成 acceptance.md 时必须遵守，否则 CI 解析失败）

- 每个 AC 一个二级标题：`## AC-<三位数字> <标题>`；**同一 AC 的多条检查放进同一小节**，不要重复同一个 id
- 小节内必须包含可执行命令：`- 命令:` 行，或 ```pwsh 代码块
- 命令成功时必须在 stdout 打印 `<AC-id> OK` 作为哨兵，runner 按此判定通过
- 判据只断言可观察结果（退出码 / stdout 子串 / 文件状态），不要断言测试标题、函数名、行号
- 每条任务额外保留一条回归门禁：`node --test "test/unit/*.test.mjs"` 全绿

自检：`node scripts/check-acceptance.mjs .collab/tasks/029/acceptance.md`
