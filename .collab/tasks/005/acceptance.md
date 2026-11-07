# Task 005 验收标准

规格来源：同目录 `design.md`（实现必须逐字照写其中的码名、路径、测试标题和输出字段）与 `brief.md`。brief 没有给基准 commit。实现前在本工作区执行 `node scripts/check-traceability.mjs` 的输出是 `check-traceability: ok (covered=14 planned=60)`；T-005 把 AC-012、AC-013、AC-014 标成 covered 之后应为 `covered=17 planned=57`。

继承：保留候选 #1 的 `design.md` 正文（§1–§13）和本文件 AC-012 A-1 至 AC-014 C-1 的命令。那些命令已经按当时的默认选项 A 验收路径、配置错误和 gitignore。人工已确认选项 A，与该默认一致，所以这些命令保持原样，只改本段说明，并新增 AC-013 E-1。确认后的规则：`write_scope` 含 `lib/cli.mjs`；`paths` 与 `init` 不先调用 `loadConfig`；配置错误向 stdout 写 `{ok:false,error:{code,message,retryable,retry_after}}`，退出码 3；通用错误体仍属 T-008；`bin/cliworker.mjs` 与 `lib/commands/_util.mjs` 不改。doctor 命令属 T-024，本任务只验收 `legacyUsageWarnings` 与 `paths` 结果里的 `W_LEGACY_USAGE`。brief 没有给基准 commit，也没有既有验收报告路径。

执行约定：

- 环境为 PowerShell 7（pwsh），工作目录是仓库根。
- 每个 `## AC-…` 小节是一条独立检查。命令自包含，不依赖其它小节的变量。
- 通过判定：进程退出码 0，且输出最后一行是该小节的 `AC-012 OK`、`AC-013 OK` 或 `AC-014 OK`。
- 行为命令把脚本写到临时 `.mjs` 再执行，避免引号被 pwsh 拆开。脚本抛错则退出码非 0，且不会打印 OK。
- brief 的四条验收方向分别落在 AC-012 A-1、AC-013 A-1、AC-014 A-1 和 AC-012 D-1。

## AC-012 A-1 测试入口

```powershell
$o = (node scripts/run-tests.mjs --ac AC-012 2>&1 | Out-String); if ($LASTEXITCODE -ne 0) { throw "run-tests exited $LASTEXITCODE" }; if ($o -notmatch 'run-tests: filtered 3 files, manifest ') { throw 'file count' }; if ($o.Contains([string][char]0x2716)) { throw 'output contains the failure mark' }; Write-Output 'AC-012 OK'
```

- 期望: 退出码 0，输出含 `run-tests: filtered 3 files, manifest `，且没有失败标记。三份文件是 design §11 的 `test/unit/paths.test.mjs`、`test/integration/paths-entries.test.mjs`、`test/characterization/defects/a4-paths.test.mjs`。
- 期望: 最后一行是 `AC-012 OK`。

## AC-012 B-1 测试标题与 a4-paths 的 repro 哈希

```powershell
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ((New-Guid).Guid + '.mjs')
$code = @'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { reproSha256 } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/scripts/check-defects.mjs'

const groups = {
  'test/unit/paths.test.mjs': [
    '[AC-012] resolvePaths takes configPath from the argument, then CLIWORKER_CONFIG, then CLIWORKER_HOME/config.json',
    '[AC-012] resolvePaths derives state_dir from CLIWORKER_HOME/state/<sha256 prefix 12> of the config path',
    '[AC-012] resolvePaths lower-cases the config path before hashing on win32',
    '[AC-012] resolvePaths resolves a relative explicit stateDir against the config file directory',
    '[AC-012] two different config paths get disjoint state_dir values',
    '[AC-012] legacyUsageWarnings reports W_LEGACY_USAGE only when the legacy usage file exists',
  ],
  'test/integration/paths-entries.test.mjs': [
    '[AC-012] cliworker paths --config X reports the same config and state_dir as resolvePaths',
    '[AC-012] createPlugin with configPath X reads the same config file that paths reports',
    '[AC-012] usage record writes under the state_dir that paths reports',
    '[AC-012] paths reports W_LEGACY_USAGE in warnings when the legacy usage file exists',
  ],
  'test/characterization/defects/a4-paths.test.mjs': [
    '[repro] [AC-005] config home ignores the directory of the config file',
    '[fixed] [AC-012] live loadConfig gives two config files disjoint state directories',
  ],
}
for (const [file, titles] of Object.entries(groups)) {
  const source = fs.readFileSync(file, 'utf8')
  for (const title of titles) assert.ok(source.includes(title), file + ' missing ' + title)
}
const ledger = JSON.parse(fs.readFileSync('test/characterization/defects.json', 'utf8'))
const defect = ledger.defects.find((item) => item.id === 'a4-paths')
const repro = fs.readFileSync('test/characterization/defects/a4-paths.test.mjs', 'utf8')
assert.equal(reproSha256(repro), defect.repro_sha256)
console.log('AC-012 OK')
'@
[System.IO.File]::WriteAllText($tmp, $code, (New-Object System.Text.UTF8Encoding $false))
& node $tmp
$e = $LASTEXITCODE
Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
if ($e -ne 0) { exit $e }
```

