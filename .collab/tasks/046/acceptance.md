# Task 046 — 客户端接入 DSH 左栏与主区

下列命令均从仓库根独立执行，使用 Node.js 20+ 与 PowerShell 7。每个 pwsh 块是一条完整验收命令；多步骤块由执行器保存为系统临时 .ps1 后以 pwsh -NoProfile -File 执行，不在仓库新增脚本。原生命令后检查退出码；成功才输出独立行 AC-089 OK，失败非零退出。不得使用跳过或占位测试取得成功哨兵。

依据同目录 design.md。brief 未提供基准 commit SHA 或既有验收报告路径；T-024/T-025 的回归路径来自当前 test/traceability/T-024.json 和 test/traceability/T-025.json，不将这些索引当作既有验收报告。

## AC-089 客户端清单、左栏与主区注册及真实路由数据展示

清单、图标与 loader 注册契约命令：

```pwsh
$ErrorActionPreference = 'Stop'
$contract = @'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const plugin = JSON.parse(fs.readFileSync('dsh.plugin.json', 'utf8'))
assert.equal(plugin.client.platform, 'web')
assert.equal(pkg.dsh.client.platform, 'web')
assert.equal(pkg.exports['./client'], './lib/client.js')
assert.equal(pkg.exports['./icon'], './icon.svg')
assert.ok(pkg.files.includes('icon.svg'))
for (const file of ['lib/client.js', 'icon.svg']) {
  assert.ok(fs.statSync(file).isFile())
  assert.ok(fs.readFileSync(file).length > 0)
}
const loads = [], log = []
const React = { createElement: (type, props, ...children) => ({ type, props, children }), Component: class {}, Fragment: Symbol('Fragment') }
const sandbox = {
  window: { __ModuleLoader__: { load: entry => loads.push(entry) } },
  console: Object.fromEntries(['log', 'warn', 'error', 'info', 'debug'].map(key => [key, (...args) => log.push(args)])),
}
vm.runInNewContext(fs.readFileSync('lib/client.js', 'utf8'), sandbox, { filename: 'lib/client.js' })
assert.equal(loads.length, 1)
assert.equal(loads[0].id, 'dsh-cliworker')
const client = loads[0].factory(id => { assert.equal(id, 'react'); return React })
assert.equal(typeof client.apply, 'function')
assert.deepEqual(Array.from(client.inject), ['slots'])
assert.equal(client.name, 'dsh-cliworker')
for (const ctx of [undefined, null, {}, { slots: {} }, { slots: { inject() {} } }]) {
  assert.doesNotThrow(() => client.apply(ctx))
}
assert.doesNotThrow(() => client.apply({ get slots() { throw new Error('unavailable') } }))
const callbacks = [], registered = []
client.apply({ slots: { inject: (name, callback) => callbacks.push({ name, callback }), register: (meta, component) => registered.push({ meta, component }) } })
assert.deepEqual(callbacks.map(item => item.name), ['sidebar.panellist', 'main'])
assert.equal(registered.length, 0)
for (const item of callbacks) assert.doesNotThrow(item.callback)
assert.equal(registered.length, 2)
assert.equal(registered[0].meta.name, 'sidebar.panellist')
assert.equal(registered[0].meta.id, 'cliworker')
assert.equal(registered[0].meta.order, 30)
assert.equal(registered[0].meta.label, 'CLIWorker')
assert.equal(registered[1].meta.name, 'main')
assert.equal(registered[1].meta.key, 'cliworker')
assert.ok(registered.every(item => typeof item.component === 'function'))
for (const failed of ['sidebar.panellist', 'main']) {
  const delayed = [], survivors = []
  client.apply({ slots: {
    inject: (name, callback) => delayed.push(callback),
    register: meta => { if (meta.name === failed) throw new Error('unsupported slot'); survivors.push(meta.name) },
  } })
  for (const callback of delayed) assert.doesNotThrow(callback)
  assert.deepEqual(survivors, [failed === 'main' ? 'sidebar.panellist' : 'main'])
}
assert.equal(log.length, 0)
console.log('client contract: ok')
'@
$output = @($contract | node --input-type=module -)
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not ($output -contains 'client contract: ok')) { throw 'Client contract did not finish' }
[xml]$icon = Get-Content -Raw -Encoding utf8 icon.svg
$root = $icon.DocumentElement
if ($root.LocalName -ne 'svg' -or $root.NamespaceURI -ne 'http://www.w3.org/2000/svg') { throw 'Invalid SVG root' }
if ($root.GetAttribute('viewBox') -ne '0 0 24 24') { throw 'Invalid icon viewport' }
if ($icon.SelectNodes("//*[local-name()='script' or local-name()='image' or local-name()='foreignObject']").Count -ne 0) { throw 'Icon contains non-vector content' }
$colors = @($icon.SelectNodes('//@fill | //@stroke | //@color') | ForEach-Object { $_.Value })
if (-not ($colors -contains 'currentColor')) { throw 'Icon must inherit currentColor' }
if (@($colors | Where-Object { $_ -notin @('none', 'currentColor') }).Count -ne 0) { throw 'Icon must be monochrome' }
$release = Get-Content -Raw -Encoding utf8 docs/release-checklist.md
if ($release -notmatch 'CLIWorker' -or $release -notmatch 'client-manifest\.test\.mjs') { throw 'Missing client release instructions' }
$output | Write-Output
Write-Output 'AC-089 OK'
```

