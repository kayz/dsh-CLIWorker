# Task 026 — 跨进程选模到执行的端到端（HTTP 与 CLI 两个入口，共享时钟文件，租约按位置递延）

## 目标

来自 Blueprint 任务图 T-026（M5）。证明「选模」与「执行」在不同进程间真的接得上：宿主 stub 或 CLI 选出的 `calls[i]`，在新进程里按它给出的 command、args、cwd、stdin 原样执行，就能得到通过 `event/v1` 校验的流和 `ok` 的 result；同一租约再执行一次必须被拒。两个入口（HTTP 与 CLI）对同一配置给出一致的 `--config` 与 `--state-dir`。`count=3` 时租约按位置递延：把共享时钟文件依次写成 `selected_at + lease_ttl_s + i × timeout_s - 1s` 后执行 `calls[i]`，三个租约都还在有效期内；越过最后一个窗口则返回 `E_LEASE_EXPIRED`。交付：
- `test/e2e/select-run.test.mjs`
- `test/e2e/select-run-sequence.test.mjs`

## 约束

- 只允许写入以下路径（write_scope，来自 task-graph）：
  - `test/e2e/select-run.test.mjs`
  - `test/e2e/select-run-sequence.test.mjs`
  - `test/traceability/T-026.json`
- 仓库级硬约束：不得修改 `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`；新增 CLI 命令一律通过 `export const route = { cmd, sub }` 自注册（本任务不应新增命令，只验证既有入口）。
- 本任务是纯测试任务：不得改 `lib/**`、`scripts/**`、`package.json` 或 `contracts/**`；发现实现缺陷时报告，不在本任务顺手改。
- 验收必须能被 `node scripts/check-acceptance.mjs` 通过（`## AC-0xx` 小节 + 可执行命令 + `<AC-id> OK` 哨兵）。
- 时间只能来自共享时钟文件（子进程 env 带 `CLIWORKER_TEST_CLOCK_FILE`）或测试伪时钟；禁止用墙钟 sleep 等待，轮询要设上限。
- 不依赖机器上真实安装的 CLI 或已登录账号：一律用 `fake-cli` 夹具；测试结束清理临时 state_dir 与时钟文件，不污染仓库与用户目录。
- 子进程必须原样使用 `calls[i]` 的 command/args/cwd，不得自己拼参数；断言 argv 时按平台差异（`cmd`/pwsh 垫片）用既有平台门控，不写死平台专属路径。
- 零第三方运行时依赖，Node 20+ / ESM；不改 `.collab/blueprint/**`、其他任务目录与 write_scope 之外的文件；`acceptance.md` 由 design 阶段产出。

## 建议验收方向

由 designer 决定命令形态，以下是必须成立的可观察结论（AC 号与层级取自任务图）。
- AC-064（levels: e2e）：用宿主 stub 和 HTTP 选模，在新进程中按 `calls[0]` 的 command、args、cwd、stdin 原样执行（子进程 env 带 `CLIWORKER_TEST_CLOCK_FILE`），得到 `event/v1` 流和 `ok` 的 result；再执行一次得到 `E_LEASE_CONSUMED`。用 CLI 选模走同样流程，结果相同。`count=3` 时把时钟文件依次写成 `selected_at + lease_ttl_s + i × timeout_s - 1s` 后执行 `calls[i]`，三个租约都未过期；另一组把时钟写成 `calls[2].expires_at + 1s` 后执行，返回 `E_LEASE_EXPIRED`。插件与 CLI 对同一配置给出的 `--config` 与 `--state-dir` 相同。

## 非目标

- 不新增功能、命令或路由；不写单测/单进程集成测试（已有任务覆盖）。
- 不验证真实 provider 的额度、身份与输出形态（`fake-cli` 夹具足够）。
- 不做性能测量（p95 由既有 perf 入口单独产出，只作报告不作门禁）与安装/升级（T-027）、冒烟（T-029）、发布门禁（T-030）。

## 验收格式（生成 acceptance.md 时必须遵守，否则 CI 解析失败）

- 每个 AC 一个二级标题：`## AC-<三位数字> <标题>`；**同一 AC 的多条检查放进同一小节**，不要重复同一个 id
- 小节内必须包含可执行命令：`- 命令:` 行，或 ```pwsh 代码块
- 命令成功时必须在 stdout 打印 `<AC-id> OK` 作为哨兵，runner 按此判定通过
- 判据只断言可观察结果（退出码 / stdout 子串 / 文件状态），不要断言测试标题、函数名、行号
- 每条任务额外保留一条回归门禁：`node --test "test/unit/*.test.mjs"` 全绿

自检：`node scripts/check-acceptance.mjs .collab/tasks/026/acceptance.md`
