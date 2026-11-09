---
write_scope:
  - lib/client.js
  - icon.svg
  - package.json
  - dsh.plugin.json
  - test/unit/client-manifest.test.mjs
  - docs/release-checklist.md
---

# Task 046 — 客户端接入 DSH 左栏与主区

## 现象

当前 dsh.plugin.json 没有 client，package.json 没有 ./client 与 ./icon 导出，仓库没有 lib/client.js 和根 icon.svg。宿主已有路由注册、会话守卫与 snapshot 投影；本任务接入浏览器端，不迁移或重写宿主。

已只读核查本机 C:/Users/kayz/.dsh/profiles/desktop/node_modules/dsh-agentline/lib/client.js 和 package.json：可用加载形状是 window.__ModuleLoader__.load({ id, factory })，factory(require) 内通过 require('react') 使用宿主 React，返回 module.exports。sidebar 的 id 与 main 的 key 对应同一入口。

brief 未提供基准 commit SHA 或既有验收报告路径，不编造基准或引用其他任务的通过结论。T-024/T-025 的接口依据是当前 lib/index.js、lib/http/routes.mjs、lib/http/security.mjs、lib/http/snapshot.mjs、ui/app.mjs 和 ui/render.mjs；既有测试索引为 test/traceability/T-024.json 与 test/traceability/T-025.json。

## 目标

完成 AC-089：DSH 能发现客户端及图标；客户端注册 CLIWorker 左栏入口与对应主区；主区展示既有宿主 snapshot 的实际数据，并能从错误态手动重试。交付一个直接加载、无需构建的 React 页面，不复制旧控制台整套管理功能。

1. dsh.plugin.json 保留现有字段，增加 "client": { "platform": "web" }。
2. package.json 保留已有 exports、dsh.bundle、scripts 和 files 项，增加 exports["./client"] = "./lib/client.js"、exports["./icon"] = "./icon.svg"、dsh.client.platform = "web"，files 增加 icon.svg。lib 已在 files 内，不新增构建步骤、依赖或版本号。
3. lib/client.js 调用 window.__ModuleLoader__.load，id 为 dsh-cliworker。factory(require) 使用局部 module/exports，通过 require('react') 获取 React，以 createElement 编写组件，不使用 JSX、Node 内置模块、源码 ESM import、打包器或新的宿主服务。脚本加载与 factory 执行不依赖 document，也不发送请求；DOM 与数据工作放在组件挂载之后。返回 module.exports，包含 apply 函数、inject = ['slots']、name = 'dsh-cliworker'。Node 的 import() 返回值不是该文件的客户端导出契约，验收必须执行 loader factory。
4. apply(ctx) 分别调用 slots.inject('sidebar.panellist', callback) 与 slots.inject('main', callback)。前者在 callback 内 slots.register({ name: 'sidebar.panellist', id: 'cliworker', order: 30, label: 'CLIWorker' }, SidebarIcon)，后者 slots.register({ name: 'main', key: 'cliworker' }, Page)。order 沿用参考实现的 30，不引入其他 slot 或导航 API。apply 只注册，不发送网络请求；Page 挂载才加载数据。
5. 缺少 ctx、slots、inject 或 register 时静默跳过。读取 ctx.slots、调用 inject、callback 内调用 register 均在异常边界内；两个 slot 独立隔离。callback 可能由宿主稍后执行，因此只在 inject 外层 try/catch 不合格；延迟 callback 抛出的 register 错误也必须被吞掉。某个 slot 失败仍尝试另一个。不打印注册错误、不产生未处理拒绝，不以兜底注册重复入口。
6. icon.svg 使用 SVG 命名空间、viewBox="0 0 24 24"，以 currentColor 和 none 绘制简洁的终端图形，不含位图、脚本、外部资源或多色装饰。SidebarIcon 渲染相同图形与视口，继承宿主颜色；注册 label 提供入口名称。图标组件可独立渲染，无需 fetch。

## 参考实现

