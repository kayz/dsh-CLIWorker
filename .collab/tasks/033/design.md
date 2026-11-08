---
write_scope:
  - lib/providers/http-openai.mjs
  - lib/providers/registry.mjs
  - lib/usage/ledger.mjs
  - test/contract/http-provider.test.mjs
  - test/unit/http-usage.test.mjs
---

# Task 033 — HTTP 直连 provider：DeepSeek 官网接入、身份与用量、凭据引用

## 目标

实现 brief 指定的 transport=http OpenAI 兼容 provider；首个渠道为 DeepSeek 官网。同一模型经 codebuddy 与官网调用时分别归属来源和额度池。身份以本次响应的 model 为证据，用量以本次响应的 usage 为证据，凭据仅接受引用。

依据：本任务 brief.md；.collab/blueprint/cliworker-v2/task-graph.json 的 T-033、AC-078；蓝图 design.md 第 11 节；现有 lib/context.mjs、lib/providers/call.mjs、lib/secrets/index.mjs、lib/probe.mjs、lib/store.mjs、lib/pools.mjs；contracts/registry.snapshot.json 与现有 usage、pool、config schema。brief 未给基准 commit SHA 或既有验收报告路径，不自行指定基线。

本轮用户已对上一轮四项问题作出权威裁决：T-033 仅支持环境变量名配置，经现有 env 凭据源取值；库层交付足够；HTTP 身份在客户端内计算，来源为 response.model；错误仅使用现有码并按本文件映射。原 attention 的阻塞已解除，无需等待 vault、T-031 或生产接线后再实现。裁决优先于原 brief 中 env/vault 及 AC-078 中旧错误名的表述。

本任务交付完整 HTTP 客户端、registry 的 HTTP 描述符及来源隔离的账本能力。HTTP provider 的端到端 probe 接线是明确保留的缺口，归 T-020；不修改 lib/probe.mjs，不宣称当前 CLI/HTTP 路由已能调用该渠道。

## 约束

实现写入范围严格为 front matter 的五个文件。不得修改配置 schema、冻结错误注册表、CLI/HTTP 路由、既有调用器、凭据模块、身份模块、追踪分片或测试辅助文件。本 design 角色本轮仅修改本目录 design.md、acceptance.md；不执行 git、不写代码、不创建脚本、attention 或测试产物。

现有文件与本轮裁决确定以下接口边界：

- createContext 已提供 ctx.fetch、ctx.fs、ctx.env、ctx.clock、ctx.exec，HTTP、文件、时钟与外部进程均经已有边界；不新增 context 字段。
- lib/secrets/index.mjs 已有 resolveSecret(ctx, config, cli)。T-033 的库配置只保存 apiKeyEnv，例如 "DEEPSEEK_API_KEY"，其值必须是合法环境变量名，不是密钥、env: 引用字符串或 vault 地址。客户端在内存中将该名称转换成现有 {ref:'env:DEEPSEEK_API_KEY'}，放入配置副本的 secrets[provider] 后调用 resolveSecret；不修改原配置、ctx.env 或凭据模块，不触发缺省 keychain 回退，不增加 vault 源。apiKeyEnv 是本轮授权的库配置输入，不据此扩展现有配置 schema 或生产配置路由。
- 环境变量未设置、空字符串或解析结果为空时，在 fetch 前以 E_SECRET_BACKEND、retryable=false 失败；消息必须包含所缺变量名，例如 missing environment variable: DEEPSEEK_API_KEY，不得包含凭据值。非法变量名按 E_REQUEST_INVALID 失败；内联明文凭据按已有 E_CONFIG_SECRET_INLINE 拒绝。其他 secret 解析异常归一为 E_SECRET_BACKEND，不输出原始异常。
- lib/providers/call.mjs 的现有 CLI/session 接口与身份枚举保持原样。不新增 lib/identity.mjs，不把 HTTP 证据送入只接受 CLI 来源的分类器。HTTP 客户端内部直接计算身份，以现有 provider-result 表达方式携带本轮明确授权的 identity、identity_source、reason 及既有模型证据；不创建新结果 schema、版本或包裹层。
- lib/providers/registry.mjs、lib/providers/http-openai.mjs、lib/usage/ledger.mjs 当前尚未存在，作为本任务库模块新增。registry 的 HTTP 描述符必须包含 transport:"http"、base_url、chat 路径、supported model ids 以及 identity/usage 提取 hooks；这些内容限定为库内描述符，不增加配置协议字段。CLI 描述符用 transport:"cli" 表达已有 CLI 调用能力，复用既有构造逻辑；不改变其参数、身份与执行行为，不在生产 probe 注册新分发逻辑。
- DeepSeek 描述符的 base_url 为 https://api.deepseek.com，chat 路径为 /chat/completions，拼接结果须精确为 AC-078 的 endpoint。supported model ids 从调用方声明或已经取得的服务端支持清单注入，不能在 lib 中硬编码一套模型表；brief 的两个模型名仅用于测试输入，不形成永久模型白名单。提取 hooks 直接使用客户端内同一套身份、用量规则，避免 registry 与实际请求出现两套解释。
- 现有 usageFile(config, ctx) 决定 usage.jsonl 路径；lib/store.mjs 提供 readJsonl、appendJsonl；lib/probe.mjs 的 commitProbeUsage(config, {ctx, row}) 示范共享状态锁内按 idempotency_key 防重。账本复用 cliworker.usage/v1 的 model、pools、输入/输出/cache token、cost_usd、时间等字段，不新增来源字段或 schema 版本。来源隔离使用不同渠道的现有 model.key 和池成员关系，不能只加标签却仍命中同一池。

