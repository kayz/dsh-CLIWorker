---
write_scope:
  - scripts/check-no-model-table.mjs
  - test/unit/check-no-model-table.test.mjs
  - test/flows/steps/enumerate.mjs
  - test/traceability/T-036.json
---

# Task 036 — 模型表静态检查与 per-CLI 枚举器

## 背景

依据同目录 brief.md、现有 `lib/commands/models/enumerate.mjs`、`lib/models/directory.mjs`、`test/helpers/flow.mjs`、`contracts/schemas/model.v1.schema.json` 和 `test/traceability/T-017.json`。brief 未提供基准 commit SHA 或既有验收报告路径；356 pass 是 brief 给出的回归基线，不另造提交基准。

当前存在必须先裁决的冲突，已按任务指令写入同目录 attention.json；本稿不授权下游带着冲突开始实现。

- `contracts/spec/ac-index.json` 仅登记 AC-001..AC-074；`scripts/check-traceability.mjs` 的 `expectedAcs()` 也固定为该范围，`mergeShards()` 将新 AC 分片报为 `shard.unknown_ac`。既有 `test/unit/traceability.test.mjs` 明确要求索引长度为 74、全仓分片合并 errors 为空、全仓追踪检查成功。因此只新增 brief 要求的 T-036 分片就会违反“既有单元测试 0 fail”，不是实现细节可以规避的问题。中央索引属于冻结文件，亦需同步清单；不能直接加一行或忽略未知 AC。
- `.collab/blueprint/cliworker-v2/task-graph.json` 的 T-036 outputs 包括 `lib/models/per-cli/*.mjs`，brief 标题和引言也提到骨架，但详细交付物未给这些模块的文件名、调用接口、配置形状或调用链。现有枚举实现只投影配置，没有可直接复用的 per-CLI 插件协议。不得据标题发明模块接口或配置字段。

当前 write_scope 严格对应 brief 的四项明确交付物。须由调度器裁决中央追踪兼容由哪个任务完成，以及本次是否仅交付四项详细交付物；如仍需 per-CLI 模块，先补充契约及精确范围，再更新这两个文档。不能把 attention 的默认值当成人类已回答。

## 交付物

1. `scripts/check-no-model-table.mjs`

   - Node ESM，零新增依赖。默认根目录由脚本位置定位，递归扫描根下 `lib/` 中的 `.mjs`、`.js`、`.cjs` 文件，覆盖 `lib/commands/`，同一文件只扫描一次。扫描只读取源码，不 import 或执行被检文件，不启动任何 provider CLI。
   - 已知名称从仓库声明文件生成集合，不在检查器中复制 CLI 或模型名单。读取 `config/cliworker.example.json` 的 `providers` 键、各 provider 的 `cli`/`adapter`、`models` 键及各模型 `id`；读取 `contracts/examples/model.v1/valid/*.json` 中既有 model/v1 记录的 `id`、`cli`、`provider`。仅收集非空字符串并去重；不把普通字段名、错误码、级别等全部 JSON 字符串当模型名。不读用户配置、不依赖用户安装情况。应有测试证明声明文件新增名称后可被识别，而无需修改检查器。
   - 按 JavaScript 词法边界识别真实数组/对象字面量，处理跨行、嵌套、单双引号及转义；不能用对整文件的名称计数替代。忽略注释及普通字符串内伪造的代码，正则和模板文本不能被误当容器。无需做动态执行、常量传播或跨表达式求值。
   - 对同一字面量范围内的字符串字面量值及对象属性键，统计命中词表的不同名称；嵌套模型记录计入其所属外层字面量。CLI 名和模型 id 可混合计数，达到 3 个即失败。重复同一名称三次不达阈值，三个分离表达式不能合并计数；函数体或代码块本身不是对象字面量。
   - 白名单只包含精确相对路径 `lib/commands/_util.mjs`，路径统一为 `/` 后比较，拒绝用目录、文件名后缀或“包含 _util”宽泛排除。不因文件已有命中就扩白名单。若发现基线真命中且无法在四文件范围内消除，交调度器裁决，不静默绕过。
   - 无命中退出 0，stdout 输出一行 `AC-079 OK`。有命中退出非 0，逐项输出相对文件路径、从 1 开始的行号及对应原始字面量片段；多行片段可以换行展示，不能仅输出名称或省略片段。失败不得输出成功标记。读取、声明解析或扫描错误同样非 0 并有可定位诊断，不能 catch 后当作干净文件。
   - 可导出内部扫描逻辑供同文件夹具测试复用，但不增加产品 CLI 参数、配置字段或公共模型协议。被 import 时不自动运行仓库检查。`scripts/check-fast.mjs` 已自动发现 `check-*.mjs`，无需修改门禁接线。

