# Task 021 评审（review r0）

评审对象：分支 task/021，HEAD `4d72ff9ad54bc27144991267fc553315f8f5236a`（取自 refs/heads/task/021；工作区另有未提交的 .collab 状态文件，不属于被评审代码）。

## 结论：needs_revision（行为验收 2/2 已通过，但存在 1 个 P1 与 3 个 P2 规格偏差）

## 执行类验收证据（引用 ci-results.json，ranAt 2026-11-09T00:51:25+08:00）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| AC-049 | 通过 | exitCode 0；`# tests 25 / pass 25 / fail 0 / cancelled 0 / skipped 0 / todo 0`；`run-tests: filtered 2 files`；末行 `AC-049 OK` |
| AC-050 | 通过 | exitCode 0；`# tests 16 / pass 16 / fail 0 / cancelled 0 / skipped 0 / todo 0`；`run-tests: filtered 1 files`；末行 `AC-050 OK` |
| AC-050 补充门禁 `check-fast.ps1` | 无法确认 | ci-results 未包含该命令；impl.md 自述退出 1，停在 `check-contract-doc`（docs/contract.md 记录的 ac-index.json 哈希 `809631…` 与当前文件不符；两文件在本工作树的时间戳相同，均不在 write_scope）。属域外问题，本轮不据此判分，但需编排方知悉该门禁未达 `check-fast: ok`。 |

## 独立核对（只读）

- 账本 `lib/usage.mjs`：写入在 `withLock(ctx, lockFilePath(config._home), …, {policy: config.policy})` 内完成严格读 → 查键 → 首次 id → 单次 `appendJsonl`（usage.mjs:167-189）；同键返回已存行（:177-180）；读取去重不改写文件（:99-115）；缺失为空、损坏/非法新格式行抛 E_CONFIG（:121-145）。符合 design 约束 2。
- 计费与归属：`forecast.mjs` 逐池按 `row.pools.includes(pool.id)` 筛行后调用既有 `evaluatePools`，再把已知池冻结交给 `buildForecast`（forecast.mjs:81-127）；任务样本仅取目标模型 `kind==='task'`（:48-58）；新鲜度 `now - at > ttl*1000` 才算过期（:115），边界仍新鲜，与引擎 `nowMs - reading.at <= ttlMs` 一致。TTL 4.5 / 8.5 数值由测试经生产命令断言（AC-049 用例 12）。
- 容量 `lib/capacity.mjs`：相邻对、Δ≥0.01（带 1e-9 容差）、区间 (前,后]、sum/sum/1e6、k<3/3..9/≥10、k=0 返回 null，均与 design 约束 6 一致；不读金标；AC-050 五个金标用例逐例通过。
- 读数解析：codex 仅识别 `rate_limits.primary/secondary`，claude 仅识别 `usage_limit` 事件；百分比 /100、remaining 先转换、epoch 转 UTC、越界/非数值/仅 token 的事件不生成读数；`selectLatest` 与顺序无关（core.mjs:77-90）。
- 追踪分片 `test/traceability/T-021.json`：task/milestone/entries 字段符合，AC-049 两文件、AC-050 一文件，无 baseline。源码与三个测试文件及夹具中未发现 `.collab` 引用（grep 为空）。

## Findings

### F1（P1）`pools set` 不校验 pool 对象即写入配置
- 位置：`lib/commands/pools/set.mjs:38-62`（`document.pools[index] = pool` 后直接 `atomicWriteJson`）。
- design 约束 7 要求 `pools set` 接收「一个既有 pool 对象」并「经锁内重读校验后」保存。当前只检查 `id` 为非空字符串；其余字段（cli/kind/funding/window/capacity_mtok/used_fraction/credits_per_mtok，见 contracts/schemas/pool.schema.json，`additionalProperties:false`）完全不校验。
- 失败场景：`pools set --json '{"id":"codex:plan","kind":"nope","junk":1}'` 返回 ok 并覆盖配置中的该池；之后同一配置下的 forecast / pools list 读到畸形池（如缺 capacity_mtok、非法 kind），要么 E_CONFIG 要么静默得出错误额度。测试只覆盖坏 JSON 和未知 id（usage-ledger.test.mjs:305-319、505），没有非法 pool 形状用例。
- 建议：在写入前按 pool.schema.json 的必填字段、枚举、window 结构、used_fraction 范围做校验，失败返回 E_REQUEST_INVALID 且不回显输入；补一条非法形状不改写配置的测试。

### F2（P2）显式导入完全损坏的 CLI 文件不会失败
- 位置：`lib/usage-readers/codex.mjs:27-41`、`claude.mjs:36-44` 对坏行/非 JSON 文档静默返回空读数；`lib/commands/usage/import.mjs:222-225` 对空读数直接返回 `{ok:true}`。
- design 约束 4：「显式导入的损坏文件以既有错误失败」。现在一个内容全是垃圾（如 `not json`）的文件导入后返回成功且无任何变化，用户无法区分「无读数」与「文件坏了」。usage-readers.test.mjs:72 仅测纯解析器返回空，没有导入层的失败用例。
- 建议：当整份文件无一可解析的 JSON 事件（或 claude 文档根不是数组/{events}）时，导入抛 E_REQUEST_INVALID；保留「有效 JSON 但无读数 → 不覆盖」的现有语义，并补测。

### F3（P2）无键 `usage record` 用 32 位内容哈希生成幂等键，可能误合并不同记录
- 位置：`lib/usage.mjs:147-154, 169-171`（FNV-1a 32 位 + `auto:` 前缀，对含 `at` 的整行取哈希）。
- 两条不同的手工记录一旦哈希碰撞（32 位，生日界约 6.5 万行），第二条会被当作「已存在」返回，账本少记一笔且调用方看到成功；同一时钟毫秒内两次内容相同的合法独立记录也会被合并。design 只要求「稳定且非空」的键，没有要求由内容推断。
- 建议：改用经 `ctx.random` 生成的键（在命令层生成一次，重试由调用方复用返回的键），或至少换成完整 SHA-256 摘要，并在 summary 说明无键调用不具备跨进程重试幂等。属风险较低的取舍，但与「不得悄悄丢记录」相冲，故列 P2。

### F4（P2）导入较旧的读数文件会把运行状态回退到更早的观测
- 位置：`lib/commands/usage/import.mjs:243-250`；`selectLatest` 只在本文件内取最新，随后无条件覆盖 `target.used_fraction` 与 `window.reset_at`。
- 场景：先导入当天较新的会话文件（at=10:00），再导入前一天的旧文件（at=昨天），池读数与 CLI reset 被回退为旧值，forecast 立即判过期并改走账本回退，同时还可能把旧 `reset_at` 写成 `cli`。design 约束 4 要求「只选择……观察时间最新的有效读数」「不覆盖上次有效观测」。
- 建议：仅当新读数 `at` 不早于现有 `used_fraction.at` 时更新；补一条旧文件导入不覆盖的测试。

## 其他说明（不计入 findings）

- claude 夹具中的 `usage_limit` 事件格式（scope/used_percent/resets_at）无外部证据，可视为夹具自洽；design 要求「夹具有明确证据」，建议 impl 在后续说明该格式来源，或在 CLI 帮助中标注为实验性。
- `readSessionTexts` 目录模式只读 `*.jsonl`，claude 的 `.json` 事件文档只能以文件路径导入；与「用户明确提供文件」口径不冲突，仅提示。
- 容量学习只使用当次导入文件内的读数对，不累积历史，重复小文件导入会以较低 k 覆盖较高 k 的已测容量；设计未规定累积，暂不判缺陷。
