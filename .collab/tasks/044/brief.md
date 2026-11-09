# Task 044 — UI 资产随 npm 包分发

## 问题

界面文件（`ui/app.mjs`、`ui/render.mjs` 等）与入口页 `docs/ui/cliworker-console.html` **没有随 npm 包分发**：`package.json` 的 `files` 不含它们。用户 `npm i <pkg>` 后拿到的 CLI 没有界面 —— 这是真实的可用性缺陷。

## 目标

让安装包包含 UI 资产，并提供一条可执行的验证：

- `npm pack` 产出的 tarball 必须包含：`ui/**`、`docs/ui/cliworker-console.html`、`bin/**`、`lib/**`
- 缺任一项即失败
- 验证方式是**断言文件清单**（存在性/前缀匹配），**不要**断言固定字节数或精确文件总数 —— 那会随正常增删而假红

## 约束

- 写域：`package.json`、`scripts/check-package-contents.mjs`（新建）、`test/unit/package-contents.test.mjs`（新建）、`docs/release-checklist.md`
- **不要修改** `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`、`ui/**` 的任何渲染逻辑（本任务只解决"分发"，不改界面行为）
- 不得用 `npm publish` 或联网操作；用 `npm pack --dry-run --json` 或等价方式在本地取清单
- 不放宽既有断言

## 验收格式

- 每个 AC 一个二级标题：`## AC-087 <标题>`
- 小节内必须包含可执行命令：`- 命令:` 行，或代码块
- 命令成功时必须在 stdout 打印 `AC-087 OK` 作为哨兵
- 判据只断言可观察结果（退出码 / stdout 子串 / 文件状态）

自检：`node scripts/check-acceptance.mjs .collab/tasks/044/acceptance.md`

## 建议验收方向

AC-087（unit + contract）：`npm pack --dry-run` 清单包含 `ui/` 前缀条目与 `docs/ui/cliworker-console.html`，且 `bin/`、`lib/` 仍在；人为从 `files` 移除 `ui/**` 时检查必须失败（用临时 package.json 副本构造，不改真实文件）。