Page 使用 React 与局部状态管理加载过程，样式内联或在组件范围内限定，不改动宿主全局元素样式。主区有 CLIWorker 标题、可访问的刷新按钮、加载/错误状态及可滚动的数据区。用户通过已有 slot 机制切换主区，不模拟点击宿主 DOM，不使用 iframe 替代可验收的数据加载。

请求顺序与契约如下：

| 请求 | 使用方式 | 响应依据 |
|---|---|---|
| GET /cliworker/api/session | 相对同源路径；先于首次 snapshot；凭据仅留在组件内存 | 既有 schema 为 cliworker.session/v1，session 为非空字符串；其余 csrf、expires_at 沿用宿主响应，不新增字段 |
| GET /cliworker/api/snapshot | 携带 x-cliworker-session，值为上一步的 session | models、forecast、issues 数组，source、at、last_error；该响应没有成功 ok 字段，不要求 ok === true |

- 初次挂载显示加载状态，成功后按返回数组展示模型 key/provider、allowed、level、availability.state 与 availability.at，并显示 snapshot 的 source、at。forecast 按 model 与模型 key 对应，使用既有 tasks_left、tasks_left_assumed、remaining_fraction 展示余量；issues 展示既有投影中可用的 subject/detail/at/evidence_ref，兼容旧投影 task_id/code/summary/at 的文本。字段缺失用 unknown，允许真实的 0 和 false，不能用默认值伪装成健康、满额或 callable。
- 延续 ui/render.mjs 的显示语义：assumed 与实测余量区分；availability 缺少有效观测时间/ttl_s、过期、或 snapshot.last_error 非空时显示 stale；无实测 evidence 的 callable 显示 unknown。snapshot.last_error 非空时即使 HTTP 200 也明确显示 stale 与错误，不冒充更新成功。对缺失或无效 forecast 值显示 unknown。
- 合法空数组显示明确空态，不能当作网络失败；初次请求失败也不能伪装成“暂无模型”。只渲染服务端数据，不内置演示模型、余额或问题。所有服务端字符串以 React 文本节点展示，不使用 dangerouslySetInnerHTML，不自动把证据字符串当 URL 执行。
- 检查 HTTP 状态、JSON 解析及基本响应形状。session 非法、snapshot 缺少数组或 at/source 类型不对、网络拒绝、非 JSON、非 2xx 都显示错误态；提示失败请求与可用 HTTP 状态或既有 error.code，不输出会话值、csrf 或整份原始响应。不新增错误码或响应 schema。
- 刷新按钮重新执行读取；已有有效会话可复用。snapshot 返回 E_ADMIN_REQUIRED 时最多重新获取会话并重试一次 snapshot，再失败必须显示错误，不能无限重试。其他失败由用户再次刷新重试。初次 session 失败后再次刷新须重新获取，不能缓存 rejected Promise。刷新中禁用按钮或复用在途请求，防止重复并发。
- 刷新失败时保留上次成功数据，明确标记 stale 和失败；成功刷新后清除旧错误、显示新数据。空态、错误态和刷新按钮均是可观察的渲染内容。
- effect 清理使卸载后的请求结果失效，或取消请求；不得卸载后 setState 或触发补发请求。无需自动轮询，不新增写操作；Page 只使用上述两个 GET 路由，不触发 discover/probe 等宿主任务、不向 storage 持久化会话。

## 约束