- 期望: design §11 的 AC-012 标题都在指定文件里；`[repro]` 块的 sha256 仍等于 `defects.json` 里 `a4-paths` 的 `repro_sha256`。
- 期望: 最后一行是 `AC-012 OK`。

## AC-012 C-1 resolvePaths 与 legacyUsageWarnings

```powershell
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ((New-Guid).Guid + '.mjs')
$code = @'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { resolvePaths, legacyUsageWarnings, bundledExamplePath } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/lib/paths.mjs'
import { createFakeContext } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/test/helpers/ctx.mjs'

function hash12(configPath, platform) {
  const key = platform === 'win32' ? configPath.toLowerCase() : configPath
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 12)
}

const cwd = '/work'
const homedir = '/users/someone'
const envHome = { CLIWORKER_HOME: '/data/home', CLIWORKER_CONFIG: '/data/from-env.json' }
const byArg = resolvePaths({ configPath: 'rel/cfg.json', env: envHome, platform: 'linux', cwd, homedir })
assert.equal(byArg.home, path.posix.resolve(cwd, '/data/home'))
assert.equal(byArg.config, path.posix.resolve(cwd, 'rel/cfg.json'))
const byEnv = resolvePaths({ env: envHome, platform: 'linux', cwd, homedir })
assert.equal(byEnv.config, path.posix.resolve(cwd, '/data/from-env.json'))
const emptyArg = resolvePaths({ configPath: '', env: envHome, platform: 'linux', cwd, homedir })
assert.equal(emptyArg.config, byEnv.config)
const blankEnvConfig = resolvePaths({ env: { CLIWORKER_HOME: '/data/home', CLIWORKER_CONFIG: '' }, platform: 'linux', cwd, homedir })
const homeOnly = resolvePaths({ env: { CLIWORKER_HOME: '/data/home' }, platform: 'linux', cwd, homedir })
assert.equal(blankEnvConfig.config, homeOnly.config)
const byDefault = resolvePaths({ env: {}, platform: 'linux', cwd, homedir })
const home = path.posix.resolve(cwd, path.posix.join(homedir, '.cliworker'))
assert.equal(byDefault.home, home)
const config = path.posix.resolve(cwd, path.posix.join(home, 'config.json'))
assert.equal(byDefault.config, config)
const prefix = hash12(byDefault.config, 'linux')
assert.equal(prefix.length, 12)
assert.equal(/[^0-9a-f]/.test(prefix), false)
assert.equal(byDefault.state_dir, path.posix.join(home, 'state', prefix))

const saved = process.env.CLIWORKER_HOME
process.env.CLIWORKER_HOME = '/should-not-use'
try {
  const isolated = resolvePaths({ env: {}, platform: 'linux', cwd, homedir: '/u' })
  assert.equal(isolated.home.includes('should-not-use'), false)
} finally {
  if (saved === undefined) delete process.env.CLIWORKER_HOME
  else process.env.CLIWORKER_HOME = saved
}

const w1 = resolvePaths({ configPath: 'C:\\A\\cfg.json', env: { CLIWORKER_HOME: 'C:\\H' }, platform: 'win32', cwd: 'C:\\work', homedir: 'C:\\Users\\x' })
const w2 = resolvePaths({ configPath: 'c:\\a\\cfg.json', env: { CLIWORKER_HOME: 'C:\\H' }, platform: 'win32', cwd: 'C:\\work', homedir: 'C:\\Users\\x' })
assert.notEqual(w1.config, w2.config)
assert.equal(w1.state_dir, w2.state_dir)
assert.equal(w1.state_dir, path.win32.join(w1.home, 'state', hash12(w1.config, 'win32')))
const l1 = resolvePaths({ configPath: '/A/cfg.json', env: { CLIWORKER_HOME: '/H' }, platform: 'linux', cwd: '/work', homedir: '/u' })
const l2 = resolvePaths({ configPath: '/a/cfg.json', env: { CLIWORKER_HOME: '/H' }, platform: 'linux', cwd: '/work', homedir: '/u' })
assert.notEqual(l1.state_dir, l2.state_dir)
assert.equal(l1.state_dir.startsWith(l2.state_dir), false)
assert.equal(l2.state_dir.startsWith(l1.state_dir), false)

const rel = resolvePaths({ configPath: '/cfg/a.json', stateDir: 'rel-state', env: {}, platform: 'linux', cwd: '/work', homedir: '/u' })
assert.equal(rel.state_dir, path.posix.resolve(path.posix.dirname(rel.config), 'rel-state'))
const abs = resolvePaths({ configPath: '/cfg/a.json', stateDir: '/var/state', env: {}, platform: 'linux', cwd: '/work', homedir: '/u' })
assert.equal(abs.state_dir, '/var/state')
const blankState = resolvePaths({ configPath: '/cfg/a.json', stateDir: '', env: {}, platform: 'linux', cwd: '/work', homedir: '/u' })
const hashed = resolvePaths({ configPath: '/cfg/a.json', env: {}, platform: 'linux', cwd: '/work', homedir: '/u' })
assert.equal(blankState.state_dir, hashed.state_dir)

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ac012-leg-'))
try {
  const who = path.join(base, 'user')
  const legacy = path.join(who, '.cliworker', 'usage.jsonl')
  const yes = legacyUsageWarnings({ ctx: createFakeContext({ files: { [legacy]: 'row' } }), homedir: who })
  assert.deepEqual(yes, [{ code: 'W_LEGACY_USAGE' }])
  const no = legacyUsageWarnings({ ctx: createFakeContext({ files: {} }), homedir: who })
  assert.deepEqual(no, [])
} finally {
  fs.rmSync(base, { recursive: true, force: true })
}

assert.equal(fs.realpathSync(bundledExamplePath()), fs.realpathSync('config/cliworker.example.json'))
console.log('AC-012 OK')
'@
[System.IO.File]::WriteAllText($tmp, $code, (New-Object System.Text.UTF8Encoding $false))
& node $tmp
$e = $LASTEXITCODE
Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
if ($e -ne 0) { exit $e }
```

