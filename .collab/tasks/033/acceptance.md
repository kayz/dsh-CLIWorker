# Task 033 验收标准

## AC-078 HTTP provider 契约、身份 verified、usage 精确记账、凭据引用、错误码映射

levels：contract、integration。所有命令从仓库根运行，使用 PowerShell 7（pwsh）。brief 未提供基准 commit SHA 或既有验收报告路径；本验收不自行指定。本轮用户提供的 e28dfda 是增量变更引用，不当作测试基准，也不要求执行 git。

本轮四项裁决已经解除上一轮阻塞，可以按 design.md 开始库层实现。验收不再要求 vault、lib/identity.mjs 或生产 probe 接线；HTTP probe 端到端接线缺口归 T-020，需在交接中记录。以下功能命令在实现完成后运行；缺失测试文件、零测试、跳过或 todo 均不能算通过。

- 命令: node scripts/check-acceptance.mjs .collab/tasks/033/acceptance.md; if ($LASTEXITCODE -ne 0) { throw 'AC-078 acceptance format failed' }; Write-Output 'AC-078 OK'
- 期望输出: 进程退出码 0，输出包含 check-acceptance: ok，最后一行为 AC-078 OK。此条只证明 runner 能解析文档，不证明 HTTP 功能通过。

brief 指定的功能命令为 node --test test/contract/http-provider.test.mjs test/unit/http-usage.test.mjs。以下执行时仅显式指定 TAP reporter，并检查测试实际执行：

```pwsh
$ErrorActionPreference = 'Stop'
$httpTestOutput = & node --test --test-reporter=tap test/contract/http-provider.test.mjs test/unit/http-usage.test.mjs
$httpTestExit = $LASTEXITCODE
$httpTestOutput | Write-Output
if ($httpTestExit -ne 0) { throw 'AC-078 HTTP tests failed' }
$httpTestSummary = $httpTestOutput -join [Environment]::NewLine
if ($httpTestSummary -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw 'AC-078 no tests executed' }
foreach ($httpTestCounter in @('fail', 'cancelled', 'skipped', 'todo')) {
    if ($httpTestSummary -notmatch "(?m)^# $httpTestCounter 0\s*$") { throw "AC-078 nonzero or missing $httpTestCounter count" }
}
Write-Output 'AC-078 OK'
```

- 期望输出: Node TAP 摘要 tests 大于 0，fail、cancelled、skipped、todo 均为 0；两份测试文件全部通过，进程退出码 0，最后一行为 AC-078 OK。
- 失败判定: 任一目标文件缺失、导入失败、断言失败、没有摘要、零测试或任一用例跳过/todo，命令必须抛错并返回非零；不得只打印哨兵掩盖失败。

上述功能命令中的两份测试必须断言以下确定输出；每个场景重新初始化 ctx、响应序列与账本，不依赖其他场景或命令的运行顺序：

