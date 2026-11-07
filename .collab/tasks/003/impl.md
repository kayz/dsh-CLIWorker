# Task 003 实施报告

实施范围严格按 `design.md` 的 `write_scope`：只新建/修改了 design 列出的文件，未改动 `brief.md`、`design.md`、`acceptance.md`、`lib/select.mjs`、`scripts/` 下的既有脚本，也未执行任何 git 命令。

## 1. 变更清单

### 新增

| 文件 | 内容 |
|---|---|
| `lib/exec.mjs` | `run(command, args, {timeout})`，原样迁入 `availability.mjs` 里的 `spawnSync` 逻辑（`shell` 取值保持原样，安全化留给 T-010）。是 `lib` 下唯一导入 `node:child_process` 的文件。 |
| `lib/context.mjs` | `TEST_CLOCK_ENV`、`createRealClock({env, fs})`、`createContext(overrides)`、`systemNow()`。时钟文件每次调用都重新读取；解析失败抛含 `CLIWORKER_TEST_CLOCK_FILE` 的 `Error`。真实时钟只暴露 `now/nowIso/setTimeout/clearTimeout/sleep` 五个方法。 |
| `lib/commands/_util.mjs` | `arg`、`flag`、`usageFile(config, ctx)`。 |
| `lib/commands/providers/list.mjs` | 输出 `cliworker.providers/v1`，状态经 `providerStatus(config, { ctx })`。 |
| `lib/commands/models/list.mjs` | 输出 `cliworker.models/v1`，`--all` → `includeDeprecated`。 |
| `lib/commands/models/select.mjs` | 沿用 `selectModels` 返回值；`--request` 解析失败抛 `bad --request JSON: …`。 |
| `lib/commands/models/forecast.mjs` | 输出 `cliworker.forecast/v1`，额外传 `now: ctx.now()`。 |
| `lib/commands/usage/record.mjs` | `row.at = row.at \|\| ctx.clock.nowIso()`，`appendUsage(…, ctx)`。 |
| `lib/commands/usage/summary.mjs` | `readUsage(…, ctx)`。 |
| `contracts/context/context.v1.json` | 十个成员的类型表、`fs_methods`(9)、`clock_methods`(5)、`fake_clock_extras`(3)、`test_clock_env`，字段与 design §7.1 逐字一致。 |
| `contracts/host/dsh-host.v1.json` | 宿主/HTTP 契约与 `stub_controllable_inputs`(remoteAddress/host/origin)，与 design §7.2 逐字一致。 |
| `test/helpers/clock.mjs` | `createFakeClock({start})`：`setNow/advance/pending` 与五个时钟方法；`advance` 按 `(到期时间, 序号)` 顺序触发并在回调间让出微任务，`setNow` 不改变已登记定时器的到期时间。 |
| `test/helpers/ctx.mjs` | `fakeExec`（只记 env 键名）、`fakeFs`（内存九方法、路径 `path.resolve` 归一、ENOENT 带 `code`）、`fakeClock`、`fakeFetch`、`fakeStream`、`createFakeContext`（成员恰为契约里的十个）。 |
| `test/helpers/host-stub.mjs` | `createHostStub`：注册校验、`failPaths`/`failInject`、可控的 `remoteAddress`/`host`/`origin`、`request()` 驱动 handler 到 `res.end`。 |
| `scripts/check-seams.mjs` | `scanRoot({root})` + CLI（`--root`、`--json`），十条规则、精确路径允许清单、注释/字符串掩码但保留行号。 |
| `test/fixtures/seams/**` | 12 组夹具（`clean`、`allowed` 与 10 个违规 case），每个违规夹具只有 `lib/bad.mjs` 触发对应规则。 |
| `test/unit/import-safe.test.mjs` | 5 条 `[AC-006]`。 |
| `test/unit/seams.test.mjs` | 5 条 `[AC-007]`。 |
| `test/unit/clock.test.mjs` | 8 条 `[AC-072]`（伪时钟语义 + 真实时钟读文件 + `main` 的 `W_TEST_CLOCK`）。 |
| `test/contract/context.test.mjs` | 6 条 `[AC-072]`（真实 ctx 与 fake ctx 对同一份契约断言）。 |
| `test/contract/host-stub.test.mjs` | 6 条 `[AC-008]`。 |
| `test/integration/registration.test.mjs` | 6 条 `[AC-008]`。 |
| `test/traceability/T-003.json` | AC-006/007/008/072 → covered，内容与 design §10 一致。 |

### 修改

