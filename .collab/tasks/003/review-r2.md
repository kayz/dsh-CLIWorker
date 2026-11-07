# Task 003 评审（第 2 轮）

- 评审的 git sha：`1e8b952bdd0d687de72779d9e5318b06eaaeba91`（task/003，`fix(dev-r2): address review findings`）
- 结论：**needs_revision**
- 通过数 / 总数：4 / 5（AC-006、AC-007、AC-008、AC-072 通过；总体回归 V-R-1 未通过）

## 证据口径

- SHA 只读核验：`.git` 指针指向 `C:/git/dsh-CLIWorker/.git/worktrees/003`，其 `HEAD` 为 `ref: refs/heads/task/003`，`refs/heads/task/003` 内容为 `1e8b952bdd0d687de72779d9e5318b06eaaeba91`。未执行 git 命令。
- 执行类验收用 `ci-results.json`（编排方 PowerShell 7 执行，`ranAt=2026-11-08T01:48:49+08:00`）：`passed=4 total=4 ok=true`。AC-072 输出 14 条 `✔ [AC-072]`，`ℹ fail 0`，`run-tests: filtered 2 files`。
- `ci-results.json` 只有四个 AC，没有总体回归 V-R-1 至 V-R-6。评审补跑了只读检查：
  - `node scripts/check-fast.mjs`：退出码 1，`ℹ tests 106`、`ℹ pass 105`、`ℹ fail 1`，末行 `check-fast: FAILED step npm test (exit 1)`。
  - `check-traceability: ok (covered=10 planned=64)`、`check-seams: ok (files=15)`、`check-test-discovery: ok`、`check-frozen-files: ok (8 files)`。
- V-R-5 需要 git，评审不能执行，无法确认；按 `impl.md` §1 清单与 design `write_scope` 对照，未见越界。不作为失败依据。

## 与第 1 轮相比

第 1 轮唯一的 P1 没有变化。dev-r2 的 `impl.md` §6 明确说明本轮没有改任何实现或测试文件，只重跑验收并请求裁决。评审核对：

- `test/unit/traceability.test.mjs:158` 仍是 `assert.equal(merged.acs['AC-006'], 'planned')`（文件 mtime 01:25，早于本轮）。
- `design.md`、`acceptance.md` 的 mtime 为 01:35，早于第 1 轮评审（01:45），裁决（扩 `write_scope` 和 V-R-5 globs）没有落地。
- 失败现象不变：`✖ [AC-004] mergeShards treats ACs without a shard as planned`，`traceability.test.mjs:158:10` 断言 `'covered'` ≠ `'planned'`。

## 逐条核对

### AC-006 import-safe 入口：通过
- CI：AC-006 `passed=true`、`exitCode=0`，末行为 `ERROR: usage: cliworker providers | models list|select|forecast | usage record|summary`，与 V-006-7 期望一致。
- `impl.md` §6.1 记录 V-006-2/3/4/5/6 探针全部 `PROBE-OK`；代码结构与第 1 轮核对一致（`lib/cli.mjs` 导出 `main(argv, ctx)`，返回 `{exitCode}`，lib 下无 `process.exit` 字样）。

### AC-007 缝规则：通过
- CI：AC-007 `passed=true`，末行 `PROBE-OK seams-real-tree`。评审实测 `check-seams: ok (files=15)`，满足 `N >= 15`。

### AC-008 宿主 stub 与注册：通过
- CI：AC-008 `passed=true`，末行 `PROBE-OK handlers`。

### AC-072 时钟与上下文契约：通过
- CI：AC-072 `passed=true`，14 条 `✔ [AC-072]`，`fail 0`，覆盖 `clock.test.mjs` 与 `context.test.mjs` 两个文件。

### 总体回归
- V-R-1 `check-fast`：**失败**（见 Findings）。
- V-R-2：`check-traceability: ok (covered=10 planned=64)`，通过。
- V-R-3：`check-test-discovery: ok`，通过。
- V-R-4：`check-frozen-files: ok (8 files)`，通过。
- V-R-5：无法用 git 确认，按清单对照未见越界。
- V-R-6：`impl.md` §6.1 声明 `PROBE-OK no-secrets`；评审读过的文件中没有密钥形态字符串。

## Findings

### P1 — V-R-1 check-fast 失败：既有 AC-004 测试与 T-003 追踪分片互斥（第 1 轮遗留，未解决）

- 位置：`test/unit/traceability.test.mjs:158`
- 现象：`node scripts/check-fast.mjs` 退出码 1，106 tests、pass 105、fail 1。
- 原因：V-R-2 要求 AC-006 为 `covered`（`covered=10 planned=64`，且 `trace-T-003` 探针逐个断言），而该测试硬编码 AC-006 为 `planned`。`mergeShards` 对同一 AC 只给一个状态，两条验收在当前仓库状态下不可能同时满足；修复文件又不在 `write_scope`，且会让 V-R-5 变红。
- 实现者的做法是对的：如实报告冲突，没有越界改动。但验收仍然没过。
- 需要的裁决（非 dev 权限）：
  1. `design.md` 的 `write_scope` 与 `acceptance.md` V-R-5 的 globs 同时加入 `test/unit/traceability.test.mjs`，并把第 158 行改成断言一个仍无分片的 AC（如 `AC-009`），或改为 `'covered'`；
  2. 或由设计方在 T-001 归属下处理该断言。
- 落地后重跑 `pwsh -NoProfile -File scripts/check-fast.ps1`，期望退出码 0、`ℹ fail 0`、末行 `check-fast: ok`，本任务即可判 pass。除此之外未发现代码问题。
