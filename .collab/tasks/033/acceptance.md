# Task 033 验收标准

## AC-078 HTTP provider 契约、身份 verified、usage 精确记账、凭据引用、错误码映射

levels：contract、integration。所有命令从仓库根运行，使用 PowerShell 7（pwsh）。brief 未提供基准 commit SHA 或既有验收报告路径；本验收不自行指定。

当前存在 attention.json 中的契约阻塞。功能命令用于裁决落实、design.md 补全且实现完成后的验收；本文件不授权绕过阻塞。缺失测试文件、零测试、跳过或 todo 均不能算通过。

- 命令: node scripts/check-acceptance.mjs .collab/tasks/033/acceptance.md; if ($LASTEXITCODE -ne 0) { throw 'AC-078 acceptance format failed' }; Write-Output 'AC-078 OK'
- 期望输出: 进程退出码 0，输出包含 check-acceptance: ok，最后一行为 AC-078 OK。此条只证明 runner 能解析文档，不证明 HTTP 功能通过。

brief 指定的功能验收命令如下，命令自身同时检查测试是否实际执行：

```pwsh
$ErrorActionPreference = 'Stop'
$httpTestOutput = & node --test test/contract/http-provider.test.mjs test/unit/http-usage.test.mjs
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

- 期望输出: Node 测试摘要 tests 大于 0，fail、cancelled、skipped、todo 均为 0；两份测试文件全部通过，进程退出码 0，最后一行为 AC-078 OK。测试运行时应使用 Node 的默认 TAP reporter；若环境覆盖 reporter，先恢复默认后独立执行此命令。
- 失败判定: 任一目标文件缺失、导入失败、断言失败、没有摘要、零测试或任一用例跳过/todo，命令必须抛错并返回非零；不得只打印哨兵掩盖失败。

上述测试必须通过生产代码验证以下行为。裁决前不预设新导出、描述符字段、身份来源枚举或错误码；裁决后的确切输入/输出须补入 design.md，并由两份测试文件断言：

- 统一 provider 契约：经裁决认可的生产入口选择 transport=http，使用 ctx.fetch 发出且只发出预期请求，CLI 执行探针为 0；transport=cli 保持已有调用语义。DeepSeek 首个 endpoint 与 AC-078 指定值一致，模型名取自声明输入而非代码清单。只在测试中直接调用新模块而缺少约定的生产接线，不算完成。
- 完整贯通：在 contract 文件内以合成服务响应贯通凭据引用解析、HTTP、身份判定和账本落盘/读回，不能仅检查伪对象或返回值。测试不访问真实官网与真实凭据。用量字段、模型键和池成员与读回结果逐项相等。
- 身份：响应 model 匹配时，按确认后的统一对象输出 verified 和真实证据；缺少 model 不得回填请求模型冒充 verified；不匹配不得静默当作匹配。HTTP 来源必须按裁决准确表示，不能冒充 CLI stdout 来源。
- 用量：prompt_tokens=123、completion_tokens=45 时，账本 input_tokens=123、output_tokens=45；显式 0 精确保存。缺失字段、负数、小数、非数值及超出安全整数的输入均不得写成零消费或估算值。cache 明细不得使 prompt_tokens 重复计费。
- 分池：同一模型名分别来自 codebuddy 与官网，先各执行一笔消费，再读回账本并调用既有 evaluatePools。两笔账本分别归属已确定的来源模型键和不同池；每笔只改变所属池，另一池保持原值；不能只比较来源标签而不验证池计算。
- 防重与失败：同一已完成消费重放后账本仍为一行，fetch 次数不增加；两来源的不同消费各保留一行。并发提交相同消费只记一次；损坏账本和写入异常显式失败，旧内容不被覆盖或截断。不得将重复提交测试写成重复付费请求测试。
- 凭据：合法 env 引用与裁决后的 vault 引用均经真实生产解析器使用；明文、无效引用、缺失值与后端失败均在网络前终止。用合成秘密扫描 stdout、stderr、错误、证据及所有写入内容，任何位置都不含秘密或 Authorization；原始服务错误回显秘密时同样不得泄露。重定向不得把秘密发送给其他地址。禁止用测试临时编造的 vault 后端宣称已有生产支持。
- 错误映射：独立覆盖 401、403、429、500、503、其他非成功状态、网络异常、超时、非法 JSON 和缺失必需响应结构。逐项断言裁决后的既有码、retryable 和实际请求次数；401/403 不重试，429/5xx 可重试，未知错误不能意外落入 E_INTERNAL；失败响应不得无依据写入成功用量。

格式检查与功能检查各自独立，不依赖前一条命令的变量、文件或执行结果。未运行功能命令不能记录为通过；格式通过也不替代对上述断言覆盖及生产接线的审查。
