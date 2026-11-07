# Task 015 — Provider 夹具：fake-cli 生成器（11 个已知、1 个未知、6 种模式）

## 目标

来自 Blueprint 任务图 T-015（M2）。交付：
- test/fixtures/fake-cli/**
- test/helpers/fake-cli.mjs（生成垫片、读取记录）

## 约束

- 只允许写入以下路径（write_scope）：
  - test/fixtures/fake-cli/**
  - test/helpers/fake-cli.mjs
  - test/integration/fake-cli.test.mjs
  - test/traceability/T-015.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-035（levels: integration）：fake-cli 生成器在当前平台为 11 个已知 CLI 和 1 个未知 CLI 生成可执行垫片（win32 为 .cmd 加 node，posix 为带 shebang 的脚本）；支持 ok、auth、quota、timeout、deprecated、mismatch 六种模式；--help、--version、模型列表输出可配置；把 argv、环境变量名以及值的 sha256 写到记录目录。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-035

测试层级：integration

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
