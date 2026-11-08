# Task 026 评审（第 1 轮）

评审对象：分支 `task/026`，HEAD = `c57e0d32de0998bf634a51b24225b6a54d3782fe`（`stage(dev): task 026`）。该 SHA 取自只读文件 `C:/git/dsh-CLIWorker/.git/worktrees/026/HEAD`（指向 `refs/heads/task/026`）和 `.git/refs/heads/task/026`，未执行 git 命令。

结论：**pass**（acceptance.md 的 AC-064 小节，6 条命令均满足）。另有 3 条不阻塞的 P2 观察。

## 证据口径

- `ci-results.json`：`passed=1, total=1, ok=true`，`ranAt=2026-11-09T03:42:22+08:00`，晚于 HEAD。它只包含 AC-064 第一条命令的输出（`select-run.test.mjs`，`# tests 1 / pass 1 / fail 0 / cancelled 0 / skipped 0 / todo 0`，末行 `AC-064 OK`）。其余五条命令没有 CI 输出，下面分别用只读核对或独立执行补充。
- 我另行执行了两条只读/自清理的 node 命令，没有写入仓库：
  - `node --test --test-reporter=tap test/e2e/select-run-sequence.test.mjs`：退出 0，4 个测试，fail/cancelled/skipped/todo 均为 0。
  - `node scripts/check-traceability.mjs`：输出 `check-traceability: ok (covered=65 planned=10)`。

## 逐条核对（acceptance.md AC-064 的 6 条命令）

1. **select-run.test.mjs**（CI 证据，加代码核对）
   - HTTP 路径：`select-run.test.mjs:57-63`
     - `createHostStub` 加真实 `createPlugin`，经 `host.request('/cliworker/select', POST)` 调用；断言 `statusCode===200`。
   - CLI 路径：`:65-67`
     - `spawnSync(process.execPath, [bin/cliworker.mjs, 'models','select','--config',…,'--request',…], shell:false, windowsHide:true)`；断言无 error、无 signal、`status===0`。
   - 响应断言：`:69-73`
     - `ok`、`models`/`calls` 长度、`calls[i]` 深等于 `models[i].call`，`--lease` 等于 `lease_id`。
   - `--config`/`--state-dir`：`:76`、`:108-111`
     - `arg()` 断言各恰好出现一次且有值，并与夹具预先确定的绝对路径比较，不只是互相比较。
   - 夹具隔离：`:30-46`
     - `mkdtemp` 目录名和 cwd 目录名都带空格，cwd 与仓库根不同。
     - 环境变量过滤掉 `NODE_TEST_CONTEXT` 和 `CLIWORKER_*`，再注入 `CLIWORKER_HOME`、`CLIWORKER_TEST_CLOCK_FILE`。
     - fake-cli 是 Node 脚本，通过 `cli_overrides` 接入，无 sleep。
     - 两个入口用不同的 `request_id`（`http-one`、`cli-one`）。
   - 原样执行：`:51-54`
     - 使用 `call.command`、`call.args`、`call.cwd`，`shell:false`，`windowsHide:true`，有 60s 挂起保护。
     - 输入为含中文、多行、尾随空格的 `INPUT`，未 trim。
   - 事件校验：`:77-83`
     - 每个非空行单独 `JSON.parse`，并用 `validate(event.v1 schema)` 校验，要求 `{ok:true,errors:[]}`。
     - 断言 `seq` 连续、`lease_id` 正确、`at` 等于时钟，stderr 为空。
   - 成功判定：`:84-89`
     - 首事件 `start`，`result` 唯一，无 `error` 事件。
     - 末事件 `result.ok`、`exit_code=0`，`text`/`usage` 等于固定值。
   - fake-cli 记录：`:95-100`
     - 断言 pid 不等于测试进程，`cwd`、`input` 逐字相等。
     - `argv` 与适配器模板一致，`--model` 取自租约持久化的 `model_key`。
   - 重放：`:117-120`
     - 状态 6，`E_LEASE_CONSUMED`，`retryable=false`，`exit_code=6`，无成功 `result`。
     - 调用记录数不变，`usage.jsonl` 字节相同，`:post` 恰一条。
   - 清理：`:48` 的 `cleanup` 在 `finally` 中删除临时根并断言不存在。
   - 结论：满足。

