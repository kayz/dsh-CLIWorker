# Task 015 评审（review）

- 评审 sha：f48179b6c67b4ef5bc7004c3ad6655a069e439cc（task/015 HEAD，工作区另有未提交的 .collab 状态文件，不涉及被评审代码）
- 结论：needs_revision（通过 0/1）

## AC-035

执行证据：ci-results.json 记录 AC-035 退出码 0，末行 `AC-035 OK`，约 54.83 秒。该命令所列的机械条件（T-015 分片深相等、直接 node:test 无 fail/cancelled/skipped/todo、正式清单 filtered/AC-035/仅一个文件、跳过日志为空）视为满足。

我另外只读核对了实现与 design.md 的符合程度，发现两处偏差。第一处是验收文本明文要求的断言缺失，所以判不通过。

### 符合的部分

- T-015.json 与 interfaces.md 第 15 节结构一致（test/traceability/T-015.json:1-7）。
- 12 个名称（11 个已知加 unknown-cli）乘 6 种模式全部真实执行，名单与模式由测试独立给出（fake-cli.test.mjs:11-12, 73-122）。
- 每次启动先原子发布记录再响应：先写 .tmp，再 rename 成 .json（runtime.js:10-12）。读取入口只读 .json，空目录返回 []，损坏记录抛固定文案错误且不回显正文（helper:24-30，测试 68-72）。
- 记录字段仅 argv、envNames、sha256、cwd，测试断言 key 集合（测试 110），并独立计算 SHA-256 核对（113-114）。
- 并发 12 次、两个实例共用记录目录，断言不丢记录、无 .tmp 残留、未注入变量不出现（测试 123-138）。
- help/version/模型列表优先于模式分支，逐字节输出，且每个实例配置各异（测试 98-104）。
- win32 的 .cmd 行为 `node "%~dp0name.mjs" %*`，与 lib/exec.mjs:113-146 的 resolveShim 匹配，由 createExec 直接解析执行，不经 shell。
- 哨兵扫描覆盖生成文件、记录、stdout、stderr 和 error，且失败信息不回显哨兵（测试 139）。

### Findings

**F1（P1）：timeout 用例没有断言进程已退出，也没有断言无遗留子进程**
- 位置：test/integration/fake-cli.test.mjs:82-96, 140-143。
- acceptance.md 与 design.md 约束 9、验收方向要求「每个 timeout……无遗留进程和伪时钟定时器」「等进程退出后再清理」。
- 现状：只断言 `timers.size === 0`（93, 140）。`children` 集合只在 finally 里用 `child.kill()` 兜底清理，从未断言 `children.size === 0`，也没有等 close 事件。
- 失败场景：若 createExec 的超时路径没有真正杀掉进程，或 Windows 下 taskkill 被拒，那么 `trackedSpawn`（33-38）的回退 kill 与 finally 的 kill 会把问题静默掩盖，测试照样通过。
- 修复：在 `checkResult(timeout)` 之后等待该子进程 close，断言 `children.size === 0`（或进程已退出）。在 finally 兜底 kill 之前先断言。

**F2（P2）：每个实例复制了完整运行逻辑，与「共享运行脚本」设计不符**
- 位置：test/helpers/fake-cli.mjs:8, 16。
- design.md 目标第一条要求 fixtures 保存共享 ESM 运行脚本，「避免复制 72 份运行逻辑」；约束 2 要求脚本「按自身位置读取生成数据」。
- 现状：helper 读入 runtime.js 全文，与 `const config = …` 拼接后写入每个实例，共 72 份完整副本。runtime.js 本身不是可独立运行的 ESM（依赖外部注入的 `config`）。
- 修复：让每个实例只保留一个很薄的入口，按 `import.meta.url` 或 `__dirname` 读取同目录的数据文件，并导入共享运行脚本。

### 次要观察（不影响判定）

- mismatch 的 reported_model 固定为 `other-model`，测试只用 `notEqual('requested-model')` 比较，而 `requested-model` 只是一个普通 argv。语义偏弱，但与「调用者给定、不另造 schema」不冲突。
- 未设置 `help` 或 `version` 时，`process.stdout.write(undefined)` 会落入 catch 并输出「fake-cli failed」。属于调用者误用，可忽略。
- impl.md 未运行 check-fast.ps1 的理由是它会调用 Git。本轮评审同样不执行 Git，故不作为 finding。
- POSIX 的 shebang、执行权限和 LF 行尾只能静态核对：helper:16-17 写入 mode 0o755 加 chmod，测试 79 在非 win32 上断言权限位。本机为 win32，未实跑 POSIX 路径，各主机需分别证明。
