---
write_scope:
  - README.md
  - docs/agentline-integration.md
  - docs/migration.md
  - docs/ui.md
  - docs/platforms.md
  - docs/host-contract.md
  - scripts/check-docs.mjs
  - test/integration/docs.test.mjs
  - test/unit/agentline-doc.test.mjs
  - test/traceability/T-028.json
---

# Task 028 — 文档：AgentLine 集成（只含契约与错误语义）、迁移（含语义变更与映射）、界面与会话、平台、宿主契约

## 目标

交付 brief 指定的六篇文档、文档检查脚本、两份测试和追溯分片。本阶段只创建本任务的 design.md 与 acceptance.md；上面的 write_scope 是下游实现阶段的写入范围，不授权修改任何其他文件。

事实来源是当前工作树：`package.json`、`contracts/registry.snapshot.json`、`contracts/spec/migration-map.json`、`contracts/agentline-forbidden.json`、`contracts/schemas/**`、`contracts/host/dsh-host.v1.json`，以及对应的现有实现和测试。brief 未给出基准 commit 或既有验收报告，不引用其他任务的基准替代。不得新增产品字段、schema 版本、命令或移除时间承诺。下文引用的点分标识均取自现有注册表或迁移映射。

**README.md**

保留产品介绍、安装运行与配置入口，链接五篇专题文档。可执行入口以 `package.json.bin` 的 `cliworker` 和仓库现有 `bin/cliworker.mjs` 为准，运行要求按 `engines` 写 Node 20+。源码运行示例使用相对路径，不依赖全局安装。说明 `config/cliworker.example.json` 是参考模板，直接运行该示例会触发 `E_CONFIG_EXAMPLE`，`init` 也不会自动把模板变成可调用配置。

移除本机绝对路径，修正把响应说成顺序尝试 `models[]` 的旧说明，改为执行返回的 `calls`。推荐选模请求显式使用现有 `cliworker.request/v1`，只含实现识别且有实际用途的字段，不推荐 `role` 或其他会产生 `W_FIELD_IGNORED` 的字段。解释未知字段警告属于兼容行为；旧字段的迁移写在迁移文档。删除当前 README 未由契约承诺的移除版本，不推算替代版本。配置说明区分现有 v1 示例与运行时 v2 结构，不把 v1 的 `providers/models/quotas` 当作 v2 写法。

**docs/agentline-integration.md**

只围绕请求、执行与错误语义展开，不讲内部选模、管理或配额实现。请求说明以 `lib/request.mjs` 与请求 schema 为准：`level` 为 Top/High/Middle/Quick；`count` 为 1..10 的整数、默认 1；`usage` 为 Heavy/Normal/Light、默认 Normal；`importance` 为 normal/high、默认 normal。大小写规则按解析实现说明，不能把 importance 也说成不区分大小写。必要的 `schema`、`request_id`、`exclude_handles` 等协议字段仅用于说明现有请求、重放和再申请，不发明业务字段。

说明读取 `ok`、`count_requested`、`count_returned`、`shortfall`、`truncated`、`warnings` 与 `error`，不保证总能返回请求数量。`calls` 必须按返回顺序执行，保持返回的 `command`、`args`、`cwd`、`input`、`output`、`timeout_ms` 的含义，参数数组不能拼成 shell 字符串。以 stdin 传入任务，消费 `cliworker.event/v1` 中现有的 start/text/usage/result/error 事件，并结合退出码和终结事件判定结果，不把 stdout 一概当单个 JSON。

解释调用一次性、过期后重新申请、全部失败或返回不足时再申请；需要避免重复时使用已有 `exclude_handles`，请求重放与新申请按现有 request_id 行为区分。错误说明以注册表中实际的 code、exit、retryable、retry_after 为准：区分请求错误、无候选、额度不足、租约未知/过期/已消费/配置不匹配、超时和调用失败；不建议对不可重试错误无限重试。错误码可以原样出现，其原因用面向调用方的中文说明，不复制注册表内部术语。CLI 的错误体与 HTTP 选模响应按实际入口区分。

