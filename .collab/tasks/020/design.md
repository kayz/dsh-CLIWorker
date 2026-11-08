---
write_scope:
  - lib/probe.mjs
  - lib/availability.mjs
  - lib/commands/models/probe.mjs
  - test/integration/probe.test.mjs
  - test/integration/probe-ledger.test.mjs
  - test/flows/steps/probe.mjs
  - test/traceability/T-020.json
---

# Task 020 — 小 token 真实探测与可用性状态机（TTL 经 ctx.clock，探测消耗入账）

## 目标

交付 T-020 / M3 的 AC-047、AC-048，测试层级为 integration。依据同目录 brief.md、蓝图 design.md、interfaces.md 的模型、用量、配置、上下文和追踪契约，以及 task-graph.json 的 T-020；字段与枚举复用 contracts/schemas/model.v1.schema.json、usage.v1.schema.json、config.v2.schema.json、contracts/registry.snapshot.json。brief 没有提供本任务的基准 commit SHA 或既有验收报告路径，不借用其他任务的基准。

当前存在必须裁决的接线冲突，详见同目录 attention.json。在裁决及所需前置交付完成前，本设计保留原 write_scope，不能以扩大写域、降低 AC 或伪造接线解决问题，也不能将两条 AC 标为 covered。下列行为要求用于恢复后的实现；验收命令是完成条件，不是已通过的报告。

现有文件足以确认：

- lib/cli.mjs 已通过 lib/routes.mjs 发现命令模块的 route 导出，models probe 可以在允许路径内注册，无需修改分发器。
- lib/catalog.mjs 提供 listModels、resolveModel、filterAllowed；原生 v2 的 readCatalogModels 仍直接报 E_CONFIG，没有可供探测命令消费的目录读取实现。lib/models 和 test/helpers/fake-cli.mjs 当前也未交付。
- lib/adapters/call.mjs 只有 buildDirectCall 等调用构造能力，没有上游设计要求的事件解析入口。不能依据提示词或请求模型伪造 reported_model，也不能自造另一套 CLI 输出协议代替 T-018。
- lib/commands/models/select.mjs 调用 providerStatus 后进入 lib/select.mjs。该选择器按 provider 状态产生旧格式 availability:<state>，没有读取 model/v1 的 availability.at、ttl_s、evidence，也没有 availability_stale 分支。同 provider 下不同模型不能因此拥有各自的有效期。
- 修改上述选择器、命令接线、目录模块均超出本任务写域。导出一个 TTL 辅助函数并在测试中直接调用，不等于 AC-047 所要求的真实选模拒选；不能将接线留给未来 T-022 却声称当前 AC-047 已完成。

恢复时按顺序核对 T-015 的实际 fake-cli 接口、T-018 的实际调用及解析接口、T-019 的目录读取接口，以及裁决确定的生产选模接线。缺失时明确失败，不吞成空目录，不把全部跳过当作成功。本设计不预定尚未交付的函数签名、缓存路径或响应字段；如果裁决要求扩大范围，须先更新本设计和 acceptance.md，再开始实现。

## 约束

1. **职责与兼容。** lib/probe.mjs 编排白名单、小提示推理、一次超时重试、身份与 nonce 核验、证据和用量提交；lib/availability.mjs 负责按规范模型 key 管理状态、缓存和新鲜度判断。保留现有 checkProvider、providerStatus 的兼容导出，不把版本或登录检查结果当作模型推理成功。模型结果使用现有 model/v1，不新增 probe schema、状态、错误码或配置字段。模块导入不执行探测或写状态。

2. **白名单先行。** 从真实目录读取归一记录，再经 catalog.listModels 和 filterAllowed 构造探测集合。只探测 allowed=true 的规范模型，别名解析后去重；不信任上游记录自报的 allowed。空白名单 exec=0、用量新增=0。未允许的模型不能先执行再隐藏结果，也不能进入探测拒选列表或产生账单。对照测试必须有确实被执行的允许模型，排除整个管线未运行造成的假通过。

3. **真实小提示。** 通过经验证的适配器构造 command、args、cwd、stdin；提示仅要求返回本次随机 nonce，不要求解释、工具调用或读写工作区。nonce 来自 ctx.random；每个新的逻辑探测有独立 probe_id，不因模型相同而复用历史身份或 nonce。stdin 不拼入 argv，不增加没有实际参数证据的 token 上限开关。令牌上限仅使用上游已验证的能力；不在本任务发明 CLI 参数或厂商数字。外部执行经过 ctx.exec，认证复用已有 SecretRef 的环境注入，密钥值不进入命令、结果或缓存。

