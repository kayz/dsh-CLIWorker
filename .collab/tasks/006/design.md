---
write_scope:
  - lib/pools.mjs
  - lib/forecast.mjs
  - test/unit/pools.test.mjs
  - test/unit/forecast-engine.test.mjs
  - test/unit/forecast-unknown.test.mjs
  - test/unit/reset.test.mjs
  - test/traceability/T-006.json
  - test/characterization/defects/a1-quota.test.mjs
---

# Task 006 设计：额度池归一与预测引擎定稿（T-006，M1，纯函数）

继承已写定的 `design.md` 与 `acceptance.md`：导出清单、§3 的公式、§4 的测试划分、§1.1 的前四条裁决，以及验收命令「自包含、最后一行 OK」的写法。这些内容与冻结的 `contracts/golden/**`、`forecast.v1.schema.json`、`registry.snapshot.json`、interfaces §6、§7 和蓝图 design §10.2（D-7）一致，并且保住了 `lib/select.mjs` 仍在调用的旧 `forecast()`，所以保留，不另起字段或函数名。

交班时与方案有关的未提交改动，只有 `.collab/blueprint/cliworker-v2/task-graph.json` 里 T-006 的 `write_scope` 多了 `test/characterization/defects/a1-quota.test.mjs`。这是人类批准写域之后写进任务图的结果，予以保留。实现者不得再改这个文件。`attention.json` 已删除。logs、state、inputs、notice 是调度器文件，不是需求。

人类回答（本轮执行）：批准该测试文件进入 T-006 的 write_scope（主仓库与本工作区的任务图都已写入）。只允许在文件末尾追加 `[fixed]`，不得改动 `[repro]` 块。据此更新 front matter、§1.1 第 5 条、§4、§5、§6、§8 和 `acceptance.md`。

基准：分支 `task/006`，起点提交 `887c7a2115e649e6df5046448dcc97d571e8f660`（`chore(003): mark merged after human permission`）。brief 没有另给验收报告路径。在该提交上：

- `node scripts/check-traceability.mjs` 输出 `check-traceability: ok (covered=14 planned=60)`
- `node scripts/check-defects.mjs` 输出 `check-defects: ok`
- `node scripts/check-seams.mjs` 输出 `check-seams: ok (files=19)`
- `node scripts/check-golden-frozen.mjs` 输出 `check-golden-frozen: ok (14 files)`

权威规格：`.collab/blueprint/cliworker-v2/design.md` §8、§10.2（D-7）、`interfaces.md` §5、§6、§7、§16、`contracts/golden/**`（只读，已由 `contracts/golden/manifest.json` 冻结）、`contracts/schemas/forecast.v1.schema.json`、`contracts/schemas/pool.schema.json`。本文不新增任何契约字段：forecast 输出只用 `forecast.v1.schema.json` 里已有的字段。

## 1. 范围与已确认的事实

- 新增 `lib/pools.mjs`：额度形状归一、多池剩余量、重置时间解析与越过重置的处理、`round3`。
- 改写 `lib/forecast.mjs`：新增预测引擎（分位数、阈值表、置信度、burn、eta、assumed 语义、`buildForecast`）。
- 四个测试文件、追踪分片 `test/traceability/T-006.json`，以及既有 `test/characterization/defects/a1-quota.test.mjs` 末尾追加的一个 `[fixed]` 测试（§8）。
- **保留旧导出不动**：`DEFAULT_PRICES`、`normalizePrices`、`estimateCost`、旧 `forecast()`。原因是 `lib/select.mjs`、`lib/commands/models/forecast.mjs`、`lib/commands/usage/record.mjs`、`test/unit/select.test.mjs` 仍在使用旧形状（该测试用 2 个样本断言 `tasks_left === 10`，新语义下样本不足会得到 null）。这些调用点由 T-007 迁移，不在本任务范围内。旧 `forecast()` 加 `@deprecated` 注释即可。
- 签名里有 `now` 的函数只收显式传入的毫秒数，调用方传 `ctx.clock.now()`；`now` 不是有限数字时抛 `TypeError`，绝不回落到系统时钟。`lib/pools.mjs` 不得出现 `Date.now`、`systemNow`、零参数 `new Date()`、任何定时器。`new Date(ms)` 带参数是 `check-seams` 允许的（它只禁零参数 `new Date()`），ISO 输出用它。`lib/forecast.mjs` 里标识符 `systemNow` 恰好出现 2 次，都在旧 `forecast()`：导入一处、默认参数一处。两个文件都不得出现 `Date.now`。
- 零第三方依赖，Node 20+，ESM。

