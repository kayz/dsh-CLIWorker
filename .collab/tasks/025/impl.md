本次工作尚未完成，不能作为 T-025 的验收通过交付。

已创建 `ui/index.html`、`ui/app.mjs`、`ui/render.mjs` 和 `test/unit/ui-render.test.mjs`：提供问题优先的静态外壳、初步的会话与轮询逻辑、六列模型展示及部分未知值和转义测试。这样做是为后续入口和数据面接线提供基础；当前外壳尚未由插件入口提供，不能视为可用的完整界面。

尚未实现快照、作业、问题组件和真实入口接线，也未创建集成测试、fixture 和追踪分片。过期值历史展示、失败隔离、脱敏、动态路由与完整问题交互等要求仍未验证。现有测试只覆盖少量渲染行为，不能证明 AC-062、AC-063 或 AC-077 的完整判据。

自测：`node --test test/unit/ui-render.test.mjs` 退出 0（2 项通过）；`node --test "test/unit/*.test.mjs"` 退出 0（482 项通过、1 项跳过）；`node --test test/integration/ui-snapshot.test.mjs` 退出 1（文件不存在）；`node scripts/check-acceptance.mjs .collab/tasks/025/acceptance.md` 退出 0（acs=3 commands=5，warnings=0），仅验证验收文档格式。组合运行 unit 和缺失的 integration 文件返回 0，但只执行了 unit 测试，不能视为集成验收通过。未运行 `scripts/check-fast.ps1`，因为其最终调用的 `scripts/run-tests.mjs` 会在仓库内创建报告文件，与本次禁止创建其他文件的指令冲突。
