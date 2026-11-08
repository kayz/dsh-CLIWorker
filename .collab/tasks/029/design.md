---
write_scope:
  - scripts/smoke-real.mjs
  - test/smoke/**
  - docs/release-checklist.md
  - test/traceability/T-029.json
---

# Task 029 — 发布前冒烟：smoke-real（步骤带 ac 映射，含 wsl-discover；real 模式由维护者真机运行，dry-run 在 CI 运行）

## 目标

交付 brief 指定的冒烟脚本、两份测试、发布检查清单及 T-029 追踪分片。本阶段仅创建本目录 design.md、acceptance.md；front matter 是下游实现的写入范围。brief 未提供基准 commit sha 或既有验收报告，使用当前工作树的只读规格，不借用其他任务基准。

报告格式以 `.collab/blueprint/cliworker-v2/interfaces.md` 中【15 测试设施格式】为准；baseline 以 `contracts/spec/ac-index.json` 为准；错误退出码以 `contracts/registry.snapshot.json` 为准。不得为冒烟新增产品命令、配置字段、报告版本或字段。当前 `contracts/schemas` 没有 smoke schema，且禁止修改 contracts；在允许的 `test/smoke/**` 内保存该既有格式的校验定义，复用 `lib/contract/validate.mjs` 校验器，脚本与测试共同使用。不能用仅检查 schema 字符串代替结构校验，也不能要求下游补写 contracts 文件。

**scripts/smoke-real.mjs**

直接入口是 `node scripts/smoke-real.mjs --dry-run`；省略 `--dry-run` 即 real，`--out <报告文件>` 沿用任务图已有参数。stdout 仅输出一份 JSON 报告；提供 --out 时将同一报告以 UTF-8 无 BOM 写入该文件，供维护者保留与 T-030 消费，不默认在仓库写报告。诊断放 stderr，全部脱敏。未知参数、缺失 --out 值等请求错误使用已有错误码，不擅自增加参数或错误码。

real 首先检查 `CLIWORKER_SMOKE === '1'`，未开启时不启动 WSL、provider、夹具或创建状态目录，按既有错误 envelope 返回 `E_SMOKE_DISABLED`，退出码取注册表（当前为 9）。开启后必须验证真实运行平台为 win32、WSL 命令可成功执行且存在至少一个发行版；缺平台、缺 WSL、空列表、枚举失败或超时均不可形成成功 real 报告。CI 和默认 node:test 运行只执行 dry-run。不能通过注入 platform、模拟 WSL 输出或复用 dry-run 文件获得 real 证据。

严格按 discover、wsl-discover、enumerate、probe、select、run、http-select 七步顺序执行，每步恰有一个报告条目。七步均 mandatory；wsl-discover 的 ac 严格为 `['AC-038']`，其余步骤的 ac 为 `['AC-069']`。AC-069 的完整结论由整个 dry-run 报告七步全 pass 和扫描成功共同判定，不能只看映射到 AC-069 的六步。既有 flow 步骤自己的 ac 不改写、不拿来扩大本任务的覆盖声明。

报告只包含既定顶层字段 `schema, mode, version, platform, node, steps, redacted`：schema 为 `cliworker.smoke/v1`，mode 只能 real 或 dry-run，version 每次从 package.json 读取，platform/node 是实际宿主值，redacted 为 true。steps 的每项只含既定字段 `id, ac, mandatory, status, reason, duration_ms`。status 只取 pass/fail/skip，duration_ms 为非负有限数；pass 的 reason 为 null，fail/skip 的 reason 为非空脱敏字符串。结构校验再叠加七步集合、顺序、映射、mandatory 与当前版本的语义校验。禁止添加 inventory、distros、leak、baseline、ok 等报告字段。

退出 0 的充分必要条件：七步全部真实完成且 pass、扫描零命中无错误、报告结构与语义校验通过、请求的报告文件写入成功、清理成功。任一步失败、异常、超时、skip 或扫描失败均非 0，不以 finally 或输出报告覆盖失败退出码。失败尽量保留七步条目；不能执行的后续步骤写 skip 和依赖失败 reason，不能标 pass。扫描命中时使有关步骤 fail，reason 只说明表面和脱敏类别，不能回显命中值；不增加第八个扫描步骤。内部故障使用既有 E_INTERNAL，不新增错误码。

dry-run 使用 `test/helpers/fake-cli.mjs` 与既有 runtime，在仓库外临时目录生成 CLI、配置、state_dir、HOME 与调用记录。PATH 使用独立夹具目录及必需的 Node/系统工具目录，不透传用户 provider 配置与登录凭据。Windows 夹具 shim 沿用现有 helper，不依赖全局 CLI。所有状态和配置都显式指向本次临时根；正常、失败、超时均清理子进程、宿主实例和临时目录。用户指定的 --out 是唯一保留的产物。

可复用只读的 `test/helpers/flow.mjs` 和 `test/flows/steps/{enumerate,probe,select,run,http-select}.mjs`，调用其现有 run(flow) 接口；当前实现有 name/id 差异，以实际导出为准，不改这些文件。不要对整个 flow 自动发现结果直接运行：它还含本任务不要求的 auth、doctor、http-admin，且当前没有 discover 步骤。冒烟 discover 与 wsl-discover 在允许范围内编排。现有 helper 会继承部分环境，编排层必须进一步隔离；现有步骤可能各自准备并恢复夹具，不能谎称七步共享同一模型/lease。

discover 实际调用既有 discover 并校验 inventory；dry-run 必须找到生成的 fake CLI，不能空库存即通过。enumerate 校验既有模型目录非空及夹具模型；probe 检查 nonce 证据与 callable；select 检查 v1 响应非空 models/calls、数量匹配和可执行调用；run 通过既有 wrapper/lease 发送极小固定 stdin，逐行校验 event/v1、终结 result 成功及无 error；http-select 复用真实插件路由与 host stub，检查 HTTP 200 和非空 v1 selection。fake-cli 调用记录必须证明实际执行，不能用常量响应代替上述链路。

real 的 WSL 枚举必须真实；其余会调用 provider 的 probe/run 等链路仍使用上述本地 fake CLI，以符合“不做真 provider 花费型调用”。清单须明确这个边界：real 报告证明真机 WSL 枚举和本地契约链路，不声明真实账号或云 provider 可用。discover 的本机扫描可读取真实已安装 CLI 的版本信息，不对未知程序执行探测、不调用真实模型。

**wsl-discover**

消费 `lib/commands/discover.mjs` 和 `lib/discovery/wsl.mjs` 的现有实现。dry-run 通过 context 注入执行夹具模拟 win32/WSL，输入覆盖 UTF-16LE（含/不含 BOM）、CRLF、NUL、重复项与带空格发行版名；执行既有 discover，断言 host.wsl_distros 的集合正确。夹具不能改变报告顶层 platform；dry-run 永远保持 mode dry-run，即使该步 pass 也不能计入 real-smoke。

当前原生 discover 只把发行版清单写入 host.wsl_distros，并不会在 Windows 侧自动生成各发行版的 CLI entries。实现不得凭这个列表合成成功 entries。real 先独立执行真实 `wsl.exe -l -q`，按既有 parseDistros 规范解析，并与 Windows discover 实际得到的 host.wsl_distros 作集合比较。再逐发行版通过 WSL 启动仓库已有 discover（只读访问同一份 CLIWorker 源码），在该发行版内真实发现 CLI；检查其 inventory.host.platform 及每个相关 entry.platform 为 `wsl:<发行版名>`，每个发行版至少一条有效发现条目。该循环只是编排既有命令，不复制或修改 WSL 发现算法。

维护者须准备各发行版可用的 Node 20+、可发现的 CLI，以及 Windows 临时根和仓库的 WSL 可访问路径。通过真实 wslpath 转换路径、argv 数组传参，不拼接发行版名、提示或路径到 shell 命令。发行版内临时配置/state 放本次可访问临时根；不写用户 home，不安装软件。发行版无 Node、无可发现 CLI、源文件不可访问或枚举失败均给 fail reason，不能跳过空发行版或伪造 wsl:<d> 条目。测试覆盖路径/发行版名含空格，真实枚举返回集合改变时失败并要求重跑。详细 inventory 只用于内存断言与 leak-scan，不扩展 smoke 报告；报告的 pass 是完成上述比较的结论。

子进程及每步均有有限超时；WSL 每次调用也须有超时。HTTP 使用 ready/请求完成信号，重试有次数上限；不得墙钟 sleep。终止时等待进程关闭并回收资源，不能仅 Promise.race 留下后台进程。

全程使用同一组随机 sentinel，通过 env 注入，令牌不进 argv。复用 `test/helpers/leak-scan.mjs` 扫描捕获的 stdout、stderr、argv、HTTP、state_dir 与 audit，以及最终报告和对外诊断。扫描在清理前完成；hits 和 errors 均必须为空，stdout/stderr、argv、HTTP、状态等应有实际采集量，不能扫描空输入通过。夹具定义/输入本身不作为输出扫描，fake-cli 调用记录要纳入扫描。测试另对用户名、临时根、仓库根等已知敏感值断言不出现在报告/诊断，不能仅凭 redacted:true 断言已脱敏。WSL 原始输出只在内存或隔离临时根使用；不把发行版名、原始库存或命令回显直接写报告。

**测试与追溯**

`test/smoke/smoke-dry-run.test.mjs` 标注 [AC-069]，实际执行脚本默认输出与 --out 输出、连续运行及含空格临时根；验证七步顺序、ac、mode、版本、结构、全部 pass、实际 fake 调用、扫描覆盖和清理。以失败样本证明：缺/错字段、错版本、空/重复/乱序步骤、空 ac、错映射、非法 status、负 duration、缺 reason、mandatory skip、执行失败/超时、扫描 canary、写报告失败均不能成功。扫描自测逐表面覆盖 stdout/stderr、argv、HTTP、state、audit、报告，并检查 raw/UTF-16LE/base64/hex 形式；诊断不能泄漏注入值。未设置或设置成非 1 的开关均拒绝 real，且拒绝发生在外部执行之前。

`test/smoke/wsl-discover.test.mjs` 标注 [AC-038]，默认只验证上述 WSL 夹具和报告条目，及 dry-run 不成为 real 的事实；绝不输出真机验收通过声明。真实分支仅在 CLIWORKER_SMOKE=1 且实际 win32 时执行，真实调用 WSL 与上述逐发行版 discover 并独立比较观测结果；前提不满足时在显式真实验收中失败，不能 skip 后输出 AC-038 OK。内部编排可导出供测试复用，不能新增产品入口、测试专用 CLI 参数或报告字段。两份测试在 CI 中无需真实账号、CLI 安装或 WSL。

`test/traceability/T-029.json` 沿用 task/milestone/entries/ac/files/status 既有结构：task T-029、milestone M5，AC-038 指向 wsl-discover.test.mjs，AC-069 指向 smoke-dry-run.test.mjs，均 covered。不声明 baseline，不改其他任务分片。covered 表示测试覆盖登记，不能替代 AC-038 的 real-smoke 证据。

**docs/release-checklist.md**

说明 Node 版本、真机/各发行版准备条件、PowerShell 7 的环境开关设置与恢复、--out 的仓库外持久报告路径、报告字段及版本核对、七步全 pass、零泄漏、失败原因与重跑、清理要求。给出 dry-run CI 命令与维护者 real 命令，明确两种报告不可互换；没有真机只能由 T-030 依据 release/waivers.json 显式豁免，不在本任务生成豁免或判发布放行。不提交本机报告、用户名、绝对路径或凭据。

## 建议验收方向

以 acceptance.md 两个既有 AC 小节为准，命令默认仓库根、Node 20+、PowerShell 7，多步骤块由执行端存为仓库外 UTF-8 无 BOM 临时 ps1 后执行。自动验收只跑 dry-run 与夹具；AC-038 真机块单列、只能维护者手动执行，成功才打印其哨兵。无真机不算通过。保留全 unit 回归与 scripts/check-fast.ps1 门禁。

设计阶段只运行无额外文件、无 git 的格式/只读检查；本环境未找到可用 pwsh，不回退 Windows PowerShell 5.1 执行快速检查链。实现验收的测试/报告输出由执行端放仓库外。不得把尚未实现的脚本、测试或未执行的真机验收写成已通过。

## 非目标

不做 T-030 的发布门禁、baseline 计算或豁免判定；不改 AC 索引、contracts/**、package.json、lib/**、test/flows/steps/**、蓝图或其他任务目录；不新增路由、UI 冒烟、压测和花费型 provider 调用。