实施写域严格限于 front matter 六个精确路径。设计角色本轮只创建本目录 design.md 与 acceptance.md，不执行 git，不创建脚本、报告或其他文件。lib/index.js、lib/http/**、ui/**、lib/cli.mjs、lib/routes.mjs、lib/context.mjs、contracts/**、追踪索引和检查器只读。不放宽、删除或跳过既有断言，不为本任务新增产品字段、schema 或版本。

测试只在 test/unit/client-manifest.test.mjs 内新增，使用 node:test 和内置库，不增加 React/DOM 测试依赖。以 node:vm 执行真实 lib/client.js，捕获 load 参数并实际调用 factory；require stub 只提供宿主 React 所需接口，未知模块必须失败。用注入捕获到的实际组件测试，不增加 __test 等公开导出。渲染驱动可在该测试文件内实现最小 React hooks/createElement 调度，必须运行 effect、处理 state 更新、调用刷新事件并执行卸载清理；不能仅靠源码正则或对自写 helper 的断言证明页面可用。需要文件系统/打包夹具时只用独立系统临时目录并在 finally 清理。

## 建议验收方向

test/unit/client-manifest.test.mjs 至少提供以下八个顶层测试，名称以 [AC-089] 加下列英文短语开头，可在其后追加描述，无 skip/todo/only。每个用例必须断言实际行为，测试名称不能替代断言。

1. manifest and icon：读取两份真实 manifest，验证所有新增字段/导出目标存在且非空；SVG 视口、单色和浏览器可渲染形状正确。调用现有 scripts/check-package-contents.mjs 的 runNpmPack，断言实际离线 npm pack dry-run 清单含 lib/client.js、icon.svg、dsh.plugin.json 与 package.json；错误不得跳过。无需生成 tarball 或新增检查器。
2. loader exports and slots：捕获并执行真实 factory，验证 id、三个导出，正常 ctx 恰好注册两个 slot、元数据与组件类型正确；实际渲染 SidebarIcon 为 24×24 视口 SVG，apply 本身零请求。
3. missing slots：分别传 undefined、null、{}、无方法 slots、缺 register，以及抛错的 slots getter，调用 apply 均不抛错。不可把客户端根本没加载当通过。
4. registration failure isolation：分别让两个 slot 的 inject 或同步 register 抛错；apply 不抛错、另一 slot 仍成功注册，错误分支无日志或未处理拒绝。
5. deferred registration failure isolation：inject 先保存回调、apply 返回后再执行；令每个 register 分别失败，回调不抛错、另一回调能注册。覆盖延迟缺 register 的情况，不仅覆盖同步执行。
6. session and snapshot rendering：挂载捕获的真实 Page，使用可变 fetch 夹具验证先 session 后 snapshot、正确请求头及零 POST，响应不含 ok 仍成功；不同响应中的模型标识、观测、forecast 和问题文本反映到渲染结果，刷新后显示第二份数据，用户内容作为文本而非 HTML；数据加载不依赖真实 DSH、CLI 或账号。
7. errors and retry：覆盖 session 失败、snapshot 非 2xx/网络拒绝/坏 JSON/非法形状；渲染明确错误与刷新入口、不能显示成功空态；从失败刷新可恢复；E_ADMIN_REQUIRED 最多重建会话并重试一次，仍失败停止请求；刷新失败保留旧数据并标 stale，成功恢复后错误消失，输出不含测试会话/CSRF 值。
8. empty stale and unmount：合法空数据有空态，unknown/0/false/assumed/stale 语义成立，200 带 last_error 显示 stale；控制在途 Promise 验证并发刷新被抑制，卸载后旧请求完成不再更新或重试。不能让测试网络访问真实宿主。

docs/release-checklist.md 在原清单中追加客户端验证步骤与上述 unit 命令：安装含客户端的新包并重新加载 DSH，确认左栏 CLIWorker 图标、点击后进入主区、实际加载模型/空态、停用宿主或制造受控失败后可见错误及恢复后刷新成功。明确自动化 unit/contract 只证明加载与注册/数据行为，不证明已在真实 DSH 观察到入口。保留现有包资产、离线安装、生成资产、dry-run 与 real-smoke 要求，不改写既有放行条件。

## 验收格式

acceptance.md 只使用 brief 指定的 AC-089，所有命令块为 pwsh，单块可从仓库根独立执行；失败非零退出且不输出 AC-089 OK，只有完整检查成功才输出该独立行。多步骤验收由执行器保存为临时 .ps1 后用 pwsh -NoProfile -File 执行，不在仓库新增脚本。

下游实施阶段运行新增 unit、T-024/T-025 相关既有回归、scripts/check-fast.ps1 与格式自检。既有 check-fast 会执行完整门禁，发生失败需报告实际原因，不得越界修改或放宽断言。本设计轮只运行不落盘的文档格式、front matter 和编码检查；check-fast 可能间接执行 git 并创建测试产物，与本轮角色限制冲突，因此本轮不运行，不宣称 AC-089 或真实 DSH 验收已经通过。
