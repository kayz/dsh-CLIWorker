# Task 040 — 跨进程写入并发一致性

brief 没有提供基准 commit sha 或既有验收报告路径。本文件的接口约定（工作进程命令行、环境变量、台账结构、临时目录前缀）全部来自同目录 design.md。候选 #1 未留下任何产物，本文件为从头编写。

各 pwsh 块由 PowerShell 7 runner 作为独立 .ps1 在仓库根执行，互不依赖变量或状态；原生命令之后立即检查 `$LASTEXITCODE`。块内的 node 脚本经 stdin 传入，所有断言只看退出码、stdout 子串、文件状态，不依赖测试标题、函数名或行号。

## AC-083 多进程并发写入不丢更新

测试文件本身必须通过：至少执行一个用例，且无失败、取消、跳过、待办。

```pwsh
$ErrorActionPreference = 'Stop'
$ac083Tap = & node --test --test-reporter=tap 'test/integration/cross-process-write.test.mjs'
$ac083Code = $LASTEXITCODE
$ac083Tap | Write-Output
if ($ac083Code -ne 0) { throw 'AC-083 cross-process-write test failed' }
$ac083Text = $ac083Tap -join "`n"
if ($ac083Text -notmatch '(?m)^# tests [1-9][0-9]*\r?$') { throw 'AC-083 executed no tests' }
foreach ($ac083Status in @('fail', 'cancelled', 'skipped', 'todo')) {
  if ($ac083Text -notmatch "(?m)^# $ac083Status 0\r?`$") { throw "AC-083 has $ac083Status tests" }
}
Write-Output 'AC-083 OK'
```

- 期望输出：退出码 0；stdout 有正数的 tests 汇总，fail、cancelled、skipped、todo 均为 0；最后一行 `AC-083 OK`。测试文件缺失、零用例或任何跳过都判失败。

项目既定的过滤运行入口（task graph 的 acceptance_direction）只命中本任务的测试文件，并产出完整的执行清单。

```pwsh
$ErrorActionPreference = 'Stop'
$ac083Runner = @'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ac083-run-'));
try {
  const env = { ...process.env };
  for (const key of ['NODE_TEST_CONTEXT', 'CLIWORKER_RUN_ACTIVE', 'CLIWORKER_RESULTS_DIR', 'CROSS_PROCESS_FAULT_DROP_ID', 'CROSS_PROCESS_SPAWN_LOG']) delete env[key];
  const result = spawnSync(process.execPath, ['scripts/run-tests.mjs', '--ac', 'AC-083', '--out-dir', out], {
    cwd: process.cwd(), env, encoding: 'utf8', windowsHide: true, timeout: 600000, maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  assert.equal(Boolean(result.error), false);
  assert.equal(result.status, 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'files-executed.json'), 'utf8'));
  assert.equal(manifest.mode, 'filtered');
  assert.equal(manifest.filter, 'AC-083');
  assert.deepEqual(manifest.files, ['test/integration/cross-process-write.test.mjs']);
  assert.equal(fs.readFileSync(path.join(out, 'skips.jsonl'), 'utf8').trim(), '');
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
console.log('AC-083 OK');
'@
$ac083Runner | node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'AC-083 filtered runner failed' }
```

- 期望输出：退出码 0；过滤运行的执行清单恰为 `test/integration/cross-process-write.test.mjs`，跳过记录为空；最后一行 `AC-083 OK`。

独立于测试文件，直接驱动新增的工作进程夹具：5 轮、每轮 24 个进程各提交一次，条目数必须恰好 24、id 集合逐项相等、目录里只剩 `ledger.json`；屏障模式与启动日志可用；故障注入时恰好丢一条且所有进程仍以 0 退出（证明「悄悄丢失」只能由条目数比较抓到）。

```pwsh
$ErrorActionPreference = 'Stop'
$ac083Worker = @'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
const worker = path.resolve('test/fixtures/store/commit-worker.mjs');
assert.ok(fs.existsSync(worker), 'commit-worker.mjs is missing');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ac083-'));
const N = 24;
const ids = Array.from({ length: N }, (unused, i) => 'w' + i);
function run(dir, id, env, barrier) {
  const args = barrier ? [worker, dir, id, barrier] : [worker, dir, id];
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', c => { stdout += c; });
    child.stderr.on('data', c => { stderr += c; });
    child.on('error', e => resolve({ code: null, stdout, stderr: stderr + e.message }));
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
function baseEnv(extra) {
  const env = { ...process.env };
  delete env.CROSS_PROCESS_FAULT_DROP_ID;
  delete env.CROSS_PROCESS_SPAWN_LOG;
  return { ...env, ...extra };
}
async function round(name, extra, useBarrier) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir);
  const barrier = useBarrier ? path.join(root, name + '-barrier') : null;
  if (barrier) fs.mkdirSync(barrier);
  const pending = ids.map(id => run(dir, id, baseEnv(extra), barrier));
  if (barrier) {
    const deadline = Date.now() + 60000;
    while (fs.readdirSync(barrier).filter(n => n.startsWith('ready-')).length < N) {
      assert.ok(Date.now() < deadline, 'workers never reached the barrier');
      await new Promise(r => setTimeout(r, 5));
    }
    fs.writeFileSync(path.join(barrier, 'go'), '');
  }
  const results = await Promise.all(pending);
  results.forEach((r, i) => {
    assert.equal(r.code, 0, ids[i] + ' failed: ' + r.stderr);
    assert.equal(r.stdout.trim(), 'COMMITTED ' + ids[i]);
  });
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'ledger.json'), 'utf8'));
  return { dir, state };
}
try {
  for (let i = 0; i < 5; i += 1) {
    const { dir, state } = await round('plain' + i, {}, false);
    assert.equal(state.entries.length, N);
    assert.deepEqual(state.entries.map(e => e.id).sort(), [...ids].sort());
    assert.deepEqual(fs.readdirSync(dir), ['ledger.json']);
  }
  const log = path.join(root, 'spawn.log');
  const gated = await round('gated', { CROSS_PROCESS_SPAWN_LOG: log }, true);
  assert.equal(gated.state.entries.length, N);
  assert.deepEqual(gated.state.entries.map(e => e.id).sort(), [...ids].sort());
  assert.deepEqual(fs.readdirSync(gated.dir), ['ledger.json']);
  const rows = fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean).map(l => l.split('\t'));
  assert.equal(rows.length, N);
  assert.ok(rows.every(c => c.length === 3 && c[0] === gated.dir));
  assert.deepEqual(rows.map(c => c[1]).sort(), [...ids].sort());
  const faulty = await round('fault', { CROSS_PROCESS_FAULT_DROP_ID: 'w3' }, false);
  assert.equal(faulty.state.entries.length, N - 1);
  assert.equal(faulty.state.entries.some(e => e.id === 'w3'), false);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log('AC-083 OK');
