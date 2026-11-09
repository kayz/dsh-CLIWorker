---
write_scope:
  - test/flows/steps/discover.mjs
  - test/flows/flow.test.mjs
  - test/integration/flow-complete.test.mjs
  - test/traceability/T-039.json
---

# Task 039 — discover 补 flow 步骤

## 目标

覆盖 AC-082（integration）：默认 runFlow 从磁盘发现 discover，按现有 STEP_ORDER 在 doctor 与 enumerate 之间执行；真实 CLI 返回成功，stdout 与 flow.state_dir/inventory.json 均为 cliworker.inventory/v1，且 generated_at 一致。

## 约束

本轮用户授权将 test/integration/flow-complete.test.mjs 加入写域，以本文件顶部四个精确路径为准，之前 attention.json 提出的写域冲突已由该授权解决。保持 flow 执行框架、共享 legacy cliworker.config/v1 fixture 和全部 lib/ 文件不变。docs/contract.md 的哈希由 gen-contract-doc 生成，不属于本任务写域。合约沿用现有 cliworker.config/v2、cliworker.inventory/v1，不新增字段或版本。

1. test/flows/steps/discover.mjs：按现有步骤接口导出 name = 'discover'、introduced_by = 'T-039'、ac = ['AC-082'] 及异步 run(flow)。在 flow.root 内写独立 UTF-8 无 BOM 的 v2 配置，state_dir 指向 flow.state_dir；参照 enumerate 的配置结构，保留 discovery、catalog、pools、policy、secrets 所需结构，catalog.manual 可为空。不改写 flow.config_path。
2. 通过 flow.run(['discover', '--config', 配置路径]) 启动真实 CLI；检查退出码为 0，再 JSON.parse stdout。必须断言 schema、entries 为数组、generated_at 为有效非空时间字符串；读取 flow.state_dir/inventory.json，检查同样的 schema、entries 和 generated_at，并比较落盘 JSON 与 stdout JSON 深度相等。文件缺失、JSON 无效、CLI 失败或不同源都必须让步骤失败，不能 catch 后跳过。discover 不要求本机预装供应商 CLI，也不要求 entries 非空；关闭 WSL、未知 CLI 探测及未知文件匹配，使用子进程环境隔离 PATH/Path，避免执行本机供应商命令。flow.run 使用绝对 Node 路径，不依赖 PATH。
3. test/flows/flow.test.mjs：保留 AC-031 自测、STEP_ORDER 顺序、步骤元数据、泄漏扫描和清理断言。独立使用 readdir 读取 steps/*.mjs，去扩展名并 sort，作为发现结果和执行结果的预期集合，不能仅用 discoverSteps 的返回值作为期望。增加标记 [AC-082] 的真实 flow 用例，使 run-tests --ac AC-082 能实际选中测试文件；断言发现和执行结果均包含 discover 且执行成功，并核对其 CLI stdout、独立 v2 配置和 inventory 同源。
4. test/integration/flow-complete.test.mjs：沿用现有 readdir + 去 .mjs + sort 的 expectedNames，删除固定八步骤的 REQUIRED 集合等式及过时的 discover 缺失注释。发现结果及执行结果均与磁盘集合严格相等。必须步骤存在性从现有 STEP_ORDER 逐项断言，不再维护固定八项列表；每个步骤 name 与文件名一致、introduced_by 匹配 /^T-\d{3}$/，执行结果也保留名称与元数据检查。其余 sentinel、每步成功、所有泄漏扫描表面和 report.ok 断言全部保留。
5. test/traceability/T-039.json：使用既有 task、milestone、entries 结构；task 为 T-039，milestone 为 ac-index 已登记的 M3。AC-082 的 status 为 covered，files 引用实际承载该 AC 测试的 test/flows/flow.test.mjs。不以步骤模块代替可执行的 .test.mjs 用例。

## 建议验收方向

以 acceptance.md 的独立命令验证：完整 flow 的可观察执行结果与产物、两个 flow 测试入口、AC-082 定向运行、单元回归和 check-fast。不能只验证步骤文件存在或依赖测试标题证明行为。每次 flow 使用自己的临时 root，并在 finally 中 cleanup；运行时临时配置和 inventory 不进入仓库。

设计阶段已运行指定检查（尚未修改任何实现文件）：check-acceptance 通过（2 个 AC、6 条命令、0 警告）；node --test test/flows/flow.test.mjs 为 8/8 通过；node --test "test/unit/*.test.mjs" 为 526 通过、5 失败、1 跳过，失败均在 release-gate.test.mjs 并报告 BLOCKED index index.count；node scripts/run-tests.mjs --ac AC-082 退出 1，输出 FAIL run.no_match AC-082，需下游新增实际 AC 用例；node scripts/check-fast.mjs 退出 1，在 check-pack.mjs 报 FAIL pack.npm_failed，npm pack 退出 4294963248。上述失败如实保留，不能据此放宽验收或越过四文件写域修复其他模块。

## 非目标

不改变 discover 的产品逻辑、配置迁移、共享 fixture、flow 框架或合约哈希，不引入新的 AC、milestone、产品字段或版本。既有八个步骤不降级、不跳过。