- 期望: `config` 的取值顺序是参数、`CLIWORKER_CONFIG`、`<home>/config.json`，空字符串跳过；`home` 只读传入的 `env`，不读 `process.env`。
- 期望: 未传 `stateDir` 时 `state_dir` 是 `<home>/state/` 加配置绝对路径的 sha256 前 12 位十六进制；win32 先把该路径转小写再哈希，linux 区分大小写。两条不同配置的 `state_dir` 互不为前缀。
- 期望: 相对 `stateDir` 相对配置文件所在目录解析，绝对 `stateDir` 规范化后原样使用，空字符串 `stateDir` 与未传相同。旧用量文件存在时返回 `[{ code: 'W_LEGACY_USAGE' }]`，否则 `[]`。
- 期望: `bundledExamplePath()` 等于仓库里 `config/cliworker.example.json` 的绝对路径。最后一行是 `AC-012 OK`。

## AC-012 D-1 paths、createPlugin、用量落点与 CLI

```powershell
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ((New-Guid).Guid + '.mjs')
$code = @'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolvePaths } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/lib/paths.mjs'
import { loadConfig } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/lib/config.mjs'
import { main } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/lib/cli.mjs'
import { createPlugin } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/lib/index.js'
import { createFakeContext } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/test/helpers/ctx.mjs'
import { createHostStub } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/test/helpers/host-stub.mjs'

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ac012-d-'))
const home = path.join(base, 'h')
const env = { CLIWORKER_HOME: home }
const body = JSON.stringify({ providers: {}, models: {} })
const f1 = path.join(base, 'a', 'config.json')
const f2 = path.join(base, 'b', 'config.json')
try {
  const ctx = createFakeContext({ files: { [f1]: body, [f2]: body }, env, platform: process.platform })
  const c1 = loadConfig({ file: f1, ctx })
  const c2 = loadConfig({ file: f2, ctx })
  assert.notEqual(c1._home, c2._home)
  assert.equal(c1._file, path.resolve(f1))
  assert.equal(c2._file, path.resolve(f2))
  assert.equal(c1._home.startsWith(path.resolve(path.dirname(f1)) + path.sep), false)
  assert.equal(c2._home.startsWith(path.resolve(path.dirname(f2)) + path.sep), false)
  assert.equal(c1._home.startsWith(c2._home), false)
  assert.equal(c2._home.startsWith(c1._home), false)

  const pctx = createFakeContext({ files: { [f1]: body }, env, platform: process.platform })
  const pointed = await main(['paths', '--config', f1], pctx)
  assert.equal(pointed.exitCode, 0)
  assert.equal(pctx.stderr.text(), '')
  const reported = JSON.parse(pctx.stdout.text())
  const expect = resolvePaths({ configPath: f1, env, platform: process.platform, cwd: process.cwd() })
  assert.equal(reported.ok, true)
  assert.equal(reported.config, expect.config)
  assert.equal(reported.state_dir, expect.state_dir)
  assert.deepEqual(reported.warnings, [])
  assert.deepEqual(Object.keys(reported), ['ok', 'config', 'state_dir', 'warnings'])
  assert.equal(pctx.stdout.text(), JSON.stringify(reported, null, 2) + '\n')
  assert.equal(c1._file, reported.config)
  assert.equal(c1._home, reported.state_dir)

  const legacy = path.join(os.homedir(), '.cliworker', 'usage.jsonl')
  const wctx = createFakeContext({ files: { [f1]: body, [legacy]: 'old' }, env, platform: process.platform })
  const warned = await main(['paths', '--config', f1], wctx)
  assert.equal(warned.exitCode, 0)
  assert.deepEqual(JSON.parse(wctx.stdout.text()).warnings, [{ code: 'W_LEGACY_USAGE' }])

  const { run } = await import('file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/lib/commands/usage/record.mjs')
  await run({ argv: ['--json', JSON.stringify({ model: 'nope' })], ctx, config: c1 })
  const usage = path.join(c1._home, 'usage.jsonl')
  assert.equal(ctx.fs.existsSync(usage), true)
  assert.ok(ctx.fs.readFileSync(usage, 'utf8').includes('nope'))
  assert.equal(usage.startsWith(c1._home + path.sep), true)

  const plugCtx = createFakeContext({ files: { [f1]: body }, env, platform: process.platform })
  const host = createHostStub()
  const created = createPlugin(host.ctx, { configPath: f1 }, { ctx: plugCtx })
  assert.equal(created.errors.length, 0)
  assert.ok(created.registered.includes('/cliworker/providers'))
  await host.request('/cliworker/providers')
  const reads = plugCtx.fs.accessed.filter((item) => item.method === 'readFileSync').map((item) => item.path)
  assert.ok(reads.includes(path.resolve(reported.config)))

  const spawnEnv = Object.assign({}, process.env, { CLIWORKER_HOME: home })
  delete spawnEnv.CLIWORKER_TEST_CLOCK_FILE
  const child = spawnSync(process.execPath, ['bin/cliworker.mjs', 'paths', '--config', 'config/cliworker.example.json'], { encoding: 'utf8', env: spawnEnv })
  assert.equal(child.status, 0, child.stderr || child.stdout)
  assert.equal(child.stderr || '', '')
  const cli = JSON.parse(child.stdout)
  const cliExpect = resolvePaths({ configPath: 'config/cliworker.example.json', env: spawnEnv, platform: process.platform, cwd: process.cwd() })
  assert.equal(cli.ok, true)
  assert.equal(cli.config, cliExpect.config)
  assert.equal(cli.config, path.resolve('config/cliworker.example.json'))
  assert.equal(cli.state_dir, cliExpect.state_dir)
  assert.deepEqual(Object.keys(cli), ['ok', 'config', 'state_dir', 'warnings'])
  const legacyOnDisk = fs.existsSync(legacy)
  const codes = cli.warnings.map((item) => item.code)
  assert.deepEqual(codes, legacyOnDisk ? ['W_LEGACY_USAGE'] : [])
} finally {
  fs.rmSync(base, { recursive: true, force: true })
}
console.log('AC-012 OK')
'@
[System.IO.File]::WriteAllText($tmp, $code, (New-Object System.Text.UTF8Encoding $false))
& node $tmp
$e = $LASTEXITCODE
Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
if ($e -ne 0) { exit $e }
```

