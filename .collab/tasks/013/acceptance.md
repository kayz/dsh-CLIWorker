# Task 013 — 用户提供令牌的密钥管理：SecretRef、OS 后端、只经 env 注入

本轮 option 1 已批准，范围以修订后的 design.md YAML 为准；此前 CLI/exec 范围阻塞已解除。brief 没有基准 commit SHA 或既有验收报告路径。以下是下游实现的验收命令，不表示当前实现已经通过。

每个代码块是一条完整、独立的 PowerShell 7 验收命令，可在仓库根或系统临时目录执行，不依赖另一条命令的产物。Node 20+；失败立即非零退出，只在所有断言成立后输出成功标记。为遵守本轮只能写两份文档的限制，命令直接在文档内给出，不生成 .ps1 文件。本设计阶段不执行测试、报告或 check-fast。

测试标题约束只用于确保下列覆盖不会被空测试、漏注册或 skip 隐藏，不新增产品字段、版本或章节。每个列出的标题须对应实际行为断言；禁止只有 mock 调用次数、仅检查变量名、预填正确 env 或直接调用 auth 模块后宣称真实 CLI 通过。

## AC-032 用户令牌只经适配器声明的环境变量注入

命令：

```pwsh
node --input-type=module --eval @'
import a from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root = 'C:/git/dsh-CLIWorker/.collab/worktrees/013';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ac032-'));
const env = {...process.env};
for (const key of ['NODE_TEST_CONTEXT', 'CLIWORKER_RESULTS_DIR', 'CLIWORKER_RUN_ACTIVE']) delete env[key];
const run = args => {
  const r = spawnSync(process.execPath, args, {cwd:root, env, encoding:'utf8', windowsHide:true, timeout:300000, maxBuffer:64*1024*1024});
  a.ok(!r.error, 'child launch failed');
  a.equal(r.signal, null, 'child interrupted');
  a.equal(r.status, 0, 'child command failed');
  return r.stdout;
};
const count = (tap, key) => {
  const line = tap.split(/\r?\n/).map(s => s.trim()).find(s => s.startsWith('# '+key+' '));
  a.ok(line, 'missing TAP total '+key);
  const value = Number(line.split(' ').at(-1));
  a.ok(Number.isInteger(value) && value >= 0, 'invalid TAP total');
  return value;
};
const check = tap => {
  a.ok(count(tap, 'pass') > 0, 'no passing tests');
  for (const key of ['fail', 'cancelled', 'skipped', 'todo']) a.equal(count(tap, key), 0, 'nonpassing tests: '+key);
};
try {
  const file = 'test/integration/secrets-native.test.mjs';
  const tap = run(['--test', '--test-reporter=tap', '--test-name-pattern=AC-032', root+'/'+file]);
  check(tap);
  const titles = [
    '[AC-032] from-env persists across processes and injects declared env only',
    '[AC-032] stdin persists across processes and injects declared env only',
    '[AC-032] default ref overwrite and state_dir isolation',
    '[AC-032] clear prevents consumption and backend failure preserves files',
    '[AC-032] auth flow uses real CLI and scans all surfaces'
  ];
  const lines = tap.split(/\r?\n/).map(s => s.trim());
  for (const title of titles) a.ok(lines.some(s => /^ok \d+ - /.test(s) && s.endsWith(' - '+title)), 'missing passed test: '+title);
  const reports = path.join(temp, 'reports');
  const out = run([root+'/scripts/run-tests.mjs', '--ac', 'AC-032', '--out-dir', reports]);
  a.ok(out.includes('run-tests: filtered 1 files'), 'unexpected discovery');
  a.ok(!out.includes('FAIL'), 'runner failure');
  const m = JSON.parse(fs.readFileSync(path.join(reports, 'files-executed.json'), 'utf8'));
  a.equal(m.mode, 'filtered');
  a.equal(m.filter, 'AC-032');
  a.deepEqual(m.files, [file]);
  a.equal(fs.readFileSync(path.join(reports, 'skips.jsonl'), 'utf8').trim(), '', 'baseline recorded skips');
  const t = JSON.parse(fs.readFileSync(root+'/test/traceability/T-013.json', 'utf8'));
  a.deepEqual(Object.keys(t).sort(), ['entries','milestone','task']);
  a.equal(t.task, 'T-013');
  a.equal(t.milestone, 'M2');
  a.deepEqual(t.entries.map(e => e.ac).sort(), ['AC-032','AC-033']);
  const e = t.entries.find(e => e.ac === 'AC-032');
  a.deepEqual(Object.keys(e).sort(), ['ac','files','status']);
  a.equal(e.status, 'covered');
  a.deepEqual(e.files, [file]);
  check(run(['--test', '--test-reporter=tap', root+'/test/flows/flow.test.mjs', root+'/test/integration/cli-envelope.test.mjs']));
  console.log('AC-032 OK');
} finally {
  fs.rmSync(temp, {recursive:true, force:true});
}
'@
if ($LASTEXITCODE -ne 0) { throw 'AC-032 failed' }
```

