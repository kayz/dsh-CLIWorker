# Task 006 验收标准

规格来源：同目录 `design.md`。brief 没有给出既有验收报告路径。基准提交是 `887c7a2115e649e6df5046448dcc97d571e8f660`（`chore(003): mark merged after human permission`，分支 `task/006` 的起点）。在该提交上：

- `node scripts/check-traceability.mjs` 输出 `check-traceability: ok (covered=14 planned=60)`
- `node scripts/check-defects.mjs` 输出 `check-defects: ok`
- `node scripts/check-seams.mjs` 输出 `check-seams: ok (files=19)`
- `node scripts/check-golden-frozen.mjs` 输出 `check-golden-frozen: ok (14 files)`

完成后追踪应为 `covered=19 planned=55`。`check-fast` 退出码 0 不是通过条件：AC-015 标成 covered 之后，`check-defects` 会因 `a1-quota` 没有 `[fixed]` 段失败，而该文件不在 write_scope（design §8，`attention.json` 仍待回答）。

约定：

- 工作目录是仓库根。每条命令自包含，不依赖其它小节的变量。
- 命令在 bash 与 pwsh 下都能原样运行：`-e` 用双引号包裹，JS 只用单引号，不含 `$`、反引号和 `!`。
- 通过时 stdout 的最后一行是该小节写明的 OK 行，退出码 0。任一断言失败则退出码非 0。
- 判定：退出码 0，且 stdout 含该 OK 行。

## AC-015 A-1 过滤运行

```
node --input-type=module -e "import { spawnSync } from 'node:child_process'; const r = spawnSync(process.execPath, ['scripts/run-tests.mjs', '--ac', 'AC-015'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); const o = (r.stdout || '') + (r.stderr || ''); if (r.status === 0) { /* ok */ } else { console.error(o); process.exit(1); } const lines = o.trim().split(/\r?\n/); const last = lines[lines.length - 1]; if (last.startsWith('run-tests: filtered 1 files, manifest ') === false) { console.error(last); process.exit(1); } if (o.indexOf(String.fromCharCode(10006)) >= 0) process.exit(1); if (o.includes('fail 0') === false) process.exit(1); const ids = ['q-pct-5','q-pct-4','q-pct-0','q-pct-15','q-credits-no-rate','q-credits-zero','q-credits-rate','q-tokens','q-usd']; for (const id of ids) { if (o.includes('[AC-015] ' + id) === false) { console.error(id); process.exit(1); } } if (o.includes('[AC-015] golden case count') === false) process.exit(1); console.log('AC-015 OK')"
```

- 期望: stdout 最后一行是 `AC-015 OK`，退出码 0。
- 期望: `run-tests` 选中 1 个文件，9 个 quota-shapes case 标题和 `[AC-015] golden case count` 都出现，没有失败标记，且含 `fail 0`。

## AC-015 A-2 金标深相等

```
node --input-type=module -e "import fs from 'node:fs'; import assert from 'node:assert/strict'; import { buildForecast } from './lib/forecast.mjs'; const g = JSON.parse(fs.readFileSync('contracts/golden/quota-shapes.json', 'utf8')); if (g.cases.length === 9) { /* ok */ } else process.exit(1); for (const c of g.cases) { const actual = buildForecast({ quota: c.input.quota, samples: c.input.samples, usage: c.input.usage, now: 0 }); for (const key of Object.keys(c.expected)) assert.deepStrictEqual(actual[key], c.expected[key], c.id + ' ' + key); } console.log('AC-015 OK')"
```

- 期望: stdout 最后一行是 `AC-015 OK`，退出码 0。
- 期望: quota-shapes 的 9 个 case，`buildForecast` 在 `expected` 的每个键上与金标深相等。

## AC-015 A-3 旧 forecast 仍给出 tasks_left 10