- 期望: 两份不同配置的 `loadConfig` 结果里 `_home` 不同，且都不落在对方配置文件所在目录内。`_home` 等于 `paths` 报告的 `state_dir`，`_file` 等于报告的 `config`。
- 期望: `main(['paths', '--config', X])` 与 `resolvePaths` 给出同一对绝对路径；stdout 只有 `{ ok, config, state_dir, warnings }` 的两空格 JSON 加换行；stderr 为空；退出码 0。假文件系统里存在 `~/.cliworker/usage.jsonl` 时 `warnings` 为 `[{ code: 'W_LEGACY_USAGE' }]`。
- 期望: `usage record` 把 jsonl 写到该 `state_dir`。`createPlugin({ configPath: X })` 在处理 `/cliworker/providers` 时 `readFileSync` 的路径包含 `paths` 报告的 `config`。
- 期望: `node bin/cliworker.mjs paths --config config/cliworker.example.json` 退出码 0，stderr 为空，`config` 是该示例的绝对路径，`state_dir` 与同一环境的 `resolvePaths` 一致。真实家目录下有旧用量文件时 `warnings` 只有 `W_LEGACY_USAGE`，否则为 `[]`。
- 期望: 最后一行是 `AC-012 OK`。

## AC-012 E-1 追溯分片

```powershell
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ((New-Guid).Guid + '.mjs')
$code = @'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const shard = JSON.parse(fs.readFileSync('test/traceability/T-005.json', 'utf8'))
assert.deepEqual(shard, {
  task: 'T-005',
  milestone: 'M1',
  entries: [
    { ac: 'AC-012', status: 'covered', files: ['test/unit/paths.test.mjs', 'test/integration/paths-entries.test.mjs', 'test/characterization/defects/a4-paths.test.mjs'] },
    { ac: 'AC-013', status: 'covered', files: ['test/unit/config.test.mjs', 'test/unit/gitignore.test.mjs'] },
    { ac: 'AC-014', status: 'covered', files: ['test/unit/config.test.mjs', 'test/characterization/defects/a4-null-config.test.mjs'] },
  ],
})
const run = spawnSync(process.execPath, ['scripts/check-traceability.mjs'], { encoding: 'utf8' })
assert.equal(run.status, 0, (run.stdout || '') + (run.stderr || ''))
assert.ok((run.stdout || '').includes('check-traceability: ok (covered=17 planned=57)'))
console.log('AC-012 OK')
'@
[System.IO.File]::WriteAllText($tmp, $code, (New-Object System.Text.UTF8Encoding $false))
& node $tmp
$e = $LASTEXITCODE
Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
if ($e -ne 0) { exit $e }
```

- 期望: `test/traceability/T-005.json` 与 design §11 的对象一致，且 `check-traceability` 打印 `check-traceability: ok (covered=17 planned=57)`。
- 期望: 最后一行是 `AC-012 OK`。

## AC-013 A-1 测试入口