期望输出：退出码 0，stdout 最后一行恰为 `AC-032 OK`；缺文件、无匹配、标题未通过、任何 fail/cancelled/skipped/todo、runner 失败、发现清单/追踪不符或回归失败均非零，不能打印成功标记。直接集成、共享 flow 和 CLI envelope 回归均至少一例通过。正式 runner 清单必须为 filtered / AC-032，只含上述 integration 文件，跳过账本为空；追踪为 T-013 / M2、本 AC covered。报告使用独立 TEMP 目录并 finally 清理。

上述标题对应的必要断言：

- `from-env persists across processes and injects declared env only`：经真实 bin 执行 `auth set kimi --from-env SENTINEL --config <隔离配置>`，退出码 0 且仅输出安全单 JSON。set 进程退出后，新进程 status 为 set；另一个不含来源哨兵的新进程调用生产 runWithSecrets，fake-cli 的 KIMI_API_KEY SHA-256 等于输入哨兵 SHA-256，其他变量和 argv 无哨兵。不是将 env:SENTINEL 引用保存下来，也不是沿用 set 进程的内存。
- `stdin persists across processes and injects declared env only`：真实 bin 的 `auth set kimi --config <隔离配置>` 从 flow.run 的 input 接收哨兵，覆盖无换行及 LF/CRLF 结束；独立 status/消费进程不接收哨兵 input 或来源 env，仍取得正确摘要。后端经生产 exec input 接收值，不进 argv。
- `default ref overwrite and state_dir isolation`：显式 keychain ref 和未配 ref 的默认路径均能跨进程消费；同一条目再次 set 后只有新值可见；不同 state_dir、不同条目互不覆盖。配置文件保持原字节，禁止增加凭据字段或写入秘密。
- `clear prevents consumption and backend failure preserves files`：独立 clear 进程成功后新 status 为 unset，重复 clear 仍 unset；消费报 E_SECRET_BACKEND，fake provider 未启动。模拟工具 ENOENT、非零退出及后端不可用时，真实 CLI 返回 E_SECRET_BACKEND、退出码 3，不回显后端秘密；原本不存在的 state_dir 仍不存在，已有文件递归列表及字节保持不变。
- `auth flow uses real CLI and scans all surfaces`：确实调用允许的 auth step，元数据符合现有 harness；分别在两种 set、消费及 clear 后执行 flow.scan，并以 flow.root 另扫文件，全部 ok=true、hits=[]、errors=[]。捕获 stdout/stderr/argv/HTTP/state_dir/audit，扫描配置、preload、替身密文、fake-cli 记录；raw/UTF-16LE/base64/hex 零命中。测试源码、断言消息、TAP 及扫描诊断不含秘密。

这些测试在 darwin/linux/win32 必跑，按 design 的测试 preload 隔离 OS 后端，不能依赖真实 pwsh/security/secret-tool 或密钥环会话。替身只模拟 OS 操作，不替换 auth、exec input、生产引用解析/定位和消费逻辑；磁盘仅密文，不保存测试密钥。源哨兵和替身密钥不传给 fake provider。附加原生测试默认不注册，不产生 baseline skip；缺少上述断言即使命令退出 0 也不构成 AC 覆盖，评审核对实际测试代码。

## AC-033 配置明文拒载、后端失败与凭据状态

命令：