4. **重试。** 仅执行结果明确为 E_TIMEOUT 时再执行一次，同一逻辑探测最多两次；不重做版本、help、登录或模型列表检查来凑 exec 次数。持续 timeout 的总 exec=2，ok、auth、quota、enoent、deprecated、mismatch 各为 1。第一次 timeout、第二次成功时按第二次有效结果判定，并保留整个逻辑探测实际消耗；第二次失败不再重试。重试共用 probe_id 与最终幂等键，不能写两条探测用量。未允许模型、配置已明确弃用模型以及未验证适配器不启动推理；配置已弃用的 exec=0 与 fake-cli 在实际调用后报告 deprecated 的 exec=1 分开验收。

5. **状态与身份。** 没有推理证据时为 unverified。成功退出、有效 nonce 回显且报告模型与请求规范模型一致时为 callable；auth 为 blocked 且 reason=auth，quota 为 blocked 且 reason=quota；重试耗尽的 timeout、enoent 为 unavailable；实际报告 deprecated 为 deprecated。明确报告其他模型时 identity=mismatch、state=blocked，不能被有效 nonce 或退出 0 覆盖。身份值只取当前 model/v1 的 verified、unverified、mismatch；不引入其他任务的新身份分档。未知模型身份、无 nonce、错误 nonce、损坏事件或只有版本信息均不得成为 callable。身份比较使用目录已有的别名解析，不用模糊字符串包含判断。失败的重新探测覆盖旧 callable，不能沿用旧成功结果；清除阻断只能来自后续有效探测，不能仅靠 TTL 到期。

6. **证据。** availability 保持 state、reason、at、ttl_s、evidence；evidence 包含 interfaces.md 已定义的 probe_id、cmd_redacted、exit、duration_ms、nonce_ok、reported_model、tokens。at 取探测完成时的 ctx.clock.nowIso()，ttl_s 取 policy.probe_ttl_s，缺省采用契约已有的 21600 秒；duration_ms 来自同一 ctx.clock 的起止差。nonce_ok 为实际核验结果；reported_model 只来自可信解析，缺失不能用请求值补齐；exit 保留真实退出情况，不把未启动或超时改写成退出 0。tokens 来自解析出的实际用量，不使用提示长度猜测。命令证据只保存脱敏描述，不保留原始 stdout/stderr、环境变量值或完整异常对象。失败证据同样保留上述键，不生成虚假成功值。

7. **TTL 与缓存。** 缓存按规范模型 key 隔离，并与实际配置解析出的 state_dir 绑定，不能按 provider 共享成功状态。读取缓存不刷新 at，不将过期 callable 改造成新的成功探测。新鲜条件为有效 at、有效 ttl_s 且 ctx.clock.now()-Date.parse(at) <= ttl_s*1000；超过阈值时，选模必须在生成 handle/call 前以既有 availability_stale 拒绝。stale 是拒选原因，不是第六个 availability.state。缺失或非法时间证据不能按新鲜 callable 使用。选模读取不触发真实推理或自动重试。缓存只持久化现有模型与证据结构，使用 ctx.fs 和 store 的原子写；读取损坏数据应失败，不能静默恢复为 callable。具体读取和选择接线须由 attention 裁决及真实上游接口落实，不能在测试中造第二个选择器。

8. **用量入账。** 每个实际启动的逻辑探测，在其所有尝试结束后提交一条 cliworker.usage/v1，kind=probe、idempotency_key=probe:<probe_id>，model 为规范 key，pools 为模型实际所属池。字段使用 schema 已有的 id、lease_id、input_tokens、output_tokens、cache_read_tokens、cache_write_tokens、cost_usd、pool_fraction_before、pool_fraction_after、at；不创建探测租约或额外账本协议。没有租约时 lease_id 使用既有 string 类型的空字符串；没有可信池前后读数时对应字段为 null，不编造读数。已确认未产生用量的启动失败可以为零，但未知或部分失败不能冒称已证实免费；实际已解析的用量，即使最终身份冲突、nonce 失败或超时，也必须计入。两次尝试的可确认用量合并到同一逻辑探测行，累计消耗不能只取最后一次。

9. **幂等与额度。** 使用现有 usageFile 定位 usage.jsonl，经 withLock 在锁内读取并查找幂等键，再使用 store.appendJsonl 写入；不能用会吞解析异常的 config.readUsage 来判断“没有同键行”。已有同键行返回原 id，不再追加；锁内合并防止并发重放重复提交。账本写入失败必须向上失败，不能返回完整探测提交成功。先完成用量提交，再公布新成功缓存，避免缓存成功但账本遗漏；失败重放沿用原 probe_id，新的主动探测使用新 id。重放提交不能重新执行推理。使用现有 pools.billedTokens、evaluatePools / remainingForModels 的口径读取账本，不直接增加配置中 used_fraction 再被账本计第二次。测试用已知容量和窗口，独立计算探测前后的 used 差；同时断言无关池不变、读数前后截止规则成立、同键重放差值为零。