### 1.1 与蓝图/brief 措辞不一致处的裁决

1. **brief 写「basis 为 assumed」。** 冻结的注册表与 schema 规定 `tasks_left_basis ∈ {tasks, usd, none}`，没有 `assumed`，而 T-006 的 write_scope 不含 `contracts/**`。裁决：样本不足时 `tasks_left_basis = 'none'`，「按假设值」由 `tasks_left_assumed !== null`（且 `tasks_left === null`、`confidence === 'none'`）表达。验收按此断言。
2. **AC-019 与 D-7（design.md §10.2）。** D-7 规定：来自估算的 reset_at 越过只触发复核，不得清零；只有 CLI 上报的 reset_at 越过才清零。裁决：`reset_source === 'cli'` 越过 → used 归零；`config`、`estimated` 越过 → used 保持，并在池明细上置 `recheck: true`。AC-019 的归零断言用 cli 来源的池。
3. **`reading_stale` 不产出。** 注册表枚举里有它，但 b44 金标要求读数过期后改用账本时 `reason` 为 `null`，所以 T-006 不产出 `reading_stale`。
4. **`credits` 剩余为 0、无换算率**：金标 `q-credits-zero` 只要求 `risk: exhausted`。「剩余量确切为 0」是事实，不是假设，所以判 exhausted（见 §3.3 零剩余规则）。
5. **a1-quota 只追加 `[fixed]`。** 人类已批准该文件进入 write_scope。只追加 §8 的那一个测试，不改 `[repro]`。

## 2. 导出清单（函数名固定，金标 `fn` 字段与之对应）

金标里的 `fn` 是 snake_case，导出用 camelCase，测试里用一张映射表对应：

| 金标 `fn` | 导出 | 文件 |
|---|---|---|
| `round3` | `round3(value)` | `lib/pools.mjs`，并在 `lib/forecast.mjs` 里 `export { round3 } from './pools.mjs'` |
| `quantile_for_usage` | `quantileForUsage(samples, usage)` | `lib/forecast.mjs` |
| `confidence` | `confidenceFor(n, cv)` | `lib/forecast.mjs` |
| `classify_risk` | `classifyRisk({ tasks_left, tasks_left_basis, remaining_fraction })` | `lib/forecast.mjs` |
| `burn_mtok_per_hour` | `burnMtokPerHour({ used_mtok, hours_since_window_start })` | `lib/forecast.mjs` |
| `eta_exhaust` | `etaExhaust({ now, remaining_mtok, burn_mtok_per_hour, reset_at })` | `lib/forecast.mjs` |

另有：

- `lib/pools.mjs`：`normalizeQuota(quota)`、`resolveResetAt({ cli, config, window, rows, now })`、`evaluatePools({ models, pools, rows, now, reading_ttl_s, cache_read_weight })`、`remainingForModels(同上)`、`billedTokens(row, cache_read_weight)`。
- `lib/forecast.mjs`：`buildForecast({ model, quota, pools, rows, samples, usage, now, policy })`、`DEFAULT_POLICY`。

`etaExhaust` 的 `now` 与 `reset_at` 约定：函数收毫秒数（`now`）与 ISO 字符串或 null（`reset_at`）。金标里的 `now` 是 ISO 字符串，由测试用 `Date.parse` 转成毫秒再传入。返回值恰好是 `{ eta_exhaust_at, exhausts_before_reset }`，`eta_exhaust_at` 为 `new Date(ms).toISOString()`（带 `.000Z`）或 null。`classifyRisk` 恰好返回 `{ risk, risk_basis }`。`quantileForUsage`、`confidenceFor`、`burnMtokPerHour`、`round3` 返回标量（数字、字符串或 null），测试再包成金标的 `{ value }` 或 `{ confidence }`。

## 3. 公式（全部以金标为准）

### 3.1 通用

- `round3(x)`：四舍五入远离零，保留 3 位。实现：`sign * Math.round(Number((Math.abs(x) * 1000).toPrecision(15))) / 1000`，再 `+ 0` 消除 `-0`（`deepStrictEqual` 区分 `-0`）。金标：`0.0625→0.063`、`0.1875→0.188`、`-0.0625→-0.063`、`1.2344→1.234`、`0→0`。非有限数原样返回。
- `billedTokens(row, w)`：行上有有限数字 `tokens` 时直接用；否则 `input_tokens + output_tokens + cache_write_tokens + w * cache_read_tokens`（缺省按 0），`w` 默认 `DEFAULT_POLICY.cache_read_weight`（0）。手算：容量 10、无读数、窗口内一行 `input_tokens` 1_000_000 且 `cache_read_tokens` 1_000_000，`w` 为 0 时 remaining 9，`w` 为 1 时 remaining 8。
- `DEFAULT_POLICY = { reading_ttl_s: 600, cache_read_weight: 0, usage_estimate_mtok: { Heavy: 2, Normal: 0.5, Light: 0.1 } }`（来自 interfaces §11 的 policy 默认值）。`buildForecast` 的 `policy` 参数浅合并在其上。

