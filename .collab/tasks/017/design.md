---
write_scope:
  - lib/models/**
  - lib/commands/models/enumerate.mjs
  - lib/commands/models/add.mjs
  - scripts/check-no-model-table.mjs
  - test/unit/enumerators.test.mjs
  - test/unit/check-no-model-table.test.mjs
  - test/fixtures/enumerators/**
  - test/fixtures/model-table/**
  - test/flows/steps/enumerate.mjs
  - test/traceability/T-017.json
---

# Task 017 — 按 CLI 分别实现模型枚举，失败时回退到手工补录，禁止写死模型表

## 目标

实现 T-017 / AC-041、AC-042。依据同目录 brief.md、蓝图 design.md、interfaces.md 第 5、10、11、13、15、16 节及 task-graph.json；模型字段与值域以只读的 contracts/schemas/model.v1.schema.json 为准，配置以 config.v2.schema.json 为准。brief 未指定基准 commit SHA 或既有验收报告路径，不借用其他任务的基线。

1. lib/models/ 下为 T-016 识别规则中的每一种已知 CLI 提供独立枚举模块，另设 normalize 与编排模块。已知 CLI 集合直接对齐 T-016 的规则与 T-015 的 11 个已知 CLI 夹具，不以示例配置中的五个 provider 代替完整集合，不自行补造其余名称。当前工作树尚无这两项上游交付；实现与测试需要消费它们的实际公开接口。上游未交付应报告依赖缺失，不能删除覆盖项、skip 或宣称全部通过。生产枚举器可以静态登记 CLI 名称、厂商、参数与解析规则，不能登记任何模型 ID 列表、默认模型或模型版本。
2. 编排读取配置解析出的 state_dir 下的 inventory.json，按 inventory/v1 使用 recognized、status、platform、path、realpath 等已有字段。仅对 recognized=true 且 status=present 的条目执行对应枚举器；gone 条目不执行，未知 CLI 不执行。多个平台或 WSL 条目保留各自执行目标，不能把某发行版的路径直接当宿主路径运行；沿用 T-016 的安全执行方式，不拼接含用户输入的 shell 命令。缺失 inventory 时不能借此扫描磁盘或执行任意 PATH 程序，返回手工补录警告；已存在但 JSON/结构损坏用既有 E_CONFIG 失败，不能当成成功的空清单。
3. 每个枚举器至少实现一个有夹具支持的自动策略，策略仅取 subcommand、help、cache、api。按该 CLI 明确支持的顺序尝试，首个产生有效非空模型集的策略获胜；不能强迫全部 CLI 支持同一 models 子命令。help 只解析模型选项明确列出的 choices/枚举值，不把帮助正文、示例命令或选项名当模型 ID；subcommand 只解析约定的模型列表结构。只在已知、安全的模型缓存路径读取 cache，不递归搜索用户目录；api 只访问明确的模型列表端点，不能触发推理、付费请求或任意 URL。没有证据支持的策略直接不可用，不猜测子命令、缓存文件或端点。错误、超时、非零退出、空列表、格式错误及零个有效模型均尝试下一策略；一个 CLI 的失败不抹掉其他 CLI 的成功。
4. 自动策略耗尽后，在既有 warnings 数组加入 W_MODELS_MANUAL_REQUIRED，以既有 ref 标识 CLI；枚举命令正常退出 0。该 CLI 已有 catalog.manual 记录时返回归一后的记录，source.kind=manual；尚未补录时 models 中没有该 CLI 的伪模型，只给警告。manual 是真实录入记录的来源，不能用占位 ID、默认模型或空 id 伪造回退成功。自动来源可用时，同一 key 的自动记录优先；手工独有记录继续可见。没有自动来源的记录不能改写成 subcommand/help/cache/api。
5. normalize 只构造 model/v1 已有字段，拒绝空白或非法类型 ID，不从 vendor 或 CLI 名推断模型版本。key 对新记录使用 cli 与 id 的冒号组合；已有手工 key 保持稳定，冲突须检查 cli/id 是否一致。同一 key 去重，结果按 key 稳定排序，重复输出不产生重复记录。id、cli、provider、vendor、capabilities、source.kind、source.ref、source.at 齐全；source.kind 对应实际获胜策略，source.ref 是不含凭据的来源标识，source.at 取 ctx.clock.nowIso()；解析到可信观测时间的缓存保留该时间，不把缓存读取时间冒称内容更新时间。不要把原始 stdout、stderr、HTTP 头或任意对象 spread 进模型。
6. 完整归一记录满足 model.v1.schema.json 的 required、additionalProperties=false、嵌套必需键、枚举与数值范围。aliases、allowed、level、level_source、deprecated 从配置既有 catalog 字段合成；枚举本身不改 catalog.allow，不自动授予等级、verified 身份或 callable 可用性。没有等级证据时 level=null、level_source=null，身份为 unverified，可用性为 unverified，availability 的其余未知字段按 schema 使用 null。capabilities 的 context_tokens/readonly/stdin 和 prices 的数值没有 null 表达，不能把缺失能力或价格伪造成 0/false：有效自动候选必须由策略输出、已有配置或手工记录提供这些必需值；缺少时该候选无效，继续下一策略，必要时回退手工。用户明确提供的 0 或 false 是有效值，必须保留。不会为了填满 schema 添加 unknown 字段、价格表或容量常数。
7. lib/commands/models/enumerate.mjs 导出现有 route={cmd:'models',sub:'enumerate'} 与 run({argv,ctx,config})，沿用现有 models 命令的 JSON 容器 cliworker.models/v1、models 数组及已有 warnings 字段。命令形式为 models enumerate --config <配置>，枚举全部清单条目；不新增必须的过滤参数。结果只返回归一后的 model/v1 与脱敏警告，不写 inventory、不改配置、不把自动结果塞进 catalog.manual。自动结果的持久目录与白名单管理属于 T-020，本任务不新增状态 schema。
8. lib/commands/models/add.mjs 同样导出 route={cmd:'models',sub:'add'} 与 run。命令形式为 models add --request-file <model/v1 JSON> --config <配置>；复用已有 --request-file 约定，输入为单个完整 model/v1 对象，不发明手工模型专用字段或版本。必须校验必需字段、值域、禁止额外键及 key/cli/id 一致性，拒绝空 ID、非法类型、非法 JSON 和含凭据字段；请求错误用既有 E_REQUEST_INVALID，加载配置错误沿用 E_CONFIG / E_CONFIG_SECRET_INLINE。source 强制取 manual、ref 指向配置中对应记录、at 取注入时钟；availability 与 identity 重置为未验证，allowed 按既有 allow 计算，不能信任输入自报 callable、verified 或 allowed。用户给出的 level 不隐式改 catalog.levels，也不隐式允许模型。
9. add 以 key 更新或新增 config.catalog.manual，通过现有 store.atomicWriteJson 与 lock.withLock 完成配置写入；在锁内重读并合并最新配置，保留其他手工条目和所有其他配置字段，避免丢失更新。只序列化 v2 契约配置，不落盘 _file、_home、warnings、兼容 models/providers/quotas；原生 v2 保持 v2，旧配置通过既有迁移逻辑转为 v2 后保存，保留既有 W_CONFIG_V1。写入失败保持原文件，采用既有错误输出；不触碰 secret 后端内容。成功结果沿用 cliworker.models/v1，models 中为本次录入后的完整归一记录。随后从新进程执行现有 models list 必须能按 key/id 找到它；现有 list 的 draft 兼容投影不在此任务改造，其 source 字符串不能冒充完整归一对象的验收结果。重新 enumerate 在自动失败时必须返回相同记录且 source.kind=manual。
10. lib/cli.mjs 已通过 lib/routes.mjs 动态发现命令模块的 route 导出，故无需修改分发器。task-graph.json 比 brief 多列 lib/cli.mjs，本任务采用 brief 的较窄范围；不得修改 lib/cli.mjs、models/list.mjs、lib/config.mjs、lib/select.mjs 或 bin。模块导入时不能执行枚举、写配置、注册副作用或输出日志。真实 bin/cliworker.mjs 必须能到达两个新增命令；直接调用模块不能替代命令接入验证。
11. scripts/check-no-model-table.mjs 默认递归扫描相对脚本定位的仓库 lib，支持 --root <待扫描目录> 以在违规夹具上运行。扫描 .mjs/.js/.cjs/.json，确定顺序，不执行或导入被扫描文件。识别模型 ID 的字面量集合：模型列表字符串数组、带字面量 id 的模型对象数组、以模型 ID 为键的模型元数据字典、Set/Map 中的同类表，以及默认/回退模型字面量。模型上下文由变量/属性与对象结构共同判定，不能只靠厂商前缀或模型版本正则；合成的无厂商 ID 也应命中。字符串词法处理需区分注释、转义、单/双引号及无插值模板字符串，覆盖多行、嵌套、导出声明，不能简单全文件搜索引号或注释中关键字。
12. 检查器允许 CLI 名称/厂商映射、策略顺序、schema 字符串、来源枚举、参数数组以及从配置/CLI 输出动态组装的模型，不按文件名、CLI 名或某一条模型 ID 静默放行 lib 中的表。不读取 test/fixtures 作为生产默认表。成功退出 0，stdout 为 check-no-model-table: ok (0 model id literal tables)；发现任意违规退出 1，逐项输出含相对路径与行号的 FAIL 诊断，末尾含 check-no-model-table: FAILED；目录不存在、无法读取或参数错误必须非零，不能报 0。test/fixtures/model-table/invalid 只放违规样例，valid 放容易误报但合规的样例，两类都必须有独立断言。
13. test/unit/enumerators.test.mjs 使用 [AC-041]，用 ctx.exec/fs/fetch/clock 和合成夹具断言：已知集合与 T-016 规则一致且为 11，每个 CLI 独立策略至少一次成功；替换夹具中的 ID 后输出随之变化；每个实现策略的失败与下一策略；全部失败、有/无手工记录；混合成功失败；空/坏 JSON、非零退出、超时、重复/非法 ID、能力字段缺失；完整 schema、来源与固定时间；未知/gone 条目 exec=0。覆盖实际启用的每种策略，不要求没有 API 的 CLI 伪造 API。单元测试中用真实 CLI 子进程及隔离的系统临时配置完成 add→新进程 list→枚举回退，并验证失败不写配置、其他配置不变、重复补录不产生重复项、白名单不自动扩张及身份仍未验证。与实现函数相同的转换逻辑不得用于生成期望结果。
14. test/unit/check-no-model-table.test.mjs 使用 [AC-042]，启动真实检查脚本验证当前 lib 为 0、逐个 invalid 样例非零且定位正确、逐个 valid 样例退出 0。违规样例覆盖上述每类表、任意合成 ID、嵌套/多行/模板写法；合规样例覆盖注释、schema、CLI/vendor 映射、参数、策略枚举和动态来源。证明省略 --root 会实际扫描 lib，根目录不存在或不可读时失败，不允许空扫描等同通过。
15. test/flows/steps/enumerate.mjs 使用当前 harness 已有的 name='enumerate'、introduced_by='T-017'、ac=['AC-041']、run(env) 导出；另外导出蓝图第 15 节已有的 id='enumerate' 供后续流程消费，不改 harness。该步骤通过真实 CLI 完成枚举、失败警告、手工补录和重新读取，使用 env 的临时 root、config_path、state_dir 与捕获接口，结束时恢复共享配置，避免改变后续 select 步骤的候选；不把哨兵写入 fixture。AC-041 单测还需直接在 createFlow 创建的隔离环境运行本步骤并检查 env.scan() 零泄漏，保证 --ac 过滤运行实际覆盖该步骤，而不依赖未来全流程任务。
16. test/traceability/T-017.json 只使用已有格式：task=T-017、milestone=M3，entries 仅 AC-041 和 AC-042。AC-041 的 files 为 test/unit/enumerators.test.mjs 与 test/flows/steps/enumerate.mjs，AC-042 的 files 为 test/unit/check-no-model-table.test.mjs；完成实际覆盖后 status=covered。层级均为 unit，平台 baseline 只读取 ac-index 的 linux/win32/darwin，不在分片增加字段或重复声明。

## 约束

实现 write_scope 严格为顶部十项，与 brief 一致。本 design 角色只创建同目录 design.md、acceptance.md，不改代码、不执行 git、不创建临时脚本或报告。下游不得修改本验收文件来适配实现结果。

Node 20+ / ESM，零第三方运行时依赖，文本 UTF-8 无 BOM；不安装解析器或测试运行时来绕过该要求。外部命令、文件、网络、时钟分别走 ctx.exec、ctx.fs、ctx.fetch、ctx.clock；lib/models 不直接 import node:fs、node:child_process 或使用全局计时器。枚举命令只读，add 的用户数据写入限定其显式解析出的配置及既有锁/原子写所需文件。

密钥仅经 T-013 SecretRef 和环境注入；不进入 argv、source.ref、模型对象、错误、日志、stdout/stderr 或状态。API 认证只用内存请求头；捕获含哨兵的 CLI stdout/stderr、API 响应、错误异常及缓存时，不回显原文，不传播任意属性。测试以假的 exec/fetch 与安全临时文件验证各输出面无哨兵，不要求真实安装、登录或联网。运行时代码与测试不得引用 .collab 中的蓝图或设计文件。

## 建议验收方向

acceptance.md 登记本任务的 AC-041、AC-042，每条命令从任意目录可执行，使用绝对脚本路径且不依赖前一次命令生成的文件。正式 --ac 运行必须实际发现并执行对应测试文件，测试数大于 0，失败、取消、skip、todo 均为 0；不能以 run.no_match、测试标题匹配、全跳过或只 import 模块作为通过证据。期望行为由上述单测中的输入/输出及持久配置断言证明，不要求开发者凑某个测试标题字符串。

check-no-model-table 的生产零命中与违规目录非零为额外独立命令；负例命令的预期就是退出 1，不能套用“所有命令退出 0”。已有 AC 索引与追踪格式只读复用，不发明 AC 或报告 schema。正式运行器的报告在既有系统临时目录，fixture、配置与流程运行数据也放系统临时目录，结束清理。

实现完成后按本机约定执行 scripts/check-fast.ps1，期望退出 0 且输出 check-fast: ok，作为集成检查，不代替两条属主 AC。当前设计阶段不运行该脚本或测试：检查链可能调用 git，运行器和测试会创建本角色禁止的额外文件。这里只交付规格，不宣称实现通过。

## 非目标

不修改 brief.md、impl.md、review*.md、verdict*.json、state.json、run.json 或任何代码；不扩大 write_scope。不重做 CLI 发现、未知 CLI 探测、真实推理、身份验证、额度读取、白名单管理、目录持久化、UI、HTTP 路由或其他里程碑。不上网猜测模型或命令，不把示例、测试夹具、vendor 表或失败回退变成生产模型表。
