# Task 021 实现说明

## 结论

T-021 的 AC-049、AC-050 行为验收均已通过：

- `node --test --test-reporter=tap test/unit/usage-ledger.test.mjs test/unit/usage-readers.test.mjs`：25 项通过，0 失败/取消/跳过/todo。
- `node scripts/run-tests.mjs --ac AC-049`：filtered 2 files。
- `node --test --test-reporter=tap test/unit/capacity.test.mjs`：16 项通过，0 失败/取消/跳过/todo。
- `node scripts/run-tests.mjs --ac AC-050`：filtered 1 file。
- 两个验收块均实际输出 `AC-049 OK` / `AC-050 OK`。

`pwsh -NoProfile -File scripts/check-fast.ps1` 目前不是绿色，原因均为本任务写域外的既有问题，详见最后一节。

## 改动文件与原因

### 账本与容量（纯逻辑）

- `lib/usage.mjs`（新增）
  - 统一实现 usage/v1 行校验、默认值、幂等提交与去重读取。
  - 写入在 `lockFilePath(config._home)` 的既有 state 锁内完成“严格读取 → 查 idempotency_key → 首次 id → 单次 append”，追加失败直接抛出，不返回成功。
  - 同键重放返回已存行和 id，即使重试负载不同也不覆盖；不同键分别落行。
  - 读取只返回每个非空键的首次出现；无键旧行逐行保留并返回 `legacy` 标记，由命令给出 `W_LEGACY_USAGE`，不补键、不改写文件。
  - 缺失账本为空；损坏 JSONL、不可读字节、非法新格式行抛 `E_CONFIG`，不会伪装成空账本。
  - usage/v1 全字段沿用既有契约：`schema/id/idempotency_key/lease_id/model/pools/kind/input_tokens/output_tokens/cache_read_tokens/cache_write_tokens/cost_usd/pool_fraction_before/pool_fraction_after/at`；token 为非负整数，cost 为非负有限数，占比为 null 或 0..1，`at` 只取调用方值或首次 `ctx.clock.nowIso()`。
  - `record` 对未提供键的旧调用保留兼容：用行内容生成稳定的 `auto:<hash>` 键，仍走同一幂等路径；已有验收测试因此不回归。

- `lib/capacity.mjs`（新增）
  - `learnCapacity` 为纯计算：按观察时间排序，只取相邻有效读数对，`Δfraction >= 0.01` 才保留（恰好 0.01 保留）；丢弃对及其 token 不再跨对拼接。
  - 每对累计 `(前读数时间, 后读数时间]` 的计费 token；多对求和后 `capacity_mtok = sum(tokens)/sum(Δfraction)/1e6`，不做逐对平均。
  - `k` 为保留对数；`k<3 low`、`3..9 medium`、`>=10 high`；`source` 固定 `measured`。
  - 无有效对、无 token 或结果非有限时返回 `null`，调用方保留已有配置/measured 容量，不产生 NaN/Infinity/伪造零容量。
  - 可选 `pool/model/window` 选择器只过滤带标签的输入；未打标签的输入由调用方保证已隔离。真实账本 token 通过既有 `billedTokens` 投影，金标 `rows.tokens` 走其既有 tokens 分支。

### CLI 额度读数

- `lib/usage-readers/core.mjs`（新增）
  - 只读取用户显式给出的文件或会话目录的直接 `*.jsonl`，不递归、不碰账号/auth 文件；读失败抛 `E_REQUEST_INVALID`。
  - `toIsoTime` 保留 ISO 原拼写，把 epoch 秒/毫秒转成 UTC ISO；`fractionFromLimit` 只接受供应商报告的 used/utilization 百分比（除以 100）或 remaining_percent（先转成使用占比），不把 token 累计量当额度。
  - `selectLatest` 按观察时间选择，结果与文件枚举/数组顺序无关。

- `lib/usage-readers/codex.mjs`（新增）
  - 解析 codex 会话 JSONL 中 `payload.rate_limits.primary/secondary`；按 `window_minutes`（<=1440 短窗口，否则周窗口）映射到 `plan_window/plan_weekly`，缺省按 primary/secondary 映射。
  - 坏行、越界百分比、非数值百分比、只有 token 累计量的行都不产生读数。

- `lib/usage-readers/claude.mjs`（新增）
  - 解析 claude `usage_limit` 事件（数组或 `{events:[...]}`），按 `scope` 区分 five_hour/seven_day；支持 used_percent、remaining_percent 与 epoch 秒 reset。
  - 未知 scope、未知事件类型不产生可信读数。

