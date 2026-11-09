# Task 037 — discover 覆盖 11 个已知 CLI 的契约清单

本轮用户裁决已解除上一轮 attention.json 的阻塞，以更新后的 design.md 为准：保持冻结 inventory/v1；id 为 CLI 键，auth/evidence 表达已有证据；可发现集合为 entries 中 recognized=true 且 status=present 的条目。显式未知候选保留在原始 entries，但不进入该集合。brief 未提供基准 commit SHA 或既有验收报告路径。本轮提供的 docs/contract.md 摘要增量按既有外部变更保留。

各 pwsh 块由 PowerShell 7 runner 作为独立 .ps1 在仓库根执行，不依赖上一命令的变量、报告或状态；原生命令之后立即检查 `$LASTEXITCODE`。本轮设计不创建或执行这些脚本，不修改测试及实现。

## AC-080 discover 对 11 个已知 CLI 的可判定识别

```pwsh
$ErrorActionPreference = 'Stop'
$ac080Tap = & node --test --test-reporter=tap 'test/integration/discovery-rules.test.mjs'
if ($LASTEXITCODE -ne 0) { throw 'AC-080 integration failed' }
$ac080Tap | Write-Output
$ac080Text = $ac080Tap -join "`n"
if ($ac080Text -notmatch '(?m)^# tests [1-9][0-9]*\r?$') { throw 'AC-080 executed no tests' }
foreach ($ac080Status in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($ac080Text -notmatch "(?m)^# $ac080Status 0\r?`$") { throw "AC-080 has $ac080Status tests" }
}
Write-Output 'AC-080 OK'
```

- 期望输出：退出码 0；stdout 有正数的 tests 汇总，fail、cancelled、skipped、todo 均为 0，最后打印独立一行 `AC-080 OK`。缺少测试文件、零用例、子进程失败或任何跳过均失败，不按测试标题断言。
- 行为判据：测试实际驱动生产 discover，在仅含假可执行文件的 PATH 上逐项验证 codex、claude、dsh、cursor、codebuddy、antigravity、trae、zcode、qoder、kimi、opencode 的精确 id、recognized=true、auth、版本和版本证据；全量可发现集合恰好 11 项，真子集恰好等于输入，零已知时为空。至少一组通过真实 bin、平台可执行夹具验证 stdout 单个 JSON 与落盘清单。每条记录按未扩展的冻结 schema 校验，不出现 provider/identity 等新增字段。
- 证据判据：新建/重探针条目的 auth 恰为 unknown/none；仅有版本观察不能声称已登录。成功可解析时 version 为夹具版本；成功无版本文本、非零退出及无可用退出码的失败结果均为 null；实际探针的 evidence 恰含既有 kind/cmd_redacted/exit/at/digest，摘要由预设 stdout 独立计算，失败不得伪造成功。内部异常沿用原错误语义。
- 兼容判据：普通未知文件被忽略；pattern/override 未知候选可留在原始 entries，recognized=false，默认执行次数为零；--probe-unknown 后有版本证据也仍不进入可发现集合。保留旧未知历史与 gone 语义，缓存不能沿用过时 id/recognized；TTL 用证据时间判断，--full/指纹变化/到期重探针，first_seen 保留。重复路径及 realpath 别名只探针一次，枚举顺序改变不改变键和排序。全程无网络、真实厂商执行或残留临时文件。只断言规则数量或自行构造 inventory 不算通过。

以下命令独立使用真实 discover 命令与现有内存上下文检查冻结字段、11 项映射和证据边界，不依赖新增测试的标题或内部实现名称：

```pwsh
$ErrorActionPreference = 'Stop'
$ac080Contract = @'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { run } from './lib/commands/discover.mjs';
import { createFakeContext } from './test/helpers/ctx.mjs';
import { validate } from './lib/contract/validate.mjs';

