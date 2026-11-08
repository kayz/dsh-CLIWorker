---
write_scope:
  - lib/usage.mjs
  - lib/usage-readers/**
  - lib/capacity.mjs
  - lib/commands/usage/**
  - lib/commands/pools/**
  - lib/commands/models/forecast.mjs
  - test/unit/usage-ledger.test.mjs
  - test/unit/usage-readers.test.mjs
  - test/unit/capacity.test.mjs
  - test/fixtures/usage/**
  - test/traceability/T-021.json
---

# Task 021 — 用量账本、CLI 额度读数、容量学习（只提供数据，不改预测公式）

## 目标

交付 T-021 / M4，覆盖 AC-049、AC-050，测试层级 unit。依据同目录 brief.md，以及 `.collab/blueprint/cliworker-v2/design.md`、`interfaces.md` 的额度池、forecast、用量行、配置、CLI、时钟和追踪契约，及 task-graph.json 中的 T-021。运行时结构沿用 `contracts/schemas/usage.v1.schema.json`、`pool.schema.json`、`forecast.v1.schema.json` 和 `contracts/registry.snapshot.json`；容量预期唯一来源为 `contracts/golden/capacity.json`。brief 未提供本任务的基准 commit SHA 或既有验收报告路径，不借用其他任务的基准或声称核验提交关系。

现有文件已能确定实施方式：

- `lib/store.mjs` 提供 readJsonl、appendJsonl、readJson、atomicWriteJson；`lib/lock.mjs` 提供 withLock、lockFilePath。不能使用会吞掉读取与解析错误的 config.readUsage 判断幂等键是否存在。
- `config._home` 已是解析后的 state_dir；`lib/commands/_util.mjs` 的 usageFile 定位该目录的 usage.jsonl。账本继续使用此路径，以便现有探测与后续执行器共用。
- `lib/pools.mjs` 已提供 billedTokens、evaluatePools、round3；`lib/forecast.mjs` 已提供 buildForecast，具有读数 TTL、读数后补账、窗口回退、容量未知和 reset_source 处理。两个文件均只读。
- 当前 models forecast 命令仍调用旧 forecast；本任务只在允许的命令文件接入 buildForecast 及新账本数据。`lib/cli.mjs` 已通过 routes.collectRoutes 发现命令模块的 route 导出，usage import、pools list/set 无需修改分发器。
- `test/helpers/ctx.mjs` 的 fakeFs 不实现锁所需的排他创建语义，不能直接拿它证明并发幂等。相关测试使用系统临时目录，或在允许的 test/fixtures/usage/** 内提供支持 flag=wx 的注入实现。

## 约束

1. **写入范围和契约。** front matter 是实现角色的完整写域，逐项沿用 brief，不包含 lib/forecast.mjs、lib/pools.mjs、lib/config.mjs、lib/catalog.mjs、lib/cli.mjs、contracts 或其他任务文件。零第三方运行时依赖，Node 20+ / ESM。所有运行时 I/O 经 ctx.fs，时间经 ctx.clock，随机数经 ctx.random；复用现有错误外壳、注册表与脱敏工具。不增加 schema、配置键、错误码、警告码、身份或额度枚举。源代码、测试与运行文档不得引用 .collab。模块导入不启动读取、CLI、网络或写状态。

2. **账本。** lib/usage.mjs 集中实现用量校验、幂等写入与去重读取，供 record、summary、import 和 forecast 命令调用。行结构完整沿用 cliworker.usage/v1：schema、id、idempotency_key、lease_id、model、pools、kind、input_tokens、output_tokens、cache_read_tokens、cache_write_tokens、cost_usd、pool_fraction_before、pool_fraction_after、at。kind 仅 task/probe/manual；token 为非负整数，cost_usd 为非负有限数；未知前后占比为 null，有值时为合法占比；无租约的手工行 lease_id 使用现有 string 类型的空字符串。缺省时间只取 ctx.clock.nowIso()，不在重读或重放时刷新时间。

   新写入必须具有稳定且非空的 idempotency_key；同键重试不能生成另一个键。id 由首次提交确定，已存在同键时返回已存行的 id 和内容，即使重试输入的其他内容不同也不得覆盖。以 state_dir 的既有 state 锁串行化“严格读取 → 查键 → 生成首次 id → 单次追加”，调用 withLock(ctx, lockFilePath(config._home), ...)，锁策略使用 config.policy。无论成功或失败都释放锁；追加失败不能返回提交成功。只在进程内缓存键或在锁外查键都不满足幂等。

   读取同键历史重复行只返回首次已提交记录，不回写、截断或迁移原文件。缺失账本为空；读错误、损坏 JSONL 和非法新格式行必须失败，不能冒充空账本。既有无幂等键的旧行按原有每行独立记录读取，不以 model/at/token 相同推断重复，不为旧行悄悄补键或改写账本。旧账本提示沿用已有 W_LEGACY_USAGE，不另造迁移协议。

3. **计费与归属。** 复用 billedTokens，计费口径固定为 input+output+cache_write+cache_read_weight*cache_read，权重取 policy.cache_read_weight，缺省 0。读取返回原始 token 字段，不能将预先计费后的数字写回 input_tokens。forecast 的任务样本只从目标规范模型的 kind=task 行投影为引擎已有的 mtok、cost_usd；probe/manual 消耗仍参与所属池的额度账本，不混作用户任务样本。每条行的 pools 决定所属池；共用池计算必须保留该池其他模型的行，并使用各行模型容量，不能仅保留目标模型。不同池的数据在调用既有纯函数前隔离，避免 evaluatePools 将无关行计入当前池。不得通过给其他模型补上目标模型容量消除 ledger_capacity_unknown。

4. **CLI 额度读数。** lib/usage-readers/** 为 codex 会话文件和 claude 事件提供独立解析器，I/O 包装与纯解析分离。输入只取用户明确提供的文件或会话目录，禁止递归扫描账号目录、读取 auth/密钥文件或执行推理获取读数。夹具保存在 test/fixtures/usage/**，JSONL 以 UTF-8 文本样本或 JSON 数组保存，在测试临时目录生成实际会话文件；不依赖提交被忽略的 .jsonl。

   每个解析器仅识别夹具有明确证据的供应商用量/限额事件；夹具须包含供应商原字段及独立手写预期，不得只把规范化对象当作“供应商事件”。对已经报告的使用百分比除以 100；剩余百分比须先转换为使用占比；epoch 时间明确按样本单位换算为 UTC。输出固定为 brief 的 `{used_fraction, reset_at, source:'cli', at}`，其中 used_fraction 为 0..1 数值，at 保留事件观察时间，reset_at 来自确实报告的重置时间；未知重置为 null。不把 token 累计量、消息文本、登录/版本成功或已消费 token 推算为官方额度百分比，不为缺失百分比补 0。对无读数、坏事件、越界或非有限占比不生成有效读数，不覆盖上次有效观测；显式导入的损坏文件以既有错误失败。未知 CLI 格式保持无可信读数，不能声明已经支持。

   只选择同一 CLI、同一目标池/窗口内观察时间最新的有效读数；文件枚举顺序不能决定结果。多窗口限额分开映射到已有池，不能把短窗口与周额度合并。纯读数解析不创建用量行，避免把官方占比和相同消耗重复入账。内部读数应用到池时，仅映射到既有 used_fraction={value,source,at} 与 window.reset_at/reset_source；确实来自 CLI 的 reset_at 才标 cli，缺失时保留已有配置/估算依据。

   新读数与容量结果通过现有 pool 结构持久化，在 config._home 下的 pools.json 保存池数组，不新增 envelope/schema；该文件是运行状态，不是新的配置字段。更新在现有 state 锁内读改写，经 atomicWriteJson 提交。合并以配置池 id 为准，不从状态文件凭空增加已删除或未知池；CLI/窗口不匹配的历史记录不可套用。读取不得刷新 at。损坏状态必须失败，不能假装没有观测。不得保留原始会话、完整事件、stdout/stderr 或环境变量值。用户配置容量 source=config 保留优先权；实测只补充/更新对应模型的 measured 容量，不覆盖其他模型或其他池。

5. **新鲜度与 forecast 接线。** models forecast 读取规范模型、去重账本、配置池与有效运行状态，一次取得 ctx.clock.now()，传给既有 buildForecast。模型与别名沿用 catalog.listModels(config,{models:[],ctx})、resolveModel；当前目录来源是 catalog.manual，不调用仍报告上游未就绪的 readCatalogModels，不另造目录协议。保持现有 --model、--config 入口及命令已有 schema/forecast 容器，容器中的 forecast 为 buildForecast 的现有 forecast/v1 字段；既有 warnings 容器追加警告，不增加 stale 布尔字段或新返回 schema。

   新鲜规则 age<=reading_ttl_s，缺省 600 秒；恰好边界仍新鲜。新鲜读数只加 at 之后的相关账本；过期读数保留原始 at 供审计，由既有引擎回退到窗口账本，同时命令给出 W_STALE_DATA。不能用当前时间重写观测使其永远新鲜，也不能将 reading_stale 直接盖掉引擎给出的容量未知原因。窗口模型容量缺失保持 unknown/ledger_capacity_unknown；无窗口起点保持既有 window_unknown。缺失读数与已有读数过期分开判断，不能为空文件伪造过期读数。

   池归属筛选与逐池数据准备在本任务允许文件中完成，复用 evaluatePools 得到各池数据，再接入 buildForecast；多池仍沿用既有 min 约束和各池详情，不能把一次全局过滤后的行无差别交给所有池。计算重用现有函数，不复制或修改分位数、风险、burn、eta、容量换算和舍入公式。估算的 reset_at 越过只触发复核，不清零；仅 CLI 确认的重置使用既有清零规则。测试必须经生产 forecast 命令验证 TTL，不能只测独立 stale helper。

6. **容量学习。** lib/capacity.mjs 为纯计算模块，沿用金标 fn=learn_capacity 的输入 readings、rows 与输出 capacity_mtok、k、confidence、source；不读取金标作为运行时计算结果。先按观察时间排序，取同一池、同一模型、同一窗口的相邻有效读数对；计算 Δfraction=后值-前值，仅保留 Δfraction>=0.01。负增量重置对、零增量、小增量均丢弃，相关 token 也丢弃；不能跨被丢弃的相邻对拼出更大跨度，以规避阈值。

   每对累计 (前读数时间,后读数时间] 的计费 token，行在边界只计一次。真实账本通过 billedTokens 投影；金标输入 rows.tokens 已是计费 token，按现有 billedTokens 支持的 tokens 口径处理。capacity_mtok=sum(保留对的tokens)/sum(保留对的Δfraction)/1e6；k 是保留读数对数量，不是行数或读数总数；confidence 为 k<3 low、3..9 medium、>=10 high，source 固定 measured。k=0 时不生成/覆盖实测容量，不输出 NaN、Infinity 或伪造零容量；保留已知配置或此前测量值。所有金标 expected 做完整深相等，不以误差阈值或字段子集替代。学习返回 capacity_mtok，写池时按已有结构映射成 capacity_mtok[model]={value,source,confidence}，不把 k 加入池 schema。

   共用池存在多个模型且无法从读数对独立归因时，不把所有模型 token 当成目标模型容量样本；先隔离可归因区间，否则保留未知。不内置任何供应商容量数字，不为了测试高置信度重复使用同一对样本。

7. **命令。** record 保留 --json 接收已有用量行；summary 保留既有 records 容器并改用去重读取。新增 usage import 接收显式 --file 路径，--cli codex/claude 与 --pool 指定已配置池时导入 CLI 读数；未给 --cli 时导入该文件中的已有 usage/v1 JSONL 行，按同一幂等写入路径处理，重复导入不增加消耗。读取旧全局账本必须用户显式指定文件，不自动把其并入当前 state_dir。导入行先完成解析校验再开始提交；提交中断后可以依幂等键安全重试，不承诺跨行事务。

   pools list 返回既有 pools 容器的有效池数据；pools set 以 --json 接收一个既有 pool 对象，按 id 在配置 pools 中更新，经锁内重读校验后 atomicWriteJson 保存配置；不能把运行状态扩展成新的配置 schema。读数导入更新运行状态并对可归因数据执行学习，供后续 pools list 与 forecast 实际消费；容量学习不能只留下无人调用的函数。命令响应复用现有 ok、records、pools、warnings 等已有字段，不新增版本或统计字段。未知池、非法参数/JSON 用 E_REQUEST_INVALID；配置/状态错误沿用 E_CONFIG，锁错误沿用 E_STATE_LOCKED；错误信息不回显原始 JSON 或事件。各模块导出既有 run({argv,ctx,config}) 与 route={cmd,sub}，实际 main/bin 路由必须可达。

8. **测试与追踪。** usage-ledger.test.mjs 与 usage-readers.test.mjs 的真实测试标题含字面量 [AC-049]。分别证明串行和并发同键返回同 id、物理只追加一次、历史重复读取只计一次、不同键分别计数、失败不伪装成功；验证实际 codex/claude 格式样本的完整四字段及转换、读数选择与窗口隔离，生产命令导入/复读、TTL 边界与过期回退、CLI reset 和 estimated reset 的不同语义。测试中放置假的密钥哨兵，检查命令 JSON、错误、持久化与 stdout/stderr 均不泄漏；使用既有 leak-scan，不使用真实令牌。

   TTL 数值对照固定为容量 10 Mtok，窗口内读数前账本 1 Mtok、读数后账本 0.5 Mtok、CLI 占比 0.5。TTL 内及恰好 600 秒时剩余 4.5 Mtok；advance 至超过 600 秒时剩余 8.5 Mtok，并出现 W_STALE_DATA。整个测试期间窗口不重置，读数 at 不变；另加无关池行证明隔离，及共用池不同模型容量行证明使用实际模型容量。预期手算，不能由被测函数生成。

   capacity.test.mjs 的标题含 [AC-050]，遍历金标全部五例，逐例调用真实容量函数并 deepStrictEqual expected；额外覆盖恰好 0.01、无有效对、区间边界、不同池/模型隔离、不覆盖 config 容量和实际读数导入到池再到 forecast 的接线。不得把金标 expected 原样返回作为“实现”。

   test/traceability/T-021.json 仅使用既有 task、milestone、entries/ac/files/status：task=T-021、milestone=M4；AC-049 指向两个 usage 测试，AC-050 指向 capacity.test.mjs，实际通过后才标 covered。baseline 仍唯一来自 contracts/spec/ac-index.json 的 darwin/linux/win32，不写入分片，不修改索引。

## 建议验收方向

按“账本与锁 → 纯读数解析及隔离夹具 → 容量金标 → 状态/命令接线 → TTL 与回归”实施。acceptance.md 的 AC-049、AC-050 均提供可独立执行的命令和期望输出；任一失败、零匹配、skip、todo 或取消都不能打印成功哨兵。测试用系统临时目录或注入文件系统，不读取个人账号、不依赖真实 CLI、网络或墙钟等待。

实现角色完成前执行 `pwsh -NoProfile -File scripts/check-fast.ps1`，期望退出 0 且输出 `check-fast: ok`；保留已有 AC-015/016/017/019 的纯函数回归，不以修改金标或引擎使新测试通过。全检查受其他任务影响，失败须记录真实原因，不改写域外文件。当前 design 角色仅写两份规格并做不落盘的文档格式检查；check-fast 会创建测试报告、临时夹具且检查链包含仓库检查，不在“禁止创建其他文件、禁止 Git”的本轮权限下运行，也不宣称实现已验收。

## 非目标

不实现新的预测公式、T-022 选模策略、T-023 执行器、HTTP/UI、定时采集、供应商账号/密钥发现或其他里程碑；不改全局读写工具、路由器、契约、金标及其他任务规格。不以真实账号采样来补齐未知 CLI 格式。此 design 轮只创建同目录 design.md、acceptance.md，使用 UTF-8 无 BOM；不执行 Git，不创建脚本、报告、夹具或代码文件。
