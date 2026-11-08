---
write_scope:
  - lib/identity.mjs
  - lib/providers/call.mjs
  - lib/contract/views.mjs
  - test/contract/identity.test.mjs
  - test/unit/identity-levels.test.mjs
---

# Task 031 — 身份证据契约：四档身份、identity_source、calls[] 证据与 unverified 不阻断

规格来源：本任务 brief、蓝图 `.collab/blueprint/cliworker-v2/design.md` 的「11. 身份证据契约（身份归 CLIWorker）」及其 11.1～11.4。AC-075 层级为 contract、unit。brief 未给基准 commit SHA 或既有验收报告路径，不沿用其他任务的基准数字。第 11 节覆盖第 10.1 节旧的 strength/asserted/unknown 和身份冲突降级规则，不引入旧字段或新 schema/version。

write_scope 是下游实现的完整写域，五条均为相对仓库根的精确路径。设计阶段只写本任务目录的 design.md、acceptance.md；不修改蓝图、注册表、追踪分片、会话模块、选择器、适配器或其他文件。

## 11. 身份证据契约（身份归 CLIWorker）

现有 `lib/providers/call.mjs` 已有描述符驱动的模型提取和四档分级，`classifyIdentity` 返回 `level、identity_source、consistent、observed_at`，供 `lib/session.mjs` 使用；尚无 `lib/identity.mjs` 和 AC-075 的两个测试文件。Session 契约刻意隐藏模型名，不能直接增加完整身份字段。

实施方式：新增完整身份证据模块和一次调用的证据入口，保留既有 Session API。三个生产文件分工如下；函数名是实现入口，不新增协议字段。

- `lib/identity.mjs`：集中维护来源枚举、模型提取、来源到等级的映射、证据白名单和脱敏。导出完整对象入口 `classifyIdentity(options)`，沿用已有参数 `descriptor、result、requested_model、readFile、cwd、observed_at`。另提供 `classifySessionIdentity(options)`，从同一次原始提取计算既有精简对象；consistent 在脱敏前比较，避免不同秘密被遮盖为同一标记后误判一致。
- `lib/providers/call.mjs`：保留全部现有导出和签名。`IDENTITY_SOURCES` 从统一模块重导出；原 `classifyIdentity` 转到 `classifySessionIdentity`，返回形状兼容。追加 `callWithIdentity(ctx, spec, text, timeout_ms, options)`；options 采用已有的 descriptor、requested_model、readFile、cwd 参数。执行一次现有 runSessionCall，返回 `{identity, calls}`；不重试。runSessionCall 仍原样返回 exec 结果，不改变现有调用者行为。
- `lib/contract/views.mjs`：追加 `identityView(identity)` 和 `callView(call)` 两个纯白名单投影，组装本任务完整身份及单条调用证据。只复制下文列出的字段，不保留未知字段引用、不 import、不取时间或读环境。`sessionView、resolveView、VIEW_NAMES` 和现有常量保持行为与返回键不变。

原始提取及安全处理归 identity 模块，views 只组装已处理的对象，不实现第二套身份判定。迁移身份解析时，保留 extractSessionId 所需的 JSON、点路径及文件读取能力；不得因抽取模块而破坏既有 session id 提取。输入不可被修改，各次输出不能共享可变 evidence 对象。零第三方依赖。

现有 select 根部的 `calls[]` 是包装命令列表，受 scanView 的 command/args 白名单约束。新入口的 calls 是蓝图 §11.3 的执行证据，不能混入旧命令列表，也不能扩大扫描器白名单。接入旧 select、ModelHandle 的实际选模流程以及修改 requireVerified 等旧策略需要写域外文件，本任务不宣称完成这些接线；交付完整 identity 和可执行的 provider 证据入口供下游使用。新入口没有身份证据准入门槛。

### 11.1 身份等级（固定枚举）

