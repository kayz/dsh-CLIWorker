# Task 043 — AC-077 问题优先页接真实 CLI 问题源

所有命令在仓库根、PowerShell 7 中独立执行。每个 pwsh 块是一条完整命令，原生命令失败时立即非零退出，不打印成功哨兵。多步骤验收由调度器将块内容作为其已有临时 ps1 执行，不在仓库新增脚本。设计轮仅执行最后的格式自检；其余命令供获准实施验收的阶段执行。

当前 attention.json 请求明确 API 字段、必要旧测试写域及“版本不符”判据；这几项未裁决前不能声称本文件是完整可实施的最终验收，也不能用下面任一命令的局部通过关闭任务。裁决后先同步 design.md 与本文件，再实施与验收。

brief 未提供基准 commit SHA 或既有验收报告。T-042 状态文件记录 merged 和提交 `b5a39615fbec2900df573807b62c7bf545c9c253`，仅用于依赖溯源；历史 `.collab/tasks/042/impl.md` 与 `.collab/tasks/042/ci-results.json` 不代表本任务通过，不覆盖新一轮测试结果。

## AC-086 真实探测问题投影、API 与 UI 一致及回归

依赖检查命令：

```pwsh
$ErrorActionPreference = 'Stop'
@'
import fs from 'node:fs'
import assert from 'node:assert/strict'
const s = JSON.parse(fs.readFileSync('.collab/tasks/042/state.json', 'utf8'))
assert.equal(s.status, 'merged', 'T-042 must be merged')
for (const p of ['lib/discovery/probe.mjs', 'test/integration/discovery-probe.test.mjs']) {
  assert.ok(fs.existsSync(p), p)
}
'@ | node --input-type=module
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node --test test/integration/discovery-probe.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-086 OK'
```

期望输出：退出码 0，stdout 含 `AC-086 OK`。T-042 状态为 merged，真实探测文件存在，既有探测集成测试全部通过。依赖不存在、未合并或测试失败必须非零退出，不能自造证据绕过。此命令仅证明依赖可用。

功能验收命令：

```pwsh
$ErrorActionPreference = 'Stop'
node --test test/integration/issues-from-probe.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-086 OK'
```

期望输出：退出码 0，stdout 含 `AC-086 OK`。指定文件必须存在且实际执行行为断言，不得空测试、skip/todo/only 或以预制问题 handler 代替生产链路。该文件承担以下可观察结果检查：

- 生产 discover/models probe 生成的持久证据经过真实管理 HTTP API 得到获准分类的问题；不可用、认证失败与裁决明确的版本分支分别精确核对事实、分类、时间及安全展示字段。API 的具体问题响应字段与版本比较期望须在 attention 裁决后补全到本文件；不得提前发明。
- 无证据文件、空记录、仅有配置的模型、成功版本或成功调用不产生失败条目；缺少证据、未知认证及 version=null 均不能单独生成故障。坏缓存/读取失败不被报告为一次成功的空结果。
- 相同证据被多次读取时条目及 count 稳定，不同模型/provider 不误合并；新一次成功探测消除对应旧失败。认证问题不声称已确定“凭据不存在”，除非真实证据确实支持该结论。
- 实际 startApp 经 session 和真实 snapshot API 渲染问题，各显示值与本次 API 返回值一致；API 空结果时页面无问题文章。生产 API 与页面均不出现旧静态 task-a/model-a/provider-a 样例。UI 不从 fixture、模型名称或默认值补问题。
- 受控时钟前进 15000ms 后读到变化，读取失败保留上次真实条目并标 stale/unknown；GET 不执行 CLI、不写状态、不访问真实网络。秘密、用户名、绝对路径哨兵不出现在响应或页面，公开模型/provider 标识仍保留，HTML 文本安全转义。

回归门禁命令：

```pwsh
$ErrorActionPreference = 'Stop'
node --test "test/unit/*.test.mjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node --test test/integration/ui-snapshot.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-086 OK'
```

期望输出：退出码 0，stdout 含 `AC-086 OK`，全 unit 与既有 UI 集成无失败。问题组件的合并、过滤、未闭环保留、证据链接限制，以及模型快照、鉴权、轮询和失败保留行为继续成立。旧 UI 集成当前固定五个 snapshot 字段及未接入提示，与新增问题接口冲突；该冲突必须经过 attention 裁决取得必要写域后用精确的新断言解决，不能忽略失败、删除断言或伪装未接入。

格式自检命令：

```pwsh
$ErrorActionPreference = 'Stop'
node scripts/check-acceptance.mjs .collab/tasks/043/acceptance.md
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-086 OK'
```

期望输出：退出码 0，stdout 含 `acs=1 commands=4`、`warnings=0` 和 `AC-086 OK`。这只证明格式可供 runner 解析，不证明功能、回归或待决接口通过。