```powershell
$o = (node scripts/run-tests.mjs --ac AC-013 2>&1 | Out-String); if ($LASTEXITCODE -ne 0) { throw "run-tests exited $LASTEXITCODE" }; if ($o -notmatch 'run-tests: filtered 2 files, manifest ') { throw 'file count' }; if ($o.Contains([string][char]0x2716)) { throw 'output contains the failure mark' }; Write-Output 'AC-013 OK'
```

- 期望: 退出码 0，输出含 `run-tests: filtered 2 files, manifest `，且没有失败标记。两份文件是 `test/unit/config.test.mjs` 与 `test/unit/gitignore.test.mjs`。
- 期望: 最后一行是 `AC-013 OK`。

## AC-013 B-1 测试标题

```powershell
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ((New-Guid).Guid + '.mjs')
$code = @'
import fs from 'node:fs'
import assert from 'node:assert/strict'

const groups = {
  'test/unit/config.test.mjs': [
    '[AC-013] loadConfig rejects _example true with E_CONFIG_EXAMPLE',
    '[AC-013] loadConfig rejects a re-indented copy of the bundled example without the marker with E_CONFIG_EXAMPLE',
    '[AC-013] loadConfig accepts the bundled example after a real edit',
    '[AC-013] init refuses to overwrite an existing file with E_CONFIG_EXISTS and leaves it unchanged',
    '[AC-013] init writes the bundled example when the target is missing',
    '[AC-013] the CLI maps E_CONFIG_EXAMPLE and E_CONFIG_EXISTS to ok false with exit code 3',
  ],
  'test/unit/gitignore.test.mjs': [
    '[AC-013] git check-ignore -v matches config/a.local.json, state/x, a.jsonl and .collab/x',
    '[AC-013] git check-ignore does not match config/cliworker.example.json',
  ],
}
for (const [file, titles] of Object.entries(groups)) {
  const source = fs.readFileSync(file, 'utf8')
  for (const title of titles) assert.ok(source.includes(title), file + ' missing ' + title)
}
console.log('AC-013 OK')
'@
[System.IO.File]::WriteAllText($tmp, $code, (New-Object System.Text.UTF8Encoding $false))
& node $tmp
$e = $LASTEXITCODE
Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
if ($e -ne 0) { exit $e }
```

- 期望: design §11 的 AC-013 标题都在指定文件里。
- 期望: 最后一行是 `AC-013 OK`。

## AC-013 C-1 gitignore

```powershell
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ((New-Guid).Guid + '.mjs')
$code = @'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const text = fs.readFileSync('.gitignore', 'utf8')
assert.notEqual(text.charCodeAt(0), 0xfeff)
assert.equal(text.includes('\r'), false)
const lines = text.split('\n').filter((line, index, all) => !(index === all.length - 1 && line === ''))
assert.deepEqual(lines, ['config/*.local.json', 'state/', '*.jsonl', '.collab/', 'node_modules/'])

function check(target) {
  return spawnSync('git', ['check-ignore', '-v', '--', target], { encoding: 'utf8' })
}
const rules = {
  'config/a.local.json': 'config/*.local.json',
  'state/x': 'state/',
  'a.jsonl': '*.jsonl',
  '.collab/x': '.collab/',
}
for (const [target, rule] of Object.entries(rules)) {
  const result = check(target)
  assert.equal(result.status, 0, target + ' ' + (result.stdout || '') + (result.stderr || ''))
  assert.ok((result.stdout || '').includes('.gitignore:'), target)
  assert.ok((result.stdout || '').includes(rule), target + ' ' + result.stdout)
}
const miss = check('config/cliworker.example.json')
assert.equal(miss.status, 1)
assert.equal(miss.stdout || '', '')
console.log('AC-013 OK')
'@
[System.IO.File]::WriteAllText($tmp, $code, (New-Object System.Text.UTF8Encoding $false))
& node $tmp
$e = $LASTEXITCODE
Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
if ($e -ne 0) { exit $e }
```

- 期望: `.gitignore` 是无 BOM 的 LF 文本，五行依次为 `config/*.local.json`、`state/`、`*.jsonl`、`.collab/`、`node_modules/`。
- 期望: `git check-ignore -v --` 对 `config/a.local.json`、`state/x`、`a.jsonl`、`.collab/x` 退出码 0，stdout 含 `.gitignore:` 和对应规则；对 `config/cliworker.example.json` 退出码 1 且 stdout 为空。
- 期望: 最后一行是 `AC-013 OK`。

## AC-013 D-1 示例识别与 init

