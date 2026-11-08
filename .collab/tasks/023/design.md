---
write_scope:
  - lib/runner.mjs
  - lib/events.mjs
  - lib/commands/run.mjs
  - lib/cli.mjs
  - lib/select.mjs
  - test/integration/runner.test.mjs
  - test/integration/runner-errors.test.mjs
  - test/flows/steps/run.mjs
  - test/traceability/T-023.json
---
# Task 023 — 执行器 run --lease：注入令牌、归一事件、前后记账、幂等、超时、失败回写、配置核对

## 目标

交付 brief 与任务图 T-023 / M4 指定的执行器，覆盖 integration 层的 AC-057、AC-058。规格来源为 .collab/blueprint/cliworker-v2/design.md、interfaces.md 第 3、4、5、9、11、13、15、16 节及 task-graph.json 的 T-023。实际字段、校验及错误语义使用 contracts/schemas/event.v1.schema.json、usage.v1.schema.json、contracts/registry.snapshot.json、contracts/spec/ac-index.json；运行时和测试不得引用 .collab。

**本轮用户已授权继续：在原七项写域上增加 lib/cli.mjs、lib/select.mjs，只做 run 所需的 opt-in 接线和租约配置摘要附加写入。** 上轮 attention 的这两项阻塞已解除，不再等待相同裁决。用户要求事件名字与形状继续遵守 interfaces 第 13 节所引用的 event/v1；无法由既有模块提供的部分在本设计记录缺口，不新造事件。其余未受本轮影响的交付行为与验收要求保持。

brief 未给出本任务的基准 commit SHA 或既有验收报告。蓝图提到的 f75bb76 是特征化冻结副本来源，不是 T-023 的行为基准，不得拿冻结副本或旧报告替代本次 live 执行器验收。

## 约束

本轮 design 角色只修改本目录 design.md、acceptance.md，不重建上轮 attention，不修改 brief.md、impl.md、review*.md、verdict*.json、state.json、run.json 或任何代码，不执行 git，不创建脚本或测试报告。文本使用 UTF-8 无 BOM。下游实现写域严格等于 front matter 的九项；lib/leases.mjs、lib/output.mjs、lib/routes.mjs、contracts 及现有回归测试均未获写入授权。

现有文件及本轮授权对应的接入要求：

- lib/cli.mjs:79–87 当前无条件加载配置、追加普通 JSON、成功退出 0。获授权的修改只增加显式 opt-in：run 的 route 声明 streamed:true，命令完成后返回用户答复允许的内部控制对象 {exitCode,streamed:true}。main 对声明且返回该标志的命令不调用 writeJson、不追加 warnings，只返回 {exitCode} 给既有 bin。未声明的命令不根据业务 payload 的 ok、error、exitCode 或 streamed 属性推断退出码与输出方式；原成功路径仍调用 warnAboutTestClock/writeJson 并返回 0，原 catch 仍使用注册表 envelope。禁止全局改 writeJson、替换 ctx.stdout、process.exit 或改薄 bin。
- 为使合法 run --lease 的配置加载错误也能产生 event/v1，只有声明 streamed:true 的 run 路由把 loadConfig 移到自己的命令处理内，沿用既有解析函数。main 不提前加载该路由的配置；其他路由保持加载顺序。run 在校验合法 lease_id 后创建同一事件写入器，在自己的 try/catch 内处理配置加载、执行和持久化错误，均返回 {exitCode,streamed:true}，不能让已经输出事件的异常逃到 main 的普通 envelope catch。缺失或格式非法的 --lease 在事件流启动前仍按既有参数错误 envelope 处理，不虚构可通过 schema 的 lease_id。
- lib/select.mjs:714–724 的租约构造新增且仅新增内部 config_digest 字段，既有字段和 requests 索引保持原样；lib/leases.mjs 的校验允许附加字段且不要求它存在，因此无需修改 leases。摘要在真实选模提交租约前生成并随同一次原子提交保存，不能推迟至首次 run、从路径代替内容或靠测试手填。下面明确该获授权附加字段的计算与旧记录规则，不新增公开 schema 或版本。
- 本轮提供的 lib/commands/models/select.mjs 增量必须保留：失败选择在 gated.view='draft' 时返回带 warnings 的 draft，在 result.legacy=true 时返回带 warnings 的 agentline，沿用普通命令返回 0；其余 v1 AgentLine 失败才 throw 对应注册表错误。main 不把 ok=false 一律改成非零，也不把所有 select 结果改为流式。本任务不修改该命令文件。
- 已知契约缺口：interfaces 第 13 节的每个输出带 W_TEST_CLOCK 与 event/v1 的 additionalProperties=false、无 warnings 字段不能同时按普通 JSON 追加规则实现。按本轮用户“记录缺口、不新造事件、继续”的答复，run 的 stdout 严守 start/text/usage/result/error 和冻结字段；普通命令继续原警告行为。不要添加 warning 事件、额外 envelope、stderr 新协议或把警告塞入业务 text。文件时钟下可验收事件 shape/时间读取，但不得宣称 run 的逐事件 W_TEST_CLOCK 已实现。