```
node --input-type=module -e "import { forecast, estimateCost, normalizePrices, DEFAULT_PRICES } from './lib/forecast.mjs'; const now = Date.parse('2026-11-07T00:00:00.000Z'); const records = [{ model: 'a', at: '2026-11-06T23:00:00.000Z', input_tokens: 1000000, output_tokens: 0, cost_usd: 10 }, { model: 'a', at: '2026-11-06T23:30:00.000Z', input_tokens: 1000000, output_tokens: 0, cost_usd: 10 }]; const f = forecast({ records, model: 'a', now, quota: { remaining_usd: 100 } }); if (f.status === 'known' && f.tasks_left === 10 && f.burn_per_task === 10 && f.risk === 'ok') { /* ok */ } else process.exit(1); if (estimateCost({ input_tokens: 1000000, output_tokens: 0, prices: { input_per_mtok: 10, output_per_mtok: 20 } }) === 10) { /* ok */ } else process.exit(1); if (normalizePrices({}).input_per_mtok === DEFAULT_PRICES.input_per_mtok) { /* ok */ } else process.exit(1); const empty = forecast({ records: [], model: 'a' }); if (empty.status === 'unknown' && empty.tasks_left === null) { /* ok */ } else process.exit(1); console.log('AC-015 OK')"
```

- 期望: stdout 最后一行是 `AC-015 OK`，退出码 0。
- 期望: 与 `test/unit/select.test.mjs` 相同的两条样本仍得到 `tasks_left` 10、`burn_per_task` 10、`risk` `ok`。`DEFAULT_PRICES`、`normalizePrices`、`estimateCost` 仍可导入。

## AC-015 A-4 a1-quota 的 repro 未改，且 check-defects 只缺这一处 [fixed]

```
node --input-type=module -e "import fs from 'node:fs'; import { spawnSync } from 'node:child_process'; import { reproSha256 } from './scripts/check-defects.mjs'; const src = fs.readFileSync('test/characterization/defects/a1-quota.test.mjs', 'utf8'); const ledger = JSON.parse(fs.readFileSync('test/characterization/defects.json', 'utf8')); const item = ledger.defects.find((d) => d.id === 'a1-quota'); if (reproSha256(src) === item.repro_sha256 && src.includes('[fixed]') === false) { /* ok */ } else process.exit(1); const r = spawnSync(process.execPath, ['scripts/check-defects.mjs'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); const o = (r.stdout || '') + (r.stderr || ''); if (r.status === 1) { /* ok */ } else { console.error(o); process.exit(1); } const fails = o.split(/\r?\n/).filter((line) => line.startsWith('FAIL ')); if (fails.length === 1 && fails[0] === 'FAIL defects.missing_fixed a1-quota has no [fixed] section' && o.includes('check-defects: FAILED (1 errors)')) { /* ok */ } else { console.error(o); process.exit(1); } console.log('AC-015 OK')"
```

- 期望: stdout 最后一行是 `AC-015 OK`，退出码 0。
- 期望: `a1-quota` 的 `[repro]` sha256 仍等于账本，源码不含 `[fixed]`。`check-defects` 退出码 1，仅一行 `FAIL defects.missing_fixed a1-quota has no [fixed] section`，末行 `check-defects: FAILED (1 errors)`。

## AC-016 A-5 过滤运行

```
node --input-type=module -e "import { spawnSync } from 'node:child_process'; const r = spawnSync(process.execPath, ['scripts/run-tests.mjs', '--ac', 'AC-016'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); const o = (r.stdout || '') + (r.stderr || ''); if (r.status === 0) { /* ok */ } else { console.error(o); process.exit(1); } const last = o.trim().split(/\r?\n/).pop(); if (last.startsWith('run-tests: filtered 1 files, manifest ') === false) { console.error(last); process.exit(1); } if (o.indexOf(String.fromCharCode(10006)) >= 0 || o.includes('fail 0') === false) process.exit(1); const ids = ['b44-used-0','b44-reading-half','b44-ledger-sonnet-1m','b44-reading-then-1m','b44-fresh-reading-ignores-earlier-rows','b44-stale-reading-uses-ledger','b44-unknown-capacity-row','b44-rounding','b44-two-pools-min']; for (const id of ids) { if (o.includes('[AC-016] ' + id) === false) { console.error(id); process.exit(1); } } if (o.includes('[AC-016] golden case count') === false) process.exit(1); console.log('AC-016 OK')"
```

