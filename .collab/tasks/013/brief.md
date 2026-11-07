# Task 013 — 用户提供令牌的密钥管理：SecretRef、OS 后端、只经 env 注入

## 目标

来自 Blueprint 任务图 T-013（M2）。交付：
- lib/secrets/**（env、keychain：DPAPI 经 pwsh、security、secret-tool；session）
- lib/commands/auth/**
- lib/config.mjs 明文令牌检测
- test/flows/steps/auth.mjs

## 约束

- 只允许写入以下路径（write_scope）：
  - lib/secrets/**
  - lib/commands/auth/**
  - lib/config.mjs
  - test/unit/secrets.test.mjs
  - test/integration/secrets-native.test.mjs
  - test/flows/steps/auth.mjs
  - test/traceability/T-013.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-032（levels: integration）：flows 的 auth 步骤：auth set kimi --from-env SENTINEL 与从 stdin 设置两种方式都成功；fake-cli 记录显示令牌只出现在适配器声明的环境变量里（sha256 一致），argv 中没有；leak-scan 在所有位置都 0 命中。
- AC-033（levels: unit）：配置中键名匹配 token、api_key、secret、password（不区分大小写）且值为字符串而非 SecretRef 时返回 E_CONFIG_SECRET_INLINE。注入的 exec 让 secret-tool、security、pwsh 返回 ENOENT 时，对应后端返回 E_SECRET_BACKEND，state_dir 文件列表不变。auth status 只输出 set 或 unset。三个平台后端的命令构造为纯单测（baseline linux）；原生后端用例按平台门控，只作附加。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-032
- node scripts/run-tests.mjs --ac AC-033

测试层级：integration, unit

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