'@
$ac083Worker | node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'AC-083 commit-worker fixture check failed' }
```

- 期望输出：退出码 0；5 轮干净运行每轮恰为 24 条且无残留文件，屏障轮与启动日志各恰为 24 行，故障注入轮恰为 23 条且缺 `w3`；最后一行 `AC-083 OK`。

故障注入必须被测试文件抓到：让 `w0` 悄悄丢一次提交，测试文件必须以非 0 退出并报告失败用例（断言不得放宽为比例或下限）。

```pwsh
$ErrorActionPreference = 'Stop'
$ac083Fault = @'
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const env = { ...process.env, CROSS_PROCESS_FAULT_DROP_ID: 'w0' };
for (const key of ['NODE_TEST_CONTEXT', 'CROSS_PROCESS_SPAWN_LOG']) delete env[key];
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test/integration/cross-process-write.test.mjs'], {
  env, encoding: 'utf8', windowsHide: true, timeout: 600000, maxBuffer: 64 * 1024 * 1024,
});
assert.equal(Boolean(result.error), false);
assert.notEqual(result.status, 0, 'a lost commit was not detected');
assert.match(result.stdout, /(?:^|\n)# fail [1-9][0-9]*\r?\n/);
console.log('AC-083 OK');
'@
$ac083Fault | node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'AC-083 fault injection was not caught' }
```

- 期望输出：退出码 0（脚本内部断言「测试文件在丢失一次提交时退出码非 0 且 tap 汇总 fail ≥ 1」）；最后一行 `AC-083 OK`。若测试文件在故障下仍通过，本命令失败。

规模与稳定性：连续运行测试文件 3 遍均通过；用启动日志旁证每遍里至少有 5 个独立的状态目录，每个目录各自启动了不少于 20 个不同进程；运行结束后系统临时目录里不留下 `cliworker-xwrite-` 前缀的目录。

```pwsh
$ErrorActionPreference = 'Stop'
$ac083Scale = @'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const prefix = 'cliworker-xwrite-';
const leftovers = () => fs.readdirSync(os.tmpdir()).filter(n => n.startsWith(prefix)).sort();
const before = leftovers();
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ac083-scale-'));
try {
  for (let rep = 0; rep < 3; rep += 1) {
    const log = path.join(work, 'spawn-' + rep + '.log');
    const env = { ...process.env, CROSS_PROCESS_SPAWN_LOG: log };
    for (const key of ['NODE_TEST_CONTEXT', 'CROSS_PROCESS_FAULT_DROP_ID']) delete env[key];
    const result = spawnSync(process.execPath, ['--test', 'test/integration/cross-process-write.test.mjs'], {
      env, encoding: 'utf8', windowsHide: true, timeout: 600000, maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(Boolean(result.error), false);
    assert.equal(result.status, 0, 'repeat ' + rep + ' failed:\n' + result.stdout + result.stderr);
    const rows = fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean).map(l => l.split('\t'));
    assert.ok(rows.every(c => c.length === 3), 'malformed spawn log row');
    const groups = new Map();
    for (const [dir, id, pid] of rows) {
      if (!groups.has(dir)) groups.set(dir, { ids: new Set(), pids: new Set() });
      groups.get(dir).ids.add(id);
      groups.get(dir).pids.add(pid);
    }
    assert.ok(groups.size >= 5, 'fewer than 5 rounds: ' + groups.size);
    for (const [dir, group] of groups) {
      assert.ok(group.ids.size >= 20, dir + ' ran only ' + group.ids.size + ' distinct workers');
      assert.ok(group.pids.size >= 20, dir + ' ran only ' + group.pids.size + ' distinct processes');
    }
  }
  assert.deepEqual(leftovers(), before);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
console.log('AC-083 OK');
'@
$ac083Scale | node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'AC-083 scale or stability check failed' }
```

- 期望输出：退出码 0；3 遍运行全部通过，每遍至少 5 个状态目录、每个目录不少于 20 个不同的工作进程，临时目录无 `cliworker-xwrite-` 残留；最后一行 `AC-083 OK`。

写域与不动实现：`lib/` 下相对分支基点零改动（含未跟踪文件），既有的两个并发测试资产不被改动，所有改动路径（`.collab/` 之外）都落在 design.md 声明的三项写域内。

```pwsh
$ErrorActionPreference = 'Stop'
$ac083Base = (& git merge-base main HEAD)
if ($LASTEXITCODE -ne 0 -or -not $ac083Base) { throw 'AC-083 cannot resolve the merge base with main' }
$ac083Base = $ac083Base.Trim()
$ac083Lib = @(& git diff --name-only $ac083Base -- lib)
if ($LASTEXITCODE -ne 0) { throw 'AC-083 git diff failed' }
if ($ac083Lib.Count -ne 0) { throw ('AC-083 lib/ was modified: ' + ($ac083Lib -join ', ')) }
$ac083LibNew = @(& git ls-files --others --exclude-standard -- lib)
if ($LASTEXITCODE -ne 0) { throw 'AC-083 git ls-files failed' }
if ($ac083LibNew.Count -ne 0) { throw ('AC-083 untracked files under lib/: ' + ($ac083LibNew -join ', ')) }
$ac083Frozen = @(& git diff --name-only $ac083Base -- 'test/integration/store-concurrency.test.mjs' 'test/fixtures/store/append-worker.mjs' 'test/fixtures/store/counter-worker.mjs')
if ($LASTEXITCODE -ne 0) { throw 'AC-083 git diff on existing store assets failed' }
if ($ac083Frozen.Count -ne 0) { throw ('AC-083 existing store assets were modified: ' + ($ac083Frozen -join ', ')) }
$ac083Changed = @(& git diff --name-only --no-renames $ac083Base) + @(& git ls-files --others --exclude-standard)
$ac083Outside = @($ac083Changed | Where-Object { $_ -and $_ -notmatch '^\.collab/' } | Where-Object {
  $_ -notmatch '^test/integration/cross-process-write\.test\.mjs$' -and
  $_ -notmatch '^test/fixtures/store/' -and
  $_ -notmatch '^test/traceability/T-040\.json$'
})
if ($ac083Outside.Count -ne 0) { throw ('AC-083 changes outside write_scope: ' + ($ac083Outside -join ', ')) }
Write-Output 'AC-083 OK'
```

- 期望输出：退出码 0，最后一行 `AC-083 OK`。`lib/` 有任何改动、既有并发测试资产被改、或出现写域之外的路径，都判失败。

追溯与测试发现：T-040 的 shard 声明 AC-083 已覆盖并指向存在的测试文件，仓库既有的追溯检查与测试发现检查保持通过。

```pwsh
$ErrorActionPreference = 'Stop'
$ac083Trace = @'
import assert from 'node:assert/strict';
import fs from 'node:fs';
const shard = JSON.parse(fs.readFileSync('test/traceability/T-040.json', 'utf8'));
assert.equal(shard.task, 'T-040');
assert.equal(Object.prototype.hasOwnProperty.call(shard, 'baseline'), false);
const entries = shard.entries.filter(e => e.ac === 'AC-083');
assert.equal(entries.length, 1);
assert.equal(entries[0].status, 'covered');
assert.ok(entries[0].files.includes('test/integration/cross-process-write.test.mjs'));
for (const file of entries[0].files) assert.ok(fs.existsSync(file), file + ' is missing');
console.log('AC-083 OK');
'@
$ac083Trace | node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'AC-083 traceability shard is wrong' }
node scripts/check-traceability.mjs
if ($LASTEXITCODE -ne 0) { throw 'AC-083 check-traceability failed' }
node scripts/check-test-discovery.mjs
if ($LASTEXITCODE -ne 0) { throw 'AC-083 check-test-discovery failed' }
Write-Output 'AC-083 OK'
```

- 期望输出：退出码 0；`check-traceability: ok (...)` 与 `check-test-discovery: ok` 均出现，最后一行 `AC-083 OK`。

## AC-006 既有单元测试不得被破坏

brief 要求保留的回归门禁：既有单元测试全部通过，本任务不得引入回归。

```pwsh
$ErrorActionPreference = 'Stop'
node --test "test/unit/*.test.mjs"
if ($LASTEXITCODE -ne 0) { throw 'existing unit tests broken' }
Write-Output 'AC-006 OK'
```

- 期望输出：退出码 0，既有单元测试全绿，最后一行 `AC-006 OK`。

项目完成前检查（见全局约定）：`scripts/check-fast.ps1` 全部通过。

```pwsh
$ErrorActionPreference = 'Stop'
pwsh -NoProfile -File 'scripts/check-fast.ps1'
if ($LASTEXITCODE -ne 0) { throw 'project check-fast failed' }
Write-Output 'AC-006 OK'
```

- 期望输出：退出码 0，最后一行 `AC-006 OK`。