- `lib/usage-readers/index.mjs`（新增）
  - `codex`/`claude` 独立注册；未知 CLI 抛 `E_REQUEST_INVALID`；同时再导出 `selectLatest` 供命令使用。

- `test/fixtures/usage/codex-session.jsonl`、`test/fixtures/usage/claude-events.json`（新增）
  - 保存供应商原字段事件样本，包含 ISO/epoch 重置、used/remaining 百分比、坏事件与 token-only 事件；测试中的期望值独立手写，不复制归一化对象。

### 命令

- `lib/commands/usage/record.mjs`（重写）
  - 保留 `--json` 与既有错误行为（坏 JSON 仍走 `E_INTERNAL`，以兼容 AC-023），把校验、计费缺省与幂等写入交给 `lib/usage.mjs`。

- `lib/commands/usage/summary.mjs`（重写）
  - 保留 `records` 容器，改用去重读取；出现无键旧行时追加 `W_LEGACY_USAGE`。

- `lib/commands/usage/import.mjs`（新增，`route={cmd:'usage',sub:'import'}`）
  - `--file` 必填；无 `--cli` 时按 usage/v1 JSONL 导入，先完整解析/校验再逐行幂等提交，重复导入不增加记录。
  - `--cli codex|claude --pool <已配置池>` 时读取读数：只取该池窗口类型的最新有效读数，更新 `used_fraction={value,source:'cli',at}`；只有读数真的带 `reset_at` 才写 `window.reset_at/reset_source='cli'`，否则保留配置/估算依据。
  - 学习容量时只使用该池、该窗口、单一可归因模型的行；多模型共用池无法归因时保留未知；已有 `source:'config'` 的容量不覆盖。
  - 读数导入不创建 usage 行；无有效读数时不覆盖上次观测。

- `lib/commands/pools/state.mjs`（新增）
  - `pools.json` 在 `config._home` 下保存池数组（不是新 envelope/schema）；缺失为无状态，损坏或非数组抛 `E_CONFIG`。
  - 合并以配置池 id 为准，只有 id/cli/kind/窗口长度匹配的运行时记录才会套用；已删除或未知池不会复活；配置容量优先于 measured。
  - `updateStatePools` 在既有 state 锁内读改写并用 `atomicWriteJson` 提交。

- `lib/commands/pools/list.mjs`（新增，`route={cmd:'pools',sub:'list'}`）
  - 返回 `{ok:true, pools:[...]}`，即配置池与匹配运行状态的合并结果。

- `lib/commands/pools/set.mjs`（新增，`route={cmd:'pools',sub:'set'}`）
  - `--json` 接收既有 pool 对象，锁内重读配置、按 id 替换并原子写回；未知池/坏 JSON 为 `E_REQUEST_INVALID`，配置错误为 `E_CONFIG`。

- `lib/commands/models/forecast.mjs`（重写）
  - 一次取 `ctx.clock.now()`；用 `listModels` + `resolveModel` 归一化模型键（legacy 配置沿用原键），读取去重账本、配置池与有效运行状态。
  - 逐池用既有 `evaluatePools` 计算各自的行归属；已知池把计算结果冻结为内部读数（不持久化、不刷新池的 `at`），未知池保留原池和其行，最后交给既有 `buildForecast`，保留 min、风险、burn、eta、容量未知等既有公式。
  - 任务样本只取目标规范模型 `kind='task'` 的行，投影为 `mtok/cost_usd`；probe/manual 仍参与池消耗。
  - 读数 age > `reading_ttl_s`（默认 600）时追加 `W_STALE_DATA`；有旧行时追加 `W_LEGACY_USAGE`。不新增 stale 布尔字段或 schema。

### 测试与追踪

- `test/unit/usage-ledger.test.mjs`（新增，标题含 `[AC-049]`）
  - 串行/并发/新进程重放同键同 id；物理一行、去重读取一行；不同键分别计数。
  - 历史重复取首次且不改写文件；无键旧行不合并并给 `W_LEGACY_USAGE`。
  - 缺失为空、损坏 JSONL/读失败/追加失败不伪装成功；完整字段/类型/时间来源。
  - 生产 `usage record/summary/import`、`pools list/set`、`models forecast` 路由可达；重复 import 不重复记账；非法 JSON/未知池/状态/配置错误码正确。
  - TTL：容量 10、读数 0.5、读数前 1 Mtok、读数后 0.5 Mtok；TTL 内与恰好 600s 均为 4.5；advance 后为 8.5 且出现 `W_STALE_DATA`；读数 `at` 不变；无关池隔离、共用池按各自模型容量计费、`ledger_capacity_unknown`、estimated/CLI reset 语义。
  - 假密钥哨兵经既有 `leak-scan` 检查 stdout/stderr/state 无泄漏。