按以下顺序实现：

1. 在 registry 内提供两种 transport 的库内描述符。HTTP 描述符校验 endpoint、所选模型与支持清单，提供同源的 identity/usage 提取 hooks。未支持的模型、非法请求参数或描述符以 E_REQUEST_INVALID 在网络前失败。registry 导入及查询不得读取环境变量值、发网络请求或启动进程；已有 CLI 描述符构造必须保持兼容。

2. http-openai.mjs 提供可直接使用的完整异步客户端，接收上述描述符、库配置、现有模型与请求上下文。完成输入及 apiKeyEnv 校验、经现有 env 源解析凭据后，通过 ctx.fetch 以 JSON POST 发往 chat endpoint；携带请求模型、messages，使用非流式 OpenAI 兼容响应，Authorization 仅在内存中的请求头中使用。不得把密钥放入 URL、请求体、描述符或可打印的调用说明；不得跟随重定向把凭据发送到其他地址。请求/响应解码与受限重试均在该客户端内完成，HTTP 路径不得调用 ctx.exec。

3. 成功响应从 choices 的消息内容取得回复，从顶层 model 取得实际模型。非空字符串与请求模型严格相等时，返回 identity:"verified"、identity_source:"response.model"；缺失、空值、非法类型或不匹配时，返回 identity:"observed"、identity_source:"response.model"，并以 reason 说明缺少证据或模型不匹配。reason 是说明文字，不增加原因枚举。缺失实际模型保持空证据，不以请求模型回填 reported_model；不匹配保留实际返回的模型证据。这两类 observed 不自动降为调用失败、不阻断可用回复或有效用量记账。HTTP/解析失败走既有失败结果与错误表达，不伪造成功身份证据。

4. 将 usage.prompt_tokens 与 usage.completion_tokens 精确映射到现有 input_tokens 与 output_tokens，不舍入、不按字符估算、不从 total_tokens 反推。显式 0 有效；缺失、负数、非整数、非数值或超出安全整数不能记成零消费。未知用量在结果中保持未知，不写伪造零账；有效回复可以保留。未报告 cache 用量不推导，账本的 cache 计数用既有默认值，不再把 prompt 的 cache 明细加进总输入而重复计费。存在有效用量时，即使身份为 observed，也归属请求所用渠道，不能因响应模型不匹配而转记到 codebuddy 池。

5. ledger.mjs 复用现有行结构、usageFile 路径、共享状态锁与防重方式。模型键必须包含已声明的渠道身份；同一模型的官网与 codebuddy 使用不同 model.key、不同池 ID，账本 pools 只包含所属渠道的池。以 config.pools 中既有成员关系检查，跨渠道共池输入须在付费请求前拒绝，不能自动合并、拆分或改写用户的池。防重按来源模型键及现有 idempotency_key 的组合区分，两来源不同消费不得互相去重；不新增防重字段。相同已完成消费的记账重放及并发提交只追加一次，不重新请求模型。客户端请求重试与账本提交重试分开，写盘失败不能触发再次付费请求；损坏账本不得覆盖或截断。

