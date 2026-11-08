# Task 018 — 调用适配器：按平台和 CLI 生成调用（只读、cwd、stdin、WSL）、事件解析、cli resolve

## 约束

本文件是验收规格，不是通过报告。同目录 attention.json 所述入口、选模接线和前置依赖尚未裁决，当前不得宣告 AC-043 或 AC-044 covered。裁决后必须补齐实现方案，所有下列必验命令才能用于最终验收；不得删去真实入口要求以规避阻断。

命令均在仓库根执行，使用 Node 20+；每条独立执行，不依赖上一条产生的状态。Node 命令返回后立即检查 $LASTEXITCODE。每条均要求退出码 0；非零、FAIL run.no_match、测试失败、应验用例跳过或测试数量为 0 均判失败。run-tests 的报告使用其现有系统临时目录默认位置，不写仓库。

brief 未给基准 commit SHA 或既有验收报告路径，因此不新增基准、版本或豁免。测试的预期取静态金标、参数采集证据与 contracts，禁止由被测函数现场生成预期。

## 建议验收方向

**AC-043：四平台调用、引用、真实命令入口。**

命令：

~~~pwsh
node scripts/run-tests.mjs --ac AC-043
~~~

期望输出：退出码 0；测试摘要 fail 为 0、pass 大于 0，末尾含 run-tests: filtered；没有 FAIL run.no_match。adapters.test.mjs 的 [AC-043] 用例必须全部执行并通过，逐项断言：

- T-016 识别规则的完整已知 CLI 集合都有四个平台的静态金标；经验证的成功调用与金标深相等，参数未验证者匹配明确拒绝金标，不能略过。至少有真实证据支持的成功适配器。
- 每个成功调用的模型参数、stdin、只读开关与采集一致；cwd 含空格和单引号分别验证。显式平台控制结果，不依赖宿主安装的软件。
- WSL 使用 --cd、--exec；发行版、目标 cwd、实际命令与各参数保持独立；任一参数都不同时含 cd 和 &&，且没有 shell -c/-lc 包装。
- pwsh 与 posix 均生成展示串；纯函数解析 posix 展示串所得命令与完整 args 向量深相等，覆盖空参数、空格、单引号、反斜杠及 shell 元字符，不执行展示串。
- 测试调用真实 main/CLI 路由，resolve 返回成功 direct_call，含具体模型参数；两种展示串来自该 direct_call。ctx.exec 调用次数为 0，没有状态写入，不用模块直接调用替代路由验证。

**AC-044：未验证参数与生产选模拒选。**

命令：

~~~pwsh
node scripts/run-tests.mjs --ac AC-044
~~~

期望输出：退出码 0；测试摘要 fail 为 0、pass 大于 0，末尾含 run-tests: filtered；没有 FAIL run.no_match。adapters-unverified.test.mjs 的 [AC-044] 用例必须全部执行并通过，逐项断言：

- 参数形态未确认的已识别 CLI 与未知 CLI 均不会得到伪造的可执行调用；buildCall 的 call 严格为 null，reason 为 adapter_unverified。
- 在其他筛选条件均满足的离线夹具中调用生产选模路径：该模型仅出现在 rejected，拒选原因为 adapter_unverified；models 和 calls 中都没有对应 handle/call。一个已验证适配器的对照模型仍能产生有效调用。
- 不将 adapter_unverified 与身份的 unverified 混同；不靠 deprecated、额度不足或 availability 拒绝来替代适配器拒选。
- 失败分支不执行 CLI、不读取凭据、不产生展示调用；日志和 JSON 没有令牌值。

**事件解析与离线安全回归。**

命令：

~~~pwsh
node --test test/unit/adapters.test.mjs test/unit/adapters-unverified.test.mjs
~~~

期望输出：退出码 0；Node 测试摘要 fail 为 0、pass 大于 0、skipped 为 0。除两条 AC 的用例外，实际执行的解析测试覆盖采集事件中的 text、usage、result、error，以及空行、未知事件、损坏 JSON；预期全部与静态事件夹具深相等。构造完整事件的样例通过 contracts/schemas/event.v1.schema.json；不得从损坏输入构造成功 result，不得从请求模型伪造返回身份。对随机运行期哨兵检查输出与错误消息，命中数为 0；fixture 中不保存真实秘密。

**真实 cli resolve 冒烟（只生成描述）。**

命令：

~~~pwsh
node bin/cliworker.mjs cli resolve --model claude:claude-sonnet-5-5 --cwd . --platform linux --readonly --config test/fixtures/adapters/resolve.config.json
~~~

期望输出：退出码 0，stdout 可整体 JSON.parse 为单个 JSON；包含成功的 direct_call，command 与 args 指向夹具的 Claude 调用和具体模型 claude-sonnet-5-5，input 为 stdin，只读参数与已采集证据一致，cwd 与请求经既定路径规则解析的目录一致；同时具有 pwsh 与 posix 两种展示串。输出不含令牌值，不产生 lease 或 usage 记录。返回 E_UNKNOWN_COMMAND、call:null、缺少配置、缺少参数证据或只调用命令模块均判失败。响应完整封装须由裁决后的 design.md 依据现有契约确定；此处不创设额外字段。

**追踪一致性。**

命令：

~~~pwsh
node scripts/check-traceability.mjs
~~~

期望输出：退出码 0，末行以 check-traceability: ok 开头，并带现有 covered、planned 计数。T-018 分片仅登记 AC-043、AC-044，milestone 为 M3，files 指向实际有对应 AC 标题的测试；两条均在上述验收通过后标 covered，baseline 未重复声明。仅此命令通过不能替代行为验收。

## 非目标

本 design 轮不执行实现验收，也不运行 scripts/check-fast.ps1：其脚本会运行全部检查及全量测试，包含 Git 调用和额外文件写入，与本轮禁止 Git、只能创建指定文件的限制冲突。下游应在其权限允许后用 pwsh -NoProfile -File scripts/check-fast.ps1 做完成前检查；预期退出码 0、末行 check-fast: ok，有失败须报告原始失败项，不能把尚未裁决的阻断称为基线豁免。