2. **select-run-sequence.test.mjs**（独立执行 4/4 通过）
   - 测试：HTTP 和 CLI 各两个。
   - 序列组（`:7-26`）：
     - 断言 3 个 lease 互异。
     - 断言 `models[i].expires_at === ISO(AT + TTL*1000 + i*TIMEOUT)`，独立计算，没有调用 `expiresAtFor`。
     - 把时钟写成 `…+i*TIMEOUT-1000` 后原样运行 `calls[i]`，每步 `at` 等于该步时钟。
     - `i>0` 的时刻显式断言大于 `models[0].expires_at`。
     - 记录数逐步递增，每个 lease 的 `:post` 恰一条，每步 input/cwd/argv 各自保留。
   - 过期组（`:27-39`）：
     - 新夹具、不执行前序调用。
     - 时钟设为 `Date.parse(models[2].expires_at)+1000` 后运行 `calls[2]`。
     - 断言 `E_LEASE_EXPIRED`、`retryable=true`、退出码 6、无 `result`。
     - fake-cli 记录 0 条，该 lease 无 `:pre`/`:post` 行。
   - 结论：满足。

3. **追踪**：`test/traceability/T-026.json:1-14`
   - 只有 `task/milestone/entries` 三个字段。
   - 值为 `T-026`、`M5`；一条 `{ac:'AC-064', files:[两个 e2e 文件], status:'covered'}`，无 baseline 或额外字段。
   - 我执行的 `node scripts/check-traceability.mjs` 输出 `check-traceability: ok`。
   - 结论：满足。

4. **unit 回归**
   - 本任务只新增 `test/e2e/*` 和追踪分片，没有改 `lib/**`、`scripts/**`、`package.json`、`contracts/**`。`worktrees/026/test/` 下只有这两个 e2e 文件。
   - impl.md 自报 480 通过、1 跳过、0 失败。
   - 本轮无 CI 输出，我也没有重跑（全量会写文件，且 `gitignore.test` 间接调用 git）。
   - 按任务范围判断这不是新增风险。
   - 结论：满足，证据为自报加范围推理，见 P2-3。

5. **check-acceptance**
   - CI 的 runner 已成功解析本文件，得到 1 个 AC 并按哨兵判定。
   - impl.md 自报 warnings=0。
   - 结论：满足。

6. **check-fast**
   - impl.md 明确说明因任务禁止 git 而未执行，没有声称通过。
   - 子检查中，`check-acceptance` 和 `check-traceability` 已确认。`run-tests` 枚举 `e2e` 目录（`scripts/run-tests.mjs:19`），以 `node --test <files>` 方式一文件一进程运行。
   - 因此 `select-run.test.mjs` 的 `argv[1]` 守卫在全量运行中同样生效，两个文件分别只注册各自的测试，不会被 sequence 文件重复注册。
   - 完整 check-fast 无运行证据，但没有与代码矛盾之处。
   - 结论：见 P2-3，不阻塞。

## Findings（均为 P2，不阻塞）

- **P2-1**：`failure()` 把退出码硬编码为 6（`select-run.test.mjs:91-93`）。设计要求等于注册表值（当前为 6）。当前注册表 `contracts/registry.snapshot.json:150-163` 中两者确为 6，所以现在是对的；若注册表改动，测试会误报失败。建议后续改为读取注册表。
- **P2-2**：`run()` 的超时固定为 60000，没有使用 `call.timeout_ms`（`select-run.test.mjs:53`）。设计允许"明确的外层挂起保护"，因此合规，仅作说明。
- **P2-3**：unit 全量回归和 `check-fast.ps1` 没有 CI 执行证据（CI 只覆盖第一条命令），依赖 impl.md 自报和范围推理。建议编排方在有 git 权限的环境补跑一次全量门禁。

## 其他核对

- 写域：交付文件仅为 `test/e2e/select-run.test.mjs`、`test/e2e/select-run-sequence.test.mjs`、`test/traceability/T-026.json`。
- 未发现对 `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs` 的改动。
- 全程未使用 `Date.now()`、墙钟 sleep 或超时竞速判断租约；时间只来自共享时钟文件。
- brief 和 design 都未指定验收报告路径，所以没有可追加的报告文档。
