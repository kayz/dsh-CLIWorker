---
write_scope:
  - lib/runner.mjs
  - lib/events.mjs
  - lib/commands/run.mjs
  - test/integration/runner.test.mjs
  - test/integration/runner-errors.test.mjs
  - test/flows/steps/run.mjs
  - test/traceability/T-023.json
---
# Task 023 — 执行器 run --lease：注入令牌、归一事件、前后记账、幂等、超时、失败回写、配置核对

## 目标

交付 brief 与任务图 T-023 / M4 指定的执行器，覆盖 integration 层的 AC-057、AC-058。规格来源为 .collab/blueprint/cliworker-v2/design.md、interfaces.md 第 3、4、5、9、11、13、15、16 节及 task-graph.json 的 T-023。实际字段、校验及错误语义使用 contracts/schemas/event.v1.schema.json、usage.v1.schema.json、contracts/registry.snapshot.json、contracts/spec/ac-index.json；运行时和测试不得引用 .collab。

**当前存在致命接线与契约缺口，已提交同目录 attention.json；裁决前不得开始实现或宣称本方案可直接落地。** 以下保留已经确定的交付行为与验收要求，未决接口不作推定。front matter 保持 brief 的原七项写域，不表示授权改动范围外文件。

brief 未给出本任务的基准 commit SHA 或既有验收报告。蓝图提到的 f75bb76 是特征化冻结副本来源，不是 T-023 的行为基准，不得拿冻结副本或旧报告替代本次 live 执行器验收。

## 约束

本轮 design 角色只创建本目录 design.md、acceptance.md；按用户明确规定的致命歧义例外，另创建 attention.json 交调度器裁决。不修改 brief.md、impl.md、review*.md、verdict*.json、state.json、run.json 或任何代码，不执行 git，不创建脚本或测试报告。文本使用 UTF-8 无 BOM。下游实现仍只允许 front matter 中的七个路径；需要扩大范围时必须先有明确裁决，再更新设计。

现有文件能够确认的阻塞证据：

- lib/cli.mjs:79–87 在 route.run 前加载配置；命令返回后无条件追加 writeJson，并以退出码 0 成功返回；抛错则输出普通错误 envelope。lib/output.mjs 的 writeJson 使用缩进 JSON。新增动态 route 可被 lib/routes.mjs 发现，但没有供 run 接管 JSONL 输出及退出码的返回约定。因此仅添加 lib/commands/run.mjs，不能通过既有正常控制流满足每行 event/v1、末行 result 及失败退出码。不能通过替换 ctx.stdout、全局补丁、process.exit、吞掉尾部输出或测试 preload 改写 CLI 来规避写域。
- lib/select.mjs:714–724 实际保存 lease_id、handle_id、request_id、model_key、selected_at、expires_at、call、funding、pools，没有配置摘要；lib/leases.mjs 没有摘要读写契约。call.args 只记录配置路径，无法检测同一路径内容在选模后改变。不能在首次 run 时才计算摘要、比较路径或测试手填摘要冒充选模时快照。必须裁决由谁在选模提交前保存摘要，以及已有规格未定义的摘要字段、算法、参与内容、路径规范化和旧租约处理方式；本设计不自行命名。
- interfaces.md 第 13 节要求设置 CLIWORKER_TEST_CLOCK_FILE 时每个输出带 W_TEST_CLOCK；实际 event/v1 的 additionalProperties=false 且无 warnings 字段。现有 main 只向普通返回对象追加 warnings。须明确 run 事件流如何兼容这两条要求；不能修改冻结 schema 或擅自增加事件字段、类型、警告传输形式。

attention.json 请求决定：保持原写域等待获授权任务交付上述接线和契约，或明确扩大写域并补齐契约。选择等待时，恢复前重新读取真实产物；选择扩大时，先按答复更新设计与验收，不把选项文本当成已获授权。