### 3.2 分位数、置信度、burn、eta

- `quantileForUsage(samples, usage)`：只取有限数字；`n < 3` 返回 `null`；否则升序排序后取 `sorted[ceil(p*n)-1]`，`p`：Heavy 0.9、Normal 0.5、Light 0.25；usage 缺省或无法识别按 Normal。不要对输入数组原地排序。
- `confidenceFor(n, cv)`：`n=0 → none`；`1..4 → low`；`5..19 → medium`；`>=20 → high`，但 `cv` 为有限数且 `> 1` 时 `high` 降为 `medium`（`cv === 1` 不降）。`cv` 只对 `high` 起作用（`n3-cv5` 仍是 `low`）。
- `burnMtokPerHour({used_mtok, hours_since_window_start})` = `round3(used_mtok / max(hours, 1/60))`。
- `etaExhaust`：`remaining_mtok <= 0` → `eta = now`；`burn <= 0` 或非有限 → `eta_exhaust_at: null`；否则 `eta = now + round(remaining / burn * 3600000)` 毫秒。`exhausts_before_reset = eta < reset_ms`（严格小于，相等为 `false`）；`reset_at` 为 null → `null`；`eta_exhaust_at` 为 null 且剩余 > 0 → `false`。

### 3.3 阈值表与 classifyRisk

阈值与 `contracts/registry.snapshot.json` 的 `thresholds` 一致，**直接用字面常量，不在运行时读注册表**：

- tasks 与 usd 依据：`<=0 exhausted`，`1..2 critical`，`3..5 low_reserve`，`>=6 ok`。
- fraction 依据：`<=0 exhausted`，`<0.05 critical`，`<0.15 low_reserve`，其余 `ok`（比较用未取整的值）。
- 优先级 tasks > usd > fraction > unknown：`tasks_left` 为有限数且 `tasks_left_basis ∈ {tasks, usd}` 时用 tasks 表，`risk_basis` 等于该 basis；否则 `remaining_fraction` 为有限数时用 fraction 表，`risk_basis: 'fraction'`；否则 `{ risk: 'unknown', risk_basis: 'none' }`。`tasks_left` 为负数按 exhausted。
- `classifyRisk` 只返回 `{ risk, risk_basis }`。**它不接收也不使用 `tasks_left_assumed`**，所以 assumed 永远不可能产出 `ok`、`critical` 等。

### 3.4 normalizeQuota（四种形状 + 无）

输入旧式 quota 对象（`remaining_pct`、`remaining`+`unit`、`remaining_usd`，可带 `credits_per_mtok`），各字段**独立**计算，不做互斥：

| 输入 | 产出 |
|---|---|
| `remaining_pct = p` | `remaining_fraction = clamp(p/100, 0, 1)`；`remaining_mtok` 保持 null（无容量） |
| `remaining = r, unit = 'credits'` | `credits_per_mtok > 0` → `remaining_mtok = r / rate`；`r === 0` → `remaining_mtok = 0`（无需换算率）；其余 → `remaining_mtok: null`、`reason: 'credits_conversion_missing'` |
| `remaining = r, unit = 'tokens'` | `remaining_mtok = r / 1e6` |
| `remaining_usd = u` | `remaining_usd = u` |
| 以上都没有 | 全 null，`reason: 'capacity_unknown'` |

返回 `{ remaining_fraction, remaining_mtok, remaining_usd, reason }`，缺项为 null。数值字符串先 `Number()`，非有限数视为缺项。

### 3.5 evaluatePools / remainingForModels（金标 b44）

池输入同时接受金标形状和 interfaces §6 / `pool.schema.json` 的形状。`capacity_mtok` 的值是有限数，或带有限数 `value` 的对象。读数：有对象 `reading` 且 `value` 为有限数时用 `reading.value` 与 `reading.at`；否则有对象 `used_fraction` 且 `value` 为有限数时用 `used_fraction.value` 与 `used_fraction.at`；否则视为没有读数。因此 `b44-reading-half` 若改成 `capacity_mtok` 的值为 `{ value: 10 }`、读数改放在 `used_fraction: { value: 0.5, at: '2026-11-07T09:55:00Z' }`，sonnet 的 `remaining_mtok` 仍是 5。`rows`：`[{ model, tokens | input_tokens…, at }]`，`at` 为 ISO 字符串。

