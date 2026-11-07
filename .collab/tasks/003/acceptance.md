# Task 003 验收标准

规格见同目录 `design.md`。基准提交是 `7f655f7`：在该提交上 `node scripts/check-fast.mjs` 通过，`node scripts/check-traceability.mjs` 输出 `check-traceability: ok (covered=6 planned=68)`。

## 约定

- 所有命令在仓库根（任务 worktree 根）执行，Node 20+，bash 与 pwsh 7 下都能原样运行。
- `node --input-type=module -e "…"` 探针的 JS 只用单引号、不含 `$`、反引号、反斜杠和双引号，这样两种 shell 下引号行为一致。探针通过时 stdout 恰好是一行 `PROBE-OK <标签>`，退出码 0；失败时抛错或 `process.exit(1)`，stdout 没有 `PROBE-OK`。
- “run-tests 通过”指：退出码 0；stdout 含 `ℹ fail 0`；含至少一行以 `✔ [AC-xxx]` 开头的测试；不含 `FAIL run.no_match`、`FAIL discovery`。
- 每条命令独立判定，不依赖前一条的副作用。

## AC-006 import-safe 入口

**V-006-1 自带测试通过**

```
node scripts/run-tests.mjs --ac AC-006
```

期望：run-tests 通过，且 `✔ [AC-006]` 行至少 3 条；末行为 `run-tests: filtered <n> files, manifest …`，其中 `n >= 1`。

**V-006-2 子进程 import 无输出**

```
node --input-type=module -e "import { spawnSync } from 'node:child_process'; import { pathToFileURL } from 'node:url'; import path from 'node:path'; for (const f of ['lib/cli.mjs', 'lib/index.js']) { const u = pathToFileURL(path.resolve(f)).href; const r = spawnSync(process.execPath, ['--input-type=module', '-e', 'await import(process.argv[1])', u], { encoding: 'utf8' }); if (r.status !== 0 || r.stdout.length !== 0 || r.stderr.length !== 0) { console.error(f, r.status, r.stdout.length, r.stderr.length); process.exit(1) } } console.log('PROBE-OK import-safe')"
```

期望：stdout 为 `PROBE-OK import-safe`，退出码 0。（基准提交上 `lib/cli.mjs` 一导入就执行 `main` 并 `process.exit`，此探针会失败。）

**V-006-3 `main(argv, ctx)` 返回 `{exitCode}`，输出进 `ctx.stdout`**

```
node --input-type=module -e "import { main } from './lib/cli.mjs'; import { createFakeContext } from './test/helpers/ctx.mjs'; const cfg = JSON.stringify({ providers: { p1: { cli: 'p1cli' } }, models: {} }); const ctx = createFakeContext({ files: { '/cw/config.json': cfg }, exec: () => ({ ok: true, code: 0, stdout: 'v 1.2.3', stderr: '', error: null }) }); const r = await main(['providers', '--config', '/cw/config.json'], ctx); const j = JSON.parse(ctx.stdout.text()); if (Object.keys(r).join() !== 'exitCode' || r.exitCode !== 0) throw new Error('result ' + JSON.stringify(r)); if (j.schema !== 'cliworker.providers/v1' || j.providers.length !== 1 || j.providers[0].id !== 'p1' || j.providers[0].state !== 'callable' || j.providers[0].version !== '1.2.3') throw new Error('stdout ' + ctx.stdout.text()); if (ctx.stderr.text() !== '' || ctx.exec.count < 1) throw new Error('stderr/exec'); console.log('PROBE-OK main-ctx')"
```

期望：stdout 为 `PROBE-OK main-ctx`，退出码 0。

**V-006-4 迁入的命令行为不变（models list、usage record/summary、models forecast）**

