# Task 003 评审（第 1 轮）

- 评审的 git sha：`b64262dd3f3f3e3306892084aff98b02aee4b306`（task/003，`stage(dev): task 003`）
- 结论：**needs_revision**
- 通过数 / 总数：4 / 5（AC-006、AC-007、AC-008、AC-072 通过；总体回归 V-R-1 未通过）

## 证据口径

- 执行类验收用 `ci-results.json`（PowerShell 7 编排方执行）：`passed=4 total=4 ok=true`。AC-072 输出 14 条 `✔ [AC-072]`，`ℹ fail 0`。
- `ci-results.json` 只覆盖四个 AC，没有总体回归 V-R-1 至 V-R-6。V-R-1 到 V-R-4 由评审补跑（只读）：
  - `node scripts/check-fast.mjs`：退出码 1，106 tests、pass 105、fail 1，末行 `check-fast: FAILED step npm test (exit 1)`。
  - `check-traceability: ok (covered=10 planned=64)`、`check-test-discovery: ok`、`check-frozen-files: ok (8 files)`、`check-seams: ok (files=15)`。
- V-R-5 需要 git，评审不能执行，无法确认。按 `impl.md` 清单和 `design.md` 的 `write_scope` 逐项对照，没有发现范围外改动，不作为失败依据。

## 逐条核对

### AC-006 import-safe 入口：通过
- `lib/cli.mjs:39-55`：`main(argv, ctx)` 返回 `{exitCode}`；先 `resolveRoute` 再 `loadConfig`；成功写 `ctx.stdout`，异常只写 `ctx.stderr`，没有任何进程退出调用。
- `lib/cli.mjs:1-19`：只有静态导入和常量，导入无副作用；`bin/cliworker.mjs` 按 design §5.3 用 `process.exitCode`。
- CI：AC-006 `passed=true`，最后一行是 `ERROR: usage: cliworker providers | models list|select|forecast | usage record|summary`，与 V-006-7 期望一致。

### AC-007 缝规则：通过
- `scripts/check-seams.mjs:13-24` 允许清单按相对路径精确匹配；`:54-106` 掩码保留换行，行号准确；`:162-179` 十条规则齐全；`:199-222` 导出 `scanRoot`；`:266-269` 仅直接运行才执行；参数错误退出 2 并写 `usage:`（`:231-246`）。
- 评审实测 `check-seams: ok (files=15)`，满足 N>=15。
- CI：AC-007 `passed=true`（`PROBE-OK seams-real-tree`）。

### AC-008 宿主 stub 与注册：通过
- `lib/index.js:37-98`：`createPlugin` 返回实时 `{registered, errors}`；单条路由失败不影响其余；`inject` 缺失或抛错记 `path:null`；stderr 提示只是附加，`errors` 才是权威。
- `getRegistration` 从未调用时返回 `failed` / `plugin not applied`；`apply`（`:100-109`）在 strict 且有错误时抛 `cliworker: route registration failed: …` 并挂 `error.registration`，非 strict 不抛。
- CI：AC-008 `passed=true`（`PROBE-OK handlers`）。

### AC-072 时钟与上下文契约：通过
- `lib/context.mjs:12-40`：真实时钟 `now()` 每次重读文件，数字或 `Date.parse`，非法内容抛含 `CLIWORKER_TEST_CLOCK_FILE` 的 `Error` 且不带环境变量值；真实时钟只有五个方法。`:42-61`：`createContext` 成员恰为十个，`now` 默认等于 `clock.now()`。
- `lib/cli.mjs:31-37`：`W_TEST_CLOCK` 只在变量为非空字符串且成功输出时追加。
- CI：AC-072 `passed=true`，14 条 `✔ [AC-072]`，`fail 0`。

### 总体回归
- V-R-1 `check-fast`：**失败**（见下方 finding）。
- V-R-2、V-R-3、V-R-4：通过（输出见上）。
- V-R-5：无法用 git 确认，按清单对照未见越界。
- V-R-6：评审读过的文件里没有密钥形态字符串；`impl.md` 声明 `PROBE-OK no-secrets`。

## Findings

### P1 — V-R-1 check-fast 失败：既有 AC-004 测试与新增 T-003 追踪分片冲突

- 位置：`test/unit/traceability.test.mjs:158`
- 现象：`assert.equal(merged.acs['AC-006'], 'planned')` 失败，实际是 `'covered'`。`check-fast` 因此退出码 1（106 tests，pass 105，fail 1）。
- 原因：本任务按 design §10 提交的 `test/traceability/T-003.json` 把 AC-006 记为 `covered`；acceptance V-R-2 同样要求 `covered=10 planned=64`，AC-006 必须是 covered。于是 V-R-1 与 V-R-2 在现有测试下互斥，实现者在 `write_scope` 内无法同时满足。
- 实现者做法正确：`impl.md` §4 如实报告了冲突，没有越界改动该文件。
- 需要的裁决与修复：
  1. 把 `test/unit/traceability.test.mjs` 加入本任务的 `write_scope`（同时更新 acceptance V-R-5 的 globs），并把第 158 行改成 `assert.equal(merged.acs['AC-006'], 'covered')`，或改断言一个仍无分片的 AC（例如 AC-009）。
  2. 修复后重跑 `pwsh -NoProfile -File scripts/check-fast.ps1`，期望退出码 0、`ℹ fail 0`、末行 `check-fast: ok`。
- 在这个测试改成与 T-003 一致之前，完整检查不可能为绿，所以判 needs_revision。除此之外未发现代码问题。
