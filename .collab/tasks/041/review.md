# Task 041 评审

验证的 git sha：`f43467f417c77ad8f31e067f470f0ca443f120d2`（分支 task/041，读自 `.git/refs/heads/task/041`；评审期间未执行 git）。
通过数/总数：2/2（AC-084、AC-006）。结论：**pass**。

## 证据口径

`ci-results.json`（ranAt 2026-11-09T12:56:30+08:00）：`passed=2 total=2 ok=true`；AC-084 exitCode 0、lastLine `AC-084 OK`；AC-006 exitCode 0、lastLine `AC-006 OK`，TAP 汇总 `tests 535 / pass 535 / fail 0 / cancelled 0 / skipped 0 / todo 0`。
注意：AC-084 在 ci-results 中只保存了最后一个命令块（check-fast）的输出。前三块的结果由整节 `passed=true、exitCode=0` 间接证明，并有以下旁证：
- check-fast 输出含 `==> check-generated-fresh.mjs`、`test/fixtures/release-gate/generate.mjs: fresh`、`scripts/gen-contract-doc.mjs: fresh`、`AC-084 OK`、`check-fast: ok`。这同时证明真实资产 fresh，且被 CI 自动发现。
- `npm test`（906 项，fail 0、skipped 0、todo 0）里含三个 `[AC-084]` 用例，均通过。
- 同一次 check-fast 中，check-write-scope、check-frozen-files、check-golden-frozen、check-contract-doc、check-acceptance 全部 ok。

## 逐条核对（读 `scripts/check-generated-fresh.mjs`、测试、`docs/release-checklist.md`）

| 要求（design.md） | 结论 | 证据 |
|---|---|---|
| 固定两项生成关系，输入集符合规格 | 满足 | check-generated-fresh.mjs:9-12。release-gate 输入为 package.json 和 ac-index.json；contract-doc 输入为 registry.snapshot、golden/manifest、schemas |
| 每项独立 `os.tmpdir()` 隔离根，不复制旧输出 | 满足 | :102-103 每项 `mkdtempSync`，只复制生成器和输入 |
| process.execPath、argv 数组、windowsHide、timeout、maxBuffer，无 shell | 满足 | :106 |
| contract-doc 带 `--root <temp>` | 满足 | :105 |
| 启动错误、signal、非零退出都算失败 | 满足 | :107 |
| 资产路径集合取并集，捕获缺失和多余；排除根层 generate.mjs；符号链接和不支持类型失败 | 满足 | :28-37、:108-115 |
| 失败项输出包含生成器相对路径，差异含资产路径；两项都执行并报告，不短路 | 满足 | :121 `console.error(generator: ...)`；循环无 early return |
| 清理放 finally，清理失败使检查失败 | 满足 | :118-120 |
| 成功哨兵只在全部通过时输出；未知或缺值参数、根不存在均失败；import 不自动执行 | 满足 | :127-139 |
| CRLF→LF 之外逐字比较 | 基本满足 | :89。见 F1（BOM） |
| TAP 规范化：只处理 duration_ms 数值、诊断块内的 type 和 location、stack 标量块；保留汇总行存在性 | 满足 | :39-57。duration 仅在合法数值时替换，其余诊断字段原样保留 |
| node 版本规范化：仅限顶层 node 字段的合法版本串，保留原格式；非法值不忽略；空 skips 保持为空 | 满足 | :59-86。深度跟踪只匹配 depth===1 |
| 规范化仅应用于 reporter.tap、smoke.json、ci/*/files-executed.json、ci/*/skips.jsonl | 满足 | :91-92 |
| 写域 | 满足 | check-write-scope: ok（CI） |
| docs/release-checklist.md：命令、两个生成器及输出范围、CI 接入、失败后的维护流程、只规范化环境元数据、不替代 real-smoke 和发布放行；保留原有内容 | 满足 | release-checklist.md:3-9；:11 起原有 WSL、真机、脱敏、waiver 内容完整 |
| 单元测试：真实 CLI + `--root` + 临时根替身；快照前后相等；规范化正反边界；启动失败和 timeout 受控注入且两项均被调用 | 大体满足 | 测试文件:41-48、:53-84。缺口见 F2 |

## AC 结论

- **AC-084：通过。** 单元块：CI 的 npm test 含 3 个 `[AC-084]` 用例并通过，fail/skipped/todo 均为 0。独立替身块：脚本逻辑与断言相符，覆盖干净、损坏、索引变化、缺失、多余、doc 过期、双项过期、生成失败、生成器缺失、输入缺失。我读脚本确认其行为符合这些预期，但该块的输出不在 ci-results 中保存，属间接证明。真实资产块：check-fast 输出 `release-gate/generate.mjs: fresh` 与 `gen-contract-doc.mjs: fresh`。check-fast 块：含 `==> check-generated-fresh.mjs`、`AC-084 OK`、`check-fast: ok`。
- **AC-006：通过。** 535/535，fail、cancelled、skipped、todo 均为 0，末行 `AC-006 OK`。

## Findings（均为 P2，非阻断）

- **F1（P2）** `scripts/check-generated-fresh.mjs:89`：`new TextDecoder('utf-8', { fatal: true })` 默认会丢弃开头的 UTF-8 BOM。因此"仅在已提交资产带 BOM"或"仅在生成结果带 BOM"的差异会被当作相等，超出 design 允许的"仅 CRLF→LF"容差。建议传 `{ ignoreBOM: true }`，让 BOM 保留在字符串中参与比较。目前生成器不产出 BOM，所以不影响现有结果。
- **F2（P2）** `test/unit/check-generated-fresh.test.mjs` 相对 design 的测试清单略薄：
  - 未单独覆盖"只改坏 docs/contract.md → 仅指名 gen-contract-doc.mjs"（只在 doc 与夹具同时过期的场景中出现；独立替身块有覆盖）。
  - 未包含"先覆盖资产再非零退出"的替身来专门验证隔离。
  - 未验证 invalid duration、stack 反例等规范化边界。
  - 成功路径未断言两个生成器各调用一次（仅在注入失败场景断言 calls===2）。
  这些行为大多由独立替身块和实现逻辑覆盖，不影响通过。

## 结论

全部验收项满足规格，CI 执行证据完整一致，无 P0/P1。判 pass，F1 和 F2 作为后续改进建议。
