---
write_scope:
  - lib/secrets/**
  - lib/commands/auth/**
  - lib/config.mjs
  - lib/cli.mjs
  - lib/exec.mjs
  - test/unit/secrets.test.mjs
  - test/integration/secrets-native.test.mjs
  - test/flows/steps/auth.mjs
  - test/traceability/T-013.json
---

# Task 013 — 用户提供令牌的密钥管理：SecretRef、OS 后端、只经 env 注入

## 目标

交付 T-013 / M2 的 AC-032、AC-033。依据 brief、`.collab/blueprint/cliworker-v2/design.md`、`interfaces.md` 第 5、11、13、15、16 节、`task-graph.json` 与现有 contracts。brief 未提供基准 commit SHA 或既有验收报告路径，不借用其他任务的基线。

本轮用户已批准 option 1：在主工作区及本 worktree 的 T-013 write_scope 中增加 `lib/cli.mjs`、`lib/exec.mjs`，前者只接入 auth set/status/clear，后者只增加 stdin input 透传；不新增 ctx 字段、不改其他路由。本设计据此解除此前的范围阻塞，先修订规格，再由下游实现。批准记录也见本任务 `inputs.jsonl` 的 answer，不再等待 attention 裁决。

现有 CLI 使用静态分发表；exec 同步路径未透传 input、异步路径将 stdin 设为 ignore；context 已提供 fs/exec/env/platform/clock，无 stdin 字段。仓库尚无完整的 `lib/adapters/**` 和 run 执行层，T-013 在允许的 secrets 模块内交付可执行的消费入口，供后续适配器/runner 调用，不为接入而改现有 provider、select 或 run 路由。

| 允许路径 | 实现要求 |
| --- | --- |
| `lib/secrets/**` | SecretRef 校验、env/keychain/session 后端、统一凭据定位、解析与执行前 env 注入；I/O 经既有 ctx。 |
| `lib/commands/auth/**` | 使用既有 `run({argv, ctx, config})` 形式交付 set/status/clear；成功输出只用既有 ok/state/warnings。 |
| `lib/config.mjs` | 调整递归明文检测，在迁移或复制配置前拒绝明文；保留路径、v1/v2、示例拒载及兼容视图。 |
| `lib/cli.mjs` | 仅新增三个 auth 模块的静态 import、三个 ROUTES 条目，并使 resolveRoute 接受 auth。沿用配置加载和统一输出/错误处理；其他路由、CONFIG_FREE、usage 文案及行为不改。 |
| `lib/exec.mjs` | 仅为 runSync/runAsync 透传既有 input 选项；保留结果结构、参数安全、超时、并发及回退策略。 |
| `test/unit/secrets.test.mjs` | AC-033 必跑纯单测，也承载本次 exec input 与 CLI 最小接入的定向断言。 |
| `test/integration/secrets-native.test.mjs` | AC-032 必跑隔离集成，以及可独立选择的附加原生测试。 |
| `test/flows/steps/auth.mjs` | 真实 bin 两种 set 输入、跨进程消费、状态和清除；使用既有共享 flow。 |
| `test/traceability/T-013.json` | 沿用 task/milestone/entries/ac/files/status，仅登记 AC-032、AC-033；实际覆盖后置 covered。 |

1. SecretRef 只使用现有 `{ref:'env:KIMI_API_KEY'}` 对象结构及 env/keychain/session 前缀，不增加 schema、版本或配置字段。env 只读 ctx.env；session 只在同一 ctx 的进程内保存，独立 ctx/新进程不可见；keychain 按 ctx.platform 使用 Windows DPAPI（经 pwsh）、macOS security、Linux secret-tool。无效引用按既有配置错误处理；后端不可用、权限错误、损坏或执行失败返回 E_SECRET_BACKEND，退出码 3、retryable=false，不伪装 unset，不回退为明文。
2. auth 和消费入口共用同一凭据定位逻辑：配置存在 `config.secrets[cli]` 时严格使用该引用；未配置时在内存中使用 `keychain:<cli>`，不重写配置，不将来源变量名存作引用。`--from-env` 仅选择输入来源，不选择后端。env 引用是只读，set/clear 返回 E_SECRET_BACKEND，不修改调用者环境；session 不可用来完成跨进程验收。持久化集成使用 keychain，并覆盖未配置引用时的默认定位。
3. keychain 服务命名空间由 `cliworker:` 与规范化绝对 state_dir 的完整 SHA-256 组成，win32 路径大小写规则沿用 resolvePaths；条目名是 keychain 引用冒号后的非空标识。同一 state_dir、同一 ref 在新进程定位同一条目，不同 state_dir 必须隔离。禁止把条目标识当文件路径拼接。使用配置加载得到的绝对 state_dir，不另加 ctx 成员或配置字段。
4. Windows 密文放在该 state_dir 的 secrets 子目录，文件名为条目标识的 SHA-256 加 `.dpapi`。固定 pwsh 脚本从 stdin 接收秘密，使用当前用户 DPAPI Protect/Unprotect；Protect 成功后才经 ctx.fs 创建目录、写临时密文并 rename 替换，临时文件也不含明文。读取只解密到内存；clear 只删对应密文。缺失文件表示 unset，损坏/拒绝访问不能表示 unset。失败清理本次临时产物，已有文件字节及目录列表不变，原本不存在的 state_dir 不创建；不自建明文主密钥文件。
5. macOS 使用同一服务/条目标识调用 security 查找、替换、删除；设置通过 `security -i` 的 stdin 交互命令输入，禁止 argv 中的 `-w <秘密>`。交互输入的引用和转义覆盖引号、反斜杠及控制字符；无法安全表达的输入在调用前返回 E_REQUEST_INVALID，不能形成额外命令。Linux 用 secret-tool store/lookup/clear 的服务/条目属性，store 的秘密经 stdin。只有工具明确返回“条目不存在”才映射 unset；ENOENT、会话不可用、权限错误均为 E_SECRET_BACKEND。三平台 set/get/status/clear 的构造和错误转换均用注入 exec 检查。
6. 所有后端执行经 ctx.exec，shell=false。秘密不得进入 argv、脚本源码或命令参数，固定脚本和后端动作可以在 argv，运行时秘密只走 input。后端 stdout 可能是秘密，只供内部解析，不成为响应；stderr/error 不原样抛出，使用安全错误说明及既有 redact 对已知秘密脱敏。
7. exec 同步路径仅在 input 不为 undefined 时向 spawnSync 传入相同 input。异步路径仅在有 input 时把 stdin 从 ignore 改为 pipe，注册 stdin error 处理后调用 `child.stdin.end(input)`，空字符串也发送 EOF；无 input 时保持原行为。写入异常/EPIPE 通过既有失败结果收敛，不产生未处理异常、不重复 settle、不泄露输入、不占住并发槽；成功/超时仍清理时钟。各实际启动尝试使用同一输入，input 不进入 argv 或调试输出。
8. auth set 接受一个 cli 和可选的 `--from-env NAME`；缺省经 `ctx.fs.readFileSync(0,'utf8')` 读 stdin，不新增 ctx.stdin。stdin 只移除一个末尾 LF 或 CRLF，不 trim 令牌本身。空输入、缺失/空环境变量、缺 cli、多余位置参数、缺选项值及未知选项返回 E_REQUEST_INVALID，退出码 2，后端不调用。不接受令牌位置参数。status/clear 使用相同定位；成功仅用既有 `{ok:true,state:'set'}` 或 `{ok:true,state:'unset'}`，保留必要的既有 warnings。clear 对确实不存在的条目幂等；后端错误仍失败。响应不增加原值、摘要、长度或凭据字段。
9. 配置扫描递归对象和数组，键名按 `/(token|api_key|secret|password)/i` 匹配；匹配且值为字符串时返回 E_CONFIG_SECRET_INLINE，退出码 3、retryable=false。裸 `env:NAME` 字符串仍拒绝；合法 SecretRef 对象不是字符串，允许通过。其余值的结构错误沿用既有校验，不扩大此错误码的触发条件。覆盖复合键名、大小写和数组内对象；消息不回显原值/JSON；不改 config-migrate，不重做 T-014。
10. 生产消费入口放在 `lib/secrets/index.mjs`，导出内部函数 `resolveSecret(ctx, config, cli)`、`runWithSecrets(ctx, config, cli, call, text, timeout)`。不增加外部字段：call 使用现有 command/args/cwd/input/env_names，text/timeout 对应 exec 的 input/timeout。执行函数先按第 2、3 项解析，再复制基础环境，只向 call.env_names 注入值，调用 ctx.exec，返回经秘密脱敏的既有 exec 结果。缺凭据失败 E_SECRET_BACKEND 且 provider 不启动；空 env_names 不注入、不解析无关凭据。不修改 call/config/ctx.env，不在返回描述附 env 值。删除所有未声明且携带该秘密的来源变量，包括 SENTINEL、CW_FLOW_SENTINEL 及其他同值变量；win32 环境变量重名按不区分大小写处理。保留必要的非秘密环境，不硬编码 kimi 的 env 名，测试描述声明 KIMI_API_KEY。
11. 本轮“without depending on the native OS keyring”按 answer 所附 attention 上下文落实为必跑集成的隔离能力：生产保留 brief 的 OS 后端，不增加 file 引用或后备存储。测试源码只放在允许的 integration 和 auth flow 文件；运行时在 flow.root 生成 preload、消费脚本、fake-cli 及密文替身。Node 20 `--import` 在真实 bin 前加载 preload，仅替换 node:child_process 的后端 spawnSync，并用 syncBuiltinESMExports 同步 ESM 绑定；只匹配 pwsh/security/secret-tool 后端动作，其他调用交原执行器。不替换 auth、生产定位/解析、exec input 或消费函数，不加生产测试开关。
12. 替身通过 flow.root 内的加密条目跨进程共享：使用 Node 内置 crypto 的带认证加密，随机密钥只在测试父进程内存及隔离子进程环境中，文件不保存密钥或可直接还原的明文编码；不新增产品环境变量或持久化 schema。Windows 替身仅模拟 DPAPI，密文仍由生产代码写；darwin/linux 替身模拟相应 store/lookup/clear，按服务/条目隔离。status/消费进程不继承哨兵来源变量、不接收令牌 input，必须从存储读取。专用场景注入后端失败，不退到真实后端。测试密钥和 preload 配置仅留给后端测试进程，在创建 provider 的基础环境前移除。
13. auth flow 沿用 `name='auth'`、`introduced_by='T-013'`、`ac=['AC-032']`、`run(flow)`；CLI/消费子进程都用 flow.run/flow.spawn。两种输入各在新进程 set 并等待退出，再分别启动独立的 status、消费和 clear 进程。消费脚本只加载生产入口、既有 context 和配置，并提供 fake-cli 的既有调用描述，不自行读取秘密后拼 env。测试环境过滤在创建既有 ctx 前完成，不改变 ctx 结构。fake-cli 记录 argv、变量名及 sha256，目标变量摘要与预期哨兵摘要相等，目标集合等于声明集合，来源及其他变量不得含哨兵。
14. 两种 set 后、消费后、clear 后均 leakScan：stdout/stderr/argv/HTTP/state_dir/audit 为 ok=true、hits=[]、errors=[]；另以 flow.root 为文件扫描根覆盖配置、preload、密文替身、fake-cli 记录及其他临时文件。后端 stdin 是授权秘密通道，只在内存断言，不把原值写入 captured、断言消息或 TAP。不得排除明文文件。使用 flow.sentinels 的 raw/UTF-16LE/base64/hex 扫描；脚本仅引用环境变量名/路径，不插入哨兵或密钥。finally 清理临时数据并恢复配置、环境供其他 flow 步骤使用。
15. 必跑 AC-032 由允许的 integration `.test.mjs` 实际调用 auth flow；另覆盖显式/默认 ref、覆盖旧值、新进程可读、不同 state_dir 隔离、clear 后消费失败且 provider 未启动、后端失败无文件变化。AC-033 逐一注入 win32/darwin/linux，检查程序/参数/shell=false/input/argv 无秘密、ENOENT 与普通失败，比较 state_dir 递归列表及已有文件字节，原本缺失的目录仍不存在。覆盖 env/session、状态及输入验证、明文检测、同步/异步 input、EOF、EPIPE 和无 input 回归，不依赖宿主平台或工具。
16. 附加原生测试按平台、工具及会话门控，skip 按既有 cliworker.skip/v1 记录；名称不带 [AC-032] 或 [AC-033]，不替代 baseline。默认不写真实账号条目，明确选择原生场景时只用隔离服务条目并 finally 删除。正式 runner 按源码标记选择整个文件，原生测试须在未显式选择时不注册，而非让 AC-032 默认运行产生 skipped 用例。

## 约束

顶部 write_scope 为 brief 七项加本轮批准的 lib/cli.mjs、lib/exec.mjs，共九项。批准适用于主工作区和本 worktree，不授权本设计角色修改主工作区或实现代码。设计角色只写本目录 design.md、acceptance.md，不修改 brief/impl/review/verdict/state/run 或代码，不执行 git，不创建其他文件。

Node 20+ / ESM、零第三方运行时依赖、UTF-8 无 BOM。运行时不读 .collab、contracts/spec 或 contracts/golden；不新增外部字段、版本、错误码、ctx 成员或适配器字段。执行、文件、环境、平台、时钟使用既有 ctx seams。临时夹具只在系统临时目录，不在仓库新增夹具源码。

## 建议验收方向

acceptance.md 使用现有 AC-032 / AC-033，以独立命令检查测试非空、无 skip/todo、正式 runner 发现清单及追踪分片。AC-032 baseline 为 darwin/linux/win32 integration；AC-033 为 linux unit，三平台后端构造在任何宿主都运行。没有本机密钥环也须通过 baseline。

下游先完成共用定位/后端、已批准的 CLI/exec 最小接入及 secrets 内执行消费，再完成跨进程 flow，运行两条 AC 和既有配置、exec、CLI envelope、全 flow 回归，实际覆盖后登记 covered。内部模块调用不能代替真实 auth 路由验收。

项目完成检查命令：`pwsh -NoProfile -File C:/git/dsh-CLIWorker/.collab/worktrees/013/scripts/check-fast.ps1`；期望退出码 0、输出 `check-fast: ok`，不得启用检查脚本注入覆盖。这是下游实现检查；本设计阶段不执行，因为检查链包含 git 和报告写入，与本轮禁止 git/创建其他文件冲突，不宣称实现测试已通过。

## 非目标

不实现其他里程碑的 adapter 注册、provider/run/lease、HTTP 管理或配置迁移；不修改其他 CLI 路由、context、helpers、contracts、脚本或范围外测试。不增加便携明文/自持主密钥存储，不将 session 当持久化，不以测试预填 env 代替生产消费入口。
