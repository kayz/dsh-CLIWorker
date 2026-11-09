---
write_scope:
  - lib/discovery/probe.mjs
  - lib/discovery/scan.mjs
  - lib/discovery/rules.mjs
  - test/integration/discovery-probe.test.mjs
  - test/fixtures/discovery/**
  - lib/commands/discover.mjs
  - lib/probe.mjs
  - lib/availability.mjs
---

# Task 042 — 真实 CLI 探测接线：discover 版本证据与 probe 可用性

## 目标

按本轮用户裁决接通既有生产路径。这里的 probe 特指 `lib/commands/models/probe.mjs` → `lib/probe.mjs`，不新增命令、第二套模型探测流程、状态文件或契约版本。`lib/discovery/probe.mjs` 只承载三处调用方共用的本地版本执行、解析及证据归一逻辑。

当前 `lib/commands/discover.mjs` 已经有 ctx.exec 版本调用、version 和 evidence 写入逻辑，本任务提取并统一该逻辑，同时让既有 models probe 消费真实版本观察。版本命令执行失败不得伪造版本，三类失败落入对应模型既有 availability.state/reason。版本成功本身绝不能让模型变成 callable；callable 必须继续由既有真实调用成功、nonce 匹配、身份核验及用量证据规则决定。此边界必须有负例和正例测试。

brief 未提供基准 commit SHA 或既有验收报告路径。本轮所附 `f43467f` 是生成资产检查增量的来源标识，不作为 T-042 的产品行为基准，也不执行 git show；已直接核对工作区的 `scripts/check-generated-fresh.mjs`。保留该外部增量，其脚本和发布文档不进入本任务写域。

## 约束

1. 顶部 write_scope 是 brief 的五项路径加用户授权的三项生产文件，均相对仓库根；`*` 匹配单段、`**` 匹配多段。本 design 轮只写本文件和 acceptance.md，不改历史 attention.json、brief、实现、审查、状态或运行文件，不执行 git。前轮 attention 中的阻塞由本轮明确裁决解除，不能因历史文件仍在而再次阻塞。
2. 冻结 `contracts/schemas/inventory.v1.schema.json`：顶层及 entry 字段完全沿用现有契约。entry.status 始终只是 present/gone，recognized 只由文件名规则决定；版本失败不能更改识别结果，不能新增 availability、reason、错误字段或证据字段。实际探测沿用 kind=probe 的证据及 cmd_redacted、exit、at、digest；digest 是真实 stdout 的 UTF-8 SHA-256。无执行则 version=null、evidence=[]，不能从指纹、旧条目、文件名或默认值补版本。新探测条目的 auth 保持 unknown/none。
3. 模型输出保持既有 cliworker.model/v1 和 cliworker.models/v1，状态只写入 `model.availability.state`，失败类别只写既有 `model.availability.reason`，不在模型上添加 version 字段。继续使用 probes.json、既有保存锁和原子写入。availability 的 at、ttl_s、evidence 和 identity 均保持既有含义，不能将版本输出当作模型身份、nonce 或 token 证据。
4. 规则表继续是版本参数的唯一来源：已识别的 11 项沿用 name、versionArgs 和 findRule，当前版本参数都是 `['--version']`。不新增模型清单、名称分支、CLI 别名、价格表、第三方依赖或运行时文档读取。不把版本参数重新硬编码到 discover、models probe 或 availability。未知候选仍仅按现有显式 --probe-unknown/config 策略处理，不能借本任务扩大默认执行集合。
5. 所有进程执行经 ctx.exec 和现有安全执行层，传离散参数数组、20 秒超时、当前 ctx.fs/env/platform lookup；不拼接 shell 命令。版本调用不读取厂商认证、不注入模型调用 prompt、不调用网络。时钟通过 ctx.clock，证据不输出原始 stdout/stderr、用户绝对路径、凭据或环境值；失败原因用稳定类别，不能直接拼接 stderr。

## 建议验收方向

按以下顺序实现，验收命令见 acceptance.md；只重构必要的接线，不重做 T-037。

1. `lib/discovery/probe.mjs` 提取通用版本执行与解析逻辑，供 discover、`lib/probe.mjs`、`lib/availability.mjs` 复用。它是内部复用模块，导出方式由实现选择，不增加公共 CLI 或输出字段。调用方传入实际可执行目标和命中的规则；已知 CLI 参数必须取 rule.versionArgs。保持 discover 对 ctx.exec 内部抛异常的 E_INTERNAL 语义，普通执行失败结果则按下面分类处理，不能把程序错误吞成版本失败。

   | 实际观察 | inventory.version / probe 证据 exit | 对应模型 availability.state / reason |
   | --- | --- | --- |
   | 启动失败且执行结果明确包含 ENOENT，或扫描后执行前目标消失 | null / null | unverified / `command missing` |
   | 进程有整数非零退出码，即使 stdout 含版本文本 | null / 真实非零码 | unverified / `non-zero exit` |
   | 正常退出 0，但 stdout 没有合法语义化版本 | null / 0 | unverified / `unparsable output` |
   | 正常退出 0，stdout 有合法语义化版本 | 真实解析版本 / 0 | 不授予 callable，继续既有真实模型调用 |

   reason 的三个字面值采用本轮裁决中的类别原文，测试逐一精确断言。空输出属于无法解析；stderr 中的版本不充当 stdout 版本。解析支持 major.minor.patch、可选预发布及构建元数据，保留真实后缀，允许文本前缀中的 v；拒绝不完整版本、非法前导零和从非法长 token 中截取合法子串。多版本文本取按输出顺序出现的首个完整合法 token。超时、EACCES 等其他启动失败不冒充 ENOENT，也不冒充输出无法解析；版本为 null、模型保持 unverified，reason 使用既有 timeout/unavailable 类别。真实模型调用本身的超时仍遵守原 unavailable/timeout 规则。

2. `lib/commands/discover.mjs` 用共用逻辑替换现有私有版本执行/解析，不新增一次额外探测；版本成功、空文本、非零码和启动失败仍各保留一条真实 probe evidence。候选规则、去重、稳定排序、first_seen、last_seen、gone、读目录失败保护和缓存保留。TTL 仍用证据 at，而非 last_seen；--full、指纹变化或 TTL 到期才重探测。失败重探测须清空旧 version，不能残留上次成功值。`lib/discovery/scan.mjs` 不执行进程，只在确有必要时调整候选交接，保持已有接口与扫描边界。

3. `lib/probe.mjs` 在既有白名单/弃用过滤及调用适配器构建之后，为实际执行目标命中版本规则的模型做版本预检。根据已有调用构造结果对应的可执行文件定位规则，不根据 model id、vendor、provider 展示名或别的安装的同名成功记录冒认。原生绝对路径取平台 basename 后按 findRule 识别；同一模型调用的已有 args_prefix 应原样保留在版本参数之前。对实际目标为 node 等解释器或未知包装器、无法命中版本规则的调用，不把解释器 --version 认作 CLI 证据，也不默认执行猜测的版本参数，继续既有真实模型调用。此限制在测试和交接中明确记录。

   每次 models probe 必须取得本次版本观察，不能仅凭 inventory 中旧的非空 version 判成功；无须先运行 discover。一次调用中，同一平台、实际可执行目标及参数前缀可共享一次版本结果，不得跨目标或跨调用复用。发现缓存只服务 discover，不能借其 TTL 保留陈旧 callable。三类版本失败时不再发起该模型的真实推理调用，直接更新并保存 unverified 和对应 reason，覆盖旧 callable；identity 为 unverified。继续使用现有 availability.evidence 的 probe_id、cmd_redacted、exit、duration_ms、nonce_ok、reported_model、tokens：记录这次版本失败的退出值和耗时，nonce_ok=false、reported_model=null、tokens=null。不捏造模型回答、用量或免费 usage 行；版本查询不计入推理账本。

   版本成功后，既有 runWithSecrets、nonce、身份解析、超时重试、认证/配额/弃用处理、用量核算及保存逻辑继续执行。版本文本不得喂给模型 JSON 事件解码器。成功版本加无模型身份、错误 nonce、真实调用非零或超时，均不能得到 callable；成功版本加真实调用、正确 nonce、正确身份及既有用量条件满足时才可 callable。非白名单或弃用模型不得因为版本预检而新增执行。

4. `lib/availability.mjs` 的 checkProvider 复用同一已知 CLI 版本逻辑，保持现有 `{ state, version, detail }` 返回形状；三类失败为 unverified、version=null，detail 为上表相应类别。仅版本成功时保留真实 version，state 仍为 unverified；不能再因“auth not configured”返回 callable。已有 auth 配置和失败处理可保留，但认证成功同样不能证明模型真实可调用；无厂商专用认证扩展。未知 provider 的既有参数声明保持兼容，不为它添加已知规则或身份承诺；版本查询本身同样不能使其返回 callable。readProbeModels 继续严格读取既有证据形状，不放宽坏缓存校验。

5. 调用点核对：discover 入口文件、models probe 的核心实现和 provider 版本检查三处都在新增写域内；`lib/commands/models/probe.mjs` 已调用 probeModels，测试直接经过它及至少一组真实 bin 子进程即可证明接通，不需要修改该文件、lib/cli.mjs、lib/routes.mjs 或 lib/context.mjs。当前没有阻断这三处接线的范围外必改文件。

   已知能力缺口：`lib/adapters/call.mjs` 对部分已识别 CLI 没有模型调用参数声明，本轮只保证其 discover 版本观察，不保证这部分 CLI 的模型调用成功；保留已有 adapter_unverified/E_NO_CANDIDATE，不能新增猜测适配器。现有解释器包装器不属于可识别版本目标，继续原真实调用路径；如需识别包装器目标，须另行明确规则和写域。字符串形式的扫描 override 与模型调用已有对象形式 override 的兼容边界不在本轮修订，不自动将 discover 的同名安装绑定给模型。若实现再发现必须修改范围外文件的调用缺口，须在交接中列出路径、不可达行为及影响，不能静默换成替代子系统，也不能宣称相应验收通过。

6. `test/integration/discovery-probe.test.mjs` 采用既有 [AC-085] 标记，夹具只放 `test/fixtures/discovery/**`，不新增 traceability 分片、索引或检查器。测试需要覆盖以下可观察行为：

   - 使用真实本地假可执行文件，至少一组经 bin 先执行 discover 再执行既有 models probe，比较 stdout JSON 和 inventory.json/probes.json；PATH 只含夹具目录，Node 用 process.execPath，Windows 垫片沿用安全执行层，POSIX 用绝对 Node shebang。断言实际 argv、执行次数和时序，不允许预制完整 inventory/model 返回值绕过生产代码。
   - 11 项已知 CLI 的成功版本均来自各自夹具输出；以独立预期验证普通版本、v 前缀、预发布+构建后缀。验证三类失败、空文本、只有 stderr 版本、非法/不完整版本、非零退出却输出合法版本、扫描后目标消失，以及无执行时 version=null/evidence=[]。逐字段校验冻结 inventory，退出码和 stdout 摘要独立计算。
   - 每类版本失败通过既有 models probe 命令路径，返回并落盘 unverified 和精确 reason，不执行真实模型调用，不产生推理用量行；从已有 callable 重新探测亦降级。成功后再次失败必须清除库存旧版本；修复后重新观察并走真实调用可恢复。两个不同可执行目标互不污染，同一目标的多个允许模型仍各自做身份/nonce 验证。
   - 明确的防提升测试：版本成功而真实调用无身份、nonce 不匹配、认证失败、超时或非零退出，均不能 callable；同一版本成功且真实回答、nonce、身份及用量条件都满足，才得到 callable。版本成功但没有发起真实模型调用的 provider 检查必须为 unverified。先运行 discover 不能写出模型 callable 或推理 usage。
   - 验证未允许/弃用模型零额外执行，未知 CLI 默认零版本执行，Node 包装器不增版本调用，TTL/--full/指纹变化/去重/first_seen/gone 兼容；版本调用不做认证或网络访问，不泄漏夹具敏感哨兵。运行时状态和记录置于系统临时目录并 finally 清理，不在仓库生成临时资产。

7. 回归保留原 discovery、probe、probe-ledger 集成和全部单元测试，不削弱原断言。执行 check-no-model-table、生成资产新鲜度检查与 check-fast。生成资产增量 `f43467f` 引入的门禁必须保留：检查仅在临时目录重生成并比较，失败不能通过改写 release-gate 资产、docs/contract.md 或扩大本任务写域消除，也不能以版本夹具测试替代发布真机证据。

## 非目标

不做厂商认证协议、真实网络请求、模型目录硬编码、用量读取、新 CLI 路由或完整适配器覆盖。保持既有真实调用用量账本行为只为兼容，不将版本探测记账或扩大成本功能。不修改冻结 schema、中央索引、生成资产、发布检查表或检查器。

## 验收格式

acceptance.md 沿用 AC-085 和既有 AC-006，不另造版本号或验收编号；每个命令块独立判定退出码与 stdout，成功后才打印本 AC 的 OK。三个失败原因、生产命令返回值、落盘状态和防 callable 提升均通过行为断言判定，不靠测试标题、内部函数名或行号判断。

设计轮只运行不落盘的格式与文档一致性自检。完整 check-fast 会执行测试、生成报告且部分检查调用 git，和本轮“禁止 git、禁止创建其他文件”冲突，因此留给获准执行实现验收的阶段；本轮不运行它，也不把未执行的产品检查报为通过。
