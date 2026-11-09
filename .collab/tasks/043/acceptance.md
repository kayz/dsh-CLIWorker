# Task 043 — AC-077 问题优先页接真实 CLI 问题源

所有命令在仓库根、PowerShell 7 中独立执行。每个 pwsh 块是一条完整命令，原生命令失败时立即非零退出，不打印成功哨兵。多步骤验收由调度器将块内容作为其已有临时 ps1 执行，不在仓库新增脚本。设计轮仅执行最后的格式自检；其余命令供获准实施验收的阶段执行。

七项裁决及本轮 index.js 窄授权均已纳入 design.md 的 write_scope。lib/index.js 只允许在既有 snapshotFailure 的 unknown fallback 对象添加字面量 issues: []，原五字段与其他逻辑不变；快照失败不生成 per-CLI 错误条目。此前 attention 的阻塞已解除，不需重复确认或修改历史 attention 文件。

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

期望输出：退出码 0，stdout 含 `AC-086 OK`。指定文件必须存在且实际执行行为断言，不得空测试、skip/todo/only 或以预制问题 handler 代替生产链路。每次测试独立建立状态与时钟；涉及 secrets 使用已有 seam 的受控 env/session/keychain 后端，不读取真实用户秘密。该文件承担以下可观察结果检查：

- 生产 discover/models probe 的持久证据经真实 snapshot API 返回；响应顶层精确为 at、forecast、issues、last_error、models、source 六键，旧五项的值与原语义保持。issues 始终为数组；每项精确为 at、detail、evidence_ref、id、kind、subject 六键，值均为字符串，kind 仅为 unavailable/version-mismatch/missing-credential，at 是有效 ISO 时间，subject 等于实际 CLI key，evidence_ref 能在测试实际写出的 probe/discover 状态中定位记录。
- 实际三类版本预检失败 command missing、non-zero exit、unparsable output 分别只得到 unavailable，detail 包含真实 reason；不出现 version-mismatch。有效版本加真实调用 timeout/unavailable 形成实际不可用问题。仅 unknown/unverified、null version、缺文件、空记录或只有配置而没有可引用观察不产生失败条目；损坏缓存不被当作成功空结果。
- 使用隔离的 CLI 规则声明 minVersion 与真实观察版本检验 version-mismatch：严格低于时产生一条且 detail 同时包含准确 observed 与 minVersion，evidence_ref 指向该观察；相等、较高、无 minVersion、缺失/无法解析版本时均不产生该种类。比较覆盖多位 minor/patch、预发布优先级和 build metadata 不影响优先级；测试版本值只为夹具，不能成为未经声明的生产最低版本。至少一组隔离规则通过实际 snapshot 入口验证接线，直接投影测试不能替代它。
- 有可引用观察记录、模型 provider 和显式 secrets 引用，且既有 seam 正常返回缺失时，产生 missing-credential；同一条件引用存在时不产生。无 secret 配置、无 provider、仅认证被拒均不产生该种类；无配置时不得调用默认 keychain 回退。后端异常不冒充秘密缺失，按失败/stale 处理。分别覆盖 env、session 和受控 keychain 的缺失/存在与后端错误，绝不依赖真实账号。
- 相同证据重复读取时 id 及条目数量稳定，不增加 count 等额外字段；同 provider 的凭据事实不因多个模型重复，不同 CLI 不误合并。新成功探测、满足最低版本或补齐所引用秘密后，对应问题消失；其余独立问题仍保留。
- 实际 startApp 经 session 和真实 snapshot API 渲染问题，逐项核对 id/kind/subject/detail/evidence_ref/at 的对应 DOM 属性或文本，所有问题来自响应；issues: [] 时无问题文章且明确展示“暂无有证据的问题”。无探测来源仍保留真实来源未接入提示；有证据时如实显示已接入。生产响应与页面均不出现旧 task-a/model-a/provider-a 静态样例。
- 受控时钟前进 15000ms 后读到变化，读取失败保留上次真实条目并标 stale/unknown，成功空结果清除旧条目。GET 不执行 CLI 探测、不写业务状态、不访问网络；使用 keychain 的受控本机 secrets 后端读取单独计数，不能误当探测执行，也不能禁掉它伪造凭据存在性。秘密、secret 引用私密名称、用户名、绝对路径哨兵不出现在响应或页面，公开 CLI 标识仍可读，HTML 安全转义。

回归门禁命令：

```pwsh
$ErrorActionPreference = 'Stop'
node --test "test/unit/*.test.mjs"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node --test test/integration/ui-snapshot.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-086 OK'
```

期望输出：退出码 0，stdout 含 `AC-086 OK`，全 unit 与既有 UI 集成无失败。旧问题组件合并、过滤、未闭环保留和证据链接限制继续成立，新六字段问题不附加旧字段。模型快照、鉴权、模型证据脱敏、轮询和失败保留的所有既有断言仍成立。

授权的旧 UI 测试只扩展 issues：在除 issues 外的其余字段上保留五键精确检查及原有字段值检查，另加完整六键检查、issues 数组及六字段条目检查，不退化为包含检查。原无证据场景的来源未接入断言继续成立，同时新增显式空状态断言；不能删改旧断言去掩盖接线错误。正常、失败保留旧快照及无历史坏缓存的 unknown 响应均有 issues；fallback 原有 source='unknown'、last_error='E_CONFIG' 等断言原样保留并通过，新断言要求 issues 精确为 []，不能含快照错误详情。既有失败保留场景中的原模型值、原观测时间及 last_error 检查保持。

按用户指定顺序，在完成上述集成后执行回归块中的全 unit 命令，再依次执行下面三条命令；各块独立判定结果，不依赖其他块生成的临时文件。

AC-086 标准 runner 命令：

```pwsh
$ErrorActionPreference = 'Stop'
node scripts/run-tests.mjs --ac AC-086
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-086 OK'
```

期望输出：退出码 0，stdout 含 `AC-086 OK`；标准 runner 找到并实际执行 AC-086 对应测试，运行结果无失败，不能以未发现用例、空测试或 skip/todo 替代覆盖。此命令生成的报告由获准的下游验收环境管理，不由 design 轮生成。

完整检查命令：

```pwsh
$ErrorActionPreference = 'Stop'
node scripts/check-fast.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-086 OK'
```

期望输出：退出码 0，stdout 含 `check-fast: ok` 和 `AC-086 OK`；格式、现有检查器和最终测试全部通过。不得注入替代检查目录或测试脚本绕过真实门禁。check-fast.ps1 转发至同一脚本，本次按用户明确要求直接执行 mjs，不重复运行包装。

追踪检查命令：

```pwsh
$ErrorActionPreference = 'Stop'
node scripts/check-traceability.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-086 OK'
```

期望输出：退出码 0，stdout 含 `check-traceability: ok` 和 `AC-086 OK`，现有索引与追踪关系通过检查。若失败须如实报告，不能修改范围外索引、追踪分片或检查器迎合结果。全部功能及门禁通过后，下游依用户授权提交到 task/043；本设计轮不执行 git，也不将提交要求转换为额外产品验收编号。

格式自检命令：

```pwsh
$ErrorActionPreference = 'Stop'
node scripts/check-acceptance.mjs .collab/tasks/043/acceptance.md
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Output 'AC-086 OK'
```

期望输出：退出码 0，stdout 含 `acs=1 commands=7`、`warnings=0` 和 `AC-086 OK`。这只证明格式可供 runner 解析，不证明功能、回归或 unknown 兜底路径通过。设计阶段仅执行此格式自检及无落盘文档核对；指定产品检查与提交由下游实施阶段完成并记录真实结果，不豁免任何失败。
