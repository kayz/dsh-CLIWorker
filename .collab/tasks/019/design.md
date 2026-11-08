---
write_scope:
  - lib/catalog.mjs
  - lib/commands/models/list.mjs
  - lib/commands/models/allow.mjs
  - lib/commands/models/deny.mjs
  - lib/commands/models/level.mjs
  - lib/commands/models/alias.mjs
  - test/unit/catalog.test.mjs
  - test/unit/catalog-levels.test.mjs
  - test/traceability/T-019.json
---

# Task 019 — 模型目录：白名单、四档等级与来源、别名、弃用、能力、价格

## 目标

实现 T-019 / M3 的 AC-045、AC-046。依据 brief.md、蓝图 design.md 中的模型目录约定、interfaces.md 第 5、10、11、13、15、16 节和 task-graph.json 的 T-019。以仓库内 contracts/schemas/model.v1.schema.json、config.v2.schema.json、contracts/registry.snapshot.json、contracts/spec/ac-index.json 为只读契约；不新增协议字段、schema 版本、可用性枚举或错误码。brief 未指定基准 commit SHA 或既有验收报告路径。

1. lib/catalog.mjs 负责把 T-017 的归一模型记录与 config.catalog 合成为目录，并提供同一套白名单、别名、等级和弃用判断。保留 key、id、cli、provider、vendor、aliases、allowed、level、level_source、availability、identity、capabilities、prices、source、deprecated 的既有语义。配置来源是 catalog，不从 loadConfig 为旧选择器生成的不可枚举 config.models 反推白名单，也不沿用旧选择器对缺等级模型默认分档的行为。
2. 目录计算与文件读写分开。纯计算显式接收归一记录和配置，不能枚举 CLI、读取认证、调用 exec/fetch、运行 forecast 或记账。暴露 listModels(config, {models, ctx})、resolveModel(models, key)、filterAllowed(models)、selectModels(models)，其中 models 是目录记录数组；listModels 的 models 输入是上游归一记录。以上函数名仅为模块接口，不定义新 JSON 协议。listModels 返回按 key 排序、去重的完整 model/v1 数组；resolveModel 接受规范 key 或唯一别名，返回同一规范模型，未知返回 null；filterAllowed 只返回 allowed=true 的记录；selectModels 返回既有 models / rejected 结构，供下游选模编排消费。内部 rejected 使用既有 key / reason，AgentLine 的不透明 ref 投影由 T-022 负责。
3. 原始模型记录、配置和嵌套证据不可被原地修改。先依 T-017 的实际公开接口获得归一记录，合并 catalog.manual，再建立规范 key 索引与别名索引；同一模型只产生一个 key。不能从模型 id 猜测 CLI，不跨 CLI 合并同名 id，不内置厂商模型表。模型本身的 allowed 值不构成授权，目录 allowed 只由显式 catalog.allow 决定；空白名单表示全部不允许。

## 约束

实现只写 front matter 中九个路径。本 design 角色只创建同目录 design.md、acceptance.md，不执行 git、不创建脚本或报告、不修改任何代码。Node 20+ / ESM、零第三方运行时依赖，文本 UTF-8 无 BOM。文件、环境、随机数与时间通过 ctx；当前时间只用 ctx.clock。运行时代码和测试不能引用 .collab，不能导入 contracts/spec 或 golden 作为运行时依赖。令牌与密钥不得进入仓库、日志、JSON、错误文本；管理命令不回显整份配置、SecretRef 内容或原始非法参数。

