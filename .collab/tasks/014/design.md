---
write_scope:
  - lib/config.mjs
  - lib/config-migrate.mjs
  - lib/commands/config/**
  - test/unit/config-v2.test.mjs
  - test/fixtures/config/**
  - test/traceability/T-014.json
---

# Task 014 — 配置 v2 与 v1 迁移（按仓库内迁移映射，quotas 映射为 pools）

当前不能进入实现：下述两处冲突需要先由人类裁决，已通过同目录 attention.json 提请调度器暂停。本文记录已确定的要求，不授权扩大 write_scope，不为缺失的数据表示发明字段。acceptance.md 是裁决后实现的验收要求，不是已通过的验收报告。

已核对交班单 design-r1-c1-to-c2.md 中的 git status、diff 摘录和本阶段产物状态：上一候选有 0 个已跟踪文件改动，design.md、acceptance.md 均不存在，唯一未跟踪项是 .collab/tasks/014/state.json。没有可以继承的代码或设计改动；保留现有现场是因为没有需要回滚的候选实现，且 state.json 是本角色禁止修改的文件。未执行 git 命令，未回滚或删除文件。交班单只用于核对现场，不作为规格来源；其中的 checkpoint 不是 brief 指定的基准提交。brief 未给出基准 commit SHA 或既有验收报告路径。

## 目标

依据 brief.md、蓝图 design.md、interfaces.md 第 6、10、11、13、15、16 节与 task-graph.json 的 T-014 / AC-034。字段、枚举和格式同时对照仓库内 contracts/spec/migration-map.json、contracts/schemas/config.v2.schema.json、pool.schema.json、model.v1.schema.json；这些契约只读。

裁决后按以下顺序实现；依赖 T-004、T-005、T-013 的交付应先可用，不能把缺失依赖默认为已经完成。

1. lib/config-migrate.mjs 提供加载和显式迁移共用的转换逻辑。无 schema 与 schema 为 cliworker.config/v1 进入同一迁移分支，输出 cliworker.config/v2；原始输入不被修改。原生 v2 不重复迁移，不产生 W_CONFIG_V1。未知 schema 继续按现有配置错误契约失败。转换本身不执行 provider、不探测可用性、不写源文件；所需时间经 ctx.clock 注入，不从全局时钟获取。
2. lib/config.mjs 保持 loadConfig({file, ctx})、路径解析、运行时 _file / _home、示例拒载及 E_CONFIG 错误语义。保留 T-013 的明文密钥检测与 SecretRef 行为。无 schema / v1 加载只在内存转换，并给 W_CONFIG_V1；加载不可落盘或改写输入。原生 v2 按 v2 结构加载，不能继续强制要求持久化的 providers / models。运行时路径元数据与警告不可混进迁移输出的配置文件。
3. 模型转换严格对应 config.models：models 的内容进入 catalog.manual，模型键进入 catalog.allow，等级进入 catalog.levels；等级来源按已有 level_source 对象表达，kind 为 config。保留模型 id、provider、价格、身份、只读与弃用信息的语义，不能把未知身份或可用性自动提升为 verified / callable。catalog 的其余字段和 discovery / policy 默认项取 interfaces 第 11 节，不定义新的 schema 名或默认版本。
4. providers 按 config.providers 转为 discovery.cli_overrides，保留 CLI 路径、参数和只读配置。不得把明文 token 从 providers 或其他输入位置带到 overrides、manual、错误体或日志。
5. quotas 按映射中的四条记录分别处理：remaining_pct 为 funding=plan 的池，used_fraction.value = 1 - remaining_pct/100；remaining + unit=credits 为 kind=credits；remaining_usd 为 kind=prepaid_usd；unit=tokens 为容量已知的池。credits_per_mtok 仅沿用输入中已有的换算率。不能伪造容量、余额、重置时刻或窗口；不能删掉余额后宣称迁移成功。credits / USD 的准确存储表示是待决冲突，当前不指定实现。
6. lib/commands/config/ 下实现命令模块，沿用现有命令模块 run({argv, ctx, config}) 和共享 JSON 错误输出约定。显式迁移与内存迁移共用转换；源输入保持不变，输出只含契约内 v2 配置字段，UTF-8 无 BOM，stdout 为单个 JSON。CLI 必须实际通过 bin/cliworker.mjs config migrate --in ... --out ... 到达此模块，不能用直接 import 命令模块的测试代替入口验收。路由如何接入是待决冲突，当前不指定越界修改。
7. test/fixtures/config/ 内提供合成、无真实凭据的 v1 配置及可核对的 v2 期望值，覆盖无 schema、显式 v1、原生 v2、四种 quota 形状，以及模型等级、身份、弃用与只读差异。期望值由仓库迁移映射和获批的数据表示确定，不能由被测迁移函数生成。
8. test/unit/config-v2.test.mjs 的本任务用例标记 [AC-034]。分别覆盖内存迁移及警告、原生 v2、模型与 providers 映射、四种 pools 映射、显式 CLI 迁移与源文件不变、非法配置/密钥不泄露、迁移前后 draft 选模完整结果深相等。选模比较使用相同请求、伪时钟、用量和注入可用性，断言非空候选及有意义的拒选集合，不能通过两边均为空或只比较模型键让测试通过。迁移后必须重新加载实际输出文件再比较，避免测试只覆盖尚保留旧字段的内存对象。
9. test/traceability/T-014.json 使用 interfaces 第 15 节已有分片格式：task 为 T-014、milestone 为 M2，entries 只登记 AC-034，files 指向 test/unit/config-v2.test.mjs，实际覆盖后 status 为 covered。不新增 AC、字段或追踪 schema。

## 约束

write_scope 严格等于 brief 中六项；上述计划中的待决事项不构成任何隐含授权。

- CLI 冲突：lib/cli.mjs 的 ROUTES 与 resolveRoute 是静态分发，CONFIG_FREE 只有 paths、init；config migrate 在调用 loadConfig 之前即被拒绝。lib/cli.mjs 与 bin/cliworker.mjs 均不在 write_scope。仅新增 lib/commands/config/ 文件不会被加载。现场只读复现的退出码为 2，stdout 的 error.code 为 E_UNKNOWN_COMMAND、message 为 unknown command: config migrate，stderr 为空，没有生成输出文件。不得通过 import 副作用、劫持 process.argv 或其他绕过分发的方式补接命令。
- 余额表示冲突：pool.schema.json 的顶层只允许 id、cli、kind、funding、window、capacity_mtok、used_fraction、credits_per_mtok，additionalProperties=false；没有 credits 余额或 USD 余额字段。迁移映射只指定目标池类别，没有说明这些余额如何无损表示。尤其正数 credits 且无换算率、以及 remaining_usd 的输入，不能按现有契约直接表达为模型 token 容量。契约文件和相关消费方均不在 write_scope。不能擅加 remaining、remaining_usd、原始 quotas 备份等字段，也不能改变既有字段含义充当余额。
- attention.json 请求先明确 CLI 接入归属/范围及余额的契约表示，再完成设计；没有默认推定批准的修复方案。保留 AC-034 全部要求，不能把真实 CLI 验收降为模块调用，不能静默忽略 quota。
- 零第三方运行时依赖，Node 20+ / ESM；文件 UTF-8 无 BOM。运行时不得读取 contracts/spec、contracts/golden 或 .collab；测试可以用随仓库的迁移规格作为预期依据。
- 当前工作区尚无 T-013 的 lib/secrets/、test/traceability/T-013.json；M2 总门禁还包含其他任务。不能修改本任务范围外的代码、测试或追踪分片来使总门禁通过。

## 建议验收方向

命令与通过条件见 acceptance.md。当前只做了源文件读取和 CLI 未知命令复现，没有运行会生成测试报告或调用 git 的检查。scripts/check-fast.ps1 存在，裁决后由实现/验收阶段执行；其调用的检查和全量测试会产生额外文件，本 design 角色的仅写产物限制不允许在此阶段执行。不能把未运行记为通过。

## 非目标

不修改 brief.md、impl.md、review*.md、verdict*.json、state.json、run.json 或任何代码文件；本阶段只新建设计与验收产物，并按用户明确的歧义处理例外写 attention.json。不实现其他里程碑任务，不改冻结规格，不在设计中自行扩大写入范围。
