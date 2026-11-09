# Task 045 实施记录

新增 `scripts/check-alpha-package.mjs`：实际离线打包或接收本地 tarball，在仓库外的独立临时目录安装并执行安装后的入口，检查版本、doctor、discover 落盘、模型清单、probe/select/run、用量记录、state backup/restore 和包内 UI 资产。子进程使用隔离配置和有限超时，结束后清理临时目录；缺少资产时指出相对路径。

新增 `test/integration/alpha-tarball.test.mjs`，重复验证真实安装，并从真实包构造只移除 `ui/` 的反例，确认安装后的同一检查器因缺失资产失败。更新 `docs/release-checklist.md`，记录命令和覆盖边界，保留现有发布检查。

包内不分发 `scripts/smoke-real.mjs`。替代验证执行已安装 CLI 的 doctor、discover、models enumerate、models probe、models select、返回的 run call 和 state backup/restore，使用本地假 provider；与原七步 dry-run 相比不执行 WSL fixture 和 http-select，不证明真实 WSL 或云 provider 可用。

自测：`node scripts/check-alpha-package.mjs` 成功并输出 `AC-088 OK`；`node --test --test-reporter=tap test/integration/alpha-tarball.test.mjs` 两轮均通过，每轮 2 个测试，fail/skipped/todo 均为 0；`node scripts/check-acceptance.mjs .collab/tasks/045/acceptance.md` 通过，1 个 AC、4 条命令、warnings=0。完整 `scripts/check-fast.ps1` 未运行：环境未找到 PowerShell 7，且该门禁链包含 Git 调用，与本任务禁止执行 Git 的要求冲突，因此不能声称完整门禁通过。

本轮修订 npm 定位：按 Windows 和 Unix 布局及系统 PATH 中指向 `npm-cli.js` 的入口解析绝对路径，集成测试复用该解析逻辑；不向隔离的子进程传入 npm 配置注入。临时目录创建前解析真实父路径，清理时核对创建的目录，若清理同时失败则保留原始错误。Windows 上独立检查器、正反集成测试及验收格式检查重新通过；正反集成测试在本轮执行多次，每次 2 项通过、无跳过。Unix 布局在本机未能实际运行验证。`ci-results.json` 不在允许写域，未修改；完整门禁仍未运行，原因同上。
