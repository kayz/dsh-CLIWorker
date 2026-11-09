# Task 042 — 真实 CLI 探测接线：discover 版本证据与 probe 可用性

依据 design.md 和本轮用户裁决。probe 指既有 models probe；inventory 仍只有 present/gone，三个版本失败类别落在模型既有 availability.state/reason。版本成功不能单独授予 callable。brief 未给基准 SHA 或既有验收报告路径；`f43467f` 仅是本轮生成资产门禁增量的来源标识。

各 pwsh 块由 PowerShell 7 runner 在仓库根作为独立脚本执行，互不依赖前一块的变量、报告或状态，原生命令之后立即检查退出码。下列产品检查供实现完成后执行；本 design 轮只执行不创建其他文件、不调用 git 的验收格式自检。

## AC-085 真实版本证据与既有 models probe 可用性接线

```pwsh
$ErrorActionPreference = 'Stop'
$probeTap = & node --test --test-reporter=tap 'test/integration/discovery-probe.test.mjs'
if ($LASTEXITCODE -ne 0) { throw 'AC-085 integration failed' }
$probeTap | Write-Output
$probeText = $probeTap -join "`n"
if ($probeText -notmatch '(?m)^# tests [1-9][0-9]*\r?$') { throw 'AC-085 executed no tests' }
foreach ($probeStatus in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($probeText -notmatch "(?m)^# $probeStatus 0\r?`$") { throw "AC-085 has $probeStatus tests" }
}
Write-Output 'AC-085 OK'
```

- 期望输出：退出码 0；TAP 的 tests 为正数，fail/cancelled/skipped/todo 均为 0，最后 stdout 打印独立一行 `AC-085 OK`。文件缺失、零用例、失败或跳过均失败，不匹配测试标题。
- 行为判据：测试实际执行生产 discover 和既有 models probe，至少一组使用隔离 PATH 的本地假可执行文件和真实 bin 子进程，比较 stdout JSON 与落盘 inventory.json/probes.json。11 项已知 CLI 版本各自来自夹具输出；成功版本、合法后缀、三类失败及无执行均按 design.md 校验，冻结字段、真实退出码、受控时间和 stdout SHA-256 独立断言。无网络或真实厂商 CLI。
- 状态判据：版本执行失败的三类 reason 精确为 `command missing`、`non-zero exit`、`unparsable output`，对应模型 availability.state 均为 unverified，版本为 null，不发起该模型推理调用，不增加推理 usage。旧 callable 会被覆盖；修复后须重新观察并经真实调用和身份核验方能恢复。inventory.status 始终 present/gone，不能新增原因字段。超时等其他版本错误不得伪装成这三类。
- 防提升判据：必须测试版本成功但无模型身份、nonce 不匹配、认证失败、真实调用超时/非零退出，结果均非 callable；相同版本且真实调用、nonce、身份和既有用量条件满足时才 callable。仅 discover 或 provider 版本检查不能写入模型 callable 或推理账本。未允许/弃用模型、未知候选、解释器包装器、不同安装之间的隔离和缓存回归也必须通过，不能靠改原测试断言消除失败。

以下独立命令直接驱动现有生产命令入口，补充断言失败落点、provider 检查边界和“版本成功不等于 callable”；不依赖新增测试文件中的预制结果。

```pwsh
$ErrorActionPreference = 'Stop'
@'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createContext } from './lib/context.mjs'
import { createFakeClock } from './test/helpers/clock.mjs'
import { run as discover } from './lib/commands/discover.mjs'
import { run as modelsProbe } from './lib/commands/models/probe.mjs'
import { checkProvider, readProbeModels } from './lib/availability.mjs'
import { validate } from './lib/contract/validate.mjs'

