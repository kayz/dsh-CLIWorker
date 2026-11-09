---
write_scope:
  - scripts/check-generated-fresh.mjs
  - test/unit/check-generated-fresh.test.mjs
  - test/fixtures/release-gate/generate.mjs
  - docs/release-checklist.md
---

# Task 041 — 生成资产 freshness gate：生成后必须无 diff

## 目标

依据同目录 brief.md。brief 未给基准 commit sha 或既有验收报告路径，不另造基准。AC-084 已在 contracts/spec/ac-index.json 登记为 T-041 / M5 / unit + contract，沿用该登记，不增加 AC、schema、版本或追踪字段。

新增 `node scripts/check-generated-fresh.mjs`：分别运行 `test/fixtures/release-gate/generate.mjs` 和 `scripts/gen-contract-doc.mjs`，对照当前工作区中的生成资产；两者都成功且生成结果一致才退出 0，并在 stdout 打印 `AC-084 OK`。任何过期、缺失、多余、读取失败或生成失败都退出非 0，不打印成功哨兵；输出必须包含对应生成器的上述完整仓库相对路径，资产差异还应列出资产相对路径。多个生成器有问题时均须报告，不能第一项失败便遗漏另一项。

现有 `.github/workflows/ci.yml` 经 `npm run check` 调用 `scripts/check-fast.mjs`，后者自动发现 `scripts/check-*.mjs`。新增文件即接入所有现有操作系统及 Node 20/22 的 CI 检查，无需修改 workflow、package.json 或 check-fast。已有 check-contract-doc 保留。

## 约束

