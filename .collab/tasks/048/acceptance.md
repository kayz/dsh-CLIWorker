# Task 048 — 界面永不阻断：数据失败时也渲染基础骨架与分区错误

所有命令在仓库根、PowerShell 7 中独立执行。每个 pwsh 代码块是一条命令，由既有执行器保存到其临时 .ps1 后执行，不在仓库新增脚本。每条命令必须退出码 0 且 stdout 输出独立行 AC-091 OK 才通过；失败不得打印成功哨兵。brief 未给出基准 commit SHA 或既有验收报告路径，不以历史报告或其他任务通过结论代替本次执行。

## AC-091 数据失败时保留完整骨架，错误局限于所属分区且可以重试

功能验收命令（实现完成后执行）：

```pwsh
$ErrorActionPreference = 'Stop'
$ac091Output = & node --test --test-reporter=tap test/unit/client-shell.test.mjs
$ac091Exit = $LASTEXITCODE
$ac091Output | Write-Output
if ($ac091Exit -ne 0) { exit $ac091Exit }
$ac091Text = $ac091Output -join "`n"
if ($ac091Text -notmatch '\[AC-091\]' -or $ac091Text -notmatch '(?m)^# tests [1-9][0-9]*\s*$' -or $ac091Text -notmatch '(?m)^# pass [1-9][0-9]*\s*$' -or $ac091Text -notmatch '(?m)^# fail 0\s*$' -or $ac091Text -notmatch '(?m)^# skipped 0\s*$' -or $ac091Text -notmatch '(?m)^# todo 0\s*$') { throw 'AC-091 requires executed passing tests without skip/todo' }
Write-Output 'AC-091 OK'
```

期望输出：退出码 0；TAP 包含 [AC-091] 用例，tests、pass 大于 0，fail、skipped、todo 均为 0，stdout 含独立行 AC-091 OK。缺文件、没有实际通过测试、任何失败或跳过均不通过。该测试文件通过真实 loader/factory/apply 得到 Page，用假 fetch 与最小 React 替身验证以下可观察结果：

- 成功、HTTP 500、快照缺 config、models=[] 四种路径各自渲染 CLIWorker 标题、状态行、刷新按钮以及有「模型」「问题」「配置」标题的三个分区容器。正常数据在对应分区内出现；断言实际子树归属，不能只拼接整页文本。
- 首次同步渲染，以及 session 或 snapshot 的 Promise 未完成时，三个分区内均有「加载中」，标题、状态行和禁用的刷新按钮均存在，没有先显示「暂无模型」或空白页。请求完成或失败后按钮恢复可用。
- 初次 snapshot HTTP 500 时，模型区内有「读取失败」、snapshot 端点/HTTP 500 原因与可点击的「重试」按钮；问题区有「暂无问题数据」；配置区有「配置摘要不可用」、unknown 配置路径/provider 状态、README.md 文档路径与刷新说明。配置/问题区仍可见，不复制模型区的详细错误，不伪造真实路径或未找到状态。session 失败、网络拒绝、坏 JSON 与非法整体响应同样保留骨架并提供相应原因。
- 触发模型区真实重试按钮或顶部刷新按钮后，通过既有 session/snapshot 链路恢复；错误文字消失，实际新模型、问题、配置路径/provider 解析状态出现在各自分区，按钮状态恢复。不发 POST，不显示会话或 CSRF 测试哨兵。
- 快照有既有 at/source，单独删除 config 或令其为 null/错误类型时，仅配置区显示「配置摘要不可用」及刷新/README.md 下一步；模型和问题照常显示。config 有效而 providers 缺失或错误类型时，配置路径仍可见、解析状态不可用。resolved 为 true/false/缺失的 provider 分别显示已解析/未找到/unknown；条目为 null 不抛错。
- models=[]、models 缺失/null/错误类型时，模型区显示「暂无模型」和查看下方配置区、配置后刷新的提示；有效 config.path、provider 状态与 issues 原内容仍出现在各自分区。模型条目缺字段或为 null 不抛错。forecast 缺失或错误类型时模型仍出现、余量 unknown。保留 false、0、assumed、无 evidence 不展示 callable 等既有可见语义。
- issues 缺失/null/错误类型时，问题区显示「暂无问题数据」和刷新提示；issues=[] 时保留「暂无问题」。其他分区内容仍可见，问题单条缺字段或 null 不阻断页面。
- 首次成功后刷新失败时，模型区内出现读取失败、原因、重试及 stale；旧模型、旧问题、原配置路径和 provider 状态均仍可见，状态表明是旧数据。恢复后显示最新值并清除错误。成功但缺 config 的新快照显示占位，不能继续把旧 config 当作新值；issues 同理。last_error 在模型区内可见，模型与预测仍标 stale。

既有客户端回归命令（实现完成后执行）：

```pwsh
$ErrorActionPreference = 'Stop'
$ac091Output = & node --test --test-reporter=tap test/unit/client-manifest.test.mjs
$ac091Exit = $LASTEXITCODE
$ac091Output | Write-Output
if ($ac091Exit -ne 0) { exit $ac091Exit }
$ac091Text = $ac091Output -join "`n"
if ($ac091Text -notmatch '(?m)^# tests [1-9][0-9]*\s*$' -or $ac091Text -notmatch '(?m)^# pass [1-9][0-9]*\s*$' -or $ac091Text -notmatch '(?m)^# fail 0\s*$' -or $ac091Text -notmatch '(?m)^# skipped 0\s*$' -or $ac091Text -notmatch '(?m)^# todo 0\s*$') { throw 'AC-091 regression requires executed passing tests without skip/todo' }
Write-Output 'AC-091 OK'
```

期望输出：退出码 0，TAP 实际通过测试且 fail/skipped/todo 为 0，stdout 含独立行 AC-091 OK。原测试文件保持不变；既有 manifest、图标、loader、缺 slot、同步/延迟注册失败隔离、session 请求头、鉴权最多重试一次、数据展示、stale、空态、并发刷新和卸载后无更新等断言原样通过，不以修改旧断言取得通过。

完整门禁命令（供实施完成后的下游执行；本 design 轮不执行会产生额外文件的完整检查）：

```pwsh
$ErrorActionPreference = 'Stop'
pwsh -NoProfile -File scripts/check-fast.ps1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-091 OK'
```

期望输出：退出码 0，stdout 含 check-fast: ok 和独立行 AC-091 OK；验收格式、既有检查器及完整测试通过。不注入替代检查目录或最终测试脚本，不用 filtered run 替代完整门禁。范围外既有失败报告实际原因，不越界修改代码、测试、追踪或契约文件。运行产物沿用既有系统临时目录配置。

docs/release-checklist.md 中的客户端验证须包含本次 unit 命令及真实 DSH 观察步骤：首次加载完整骨架、受控数据失败后分区仍可见、配置缺失占位、刷新失败保留旧配置和恢复重试。文档保留原发布门禁，并明确上述自动化测试不能证明真实 DSH 已观察通过；本验收不声称已执行真机验证。

格式自检命令（design 轮执行）：

```pwsh
$ErrorActionPreference = 'Stop'
node scripts/check-acceptance.mjs .collab/tasks/048/acceptance.md
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-091 OK'
```

期望输出：退出码 0，stdout 含 check-acceptance: ok、warnings=0 和独立行 AC-091 OK；只证明本文格式可被执行器解析，不代替上述功能、回归、完整门禁或真实 DSH 观察。