对每个被查询的模型 m、每个把 m 列入 `capacity_mtok` 的池 p：

1. 池的有效重置：`resolveResetAt`（见 §3.6）。若 `reset_source === 'cli'` 且 `now >= reset_ms`：该池的有效窗口起点改为 `reset_ms`，早于 `reset_ms` 的读数视为作废、早于 `reset_ms` 的行不计。若来源不是 cli 且 `now >= reset_ms`：不改动，池明细 `recheck: true`。
2. 读数新鲜：`reading` 存在、未作废，且 `now - reading.at <= reading_ttl_s * 1000`。
3. `used_p`：
   - 新鲜读数：`reading.value + Σ(at > reading.at 且 at <= now 的行的 tokens_i / (cap_p(model_i) * 1e6))`。
   - 否则：窗口内（`start_at <= at <= now`，起点用步骤 1 的有效起点）所有行的同样求和。没有窗口且存在需要计入的行 → 该池 `unknown(window_unknown)`。
   - 参与求和的行里，只要某行的模型在池 p 的 `capacity_mtok` 里没有容量 → 该池 `unknown(ledger_capacity_unknown)`。**只有实际参与求和的行才触发**（新鲜读数之前的行不参与）。
   - `used_p` 夹到 `[0, 1]`。
4. `remaining_p(m) = cap_p(m) * (1 - used_p)`。
5. 模型结果：任一成员池为 unknown → `{ status: 'unknown', remaining_mtok: null, reason: <该原因> }`；没有任何池把 m 列入容量 → `unknown(capacity_unknown)`；否则 `{ status: 'known', remaining_mtok: round3(min_p remaining_p), reason: null }`（多池取最小值）。

`evaluatePools` 返回 `{ [model]: { status, remaining_mtok, remaining_fraction, reason, pools: [...] } }`。`remaining_fraction = round3(min_p (1 - used_p))`；`pools[i] = { pool_id, remaining_mtok, remaining_fraction, used_fraction, used_mtok, reset_at, reset_in_h, reset_source, recheck }`，其中 `used_fraction` 是夹紧后的 `used_p`（不另做 round3），`used_mtok = cap_p(m) * used_p`，`reset_in_h = max(0, round3((reset_ms - now)/3600000))`，无重置时间时为 null。`recheck` 仅当该池来源不是 `cli` 且 `now >= reset_ms` 时为 true，否则 false。`recheck` 与 `used_*` 不进入 forecast/v1 输出（输出里的 `pools[i]` 恰好是 schema 规定的六个字段：`pool_id`、`remaining_mtok`、`remaining_fraction`、`reset_at`、`reset_in_h`、`reset_source`）。没有池时 forecast 的 `pools` 为 `[]`。

`remainingForModels` 是 `evaluatePools` 的投影，每个模型只保留 `{ status, remaining_mtok, reason }`，与金标 `expected` 逐键深相等。

### 3.6 resolveResetAt（AC-019）

`resolveResetAt({ cli, config, window, rows, now })` 返回 `{ reset_at: ISO | null, reset_source }`；`reset_at` 一律规整为 `new Date(ms).toISOString()`（形如 `2026-11-07T12:00:00.000Z`），`rows` 只需有 `at`（ISO 字符串）：

1. `cli` 是可解析的时间 → `{ cli }`；
2. 否则 `config` 可解析 → `config`；
3. 否则 `window.anchor === 'rolling'` 且 `window.length_s > 0`：取 `rows` 中 `now - length_s*1000 < at <= now` 的最早一条，`reset_at = 最早 at + length_s*1000`，来源 `estimated`；没有这样的行 → 下一步；
4. 否则 `{ reset_at: null, reset_source: 'unknown' }`。

`evaluatePools` 从池窗口派生候选：`window.reset_source === 'cli'` 时 `cli = window.reset_at`；`'config'` 或缺省（有 `reset_at` 却没写来源）时 `config = window.reset_at`；来源为 `estimated` 或 `unknown` 时丢弃存量值，重新估算。

### 3.7 buildForecast

入参：`model`（字符串，缺省 `''`）、`quota`（旧式对象，可 null）、`pools`/`rows`（b44 形状，可缺省）、`samples`（`[{ mtok, cost_usd }]`，值可为 null）、`usage`（Heavy/Normal/Light，缺省 Normal）、`now`（必填毫秒数）、`policy`。返回完整的 `cliworker.forecast/v1` 对象：**`forecast.v1.schema.json` 里 `required` 的每个字段都必须出现**，缺值写 null；`schema: 'cliworker.forecast/v1'`。