| 文件 | 改动 | 原因 |
|---|---|---|
| `lib/cli.mjs` | 重写为 `export async function main(argv, ctx)`，静态 `ROUTES` 表 + 静态导入的命令模块；导入零副作用；输出写 `ctx.stdout`，错误写 `ctx.stderr` 并返回 `{exitCode}`；新增 `W_TEST_CLOCK` 追加逻辑。 | AC-006、AC-072；移除 `node:fs`、`process.exit` 与导入即执行。 |
| `bin/cliworker.mjs` | 薄封装：`createContext()` + `main(process.argv.slice(2), ctx)`，只设置 `process.exitCode`。 | AC-006；避免截断 stdout。 |
| `lib/index.js` | 导出 `name`/`createPlugin`/`getRegistration`/`apply`；注册结果变成结构化报告（`registered`、`errors`），stderr 提示只是附加信息；`strict` 抛错并挂 `error.registration`；导入不再读 `process.env`。 | AC-008。 |
| `lib/availability.mjs` | 删除本地 `run` 与 child_process 导入；改用 `ctx.exec`；`probe` 为真但缺 `ctx.exec` 时抛 `TypeError`。字段、`state`、`detail` 文案不变。 | AC-007。 |
| `lib/config.mjs` | 删除 `node:fs` 导入；`defaultHome(env)`；`loadConfig({file, ctx})`/`ensureDir`/`readUsage`/`appendUsage` 全部走 `ctx.fs`。其余语义（含 `E_CONFIG`、`readUsage` 出错返回 `[]`）不变。 | AC-007。 |
| `lib/forecast.mjs` | 只改默认值 `now = systemNow()`（新增 `import { systemNow }`）。 | AC-007；保证不传 `now` 时行为与迁移前一致。 |

## 2. 关键决策

- **路由先于配置**：`resolveRoute` 在 `loadConfig` 之前判定，未知命令一律报用法错（design §5.1、§12 已说明这是有意变更）。`providers` 不看子命令，因此 `providers --config x` 仍能路由；`models` 的子命令缺省/`list` 归一为默认路由。
- **`W_TEST_CLOCK` 的边界**：只在成功输出时、且 `ctx.env.CLIWORKER_TEST_CLOCK_FILE` 为非空字符串时追加；环境变量未设置或为空串时不产生 `warnings` 键，输出与迁移前逐字一致（V-072-5/6 覆盖）。
- **报告是实时对象**：`createPlugin` 返回的 `registered`/`errors` 就是内部数组本身，串行注册期间逐条追加；`getRegistration()` 每次调用才做拷贝并按 `errors.length` 现算 `status`，所以延后到达的注册结果也会反映出来。
- **seam 扫描的文本处理**：一次扫描产出两份等长视图——`code`（仅去注释、字符串保留）与 `bare`（再去字符串/模板文本），都保留换行以维持行号。导入类规则在 `code` 上匹配并按字符串区间过滤，因此 `'node:fs'` 这类普通字符串不会被误报；其它规则在 `bare` 上匹配，因此注释与字符串里的 `Date.now()` 不计违规。
- **`new Date` 规则**：`new Date()`、`new Date` 视为违规，`new Date(x)` 不算（按 `(` 后是否为 `)` 判定）。
- **定时器规则只认裸标识符与 `globalThis/global/window`**：`obj.setTimeout`、`ctx.clock.setTimeout` 不在规则内，这也是 `clean` 夹具能保持 0 违规的原因。
- **`fakeFs` 不强制目录存在**：`writeFileSync`/`appendFileSync` 直接写入内存 Map，`mkdirSync` 仅记录调用；这样既满足 `appendUsage` 的 `ensureDir` 流程，也满足 `ctx.fs.writeFileSync('/a/b.txt', …)` 这类无父目录写入的用法。

## 3. 自测

全部在任务 worktree 根执行。逐条结果：

| 命令 | 结果 |
|---|---|
| `node scripts/run-tests.mjs --ac AC-006` | 通过，5 条 `✔ [AC-006]`，`ℹ fail 0`，`run-tests: filtered 1 files` |
| `node scripts/run-tests.mjs --ac AC-007` | 通过，5 条 `✔ [AC-007]`，`ℹ fail 0` |
| `node scripts/run-tests.mjs --ac AC-008` | 通过，12 条 `✔ [AC-008]`，`run-tests: filtered 2 files` |
| `node scripts/run-tests.mjs --ac AC-072` | 通过，14 条 `✔ [AC-072]`，`run-tests: filtered 2 files` |
| `node scripts/check-seams.mjs` | `check-seams: ok (files=15)`，退出码 0 |
| `node scripts/check-traceability.mjs` | `check-traceability: ok (covered=10 planned=64)` |
| `node scripts/check-test-discovery.mjs` | `check-test-discovery: ok` |
| `node scripts/check-frozen-files.mjs` | `check-frozen-files: ok (8 files)` |

acceptance 里每条 `node --input-type=module -e …` 探针都单独跑过并通过：