其余实施约束已经明确：Node 20+、ESM、零第三方运行时依赖；时间与定时器经 ctx.clock，IO 经 ctx.fs/store，进程经既有 exec。不得改变公开 schema、注册表、AC 属主或 baseline。不得将其他里程碑功能纳入本任务。

裁决消除阻塞后，按下列已确定职责实施；涉及未决摘要或 CLI 返回约定的具体代码必须使用裁决后的真实接口：

1. lib/commands/run.mjs 注册既有 route={cmd:'run',sub:null}，遵循命令模块入口，解析 brief 已有 --lease、--state-dir、--config。实际状态定位必须使用包装调用给出的绝对 state_dir，不能仅采用新配置的默认状态目录而读错租约。输入经 ctx.fs.readFileSync(0,...) 等既有 IO 缝读取并完整传给执行器，不 trim、不添加换行。最终由获授权的 CLI 接线保证只输出 JSONL 和注册表退出码；配置加载前失败的输出规则也需一并接通。
2. lib/runner.mjs 编排租约校验、秘密注入、异步执行、记账与失败回写。租约来自 readLeaseState，保持同文件 requests 索引及其他租约；复用现有 state 锁和原子写。查找、到期与消费判定必须发生在供应商启动和写 pre 之前，失败不启动 provider、不新增账本行。到期沿用 isExpired 的严格早于 now 规则，恰好 expires_at 尚有效，超过才返回 E_LEASE_EXPIRED。未知租约用 E_LEASE_UNKNOWN；成功过的租约重放用 E_LEASE_CONSUMED。
3. 同一租约的启动资格必须跨进程互斥，不能仅有内存标记。消费及运行中判定不得自行增加持久化字段或状态枚举；先复核获授权的租约接口能否表达该保证，不能表达则继续交调度器处理。长时间 provider 执行不持有会阻塞全局状态操作的锁；writeUsageRow 自带同一 state 锁，不得在持有该锁时嵌套调用。账本提交失败不报告成功。
4. 只使用既有 buildDirectCall 及租约关联的模型/完整视图材料恢复调用；cwd、readonly、timeout_ms 必须来自选模生成的 handle/call，不回退到 runner 进程当前目录或放松只读。配置核对在重建调用及读取秘密前完成。不得从模型名猜 CLI 参数，不执行展示字符串，不绕过既有 shim、安全参数或 WSL 处理。
5. 秘密解析复用 lib/secrets/index.mjs 的 resolveSecret/runWithSecrets，按 direct_call.env_names 注入子进程环境，原 ctx.env/config/call 保持不变。runWithSecrets 当前使用 ctx.exec 同步入口；runner 必须以既有异步 exec 能力接入，保留同样的解析、来源变量清除和脱敏语义，不用同步执行代替超时进程树保证。空 env_names 不读无关秘密；秘密后端失败不启动 provider。原值不得出现在 argv、事件、stderr、审计、账本、租约或临时记录。
6. lib/events.mjs 归一 start/text/usage/result/error，使用 cliworker.event/v1；seq 从 1 连续递增，lease_id 一致，at 来自 ctx.clock。成功流最后且仅有一个 result，包含 ok=true、exit_code=0、text 与 input_tokens/output_tokens 的 usage。逐行 JSON 编码；不把 provider 原始 JSON、日志、额外 envelope 或普通字符串写到 stdout。event usage 只接受 schema 已有两个 token 字段；账本可记录 usage/v1 已有缓存 token 和 cost。不能重复累计累计式 usage 或最终汇总。未知/损坏供应商输出不能伪装成功或捏造用量。
7. 成功执行分别提交 idempotency_key 为 <lease>:pre 和 <lease>:post 的两行，复用 writeUsageRow 的幂等语义。pre 表达执行前快照且 token 为零，post 承载本次实际用量，不能双计；同一 key 不追加第二行。model/pools 与所用租约一致，kind='task'，两行通过 usage/v1 校验。pool_fraction_before/after 使用既有池读数来源；已知 fixture 必须断言具体前后数值，不能都填 null 通过，确实未知时保持 null，不虚构读数。不得为本任务扩充账本或池协议。
8. auth/quota 失败分别映射 E_PROVIDER_AUTH/E_PROVIDER_QUOTA，退出 7、retryable 按注册表；更新现有模型可用性为 blocked，保留完整 model/v1 证据，随后真实选模必须以 availability_blocked 拒选该模型。普通 provider 失败用 E_PROVIDER_FAILED。失败回写也须经现有锁和原子写，不清空其他 probe 记录。供应商错误消息和片段先脱敏；不能把 stderr 原文直接持久化。
9. 超时走 createExec 的 runAsync 及 ctx.clock 定时器，使用租约 timeout_ms，返回 E_TIMEOUT、退出 4、retryable=true。进程树清理由既有 exec 负责，runner 不能仅杀直接子进程或提前返回成功；结束后清理计时器和运行资源。失败用 error 事件及注册表语义输出，不新增终结事件类型。失败租约的重试/释放规则尚未在现有持久化契约定义，不能自行发明状态规则。
10. 两个 integration 文件内使用系统临时目录生成 fake-cli 和必要脚本，不在仓库增加 fixtures/helpers。fake-cli 有成功、auth、quota、普通失败、超时场景，记录 stdin、cwd、调用次数及安全的环境名/摘要。超时 fixture 派生孙进程，生成 PID 屏障后才推进伪时钟；测试 finally 清理全部进程和临时目录。禁止真实 provider、网络、个人配置或个人密钥环依赖。
11. test/flows/steps/run.mjs 沿用 flow 发现器实际要求的 id/name/introduced_by/ac/run，标识 run、T-023，消费真实 selection 的包装 calls。现有 select flow 的 CLI 是 process.execPath 且 args_prefix 为空，不能直接作为 provider 成功 fixture；run step 须在自己允许的文件内准备可执行 fake-cli 配置，再通过真实选模生成新租约，不能改已签发调用或伪造租约来隐藏接线问题。runner.test.mjs 实际调用该 step 并校验输出、账本和 cwd/stdin，不能只检查导出存在。
12. test/traceability/T-023.json 使用 interfaces 第 15 节的既有 task/milestone/entries 格式，仅列属主 AC-057、AC-058，指向实际带 AC 标记的两个 integration 文件；实际覆盖后才标 covered，不新增 schema、baseline 或状态枚举。

