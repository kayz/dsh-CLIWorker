# 实施说明

增加客户端与图标声明、终端图标和无需构建的浏览器客户端。客户端分别隔离左栏与主区注册，挂载主区后通过既有 session 和 snapshot 路由读取数据，支持刷新、错误与 stale 状态、会话失效后一次重试及卸载清理。发布清单追加真实 DSH 验证步骤；新增 unit 测试执行实际 loader factory、组件和离线包清单检查。

自测：`node --test --test-reporter=tap test/unit/client-manifest.test.mjs` 八项通过；T-024/T-025 对应六个验收测试文件分别通过；`node scripts/check-acceptance.mjs .collab/tasks/046/acceptance.md` 通过，warnings=0。自动化测试不证明真实 DSH GUI 已观察通过。

未运行 `scripts/check-fast.ps1`：其 `scripts/check-scope-visible.mjs` 调用 `git check-ignore`，完整测试还包含调用 Git 的用例，与本任务禁止执行 Git 的指令冲突。完整门禁及真实 DSH 冒烟尚未验证。