- V-006-2/3/4/5/6/7、V-007-3/5/6、V-008-2/3/4/5、V-072-2/3/4/5/6/7、V-R-2（JSON 版）、V-R-6 全部输出 `PROBE-OK …`。
- V-007-4 的两条命令：`--root test/fixtures/seams/date-now` 输出两行并以 `check-seams: FAILED (1 violations)` 结尾、退出码 1；`--bogus` 退出码 2、stdout 为空、stderr 含 `usage:`。
- V-006-7 `node bin/cliworker.mjs`：退出码 1、stdout 为空、stderr 以 `ERROR: usage: cliworker providers | models list|select|forecast | usage record|summary` 开头。

`pwsh -NoProfile -File scripts/check-fast.ps1` 的结果：**退出码 1**，23 个测试文件、106 个测试、`pass 105`、`fail 1`，失败项见下一节。`check-seams: ok` 在其中正常出现。

## 4. 已知问题：一条既有测试与 V-R-2 直接冲突（需要任务级裁决）

`test/unit/traceability.test.mjs:158`（T-001 的 AC-004 测试）硬编码断言：

```js
assert.equal(merged.acs['AC-006'], 'planned')
```

它写于 AC-006 还没有任何 shard 的时期。本任务按 design §10 提交 `test/traceability/T-003.json` 把 AC-006 记为 `covered` 后，这一行必然变成 `covered`，该测试因此失败；而 acceptance 的 V-R-2 又明确要求 `check-traceability` 输出 `covered=10 planned=64`（即 AC-006 必须 covered）。两者互斥，不可能同时满足。

我没有修改该文件，因为：

- brief 与 design 的 `write_scope` 不含 `test/unit/traceability.test.mjs`；
- acceptance 的 V-R-5 会把任何 `write_scope` 之外的文件变化判为失败。

建议的处置（需要在 `write_scope` 之外改动，应由该文件所属任务或裁决方执行）：把第 158 行改成 `assert.equal(merged.acs['AC-006'], 'covered')`（或改成断言一个仍然没有 shard 的 AC，例如 `AC-009`）。除此之外 `check-fast` 其余步骤全绿。

## 5. 风险与遗留

- **未验证 `lib/select.mjs` 的 forecast 时间**：它仍用 `forecast()` 的默认值 `systemNow()`，因此 `main` 的伪时钟不会影响 `models select` 内部的 forecast。这是 design §12 明确保留给 T-007 的行为，本任务未改。
- **真实 DSH 若延后调用 inject 回调**：strict 模式只在 `apply` 返回时判定，延后到达的失败不会补抛（design §12 已记录，契约按同步调用写）。
- **`lib/exec.mjs` 的 `shell` 行为原样保留**：Windows 下 `shell: true` 的注入风险归 T-010，本任务不做安全化，避免越界改动。

## 6. 第 2 轮：全量复核与唯一阻塞项

第 1 轮评审给出的唯一 P1 是 `check-fast` 因 `test/unit/traceability.test.mjs:158` 失败。本轮没有改任何 `lib/`、`bin/`、`contracts/`、`test/` 下的实现文件，只重跑验收并复核代码，原因见 §6.3。

### 6.1 本轮复核结果（全部在任务 worktree 根执行）

| 命令 | 结果 |
|---|---|
| `node scripts/run-tests.mjs --ac AC-006` | 5 条 `✔ [AC-006]`，`fail 0`，`filtered 1 files` |
| `node scripts/run-tests.mjs --ac AC-007` | 5 条 `✔ [AC-007]`，`fail 0`，`filtered 1 files` |
| `node scripts/run-tests.mjs --ac AC-008` | 12 条 `✔ [AC-008]`，`fail 0`，`filtered 2 files` |
| `node scripts/run-tests.mjs --ac AC-072` | 14 条 `✔ [AC-072]`，`fail 0`，`filtered 2 files` |
| `node scripts/check-seams.mjs` | `check-seams: ok (files=15)`，退出码 0 |
| `node scripts/check-traceability.mjs` | `check-traceability: ok (covered=10 planned=64)`，退出码 0 |
| `node scripts/check-fast.mjs` | **退出码 1**：106 tests、`pass 105`、`fail 1`，末行 `check-fast: FAILED step npm test (exit 1)` |

acceptance.md 里的 21 条 `node --input-type=module -e …` 探针逐条抽取执行，结果全部为 `PROBE-OK …`、退出码 0：

- AC-006：V-006-2/3/4/5/6（`import-safe`、`main-ctx`、`commands`、`main-errors`、`no-process-exit`）
- AC-007：V-007-3/5/6（`seams-fixtures`、`seams-allowlist-exact`、`seams-real-tree`）
- AC-008：V-008-2/3/4/5（`host-contract`、`host-stub`、`registration`、`handlers`）
- AC-072：V-072-2/3/4/5/6/7（`fake-clock`、`test-clock-file`、`context-contract`、`warn-inproc`、`warn-bin`、`helpers`）
- 总体：V-R-2 的 `trace-T-003`、V-R-5 的 `scope 47`、V-R-6 的 `no-secrets`

