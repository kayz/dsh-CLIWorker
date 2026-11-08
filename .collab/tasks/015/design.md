---
write_scope:
  - test/fixtures/fake-cli/**
  - test/helpers/fake-cli.mjs
  - test/integration/fake-cli.test.mjs
  - test/traceability/T-015.json
---

# Task 015 — Provider 夹具：fake-cli 生成器（11 个已知、1 个未知、6 种模式）

## 目标

落实 T-015 / M2 / AC-035，交付可被后续发现、枚举、探测和执行测试复用的本地夹具。规格来源为 brief 指定的蓝图 design.md、interfaces.md、task-graph.json；CLI 名单补充依据为 REQUIREMENTS.md 第 3 节第 3 条：codex、claude、dsh、cursor、codebuddy、antigravity、trae、zcode、qoder、kimi、opencode。另用不在此集合内、匹配既有 *-cli 模式的合成名称 unknown-cli。不得用 gemini 替换名单成员，也不得按生产识别表当前仅有的 claude 规则缩减夹具集合。

brief 未指定本任务的基准 commit SHA 或既有验收报告。蓝图特征化任务中的 f75bb76 只属于其冻结副本，不作为 T-015 基准。夹具不证明真实 CLI 参数、认证、模型或适配能力已经验证，不扩充生产识别规则。

- test/fixtures/fake-cli/** 保存共享 ESM 运行脚本及无秘密模板，避免复制 72 份运行逻辑。
- test/helpers/fake-cli.mjs 提供生成垫片、读取记录的可复用导出。生成入口接收目标目录、CLI 名称、模式、help/version/模型列表输出文本、模型列表请求 argv 和记录目录，返回垫片绝对路径；读取入口接收记录目录并返回解析后的记录数组。导出和参数须在模块注释中说明。输出及请求 argv 由调用者给定，不新增产品配置字段、环境变量协议、schema 或版本号。
- test/integration/fake-cli.test.mjs 使用 node:test、Node 内置断言和真实子进程；按现有设施标记 [AC-035]。名单、模式、输出及哈希预期由测试独立给定，不从被测结果反推。
- test/traceability/T-015.json 严格使用 interfaces.md 第 15 节既有结构：task=T-015、milestone=M2，entries 仅一项 ac=AC-035、files=[test/integration/fake-cli.test.mjs]、status=covered；不添加 baseline 或自定义字段。

## 约束

1. front matter 是后续实现的完整写入范围；本轮 design 只创建本目录的 design.md、acceptance.md。Node 20+、ESM、零第三方运行时依赖。不修改生产代码、公共 helper、package.json 或权威契约。实现和测试不得引用蓝图工作目录；名单来源写为 REQUIREMENTS.md，避免 check-no-collab 扫描命中。
2. 生成物与记录放调用方创建的独立 OS 临时目录，不共享全局状态。脚本按自身位置读取生成数据，不依赖调用时 cwd、仓库绝对路径或本机厂商 CLI。数据仅含合成输出及控制信息，不复制 process.env 或真实凭据。路径使用平台 API，文本 UTF-8 无 BOM。
3. win32 为每个 CLI 生成 .cmd 及对应 Node ESM 脚本。Node 调用行须匹配 lib/exec.mjs 的 resolveShim：带引号的 %~dp0 相对脚本路径、末尾 %*，脚本路径后不夹入模式等控制参数。模式与输出绑定到生成脚本的数据。createExec 注入真实 fs、process.execPath 和环境后能解析垫片并直接执行 Node；不要求裸 spawn(.cmd) 成功，不通过 shell 拼接用户参数。
4. Linux / macOS 生成带 Node shebang、LF 行尾的无扩展脚本，并设置执行权限。测试直接启动该路径，不能显式 node 跳过权限和 shebang。只要求当前平台真实执行；各主机分别证明原生执行，不用 platform 伪装冒充实跑。
5. 每次启动先完成一条调用记录再响应。argv 为应用参数数组，排除 Node 和脚本路径，保持空串、空格、中文、引号及 shell 元字符的边界。记录使用 brief 已规定的 argv、sha256，以及既有 envNames、cwd：envNames 是实际收到的环境变量名并稳定排序，sha256 按环境变量名对应其 UTF-8 值的 SHA-256 小写十六进制摘要；cwd 取实际 process.cwd()。不得保存环境变量原值、完整 process.env 或登录文件，不新增 schema、时间戳、版本等字段。
6. 每次调用写独立记录文件，写完后才向读取入口公开，避免并发覆盖和半行。读取入口只解析已完成记录，不执行垫片；空目录返回空数组，损坏记录明确失败，不能静默丢弃。测试按输入匹配记录，不依赖跨进程启动顺序。异常只报告固定说明，不回显记录正文或环境值。
7. --help、--version、调用者配置的模型列表 argv 优先匹配，退出码 0，逐字节返回对应文本，不自动追加换行或查询真实服务。模型请求以 argv 数组全等匹配，不发明厂商 models 参数。两套配置必须隔离；一个实例的模式不能污染另一实例。
8. 其余调用按模式响应：ok 成功退出；auth、quota 非零退出，stderr 分别含可区分的 auth、quota 证据；timeout 记录完成后保持等待，由调用方取消，不能自行提前成功退出；deprecated 提供明确弃用证据；mismatch 的 reported_model 与测试明确指定的 requested_model 不同。模型/证据输出使用既有接口字段或调用者给定的纯文本，不另造事件 schema；测试用非零进程状态不能冒充 CLIWorker 注册表错误。六种模式必须分别断言状态、输出和记录。
9. timeout 测试等记录完成的屏障后，推进既有伪时钟触发 createExec.runAsync 超时，断言已有 E_TIMEOUT，等进程退出后再清理。有界启动等待、真实时间兜底终止和 finally 清理须防止挂起；不用长 sleep 或精确墙钟阈值作通过依据。夹具不派生后台进程；生产杀树回归属于 T-010。
10. 凭据仅用测试动态随机哨兵经环境注入。argv 测试只使用非秘密合成值，输出模板不含哨兵。扫描生成数据、记录、stdout、stderr 及失败信息，必须无哨兵明文；独立计算 SHA-256 核对同名环境摘要，未注入实例不得出现该变量。不能为记录 argv 把秘密参数落盘，断言失败也不得回显哨兵或开发机环境值。

## 建议验收方向

唯一属主 AC 为 AC-035，层级 integration，正式方向是 node scripts/run-tests.mjs --ac AC-035。独立命令及通过条件见 acceptance.md。集成测试必须验证：

- 11 个明确名称与 unknown-cli 全部生成并实际启动；12 个 CLI 分别运行六种模式，每次都有对应记录。不得只检查文件存在或只执行一个 CLI。
- 所有名称的 help/version/模型输出均可配置，至少两套配置验证隔离；未匹配的 argv 进入模式分支。
- 空格、中文生成路径和 cwd 下，敌意但无秘密的 argv 完整往返；Windows 经现有 createExec/resolveShim，POSIX 直接启动生成物。
- ok、auth、quota、deprecated、mismatch 各有独立预期；每个 timeout 在记录屏障之后取消，返回 E_TIMEOUT，无遗留进程和伪时钟定时器。
- 环境变量名和独立计算的 SHA-256 一致，所有受检表面无明文哨兵；未注入变量不被虚构；并发调用不串配置、不丢记录、无可读半成品；空目录与损坏记录读取分支均被验证。

验收不依赖测试标题全文、内部函数名、固定例数或其他任务状态；实际执行至少一例，fail/cancelled/skipped/todo 全为零，正式清单确实包含本测试。仓库已有 scripts/check-fast.ps1，后续实现完成应执行；本轮设计阶段仅执行不调用 git、不创建额外文件的格式检查，不能运行会修改文件或调用 git 的全套检查。

## 非目标

不实现真实厂商 CLI、生产识别规则、枚举器、适配器、探测状态机、额度、租约、WSL smoke 或其他里程碑任务。不把合成夹具当真机认证证据，不修改验收文本迁就实现。