```
node --input-type=module -e "import path from 'node:path'; import { main } from './lib/cli.mjs'; import { createFakeContext } from './test/helpers/ctx.mjs'; const cfg = JSON.stringify({ providers: { p1: { cli: 'p1cli', readonly: true } }, models: { m1: { provider: 'p1', id: 'm1', tier: 'top', identity: 'verified', vendor: 'v', prices: { input_per_mtok: 1000, output_per_mtok: 0 } } } }); const mk = () => createFakeContext({ files: { '/cw/config.json': cfg }, env: { CLIWORKER_HOME: '/cw/home' }, now: Date.parse('2020-01-01T00:00:00Z'), exec: () => ({ ok: true, code: 0, stdout: '1.2.3', stderr: '', error: null }) }); const c1 = mk(); const r1 = await main(['models', 'list', '--config', '/cw/config.json'], c1); const l = JSON.parse(c1.stdout.text()); if (r1.exitCode !== 0 || l.schema !== 'cliworker.models/v1' || l.models.length !== 1 || l.models[0].key !== 'm1' || l.models[0].callable !== true || l.models[0].level !== 'Top') throw new Error('list ' + c1.stdout.text()); const c2 = mk(); const r2 = await main(['usage', 'record', '--json', JSON.stringify({ model: 'm1', input_tokens: 1000, output_tokens: 0 }), '--config', '/cw/config.json'], c2); const rec = JSON.parse(c2.stdout.text()); if (r2.exitCode !== 0 || rec.schema !== 'cliworker.usage/v1' || rec.ok !== true || rec.recorded.at !== '2020-01-01T00:00:00.000Z' || rec.recorded.cost_usd !== 1) throw new Error('record ' + c2.stdout.text()); const lines = c2.fs.readFileSync(path.resolve('/cw/home/usage.jsonl'), 'utf8').split(String.fromCharCode(10)).filter(Boolean); if (lines.length !== 1 || JSON.parse(lines[0]).model !== 'm1') throw new Error('usage file'); const n = c2.stdout.text().length; const r3 = await main(['usage', 'summary', '--config', '/cw/config.json'], c2); const sum = JSON.parse(c2.stdout.text().slice(n)); if (r3.exitCode !== 0 || sum.schema !== 'cliworker.usage/v1' || sum.records.length !== 1) throw new Error('summary'); const n2 = c2.stdout.text().length; const r4 = await main(['models', 'forecast', '--model', 'm1', '--config', '/cw/config.json'], c2); const fc = JSON.parse(c2.stdout.text().slice(n2)); if (r4.exitCode !== 0 || fc.schema !== 'cliworker.forecast/v1' || fc.forecast.status !== 'known' || fc.forecast.burn_per_hour !== 60) throw new Error('forecast ' + JSON.stringify(fc)); console.log('PROBE-OK commands')"
```

期望：stdout 为 `PROBE-OK commands`，退出码 0。`burn_per_hour` 为 60 说明 forecast 用的是 `ctx.now()`（伪时钟等于样本时间），不是系统时间。

**V-006-5 错误路径不退出进程，只写 stderr**

```
node --input-type=module -e "import { main } from './lib/cli.mjs'; import { createFakeContext } from './test/helpers/ctx.mjs'; const a = createFakeContext(); const ra = await main([], a); const b = createFakeContext(); const rb = await main(['providers', '--config', '/missing/config.json'], b); if (ra.exitCode !== 1 || a.stdout.text() !== '' || a.stderr.text().indexOf('ERROR: usage: cliworker') !== 0) throw new Error('usage ' + a.stderr.text()); if (rb.exitCode !== 1 || b.stdout.text() !== '' || b.stderr.text().indexOf('ERROR: cannot read CLIWorker config') !== 0) throw new Error('config ' + b.stderr.text()); console.log('PROBE-OK main-errors')"
```

期望：stdout 为 `PROBE-OK main-errors`，退出码 0。

**V-006-6 lib 下没有 `process.exit` 字样（含注释）**

```
node --input-type=module -e "import fs from 'node:fs'; import path from 'node:path'; const hits = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/[.](mjs|js|cjs)$/.test(p) && fs.readFileSync(p, 'utf8').includes('process.exit')) hits.push(p) } }; walk('lib'); if (hits.length) { console.error(hits); process.exit(1) } console.log('PROBE-OK no-process-exit')"
```

期望：stdout 为 `PROBE-OK no-process-exit`，退出码 0。

**V-006-7 bin 入口是薄封装**

```
node bin/cliworker.mjs
```

期望：退出码 1；stdout 为空；stderr 以 `ERROR: usage: cliworker providers | models list|select|forecast | usage record|summary` 开头。

## AC-007 缝规则与 check-seams

**V-007-1 自带测试通过**

```
node scripts/run-tests.mjs --ac AC-007
```

期望：run-tests 通过，`✔ [AC-007]` 行至少 3 条。

**V-007-2 真实 lib 通过**

```
node scripts/check-seams.mjs
```

期望：退出码 0；stdout 最后一行匹配 `check-seams: ok (files=N)`，`N >= 15`（8 个原 lib 文件加 `_util.mjs` 与 6 个命令模块）；没有 `FAIL` 行。

**V-007-3 每类违规夹具都被报出，合法夹具 0 违规**