计算顺序：

1. **剩余量**：`pools` 非空 → `evaluatePools(...)[model]`（`remaining_mtok`、`remaining_fraction`、`reason`）；否则 → `normalizeQuota(quota)`。两者都给时以 pools 为准，且 `quota.remaining_usd` 仍可作为 usd 剩余量。
2. **样本**：`mtok` 为有限数的样本形成 token 序列，`cost_usd` 为有限数的形成成本序列；`tokens_per_task = { p25, p50, p90, n }`，三个分位数各自 `quantileForUsage` 的 Light/Normal/Heavy 结果（`n < 3` 全 null），`n` 为 token 序列长度。
3. **tasks_left**（取用户 usage 对应分位数 q，`q > 0`）：
   - `remaining_mtok` 非 null 且 token 序列分位数有效 → `floor(remaining_mtok / q)`，`tasks_left_basis: 'tasks'`；
   - 否则 `remaining_usd` 非 null 且成本序列分位数有效 → `floor(remaining_usd / q)`，`'usd'`；
   - 否则 `tasks_left: null`、`tasks_left_basis: 'none'`。
4. **tasks_left_assumed**：仅当 `tasks_left === null` 且 `remaining_mtok` 非 null：`floor(remaining_mtok / policy.usage_estimate_mtok[usage])`，否则 null。`tasks_left` 非 null 时它为 null。
5. **risk**：`classifyRisk({ tasks_left, tasks_left_basis, remaining_fraction })`。**零剩余规则**：结果为 `unknown` 且 `remaining_mtok === 0` 或 `remaining_usd === 0` 时，改为 `{ risk: 'exhausted', risk_basis: 'none' }`。写出的 `tasks_left` 与 `tasks_left_assumed` 只允许 null 或 ≥0 的整数（schema 的 minimum）；`Math.floor` 结果为负时写 0。
6. **confidence**：`confidenceFor(n, cv)`，`n = samples.length`（不是过滤后的序列长度）。`cv` 取参与 tasks_left 的那条序列；`tasks_left` 为 null、序列长度 < 2 或均值等于 0 时为 null；否则 `cv = sqrt(sum((x-mean)^2) / n) / mean`（除以 n，是总体标准差）。`samples` 为空时 `none`。20 个样本里 19 个 `mtok` 为 1、1 个为 100 时 `cv > 1`，confidence 为 `medium`；20 个 `mtok` 都是 1 时为 `high`。配额 `{ remaining: 3000000, unit: 'tokens' }`、样本 mtok `[0.1, 0.2, 0.3]` 时，Heavy / Normal / Light 的 `tasks_left` 分别为 10、15、30，`tokens_per_task` 的 p90 / p50 / p25 为 0.3 / 0.2 / 0.1。
7. **status**：`remaining_mtok`、`remaining_fraction`、`remaining_usd` 至少一个非 null 为 `known`，否则 `unknown`（此时 `risk: 'unknown'`、`risk_basis: 'none'`）。
8. **reason**：`unknown` 时取剩余量阶段给出的原因（`credits_conversion_missing`、`ledger_capacity_unknown`、`window_unknown`、`capacity_unknown`）；`known` 时：有效样本不足（`tasks_left === null`）且只有 usd 剩余量 → `usd_samples_missing`，其余样本不足 → `no_samples`；`tasks_left` 非 null → null。
9. **burn / eta**（只在 `pools` 路径、`status: known` 时计算，否则三项 null）：取该模型剩余量最小的池，并列时取 `pools` 输入顺序中的第一个。`burn_mtok_per_hour = burnMtokPerHour({ used_mtok, hours_since_window_start: (now - 有效窗口起点)/3600000 })`，`eta_exhaust_at`/`exhausts_before_reset` 来自 `etaExhaust`，`reset_at` 用该池有效重置。手算（`b44-reading-half` 的 sonnet，无样本，usage Normal）：`remaining_mtok` 5，`remaining_fraction` 0.5，`tasks_left` null，`tasks_left_basis` `none`，`tasks_left_assumed` 10，`confidence` `none`，`risk` `ok`，`risk_basis` `fraction`，`reason` `no_samples`，`burn_mtok_per_hour` 1.667，`eta_exhaust_at` `2026-11-07T12:59:57.840Z`，`exhausts_before_reset` false，`samples` 0；池一条：`pool_id` `claude:plan-5h`，`remaining_mtok` 5，`remaining_fraction` 0.5，`reset_at` `2026-11-07T12:00:00.000Z`，`reset_in_h` 2，`reset_source` `config`（窗口没写来源）。
10. **其余字段**：`burn_per_task = round3(成本序列均值)` 或 null；`samples = samples.length`；`pools` 为各池的六字段（`pool_id`、`remaining_mtok`、`remaining_fraction`、`reset_at`、`reset_in_h`、`reset_source`）；`remaining_mtok`、`remaining_fraction` 输出前 `round3`；`model` 原样。

