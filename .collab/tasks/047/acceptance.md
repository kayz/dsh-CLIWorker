# Task 047 — 配置引导验收

所有命令在仓库根、PowerShell 7 中独立执行。每个 pwsh 代码块是一条命令，由调度器作为其既有 ps1 执行，不在仓库创建脚本。每条命令必须退出码 0 且 stdout 包含 AC-090 OK 才通过；失败时不得打印成功哨兵。原生命令后检查 $LASTEXITCODE。

brief 未给基准 commit SHA 或既有验收报告路径。本轮提供的 00ac738 用于说明上游增量，不作为测试通过证据；不执行 git。AC-090 已在现有 ac-index 登记为 T-047 / M5 / integration，本任务不再改登记文件。

## AC-090 没有可用 CLI 时仍能配置，快照增量与隐私约束保持

功能验收命令：

```pwsh
$ErrorActionPreference = 'Stop'
$ac090Output = & node --test --test-reporter=tap test/integration/ui-config-guide.test.mjs
$ac090Exit = $LASTEXITCODE
$ac090Output | Write-Output
if ($ac090Exit -ne 0) { exit $ac090Exit }
$ac090Text = $ac090Output -join "`n"
if ($ac090Text -notmatch '(?m)^# tests [1-9][0-9]*\s*$' -or $ac090Text -notmatch '(?m)^# pass [1-9][0-9]*\s*$' -or $ac090Text -notmatch '(?m)^# fail 0\s*$' -or $ac090Text -notmatch '(?m)^# skipped 0\s*$' -or $ac090Text -notmatch '(?m)^# todo 0\s*$') { throw 'AC-090 requires executed passing tests without skip/todo' }
Write-Output 'AC-090 OK'
```

期望输出：退出码 0；TAP 汇总 tests 与 pass 均大于 0，fail、skipped、todo 均为 0；stdout 含 AC-090 OK。缺文件、空测试、跳过或失败均不通过。指定文件应对以下实际结果执行断言，每组都通过真实 snapshot/session/startApp 链路；纯渲染测试仅作补充：

- 全部 CLI 缺失：通过既有 probe 入口在受控 exec 返回 ENOENT 的条件下产生真实 command missing 缓存。GET snapshot 返回 200，顶层排序后精确等于 ['at', 'config', 'forecast', 'issues', 'last_error', 'models', 'source']；排除 config/issues 后精确等于原五键。模型和问题按既有缓存投影，不因 CLI 缺失将整页变成错误页。
- config 精确三键 path/providers/hint；path 严格等于该次实际配置文件绝对路径；provider 项精确三键 name/cli/resolved，resolved 是布尔且缺失场景为 false。普通命令名保持；绝对/带目录声明只显示安全文件名，不出现实际目录。hint 是可 JSON.parse 的字符串，v2 片段只使用既有 discovery.cli_overrides/provider/cli 结构，旧配置只使用既有 providers/provider/cli 结构；没有完整配置或新版本的伪造。
- 证据结果可区分：匹配的有效 present discovery 或有整数 exit 的 probe 支持 resolved=true；非零退出仍能已解析且模型不因此变为 callable。无缓存/仅声明/无匹配/过期证据为 false，gone 或较新的 command missing 不被旧成功覆盖。两个不同绝对目标即使文件名相同，也不误认其证据；不同 provider 不串行。读取摘要不增加 CLI 探测执行次数、业务状态写入次数或网络调用；已有受控 secrets 后端读取单独计数。
- 默认问题标签下，实际挂载后的页面可见配置路径、配置标题和 provider/声明的 cli/解析状态三列表格；缺失行显示「✘ 未找到」，成功解析行显示「✔ 已解析」。路径值可选中复制；带目录的 CLI 仅显示安全文件名且有说明。不能只检查尚未挂到页面的 HTML 字符串。
- models=[] 和全部非 callable 时顶部有「把 CLI 装进 PATH」及「把 cli 指向可执行文件绝对路径」说明与 JSON 示例。混合场景中只要至少一个模型 availability.state 为 callable，顶部引导消失，配置区与表格仍存在。resolved=true 而无 callable 时仍有引导。切换模型/问题标签均不隐藏配置区。
- API 中每个 command missing 的 issue 仍精确为原六键，detail 保持 command missing，id、kind、subject、evidence_ref、at 与原证据相符。页面中逐条 article 均有可见「下一步」及该 CLI 的 PATH/修改 cli 说明；多条问题不能只补一条或仅有全局说明。非命令缺失问题的种类与原始证据不变。
- 成功轮询后不重复配置区，配置表与引导随最新快照更新；读取失败保留原路径/表格/问题并显示既有 stale 状态，恢复读取后展示新值。GET 不触发 POST。既有刷新、探测按钮继续走原鉴权和任务入口；原模型表和问题来源行为保持。没有 config 的既有 unknown fallback 不崩溃、不伪造路径。
- 隐私检查只从响应深拷贝中删除 config.path，再对剩余整个响应保留 cw-private-person-*、PRIVATE_、secret/token 哨兵及真实主机目录否定断言。config.path 另行精确等于实际文件路径；不能删整个 config，不能替换字符串或放宽正则。分别向秘密引用、受控环境、原始输出、CLI 绝对目录放入不同哨兵，均不能出现在 config 其他位置、hint 内嵌 JSON、问题或模型投影中。配置路径若在别的字段再出现，也必须失败。
- 页面路径仅在配置区的路径控件/文本中展示；问题 HTML 延续原真实目录与秘密否定断言。路径和示例内的引号、尖括号、与号等被安全显示，不产生 script、事件属性或任意链接。

兼容与裁决回归命令：

```pwsh
$ErrorActionPreference = 'Stop'
$ac090Output = & node --test --test-reporter=tap test/integration/ui-snapshot.test.mjs test/integration/issues-from-probe.test.mjs test/integration/snapshot-legacy-config.test.mjs
$ac090Exit = $LASTEXITCODE
$ac090Output | Write-Output
if ($ac090Exit -ne 0) { exit $ac090Exit }
$ac090Text = $ac090Output -join "`n"
if ($ac090Text -notmatch '(?m)^# tests [1-9][0-9]*\s*$' -or $ac090Text -notmatch '(?m)^# pass [1-9][0-9]*\s*$' -or $ac090Text -notmatch '(?m)^# fail 0\s*$' -or $ac090Text -notmatch '(?m)^# skipped 0\s*$' -or $ac090Text -notmatch '(?m)^# todo 0\s*$') { throw 'AC-090 regression requires passing tests without skip/todo' }
Write-Output 'AC-090 OK'
```

期望输出：退出码 0，TAP 有实际通过测试且 fail/skipped/todo 均为 0，stdout 含 AC-090 OK。三个指定旧测试文件全部执行，不得删测试、skip/todo/only 或减弱旧断言。除本轮明确授权的两份旧测试增量契约更新外，旧字段值断言逐字保留；snapshot-legacy-config.test.mjs 不在写域，原样通过。

ui-snapshot 与 issues-from-probe 的正常快照顶层精确更新为七键；排除 config/issues 后精确保留五键；原模型值、证据字段、原观测时间、last_error、source、鉴权、轮询、失败保留等断言全部保持。issues-from-probe 的 issue 六键和 probe-evidence 断言不变。config.path 与实际配置路径精确相等，再对只删除该 path 的副本保留原全响应脱敏正则。cw-discover-* 等实际目录哨兵按同一规则处理；问题 HTML 的原脱敏断言原样保留。无历史的 unknown fallback 继续按旧语义验收，不为七键正常快照要求改写范围外 fallback。

完整门禁命令（供实现完成后的下游执行）：

```pwsh
$ErrorActionPreference = 'Stop'
pwsh -NoProfile -File scripts/check-fast.ps1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-090 OK'
```

期望输出：退出码 0，stdout 含 check-fast: ok 和 AC-090 OK；验收格式、既有检查器和完整测试均通过。不得注入替代检查目录/最终测试脚本，不以 filtered run 代替完整检查；出现范围外既有失败须报告，不能修改范围外脚本、追踪、索引或契约迎合结果。运行产物沿用现有系统临时目录配置，不在仓库添加报告。本命令独立运行，不依赖前两条命令生成文件。

格式自检命令（设计轮执行）：

```pwsh
$ErrorActionPreference = 'Stop'
node scripts/check-acceptance.mjs .collab/tasks/047/acceptance.md
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-090 OK'
```

期望输出：退出码 0，stdout 含 acs=1 commands=4、warnings=0、check-acceptance: ok 和 AC-090 OK。该命令只证明格式可解析，不代表尚未实现的产品功能或回归通过。设计轮不运行会生成其他文件的产品测试、完整门禁或 git。
