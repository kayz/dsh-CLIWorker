---
task: T-011
milestone: M2
write_scope:
  - lib/store.mjs
  - lib/lock.mjs
  - lib/audit.mjs
  - lib/redact.mjs
  - test/unit/store.test.mjs
  - test/unit/lock.test.mjs
  - test/unit/redact.test.mjs
  - test/unit/audit.test.mjs
  - test/integration/store-concurrency.test.mjs
  - test/fixtures/store/**
  - test/traceability/T-011.json
---

# Task 011 设计：状态存储、文件锁、审计日志与脱敏

## 1. 范围与依据

- 交付 `lib/store.mjs`、`lib/lock.mjs`、`lib/audit.mjs`、`lib/redact.mjs` 四个模块，及其单测、集成测试、夹具和追踪分片。
- 覆盖 AC-029（unit + integration）和 AC-030（unit）。属主和层级以 `contracts/spec/ac-index.json` 为准：两条均属 T-011，里程碑 M2，baseline 为 darwin / linux / win32。
- 规格来源：`.collab/blueprint/cliworker-v2/` 下的 `design.md`（第 3 节时钟、第 8 节可靠性）、`interfaces.md`（第 5 节注册表、第 11 节 `policy.lock_*`、第 16 节 ctx 与时钟）、`task-graph.json`（T-011、AC-029、AC-030）。仓库内的代码、测试、文档不得出现 `.collab` 字样（`scripts/check-no-collab.mjs`）。
- 不改动 write_scope 之外的任何文件。不迁移 `lib/config.mjs` 里已有的 `readUsage`、`appendUsage`、`ensureDir`，也不接入 `lib/commands/**`；这些由后续任务按需调用新模块。
- 零第三方运行时依赖，Node 20+，ESM。

## 2. 仓库现状（已核对，基线 HEAD 040d2e9）

1. `lib/context.mjs` 的 ctx 成员固定为 `exec, fs, fetch, env, platform, stdout, stderr, random, clock, now`，不得扩展（`contracts/context/context.v1.json`）。`ctx.fs` 只保证 9 个方法：`readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, statSync, readdirSync, renameSync, rmSync`。四个新模块只能调用这 9 个方法。
2. `ctx.clock` 提供 `now()`、`nowIso()`、`setTimeout`、`clearTimeout`、`sleep(ms)`。伪时钟 `test/helpers/clock.mjs` 另有 `setNow`、`advance`、`pending`，`sleep` 只随 `advance` 前进。
3. `scripts/check-seams.mjs`：只有 `lib/context.mjs`、`lib/store.mjs`、`lib/fsx.mjs` 可以导入 `node:fs`；不带参数的 `Date.now` / `new Date`、全局 `setTimeout` / `setInterval` / `setImmediate`、`node:timers` 只允许在 `lib/context.mjs`。所以：
   - `lib/lock.mjs`、`lib/audit.mjs`、`lib/redact.mjs` 不导入 `node:fs`，也不碰任何时间原语，一律用 `ctx.fs` 和 `ctx.clock`。
   - `lib/store.mjs` 同样优先用 `ctx.fs`；除非确有必要，不导入 `node:fs`。
4. `scripts/check-unused.mjs` 会报告未使用的导入和未导出且未被引用的顶层函数。内部辅助函数必须被用到，否则导出或删除。
5. `test/helpers/ctx.mjs` 的 `fakeFs` 不支持 `{flag:'wx'}`（写已存在文件不会抛 EEXIST），没有 `mtimeMs`，不能直接用来测锁。`test/helpers/**` 不在 write_scope，所以本任务在 `test/fixtures/store/` 下自备内存文件系统（见第 8 节）。
6. 错误一律用 `lib/output.mjs` 的 `codedError(code, message, extra)` 构造。`E_STATE_LOCKED` 在注册表里是 exit 4、HTTP 503、`retryable:false`、`trigger_id: state_lock_timeout`；不要在抛出处覆盖 `retryable`，以注册表为准。
7. `.gitignore` 含 `*.jsonl` 和 `state/`：本任务不得把 `.jsonl` 文件作为夹具提交，所有 JSONL 在测试运行时于临时目录生成。
8. `scripts/run-tests.mjs --ac AC-xxx` 只挑选源码里包含 `[AC-xxx]` 的 `*.test.mjs`。`scripts/check-traceability.mjs` 还要求分片所列文件中至少一个纯字符串字面量的测试标题包含 `[AC-xxx]`。开工前的基线：`check-traceability: ok (covered=28 planned=46)`、`check-seams: ok (files=26)`。

## 3. `lib/redact.mjs`

导出：

| 名称 | 说明 |
|---|---|
| `REDACTED` | 常量字符串 `'[REDACTED]'` |
| `redactString(text, secrets = [])` | 对一个字符串打码，返回新字符串 |
| `redact(value, { secrets = [] } = {})` | 深度打码任意值，返回新值，不修改入参 |
| `createSecretRegistry()` | 返回 `{ add(value), list(), redact(value) }`；`add` 登记密钥值，`redact` 等价于 `redact(value, { secrets: list() })` |

规则（按顺序应用于每个字符串）：

1. **已登记的密钥值**：精确子串替换为 `[REDACTED]`，替换全部出现位置。忽略非字符串和空串；去重；按长度从长到短替换，避免短值切碎长值。
2. **`sk-` 前缀**：正则 `(?<![A-Za-z0-9_])sk-[A-Za-z0-9_-]{8,}`，整段替换。左边界断言保证 `task-description-long` 之类普通词不被误伤。
3. **Bearer**：正则 `\bBearer\s+[A-Za-z0-9._~+/-]+=*`，不区分大小写，替换为「原样的 Bearer 字样 + 一个空格 + `[REDACTED]`」。
4. **JWT（三段 base64url）**：正则 `(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+`，整段替换。第一段限定 `eyJ` 开头（JWT 头部 JSON 的 base64url 固定前缀），否则 `config.example.json` 这类三段文件名会被误伤。

值的遍历：

- 字符串：按上述规则处理。
- 数组、普通对象：递归；对象的键也走字符串打码；返回新对象。
- `Error` 实例：转成普通对象 `{ name, message }`，若存在 `code` 则带上；`message` 走字符串打码。不输出 `stack`。这样 `error.message` 里的密钥也会被打掉。
- 循环引用：命中已访问对象时输出字符串 `'[Circular]'`。
- number、boolean、null、undefined 原样返回。
- 入参永不被修改。

## 4. `lib/store.mjs`

只经 `ctx.fs` 和 `ctx.clock` 工作，文本一律 UTF-8 无 BOM。导出：

| 名称 | 行为 |
|---|---|
| `ensureDir(ctx, dir)` | `ctx.fs.mkdirSync(dir, { recursive: true })`，返回 `dir` |
| `readJson(ctx, file, fallback)` | 读并解析；文件不存在（`ENOENT`）返回 `fallback`（缺省 `null`）；其他读错误和解析错误原样抛出 |
| `atomicWriteJson(ctx, file, value)` | `async`；见下 |
| `appendJsonl(ctx, file, row)` | 见下 |
| `readJsonl(ctx, file, { skipInvalid = false } = {})` | 见下 |
| `RENAME_RETRY_DELAYS_MS` | `[10, 20, 40, 80, 160]` |

**`atomicWriteJson`：**

1. `ensureDir(path.dirname(file))`。
2. 序列化为 `JSON.stringify(value, null, 2) + '\n'`。`value` 为 `undefined` 或不可序列化时抛 `TypeError`，此时尚未触碰文件系统。
3. 在目标同一目录写临时文件，名称 `<file>.<random>.tmp`，`<random>` 来自 `ctx.random()`（转 base36 取小数部分）。用 `ctx.fs.writeFileSync(tmp, text, 'utf8')`。
4. `ctx.fs.renameSync(tmp, file)` 替换目标。
5. 任何一步抛错：先尽力 `ctx.fs.rmSync(tmp, { force: true })` 清理临时文件（清理本身的错误吞掉），再把原始错误原样抛出。**目标文件的字节在失败时保持不变**。
6. Windows 重试：仅当 `ctx.platform === 'win32'` 且 `renameSync` 抛出的 `error.code` 为 `EPERM`、`EACCES` 或 `EBUSY` 时，按 `RENAME_RETRY_DELAYS_MS` 依次 `await ctx.clock.sleep(delay)` 后重试，最多重试 5 次；用尽后抛出最后一次的错误（并按第 5 点清理）。其他平台、其他错误码不重试。
7. 不做 fsync（`ctx.fs` 没有该方法），崩溃耐久性不在本任务承诺范围内；本任务承诺的是「读者永远看到完整的旧版本或完整的新版本」。

**`appendJsonl`：**

- `ensureDir` 后只做**一次** `ctx.fs.appendFileSync(file, JSON.stringify(row) + '\n', 'utf8')`。
- `row` 为 `undefined` 或序列化结果不是字符串时抛 `TypeError`，且不触碰文件。
- 不加锁。多进程同时追加的完整性靠「单次追加写入一整行」保证（`O_APPEND` / Windows 追加语义）；`JSON.stringify` 的输出里不会出现原始换行，所以一行就是一条记录。
- 返回 `undefined`。

**`readJsonl`：**

- 文件不存在返回 `[]`。
- 按 `\r?\n` 切分，忽略空行，逐行 `JSON.parse`。
- 默认遇到无法解析的行抛 `SyntaxError`，消息里带行号（从 1 开始）；`skipInvalid:true` 时丢弃坏行继续。

## 5. `lib/lock.mjs`

只用 `ctx.fs`、`ctx.clock`、`ctx.random`、`lib/output.mjs`。导出：

| 名称 | 说明 |
|---|---|
| `LOCK_DEFAULTS` | `{ lock_stale_ms: 30000, lock_wait_ms: 5000, lock_poll_ms: 50 }`，与 interfaces 第 11 节 `policy` 默认值一致 |
| `lockFilePath(stateDir, name = 'state')` | 返回 `path.join(stateDir, name + '.lock')`；`name` 必须匹配 `^[A-Za-z0-9._-]+$`，否则抛 `TypeError` |
| `isPidAlive(pid)` | 默认实现：`process.kill(pid, 0)`；成功返回 `true`；抛 `ESRCH` 返回 `false`；抛 `EPERM` 返回 `true`；`pid` 不是正整数返回 `false` |
| `acquireLock(ctx, lockPath, options)` | `async`，返回 `{ release() }` |
| `withLock(ctx, lockPath, fn, options)` | `async`，持锁执行 `fn`，无论成败都释放 |

`options`：`{ policy, pid, isPidAlive }`。

- `policy` 取自配置的 `policy` 对象，只读 `lock_stale_ms`、`lock_wait_ms`、`lock_poll_ms`，缺的用 `LOCK_DEFAULTS`。
- `pid` 缺省 `process.pid`；`isPidAlive` 缺省用上面导出的默认实现。两者是为测试注入的，ctx 不扩展。

**锁文件内容**：JSON `{ "pid": <number>, "at": <ctx.clock.now() 毫秒>, "token": "<唯一串>" }`，`token` 由 `pid`、`at` 与 `ctx.random()` 拼成。创建方式 `ctx.fs.writeFileSync(lockPath, text, { encoding: 'utf8', flag: 'wx' })`，已存在时抛 `EEXIST`。创建前 `ensureDir` 锁文件所在目录。

**`acquireLock` 算法**（`waitMs = lock_wait_ms`，`pollMs = lock_poll_ms`，`staleMs = lock_stale_ms`）：

```
start = ctx.clock.now()
loop:
  尝试 wx 创建锁文件
    成功 → 返回句柄
    EEXIST → 继续；其他错误 → 原样抛出
  读取现有锁文件并解析（读失败 ENOENT → 立即回到 loop 顶部重试，不计重试）
  判定：
    死锁：解析出 pid 且 !isPidAlive(pid)                    → 回收，立即回到 loop 顶部
    陈旧：heldSince 已知 且 ctx.clock.now() - heldSince > staleMs → 回收，立即回到 loop 顶部
      heldSince = 解析出的 at（有限数）；否则 statSync(lockPath).mtimeMs（有限数）；否则未知（未知按活锁处理）
  否则（活锁且未陈旧）：
    若 ctx.clock.now() - start >= waitMs → 抛 E_STATE_LOCKED
    await ctx.clock.sleep(pollMs)；retries += 1；回到 loop 顶部
```

要点：

- **重试次数**定义为「`ctx.clock.sleep(pollMs)` 的调用次数」。对活锁，它恰好等于 `ceil(lock_wait_ms / lock_poll_ms)`：例如 5000/50 → 100；120/50 → 3；100/50 → 2。最后一次睡眠之后仍会再尝试一次创建，失败才抛错。
- 死锁和陈旧回收**不调用 sleep、不消耗虚拟时间**。
- 陈旧用严格大于：`age == lock_stale_ms` 时仍是活锁，`age == lock_stale_ms + 1` 才回收。
- 内容为空或无法解析的锁文件（持有者刚 `wx` 创建、尚未写入内容的瞬间）不当作死锁；只有 `statSync().mtimeMs` 可用且超过 `staleMs` 才回收，`mtimeMs` 不可用时一律按活锁等待。
- 回收动作：`ctx.fs.renameSync(lockPath, lockPath + '.stale-' + <唯一串>)`，成功后读该墓碑文件核对 `token`：
  - 与刚才判定陈旧时读到的 `token` 一致 → `rmSync(墓碑, { force: true })`，继续尝试创建；
  - 不一致（抢走了别人刚创建的新锁）→ 尽力恢复：若 `existsSync(lockPath)` 为假则把墓碑改名回 `lockPath`，否则删除墓碑；然后按活锁路径处理。
  - `renameSync` 抛 `ENOENT`（别人已先回收）→ 直接继续循环；其他错误原样抛出。
  - 残余竞态（核对到恢复之间的极窄窗口）接受，由「释放时校验 token」兜底。
- **`E_STATE_LOCKED`** 通过 `codedError('E_STATE_LOCKED', '<含锁文件路径和 wait 毫秒数的消息>')` 抛出，不覆盖 `retryable`。消息中不得出现锁文件内容以外的敏感信息。
- **释放**：`release()` 读锁文件，仅当 `token` 等于自己的才 `rmSync(lockPath, { force: true })`；文件不存在或 token 不同则什么都不做；幂等；不抛错（尽力而为）。
- **`withLock`**：`const h = await acquireLock(...)`，`try { return await fn() } finally { await h.release() }`。`fn` 的异常原样向上抛。

## 6. `lib/audit.mjs`

只用 `ctx.fs`（经 `lib/store.mjs` 的 `appendJsonl` / `readJsonl`）、`ctx.clock.nowIso()` 和 `lib/redact.mjs`。导出：

| 名称 | 说明 |
|---|---|
| `AUDIT_FILE` | `'audit.jsonl'` |
| `AUDIT_ENTRIES` | `['cli', 'http']` |
| `AUDIT_ACTIONS` | `['select', 'lease', 'run', 'probe', 'allow', 'deny', 'level', 'secret_set']`，对应需求里「select、lease、run、probe、白名单与等级变更、密钥设置」：白名单变更拆成 `allow` / `deny`，等级变更为 `level`，密钥设置为 `secret_set` |
| `AUDIT_RESULTS` | `['ok', 'error']` |
| `auditPath(stateDir)` | `path.join(stateDir, AUDIT_FILE)` |
| `writeAudit(ctx, stateDir, event, { secrets = [] } = {})` | 写一行并返回写入的行对象 |
| `readAudit(ctx, stateDir)` | `readJsonl(ctx, auditPath(stateDir))` |

`event`：`{ entry, action, result, code?, detail? }`。

- 行对象字段顺序：`at`（`ctx.clock.nowIso()`）、`entry`、`action`、`result`，然后在提供时依次加 `code`（字符串）、`detail`（任意可 JSON 化的值）。不增加其他字段，不加 schema 字段。
- 校验：`entry` 必须在 `AUDIT_ENTRIES`，`action` 在 `AUDIT_ACTIONS`，`result` 在 `AUDIT_RESULTS`；否则抛 `TypeError`，且不写文件。
- 落盘前整行经 `redact(row, { secrets })`；`detail` 里的嵌套对象、`Error` 实例（其 `message`）都会被打码。`secrets` 为已登记的密钥值列表。
- 每次调用恰好追加一行，调用方每发生一次可审计动作就调用一次。接线（在 select、lease、run、probe、allow/deny、level、secret set 的命令里调用）不在本任务内。
- 审计写失败时 `writeAudit` 抛出原始错误；是否中断主流程由调用方决定。
- **泄露检查**：T-012 才交付共享 leak-scan harness，T-011 不能依赖它。本任务的 AC-030 用测试内的最小 leak 检查：把 `audit.jsonl` 的全文读成字符串，断言不包含任何已登记密钥值（以及 sk-、Bearer、JWT 样本的明文）。该检查写在 `test/unit/audit.test.mjs` 内。

## 7. 与现有代码的关系

- 新模块无反向依赖：`store.mjs` 不依赖 `lock.mjs`；`lock.mjs` 只依赖 `output.mjs` 和 `node:path`；`audit.mjs` 依赖 `store.mjs`、`redact.mjs`；`redact.mjs` 无依赖。
- `lib/index.js`、`lib/cli.mjs`、`lib/commands/**` 本任务不改。四个模块暂无生产调用方，所以它们的导出函数都不会触发 `check-unused`（只检查未导出的顶层函数和未使用的导入）。

## 8. 测试设计

所有测试文件的标题约定：

- 只用顶层 `test(...)`，不用 `describe`，使 `--test-name-pattern` 能精确选中单个测试，`ℹ pass` 计数可预测。
- 每个测试标题以纯字符串字面量开头，形如 `'[AC-029] <slug>: 说明'`，其中 `<slug>` 是第 8.2 节固定的名字；一个 slug 只对应一个测试，且 slug 不是其他 slug 的子串。
- `[AC-029]` 只出现在 `store.test.mjs`、`lock.test.mjs`、`store-concurrency.test.mjs`；`[AC-030]` 只出现在 `redact.test.mjs`、`audit.test.mjs`。不要在注释或其他文件里提到对方的标签，否则 `--ac` 选中的文件数会变。
- 测试里不得调用真实的 `setTimeout` / sleep；时间只经伪时钟。

### 8.1 夹具 `test/fixtures/store/`

| 文件 | 内容 |
|---|---|
| `memfs.mjs` | 内存 `ctx.fs`：9 个方法齐全；`writeFileSync` 支持 `{ flag: 'wx' }`（已存在抛 `EEXIST`）；`statSync` 返回 `mtimeMs`（取自可注入的时钟）；`renameSync` 原子替换；记录每次方法调用名；支持按方法名注入一次性或持续失败（可指定 `error.code`） |
| `drive.mjs` | `drive(clock, promise, { step, maxIterations = 100000 })`：循环 `await clock.advance(step)` 并让出若干次微任务，直到 `promise` 落定；超过上限则抛错而不是挂起；返回 `promise` 的结果或拒绝原因 |
| `append-worker.mjs` | 子进程入口：参数 `<file> <workerId> <count>`；用 `createContext()` 和 `appendJsonl` 追加 `count` 行，行为 `{ id: '<workerId>-<i>', worker, i }` |
| `counter-worker.mjs` | 子进程入口：参数 `<stateDir> <rounds>`；循环 `rounds` 次：`withLock` 内 `readJson` → +1 → `atomicWriteJson` |

不提交任何 `.jsonl` 夹具；`.gitignore` 会忽略它们，且测试都在 `os.tmpdir()` 下用 `mkdtemp` 生成数据，`after` 里清理。

### 8.2 测试清单

`test/unit/store.test.mjs`（AC-029）：

| slug | 断言 |
|---|---|
| `atomic-write-ok` | 写入后文件内容为 `JSON.stringify(value, null, 2) + '\n'`；首字节不是 BOM；目录里没有残留 `.tmp` |
| `atomic-write-rename-fail` | 目标先有已知字节；`renameSync` 注入 `EIO` 失败；`atomicWriteJson` 拒绝，且 `error.code === 'EIO'`；目标字节与之前逐字节相同；`.tmp` 已清理 |
| `atomic-write-write-fail` | 临时文件写入阶段注入失败（`ENOSPC`）；拒绝；目标字节不变；无残留 |
| `atomic-write-eperm-retry` | `platform:'win32'`，`renameSync` 前两次抛 `EPERM` 第三次成功：最终写入成功，`sleep` 被调用 2 次，延迟依次为 10、20，伪时钟累计推进 30；再测持续 `EPERM`：共 `RENAME_RETRY_DELAYS_MS.length` 次睡眠后拒绝、目标字节不变、`.tmp` 已清理 |
| `atomic-write-posix-no-retry` | `platform:'linux'`，`renameSync` 抛 `EPERM`：不调用 `sleep`，直接拒绝 |
| `atomic-write-bad-value` | `undefined` 抛 `TypeError`，且 `memfs` 记录里没有任何写类调用 |
| `jsonl-append-shape` | `appendJsonl` 恰好调用一次 `appendFileSync`；写入文本是一行 JSON 加 `\n`；含换行符的字符串值被转义，整体仍只有一个 `\n` |
| `jsonl-read` | 缺失文件返回 `[]`；CRLF 与空行被忽略；坏行默认抛 `SyntaxError` 且消息含行号；`skipInvalid:true` 丢弃坏行 |
| `store-fs-surface` | 本文件所有场景中，`memfs` 记录到的方法名都属于 `context.v1.json` 的 `fs_methods` |

`test/unit/lock.test.mjs`（AC-029，全部用 `memfs` + 伪时钟）：

| slug | 断言 |
|---|---|
| `lock-free-acquire` | 无锁时立即获得；锁文件内容含数值 `pid`、数值 `at`（等于伪时钟 now）、字符串 `token`；不调用 `sleep` |
| `lock-dead-pid` | 预置锁 `{pid: 4242, at: now}`，`isPidAlive` 返回 `false`：`acquireLock` 无需任何 `advance` 就完成；`sleep` 调用 0 次；`clock.now()` 前后相等；新锁文件的 pid 是自己的 |
| `lock-stale-advance` | 预置锁 `{pid: 4242, at: now}`，`isPidAlive` 恒 `true`，`lock_stale_ms: 30000`，`lock_wait_ms` 足够大：用 `drive` 推进，acquire 成功；回收发生在虚拟时间越过 30000 之后；另测恰好 `age == lock_stale_ms` 时仍在等待（此时 `sleep` 次数大于 0 且尚未成功），`age == lock_stale_ms + 1` 时回收 |
| `lock-timeout-retries` | 活锁且不陈旧（`at` 取当前、`lock_stale_ms` 远大于 `lock_wait_ms`）：对 `(wait, poll)` 取 `(5000, 50)`、`(120, 50)`、`(100, 50)`、`(1, 50)`，用包装过的 `ctx.clock.sleep` 计数，断言拒绝的错误 `code === 'E_STATE_LOCKED'`，`sleep` 调用次数等于 `Math.ceil(wait / poll)`，虚拟耗时 `clock.now() - start >= wait`（对 `(5000, 50)` 等整除情形等于 `wait`），且锁文件仍属于原持有者、内容未变 |
| `lock-release-token` | `release()` 删除自己的锁；锁被他人替换（token 不同）后 `release()` 不删除；重复 `release()` 不抛错 |
| `lock-with-lock` | `withLock` 在 `fn` 成功时返回其结果并释放；`fn` 抛错时错误原样抛出且锁已释放 |
| `lock-corrupt-content` | 空文件或非 JSON 的锁文件：`mtimeMs` 已超过 `lock_stale_ms` 时被回收；`mtimeMs` 新鲜时按活锁等待并最终 `E_STATE_LOCKED` |
| `lock-seams` | 读取 `lib/lock.mjs` 源码文本，断言不含 `node:fs`、`Date.now`、`setTimeout`、`setInterval`、`setImmediate`、`node:timers` 字样 |

`test/integration/store-concurrency.test.mjs`（AC-029，真实文件系统与真实进程）：

| slug | 断言 |
|---|---|
| `append-20x50` | 在 `mkdtemp` 目录里同时启动 20 个 `append-worker.mjs`，每个追加 50 行；全部以退出码 0 结束；文件恰好 1000 行；每行 `JSON.parse` 成功；`id` 共 1000 个且唯一；每个 worker 恰有 50 行，且其 `i` 在文件中按 0..49 递增出现 |
| `lock-counter` | 先 `atomicWriteJson` 写 `{ n: 0 }`；同时启动 5 个 `counter-worker.mjs`，每个循环 10 次，`policy` 取 `lock_wait_ms: 30000`、`lock_poll_ms: 10`；全部退出码 0；最终 `n === 50`；目录里不残留 `.lock`、`.stale-*`、`.tmp` 文件 |

`test/unit/redact.test.mjs`（AC-030）：

| slug | 断言 |
|---|---|
| `redact-sk` | `sk-` 前缀密钥（含 `sk-ant-` 形态）整段变为 `[REDACTED]`；`task-description-long` 原样保留 |
| `redact-bearer` | `Authorization: Bearer abc.DEF-123_x~+/=` 变为 `Authorization: Bearer [REDACTED]`；小写 `bearer` 同样处理且保留原写法 |
| `redact-jwt` | 三段 base64url 的 JWT（`eyJ...`）整段打码；`config.example.json`、版本号 `1.2.3` 原样保留 |
| `redact-registered` | 已登记的值在字符串任意位置、多次出现时全部打码；较长值包含较短值时两者都不残留；空串、非字符串登记被忽略且不破坏输出 |
| `redact-nested` | 嵌套对象、数组里的字符串值和键中的密钥全部打码；数字、布尔、null 原样 |
| `redact-error-message` | `Error('failed with key <secret>')`（含嵌套在对象里的 Error）打码后是 `{ name, message }`，`message` 不含密钥，且结果里没有 `stack` |
| `redact-no-mutation` | 入参深冻结后调用不抛错；原对象内容不变 |
| `redact-cycle` | 自引用对象不死循环，循环处为 `'[Circular]'` |
| `redact-registry` | `createSecretRegistry().add(x)` 之后 `.redact(...)` 与 `redact(..., { secrets: [x] })` 结果深相等；`list()` 去重 |
| `redact-seams` | 读取 `lib/redact.mjs` 源码，断言不含 `node:fs`、`Date.now`、`setTimeout` 字样 |

`test/unit/audit.test.mjs`（AC-030，`memfs` + 伪时钟）：

| slug | 断言 |
|---|---|
| `audit-fields` | 写一行后 `readAudit` 得到一行，包含 `at`（等于 `clock.nowIso()`）、`entry`、`action`、`result` 四个字段；`entry` 取 `cli` 与 `http` 各一次均可 |
| `audit-actions` | 对 `AUDIT_ACTIONS` 的 8 个动作各调用一次，文件恰好 8 行，`action` 集合与 `AUDIT_ACTIONS` 相等，且 `AUDIT_ACTIONS` 覆盖 select、lease、run、probe、allow、deny、level、secret_set |
| `audit-invalid` | 非法 `entry`、`action`、`result` 各抛 `TypeError`，且文件未被创建或未增加行 |
| `audit-redacts` | `detail` 含 `sk-`、`Bearer`、JWT 样本、已登记密钥（嵌套对象内，以及 `new Error('boom ' + secret)`）；落盘后的行不含任何明文 |
| `audit-leak-scan` | 以 select、lease、run、probe、allow、level、secret_set 七类事件各写一行（各自 `detail` 带一个不同的已登记密钥），读取 `audit.jsonl` 全文，对每个已登记密钥做子串检查，命中数为 0；同时断言文件非空且行数为 7 |
| `audit-seams` | 读取 `lib/audit.mjs` 源码，断言不含 `node:fs`、`Date.now`、`new Date` 字样 |

### 8.3 追踪分片 `test/traceability/T-011.json`

```json
{
  "task": "T-011",
  "milestone": "M2",
  "entries": [
    { "ac": "AC-029", "status": "covered", "files": ["test/unit/store.test.mjs", "test/unit/lock.test.mjs", "test/integration/store-concurrency.test.mjs"] },
    { "ac": "AC-030", "status": "covered", "files": ["test/unit/redact.test.mjs", "test/unit/audit.test.mjs"] }
  ]
}
```

## 9. 实施顺序

1. `lib/redact.mjs` 与 `test/unit/redact.test.mjs`。
2. `lib/store.mjs`、`test/fixtures/store/memfs.mjs`、`test/unit/store.test.mjs`。
3. `lib/lock.mjs`、`test/fixtures/store/drive.mjs`、`test/unit/lock.test.mjs`。
4. `lib/audit.mjs` 与 `test/unit/audit.test.mjs`。
5. `test/fixtures/store/append-worker.mjs`、`counter-worker.mjs` 与 `test/integration/store-concurrency.test.mjs`。
6. `test/traceability/T-011.json`。
7. 跑 `pwsh -NoProfile -File scripts/check-fast.ps1`，全部通过后再交付。

## 10. 风险与注意事项

- **伪时钟与微任务**：`advance` 每触发一个定时器只让出一次微任务，等锁循环在 `sleep` 返回后再经过若干次 `await` 才会登记下一个定时器。`drive` 必须在每次 `advance` 之后额外让出多次微任务，并以 `step = lock_poll_ms` 推进；`acquireLock` 的循环里 `sleep` 与重试之间的 `await` 越少越好。
- **Windows 路径**：锁文件和临时文件在同一目录，重命名不会跨卷。集成测试必须在 `os.tmpdir()` 下运行（不要在 OneDrive 同步的仓库目录内生成数据）。
- **进程存活判断**：`process.kill(pid, 0)` 在 Windows 上同样可用。跨主机 / WSL 的 pid 不在本任务范围内，由 `lock_stale_ms` 兜底。
- **E_STATE_LOCKED 的 retryable**：`interfaces.md` 把它列在「可重试」的退出码 4 下，而 `contracts/registry.snapshot.json` 记为 `retryable:false`。本任务以快照为准，不改快照（`contracts/**` 不在 write_scope）；如需统一，走蓝图变更。
- **竞态说明**：陈旧锁回收存在极窄的残余竞态（见第 5 节），已用「释放时校验 token」兜底；集成测试 `lock-counter` 在高竞争下验证不丢更新。
