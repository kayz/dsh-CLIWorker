---
write_scope:
  - lib/index.js
  - ui/**
  - lib/http/snapshot.mjs
  - lib/http/jobs.mjs
  - lib/http/issues-api.mjs
  - test/unit/ui-render.test.mjs
  - test/integration/ui-snapshot.test.mjs
  - test/fixtures/ui/**
  - test/traceability/T-025.json
---

# Task 025 — 模型管理界面（白名单、等级、可用性、余量、刷新时间、实测证据）与实时数据

## 目标

本轮完成实现规格与独立验收入口。依据 brief、Blueprint design.md §12 与 interfaces.md 的 HTTP、model/v1、forecast/v1、会话和宿主契约；旧的 docs/ui/cliworker-console.html 仅供视觉参考。brief 没有给本任务的基准 commit SHA 或既有验收报告，不自行指定；其他任务的历史提交不作为本任务基准。

本轮用户答复覆盖 brief 中的接入限制和实时要求：允许修改 lib/index.js 并导入数据面模块，真实入口提供 UI；deps.handlers 优先于内建响应；AC-063、AC-077 的实时传输采用每 15 秒一次的 JSON 轮询。SSE 是未来任务，本任务不实现 SSE，也不验收“状态变化 5 秒内上屏”。正常连接下，下一个轮询周期读取变化；网络或服务失败时保留上次数据并显示 stale，不能承诺墙钟 15 秒内一定完成请求。

交付 ui/index.html、ui/app.mjs、ui/render.mjs，三个 lib/http 数据面模块，两个指定测试文件、UI fixtures 和 T-025 追踪分片。新增模块限于顶部列出的三个数据面文件，足以完成本轮接线；用户允许的其他必要数据面模块本轮不使用，不用宽泛 glob 放开会话或 csrf 文件。design/acceptance 是设计产物，不属于开发写入范围。

## 约束

**入口接线与覆盖顺序。** lib/index.js 只负责路由注册、既有守卫和数据面接线；业务逻辑放在 snapshot.mjs、jobs.mjs、issues-api.mjs。不修改 lib/http/routes.mjs、security.mjs、guard.mjs、contracts/**、package.json、CLI/上下文入口或通用测试 helper。不新增错误码、schema、契约版本、配置项或宿主能力。保持现有 createPlugin/apply/getRegistration 接口、strict 行为、注册失败隔离和各实例隔离。

请求先按实际 URL 与方法确定路由级别，再执行原有守卫，写请求依次执行 session > readonly > csrf > body 校验。完成这些检查后，先查 deps.handlers 对应路径的 handler，再进入任何内建响应，包括 session、ui、health、select 和数据面。覆盖不绕过守卫：非 loopback 的 UI 请求，即使注入 handler，仍为 403 E_LOOPBACK_ONLY；管理接口缺会话仍为 403 E_ADMIN_REQUIRED。select 的既有视图限制也必须在覆盖前执行。禁止在鉴权前执行 handler、读请求体或启动 job。

保留旧 handler 返回普通 JSON 值的行为。为原始 HTML/资源响应，可在传给 handler 的内部参数中提供当前 res；handler 自行结束响应后不再 sendJson 或 fall through。由分发器在本次调用内可靠记录是否已结束响应，不能假定所有契约宿主都提供 headersSent/writableEnded。这是进程内接线，不增加请求或响应的 JSON 字段；新测试验证每个请求只结束一次、内建 handler 未再运行。覆盖键使用已校验的实际 pathname，不含 query；模板兼容仅用于现有 jobIds 注入，不用用户输入拼 handler 名称执行代码。

**真实 UI 与静态资源。** GET /cliworker/ui 返回 ui/index.html 的实际 UTF-8 内容，静态外壳仅含布局、问题首标签页、加载占位与 ESM 入口，不嵌入配置、模型、问题、session 或 csrf 数据。相对导入必须能从该 URL 解析；建议 index 使用 /cliworker/ui/app.mjs，app 同目录导入 render.mjs。资源地址映射到包目录 ui 下的显式清单；可服务清单中的 HTML、ESM、CSS、静态 JSON。JSON 资源只能是静态展示资源，不能承载管理数据或秘密。HTML、ESM、JSON 的 Content-Type 分别正确，响应 no-store；不依赖工作目录、构建器、CDN 或第三方框架。

沿用 exact 宿主：首次合法 UI 请求时通过捕获的 httpCtx.effect/register 注册所需具体资源路径，注册完成后再返回外壳。这样无需修改只读路由表，也保留 T-024 初始化声明集合。注册失败如实进入注册报告，不能返回一个资源实际不可达的“成功 UI”。所有资源均按 bootstrap 执行原有 loopback 三项检查，不要求会话。资源只从服务端 ctx.fs 读取；路径以 import.meta.url 定位 ui 根，白名单映射先于文件读取，拒绝 ..、编码绕过、反斜线、绝对路径和符号链接逃逸。不把目录、状态文件、任意 JSON 或 package 文件暴露成静态资源。缺失、越界、未知资源不得回显请求路径或绝对本机路径。

**快照读取与呈现。** snapshot.mjs 从现有配置目录、probes.json、额度池及 usage ledger 读取，复用 catalog、readProbeModels、forecast 的既有领域实现。不能在 GET snapshot、GET UI、签发会话、GET job 查询、正常轮询中调用 providerStatus 默认探测、checkProvider、任何命令执行器或 CLI；这些场景累计 ctx.exec.count 必须为 0。不要经现有 /providers 或 /models 接口间接触发默认探测。每次快照使用同一 ctx.clock 时刻，只读当前证据；不重新计算或修改选模策略、可用性、额度算法。

快照使用现有 models、forecast、source、at、last_error 字段名称组合管理数据：models 是 model/v1 条目的脱敏投影；forecast 是对应 forecast/v1 结果的集合，按其 model 与条目的 key 关联；source/at 表示此次读取的来源与观测时间，last_error 无故障时为 null。领域对象内部字段及版本不变；不另造 snapshot schema、revision 字段或 since 增量协议，本轮全量返回 JSON。UI 只呈现有证据的数据：allowed 缺失不能当 false，未知等级不能猜测，可用性缺证据/过期不能显示 callable；没有数值的余量不能做 Number(null) 或默认 0。空目录、缺失数据、读取损坏与“确认为空”须可区分。

模型页是六列：白名单、等级、可用性、余量、刷新时间、实测证据。模型/provider 标识置于行的标题或既有单元格内，保证六项都可读，不另用图标隐藏证据。source 和 at 缺失时明确显示 unknown，不能用本次浏览器渲染时间充当测量时间。过期根据条目 at、ttl_s 或既有 policy 的规则判断，过期显示 stale，保留此前值作历史参考，来源与原观测时间仍可读。tasks_left 为 null 而 tasks_left_assumed=N 时精确显示“unknown（估计 N，assumed）”；真实的 0、真实的 100% 正常显示，测试只禁止由缺失或陈旧数据伪造这些数值。刷新时间包含读取/尝试时间与证据观测时间，避免将二者混为一谈。

ui/render.mjs 是纯函数：输入数据和显式的当前时刻/筛选条件，输出可检查的展示结果，不读 DOM、网络、文件、全局时钟，不修改输入。ui/app.mjs 管理请求、计时、交互和 DOM。所有动态文本须转义或使用 textContent；证据、摘要、provider 名称都按不可信文本处理，禁止未经验证的 innerHTML、javascript:、file: 或本机绝对路径链接。

**会话与轮询。** 浏览器首先 GET /cliworker/api/session，拿到 session/csrf 后才立即 GET /cliworker/api/snapshot；此后每 15000ms 发起一轮正常读取，读带 x-cliworker-session，写再带 x-cliworker-csrf。token 仅存当前页面内存，不使用 URL、cookie 或 localStorage。每种读取最多一个在途请求，不重复绑定计时器。错误不清空已有数据；保留数值、显示 stale 和可读错误/时间，下个周期重试。

收到 E_ADMIN_REQUIRED 时只启动一次重新签发，替换整对 session/csrf，随后重试读请求一次；持续失败时显示错误并等待后续周期，不递归无限重签。写请求不能因网络错误自动重放；仅服务器明确以 E_ADMIN_REQUIRED 拒绝、尚未创建 job 时，才允许换会话后重新提交一次。新会话签发失败同样不得清空历史值。job 创建/完成后的额外 GET 不执行 CLI。

**异步 job 与动态查询。** 沿用 POST /cliworker/api/discover、enumerate、probe、read-usage，接受其现有 body，返回含 job_id 的 JSON；UI 的刷新/探测按钮只调用这些接口，不执行浏览器本地命令。jobs.mjs 在守卫和业务参数验证通过后分配不可预测且 URL 安全的 id，登记初始 job、注册具体查询路径，再返回 job_id；实际业务通过 ctx.clock 调度，调用现有领域函数。测试用受控执行结果，禁止真实供应商或网络调用。

查询路径沿用 /cliworker/api/jobs/<id>，不添加示例中的 /cliworker/jobs 别名。查询 handler 每次从 req.url 的 pathname 解析单段 id，再查当前实例 job 表，不捕获初始化结果、不要求把新 id 加进 deps.jobIds、不调用执行器。宿主只有 kind:exact，因此每个新 job 在接受时实时注册自身的具体路径；这只是让宿主将请求送达，查询仍在请求时解析并查表。返回 job_id 前必须确认对应 effect 实际执行且 register 成功；失败不得启动业务或对外宣称 job 已接受。保留旧 deps.jobIds/handlers 的兼容路径，同时新 job 的可达性必须在空 jobIds 的真实入口测试中证明。注册报告与 health 的预期集合随成功注册同步，不把新增资源/job 误报为失败。

job 查询复用既有 job_id、status、at、last_error、error 与业务结果字段，不新增 job schema 或重试错误码；状态显示排队、执行中、成功、失败，内部状态命名由实现保持一致，不扩展为配置契约。未知/畸形 id 不得命中别的 job，不带会话不能读。只承诺已接受 job 的具体路径可达；未注册的任意未知路径是否返回 404 由真实宿主负责，不声称 exact 注册支持通配路由。作业只在本插件实例内存存在，重启后不声称可恢复；多实例不得共享会话和 job。

每个 job 运行前保留受影响项的上次有效视图。成功后重新读取实际状态，只有成功结果清除本次 last_error；失败则保留上次有效值和原证据 at，显示 stale，并用 last_error 与此次尝试的 at 报告失败时间。首轮即失败则 unknown + last_error，不能生成一个历史值；其他模型不被错误覆盖。后完成的旧作业不能把更新证据覆盖成旧值。同一状态目录的业务继续使用既有锁，不另造无锁写入路径。

**问题优先页与已确认缺口。** 第一个、默认选中的标签页必须是“问题”，模型页居后。问题展示沿用 Blueprint §12 的最小语义：任务、角色、模型/provider、发生时间、错误码或分类、摘要、可展开的原始片段/证据/建议动作；有真实记录时按 blocking > major > minor、同严重度时间倒序排列，支持任务、角色、严重度组合筛选。同一任务同类问题合并次数，反复轮询同一记录不能加次数；不同任务不能合并。无法完成但 flow 继续的问题标红“未闭环”，轮询快照暂缺或 flow 继续不能当作解决，筛选仅改变视图不删除记录。以上为问题组件行为规格，不能据此声称已经接入真实 CLI 事件源。

仓库当前只有 CLIWorker 的运行/用量/会话记录，没有统一的 CLI 自报问题记录格式、任务根目录发现协议、明确解决标记或 sessions/logs 证据 HTTP 服务；lib/session.mjs 的角色策略文件也不是问题事件源。禁止扫描个人目录、解析本任务 .collab 状态作生产协议、发明问题文件/schema 或把 CLI 日志推测为可靠问题清单。本轮 issues-api.mjs 负责投影/合并/筛选和来源缺失处理；没有真实输入时，页面持续显示“问题来源未接入”，不能显示“没有问题”或编造记录。问题页随同 snapshot 的 15 秒读取更新连接/来源状态；纯组件的排序、筛选、证据展开、合并与未闭环保留用显式 UI fixtures 验证。

不新增未经约定的问题 JSON endpoint/字段。来自宿主已有 deps.handlers 的问题数据只有在宿主提供实际记录契约后才能接入；本轮不以测试 handler 回传假问题证明真实 CLI 来源已通。详情只允许可信 HTTP 同源证据链接；当前不存在证据 HTTP 服务时，显示脱敏的相对 sessions/、logs/ 证据文字并标“证据链接未接入”，不生成可点击但无法打开的 file URL。AC-077 的本轮入口验收仅要求首标签页、15 秒轮询和来源缺失的诚实呈现；去掉 CLI 自报到前端、自动闭环、真实日志直达的端到端通过断言。组件具备行为不等于这些缺口已关闭。

**脱敏与只读边界。** 管理页必须显示公开模型/provider 标识，但不得输出令牌、真实用户名、绝对本机路径、认证配置或 provider 私密字段。先选取需要的公开字段，再经已有 redact 与扫描机制检查，尤其 level_source.ref、cmd_redacted、evidence.path、原始错误/输出片段。只改变 HTTP 投影，不破坏原始持久记录。lib/contract/scan.mjs 的 scanView 是 AgentLine 扫描器，会拒绝模型标识，不能对管理视图机械套全部 AgentLine 禁用项或靠空 catalog 假装通过；沿用其适用扫描逻辑并用秘密哨兵、用户名与绝对路径样本验证 HTTP 响应。session 签发中 session/csrf 是既有必要例外，不得被复制进 snapshot、job、错误或日志。

## 建议验收方向

test/unit/ui-render.test.mjs 覆盖六列、缺失/过期/assumed、真实 0/100%、来源与时间、HTML 转义、纯函数不变性，并以 UI fixtures 覆盖问题组件。test/integration/ui-snapshot.test.mjs 必须从 lib/index.js 的 createPlugin 及真实 exact 注册表访问请求，并运行实际 ui/app.mjs 的请求/调度逻辑，不能只靠搜索源码中的 URL、硬写请求顺序或直接调用 snapshot/jobs 绕过入口。

测试可在这两个指定文件内增补局部 HTTP/DOM/计时适配器，复用现有 host-stub/fake ctx，不修改 test/helpers。静态文件测试向 ctx.fs 提供与磁盘 ui/** 一致的实际字节，不在测试内重写一个假的 HTML/app 代替产品文件；另用实际 fs 只读的 ctx 验证真实入口可服务仓库资源。时间测试用受控 clock 推进，不等待 15 秒墙钟，不依赖真实账号。每条验收命令自行建立/清理其 fixture、时钟和插件实例，不依赖其他命令先运行；临时状态在系统临时目录，禁止写个人配置。

acceptance.md 仅用 AC-062、AC-063、AC-077 三个小节，每条命令检查 native 退出码后才输出对应哨兵。AC-062 映射 unit 文件，AC-063 映射 integration 文件；可使用同一 integration 文件验证 AC-077 的有限入口行为，不通过测试标题筛选。禁止 skip/todo/only 或“缺资源即跳过”获得绿灯。

追踪分片沿用 {task,milestone,entries:[{ac,files,status}]}，task 为 T-025，milestone 为 M5，只登记索引里已属本任务的 AC-062/063。当前 contracts/spec/ac-index.json 没有 AC-077，check-traceability 也未支持它；两者范围外，不加一个 covered 的未知 AC 来伪造完整追踪。AC-077 保留本文件/acceptance 的有限验收和缺口，完整登记需后续契约任务处理。

实现后执行 acceptance 全部命令和全 unit 回归，再运行 scripts/check-fast.ps1 收集整体结果。当前运行环境可执行 node，但 pwsh 未在 PATH；验收命令由有 PowerShell 7 的 runner 执行，不使用 Windows PowerShell 5.1。设计阶段只执行无产物的 acceptance 格式检查与静态文档核对，不运行会生成报告的全量 check-fast，也不调用 git。

已知旧回归差异需如实报告：T-024 的 plugin-routes.test.mjs 用无 UI 文件的 fakeFs 请求 /ui；真实静态资源服务可能使此旧用例失效，不能返回固定空 HTML 迎合它。registration.test.mjs 固定初始化集合，本方案在首次 UI 访问及 job 接受时增加资源具体路由，保持初始化集合。其他旧用例若固定同步 discover/probe 响应，与本任务 job_id 行为冲突，同样不改范围外测试或隐瞒失败。check-fast 全绿在这些旧断言调整前不作为本轮独立 AC 的通过声明；下游仍须运行并记录准确退出结果，不把失败记录写成通过，也不拓宽本任务测试修改范围。

## 非目标

不实现 SSE、5 秒推送、CLI 自报问题采集协议、任务目录自动发现、真实 sessions/logs 证据服务、问题跨重启持久化或自动闭环；不把这些缺口写成 AC-077 完整通过。不实现设置/凭据编辑、登录/多用户、前端构建、i18n、打包清单或发布门禁。不修改冻结入口、会话/csrf 或宿主契约，不通过未声明的 prefix/regexp 能力解决 exact 分发。
