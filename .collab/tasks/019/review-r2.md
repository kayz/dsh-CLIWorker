# T-019 评审第 2 轮（review-r2）

**结论：needs_revision（0/3 通过）**

评审的 git sha：`1bd40a6e945aea2851e8036c8bf4a81f5aa062e5`。我没有执行 git 命令，这个 sha 是读取 `.git/refs/heads/task/019` 得到的，与会话开头 gitStatus 的 `1bd40a6` 一致。

## 与第 1 轮相比

第 2 轮只改了 `lib/catalog.mjs` 和两个测试文件。ci-results.json 显示 AC-045 有 3 条测试、AC-046 有 4 条测试，均通过，fail、cancelled、skipped、todo 都是 0。这比第 1 轮的各 1 条多，但第 1 轮的两个 P0 阻断项都没有动：

- 四个管理写命令仍然不存在。
- `test/traceability/T-019.json` 仍然不存在。

impl.md 的第 2 轮增量也自述这些没有完成。

## 逐条核对

### AC-045 — 不通过

- ci-results.json：`tests 3 / pass 3`，退出码 0，结尾是 `run-tests: filtered 1 files`。命令本身能通过。
- 但 acceptance 要求同一文件逐项断言的内容，大部分没有实现：
  - `lib/commands/models/` 下只有 forecast.mjs、list.mjs、select.mjs，没有 allow.mjs、deny.mjs、level.mjs、alias.mjs，所以通过 main 分发五条路由、幂等、v1 写入返回 E_CONFIG、锁失败、原子写失败这些都无从测试。
  - `lib/commands/models/list.mjs:1-7` 仍然 import `providerStatus`，用旧的 `../../select.mjs` 的 `listModels`，没有 route 导出，没有使用 `lib/catalog.mjs`。这违反 design 第 2、10 条（list 不得依赖 providerStatus，且要走目录）。
  - 管理副本的 `availability.reason=not_allowed` 在 `lib/catalog.mjs` 中没有实现。grep 整个文件没有该字符串，测试也没有对应断言。
  - `lib/catalog.mjs` 的 `selectModels`（第 84-90 行）内部调用了 `filterAllowed`，白名单先于弃用和缺等级，这点正确。

### AC-046 — 不通过

- ci-results.json：`tests 4 / pass 4`，退出码 0。
- 已实现且有测试标题对应的部分：配置 > measured > cli 的优先级、同级取最新、等时冲突 E_CONFIG、弃用保留证据、非法价格被拒。我读了 `lib/catalog.mjs:57-76`，实现与 design 第 4、5 条基本一致。
- 缺失的部分：
  - 命令层的 E_LEVEL_REQUIRED、E_LEVEL_UNKNOWN 无法实现，因为 level.mjs 不存在。
  - alias 命令的 E_REQUEST_INVALID 冲突、allow/deny/level 对别名与规范 key 的等价性，无法验证。
  - 输出没有逐条用 `contracts/schemas/model.v1.schema.json` 校验，`validate` 是自写简化校验（`lib/catalog.mjs:8-17`）。
  - 令牌 canary 对管理输出、错误、stdout/stderr 的检查不存在。
  - `lib/catalog.mjs:86` 中 `deprecated` 配置只把 `=== true` 当作弃用，这与 design 第 8 条一致，这点没问题。

### 追踪检查 — 不通过

`test/traceability/T-019.json` 不存在（用 `ls` 确认）。acceptance 的追踪命令要求该文件存在且内容精确匹配，必然失败。impl.md 也记录该检查退出码 1。

### check-fast — 无法确认

ci-results.json 只包含 AC-045、AC-046 两项，没有 check-fast 和追踪检查的结果。impl.md 称因为其中的 check-write-scope 会执行 git 而没有运行。这一项没有执行证据，按规则不能算通过。我没有把它单独作为判 needs_revision 的理由，因为前面两个 P0 已经足够。

## 其他观察

- `lib/catalog.mjs:73-74` 中配置等级的 `level_source` 构造：有 `ctx.fs.statSync` 时取文件修改时间，否则用 `ctx.clock.nowIso()`，stat 失败现在抛 E_CONFIG，不再静默吞掉。这修了第 1 轮的 P1。
- 匹配的配置 `level_source` 现在会保留（第 69-71 行）。这也修了第 1 轮的一项。
- 其他元数据取 group 的最后一条（第 62 行），顺序依赖于输入顺序，没有证据显示与 T-017 的归一规则一致。T-017 的 `lib/models/**` 在工作树中仍不存在（`ls lib/models` 失败），这是上游依赖未就绪，需要编排方裁决；但命令模块与纯函数测试不依赖上游，不应缺席。

## 结论与建议

needs_revision。下一轮至少需要：

1. 新增 allow.mjs、deny.mjs、level.mjs、alias.mjs，并重写 list.mjs 使其走 `lib/catalog.mjs`、导出 route、管理副本标 not_allowed。
2. 补齐 acceptance 要求的测试（含 main 五条分发路径、写失败路径、schema 校验、canary）。
3. 创建 `test/traceability/T-019.json`，并在测试真实覆盖后再标 covered。
4. 若 T-017 确实未交付，由编排方决定依赖顺序，不要把缺失接口静默吞成空目录。

brief 未指定验收报告路径，没有追加目标。
