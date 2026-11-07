# Task 003 评审（第 2 轮）

- 评审的 git sha：`068839e6dede2abade500f63d88ba6acf2ad9733`（task/003，`fix(dev-r2): address review findings (task 003)`）
- 结论：**pass**
- 通过数 / 总数：5 / 5（AC-006、AC-007、AC-008、AC-072 与总体回归 V-R-1…V-R-6）。V-R-5 无法用 git 确认，并有一处需要说明的例外，见下。

## 证据口径

- SHA 只读核验：`C:/git/dsh-CLIWorker/.git/worktrees/003/HEAD` 为 `ref: refs/heads/task/003`；`.git/refs/heads/task/003` 为 `068839e6dede2abade500f63d88ba6acf2ad9733`，与会话开头 git log 首行 `068839e` 一致。未执行 git 命令。
- 执行类验收引用 `ci-results.json`（`ranAt=2026-11-08T02:20:22+08:00`，晚于 `lib/index.js` 的修改时间 02:19:18）：`passed=4 total=4 ok=true`，AC-006/007/008/072 各 `passed=true`、`exitCode=0`（`ci-results.json:5-7`）。AC-072 输出 14 条 `✔ [AC-072]`、`fail 0`、`filtered 2 files`。
- `ci-results.json` 不含 V-R-1…V-R-6，评审补跑了只读脚本：
  - `node scripts/check-fast.mjs`：`ℹ tests 106 / pass 106 / fail 0`，`run-tests: full 23 files`，末行 `check-fast: ok`（V-R-1）。
  - `node scripts/check-traceability.mjs`：`ok (covered=10 planned=64)`（V-R-2）。
  - `node scripts/check-seams.mjs`：`check-seams: ok (files=15)`，退出码 0。
  - `node scripts/check-test-discovery.mjs`：`ok`（V-R-3）。
  - `node scripts/check-frozen-files.mjs`：`ok (8 files)`（V-R-4）。
  - `grep -rn "process.exit" lib`：无命中。

## 与上一轮（c4cc757）相比

实现只变了一处：`lib/index.js:38`，`const s = settings || {}` 改为 `const s = { readonly: false, ...(settings || {}) }`。design.md §6（第 192 行）要求 `settings` 取 `configPath`、`readonly`（缺省 false）、`strict`（缺省 false），这一行补上了 `readonly` 缺省值。`readonly` 不参与任何注册行为，所以路由注册、HTTP 输出与 `getRegistration()` 结构都不变。`strict` 仍由 `apply` 里的 `settings || {}` 读取（`lib/index.js:101-103`），不受影响。

## 逐条核对

### AC-006 import-safe 入口：通过
- CI `passed=true`、`exitCode=0`，末行为 V-006-7 期望的 usage 错误行。
- `lib/index.js` 顶层只有静态导入、`name` 常量和 `let report = null`，导入不读环境、不写输出；`createContext` 只在 `createPlugin` 调用时才执行（`:39`）。`lib` 下无 `process.exit`。

### AC-007 缝规则：通过
CI 末行 `PROBE-OK seams-real-tree`；评审实测 `check-seams: ok (files=15)`，满足 N ≥ 15。本轮改动没有引入新的 `node:fs`、`child_process`、定时器或 `Date` 用法。

### AC-008 宿主 stub 与注册：通过
- CI 末行 `PROBE-OK handlers`。
- 独立读代码：`lib/index.js:53-60` 单条路由 try/catch，成功才进 `registered`；失败进 `errors` 并写 stderr，继续注册其余路由。`inject` 缺失或抛错记 `path:null`（`:62-63`、`:87-89`）。`getRegistration()` 按 `errors.length` 现算 `status`（`:94-98`），未应用时返回 `failed`。`apply` 在 `strict===true` 且有错误时抛 `cliworker: route registration failed: …` 并挂 `error.registration`（`:100-109`）。错误不只写 console，与 design §6 一致。

### AC-072 时钟与上下文契约：通过
CI 14 条 `✔ [AC-072]`，`fail 0`，覆盖 `clock.test.mjs` 与 `context.test.mjs` 两个文件。`lib/context.mjs`、`lib/cli.mjs`、`test/helpers` 自 01:42 起无改动。

### 总体回归
- V-R-1：通过（`check-fast: ok`，106/106）。
- V-R-2、V-R-3、V-R-4：通过。
- V-R-5：无法用 git 确认；按文件清单对照 `write_scope`，dev 本轮只改了 `lib/index.js`（在 `write_scope` 内）。字面例外仍是 `test/unit/traceability.test.mjs`（编排方 `c4cc757` 所改，见 P2-1）。
- V-R-6：评审读过的文件中无密钥形态字符串；这里没有重跑。

## Findings

### P2-1（不阻塞，沿用上一轮）— V-R-5 的 globs 未列 `test/unit/traceability.test.mjs`
- 位置：`acceptance.md` V-R-5 `globs`、`design.md` `write_scope`
- 现象：该文件相对基准有改动，两份规格都没有列它，字面运行 V-R-5 会报 `outside write_scope`。改动出自编排方对已记录死锁的处置，不是 dev 越界。
- 建议：编排方补进 `write_scope` 与 V-R-5 `globs`，或在合并说明里记录该例外。

### P2-2（不阻塞，沿用上一轮）— `traceability.test.mjs:159-162` 的断言偏弱
- 现象：`for (const id of plannedIds) assert.equal(merged.acs[id], 'planned')` 对按同一条件筛出的数组断言，恒真。
- 建议：之后补 `assert.ok(plannedIds.length > 0)`。不影响本任务验收。

## 结论

AC-006、AC-007、AC-008、AC-072 及总体回归 V-R-1…V-R-4、V-R-6 均有证据支持；V-R-5 无法用 git 确认，只有上面说明的一处例外。本轮唯一改动（`lib/index.js:38` 的 `readonly` 缺省值）符合 design §6 且无副作用，没有发现新问题，判 **pass**。