期望输出：退出码 0，stdout 包含 client contract: ok 和 AC-089 OK。两份清单均声明 web，导出目标存在，icon.svg 为单色 24×24 SVG，发布文档包含客户端测试入口；真实客户端脚本执行一次 load，factory 返回 apply/inject/name，apply 容忍缺失服务，正常注册左栏 cliworker/CLIWorker 与主区 cliworker；延迟回调的任一 register 失败仍不抛错且不阻止另一 slot，不打印注册错误。此命令不依赖真实 DSH，不启动网络或 CLI。

新增 unit 与浏览器行为契约命令：

```pwsh
$ErrorActionPreference = 'Stop'
$output = @(node --test --test-reporter=tap test/unit/client-manifest.test.mjs)
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$tap = $output -join [Environment]::NewLine
if ($tap -notmatch '(?m)^# tests ([8-9]|[1-9][0-9]+)\s*$') { throw 'Expected at least eight executed client tests' }
foreach ($summary in @('# fail 0', '# cancelled 0', '# skipped 0', '# todo 0')) {
  if (-not ($output -contains $summary)) { throw "Missing TAP summary: $summary" }
}
foreach ($name in @('manifest and icon', 'loader exports and slots', 'missing slots', 'registration failure isolation', 'deferred registration failure isolation', 'session and snapshot rendering', 'errors and retry', 'empty stale and unmount')) {
  $pattern = '(?m)^ok [0-9]+ - \[AC-089\] ' + [regex]::Escape($name) + '(?:\s|$)'
  if ($tap -notmatch $pattern) { throw "Missing successful client test: $name" }
}
$output | Write-Output
Write-Output 'AC-089 OK'
```

期望输出：退出码 0，TAP 至少八个实际用例，fail/cancelled/skipped/todo 均为 0，包含八个列出的成功测试，最后输出 AC-089 OK。按 design.md 约定，八个名称直接接在 [AC-089] 后，可追加描述。测试必须执行真实 loader factory 和注册捕获的 Page/SidebarIcon；实际离线 npm pack dry-run 清单含 lib/client.js、icon.svg、dsh.plugin.json、package.json；缺 slots、同步及延迟注册异常均隔离。Page 首次先请求 session，再携带 x-cliworker-session 请求 snapshot，只发送 GET；无 ok 字段的正常 snapshot 能展示模型、余量、问题及来源时间，刷新显示新响应。网络、HTTP、JSON、非法响应都有可见错误与重试；E_ADMIN_REQUIRED 只允许一次会话重建及读取重试。失败保留旧数据并标 stale，恢复后清错；空态、unknown/0/false/assumed、过期观测、last_error、并发抑制及卸载清理均有可观察断言，服务端字符串是文本，界面不包含会话或 CSRF。仅检查源码字符串或仅返回固定 fixture 的 helper 不满足该验收。

既有 T-024/T-025 回归命令：

```pwsh
$ErrorActionPreference = 'Stop'
$files = @(
  'test/integration/registration.test.mjs',
  'test/integration/plugin-routes.test.mjs',
  'test/integration/plugin-session.test.mjs',
  'test/integration/plugin-guard.test.mjs',
  'test/integration/ui-snapshot.test.mjs',
  'test/unit/ui-render.test.mjs'
)
foreach ($file in $files) {
  $output = @(node --test --test-reporter=tap $file)
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  if (($output -join [Environment]::NewLine) -notmatch '(?m)^# tests [1-9][0-9]*\s*$') { throw "No executed tests in $file" }
  foreach ($summary in @('# fail 0', '# cancelled 0', '# skipped 0', '# todo 0')) {
    if (-not ($output -contains $summary)) { throw ('Missing TAP summary in ' + $file + ': ' + $summary) }
  }
  $output | Write-Output
}
Write-Output 'AC-089 OK'
```

期望输出：六个测试文件各自退出码 0，各有实际测试，fail/cancelled/skipped/todo 均为 0，最终输出 AC-089 OK。既有精确路由注册、会话自举、会话/CSRF 守卫、snapshot 数据投影及旧 UI 渲染继续通过；lib/index.js、lib/http/** 与 ui/** 无需修改。此命令只验证宿主回归，不替代上一条对新 Page 的行为验证。

完整门禁命令（下游实施/验收阶段执行）：

```pwsh
$ErrorActionPreference = 'Stop'
$output = @(pwsh -NoProfile -File scripts/check-fast.ps1)
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not ($output -contains 'check-fast: ok')) { throw 'Missing check-fast success output' }
$output | Write-Output
Write-Output 'AC-089 OK'
```

期望输出：退出码 0，stdout 包含 check-fast: ok 与 AC-089 OK，完整现有门禁和测试继续通过。新增客户端直接加载，无构建步骤或新增依赖；原包资产与发布检查继续有效。docs/release-checklist.md 保留原发布要求，追加重新加载 DSH、观察左栏图标、点击主区、检查实际数据/空态与错误恢复的步骤，并区分自动化契约与真实 GUI 观察。完整门禁失败须报告实际诊断，不能改写写域外文件或放宽断言取得通过。

验收格式自检命令：

```pwsh
$ErrorActionPreference = 'Stop'
$output = @(node scripts/check-acceptance.mjs .collab/tasks/046/acceptance.md)
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (($output -join [Environment]::NewLine) -notmatch 'check-acceptance: ok .*warnings=0') { throw 'Acceptance format failed or has warnings' }
$output | Write-Output
Write-Output 'AC-089 OK'
```

期望输出：退出码 0，stdout 含 check-acceptance: ok、warnings=0 和 AC-089 OK，解析到一个 AC、五条命令。格式通过只证明文档可执行，不代表实现或真实 DSH 验收通过。设计角色本轮仅执行此格式自检与只读文档检查；完整门禁可能间接执行 git 或创建测试产物，受本轮角色限制不执行。
