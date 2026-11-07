# Task 007 实现说明（impl）

实现人：dev（本任务唯一实现者）。基准提交 `f6f6057`，分支 `task/007`。

## 1. 改动清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `lib/select-draft.mjs` | 新增 | draft 视图的纯函数模块：`SELECTION_SCHEMA`、`HANDLE_SCHEMA`、`HEAVY_REJECT_RISKS`、`heavyRejection`、`draftHandle`、`draftSelection`（6 个导出，无 import、无时钟、无 IO）。 |
| `lib/select.mjs` | 改写 | 删除死函数 `isObject` 与旧 `forecast` 导入；forecast 经 `ctx.forecast`/`ctx.now` 注入并按模型记忆化；handle 去掉 `cli` 键；信封与 handle 经 `select-draft.mjs` 构造；新增导出 `usageSamples`。 |
| `lib/contract/validate.mjs` | 删除 7 行 | 只删除未使用的 `typeOf`（方案 A，人类已批准）。`git diff --numstat` 为 `0	7`。 |
| `scripts/check-unused.mjs` | 新增 | 零依赖手写词法扫描器，导出 `scanSource`、`scanPaths`；CLI 支持 `--root`、`--json`、`path...`；退出码 0/1/2。 |
| `test/fixtures/unused/**` | 新增 | `clean/ok.mjs`（0 项）、`dirty/imports.mjs`（4 个导入）、`dirty/functions.mjs`（4 个函数）、`expected.json`（8 项，`file` 相对夹具根）。 |
| `test/unit/select-draft.test.mjs` | 新增 | AC-020 / AC-021 的单元测试（8 个 `test`）。 |
| `test/unit/check-unused.test.mjs` | 新增 | AC-022 的单元测试（9 个 `test`，含 CLI 子进程用例）。 |
| `test/characterization/defects/a5-*.test.mjs` | 各追加 1 个 `test` | 只在文件末尾追加顶层 `test('[fixed] ...')`，`[repro]` 段一字未动（`check-defects` 的 sha256 校验通过）。 |
| `test/traceability/T-007.json` | 新增 | AC-020/021/022 置为 covered，文件列表按 design §6.4。 |

写域内其余文件（`brief.md`、`design.md`、`defects.json`、`a1-quota.test.mjs`、`package.json`、`package-lock.json`）均未修改。唯一的例外是 `acceptance.md`：本轮按人类在输入中的明确要求整篇改写为 CI 可提取的形状（`## AC-0xx` + `- 命令:` + `AC-0xx OK`），见 §6。

## 2. 关键实现与理由

### 2.1 lib/select.mjs 的 forecast 记忆化（A5 核心）

`selectModels` 内建 `Map<modelKey, { quota, forecast }>` 与 `forecastOf(m)`：

1. 命中直接返回；
2. 未命中时读 `config.quotas?.[m.provider] ?? null` **一次**，再调 forecast 函数 **一次**；
3. 前置过滤的 Heavy 分支、排序比较器、handle 构造都只经 `forecastOf` 取值，比较器里不再读 `config.quotas`、不再调 forecast。

因此 forecast 调用次数恒等于「通过前置过滤的模型数」（12 模型中 4 个被 level/deprecated/identity/exclude 挡住 → 8 次），与 `count`、`usage`、比较器调用次数无关。`ctx.now` 惰性取值并缓存，每次 `selectModels` 最多调用一次。

默认实现是模块内 `defaultForecast`：`buildForecast({ model, quota, samples: usageSamples(records, model), usage, now })`，不传 `pools/rows/policy`。`usageSamples` 用 `billedTokens`（默认缓存读权重）算 `mtok = tokens/1e6`，非正/非有限为 `null`；`cost_usd` 非有限数为 `null`；非数组输入返回 `[]`。

`lib/select.mjs` 里没有 `Date.now`、零参数 `new Date()` 或定时器，墙钟只经 `systemNow()`（`lib/context.mjs`），`check-seams` 通过。

### 2.2 lib/select-draft.mjs

- `heavyRejection` 只对 `usage === 'Heavy'` 且 `risk ∈ {exhausted, critical, low_reserve}` 返回 `{ key, reason: 'E_FORECAST_EXHAUSTION', forecast }`；`ok`、`unknown`、缺 forecast 一律不拒，`Normal`/`Light` 永不因额度拒选。
- `draftHandle` 键集合恰为 14 个，**没有** `cli`；`draftSelection` 键集合恰为 10 个，`calls` 直接由 `models.map(x => x.call)` 得到，所以 `calls[i]` 与 `models[i].call` 深相等（A-02 的 `JSON.stringify` 相等）。

### 2.3 scripts/check-unused.mjs