摘要的内部共用计算放在已获写入授权的 lib/runner.mjs，选模与执行都调用同一纯函数；runner 不静态导入 select，避免循环导入和导入时 IO。config_digest 为 Node 内置 crypto 的 SHA-256、小写 64 位 hex。输入为 JSON.stringify([规范化的实际 state_dir,规范化后的生效配置]) 的 UTF-8 字节：state_dir 取 config._home 的规范化绝对路径，win32 按现有路径规则转小写；配置取 loadConfig 返回对象的自有可枚举 JSON 数据，递归按对象键排序、数组顺序保持。只包含 SecretRef，不解析或包含秘密值；_file、_home、warnings 这类不可枚举运行元数据不进入配置数据。源文件缩进、键顺序和同内容的配置文件改名不影响摘要；相对路径最终落到不同 state_dir 或任何生效配置值改变则影响摘要。摘要绑定传给真实选模的同一配置对象，不再重读文件以免与构造调用使用的配置错位。

run 在显式 --state-dir 定位的租约上，把记录值与使用本次配置原本解析出的 state_dir 所算摘要比较，再为后续状态操作使用显式目录；不先覆写 _home 而掩盖配置差异。缺失或非法 config_digest 的旧租约仍被既有租约 reader、选模和 request_id 重放接受，不迁移、不回填、不重置预留；执行时无法证明快照一致，返回现有 E_LEASE_CONFIG_MISMATCH、退出 6、无启动/记账副作用，调用方重新申请租约。重放已有 request_id 不刷新原租约摘要。新字段只在内部 leases 记录，不进入 handle、call、selection 或其他公开输出。

其余实施约束已经明确：Node 20+、ESM、零第三方运行时依赖；时间与定时器经 ctx.clock，IO 经 ctx.fs/store，进程经既有 exec。不得改变公开 schema、注册表、AC 属主或 baseline。不得将其他里程碑功能纳入本任务。

按下列职责实施，并使用上文已经明确的 opt-in 和摘要规则：

