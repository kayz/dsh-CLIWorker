# Task 025 — 模型管理界面（白名单、等级、可用性、余量、刷新时间、实测证据）与实时数据

所有命令在仓库根、PowerShell 7 中独立执行；每个 pwsh 块是一条完整验收命令，任一步失败立即非零退出且不打印成功哨兵。没有本任务指定的基准 commit SHA 或既有验收报告。

依据本轮用户答复，AC-063/AC-077 的实时传输以 15 秒 JSON 轮询验收，不实现 SSE，不断言 5 秒上屏。AC-077 的实际 CLI 问题来源、解决标记与证据 HTTP 服务缺失，本轮只验收真实入口的首标签页/来源提示及组件行为，不以此宣称完整端到端 AC-077 已覆盖。完整缺口见 design.md。

## AC-062 六列、未知值与纯渲染（unit）

```pwsh
$ErrorActionPreference = 'Stop'
node --test test/unit/ui-render.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-062 OK'
```

期望输出：退出码 0，stdout 含 `AC-062 OK`。测试直接断言渲染结果具有白名单、等级、可用性、余量、刷新时间、实测证据六列；模型/provider 可读。缺失值显示 unknown，过期值显示 stale，source/at 可读；缺少来源或时间时显式 unknown。缺失/陈旧数据不产生伪造的 0 或 100%，有真实新鲜证据的 0、100% 保留。tasks_left 缺失而估计为 N 时显示 `unknown（估计 N，assumed）`。输入不被修改，同输入同时间产生同结果；不可信文本被转义。问题组件 fixture 的排序、组合筛选、展开证据、同任务同类计数与未闭环保留也必须通过；这些 fixture 不证明 CLI 来源已经接通。不得以断言测试标题、函数名、行号或 skip 替代结果检查。

本任务额外保留全 unit 回归门禁：

```pwsh
$ErrorActionPreference = 'Stop'
node --test "test/unit/*.test.mjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-062 OK'
```

期望输出：退出码 0，全部 unit 测试通过，stdout 含 `AC-062 OK`；不能用本任务单文件替代全 unit 集合。

## AC-063 真实静态入口、会话轮询与 job（integration）

```pwsh
$ErrorActionPreference = 'Stop'
node --test test/integration/ui-snapshot.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-063 OK'
```

期望输出：退出码 0，stdout 含 `AC-063 OK`。integration 文件必须直接验证以下可观察结果：

- 从实际 createPlugin 的 exact 注册入口 GET /cliworker/ui 得到 ui/index.html 实际内容，未嵌入业务数据或凭据；HTML 引用的 app/render 与清单内静态 JSON/样式资源可从真实注册路径读取，字节和 Content-Type 正确。拒绝越界资源请求且不泄露绝对路径。非 loopback 的外壳和资源均 403 E_LOOPBACK_ONLY。
- 在合法守卫之后，deps.handlers 对 UI 和其他已有路由的覆盖优先于内建响应，响应只结束一次；不合法请求不会调用覆盖 handler。原有返回 JSON 的注入行为保留。
- 实际 app 首次请求 session，随后 snapshot 带 x-cliworker-session，推进受控时钟至下一 15000ms 周期可观察到下一次 snapshot 请求；连续推进不出现重叠请求/重复计时器。此过程及快照/job 查询的 exec 总数为 0；不能用测试硬写的请求序列替代 app。
- 使实际会话过期后，旧头得到 403 E_ADMIN_REQUIRED；app 重新签发一次，使用新的 session/csrf 恢复读取。持续拒绝或网络失败不会造成无限重签或写请求重放，原数据仍可见且标 stale。
- 合法刷新与探测通过已有管理写接口得到 job_id；缺会话、readonly、csrf 不合法的请求仍按既有顺序拒绝且不启动 job。没有预置 jobIds 的插件实例，在接受新 job 后能从宿主已注册的具体 /cliworker/api/jobs/<id> 路径查询该 job；查询通过请求路径解析 id，不能查询到另一实例的 job。注册失败不返回已接受 job，也不执行后台业务。
- 受控 job 成功后 snapshot 显示持久状态的最新证据；失败后保留指定项原来的数值及测量时间，显示 stale，并附 last_error 与失败尝试 at。首轮无历史数据时显示 unknown；其他项不被清空，旧作业不覆盖新证据。只有写 job 阶段允许发生受控 exec，不调用真实 CLI。
- 正常及错误的 snapshot/job/资源响应中秘密哨兵、真实用户名样本、本机绝对路径样本均无泄漏；公开模型/provider 标识仍可读。会话令牌仅在签发响应出现。

## AC-077 问题首标签页与轮询（integration，本轮有限覆盖）

```pwsh
$ErrorActionPreference = 'Stop'
node --test test/unit/ui-render.test.mjs test/integration/ui-snapshot.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-077 OK'
```

期望输出：退出码 0，stdout 含 `AC-077 OK`。真实外壳及 app 渲染的第一个且默认选中标签页为“问题”；无问题数据源时明确显示 `问题来源未接入`，不能显示一个虚假的“没有问题”。推进受控时钟 15000ms 后，经真实 JSON 快照入口观察到新一次读取及页面来源状态更新；连接失败后状态仍显示 unknown/stale，不抹掉已有展示。

组件 fixture 另外验证：任务、角色、模型/provider、时间、分类或错误码、摘要和可展开的详情均可读；blocking > major > minor、同严重度时间倒序；按任务/角色/严重度组合筛选；不同任务不合并，同任务同类重复事件合并次数，同一快照反复轮询不重复计数；未闭环记录在 flow 继续或下一快照暂缺时仍保留并标红。只有经过校验的同源 HTTP 证据 URL 可点击；无证据服务时相对 sessions/logs 路径只显示为文字及未接入提示，不生成 file URL。

本哨兵只表示上述有限范围通过：不证明真实 CLI 自报自动采集、证据文件 HTTP 直达、问题自动解决或 AC 索引登记已完成。这些断言按本轮授权从本次验收移除，不以测试注入假记录代替交付。

文档格式自检：

```pwsh
$ErrorActionPreference = 'Stop'
node scripts/check-acceptance.mjs .collab/tasks/025/acceptance.md
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-077 OK'
```

期望输出：退出码 0，stdout 含 `acs=3 commands=5`、`warnings=0` 和 `AC-077 OK`。此命令只验证验收文档能被 runner 解析，不代替前面的产品验收。
