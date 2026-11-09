---
write_scope:
  - scripts/smoke-real.mjs
  - test/integration/wsl-smoke-preflight.test.mjs
  - docs/release-checklist.md
---

# Task 038 — AC-038 真机冒烟：WSL 内 Node 与 CLI 探测

## 目标

依据同目录 brief.md、现有 smoke-real.mjs、test/smoke/report.mjs、WSL 解码及 discover 实现。brief 未提供基准 commit SHA 或既有验收报告路径，不另造基准。当前 realWsl 已枚举全部发行版并在发行版内执行 discover，但 Node 缺失、执行失败和版本过低被归并成同一原因，且没有可独立检查的成功返回值。

实现须先确认 WSL、发行版列表及各发行版内 Node，再确认同一发行版内的 CLI 发现结果。前置满足后，真实发现结果必须非空且每项 platform 精确等于对应的 wsl:<distro>；前置不足时 wsl-discover 为 fail、reason 指明具体类别、整体退出非 0。所有已枚举发行版都必须满足要求，不能选择一个成功发行版掩盖其他发行版的失败。

## 约束

- 产品与测试写域精确为 front matter 的三个文件。本 design 角色只创建本目录 design.md、acceptance.md。lib/cli.mjs、lib/routes.mjs、lib/context.mjs 及其他代码、测试、契约、追踪分片只读；不安装 WSL、Node 或 CLI。
- 继续使用 cliworker.smoke/v1、cliworker.inventory/v1 及现有字段。报告仍为原顺序七步；不新增前置步骤、报告字段、配置项、错误码、版本、产品 CLI 参数或测试专用环境变量。wsl-discover 继续 mandatory=true、ac=['AC-038']，AC-081 是夹具测试覆盖，不添加到该步骤的 ac 数组。
- 保留既有发行版集合前后相等、环境身份、非空 entries、每项 present、每项 platform、泄漏扫描、清理、版本与报告结构断言。dry-run 仍只用夹具，不能满足真实 AC-038。
- 生产默认路径始终执行真实 wsl.exe，不允许回退至 Windows Node、宿主 CLI、合成 entries 或干跑结果。所有外部调用保留超时、缓冲区上限、windowsHide 和 argv 数组传参；名称含空格或中文不能拼进 shell 命令。

## 建议验收方向

scripts/smoke-real.mjs：

1. 将 realWsl 内的前置探测组织成可单独调用、可注入外部执行依赖的流程，沿用已导出的 realWsl 作为调用入口，保留现有四个位置参数。可增加第五个可选上下文参数，复用既有 ctx 的 platform、env、fs、exec 语义与 exec 的 ok/code/stdout/stderr 返回形状；默认上下文使用真实平台、文件系统及进程执行。夹具无需改变 process.platform，也不能真的启动本机 WSL。
2. 先检查 Windows 平台与 WSL 可执行文件，再用 wsl.exe -l -q 获取二进制输出，交现有 parseDistros 解码。不得把发行版列表和发行版内程序输出使用同一种编码：列表沿用 UTF-16LE，发行版内 Node、环境变量及 JSON 按 UTF-8。无发行版与列表执行失败分别失败。先完成整个初始列表中所有发行版的 Node 检查，再进入 CLI 发现，避免缺失 Node 被 wslpath 或 CLI 失败抢先遮蔽。
3. 每次 Node 检查均通过 wsl.exe -d <distro> --exec 在目标发行版内执行。先确认 Linux PATH 中 node 可执行文件是否存在，再运行其 --version 并严格解析主版本，要求 >=20。存在性探测可以通过固定的 Linux sh 脚本实现；用户数据仅通过独立 argv 传入。解析出的 Node 路径必须是 Linux 绝对路径，拒绝 .exe/.cmd/.bat 程序，并由该 Node 自报 process.platform=linux，避免经 WSL 互操作调用 Windows Node。在版本检查及后续 discover 中使用该已确认的 Node；仅处于挂载目录不作为判定其操作系统的依据。缺失、版本不足、异常版本输出以及存在但不能执行均失败，不使用宿主进程的 process.version/process.execPath 作为发行版内版本证据。
4. Node 全部通过后，沿用临时隔离配置、wslpath、Linux PATH 和 WSL_DISTRO_NAME 取值及精确匹配检查。在同一发行版内，通过已确认的 Linux Node 执行仓库 bin/cliworker.mjs discover --config <隔离配置> --full。保留 env -i 与隔离 HOME/CLIWORKER_HOME，不使用真实账号配置或云调用。CLI 是否可发现以这次实际 inventory.entries 为证据，不复制生产 CLI 名单、不单独硬编码一组 command -v CLI 名称。发现命令失败、非 JSON、错误平台分别失败；合法 inventory 但 entries 为空须明确报告未发现 CLI。该次发现同时是 CLI 前置探测与真实发现证据，不必重复执行同一个 discover 命令。
5. 精确比对初始解码名称、Windows inventory.host.wsl_distros 和发行版内 inventory.host.platform/entries[*].platform；所有相关名称均不得残留 BOM、NUL、CR、LF。再枚举并比较初始与最终发行版集合。成功时 realWsl 返回按初始发行版顺序排列的原始 inventory 对象数组，至少一项；每项沿用 cliworker.inventory/v1，不添加探测包装字段。失败抛出受控错误；捕获区继续记录实际执行和 inventory，用于现有泄漏扫描。这样集成测试能直接断言成功 inventories，失败能通过现有步骤报告断言原因。
6. safeReason 应保留受控类别，并区分 Windows 平台不符、WSL 不可用、发行版列表失败、无发行版、Node 缺失、Node 低于 20、Node 执行或版本解析失败、无可发现 CLI。沿用既有 WSL 环境不匹配、发现失败、集合变化类别。新原因文本须明确包含对应含义，例如 Node 缺失含 WSL、Node、not found；版本不足含 WSL、Node、20；无 CLI 含 WSL、CLI。不得回显原始 stderr、用户路径、发行版名称或凭据。不要用通用 external command failed 覆盖已经识别的前置失败。
7. 前置探测由实际 wsl-discover 动作执行，其错误进入现有 catch：当前步骤 fail，failed=true，main 返回现有 E_INTERNAL 对应的非零退出码；后续步骤保留 dependency failed 的 skip 语义。前置缺失自身不得转成 skip 或 pass。此前 discover 已失败的既有依赖短路行为保持；夹具验证前置错误时必须让此前步骤通过，确保确实观察到 wsl-discover 的 fail。
8. 为测试完整映射，可给 executeSmoke 增加可选的位置参数作为 WSL 执行动作，默认值为真实 realWsl；可导出 main，并增加可选的位置参数作为 smoke 执行函数，默认值为 executeSmoke。现有对象字段与 CLI 调用方式不变。夹具动作必须调用带注入上下文的同一个 realWsl，不得直接返回预制 pass/fail 报告。子进程通过 import 后调用这些函数，沿用 main 的真实 stdout 与退出码逻辑。不得让生产环境变量或 CLI 参数选择夹具；正常命令行始终使用默认执行依赖。