1. lib/commands/run.mjs 注册 route={cmd:'run',sub:null,streamed:true}，遵循命令模块入口和上述 opt-in，解析 brief 已有 --lease、--state-dir、--config。实际状态定位必须使用包装调用给出的绝对 state_dir，不能仅采用新配置的默认状态目录而读错租约。输入经 ctx.fs.readFileSync(0,...) 等既有 IO 缝读取并完整传给执行器，不 trim、不添加换行。合法 lease_id 的配置加载失败也由此命令写 error 事件并返回注册表退出码，不追加普通 JSON。
2. lib/runner.mjs 编排租约校验、秘密注入、异步执行、记账与失败回写。租约来自 readLeaseState，保持同文件 requests 索引及其他租约；复用现有 state 锁和原子写。查找、到期与消费判定必须发生在供应商启动和写 pre 之前，失败不启动 provider、不新增账本行。到期沿用 isExpired 的严格早于 now 规则，恰好 expires_at 尚有效，超过才返回 E_LEASE_EXPIRED。未知租约用 E_LEASE_UNKNOWN；成功过的租约重放用 E_LEASE_CONSUMED。
3. 同一租约的启动资格使用既有 lockFilePath/withLock 的命名锁能力按 lease_id 隔离，锁名只由合法 ID 构造，沿用锁文件既有格式，不增加租约状态字段或枚举。运行锁持有到执行/后账提交结束，完成后 finally 释放；锁的 stale_ms 针对该运行至少覆盖 timeout_ms 和受控清理时间，禁止默认 30 秒陈旧回收让长任务重复启动。等待者未取得锁返回既有 E_STATE_LOCKED；取得后重新检查过期、摘要和已有成功 post。只有成功记账的 post 作为已消费证据，第二次执行 E_LEASE_CONSUMED。长时间执行不持有全局 state 锁；writeUsageRow 自带该锁，不得嵌套调用。账本提交失败不报告成功。进程崩溃后不在本任务承诺恰好一次执行，恢复语义仍属后续任务。
4. 只使用既有 buildDirectCall 及租约关联的模型/完整视图材料恢复调用；cwd、readonly、timeout_ms 必须来自选模生成的 handle/call，不回退到 runner 进程当前目录或放松只读。配置核对在重建调用及读取秘密前完成。不得从模型名猜 CLI 参数，不执行展示字符串，不绕过既有 shim、安全参数或 WSL 处理。
5. 秘密解析复用 lib/secrets/index.mjs 的 resolveSecret/runWithSecrets，按 direct_call.env_names 注入子进程环境，原 ctx.env/config/call 保持不变。runWithSecrets 当前使用 ctx.exec 同步入口；runner 必须以既有异步 exec 能力接入，保留同样的解析、来源变量清除和脱敏语义，不用同步执行代替超时进程树保证。空 env_names 不读无关秘密；秘密后端失败不启动 provider。原值不得出现在 argv、事件、stderr、审计、账本、租约或临时记录。
6. lib/events.mjs 归一 start/text/usage/result/error，使用 cliworker.event/v1；seq 从 1 连续递增，lease_id 一致，at 来自 ctx.clock。成功流最后且仅有一个 result，包含 ok=true、exit_code=0、text 与 input_tokens/output_tokens 的 usage。逐行 JSON 编码；不把 provider 原始 JSON、日志、额外 envelope 或普通字符串写到 stdout。event usage 只接受 schema 已有两个 token 字段；账本可记录 usage/v1 已有缓存 token 和 cost。不能重复累计累计式 usage 或最终汇总。未知/损坏供应商输出不能伪装成功或捏造用量。
7. 成功执行分别提交 idempotency_key 为 <lease>:pre 和 <lease>:post 的两行，复用 writeUsageRow 的幂等语义。pre 表达执行前快照且 token 为零，post 承载本次实际用量，不能双计；同一 key 不追加第二行。model/pools 与所用租约一致，kind='task'，两行通过 usage/v1 校验。pool_fraction_before/after 使用既有池读数来源；已知 fixture 必须断言具体前后数值，不能都填 null 通过，确实未知时保持 null，不虚构读数。不得为本任务扩充账本或池协议。
8. auth/quota 失败分别映射 E_PROVIDER_AUTH/E_PROVIDER_QUOTA，退出 7、retryable 按注册表；更新现有模型可用性为 blocked，保留完整 model/v1 证据，随后真实选模必须以 availability_blocked 拒选该模型。普通 provider 失败用 E_PROVIDER_FAILED。失败回写也须经现有锁和原子写，不清空其他 probe 记录。供应商错误消息和片段先脱敏；不能把 stderr 原文直接持久化。
9. 超时走 createExec 的 runAsync 及 ctx.clock 定时器，使用租约 timeout_ms，返回 E_TIMEOUT、退出 4、retryable=true。进程树清理由既有 exec 负责，runner 不能仅杀直接子进程或提前返回成功；结束后清理计时器和运行资源。失败用 error 事件及注册表语义输出，不新增终结事件类型。执行失败不得写可被当作成功消费凭据的 post，也不得增加持久化失败状态；已有 pre 幂等保留。AC-058 不扩展为失败后重试/崩溃恢复策略验收，不对这部分作新的协议承诺。
10. 两个 integration 文件内使用系统临时目录生成 fake-cli 和必要脚本，不在仓库增加 fixtures/helpers。fake-cli 有成功、auth、quota、普通失败、超时场景，记录 stdin、cwd、调用次数及安全的环境名/摘要。超时 fixture 派生孙进程，生成 PID 屏障后才推进伪时钟；测试 finally 清理全部进程和临时目录。禁止真实 provider、网络、个人配置或个人密钥环依赖。
11. test/flows/steps/run.mjs 沿用 flow 发现器实际要求的 id/name/introduced_by/ac/run，标识 run、T-023，消费真实 selection 的包装 calls。现有 select flow 的 CLI 是 process.execPath 且 args_prefix 为空，不能直接作为 provider 成功 fixture；run step 须在自己允许的文件内准备可执行 fake-cli 配置，再通过真实选模生成新租约，不能改已签发调用或伪造租约来隐藏接线问题。runner.test.mjs 实际调用该 step 并校验输出、账本和 cwd/stdin，不能只检查导出存在。
12. test/traceability/T-023.json 使用 interfaces 第 15 节的既有 task/milestone/entries 格式，仅列属主 AC-057、AC-058，指向实际带 AC 标记的两个 integration 文件；实际覆盖后才标 covered，不新增 schema、baseline 或状态枚举。