```
node --input-type=module -e "import { spawnSync } from 'node:child_process'; const want = { 'child-process': 'seams.child_process', 'fs': 'seams.fs', 'date-now': 'seams.date_now', 'new-date': 'seams.new_date', 'set-timeout': 'seams.set_timeout', 'set-interval': 'seams.set_interval', 'set-immediate': 'seams.set_immediate', 'node-timers': 'seams.node_timers', 'wall-clock': 'seams.wall_clock', 'process-exit': 'seams.process_exit' }; const scan = (dir) => { const r = spawnSync(process.execPath, ['scripts/check-seams.mjs', '--root', 'test/fixtures/seams/' + dir, '--json'], { encoding: 'utf8' }); return { status: r.status, j: JSON.parse(r.stdout) } }; for (const [dir, rule] of Object.entries(want)) { const { status, j } = scan(dir); if (status !== 1 || j.ok !== false || j.violations.length === 0) throw new Error(dir + ' not reported'); if (!j.violations.every((v) => v.rule === rule && v.file === 'lib/bad.mjs' && v.line >= 1)) throw new Error(dir + ' wrong ' + JSON.stringify(j.violations)); } for (const dir of ['clean', 'allowed']) { const { status, j } = scan(dir); if (status !== 0 || j.ok !== true || j.violations.length !== 0 || j.files < 1) throw new Error(dir + ' not clean ' + JSON.stringify(j)); } console.log('PROBE-OK seams-fixtures')"
```

期望：stdout 为 `PROBE-OK seams-fixtures`，退出码 0。

**V-007-4 默认输出格式与参数错误**

```
node scripts/check-seams.mjs --root test/fixtures/seams/date-now
```

期望：退出码 1；stdout 恰有两行：`FAIL seams.date_now lib/bad.mjs:<line>`（`<line>` 为正整数）和 `check-seams: FAILED (1 violations)`。

```
node scripts/check-seams.mjs --bogus
```

期望：退出码 2；stdout 为空；stderr 含 `usage:`。

**V-007-5 允许清单按路径精确匹配**

```
node --input-type=module -e "import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-seams-')); try { fs.mkdirSync(path.join(d, 'lib', 'commands'), { recursive: true }); fs.writeFileSync(path.join(d, 'lib', 'commands', 'exec.mjs'), 'import cp from ' + String.fromCharCode(39) + 'node:child_process' + String.fromCharCode(39) + String.fromCharCode(10)); const r = spawnSync(process.execPath, ['scripts/check-seams.mjs', '--root', d, '--json'], { encoding: 'utf8' }); const j = JSON.parse(r.stdout); if (r.status !== 1 || j.violations.length !== 1 || j.violations[0].rule !== 'seams.child_process' || j.violations[0].file !== 'lib/commands/exec.mjs') throw new Error(r.stdout) } finally { fs.rmSync(d, { recursive: true, force: true }) } console.log('PROBE-OK seams-allowlist-exact')"
```

期望：stdout 为 `PROBE-OK seams-allowlist-exact`，退出码 0。（`lib/commands/exec.mjs` 不是 `lib/exec.mjs`，必须被报出。）

**V-007-6 受限模块只在允许文件出现（对真实 lib 的独立核对）**

```
node --input-type=module -e "import fs from 'node:fs'; import path from 'node:path'; const cp = []; const fsu = []; const tm = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name).split(path.sep).join('/'); if (e.isDirectory()) { walk(p); continue } if (!/[.](mjs|js|cjs)$/.test(p)) continue; const s = fs.readFileSync(p, 'utf8'); if (/(node:)?child_process/.test(s)) cp.push(p); if (/from 'node:fs|from 'fs'|require[(]'(node:)?fs/.test(s)) fsu.push(p); if (/Date[.]now|new Date[(][)]|node:timers/.test(s)) tm.push(p) } }; walk('lib'); const same = (a, b) => a.join() === b.join(); if (!same(cp, ['lib/exec.mjs'])) throw new Error('child_process ' + cp); if (!fsu.every((f) => ['lib/context.mjs', 'lib/store.mjs', 'lib/fsx.mjs'].includes(f)) || !fsu.includes('lib/context.mjs')) throw new Error('fs ' + fsu); if (!same(tm, ['lib/context.mjs'])) throw new Error('clock ' + tm); console.log('PROBE-OK seams-real-tree')"
```

期望：stdout 为 `PROBE-OK seams-real-tree`，退出码 0。这个探针只做文本匹配，所以 `lib` 里的注释也不能写出 `child_process`、`Date.now`、`new Date()`、`node:timers` 这些字面量（`lib/exec.mjs` 与 `lib/context.mjs` 自身除外）。

## AC-008 宿主 stub 与注册

**V-008-1 自带测试通过**

```
node scripts/run-tests.mjs --ac AC-008
```

期望：run-tests 通过，`✔ [AC-008]` 行至少 5 条，且分布在 `test/contract/host-stub.test.mjs` 与 `test/integration/registration.test.mjs` 两个文件（`run-tests: filtered 2 files` 或更多）。