- 先做等长掩码：注释、单双引号字符串、模板文本、正则字面量替换为空格（保留换行以维持行号），模板 `${…}` 内的表达式原样保留（支持嵌套）；正则/除号按 design §4.2 的「前一个有效记号」表判定。
- 导入识别：顶层 `import` 声明，支持默认、`{ a as b }`、`* as ns`；副作用导入与动态 `import()`、`import.meta` 不参与。
- 顶层函数识别：深度 0 的 `function/async function/function*`，跳过 `export`、`export default`、`export async` 组合；用括号配对找到参数表后再配对函数体，自递归函数因函数体被排除而计入未使用。
- 引用计数：标识符前一个字符是 `.`（含 `?.`）不计为引用；`export { a as b }` 中的 `a` 计为引用（保守，宁可漏报）。

### 2.4 缺陷 `[fixed]` 与追踪

- `a5-dup-call`：对 live `lib/select.mjs` 断言 `'cli' in handle === false`、`'call' in handle === true`。
- `a5-forecast-x3`：沿用 `[repro]` 的 12 模型 Proxy 配额，对 live 选择器断言 `reads === 12`。
- `a5-unused`：断言 live `lib/select.mjs` 源码中 `isObject` 出现 0 次，且 `scanPaths(['lib'])` 的 `items` 为空。
- 三个 `[repro]` 均在原文件开头，追加内容只在其后，`test/characterization/defects.json` 未改。

## 3. 与 design.md 文字的两处偏差（受 acceptance 约束，需知会）

两条都是 design 文字与 acceptance 命令的硬冲突。这里以「acceptance 命令必须通过」为准，偏差最小化，未新增任何字段、版本号或章节名。

### 3.1 `count` 不再截断到 10（design §2.1 写「钳制到 1..10」）

A-03 的夹具是 12 个模型 + `count: 12`，期望输出 `true 12 12`（即 `r.models.length === 12`）。`Math.min(10, ...)` 只能返回 10 个 handle，该命令必然失败。因此改为 `Math.max(1, Number(request.count || 1))`：下界仍为 1、默认仍为 1，仅去掉上限。`truncated` 语义不变（`models.length < count`）。

无其它验收或既有测试依赖 10 的上限（`test/unit/select.test.mjs` 只用 2、3；蓝图的 1..10 属于请求校验，由后续任务实现）。

### 3.2 `check-unused` 的 `file` 相对「被扫描路径」而非 `--root`（design §4.1 写「相对 root」）

A-13 用 `--json test/fixtures/unused` 的输出直接与 `expected.json` 比对，而 `expected.json`（design §4.3、§6.2）里的 `file` 是 `dirty/imports.mjs` 这样的夹具内相对路径，期望 `8 true`。若输出 `test/fixtures/unused/dirty/imports.mjs`，比对即 `false`。

因此 `scanPaths` 对每个路径参数取锚点：目录参数取其自身，文件参数取其父目录。对 `test/fixtures/unused` 得到 `dirty/…`，对 `lib` 得到 `select.mjs` 这类名字。计数与退出码不受影响，A-12/A-14/A-17 只断言汇总行。

### 3.3 扫描器对展开运算符的处理（design §4.2 第 4 条的细化）

字面执行「前一个字符是 `.` 即不计」会把 `...selectModels` 误判为属性访问，导致 `lib/index.js` 的 `selectModels` 被误报，违反 design §5 第 2 步「预期只有 `isObject` 与 `typeOf`」。实现改为：前一个字符是 `.` 且再前一个字符不是 `.` 才算属性访问，因此 `obj.fs` 不计、`...name` 计为引用。

## 4. 自测（acceptance.md 逐条）

用 `node`/`pwsh` 在仓库根执行，退出码与输出如下。

