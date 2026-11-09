# Task 039 验收标准

从仓库根执行，使用 PowerShell 7。每个 pwsh 代码块为一个独立验收脚本；交由 runner 执行，手动运行时保存为仓库外 UTF-8 无 BOM 的 .ps1 后用 pwsh -NoProfile -File 执行。命令任一断言失败或原生命令退出非零即失败，只在成功后输出哨兵。brief 未指定基准 commit 或既有验收报告。

## AC-082 flow 真实执行 discover 并验证 inventory 同源

```pwsh
@'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createFlow, discoverSteps, runFlow, STEP_ORDER } from './test/helpers/flow.mjs'
const expected = fs.readdirSync('test/flows/steps', { withFileTypes: true })
  .filter(e => e.isFile() && e.name.endsWith('.mjs') && !e.name.endsWith('.test.mjs'))
  .map(e => e.name.slice(0, -4)).sort()
const steps = await discoverSteps()
assert.deepEqual(steps.map(s => s.name).sort(), expected)
for (const name of STEP_ORDER) assert.ok(expected.includes(name), `missing required step: ${name}`)
for (const s of steps) {
  assert.equal(s.name, path.basename(s.file, '.mjs'))
  assert.match(s.mod.introduced_by, /^T-\d{3}$/)
}
const flow = createFlow()
const original = fs.readFileSync(flow.config_path, 'utf8')
try {
  const report = await runFlow({ flow })
  assert.deepEqual(report.results.map(s => s.name).sort(), expected)
  assert.equal(report.results.find(s => s.name === 'discover')?.ok, true)
  assert.equal(report.ok, true, JSON.stringify(report.results))
  assert.equal(report.leak.ok, true)
  const bin = path.resolve('bin/cliworker.mjs')
  const calls = flow.captured.argv.map((argv, i) => ({ argv, stdout: flow.captured.stdout[i] }))
    .filter(c => c.argv[0] === process.execPath && c.argv[1] === bin && c.argv[2] === 'discover')
  assert.ok(calls.length > 0, 'no real discover CLI call')
  const call = calls.at(-1)
  const flag = call.argv.indexOf('--config')
  assert.ok(flag >= 0, 'discover must use its own config')
  const configFile = path.resolve(call.argv[flag + 1])
  const relative = path.relative(flow.root, configFile)
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative))
  assert.notEqual(configFile, flow.config_path)
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  assert.equal(config.schema, 'cliworker.config/v2')
  assert.equal(path.resolve(path.dirname(configFile), config.state_dir), flow.state_dir)
  const output = JSON.parse(call.stdout)
  const inventory = JSON.parse(fs.readFileSync(path.join(flow.state_dir, 'inventory.json'), 'utf8'))
  assert.equal(output.schema, 'cliworker.inventory/v1')
  assert.ok(Array.isArray(output.entries))
  assert.equal(typeof output.generated_at, 'string')
  assert.ok(output.generated_at.length > 0 && Number.isFinite(Date.parse(output.generated_at)))
  assert.equal(inventory.schema, 'cliworker.inventory/v1')
  assert.ok(Array.isArray(inventory.entries))
  assert.equal(inventory.generated_at, output.generated_at)
  assert.deepEqual(inventory, output)
  assert.equal(fs.readFileSync(flow.config_path, 'utf8'), original)
} finally {
  flow.cleanup()
}
assert.equal(fs.existsSync(flow.root), false)
console.log('AC-082 OK')
'@ | node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'AC-082 flow behavior failed' }
```

- 期望输出：退出码 0，stdout 含 `AC-082 OK`。磁盘步骤集合与发现、执行集合一致，必需步骤存在，discover 成功执行真实 CLI，v2 配置位于 flow.root，inventory 与 stdout 全量相等且 generated_at 一致，共享配置未改变，临时目录已清理。

```pwsh
node --test test/flows/flow.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'AC-082 flow tests failed' }
Write-Output 'AC-082 OK'
```

- 期望输出：退出码 0，测试全部通过，stdout 含 `AC-082 OK`。

```pwsh
node --test test/integration/flow-complete.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'AC-082 complete flow regression failed' }
Write-Output 'AC-082 OK'
```

- 期望输出：退出码 0，完整 flow 及既有 sentinel/泄漏不变量通过，stdout 含 `AC-082 OK`。

```pwsh
node scripts/run-tests.mjs --ac AC-082
if ($LASTEXITCODE -ne 0) { throw 'AC-082 targeted run failed' }
Write-Output 'AC-082 OK'
```

- 期望输出：退出码 0，stdout 含 `run-tests: filtered` 和 `AC-082 OK`；不得出现 `FAIL run.no_match AC-082`。

```pwsh
node scripts/check-fast.mjs
if ($LASTEXITCODE -ne 0) { throw 'AC-082 check-fast failed' }
Write-Output 'AC-082 OK'
```

- 期望输出：退出码 0，stdout 含 `check-fast: ok` 和 `AC-082 OK`。完成前也可使用等价入口 pwsh -NoProfile -File scripts/check-fast.ps1；不得修改合约哈希以掩盖门禁失败。

## AC-006 既有单元测试不得被破坏

```pwsh
node --test "test/unit/*.test.mjs"
if ($LASTEXITCODE -ne 0) { throw 'AC-006 unit regression failed' }
Write-Output 'AC-006 OK'
```

- 期望输出：退出码 0，全部既有单元测试通过，stdout 含 `AC-006 OK`。