| 调用结果和实际取得的证据 | level | identity_source | 行为 |
|---|---|---|---|
| 本次 stdout 的 modelUsage 模型证据 | verified | stdout.modelUsage | 保留调用结果 |
| 本次 stdout 的 event.model 模型证据 | verified | stdout.event.model | 保留调用结果 |
| 本次 stdout 的 stats.models 模型证据 | verified | stats.models | 保留调用结果 |
| 本次指定 rollout 文件的模型证据 | observed | rollout-file | 保留调用结果 |
| 仅有 CLI 参数声明 | unverified | cli_flag | 保留调用结果 |
| 无描述符、无证据、读取/解析失败或来源不支持 | unverified | none | 保留调用结果 |
| 调用失败：超时、认证/限流失败、非零退出等 | failed | none | outcome 为 failed，交给上层切换候选 |

gemini stats.models 按 §11.2 的明确规定记 verified，不能因 §11.1 对统计表的泛称而降为 observed。codex rollout 即使报告与请求相同也始终 observed，不能按文件内的字段名伪装成 stdout 来源。

失败判定优先于证据解析：result.ok 不为 true，或实际有非零退出码时为 failed。缺少数值退出码但 ok:true 的注入结果保留成功标记，exit_code 用 null。exec 抛异常同样形成 failed 证据，不能外泄异常文本。

模型不一致不改变由来源决定的等级，不触发重试或降级；既有 Session consistent 如实为 false。读取失败、空模型、乱码、mismatch、unverified 都不能转成 failed。认证/限流失败由 exec 结果报告，不根据模型字符串猜测。

### 11.2 ModelHandle 的 identity 对象

完整对象只含蓝图 §11.2 的字段：

| 字段 | 输出规则 |
|---|---|
| level | 上述四值之一 |
| identity_source | stdout.modelUsage、stdout.event.model、stats.models、rollout-file、cli_flag、none 六值之一 |
| evidence | 始终为含 path、at、detail 的对象；缺失项显式 null |
| requested_model | 实际请求模型；缺失为 null |
| reported_model | 从对应来源实际提取的模型；无实际模型证据为 null |

不增加 selected_model、source、strength、provisional、schema 等字段。Session 精简对象仍只有 level、identity_source、consistent、observed_at；完整对象时间放 evidence.at，不重复追加 observed_at。

沿用 descriptor.identity 的 source、model_path、file，不猜 provider 名、CLI 参数或新路径。stdout 先尝试完整 JSON，失败再逐非空行解析 JSONL；点路径只读自身属性，拒绝 __proto__/constructor/prototype。接受非空模型字符串，保留既有数字路径值转字符串的兼容；不从普通文本推断模型。无关行或坏 JSON 行不应掩盖后续有效证据。rollout 只读指定文件，相对路径按 cwd 解析，使用注入 readFile；不扫描用户目录或访问真实会话。读取失败、字段缺失、无效行均按无证据处理。

cli_flag 只证明请求参数，reported_model 必须为 null；none 即使 stdout 偶然有 model 字段也不能产生报告模型。禁止用 modelResolved、请求模型或 CLI 参数兜底 reported_model。非法来源分类为 none/unverified，描述符校验仍保留原有非法来源检查。

有实际模型证据时，evidence.path 是声明的 stdout 模型路径或脱敏后的 rollout 文件路径；at 取 observed_at；detail 为脱敏后的 reported_model 字符串，不嵌套原始对象；不复制整段 stdout/stderr、argv、环境、描述符、session id 或异常。cli_flag 可记录固定说明，path 为 null；none/failed 的 path/detail 为 null。时间缺失为 null，不读取真实时间。

整个 evidence 对象（含 path、at、detail）必须经既有 lib/redact.mjs 的 redact 处理。先移除 Windows Users/<用户名>、POSIX /home/<用户名> 与 /Users/<用户名> 的用户目录段，统一用已有 [REDACTED] 标记，兼容正反斜杠。现有 redact 不识别用户名，所以 identity 模块必须补这一步，不能改 redact.mjs。采用最小证据白名单避免非标准令牌随原始输出外泄。requested_model/reported_model 也经 redact，不能从模型字符串绕过脱敏。不得靠读取环境获取令牌或用户名。

### 11.3 calls[] 的证据

