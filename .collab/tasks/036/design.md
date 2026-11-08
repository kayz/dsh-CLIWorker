---
write_scope:
  - scripts/check-no-model-table.mjs
  - test/unit/check-no-model-table.test.mjs
  - test/flows/steps/enumerate.mjs
  - test/traceability/T-036.json
  - contracts/spec/ac-index.json
  - contracts/schemas/ac-index.schema.json
  - contracts/golden/manifest.json
  - scripts/check-traceability.mjs
  - test/unit/traceability.test.mjs
  - test/unit/lock.test.mjs
  - test/contract/milestone-gate.test.mjs
---

# Task 036 — 模型表静态检查与 per-CLI 枚举器

## 背景

依据同目录 brief.md、现有 `lib/commands/models/enumerate.mjs`、`lib/models/directory.mjs`、`test/helpers/flow.mjs`、`contracts/schemas/model.v1.schema.json` 和 `test/traceability/T-017.json`。brief 未提供基准 commit SHA 或既有验收报告路径；356 pass 是 brief 给出的回归基线，不另造提交基准。

本轮用户已裁决：授权最小追加 AC-079 并完成相关索引计数迁移；取消 per-CLI 模块，只交付 brief 的四项详细交付物及必要的中央追踪兼容修改。此裁决替代上一轮 attention.json 中的待答问题，解除原暂停条件；本轮不修改旧 attention.json，也不等待上游任务。`lib/models/per-cli/*` 不进入计划或 write_scope，不创建该目录或模块；蓝图的旧 outputs 不覆盖本轮裁决。

write_scope 在原四文件上增加用户授权的索引、按需 schema、计数测试，以及完成该授权所必要的追踪检查器、实际含固定计数的 `test/unit/traceability.test.mjs` 和索引冻结清单。当前核查发现 `test/unit/lock.test.mjs` 没有 AC 数量断言，`test/contract/milestone-gate.test.mjs` 不存在；这两个用户点名路径保留授权，但不为它们创建文件或做无关修改。实际 milestone 测试为 `test/unit/milestone-gate.test.mjs`，本次只运行，不需修改。

本轮给出的增量引用为 `e2667e5`，不是另定验收基准；按禁止 git 的约束，只核对工作树实际文件。`models add` 和 `lib/models/directory.mjs` 已使用 `E_LEVEL_UNKNOWN`（非法级别）及 `E_REQUEST_INVALID`（未知 provider），既有 models-add 测试亦已对应。沿用这些错误语义，不恢复旧码、不将这些代码文件加入本任务范围。

## 交付物