- 期望: stdout 最后一行是 `AC-016 OK`，退出码 0。
- 期望: 选中 1 个文件，9 个 b44 case 标题和 `[AC-016] golden case count` 都出现。

## AC-016 A-6 b44 金标深相等

```
node --input-type=module -e "import fs from 'node:fs'; import assert from 'node:assert/strict'; import { remainingForModels } from './lib/pools.mjs'; const g = JSON.parse(fs.readFileSync('contracts/golden/b44.json', 'utf8')); if (g.cases.length === 9) { /* ok */ } else process.exit(1); for (const c of g.cases) { const actual = remainingForModels({ models: c.input.models, pools: c.input.pools, rows: c.input.rows, now: Date.parse(c.input.now), reading_ttl_s: c.input.reading_ttl_s }); assert.deepStrictEqual(actual, c.expected, c.id); } console.log('AC-016 OK')"
```

- 期望: stdout 最后一行是 `AC-016 OK`，退出码 0。
- 期望: 9 个 b44 case，`remainingForModels` 与 `expected` 整体深相等。`now` 由 `Date.parse` 转成毫秒。

## AC-016 A-7 schema 形状与计费权重

```
node --input-type=module -e "import { remainingForModels } from './lib/pools.mjs'; const now = Date.parse('2026-11-07T10:00:00.000Z'); const shaped = remainingForModels({ models: ['claude:claude-sonnet-5-5'], now, reading_ttl_s: 600, rows: [], pools: [{ id: 'claude:plan-5h', window: { start_at: '2026-11-07T07:00:00.000Z', reset_at: '2026-11-07T12:00:00.000Z' }, capacity_mtok: { 'claude:claude-sonnet-5-5': { value: 10 } }, used_fraction: { value: 0.5, at: '2026-11-07T09:55:00.000Z' } }] }); if (shaped['claude:claude-sonnet-5-5'].remaining_mtok === 5) { /* ok */ } else process.exit(1); const row = { model: 's', input_tokens: 1000000, cache_read_tokens: 1000000, at: '2026-11-07T08:00:00.000Z' }; const run = (w) => remainingForModels({ models: ['s'], now, reading_ttl_s: 600, cache_read_weight: w, pools: [{ id: 'p', window: { start_at: '2026-11-07T07:00:00.000Z', reset_at: '2026-11-07T12:00:00.000Z' }, capacity_mtok: { s: 10 }, reading: null }], rows: [row] }); if (run(0).s.remaining_mtok === 9 && run(1).s.remaining_mtok === 8) { /* ok */ } else process.exit(1); console.log('AC-016 OK')"
```

- 期望: stdout 最后一行是 `AC-016 OK`，退出码 0。
- 期望: `used_fraction` 加 `{ value: 10 }` 容量得到 remaining 5。权重 0 时 remaining 9，权重 1 时 remaining 8。

## AC-016 A-8 b44-reading-half 的 sonnet 手算

```
node --input-type=module -e "import assert from 'node:assert/strict'; import { buildForecast } from './lib/forecast.mjs'; const pools = [{ id: 'claude:plan-5h', window: { start_at: '2026-11-07T07:00:00.000Z', reset_at: '2026-11-07T12:00:00.000Z' }, capacity_mtok: { 'claude:claude-opus-5-5': 2, 'claude:claude-sonnet-5-5': 10 }, reading: { value: 0.5, at: '2026-11-07T09:55:00.000Z' } }]; const actual = buildForecast({ model: 'claude:claude-sonnet-5-5', pools, rows: [], samples: [], usage: 'Normal', now: Date.parse('2026-11-07T10:00:00.000Z') }); const expect = { schema: 'cliworker.forecast/v1', status: 'known', remaining_mtok: 5, remaining_fraction: 0.5, tasks_left: null, tasks_left_basis: 'none', tasks_left_assumed: 10, confidence: 'none', risk: 'ok', risk_basis: 'fraction', reason: 'no_samples', burn_mtok_per_hour: 1.667, eta_exhaust_at: '2026-11-07T12:59:57.840Z', exhausts_before_reset: false, samples: 0 }; for (const key of Object.keys(expect)) assert.deepStrictEqual(actual[key], expect[key], key); assert.deepStrictEqual(Object.keys(actual.pools[0]).sort(), ['pool_id', 'remaining_fraction', 'remaining_mtok', 'reset_at', 'reset_in_h', 'reset_source']); assert.deepStrictEqual(actual.pools[0], { pool_id: 'claude:plan-5h', remaining_mtok: 5, remaining_fraction: 0.5, reset_at: '2026-11-07T12:00:00.000Z', reset_in_h: 2, reset_source: 'config' }); console.log('AC-016 OK')"
```

