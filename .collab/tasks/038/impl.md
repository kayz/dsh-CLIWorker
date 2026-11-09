# Task 038 实现记录

- `scripts/smoke-real.mjs` 先枚举发行版并逐一验证发行版内 Linux Node 的路径、平台和版本，再执行隔离的 CLI 发现；成功返回原始 inventories，失败映射为脱敏原因，保留原有报告结构和依赖短路。
- `test/integration/wsl-smoke-preflight.test.mjs` 使用可注入执行器覆盖编码、多发行版、前置故障及完整入口的报告和退出码；`docs/release-checklist.md` 补充准备和重跑说明。
- 自测：新增 integration 19 项通过；既有 WSL/dry-run 8 项通过；unit 532 项中 531 通过、1 项既有 skip，退出码 0；验收格式检查通过。
- 真机 smoke 退出码 1，`wsl-discover` 报告 `WSL distribution list failed`，因此 AC-038 未通过，后续步骤按依赖跳过。
- 未运行 `scripts/check-fast.ps1`：该检查会执行 git 并生成写域外产物，与本任务禁止执行 git 和创建其他文件的明确约束冲突。
- 后续 CI 记录：完整检查的 `npm test` 在写域外的 `test/integration/cross-process-write.test.mjs` 中失败（AC-083，期望 24 条记录，实际 19 条），其余 902 项通过；真实 AC-038 报告 `WSL Node not found` 并退出非零。两项门禁均未通过，未修改写域外文件或安装环境。