**V-008-2 契约文件顶层键**

```
node --input-type=module -e "import fs from 'node:fs'; const h = JSON.parse(fs.readFileSync('contracts/host/dsh-host.v1.json', 'utf8')); if (h.contract !== 'dsh-host' || h.version !== 1) throw new Error('header'); for (const k of ['host_ctx', 'http_ctx', 'registration', 'request', 'response', 'stub_controllable_inputs', 'plugin_exports']) if (!(k in h)) throw new Error('missing ' + k); if (h.stub_controllable_inputs.slice().sort().join() !== 'host,origin,remoteAddress') throw new Error('inputs'); if (h.registration.kind.join() !== 'exact') throw new Error('kind'); if (h.plugin_exports.getRegistration.status.join() !== 'ok,failed') throw new Error('status'); console.log('PROBE-OK host-contract')"
```

期望：stdout 为 `PROBE-OK host-contract`，退出码 0。

**V-008-3 stub 符合契约：校验、失败注入、可控的三项输入**

```
node --input-type=module -e "import { createHostStub } from './test/helpers/host-stub.mjs'; const s = createHostStub(); let seen = null; s.ctx.inject(['webServer'], (h) => { const reg = (p, name) => h.effect(() => h.webServer.register({ kind: 'exact', path: p, handler: (req, res) => { res.statusCode = 200; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ra: req.socket.remoteAddress, host: req.headers.host, origin: req.headers.origin })) } }), name); reg('/x', 'x'); for (const bad of [{ kind: 'prefix', path: '/y', handler: () => {} }, { kind: 'exact', path: 'y', handler: () => {} }, { kind: 'exact', path: '/y', handler: 1 }]) { try { h.webServer.register(bad); throw new Error('accepted ' + JSON.stringify(bad)) } catch (e) { if (!(e instanceof TypeError)) throw e } } seen = h }); if (s.injectCalls.length !== 1 || s.injectCalls[0].join() !== 'webServer' || s.effects.join() !== 'x' || s.registered.length !== 1 || s.registered[0].path !== '/x') throw new Error('records'); const a = await s.request('/x'); const b = await s.request('/x', { remoteAddress: '10.0.0.5', host: 'evil.test', origin: 'http://evil.test' }); const ja = JSON.parse(a.body); const jb = JSON.parse(b.body); if (a.statusCode !== 200 || ja.ra !== '127.0.0.1' || ja.host !== 'localhost') throw new Error('defaults ' + a.body); if (jb.ra !== '10.0.0.5' || jb.host !== 'evil.test' || jb.origin !== 'http://evil.test') throw new Error('controls ' + b.body); const f = createHostStub({ failPaths: ['/boom'] }); f.ctx.inject(['webServer'], (h) => { try { h.webServer.register({ kind: 'exact', path: '/boom', handler: () => {} }); throw new Error('no throw') } catch (e) { if (e.message.indexOf('/boom') < 0) throw e } }); if (f.registered.length !== 0) throw new Error('failed path recorded'); let threw = false; try { createHostStub({ failInject: true }).ctx.inject(['webServer'], () => {}) } catch (e) { threw = true } if (!threw) throw new Error('failInject'); console.log('PROBE-OK host-stub')"
```

期望：stdout 为 `PROBE-OK host-stub`，退出码 0。

**V-008-4 createPlugin / getRegistration / apply 的成功、失败与 strict**