10. **命令与流程。** lib/commands/models/probe.mjs 导出 route={cmd:'models',sub:'probe'} 和现有 run({argv,ctx,config})。基础调用为 models probe --config <配置>，处理目录白名单，不新增必填选项或公共返回字段；沿用 cliworker.models/v1 的 models 容器返回更新后的 model/v1。参数、配置、锁与持久化错误复用已有错误输出和退出码，不回显原始输入。真实 bin/cliworker.mjs 必须可达，不能仅直接调用命令模块验收。流程步骤沿用当前 harness 的 name='probe'、introduced_by='T-020'、ac=['AC-047','AC-048']、run(env)，并导出蓝图已有的 id='probe'；通过同一 flow 临时配置、state_dir 和真实 CLI 探测并复读证据与账本，执行 env.scan() 检查泄漏。用步骤自身可用的隔离临时数据，不修改 harness 或上游 fixture 文件，结束恢复共享配置，不能以无断言的空步骤通过。

11. **集成测试。** probe.test.mjs 的标题含 [AC-047]，消费 T-015 真正生成的 fake-cli；enoent 使用不存在的可执行目标，不把它当作第七种夹具模式。逐项断言状态、身份、exec 计数、完整证据和 nonce_ok，另测错误/缺失 nonce、缺失报告身份、timeout 后成功、失败覆盖旧 callable，以及跨模型缓存隔离。伪时钟使用 test/helpers/clock.mjs，在 TTL 内、恰好边界和边界后验证生产选择结果；至少有一个新鲜可选对照，旧模型必须出现在真实 rejected 中且 reason 精确为 availability_stale，不能只检查空 models。

12. **入账测试。** probe-ledger.test.mjs 的标题含 [AC-048]，在独立临时 state_dir 或注入文件系统中断言允许模型确实执行、未允许模型零执行零行、别名不重复、每次实际探测一行、完整 usage schema、池归属与 used 增量。覆盖失败但有实际用量、超时两次合并、同 probe_id 串行及并发重放、两次新探测各计一次、损坏账本及追加失败不能返回成功。对 stdout/stderr、JSON、缓存、用量文件和 argv 放置假的密钥哨兵并用既有 leak-scan 检查；不得把真实凭据带入测试。AC-047 测试还需实际运行新增 flow 步骤，避免 --ac 过滤运行遗漏它。

13. **追踪。** test/traceability/T-020.json 只采用既有 task、milestone、entries 格式，task=T-020、milestone=M3，仅登记 AC-047 对应 test/integration/probe.test.mjs、AC-048 对应 test/integration/probe-ledger.test.mjs。flows/steps/probe.mjs 由这些测试实际调用，不作为独立 .test.mjs 登记，以符合现有完整运行清单的文件判定。只有相关验收全部通过才标 covered，baseline 只从 contracts/spec/ac-index.json 读取。

## 建议验收方向

先解决 attention 中的接线裁决并确认前置实际交付，再实现探测与状态缓存、用量提交、命令和流程，最后分别执行 acceptance.md 的两条独立命令。每条均使用真实 --ac 运行，零匹配、导入失败、失败、取消、skip、todo 都不算通过；预期结果必须由集成测试对真实模块与入口的断言证明。

M3 全部属主任务完成后执行 node scripts/milestone-gate.mjs --milestone M3，期望退出 0 且输出 milestone-gate M3: PASS；它受其他 M3 任务影响，不能以修改索引、伪造分片或将本任务两条 AC 的 filtered 清单冒充 full 结果使其通过。完成前还须执行 pwsh -NoProfile -File scripts/check-fast.ps1，期望退出 0 且输出 check-fast: ok。这些门禁由实现/验收角色执行；本 design 角色不能运行会创建报告、临时夹具或执行 Git 的检查链。设计阶段只做不落盘、不调用 Git 的验收文档解析检查，不声称实现已通过。

## 非目标

不修改原 write_scope 以外的代码、测试、契约、蓝图或配置，不实现 T-022 的选模策略、T-023 的任务执行器、身份新分档、自动定时探测、HTTP/UI 或其他里程碑。运行时代码与测试不引用 .collab，不内置模型表、厂商容量或虚构参数。Node 20+ / ESM，零第三方运行时依赖；外部执行、文件、时钟、随机数经过 ctx，不引入全局时钟或计时器。

本轮 design 仅创建同目录 design.md、acceptance.md，以及用户明确要求在致命歧义时创建的 attention.json；不执行 Git，不创建临时脚本、报告或任何其他文件。文本为 UTF-8 无 BOM。attention 的默认选项不是人类已批准，不能据此继续依赖裁决的实现。
