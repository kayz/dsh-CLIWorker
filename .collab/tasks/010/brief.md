# Task 010 — 安全进程执行层：去掉 shell、win32 垫片解析、参数白名单、ctx 时钟超时、杀进程树、并发上限（A5 shell 问题）

## 目标

来自 Blueprint 任务图 T-010（M2）。交付：
- lib/exec.mjs 安全版（超时经 ctx.clock）
- lib/availability.mjs 改为经 exec 调用
- test/fixtures/exec/**（垫片样本、派生孙进程并写屏障文件的脚本）
- defects/a5-shell 的 [fixed] 部分

## 约束

- 只允许写入以下路径（write_scope）：
  - lib/exec.mjs
  - lib/availability.mjs
  - test/unit/exec.test.mjs
  - test/integration/exec-native.test.mjs
  - test/integration/exec-tree.test.mjs
  - test/fixtures/exec/**
  - test/characterization/defects/a5-shell.test.mjs
  - test/traceability/T-010.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-026（levels: unit）：exec 层每次 spawn 都是 shell:false（由注入的 spawn 记录断言）。10 个敌意参数（& | ; ^ % ! 空格 双引号 换行 反引号）在直接执行时原样传递，在 cmd 回退路径上返回 E_UNSAFE_ARG。npm v6、npm v7+、pnpm、bun 四种 .cmd 垫片夹具都能解析出 {node, script}；注入的 spawn 对 .cmd 抛 EINVAL 时转入解析路径。全部为纯单测，三平台都跑。defects/a5-shell 的 [fixed] 部分通过。
- AC-027（levels: integration）：win32 原生用例（baseline win32，其他平台写跳过记录）：测试在临时目录自行生成 npm v7+ 形态的 .cmd 垫片指向夹具 node 脚本，不依赖 runner 已安装的垫片；带 a&b 与空格参数调用时，exec 解析垫片后直接用 node 执行，脚本记录到的 argv 与传入完全一致，且全程未调用 cmd.exe。
- AC-028（levels: integration）：超时：exec 的超时定时器经 ctx.clock 注册。夹具脚本派生孙进程并写出 pid 屏障文件；测试等到屏障文件出现后对伪时钟 advance(timeout_ms)，得到 E_TIMEOUT；随后轮询（上限 5 秒）对子进程和孙进程 process.kill(pid,0) 都抛 ESRCH。并发上限 4 时运行 10 个任务：用 wx 计数文件观测到的最大并发 <= 4，且 10 个全部完成。不断言墙钟时间。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-026
- node scripts/run-tests.mjs --ac AC-027
- node scripts/run-tests.mjs --ac AC-028

测试层级：integration, unit

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
