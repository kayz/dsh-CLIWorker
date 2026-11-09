---
write_scope:
  - package.json
  - scripts/check-package-contents.mjs
  - test/unit/package-contents.test.mjs
  - docs/release-checklist.md
---

# Task 044 — UI 资产随 npm 包分发

## 问题

当前 package.json 的 files 已包含 bin、lib，但没有 ui 与 docs/ui/cliworker-console.html。现有 scripts/check-pack.mjs 检查运行时文件及禁入路径，没有验证 UI；其 contracts 白名单仅限制 contracts 路径，加入本任务 UI 路径无需改动旧检查器。scripts/check-fast.mjs 会自动发现 check-*.mjs，因此新检查器无需新增 npm scripts 或修改检查调度器。

brief 未给基准 commit SHA 或既有验收报告路径，不另设基准。本设计以当前文件与本轮验收结果为依据。

## 目标

安装包包含 ui/**、docs/ui/cliworker-console.html、bin/**、lib/**。以本地 npm pack --dry-run --json 的实际 files 清单判定；四类资产任一缺失均失败。检查不能仅验证 package.json 声明，也不能以源码文件存在替代打包结果。

## 约束

- 实施写域严格为 front matter 的四个文件，路径相对仓库根；设计轮只创建本目录 design.md、acceptance.md。不执行 git，不修改 brief 或其他角色产物，不创建其他文件。
- package.json 仅在 files 中追加 ui/** 与 docs/ui/cliworker-console.html，保留全部旧条目及其他字段、版本、入口与 scripts。不使用过宽的 docs/** 或将 scripts/test 一并发布。
- 不修改 lib/cli.mjs、lib/routes.mjs、lib/context.mjs、ui/** 或其他实现文件，不改变渲染、路由、静态资源加载方式。不引入依赖、产品配置、schema 或版本号。
- 不执行 npm publish、npm install 或联网操作；取清单使用 npm pack --dry-run --json --ignore-scripts，强制 npm 离线模式。禁用生命周期脚本，避免发布钩子副作用；不生成 tarball。
- 不断言固定字节数、散列、精确文件总数或整个清单与固定快照相等。不删除、跳过、放宽旧检查与测试断言。
- 实施测试使用系统临时目录，finally 清理；不得改真实 package.json 来制造失败，不新增仓库夹具。清理仅针对本次创建的临时目录。

## 建议验收方向

package.json：

- 在现有 files 白名单中追加 ui/** 和 docs/ui/cliworker-console.html；保留 bin、lib 与所有既有分发资产。

scripts/check-package-contents.mjs：

1. 无参数时检查脚本所在仓库；沿用 scripts/check-pack.mjs 的 --root <dir> 约定，以便针对临时副本执行同一检查器。缺少参数值、未知参数或目标不可读均非零退出，不能悄悄改查真实仓库。--root 仅是检查工具参数，不进入产品 CLI 或配置。
2. 对目标目录执行本地 npm pack --dry-run --json --ignore-scripts，启用 npm 离线模式，兼容 Windows npm.cmd 与非 Windows npm。设置有限超时、缓冲上限及 windowsHide；启动失败、超时、非零退出、非法 JSON、缺失或非法 files/path 均为失败。可复用现有只读 helper，但不得修改它；复用时仍须满足离线与错误处理要求。
3. 从 npm JSON 的 files[*].path 得到相对包根路径，将反斜杠规范成斜杠。至少检查存在 ui/、bin/、lib/ 下的文件，以及精确路径 docs/ui/cliworker-console.html；ui-old/ 等相似前缀不能算命中，目录名本身也不能算文件。
4. 为保证 ** 代表完整资产而不只是非空目录，枚举目标源码 ui、bin、lib 的普通文件，逐个断言相对路径在实际打包清单中。目录缺失或无文件也失败。不要求清单只含这些文件，正常增加已纳入分发的文件应通过；嵌套目录同样检查。不以源码数量或字节数作为判据。
5. 所有要求均成立才以退出码 0 在 stdout 输出 AC-087 OK；任何失败均非零退出且不输出该哨兵。缺文件或目录时诊断包含对应相对路径或前缀；npm 失败与内容缺失必须可区分。导入测试所需函数时不得触发进程、打印成功哨兵或设置退出码。无需新增结构化报告、错误码体系或落盘产物。
6. 新文件按 check-*.mjs 命名，自动进入现有 check-fast 链路。既有 check-pack、禁入路径、版本一致性与完整 lib 检查继续独立成立。

test/unit/package-contents.test.mjs：

- 使用 node:test 和 [AC-087] 标记，包含真正执行的 unit 与实际 npm 清单契约断言，不使用 skip/todo/only 或占位用例。虽然文件位于 unit，契约覆盖须实际调用 npm 与生产检查入口。
- 正向用例验证真实仓库 dry-run 清单及检查器成功；临时副本从真实 package.json、ui、bin、lib 和指定 HTML 复制所需资产，不复制整个仓库。在副本中加入额外 UI 嵌套文件后仍须通过，证明不依赖固定总数或大小。
- 负向用例在副本的 files 移除 ui/**（兼容 ui、ui/ 的等价声明），保留 ui 源文件；由实际 npm 清单证明 ui/ 消失，再确认同一检查器非零退出、没有成功哨兵、诊断含 ui/。同时核对真实 package.json 内容未变。
- 分别在独立副本中删除指定 HTML、整个 bin、整个 lib，确认实际检查失败并指明缺失项。bin 可能被 npm 的 bin 字段自动纳入、lib/index.js 可能被 main 自动纳入，不能仅移除 files 条目来假定这两类必然缺失。
- 补充纯清单边界：任一必需项缺失、只有相似前缀、只缺一个嵌套资产而目录仍非空均失败；额外合法清单条目不导致失败。以受控执行 seam 验证 npm 失败、启动失败/超时、非法 JSON、非法 files/path 均失败，不能为这些边界发起网络请求。
- 测试不读取真实账号，不生成 tarball，不产生仓库内状态或报告。使用绝对检查器路径和独立 cwd/--root，防止负向测试误查真实仓库而假通过。

docs/release-checklist.md：

- 在现有发布清单中补充 node scripts/check-package-contents.mjs，说明成功退出且输出 AC-087 OK 才通过，并说明其基于 npm pack --dry-run --json 清单、强制离线、禁止生命周期脚本且不发布。
- 列明 ui/**、指定 HTML、bin/**、lib/** 的检查要求，以及缺失时修复 files/资产后重跑。保留所有既有生成资产与 real-smoke 要求，包内容通过不能替代发布前其他门禁。

## 验收格式

acceptance.md 只使用本任务指定的 AC-087 二级标题；每个命令块可独立从仓库根在 PowerShell 7 执行，每条命令成功后才打印 AC-087 OK。多步骤命令块由执行器作为已有临时 ps1 执行，不要求在仓库新增脚本。具体退出码、stdout 与文件状态判据见 acceptance.md。

实施阶段按验收运行新 unit/契约、独立清单检查、负向临时副本检查及 scripts/check-fast.ps1。完整门禁失败必须保留失败结果，不得改写域外文件或放宽断言消除失败。

设计轮仅执行无落盘的 check-acceptance 格式自检和两份文档的 UTF-8/front matter 核对。check-fast 会运行测试、生成产物，且既有检查链包含 git 调用，与设计轮禁止 git 和创建其他文件的要求冲突，因此留给下游实施验收，不在本轮执行或宣称通过。