## 继承说明（候选 #1 → #2）

候选 #1 在 stall 前已写完本目录的 design.md 与 acceptance.md（含 write_scope 九项、cli opt-in、select 摘要规则、AC-057/AC-058 验收命令及回归命令）。本轮选择**保留**这两份文件作为基础，理由：(1) 内容与用户本轮答复逐条一致（cli 的 opt-in 控制对象、select 仅附加 config_digest、第 13 节事件名不新造并记录 W_TEST_CLOCK 缺口）；(2) 已对照现有代码核实其锚点真实存在：lib/cli.mjs:78–88 的加载配置/writeJson/退出 0 路径，lib/select.mjs:714–724 的租约构造，lib/commands/models/select.mjs 的 draft/legacy 失败分支，lib/leases.mjs 的 readLeaseState/isExpired，lib/lock.mjs 的 lockFilePath/withLock，lib/exec.mjs 的 runAsync，lib/usage.mjs 的 writeUsageRow，lib/secrets/index.mjs 的 resolveSecret/runWithSecrets，以及 acceptance 中引用的回归测试文件与 scripts；(3) 验收命令均为「命令 + 期望输出」且各自独立判定。本轮未放弃任何改动，也未删除任何文件；交班单文字不作为需求，仅按 brief 与用户答复复核。下游注意：task-graph.json、state.json 等调度器文件的未提交改动不属于本设计，不在 write_scope 内。

## 建议验收方向

acceptance.md 按 docs/acceptance-format.md 使用已有 AC 二级标题、独立 pwsh 命令和所属 AC OK 哨兵。每条命令显式定位仓库根、检查所有原生命令退出码；直接测试还检查非空以及零 fail/cancelled/skipped/todo，再执行 brief 指定的正式 AC runner。未实现的行为必须失败，不得输出成功哨兵。本轮增加现有 AC-023、AC-047、AC-006 的独立回归命令，不能修改这些既有测试来迎合接线；它们仍由原任务拥有，不写入 T-023 分片。

AC-057 覆盖真实 bin 包装调用成功、逐行 schema、最后 result 的已知用量、前后两行账本及池读数、完整 stdin、handle cwd、秘密不泄漏，以及实际 run flow。AC-058 将重复消费、auth、quota、进程树超时、租约过期和配置摘要不匹配分别作为必跑用例，不允许一条成功断言代替全部错误分支。配置不匹配必须包含同路径内容改变，不能仅测试另一文件路径。

完成前由下游执行 scripts/check-fast.ps1 及 milestone-gate --milestone M4，任何失败如实报告，不扩大写域修复其他任务，不把 filtered 报告当 full 报告。本 design 轮只运行不产生文件的验收格式与编码检查；完整检查链会创建运行产物，且部分检查调用 git，故不在本轮执行。

## 非目标

不修改冻结 contracts、leases、secrets、exec、context、flow harness、models/select 命令或其他范围外文件。CLI 与 select 只做本轮已授权的最小附加修改；不改普通命令输出/退出行为、不扩充公开字段或 schema、不添加租约生命周期状态、不新造事件或测试时钟警告承载方式。不实现 HTTP 跨进程 E2E、恢复迁移及其他任务职责；真实 CLI 执行验收不能降为直接调用 runner，也不能修改或过滤 CLI 输出后才校验。