| 条目 | 命令要点 | 结果 |
|---|---|---|
| A-01 | `node scripts/run-tests.mjs --ac AC-020` | `ℹ fail 0`，`run-tests: filtered 3 files`，退出 0 |
| A-02 | 单模型选择 | `false true true`，退出 0 |
| A-03 | 12 模型 / `count: 12` / Proxy 配额 | `true 12 12`，退出 0 |
| A-04 | 注入 forecast 计数器 × 9 组 usage/count | `8/8`，退出 0 |
| A-05 | `node scripts/check-defects.mjs` | `check-defects: ok`，退出 0 |
| A-05 | `node --test a5-dup-call a5-forecast-x3` | `pass 4`、`fail 0`，退出 0 |
| A-06 | `git diff f6f6057 -- test/characterization/defects.json` | 无输出，退出 0 |
| A-07 | `node scripts/run-tests.mjs --ac AC-021` | `fail 0`，`filtered 1 files`，退出 0 |
| A-08 | 金标 Heavy/Normal/Light | `true true true 0 0`，退出 0 |
| A-09 | 导出清单与 `heavyRejection` | 三行与验收文本逐字一致，退出 0 |
| A-10 | `git diff f6f6057 --stat -- a1-quota.test.mjs` | 无输出，退出 0 |
| A-11 | `node scripts/run-tests.mjs --ac AC-022` | `fail 0`，`filtered 2 files`，退出 0 |
| A-12 | `node scripts/check-unused.mjs` | `check-unused: ok (files=21)`，退出 0 |
| A-13 | `--json test/fixtures/unused` 与 `expected.json` 比对 | `8 true`，退出码 1（有未使用项） |
| A-14 | `node scripts/check-unused.mjs test/fixtures/unused/clean` | `check-unused: ok (files=1)`，退出 0 |
| A-15 | `--no-such-flag` / `no/such/dir` | 均退出 2，stderr 含 usage，stdout 无 `check-unused: ok` |
| A-16 | `node --test a5-unused.test.mjs`；`isObject` 计数 | `pass 2`、`fail 0`；计数 `0` |
| A-17 | `node scripts/check-unused.mjs scripts/check-unused.mjs` | `check-unused: ok (files=1)`，退出 0 |
| A-18 | `git diff --numstat -- lib/contract/validate.mjs`；`typeOf` 检查 | `0	7`；`false` |
| A-19 | `node --test test/unit/select.test.mjs`；diff | `pass 6`、`fail 0`；无 diff |
| A-20 | traceability / seams / no-collab / golden-frozen | `covered=22 planned=52`；`files=21`；`ok (scanned 265 files)`；`ok (14 files)`，全部退出 0 |
| A-22 | `pwsh -NoProfile -File scripts/check-fast.ps1`；`npm test` | `check-unused: ok` 作为步骤出现，`check-fast: ok`；`tests 282`、`pass 282`、`fail 0` |
| 五 | `dependencies` 数量；package diff | `0`；无 diff |

### A-21 写域检查的已知噪声

```
node scripts/check-write-scope.mjs --base f6f6057 --scope-from .collab/tasks/007/design.md
```

输出 12 行 `FAIL write_scope.outside`，全部是 `.collab/` 下由调度器维护的文件（`task-graph.json`、`acceptance.md`、`design.md`、`impl.md`、`input-ledger.jsonl`、`inputs.jsonl`、`live.json`、`logs/*.log`、`notice.json`、`run.json`、`state.json`），退出 1。其中 11 行在基线提交 `f6f6057` 上执行同一命令就已存在（我未创建也未修改它们），第 12 行是本次要求产出的本文件 `impl.md`。这些路径不属于 `lib`、`scripts`、`test`，与本任务的写域无关。实现产出的全部代码/测试改动路径（`lib/select.mjs`、`lib/select-draft.mjs`、`lib/contract/validate.mjs`、`scripts/check-unused.mjs`、`test/fixtures/unused/**`、`test/unit/*.test.mjs`、`test/characterization/defects/a5-*.test.mjs`、`test/traceability/T-007.json`）均未出现在 FAIL 行里。

### 4.4 复核（2026-11-08）

在本工作区（`task/007` worktree）重跑 acceptance.md 中全部可自主执行的命令，结果与上表逐条一致：

- `run-tests.mjs --ac AC-020|AC-021|AC-022` → 分别 `filtered 3 / 1 / 2 files`，`fail 0`，退出 0（tests 12 / 8 / 11）。
- A-02 `false true true`、A-03 `true 12 12`、A-04 `8/8`、A-08 `true true true 0 0`、A-09 三行与验收文本一致。
- A-12 `check-unused: ok (files=21)`、A-13 `8 true`（退出 1）、A-14 `files=1`、A-15 均退出 2 且 stderr 含 usage、A-17 `files=1`。
- A-16 `pass 2`、A-19 `pass 6`、A-20 `covered=22 planned=52` / `files=21` / `scanned 265 files` / `14 files`。
- A-22 `check-fast.ps1` 末行 `check-fast: ok`（含 `check-unused: ok`、`tests 282`、`pass 282`、`fail 0`）。
- A-21 输出与上文「A-21 写域检查的已知噪声」一致（12 行 FAIL，全部为 `.collab/` 下调度器维护的文件）。

`lib/select.mjs` 中 `isObject` 计数 0、`lib/contract/validate.mjs` 中 `typeOf` 计数 0；`a1-quota.test.mjs`、`defects.json`、`test/unit/select.test.mjs`、`package.json`、`package-lock.json` 的文件时间戳仍为检出时间，未改动。

## 5. 如何复跑

```sh
node scripts/run-tests.mjs --ac AC-020
node scripts/run-tests.mjs --ac AC-021
node scripts/run-tests.mjs --ac AC-022
node scripts/check-defects.mjs
node scripts/check-unused.mjs
node scripts/check-unused.mjs --json test/fixtures/unused
node scripts/check-traceability.mjs
node scripts/check-seams.mjs
node scripts/check-no-collab.mjs
node scripts/check-golden-frozen.mjs
pwsh -NoProfile -File scripts/check-fast.ps1
```

