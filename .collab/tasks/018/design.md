---
write_scope:
  - lib/adapters/**
  - lib/commands/cli/**
  - test/unit/adapters.test.mjs
  - test/unit/adapters-unverified.test.mjs
  - test/fixtures/adapters/**
  - test/traceability/T-018.json
---

# Task 018 — 调用适配器：按平台和 CLI 生成调用（只读、cwd、stdin、WSL）、事件解析、cli resolve

## 目标

交付范围和验收归属沿用 brief 与任务图 T-018（M3），只覆盖 AC-043、AC-044，测试层级为 unit。权威依据为蓝图 design.md、interfaces.md、task-graph.json；具体输出字段、错误码与事件结构复用仓库 contracts，不增加 schema、版本号或公开字段。

**本设计尚有阻断，不能据此开始实现或宣告验收完成。** 已生成同目录 attention.json。以下写域保持 brief 原值，未自行扩权；已确定的行为要求和验收门槛可保留，涉及入口与选模接线的实现步骤须在裁决后补齐。

当前文件提供的证据：

- lib/cli.mjs 的 ROUTES 静态导入命令；resolveRoute 明确拒绝 cli 命令词。新增 lib/commands/cli/ 下的模块不会自动注册。lib/cli.mjs 与 bin/cliworker.mjs 均不在本任务写域。
- lib/select.mjs 的 cliCall 内联拼装调用，selectModels 没有注入适配器的接口，也没有 adapter_unverified 分支。只新增 lib/adapters/ 无法改变现有选模结果。lib/select.mjs 不在本任务写域。
- T-016 是 T-018 的显式前置任务，但当前没有 lib/discovery/，也没有 .collab/tasks/016/design.md。不能从旧 select.mjs 推导完整的 11 个已知 CLI、已验证参数和只读能力。其 cursor-wsl 的 shell 拼接尤其不能作为新金标。
- .collab/tasks/008/design.md 明确保持静态 ROUTES；任务图 T-022 后续才接管 lib/select.mjs。现有文件没有授权 T-018 修改这些文件，亦没有可供 T-018 使用的动态注册缝。

需要裁决的是：补齐前置任务及写域外接线后再继续，还是经正式任务调整允许 T-018 修改入口和选模。默认保持原写域并暂停，不把真实入口验收换成仅直接调用命令模块，不把自制选模函数当成生产选模。裁决前不固定缺失的 CLI 参数表、展示串封装字段或新增接口签名。

## 约束

1. **交付与依赖。** lib/adapters/** 承担 buildCall、parseEvent 及展示串引用；lib/commands/cli/** 承担 cli resolve 命令处理。使用 Node 20+ / ESM，无第三方运行时依赖。前置 T-016 的识别规则和脱敏 --help 采集交付后，逐项引用实际证据建立适配器表；参数、stdin 或只读开关证据不足的 CLI 走 adapter_unverified，不能因为名称已识别就声称参数已验证。若没有任何可验证的成功调用，不得把全部拒绝当作 AC-043 通过。

2. **调用结构。** 复用 interfaces.md 中 direct_call 的 command、args、cwd、input、env_names；模型 id 来自已解析模型，不把整个 model key 直接当作 CLI 模型参数。buildCall 只构造描述，不启动 CLI、不联网、不探测登录、不读密钥。input 为 stdin，提示内容不拼入参数或展示串。env_names 只列名称，不返回环境变量值。失败使用既有 call:null 与 reason:adapter_unverified，不伪造空 args 的成功调用；只读能力不足用既有 readonly_unavailable 原因，与参数未验证区分。

3. **平台与只读。** 显式平台覆盖宿主平台；单测用注入值覆盖 win32、darwin、linux、wsl:Ubuntu，不要求安装各 CLI 或 WSL。原生调用保持 command 与 args 分离，cwd 单独传递；采用目标平台路径规则，不能用宿主路径行为生成跨平台预期。只读要求落实为经证据确认的 CLI 开关；不允许把配置中的 readonly:true 当成开关已生效，也不允许使用强制写入或绕过权限的参数。没有只读要求时也不自行增加权限提升参数。

4. **WSL。** 在宿主通过 wsl.exe 的参数向量选择发行版，以 --cd 传入目标目录、以 --exec 传入实际 CLI 及逐项参数。目录与模型均保持独立参数，不经过 bash -lc、sh -c 或 cd … && …。不能对参数预先加 shell 引号。含空格、单引号的目录必须原样到达 --cd 后的单个参数。目标 Linux cwd 与宿主进程 cwd 不混用；由前置任务的实际路径映射接口确定两者，未有映射证据时不猜测 Windows 盘符转换。

5. **展示串。** pwsh 和 posix 两种展示串均从同一成功 direct_call 生成，仅供展示。实现前先核对前置任务是否已提供引用函数；若无则在本任务写域内提供纯函数，禁止改动 lib/exec.mjs。posix 单引号按 shell 字面量规则转义；pwsh 使用调用运算符和单引号字面量，并将内部单引号加倍。测试必须用独立纯解析函数还原 posix 展示串，断言命令和完整 args 向量一致，不能只比较字符串。解析器不执行 shell，不做变量替换或命令替换。展示串不承载 stdin 内容或凭据。

6. **事件解析。** parseEvent 只把有采集证据的 CLI 输出映射为 event.v1.schema.json 已定义的 text、usage、result、error 内容；构造完整事件时必须通过现有事件 schema。seq、lease_id、at 等执行期信息由调用方提供，不在解析器内读取全局时间或捏造租约。未知记录、空行和损坏 JSON 不产生成功 result，也不从请求参数补出 reported_model。凭据、认证头、完整原始对象和未知字段不能透传。错误映射限于注册表已有 E_PROVIDER_AUTH、E_PROVIDER_QUOTA、E_PROVIDER_FAILED 等既定触发语义；执行超时和退出结算留给 T-023。最终身份分档和 session 协议分别由对应任务负责。

7. **cli resolve。** 命令模块遵守现有 run({argv,ctx,config}) 约定，解析蓝图已有 --model、--cwd、--platform、--readonly，复用配置加载及既有错误输出工具。它解析指定模型并调用同一 buildCall，返回含具体模型参数的 direct_call 以及两种展示串，禁止以展示串再构造可执行调用。只解析描述，不申请租约、不执行模型、不写状态。缺失模型、平台非法及参数缺值的错误沿用注册表与配置约定；未验证情况保持 call:null 和 adapter_unverified，不新增专属错误码。成功响应的完整封装须在缺失依赖与接线裁决补齐后，依据现有契约确定，不在此发明字段。

8. **真实集成。** AC-043 必须经 bin/cliworker.mjs cli resolve 验证路由；AC-044 必须经生产选模路径验证拒选。接线应在任何 handle/call 生成前检查适配器结果，失败模型仅进入 rejected。夹具须把等级、可用性、身份、只读及额度等其他过滤条件设为通过，以免被其他原因提前拒绝而掩盖缺陷。至少包含一个可调用对照模型，证明 models/calls 不是因全局失败而为空。不能通过 import 副作用、修改全局对象、测试中重写生产函数、第二套选模实现或自执行命令模块绕过写域冲突。

9. **夹具。** test/fixtures/adapters/golden/** 存逐 CLI、逐平台的独立静态调用预期；不在测试运行时调用 buildCall 生成预期。覆盖带空格与单引号的 cwd、stdin、模型参数、只读开关及拒绝分支。同一 fixtures 根目录存脱敏参数证据、事件输入与预期和 resolve 的离线配置。配置复用 config/v2 与仓库已有模型样例；不依赖个人配置或真实凭据。resolve 验收配置固定为 test/fixtures/adapters/resolve.config.json，成功样例模型沿用接口示例 claude:claude-sonnet-5-5；该成功样例必须先有参数证据，缺证据时保持阻断，不能伪造验证结论。

10. **追踪。** test/unit/adapters.test.mjs 的相关测试标题含 [AC-043]；test/unit/adapters-unverified.test.mjs 的相关标题含 [AC-044]。test/traceability/T-018.json 使用 interfaces.md 已定义的 task、milestone、entries 格式，只列本任务这两条 AC 及实际测试文件；全部对应验收通过才标 covered。baseline 只读取 contracts/spec/ac-index.json，不在分片重定义。

## 建议验收方向

执行顺序为：完成阻断裁决并修订本设计 → 前置规则与采集可用 → 实现纯适配器及独立金标 → 事件解析与命令模块 → 经授权责任方完成入口与生产选模接线 → 分别执行 acceptance.md 中各命令。AC-043 与 AC-044 都必须通过；没有测试匹配、跳过、缺少前置或仅模块级调用都不算完成。

详细命令和期望见同目录 acceptance.md。brief 没有提供本任务基准 commit SHA 或既有验收报告路径，不借用其他任务的基准，不制造对比报告。这里的要求是设计验收门槛，并非已执行通过的报告。

## 非目标

不改 brief、impl、review、verdict、state 或 run 文件，不执行 Git，不写代码或测试，不创建临时脚本。本轮只写 design.md、acceptance.md，以及用户明确允许在致命歧义时生成的 attention.json。

实现角色仍只受 YAML 原写域授权；不得因本文件解释了接线要求就扩权。发现、真实探测、模型目录、额度策略、租约、runner、身份分档、会话及秘密注入由各自任务负责。运行时代码、测试和随包文档不得引用 .collab；规格来源只在本调度文档中记载。
