# Task 003 评审（第 3 轮）

- 评审的 git sha：`78c49c980ec422095c341d8990c0278a63e1c6e1`（task/003，`fix(dev-r3): address review findings`）
- 结论：**needs_revision**
- 通过数 / 总数：4 / 5（AC-006、AC-007、AC-008、AC-072 通过；总体回归 V-R-1 未通过）

## 证据口径

- SHA 只读核验：`.git` 指针 -> `C:/git/dsh-CLIWorker/.git/worktrees/003/HEAD` 内容为 `ref: refs/heads/task/003`；`refs/heads/task/003` 内容为 `78c49c980ec422095c341d8990c0278a63e1c6e1`，与会话开头 git log 首行 `78c49c9` 一致。未执行 git 命令。
- 执行类验收用 `ci-results.json`（`ranAt=2026-11-08T01:52:48+08:00`）：`passed=4 total=4 ok=true`；AC-006/007/008/072 各 `passed=true`、`exitCode=0`。AC-072 输出 14 条 `✔ [AC-072]`、`ℹ fail 0`、`run-tests: filtered 2 files`（`ci-results.json:43`）。
- `ci-results.json` 不含总体回归 V-R-1 至 V-R-6，评审只读补跑：
  - `node scripts/check-fast.mjs`：失败，末行 `check-fast: FAILED step npm test (exit 1)`；断言 `actual: 'covered'`、`expected: 'planned'`。
  - `check-seams: ok (files=15)`、`check-traceability: ok (covered=10 planned=64)`。
- V-R-5 需要 git，评审不能执行，无法确认；按 `impl.md` §1 清单与 design `write_scope` 对照，未见越界，不作为失败依据。

## 与第 2 轮相比

没有变化。dev-r3 的 `impl.md` §7.1 明确说明本轮未改任何实现或测试文件。评审核对：

- `test/unit/traceability.test.mjs:158` 仍是 `assert.equal(merged.acs['AC-006'], 'planned')`，文件 mtime 01:25。
- `design.md` 的 `write_scope`（文件头 2-25 行）仍不含 `test/unit/traceability.test.mjs`；`acceptance.md` 全文不含该路径，V-R-5 的 `globs` 也没有它。两份文件 mtime 仍为 01:35，两轮评审提出的裁决没有落地。

## 逐条核对

### AC-006 import-safe 入口：通过
CI `passed=true`、`exitCode=0`，末行为 V-006-7 期望的 `ERROR: usage: cliworker providers | models list|select|forecast | usage record|summary`。`impl.md` §7.2 记录 V-006-2/3/4/5/6 探针全部 `PROBE-OK`。

### AC-007 缝规则：通过
CI 末行 `PROBE-OK seams-real-tree`；评审实测 `check-seams: ok (files=15)`，满足 `N >= 15`。

### AC-008 宿主 stub 与注册：通过
CI 末行 `PROBE-OK handlers`。

### AC-072 时钟与上下文契约：通过
CI：14 条 `✔ [AC-072]`，`fail 0`，覆盖 `clock.test.mjs` 与 `context.test.mjs`。

### 总体回归
- V-R-1：**失败**（见 Findings）。
- V-R-2：`check-traceability: ok (covered=10 planned=64)`，通过。
- V-R-3、V-R-4：`impl.md` §7.2 记录 `check-test-discovery: ok`、`check-frozen-files: ok (8 files)`；第 2 轮评审亦独立确认，代码未变。
- V-R-5：无法用 git 确认，按清单对照未见越界。
- V-R-6：`impl.md` §7.2 记录 `PROBE-OK no-secrets`；评审读过的文件中无密钥形态字符串。

## Findings

### P1 — V-R-1 check-fast 失败：既有 AC-004 测试与 T-003 追踪分片互斥（第 1、2 轮遗留，仍未解决）

- 位置：`test/unit/traceability.test.mjs:158`
- 现象：`node scripts/check-fast.mjs` 退出码 1，一条失败：`[AC-004] mergeShards treats ACs without a shard as planned`，`actual: 'covered'`、`expected: 'planned'`。
- 原因：V-R-2 要求 AC-006 为 `covered`（`covered=10 planned=64`，且 `trace-T-003` 探针逐个断言），而该测试硬编码 AC-006 为 `planned`；`mergeShards` 对同一 AC 只给一个状态，两条验收在当前仓库状态下不能同时满足。该文件不在 `write_scope`，改它会使 V-R-5 变红。
- dev 的做法正确（如实报告、未越界），实现代码无其它问题。**这是任务级死锁，dev 角色无法自行解开**，三轮 review→dev 循环不会有进展，需要编排方/设计方裁决：
  1. `design.md` 的 `write_scope` 与 `acceptance.md` V-R-5 的 `globs` 同时加入 `test/unit/traceability.test.mjs`，并把第 158 行改为断言仍无分片的 AC（推荐 `AC-009`），然后重跑 `pwsh -NoProfile -File scripts/check-fast.ps1`，期望退出码 0、`ℹ fail 0`、末行 `check-fast: ok`；
  2. 或由设计方在 T-001 归属下处理该断言。
- 裁决落地且 check-fast 转绿后，本任务可判 pass；除此之外未发现代码问题。
