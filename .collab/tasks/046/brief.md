# Task 046 — 客户端接入 DSH 左栏与主区

## 现象

插件装进 DSH 后，**插件列表里能看到 `dsh-cliworker`，但左栏没有入口与图标**。

原因已查明：本插件只有宿主端（host half），没有浏览器端（client half）。对照同机的 `dsh-agentline`：

| 插件 | dsh.plugin.json 字段 |
|---|---|
| dsh-agentline | name, description, version, entry, **client** |
| dsh-github-picker | name, description, version, entry, **client** |
| **dsh-cliworker** | name, description, version, entry（**缺 client**） |

## 目标

补齐 client half，让 cliworker 出现在 DSH 左栏并有一个可用的主区页面：

1. `dsh.plugin.json` 增加 `"client": { "platform": "web" }`
2. `package.json`：`exports` 增加 `./client` 与 `./icon`；增加 `dsh.client.platform = "web"`；`files` 含 `icon.svg`
3. 新建 `lib/client.js`（浏览器端模块）：
   - 通过 `window.__ModuleLoader__.load({ id, factory: (require) => {...} })` 形式加载
   - 导出 `apply(ctx)`：`ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'cliworker', order, label: 'CLIWorker' }, SidebarIcon))`
   - 同时 `ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'cliworker' }, Page))`
   - 导出 `inject = ['slots']`、`name = 'dsh-cliworker'`
   - 所有注册都用 try/catch 包裹，slot 不可用时静默跳过（不能因为宿主版本差异炸掉整个 GUI）
4. 新建 `icon.svg`（左栏图标，简洁、单色、24×24 视口）
5. 页面从**既有宿主端路由**取数据（T-024/T-025 已实现），不要自造假数据；请求失败时显示明确错误态

## 参考实现

同机已装的 `dsh-agentline` 的 `lib/client.js`（`~/.dsh/profiles/desktop/node_modules/dsh-agentline/lib/client.js`）是可用范本，重点看它的 `apply(ctx)` 与 `exports` 形状。

## 约束

- 写域：`lib/client.js`、`icon.svg`、`package.json`、`dsh.plugin.json`、`test/unit/client-manifest.test.mjs`、`docs/release-checklist.md`
- **不要修改** `lib/index.js`、`lib/http/**`、`ui/**`（宿主端已稳定，本任务只加客户端）
- 不引入构建步骤（DSH 直接加载该文件，不要 TS/打包器）
- 不改 `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`
- 不放宽既有断言

## 验收格式

- 每个 AC 一个二级标题：`## AC-089 <标题>`
- 小节内必须有可执行命令：`- 命令:` 行或代码块
- 成功时 stdout 打印 `AC-089 OK`
- 判据只断言可观察结果

自检：`node scripts/check-acceptance.mjs .collab/tasks/046/acceptance.md`

## 建议验收方向

AC-089（unit + contract）：清单与导出契约（`client.platform=web`、`exports` 含 `./client`/`./icon`、`files` 含 `icon.svg`）；`lib/client.js` 是合法模块且 `apply` 在缺少 slots 时不抛错；用假 `ctx.slots` 驱动一次注册，断言注册了 `sidebar.panellist` 与 `main` 两个 slot。