两条此前未被完整记录的探针本轮已实测通过：

- **V-006-4**（`PROBE-OK commands`）：`models list` 输出 `cliworker.models/v1` 且 `m1` 的 `callable=true`、`level=Top`；`usage record` 在伪时钟下写出 `recorded.at=2020-01-01T00:00:00.000Z`、`cost_usd=1`，`usage.jsonl` 恰一行；`usage summary` 读到 1 条；`models forecast` 的 `burn_per_hour=60`，说明 forecast 用的是注入的 `ctx.now()`。
- **V-008-4**（`PROBE-OK registration`）：四条路由全部注册、`getRegistration()` 为 `ok`；注入单条失败时 `errors[0].path='/cliworker/models'` 且其余 3 条仍然注册、`status='failed'`、stderr 有该路径的提示；非 strict 全失败只留报告不抛；strict 抛 `cliworker: route registration failed…` 且 `error.registration.status='failed'`。

`V-007-4` 的两条命令与 `V-006-7` 也复跑确认：`--root test/fixtures/seams/date-now` 恰两行、退出码 1；`--bogus` 退出码 2、stdout 为空、stderr 含 `usage:`；`node bin/cliworker.mjs` 退出码 1、stdout 为空、stderr 以用法行开头。

### 6.2 失败详情（与第 1 轮同一处，未扩散）

```
✖ [AC-004] mergeShards treats ACs without a shard as planned
  AssertionError: Expected values to be strictly equal:
  + actual - expected
  + 'covered'
  - 'planned'
  at test/unit/traceability.test.mjs:158:10
ℹ tests 106  ℹ pass 105  ℹ fail 1
```

`test/unit/traceability.test.mjs:151-159` 的断言写于 AC-006 还没有任何分片时，它把 `AC-006` 当作“没有 shard 的 AC”的样本。本任务按 design §10 提交 `test/traceability/T-003.json` 后，`AC-006` 必然变成 `covered`。

### 6.3 为什么本轮不在 `write_scope` 之外修这一行

三条验收要求在同一份仓库状态上互相排斥，而可调和它们的两份文件（`test/unit/traceability.test.mjs`、`acceptance.md` 的 V-R-5 globs）都不在本任务写入范围：

1. **V-R-1** 要求 `check-fast` 退出码 0、`ℹ fail 0`，这要求 `merged.acs['AC-006'] === 'planned'`。
2. **V-R-2** 要求 `check-traceability` 输出 `covered=10 planned=64`，且 `--json` 探针逐个断言 AC-006/007/008/072 为 `covered`，这要求 `merged.acs['AC-006'] === 'covered'`。
3. `mergeShards` 对同一个 AC 只产出一个状态（`test/traceability/*.json` 的 `declared` 映射，见 `scripts/check-traceability.mjs` 的 `mergeShards`），两次读取的是同一个 `test/traceability` 目录，因此 (1) 与 (2) 不可能同时成立。

可行的改动只有三类，都在写入范围之外：

- 改 `test/unit/traceability.test.mjs:158` 为 `'covered'`，或改断言一个仍无分片的 AC（如 `AC-009`，语义上更贴合该测试标题）。**副作用**：该文件不在 V-R-5 的 globs 内，V-R-5 的 `scope` 探针会把它判为 `outside write_scope`，V-R-5 转红。因此这一改动必须与 `write_scope` 和 V-R-5 globs 的同步扩充一起做（即第 1 轮评审 P1 建议的 (a)）。
- 让 `T-003.json` 把 AC-006 记为 `planned`。**副作用**：V-R-2 变成 `covered=9 planned=65` 且 AC-006 失去覆盖证据，与 design §10 直接冲突，失败项从一个变成两个，更差。
- 把该断言的所有权改回 T-001 并在那一侧修。**副作用**：仍要改同一行文件，同样受 V-R-5 限制。

在没有 `write_scope` / V-R-5 globs 扩充的前提下，任何一侧修复都只是把失败项从一个验收条目搬到另一个，总判定仍是 `needs_revision`。因此本轮保持仓库现状：实现与 20/21 条探针全绿，唯一红项的证据就是上面这段输出。

**请求的裁决**（二者取一，均需改 `design.md`/`acceptance.md`，非本角色权限）：

- (a) `write_scope` 增加 `test/unit/traceability.test.mjs`，同时 V-R-5 的 `globs` 增加 `'test/unit/traceability.test.mjs'`，并把第 158 行改为 `assert.equal(merged.acs['AC-006'], 'covered')`（推荐改断言 `AC-009` 以保留该测试的原意）；
- (b) 由设计方把“无分片的 AC 样本”改成一个当前没有 shard 的 AC，并在 T-001 归属下更新该断言。