当前工作树已有 T-014 的 config/v2 迁移和 lib/routes.mjs 动态命令发现，但尚无 lib/models/**，T-017 目前只有 brief。实现时只适配 T-017 最终交付的真实公开接口及缓存位置，不自行发明缓存文件名或存储格式，不修改上游文件。单测使用内联归一记录和注入文件系统，不依赖真实 CLI。若实际命令所需上游尚未交付，应如实记录依赖未就绪，不能把导入失败、读取失败吞成空目录并声称完整接入通过。本任务不要求提前实现 T-020 的真实探测、T-021 的预测命令或 T-022 的全量选择器。

1. 白名单在产生任何候选、rejected、探测队列或 forecast 输入之前执行。filterAllowed 必须为这些消费方提供共同入口；selectModels 必须自己调用该入口，不能要求调用方自觉预过滤。未允许模型即使 callable、有等级、价格低或有别名，也不得进入选择用的 rejected。对后续探测和预测的单元验证用实际 filterAllowed 结果驱动注入回调，记录被调用的模型 key；不能先调用再隐藏输出。允许且合格的对照模型必须确实到达回调，以排除整个管线未运行造成的假零计数。
2. 管理列表保留所有已知模型，包括未允许、未分档和弃用模型。listModels 返回的核心记录保留真实 availability 状态、时间与证据。仅在 models list 的管理输出副本上，对 allowed=false 的记录将既有 availability.reason 标为 not_allowed，availability.state 仍取冻结枚举；禁止把 not_allowed 当作 state 或向 model/v1 添加顶层 reason。该副本不能再用作选择输入。保留当前 cliworker.models/v1 外壳及 models 字段，不新增目录 envelope。--all 保持可接受，但缺省管理列表也不得隐藏未允许或弃用模型；list 全程只读缓存与配置，移除旧 list 对 providerStatus 的依赖。
3. catalog.allow 保存规范 key 的集合语义。读取时已存在的唯一别名可以解析为 key，解析本身不会授予权限；写入时 allow / deny 使用规范 key，重复 allow 不增加重复项，重复 deny 不报错。未知目标不能创建虚构模型。deny 不删除模型、等级、别名、价格、来源或历史证据。后续重新读取目录必须反映允许状态变化。
4. 等级只取 Top / High / Middle / Quick，输入大小写不敏感，输出使用标准大小写。catalog.levels 沿用 T-014 已使用的 key 到等级字符串映射，不向配置添加新结构。对同一 key 先取有效显式配置等级，否则取 kind=measured 的记录等级，否则取 kind=cli 的记录等级。其他元数据合并沿用上游归一规则；不得拿整个记录的覆盖次序替代等级来源优先级。同优先级有多条等级证据时按有效 level_source.at 较新者取值，相同时间且等级冲突视为 E_CONFIG，不能依赖数组顺序随机选择。
5. 有等级时 level_source 必须完整包含 kind、ref、at。measured / cli 保留所选证据的 ref 和 at，不在列表读取时改写成当前时间；不能仅改 kind 而保留另一来源的引用。显式配置的 ref 指向实际配置及 catalog.levels 的该 key；有匹配的配置 level_source 时保留它，否则以配置文件修改时间作为 at，无文件元数据的注入调用使用本次配置解析时的 ctx.clock.nowIso()。时间转换只能使用显式时间参数。配置等级非法用 E_CONFIG，管理命令的非法等级用 E_LEVEL_UNKNOWN，缺少等级用 E_LEVEL_REQUIRED；不能静默降到低优先级以掩盖非法配置。
6. 没有任何有效等级证据时 level=null、level_source=null，不默认 Quick，也不根据模型名、价格、上下文长度、历史 tier 推断。白名单中未弃用且缺等级的模型由 selectModels 以 level_unassigned 拒选。显式配置覆盖存在时，下层 measured / cli 变化不能改变结果；移除配置覆盖后恢复 measured，再移除 measured 后恢复 cli。
7. catalog.aliases 沿用别名到规范 key 的字符串映射，归一记录 aliases 中的名称也参与解析。别名必须直接指向已知规范 key；不引入别名链。不允许循环、自指、覆盖另一模型规范 key、同一别名指向不同模型、空别名或未知目标。配置中的冲突用 E_CONFIG，alias 命令中的冲突用 E_REQUEST_INVALID，错误不得更改配置。相同别名指向相同 key 幂等。allow、deny、level 经别名操作与经规范 key 操作得到同一模型；别名本身不会作为另一条候选或独立探测对象。
8. catalog.deprecated 沿用 key 到布尔值的映射，模型 deprecated=true 或配置为 true 即判定弃用；配置 false 不复活上游已弃用模型。将目录记录 deprecated=true、availability.state=deprecated、availability.reason=deprecated，保留已有证据、时间和 TTL，不凭空生成探测证据。selectModels 的次序是白名单、弃用、缺等级；同时弃用且缺等级的白名单模型以 deprecated 拒选。未允许的弃用模型仍不出现在选择 rejected。allow 或 level 不能复活弃用模型。
9. capabilities 的 context_tokens / readonly / stdin 和 prices 的 input_per_mtok / output_per_mtok / source 按 model/v1 保留，不套厂商默认值、不换算币种、不把缺价格或缺能力补成免费、零上下文或已支持。有效归一记录必须满足既有 schema；缺失、负数、NaN、Infinity 或类型错误不能伪装为合规 model/v1。缺失元数据的处理沿用 T-017 的真实归一结果或明确失败，不在本任务扩展 schema 的 null 范围。零价格、false 能力等有效值必须原样保留。选中等级来源不得覆盖模型枚举 source，两者分别表示等级和模型记录的来源。
10. 五个命令模块沿用 run({argv, ctx, config})。list 导出 route={cmd:'models',sub:null}：现有 lib/cli.mjs 已把显式 list 归一为 null；其余模块分别导出 models / allow、deny、level、alias 的 route，利用动态发现接入，不修改 lib/cli.mjs。管理语法采用 models allow <key-or-alias>、models deny <key-or-alias>、models level <key-or-alias> <level>、models alias <alias> <key>，均接受现有 --config <path>。缺参、多余位置参数、未知选项或未知目标用 E_REQUEST_INVALID；level 缺等级及非法等级按前述等级码。四个写命令成功只返回既有 {ok:true}，stdout 单 JSON，失败使用现有共享错误体和退出码，不打印配置正文。
11. 写操作重新读取 config._file 对应的原始配置，仅修改目标 catalog 子项，避免把不可枚举 _file / _home / warnings、旧 models / providers / quotas 或临时目录记录序列化。本任务的管理写入要求原生 config/v2；若文件是 v1 或无 schema，返回 E_CONFIG，沿用已有 config migrate 先显式迁移，不在管理命令中隐式重写 v1。沿用 lib/lock.mjs 的 withLock、lockFilePath 和 lib/store.mjs 的 atomicWriteJson；锁住同一配置对应的状态范围，在锁内重新读取、校验并修改，保留其他配置字段。锁失败、配置校验失败或原子写失败不得报告成功，原文件不受损；非法参数先验证，不能留下配置写入。测试经 fakeFs 观察文件变更，不能写测试夹具或真实用户配置。
12. test/unit/catalog.test.mjs 负责 AC-045 及管理命令、动态路由接入和只读列表；test/unit/catalog-levels.test.mjs 负责 AC-046 的等级、来源、别名、弃用、能力和价格。测试名分别包含真实 [AC-045]、[AC-046] 标记，不使用 skip、todo、only。夹具在两个获准测试文件内构造，期望值手工给出，不能由被测函数生成。除纯函数测试外，在单测层直接使用现有 main 和注入 ctx 验证五条真实 CLI 分发路径；不能只断言 route 对象存在。
13. test/traceability/T-019.json 沿用既有格式：task=T-019、milestone=M3、entries 恰为 AC-045 和 AC-046，前者 files=[test/unit/catalog.test.mjs]，后者 files=[test/unit/catalog-levels.test.mjs]，实际覆盖后 status=covered。不声明 baseline，不登记其他任务 AC，不改 ac-index。

## 建议验收方向

acceptance.md 中各命令均在仓库根通过 PowerShell 7 执行，每条自带判定所需的完整输入，不依赖前一次命令的临时文件。正式 --ac 命令应真实执行对应测试文件；同时要求至少一例测试且 fail、cancelled、skipped、todo 均为零。缺文件、无匹配、跳过或空跑不算通过。追踪检查独立核对本任务分片及实际标题，check-fast 作为现有完成检查执行。

设计阶段不执行 run-tests 或 check-fast：运行器会生成清单，check-fast 链还包含可能执行 git 的检查，与本角色禁止创建其他文件和执行 git 的权限冲突。仅检查这两份设计产物的内容、路径和 UTF-8 编码。下游实现角色按自身授权执行 acceptance.md，不得将这里列出的期望描述成已通过的结果。

## 非目标

不修改 brief.md、impl.md、review*.md、verdict*.json、state.json、run.json 或任何代码，不创建其他文件。不实现真实模型枚举、真实探测、用量账本、预测公式、最终选模排序、租约、HTTP 或管理界面；后续任务必须消费本目录的白名单入口，但它们的完整链路验收归各自属主。四档指模型能力等级，不扩展身份证据等级或会话协议。
