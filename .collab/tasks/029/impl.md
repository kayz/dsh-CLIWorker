# 实现记录

目前仅完成部分实现，不能作为 AC-038 或 AC-069 的验收通过证据。

- 在 `test/smoke/report.mjs` 中使用既有契约校验器定义冒烟报告的结构，并检查步骤顺序、AC 映射、mandatory、版本、原因和有限时长。
- 在 `test/smoke/smoke-dry-run.test.mjs` 中检查合法报告和多种错误报告；在 `test/smoke/wsl-discover.test.mjs` 中验证 UTF-16LE 夹具和既有 discover 的发行版结果。
- 自测：`node --test test/smoke/smoke-dry-run.test.mjs test/smoke/wsl-discover.test.mjs` 通过；`node --test "test/unit/*.test.mjs"` 为 485 通过、1 跳过、0 失败。

尚未实现 `scripts/smoke-real.mjs`、真实 WSL 逐发行版检查、完整 dry-run 链路和泄漏扫描、发布清单及追踪分片。未执行真机验收和完整快速检查；验收命令不能全部通过。