```pwsh
node --input-type=module --eval @'
import a from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root = 'C:/git/dsh-CLIWorker/.collab/worktrees/013';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-ac033-'));
const env = {...process.env};
for (const key of ['NODE_TEST_CONTEXT', 'CLIWORKER_RESULTS_DIR', 'CLIWORKER_RUN_ACTIVE']) delete env[key];
const run = args => {
  const r = spawnSync(process.execPath, args, {cwd:root, env, encoding:'utf8', windowsHide:true, timeout:300000, maxBuffer:64*1024*1024});
  a.ok(!r.error, 'child launch failed');
  a.equal(r.signal, null, 'child interrupted');
  a.equal(r.status, 0, 'child command failed');
  return r.stdout;
};
const count = (tap, key) => {
  const line = tap.split(/\r?\n/).map(s => s.trim()).find(s => s.startsWith('# '+key+' '));
  a.ok(line, 'missing TAP total '+key);
  const value = Number(line.split(' ').at(-1));
  a.ok(Number.isInteger(value) && value >= 0, 'invalid TAP total');
  return value;
};
const check = tap => {
  a.ok(count(tap, 'pass') > 0, 'no passing tests');
  for (const key of ['fail', 'cancelled', 'skipped', 'todo']) a.equal(count(tap, key), 0, 'nonpassing tests: '+key);
};
try {
  const file = 'test/unit/secrets.test.mjs';
  const tap = run(['--test', '--test-reporter=tap', root+'/'+file]);
  check(tap);
  const titles = [
    '[AC-033] recursive inline secret detection preserves config compatibility',
    '[AC-033] env and session isolation',
    '[AC-033] win32 backend stdin and failure atomicity',
    '[AC-033] darwin backend stdin and failure atomicity',
    '[AC-033] linux backend stdin and failure atomicity',
    '[AC-033] auth input status and errors',
    '[AC-033] exec sync async input EOF and EPIPE',
    '[AC-033] auth routes preserve other routing and context',
    '[AC-033] consumer scrubs source env and redacts failures'
  ];
  const lines = tap.split(/\r?\n/).map(s => s.trim());
  for (const title of titles) a.ok(lines.some(s => /^ok \d+ - /.test(s) && s.endsWith(' - '+title)), 'missing passed test: '+title);
  const reports = path.join(temp, 'reports');
  const out = run([root+'/scripts/run-tests.mjs', '--ac', 'AC-033', '--out-dir', reports]);
  a.ok(out.includes('run-tests: filtered 1 files'), 'unexpected discovery');
  a.ok(!out.includes('FAIL'), 'runner failure');
  const m = JSON.parse(fs.readFileSync(path.join(reports, 'files-executed.json'), 'utf8'));
  a.equal(m.mode, 'filtered');
  a.equal(m.filter, 'AC-033');
  a.deepEqual(m.files, [file]);
  a.equal(fs.readFileSync(path.join(reports, 'skips.jsonl'), 'utf8').trim(), '', 'unit tests recorded skips');
  const t = JSON.parse(fs.readFileSync(root+'/test/traceability/T-013.json', 'utf8'));
  a.deepEqual(Object.keys(t).sort(), ['entries','milestone','task']);
  a.equal(t.task, 'T-013');
  a.equal(t.milestone, 'M2');
  a.deepEqual(t.entries.map(e => e.ac).sort(), ['AC-032','AC-033']);
  const e = t.entries.find(e => e.ac === 'AC-033');
  a.deepEqual(Object.keys(e).sort(), ['ac','files','status']);
  a.equal(e.status, 'covered');
  a.deepEqual(e.files, [file]);
  check(run(['--test', '--test-reporter=tap', ...[
    'test/unit/config.test.mjs',
    'test/unit/config-v2.test.mjs',
    'test/unit/paths.test.mjs',
    'test/unit/exec.test.mjs'
  ].map(f => root+'/'+f)]));
  console.log('AC-033 OK');
} finally {
  fs.rmSync(temp, {recursive:true, force:true});
}
'@
if ($LASTEXITCODE -ne 0) { throw 'AC-033 failed' }
```

期望输出：退出码 0，stdout 最后一行恰为 `AC-033 OK`。secrets 纯单测和 config/config-v2/paths/exec 回归各次运行至少一例通过，fail/cancelled/skipped/todo 全为 0；九个标题全部真实通过。正式清单为 filtered / AC-033，只含 secrets 单测，跳过账本为空；追踪为 T-013 / M2、本 AC covered。任何子进程、标题、汇总或追踪不符均非零，不输出成功标记；报告使用本命令独立 TEMP 目录并清理。

