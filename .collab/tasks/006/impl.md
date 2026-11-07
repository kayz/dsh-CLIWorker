# Task 006 实现说明

## 改动清单（全部落在 write_scope 内）

| 文件 | 动作 | 内容 |
|---|---|---|
| `lib/pools.mjs` | 新增 | `round3`、`billedTokens`、`normalizeQuota`、`resolveResetAt`、`evaluatePools`、`remainingForModels` |
| `lib/forecast.mjs` | 改写（保留旧导出） | 新增 `DEFAULT_POLICY`、`quantileForUsage`、`confidenceFor`、`classifyRisk`、`burnMtokPerHour`、`etaExhaust`、`buildForecast`，并 `export { round3 }`；`DEFAULT_PRICES`、`normalizePrices`、`estimateCost`、旧 `forecast()` 原样保留（仅加 `@deprecated` 注释） |
| `test/unit/pools.test.mjs` | 新增 | AC-015 的 9 条 quota-shapes 金标 + `normalizeQuota` 五种形状直测；AC-016 的 9 条 b44 金标 |
| `test/unit/forecast-engine.test.mjs` | 新增 | AC-017 的 thresholds/quantiles/confidence/burn-eta 四份金标（21/15/11/14）+ 分位数排序、变异系数、`Date.now` 抛错、`now` 非有限抛 `TypeError` |
| `test/unit/forecast-unknown.test.mjs` | 新增 | AC-018 的 assumed/unknown 语义，全部输出过 `forecast.v1.schema.json`，reason 取自注册表枚举 |
| `test/unit/reset.test.mjs` | 新增 | AC-019 的 `resolveResetAt` 四级优先级 + 伪时钟下 cli 越过清零、config 越过只 `recheck` |
| `test/traceability/T-006.json` | 新增 | AC-015..AC-019 全部 covered，格式与 T-004 一致，无 `baseline` 键 |
| `test/characterization/defects/a1-quota.test.mjs` | 末尾追加 | 只追加一个 `[fixed] [AC-015] live forecast reads percentage and credits quotas`，`[repro]` 未动 |

未改动 `brief.md`、`design.md`、`acceptance.md`、`review*.md`、`verdict*.json`、`state.json`、`run.json`、`task-graph.json`、`contracts/**`，未执行任何 git 写操作。

## 为什么这样实现

- **纯函数 + 显式时间**：`lib/pools.mjs` 不导入任何东西，`now` 一律由调用方以毫秒数传入；两个文件都不出现 `Date.now`、定时器或零参数 `new Date()`。`lib/forecast.mjs` 里 `systemNow` 只保留旧的导入与旧 `forecast()` 默认参数两处，`check-seams` 与门禁 R-3 因此仍然通过。
- **形状兼容**：`capacity_mtok` 的标量值与 `{ value }` 对象、`reading` 与 `used_fraction` 两种读数都接受，`b44-reading-half` 的两种写法都得到 sonnet 剩余 5。
- **金标优先**：阈值表用字面常量实现（`tasks`/`usd`：`<=0` exhausted、`1..2` critical、`3..5` low_reserve、`>=6` ok；`fraction`：`<=0` exhausted、`<0.05` critical、`<0.15` low_reserve、其余 ok），不在运行时读注册表；`classifyRisk` 只接受 `tasks_left`/`tasks_left_basis`/`remaining_fraction`，因此 assumed 值永远无法产出 `ok`/`critical`。
- **浮点**：多池剩余量与 `2 * (1 - 0.6)` 这类结果统一走 `round3`（`toPrecision(15)` 后再 `Math.round`，并把 `-0` 归零）；`classifyRisk` 使用未取整的 `1 - used_fraction`，保证 `0.15` 边界落在 `ok`。
- **重置语义**：按 D-7 裁决，`cli` 来源越过重置才清零并把有效窗口起点改为 `reset_ms`；`config`/`estimated` 越过只置 `recheck: true`。AC-019 的读数时刻取 `11:50:01`，使越过之后年龄仍不超过 600 秒，能区分「保持」与「归零」。
- **burn/eta**：只在 pools 路径且 `status: known` 时计算，取剩余量最小的池（并列取输入顺序第一个），`hours_since_window_start` 用有效窗口起点；`eta` 使用的 burn 正是已 `round3` 的字段值，因此 A-8 的手算 `2026-11-07T12:59:57.840Z` 精确复现。
- **旧 `forecast()` 不动**：`lib/select.mjs` 等调用点仍依赖旧形状（`select.test.mjs` 的 2 样本断言 `tasks_left === 10`），迁移留给 T-007。

## 自测方式

逐条执行了 `acceptance.md` 里的全部 20 段命令（bash，逐段 `spawnSync`），全部退出码 0 且末行匹配：

- A-1..A-4 → `AC-015 OK`（过滤运行选中 2 个文件、9 条金标、`[fixed]` 标题、repro sha256 与前缀 sha256 均未变）
- A-5..A-8 → `AC-016 OK`（9 条 b44 深相等、`{value}` 形状、权重 0/1 得 9/8、A-8 六字段池输出）
- A-9..A-11 → `AC-017 OK`（21/15/11/14 金标、10/15/30、medium/high、墙钟抛错仍工作、NaN 抛 `TypeError`）
- A-12..A-13 → `AC-018 OK`（四份输出过 schema，reason 属枚举，`tasks_left_basis` 无 `assumed`）
- A-14..A-15 → `AC-019 OK`（cli > config > estimated > unknown，越过重置的保持/归零）
- R-1 → `run-tests: full 32 files`、`fail 0`、`T-006 OK`
- R-2 → `check-seams: ok (files=20)`、`check-traceability: ok (covered=19 planned=55)`、`check-golden-frozen: ok (14 files)`、`check-write-scope: ok`
- R-3 → `lib/pools.mjs` 无 `Date.now`/`systemNow`/定时器，`lib/forecast.mjs` 无 `Date.now` 且 `systemNow` 恰 2 次
- R-4 → 8 个文件均无令牌字样
- R-5 → `check-defects: ok` + `check-fast: ok`

另外单独确认：`reproSha256` 仍为 `1dd92cf7…f1ec`；`[fixed]` 打开行前的前缀（LF 归一）sha256 仍为 `68d8df3d…7888c`；全文 `[fixed]` 恰好出现一次。