```
node --input-type=module -e "import { createPlugin, getRegistration, apply } from './lib/index.js'; import { createHostStub } from './test/helpers/host-stub.mjs'; import { createFakeContext } from './test/helpers/ctx.mjs'; const want = ['/cliworker/forecast', '/cliworker/models', '/cliworker/providers', '/cliworker/select']; const ok = createHostStub(); const c1 = createFakeContext(); const r1 = createPlugin(ok.ctx, {}, { ctx: c1 }); if (r1.errors.length !== 0 || r1.registered.slice().sort().join() !== want.join()) throw new Error('ok ' + JSON.stringify(r1)); if (ok.registered.map((x) => x.path).sort().join() !== want.join()) throw new Error('stub records'); const g1 = getRegistration(); if (g1.status !== 'ok' || g1.errors.length !== 0 || g1.registered.length !== 4) throw new Error('get ok'); const bad = createHostStub({ failPaths: ['/cliworker/models'], failMessage: 'boom' }); const c2 = createFakeContext(); const r2 = createPlugin(bad.ctx, {}, { ctx: c2 }); if (r2.errors.length !== 1 || r2.errors[0].path !== '/cliworker/models' || r2.errors[0].message.indexOf('boom') < 0) throw new Error('partial ' + JSON.stringify(r2)); if (r2.registered.length !== 3 || r2.registered.includes('/cliworker/models')) throw new Error('partial registered'); const g2 = getRegistration(); if (g2.status !== 'failed' || g2.errors.length !== 1) throw new Error('get failed'); if (c2.stderr.text().indexOf('/cliworker/models') < 0) throw new Error('stderr hint'); const c3 = createFakeContext(); apply(createHostStub({ failPaths: ['*'] }).ctx, {}, { ctx: c3 }); if (getRegistration().status !== 'failed' || getRegistration().registered.length !== 0) throw new Error('non-strict'); let err = null; try { apply(createHostStub({ failPaths: ['/cliworker/select'] }).ctx, { strict: true }, { ctx: createFakeContext() }) } catch (e) { err = e } if (!err || err.message.indexOf('cliworker: route registration failed') !== 0 || err.registration.status !== 'failed' || getRegistration().status !== 'failed') throw new Error('strict'); const r4 = createPlugin(createHostStub({ failInject: true }).ctx, {}, { ctx: createFakeContext() }); if (r4.errors.length !== 1 || r4.errors[0].path !== null || r4.registered.length !== 0) throw new Error('inject ' + JSON.stringify(r4)); apply(createHostStub().ctx, { strict: true }, { ctx: createFakeContext() }); if (getRegistration().status !== 'ok') throw new Error('strict ok'); console.log('PROBE-OK registration')"
```

期望：stdout 为 `PROBE-OK registration`，退出码 0。

**V-008-5 注册后的 handler 能往返（配置、探测、forecast 都走注入的 ctx）**

```
node --input-type=module -e "import { createPlugin } from './lib/index.js'; import { createHostStub } from './test/helpers/host-stub.mjs'; import { createFakeContext } from './test/helpers/ctx.mjs'; const cfg = JSON.stringify({ providers: { p1: { cli: 'p1cli' } }, models: { m1: { provider: 'p1', id: 'm1', tier: 'top', identity: 'verified' } } }); const ctx = createFakeContext({ files: { '/cw/config.json': cfg }, exec: () => ({ ok: true, code: 0, stdout: '1.2.3', stderr: '', error: null }) }); const s = createHostStub(); createPlugin(s.ctx, { configPath: '/cw/config.json' }, { ctx }); const p = await s.request('/cliworker/providers'); const jp = JSON.parse(p.body); if (p.statusCode !== 200 || jp.ok !== true || jp.providers.p1.state !== 'callable') throw new Error('providers ' + p.body); const m = JSON.parse((await s.request('/cliworker/models')).body); if (m.ok !== true || m.models.length !== 1 || m.models[0].key !== 'm1') throw new Error('models'); const bad = createFakeContext({ files: {}, exec: () => ({ ok: true, code: 0, stdout: '1.2.3', stderr: '', error: null }) }); const t = createHostStub(); createPlugin(t.ctx, { configPath: '/cw/nope.json' }, { ctx: bad }); const e = await t.request('/cliworker/providers'); if (e.statusCode !== 500 || JSON.parse(e.body).ok !== false) throw new Error('error path ' + e.body); console.log('PROBE-OK handlers')"
```

期望：stdout 为 `PROBE-OK handlers`，退出码 0。

## AC-072 时钟与上下文契约

**V-072-1 自带测试通过**

```
node scripts/run-tests.mjs --ac AC-072
```

期望：run-tests 通过，`✔ [AC-072]` 行至少 6 条，覆盖 `test/unit/clock.test.mjs` 与 `test/contract/context.test.mjs` 两个文件。

**V-072-2 伪时钟：advance、setNow、定时器顺序、pending、sleep**

