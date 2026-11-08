# Task 016 — 平台识别与本地 CLI 发现：WSL 跨发行版解析、拒读清单、增量清单

## 目标

来自 Blueprint 任务图 T-016（M3）。交付：
- lib/discovery/**（platform、rules、scan、wsl、inventory）
- lib/fsx.mjs
- lib/commands/discover.mjs
- test/flows/steps/discover.mjs

## 约束

- 只允许写入以下路径（write_scope）：
  - lib/discovery/**
  - lib/fsx.mjs
  - lib/commands/discover.mjs
  - test/unit/discovery/**
  - test/integration/discovery.test.mjs
  - test/integration/discovery-incremental.test.mjs
  - test/integration/discovery-deny.test.mjs
  - test/fixtures/discovery/**
  - test/flows/steps/discover.mjs
  - test/traceability/T-016.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-036（levels: integration）：在夹具 PATH 与已知安装目录下发现 11 个已知 CLI，每个记录 path、realpath、version、platform、evidence；未知 CLI 标为 recognized:false，对它的 exec 计数为 0；只有 --probe-unknown 时才执行它的 --version。
- AC-037（levels: unit）：平台识别表（process.platform、/proc/version、WSL_DISTRO_NAME 均注入）判定正确。wsl -l -q 的 UTF-16LE 夹具（含 BOM、CRLF、NUL、默认发行版标记）解析出发行版列表；每个发行版生成 platform 为 wsl:<d> 的独立条目；每个发行版调用的 args 与常量模板深相等，不含插值。
- AC-039（levels: integration）：第二次运行 discover 时，指纹不变且在 TTL 内的条目 exec 计数为 0；被删除的 CLI 标为 gone 且条目保留；--full 重新执行；inventory.json 通过 inventory/v1 校验。
- AC-040（levels: integration）：discover 全程对拒读清单路径的 fsx 访问探针计数为 0；evidence 中只有 digest 和脱敏摘要，leak-scan 检查原始输出哨兵 0 命中。

任务图给的验收方向：
- node scripts/run-tests.mjs --ac AC-036
- node scripts/run-tests.mjs --ac AC-037
- node scripts/run-tests.mjs --ac AC-039
- node scripts/run-tests.mjs --ac AC-040

测试层级：integration, unit

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