```powershell
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ((New-Guid).Guid + '.mjs')
$code = @'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createContext } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/lib/context.mjs'
import { loadConfig } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/lib/config.mjs'
import { bundledExamplePath, resolvePaths } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/lib/paths.mjs'
import { main } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/lib/cli.mjs'
import { fakeStream } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/test/helpers/ctx.mjs'

const raw = fs.readFileSync('config/cliworker.example.json', 'utf8')
assert.notEqual(raw.charCodeAt(0), 0xfeff)
const example = JSON.parse(raw)
assert.deepEqual(Object.keys(example).slice(0, 2), ['_example', 'schema'])
assert.equal(example._example, true)
assert.equal(example.schema, 'cliworker.config/v1')
assert.equal(example.providers.claude.cli, 'claude')
assert.equal(example.quotas.codebuddy.unit, 'credits')
assert.equal(example.quotas.codebuddy.remaining, 1000)
assert.equal(example.quotas.codebuddy.credits_per_mtok, 1000)
const quotaKeys = Object.keys(example.quotas.codebuddy)
assert.equal(quotaKeys.indexOf('credits_per_mtok'), quotaKeys.indexOf('unit') + 1)

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ac013-'))
try {
  const env = { CLIWORKER_HOME: path.join(base, 'home') }
  const fresh = () => createContext({ env, stdout: fakeStream(), stderr: fakeStream() })
  const prefixOf = (file) => 'cannot load CLIWorker config ' + path.resolve(file) + ': '

  const stripped = JSON.parse(raw)
  delete stripped._example
  const reindented = path.join(base, 'reindented.json')
  fs.writeFileSync(reindented, JSON.stringify(stripped, null, 4))
  let rejected
  try { loadConfig({ file: reindented, ctx: fresh() }) } catch (error) { rejected = error }
  assert.ok(rejected)
  assert.equal(rejected instanceof TypeError, false)
  assert.equal(rejected.code, 'E_CONFIG_EXAMPLE')
  assert.ok(rejected.message.startsWith(prefixOf(reindented)))
  assert.ok(rejected.message.includes('this is the bundled example; copy it and edit it'))

  const marked = path.join(base, 'marked.json')
  fs.writeFileSync(marked, JSON.stringify({ _example: true, providers: { a: 1 }, models: { b: 1 } }))
  let markedError
  try { loadConfig({ file: marked, ctx: fresh() }) } catch (error) { markedError = error }
  assert.equal(markedError.code, 'E_CONFIG_EXAMPLE')

  const editedObj = JSON.parse(raw)
  delete editedObj._example
  editedObj.quotas.claude.window = 'edited'
  const edited = path.join(base, 'edited.json')
  fs.writeFileSync(edited, JSON.stringify(editedObj))
  const loaded = loadConfig({ file: edited, ctx: fresh() })
  assert.equal(loaded._file, path.resolve(edited))
  assert.equal(typeof loaded._home, 'string')
  assert.notEqual(loaded._home, loaded._file)

  const exists = path.join(base, 'exists.json')
  fs.writeFileSync(exists, 'KEEP')
  const ctxExists = fresh()
  const initExists = await main(['init', '--config', exists], ctxExists)
  assert.equal(initExists.exitCode, 3)
  assert.equal(ctxExists.stderr.text(), '')
  const bodyExists = JSON.parse(ctxExists.stdout.text())
  assert.equal(bodyExists.ok, false)
  assert.equal(bodyExists.error.code, 'E_CONFIG_EXISTS')
  assert.ok(bodyExists.error.message.includes(path.resolve(exists)))
  assert.equal(bodyExists.error.retryable, false)
  assert.equal(bodyExists.error.retry_after, null)
  assert.deepEqual(Object.keys(bodyExists), ['ok', 'error'])
  assert.deepEqual(Object.keys(bodyExists.error), ['code', 'message', 'retryable', 'retry_after'])
  assert.equal(ctxExists.stdout.text(), JSON.stringify(bodyExists, null, 2) + '\n')
  assert.equal(fs.readFileSync(exists, 'utf8'), 'KEEP')

  const missing = path.join(base, 'nested', 'config.json')
  const ctxMissing = fresh()
  const initMissing = await main(['init', '--config', missing], ctxMissing)
  assert.equal(initMissing.exitCode, 0)
  assert.equal(ctxMissing.stderr.text(), '')
  const bodyMissing = JSON.parse(ctxMissing.stdout.text())
  assert.equal(bodyMissing.ok, true)
  assert.equal(bodyMissing.config, path.resolve(missing))
  const expected = resolvePaths({ configPath: missing, env, platform: process.platform, cwd: process.cwd() })
  assert.equal(bodyMissing.state_dir, expected.state_dir)
  assert.deepEqual(bodyMissing.warnings, [])
  assert.deepEqual(Object.keys(bodyMissing), ['ok', 'config', 'state_dir', 'warnings'])
  assert.equal(ctxMissing.stdout.text(), JSON.stringify(bodyMissing, null, 2) + '\n')
  assert.equal(fs.readFileSync(missing, 'utf8'), fs.readFileSync(bundledExamplePath(), 'utf8'))

  const ctxCli = fresh()
  const cli = await main(['providers', '--config', reindented], ctxCli)
  assert.equal(cli.exitCode, 3)
  assert.equal(ctxCli.stderr.text(), '')
  const bodyCli = JSON.parse(ctxCli.stdout.text())
  assert.equal(bodyCli.ok, false)
  assert.equal(bodyCli.error.code, 'E_CONFIG_EXAMPLE')
  assert.equal(bodyCli.error.retryable, false)
  assert.equal(bodyCli.error.retry_after, null)
  assert.ok(bodyCli.error.message.includes(path.resolve(reindented)))
} finally {
  fs.rmSync(base, { recursive: true, force: true })
}
console.log('AC-013 OK')
'@
[System.IO.File]::WriteAllText($tmp, $code, (New-Object System.Text.UTF8Encoding $false))
& node $tmp
$e = $LASTEXITCODE
Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
if ($e -ne 0) { exit $e }
```

