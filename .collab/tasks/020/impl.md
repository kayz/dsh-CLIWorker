# T-020 实现记录

## 已完成

- 在 `lib/availability.mjs` 增加探测缓存读取入口，读取缺失文件时返回空数组，并对缓存记录进行部分校验。
- 在 `lib/select.mjs` 和 `lib/commands/models/select.mjs` 接入按 key、provider、id 匹配的探测记录和逐模型 TTL；没有记录时保留既有路径。此部分尚需完整验收和进一步校验。

## 未完成及原因

- 探测执行、结果解码、重试、用量入账和幂等提交、命令、流程步骤、夹具、追踪分片及完整测试均未实现；缓存校验和选择器接线也尚未完成规格所要求的全部验证。当前交付不能视为 AC-047 或 AC-048 通过。
- 本次未完成所需实现与验证，不能声称本地 stub 回归通过。T-015 仍缺失，正式集成验收也保持待完成。

## 自测

- `node --test test/unit/select.test.mjs test/unit/select-draft.test.mjs test/unit/adapters.test.mjs test/unit/adapters-unverified.test.mjs`：27 项通过，仅覆盖既有回归。
- AC-047 本地 TAP 命令中的 Node 测试调用返回 0、27 项通过，但 `test/integration/probe.test.mjs` 尚不存在；本机 Node 没有因此报错，所以此结果不能证明探测测试运行或 AC 通过。
- 未运行 `scripts/check-fast.ps1`：完整测试链包含直接调用 Git 的测试，与用户禁止执行 Git 的要求冲突。未运行会写入仓库外指定范围之外报告的门禁。
