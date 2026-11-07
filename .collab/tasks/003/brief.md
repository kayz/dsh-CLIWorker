# Task 003 — 可注入缝与可推进时钟、import-safe 入口、命令路由骨架、宿主与上下文契约

## 目标

来自 Blueprint 任务图 T-003（M1）。交付：
- lib/context.mjs（createContext、真实 clock、CLIWORKER_TEST_CLOCK_FILE）
- lib/exec.mjs（迁入现有 spawn，安全化在 T-010）
- lib/cli.mjs 导出 main(argv, ctx)，含 W_TEST_CLOCK
- lib/commands/<cmd>/<sub>.mjs（迁入现有命令）
- lib/index.js 的 createPlugin、getRegistration、strict
- contracts/host/dsh-host.v1.json
- contracts/context/context.v1.json
- test/helpers/ctx.mjs、clock.mjs、host-stub.mjs
- scripts/check-seams.mjs（含定时器规则）

## 约束

- 只允许写入以下路径（write_scope）：
  - lib/context.mjs
  - lib/exec.mjs
  - lib/cli.mjs
  - lib/commands/**
  - bin/cliworker.mjs
  - lib/index.js
  - lib/availability.mjs
  - lib/config.mjs
  - lib/forecast.mjs
  - contracts/host/**
  - contracts/context/**
  - test/helpers/ctx.mjs
  - test/helpers/clock.mjs
  - test/helpers/host-stub.mjs
  - scripts/check-seams.mjs
  - test/fixtures/seams/**
  - test/unit/seams.test.mjs
  - test/unit/import-safe.test.mjs
  - test/unit/clock.test.mjs
  - test/contract/host-stub.test.mjs
  - test/contract/context.test.mjs
  - test/integration/registration.test.mjs
  - test/traceability/T-003.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-006（levels: unit）：在子进程中 import lib/cli.mjs 与 lib/index.js：stdout 和 stderr 都是 0 字节，退出码 0。main(argv, ctx) 返回 {exitCode}，输出写入 ctx.stdout。lib 下没有任何 process.exit。
- AC-007（levels: unit）：check-seams 断言：lib 下只有 lib/exec.mjs 导入 node:child_process；只有 lib/context.mjs、lib/store.mjs、lib/fsx.mjs 导入 node:fs；不带参数的 Date.now、new Date、全局 setTimeout、setInterval、setImmediate 与 node:timers 只出现在 lib/context.mjs。test/fixtures/seams 下每类违规样例都被报出。
- AC-008（levels: contract, integration）：宿主 stub 通过 contracts/host/dsh-host.v1.json 的契约测试。createPlugin 返回已注册路径列表。stub 的 register 抛错时：report.errors 非空，getRegistration().status 为 failed；strict:true 时 apply 抛出；任何情况下都不能只把错误写进 console 就当通过。
- AC-072（levels: unit）：时钟：contracts/context/context.v1.json 描述 ctx 接口面，test/helpers/ctx.mjs 与 createContext 都符合它。伪时钟：advance(1000) 前后两次 now() 恰差 1000；setNow 可前后设置；经 clock.setTimeout 注册的回调按到期时间、相同时按注册顺序在 advance 中触发，未到期的不触发，pending() 计数正确；clock.sleep 只在 advance 后完成。真实 createContext 在设置 CLIWORKER_TEST_CLOCK_FILE 时 now() 返回文件中的值，且每次调用都重新读取；此时 main() 输出的 warnings 含 W_TEST_CLOCK；未设置时不出现该警告。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-006
- node scripts/check-seams.mjs
- node scripts/run-tests.mjs --ac AC-008
- node scripts/run-tests.mjs --ac AC-072

测试层级：contract, integration, unit

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
