# T-019 评审第 3 轮（review-r3）

**结论：needs_revision（0/3 通过）**

评审的 git sha：`75e8abb5769b0e9a1a632261c48ecb2520be1c3e`。我没有执行 git 命令，这个 sha 是读取 `C:/git/dsh-CLIWorker/.git/refs/heads/task/019` 得到的，与会话开头 gitStatus 的最近提交 `75e8abb` 一致。

## 与第 2 轮相比

第 3 轮只补了 `lib/catalog.mjs` 的配置容器校验和测试（AC-045 共 3 条、AC-046 共 8 条，ci-results.json 显示全部通过，fail、cancelled、skipped、todo 均为 0）。第 2 轮的两个 P0 阻断项仍然原样存在，impl.md 第 3 轮增量也自述这些没有完成。

## 逐条核对

### AC-045 — 不通过

- ci-results.json：`tests 3 / pass 3`，退出码 0，结尾 `run-tests: filtered 1 files`。命令能通过，但只覆盖白名单过滤、回调计数和别名不绕过禁止这三个纯函数场景。
- acceptance 要求同一文件通过现有 main 和注入 ctx 覆盖 list、allow、deny、level、alias 的动态分发，以及幂等、未知目标、v1 写入、锁失败、原子写失败。`lib/commands/models/` 下只有 forecast.mjs、list.mjs、select.mjs，allow.mjs、deny.mjs、level.mjs、alias.mjs 不存在，这些场景无从测试。
- `lib/commands/models/list.mjs:1-7` 仍 import `providerStatus` 和旧 `select.mjs` 的 `listModels`，没有 `route` 导出，没有使用 `lib/catalog.mjs`。违反 design 第 2、10 条。
- 管理副本 `availability.reason=not_allowed`：`grep -c not_allowed lib/catalog.mjs` 结果为 0，未实现。

### AC-046 — 不通过

- ci-results.json：`tests 8 / pass 8`，退出码 0。
- 优先级 config > measured > cli、同级取最新、等时冲突 E_CONFIG、四档大小写、弃用保留证据、非法价格被拒、别名冲突、配置时间取文件元数据，这些纯计算部分有对应测试标题。
- 缺失：命令层 E_LEVEL_REQUIRED、E_LEVEL_UNKNOWN 与"均无配置写入"（level.mjs 不存在）；alias 命令的 E_REQUEST_INVALID；allow/deny/level 对别名与规范 key 的等价性；输出按 `contracts/schemas/model.v1.schema.json` 逐条校验（impl 用自写简化校验）；令牌 canary 对管理输出、错误、stdout/stderr 的检查。

### 追踪检查 — 不通过

`test/traceability/` 下只有 T-001 到 T-014，没有 `T-019.json`（ls 确认）。acceptance 的追踪命令要求该文件精确匹配，必然失败。

### check-fast — 无法确认

ci-results.json 只有 AC-045、AC-046 两项，无追踪检查和 check-fast 结果；impl.md 称 check-fast 因间接执行 Git 而未运行。没有执行证据，不能算通过。

## 上游依赖

`lib/models/` 仍不存在，T-017 未交付。这是编排方需要裁决的依赖问题；但命令模块、管理副本、追踪分片和纯函数测试不依赖 T-017，不应缺席。连续三轮未动这些 P0，建议编排方确认是否应拆任务或调整依赖顺序，而不是继续同样的重试。

## 建议

1. 新增 allow.mjs、deny.mjs、level.mjs、alias.mjs；重写 list.mjs 走 `lib/catalog.mjs`、导出 route、管理副本标 not_allowed。
2. 补齐 acceptance 要求的测试（main 五条分发路径、写失败路径、model/v1 schema 校验、canary）。
3. 测试真实覆盖后创建 `test/traceability/T-019.json` 并标 covered。
4. 若 T-017 确实阻塞，由编排方明确裁决，不要把缺失接口吞成空目录。