```
node --input-type=module -e "import { createFakeClock } from './test/helpers/clock.mjs'; const c = createFakeClock({ start: 1000 }); const t0 = c.now(); await c.advance(1000); if (c.now() - t0 !== 1000) throw new Error('advance'); c.setNow(5); if (c.now() !== 5) throw new Error('setNow back'); c.setNow(9000); if (c.now() !== 9000) throw new Error('setNow fwd'); c.setNow(Date.parse('2026-01-01T00:00:00Z')); if (c.nowIso() !== '2026-01-01T00:00:00.000Z') throw new Error('nowIso'); c.setNow(9000); const log = []; const seen = []; c.setTimeout(() => log.push('b2'), 200); c.setTimeout(() => { log.push('a1'); seen.push(c.now()) }, 100); c.setTimeout(() => log.push('b3'), 200); const h = c.setTimeout(() => log.push('x'), 150); c.clearTimeout(h); c.setTimeout(() => log.push('far'), 1000); if (c.pending() !== 4) throw new Error('pending1 ' + c.pending()); await c.advance(99); if (log.length !== 0 || c.pending() !== 4) throw new Error('fired early'); await c.advance(1); if (log.join() !== 'a1' || seen[0] !== 9100 || c.pending() !== 3) throw new Error('a1 ' + log.join()); await c.advance(100); if (log.join() !== 'a1,b2,b3' || c.pending() !== 1) throw new Error('b ' + log.join()); let slept = false; c.sleep(500).then(() => { slept = true }); if (c.pending() !== 2) throw new Error('sleep pending'); await c.advance(499); await Promise.resolve(); await Promise.resolve(); if (slept) throw new Error('slept early'); await c.advance(1); await Promise.resolve(); await Promise.resolve(); if (!slept || c.pending() !== 1) throw new Error('slept late'); c.setNow(20000); await c.advance(0); if (log.join() !== 'a1,b2,b3,far' || c.pending() !== 0) throw new Error('overdue ' + log.join()); let rej = false; try { await c.advance(-1) } catch (e) { rej = e instanceof RangeError } if (!rej) throw new Error('RangeError'); console.log('PROBE-OK fake-clock')"
```

期望：stdout 为 `PROBE-OK fake-clock`，退出码 0。

**V-072-3 真实 createContext 读时钟文件，每次重读**

```
node --input-type=module -e "import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { createContext } from './lib/context.mjs'; const f = path.join(os.tmpdir(), 'cw-clock-' + process.pid + '.txt'); try { fs.writeFileSync(f, '1000'); const ctx = createContext({ env: { CLIWORKER_TEST_CLOCK_FILE: f } }); if (ctx.now() !== 1000 || ctx.clock.now() !== 1000) throw new Error('first'); fs.writeFileSync(f, '2500'); if (ctx.now() !== 2500 || ctx.clock.now() !== 2500) throw new Error('reread'); fs.writeFileSync(f, '2026-11-07T00:00:00.000Z'); if (ctx.clock.now() !== Date.parse('2026-11-07T00:00:00.000Z') || ctx.clock.nowIso() !== '2026-11-07T00:00:00.000Z') throw new Error('iso'); fs.writeFileSync(f, 'not a time'); let threw = false; try { ctx.now() } catch (e) { threw = e.message.indexOf('CLIWORKER_TEST_CLOCK_FILE') >= 0 } if (!threw) throw new Error('invalid content'); const real = createContext({ env: {} }); if (Math.abs(real.now() - Date.now()) > 5000) throw new Error('real now'); const empty = createContext({ env: { CLIWORKER_TEST_CLOCK_FILE: '' } }); if (Math.abs(empty.now() - Date.now()) > 5000) throw new Error('empty var'); for (const m of ['setNow', 'advance', 'pending']) if (m in real.clock) throw new Error('real clock exposes ' + m) } finally { fs.rmSync(f, { force: true }) } console.log('PROBE-OK test-clock-file')"
```

期望：stdout 为 `PROBE-OK test-clock-file`，退出码 0。

**V-072-4 context.v1.json 描述 ctx 接口面，真实 ctx 与 fake ctx 都符合**

```
node --input-type=module -e "import fs from 'node:fs'; import { createContext } from './lib/context.mjs'; import { createFakeContext } from './test/helpers/ctx.mjs'; const spec = JSON.parse(fs.readFileSync('contracts/context/context.v1.json', 'utf8')); if (spec.contract !== 'cliworker.context' || spec.version !== 1 || spec.test_clock_env !== 'CLIWORKER_TEST_CLOCK_FILE') throw new Error('header'); if (spec.fake_clock_extras.join() !== 'setNow,advance,pending' || spec.clock_methods.join() !== 'now,nowIso,setTimeout,clearTimeout,sleep' || spec.stream_methods.join() !== 'write') throw new Error('lists'); if (spec.fs_methods.length !== 9) throw new Error('fs_methods'); const check = (name, ctx, fake) => { if (Object.keys(ctx).sort().join() !== Object.keys(spec.members).sort().join()) throw new Error(name + ' keys ' + Object.keys(ctx)); for (const [k, t] of Object.entries(spec.members)) { const v = ctx[k]; const ok = t === 'stream' ? typeof v.write === 'function' : typeof v === t; if (!ok) throw new Error(name + ' member ' + k); } for (const m of spec.fs_methods) if (typeof ctx.fs[m] !== 'function') throw new Error(name + ' fs.' + m); for (const m of spec.clock_methods) if (typeof ctx.clock[m] !== 'function') throw new Error(name + ' clock.' + m); for (const m of spec.fake_clock_extras) if ((typeof ctx.clock[m] === 'function') !== fake) throw new Error(name + ' extra ' + m); if (Math.abs(ctx.now() - ctx.clock.now()) > 50) throw new Error(name + ' now alias'); }; check('real', createContext({ env: {} }), false); const fake = createFakeContext(); check('fake', fake, true); if (fake.now() !== fake.clock.now()) throw new Error('fake alias exact'); await fake.clock.advance(1000); if (fake.now() !== fake.clock.now()) throw new Error('fake alias after advance'); console.log('PROBE-OK context-contract')"
```

