# Task 003 评审（第 5 轮）

- 评审的 git sha：`53d4f2aca4826bf8fbc13e089ae63c234a838289`（task/003，`fix(dev-r2): address review findings`）
- 结论：**needs_revision**
- 通过数 / 总数：4 / 5（AC-006、AC-007、AC-008、AC-072 通过；总体回归 V-R-1 未通过）

## 证据口径

- SHA 只读核验：`C:/git/dsh-CLIWorker/.git/worktrees/003/HEAD` 内容为 `ref: refs/heads/task/003`；`.git/refs/heads/task/003` 内容为 `53d4f2aca4826bf8fbc13e089ae63c234a838289`，与会话开头 git log 首行 `53d4f2a` 一致。未执行 git 命令。
- 执行类验收用 `ci-results.json`（`ranAt=2026-11-08T02:06:22+08:00`）：`passed=4 total=4 ok=true`；AC-006/007/008/072 各 `passed=true`、`exitCode=0`。AC-072 输出 14 条 `✔ [AC-072]`、`fail 0`、`filtered 2 files`（`ci-results.json:43`）。
- `ci-results.json` 不含总体回归 V-R-1 至 V-R-6，评审补跑（只读脚本）：
  - `node scripts/check-fast.mjs`：失败。`traceability.test.mjs:158` 断言 `actual: 'covered'`、`expected: 'planned'`，末行 `check-fast: FAILED step npm test (exit 1)`。
  - `node scripts/check-traceability.mjs`：`check-traceability: ok (covered=10 planned=64)`。
  - `node scripts/check-seams.mjs`：`check-seams: ok (files=15)`。
- V-R-5 需要 git，评审不能执行，无法确认；按 `impl.md` §1 清单与 design `write_scope` 对照，未见越界，不作为失败依据。

## 与第 4 轮相比

没有变化。

- `lib/`、`scripts/check-seams.mjs`、`test/traceability/T-003.json` 的 mtime 都停在 01:38–01:42，之后没有改动。
- `test/unit/traceability.test.mjs` mtime 仍为 01:25:45，第 158 行仍是 `assert.equal(merged.acs['AC-006'], 'planned')`。
- `design.md`、`acceptance.md` mtime 仍为 01:35，对 `traceability.test` 的 grep 无任何命中：`write_scope` 与 V-R-5 `globs` 都没有该文件。前几轮要求的裁决没有落地。
- `impl.md` §9.1 自述本轮未改任何文件，与上述事实一致。

## 逐条核对

### AC-006 import-safe 入口：通过
CI `passed=true`、`exitCode=0`，末行为 V-006-7 期望的 `ERROR: usage: cliworker providers | models list|select|forecast | usage record|summary`（`ci-results.json:15`）。

### AC-007 缝规则：通过
CI 末行 `PROBE-OK seams-real-tree`（`ci-results.json:24`）；评审实测 `check-seams: ok (files=15)`，满足 `N >= 15`。

### AC-008 宿主 stub 与注册：通过
CI 末行 `PROBE-OK handlers`（`ci-results.json:33`）。

### AC-072 时钟与上下文契约：通过
CI 14 条 `✔ [AC-072]`，`fail 0`，覆盖 `clock.test.mjs` 与 `context.test.mjs`（`ci-results.json:43`）。

### 总体回归
- V-R-1：**失败**（见 Findings）。
- V-R-2：`check-traceability: ok (covered=10 planned=64)`，通过。
- V-R-3、V-R-4：`impl.md` §9.2 记录 `check-test-discovery: ok`、`check-frozen-files: ok (8 files)`；代码自第 2 轮起未变。
- V-R-5：无法用 git 确认，按清单对照未见越界。
- V-R-6：`impl.md` 记录 `PROBE-OK no-secrets`；评审读过的文件中无密钥形态字符串。

## Findings

### P1 — V-R-1 check-fast 失败：既有 AC-004 测试与 T-003 追踪分片互斥（第 1–4 轮遗留，仍未解决）

- 位置：`test/unit/traceability.test.mjs:158`
- 现象：`node scripts/check-fast.mjs` 退出码 1，一条失败：`[AC-004] mergeShards treats ACs without a shard as planned`，`actual: 'covered'`、`expected: 'planned'`。
- 原因：V-R-2 要求 AC-006 为 `covered`（`covered=10 planned=64`，`trace-T-003` 探针逐个断言），而该测试硬编码 AC-006 为 `planned`；`mergeShards` 对同一 AC 只给一个状态，两条验收在同一仓库状态下不能同时满足。该文件不在 `write_scope`，改它会使 V-R-5 变红。
- 这是任务级死锁，dev 角色无法自行解开；实现代码本身未发现其它问题。需要编排方/设计方裁决，之后本任务可直接判 pass：
  1. `design.md` 的 `write_scope` 与 `acceptance.md` V-R-5 的 `globs` 同时加入 `test/unit/traceability.test.mjs`，并把第 158 行的 `'AC-006'` 改为仍无分片的 AC（推荐 `AC-009`）；然后重跑 `pwsh -NoProfile -File scripts/check-fast.ps1`，期望退出码 0、`ℹ fail 0`、末行 `check-fast: ok`；
  2. 或由设计方在 T-001 归属下处理该断言。
- 继续 review→dev 循环不会有进展，建议停止循环，等待裁决。