全文（含标题、链接、注释、代码和例子）用 `contracts/agentline-forbidden.json.keys` 做不区分大小写的整词扫描，不设置豁免。整词边界按 ASCII 字母、数字、下划线组成的标识符判定，因此 `CLIWorker` 和完整错误码不会因含子串而误报，而独立的禁词和 JSON 键必须报错。只读顶层 `keys` 为禁词，`call.keys` 是可用调用模板字段，不能误作禁词。其他专题可以解释管理侧内容，但不得为迁就扫描改禁词表或隐写术语。

**docs/migration.md**

注册表 `semantic_change` 的每个值各有一个以该值原文命名的三级小节，正文必须说明旧语义、现语义和调用方动作，不能只贴索引。当前包括 `forecast.tasks_left`、`forecast.risk`、`handle.cli_removed`、`draft_reason_mapping`、`config_v1_to_v2`；检查必须动态读取清单，不把当前五项写死为覆盖总量。

`forecast.tasks_left` 解释单位、依据及 unknown/null 条件；`forecast.risk` 解释风险枚举、依据和边界，数值来自注册表 thresholds 与当前预测实现，不能把 unknown 当作通过。`handle.cli_removed` 解释包装调用取代旧直接调用，管理视图与 AgentLine 视图的字段去向；`draft_reason_mapping` 解释原因码变化；`config_v1_to_v2` 解释内存迁移、`W_CONFIG_V1`、显式持久化命令的现有行为和未知容量的处理。涉及 draft 警告、视图与选择失败退出行为，核对 `lib/contract/views.mjs`、`lib/commands/models/select.mjs`，不承诺实现没有的兼容行为。

按 `migration-map.json` 的现有三组内容提供 Markdown 映射表：`draft_to_v1.reasons`、`draft_to_v1.fields`、`config_v1_to_v2`。每项独占一行，第一列为原始 id（可用反引号），同一行包含其原始 draft/v1 或 from/to 值，空 to 明确写“移除”；多目标全部列出。保留 note 所表达的限制，例如仅管理完整视图可见、移除、改为不透明引用、转换公式和来源。当前分别为 10、15、7 项，仅作为现状核对，运行检查从源文件枚举。`<Level>`、`<provider>` 等原文在表格内用反引号保留，避免变成 HTML 标签。不能以链接到映射文件代替逐项说明。

**docs/ui.md**

说明现有 `/cliworker/ui`、快照读取、异步任务状态与错误展示，以 `ui/**`、`lib/http/routes.mjs`、`lib/http/jobs.mjs`、`lib/http/snapshot.mjs` 为准。HTTP 管理会话从 `/cliworker/api/session` 获得，说明返回的 session/csrf/expires_at、对应请求头、过期与进程重启后失效、内存保存及不经 URL/cookie 传递的要求；写请求按 session → readonly → csrf → body 的实际顺序判定，保留具体错误码。说明 loopback 对 socket 地址、Host、存在的 Origin 分别校验，转发头不能代替真实来源。

明确区分 HTTP 管理会话和 `lib/session.mjs` 的模型对话 start/resume：后者是现有程序接口，按实际导出说明输入、返回、不透明 session_token、失效及恢复失败处理，不虚构 session CLI 命令或 HTTP 路由。`role` 如用于已有会话策略，应说明其所属接口，不能放入选模请求。敏感返回值用文字占位，不写伪造的真实凭据。

**docs/platforms.md**

以 `lib/paths.mjs`、`lib/discovery/platform.mjs`、`lib/discovery/wsl.mjs`、`lib/exec.mjs`、`lib/secrets/**` 及平台测试为依据，说明 Windows/macOS/Linux/WSL 的实际差异：配置与状态目录解析和优先级、Windows 配置路径大小写对隔离标识的影响、WSL 探测与禁用方式、Windows shim 与参数安全限制、超时进程树行为、密钥后端可用条件。仅陈述当前实现支持的行为，不把夹具执行等同于真机验证。跨平台可运行片段使用 Node 参数调用的共同子集；真机命令单列为不可运行并说明前提。

