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

当前结论：存在无法从现有文件确定的契约缺口，已提交同目录 attention.json。下列内容固定已知要求与恢复步骤，尚不授权下游自行补造接口并开始实现；裁决后须先在本文件及 acceptance.md 内补全确定的契约，才进入实现。

## 约束

实现写入范围严格为 front matter 的五个文件。不得为接入而修改配置 schema、冻结错误注册表、CLI/HTTP 路由、既有调用器、凭据模块、身份模块、追踪分片或测试辅助文件。本 design 角色仅写本目录 design.md、acceptance.md，以及用户明确允许的歧义上报 attention.json；不执行 git、不写代码、不创建脚本或测试产物。

现有文件可以确定以下事实：

- createContext 已提供 ctx.fetch、ctx.fs、ctx.env、ctx.clock、ctx.exec，可作为 HTTP、文件、时钟与外部进程边界；不需要新增 context 字段。
- lib/secrets/index.mjs 已有 resolveSecret(ctx, config, cli)，从 config.secrets[cli] 的现有 {ref:...} 对象读取凭据。其实际解析前缀仅为 env、keychain、session，缺值返回 null；未实现 vault。T-033 输入中提及的 lib/secrets.mjs 不存在，不能照该路径导入，也不能把 keychain 或 session 擅自解释为 vault。
- lib/providers/call.mjs 当前是 session 描述符与 CLI 调用相关实现，其 identity_source 枚举不含 HTTP 响应来源。T-031 所需 lib/identity.mjs 当前不存在；不能把 HTTP 响应伪装成 stdout 证据，或为它发明新枚举值。
- lib/providers/registry.mjs、lib/providers/http-openai.mjs、lib/usage/ledger.mjs 当前均不存在。现有生产 probe 经 lib/adapters/call.mjs 构造 CLI 调用，再经 runWithSecrets 执行；没有读取新 HTTP registry 的分发入口。这三文件是本任务允许新增的模块，但其统一描述符、调用入口与返回契约没有在现有文件中定义。仅由测试导入新模块不能证明实际 CLIWorker 调用链已支持 HTTP。
- 现有 usageFile(config, ctx) 决定 usage.jsonl 路径；lib/store.mjs 提供 readJsonl 与 appendJsonl；lib/probe.mjs 的 commitProbeUsage(config, {ctx, row}) 已在共享状态锁内按 idempotency_key 防重。现有 usage 行使用 cliworker.usage/v1，含 model、pools、输入/输出/cache token、cost_usd、时间等字段。来源隔离应复用已确认的模型键与池成员关系；不能仅增加来源标签、却仍让两个渠道命中同一池。
- 冻结注册表只有 E_PROVIDER_AUTH、E_PROVIDER_QUOTA、E_PROVIDER_FAILED、E_SECRET_BACKEND、E_TIMEOUT 等现有码，没有 AC-078 正文出现的 E_SECRET_MISSING 或 E_AUTH。errorBody 支持显式 retryable 覆盖，但未知错误码会降为 E_INTERNAL。不能新增错误码或直接返回未登记的码。

必须裁决的问题已合并到 attention.json：

1. vault 引用的确切格式、凭据读取接口及其归属。保持五文件范围时，要明确可复用的真实后端；不能用测试自建 resolver 冒充生产 vault 支持。
2. transport=cli/http 统一描述符、调用与返回契约，以及从现有生产入口到新 registry 的接线归属。需要明确本任务是否仅交付库层能力；若要求真实入口支持，须由权威任务调整范围或先交付范围外接线。
3. HTTP model 证据如何进入统一身份对象及 identity_source，和缺失、冲突身份的确定行为。现有 CLI 枚举与尚未交付的 T-031 不能代替 HTTP 契约。
4. AC-078 的 401/403 错误名与现有错误表的冲突如何解决；补齐缺失凭据、429、5xx、其他失败的逐项映射和重试语义。不得由实现者自行选择不存在的错误码。