test/integration/wsl-smoke-preflight.test.mjs：

- 新增离线 node:test 用例，使用 [AC-081] 标记；无 skip/todo/only。夹具和响应表放在本文件，文件夹具只在系统临时目录生成并 finally 清理，不增加仓库夹具文件。不依赖真实 WSL、Node 安装状态、发行版、账号或宿主已安装 CLI；完整脚本用例在隔离子进程环境中运行，PATH 仅含受控目录。
- 至少三种主场景均通过同一个真实探测实现：前置满足；发行版存在但 Linux node 缺失；WSL 可执行文件不存在。成功场景返回非空原始 inventories，准确包含每个预期 wsl:<distro>，所有 entries 非空且 present；失败场景分别观察明确 Node/WSL 原因。
- 编码夹具含 UTF-16LE 有 BOM 和无 BOM 两种列表、NUL、CRLF、重复项、空格名称和中文名称；独立比对完整预期名称数组，不能只查无非法字符。命令记录证明 -d 后是完整名称单个参数，Node 的存在性、版本及 discover 都走该发行版，不能调用宿主 Node 充当探测结果。
- 补充 Node 19、Node 20 边界、无发行版、列表失败、Node 异常版本或执行失败、Windows Node 路径伪装、无 CLI、环境不匹配、非法发现 JSON、错误条目平台、非 present 条目、发行版集合变化，以及一个发行版成功而另一个缺 Node。检查 Node 失败时没有执行 CLI 发现；无 CLI 与无 Node 原因不同。对每种预置失败验证没有降级为成功。
- 至少对三种主场景，通过受控动作驱动 mode=real 的完整脚本入口并捕获退出码和 stdout JSON：满足时七步全 pass、退出 0；Node 缺失和无 WSL 时 wsl-discover 为 fail、reason 指向具体类别、退出非 0，后续步骤依赖跳过。用现有 validateReport 验证结构；不得以 mock main 返回值代替脚本输出，或只检查抛异常。测试夹具产生的 mode=real 报告仅是离线断言，不保存为发布证据。
- 验证失败原因不会泄漏夹具中的敏感哨兵、路径和发行版名，现有清理和 dry-run 兼容性测试保持通过。不要求毫秒耗时或真实等待。

docs/release-checklist.md：

- 在现有发布前冒烟内容中说明探测顺序、每个发行版的 Linux Node 20+ 与非空 CLI 发现要求；Node 缺失、版本不足、WSL 不可用和无 CLI 都是失败，给出按原因准备环境后重跑的说明，不自动安装。
- 保留真实执行开关、现有七步及脱敏要求，说明独立 realWsl 返回的 inventories 是脚本内测试证据，stdout/--out 仍只有原 smoke 报告。保持报告归档在仓库外，dry-run/AC-081 夹具通过不能证明 AC-038 真机通过。

## 验收格式

acceptance.md 的命令从仓库根用 PowerShell 7 执行，每块独立判定，失败不得输出该块的 OK 哨兵。AC-081 的离线验证必须通过；AC-038 保留严格真机门禁，缺少 Node 的当前环境预期无法通过该门禁，不得将此环境失败归为 skip 或发布成功。使用既有错误退出码来源，不另定数字。

实现后的回归包括新增 integration、现有 WSL/dry-run smoke 与 node --test "test/unit/*.test.mjs"。按本机规范在允许执行完整仓库检查的实现/CI 阶段运行 scripts/check-fast.ps1；本 design 轮禁止 git 和创建其他文件，而该检查链会调用 git 并生成测试产物，因此仅运行只读的 check-acceptance 自检。完整门禁的既有失败必须如实报告，不能通过修改写域外文件消除。

## 非目标

不安装环境、不降低 Node 要求、不豁免真实 AC-038、不修改发布放行规则、冻结 schema、索引或追踪分片，不扩展 discover 的产品行为。
