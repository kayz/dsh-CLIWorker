# Task 009 验收标准（AC-025）

规格来源：`.collab/blueprint/cliworker-v2/task-graph.json` T-009，`contracts/spec/ac-index.json` AC-025（levels: integration）。缺陷登记：`test/characterization/defects.json` 的 `a2-pack`（`repro_sha256` = `f520198675d74dc94fd4be7bd120a0f7f5168e0058e85369bcc618100dbd9c93`，不得变化）。

本文件按 CI 契约（`tools/ci-runner.ps1`）书写：每个 AC 一个以 AC id 开头的二级小节，`- 命令:` 为单行命令，`- 期望:` 说明判定条件。命令可能在临时目录下执行，因此全部使用绝对路径（含 `file:///C:/...` 形式，若需要 ESM 导入）。

## AC-025 打包清单与 bin 入口（bin/files/版本对齐/包内容白名单）

- 命令: `$r='C:/git/dsh-CLIWorker/.collab/worktrees/009'; node "$r/scripts/check-pack.mjs"; $a=$LASTEXITCODE; node --test --test-reporter=tap "$r/test/integration/pack.test.mjs" "$r/test/characterization/defects/a2-pack.test.mjs" *> $null; $b=$LASTEXITCODE; node "$r/scripts/check-defects.mjs" *> $null; $c=$LASTEXITCODE; if ($a -eq 0 -and $b -eq 0 -and $c -eq 0) { 'AC-025 OK' } else { "AC-025 FAILED check-pack=$a tests=$b defects=$c"; exit 1 }`
- 期望: 退出码 0，stdout 同时含 `check-pack: ok` 与 `AC-025 OK`。该命令按顺序验证下列内容，任一环节失败即打印 `AC-025 FAILED check-pack=<n> tests=<n> defects=<n>` 并以非 0 退出。

覆盖范围（逐条对应本任务的可验收事实，均由上面那一条命令验证）：

- `package.json` 的 `bin.cliworker` 为 `bin/cliworker.mjs`；`dsh.plugin.json` 的 `version` 与 `package.json` 的 `version` 一致（`check-pack` 的 `pack.bin_mismatch` / `pack.version_mismatch` 规则）。
- `package.json` 的 `files` 为精确白名单：含 `bin`、`lib`、`config/cliworker.example.json`、`contracts/registry.snapshot.json`、`contracts/agentline-forbidden.json`、`contracts/schemas`、`contracts/host`、`contracts/context`、`cordis.patch.yml`、`dsh.plugin.json`、`README.md`；不含 `config`、`contracts`、`contracts/spec`、`contracts/golden`、`contracts/examples`、`test`、`scripts` 这类目录级或规格金标条目（`a2-pack.test.mjs` 的 `[fixed]` 段）。
- 真实 `npm pack --dry-run --json` 清单含 `bin/cliworker.mjs`、`config/cliworker.example.json`、`lib/` 全部文件、`contracts/registry.snapshot.json`、`contracts/agentline-forbidden.json`，以及 `contracts/schemas/`、`contracts/host/`、`contracts/context/` 下各至少一个文件（`pack.missing_required` + 集成测试第 2 条）。
- 清单不含 `test/`、`scripts/`、`state/`、`contracts/golden/`、`contracts/spec/`、`contracts/examples/`、`.collab/`、`config/*.local.json`、`*.jsonl`（`pack.forbidden_present` + 集成测试第 3 条）。
- 负向行为：缺必需文件报 `pack.missing_required`；各类禁入路径各报 `pack.forbidden_present`；`bin` 缺失或带 `./` 前缀报 `pack.bin_mismatch`；版本不一致报 `pack.version_mismatch`；`contracts/` 下非白名单路径报 `pack.not_whitelisted`（集成测试第 4–7 条）。
- 缺陷登记 `a2-pack`：`[repro]` 块字节未变（`repro_sha256` 等于登记值）、canary 变体上 repro 失败、`[fixed]` 段存在且在真实 `package.json` 上通过（`scripts/check-defects.mjs` 与 `a2-pack.test.mjs`）。
- 追溯：`test/traceability/T-009.json` 以 `AC-025` / `covered` 指向 `test/integration/pack.test.mjs` 与 `test/characterization/defects/a2-pack.test.mjs`（由 `node scripts/check-traceability.mjs` 在仓库门禁中校验）。

说明：`check-no-collab`、`check-unused`、`check-fast` 等全局门禁不属于 AC-025，由仓库自身的 `scripts/check-fast.ps1` 承担，不并入本 AC 的判定；其当前失败项来自其它任务的 `test/unit/gitignore.test.mjs` 与 `a5-ignored-fields` 缺陷登记，不在本任务写域内。