- 期望: stdout 最后一行是 `AC-016 OK`，退出码 0。
- 期望: 与 design §3.7 的手算一致，池输出恰好六个字段，未写来源的窗口记为 `config`。

## AC-017 A-9 过滤运行

```
node --input-type=module -e "import { spawnSync } from 'node:child_process'; const r = spawnSync(process.execPath, ['scripts/run-tests.mjs', '--ac', 'AC-017'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); const o = (r.stdout || '') + (r.stderr || ''); if (r.status === 0) { /* ok */ } else { console.error(o); process.exit(1); } const last = o.trim().split(/\r?\n/).pop(); if (last.startsWith('run-tests: filtered 1 files, manifest ') === false) { console.error(last); process.exit(1); } if (o.indexOf(String.fromCharCode(10006)) >= 0 || o.includes('fail 0') === false) process.exit(1); const titles = ['[AC-017] tasks-0','[AC-017] frac-0.15','[AC-017] n2-invalid','[AC-017] n20-heavy','[AC-017] n20-cv1.01','[AC-017] n3-cv5','[AC-017] eta-equal-reset','[AC-017] round3-negative','[AC-017] thresholds golden case count','[AC-017] quantiles golden case count','[AC-017] confidence golden case count','[AC-017] burn-eta golden case count']; for (const title of titles) { if (o.includes(title) === false) { console.error(title); process.exit(1); } } console.log('AC-017 OK')"
```

- 期望: stdout 最后一行是 `AC-017 OK`，退出码 0。
- 期望: 选中 1 个文件，列出的 12 个标题都出现。

## AC-017 A-10 四个金标文件逐条深相等

```
node --input-type=module -e "import fs from 'node:fs'; import assert from 'node:assert/strict'; import { quantileForUsage, confidenceFor, classifyRisk, burnMtokPerHour, etaExhaust, round3 } from './lib/forecast.mjs'; const calls = { classify_risk: (input) => classifyRisk(input), quantile_for_usage: (input) => ({ value: quantileForUsage(input.samples, input.usage) }), confidence: (input) => ({ confidence: confidenceFor(input.n, input.cv) }), burn_mtok_per_hour: (input) => ({ value: burnMtokPerHour(input) }), eta_exhaust: (input) => etaExhaust({ now: Date.parse(input.now), remaining_mtok: input.remaining_mtok, burn_mtok_per_hour: input.burn_mtok_per_hour, reset_at: input.reset_at }), round3: (input) => ({ value: round3(input.value) }) }; const files = ['thresholds.json', 'quantiles.json', 'confidence.json', 'burn-eta.json']; const counts = [21, 15, 11, 14]; for (let i = 0; i < files.length; i += 1) { const g = JSON.parse(fs.readFileSync('contracts/golden/forecast/' + files[i], 'utf8')); if (g.cases.length === counts[i]) { /* ok */ } else process.exit(1); for (const c of g.cases) assert.deepStrictEqual(calls[c.fn](c.input), c.expected, c.id); } const z = etaExhaust({ now: Date.parse('2026-11-07T10:00:00.000Z'), remaining_mtok: 5, burn_mtok_per_hour: 0, reset_at: '2026-11-07T12:00:00.000Z' }); assert.deepStrictEqual(z, { eta_exhaust_at: null, exhausts_before_reset: false }); if (Object.is(round3(0), 0) === true && Object.is(round3(-0.0004), 0) === true) { /* ok */ } else process.exit(1); console.log('AC-017 OK')"
```

