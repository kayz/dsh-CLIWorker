---
write_scope:
  - lib/discovery/**
  - lib/fsx.mjs
  - lib/commands/discover.mjs
  - test/unit/discovery/**
  - test/integration/discovery.test.mjs
  - test/integration/discovery-incremental.test.mjs
  - test/integration/discovery-deny.test.mjs
  - test/fixtures/discovery/**
  - test/flows/steps/discover.mjs
  - test/traceability/T-016.json
---

# Task 016 — 平台识别与本地 CLI 发现：WSL 跨发行版解析、拒读清单、增量清单

## 目标

实现 brief 的 T-016 / M3，覆盖 AC-036、AC-037、AC-039、AC-040。依据为蓝图 design.md、interfaces.md 第 10、11、13、15、16 节和 task-graph.json 中相应 AC；落盘对象严格服从只读的 contracts/schemas/inventory.v1.schema.json，配置服从既有 config v2。brief 没有给出基准 commit SHA 或既有验收报告路径，不借用特征化任务的基准作为本任务基准。

当前存在必须先裁决的规格缺口，已写入同目录 attention.json。本文件确定可从现有契约推导的实现和验收边界，尚不能据此宣称任务可以无条件进入实现：

1. 三份权威规格仅要求发现 11 个已知 CLI，没有列出完整可执行名、别名、安装目录和拒读路径集合。T-015 当前也仅有 brief，没有已交付的 test/helpers/fake-cli.mjs 或识别名单。不得自行凑齐 11 个名称，也不得以实现中的规则表反向生成测试预期。需提供该规则来源或明确授权设计师制定。
2. task-graph.json 的 T-016 write_scope 另含 lib/cli.mjs、lib/exec.mjs，brief 没有这两项；本文件取更窄的 brief 范围，不自行扩权。当前 lib/routes.mjs 支持 route 导出，但 lib/cli.mjs 的 resolveRoute 会把 discover 后的 --full、--probe-unknown、--config 等作为 sub，无法匹配普通无子命令路由。单独新增 discover 模块不能正确接入这些调用。需授权分发器的最小修改，或明确现成可用的接入方案；禁止导入副作用、篡改 argv 或劫持其他命令绕过范围。
3. 当前 lib/exec.mjs 的同步执行固定 encoding=utf8，异步结果也转文本；UTF-16LE 原始字节尤其非 ASCII 发行版名可能不可逆丢失。AC-037 的纯解析函数可接收注入 Buffer，但生产 WSL 枚举也必须获得无损输入。需随裁决确定已有无损执行入口，或授权执行器的最小调整；不得让单测 Buffer 能通过、真实路径却永久丢失字节。

## 约束

实现使用 Node 20+ / ESM，零第三方运行时依赖。除 front matter 外不扩大写入范围；规则、夹具、测试只能写入列出的目录。不得修改 contracts、公共测试辅助器、分发器或执行器来掩盖依赖缺口；裁决后先由设计师更新规格及 write_scope，再实施获准修改。

1. lib/discovery/ 下分别承载 platform、rules、scan、wsl、inventory。平台判定输入来自 ctx.platform、ctx.env 和经 fsx 获取的 /proc/version，不直接读取全局 process.platform / process.env。先依据宿主平台区分 win32、darwin、linux；仅 Linux 使用 WSL 环境和内核证据识别 WSL。具有明确发行版名时使用既有 wsl:<d> 表达，不凭内核文本发明发行版名。host.arch 从既有可注入依赖边界获取，不给 ctx 契约添加新字段。全部时间来自 ctx.clock。
2. rules 只固化经裁决确认的名称、别名、已知目录和安全探测参数。扫描使用 PATH、确认的安装目录、discovery.extra_dirs 和 discovery.cli_overrides；按目标平台使用对应路径分隔符、扩展名和大小写规则。仅扫描声明的目录层级，不遍历整个用户目录。缺失目录可跳过；失败不得把原始异常输出或环境值写入清单。目录、候选、符号链接处理均经 fsx。候选按平台与规范化 realpath 去重，排序和 id 确定，保证重复扫描不重复建档、不同 WSL 发行版不互相覆盖。
3. 未知候选只来自 discovery.unknown_patterns，默认不执行、不读取可执行文件正文；recognized=false、version=null、auth.state=unknown。discovery.probe_unknown 或 --probe-unknown 明确启用时，才允许一次受超时约束的 --version，不执行未知 CLI 的 status、help 或模型请求，不因版本输出提升为 recognized=true。--full 只绕过缓存，不隐含 --probe-unknown。已知 CLI 仅执行确认过的版本/状态探测；不能从安装存在、版本成功或配置 SecretRef 推断已登录。
4. lib/fsx.mjs 包装 ctx.fs，并在每次底层访问前判定拒读；禁止通过拒读目标的 exists、stat、read、readdir、realpath 等操作先访问再过滤。规范化处理相对路径、点段、分隔符、Windows 大小写和目录边界，不能把名称前缀相同的相邻目录误判。对允许路径的链接先检查其解析目标；若无法安全确认目标则跳过，不能读取链接指向的秘密。直接路径与解析目标均须符合经裁决确认的拒读集合。测试统计底层 ctx.fs 的访问计数，不能仅统计包装器自身调用；不要求阻止 CLI 子进程自己的内部文件访问。
5. WSL 仅在适用宿主且 discovery.wsl=true 时枚举，禁用时 WSL exec 数为零。列表调用使用独立 argv；解析入口接受 UTF-16LE 字节夹具，处理 BOM、CRLF、NUL、空行和默认发行版标记，保留合法名称并稳定去重。每个发行版生成独立 platform=wsl:<d> 的条目。列表调用、逐发行版调用和安全探测全部经 ctx.exec / 已有执行层，禁止直接引入 child_process。
6. 逐发行版命令使用固定参数模板。发行版名、路径等只能作为完整 argv 元素或静态脚本的位置参数传入；若需要 sh -lc，其脚本文本必须是常量，不能拼接发行版名、候选名或路径。测试独立写出预期 argv，与实际调用深相等，覆盖空格、中文和 shell 元字符，不能只断言实际参数等于实现自己返回的模板。非交互调用使用已有超时与执行限制，不发起模型推理、登录或付费调用。真实 WSL smoke 属 T-029 / AC-038，本任务的夹具通过不冒充真机通过。
7. inventory.json 存在既有 resolvePaths 得到的 state_dir，通过 lib/store.mjs 的 readJson / atomicWriteJson 读取和原子替换；不另造配置路径、持久化文件或 schema。对象只包含 schema、generated_at、host、entries 及 inventory schema 已列字段。fingerprint 只包含 size、mtime、realpath；evidence 只包含 kind、cmd_redacted、exit、at、digest；不加 raw、stdout、stderr、summary、ttl、last_probe 等字段。脱敏摘要使用既有 cmd_redacted 等字段表达，不存任意原始输出截断。
8. 增量复用按同一身份、fingerprint 全部相等及 policy.probe_ttl_s 判断；TTL 默认沿用 21600 秒，时效依据保存的探测 evidence.at，不能用每轮刷新的 last_seen 无限延长缓存。TTL 内缓存条目不执行版本/状态探测；逐次更新 generated_at、仍存在条目的 last_seen，保留 first_seen。TTL 到期、指纹变化或 --full 时重新探测；未知候选仍受第 3 条约束。删除条目保留 id、first_seen、旧 last_seen 和历史证据，status=gone；重新出现恢复 present。只有完成对应扫描域并确认缺失才标 gone，WSL 禁用、枚举失败或目录无权访问不能当成确认删除。列出发行版所需的控制调用与条目探测调用分开计数；AC-039 的零探测断言使用关闭 WSL 的本地夹具，另测 WSL 条目复用。
9. 探测输出仅在内存中提取严格版本/状态信息并计算 digest，随后丢弃；对外只输出 schema 允许的已脱敏证据。未知或失败探测允许 version=null、auth.state=unknown，不把整行错误当版本。复用 lib/redact.mjs、现有输出及审计设施；不调用秘密后端来读取令牌，不输出环境值，不把秘密塞入 id、路径、摘要或异常。AC-040 同时注入凭据形态哨兵和普通原始输出哨兵，防止只靠密钥正则掩盖原文泄漏。
10. lib/commands/discover.mjs 沿用 run({argv, ctx, config})，返回单个 inventory JSON，错误使用既有错误码和公共错误输出，不注册新码、版本或成功 envelope。按最终裁决的路由方式提供 discover [--full] [--probe-unknown]，并支持已有 --config。模块不自行写 stdout，不打印探测原文；需要的 CLIWORKER_TEST_CLOCK_FILE 警告由公共入口负责。写入失败不得破坏旧 inventory；可预期的单个探测失败保留合法条目，不假装成功版本。
11. test/flows/steps/discover.mjs 按当前 harness 导出既有 name='discover'、introduced_by='T-016'、ac 和 run(flow)，同时导出蓝图所要求的既有 id='discover'；不改 test/helpers/flow.mjs。复用同一临时 state_dir、捕获和泄漏扫描设施，真实经过 bin 到命令模块。test/traceability/T-016.json 使用既有 task、milestone、entries 格式，仅登记四个属主 AC 与实际测试文件，status=covered 以通过为前提；baseline 只读 contracts/spec/ac-index.json。

## 建议验收方向

验收命令与期望输出见 acceptance.md；四个 AC 各自建立夹具、时钟、调用记录和状态，不依赖上一条命令留下的报告。平台矩阵、WSL 和拒读测试均可通过注入全平台执行，不因当前没有 WSL 或真实 CLI 而跳过。T-015 依赖尚未交付时不得将 AC-036 标为通过；应在设计裁决和依赖补齐后运行。

测试预期来自经裁决确认的规则和拒读集合、既有 schema 及固定合成输入；不能用被测规则表生成完整 expected 集合、删除字段校验或更新权威 schema 来让测试通过。临时垫片和记录放 OS 临时目录，在 finally 清理。验收依据是退出码、实际对象/计数断言与稳定运行器摘要，不要求某个测试标题全文，也不为测试另增产品字段。

## 非目标

不实现模型枚举、身份验证、额度探测、选模、UI、HTTP 管理入口或 real-smoke。不把 recognized 解释为 adapter 已验证或模型可调用。不改其他任务、权威契约和密钥后端。本次 design 角色只产出 design.md、acceptance.md 及明确授权的致命歧义 attention.json，不执行可能生成文件或调用 git 的检查程序。
