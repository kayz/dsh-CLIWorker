# 实现说明

快照复用已读取的配置、探测和发现缓存，追加配置文件路径、经过安全处理的 provider/CLI 摘要以及 v1/v2 配置示例。解析状态根据匹配目标的有效缓存证据及观察时间计算，不运行新的探测，也不改变模型和问题的投影。CLI 目录不进入摘要或示例。

页面在主容器挂载配置区，显示可选中的路径、解析表和无 callable 模型时的修复引导；逐条 command missing 问题增加下一步。读取失败沿用上次展示。更新了两份既有集成测试的快照键与路径隐私断言，并增加真实路由、探测、发现和页面挂载测试。

自测结果：

- `node --test --test-reporter=tap test/integration/ui-config-guide.test.mjs`：2 项通过。
- `node --test --test-reporter=tap test/integration/ui-snapshot.test.mjs test/integration/issues-from-probe.test.mjs test/integration/snapshot-legacy-config.test.mjs`：16 项通过。
- `node scripts/check-acceptance.mjs .collab/tasks/047/acceptance.md`：通过，`acs=1 commands=4`、`warnings=0`。
- 指定的 `pwsh -NoProfile -File scripts/check-fast.ps1` 无法运行：环境中找不到 `pwsh`。直接运行其 Node 入口 `node scripts/check-fast.mjs` 作为补充检查，止于已有任务验收文档的格式错误：46 个文件中 9 个失败、160 个问题、6 个警告；未修改范围外文档。不能宣称完整门禁通过。

新增测试尚未覆盖验收要求中的所有组合，特别是 v1 示例、空模型、多 provider、同时间冲突、真实 DOM 输入值及完整行为计数；这些仍需补充验证。