- 期望: stdout 最后一行是 `AC-017 OK`，退出码 0。
- 期望: 21、15、11、14 条金标全部深相等。burn 为 0 且剩余大于 0 时 `eta_exhaust_at` 为 null、`exhausts_before_reset` 为 false。`round3(0)` 与 `round3(-0.0004)` 都是正零。

## AC-017 A-11 用量分位、变异系数与伪时钟

```
node --input-type=module -e "import assert from 'node:assert/strict'; import { buildForecast } from './lib/forecast.mjs'; const samples = [{ mtok: 0.1, cost_usd: null }, { mtok: 0.2, cost_usd: null }, { mtok: 0.3, cost_usd: null }]; const quota = { remaining: 3000000, unit: 'tokens' }; const now = Date.parse('2026-11-07T10:00:00.000Z'); const heavy = buildForecast({ quota, samples, usage: 'Heavy', now }); const normal = buildForecast({ quota, samples, usage: 'Normal', now }); const light = buildForecast({ quota, samples, usage: 'Light', now }); if (heavy.tasks_left === 10 && normal.tasks_left === 15 && light.tasks_left === 30 && normal.tokens_per_task.p90 === 0.3 && normal.tokens_per_task.p50 === 0.2 && normal.tokens_per_task.p25 === 0.1 && normal.tokens_per_task.n === 3) { /* ok */ } else process.exit(1); const mixed = []; for (let i = 0; i < 19; i += 1) mixed.push({ mtok: 1, cost_usd: null }); mixed.push({ mtok: 100, cost_usd: null }); const spread = buildForecast({ quota: { remaining: 20000000, unit: 'tokens' }, samples: mixed, usage: 'Normal', now }); const flat = []; for (let i = 0; i < 20; i += 1) flat.push({ mtok: 1, cost_usd: null }); const tight = buildForecast({ quota: { remaining: 20000000, unit: 'tokens' }, samples: flat, usage: 'Normal', now }); if (spread.confidence === 'medium' && tight.confidence === 'high') { /* ok */ } else process.exit(1); const orig = Date.now; Date.now = () => { throw new Error('wall'); }; try { const still = buildForecast({ quota: { remaining_pct: 15 }, samples: [], usage: 'Normal', now: 0 }); if (still.remaining_fraction === 0.15 && still.risk === 'ok') { /* ok */ } else process.exit(1); } finally { Date.now = orig; } assert.throws(() => buildForecast({ now: Number.NaN }), TypeError); console.log('AC-017 OK')"
```

- 期望: stdout 最后一行是 `AC-017 OK`，退出码 0。
- 期望: Heavy / Normal / Light 的 `tasks_left` 为 10 / 15 / 30。20 个拉开的样本 confidence 为 `medium`，20 个相同样本为 `high`。`Date.now` 抛错时 `{ remaining_pct: 15 }` 仍得到 0.15 与 `ok`。`now` 为 NaN 时抛 `TypeError`。

## AC-018 A-12 过滤运行

```
node --input-type=module -e "import { spawnSync } from 'node:child_process'; const r = spawnSync(process.execPath, ['scripts/run-tests.mjs', '--ac', 'AC-018'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); const o = (r.stdout || '') + (r.stderr || ''); if (r.status === 0) { /* ok */ } else { console.error(o); process.exit(1); } const last = o.trim().split(/\r?\n/).pop(); if (last.startsWith('run-tests: filtered 1 files, manifest ') === false || o.indexOf(String.fromCharCode(10006)) >= 0 || o.includes('fail 0') === false || o.includes('[AC-018]') === false) { console.error(last); process.exit(1); } console.log('AC-018 OK')"
```

