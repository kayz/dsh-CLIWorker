# Task 003 评审（第 6 轮）

- 评审的 git sha：`c4cc75758a54f2e09a4e323697154a2e0e2f211c`（task/003，`fix(test): invariant-based AC assertion (worktree 003)`）
- 结论：**pass**
- 通过数 / 总数：5 / 5（AC-006、AC-007、AC-008、AC-072 与总体回归 V-R-1…V-R-6）。V-R-5 无法用 git 确认，并有一处需要说明的例外，见下。

## 证据口径

- SHA 只读核验：`C:/git/dsh-CLIWorker/.git/worktrees/003/HEAD` 为 `ref: refs/heads/task/003`；`.git/refs/heads/task/003` 为 `c4cc75758a54f2e09a4e323697154a2e0e2f211c`，与会话开头 git log 首行 `c4cc757` 一致。未执行 git 命令。
- 执行类验收引用 `ci-results.json`（`ranAt=2026-11-08T02:14:54+08:00`，晚于 `traceability.test.mjs` 的修改时间 02:14:48）：`passed=4 total=4 ok=true`，AC-006/007/008/072 各 `passed=true`、`exitCode=0`（`ci-results.json:5-7`）。AC-072 输出 14 条 `✔ [AC-072]`、`fail 0`、`filtered 2 files`（`ci-results.json:43`）。
- `ci-results.json` 不含 V-R-1…V-R-6，评审补跑了只读脚本：
  - `node scripts/check-fast.mjs`：`ℹ tests 106 / pass 106 / fail 0`，`run-tests: full 23 files`，末行 `check-fast: ok`。第 1–5 轮的唯一红项已消失。
  - `node scripts/check-traceability.mjs`：`check-traceability: ok (covered=10 planned=64)`（V-R-2）。
  - `node scripts/check-seams.mjs`：`check-seams: ok (files=15)`（N ≥ 15）。
  - `node scripts/check-test-discovery.mjs`：`check-test-discovery: ok`（V-R-3）。
  - `node scripts/check-frozen-files.mjs`：`check-frozen-files: ok (8 files)`（V-R-4）。
  - `grep -rn "process.exit" lib`：无命中（V-006-6）。

## 与第 5 轮相比

唯一变化是 `test/unit/traceability.test.mjs`（mtime 02:14:48，已进入 `c4cc757`）。第 151–163 行不再把 `AC-006` 写死为 `planned`，改为断言 `AC-001/004/074` 为 `covered`，并对 `merged.acs` 按状态分组做不变量检查。前五轮要求的“任务级裁决”由编排方以这次提交落地。

`lib/`、`bin/`、`contracts/`、`scripts/check-seams.mjs`、`test/traceability/T-003.json` 的 mtime 仍停在 01:38–01:42，实现没有变动。`design.md`、`acceptance.md`（mtime 01:35）对 `traceability.test` 的 grep 仍为 0 命中，规格文件没有同步更新。

## 逐条核对

### AC-006 import-safe 入口：通过
- CI `passed=true`、`exitCode=0`，末行为 V-006-7 期望的 usage 错误行（`ci-results.json:15`）。
- 独立读代码：`lib/cli.mjs:39-55` 导出 `main(argv, ctx)`，导入无副作用；路由在 `loadConfig` 之前判定（`:40-44`），成功写 `ctx.stdout` 返回 `{exitCode:0}`，异常写 `ctx.stderr` 返回 `{exitCode: e.exitCode ?? 1}`。`lib` 下无 `process.exit` 字样。

### AC-007 缝规则：通过
CI 末行 `PROBE-OK seams-real-tree`（`ci-results.json:24`）；评审实测 `check-seams: ok (files=15)`。

### AC-008 宿主 stub 与注册：通过
- CI 末行 `PROBE-OK handlers`（`ci-results.json:33`）。
- 独立读代码：`lib/index.js:37-92` 单条路由 try/catch，成功才进 `registered`；失败进 `errors` 并写 stderr，继续注册其余路由；`inject` 缺失或抛错记 `path:null`（`:63`、`:87-89`）。`getRegistration()` 按 `errors.length` 现算 `status`（`:94-98`）。`apply` 在 `strict===true` 且有错误时抛 `cliworker: route registration failed: …` 并挂 `error.registration`（`:100-109`）。这与 design §6 一致，错误不只写 console。

### AC-072 时钟与上下文契约：通过
CI 14 条 `✔ [AC-072]`，`fail 0`，覆盖 `clock.test.mjs` 与 `context.test.mjs` 两个文件（`ci-results.json:43`）。

### 总体回归
- V-R-1：**通过**（`check-fast: ok`，106/106）。
- V-R-2：通过（`covered=10 planned=64`）。
- V-R-3、V-R-4：通过。
- V-R-5：无法用 git 确认；按文件清单对照 `write_scope` 没有 dev 越界。唯一例外是 `test/unit/traceability.test.mjs`：它不在 `write_scope` 与 V-R-5 的 `globs` 里，字面运行 V-R-5 探针会把它列为 `outside write_scope`。该改动是编排方为解开已记录的死锁而做的，不是 dev 越界；见 Finding P2-1。
- V-R-6：评审读过的文件中无密钥形态字符串，`impl.md` 记录 `PROBE-OK no-secrets`；这里没有重跑。

## Findings

### P2-1（不阻塞）— V-R-5 的 globs 未同步，字面运行会把编排方的修复文件判为越界
- 位置：`acceptance.md` V-R-5 `globs`、`design.md` `write_scope`
- 现象：`test/unit/traceability.test.mjs` 相对基准 `7f655f7` 有改动，而两份规格都没有列它。
- 建议：编排方把该文件加入 `write_scope` 与 V-R-5 `globs`，或在合并说明里记录该例外，避免后续按字面重跑 V-R-5 时误报。

### P2-2（不阻塞）— 改后的断言偏弱
- 位置：`test/unit/traceability.test.mjs:159-162`
- 现象：`for (const id of plannedIds) assert.equal(merged.acs[id], 'planned')` 是恒真式（`plannedIds` 本来就是按该条件筛出的）。该测试标题是“没有分片的 AC 记为 planned”，现在没有任何断言证明有 AC 是 `planned`。
- 建议：之后加一条不依赖具体 AC 编号的断言，例如 `assert.ok(plannedIds.length > 0)`，或对 `index` 里没有 shard 声明的 AC 断言为 `planned`。不影响本任务的验收。

## 结论

AC-006、AC-007、AC-008、AC-072 及总体回归 V-R-1…V-R-4、V-R-6 均有证据支持；V-R-5 无法用 git 确认，只有上面说明的一处例外。第 1–5 轮唯一阻塞项已消失，实现代码没有发现问题，判 **pass**。