6. 本轮用户给出的 e28dfda 增量表明：probe 的一次早期未知超时不能抹掉后续已确认用量，存在任一次已确认用量时应记入账本，而不是整体丢弃或补零。本任务只沿用此记账原则，不修改或重新验收范围外 probe。HTTP 的每次尝试分别判断用量；重试前后所有确切报告的用量合计一次，最终失败也保留已经确认的消费；完全未知时不写零账。合计超出安全整数须显式失败，不能舍入。timeout 后成功且仅成功响应报告 123/45 时，最终记录恰为 123/45，不把未知首轮当作免费证据或额外估算值。

7. 错误只使用 lib/contract/registry.mjs 已有码，经既有 codedError/错误结果和 retryable、retry_after 表达；不修改注册表。E_SECRET_MISSING 对应 E_SECRET_BACKEND，E_AUTH 对应 E_PROVIDER_AUTH，旧名称不对外输出。映射和调用次数如下：

| 情况 | 现有码 | retryable | 单次库调用内的请求次数 |
|---|---|---|---|
| 缺失环境变量/凭据后端失败 | E_SECRET_BACKEND | false | 0 |
| 内联明文凭据 | E_CONFIG_SECRET_INLINE | false | 0 |
| 非法本地输入 | E_REQUEST_INVALID | false | 0 |
| HTTP 401/403 | E_PROVIDER_AUTH | false | 1 |
| HTTP 429，或明确的配额/余额耗尽（含 HTTP 402） | E_PROVIDER_QUOTA | false | 1，不在同池重试 |
| HTTP 5xx（没有明确配额耗尽证据） | E_PROVIDER_FAILED | true | 最多 2 次 |
| 本次尝试超时 | E_TIMEOUT | true | 最多 2 次 |
| 其他 HTTP 4xx | E_REQUEST_INVALID | false | 1 |
| 重定向、网络异常、非法 JSON、缺失必需回复结构 | E_PROVIDER_FAILED | false | 1 |

   最多 2 次表示首次加一次重试，固定上限而非新增重试配置字段。第一次超时/5xx 后最多再请求一次；第二次结果决定是否成功及最终错误码，一旦遇到认证、请求错误或配额错误立即停止。耗尽尝试后仍保留表中 retryable 值，表示调用方可在后续合适时机重试；配额错误在同池不可重试。每次尝试以已有 timeout_ms 为界，缺省复用现有 DEFAULT_TIMEOUT_MS；定时经 ctx.clock，覆盖 fetch 与响应体读取，结束后取消计时并中止未完成请求。不要因超时回调晚到而处理同一次响应两遍。5xx 与超时允许一次立即重试，不自动等待服务端给出的任意时长。

   HTTP 429 提供 Retry-After 时填充现有 retry_after：非负秒数按 ctx.clock.now() 换算成 ISO 时间，有效 HTTP 日期转为 ISO 时间；缺失或无效为 null。不把 429 标成 retryable=true，不跟随 Retry-After 在当前池重发。用户明确的错误语义优先于旧稿“429/5xx 均可重试”。所有可输出消息、回复、模型证据与账本内容经现有 redact 规则及本次真实秘密值脱敏，原始请求头、异常和响应体不得直接打印。

8. 两份获准测试文件内内联合成响应、伪 fetch、伪时钟和文件探针。contract 文件承担库层 contract/integration：从真实 registry 描述符进入真实 HTTP 客户端，经真实 env 解析与 ledger 存储完成闭环；不要求生产 probe/路由接线。unit 文件覆盖精确 token 映射、来源分池、已确认/未知用量及防重。测试调用生产模块，不用测试自建客户端或凭据后端替代实现。标题标注 [AC-078]，不得依赖真实官网、真实令牌、用户家目录或平台凭据库，不以跳过/todo 代替断言。

## 建议验收方向

验收要求见同目录 acceptance.md，AC 编号固定为 AC-078，levels 为 contract、integration；单元用量测试保留 brief 指定文件名，不另造 AC。上一轮 vault、等待统一身份模块、必须接通生产 probe 的验收要求已由本轮裁决替换；仅缺少 HTTP probe 接线不得判 T-033 失败，但该缺口必须在实现交接中明确记录给 T-020。

brief 的 525ms、1073ms 只记录既有实测，不是性能门槛。不把公网响应时间作为自动验收条件。

本角色只运行不写文件、不调用 git 的文档格式检查。scripts/check-fast.ps1 会继续运行项目门禁和全量测试，存在间接执行 git、创建报告/夹具的路径，与本角色禁止事项冲突，因此本轮不运行；不得把它记录为已通过。目标功能测试留给实现后的验收，不宣称 AC-078 已通过。