- `test/unit/usage-readers.test.mjs`（新增，标题含 `[AC-049]`）
  - codex/claude 夹具的真实解析结果与手写四字段期望深相等；百分比、remaining、epoch 转换。
  - 最新读数按观察时间、窗口隔离、坏数据/未知格式不造 0、不从 token 推断、不读 auth、不执行 CLI；生产导入后 pools list/forecast 复读。

- `test/unit/capacity.test.mjs`（新增，标题含 `[AC-050]`）
  - 遍历 `contracts/golden/capacity.json` 全部五例，真实 `learnCapacity` 结果与 expected 完整深相等。
  - 恰好 0.01、低于阈值、无有效对、区间边界、负增量不拼接、池/模型/窗口隔离、按和而非平均、k 置信度。
  - 导入读数→pools.json measured 容量→forecast 消费；config 容量不被覆盖；多模型共用池保持未知。
  - 追踪分片断言。

- `test/fixtures/usage/harness.mjs`（新增）
  - 仅测试使用：临时 state_dir、合法 v2 配置、伪时钟、真实 `main` 路由与真实文件读写。

- `test/traceability/T-021.json`（新增）
  - `task=T-021`、`milestone=M4`，仅 AC-049/AC-050；AC-049 指向两个 usage 测试，AC-050 指向 capacity 测试；不声明 baseline。

## 自测

```pwsh
node --test --test-reporter=tap test/unit/usage-ledger.test.mjs test/unit/usage-readers.test.mjs test/unit/capacity.test.mjs
# 41 tests / 41 pass / 0 fail

node scripts/run-tests.mjs --ac AC-049
# run-tests: filtered 2 files

node scripts/run-tests.mjs --ac AC-050
# run-tests: filtered 1 file

node scripts/check-seams.mjs
# check-seams: ok (files=74)

node scripts/check-unused.mjs
# check-unused: ok (files=74)

node scripts/check-traceability.mjs
# check-traceability: ok (covered=50 planned=25)

node scripts/check-write-scope.mjs
# check-write-scope: ok

node scripts/check-test-discovery.mjs
# check-test-discovery: ok
```

## check-fast 的实际状态（域外失败，未修改域外文件）

`pwsh -NoProfile -File scripts/check-fast.ps1` 退出 1，停在：

```text
==> check-acceptance.mjs
ok .collab/tasks/021/acceptance.md (acs=2 commands=3)
==> check-ci.mjs
check-ci: ok
==> check-contract-doc.mjs
FAIL contract_doc.stale docs/contract.md
check-contract-doc: FAILED (1 errors)
```

单步复核后确认与 T-021 无关：

- `check-contract-doc.mjs`：`docs/contract.md` 中 `contracts/spec/ac-index.json` 的哈希是旧值（`809631…`），当前文件为 `c55986…`；`docs/`、`contracts/` 均不在本任务 write_scope。
- `check-no-collab.mjs`：既有 3 处命中 `docs/ui/cliworker-console.html:1096`、`test/unit/gitignore.test.mjs:13/18`，都不在本任务写域，且本任务新增文件不含该工作目录名。
- 完整 `node scripts/run-tests.mjs`：630 项中 625 通过、5 失败，失败项均为上述文档/检查问题及既有测试：
  - `[fixed] [AC-012] live loadConfig …`：`lib/config-migrate.mjs` 收到无 `ctx` 的调用（缺陷表征测试）。
  - `[AC-073]` 的 `check-no-collab`、`gen-contract-doc`、`check-contract-doc` 三项。
  - `[AC-031] full flow …`：`models enumerate` 对 legacy 配置返回 `E_CONFIG`（T-036 范围）。
  - `[AC-029] lock-counter` 曾在并行满载时偶发失败；单独执行 `--ac AC-029` 19 项全通过，最近一次全量运行也未复现。
- 本任务新增的 41 项测试在全量运行中全部通过。

未修改 `docs/contract.md`、`contracts/spec/ac-index.json`、`brief.md`、`design.md`、`acceptance.md`、其他任务文件或任何配置/金标，也未执行 Git 命令。
