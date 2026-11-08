# Task 027 — 安装、升级、回滚、state 迁移与重启恢复

## 目标

来自 Blueprint 任务图 T-027（M5）。证明交付物能被真正安装并用起来，也能安全升级与恢复：把 `npm pack` 产物安装到全新临时目录后，`cliworker --version` 可用、`cliworker doctor --config <临时配置>` 成功、`import` 包入口并用宿主 stub 注册得到 `getRegistration().status === 'ok'`，且安装目录里不存在 `contracts/golden`、`contracts/spec`、`.collab`。升级时自动生成 `backup-<ver>-<ts>` 并把 `state/VERSION` 迁移；`state restore` 后与备份逐字节一致；进程被强制杀死后重启，未过期租约、账本、探测状态完整，过期租约被释放，陈旧锁被回收。交付：
- `lib/migrate.mjs`
- `lib/commands/state/**`
- `scripts/e2e-install.mjs`
- `test/e2e/install.test.mjs`、`test/e2e/upgrade.test.mjs`
- `test/integration/restart-recovery.test.mjs`

## 约束

- 只允许写入以下路径（write_scope，来自 task-graph）：
  - `lib/migrate.mjs`
  - `lib/commands/state/**`
  - `scripts/e2e-install.mjs`
  - `test/e2e/install.test.mjs`
  - `test/e2e/upgrade.test.mjs`
  - `test/integration/restart-recovery.test.mjs`
  - `test/traceability/T-027.json`
- 仓库级硬约束：不得修改 `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`；新增 CLI 命令一律通过 `export const route = { cmd, sub }` 自注册，不得靠改路由表注册 `state backup|restore|migrate`。
- 不得修改 `lib/store.mjs`、`lib/leases.mjs`（不在 write_scope 内）：恢复语义只能消费它们已有的原子写、锁与启动回收行为；确实需要改动时走 amendment，不在本任务顺手改。
- 不得修改 `package.json` 与 `contracts/**`；测试中的版本号从 `package.json` 读取，不写死，升级夹具自行构造旧版本。
- 验收必须能被 `node scripts/check-acceptance.mjs` 通过（`## AC-0xx` 小节 + 可执行命令 + `<AC-id> OK` 哨兵）。
- 安装测试只操作 `os.tmpdir()` 下的目录，注入临时 HOME/state_dir，不写用户真实目录、不联网、不依赖全局安装；`npm pack` 的产物与临时安装目录测试后清理。
- 备份与恢复必须原子且逐字节保真；迁移或恢复中途失败必须回到可用的旧状态，不允许留下半迁移的 state。
- 强制杀进程的用例要跨平台可用（Windows 与 POSIX 都不能靠信号名），断言只涉及重启后的状态文件内容。
- 零第三方运行时依赖，Node 20+ / ESM；令牌与密钥不得进入日志与备份产物；不改 `.collab/blueprint/**`、其他任务目录；`acceptance.md` 由 design 阶段产出。

## 建议验收方向

由 designer 决定命令形态，以下是必须成立的可观察结论（AC 号与层级取自任务图）。
- AC-065（levels: e2e）：`npm pack` 后安装到临时目录——`cliworker --version` 成功；`cliworker doctor --config <临时配置>` 成功；`import` 包入口并用宿主 stub 注册后 `getRegistration().status` 为 `ok`；安装目录中不存在 `contracts/golden`、`contracts/spec`、`.collab`。
- AC-066（levels: e2e, integration）：升级时自动生成 `backup-<ver>-<ts>`，`state/VERSION` 被迁移；`state restore` 后与备份逐字节一致；`kill -9`（跨平台的强制终止）后重启，未过期的租约、账本、探测状态完整，过期租约被释放，陈旧锁被回收。

## 非目标

- 不做多版本并行共存、在线热升级或跨主机迁移；不做 npm 发布、签名与供应链校验。
- 不改打包清单与 `bin` 入口（T-009 已冻结），不改 store/leases 的存储格式与锁算法。
- 不做 UI 侧的状态展示（T-025）、冒烟（T-029）与发布门禁（T-030）。

## 验收格式（生成 acceptance.md 时必须遵守，否则 CI 解析失败）

- 每个 AC 一个二级标题：`## AC-<三位数字> <标题>`；**同一 AC 的多条检查放进同一小节**，不要重复同一个 id
- 小节内必须包含可执行命令：`- 命令:` 行，或 ```pwsh 代码块
- 命令成功时必须在 stdout 打印 `<AC-id> OK` 作为哨兵，runner 按此判定通过
- 判据只断言可观察结果（退出码 / stdout 子串 / 文件状态），不要断言测试标题、函数名、行号
- 每条任务额外保留一条回归门禁：`node --test "test/unit/*.test.mjs"` 全绿

自检：`node scripts/check-acceptance.mjs .collab/tasks/027/acceptance.md`
