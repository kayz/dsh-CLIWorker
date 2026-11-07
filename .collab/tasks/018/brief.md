# Task 018 — 调用适配器：按平台和 CLI 生成调用（只读、cwd、stdin、WSL）、事件解析、cli resolve

## 目标

来自 Blueprint 任务图 T-018（M3）。交付：
- lib/adapters/**（buildCall、parseEvent、展示串引用）
- lib/commands/cli/**
- test/fixtures/adapters/golden/**

## 约束

- 只允许写入以下路径（write_scope）：
  - lib/adapters/**
  - lib/commands/cli/**
  - test/unit/adapters.test.mjs
  - test/unit/adapters-unverified.test.mjs
  - test/fixtures/adapters/**
  - test/traceability/T-018.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-043（levels: unit）：每个已知 CLI 在 win32、darwin、linux、wsl:Ubuntu 上的 buildCall 输出与 test/fixtures/adapters/golden 深相等；cwd 含空格和单引号时结果正确；wsl 用 --cd 与 --exec，任何参数都不同时含 cd 和 &&；cli resolve 返回带模型的 direct_call，以及 pwsh 和 posix 两种展示串，posix 展示串经纯函数解析后与 args 一致。
- AC-044（levels: unit）：参数形态未确认的 CLI，buildCall 返回 call:null 和 adapter_unverified；在选模夹具中，这类模型只出现在 rejected 里，models 和 calls 中没有对应的 handle。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-043
- node scripts/run-tests.mjs --ac AC-044
- node bin/cliworker.mjs cli resolve --model <key> --cwd . --platform linux --config <夹具配置>

测试层级：unit

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