- 期望: stdout 最后一行是 `AC-018 OK`，退出码 0。
- 期望: 选中 1 个文件，输出含 `[AC-018]`，含 `fail 0`，没有失败标记。

## AC-018 A-13 assumed 不进入 risk，输出过 schema

```
node --input-type=module -e "import fs from 'node:fs'; import { buildForecast } from './lib/forecast.mjs'; import { validate } from './lib/contract/validate.mjs'; const schema = JSON.parse(fs.readFileSync('contracts/schemas/forecast.v1.schema.json', 'utf8')); const reasons = JSON.parse(fs.readFileSync('contracts/registry.snapshot.json', 'utf8')).forecast_reasons; function check(quota, expect) { const actual = buildForecast({ quota, samples: [], usage: 'Normal', now: 0 }); const result = validate(schema, actual); if (result.ok === false) { console.error(JSON.stringify(result.errors)); process.exit(1); } for (const key of Object.keys(expect)) { if (Object.is(actual[key], expect[key]) === false) { console.error(key + '=' + String(actual[key])); process.exit(1); } } if (actual.tasks_left === null && actual.risk_basis === 'tasks') process.exit(1); if (actual.tasks_left_basis === 'assumed') process.exit(1); if (actual.reason === null) { /* ok */ } else if (reasons.includes(actual.reason) === false) process.exit(1); } check({ remaining_pct: 50, remaining: 2000000, unit: 'tokens' }, { remaining_fraction: 0.5, remaining_mtok: 2, tasks_left: null, tasks_left_basis: 'none', tasks_left_assumed: 4, risk: 'ok', risk_basis: 'fraction', confidence: 'none', reason: 'no_samples' }); check({ remaining: 2000000, unit: 'tokens' }, { remaining_mtok: 2, remaining_fraction: null, tasks_left: null, tasks_left_assumed: 4, risk: 'unknown', risk_basis: 'none', confidence: 'none', reason: 'no_samples', status: 'known' }); check({ remaining: 1, unit: 'credits' }, { risk: 'unknown', risk_basis: 'none', reason: 'credits_conversion_missing', status: 'unknown', tasks_left_assumed: null }); check({}, { status: 'unknown', risk: 'unknown', reason: 'capacity_unknown', tasks_left_basis: 'none' }); console.log('AC-018 OK')"
```

- 期望: stdout 最后一行是 `AC-018 OK`，退出码 0。
- 期望: 比例加容量时 assumed 为 4 但 risk 为 `ok` / `fraction`。只有容量时 assumed 为 4 且 risk 为 `unknown`。`tasks_left_basis` 不是 `assumed`。无样本且 `tasks_left` 为 null 时 `risk_basis` 不是 `tasks`。四份输出都通过 `forecast.v1.schema.json`，reason 属于注册表枚举或为 null。

## AC-019 A-14 过滤运行

```
node --input-type=module -e "import { spawnSync } from 'node:child_process'; const r = spawnSync(process.execPath, ['scripts/run-tests.mjs', '--ac', 'AC-019'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); const o = (r.stdout || '') + (r.stderr || ''); if (r.status === 0) { /* ok */ } else { console.error(o); process.exit(1); } const last = o.trim().split(/\r?\n/).pop(); if (last.startsWith('run-tests: filtered 1 files, manifest ') === false || o.indexOf(String.fromCharCode(10006)) >= 0 || o.includes('fail 0') === false || o.includes('[AC-019]') === false) { console.error(last); process.exit(1); } console.log('AC-019 OK')"
```

- 期望: stdout 最后一行是 `AC-019 OK`，退出码 0。
- 期望: 选中 1 个文件，输出含 `[AC-019]`，含 `fail 0`，没有失败标记。

## AC-019 A-15 重置优先级与越过重置

