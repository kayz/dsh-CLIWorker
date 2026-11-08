---
write_scope:
  - lib/probe.mjs
  - lib/availability.mjs
  - lib/commands/models/probe.mjs
  - lib/select.mjs
  - lib/commands/models/select.mjs
  - test/integration/probe.test.mjs
  - test/integration/probe-ledger.test.mjs
  - test/fixtures/probe/**
  - test/flows/steps/probe.mjs
  - test/traceability/T-020.json
---

# Task 020 — 小 token 真实探测与可用性状态机（TTL 经 ctx.clock，探测消耗入账）

## 目标

交付 T-020 / M3 的 AC-047、AC-048，测试层级为 integration。依据同目录 brief.md、蓝图 design.md、interfaces.md 的模型、用量、配置、上下文和追踪契约，以及 task-graph.json 的 T-020；字段与枚举复用 contracts/schemas/model.v1.schema.json、usage.v1.schema.json、config.v2.schema.json、contracts/registry.snapshot.json。brief 没有提供本任务的基准 commit SHA 或既有验收报告路径，不借用其他任务的基准。

本轮用户裁决已解除上一轮的接线暂停：允许在 lib/select.mjs 与 lib/commands/models/select.mjs 接入逐模型 TTL，明确要求无探测记录的模型保持原有选择语义；T-018 已交付；目录读取复用已有导出；T-015 暂缺，允许使用 test/fixtures 下的本地 stub，但不得宣称集成覆盖。因此 front matter 在原范围上仅增加两个选择文件和本任务专属的 test/fixtures/probe/**。本 design 角色仍只修改 design.md 与 acceptance.md，不执行合并、不写代码或夹具。本轮不再等待上一轮 attention 的裁决，也不新建 attention.json。

现有文件足以确认：

- lib/cli.mjs 已通过 lib/routes.mjs 发现命令模块的 route 导出，models probe 可以在允许路径内注册，无需修改分发器。
- lib/catalog.mjs 已有 listModels(config, {models, ctx})、resolveModel(models, key)、filterAllowed(models)、selectModels(models)。当前 lib/models/directory.mjs 的 configuredModels 以及已交付的 cli resolve 都以配置中的 catalog.manual 为目录来源；cli resolve 实际使用 listModels(config, {models: [], ctx})。本任务照此读取，不调用仍报 E_CONFIG 的 readCatalogModels，不创建平行目录读取器，不要求修改 lib/catalog.mjs。configuredModels 带 managementView 投影，不把其 not_allowed 展示原因当成核心探测证据。
- T-018 的用户交付引用为提交 770b609；当前工作树已能读取 lib/adapters/call.mjs、display.mjs、lib/commands/cli/resolve.mjs 及适配器测试。这里仅将提交号作为交付来源，不冒称已执行 Git 或验证提交祖先关系，也不将它当成本任务基准 SHA。真实构造接口为 buildDirectCall({model, config, cwd, platform, readonly})，返回 {call, reason}；call 的键为 command、args、cwd、input、env_names。parsePlatform(value, fallback) 负责平台校验。未验证适配器返回 call=null，cli resolve 使用 E_NO_CANDIDATE 拒绝；不能猜测 buildCall、parseEvent 等并不存在的导出。
- lib/commands/models/select.mjs 调用 providerStatus 后进入 lib/select.mjs。该选择器按 provider 状态产生旧格式 availability:<state>，没有读取 model/v1 的 availability.at、ttl_s、evidence，也没有 availability_stale 分支。同 provider 下不同模型不能因此拥有各自的有效期。
- 本轮已授权修改选择器及其命令接线，具体实现见下文第 7 条；lib/catalog.mjs、lib/adapters/**、lib/models/** 仍只读。没有记录的模型不因本任务变成 unverified、stale 或被新的白名单策略拒绝，不重写既有排序、额度、视图、错误外壳或调用构造。
- test/helpers/fake-cli.mjs 与 T-015 的完整夹具尚未交付。本轮仅以 test/fixtures/probe/** 的本地 stub 验证状态机、命令接线、TTL、入账及重放；即使这些测试位于 test/integration，文件夹和 AC 标题也不能证明 T-015 集成覆盖。AC-047、AC-048 的追踪保持 planned，直到真实 T-015 接入并验收通过。

本轮可继续实现上述本地验证范围，不以 T-015 缺失阻断开发，也不能用本地通过替代最终集成验收。目录所需能力已由现有导出满足，不需要新的目录 helper 签名或配置回退标志；不另造 --config-only 等选项。实际执行过程仍不得把上游故障吞成空目录。T-018 当前没有事件解析导出，探测结果解码应在本任务 lib/probe.mjs 内显式处理已有、可查验的样本；本地 stub 样本只证明本地协议处理，不是供应商真实输出证据，未知输出保持未验证，不能据此宣称真实 CLI 已验证。

## 约束

1. **职责与兼容。** lib/probe.mjs 编排白名单、小提示推理、一次超时重试、身份与 nonce 核验、证据和用量提交；lib/availability.mjs 负责按规范模型 key 管理状态、缓存和新鲜度判断。保留现有 checkProvider、providerStatus 的兼容导出，不把版本或登录检查结果当作模型推理成功。lib/select.mjs 仅增加有探测记录时的可用性过滤，命令模块只负责加载并传入记录。模型结果使用现有 model/v1，不新增 probe schema、状态、错误码或配置字段。模块导入不执行探测或写状态。

2. **白名单先行。** 通过 catalog.listModels(config, {models: [], ctx}) 读取配置目录，再用 filterAllowed 构造探测集合，需要解析规范 key 或别名时调用 resolveModel；不得再次手写白名单、别名和弃用判断。catalog.selectModels 同时过滤缺等级，不能拿它的返回集合替代探测白名单而漏探允许但未分档的模型。只探测 allowed=true 的规范模型，别名解析后去重；不信任手工记录自报的 allowed。空白名单 exec=0、用量新增=0。未允许的模型不能先执行再隐藏结果，也不能进入探测拒选列表或产生账单。对照测试必须有确实被执行的允许模型，排除整个管线未运行造成的假通过。这里的白名单规则作用于探测，不借机改变无探测记录模型的旧选择语义。

3. **真实小提示。** 直接调用 T-018 的 buildDirectCall，原样使用其 command、args、cwd 和 stdin 约定；platform 来自 ctx.platform，cwd 来自实际执行工作区，不调用 cli resolve 子进程构造命令，因为其当前 callable 门会阻断首次探测。buildDirectCall 返回 call=null 时保留实际 reason，以既有 E_NO_CANDIDATE 失败，不猜参数、不启动 CLI。提示仅要求返回本次随机 nonce，不要求解释、工具调用或读写工作区。nonce 来自 ctx.random；每个新的逻辑探测有独立 probe_id，不因模型相同而复用历史身份或 nonce。stdin 不拼入 argv，不增加没有实际参数证据的 token 上限开关。令牌上限仅使用上游已验证的能力；不在本任务发明 CLI 参数或厂商数字。外部执行经过 ctx.exec，认证复用已有 SecretRef 的环境注入，密钥值不进入命令、结果或缓存。本地 stub 通过测试临时配置的 discovery.cli_overrides 指定 node 和 args_prefix，不把 stub 路径、模式或默认供应商植入生产代码。

4. **重试。** 仅执行结果明确为 E_TIMEOUT 时再执行一次，同一逻辑探测最多两次；不重做版本、help、登录或模型列表检查来凑 exec 次数。持续 timeout 的总 exec=2，ok、auth、quota、enoent、deprecated、mismatch 各为 1。第一次 timeout、第二次成功时按第二次有效结果判定，并保留整个逻辑探测实际消耗；第二次失败不再重试。重试共用 probe_id 与最终幂等键，不能写两条探测用量。未允许模型、配置已明确弃用模型以及未验证适配器不启动推理；配置已弃用的 exec=0 与 fake-cli 在实际调用后报告 deprecated 的 exec=1 分开验收。

5. **状态与身份。** 没有推理证据时为 unverified。成功退出、有效 nonce 回显且报告模型与请求规范模型一致时为 callable；auth 为 blocked 且 reason=auth，quota 为 blocked 且 reason=quota；重试耗尽的 timeout、enoent 为 unavailable；实际报告 deprecated 为 deprecated。明确报告其他模型时 identity=mismatch、state=blocked，不能被有效 nonce 或退出 0 覆盖。身份值只取当前 model/v1 的 verified、unverified、mismatch；不引入其他任务的新身份分档。未知模型身份、无 nonce、错误 nonce、损坏事件或只有版本信息均不得成为 callable。身份比较使用目录已有的别名解析，不用模糊字符串包含判断。失败的重新探测覆盖旧 callable，不能沿用旧成功结果；清除阻断只能来自后续有效探测，不能仅靠 TTL 到期。

6. **证据。** availability 保持 state、reason、at、ttl_s、evidence；evidence 包含 interfaces.md 已定义的 probe_id、cmd_redacted、exit、duration_ms、nonce_ok、reported_model、tokens。at 取探测完成时的 ctx.clock.nowIso()，ttl_s 取 policy.probe_ttl_s，缺省采用契约已有的 21600 秒；duration_ms 来自同一 ctx.clock 的起止差。nonce_ok 为实际核验结果；reported_model 只来自可信解析，缺失不能用请求值补齐；exit 保留真实退出情况，不把未启动或超时改写成退出 0。tokens 来自解析出的实际用量，不使用提示长度猜测。命令证据只保存脱敏描述，不保留原始 stdout/stderr、环境变量值或完整异常对象。失败证据同样保留上述键，不生成虚假成功值。

7. **TTL 与缓存。** 在实际 config._home 即解析后的 state_dir 下使用 probes.json 保存已提交的完整 model/v1 记录数组，复用原结构，不新增 schema 或 envelope；它只存探测结果，不承担目录枚举、允许授权或配置写回。通过 ctx.fs、store.readJson 和 atomicWriteJson 读写，按规范 key 更新，锁内合并避免不同模型结果互相覆盖。以 key、provider、id 对照当前配置目录，不把已经换身份的同名记录套到另一模型，也不从缓存新增候选。缺失文件表示没有探测记录；文件损坏或记录非法必须失败，不能等价于没有记录。

   lib/availability.mjs 新增内部模块导出 readProbeModels(config, {ctx})，返回上述已校验记录数组；这是本任务缓存读取接口，不是替代 catalog 的目录读取器，也不改变 JSON 契约。lib/commands/models/select.mjs 在原请求解析、视图门控之后读取一次并作为内部 options.probeModels 传给 lib/select.mjs 的 selectModels(config, request, {status, usage, ctx, probeModels=[]})。该参数不进入 CLI 请求或响应。直接模块调用可以显式传入记录，既有调用省略它时行为保持原样。

   选择器保留既有 excluded、candidates、level 过滤顺序；在既有 availability 检查位置处理当前 key 的探测记录。有记录时以其 availability 与 identity 判定，不能被 providerStatus 的版本成功覆盖；配置已弃用仍不能复活。callable 新鲜条件为有效 at、有效非负 ttl_s 且 ctx.clock.now()-Date.parse(at) <= ttl_s*1000；超过阈值，在 forecast、排序、handle/call 构造前以精确 availability_stale 拒绝。缺失或非法时间不能按新鲜 callable 使用。blocked、unavailable、unverified、deprecated 和身份冲突分别沿用注册表已定义的拒选原因；不要把 blocked 的过期结果变成 callable。stale 只是拒选原因，不是第六种 state。缓存读取不刷新 at，不执行推理或自动重试；命令原有兼容 provider 检查不改造成推理刷新。

   没有该 key 的探测记录时，完整保留旧 provider 状态、身份、缺等级处理、拒选字符串、readonly、额度、排序、调用向量和视图行为，包括手工 availability 带旧 at 但 evidence=null 的模型。不得把全局 policy.probe_ttl_s 套给所有旧模型。不要修改 lib/request.mjs 或要求客户端增加字段，也不借本次授权把选择器改为另一套目录策略。生产命令必须真正加载 probes.json；测试只调用 TTL helper 不足以验收。

8. **用量入账。** 每个实际启动的逻辑探测，在其所有尝试结束后提交一条 cliworker.usage/v1，kind=probe、idempotency_key=probe:<probe_id>，model 为规范 key，pools 为模型实际所属池。字段使用 schema 已有的 id、lease_id、input_tokens、output_tokens、cache_read_tokens、cache_write_tokens、cost_usd、pool_fraction_before、pool_fraction_after、at；不创建探测租约或额外账本协议。没有租约时 lease_id 使用既有 string 类型的空字符串；没有可信池前后读数时对应字段为 null，不编造读数。已确认未产生用量的启动失败可以为零，但未知或部分失败不能冒称已证实免费；实际已解析的用量，即使最终身份冲突、nonce 失败或超时，也必须计入。两次尝试的可确认用量合并到同一逻辑探测行，累计消耗不能只取最后一次。

9. **幂等与额度。** 使用现有 usageFile 定位 usage.jsonl，经 withLock 在锁内读取并查找幂等键，再使用 store.appendJsonl 写入；不能用会吞解析异常的 config.readUsage 来判断“没有同键行”。已有同键行返回原 id，不再追加；锁内合并防止并发重放重复提交。账本写入失败必须向上失败，不能返回完整探测提交成功。先完成用量提交，再公布新成功缓存，避免缓存成功但账本遗漏；失败重放沿用原 probe_id，新的主动探测使用新 id。重放提交不能重新执行推理。使用现有 pools.billedTokens、evaluatePools / remainingForModels 的口径读取账本，不直接增加配置中 used_fraction 再被账本计第二次。测试用已知容量和窗口，独立计算探测前后的 used 差；同时断言无关池不变、读数前后截止规则成立、同键重放差值为零。

10. **命令与流程。** lib/commands/models/probe.mjs 导出 route={cmd:'models',sub:'probe'} 和现有 run({argv,ctx,config})。基础调用为 models probe --config <配置>，复用 parseModelOptions 校验选项，处理配置目录白名单，不新增必填选项或公共返回字段；沿用 cliworker.models/v1 的 models 容器返回更新后的 model/v1。参数、配置、锁与持久化错误复用已有错误输出和退出码，不回显原始输入。真实 bin/cliworker.mjs 必须可达，不能仅直接调用命令模块验收。流程步骤沿用当前 harness 的 name='probe'、introduced_by='T-020'、ac=['AC-047','AC-048']、run(env)，并导出蓝图已有的 id='probe'。当前 harness 的默认配置是旧 v1 且 stub 只报版本，步骤必须临时换成完整 v2 手工目录与本任务 stub，仍使用同一个 env.config_path / state_dir，通过 env.run 执行命令并复读结果，finally 恢复原配置及本步骤专属探测缓存，避免改变后续旧 select 步骤。账本检查与 env.scan() 在恢复前执行；不改 harness 或其他任务夹具，不使用无断言的空步骤。这是本地 stub 流程回归，不能称为 T-015 全流程集成已通过。

11. **集成测试。** 当前先在 test/fixtures/probe/** 放本任务专属本地 stub 与脱敏响应样本，不冒充 test/helpers/fake-cli.mjs，不创建 T-015 的 11+1 CLI 生成器。stub 只在测试配置中使用；支持本任务的 ok、auth、quota、timeout、deprecated、mismatch、错误/缺失 nonce 等可控情况，记录安全的调用次数和参数，不能记录密钥值。样本与被测解码逻辑分别维护，不由被测函数生成预期；没有供应商样本的分支明确为合成协议验证，不能据此宣称真实供应商输出已支持。enoent 使用不存在的可执行目标。probe.test.mjs 的标题含 [AC-047] 并明确 local stub；原有集成标准不删除，但本轮仅记本地回归通过。

   逐项断言状态、身份、exec 计数、完整证据和 nonce_ok，另测缺失报告身份、timeout 后成功、失败覆盖旧 callable，以及同 provider 不同模型的缓存隔离。伪时钟使用 test/helpers/clock.mjs，在 TTL 内、恰好边界和 advance 超过阈值后调用真实 selectModels；另经真实 main 或 bin 命令证明从缓存接入。至少有一个新鲜可选对照，过期模型必须在真实 rejected 中且 reason 精确为 availability_stale，不能只检查空 models。额外覆盖无缓存文件、空数组、仅另一模型有记录、手工 evidence=null 四种无记录情况，独立断言现有候选、顺序、call、forecast 次数、身份和拒选原因全部保持原样。既有 select、select-draft、适配器测试原文件只读，必须继续通过。

12. **入账测试。** probe-ledger.test.mjs 的标题含 [AC-048]，在独立临时 state_dir 或注入文件系统中断言允许模型确实执行、未允许模型零执行零行、别名不重复、每次实际探测一行、完整 usage schema、池归属与 used 增量。覆盖失败但有实际用量、超时两次合并、同 probe_id 串行及并发重放、两次新探测各计一次、损坏账本及追加失败不能返回成功。对 stdout/stderr、JSON、缓存、用量文件和 argv 放置假的密钥哨兵并用既有 leak-scan 检查；不得把真实凭据带入测试。AC-047 测试还需实际运行新增 flow 步骤，避免 --ac 过滤运行遗漏它。

13. **追踪。** test/traceability/T-020.json 只采用既有 task、milestone、entries 格式，task=T-020、milestone=M3，仅登记 AC-047 对应 test/integration/probe.test.mjs、AC-048 对应 test/integration/probe-ledger.test.mjs。flows/steps/probe.mjs 由这些测试实际调用，不作为独立 .test.mjs 登记，以符合现有完整运行清单的文件判定。T-015 缺失期间，两条 status 均保持 planned，不因本地 stub 测试放在 integration 目录、--ac 运行退出 0 或子进程真实启动就写 covered；baseline 只从 contracts/spec/ac-index.json 读取。后续 T-015 实际交付后必须用其真实生成器重新验证原 AC 的全部模式、执行记录和入账，再执行正式验收命令，才能标 covered。不修改 AC 索引或增加 local 等追踪字段。

## 建议验收方向

执行顺序为：按本轮授权实现已有配置目录与 T-018 构造接口的接入 → 实现逐模型缓存与最小选择过滤 → 实现探测入账与命令 → 本地 stub 和旧语义回归。acceptance.md 为两条 AC 分别列独立本地回归命令与正式集成命令及各自期望。本轮本地回归命令可通过，正式集成命令在缺失 T-015 时必须非零且不打印 AC OK；不能将前者当成后者，也不采用 skip 把缺口隐藏。T-015 交付且测试真实接入后再运行 --ac 及正式验收，零匹配、失败、取消、skip、todo 都不算通过。当前只是规格更新，不是实现或测试通过报告。

M3 全部属主任务完成后执行 node scripts/milestone-gate.mjs --milestone M3，期望退出 0 且输出 milestone-gate M3: PASS；它受其他 M3 任务影响，不能以修改索引、伪造分片或将本任务两条 AC 的 filtered 清单冒充 full 结果使其通过。完成前还须执行 pwsh -NoProfile -File scripts/check-fast.ps1，期望退出 0 且输出 check-fast: ok。这些门禁由实现/验收角色执行；本 design 角色不能运行会创建报告、临时夹具或执行 Git 的检查链。设计阶段只做不落盘、不调用 Git 的验收文档解析检查，不声称实现已通过。

## 非目标

不修改本轮 front matter 以外的代码、测试、契约、蓝图或配置，不实现 T-022 的选模策略、T-023 的任务执行器、身份新分档、自动定时探测、HTTP/UI 或其他里程碑。选择文件的新增权限只用于逐模型探测过滤及缓存接线，不扩展到重做选择算法或改造无探测记录模型。本地 fixture 权限仅限 test/fixtures/probe/**。运行时代码与测试不引用 .collab，不内置模型表、厂商容量或虚构参数。Node 20+ / ESM，零第三方运行时依赖；外部执行、文件、时钟、随机数经过 ctx，不引入全局时钟或计时器。

本轮 design 仅修改同目录 design.md、acceptance.md，不执行 Git，不创建临时脚本、夹具、报告、attention.json 或任何其他文件。文本为 UTF-8 无 BOM。用户所述 git merge main 与本轮禁止 Git、禁止写代码的角色约束冲突；当前工作树所需 T-018 文件已存在，本轮直接读取它们完成设计核对，不执行合并。T-015 集成缺口保留并明确上报，不再把已解决的写域问题当作暂停理由。
