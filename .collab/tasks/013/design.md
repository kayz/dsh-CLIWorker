---
write_scope:
  - lib/secrets/**
  - lib/commands/auth/**
  - lib/config.mjs
  - test/unit/secrets.test.mjs
  - test/integration/secrets-native.test.mjs
  - test/flows/steps/auth.mjs
  - test/traceability/T-013.json
---

# Task 013 — 用户提供令牌的密钥管理：SecretRef、OS 后端、只经 env 注入

## 目标

交付 T-013 / M2 的 AC-032、AC-033。依据本任务 brief、`.collab/blueprint/cliworker-v2/design.md`、`interfaces.md` 第 5、11、13、15、16 节和 `task-graph.json`；错误码、SecretRef 结构及测试追踪格式以现有 contracts 为准。brief 未提供基准 commit SHA 或既有验收报告路径，不借用其他任务的基线。

**存在阻塞，等待 attention.json 裁决后才能完成接入方案并进入实现。** 以下固定可从现有文件确定的要求，不授权扩大顶部 write_scope，也不把未接入的模块当作 CLI 已交付。

1. `lib/cli.mjs` 使用静态 import、ROUTES 与 resolveRoute。现有分发表没有 auth，resolveRoute 对 auth 直接返回 null；`bin/cliworker.mjs` 只调用该 main。`lib/commands/auth/**` 下新增模块不会自动注册。仅用允许路径无法使真实入口的 `auth set/status/clear` 可达。不能把路由副作用藏入 `lib/config.mjs`，也不能由测试另建入口代替真实 CLI。
2. `lib/exec.mjs` 的 runSync/runAsync 接收选项，但没有把 input 交给 spawnSync，也没有向异步 child.stdin 写入；`lib/context.mjs` 没有 stdin 字段。命令自身读取 stdin 可使用已有注入缝 `ctx.fs.readFileSync(0, 'utf8')`，无需新增上下文字段；后端若要经 stdin 接收秘密，现有 exec 则尚不支持。不能在 secrets 模块另行 import child_process 绕过 exec，也不能把秘密拼进脚本参数绕过此缺口。
3. attention.json 请求裁决：是否将 `lib/cli.mjs`、`lib/exec.mjs` 的上述最小接入改动加入实现范围，或保持范围并先由调度器交付这两个依赖。批准前不把它们写入 write_scope；批准后应先更新本设计和验收，明确最小路由及 input 透传，再开始实现。其他任务已获批的范围不代表本任务获批。

范围裁决解决后，按以下要求落地；未被权威文件定义的持久化字段、SecretRef 新形状、CLI 参数和输出 schema 均不得自行增加。

| 允许路径 | 实现要求 |
| --- | --- |
| `lib/secrets/**` | 承载 SecretRef 校验、env / keychain / session 后端、秘密解析与调用环境构造。只在调用前解析秘密；不向调用描述、JSON、argv、日志或审计暴露原值。使用现有 ctx.exec/fs/env/platform，时间只取 ctx.clock。 |
| `lib/commands/auth/**` | 沿用命令模块的 `run({argv, ctx, config})` 接入形式，提供 interfaces 第 13 节已有的 set/status/clear。set 支持 `--from-env NAME`，不加时读 stdin。错误交由共享 errorBodyFrom / exitCodeFor / writeJson 路径处理。 |
| `lib/config.mjs` | 在迁移或复制秘密配置前递归检测明文，保留现有 v1/v2 加载、示例拒载、路径及运行时兼容视图。不得在本任务重做 T-014 迁移。 |
| `test/unit/secrets.test.mjs` | AC-033 的必跑纯单测；不依赖本机密钥环或原生命令。 |
| `test/integration/secrets-native.test.mjs` | AC-032 的可重复集成测试，以及按平台门控的附加原生测试。必跑集成与可跳过的原生测试必须能分别选择。 |
| `test/flows/steps/auth.mjs` | 真实 CLI 的两种 set 输入、秘密环境注入、无泄露断言；加入既有共享 flow。 |
| `test/traceability/T-013.json` | 仅登记本任务的 AC-032、AC-033，使用已有 task / milestone / entries / ac / files / status 字段；实际覆盖后才标 covered。 |

1. SecretRef 沿用 `secrets: {kimi: {ref: 'env:KIMI_API_KEY'}}` 以及 config.v2.schema.json 已有的 ref 对象约束，不发明额外凭据字段或版本。env 从注入的 ctx.env 读取，session 只存当前进程内存，keychain 按 ctx.platform 分发到 Windows DPAPI（经 pwsh）、macOS security、Linux secret-tool。后端缺失、不可访问或执行失败返回既有 E_SECRET_BACKEND，退出码 3，retryable=false。不得在后端失败时静默降级为明文文件，也不得把 session 宣称为跨进程持久化后端。
2. 后端调用必须经 ctx.exec，保持 shell=false，秘密不得拼入命令字符串或 argv。执行器的原始 stdout/stderr/error 可能带秘密，不得直接成为 JSON、异常消息或审计内容；结合现有 lib/redact.mjs 对已解析秘密脱敏。缺失工具的错误只说明后端不可用，不回显秘密。Windows 加密产物如需落盘，只能是 DPAPI 保护后的内容；路径及引用规则须在裁决后的接入方案中明确，不能用自行增加的配置字段表达。
3. 配置扫描遍历对象与数组，键名按 `/(token|api_key|secret|password)/i` 匹配。匹配键的值是字符串且不是合法 SecretRef 对象时，抛 E_CONFIG_SECRET_INLINE，退出码 3、retryable=false；看起来像 `env:NAME` 的裸字符串也不是 ref 对象。覆盖深层、数组、不同大小写和复合键名；合法 ref 对象不误拒。错误消息不含原值或原始 JSON 片段。非字符串值的其他合法性仍按既有配置契约校验，不扩大此错误码的触发条件。
4. auth set 的输入值仅在读取、后端存储与调用环境构造期间驻留内存。两种输入都必须覆盖成功与空输入/缺失变量的失败；参数错误沿用 E_REQUEST_INVALID，后端错误用 E_SECRET_BACKEND。不接受把令牌值作为位置参数或另加 token 参数。status 的凭据状态只能是 set 或 unset；除共享 envelope、warnings 等既有机制外，不增加秘密、长度、摘要或提示字段。clear 后的 status 必须为 unset。成功与错误输出均不得包含令牌。
5. 调用环境从基础环境的副本构造，仅将解析值赋给适配器声明的 env_names；不修改 ctx.env，不把来源变量 SENTINEL 或 CW_FLOW_SENTINEL 原样带到 provider。调用描述只保留现有环境变量名，不含值。env_names 之外的变量以及 argv 中均不得出现秘密；不能为 kimi 猜测新的适配器字段。当前未有完整适配器接入，裁决后的设计必须明确真实消费点；用测试自行给 fake-cli 填入正确环境，不能证明生产注入实现正确。
6. auth flow 使用现有 harness 的实际导出契约：`name='auth'`、`introduced_by='T-013'`、`ac=['AC-032']`、`run(flow)`。interfaces 的步骤 id 语义由现有 name 承载，不另加字段。所有 CLI 子进程经 flow.run / flow.spawn，stdin 通过其既有 input 选项传递。使用 flow.root / state_dir / sentinels，不能创建第二套不受扫描的状态目录；不能修改 helpers、flow.test.mjs 或既有步骤来迁就本任务。
7. AC-032 集成用运行时生成的哨兵验证两种输入：`auth set kimi --from-env SENTINEL` 与不带该选项的 stdin。分别覆盖真实 bin 入口、成功状态、后续调用环境和清除。fake-cli 只记录 argv、变量名及值的 sha256，不记录原值；摘要与哨兵的预期摘要相等，同时断言未声明环境变量不含该秘密。调用必须经过被测生产解析/注入逻辑。平台原生工具不可用不能导致这组 baseline 集成跳过；跨进程存储隔离与替身接入方式待范围裁决后一并明确。
8. 两次 set 及调用后均用既有 leakScan 覆盖 stdout、stderr、argv、HTTP、state_dir 全深度文件及 audit，要求 ok=true、hits=[]、errors=[]；对测试写入的 config、fake-cli 记录及 flow.root 内其他文件另行扫描，不能用只扫 state_dir 掩盖泄露。临时数据只在系统临时目录，finally 清理；断言消息只含标签或位置，不用会打印秘密原值的深相等错误输出。
9. AC-033 用注入 exec 分别验证 win32 / darwin / linux 的后端命令构造和错误转换，每个平台都实际执行断言，即使宿主是 Linux。令 pwsh / security / secret-tool 分别抛出 ENOENT 或返回失败结果时均得到 E_SECRET_BACKEND；调用前后递归文件列表和已有文件内容保持相同，缺省不存在的 state_dir 仍不存在。命令构造断言应检查程序、必要参数、shell=false、秘密传输位置与 argv 无秘密，不能只检查 mock 调用次数。
10. session 单测覆盖设置、读取、清除与新实例不可见，env 单测覆盖变量存在/缺失、读取不修改环境；status 单测分别覆盖 set/unset、clear 后 unset 及后端错误不伪装 unset。原生附加测试按平台和 pwsh/security/secret-tool 可用性门控，按既有 cliworker.skip/v1 记录原因，不能用这些 skip 替代 Linux baseline 的纯单测。

## 约束

顶部 write_scope 严格等于 brief 七项。设计角色只写本目录 design.md、acceptance.md；另按用户明确的致命歧义例外写 attention.json。不修改 brief、实现/评审/状态文件或任何代码，不执行 git，不创建脚本或测试报告。

Node 20+ / ESM，零第三方运行时依赖，文本 UTF-8 无 BOM。运行时代码不得读取 .collab 或依赖开发用 contracts/spec、contracts/golden。保留现有共享错误注册表和 JSON 输出；不新增 schema、版本号、错误码、上下文字段或适配器字段。原生后端无法工作的环境必须明确失败，不能将明文存储或全量跳过包装成通过。

## 建议验收方向

acceptance.md 按现有 AC-032 / AC-033 标识写独立命令及输出要求。AC-032 baseline 为 darwin/linux/win32 的 integration，AC-033 baseline 为 linux 的 unit；原生后端仅附加验证。正式 run-tests 只发现 .test.mjs，因此必须由允许的 integration 测试文件实际调用 auth flow，不能只在步骤文件写 AC 标记。

范围问题解决后，下游应先补齐本文件注明的接入与隔离细节，再实现和执行验收，不能把当前文档作为已可通过的交付。每条验收从仓库根或系统临时目录独立运行；使用绝对路径，不依赖上次报告或本机真实账号。brief 没有给验收报告路径，正式 runner 的报告使用自身默认系统临时目录。

完成前执行项目已有 `pwsh -NoProfile -File C:/git/dsh-CLIWorker/.collab/worktrees/013/scripts/check-fast.ps1`，退出码 0 且输出 `check-fast: ok`；它属于下游实现完成检查。当前 design 角色不执行：其检查链包含 git 和报告写入，与本轮禁止执行 git、创建其他文件的限制冲突。不声称实现测试或 check-fast 已通过。

## 非目标

不实现其他任务的适配器、run/lease、HTTP 管理入口或配置迁移，不修改范围外的 CLI、exec、context、helpers、contracts 和脚本。上述范围外接入需求必须经 attention 裁决解决；不能增加范围外路径后宣称符合 brief，不能以直接调用命令模块代替真实 CLI 验收。