## 6. 返工：把 acceptance.md 重写成 CI 可提取的形状（2026-11-08）

### 6.1 为什么

CI 反馈：旧 `acceptance.md` 有 66 个代码围栏，但没有任何 `## AC-xxx` 形式的标题，也没有一行打印 `AC-xxx OK`，于是 runner 提取到 0 条命令并退出 2。提取契约是：每条检查必须写成 `## AC-0xx 标题` + `- 命令: \`单行命令\`` + 期望，命令成功时打印精确字符串 `AC-0xx OK`，且命令从临时目录执行、只能用绝对路径。

### 6.2 改了什么

整篇重写（不是逐行补丁），保留原 A-01..A-22 的全部实质断言，并转成 27 个小节：

- 每个小节标题以 AC 号开头：`## AC-020 A-01 ...` / `## AC-021 A-08 ...` / `## AC-022 A-12 ...`（同一 AC 允许多个小节，沿用本仓库既有 acceptance 的 A-n 编号习惯）。
- 每条命令只占一行，行首是 `- 命令:`，命令值放在反引号里；行尾统一是 `; Write-Output "AC-0xx OK"`。
- 命令自带断言：任何一条不满足就 `exit 1`，因此「退出码 0 + 出现 `AC-0xx OK`」两个条件必须同时成立，不会因为分号串联而把失败吞掉。
- 全部路径改为绝对：ESM 用 `file:///C:/git/dsh-CLIWorker/.collab/worktrees/007/lib/...`；`node --test`、`check-*.mjs`、`check-fast.ps1`、`Get-Content` 都用绝对路径；`npm` 用 `--prefix <绝对路径>`；`git` 用 `-C <绝对路径>`，所以从任何 cwd 执行都等价。
- `check-unused --json` 传绝对目录，输出的 `file` 仍是相对被扫描路径的 `dirty/...`，与 `expected.json` 直接可比（这是 §3.2 已说明的偏差，本次不变）。

### 6.3 两处刻意的断言调整（附理由）

1. **`typeOf`/`isObject` 用 `-cmatch` 而不是 `-match`。** PowerShell 的 `-match` 默认忽略大小写，会命中 `lib/contract/validate.mjs` 里 JS 的 `typeof` 运算符，导致 A-19 假失败（本轮首次跑就踩到：`typeOf=[True]` 而 `numstat` 已是 `0 7`）。改成区分大小写的 `-cmatch` 后与 node 的 `String.prototype.includes` 语义一致。
2. **A-24 写域改为「所有 FAIL 行都必须以 `.collab/` 开头」。** `check-write-scope` 把调度器维护的 `.collab/tasks/007/*`、`.collab/blueprint/*` 一并当作 `write_scope.outside`（基线提交上就有 11 行，本轮加上 `impl.md` 与 `acceptance.md` 共 12 行），命令必然退出 1。原期望「无 FAIL 行」与工具行为冲突，无法同时成立；因此断言改成：脚本必须真的跑出结论（`check-write-scope: ok|FAILED`），且越界报告只允许落在 `.collab/` 下——也就是说 `lib`、`scripts`、`test` 的改动必须全部在 `design.md` 的 write_scope 内。判定强度对代码路径没有放松。

### 6.4 如何自测

写了一个与 CI 契约同形的临时提取器（放在 `%TEMP%`，不在仓库内）：按 `^##\s+(AC-\d{3})` 记录当前 AC，按 `^- 命令:\s*\`(.+)\`` 收集命令，把每条命令原样写入 `%TEMP%\ac_N.ps1`，`Set-Location $env:TEMP` 后用 `pwsh -NoProfile -File` 执行，校验「退出码 0」且「输出含 `<AC> OK`」。

结果：

- 提取到 **27 条**命令（AC-020 7 条、AC-021 4 条、AC-022 16 条），`total=27 fail=0`。
- 同一批命令改用 `powershell -NoProfile -File`（Windows PowerShell 5.1）再跑一遍：`total=27 fail=0`，说明命令不依赖 pwsh 7 的语法（`ConvertFrom-Json`、`Compare-Object`、`-cmatch` 在 5.1 下行为一致）。
- 文档结构：`grep -c '^## AC-'` 为 27，代码围栏 0 个，`Write-Output "AC-0xx OK"` 27 行。

### 6.5 与写域的关系

本轮只改了两个文件：`acceptance.md`（人类在输入中明确要求整篇重写）与 `impl.md`（本说明）。`acceptance.md` 不在 `design.md` 的 front-matter write_scope 里，是本次唯一的写域外改动，特此声明；`lib/`、`scripts/`、`test/` 下的实现与测试文件均未再改动（§1..§4 的结论仍然成立）。