- 期望: 示例最前面两个键是 `_example: true` 与 `schema: cliworker.config/v1`；`quotas.codebuddy.credits_per_mtok` 为 1000 且紧跟 `unit`；`providers.claude.cli` 仍是 `claude`。
- 期望: 重新缩进且去掉 `_example` 的副本，以及 `_example: true` 但内容不同的文件，都以 `E_CONFIG_EXAMPLE` 失败。`message` 以 `cannot load CLIWorker config <绝对路径>: ` 开头，并含 `this is the bundled example; copy it and edit it`。改掉一个字段并去掉标记后可以加载。
- 期望: 目标已存在时 `init` 返回退出码 3，stdout 为 `{ ok: false, error: { code: E_CONFIG_EXISTS, message, retryable: false, retry_after: null } }`，stderr 为空，文件内容不变。目标不存在时退出码 0，写入随包示例原文，`warnings` 为 `[]`。
- 期望: 加载示例副本时 CLI 同样把 `E_CONFIG_EXAMPLE` 打到 stdout，退出码 3，stderr 为空。最后一行是 `AC-013 OK`。

## AC-013 E-1 bin 与 _util 不改

```powershell
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ((New-Guid).Guid + '.mjs')
$code = @'
import fs from 'node:fs'
import assert from 'node:assert/strict'

function lines(file) {
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const all = text.split('\n')
  if (all.length > 0 && all[all.length - 1] === '') all.pop()
  return all
}

assert.deepEqual(lines('C:/git/dsh-CLIWorker/.collab/worktrees/005/bin/cliworker.mjs'), [
  '#!/usr/bin/env node',
  "import { main } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/lib/cli.mjs'",
  "import { createContext } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/lib/context.mjs'",
  '',
  'const { exitCode } = await main(process.argv.slice(2), createContext())',
  'process.exitCode = exitCode',
])
assert.deepEqual(lines('C:/git/dsh-CLIWorker/.collab/worktrees/005/lib/commands/_util.mjs'), [
  "import path from 'node:path'",
  "import { defaultHome } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/config.mjs'",
  '',
  'export function arg(argv, name, fallback) {',
  '  const i = argv.indexOf(name)',
  '  return i >= 0 ? argv[i + 1] : fallback',
  '}',
  '',
  'export function flag(argv, name) {',
  '  return argv.includes(name)',
  '}',
  '',
  'export function usageFile(config, ctx) {',
  "  return path.join(config._home || defaultHome(ctx.env), 'usage.jsonl')",
  '}',
])
console.log('AC-013 OK')
'@
[System.IO.File]::WriteAllText($tmp, $code, (New-Object System.Text.UTF8Encoding $false))
& node $tmp
$e = $LASTEXITCODE
Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
if ($e -ne 0) { exit $e }
```

- 期望: `bin/cliworker.mjs` 仍只调用 `lib/cli.mjs` 的 `main`，没有 `paths`、`init` 或 `loadConfig`。`lib/commands/_util.mjs` 的 `usageFile` 仍读 `config._home`。
- 期望: 最后一行是 `AC-013 OK`。

## AC-014 A-1 测试入口

```powershell
$o = (node scripts/run-tests.mjs --ac AC-014 2>&1 | Out-String); if ($LASTEXITCODE -ne 0) { throw "run-tests exited $LASTEXITCODE" }; if ($o -notmatch 'run-tests: filtered 2 files, manifest ') { throw 'file count' }; if ($o.Contains([string][char]0x2716)) { throw 'output contains the failure mark' }; Write-Output 'AC-014 OK'
```

- 期望: 退出码 0，输出含 `run-tests: filtered 2 files, manifest `，且没有失败标记。两份文件是 `test/unit/config.test.mjs` 与 `test/characterization/defects/a4-null-config.test.mjs`。
- 期望: 最后一行是 `AC-014 OK`。

## AC-014 B-1 测试标题与 a4-null-config 的 repro 哈希

```powershell
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ((New-Guid).Guid + '.mjs')
$code = @'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { reproSha256 } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/scripts/check-defects.mjs'

const groups = {
  'test/unit/config.test.mjs': [
    '[AC-014] loadConfig throws E_CONFIG with the absolute path and a reason for null, [], 42, non-JSON, missing providers and missing models',
    '[AC-014] the CLI prints ok false E_CONFIG on stdout, exits 3 and writes nothing to stderr for each bad config',
  ],
  'test/characterization/defects/a4-null-config.test.mjs': [
    '[repro] [AC-005] a null or empty config throws without an error code',
    '[fixed] [AC-014] live loadConfig throws E_CONFIG for a null and an empty config',
  ],
}
for (const [file, titles] of Object.entries(groups)) {
  const source = fs.readFileSync(file, 'utf8')
  for (const title of titles) assert.ok(source.includes(title), file + ' missing ' + title)
}
const ledger = JSON.parse(fs.readFileSync('test/characterization/defects.json', 'utf8'))
const defect = ledger.defects.find((item) => item.id === 'a4-null-config')
const repro = fs.readFileSync('test/characterization/defects/a4-null-config.test.mjs', 'utf8')
assert.equal(reproSha256(repro), defect.repro_sha256)
console.log('AC-014 OK')
'@
[System.IO.File]::WriteAllText($tmp, $code, (New-Object System.Text.UTF8Encoding $false))
& node $tmp
$e = $LASTEXITCODE
Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
if ($e -ne 0) { exit $e }
```

