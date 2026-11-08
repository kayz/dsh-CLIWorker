# Task 015 — Provider 夹具：fake-cli 生成器（11 个已知、1 个未知、6 种模式）

## AC-035

规格为本目录 design.md 的目标、约束与建议验收方向，层级 integration。brief 未给本任务基准 commit SHA 或既有验收报告路径，不引用其他任务基准。以下是一个完整独立命令，用 PowerShell 7 从任意目录运行。

命令：

```pwsh
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'C:/git/dsh-CLIWorker/.collab/worktrees/015'
$ac035 = @'
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const file = 'test/integration/fake-cli.test.mjs';
const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
delete env.CLIWORKER_RUN_ACTIVE;
delete env.CLIWORKER_RESULTS_DIR;
const run = (args) => {
  const result = spawnSync(process.execPath, args, {
    cwd: root, env, encoding: 'utf8', windowsHide: true,
    timeout: 180000, maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(Boolean(result.error), false, 'child process must start and finish');
  assert.equal(result.status, 0, 'child process must exit successfully');
  return result.stdout;
};
assert.deepEqual(
  JSON.parse(fs.readFileSync('test/traceability/T-015.json', 'utf8')),
  { task: 'T-015', milestone: 'M2', entries: [
    { ac: 'AC-035', files: [file], status: 'covered' },
  ] },
);
const tap = run(['--test', '--test-reporter=tap', file]);
assert.match(tap, /^# tests [1-9][0-9]*\r?$/m);
for (const item of ['fail', 'cancelled', 'skipped', 'todo']) {
  assert.match(tap, new RegExp('^# ' + item + ' 0\\r?$', 'm'));
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ac035-'));
try {
  const output = run(['scripts/run-tests.mjs', '--ac', 'AC-035', '--out-dir', dir]);
  assert.match(output, /run-tests: filtered 1 files, manifest /);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'files-executed.json'), 'utf8'));
  assert.equal(manifest.mode, 'filtered');
  assert.equal(manifest.filter, 'AC-035');
  assert.equal(manifest.platform, process.platform);
  assert.deepEqual(manifest.files, [file]);
  assert.equal(fs.readFileSync(path.join(dir, 'skips.jsonl'), 'utf8').trim(), '');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('AC-035 OK');
'@
$ac035 | node --input-type=module
if ($LASTEXITCODE -ne 0) { throw 'AC-035 failed' }
```

期望输出：退出码 0，stdout 包含独立一行 `AC-035 OK`；任一步失败不得打印成功标记。正式运行确实执行且仅发现 test/integration/fake-cli.test.mjs，清单 mode=filtered、filter=AC-035、platform 为当前平台，跳过日志为空；直接 node:test 执行至少一例，fail、cancelled、skipped、todo 全为 0；T-015 分片与命令中既有结构深相等。报告仅在独立系统临时目录生成并清理，不依赖之前的报告。

测试文件必须实际断言 design.md 所列行为：12 个名称乘六种模式全部真实执行；三种输出可配置且实例隔离；平台垫片可执行；空格/中文路径、cwd 和非秘密 argv 原样往返；envNames、值的 SHA-256 正确且全部受检表面无哨兵原文；timeout 在记录屏障后取消并返回 E_TIMEOUT，清理进程及定时器；并发记录无丢失或损坏；空目录及损坏记录读取结果明确。只查文件存在、只跑一个 CLI、模拟 spawn 代替真实执行、用被测实现生成预期、吞掉断言或缺少上述覆盖，均不满足 AC-035。成功不依赖具体测试标题全文或固定例数。