### 3.8 unknown 语义清单（AC-018）

- 无样本（或 `n < 3`）：`tasks_left: null`、`tasks_left_assumed` 按 policy 估计值算出（需要 `remaining_mtok`）、`tasks_left_basis: 'none'`、`confidence: 'none'`（`n=0` 时；`n=1..2` 为 `low`）、`reason: 'no_samples'`。`tasks_left_basis` 没有 `assumed` 这一枚举值。
- 手算，samples 为空、usage Normal：`{ remaining_pct: 50, remaining: 2000000, unit: 'tokens' }` 得到 `remaining_fraction` 0.5、`remaining_mtok` 2、`tasks_left_assumed` 4、`risk` `ok`、`risk_basis` `fraction`（若误用 assumed 的 4，会得到 `low_reserve`）。只有 `{ remaining: 2000000, unit: 'tokens' }` 时 `tasks_left_assumed` 仍是 4，但 `remaining_fraction` 为 null，`risk` `unknown`、`risk_basis` `none`。
- 此时有 `remaining_fraction` → `risk_basis: 'fraction'`，否则 `risk: 'unknown'`。
- 既无容量也无比例（`remaining_mtok`、`remaining_fraction`、`remaining_usd` 全 null）→ `status: 'unknown'`、`risk: 'unknown'`、`reason` 取自 `forecast_reasons` 枚举（见 `contracts/registry.snapshot.json`）。
- 不允许出现「`tasks_left === null` 且 `risk_basis === 'tasks'`」。

## 4. 测试设计（AC-015 与 AC-016 共用一个文件，其余每个 AC 一个文件，标题带 `[AC-0xx]`）

通用约定：

- 测试标题必须含 `[AC-015]` 等标签（`scripts/run-tests.mjs --ac` 按文件内容里的 `[AC-xxx]` 子串筛文件）。不要在别的 AC 的文件里写这个标签。
- 金标用 `fs.readFileSync(new URL('../../contracts/golden/<f>.json', import.meta.url))` 读取，不得复制进测试。金标里的每个 case 各是一个独立的 `test()`，标题 `[AC-0xx] <case.id>`。AC-015、AC-016 各加一个 `[AC-0xx] golden case count`。AC-017 四个文件各加一个，标题逐字为 `[AC-017] thresholds golden case count`、`[AC-017] quantiles golden case count`、`[AC-017] confidence golden case count`、`[AC-017] burn-eta golden case count`，断言 21、15、11、14。计数必须与磁盘上的金标文件一致。
- 时间只经伪时钟：`createFakeContext({ now })`（`test/helpers/ctx.mjs`），用 `ctx.clock.setNow(ms)`、`await ctx.clock.advance(ms)` 推进，传给引擎的 `now` 永远是 `ctx.clock.now()`。
- 比较方式：对 `expected` 的每个键，`assert.deepStrictEqual(actual[key], expected[key])`；b44 金标因为 `expected` 含完整三键，整体 `assert.deepStrictEqual`。

| 文件 | AC | 内容 |
|---|---|---|
| `test/unit/pools.test.mjs` | AC-015、AC-016 | quota-shapes 金标 9 例（经 `buildForecast`，`samples` 与 `usage` 取自金标）；b44 金标 9 例（经 `remainingForModels`）；`normalizeQuota` 五种形状直测 |
| `test/characterization/defects/a1-quota.test.mjs` | AC-015 | 末尾追加 §8 的一个 `[fixed]` 测试。不改 `[repro]` |
| `test/unit/forecast-engine.test.mjs` | AC-017 | thresholds 金标 21 例、quantiles 15 例、confidence 11 例、burn-eta 14 例（`fn` 分派表）；Heavy/Normal/Light 取 p90/p50/p25 的 `buildForecast` 直测；`Date.now` 被替换成抛错函数时引擎仍工作 |
| `test/unit/forecast-unknown.test.mjs` | AC-018 | unknown 语义；输出用 `lib/contract/validate.mjs` 的 `validate` 对 `forecast.v1.schema.json` 校验；遍历所有无样本输入断言 `risk_basis !== 'tasks'` 且 `risk ∉ {ok, critical}`（除非 fraction 依据） |
| `test/unit/reset.test.mjs` | AC-019 | `resolveResetAt` 四级优先级；下面这组夹具：cli 池在 reset 前 `used_fraction === 0.5` 且 `recheck === false`，越过后 `used_fraction === 0` 且 `recheck === false`；同一夹具改成 `config` 后越过仍是 0.5 且 `recheck === true` |

