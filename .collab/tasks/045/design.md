---
write_scope:
  - test/integration/alpha-tarball.test.mjs
  - scripts/check-alpha-package.mjs
  - docs/release-checklist.md
---

# Task 045 — alpha 包黑盒验收：以用户视角安装并验证

## 背景

当前 package.json 版本为 0.2.0-alpha.1，无安装依赖，bin.cliworker 指向 bin/cliworker.mjs。files 包含 bin、lib、ui/** 和 docs/ui/cliworker-console.html，不包含 scripts/smoke-real.mjs 及其依赖的 test/**。现有 check-package-contents.mjs 只检查 npm pack dry-run 清单，不能证明安装后的命令可用。scripts/check-fast.mjs 会自动发现新 check-*.mjs，无需修改 package.json 或调度器。

brief 未提供基准 commit SHA 或既有验收报告路径，不编造基准，不引用其他任务的通过结论。133 个文件仅为背景，不固定文件数、包大小或哈希。

## 目标

新增一个可重复、无网络的真实 tarball 安装验收。仓库仅作为打包输入和验收程序来源；产品运行必须通过临时安装生成的入口及包内文件，cwd、配置、HOME、state、假 provider、npm 缓存均在仓库外。成功要求 brief 六项全部成立，缺少 ui/ 的包即使可以安装和运行 CLI 也必须失败。

## 约束

- 实施写域为 front matter 的三个精确路径。设计轮仅创建本目录 design.md、acceptance.md；不执行 git、不修改代码或其他角色文件、不创建其他文件。
- 不修改 lib/**、ui/**、package.json 或既有检查断言，不新增依赖、产品字段、schema、版本或结构化报告。测试配置及输出使用已有契约；下文的参数仅属于验收工具。
- 使用 Node.js 20+ 和 PowerShell 7。npm pack 与 npm install 强制离线、禁止生命周期脚本、关闭 audit/fund/update-notifier，缓存、日志、userconfig/globalconfig 均指向本次临时目录，不使用用户 npm 配置及缓存；不得 npx、联网安装、npm publish 或调用真实 provider。
- 不继承 NODE_PATH、NODE_OPTIONS、npm 配置注入、CLIWORKER_* 或凭据环境变量；构造子进程所需的最小环境。HOME、USERPROFILE、APPDATA、LOCALAPPDATA、XDG_CONFIG_HOME、XDG_CACHE_HOME、XDG_DATA_HOME、TEMP、TMP、TMPDIR、CLIWORKER_HOME 全部落在本次临时根内。Windows 环境键按大小写不敏感处理，避免 Path/PATH 双份导致继承仓库路径。
- 每次用 mkdtemp 创建独立系统临时根，解析真实路径并确认不在仓库内，比较必须考虑 Windows 大小写和路径段边界。不得借用仓库 node_modules、源码 lib 或协作目录；不得把仓库整体复制到临时目录。系统 Node、npm 及必要系统工具可以使用。
- 为打包和安装解析 Node/npm 工具的绝对路径；CLI 运行时 PATH 只含临时 .bin、临时假 CLI 及必要系统工具，不能继承开发机 provider 搜索路径。所有子进程有有限超时、缓冲上限及 windowsHide；启动错误、超时、信号、非零退出、JSON 解析错误均不得当作成功。
- 所有临时内容在 finally 中清理，清理失败使验收失败。删除前核对绝对路径处于本次创建的临时根内，禁止删除传入的原始 tarball、用户 HOME 或仓库。失败路径也必须清理；不留下仓库 tarball、状态、lockfile、缓存或报告。

## 建议验收方向

scripts/check-alpha-package.mjs：

1. 无参数时，从脚本所在仓库执行实际 npm pack --json --ignore-scripts --pack-destination <临时目录>；不是 dry-run。解析返回的 filename/version，验证产物确实位于指定目录，再以绝对路径安装。仅支持可选的一个本地 .tgz 路径作为位置参数，用于复用同一验收检查反例；拒绝未知参数、多余参数、非文件或不存在的路径，不能回退到默认包。位置参数的包版本从安装后的 package.json 读取，不强制写死版本。
2. 在新的临时安装目录执行 npm install <绝对本地tarball路径> --offline --ignore-scripts --no-audit --no-fund --package-lock=false，同时隔离 npm 配置和缓存。不得使用 npm link、源码 import 或假安装。确认 node_modules/dsh-cliworker 是本次安装中的实际目录，读取该包 package.json，验证 bin.cliworker 对应的文件存在且解析后在包内；确认安装生成的 .bin/cliworker（Windows 为 .cmd）存在并实际执行该 shim。后续需要 Node 直调时也只能使用同一安装包中的 bin 入口。
3. 默认打包路径将 CLI 版本与 npm pack 返回版本、安装后的 package.json 版本以及打包输入 package.json 版本比较。--version 的 stdout 是 JSON，按既有契约检查 ok === true、version 与安装包一致；不比较整段 stdout 与裸版本文本。
4. 所有需要配置的命令显式传 --config <临时配置绝对路径>。用已有 cliworker.config/v2 契约构造最小本地夹具，state_dir 指向临时 state，secrets 为空，discovery.wsl 为 false，关闭未知 CLI 探测。catalog.manual 至少放入一个合法手工模型，明确 catalog.allow、levels，以及匹配的本地 CLI override 和 quota pool；字段形状参照 test/unit/models-enumerate.test.mjs、test/flows/steps/run.mjs，不加载这些仓库 helper 作为产品运行依赖，不复制示例配置后直接运行。
5. doctor 在这个有效、可写、无真实凭据的夹具上必须退出 0，输出 status === 'ok'、checks 为非空数组且所有检查 ok === true。新 state 的 inventory 检查 detail === 'not generated' 是已有且可解释的健康状态，不要求预装真实 CLI 或生成探测缓存。不笼统接受任意 degraded、异常或缺配置错误。
6. 执行 discover --full --config <临时配置>，必须退出 0，stdout 是 schema === 'cliworker.inventory/v1' 的 JSON，entries 为数组、generated_at 可解析。读取临时 state/inventory.json，确认与 stdout 解析结果相等；文件实际在指定 state 内，不能以 stdout 有 schema 代替落盘。受控 PATH 无可发现 provider 时允许空 entries，不依赖开发机已有 CLI。
7. 执行 models enumerate --config <临时配置>，必须退出 0，schema === 'cliworker.models/v1'，models 为非空数组且包含夹具配置的模型 key；不接受只有空数组或命令帮助文本的结果。
8. 验证 smoke-real --dry-run 的包内等价 CLI 路径：在临时目录内生成独立假 provider 脚本，以系统 Node 和配置中的 args_prefix 调用，按已有 claude adapter 的 result/model/text/usage 事件契约响应 probe nonce 和固定 run 文本。参考 test/fixtures/probe/stub.mjs 的响应格式及 test/flows/steps/run.mjs 的调用形状，在新脚本内直接实现少量夹具，不 import 仓库实现或 test helper。通过已安装入口实际执行 models probe，确认模型 callable、evidence.nonce_ok === true，且临时 probes.json 和 usage.jsonl 有对应记录；随后 models select --request <既有 cliworker.request/v1 JSON> 返回 cliworker.selection/v1、ok === true、count_returned === 1 及有效 handle/lease/call。执行返回的 call，核对 command/args 中产品入口、配置和 state 路径均属于本次安装和临时根；输入固定文本，JSONL 必须有 cliworker.event/v1 start 和成功 result、正确 lease_id、固定假 provider 返回文本及 usage。不能手写 callable 缓存替代真实 probe，不能用预期错误或空选择替代成功链路。
9. 补上原 dry-run preflight 的 state backup/restore 等价 CLI 往返：在 state 内写 marker，state backup 获取 backup 名，改变 marker，再 state restore --from <返回名>，确认退出 0、既有 ok 字段为 true 且 marker 内容恢复。所有文件仍在临时根；执行顺序可放在 probe/select/run 之后，避免污染活动 lease。
10. 在已安装包中检查 ui/index.html、ui/app.mjs、ui/render.mjs 及精确路径 docs/ui/cliworker-console.html 均为可读非空普通文件；不能只检查源码 files 声明，也不能仅检查 ui 目录名。ui/ 完全缺失时诊断必须含 ui/，HTML 缺失时必须含其精确相对路径。
11. 当前包无 smoke-real 脚本时，上述 CLI 夹具链路为第 5 项的替代验证，不增发脚本。下游在 impl.md 记录脚本不随包分发、实际执行的 CLI 及与原七步 dry-run 的差异：本任务不执行 WSL fixture 和 http-select，也不宣称通过真实 WSL 或云 provider。docs/release-checklist.md 同样简述覆盖边界，保留现有 smoke/real 发布要求。
12. 全部检查及清理成功后 stdout 才输出独立行 AC-088 OK。失败非零退出、无成功哨兵，诊断包括失败步骤、缺失相对路径或不匹配字段、期望与实际退出状态；对 JSON 失败提供足够定位的信息，不只打印笼统 failed，不泄漏用户环境。供 integration 复用的内部逻辑可导出，但导入不得启动安装或打印哨兵；不再增加对外报告格式或字段。

test/integration/alpha-tarball.test.mjs：

- 使用 node:test，所有用例加 [AC-088] 标记；不使用 skip/todo/only，不允许环境缺 npm 时跳过。
- 至少两个实际集成用例，均执行真实 npm，不以 mock 替代关键安装。正向用例从真实仓库打包到临时目录，调用上述同一检查器，验证六项及额外 CLI 往返成功；再次运行也必须成功且没有前轮状态依赖。
- 负向用例名称包含 rejects tarball without ui。从真实 tarball 在临时目录解包，仅删除 package/ui，保留 package.json、bin、lib 及 docs/ui HTML，再从临时解包目录实际 npm pack 成另一 tarball。所有归档工具使用本机已有实现、无新增依赖；解包前校验成员路径不能越出临时根。确认反例实际缺 ui/、HTML 仍存在，再把反例 tarball 传给同一个检查入口。检查必须非零退出、stdout 不含 AC-088 OK，诊断含 ui/；因解包、重打包或 npm 安装失败而失败不能算抓到了 UI 缺失。
- 对正常包和失败包均核对调用 cwd、配置/state 路径、产品入口位于临时安装内，安装产物不是指向源码的链接。检查各轮新建的临时目录已删除，源 tarball 未被检查器改写/删除；前后仓库 package.json 和原 UI 资产内容不变。对超时、非法 JSON 等可用受控进程 seam 补充边界，但不得替代正反真实安装用例，不修改仓库来制造反例。

docs/release-checklist.md：

- 在既有发布清单中加入 node scripts/check-alpha-package.mjs 及 node --test test/integration/alpha-tarball.test.mjs。说明退出码 0 且 AC-088 OK 表示实际离线打包、仓库外安装和六项检查通过；说明指定本地 tarball 的位置参数用法、临时清理、缺失资产的失败诊断与修复后重跑方式。
- 保留 AC-087、生成资产检查、现有 dry-run、real-smoke 与发布放行要求。明确 tarball CLI 等价夹具不覆盖 WSL/http-select，不等于执行完整 smoke-real，也不证明真实账号可用。

## 验收格式

acceptance.md 只声明 brief 指定的 AC-088，所有可执行块为 pwsh，成功才输出 AC-088 OK；每块可独立从仓库根执行。多步骤块交由验收执行器保存为其临时 ps1 执行，不在仓库新增脚本。

实施阶段运行独立检查器、真实正反 integration、scripts/check-fast.ps1 及验收格式自检。check-fast 必须自动执行新检查器和既有门禁；失败不得通过修改写域外文件、降低断言或跳过测试掩盖。

设计轮仅运行不落盘的验收格式与文档编码/front matter 核对。check-fast 链路包含 git 调用及可能落盘的测试，与本角色禁止 git 和创建其他文件的限制冲突，因此本轮不运行，不宣称实现验收已通过。