1. `scripts/check-no-model-table.mjs`

   - Node ESM，零新增依赖。默认根目录由脚本位置定位，递归扫描根下 `lib/` 中的 `.mjs`、`.js`、`.cjs` 文件，覆盖 `lib/commands/`，同一文件只扫描一次。扫描只读取源码，不 import 或执行被检文件，不启动任何 provider CLI。
   - 已知名称从仓库声明文件生成集合，不在检查器中复制 CLI 或模型名单。读取 `config/cliworker.example.json` 的 `providers` 键、各 provider 的 `cli`/`adapter`、`models` 键及各模型 `id`；读取 `contracts/examples/model.v1/valid/*.json` 中既有 model/v1 记录的 `id`、`cli`、`provider`。仅收集非空字符串并去重；不把普通字段名、错误码、级别等全部 JSON 字符串当模型名。不读用户配置、不依赖用户安装情况。应有测试证明声明文件新增名称后可被识别，而无需修改检查器。
   - 按 JavaScript 词法边界识别真实数组/对象字面量，处理跨行、嵌套、单双引号及转义；不能用对整文件的名称计数替代。忽略注释及普通字符串内伪造的代码，正则和模板文本不能被误当容器。无需做动态执行、常量传播或跨表达式求值。
   - 对同一字面量范围内的字符串字面量值及对象属性键，统计命中词表的不同名称；嵌套模型记录计入其所属外层字面量。CLI 名和模型 id 可混合计数，达到 3 个即失败。重复同一名称三次不达阈值，三个分离表达式不能合并计数；函数体或代码块本身不是对象字面量。
   - 白名单只包含精确相对路径 `lib/commands/_util.mjs`，路径统一为 `/` 后比较，拒绝用目录、文件名后缀或“包含 _util”宽泛排除。不因文件已有命中就扩白名单。若发现基线真命中且无法在获准范围内消除，交调度器裁决，不静默绕过。
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

   同步完成以下用户授权的中央追踪兼容修改，再运行全仓验收。不能将 covered 改 planned、删除分片、过滤 AC-079、跳过全仓追踪测试来换取绿灯。

   - `contracts/spec/ac-index.json`：在原 AC-074 条目后仅追加一条 `{"ac":"AC-079","owner":"T-036","milestone":"M3","levels":["contract"],"baseline":["darwin","linux","win32"]}`，字段与取值沿用既有索引及蓝图 AC-079 的 contract 级别。既有 74 条内容、相对顺序和 schema 标识保持不变；新总数为 75，不是 79，不补 AC-075..AC-078。当前 `test/fixtures/traceability/ac-index.json` 与修改前中央索引 JSON 完全一致，可作为独立的旧条目保留性依据，禁止修改该夹具。
   - `contracts/schemas/ac-index.schema.json`：当前 `ac` 使用 `^AC-\\d{3}$`，已经接受 AC-079，无枚举扩展需求，因此保持不变。未来若核查环境发现确有枚举，只增补 AC-079，保持旧 schema 文档和旧索引有效，不升级 schema 或改字段。
   - `scripts/check-traceability.mjs`：调整 `expectedAcs()`/`validateIndex()` 的范围校验，使完整原 AC-001..AC-074 与其末尾追加 AC-079 的形状均有效。旧完整索引仍用于既有追踪夹具；真实仓库必须由分片与追加条目断言确认包含 AC-079。继续拒绝原条目缺失、重复、乱序和未授权新增 ID，保留 `index.count` 等现有诊断及所有字段校验。不能单纯把上界 74 改成 79，也不能仅比较输入长度与自身推导长度。计数与遍历优先由已验证条目数组长度取得；原 AC 集合的完整性边界不能为消除数字常量而丢失。
   - `test/unit/traceability.test.mjs`：用旧完整夹具作独立参照，断言中央索引恰好等于旧条目加上述 AC-079 条目，并用 `legacy.acs.length + 1` 表达新总数，禁止自比较。原缺失反例不能再只 pop 可选扩展的尾条目，应删除一个原核心条目，继续断言 `index.count`；重复和乱序反例继续失败，数组索引改用实际长度或按 AC 查找。补充旧完整索引仍可校验和新条目精确归属的断言；不删测试、不降低反例约束强度。
   - 用户点名的 lock/contract 测试路径：若实施时已有准确的 AC 数量断言，按本轮授权改成源索引长度或旧基线长度加一，并保留原比较的实际结果与独立期望。当前无需修改；不要批量替换包含 74 的随机数常量、AC-074 标签或其他无关数字。既有 milestone 夹具不增加 AC-079，避免改变其已定义的 M1/M2/M3/M4 通过和阻断情景。
   - `contracts/golden/manifest.json`：中央索引属于冻结清单，本次授权追加后只刷新 `contracts/spec/ac-index.json` 对应的规范化 SHA-256；保留所有其他条目及其摘要。沿用 `scripts/check-golden-frozen.mjs` 的 CRLF 规范化算法，不关闭冻结检查、不修改黄金数据。若使用该脚本的 `--write` 生成清单，必须核实实际差异仅为获准索引摘要，不能顺带接受其他漂移。

   实施顺序为中央兼容及保持强度的测试迁移、四项交付物、索引清单摘要同步、独立验收及完整门禁。这些兼容变更是四项交付物的必要接线，不增加产品功能或 per-CLI 协议。

## 硬约束

实现仅写 front matter 路径，新增授权仅用于上述 AC 索引兼容；禁止修改 `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`、`lib/catalog.mjs` 及本轮已更新的模型代码。不放宽既有断言，不修改其他中央契约、冻结条目、检查器或测试框架。保持 Windows/PowerShell 7、UTF-8 无 BOM，不使用 Bash/WSL，不执行 git。

本轮 design 阶段只修改 design.md、acceptance.md，不修改代码、任务状态或旧 attention.json，不运行会生成文件或间接执行 git 的全量检查。下游在实现完成且获准执行测试的阶段运行 acceptance.md 命令；多步骤自动化按本机规范写为获准位置的 `.ps1`，原生命令后检查 `$LASTEXITCODE`。本轮未运行产品测试，不记录通过结果。

## 验收

以 acceptance.md 的独立命令及期望输出为准。本轮裁决已满足继续实施的前提；实现完成后必须保留 `node scripts/check-no-model-table.mjs` 的成功标记、夹具反例、真实 flow 接线、追加索引与旧索引兼容检查、追踪分片检查、既有单元测试零失败，以及项目 `scripts/check-fast.ps1` 门禁。原条目被修改、schema 失去兼容、冻结清单未同步均为失败。
