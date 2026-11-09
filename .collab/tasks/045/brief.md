# Task 045 — alpha 包黑盒验收：以用户视角安装并验证

## 背景

已发布 `0.2.0-alpha.1`：`npm pack` 产出 `dsh-cliworker-0.2.0-alpha.1.tgz`（133 个文件）。此前所有验证都是**在仓库内**跑的，用户拿到 tarball 之后能不能用**从未验证过**。本任务补上这一步。

## 目标

写一条黑盒验收：把 tarball 安装到**仓库外的临时目录**，在没有仓库文件的情况下验证：

1. `cliworker --version` 输出与包版本一致
2. `cliworker doctor` 返回健康（或明确的可解释状态）
3. `cliworker discover` 能产出 `cliworker.inventory/v1` 且写到临时 state
4. `cliworker models enumerate` 能产出清单
5. `node scripts/smoke-real.mjs --dry-run` 等价路径可用（若脚本不在包内，则改为验证 CLI 自带的等价命令，并在 impl 里记录差异）
6. UI 入口页 `docs/ui/cliworker-console.html` 存在于包内

**关键**：验证必须在临时目录中进行，不能依赖仓库内的 `node_modules`、`lib/` 或 `.collab/`。

## 约束

- 写域：`test/integration/alpha-tarball.test.mjs`（新建）、`scripts/check-alpha-package.mjs`（新建）、`docs/release-checklist.md`
- **不要修改** `lib/**`、`ui/**`、`package.json`（本任务只加验收，不改实现）
- 安装用本地 tarball（`npm install <path>.tgz` 到临时目录），**不得联网**
- 测试要能重复运行：临时目录用完即删；不污染仓库与用户 HOME
- 不放宽既有断言；失败要打印具体缺失项

## 验收格式

- 每个 AC 一个二级标题：`## AC-088 <标题>`
- 小节内必须包含可执行命令：`- 命令:` 行，或代码块
- 命令成功时必须在 stdout 打印 `AC-088 OK`
- 判据只断言可观察结果

自检：`node scripts/check-acceptance.mjs .collab/tasks/045/acceptance.md`

## 建议验收方向

AC-088（integration）：从仓库根 `npm pack` 出 tarball → 装到临时目录 → 六项验证全通过；把 tarball 里的 `ui/` 移除后验证必须失败（可用改造后的临时 tarball 构造反例）。