- 库层 provider 契约：真实 registry 描述符包含 transport:"http"、base_url、chat 路径、supported model ids、identity/usage 提取 hooks。DeepSeek endpoint 精确为 https://api.deepseek.com/chat/completions；支持清单由输入声明，改变注入的模型 ID 后不修改代码仍可构造对应请求，未支持模型在 fetch 前返回 E_REQUEST_INVALID。HTTP 请求为非流式 JSON POST，所选 model 和 messages 与输入相等；ctx.exec 调用数为 0。CLI 描述符使用 transport:"cli" 并保持原调用构造语义。registry 查询本身无凭据读取、网络或进程副作用。
- 库层完整贯通：从真实 registry 描述符进入真实 HTTP 客户端，使用 apiKeyEnv 指向 ctx.env 中的合成秘密，经现有 resolveSecret 的 env 源取值、处理响应、调用真实 ledger 写入并读回。有效响应 prompt_tokens=123、completion_tokens=45 时，账本 input_tokens=123、output_tokens=45，模型键与 pools 精确匹配当前渠道；不以生产 probe 或路由是否接线判定本任务失败。
- 凭据与错误前置：apiKeyEnv 为 "DEEPSEEK_API_KEY" 时，值只进入请求内存中的 Bearer 头，输入配置和 ctx.env 保持不变。变量不存在或为空时，输出 E_SECRET_BACKEND、retryable=false，消息包含 DEEPSEEK_API_KEY，fetch 调用数为 0；非法变量名输出 E_REQUEST_INVALID、内联明文输出 E_CONFIG_SECRET_INLINE，均不发请求。没有 vault 新后端，也不修改 lib/secrets/index.mjs。用合成秘密扫描返回结果、stdout、stderr、错误、证据和所有文件写入内容，均不含秘密；不得输出原始 Authorization 头。服务响应或异常回显秘密时同样通过；重定向不得向其他地址发送凭据。
- 身份：有效响应 model 与请求严格匹配时，结果 identity="verified" 且 identity_source="response.model"；model 缺失、空字符串、非法类型或不匹配时，identity="observed"、identity_source="response.model"，reason 非空且准确说明缺失/冲突，仍保留有效回复与已知用量。缺失时 reported_model 不得回填请求模型，不匹配时保留实际模型证据。registry 提取 hooks 与真实客户端给出相同判定，不创建或依赖 lib/identity.mjs。
- 用量：123/45 精确保存，显式 0/0 可记为零；字段缺失、负数、小数、非数值、超出安全整数时不写伪造零消费，保留未知状态。cache 明细不使 prompt_tokens 重复计费。响应身份为 observed 时，已确认用量仍写入请求所用渠道的账本。
- 分池：同一模型名分别通过 codebuddy 与官网，使用不同来源 model.key 与池 ID。先各提交一笔消费，再读回账本并调用现有 evaluatePools，每笔只改变所属池，另一池不变。将两个来源声明到同池时，在 HTTP 付费请求前显式拒绝，fetch 调用数为 0；不能只比较来源标签。
- 防重与存储失败：对同一来源、同一 idempotency_key 重放已完成记账或并发提交，账本只增加一行且不调用 fetch；两个来源分别提交时，即使原始 idempotency_key 相同也各保留一行。损坏账本和写入异常必须显式失败，不覆盖或截断旧内容，不因写盘失败再次付费请求。
- 本轮 probe 增量对应的用量回归：HTTP 第一次超时无用量、第二次成功给出 123/45 时，只记 123/45；两次均未知时不记零账；5xx 尝试提供有效用量、随后成功或最终失败时，所有已确认消费合计一次，未知部分不估算。使用现有 probe 的原则，不修改或要求重跑范围外 probe 来代替 HTTP 测试。

错误映射和重试必须由功能命令实际触发真实 HTTP 客户端，逐项断言既有码、retryable、retry_after 及 fetch 次数：

| 输入/响应序列 | 期望输出 | fetch 次数 |
|---|---|---|
| 缺失/空环境变量 | E_SECRET_BACKEND，retryable=false，消息含变量名 | 0 |
| 本地无效请求 | E_REQUEST_INVALID，retryable=false | 0 |
| 401、403 各一例 | E_PROVIDER_AUTH，retryable=false | 各 1 |
| 429，Retry-After: 30 | E_PROVIDER_QUOTA，retryable=false，retry_after 为伪时钟当前时间加 30 秒的 ISO 时间 | 1 |
| 429，有效 HTTP 日期 Retry-After | E_PROVIDER_QUOTA，retryable=false，retry_after 为该日期的 ISO 时间 | 1 |
| 429，缺失/无效 Retry-After | E_PROVIDER_QUOTA，retryable=false，retry_after=null | 1 |
| 402 或明确配额耗尽 | E_PROVIDER_QUOTA，retryable=false；同池不重试 | 1 |
| 500 后成功、503 后成功各一例 | 返回有效回复、正确身份及已知用量 | 各 2 |
| 连续两次 500、连续两次 503 各一例 | E_PROVIDER_FAILED，retryable=true，无第三次尝试 | 各 2 |
| 超时后成功 | 成功；仅记已知用量，无遗留定时器 | 2 |
| 连续超时 | E_TIMEOUT，retryable=true，无第三次尝试，无遗留定时器 | 2 |
| 5xx 后 401/403/429 各一例 | 分别为 E_PROVIDER_AUTH/E_PROVIDER_AUTH/E_PROVIDER_QUOTA，retryable=false，立即停止 | 各 2 |
| 其他 HTTP 4xx | E_REQUEST_INVALID，retryable=false | 1 |
| 重定向、网络异常、非法 JSON、缺失必需回复结构各一例 | E_PROVIDER_FAILED，retryable=false，不泄露原始异常/响应 | 各 1 |

测试还须验证：仅缺少 model 或 usage 不等于缺少必需回复结构，按前述 observed/未知用量规则处理；fetch 和响应体读取均受超时控制；任何场景不输出 E_SECRET_MISSING/E_AUTH，也不把表中错误意外转换成 E_INTERNAL。5xx 或超时最多首次加一次立即重试；耗尽尝试后的 retryable=true 不表示当前调用继续循环。429 即便有 retry_after 也不在同池等待或重发。

格式检查与功能检查各自独立，不依赖前一条命令的变量、文件或执行结果。未运行功能命令不能记录为通过；格式通过也不替代对上述断言覆盖的审查。