2. `test/unit/check-no-model-table.test.mjs`

   所有新增用例标题以 `[AC-079]` 开头，无 skip/todo/only。夹具源码、词表声明和探针均内置在该测试文件，运行时如需文件只放系统临时目录并 finally 清理，不新增仓库夹具文件。复用实际扫描逻辑，并以子进程覆盖检查器真实退出码与输出；可在临时根复制该脚本及最小声明文件，沿用默认脚本相对路径，避免增加测试专用 CLI 开关。

   至少覆盖：干净文件；两个名称通过；三种不同 CLI 名数组失败；三个模型 id 失败；对象键、多行及嵌套模型表失败；混合 CLI/模型名失败；重复名称和分离表达式通过；注释与字符串中的伪字面量不误报；精确白名单通过；相似文件名及 commands 子目录仍被检查；动态声明词表生效；失败诊断包含正确路径、行号和片段；输入读取/解析错误非 0。不得仅断言扫描函数“有返回值”。

3. `test/flows/steps/enumerate.mjs`

   沿用现有 step 接口，导出 `name = 'enumerate'`、`introduced_by = 'T-036'`、`ac = ['AC-079']` 和异步 `run(flow)`。`STEP_ORDER` 已包含 enumerate，无需修改辅助框架。调用 `flow.run(['models', 'enumerate', '--config', flow.config_path])`，通过真实 bin 和路由运行配置驱动枚举，不直接调用命令函数、不执行真实 provider。

   断言退出码 0，`JSON.parse(result.stdout)` 成功，顶层沿用现有 `schema: 'cliworker.models/v1'` 和 `models` 数组。使用既有 flow 配置的单条 q 模型，断言恰好返回一条且 id 为 q，防止空数组让字段断言空转；不硬编码生产 CLI/模型表。按 `contracts/schemas/model.v1.schema.json` 检查该条记录的全部 required 字段、嵌套 required 字段及类型/可空值，不只检查 id。复用现有契约校验能力或按该 schema 检查，不另造版本或字段。不改 flow 配置，保留捕获与泄漏扫描。

4. `test/traceability/T-036.json`

   沿用 T-017 分片形状：顶层仅 `task`、`milestone`、`entries`，值分别为 T-036、M3 及条目数组；唯一条目使用 `ac: 'AC-079'`、`status: 'covered'`、`files`，files 精确指向上述单元测试和 flow 步骤两个文件。不得改 AC-042 的既有归属，不添加 baseline 或新 schema。

   此分片只能在中央追踪兼容问题被明确解决后落地。不能将 covered 改 planned、删除分片、过滤 AC-079、跳过全仓追踪测试来换取绿灯。

## 硬约束

实现仅写 front matter 四条路径；禁止修改 `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`、`lib/catalog.mjs`，不放宽既有断言，不修改中央契约、冻结清单、其他检查器或测试框架。保持 Windows/PowerShell 7、UTF-8 无 BOM，不使用 Bash/WSL，不执行 git。遇到所述裁决扩大范围时，先更新规格，再按获准范围实施。

本 design 阶段仅创建 design.md、acceptance.md，以及用户为致命歧义明确授权的 attention.json；不运行会生成文件或间接执行 git 的全量检查。下游在实现完成且获准执行测试的阶段运行 acceptance.md 命令；多步骤自动化按本机规范写为获准位置的 `.ps1`，原生命令后检查 `$LASTEXITCODE`。不能因当前阻塞而声称测试已通过。

## 验收

以 acceptance.md 的独立命令及期望输出为准。中央追踪冲突未解决、per-CLI 范围未裁决时，不宣告可实现或验收通过。必须保留 `node scripts/check-no-model-table.mjs` 的成功标记、夹具反例、真实 flow 接线、追踪分片检查、既有单元测试零失败，以及项目 `scripts/check-fast.ps1` 门禁；不把已知冲突作为可接受失败。