**docs/host-contract.md**

独立解释 `contracts/host/dsh-host.v1.json` 的所有契约部分，保持其现有名称与含义：host_ctx.inject 的服务与同步回调、http_ctx.effect 的返回与异常传播、webServer.register 的 exact 注册、request/response 必需与可选成员、stub_controllable_inputs、createPlugin/getRegistration/apply 的现有返回和严格失败语义。结合 `lib/index.js`、`test/helpers/host-stub.mjs` 与 registration 测试，给出宿主接入方式与可观测的注册失败处理，不能吞错或宣称提供不存在的监听命令。宿主对象代码标为不可运行并说明需真实宿主；可用现有 stub 的离线说明不能要求用户修改库代码。

## 约束

**scripts/check-docs.mjs**

使用 Node 内置模块与已有仓库辅助代码，ESM，零新增依赖。唯一必须支持的直接执行方式是 `node scripts/check-docs.mjs`，从脚本位置确定仓库根；直接执行才启动检查，导入时不执行命令或创建夹具。现有 check-fast 会自动发现它，不修改 package.json。只在成功执行全部检查后输出 `check-docs: ok` 并退出 0；任何遗漏、失败、超时或不可解析输入都退出非 0，诊断指向文档相对路径和片段，不输出密钥、真实用户名或临时绝对路径。

检查 README 和 docs 下的 Markdown，包括已有的非交付文档。现有生成文档只检查链接和可运行标记；不为本任务修改它们。六份交付文档必须存在且非空，README 链接到五篇专题，仓库内文件链接目标必须存在，外部链接不联网验证。检查六份文档不含协作目录名、蓝图编号、本机绝对路径或实际凭据；示例密钥仅为 env/SecretRef 引用。保留已有 check-no-collab 门禁，并补上其未扫描 README 的覆盖。

文档代码块的执行标记使用普通正文，不新增协议字段：代码块紧前的非空行恰为“可运行：”时执行；“不可运行：原因”明确跳过并保留原因。交付文档中所有命令/程序代码块（pwsh、sh、bash、javascript、js、mjs 等）都必须有其中一种说明；JSON、text 类型的静态数据和输出应由上下文说明，不当命令执行。拒绝无说明的命令块、未知可执行语言、空片段、未闭合代码块和混用标记，不以猜测跳过。其他已有文档中的未标记代码块不自动获得可运行声明。

可运行片段统一用 pwsh 代码围栏，只包含逐行 `node bin/cliworker.mjs ...` 的简单命令；参数允许单/双引号包住 JSON 或含空格路径。检查脚本解析这个明确子集为 argv，用 `process.execPath` 和 `shell:false` 真正启动 CLI，不依赖已安装 pwsh、Bash 或全局 cliworker。不能使用 eval、shell:true、管道、重定向、命令替换、环境插值或任意外部可执行文件；超出子集的实机场景明确标为不可运行。可运行示例不得含未提供的 `<占位符>` 或依赖仓库没有的 request.json；请求文件写法可标为不可运行并在相邻 JSON 给出准备条件。

至少 README 与 docs 中各有一段真实可运行片段，总执行数必须大于零；README 包含 v1 选模成功、列表和用量读取的示例。不得通过把全部片段标为不可运行来通过检查。每条成功示例要求实际退出 0、解析 JSON 且 ok 不为 false；选模额外要求返回非空 calls 和匹配的数量，不能让空候选/旧接口退出 0 冒充成功。事件流例子若标可运行必须逐行解析并检查终结成功。预期失败的演示不纳入成功片段，作为不可运行示例说明错误语义，并在测试内单独断言。