期望：stdout 为 `PROBE-OK context-contract`，退出码 0。

**V-072-5 设置时钟文件时 `main()` 输出含 `W_TEST_CLOCK`，未设置时不含（进程内）**

```
node --input-type=module -e "import { main } from './lib/cli.mjs'; import { createFakeContext } from './test/helpers/ctx.mjs'; const cfg = JSON.stringify({ providers: {}, models: {} }); const run = async (env) => { const ctx = createFakeContext({ files: { '/cw/config.json': cfg }, env }); const r = await main(['usage', 'summary', '--config', '/cw/config.json'], ctx); return { r, j: JSON.parse(ctx.stdout.text()) } }; const on = await run({ CLIWORKER_HOME: '/cw/home', CLIWORKER_TEST_CLOCK_FILE: '/cw/clock.txt' }); if (on.r.exitCode !== 0 || !Array.isArray(on.j.warnings) || !on.j.warnings.some((w) => w.code === 'W_TEST_CLOCK')) throw new Error('on ' + JSON.stringify(on.j)); for (const env of [{ CLIWORKER_HOME: '/cw/home' }, { CLIWORKER_HOME: '/cw/home', CLIWORKER_TEST_CLOCK_FILE: '' }]) { const off = await run(env); if (off.r.exitCode !== 0 || JSON.stringify(off.j).indexOf('W_TEST_CLOCK') >= 0 || 'warnings' in off.j) throw new Error('off ' + JSON.stringify(off.j)); } console.log('PROBE-OK warn-inproc')"
```

期望：stdout 为 `PROBE-OK warn-inproc`，退出码 0。

**V-072-6 端到端：bin 子进程在时钟文件环境下输出 `W_TEST_CLOCK`**

```
node --input-type=module -e "import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-bin-')); try { const cfg = path.join(d, 'config.json'); const clk = path.join(d, 'clock.txt'); fs.writeFileSync(cfg, JSON.stringify({ providers: {}, models: {} })); fs.writeFileSync(clk, '1000'); const run = (extra) => spawnSync(process.execPath, ['bin/cliworker.mjs', 'usage', 'summary', '--config', cfg], { encoding: 'utf8', env: { ...process.env, CLIWORKER_HOME: d, CLIWORKER_TEST_CLOCK_FILE: '', ...extra } }); const a = run({ CLIWORKER_TEST_CLOCK_FILE: clk }); const b = run({}); if (a.status !== 0 || a.stderr !== '') throw new Error('a ' + a.status + a.stderr); if (!JSON.parse(a.stdout).warnings.some((w) => w.code === 'W_TEST_CLOCK')) throw new Error('a warnings ' + a.stdout); if (b.status !== 0 || b.stderr !== '' || b.stdout.indexOf('W_TEST_CLOCK') >= 0) throw new Error('b ' + b.stdout + b.stderr); if (JSON.parse(b.stdout).schema !== 'cliworker.usage/v1') throw new Error('b schema') } finally { fs.rmSync(d, { recursive: true, force: true }) } console.log('PROBE-OK warn-bin')"
```

期望：stdout 为 `PROBE-OK warn-bin`，退出码 0。

**V-072-7 助手不泄露环境值**

```
node --input-type=module -e "import { createFakeContext } from './test/helpers/ctx.mjs'; const ctx = createFakeContext(); ctx.exec('tool', ['--flag'], { env: { SECRET_TOKEN: 'sentinel-8f3a' }, timeout: 5 }); ctx.exec('tool', [], {}); const dump = JSON.stringify(ctx.exec.calls); if (dump.indexOf('sentinel-8f3a') >= 0) throw new Error('value leaked'); if (ctx.exec.count !== 2 || ctx.exec.calls[0].command !== 'tool' || ctx.exec.calls[0].args.join() !== '--flag' || ctx.exec.calls[0].envNames.join() !== 'SECRET_TOKEN') throw new Error('record ' + dump); ctx.fs.writeFileSync('/a/b.txt', 'x'); if (ctx.fs.readFileSync('/a/b.txt', 'utf8') !== 'x' || ctx.fs.accessed.length < 2) throw new Error('fakeFs'); try { ctx.fs.readFileSync('/a/none.txt', 'utf8'); throw new Error('no enoent') } catch (e) { if (e.code !== 'ENOENT') throw e } console.log('PROBE-OK helpers')"
```

