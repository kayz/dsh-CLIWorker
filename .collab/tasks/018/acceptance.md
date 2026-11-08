# Task 018 — 调用适配器：按平台和 CLI 生成调用（只读、cwd、stdin、WSL）、事件解析、cli resolve

## 约束

本文件是暂停期间保留的验收要求，不是通过报告。用户已明确裁决暂停 T-018、保持 write_scope 不变，仅在 T-016 落地后恢复；当前不执行下列实现验收，不得宣告 AC-043 或 AC-044 covered，也不再等待同一问题的裁决或新建 attention.json。

恢复设计时必须引用 T-016 实际发现产物、脱敏参数采集与验收证据，并核对真实 resolve/select 接线已由获授权任务交付。T-016 落地只允许恢复设计复核；接线未交付仍阻断实现。随后依据实际契约补齐设计和真实入口的具体冒烟命令，才能进入实现与最终验收。不得删去真实入口或生产选模要求，不得发明接口或把缺失依赖视作通过。

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

**真实 cli resolve 冒烟（暂停，恢复设计时补齐）。**

brief 给定的入口为 bin/cliworker.mjs cli resolve，包含 --model、--cwd、--platform、--config；只读场景另带蓝图已有 --readonly。T-016 尚未落地，不能确认成功模型、调用参数或离线配置，不保留此前凭接口示例指定的成功样例，也不提供带占位符而无法独立判定的验收命令。本项保持未完成，不能据此验收通过。

恢复设计时必须在本项补入一条使用实际模型与实际夹具路径、可从仓库根独立执行的完整命令，并写明对应 T-016 证据路径与具体响应断言。期望输出必须包括：退出码 0，stdout 可整体 JSON.parse 为单个 JSON；成功 direct_call 的 command、args、具体模型、stdin、只读参数及 cwd 与实际证据和夹具一致；包含 pwsh 与 posix 两种展示串。输出不含令牌值，不产生 lease 或 usage 记录。E_UNKNOWN_COMMAND、call:null、缺少配置、缺少参数证据或只调用命令模块均判失败。响应封装只引用实际契约，不创设字段；未补齐此命令前不得进入最终验收。

**追踪一致性。**

命令：

~~~pwsh
node scripts/check-traceability.mjs
~~~

期望输出：退出码 0，末行以 check-traceability: ok 开头，并带现有 covered、planned 计数。T-018 分片仅登记 AC-043、AC-044，milestone 为 M3，files 指向实际有对应 AC 标题的测试；两条均在上述验收通过后标 covered，baseline 未重复声明。仅此命令通过不能替代行为验收。

## 非目标

本 design 轮不执行实现验收，也不运行 scripts/check-fast.ps1：其脚本会运行全部检查及全量测试，包含 Git 调用和额外文件写入，与本轮禁止 Git、只能创建指定文件的限制冲突。下游应在恢复设计、依赖补齐且其权限允许后执行完成前检查。

命令：

~~~pwsh
pwsh -NoProfile -File scripts/check-fast.ps1
~~~

期望输出：退出码 0、末行 check-fast: ok。非零退出码或任一 FAILED 均判失败；须报告原始失败项，不能把已裁决暂停但尚未补齐的依赖称为基线豁免。当前未执行此命令，也没有全量检查通过结论。