## 建议验收方向

acceptance.md 按 docs/acceptance-format.md 使用已有 AC 二级标题、独立 pwsh 命令和所属 AC OK 哨兵。每条命令显式定位仓库根、检查所有原生命令退出码；直接测试还检查非空以及零 fail/cancelled/skipped/todo，再执行 brief 指定的正式 AC runner。当前阻塞未解除且实现未交付时，这些命令应失败，不得输出成功哨兵。

AC-057 覆盖真实 bin 包装调用成功、逐行 schema、最后 result 的已知用量、前后两行账本及池读数、完整 stdin、handle cwd、秘密不泄漏，以及实际 run flow。AC-058 将重复消费、auth、quota、进程树超时、租约过期和配置摘要不匹配分别作为必跑用例，不允许一条成功断言代替全部错误分支。配置不匹配必须包含同路径内容改变，不能仅测试另一文件路径。

完成前由下游执行 scripts/check-fast.ps1 及 milestone-gate --milestone M4，任何失败如实报告，不扩大写域修复其他任务，不把 filtered 报告当 full 报告。本 design 轮只运行不产生文件的验收格式与编码检查；完整检查链会创建运行产物，且部分检查调用 git，故不在本轮执行。

## 非目标

不修改冻结 contracts、CLI 主入口、select、leases、secrets、exec、context、flow harness 或其他范围外文件；相关接线必须先获得裁决。不开辟平行状态 schema，不自行定义摘要字段、算法、消费状态或测试时钟警告承载方式。不实现 HTTP 跨进程 E2E、恢复迁移及其他任务职责；真实 CLI 执行验收不能降为直接调用 runner，也不能修改或过滤 CLI 输出后才校验。