恢复后按以下顺序执行，裁决内容只补入已有章节，不新增协议字段、schema 版本或章节名：

1. 先核实裁决所依赖的生产接口已在当前工作树可读。将真实模块路径、导出、参数、返回形状、描述符来源、错误映射和生产调用链写入本文件。若裁决改变五文件范围，应先由权威 brief 更新，不能只扩大 front matter。
2. lib/providers/registry.mjs 依裁决统一区分 cli/http 描述符并分发，保持已有 CLI 调用、身份与用量语义。HTTP 路径不得启动 CLI。模型名来自调用方或服务端支持清单；brief 中两个模型名是样例，不是代码内置清单，不因别名字符串相同而合并渠道。
3. lib/providers/http-openai.mjs 经 ctx.fetch 发起 OpenAI 兼容调用。AC-078 指定首个地址为 https://api.deepseek.com/chat/completions；先完成引用校验及凭据解析再发请求。明文配置、缺失凭据和后端失败均不得触发网络请求。仅在请求所需的内存中持有凭据，禁止把 Authorization、凭据值、带凭据 URL 或原始异常写入配置、账本、证据、stdout、stderr。不得自动把凭据跟随重定向发送给其他地址。
4. 从实际成功响应读取 model 作为实际模型证据，绝不以请求模型回填 reported_model。已确认身份、缺少证据与身份冲突按裁决处理；证据输出复用现有 redact 规则。测试须分别覆盖匹配、缺失和不匹配响应，不能仅断言身份常量。
5. 将 usage.prompt_tokens 与 usage.completion_tokens 精确映射到现有 input_tokens 与 output_tokens，不舍入、不按字符估算、不从 total_tokens 反推。有效的零值与缺失/无效值必须区分；缺失、负数、非整数或超出安全整数的用量不能记成零消费。未报告 cache 用量时不能凭空推导；不得把 prompt_tokens 与其 cache 明细重复相加。
6. lib/usage/ledger.mjs 复用既有行结构、存储路径与锁/防重方式。写入前确定来源独立的 model 和 pools；以两个来源相同的模型名构造回归，验证官网消费只影响官网池，codebuddy 消费只影响 codebuddy 池。先确定来源隔离，再验证幂等；两个来源的独立消费不能因防重键相同被误删。存储失败必须向上报告，损坏账本不能覆盖或截断；重放已记账结果不能再次发起付费请求。
7. 按裁决映射 HTTP 状态。401/403 立即失败且不重试；429/5xx 标为可重试，不能无限重试或隐藏额外消费。可重试标记与自动重发是不同动作，必须按裁决固定调用次数。网络错误、超时、非 JSON、缺失必需响应结构也必须进入确定失败路径，且不得泄露响应体中的凭据。
8. 在两份允许的测试文件内内联合成响应、伪 fetch、伪时钟和文件探针，测试必须调用真实生产模块。contract 文件同时承担 AC-078 要求的 integration 场景，通过裁决后的统一生产入口贯通凭据解析、HTTP 响应、身份和真实账本写入；unit 文件覆盖精确 token 映射、分池与防重。测试不得依赖真实官网、真实令牌、用户家目录或平台凭据库，也不得以跳过/todo 代替断言。

## 建议验收方向

验收要求见同目录 acceptance.md，AC 编号固定为 AC-078，levels 为 contract、integration；单元用量测试保留 brief 指定文件名，不另造 AC。只有裁决完成、设计补全、实现就绪后才能进行功能验收；验收文档格式通过不能解除阻塞或表示功能通过。

brief 的 525ms、1073ms 只记录既有实测，不是性能门槛。未获得稳定性能规格前，不把公网响应时间作为自动验收条件。

本角色只运行不写文件、不调用 git 的文档格式检查。scripts/check-fast.ps1 会继续运行项目门禁和全量测试，存在间接执行 git、创建报告/夹具的路径，与本角色禁止事项冲突，因此本轮不运行；不得把它记录为已通过。目标功能测试尚未执行，也不宣称 AC-078 已通过。
