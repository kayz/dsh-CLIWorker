---
write_scope:
  - lib/index.js
  - lib/http/**
  - lib/health.mjs
  - lib/commands/doctor.mjs
  - test/integration/registration.test.mjs
  - test/integration/plugin-routes.test.mjs
  - test/integration/plugin-guard.test.mjs
  - test/integration/plugin-session.test.mjs
  - test/integration/health.test.mjs
  - test/unit/health.test.mjs
  - test/flows/steps/http-select.mjs
  - test/flows/steps/http-admin.mjs
  - test/flows/steps/doctor.mjs
  - test/traceability/T-024.json
---

# Task 024 — DSH 插件路由分级、会话自举（loopback 例外）、csrf 签发、固定判定顺序、健康检查与 doctor

## 目标

完成 brief 的 AC-059、AC-060、AC-061。本文件是实现规格，acceptance.md 是独立执行的验收入口；文档生成不代表实现通过。brief 未给基准 commit SHA 或既有验收报告，本任务不自行指定基准。

依据只读的 contracts/registry.snapshot.json、contracts/schemas/session.v1.schema.json、contracts/schemas/error-envelope.schema.json、contracts/host/dsh-host.v1.json，以及 .collab/blueprint/cliworker-v2/design.md 第 7 节和 interfaces.md 第 12～16 项。沿用已有 schema、错误码、字段及 warning，不新增契约版本。

## 约束

本轮用户已明确授权 test/integration/registration.test.mjs，故将它加入顶部 write_scope；brief 与 task-graph 中未列此路径的旧清单不随本任务修改。该授权仅供下游实现角色使用，本 design 角色只写 design.md、acceptance.md，不修改产品代码或测试。lib/cli.mjs、lib/routes.mjs、lib/context.mjs、contracts/**、scripts/**、test/helpers/** 仍只读。

**实现分工与路由。** lib/index.js 保留 name、createPlugin(hostCtx, settings, deps)、getRegistration()、apply() 的已有宿主接口，把路由声明、守卫、会话、HTTP 编解码放进 lib/http/**。声明表是注册与分级的唯一生产来源，必须同时声明方法、路径及级别；私有模块组织由实现者决定，不扩展公开 settings、请求或响应字段。按方法与路径匹配，不能把所有 /api 路由一律视为管理接口而遮蔽 session 例外，也不能允许 GET 绕过写路由的守卫。

| 路由（均以 /cliworker 为前缀） | 级别 | 守卫与成功行为 |
|---|---|---|
| POST /select | AgentLine | v1 无 view 不要求会话；full、draft 无有效会话返回 403 E_VIEW_FORBIDDEN；通过后调用既有选择链 |
| GET /api/session | 自举例外 | 只作三项 loopback 校验；200 返回严格 session/v1 |
| GET /ui | 自举例外 | 同上；200 仅静态外壳，不嵌入会话或管理数据 |
| GET /health | 公共 | 无会话可访问；正常 200，故障 503，返回既有健康报告 |
| GET /providers、/models、/forecast、/api/snapshot、/api/jobs/<id> | 管理读 | 缺失、未知、过期会话均为 403 E_ADMIN_REQUIRED；有效会话进入数据处理器 |
| POST /api/discover、/api/enumerate、/api/probe、/api/read-usage、/api/allow、/api/deny、/api/level、/api/alias、/api/manual-model、/api/pool、/api/secret | 管理写 | 严格执行 session > readonly > csrf > body，之后才能调用业务处理器 |

管理写路径清单取自 interfaces.md 第 12 项，不自行增加端点或请求字段。本任务交付完整守卫及业务分发接缝；已有目录、池、密钥操作复用现有命令/领域函数及参数校验，不另造一套业务语义。完整 snapshot/jobs 数据与异步作业生命周期仍属 T-025。AC-059 中 snapshot/jobs 的成功用例使用测试内部注入的受控数据处理器；200 只证明守卫放行与响应传递，不声称交付 T-025 的数据契约。写请求首用成功必须另有至少一个真实已有目录操作，断言实际状态变化，不能只依赖恒定 200 的测试处理器。

宿主仅支持 kind:'exact'，不得私自添加 prefix/regexp 或把字面量 <id> 注册成可用动态路由。静态路由按声明表逐一 exact 注册；jobs 模板在具体 id 已知时展开为相应 exact 路径并走同一守卫，测试以已知 fixture id 验证。T-024 不生成生产 job，未知 id 的动态发现、注册时机及完整宿主分发由 T-025 接入；这是明确的接入缺口，不能把直接调用模板 handler 的结果当作真实宿主动态匹配已通过。不得为消除此缺口修改只读宿主契约或降低管理读保护。

注册成功必须以 effect 内实际 register 未抛错为准，失败路径不进入 registered；单路由失败不阻断其他路由。createPlugin 返回 {registered,errors}，getRegistration 返回拷贝及 ok/failed，未 apply 时继续报告既有 failed 占位结果；strict:true 的 apply 保持失败抛错，非 strict 保持既有返回行为。注册与异常消息只输出稳定、脱敏摘要，不能回显任意宿主异常、headers、body、secret 或 session。保留依赖注入，导入模块不注册路由、不读个人配置、不输出日志。

**loopback、会话与 csrf。** socket.remoteAddress 只接受 127.0.0.1、::1、::ffff:127.0.0.1；Host 按合法 authority 解析主机名（允许合法端口），只接受 localhost、127.0.0.1、[::1]；Origin 缺省允许，存在时必须是合法 HTTP/HTTPS origin 且主机名属于同一 loopback 集合。缺少 socket/Host、空值、畸形值、Origin:null、远端域名、后缀欺骗、userinfo 均拒绝。不能通过 DNS 解析或 X-Forwarded-* 放行；三项独立校验，任一失败只返回 403 E_LOOPBACK_ONLY。其他级别不追加此码，以免改变注册表触发条件。

每个插件实例持有独立的内存会话表及进程内随机 HMAC 密钥。用 node:crypto 的安全随机源产生 32 字节 session，base64url 编码；csrf 为进程密钥对该 session 字符串的 HMAC-SHA256 的 base64url。不能使用 ctx.random/Math.random 生成安全令牌。TTL 来自 policy.session_ttl_s，缺省 43200 秒，expires_at 来自 ctx.clock.now()，到期时失效（now >= expires_at）。校验只认 x-cliworker-session / x-cliworker-csrf，不认 URL、body 或 cookie；常量时间比较 csrf，跨会话的 csrf 不可互换。过期记录惰性移除；重建插件实例或重启进程不能使用原会话，不持久化令牌或密钥，不引入清理定时器泄漏。

session 响应严格只有 schema、session、csrf、expires_at，不添加 ok、warnings 或新版本；响应 no-store，不设置 cookie。这是 brief 所指令牌禁止进入其他输出的必要签发例外：仅这一自举响应可携带 session/csrf，后续错误、健康报告、业务响应、注册报告、日志、磁盘均不得复制它们。readonly 不阻止签发与管理读。

**固定判定顺序与响应。** 每条管理写接口先读取请求头查会话，失败 E_ADMIN_REQUIRED；其次 readonly 为真则 E_READONLY；其次缺失或不匹配 csrf 则 E_CSRF；前三项全部通过后才订阅/解析请求体、验证字段及调用业务。拒绝请求不得触发目录写、密钥访问或业务 exec。畸形 JSON 或超出既有 2,000,000 字节上限返回 E_REQUEST_INVALID；超限也必须结束响应，不能仅 destroy 后悬挂。无效业务字段继续遵循领域层已有错误映射，不覆盖 level/schema 的专用错误码。所有错误的 HTTP 状态、retryable、retry_after 与 error envelope 均取既有注册表/输出工具，不泄露原始异常；这四种门控错误均为 403。

select 使用既有 resolveView({transport:'http',request,hasSession}) 及选择实现。brief 所说“不带 view”成功指显式 schema:'cliworker.request/v1'；缺少 schema 已被 resolveView 定义为 draft，故同样需要会话。有效会话分别测试 full 和 draft，HTTP 不改变现有 CLI 的视图规则。沿用已有包装请求兼容行为时，对解包后的同一个 request 做视图检查与选择，不能让外层/内层字段绕过鉴权。

AgentLine 响应与 CLI 输出用同一 lib/contract/scan.mjs 的 scanView，传入实际目录、禁用键清单及 wrapper 配置，正常与错误的 AgentLine 视图都要求 0 命中；不能以空目录掩盖泄露。full/draft 管理视图允许契约内细节，不强加 AgentLine 禁用键规则。所有响应另作秘密哨兵 leak-scan，包括 full/draft、自举（检测业务秘密）、错误、health 及注册失败。不能为扫描失败新增错误码。

**健康检查与 doctor。** lib/health.mjs 统一收集事实，HTTP 与 CLI 共用，不各写一份判定。返回沿用 interfaces 第 12 项形状：{status:'ok|degraded',checks:[{id,ok,detail}],registration:'ok|failed',test_clock:boolean}。checks 覆盖下列八类事实，id 标识对应检查项，detail 只承载脱敏状态、数值与必要原因；不新增 schema 或其他顶层诊断字段。一次收集使用同一时刻，逐项捕获故障，单项失败不能短路其余检查。

| 检查事实 | 数据来源与判定 |
|---|---|
| 配置有效性 | 用 resolvePaths 与 loadConfig，包括缺失、损坏、示例、内联秘密等现有验证；捕获后记失败，不直接把 E_CONFIG 作为 doctor 最终退出码 |
| state_dir 可写性 | 按现有路径规则解析；通过 ctx.fs 在该目录创建独占小探针并删除，失败记失败，finally 清理；允许创建尚不存在的合法 state_dir，不覆盖现有文件 |
| 锁状态 | 检查既有 state.lock 与存活/陈旧规则；可正常取得并释放或按现有规则回收则成功，活跃锁导致超时记失败；不得强删活跃锁，伪时钟测试主动 advance |
| 密钥后端 | 使用现有 SecretRef 与 secrets 实现检测配置所需后端是否可访问；只报告可用性，不输出值、不写试验秘密；无配置引用不强制要求系统 keychain 或真实账号 |
| 清单年龄 | 读取既有 inventory.json 的 generated_at，报告相对受控时钟的年龄；损坏、不可读、无效时间记失败；全新目录未发现清单报告尚未生成，不伪造年龄或故障；不发明 inventory TTL 配置，年龄本身无既定故障阈值 |
| 过期探测数量 | 使用现有 probes 读取/校验及每条 availability.at/ttl_s（缺省 policy.probe_ttl_s）的既有过期规则，报告精确数量；有过期或损坏/读取失败记失败；新目录无探测记录为 0 |
| 注册状态 | HTTP 使用当前插件实例的实际注册结果；部分失败/宿主 inject 失败为 failed；不能用另一个实例最近一次成功覆盖本实例失败 |
| test_clock | 设置 CLIWORKER_TEST_CLOCK_FILE 即 true 并判定失败，即使文件内容有效；文件不可读/内容非法也收口 degraded，不能阻断其他检查 |

任一检查失败即 status:degraded，HTTP 返回 503，归因统一为注册表 E_HEALTH_DEGRADED；健康路由保持既定报告形状，不向其顶层塞 error 而破坏公共形状。所有成功为 status:ok、HTTP 200。公共 health 不返回 provider 列表、模型、配置内容、绝对秘密路径、原始 backend 错误或令牌。config 无效导致依赖检查无法完成时，detail 明确无法检查，不伪称健康。

doctor 通过已有动态命令机制自注册 cmd:'doctor'、sub:null。注意冻结 cli.mjs 会在普通命令 run 前 loadConfig，且普通返回值不会决定退出码；必须使用 T-023 已有 route.streamed:true 钩子让 doctor 自行加载、收集并只输出一个 JSON，返回内部 {streamed:true,exitCode}，不输出内部返回值。此钩子只表示自行管理输出，不把 doctor 改成 JSONL。正常退出 0，输出健康报告；失败退出 9，输出标准 error envelope，error.code=E_HEALTH_DEGRADED、retryable=false、retry_after=null，error.message 为脱敏健康报告的 JSON 字符串，使失败时仍可提取完整 checks，并保持 error-envelope.schema.json 不增加字段。HTTP 与 doctor 的一致性测试比较该报告，忽略表现形式，不只检查 code。

CLI 独立进程没有已启动 DSH 宿主，不能直接把 getRegistration 的“未 apply”占位失败解释成故障，否则所有独立 doctor 都失败。doctor 在进程内用符合既有宿主契约的无监听诊断宿主执行实际注册链，报告该注册结果；不访问/宣称远端宿主存活。测试注入 register/inject 故障，验证 doctor 与对应失败插件的 health 均 failed。实际 DSH 宿主连通性不在此任务覆盖。

doctor 继续报告现有 W_LEGACY_USAGE。自行管理输出时需带出既有 W_TEST_CLOCK 语义：正常报告可用已有 warnings 字段；失败时 warnings 随脱敏报告保存在 error.message 的 JSON 内，避免给严格错误 envelope 添加字段。这是错误输出顶层 warnings 与严格 error-envelope 不兼容的承载差异，验收必须注明，不声称已修复所有 CLI 命令的 warning 行为。

**旧契约与范围外缺口。** test/integration/registration.test.mjs 编码旧四路由与无会话读成功，现已授权修改：集合等于新声明集（含 session/ui/health），不写固定数量；额外独立断言预期路径与级别，避免生产表和测试一起漏路由仍通过。管理读无会话断言 403 E_ADMIN_REQUIRED，有会话测试正常数据，保留失败隔离、strict、占位结果及 ctx 注入。

contracts/registry.snapshot.json 只有错误/顺序注册表，没有“四路由”冻结清单，新行为与之相符，不修改；contracts/host/dsh-host.v1.json 只有 exact 宿主能力而非旧路由集合，范围外，动态 jobs 接入缺口见上文。contracts/spec/surfaces.json 也未固定旧四路由。scripts/check-golden-frozen.mjs、check-frozen-files.mjs、check-write-scope.mjs 校验既有只读清单，没有查到硬编码旧四路由集合，均范围外不修改。不能把现有 snapshot_version 当成路由版本并擅自提升。

另有 test/integration/paths-entries.test.mjs 的旧用例无会话访问 providers 后断言读取配置，但不要求该访问 200；它不在本轮授权范围。插件构建时为健康与路径诊断读取配置（捕获异常，不阻断注册/自举）即可保留该路径验证，同时请求仍严格 403；不能为保持旧测试而在未鉴权业务 handler 内访问秘密或放行业务。若实现采用完全延迟配置读取导致该断言失败，应如实记录范围外差异，不删除或跳过测试。冻结 lib/cli.mjs 的 CONFIG_FREE、普通命令退出规则不改，用已有 streamed 钩子解决，不引入新路由字段。

## 建议验收方向

在指定五个新增测试文件中完成真实生产链测试，registration.test.mjs 更新旧契约。插件测试用现有 host-stub、fake ctx、clock，可在范围内测试文件中增补本地夹具，禁止修改通用 helper 或 mock 掉被测守卫。测试用明确 fixture 内容计算期望，不能只比较函数自身两次输出。

flows 的 http-select、http-admin 使用同一 flow 配置/state_dir，通过 in-process 宿主 stub 访问插件并 flow.recordHttp 记录全部响应体，再显式检查 flow.scan() 的 HTTP 秘密哨兵 0 命中。http-select 另做真实 scanView 的 0 命中检查；http-admin 验证同次自举首写及拒绝矩阵，覆盖真实目录写结果。doctor 步骤替换最小版检查，实际执行 CLI doctor 并验证八项事实，注意它在 discover/probe 之前运行，合法全新状态不得因缺少清单或探测而失败。沿用当前 helper 要求的 name、introduced_by、ac、run 导出；新增步骤 introduced_by 为 T-024，不重写共享 runner。

test/traceability/T-024.json 沿用现有 {task,milestone,entries:[{ac,files,status}]} 格式，仅登记 AC-059/060/061，milestone 为 M5；映射文件实际含对应 AC 标签，unit/integration 层级与 contracts/spec/ac-index.json 一致，不把其他任务 AC 迁入本分片。最终执行 acceptance.md 各独立命令、全 unit 回归与 scripts/check-fast.ps1；不能只验证文档格式就宣称产品通过。

## 非目标

不实现 UI 数据面、snapshot revision、issues、完整异步 jobs 或跨进程 e2e；不新增错误码、schema、业务请求字段或契约版本；不修改冻结命令入口与 ctx；不做代理鉴权、真实供应商/网络探测或发布门禁。设计阶段不执行会写测试报告、修改文件或隐含调用 git 的全量门禁，仅进行文档格式及静态范围核对；完整命令供实现完成后下游执行。