裁决落地后，本轮无需再改实现代码，只需按 (a)/(b) 改那一行并重跑 `pwsh -NoProfile -File scripts/check-fast.ps1`。

## 7. 第 3 轮：全量复核，无实现改动

### 7.1 本轮改了什么

**没有改任何 `lib/`、`bin/`、`contracts/`、`test/`、`scripts/` 下的文件。** 本轮只重跑验收、复核代码，并把结果写进本报告。

原因：第 1、2 轮评审的唯一 P1 都落在 `test/unit/traceability.test.mjs:158`，该文件不在 `write_scope`；两轮评审建议的裁决（`design.md` 的 `write_scope` 与 `acceptance.md` V-R-5 的 `globs` 同时加入该文件）在本轮开始前仍未落地——`design.md`、`acceptance.md` 的 mtime 是 01:35，早于第 1 轮评审的 01:45。在没有新授权的前提下，改动它会让 V-R-5 转红（见 §7.4），所以维持现状。

第 1、2 轮已提交的实现（§1 的变更清单）本轮逐条复核，与 `design.md` 一致，未发现需要修正的地方：

- `lib/cli.mjs`：`main(argv, ctx)` 返回 `{exitCode}`，先 `resolveRoute` 再 `loadConfig`，成功写 `ctx.stdout`、异常写 `ctx.stderr`；静态 `ROUTES` + 静态导入，导入零副作用。
- `lib/index.js`：`createPlugin` 返回实时 `{registered, errors}`，单条失败不阻塞其余；`inject` 缺失/抛错记 `path:null`；`apply` 的 strict 抛错并挂 `error.registration`。
- `lib/context.mjs` / `lib/exec.mjs` / `lib/availability.mjs` / `lib/config.mjs` / `lib/forecast.mjs` / `lib/commands/**`：注入点替换与 design §2–§5 逐条对应。

### 7.2 复核结果（全部在任务 worktree 根执行）

| 命令 | 结果 |
|---|---|
| `node scripts/run-tests.mjs --ac AC-006` | 5 条 `✔ [AC-006]`，`ℹ fail 0`，`filtered 1 files` |
| `node scripts/run-tests.mjs --ac AC-007` | 5 条 `✔ [AC-007]`，`ℹ fail 0`，`filtered 1 files` |
| `node scripts/run-tests.mjs --ac AC-008` | 12 条 `✔ [AC-008]`，`ℹ fail 0`，`filtered 2 files` |
| `node scripts/run-tests.mjs --ac AC-072` | 14 条 `✔ [AC-072]`，`ℹ fail 0`，`filtered 2 files` |
| `node scripts/check-seams.mjs` | `check-seams: ok (files=15)`，退出码 0 |
| `node scripts/check-traceability.mjs` | `check-traceability: ok (covered=10 planned=64)`，退出码 0 |
| `node scripts/check-test-discovery.mjs` | `check-test-discovery: ok`，退出码 0 |
| `node scripts/check-frozen-files.mjs` | `check-frozen-files: ok (8 files)`，退出码 0 |
| `pwsh -NoProfile -File scripts/check-fast.ps1` | **退出码 1**：106 tests、`pass 105`、`fail 1`，末行 `check-fast: FAILED step npm test (exit 1)` |

`acceptance.md` 的 21 条 `node --input-type=module -e …` 探针本轮全部重跑，全部 `PROBE-OK`、退出码 0：

- AC-006：`import-safe`、`main-ctx`、`commands`、`main-errors`、`no-process-exit`
- AC-007：`seams-fixtures`、`seams-allowlist-exact`、`seams-real-tree`
- AC-008：`host-contract`、`host-stub`、`registration`、`handlers`
- AC-072：`fake-clock`、`test-clock-file`、`context-contract`、`warn-inproc`、`warn-bin`、`helpers`
- 总体：`trace-T-003`、`scope 47`（V-R-5）、`no-secrets`（V-R-6）

非探针命令：

- V-007-4：`--root test/fixtures/seams/date-now` 输出恰两行 `FAIL seams.date_now lib/bad.mjs:2` 与 `check-seams: FAILED (1 violations)`，退出码 1；`--bogus` 退出码 2、stdout 空、stderr 含 `usage:`。
- V-006-7 `node bin/cliworker.mjs`：退出码 1、stdout 空、stderr 以 `ERROR: usage: cliworker providers | models list|select|forecast | usage record|summary` 开头。

合计：AC-006/007/008/072 的 25 条验收项全绿，V-R-2/3/4/5/6 全绿，唯一红项是 V-R-1。

### 7.3 V-R-1 的失败明细（与前两轮同一处）

```
✖ [AC-004] mergeShards treats ACs without a shard as planned
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  + 'covered'
  - 'planned'
  at TestContext.<anonymous> (file:///C:/git/dsh-CLIWorker/.collab/worktrees/003/test/unit/traceability.test.mjs:158:10)
ℹ tests 106  ℹ pass 105  ℹ fail 1
check-fast: FAILED step npm test (exit 1)
```

