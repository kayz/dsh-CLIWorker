---
write_scope:
  - lib/client.js
  - test/unit/client-shell.test.mjs
  - docs/release-checklist.md
---

# Task 048 — 界面永不阻断：数据失败时也渲染基础骨架与分区错误

## 目标

以 brief 为准修复 DSH 插件主区。当前 lib/client.js 的 Page 仅在 data 存在时渲染内容，快照校验要求 models、forecast、issues 全为数组，且已有 configBlock 没有挂载；因此加载、请求失败和缺字段都会使用户失去分区或配置入口。本任务只改客户端展示与对应测试、发布清单，不改变服务端快照契约。

brief 未给出基准 commit SHA 或既有验收报告路径；使用当前文件与既有 test/unit/client-manifest.test.mjs 作为兼容依据，不编造基准或既往通过证据。

1. 恒定骨架。

Page 从首次同步渲染起始终返回同一个页面骨架：CLIWorker 标题、状态行、刷新按钮，以及各有对应 h2 标题的模型、问题、配置三个分区容器。分区不能放在 data、error 或 loading 的整体条件分支内。状态行始终存在，加载时显示加载状态，有快照时展示现有 source、at；缺值显示 unknown，不产生虚假的来源或时间。具体错误与原因放进所属分区。

首次挂载、session 在途及 snapshot 在途时，三个分区都显示「加载中」。初次加载没有数据时不能显示已经成功读取的「暂无模型」。刷新按钮沿用在途禁用规则；后台刷新已有数据时保留三个分区的旧内容，并显示正在更新的状态。保持布局可滚动，使用现有 React.createElement 和局部样式，不增加页面框架。

2. 每个分区独立渲染。

保留原请求流程与现有 data/error/loading 状态所表达的含义，把数组和对象的防御性读取放在各自分区。快照整体仍须是非空、非数组对象，at、source 仍须为字符串；null、数组、{} 等不可辨识响应继续产生现有 invalid response 错误，以兼容旧测试。models、forecast、issues 或 config 的缺失、null、错误类型不能再否决一个具有既有 at/source 的快照，更不能让 map、find、some 抛错。

| 情况 | 模型区 | 问题区 | 配置区 |
| --- | --- | --- | --- |
| 首次加载，无历史数据 | 加载中 | 加载中 | 加载中 |
| 正常快照 | 现有模型与预测展示 | 现有问题展示；空数组为「暂无问题」 | 实际配置路径、provider 解析状态和已有引导 |
| models=[]、缺失或不是数组 | 「暂无模型」及查看下方配置区、配置后刷新的提示 | 按自身数据展示 | 按自身数据展示 |
| forecast 缺失或不是数组 | 模型仍显示，余量 unknown | 按自身数据展示 | 按自身数据展示 |
| issues 缺失或不是数组 | 按自身数据展示 | 「暂无问题数据」，可使用顶部刷新重读 | 按自身数据展示 |
| config 缺失、null 或不是对象 | 按自身数据展示 | 按自身数据展示 | 「配置摘要不可用」，提示刷新重试并查看 README.md 的配置说明 |
| 首次请求失败，无历史数据 | 「读取失败」+ 原因 + 可点击「重试」 | 「暂无问题数据」及刷新提示 | 「配置摘要不可用」，配置路径与 provider 解析状态标为 unknown，并给出 README.md 配置说明路径 |
| 已成功后刷新失败 | 内联读取失败与原因、重试；保留原模型并标 stale | 保留已有问题内容 | 保留已有配置路径与 provider 状态，明确为上次数据 |

成功响应里的缺省字段按该次快照降级，不把上一份 config 或 issues 拼进新快照冒充当前数据。请求失败才保留整份最后成功快照；首次失败无法取得真实配置路径或 provider 状态，只能展示占位，不新增请求、不硬编码主机路径、不把 unknown 写成「✘ 未找到」。恢复成功时错误消失，内容与占位随最新快照更新。

模型条目可能缺少 key、provider、availability 等字段，继续用已有 unknown 展示；null 或非对象项也不能导致渲染抛错。保留 allowed=false、level=0、remaining=0 的真实值；保留 forecast 的 tasks_left、tasks_left_assumed、remaining_fraction 优先级、无 evidence 时不显示 callable、基于服务端 at/ttl_s 的陈旧度判断。last_error 的告警移入模型区，旧模型和预测仍按既有规则标 stale。不能为稳定展示把失败数据改为成功可调用。

问题列表保留现有 subject/task_id、detail/code、summary、at、evidence_ref 展示兼容。单条缺字段或 null 使用安全缺省文本，不影响相邻问题与其他分区。

配置区实际挂载现有 configBlock 的内容，并确保其始终返回带「配置」标题的容器。config 有效时显示 config.path、config.providers 中现有 name/cli/resolved，以及 config.hint；providers 缺失或不是数组时显示解析状态不可用提示，不抛错。provider 项缺少布尔 resolved 时显示 unknown，只有明确 true/false 时分别显示已有「✔ 已解析」/「✘ 未找到」。不从解析状态推断模型可调用。无 callable 模型时保留把 CLI 装进 PATH 或在配置中把 providers.<name>.cli 指向可执行文件绝对路径的现有引导；如展示 hint，作为文本展示已有内容，不生成新配置字段或版本。