const names = ['codex', 'claude', 'dsh', 'cursor', 'codebuddy', 'antigravity', 'trae', 'zcode', 'qoder', 'kimi', 'opencode'];
const schema = JSON.parse(fs.readFileSync('contracts/schemas/inventory.v1.schema.json', 'utf8'));
const fields = ['id', 'recognized', 'platform', 'path', 'realpath', 'version', 'fingerprint', 'auth', 'evidence', 'first_seen', 'last_seen', 'status'].sort();
const root = path.resolve('ac080-memory-only');
const bin = path.join(root, 'bin');
const home = path.join(root, 'state');
const executable = name => path.join(bin, name + (process.platform === 'win32' ? '.cmd' : ''));
const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');
async function check(selected, { opted = false, probe = false, code = 0, empty = false } = {}) {
  const files = Object.fromEntries([...selected, 'other-cli'].map(name => [executable(name), 'fake executable']));
  const ctx = createFakeContext({
    files, env: { PATH: bin }, platform: process.platform,
    exec(command, args) {
      assert.deepEqual(args, ['--version']);
      const name = path.basename(command).replace(/\.(?:cmd|exe|bat|com)$/i, '');
      assert.ok(selected.includes(name) || (opted && probe && name === 'other-cli'));
      return { ok: code === 0, code, stdout: empty ? '' : `${name} 1.2.3\n`, stderr: '', error: null };
    },
  });
  ctx.fs.lstatSync = () => ({ isSymbolicLink: () => false });
  const body = await run({ argv: ['discover'], ctx, config: {
    _home: home, discovery: { wsl: false, extra_dirs: [], cli_overrides: {}, unknown_patterns: opted ? ['*-cli'] : [], probe_unknown: probe },
    policy: { probe_ttl_s: 3600 },
  } });
  assert.deepEqual(validate(schema, body), { ok: true, errors: [] });
  assert.equal(body.schema, 'cliworker.inventory/v1');
  assert.deepEqual(body.entries.filter(e => e.recognized && e.status === 'present').map(e => e.id).sort(), [...selected].sort());
  assert.equal(body.entries.length, selected.length + Number(opted));
  for (const entry of body.entries) {
    assert.deepEqual(Object.keys(entry).sort(), fields);
    assert.equal(entry.recognized, selected.includes(entry.id));
    assert.equal(entry.platform, process.platform);
    assert.equal(entry.path, executable(entry.id));
    assert.equal(entry.realpath, entry.path);
    assert.equal(entry.fingerprint.realpath, entry.realpath);
    assert.deepEqual(entry.auth, { state: 'unknown', source: 'none' });
    assert.equal(entry.status, 'present');
    assert.equal(entry.first_seen, body.generated_at);
    assert.equal(entry.last_seen, body.generated_at);
    const executed = entry.recognized || probe;
    assert.equal(entry.version, executed && code === 0 && !empty ? '1.2.3' : null);
    assert.deepEqual(entry.evidence, executed ? [{
      kind: 'probe', cmd_redacted: `${entry.id} --version`, exit: code,
      at: body.generated_at, digest: digest(empty ? '' : `${entry.id} 1.2.3\n`),
    }] : []);
  }
  assert.equal(ctx.exec.count, selected.length + Number(opted && probe));
  assert.equal(ctx.fetch.calls.length, 0);
  assert.deepEqual(JSON.parse(ctx.fs.readFileSync(path.join(home, 'inventory.json'), 'utf8')), body);
}
await check(names);
await check(['codex', 'dsh', 'qoder']);
await check([]);
await check(['codex'], { code: 7 });
await check(['codex'], { code: null });
await check(['codex'], { empty: true });
await check(['claude'], { opted: true });
await check(['claude'], { opted: true, probe: true });
console.log('AC-080 OK');
'@
$ac080Contract | node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'AC-080 frozen contract behavior failed' }
```

- 期望输出：退出码 0，stdout 独立一行 `AC-080 OK`。全量、子集、空集合、失败/空版本和显式未知候选均通过精确输出与落盘状态断言；不存在真实文件写入或网络调用。任一字段多余、认证状态升级、未知项误入可发现集合、证据伪造或缺少 CLI 都失败。

```pwsh
$ErrorActionPreference = 'Stop'
$ac080Runner = @'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ac080-'));
try {
  const env = { ...process.env };
  for (const key of ['NODE_TEST_CONTEXT', 'CLIWORKER_RUN_ACTIVE', 'CLIWORKER_RESULTS_DIR']) delete env[key];
  const result = spawnSync(process.execPath, ['scripts/run-tests.mjs', '--ac', 'AC-080', '--out-dir', out], {
    cwd: process.cwd(), env, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 32 * 1024 * 1024,
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  assert.equal(Boolean(result.error), false);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /run-tests: filtered [1-9][0-9]* files, manifest /);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'files-executed.json'), 'utf8'));
  assert.equal(manifest.mode, 'filtered');
  assert.equal(manifest.filter, 'AC-080');
  assert.equal(manifest.platform, process.platform);
  assert.deepEqual(manifest.files, ['test/integration/discovery-rules.test.mjs']);
  assert.equal(fs.readFileSync(path.join(out, 'skips.jsonl'), 'utf8').trim(), '');
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
console.log('AC-080 OK');
'@
$ac080Runner | node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'AC-080 filtered runner failed' }
```

- 期望输出：退出码 0，stdout 报告 AC-080 的 filtered 运行并最后打印 `AC-080 OK`。新生成的执行清单 mode=filtered、filter=AC-080、platform 为当前主机，files 恰为 `test/integration/discovery-rules.test.mjs`，跳过日志为空；不以零文件或跳过执行代替通过。命令使用独立系统临时目录保存报告并 finally 清理，不读取上次报告或写入本任务目录。

```pwsh
$ErrorActionPreference = 'Stop'
node --test 'test/integration/discovery.test.mjs' 'test/integration/discover-command.test.mjs' 'test/integration/discovery-incremental.test.mjs' 'test/integration/discovery-deny.test.mjs'
if ($LASTEXITCODE -ne 0) { throw 'AC-080 discovery regression failed' }
Write-Output 'AC-080 OK'
```

- 期望输出：退出码 0，所列既有 discovery 集成测试全部通过，stdout 最后打印 `AC-080 OK`。保留原有 unknown_patterns、--probe-unknown、缓存与错误行为断言，不修改这些范围外测试。

```pwsh
$ErrorActionPreference = 'Stop'
node scripts/check-no-model-table.mjs
if ($LASTEXITCODE -ne 0) { throw 'AC-080 model table gate failed' }
Write-Output 'AC-080 OK'
```

- 期望输出：退出码 0，stdout 最后打印 `AC-080 OK`。规则声明由用户授权的 rules.mjs 承载，不复制到命令分支或加载测试数据；不包含硬编码模型清单，不修改检查器或扩大白名单。

## AC-006 既有单元测试不得被破坏

```pwsh
$ErrorActionPreference = 'Stop'
node --test "test/unit/*.test.mjs"
if ($LASTEXITCODE -ne 0) { throw 'existing unit tests broken' }
Write-Output 'AC-006 OK'
```

- 期望输出：退出码 0，既有单元测试全绿，stdout 最后打印 `AC-006 OK`；保留 brief 指定的原始单元回归命令。

```pwsh
$ErrorActionPreference = 'Stop'
pwsh -NoProfile -File 'scripts/check-fast.ps1'
if ($LASTEXITCODE -ne 0) { throw 'project check-fast failed' }
Write-Output 'AC-006 OK'
```

- 期望输出：退出码 0，项目 check-fast 全部检查及测试通过，stdout 最后打印 `AC-006 OK`。本命令用于下游实施完成后的完整门禁，本轮设计阶段不运行；不得通过跳过检查、放宽断言或改变本任务写域外的文件来制造通过。