```
node --input-type=module -e "import assert from 'node:assert/strict'; import { resolveResetAt, evaluatePools } from './lib/pools.mjs'; import { createFakeContext } from './test/helpers/ctx.mjs'; const cliAndConfig = resolveResetAt({ cli: '2026-11-07T12:00:00Z', config: '2026-11-08T00:00:00Z', now: Date.parse('2026-11-07T10:00:00.000Z') }); assert.deepStrictEqual(cliAndConfig, { reset_at: '2026-11-07T12:00:00.000Z', reset_source: 'cli' }); const estimated = resolveResetAt({ window: { anchor: 'rolling', length_s: 3600 }, rows: [{ at: '2026-11-07T08:00:00.000Z' }, { at: '2026-11-07T09:30:00.000Z' }, { at: '2026-11-07T09:10:00.000Z' }], now: Date.parse('2026-11-07T10:00:00.000Z') }); assert.deepStrictEqual(estimated, { reset_at: '2026-11-07T10:10:00.000Z', reset_source: 'estimated' }); const unknown = resolveResetAt({ now: Date.parse('2026-11-07T10:00:00.000Z') }); assert.deepStrictEqual(unknown, { reset_at: null, reset_source: 'unknown' }); const pool = (source) => ({ id: 'p', window: { start_at: '2026-11-07T07:00:00.000Z', reset_at: '2026-11-07T12:00:00.000Z', reset_source: source }, capacity_mtok: { m: 10 }, reading: { value: 0.5, at: '2026-11-07T11:50:01.000Z' } }); const ctx = createFakeContext({ now: Date.parse('2026-11-07T11:59:59.000Z') }); const before = evaluatePools({ models: ['m'], pools: [pool('cli')], rows: [], now: ctx.clock.now(), reading_ttl_s: 600 }); if (before.m.pools[0].used_fraction === 0.5 && before.m.pools[0].recheck === false) { /* ok */ } else process.exit(1); await ctx.clock.advance(2000); const after = evaluatePools({ models: ['m'], pools: [pool('cli')], rows: [], now: ctx.clock.now(), reading_ttl_s: 600 }); if (after.m.pools[0].used_fraction === 0 && after.m.pools[0].recheck === false) { /* ok */ } else process.exit(1); const kept = evaluatePools({ models: ['m'], pools: [pool('config')], rows: [], now: ctx.clock.now(), reading_ttl_s: 600 }); if (kept.m.pools[0].used_fraction === 0.5 && kept.m.pools[0].recheck === true) { /* ok */ } else process.exit(1); console.log('AC-019 OK')"
```

- 期望: stdout 最后一行是 `AC-019 OK`，退出码 0。
- 期望: cli 优先于 config；滚动窗口估出 `2026-11-07T10:10:00.000Z` / `estimated`；无输入为 `unknown`。伪时钟在 reset 前 1 秒 `used_fraction` 为 0.5；`advance(2000)` 之后 cli 池归零且 `recheck` 为 false，config 池仍为 0.5 且 `recheck` 为 true。

## 仓库门禁 R-1 完整测试

```
node --input-type=module -e "import { spawnSync } from 'node:child_process'; const r = spawnSync(process.execPath, ['scripts/run-tests.mjs'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); const o = (r.stdout || '') + (r.stderr || ''); if (r.status === 0) { /* ok */ } else { console.error(o.slice(-4000)); process.exit(1); } const last = o.trim().split(/\r?\n/).pop(); if (last.startsWith('run-tests: full ') === false || o.includes('fail 0') === false || o.includes('FAIL discovery') || o.indexOf(String.fromCharCode(10006)) >= 0) { console.error(last); process.exit(1); } console.log('T-006 OK')"
```

- 期望: stdout 最后一行是 `T-006 OK`，退出码 0。
- 期望: 末行以 `run-tests: full ` 开头，含 `fail 0`，没有 `FAIL discovery`，没有失败标记。

## 仓库门禁 R-2 缝、追踪、金标冻结、写域