上述标题对应的必要断言：

- `recursive inline secret detection preserves config compatibility`：token/api_key/secret/password 的大小写、复合键、深层对象、数组内对象的字符串值均拒绝；裸 env:NAME 字符串拒绝；合法 ref 对象通过；非字符串不被误判为此错误；错误 E_CONFIG_SECRET_INLINE、退出映射 3、retryable=false，消息无原值。保留 v1/v2、路径、示例拒载与迁移兼容行为。
- `env and session isolation`：env 存在/缺失与只读语义，session set/get/clear 和独立 ctx/新进程隔离；不改 ctx.env，不把 session 标为持久化。配置 ref 优先于默认 keychain；env 的 set/clear 明确失败，不触碰后端或磁盘。
- 三条 `<platform> backend stdin and failure atomicity`：无论宿主平台，分别注入 win32、darwin、linux 检查 set/get/status/clear 的实际命令、必要参数、shell=false、input 内容与 argv 无秘密。pwsh/security/secret-tool 各自 ENOENT 和普通失败返回 E_SECRET_BACKEND、退出映射 3；已有文件字节/递归列表不变、缺省目录不创建。Windows 验证 DPAPI 成功前无写入及密文替换；macOS 验证 stdin 引号/反斜杠/换行攻击不生成额外命令；Linux 验证 store 走 stdin；真实“无条目”与不可访问分别为 unset 和错误。
- `auth input status and errors`：两种输入成功、缺/空变量、空 stdin、换行处理、缺 cli、未知选项、缺选项值、多余位置参数；错误 E_REQUEST_INVALID、退出映射 2 且存储不调用。status 只含既有成功包装和 set/unset，clear 后 unset；后端错误不伪装 unset；任何错误/成功体都不含值、长度或摘要。
- `exec sync async input EOF and EPIPE`：同步 input 完整透传；异步有 input 时 pipe/end，空串同样 EOF，无 input 保持 ignore；处理 EPIPE、同步写入异常和 spawn 失败，无未处理异常/秘密回显；promise 仅收敛一次，计时器清理、并发槽释放；现有超时、shell=false 和回退不变。测试放在允许的 secrets 单测，不修改现有 exec 测试。
- `auth routes preserve other routing and context`：main 的真实分发表能到三个 auth run，未知 auth 子命令仍 E_UNKNOWN_COMMAND；原有路由走原模块、配置加载与输出路径不变；createContext 的成员集合与 contracts/context/context.v1.json 一致，无 stdin 或新秘密成员。代码评审另确认 lib/cli.mjs 仅 auth import/条目/分支，lib/exec.mjs 仅 input 所需改动。
- `consumer scrubs source env and redacts failures`：调用真实 runWithSecrets，经注入 exec 断言仅声明的 env_names 有秘密，来源变量和同值别名已删除（含 win32 大小写别名）；基础环境、call、config、ctx.env 不变；空 env_names 不解析秘密；缺凭据不执行 provider；后端/provider stdout/stderr/error 含秘密时，对外结果已脱敏。

这些纯单测不调用宿主真实密钥工具，不因非 Linux 或工具缺失 skip；正式源码选择标记 [AC-033] 只放 secrets 单测，不放附加原生测试。评审须核对行为断言，不能由标题或退出码单独替代覆盖。

下游完成前另执行项目既有检查，作为独立命令：

```pwsh
pwsh -NoProfile -File C:/git/dsh-CLIWorker/.collab/worktrees/013/scripts/check-fast.ps1
if ($LASTEXITCODE -ne 0) { throw 'check-fast failed' }
```

期望输出：退出码 0，stdout 包含独立一行 `check-fast: ok`，没有 `check-fast: test injection active`。不覆盖 CLIWORKER_TEST_CHECK_DIR/CLIWORKER_TEST_FINAL_SCRIPT 来跳过真实检查。不把原生附加 skip 当 AC baseline 通过。本设计角色不执行该检查：它会间接执行 git 并创建报告，违反本轮角色限制。