AC-019 夹具（两步都用 `createFakeContext` 的 `ctx.clock.now()`）：池 `id` `p`，窗口 `start_at` `2026-11-07T07:00:00.000Z`、`reset_at` `2026-11-07T12:00:00.000Z`、`reset_source` `cli`，容量 `{ m: 10 }`，读数 `{ value: 0.5, at: '2026-11-07T11:50:01.000Z' }`，无行，`reading_ttl_s` 600。读数时刻取 11:50:01 而不是 11:50:00，是为了越过重置之后年龄仍不超过 600 秒，否则过期读数会改走空账本，看不出「保持」和「归零」的差别。`setNow(Date.parse('2026-11-07T11:59:59.000Z'))` 时年龄 598 秒，`used_fraction` 为 0.5，`recheck` 为 false。`advance(2000)` 之后 now 为 `2026-11-07T12:00:01.000Z`，年龄恰 600 秒。cli 越过之后 `used_fraction` 为 0，`recheck` 仍为 false。`config` 来源用同一组时间，只把 `reset_source` 改成 `config`：越过之后 `used_fraction` 仍是 0.5，`recheck` 为 true。滚动估算例：`now` `2026-11-07T10:00:00.000Z`，`window.anchor` `rolling`，`length_s` 3600，行的 `at` 为 `08:00`、`09:30`、`09:10`（均 2026-11-07、Z），最早落入窗口的是 `09:10`，`reset_at` 为 `2026-11-07T10:10:00.000Z`，`reset_source` `estimated`。同时给出 cli 与 config 时来源为 `cli`，`reset_at` 规整为 `2026-11-07T12:00:00.000Z`。什么都没有时 `{ reset_at: null, reset_source: 'unknown' }`。

每个新建的测试文件只写自己负责的 `[AC-xxx]` 标签。`pools.test.mjs` 同时写 AC-015 与 AC-016。`--ac AC-016` 只选中 `pools.test.mjs`。`--ac AC-015` 选中两个文件：`pools.test.mjs`，以及追加了 `[AC-015]` 标题的 `a1-quota.test.mjs`（该文件里的 `[repro]` 标题含 `[AC-005]`，过滤 AC-015 时整文件都会跑，`[repro]` 仍须通过）。

各金标 case 数量：quota-shapes 9、b44 9、thresholds 21、quantiles 15、confidence 11、burn-eta 14。数量以仓库里金标文件的实际 case 数为准。

## 5. 追踪分片 `test/traceability/T-006.json`

```json
{
  "task": "T-006",
  "milestone": "M1",
  "entries": [
    { "ac": "AC-015", "status": "covered", "files": ["test/unit/pools.test.mjs", "test/characterization/defects/a1-quota.test.mjs"] },
    { "ac": "AC-016", "status": "covered", "files": ["test/unit/pools.test.mjs"] },
    { "ac": "AC-017", "status": "covered", "files": ["test/unit/forecast-engine.test.mjs"] },
    { "ac": "AC-018", "status": "covered", "files": ["test/unit/forecast-unknown.test.mjs"] },
    { "ac": "AC-019", "status": "covered", "files": ["test/unit/reset.test.mjs"] }
  ]
}
```

格式与 `test/traceability/T-004.json` 一致；不得出现 `baseline` 键；只列属主为 T-006 的 AC。

## 6. 实施步骤

1. 写 `lib/pools.mjs`：`round3`、`billedTokens`、`normalizeQuota`、`resolveResetAt`、`evaluatePools`、`remainingForModels`。
2. 在 `lib/forecast.mjs` 保留旧导出，新增 §2 的函数与 `buildForecast`、`DEFAULT_POLICY`；`export { round3 } from './pools.mjs'`；`forecast.mjs` 导入 `pools.mjs`，反向不得导入（避免循环）。
3. 写四个测试文件，先让金标驱动的用例全部通过，再补直测用例。
4. 写 `test/traceability/T-006.json`。
5. 按 §8 只追加 `a1-quota` 的 `[fixed]` 测试。
6. 自检（顺序）：`node scripts/run-tests.mjs`（完整，退出码 0）、`node scripts/check-seams.mjs`（`check-seams: ok (files=20)`）、`node scripts/check-traceability.mjs`（`check-traceability: ok (covered=19 planned=55)`）、`node scripts/check-golden-frozen.mjs`（仍是 `ok (14 files)`）、`node scripts/check-defects.mjs`（`check-defects: ok`）、`node scripts/check-fast.mjs`（`check-fast: ok`）、`node scripts/check-write-scope.mjs --base 887c7a2115e649e6df5046448dcc97d571e8f660 --scope-from .collab/tasks/006/design.md --scope .collab/tasks/006/** --scope .collab/blueprint/cliworker-v2/task-graph.json`。最后这项多放行的任务图路径，只因为人类批准时已经改过那一行；实现者不得再改它（§8 的 sha256）。不要改 write_scope 之外的文件。

