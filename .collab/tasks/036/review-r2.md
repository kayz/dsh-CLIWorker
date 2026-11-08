# Task 036 评审 r2（review）

评审对象：工作树 HEAD `57a8ea9`（取自会话 gitStatus 快照，按约束未执行 git 复核）。结论：**needs_revision**，验收命令通过 2/2（CI 口径），但上轮两个 P1 均未修复。

## 验收逐条

| 条目 | 结论 | 证据 |
|---|---|---|
| AC-079 `node scripts/check-no-model-table.mjs` | 通过 | ci-results.json（ranAt 2026-11-08T23:22:51+08:00）：exitCode 0，lastLine `AC-079 OK`。 |
| AC-006 `node --test "test/unit/*.test.mjs"` | 通过 | ci-results.json：exitCode 0，lastLine `AC-006 OK`，`# tests 362 / # pass 362 / # fail 0`。 |

CI 的 2/2 只覆盖这两条命令，不覆盖 flow 测试和 `check-contract-doc`。

## 上轮 findings 复核

### F1 [P1] 仍未修复：enumerate flow 步骤令 `[AC-031] full flow` 失败
- 我运行 `node --test test/flows/flow.test.mjs`，结果 7 pass / 1 fail。
  - 失败项：`not ok 2 - [AC-031] full flow runs all discovered steps in one state_dir`。
  - 报错：`enumerate: ... 3 !== 0`。
- 原因没有变。
  - `test/flows/steps/enumerate.mjs:10` 仍然是 `flow.run(['models','enumerate','--config', flow.config_path])`。
  - `test/helpers/flow.mjs` 里没有 `catalog`（grep 无结果）。
  - `lib/models/directory.mjs:90` 在 `catalog.manual` 不是数组时抛 `E_CONFIG`，退出码 3。
- 所以 design 的前提「既有 flow 配置带单条 q 模型即可枚举」不成立。步骤文件本身没有改动来解决这一点。
- 此前绿的测试被新增步骤弄红。这个回归在 `test/unit` 之外，CI 的 AC-006 看不到。
- 建议：
  1. 步骤在 `flow.root` 下自写一份带 `catalog.manual` 单条 q 记录的 `cliworker.config/v2` 临时配置，用 `--config` 指向它；不改 flow 夹具和模型代码。
  2. 或由调度器裁决把 `test/helpers/flow.mjs` 纳入 write_scope。
- 修复后 `node --test test/flows/flow.test.mjs` 必须全绿。

### F2 [P1] 仍未修复：`docs/contract.md` 内嵌的索引摘要过期
- `node scripts/check-contract-doc.mjs` 输出 `FAIL contract_doc.stale docs/contract.md`，退出码 1。
- `docs/contract.md` 里 `contracts/spec/ac-index.json` 一行仍是旧摘要 `809631c8…`。
- 我重新计算该文件的 sha256 为 `c80c95bb…`。这与冻结清单一致：`node scripts/check-golden-frozen.mjs` 输出 `ok (14 files)`，退出码 0。
- 过期由本任务授权的索引追加造成。`docs/contract.md` 不在 write_scope，所以需要调度器扩大范围，用 `scripts/gen-contract-doc.mjs` 重新生成，或明确豁免。
- 它会让 `scripts/check-fast.ps1` 失败。

### F3 [P2] 仍未解决：没有 check-fast 的执行证据
- impl.md 仍写着 flow 与契约文档问题未解决，且 check-fast 未运行。
- impl.md 的末尾内容与本轮「address review findings」的提交不符。它没有记录第二轮做了什么。
- F1、F2 修复后需要提供一次完整 `scripts/check-fast.ps1` 的结果。

## 其余交付物（沿用 r1 结论，本轮未发现变化）
- `scripts/check-no-model-table.mjs`、`test/unit/check-no-model-table.test.mjs`、`test/traceability/T-036.json`、中央索引追加（75 条）及冻结清单摘要同步，r1 已核对符合 design。本轮 CI 的 362 项单元测试全绿，没有出现矛盾。
- 本轮没有重新逐行审阅这些文件，只靠 CI 结果、冻结检查和索引摘要核对。

## 说明
- 本轮没有执行 git。我只运行了 `node --test test/flows/flow.test.mjs`、`node scripts/check-contract-doc.mjs`、`node scripts/check-golden-frozen.mjs` 和 `sha256sum`，都是只读检查。
- 我没有改动被评审的代码和文档，只创建了 `review-r2.md` 和 `verdict-r2.json`。