每次 callWithIdentity 执行恰一次 ctx.exec，返回完整 identity 和长度为 1 的 calls；失败也保留一条。连续调用不累积模块状态，顺序由上层组合。每条只含蓝图已给字段；tokens_in/out 按 tokens_in、tokens_out 两个字段展开：

| 字段 | 输出规则 |
|---|---|
| requested_model、reported_model | 与完整 identity 一致，包括 null |
| identity | 只含 level，值与完整 identity.level 一致 |
| identity_source、evidence | 与完整 identity 对应字段一致，按白名单深拷贝 |
| exit_code | exec 已有 code 的有限整数值；缺失/无效/抛异常为 null |
| latency_ms | ctx.clock.now() 在 exec 前后的差，非负有限毫秒；时钟回退或差值不是有限数时取 0 |
| tokens_in、tokens_out | exec 同名字段为非负有限整数时保留；缺失/无效为 null，真实 0 保留 |
| outcome | 成功为 ok，失败为 failed，与 identity.level 的 failed 状态一致 |

测量只用 ctx.clock；evidence.at 用 ctx.clock.nowIso()，不得 Date.now、真实 Date 或 sleep。不根据 stdout 猜 token 用量，不把未知用量造为 0。失败不能因 stdout 含模型而被洗成 ok；exec 抛异常仍然一次执行一次记录。失败后由调用方基于已知请求候选实施已有 exclude 语义，不追加 retryable、exclude 或候选字段，也不私自调用选择器。

用内存假 exec、伪时钟和读文件回调验证入口确实产生证据，不能只给手写 calls 数组做快照。原 runSessionCall、session id 提取及 Session 传参与错误码保持兼容。

### 11.4 与上层的分工

CLIWorker 提取、判级、脱敏并提供证据，上层消费 identity/calls，无须重新解析 stdout。unverified 继续执行，failed 提供切换依据；新入口不自动重试，不改 AgentLine。

先在 identity.mjs 汇总解析和来源映射，复用到 Session 精简投影；再追加纯白名单视图与 provider 调用证据入口；最后补充两个 AC-075 文件。测试使用内存数据，不连接真实 CLI、不依赖登录态、不写夹具文件。

test/unit/identity-levels.test.mjs 覆盖：三种 stdout 来源、rollout 恒 observed、cli_flag/none、缺失/坏 JSON/无模型/读取抛异常、安全点路径、模型不一致、成功但无证据、失败优先、输入不变及 Session 精简投影兼容。用 Windows/POSIX 路径和合成令牌校验脱敏；令牌测试值用片段拼成，禁止真实秘密。

test/contract/identity.test.mjs 覆盖：完整 identity 和 calls 的精确键集合、null 与真实 0、无伪造报告模型兜底、投影丢弃额外字段与深拷贝、证据不含用户名/令牌。通过真实 callWithIdentity 入口注入 exec，验证所有成功等级仅执行一次且 outcome 为 ok；超时/认证/限流/非零退出与抛异常均产生一条 failed 记录；伪时钟推进/回退、tokens 缺失/有效/无效值、identity 与 calls 一致、多次调用无串线。测试必须覆盖实际入口，不能只测试枚举或手工对象。兼容性另用既有 test/contract/session.test.mjs、test/unit/session-invalidation.test.mjs 只读回归，证明重导出、session id 提取和精简身份未破坏既有调用；不得修改这两个文件。

新测试使用 AC-075 标记，但 acceptance 不依赖测试标题、函数名、行号或其他任务产物状态。不得修改其他测试、contracts/spec 或追踪分片来强行登记 covered。

设计阶段执行指定 acceptance.md 的格式检查与只读文档核对，不运行尚未实现的 AC-075。仓库存在 scripts/check-fast.ps1，下游应按项目约定使用 `pwsh -NoProfile -File scripts/check-fast.ps1` 做完成检查并报告真实结果。全量链会进入生成测试产物的 runner 及涉及 git 的既有测试；当前设计角色受「不创建其他文件、禁止 git」限制，不能运行，也不把其他任务的全量状态设为 AC-075 通过条件。
