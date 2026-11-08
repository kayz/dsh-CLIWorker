# 实现说明

- 新增 state 版本读取、持锁备份、校验、恢复、迁移及中断操作回滚；备份排除密钥目录、锁与临时文件，数据按字节复制并校验摘要。迁移先保存回滚点，在副本上执行步骤，提交时最后写入 VERSION。
- 通过命令模块自注册 `--version` 与 `state backup|restore|migrate`；新增离线打包安装检查、升级与重启恢复测试，以及 T-027 追踪条目。
- 自测：`node scripts/e2e-install.mjs`、三个新增测试文件、`node --test "test/unit/*.test.mjs"`、`node scripts/check-seams.mjs`、`node scripts/check-traceability.mjs`、`node scripts/check-acceptance.mjs .collab/tasks/027/acceptance.md` 均退出 0。单元回归共 481 项，其中既有 1 项 skipped。
- `node scripts/check-fast.mjs` 在既有 `check-pack.mjs` 的 npm 调用处失败，报告退出码 4294963248；独立安装脚本使用 Node 调用 npm CLI 则成功。当前环境找不到 `pwsh`，所以 `scripts/check-fast.ps1` 无法运行。验收中使用 Git 的检查因用户禁止执行 Git 而未主动运行。
- 曾启动 `node scripts/run-tests.mjs`，其既有测试间接调用了 Git；发现后立即中断，完整测试未完成。验收中直接使用 PowerShell 的命令也未运行，因此完整验收尚未通过。
