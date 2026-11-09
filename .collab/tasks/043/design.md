---
write_scope:
  - lib/http/issues-api.mjs
  - lib/http/snapshot.mjs
  - test/integration/issues-from-probe.test.mjs
  - ui/app.mjs
  - ui/render.mjs
  - test/fixtures/ui/**
---

# Task 043 — AC-077 问题优先页接真实 CLI 问题源

## 目标

将 probe/discover 已持久化的实际观察投影为问题，并让问题首标签页展示 API 返回的同一批记录。无观察证据不能生成问题；成功观察不能生成失败问题。只接数据，不重做视觉。

当前设计有致命待裁决项，见同目录 attention.json。下游须先取得裁决并更新本文件与 acceptance.md，再实现涉及待定接口和分类的部分；不能把本文视为新增字段、扩大写域或重定义“版本不符”的授权。

T-042 的 `.collab/tasks/042/state.json` 当前为 merged，记录的合并提交为 `b5a39615fbec2900df573807b62c7bf545c9c253`。工作区已有 `lib/discovery/probe.mjs` 和 `test/integration/discovery-probe.test.mjs`，`lib/probe.mjs` 已保存版本失败的实际证据。本轮不是因依赖未合并阻塞。brief 未指定基准 commit SHA 或既有验收报告；上述 SHA 仅为依赖来源记录，不自行设为本任务比较基准。`.collab/tasks/042/impl.md` 和 `ci-results.json` 是历史交接及结果，不能代替本任务重跑验收。

## 约束

1. 顶部 write_scope 严格沿用 brief，路径相对仓库根，`*` 匹配单段、`**` 匹配多段。设计轮仅创建本文件、acceptance.md，以及用户明确授权在致命歧义时创建的 attention.json。不执行 git，不创建脚本、日志或其他文件。不修改 brief、实现交接、审查、裁决、状态、运行文件或代码。
2. 开发不得修改 `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`、`lib/index.js`，也不得绕到范围外 HTTP 路由、schema、配置、索引、通用 helper 或旧测试中修补。若裁决扩大写域，必须先同步本文件 front matter；当前声明不包含待申请路径。
3. 现有 `lib/http/routes.mjs` 没有 issues endpoint。真实管理入口仅通过 `lib/index.js` 调用 `readSnapshot` 发布 snapshot。现有 snapshot 字段为 models、forecast、source、at、last_error；不存在已约定的问题列表响应字段。`test/integration/ui-snapshot.test.mjs` 精确断言这五个字段，且始终断言“问题来源未接入”。新增问题响应会与这两类既有断言冲突，该测试又在本任务写域之外。不能偷偷新增响应字段、保持错误来源提示迎合测试、非枚举属性偷运数据、把问题塞入 models/forecast，或用另一个测试代替失败回归。attention.json 请求明确接口及必要测试授权。
4. T-042 的版本观察区分 `command missing`、`non-zero exit`、`unparsable output`；这些不等于已安装版本不满足要求。规则表只有名称和版本命令参数，配置没有要求版本或范围。禁止发明最低版本、期望版本、比较配置、新错误码或把“无法解析”冒称“版本不符”。后者的含义、证据与分类映射必须由裁决明确。
5. 沿用 15 秒 JSON 轮询，不引入 SSE、额外定时器或新 endpoint。只读请求不得执行 probe/discover、访问网络、读取认证材料或写入状态。生产问题来源不能读取 `.collab` 调度文件、UI fixture、个人目录或任意日志；任务状态仅供设计与依赖验收使用。
6. 不放宽既有断言，不以 skip/todo/only、删除测试或忽略失败取得通过。`projectIssues(previous, records, filters)` 及 `renderIssuesHtml(issues, origin)` 已被单元测试使用，须保留其显式记录的合并、筛选、未闭环保留和安全渲染兼容性；旧 `test/fixtures/ui/issues.json` 是组件测试输入，不是生产数据源，不删除或改造它以躲避既有断言。

## 建议验收方向

裁决明确接口、分类和版本判据后，按以下顺序实现；每一步只修改当时已授权的文件。

1. `lib/http/issues-api.mjs` 承载实际证据到既有问题记录的投影；`lib/http/snapshot.mjs` 负责读取与发布。优先利用现有 `readProbeModels` 的严格读取结果及现有 inventory 读取/校验路径，不用目录里存在文件本身作为失败证据。模型的证据来自持久化 probe 记录，而非配置补出的 unknown/unverified 模型。inventory 使用 entry.evidence 的 probe 观察，不能拿 fingerprint、last_seen、recognized、version=null 或 auth.state=unknown 单独推断故障。
2. 先建立证据资格，再分类。probe 必须有通过现有校验的 availability.evidence 和实际观测时间；不可用按记录的 availability.state/reason 与执行结果判定。版本预检失败保留其真实三类原因，不伪造版本比较；认证问题只能来自实际认证失败观察，例如 probe 的 blocked/auth，不从 secrets 配置缺省推断“凭据缺失”，也不把认证被拒武断缩窄为凭据不存在。分类字面值、认证问题文案和版本比较规则待裁决，不增加未约定字段或枚举。
3. 复用既有 task_id、role、model、provider、severity、category/code、at、summary、raw_output、action、evidence、count、unclosed 等记录能力，不创造任务或角色。CLI 探测没有 task_id/role 时不得填入虚构任务或 dev/reviewer；缺失上下文按既有 unknown 渲染。时间取观察时间，不取轮询时间。摘要与建议须描述已观察到的事实，不能声称已经修复、拥有账号或完成版本升级。具体发布字段及缺值表示由接口裁决确定。
4. 同一证据重复轮询不能增加 count；不同模型/provider 的问题不能因 task_id 缺失而被错误合并。生产投影基于当前有效状态，不把旧组件的未闭环保留机制当作探测历史数据库；修复后新一次成功观察须移除已失效的探测问题。GET 失败保留上次真实展示并明确 stale/unknown，成功读到无证据时问题列表为空。缓存损坏不能伪装成“无问题”。无来源与有来源但无失败均可为空，来源文案须据 API 如实区分，不能由浏览器补出条目。
5. `ui/app.mjs` 在现有 session → snapshot 读取路径中消费获准的问题响应，并调用 `ui/render.mjs`。`ui/index.html` 不在写域；沿用现有 issues 容器与 issue-source 提示，可由 app 创建所需内容节点，保留默认问题标签、模型页及一次轮询调度。正常读取只替换对应 API 记录，后续轮询更新、失败时保留真实旧条目；不能从页面文本、静态 fixture 或模型名另造问题。UI 验收只核对字段来自 API、无伪造条目及既有轮询行为，不增加视觉断言。
6. HTTP 投影先选取安全字段，再沿用已有脱敏；不向问题详情拷贝原始 stdout/stderr、认证配置、秘密、用户名或本机绝对路径。evidence 只展示已存在且安全的证据标识，不发明证据 HTTP 服务或 file URL。继续保留 HTML 转义及同源 HTTP 链接限制，原始持久证据不被改写。
7. `test/integration/issues-from-probe.test.mjs` 使用 AC-086，复用现有 host-stub、受控 ctx/clock 与实际 `createPlugin` 入口，至少一组通过生产 discover/models probe 生成落盘证据，再经有会话的真实 snapshot 请求和实际 `startApp` 观察结果。不得以 deps.handlers 返回预制问题或仅直接调用投影函数证明接通。CLI 执行使用本地夹具，不访问真实服务；新增夹具只在 `test/fixtures/ui/**`，运行状态位于系统临时目录并 finally 清理。
8. 新集成覆盖有证据的各项获准分类、无文件/空记录/仅配置模型/成功版本与成功调用均无问题、重复轮询不增计数、不同目标不误合并、失败修复后消失、损坏缓存不假空、读取失败 stale、公开标识保留及敏感哨兵不泄漏。版本比较分支在裁决前不能编造测试输入或期望。将实际 HTTP 返回的字段值与 DOM 文本逐项比较，空 API 结果断言无问题文章；确认旧 task-a/model-a/provider-a 静态样例未进入生产响应或页面。推进受控时钟 15000ms 后检查状态变化，GET 过程零额外 exec。
9. acceptance.md 每个命令块独立建立前置条件并根据退出码、stdout 或文件状态判断；不得靠测试标题、内部函数名或行号判定。保留全 unit 回归。裁决授权后，旧 snapshot 测试只能同步明确获准的新字段及来源语义，并增加对应精确断言；认证、模型投影、脱敏、轮询与失败保留断言不得削弱。

## 非目标

不重做页面视觉，不做 SSE、版本要求配置、认证协议、真实网络探测、问题文件格式、自动任务发现、跨重启问题历史、解决按钮或证据文件服务。不宣称本任务完成 Blueprint 中完整 CLI 任务自报、角色筛选交互或自动闭环能力。

## 验收格式

仅使用 brief 指定的 AC-086 二级标题，将依赖、集成、回归、格式检查放在同一小节；每条命令成功后才输出 `AC-086 OK`。存在 attention.json 待决项时，即使依赖或格式命令通过，也不得宣称功能验收通过或开始猜测实现。

本设计轮仅运行无落盘的 acceptance 格式检查及 UTF-8/front matter 核对。`scripts/check-fast.ps1` 会遍历其他检查器、运行测试并可能调用 git 和生成报告，与本轮禁止 git、禁止其他文件冲突，因此本轮不运行。获准实施验收的阶段仍须执行该脚本并如实记录结果；本设计不豁免回归失败，也不将未执行检查写为通过。