在 `os.tmpdir()` 的独立目录生成符合现有 schema 的配置、状态与输入文件，使用 `test/helpers/fake-cli.mjs` 和现有 fake-cli runtime，按现有测试方式提供模型、探测证据和可用容量。注入夹具的 config/state 参数与隔离的 CLIWORKER_HOME 等环境；文档里的显式路径只允许映射到夹具根内预先准备的相对文件，禁止绝对路径和 `..` 逃逸。明确公开给读者：这些标记示例由检查器提供离线测试配置，真实使用前需按配置说明准备自己的可调用配置。参考模板不直接当运行夹具，也不删 `_example` 后盲目当作可用。

环境只给子进程必要系统变量、Node 与 fake-cli 所需搜索路径和测试变量，不继承用户 CLIWorker 配置或凭据，不使用真实模型服务。每段片段有独立初始夹具，同一片段内部的多行按顺序执行；每条子进程有有限超时，异常与成功均清理该次临时目录。fake-cli 记录证明实际调用了夹具。运行时临时文件放仓库外，不新增固定夹具文件、报告或其他受版本管理的产物。

静态检查从现有数据动态得到迁移覆盖集合，逐个确认 semantic_change 有实质正文，映射行包含完整来源和目标；对空目标、重复行或错目标不能只凭 id 存在判定通过。README 中所有推荐的请求 JSON（独立 JSON、内联 --request 及文档提供的请求文件示例）用现有请求解析器验证，无 `W_FIELD_IGNORED`；不能只搜索字符串 role。执行结果中的请求字段警告也要验证，兼容配置警告与 unknown-field 警告不能混淆。

**测试与追溯**

`test/integration/docs.test.mjs` 对真实文档执行 checker，覆盖上述链接、离线命令成功、非空选模响应、所有推荐请求以及迁移完整性。再在仓库外临时副本或内存输入构造失败样本：删除任一语义段落、任一映射行、保留 id 却改错目标或删除正文，注入未知推荐字段，加入退出失败或超时的命令，删除全部可运行片段、引入坏标记/坏引号/非法命令、无效链接或绝对路径，均须失败。覆盖含空格路径与 CRLF，不依赖机器装有真实模型 CLI。导入 checker 可暴露内部可测试逻辑，不能为测试增加产品入口或契约字段，也不能原地改真实文档。

`test/unit/agentline-doc.test.mjs` 读取真实禁词表扫描完整 AgentLine 文档，断言零命中，同时断言四个核心请求字段、calls 顺序执行、再申请及错误/流程状态有说明。给每个禁词构造独立键、大小写、Markdown/注释等输入，证明会命中；给较长合法标识符和注册表错误码构造输入证明不误报。测试中不要直接复制内部协作目录字面量。

两份测试按仓库追溯规则分别标注 `[AC-067]`、`[AC-068]`，这只是现有门禁的登记要求，不把标题作为业务验收判据。`test/traceability/T-028.json` 沿用既有 task/milestone/entries/ac/files/status 结构，登记两个 AC 为 covered、引用对应测试，不自行添加 baseline；baseline 来自现有 ac-index。禁止修改其他任务分片。

## 建议验收方向

以 acceptance.md 中 AC-067、AC-068 的独立命令为准，每条均检查原生命令退出码，成功才打印对应哨兵。验收含 checker、集成测试、动态迁移覆盖、禁词测试及独立扫描、全量 unit 回归和现有 check-fast。多步骤验收代码由执行端落为临时 ps1 后使用 `pwsh -NoProfile -File` 执行；文件 UTF-8 无 BOM，命令默认工作目录为仓库根。

设计阶段只运行不产生额外文件且不调用 git 的格式与只读核对，不能预先声称尚未实现的产品验收已通过。若本机缺少 pwsh，应记录环境限制，不回退 Windows PowerShell 5.1。实现阶段的测试临时文件、报告遵循现有 runner 的仓库外输出方式。

## 非目标

不新增 CLI 命令，不改 package.json、contracts/**、lib/**、现有 UI 代码或其他文档；不改发布检查清单、生成契约文档或冒烟说明，不修改蓝图与其他任务。不通过改实现、注册表、迁移映射或禁词表迁就文档。任何当前实现限制均如实写入对应文档。