- 实现写域严格为 front matter 的四个精确路径；生成夹具、docs/contract.md、contracts/spec/**、lib/**、追踪分片及其他文件只读。design 角色只写本目录 design.md、acceptance.md。不得通过重新生成并提交写域外资产掩盖过期；如发现真实资产已过期，保留失败，交班说明所需更新及写域限制。
- 不修改产品行为、契约索引、既有测试断言或发布放行规则；不新增配置字段、环境变量、资产清单文件或产品 CLI 参数。下面的 `--root <dir>` 沿用仓库检查脚本惯例，仅用于选取被检查的仓库根，默认根按检查脚本位置解析；未知参数、参数缺值、根不存在均失败。导入检查脚本不得自动执行检查。
- 本检查不执行 git、不检查全局 dirty 状态，不重置用户改动。对比的是生成结果与当前文件内容；修改源输入而未更新资产也必须失败。初始已有无关改动不影响判定，运行前后原目录的文件集合和字节都必须相同。
- 所有生成发生在 `os.tmpdir()` 下的独立临时目录；成功、资产不一致、生成器非零、启动失败或超时均通过 finally 清理自己创建的目录。不得在真实树内试生成后回滚，不复制 .git、node_modules 或用户配置，不运行 shell、不访问网络。子进程使用 process.execPath、argv 数组、windowsHide、有限 timeout 和 maxBuffer；启动错误及 signal 退出也视为失败。清理失败本身必须使检查失败。

## 建议验收方向

`scripts/check-generated-fresh.mjs`：

1. 固定检查本任务指定的两项生成关系，不扩展到其他生成器。每项创建自己的隔离根，保留原仓库相对布局，复制本项生成脚本和必要输入。release-gate 输入为 package.json、contracts/spec/ac-index.json；contract-doc 输入为 contracts/registry.snapshot.json、contracts/golden/manifest.json、contracts/schemas 下的文件。复制输入时保留字节；缺失输入失败。不得复制旧生成输出作为新输出的初始内容。
2. 在该隔离根 cwd 中分别执行复制后的 `node test/fixtures/release-gate/generate.mjs`、`node scripts/gen-contract-doc.mjs --root <隔离根>`，各一次。两者都是仅依赖 Node 内置模块的现有脚本，按原布局复制后可直接运行。当前 release-gate 生成器只支持就地输出，因此必须先复制再执行，不能仅将 cwd 改成临时目录。无需重写生成器；generate.mjs 的写域仅用于确有必要的路径兼容修正，不改变 42 个场景、失败变体、输入契约或已有资产。
3. 生成器成功后，release-gate 比较 `test/fixtures/release-gate/` 下除根层 generate.mjs 外的完整普通文件路径集合；新生成根与原根的并集逐项比较，捕获缺文件和多文件。contract-doc 比较 docs/contract.md。输出目录缺失、文件无法读取或遇到不能安全比较的符号链接均失败。不要仅抽样 good，不固定 AC 数量，不排除 ci/、traceability/ 或负面场景；空目录不属于已提交资产。
4. 一般文件仅统一 CRLF 为 LF 后比较，其余文本逐字比较。docs/contract.md、内嵌 ac-index、package.json、evidence.test.mjs、waivers 等均走此规则；不忽略尾空白，不排序 AC 或删除 JSON 字段。
5. 当前夹具由真实 Node TAP reporter 生成，含耗时、宿主 Node 版本、诊断路径和 Node 内部堆栈；原始字节会随机器和 Node 版本变化。仅在下列已知运行环境位置比较规范化表示，双方使用同一规则，原文件不改写：
   - reporter.tap：保留所有 TAP 测试声明、ok/not ok、编号、计划、SKIP/TODO 指令、原因、汇总及诊断错误字段。仅将合法数值 duration_ms（YAML 字段和末尾汇总）的值替换成固定占位；在 YAML 诊断块内移除 Node 版本可增减的 type、location 字段及 stack 标量块。不得删除整段 YAML，failureType、error、code、name、operator、未知字段和普通文本都要参与比较。必须保留末尾 duration_ms 汇总行的存在性，避免把 truncated-tap 变成完整输出。
   - smoke.json、ci/*/files-executed.json、ci/*/skips.jsonl：仅将各报告对象已有顶层 node 字段中的合法 Node 版本字符串值规范化；其他字段和格式继续比较。空 skips.jsonl 保持空，不全局替换任何相似字符串。版本不是合法版本字符串时不能忽略；linux-alternative 的 Node 值也是夹具运行环境元数据，其余场景身份仍严格保留。
   - 不对其他文件应用上述特例；未知差异一律失败。不得把 TAP 仅投影成 AC 集合或最终 pass 数，也不得屏蔽含 AC 的行。规范化仅处理已有 reporter/运行环境噪声，不豁免契约或资产内容过期，不改变现有 release-gate 验证逻辑。
6. 每项输出可读的成功或失败说明，包含原生成器相对路径；收集两项结果后才决定总体退出码。异常同样携带生成器身份及原因，不能把空输出或无法读取当作相等。总体成功哨兵仅在两项通过并完成清理后输出。

`test/unit/check-generated-fresh.test.mjs`：

- 使用 `[AC-084]` 的普通 node:test 用例，无 skip/todo/only。所有场景用系统临时目录构造，finally 清理。通过实际检查 CLI 的 `--root` 调用测试，临时根内同路径生成器为最小替身，不能真的生成仓库夹具。替身按源 ac-index/registry 内容生成已知文件，不读取被比较资产决定输出。
- 干净临时根通过；改坏单份夹具失败且输出指名 release-gate/generate.mjs 和资产；只改源索引而不更新内嵌索引时失败；恢复相应资产后通过。单独改坏 docs/contract.md 必须指名 gen-contract-doc.mjs，两个资产同时过期必须报告两项。
- 文件缺失、多余、生成器缺失、输入缺失、生成器非零/抛错/超时均失败，不打印 AC-084 OK；生成器失败不能被旧资产相同掩盖。检查在空输出根生成，避免复制后覆盖让多余文件漏检。通过受控进程依赖测试启动失败和 timeout，避免漫长真实等待。
- 每种成功及失败运行前后，递归快照原临时根的路径与文件字节，严格相等；尤其用一个会先覆盖资产再非零退出的替身检验隔离。测试清理不得删除非本次创建的临时目录。两项生成器每次各被调用一次，即使另一项失败也执行。
- 专门验证规范化的正反边界：只有 CRLF、有效耗时、合法 node 版本、允许的 TAP 诊断差异时通过；改变 TAP 的 AC 标记、ok/not ok、SKIP/TODO、计划、汇总、错误码或增加未知文本时失败；删去截断标记场景的尾行、改变 JSON 中非 node 值、改变内嵌索引任一内容、加入非法 node 值时失败。禁止以测试标题或函数名检查替代行为断言。

`docs/release-checklist.md`：

- 在原有清单中补充生成资产检查命令、两个生成器及输出范围、CI 自动接入方式、失败时按指名生成器更新对应资产并提交再重跑的操作说明。说明检查隔离执行，不会替用户更新工作区；列明只规范化上述运行环境元数据。
- 更新资产属于维护者另行获得写域授权后的操作，不能由 freshness 检查执行。保留原有 WSL、真机冒烟、脱敏和发布限制，不把 freshness 成功当成 real-smoke 或发布通过。

## 验收格式

acceptance.md 沿用 brief 指定的 AC-084 二级标题；各 pwsh 块从仓库根以 PowerShell 7 独立执行，断言全部通过后才打印 AC-084 OK。包含新增单元用例、独立替身 CLI 行为、真实资产和不污染检查，以及回归门禁 `node --test "test/unit/*.test.mjs"`（沿用现有 AC-006）。测试只断言退出码、stdout/stderr 内容及文件状态。

实现阶段按本机规范运行 `pwsh -NoProfile -File scripts/check-fast.ps1`，保留真实失败，不降级为警告或扩大写域修复。该链会调用 git 并生成测试产物；本 design 轮禁止 git 及创建其他文件，因此只运行只读的 `node scripts/check-acceptance.mjs .collab/tasks/041/acceptance.md` 格式自检，不运行实现或全仓检查。此限制不免除下游实现/CI 阶段的完整检查。

## 非目标

不重写生成器，不增加生成资产类别，不为本任务更新写域外资产或追踪分片，不保证当前工作区内容已经提交，不修改既有 CI 矩阵、产品文件或契约。