### 7.4 为什么在 `write_scope` 内无法消除（不可满足性）

同一份仓库状态被三条验收同时约束：

1. **V-R-1** 要求 `ℹ fail 0`，即 `merged.acs['AC-006'] === 'planned'`（`traceability.test.mjs:158`）。
2. **V-R-2** 要求 `covered=10 planned=64`，且 `trace-T-003` 探针逐个断言 AC-006/007/008/072 为 `covered`，即 `merged.acs['AC-006'] === 'covered'`。
3. `scripts/check-traceability.mjs:282-286` 的 `mergeShards` 对每个 AC 只产出**一个**状态；测试与 CLI 读的是同一个 `test/traceability` 目录。

因此 (1) 与 (2) 在同一状态下互斥。能改变 (1) 的只有三种改动，全部在写入范围之外：

| 改动 | 是否可行 | 副作用 |
|---|---|---|
| 改 `test/unit/traceability.test.mjs:158` | 文件不在 `write_scope` | V-R-5 的 `scope` 探针把它判为 `outside write_scope`，V-R-5 转红 |
| 让 `T-003.json` 把 AC-006 记为 `planned` | 文件在范围内，但违反 design §10 | V-R-2 变成 `covered=9 planned=65`，失败项从 1 个变 2 个 |
| 让另一个任务的分片声明 AC-006 | AC-006 的 owner 是 T-003（`contracts/spec/ac-index.json`），别的分片会触发 `shard.not_owner` | 该分片也不在 `write_scope` |

所以在没有新授权时，任何改动都只是把红项从一个验收条目搬到另一个。本轮据此保持仓库现状，把证据留在 §7.3。

### 7.5 请求裁决（与第 1、2 轮一致，本轮给出可直接执行的 diff）

需要 `design.md` 的 `write_scope` 与 `acceptance.md` V-R-5 的 `globs` 同时增设 `test/unit/traceability.test.mjs`，然后按下面任一改法改一行：

```diff
--- a/test/unit/traceability.test.mjs
+++ b/test/unit/traceability.test.mjs
@@ test('[AC-004] mergeShards treats ACs without a shard as planned')
-  assert.equal(merged.acs['AC-006'], 'planned')
+  assert.equal(merged.acs['AC-009'], 'planned')
```

推荐改 `AC-009`（而不是 `'covered'`）：它的 owner 是 T-004、当前没有任何分片，仍是 `planned`，能保留该测试“没有分片的 AC 记为 planned”的原意；改成 `'covered'` 会把这个测试变成同义反复。

裁决落地后无需再改任何实现代码，重跑 `pwsh -NoProfile -File scripts/check-fast.ps1` 应为退出码 0、`ℹ fail 0`、末行 `check-fast: ok`。

## 8. 第 4 轮：复核无改动，死锁仍未解开（等待编排方裁决）

### 8.1 本轮改了什么

**没有改任何文件**（`lib/`、`bin/`、`contracts/`、`test/`、`scripts/` 全部保持第 3 轮提交的状态）。原因：

1. `review-r3.md` 的 P1 明确写「实现代码无其它问题」「dev 的做法正确（如实报告、未越界）」，并把 `test/unit/traceability.test.mjs:158` 定性为 **dev 角色无法自行解开的任务级死锁**，要求编排方/设计方裁决；
2. 裁决所需的两个前置（`design.md` 的 `write_scope`、`acceptance.md` V-R-5 的 `globs` 同时加入该文件）在本轮开始时仍未落地：两份文件 mtime 仍是 01:35，`write_scope` 仍不含 `test/unit/traceability.test.mjs`，`acceptance.md` 全文不含该路径；
3. 在本轮授权的写入范围内不存在任何能改变 `merged.acs['AC-006']` 的杠杆（`test/traceability/T-003.json` 是范围内唯一影响 `mergeShards` 的文件，把它改成 `planned` 只会让 V-R-2 也变红，见 §7.4）。

### 8.2 本轮复核结果（全部在任务 worktree 根实测）