期望：stdout 为 `PROBE-OK helpers`，退出码 0。

## 总体回归与范围

**V-R-1 完整检查**

```
pwsh -NoProfile -File scripts/check-fast.ps1
```

期望：退出码 0；stdout 最后一行为 `check-fast: ok`；输出中 `ℹ fail 0`；`ℹ pass` 的数字大于 70（基准为 70）；`check-seams: ok` 出现（check-fast 会自动跑 `scripts/check-*.mjs`）。

**V-R-2 追踪**

```
node scripts/check-traceability.mjs
```

期望：退出码 0；stdout 为 `check-traceability: ok (covered=10 planned=64)`。

```
node --input-type=module -e "import { spawnSync } from 'node:child_process'; const r = spawnSync(process.execPath, ['scripts/check-traceability.mjs', '--json'], { encoding: 'utf8' }); const j = JSON.parse(r.stdout); const st = (ac) => j.acs.find((x) => x.ac === ac).status; for (const ac of ['AC-006', 'AC-007', 'AC-008', 'AC-072']) if (st(ac) !== 'covered') throw new Error(ac + ' ' + st(ac)); if (r.status !== 0 || j.ok !== true) throw new Error('not ok'); console.log('PROBE-OK trace-T-003')"
```

期望：stdout 为 `PROBE-OK trace-T-003`，退出码 0。

**V-R-3 测试发现**

```
node scripts/check-test-discovery.mjs
```

期望：退出码 0；stdout 最后一行为 `check-test-discovery: ok`。新建的 `test/contract/`、`test/integration/` 下的测试文件会进入完整运行。

**V-R-4 冻结文件与 0.1 副本未动**

```
node scripts/check-frozen-files.mjs
```

期望：退出码 0。

**V-R-5 改动范围不超出 write_scope（含 `lib/select.mjs` 未被改动）**

```
node --input-type=module -e "import { spawnSync } from 'node:child_process'; const git = (a) => spawnSync('git', a, { encoding: 'utf8' }).stdout.split(String.fromCharCode(10)).filter(Boolean); const globs = ['lib/context.mjs', 'lib/exec.mjs', 'lib/cli.mjs', 'lib/commands/**', 'bin/cliworker.mjs', 'lib/index.js', 'lib/availability.mjs', 'lib/config.mjs', 'lib/forecast.mjs', 'contracts/host/**', 'contracts/context/**', 'test/helpers/ctx.mjs', 'test/helpers/clock.mjs', 'test/helpers/host-stub.mjs', 'scripts/check-seams.mjs', 'test/fixtures/seams/**', 'test/unit/seams.test.mjs', 'test/unit/import-safe.test.mjs', 'test/unit/clock.test.mjs', 'test/contract/host-stub.test.mjs', 'test/contract/context.test.mjs', 'test/integration/registration.test.mjs', 'test/traceability/T-003.json']; const re = globs.map((g) => new RegExp('^' + g.split('.').join('[.]').split('**').join('@@').split('*').join('[^/]*').split('@@').join('.*') + '$')); const files = [...new Set([...git(['diff', '--name-only', '7f655f7']), ...git(['ls-files', '--others', '--exclude-standard'])])].filter((f) => !f.startsWith('.collab/')); const bad = files.filter((f) => !re.some((r) => r.test(f))); if (bad.length) { console.error('outside write_scope:', bad); process.exit(1) } console.log('PROBE-OK scope ' + files.length)"
```

期望：stdout 为 `PROBE-OK scope <n>`，`n >= 30`（实现完成后）；退出码 0。`.collab/` 下的任务状态文件不计入。

**V-R-6 仓库与输出里没有密钥**

```
node --input-type=module -e "import fs from 'node:fs'; import path from 'node:path'; const bad = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { walk(p); continue } if (!/[.](mjs|js|json)$/.test(p)) continue; const s = fs.readFileSync(p, 'utf8'); if (/sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|BEGIN [A-Z ]*PRIVATE KEY/.test(s)) bad.push(p) } }; for (const d of ['lib', 'bin', 'contracts', 'scripts', 'test']) walk(d); if (bad.length) { console.error(bad); process.exit(1) } console.log('PROBE-OK no-secrets')"
```

期望：stdout 为 `PROBE-OK no-secrets`，退出码 0。

## 判定

AC-006、AC-007、AC-008、AC-072 各自的 `V-xxx-n` 全部通过，且 `V-R-1` 到 `V-R-6` 全部通过，任务才算验收通过。任何一条失败，按失败的那条命令和它的输出写进 review。
