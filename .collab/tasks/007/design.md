---
write_scope:
  - lib/select.mjs
  - lib/select-draft.mjs
  - lib/contract/validate.mjs
  - scripts/check-unused.mjs
  - test/fixtures/unused/**
  - test/unit/select-draft.test.mjs
  - test/unit/check-unused.test.mjs
  - test/characterization/defects/a5-dup-call.test.mjs
  - test/characterization/defects/a5-forecast-x3.test.mjs
  - test/characterization/defects/a5-unused.test.mjs
  - test/traceability/T-007.json
---

# Task 007 设计：选模卫生与 draft 兼容（T-007，M1）

基准：分支 `task/007`，起点提交 `f6f6057`（`chore(006): mark merged after human permission`）。brief 没有另给验收报告路径。在该提交上：

- `node scripts/check-traceability.mjs` 输出 `check-traceability: ok (covered=19 planned=55)`
- `node scripts/check-defects.mjs` 输出 `check-defects: ok`
- `node scripts/check-seams.mjs` 输出 `check-seams: ok (files=20)`
- `node scripts/check-golden-frozen.mjs` 输出 `check-golden-frozen: ok (14 files)`
- `node scripts/check-fast.mjs` 最后一行 `check-fast: ok`
- `node scripts/run-tests.mjs --ac AC-020` 输出 `FAIL run.no_match AC-020`（还没有任何测试带该标签）

权威规格：`.collab/blueprint/cliworker-v2/design.md` §2 第 5 条、§3（缺陷账本与 `[repro]`/`[fixed]` 分段）、`interfaces.md` §1（draft 拒选原因 `E_FORECAST_EXHAUSTION`）、§6（forecast 字段）、`contracts/golden/quota-shapes.json`（AC-015 金标，只读）、`contracts/spec/migration-map.json`（draft 原因映射，只读）。本文不新增任何契约字段、码或 schema 名。

## 0. 写域缺口：人类已裁决（方案 A）

**人类已选方案 A**（用户输入：「lib/contract/validate.mjs added to T-007 write_scope (main and worktree). Delete only the unused function typeOf; do not touch anything else in that file.」）。没有待决问题，不需要 `attention.json`。

AC-022 要求 `check-unused` 对 `lib` 报告 0。`scripts/check-fast.mjs` 会无参运行每个 `scripts/check-*.mjs`，所以 `node scripts/check-unused.mjs` 在 `lib` 上必须退出 0。但基准上 `lib/contract/validate.mjs:45` 有未导出、全仓无引用的 `typeOf`（T-004 遗留），不在 brief 的 write_scope 内。

处理：`lib/contract/validate.mjs` 加入 T-007 的 write_scope（front matter 已含该路径），实现者**只删除 `typeOf` 函数**（第 45–50 行的函数及其后的一个空行，共 7 行），该文件其余内容一字不动，包括不整理格式、不改其它函数。不得靠放宽扫描规则（例如排除 `lib/contract/**`）绕过。

## 1. 范围

- 改写 `lib/select.mjs`：删除死函数 `isObject`；forecast 按模型记忆化（每次 `selectModels` 调用内每个通过前置过滤的模型恰好算一次）；forecast 经 `ctx` 注入；handle 去掉重复的 `cli` 键；改用 `buildForecast`。
- 新增 `lib/select-draft.mjs`：draft 视图的构造与 Heavy 拒选规则。
- 新增 `scripts/check-unused.mjs`、夹具 `test/fixtures/unused/**`、测试 `test/unit/check-unused.test.mjs`。
- 新增 `test/unit/select-draft.test.mjs`。
- 在三个既有缺陷文件末尾各追加 `[fixed]` 测试；新增追踪分片 `test/traceability/T-007.json`。
- 删除 `lib/contract/validate.mjs` 中的 `typeOf`（按 §0，人类已批准）。

### 1.1 不做的事与裁决

1. **`a1-quota.test.mjs` 不在 write_scope。** 它归 T-006，且 `[repro]` 的哈希已登记。brief 里「a1-quota 的 draft 部分 [fixed]」改为在 `test/unit/select-draft.test.mjs` 里断言（AC-021），不碰 `a1-quota.test.mjs`。
2. **旧 `forecast()` 保持导出。** `lib/index.js`、`lib/commands/models/forecast.mjs`、`lib/commands/usage/record.mjs`（`estimateCost`）、`test/unit/select.test.mjs` 仍在使用 `lib/forecast.mjs` 的旧导出，该文件不在 T-007 范围。`select.mjs` 只是不再调用旧 `forecast()`。
3. **`W_DRAFT_DEPRECATED`、`W_FIELD_IGNORED` 等警告、v1 视图、请求校验不做。** 它们是后续任务（T-008 及以后）的范围。本任务的 draft 视图只是现有返回结构去掉 `cli` 键。
4. **`lib/commands/models/select.mjs` 与 `lib/index.js` 不改。** 它们调用 `selectModels(config, req, { status, usage })` 不带 `ctx`，新代码对此兼容（见 §2.2 的回落规则）。把真实 `ctx` 传下去留给后续任务。
5. **`test/unit/select.test.mjs` 不改，必须继续通过。**
6. **`[repro]` 块一字不改。** `defects.json` 登记了它们的 sha256；三个缺陷文件只在末尾追加 `[fixed]` 测试，且写成顶层 `test('[fixed] ...')`，不放进 `describe`。

## 2. lib/select.mjs

### 2.1 保持不变

`SCHEMA`、`LEVELS`、`USAGES`、`listModels` 的行为与输出、`cliCall`、前置过滤的顺序和拒选原因字符串（`excluded`、`not_in_workspace_order`、`level:<Level>`、`availability:<state>`、`identity_unverified`、`readonly_unavailable`）、排序键、`count` 钳制到 1..10。`stable.test.mjs` 只 import v0.1 副本，不受影响。

### 2.2 `selectModels(config, request = {}, { status = {}, usage = [], ctx } = {})`

新增可选的 `ctx`，仅两个用途，都可缺省：

- `ctx.forecast`：可选函数。有则用它算每个模型的 forecast，没有则用默认实现（§2.3）。调用参数是一个对象：`{ model, prices, quota, records, usage, now }`，其中 `model` 是模型 key，`prices` 是 `m.prices`，`quota` 是 `config.quotas?.[m.provider] ?? null`，`records` 是传入的 `usage` 数组，`usage` 是归一化后的 `Heavy|Normal|Light`，`now` 是毫秒时间戳。返回值须是 `cliworker.forecast/v1` 形状（至少含 `risk`、`tasks_left`）。
- `ctx.now`：可选函数。取 `now` 时：`typeof ctx?.now === 'function' ? ctx.now() : systemNow()`（`systemNow` 从 `./context.mjs` 导入，这是 `check-seams` 允许出现墙钟的唯一位置）。每次 `selectModels` 调用最多取一次，且只在第一次真正需要 forecast 时取。`select.mjs` 里不得出现 `Date.now`、零参数 `new Date()`、任何定时器。

### 2.3 记忆化规则（A5 的核心）

在 `selectModels` 内建一个 `Map<modelKey, { quota, forecast }>`，函数 `forecastOf(m)`：

1. 缓存命中直接返回。
2. 未命中：读 `config.quotas?.[m.provider]` **恰好一次**，把值存进条目，再调用 forecast 函数**恰好一次**，存进条目。
3. 前置过滤、Heavy 拒选、排序比较器、handle 构造都只通过 `forecastOf` 取 forecast 和 quota。禁止在比较器或 handle 构造里直接读 `config.quotas` 或调用 forecast 函数。
4. 只有通过全部前置过滤（exclude、候选范围、level、可用性、identity、readonly）的模型才会进入 `forecastOf`。因此 forecast 调用次数 = 通过前置过滤的模型数，与 `count`、`usage`、比较器调用次数无关；被 Heavy 拒选的模型也算通过前置过滤，也算一次。

默认 forecast 实现（模块内函数，不导出）：

```
buildForecast({ model, quota, samples: usageSamples(records, model), usage, now })
```

不传 `pools`、`rows`、`policy`。

导出 `usageSamples(records = [], model)`：只取 `row.model === model` 的行，每行映射为 `{ mtok, cost_usd }`：

- `mtok` = `billedTokens(row) / 1e6`（`billedTokens` 从 `./pools.mjs` 导入，默认缓存读权重）；若结果不是大于 0 的有限数则为 `null`。
- `cost_usd` = `row.cost_usd` 为有限数则取它，否则 `null`。

输入不是数组时返回 `[]`。

### 2.4 Heavy 拒选与 handle

- 拒选判断写在 `lib/select-draft.mjs`（§3），`select.mjs` 在前置过滤的最后一步调用它。拒选条目形状与基准一致：`{ key, reason: 'E_FORECAST_EXHAUSTION', forecast }`。
- 排序：键不变（Heavy：`[unknown, -(tasks_left ?? -1), price, key]`；Light：`[price, unknown, key]`；其余：`[unknown, price, key]`），`unknown` 取 `forecast.risk === 'unknown'`。
- handle 与返回信封都经 `lib/select-draft.mjs` 构造（§3）。`select.mjs` 的 `SCHEMA` 常量改为从 `select-draft.mjs` 取值后重导出，字符串仍是 `cliworker.selection/v1`。

## 3. lib/select-draft.mjs

纯函数模块，不 import `select.mjs`（单向依赖，避免环），不碰时钟、文件、环境变量。导出（名字固定）：

| 导出 | 说明 |
|---|---|
| `SELECTION_SCHEMA` | `'cliworker.selection/v1'` |
| `HANDLE_SCHEMA` | `'cliworker.handle/v1'` |
| `HEAVY_REJECT_RISKS` | 冻结数组 `['exhausted', 'critical', 'low_reserve']` |
| `heavyRejection({ key, usage, forecast })` | `usage === 'Heavy'` 且 `HEAVY_REJECT_RISKS.includes(forecast?.risk)` 时返回 `{ key, reason: 'E_FORECAST_EXHAUSTION', forecast }`，否则 `null`。`unknown` 与 `ok` 不拒；`Normal`、`Light` 永不拒。 |
| `draftHandle({ model, call, forecast, quota, adapter })` | 返回 handle，键恰为：`schema, key, provider, id, level, adapter, identity, identity_group, vendor, readonly, prices, quota, forecast, call`。**没有 `cli` 键**。`model` 是 `listModels` 的一项，`adapter` 为 `config.providers[provider]?.adapter ?? null`。 |
| `draftSelection({ request, level, usage, models, rejected, reason = null, count = 1 })` | 返回信封，键恰为：`schema, ok, request, level, usage, models, calls, rejected, reason, truncated`。`ok = models.length > 0`；`calls = models.map((x) => x.call)`；`truncated = models.length < count`；`reason` 在 `models` 为空且调用方没给时为 `'no_eligible_model'`，有模型时为 `null`。缺 level 的路径传 `level: null`、`reason: 'E_LEVEL_REQUIRED'`、`count: 0`。 |

`handle.cli` 与 `handle.call` 在基准里是同一个对象（`a5-dup-call` 的 `[repro]` 断言 `deepEqual`）。新实现里 `call` 是 handle 上唯一的调用模板，信封的 `calls` 数组项与对应 `handle.call` 深相等。

## 4. scripts/check-unused.mjs

零依赖的扫描器，手写词法扫描，不用 AST。

### 4.1 命令行

```
node scripts/check-unused.mjs [--root <dir>] [--json] [path...]
```

- 不带 `path` 时扫描 `lib`；`path` 相对 `--root`（默认仓库根）。目录递归，只取 `.mjs`、`.js`、`.cjs`，按码点排序。
- 文本输出，每条一行：`<posix 相对路径>:<行号> unused-import <名字>` 或 `unused-function <名字>`；最后一行：无结果 `check-unused: ok (files=N)`，有结果 `check-unused: FAIL (N unused)`。
- `--json`：stdout 只输出一个 JSON：`{"files":N,"items":[{"file":"<相对 root 的 posix 路径>","line":1,"kind":"import|function","name":"..."}]}`，`items` 按 `file`、`line`、`name` 排序。
- 退出码：无未使用项 0；有 1；用法错误（未知参数、路径不存在）2，错误写 stderr。
- 与其它 `check-*.mjs` 一致，只在作为入口运行时执行 `main`，被 import 时无副作用。
- 导出 `scanSource(source)` 返回 `[{ line, kind, name }]`，导出 `scanPaths(paths, { root })` 返回 `{ files, items }`（`items` 同 `--json` 的 `items`）。

### 4.2 扫描规则

1. **预处理**：去掉 `//` 与 `/* */` 注释、单双引号字符串、模板字符串的文本部分；模板里 `${…}` 内的表达式保留（支持嵌套）。正则字面量按前一个有效记号判断：前一个记号缺失，或是 `( , = : [ ! & | ? { } ; + - * % < > ~ ^`，或是关键字 `return typeof case in of delete void throw new else do` 时，`/` 起始一个正则，整段跳过（含其中的引号）；其余情况是除号。
2. **未使用导入**：顶层 `import` 声明（可跨行）里的每个本地绑定——默认导入、命名导入（`a as b` 取 `b`）、命名空间导入（`* as ns`）。除 import 声明本身外，该标识符在文件里出现 0 次即报告。副作用导入 `import 'x'` 与动态 `import(…)`、`import.meta` 不报告。
3. **未使用顶层函数**：花括号深度 0 的 `function name`、`async function name`、`function* name` 声明，且前面没有 `export`。除声明自身的名字和它自己的函数体（从声明的 `{` 到配对的 `}`）外，该标识符出现 0 次即报告，因此只有自递归的函数也算未使用。`export function`、`export default function` 不报告。
4. **引用计数**：标识符记号 `[A-Za-z_$][\w$]*`，前一个字符是 `.`（含 `?.`）的不计（属性访问不是引用）；对象字面量的键 `{ a: 1 }` 无法可靠区分，按引用计。`export { a }`、`export { a as b }` 里的 `a` 计为引用。这条规则偏保守：宁可漏报，不可误报。
5. 已知限制：正则字面量判断是启发式的；不分析 `const f = () => {}` 形式的函数（brief 只要求导入和顶层函数）。

### 4.3 夹具 `test/fixtures/unused/`

夹具文件不会被执行（`test/fixtures` 不参与测试发现）。结构与内容如下，实现者可调整无关代码，但名字、数量和每条的「应报告/不应报告」必须保持：

- `expected.json`：`{ "items": [ { "file": "dirty/imports.mjs", "kind": "import", "name": "fs" }, … ] }`，`file` 相对夹具根；不含行号。
- `clean/ok.mjs`：应报告 0 项。包含：所有导入都被使用；一个只在模板 `${…}` 里使用的导入；一个只在对象简写 `{ helper }` 里使用的函数；一个先使用后声明（提升）的函数；`function viaExportList() {}` 加 `export { viaExportList }`；`export function` 一个；副作用导入 `import 'node:process'`；一个含引号的正则字面量如 `/["']/`，其后的代码仍被正确扫描；注释和字符串里提到的名字不影响结果。
- `dirty/imports.mjs`：应报告 4 项导入：`fs`（默认导入，未使用）、`readFileSync`（`import { readFileSync, existsSync } from 'node:fs'` 中未使用的那个，`existsSync` 被使用）、`joinPath`（`import { join as joinPath } from 'node:path'`，别名未使用，`join` 只出现在注释里）、`os`（`import * as os from 'node:os'`，只在注释和字符串里出现）。
- `dirty/functions.mjs`：应报告 4 项函数：`deadHelper`、`deadAsync`（async）、`deadGen`（生成器）、`deadRecursive`（只有自递归）。同文件里 `liveHelper`（被 `exportedUnused` 调用）和 `export function exportedUnused` 不报告。

合计 8 项（4 导入 + 4 函数）。

## 5. 实现步骤

1. 先写 `scripts/check-unused.mjs` 与夹具，用夹具自测（`check-unused.test.mjs`）确认 8 项恰好命中。
2. 运行 `node scripts/check-unused.mjs`，列出 `lib` 上的全部报告。预期只有 `lib/select.mjs` 的 `isObject` 和 `lib/contract/validate.mjs` 的 `typeOf`。若还有别的（尤其在 write_scope 之外的文件），先核对是不是扫描器误报；确是真未使用且不在写域内，写入 `impl.md` 并停下，不要擅自改文件。
3. 写 `lib/select-draft.mjs`。
4. 改 `lib/select.mjs`（§2），删 `isObject`；确认自己引入的每个 import 都被使用。
5. 按 §0（已批准的方案 A）删除 `lib/contract/validate.mjs` 的 `typeOf`，只删这一个函数。
6. 写 `test/unit/select-draft.test.mjs`、三个缺陷文件的 `[fixed]` 追加、`test/traceability/T-007.json`。
7. 跑验收文件里的全部命令，最后跑 `pwsh -NoProfile -File scripts/check-fast.ps1`。

## 6. 测试设计

所有测试标题带 AC 标签，形如 `[AC-020] ...`，缺陷追加的写成 `[fixed] [AC-020] ...`。用 Node 内置 `node:test`，不用第三方库。

### 6.1 test/unit/select-draft.test.mjs

AC-020：

- 单模型成功选择：handle 的键集合恰等于 §3 表里的键；`'cli' in handle === false`；`'call' in handle === true`；`result.calls[0]` 深相等 `handle.call`。
- 计数器：构造 12 个模型（同一 provider，其中 1 个 level 不符、1 个 deprecated、1 个 `identity` 为 `unverified`、1 个在 `request.exclude` 里，其余 8 个通过）。注入 `ctx = { forecast(args) { calls.push(args.model); return …有效的 forecast… } }`。对 `usage ∈ {Normal, Light, Heavy}`、`count ∈ {1, 3, 8}` 的每个组合，`calls.length === 8` 且 `new Set(calls).size === 8`。
- 调用参数形状：每次调用的参数含 `model`、`prices`、`quota`、`records`（与传入的 `usage` 数组是同一个引用）、`usage`、`now`。
- 默认路径：不带 `ctx.forecast`，带 `ctx = { now: () => 固定毫秒 }` 与若干 usage 记录，`handle.forecast.schema === 'cliworker.forecast/v1'`。
- `usageSamples`：按 model 过滤；`input_tokens`、`output_tokens` 之和转 Mtok；token 为 0 时 `mtok` 为 `null`；`cost_usd` 非有限数时为 `null`；输入不是数组返回 `[]`。

AC-021：

- 读取 `contracts/golden/quota-shapes.json`（只读）。对每个有 `expected.risk` 的用例建一个 Quick 级模型、一个独立 provider；`config.quotas[provider] = case.input.quota`；注入 `ctx.forecast = (a) => buildForecast({ quota: a.quota, samples: 该用例的 input.samples, usage: a.usage, now: 0 })`。
- `usage: 'Heavy'`、`count: 10`：`rejected` 里 `reason === 'E_FORECAST_EXHAUSTION'` 的 key 集合恰等于 `expected.risk ∈ {exhausted, critical, low_reserve}` 的用例集合；其余用例（`ok`、`unknown`）全部在 `models` 里。集合比较，不比较顺序。
- `usage: 'Normal'` 与 `'Light'`：同一批用例中没有任何 `E_FORECAST_EXHAUSTION` 拒选，全部进入 `models`。
- `heavyRejection` 直接单测：三种高风险拒、`ok`/`unknown`/缺 forecast 不拒、非 Heavy 不拒。
- 走真实 usage 记录路径的一条：用金标 `q-usd` 的 quota 与由其样本构造的 usage 记录（`model` 为模型 key、`cost_usd` 取样本值），不注入 `ctx.forecast`，Heavy 下该模型不被拒（`risk: ok`）。

### 6.2 test/unit/check-unused.test.mjs（AC-022）

- 对 `test/fixtures/unused` 调 `scanPaths`，取 `(file, kind, name)` 排序后深相等 `expected.json` 的 `items`（8 项）。
- `clean/` 子目录报告 0 项。
- `scanPaths(['lib'])` 报告 0 项（依赖 §0 已批准的 `typeOf` 删除）。
- 子进程运行 CLI：夹具目录退出码 1，`--json` 的 stdout 可解析且 `items` 与 `expected.json` 一致；`lib` 退出码 0 且最后一行以 `check-unused: ok (files=` 开头；未知参数退出码 2。
- `scanSource` 单测：注释、字符串、模板文本里的名字不算引用；模板 `${x}` 里的算引用；`obj.fs` 不算引用；含引号的正则不让后续扫描错位；`export { a as b }` 把 `a` 算引用。

### 6.3 三个缺陷文件的 `[fixed]` 追加

- `a5-dup-call.test.mjs`：`[fixed] [AC-020]` 对 **live** `lib/select.mjs`（`../../../lib/select.mjs`，写法同 `a1-quota.test.mjs` 的 `[fixed]`）选一个 Quick 模型：`'cli' in handle === false`、`'call' in handle === true`。
- `a5-forecast-x3.test.mjs`：`[fixed] [AC-020]` 沿用 `[repro]` 的 12 模型 Proxy 配置，对 live `selectModels` 且 `count: 12`，断言 `reads === 12`（每个模型读一次 quota）。
- `a5-unused.test.mjs`：`[fixed] [AC-022]` 断言 live `lib/select.mjs` 源码里 `isObject` 出现 0 次；并用 `scanPaths(['lib'], { root: 仓库根 })` 断言 `items` 为空数组（import 路径 `../../../scripts/check-unused.mjs`）。

### 6.4 test/traceability/T-007.json

```json
{
  "task": "T-007",
  "milestone": "M1",
  "entries": [
    { "ac": "AC-020", "status": "covered", "files": ["test/unit/select-draft.test.mjs", "test/characterization/defects/a5-dup-call.test.mjs", "test/characterization/defects/a5-forecast-x3.test.mjs"] },
    { "ac": "AC-021", "status": "covered", "files": ["test/unit/select-draft.test.mjs"] },
    { "ac": "AC-022", "status": "covered", "files": ["test/unit/check-unused.test.mjs", "test/characterization/defects/a5-unused.test.mjs"] }
  ]
}
```

## 7. 风险与注意事项

1. **行为变化是预期的**：handle 的 `forecast` 从旧形状换成 `cliworker.forecast/v1`（`surfaces.json` 的 `semantic_change` 已列 `forecast.tasks_left`、`forecast.risk`、`handle.cli_removed`）。`test/unit/select.test.mjs` 不依赖 handle 的 forecast 字段。
2. **`check-seams`**：`select.mjs`、`select-draft.mjs` 里不得出现裸 `Date.now`、零参数 `new Date()`、全局定时器；`check-unused.mjs` 不涉及时钟。
3. **`check-no-collab`**：所有新文件不得出现对 `.collab` 的引用。
4. **扫描器自检的循环性**：`check-unused.mjs` 自己也在 `scripts/` 下，不在默认扫描范围内，但它的源码不应留下未使用的导入或函数。
5. **不要为了让 `lib` 报告 0 而放宽扫描规则**（例如把 `lib/contract/**` 排除）；那样会让 AC-022 失去意义。
6. 令牌和密钥不得进入仓库、日志或 JSON 输出：本任务不读取任何凭据，夹具和测试里也不要放真实密钥。