- 期望: design §11 的 AC-014 标题都在指定文件里；`[repro]` 块的 sha256 仍等于 `defects.json` 里 `a4-null-config` 的 `repro_sha256`。
- 期望: 最后一行是 `AC-014 OK`。

## AC-014 C-1 非法配置与 CLI 退出码

```powershell
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ((New-Guid).Guid + '.mjs')
$code = @'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createContext } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/lib/context.mjs'
import { loadConfig } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/lib/config.mjs'
import { fakeStream } from 'file:///C:/git/dsh-CLIWorker/.collab/worktrees/005/test/helpers/ctx.mjs'

const cases = [
  ['null.json', 'null', 'root must be a JSON object'],
  ['arr.json', '[]', 'root must be a JSON object'],
  ['num.json', '42', 'root must be a JSON object'],
  ['bad.json', '{', null],
  ['nop.json', JSON.stringify({}), 'providers is required'],
  ['nom.json', JSON.stringify({ providers: {} }), 'models is required'],
  ['arrprov.json', JSON.stringify({ providers: [], models: {} }), 'providers is required'],
  ['arrmod.json', JSON.stringify({ providers: {}, models: [] }), 'models is required'],
  ['st.json', JSON.stringify({ providers: {}, models: {}, state_dir: 1 }), 'state_dir must be a non-empty string'],
  ['emptystr.json', JSON.stringify({ providers: {}, models: {}, state_dir: '' }), 'state_dir must be a non-empty string'],
]
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ac014-'))
try {
  const env = { CLIWORKER_HOME: path.join(base, 'home') }
  const spawnEnv = Object.assign({}, process.env, env)
  delete spawnEnv.CLIWORKER_TEST_CLOCK_FILE
  for (const [name, contents, reason] of cases) {
    const file = path.join(base, name)
    fs.writeFileSync(file, contents)
    const abs = path.resolve(file)
    const prefix = 'cannot load CLIWorker config ' + abs + ': '
    let error
    try {
      loadConfig({ file, ctx: createContext({ env, stdout: fakeStream(), stderr: fakeStream() }) })
    } catch (caught) {
      error = caught
    }
    assert.ok(error, name)
    assert.equal(error instanceof TypeError, false, name)
    assert.equal(error.code, 'E_CONFIG', name)
    assert.ok(error.message.startsWith(prefix), error.message)
    assert.ok(error.message.length > prefix.length, name)
    if (reason) assert.ok(error.message.includes(reason), name + ' ' + error.message)

    const child = spawnSync(process.execPath, ['bin/cliworker.mjs', 'providers', '--config', file], { encoding: 'utf8', env: spawnEnv })
    assert.equal(child.status, 3, name + ' ' + (child.stderr || '') + (child.stdout || ''))
    assert.equal(child.stderr || '', '', name)
    assert.equal((child.stdout || '').includes('TypeError'), false, name)
    const body = JSON.parse(child.stdout)
    assert.equal(body.ok, false, name)
    assert.equal(body.error.code, 'E_CONFIG', name)
    assert.equal(body.error.retryable, false, name)
    assert.equal(body.error.retry_after, null, name)
    assert.ok(body.error.message.includes(abs), name)
    if (reason) assert.ok(body.error.message.includes(reason), name)
    assert.deepEqual(Object.keys(body), ['ok', 'error'])
    assert.deepEqual(Object.keys(body.error), ['code', 'message', 'retryable', 'retry_after'])
    assert.equal(child.stdout, JSON.stringify(body, null, 2) + '\n')
  }
} finally {
  fs.rmSync(base, { recursive: true, force: true })
}
console.log('AC-014 OK')
'@
[System.IO.File]::WriteAllText($tmp, $code, (New-Object System.Text.UTF8Encoding $false))
& node $tmp
$e = $LASTEXITCODE
Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
if ($e -ne 0) { exit $e }
```

- 期望: 配置根为 `null`、`[]`、`42`、非 JSON，或缺 `providers`、缺 `models`，或 `providers`/`models` 是数组，或 `state_dir` 不是非空字符串时，`loadConfig` 抛 `E_CONFIG` 而不是 `TypeError`。`message` 以 `cannot load CLIWorker config <绝对路径>: ` 开头；已知原因分别是 `root must be a JSON object`、`providers is required`、`models is required`、`state_dir must be a non-empty string`。
- 期望: 对同一批文件，`node bin/cliworker.mjs providers --config <file>` 退出码 3，stdout 是 `{ ok: false, error: { code, message, retryable: false, retry_after: null } }` 的两空格 JSON 加换行，stderr 为空，输出中没有 `TypeError`。
- 期望: 最后一行是 `AC-014 OK`。