const inventorySchema = JSON.parse(fs.readFileSync('contracts/schemas/inventory.v1.schema.json', 'utf8'))
const modelSchema = JSON.parse(fs.readFileSync('contracts/schemas/model.v1.schema.json', 'utf8'))
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ac085-'))
const versionText = 'fixture v1.2.3-alpha.1+build.7\n'
const version = '1.2.3-alpha.1+build.7'
const outcomes = [
  ['command missing', { ok: false, code: null, stdout: '', stderr: '', error: 'spawn ENOENT' }],
  ['non-zero exit', { ok: false, code: 7, stdout: versionText, stderr: 'failed', error: null }],
  ['unparsable output', { ok: true, code: 0, stdout: 'no release reported\n', stderr: '1.2.3', error: null }],
  ['missing identity', null],
  ['bad nonce', null],
  ['valid call', null],
]
try {
  for (const [index, [mode, failure]] of outcomes.entries()) {
    const state = path.join(root, String(index))
    const bin = path.join(state, 'bin')
    fs.mkdirSync(bin, { recursive: true })
    const executable = path.join(bin, process.platform === 'win32' ? 'claude.cmd' : 'claude')
    fs.writeFileSync(executable, 'controlled executable observation\n', 'utf8')
    const clock = createFakeClock()
    const at = clock.nowIso()
    let realCalls = 0
    const ctx = createContext({
      fs, clock, env: { PATH: bin }, platform: process.platform,
      exec(command, args, options) {
        assert.equal(command, executable)
        if (args.length === 1 && args[0] === '--version') {
          return failure ?? { ok: true, code: 0, stdout: versionText, stderr: '', error: null }
        }
        realCalls++
        assert.ok(args.includes('--model'))
        assert.equal(typeof options.input, 'string')
        const nonce = options.input.trim().split(/\s+/).at(-1)
        return { ok: true, code: 0, stdout: JSON.stringify({ type: 'result',
          ...(mode === 'missing identity' ? {} : { model: 'claude:fixture' }),
          text: mode === 'bad nonce' ? 'wrong' : nonce,
          usage: { input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0 },
        }) + '\n', stderr: '', error: null }
      },
    })
    const model = {
      schema: 'cliworker.model/v1', key: 'claude:fixture', id: 'fixture', cli: executable,
      provider: 'claude', vendor: 'fixture', aliases: [], allowed: false,
      level: 'Quick', level_source: { kind: 'config', ref: 'fixture', at },
      availability: { state: 'unverified', reason: null, at: null, ttl_s: null, evidence: null },
      identity: 'unverified', capabilities: { context_tokens: 0, readonly: true, stdin: true },
      prices: { input_per_mtok: 0, output_per_mtok: 0, source: 'fixture' },
      source: { kind: 'manual', ref: 'fixture', at }, deprecated: false,
    }
    const config = { _home: state, secrets: {}, pools: [], policy: { probe_ttl_s: 10 },
      discovery: { wsl: false, extra_dirs: [], unknown_patterns: [], cli_overrides: {}, probe_unknown: false },
      catalog: { manual: [model], allow: [model.key], levels: {}, aliases: {}, deprecated: {} },
    }
    const inventory = await discover({ argv: ['discover', '--full'], ctx, config })
    assert.deepEqual(validate(inventorySchema, inventory), { ok: true, errors: [] })
    assert.equal(inventory.entries.length, 1)
    const entry = inventory.entries[0]
    assert.equal(entry.status, 'present')
    assert.equal(entry.recognized, true)
    assert.equal(entry.version, failure ? null : version)
    assert.deepEqual(entry.auth, { state: 'unknown', source: 'none' })
    const stdout = failure ? failure.stdout : versionText
    assert.deepEqual(entry.evidence, [{ kind: 'probe', cmd_redacted: 'claude --version',
      exit: failure ? failure.code : 0, at, digest: createHash('sha256').update(stdout, 'utf8').digest('hex'),
    }])
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(state, 'inventory.json'), 'utf8')), inventory)
    assert.equal(realCalls, 0)
    assert.equal(fs.existsSync(path.join(state, 'probes.json')), false)
    assert.equal(fs.existsSync(path.join(state, 'usage.jsonl')), false)
    const provider = checkProvider({ cli: executable }, { ctx })
    assert.equal(provider.state, 'unverified')
    assert.equal(provider.version, failure ? null : version)
    if (failure) assert.equal(provider.detail, mode)
    const result = await modelsProbe({ argv: ['models', 'probe'], ctx, config })
    assert.equal(result.schema, 'cliworker.models/v1')
    assert.equal(result.models.length, 1)
    const observed = result.models[0]
    assert.deepEqual(validate(modelSchema, observed), { ok: true, errors: [] })
    assert.deepEqual(readProbeModels(config, { ctx }), result.models)
    assert.equal(observed.availability.state, mode === 'valid call' ? 'callable' : 'unverified')
    assert.equal(realCalls, failure ? 0 : 1)
    if (failure) {
      assert.equal(observed.availability.reason, mode)
      assert.equal(observed.identity, 'unverified')
      assert.equal(observed.availability.evidence.exit, failure.code)
      assert.equal(observed.availability.evidence.nonce_ok, false)
      assert.equal(observed.availability.evidence.reported_model, null)
      assert.equal(observed.availability.evidence.tokens, null)
      assert.equal(fs.existsSync(path.join(state, 'usage.jsonl')), false)
    } else {
      assert.equal(observed.identity, mode === 'missing identity' ? 'unverified' : 'verified')
      assert.equal(observed.availability.evidence.nonce_ok, mode !== 'bad nonce')
    }
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
assert.equal(fs.existsSync(root), false)
console.log('AC-085 OK')
'@ | node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'AC-085 production behavior failed' }
```

- 期望输出：退出码 0，stdout 最后打印 `AC-085 OK`。三类失败分别得到精确 reason、unverified、真实退出值和空模型/用量证据，无推理执行和账本行。三个成功版本场景使用相同真实版本文本，缺身份或错误 nonce 时仍 unverified，只有真实调用条件满足时 callable。provider 检查仅凭版本始终 unverified。所有 inventory/model 均符合原 schema，返回值与持久化记录相同，临时目录已清理。此命令用受控 ctx.exec 隔离观察，上一条 integration 命令另外负责真实假可执行文件和 bin 子进程验证。

```pwsh
$ErrorActionPreference = 'Stop'
node --test 'test/integration/discovery.test.mjs' 'test/integration/discover-command.test.mjs' 'test/integration/discovery-incremental.test.mjs' 'test/integration/discovery-rules.test.mjs' 'test/integration/probe.test.mjs' 'test/integration/probe-ledger.test.mjs'
if ($LASTEXITCODE -ne 0) { throw 'AC-085 discovery/probe regression failed' }
Write-Output 'AC-085 OK'
```

- 期望输出：退出码 0，所列既有集成测试全部通过，stdout 最后打印 `AC-085 OK`。TTL、gone、未知候选、包装器执行次数、真实调用状态机及用量幂等均保留，不修改范围外夹具或放宽旧断言。

```pwsh
$ErrorActionPreference = 'Stop'
node scripts/check-no-model-table.mjs
if ($LASTEXITCODE -ne 0) { throw 'AC-085 model-table gate failed' }
Write-Output 'AC-085 OK'
```

- 期望输出：退出码 0，stdout 含既有静态检查哨兵 `AC-079 OK`，最后打印 `AC-085 OK`；运行时代码不得复制模型清单或绕过检查器。

本轮生成资产增量 `f43467f` 的兼容门禁保持独立，失败即失败，不在 T-042 内更新生成资产。

```pwsh
$ErrorActionPreference = 'Stop'
$freshOutput = & node scripts/check-generated-fresh.mjs
if ($LASTEXITCODE -ne 0) { throw 'AC-085 generated assets are stale' }
$freshOutput | Write-Output
$freshText = $freshOutput -join "`n"
foreach ($freshMarker in @('test/fixtures/release-gate/generate.mjs: fresh', 'scripts/gen-contract-doc.mjs: fresh', 'AC-084 OK')) {
  if (-not ($freshText.Contains($freshMarker))) { throw "AC-085 missing freshness result: $freshMarker" }
}
Write-Output 'AC-085 OK'
```

- 期望输出：退出码 0，stdout 包含两项生成器的 fresh 结果及 `AC-084 OK`，最后打印 `AC-085 OK`。现有资产若过期，报告对应生成器和资产路径并失败，不更新工作区，也不能豁免或修改门禁。

完整仓库门禁由允许执行实现验收的阶段运行，本 design 轮不执行该块。

```pwsh
$ErrorActionPreference = 'Stop'
$fastOutput = & pwsh -NoProfile -File 'scripts/check-fast.ps1'
if ($LASTEXITCODE -ne 0) { throw 'AC-085 check-fast failed' }
$fastOutput | Write-Output
$fastText = $fastOutput -join "`n"
if (-not $fastText.Contains('==> check-generated-fresh.mjs')) { throw 'AC-085 freshness gate not discovered' }
if (-not $fastText.Contains('check-fast: ok')) { throw 'AC-085 check-fast incomplete' }
Write-Output 'AC-085 OK'
```

- 期望输出：退出码 0，stdout 包含 `==> check-generated-fresh.mjs` 和 `check-fast: ok`，最后打印 `AC-085 OK`。任何既有门禁失败均阻断，不能降为警告或越写域修复。

## AC-006 单元回归门禁

```pwsh
$ErrorActionPreference = 'Stop'
node --test "test/unit/*.test.mjs"
if ($LASTEXITCODE -ne 0) { throw 'AC-006 unit regression failed' }
Write-Output 'AC-006 OK'
```

- 期望输出：退出码 0，所有单元测试通过，stdout 最后打印 `AC-006 OK`；任一失败均阻断。