| 命令 | 结果 |
|---|---|
| `node scripts/run-tests.mjs --ac AC-006` | 5 条 `✔ [AC-006]`，`ℹ fail 0`，`filtered 1 files` |
| `node scripts/run-tests.mjs --ac AC-007` | 5 条 `✔ [AC-007]`，`ℹ fail 0`，`filtered 1 files` |
| `node scripts/run-tests.mjs --ac AC-008` | 12 条 `✔ [AC-008]`，`ℹ fail 0`，`filtered 2 files` |
| `node scripts/run-tests.mjs --ac AC-072` | 14 条 `✔ [AC-072]`，`ℹ fail 0`，`filtered 2 files` |
| `node scripts/check-seams.mjs` | `check-seams: ok (files=15)`，退出码 0 |
| `node scripts/check-traceability.mjs` | `ok (covered=10 planned=64)`，退出码 0 |
| `node scripts/check-test-discovery.mjs` | `ok`，退出码 0 |
| `node scripts/check-frozen-files.mjs` | `ok (8 files)`，退出码 0 |
| `node scripts/check-ci.mjs` / `check-defects.mjs` | `ok` / `ok`，退出码 0 |
| `node scripts/check-fast.mjs` | **退出码 1**：`ℹ tests 106 / pass 105 / fail 1`，末行 `check-fast: FAILED step npm test (exit 1)` |

acceptance 的 21 条 `node --input-type=module` 探针本轮逐条重跑，全部 `PROBE-OK`、退出码 0：AC-006 的 `import-safe`/`main-ctx`/`commands`/`main-errors`/`no-process-exit`，AC-007 的 `seams-fixtures`/`seams-allowlist-exact`/`seams-real-tree`，AC-008 的 `host-contract`/`host-stub`/`registration`/`handlers`，AC-072 的 `fake-clock`/`test-clock-file`/`context-contract`/`warn-inproc`/`warn-bin`/`helpers`，总体的 `trace-T-003`/`no-secrets`。非探针项：`--root test/fixtures/seams/date-now` 恰两行且退出码 1、`--bogus` 退出码 2 且 stderr 含 `usage:`、`node bin/cliworker.mjs` 退出码 1 且 stdout 为空。

### 8.3 唯一红项（与前三轮同一行，未扩散）

```
✖ [AC-004] mergeShards treats ACs without a shard as planned
  AssertionError: actual 'covered' / expected 'planned'
  at test/unit/traceability.test.mjs:158:10
ℹ tests 106  ℹ pass 105  ℹ fail 1
check-fast: FAILED step npm test (exit 1)
```

### 8.4 需要的最小裁决（一行，非本角色权限）

```diff
--- a/test/unit/traceability.test.mjs
+++ b/test/unit/traceability.test.mjs
@@ test('[AC-004] mergeShards treats ACs without a shard as planned')
-  assert.equal(merged.acs['AC-006'], 'planned')
+  assert.equal(merged.acs['AC-009'], 'planned')
```

并同时把 `test/unit/traceability.test.mjs` 加入 `design.md` 的 `write_scope` 与 `acceptance.md` V-R-5 的 `globs`。`AC-009` 的属主是 T-004（`contracts/spec/ac-index.json` 已核对），本分支没有任何分片声明它，改完仍是合法的「无分片」样例，判定应为 `check-fast: ok` / `ℹ fail 0`。改 `'covered'` 也能让红色消失，但会把该用例变成同义反复，不推荐。

本轮不代为执行该改动，因为它落在 write_scope 之外，且 V-R-5 会把该文件判为 `outside write_scope`——同一条死锁的镜像。

### 8.5 本轮未做

- 未执行任何 git 命令（本轮角色授权明确禁止），因此 V-R-5 的 `git diff` 探针未复测；按 §1 清单与 design `write_scope` 逐条对照，未见越界，`lib/select.mjs` 未改动。
- 未修改 `brief.md`、`design.md`、`acceptance.md`、`review*.md`、`verdict*.json`、`state.json`、`run.json`；本文件只追加本节。

## 9. 第 5 轮：复核无改动，阻塞项仍是同一个未落地的裁决

### 9.1 本轮改了什么

**没有改任何文件。** 本轮开工时重新读了 `brief.md`、`design.md`、`acceptance.md`：`design.md` 的 `write_scope` 与 `acceptance.md` V-R-5 的 `globs` 仍不含 `test/unit/traceability.test.mjs`，因此 §7.5/§8.4 请求的裁决依旧未落地，`lib/`、`bin/`、`contracts/`、`test/`、`scripts/` 也保持在 `82cfd61` 的状态——`review-r4.md` 已确认该状态除 V-R-1 外全部达标，重写代码只会引入回归风险。

在 `write_scope` 内能影响 `mergeShards` 的只有 `test/traceability/T-003.json`，而 V-R-2 要求 `covered=10 planned=64` 且 `trace-T-003` 探针逐条断言 AC-006/007/008/072 为 `covered`；把它改成 `planned` 会让 V-R-2 与四条 AC 同时变红，所以范围内无解（不可满足性证明见 §7.4，本轮复核仍然成立）。

### 9.2 本轮复核结果（全部在任务 worktree 根实测，与 §8.2 一致）

