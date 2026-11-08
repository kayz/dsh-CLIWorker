---
write_scope:
  - lib/policy.mjs
  - lib/leases.mjs
  - lib/select.mjs
  - lib/commands/admin/**
  - lib/commands/models/select.mjs
  - test/unit/select-policy.test.mjs
  - test/unit/select-reserve.test.mjs
  - test/unit/select-noexec.test.mjs
  - test/contract/selection-shape.test.mjs
  - test/contract/selection-view.test.mjs
  - test/integration/select-concurrency.test.mjs
  - test/perf/**
  - test/flows/steps/select.mjs
  - test/characterization/defects/a5-nocache.test.mjs
  - test/traceability/T-022.json
---
# Task 022 — 选模策略与租约

## 目标

交付 brief 中 T-022 / M4 的全部产物，覆盖 AC-051..AC-056。依据 .collab/blueprint/cliworker-v2/design.md、interfaces.md 第 1、2、3、8、11、13、15、16、17 节和 task-graph.json 的 T-022；运行时与测试只引用仓库内 contracts，不引用 .collab。字段、schema、原因码和视图以既有 contracts/schemas、contracts/registry.snapshot.json、contracts/spec/migration-map.json 为准，不新增协议字段、版本或错误码。

策略金标为 contracts/golden/policy/*.json 的实际六个 cases：p1-order、p2-quota-low、p3-after-known、p3-reject、p4-distinct-group、p4-fill-same-group。逐例执行，不能只按四个文件断言覆盖。brief 没有给基准 commit SHA 或既有验收报告；蓝图中的 f75bb76 只用于冻结副本的 [repro]，不得拿它替代本任务 live 行为验收。

## 约束

本轮 design 角色仅写同目录 design.md、acceptance.md；下游实现的 write_scope 严格等于 front matter，不修改 brief、其他角色产物、冻结规格、现有测试或写域外代码。Node 20+、ESM、零第三方运行时依赖，UTF-8 无 BOM。所有业务时间与等待经 ctx.clock，文件操作经 ctx.fs / store / lock；不直接引用 node:fs、child_process、全局时钟或定时器实现生产选模。令牌、密钥值及原始供应商响应不进入输出、日志、租约或仓库。

现有 lib/select.mjs 仍以 draft 为主；lib/commands/models/select.mjs 调用 providerStatus，会执行版本或认证命令，必须移除这条选模路径上的调用。复用 readProbeModels、catalog.listModels、readUsageLedger、effectivePools、evaluatePools/buildForecast、buildDirectCall、withLock/lockFilePath、atomicWriteJson、requestFromArgv/gateView、scanView。不得为本任务修改这些写域外模块。保留现有 select 模块公开导出及既有 draft 模块调用的兼容面；异步租约入口由命令 await，不把 Promise 暴露给既有同步 draft 调用。CLI 的 draft 请求也须从共享的缓存选模结果投影，不能重新调用旧 providerStatus。

## 8 选模策略

1. lib/policy.mjs 是纯计算。金标 input 的 est_mtok、count、importance、policy、reserve_mtok、pools、candidates 是已有测试接口形状；完整返回值 deepStrictEqual 对应 expected，不在生产代码读取金标。真实编排按模型构造估计：Heavy/Normal/Light 对应 p90/p50/p25，样本不足用 policy.usage_estimate_mtok，不把 tasks_left=null 当零额度，也不沿用旧 Heavy 风险标签一票拒选。

2. 先完成非额度过滤，后进入额度策略。候选只能来自当前目录且在白名单内；探测缓存只能覆盖匹配 key/provider/id 的已有模型证据，不能扩充授权候选。按既有规则处理 excluded、level_mismatch、level_unassigned、deprecated、availability_unverified/blocked/unavailable/stale、identity_unverified/mismatch、readonly_unavailable、adapter_unverified；未白名单模型不向 AgentLine 暴露 not_allowed。callable 的 at、ttl_s 必须有效，age<=ttl_s*1000 可用，超过即 stale。构造 direct_call 使用已声明适配器，未声明向量不猜参数；空 call 在额度过滤前拒绝。缺失或坏缓存不能触发刷新；损坏缓存按既有状态错误处理，不能假装空缓存或 callable。

3. 每个相关池使用同一锁内快照：avail_p=remaining_p-有效预留-(normal 时 reserve_fraction_for_high*cap_p)。先判断扣预留后是否不足 est，不足为 quota_low；额度原本够、仅扣储备后不足为 reserve_protected。high 只免储备，不免已有预留；恰好等于 est 可选。reserve_fraction_for_high 来自当前配置，不能固定为 0.15。多个同时约束同一模型的池全部通过才可选；已知不足不能被另一个未知池或付费池掩盖。

4. A 类为计划内相关池全部已知且可完成，紧迫度 min_p(remaining_p/max(reset_in_h_p,0.25)) 降序，再价格升序、key 升序。紧迫度使用 remaining，预留及储备用于准入，不能把排序公式偷换为 avail。B 类为计划内剩余未知且 unknown_policy=after_known，排 A 之后、C 之前，按 key 升序；reject 时以 quota_unknown_policy 拒绝。未知不是 0，也不是无限已知余额，允许 B 类是显式策略通过。C 类为付费池已知且可完成，funding=paid，按价格升序、key 升序；不能擅自回退到未声明池。

5. count>1 先按顺序贪心选择不同 identity_group，再按原顺序补齐同组候选；null 不作为所有模型共享的一个组。identity_group 使用当前配置中已有元数据或金标候选，不能给严格 model/v1 schema 加键。每次选中立即在当前计算中增加所有相关池的预留，再判后续候选，防止同请求共享池超卖。跨模型容量不同的共享池按同一容量比例换算预留，不能把某模型的 Mtok 余额用于另一个模型后直接相减。未知容量不伪造余额。

6. P1 返回 mA、mB、mC，funding 分别 plan、plan、paid；P2 mA/quota_low，只选 mC；P3 分别 A/U/C 与 A/C+U/quota_unknown_policy；P4 分别 m1/m3 与 m1/m2。除金标外补紧迫度分母 0.25 下限、价格/key 同分、normal/high 储备、共享池累计预留和多池最小约束边界。

## 3 ModelHandle v1

lib/leases.mjs 负责锁内预留、持久化、重放与到期判定；lib/select.mjs 负责读取缓存、过滤、一次计算预测、调用 policy、生成选择结果。只读缓存指不探测、不刷新 inventory/models/probes、不写用量或池配置；申请租约所需状态写入仍然必须发生。

复用解析后的 config._home（实际 state_dir）和 config._file（实际配置路径），用该 state_dir 的既有 state 锁协调其他写入。租约及 request_id 的结果索引在同一次原子状态提交中持久化，不能先返回 handle、后写预留，不能用两个无事务写入留下半提交状态。新增模块内部存储只承担本任务需要的 handle、所选模型/池、估计预留、原请求和完整视图信息；复用已有契约名，不发布新的状态 schema、版本号或配置项，文件定位和读写集中在 leases 模块供后续执行器复用。

一次申请在同一临界区完成：重新读取当前额度/账本及有效租约，按 ctx.clock.now() 排除过期预留，查同 request_id，过滤和排序，逐项预留，原子提交全部新租约和首次结果，随后返回。昂贵但只读的目录合并可预先完成；额度与预留不能锁外读旧值后直接提交。提交失败整体失败，不返回未经落盘的成功结果；损坏状态、锁超时及 IO 错误沿用既有码，不清空状态重试。

同 state_dir 内同一非空 request_id 重放返回首次结果中深相等的 handle、lease_id、call、expires_at，不重新排序、换 id、刷新 TTL 或增加预留；新进程也如此。重放的是原申请，不能恢复过期预留或延长原 handle。重新补足须用新的 request_id，并传 exclude_handles；通过持久化映射排除这些 handle 对应的候选，已存在的有效预留仍占额度，不能靠排除动作取消预留。同键变更请求不能绕过首次结果生成第二批租约；省略 request_id 的独立调用不得都命中一个空字符串键。

选择时刻在锁内取 ctx.clock.now()，同批全部 handle 使用它，i 从 0 起：expires_at_i=selected_at+lease_ttl_s*1000+i*timeout_ms。lease_ttl_s 来自配置；timeout_ms 来自既有请求及默认规则，不另加 timeout_s 请求字段。过期条件与既有码触发一致，expires_at 早于 now 才过期；恰好相等和越过 1ms 都要测试。只回收过期预留，不重置实际池用量，不因估算 reset_at 越过而清零。

AgentLine handle 使用 cliworker.handle/v1 的 schema、handle_id、lease_id、level、label、readonly、expires_at、call；handle_id/lease_id 不编码模型或供应商。call.command 是 node 绝对路径，args 精确为 [bin 绝对路径,'run','--lease',lease_id,'--state-dir',state_dir 绝对路径,'--config',config 绝对路径]，另含 cwd、input:'stdin'、output:'cliworker.event/v1'、timeout_ms。不向其加入供应商 argv、模型、env 或密钥；真实 direct_call 保留在内部并只供完整视图使用。本任务生成 run 包装调用，不实现 T-023 的执行/消费功能。

## 2 ModelSelection v1（AgentLine 视图）

至少返回一个时 ok=true，count_returned=models.length=calls.length，truncated=(count_returned<count_requested)，shortfall=count_requested-count_returned，error=null；满额 shortfall=0。calls[i] deepStrictEqual models[i].call；所有 handle 同时满足非空调用、新鲜 callable、额度策略通过三个前提，不能先取 count 再过滤而漏补后续可用模型。

零选中时 models=[]、calls=[]、truncated=false、shortfall=count_requested。至少一个候选通过所有非额度过滤，且这些候选全部被 quota_low、reserve_protected、quota_unknown_policy 拒绝，唯一结果 E_INSUFFICIENT_QUOTA；否则 E_NO_CANDIDATE。retry_after 只从实际因额度被拒的池取最早 reset_at，无有效值为 null；非额度拒选池不参与。使用两个独立夹具固定两个错误，另测混合非额度拒选和额度拒选，不能把两码之一都当成功。

AgentLine 以字段白名单新建对象；rejected 使用不透明 ref 和注册原因，warnings 合并请求、视图、账本/数据陈旧及测试时钟警告，不能覆盖。管理 detail、原 request、模型 key、供应商、池、价格和 forecast 不向 AgentLine 复制。对实际 AgentLine 输出调用 scanView，传入真实目录、contracts/agentline-forbidden.json 和当前 wrapper，校验 ok=true、hits=[]。完整/草稿视图按其各自契约校验，不对原始 full/config 等管理示例错误要求 AgentLine 扫描零命中。

## 13 CLI

lib/commands/models/select.mjs 使用 requestFromArgv 和 gateView，先门控再缓存读取/租约写入；schema='cliworker.request/v1' 时得到 AgentLine，view=full 固定 E_VIEW_FORBIDDEN、退出码 2，且不产生租约。无 schema 或 compat=draft 由既有 draft 投影返回 0.1 扁平字段 key/provider/id/level/prices/quota/forecast/call，不含 cli，带 W_DRAFT_DEPRECATED，原因映射遵循已有迁移表。

lib/commands/admin/select.mjs 导出既有 route={cmd:'admin',sub:'select'} 和 run，由现有 collectRoutes 自举；完整视图仅此管理入口提供，每个 handle.detail 包含 model_key、cli、vendor、funding、pools、forecast、direct_call，密钥只允许已有 env_names 名称。两个命令共享同一选模和租约实现，不能各算一次或重复预留。请求验证错误保持原注册表退出码；零候选 CLI 使用 interfaces 第 13 节已定义通用错误体及退出码 5，编排模块返回第 2 节完整 selection 失败体。这样可复用现有 main 的 throw/errorBodyFrom 路径，不改 lib/cli.mjs、lib/output.mjs；CLI truncated 成功退出 0。不要让 main 对返回的 ok=false 默认退出 0。

本任务不实现 HTTP 路由、管理会话、降档授权或其他里程碑功能。已有其他任务的会话与身份契约不改动；本次 selectable 证据和拒选原因按当前 model/v1、缓存与注册表消费，不新增身份枚举。

## 15 测试设施格式

- test/unit/select-policy.test.mjs：[AC-051] 六个金标与排序边界；[AC-053] 零候选、额度/非额度原因及每个 handle 的准入条件。
- test/unit/select-reserve.test.mjs：[AC-052] 可配置储备、high、相等边界、已有预留与共享池。
- test/contract/selection-shape.test.mjs：[AC-053] 真实编排输出经既有 schema 校验，truncated/shortfall/calls、三项前提、TTL 与递延时间、两个唯一失败码；不只验证静态 examples。
- test/integration/select-concurrency.test.mjs：[AC-054] 50 个真实 Node 子进程，共享临时 config/state、时钟文件、屏障。全部 ready 后父进程创建屏障，子进程预先 fs.watch 并复查以免漏事件；不使用 sleep、固定墙钟等待或顺序启动完成来冒充并发。锁内等待使用可推进的注入时钟，由事件协调推进，不以真实延时赌调度。保留实际锁、实际文件原子写和实际生产编排；子进程入口可用 node --input-type=module -e，无需新增写域外脚本。检查所有成功响应所对应的每池预留及整个竞争过程的持久化快照都不超额，子进程全部收束。另测同键并发/串行/重启重放不增预留、新键 exclude_handles 在有剩余额度夹具中补足且不重复、TTL 过期后的预留释放以及提交失败不返回成功。跨模型不同容量共享池以比例独立计算总量，不能只把同模型句柄计数当所有池的证明。
- test/unit/select-noexec.test.mjs：[AC-055] 50 个白名单模型，调用真实命令与编排，ctx.exec/fetch 同时计数且一旦调用就失败；覆盖成功、缺缓存、陈旧缓存、拒选、full 门控和 CLI draft。exec=0、fetch=0，缓存内容/mtime 不变，forecast 每个通过前置过滤的模型至多一次，排序与 handle 复用结果。
- test/characterization/defects/a5-nocache.test.mjs：保持原 [repro]/[AC-005] 不动，新增 [fixed]/[AC-055]，调用 live 选模并断言两次选择不探测；不删复现、不改冻结副本。
- test/contract/selection-view.test.mjs：[AC-056] 遍历 contracts/examples 的输入材料及全部 AC-051..053 夹具，支持的请求驱动真实命令，模型/池等材料作为 fixture 输入，非法示例走其既有验证失败路径；对实际产生的 AgentLine 成功/失败输出 scanView 断言 0 命中。静态 AgentLine 示例也扫描，非 AgentLine 管理示例按所属 schema 校验，不先删除泄漏再扫描。由真实 main/bin 证明 full 门控码/退出码/无副作用、admin 路由及 detail、draft 与警告、两个额度错误退出码。假密钥哨兵扫描 stdout/stderr、JSON、状态和审计内容，不打印哨兵原值。
- test/flows/steps/select.mjs：保留现有发现器要求的 name、introduced_by、ac、run，并提供蓝图约定的 id='select'，introduced_by='T-022'，不改变 harness。步骤主动准备隔离的有效 v1 目录/额度/缓存，使用真实 CLI schema='cliworker.request/v1' 选择，断言 v1 handle/calls 并将结果存 flow.shared 供后续 run 消费；不再依赖 models[0].key。selection-view 的测试实际调用此步骤，完整检查链再验证原 flow 可用。
- test/perf/select.perf.mjs：50 模型夹具，预热后重复测量真实缓存选模路径，输出样本数和 p95 及单位，性能数字仅报告。现有 runner --perf 仅枚举 *.test.mjs，因此在允许的 test/perf/** 内增加 select.test.mjs 调用该测量模块；npm run perf 不得输出 no perf tests。使用 node:perf_hooks 仅测量耗时，业务时钟仍 ctx.clock；报告走 stdout 或系统临时结果目录，不新增协议 schema，不设 p95 门限、不纳入 AC 的墙钟断言。
- test/traceability/T-022.json：沿用 {task,milestone,entries}，task=T-022、milestone=M4，仅 AC-051..056，status 在实际覆盖后设 covered；files 指向上述相应可发现 *.test.mjs，baseline 只读 ac-index，不在分片增加字段。不得将 perf 结果伪装成功能门禁通过。

每个 AC 用 acceptance.md 独立命令验收，明确拒绝零测试、skip/todo/cancelled；完整完成检查使用已有 scripts/check-fast.ps1。design 轮只做文档格式与命令语法的只读检查，不运行可能生成报告/临时文件的实现检查链，也不宣称 AC 已通过。
