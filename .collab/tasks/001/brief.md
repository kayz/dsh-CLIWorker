# Task 001 — 测试运行器、完整与过滤两种模式、CI 矩阵、check-fast、AC 索引、追踪合并、里程碑门与缺陷检查（A3）

## 目标

来自 Blueprint 任务图 T-001（M1）。交付：
- package.json 的 scripts（test、check、perf、snapshot:update）
- scripts/run-tests.mjs 与 reporters/files.mjs（files-executed.json，mode full 或 filtered）
- scripts/check-test-discovery.mjs、check-fast.mjs、check-fast.ps1、check-traceability.mjs、check-ci.mjs、gen-ci.mjs、ci-matrix.json
- scripts/milestone-gate.mjs、check-defects.mjs
- contracts/spec/ac-index.json（AC-001..AC-074 的属主、里程碑、层级、baseline）
- .github/workflows/ci.yml
- package-lock.json
- test/unit/select.test.mjs（迁入）
- test/helpers/platform-gate.mjs
- defects/a3-runner 的 [fixed] 部分

## 约束

- 只允许写入以下路径（write_scope）：
  - package.json
  - package-lock.json
  - scripts/run-tests.mjs
  - scripts/reporters/**
  - scripts/check-test-discovery.mjs
  - scripts/check-fast.mjs
  - scripts/check-fast.ps1
  - scripts/check-traceability.mjs
  - scripts/check-ci.mjs
  - scripts/gen-ci.mjs
  - scripts/ci-matrix.json
  - scripts/milestone-gate.mjs
  - scripts/check-defects.mjs
  - contracts/spec/ac-index.json
  - .github/workflows/**
  - test/select.test.mjs
  - test/unit/select.test.mjs
  - test/unit/runner-selftest.test.mjs
  - test/unit/traceability.test.mjs
  - test/unit/milestone-gate.test.mjs
  - test/helpers/platform-gate.mjs
  - test/fixtures/discovery-selftest/**
  - test/fixtures/traceability/**
  - test/fixtures/milestone-gate/**
  - test/characterization/defects/a3-runner.test.mjs
  - test/traceability/T-001.json
- 零第三方运行时依赖，Node 20+ / ESM。
- 规格以 .collab/blueprint/cliworker-v2/design.md、interfaces.md、task-graph.json 为准。
- 令牌与密钥不得进入仓库、日志或 JSON 输出。

## 建议验收方向

把每条 AC 转成可独立执行的验收命令：
- AC-001（levels: unit）：npm test 以 0 退出。run-tests 枚举 test 下 unit、integration、contract、e2e、smoke、characterization、flows 中的 *.test.mjs，排除 test/fixtures、test/helpers、test/perf。完整运行写 files-executed.json（mode:'full'），并当场断言枚举集合与 reporter 实际执行集合相等；--ac 过滤运行只写 mode:'filtered'，不做相等比较。check-test-discovery 用夹具自测：能检出不一致；filtered 清单不能满足完整校验；放在 test/fixtures 下的 x.test.mjs 不会被执行。
- AC-002（levels: unit）：check-ci 校验 .github/workflows/ci.yml 是由 scripts/ci-matrix.json 生成的最新版本；矩阵含 os ubuntu、windows、macos 与 node 20、22，每格运行 npm run check 并上传 files-executed.json 与 skips.jsonl；perf 作业单独存在且标为不阻断。
- AC-003（levels: integration）：node scripts/check-fast.mjs 按字母序执行 scripts/check-*.mjs（不含自身），最后执行完整 npm test；任一步非 0 时立即停止，输出该步名称并以该步退出码退出。pwsh -NoProfile -File scripts/check-fast.ps1 只包一层 node 调用，并原样传递 $LASTEXITCODE。自测：注入一个失败步骤，两个入口以同一个非 0 码退出。
- AC-004（levels: unit）：check-traceability：contracts/spec/ac-index.json 恰含 AC-001..AC-074，每条有唯一 owner、milestone、levels、baseline，levels 与任务图一致，baseline 与层级相容（unit、contract、integration、e2e 只能取 linux、win32、darwin；smoke 只能取 linux 或 real-smoke）。合并 test/traceability/*.json：同一 AC 出现在两个分片，或出现在非属主分片时失败；分片不得声明 baseline；没有分片的 AC 视为 planned；status 为 covered 的条目，其文件必须存在，且至少一个测试标题含对应的 [AC-xxx]。夹具覆盖重复、非属主、缺文件、缺标题四种失败。
- AC-074（levels: unit）：milestone-gate 与 check-defects 的夹具测试：milestone-gate --milestone Mx 只要求属主里程碑 <= Mx 的 AC 为 covered 并在完整运行中通过，以及 owner_milestone <= Mx 的缺陷具备 [fixed] 部分；夹具中 M2 的 AC-026 为 planned、a5-shell 无 [fixed] 时，M1 门通过、M2 门阻断；a5-nocache 无 [fixed] 时，M3 门通过、M4 门阻断。check-defects 默认模式只要求属主分片已为 covered 的缺陷具备 [fixed]，不会提前误报。

任务图给的验收方向：
- npm test
- node scripts/check-test-discovery.mjs
- node scripts/check-ci.mjs
- pwsh -NoProfile -File scripts/check-fast.ps1
- node scripts/check-traceability.mjs
- node scripts/run-tests.mjs --ac AC-074

测试层级：integration, unit

## 非目标

- 不改动 write_scope 之外的文件。
- 不实现其他里程碑的任务。