```
node --input-type=module -e "import { spawnSync } from 'node:child_process'; import fs from 'node:fs'; function run(args) { const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }); return { status: r.status, out: (r.stdout || '') + (r.stderr || '') }; } const seams = run(['scripts/check-seams.mjs']); if (seams.status === 0 && seams.out.includes('check-seams: ok (files=20)')) { /* ok */ } else { console.error(seams.out); process.exit(1); } const trace = run(['scripts/check-traceability.mjs']); if (trace.status === 0 && trace.out.includes('check-traceability: ok (covered=19 planned=55)')) { /* ok */ } else { console.error(trace.out); process.exit(1); } const golden = run(['scripts/check-golden-frozen.mjs']); if (golden.status === 0 && golden.out.includes('check-golden-frozen: ok (14 files)')) { /* ok */ } else { console.error(golden.out); process.exit(1); } const scope = run(['scripts/check-write-scope.mjs', '--base', '887c7a2115e649e6df5046448dcc97d571e8f660', '--scope-from', '.collab/tasks/006/design.md', '--scope', '.collab/tasks/006/**']); if (scope.status === 0 && scope.out.includes('check-write-scope: ok')) { /* ok */ } else { console.error(scope.out); process.exit(1); } const shard = JSON.parse(fs.readFileSync('test/traceability/T-006.json', 'utf8')); const got = [shard.task, shard.milestone, shard.entries.map((e) => e.ac + ':' + e.status).join(' '), JSON.stringify(shard).includes('baseline')]; if (got[0] === 'T-006' && got[1] === 'M1' && got[2] === 'AC-015:covered AC-016:covered AC-017:covered AC-018:covered AC-019:covered' && got[3] === false) { /* ok */ } else { console.error(JSON.stringify(got)); process.exit(1); } console.log('T-006 OK')"
```

- 期望: stdout 最后一行是 `T-006 OK`，退出码 0。
- 期望: `check-seams: ok (files=20)`，`check-traceability: ok (covered=19 planned=55)`，`check-golden-frozen: ok (14 files)`，`check-write-scope: ok`。分片五个 AC 都是 covered，且没有 `baseline` 键。写域基准是 `887c7a2115e649e6df5046448dcc97d571e8f660`，`.collab/tasks/006/**` 只放行本任务的调度产物。

## 仓库门禁 R-3 新引擎不碰墙钟，旧导出只留两处 systemNow

```
node --input-type=module -e "import fs from 'node:fs'; const pools = fs.readFileSync('lib/pools.mjs', 'utf8'); const forecast = fs.readFileSync('lib/forecast.mjs', 'utf8'); const banned = ['Date.now', 'systemNow', 'setTimeout', 'setInterval', 'setImmediate']; for (const word of banned) { if (pools.includes(word)) { console.error(word); process.exit(1); } } if (forecast.includes('Date.now')) process.exit(1); const count = forecast.split('systemNow').length - 1; if (count === 2) { /* ok */ } else { console.error(String(count)); process.exit(1); } console.log('T-006 OK')"
```

- 期望: stdout 最后一行是 `T-006 OK`，退出码 0。
- 期望: `lib/pools.mjs` 不含 `Date.now`、`systemNow` 和定时器。`lib/forecast.mjs` 不含 `Date.now`，`systemNow` 恰好 2 次。零参数 `new Date()` 由 R-2 的 `check-seams` 覆盖。

## 仓库门禁 R-4 新文件不含令牌样子

```
node --input-type=module -e "import fs from 'node:fs'; const files = ['lib/pools.mjs', 'lib/forecast.mjs', 'test/unit/pools.test.mjs', 'test/unit/forecast-engine.test.mjs', 'test/unit/forecast-unknown.test.mjs', 'test/unit/reset.test.mjs', 'test/traceability/T-006.json']; const needles = ['sk-', 'Bearer ', 'ghp_', 'xox', 'AKIA']; for (const file of files) { const text = fs.readFileSync(file, 'utf8'); for (const needle of needles) { if (text.includes(needle)) { console.error(file); process.exit(1); } } } console.log('T-006 OK')"
```

- 期望: stdout 最后一行是 `T-006 OK`，退出码 0。
- 期望: write_scope 里的 7 个文件都不含 `sk-`、`Bearer `、`ghp_`、`xox`、`AKIA`。