3. 错误内联与可执行下一步。

session 获取失败、snapshot HTTP 错误、网络拒绝、坏 JSON、不可辨识响应都结束加载，保留完整骨架；读取错误归入模型区。模型区「重试」按钮调用与顶部「刷新」相同的既有 refresh，加载时禁用。模型空态明确提示查看下方配置区，配置占位明确给出刷新操作和真实存在的 README.md 文档路径。文档路径可以只读文本展示，不要求宿主提供文件打开 API。

错误原因沿用 request 当前生成的端点、HTTP 状态、安全 E_* 错误码或 network error/invalid JSON，不直接显示原始响应体、凭据或异常对象。不要在页根再复制一个替代内容的错误页或详细告警。用户数据继续作为 React 文本子节点传入，不使用 dangerouslySetInnerHTML，不将路径或 hint 变成可执行内容。

## 约束

顶部 write_scope 是下游实现的完整写域，精确三项，不使用通配符扩大范围。lib/client.js 仍是单文件、无构建、无新依赖；不改 lib/http/**、ui/**、lib/catalog.mjs、manifest、索引、schema 或其他代码与测试。不新增协议字段、路由、版本号、公开测试导出或宿主导航 API。不增加轮询、探测、POST 或真实 CLI 调用。

保留 loader/factory 和导出、两个 slot 的注册元数据。ctx、slots、inject、register 缺失或抛错仍静默跳过；同步和延迟注册都隔离，某个 slot 失败仍尝试另一个，不输出注册错误。

保留先 GET session 再 GET snapshot、现有会话头、E_ADMIN_REQUIRED 最多重新获取会话并重试一次、并发刷新抑制、卸载与 generation 保护。请求晚于卸载完成不得更新状态、继续鉴权重试或产生未处理拒绝。顶部刷新仍是页面中的首个按钮，保持既有测试对入口的使用。现有 client-manifest.test.mjs 原样通过，不删除或放宽任何既有断言。

docs/release-checklist.md 更新已有客户端验证段落：补充本次 unit 命令及真实 DSH 中首次加载、首次受控失败、分区缺字段、刷新失败保留配置、恢复后重试的可见结果。保留现有打包、离线安装、生成资产、dry-run、real-smoke 与发布放行要求。明确 unit 的树结构断言不代表已经完成真实 DSH 界面观察。

本 design 轮只创建/修改同目录 design.md、acceptance.md，使用 UTF-8 无 BOM，不执行 git 或创建其他文件。完整 check-fast 会启动检查器及测试并可能产生额外文件，与本轮角色限制冲突，留给实施完成后的下游执行；本轮只运行不落盘的格式、write_scope 和编码自检，不宣称功能验收通过。

## 建议验收方向

新增 test/unit/client-shell.test.mjs，测试名标记 [AC-091]。参照现有客户端测试，在 node:vm 执行真实 lib/client.js，捕获 loader、执行 factory/apply 并取到实际 Page。用最小 React 替身（createElement 返回普通对象，支持 useState/useRef/useEffect、重渲染及卸载清理）和假 fetch 驱动；不修改已有测试、不增加 helper 文件或公开测试接口。

核心四种路径逐一断言实际渲染树：成功、HTTP 500、快照缺 config、models 为空；每种都断言 CLIWorker 标题、状态行、刷新按钮和三个具备对应标题的分区容器。按各自分区节点检查文本和按钮，不能仅搜索整棵树的字符串证明错误归属。

补充覆盖首次 session/snapshot 延迟、首次失败与失败恢复、models/forecast/issues/config 缺失及错误类型、条目缺字段/null、成功后失败保留数据再恢复、session 失败、坏 JSON、网络拒绝、last_error 和非法整体响应。控制 Promise，观察加载中三个分区与失败后重试按钮状态，点击实际按钮并核对请求和恢复内容。覆盖配置存在但 models 缺失的场景，证明路径/provider 与问题仍可见；覆盖初次失败 unknown 占位，证明未捏造路径或「未找到」证据。

现有 client-manifest.test.mjs 独立作为回归，保持其中 session 重建、stale、空态、零值、slot 隔离与卸载断言。新增用例不靠源码正则、不访问真实宿主、账号或 CLI，不使用 skip/todo/only。

## 验收格式

acceptance.md 仅使用 brief 指定的 AC-091 二级标题，不分配新 AC 编号。每个 pwsh 代码块为一条可从仓库根独立执行的命令，由既有执行器作为临时 .ps1 运行，不在仓库新增脚本。每条命令原生命令后检查 $LASTEXITCODE；失败非零且不打印成功哨兵，成功 stdout 输出独立行 AC-091 OK。功能、回归、完整门禁与格式自检分别判定，不依赖前一条生成文件。