| 命令 | 结果 |
|---|---|
| `node scripts/run-tests.mjs --ac AC-006` | `pass 5`、`ℹ fail 0`、`filtered 1 files` |
| `node scripts/run-tests.mjs --ac AC-007` | `pass 5`、`ℹ fail 0`、`filtered 1 files` |
| `node scripts/run-tests.mjs --ac AC-008` | `pass 12`、`ℹ fail 0`、`filtered 2 files` |
| `node scripts/run-tests.mjs --ac AC-072` | `pass 14`、`ℹ fail 0`、`filtered 2 files` |
| `node scripts/check-seams.mjs` | `check-seams: ok (files=15)`，退出码 0 |
| `node scripts/check-traceability.mjs` | `ok (covered=10 planned=64)`，退出码 0 |
| `node scripts/check-test-discovery.mjs` | `ok`，退出码 0 |
| `node scripts/check-frozen-files.mjs` | `ok (8 files)`，退出码 0 |
| `node bin/cliworker.mjs` | 退出码 1，stdout 空，stderr 为 `ERROR: usage: cliworker providers | models list|select|forecast | usage record|summary`（V-006-7） |
| `node scripts/check-fast.mjs` | **退出码 1**：`ℹ tests 106 / pass 105 / fail 1`，末行 `check-fast: FAILED step npm test (exit 1)` |

acceptance 的探针本轮逐条重跑，全部 `PROBE-OK`、退出码 0：`import-safe`、`main-ctx`、`commands`、`main-errors`、`no-process-exit`、`seams-fixtures`、`seams-allowlist-exact`、`seams-real-tree`、`host-contract`、`host-stub`、`registration`、`handlers`、`fake-clock`、`test-clock-file`、`context-contract`、`warn-inproc`、`warn-bin`、`helpers`、`trace-T-003`、`no-secrets`。非探针项：`--root test/fixtures/seams/date-now` 恰输出 `FAIL seams.date_now lib/bad.mjs:2` 与 `check-seams: FAILED (1 violations)`、退出码 1；`--bogus` 退出码 2、stdout 空、stderr 含 `usage:`。

### 9.3 唯一红项（第 1–4 轮同一行，未扩散）

```
✖ [AC-004] mergeShards treats ACs without a shard as planned
  AssertionError [ERR_ASSERTION]: actual 'covered' / expected 'planned'
  at test/unit/traceability.test.mjs:158:10
ℹ tests 106  ℹ pass 105  ℹ fail 1
check-fast: FAILED step npm test (exit 1)
```

该断言把 AC-006 当作「没有分片的 AC」的样例；T-003 一旦提交 `test/traceability/T-003.json`（design §10 硬性要求），AC-006 就不再是样例。这不是实现缺陷，而是样例选取与分片落盘互斥。

### 9.4 本轮新增的证据：那行改动确实能收尾

用只读方式复算 `mergeShards({ root: cwd, index })` 的返回（不写任何文件）：

```
node --input-type=module -e "import fs from 'node:fs'; import { mergeShards } from './scripts/check-traceability.mjs'; const index = JSON.parse(fs.readFileSync('contracts/spec/ac-index.json','utf8')); const m = mergeShards({ root: process.cwd(), index }); console.log('errors', m.errors.length); console.log('AC-006', m.acs['AC-006'], 'AC-009', m.acs['AC-009'], 'AC-010', m.acs['AC-010']);"
-> errors 0
-> AC-006 covered AC-009 planned AC-010 planned
```

即 `errors` 为空（`check-traceability` 仍然 `ok`），而 `AC-009`/`AC-010` 仍是合法的「无分片」样例。因此 §8.4 的一行改动（`AC-006` → `AC-009`）不需要再动任何实现或契约，改完 `check-fast` 的唯一红项即消失；remainder 的 105 条测试本轮全绿。

### 9.5 请求（同 §7.5/§8.4，本轮不重复 diff）

1. 由编排方/设计方把 `test/unit/traceability.test.mjs` 加进 `design.md` 的 `write_scope` 与 `acceptance.md` V-R-5 的 `globs`；
2. 允许把该文件第 158 行的 `'AC-006'` 改为 `'AC-009'`；
3. 之后重跑 `pwsh -NoProfile -File scripts/check-fast.ps1`，期望退出码 0、`ℹ fail 0`、末行 `check-fast: ok`。

三条都落在本角色授权之外（第 1、2 条要么改冻结规格，要么改 write_scope 之外的文件，且会让 V-R-5 判为 `outside write_scope`），所以本轮只报告、不代改。若编排方希望由 dev 直接执行第 2 条并接受 V-R-5 的一次性例外，需要显式授权，我可以在下一轮用一条命令完成并给出复测结果。

### 9.6 本轮未做

- 未执行任何 git 命令，V-R-5 的 `git diff` 探针未复测；按 §1 清单与 design `write_scope` 逐条对照，未见越界，`lib/select.mjs` 未改动。
- 未修改 `brief.md`、`design.md`、`acceptance.md`、`review*.md`、`verdict*.json`、`state.json`、`run.json`；本文件只追加本节。
