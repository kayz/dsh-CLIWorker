# Task 047 — 配置引导：没有可用 CLI 时也能在界面里完成配置

## 问题（用户实际反馈）

插件打开后，14 个模型全部显示 `stale (unverified)`，问题页列出一串 `command missing`，**用户没有任何可操作入口**：不知道配置文件在哪、不知道 provider 的 `cli` 该写什么、也没有"重新探测"之类的按钮。用户原话：

> 查不到 cli 也应该输出基础界面让用户配置，而不是给出错误页面，无法进行下一步。

## 目标

当"没有任何可用 CLI / 没有 callable 模型"时，界面仍然是一个**可用的配置向导**，而不是死路：

1. 快照增加 `config` 摘要（只读、不含密钥）：
   - `path`：配置文件绝对路径
   - `providers[]`：`{ name, cli, resolved }` —— `resolved` 表示该 CLI 当前能否在 PATH 中解析到（用既有 discovery/probe 证据判断，不要新起探测子系统）
   - `hint`：一段可直接照抄的配置片段（provider → cli 映射示例）
2. UI 增加「配置」区（现有页面内一节即可，不新建页面路由）：
   - 显示配置文件路径（可复制）
   - 表格：provider / 声明的 cli / 解析状态（✔ 已解析 / ✘ 未找到）
   - 当**没有任何 callable 模型**时，顶部显示一段引导：告诉用户要么把 CLI 装进 PATH，要么把 provider 的 `cli` 指向可执行文件绝对路径，并给出示例 JSON
3. 现有「问题」页保留，但每条 `command missing` 必须附带"下一步"文本（例如"把 claude 加入 PATH 或在配置里写 cli: C:\\path\\to\\claude.cmd"），不能只有错误码

## 约束

- 写域：`ui/render.mjs`、`ui/app.mjs`、`lib/http/snapshot.mjs`、`test/integration/ui-config-guide.test.mjs`（新建）、`test/fixtures/ui/**`
- **不要修改** `lib/exec.mjs`、`lib/probe.mjs`、`lib/catalog.mjs`（解析逻辑刚修好，别动）
- 快照新增字段必须是**增量**的：既有五字段与 `issues`/`models`/`forecast` 语义不变，既有 `ui-snapshot.test.mjs` 断言不得放宽
- 配置摘要里**绝不能**出现 secrets 或 token；只允许路径与 provider 名
- 不放宽断言；不引入前端构建步骤

## 验收格式

- 每个 AC 一个二级标题：`## AC-090 <标题>`
- 小节内必须有可执行命令：`- 命令:` 行或代码块
- 成功时 stdout 打印 `AC-090 OK`
- 判据只断言可观察结果

自检：`node scripts/check-acceptance.mjs .collab/tasks/047/acceptance.md`

## 建议验收方向

AC-090（integration）：快照含 `config.path` 与 `config.providers[]`（含 resolved 布尔）；全部 CLI 不可解析的夹具下，页面 HTML 含配置文件路径与"把 cli 指向可执行文件"的引导文本；有可用模型时引导不显示；`issues` 每条 `command missing` 都带下一步文本；快照中不出现 secret 值。