## 7. 风险与边界

- 旧 `forecast()` 与新 `buildForecast()` 并存会让 `select.mjs` 暂时用旧语义；这是有意的，由 T-007 迁移后删除旧函数。
- 浮点：`10 * (1 - 0.6)` 得到 `4.000000000000001`，靠 `round3` 吸收；`classifyRisk` 的 fraction 比较用未取整值，`0.15` 恰为 `ok`（`15/100` 的双精度值等于字面量 `0.15`）。
- 样本中混有 null：token 序列与成本序列各自过滤，互不影响。

## 8. a1-quota 的 [fixed]（人类已批准扩围）

人类已批准：`test/characterization/defects/a1-quota.test.mjs` 进入 T-006 的 write_scope。主仓库与本工作区的任务图都已加上这一项。本任务对这个文件只做一件事：在末尾追加一个 `[fixed]` 测试。不得改 `[repro]` 块，不得在它前面插入 import、注释或空行。

账本 `test/characterization/defects.json` 里 `a1-quota` 的 `owner_task` 是 `T-006`、`ac` 是 `AC-015`、`repro_sha256` 是 `1dd92cf708089283f8e3790273c02ac77c63e0965c6c9d38489c2f236bbdf1ec`。`scripts/check-defects.mjs` 的 `reproSha256` 只哈希列 0 的 `test('[repro]...'` 到列 0 的 `})` 这一段，并先把 CRLF 收成 LF。追加在该段之后，哈希不变。

把当前文件按 LF 归一后的 sha256 是 `68d8df3db41597b8d2810a2335b94ec18857655abb4b63d3e664b9260f47888c`。追加之后，打开行 `test('[fixed] [AC-015] live forecast reads percentage and credits quotas'` 之前的前缀，LF 归一后的 sha256 必须仍是这个值。全文里子串 `[fixed]` 恰好出现 1 次。标题必须逐字是：

`[fixed] [AC-015] live forecast reads percentage and credits quotas`

`hasFixedSection` 只认普通 `test(` / `it(`，不认 `test.skip` 或 `test.todo`。打开行用单引号，与现有 `[repro]` 一致。

测试正文在函数内部 `import('../../../lib/forecast.mjs')`，只调用 live 的 `buildForecast`。不要调用仍保留的旧 `forecast()`，也不要 import `test/fixtures/characterization/v0.1`。`[repro]` 继续对副本断言旧缺陷。`now` 传 `0`。

断言：

1. `quota: { remaining_pct: 5 }`，`samples` 为 3 个 `{ mtok: 0.2, cost_usd: null }`，`usage: 'Normal'`：`remaining_fraction` 为 `0.05`，`remaining_mtok` 为 `null`，`tasks_left` 为 `null`，`tasks_left_basis` 为 `'none'`，`risk` 为 `'low_reserve'`，`risk_basis` 为 `'fraction'`。这 3 个样本不得把 risk 改成 tasks 依据。
2. `quota: { remaining: 1, unit: 'credits' }`，`samples: []`，`usage: 'Normal'`：`reason` 为 `'credits_conversion_missing'`，`risk` 为 `'unknown'`，`risk_basis` 为 `'none'`，`status` 为 `'unknown'`。

T-007 的 outputs 仍写了同一缺陷的 draft 部分，但它的 write_scope 没有这个文件。本任务不写 draft 用例，也不改标题去覆盖那一半。

`.collab/blueprint/cliworker-v2/task-graph.json` 不在本任务的 write_scope 里。实现者不得修改它。其中 T-006 的 `write_scope` 必须与本文 front matter 的 8 条相同、顺序相同。该文件按 LF 归一后的 sha256 是 `794e1a3b0ada3c3689175033b639dbc26b04a0106be078e330325e9d9cd8bc6f`。

AC-015 标成 covered 并且 `[fixed]` 追加之后，`node scripts/check-defects.mjs` 退出码 0，输出 `check-defects: ok`。`node scripts/check-fast.mjs` 退出码 0，输出含 `check-fast: ok`。
