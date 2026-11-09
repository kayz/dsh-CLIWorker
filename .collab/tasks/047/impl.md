# 实现说明

快照复用已读取的配置、探测和发现缓存，追加配置文件路径、经过安全处理的 provider/CLI 摘要以及 v1/v2 配置示例。解析状态根据匹配目标的有效缓存证据及观察时间计算，不运行新的探测，也不改变模型和问题的投影。CLI 目录不进入摘要或示例。

页面在主容器挂载配置区，显示可选中的路径、解析表和无 callable 模型时的修复引导；逐条 command missing 问题增加下一步。读取失败沿用上次展示。更新了两份既有集成测试的快照键与路径隐私断言，并增加真实路由、探测、发现和页面挂载测试。

自测结果：

- `node --test --test-reporter=tap test/integration/ui-config-guide.test.mjs`：2 项通过。
- `node --test --test-reporter=tap test/integration/ui-snapshot.test.mjs test/integration/issues-from-probe.test.mjs test/integration/snapshot-legacy-config.test.mjs`：16 项通过。
- `node scripts/check-acceptance.mjs .collab/tasks/047/acceptance.md`：通过，`acs=1 commands=4`、`warnings=0`。
- 指定的 `pwsh -NoProfile -File scripts/check-fast.ps1` 无法运行：环境中找不到 `pwsh`。直接运行其 Node 入口 `node scripts/check-fast.mjs` 作为补充检查，止于已有任务验收文档的格式错误：46 个文件中 9 个失败、160 个问题、6 个警告；未修改范围外文档。不能宣称完整门禁通过。

## 第 2 轮补充

针对评审补充集成测试：通过真实 session/snapshot 和 `startApp` 请求链覆盖空模型、v1/v2 示例、混合 callable、同时间及新旧证据冲突、gone、不同 provider 和同名不同目录目标、逐条修复提示、定时更新、失败保留与恢复、unknown fallback、按钮鉴权及隐私哨兵。DOM seam 检查挂载位置、标签隐藏状态和只读输入值；另用渲染测试检查特殊字符转义。受控计数检查读取时没有额外执行 CLI、写入或网络访问，并单独计数秘密后端读取。本轮未修改产品实现。

复测结果：新集成测试 8 项通过；三份指定回归测试 16 项通过；本任务验收格式检查通过（`acs=1 commands=4`，`warnings=0`）。指定 `pwsh -NoProfile -File scripts/check-fast.ps1` 仍因环境找不到 `pwsh` 无法执行。补充运行 `node scripts/check-fast.mjs` 仍在范围外历史验收文档格式检查失败（9 个文件、160 个问题、6 个警告），不能宣称完整门禁通过。DOM 使用测试 seam 而非真实浏览器，特殊字符的引号和尖括号另以渲染测试验证。
