---
write_scope:
  - lib/config.mjs
  - lib/config-migrate.mjs
  - lib/commands/config/**
  - test/unit/config-v2.test.mjs
  - test/fixtures/config/**
  - test/traceability/T-014.json
  - lib/cli.mjs
---

# Task 014 — 配置 v2 与 v1 迁移（按仓库内迁移映射，quotas 映射为 pools）

## 目标

实现 T-014 / AC-034，依据 brief.md、蓝图 design.md、interfaces.md 第 6、7、10、11、13、15、16 节、task-graph.json，以及只读的 contracts/spec/migration-map.json、contracts/schemas/config.v2.schema.json、pool.schema.json 和 contracts/registry.snapshot.json。brief 未指定基准 commit SHA 或既有验收报告路径；不从其他任务借用基线。

本轮用户裁决取代上一版的待决结论：lib/cli.mjs 已获准纳入实现 write_scope，仅注册 config migrate 路由，沿用 T-005 的最小接入方式；bin/cliworker.mjs 保持原样。credits 与 remaining_usd 是独立池，不存在两者之间的换算率，不互转、不合并。不可换算余额按现有字段表达未知，并由 forecast 的既有 reason 说明原因、risk 为 unknown；pool schema 保持 additionalProperties=false，不增加字段。这两项不再需要 attention.json。

1. lib/config-migrate.mjs 承载内存加载和显式命令共用的转换逻辑。输入为无 schema 或 schema=cliworker.config/v1 时转换为 cliworker.config/v2，产生既有 W_CONFIG_V1 警告；原生 v2 只校验并加载，不重复迁移、不产生此警告。不修改传入对象。转换不执行 provider、不读取登录状态、不探测可用性；文件、环境、时钟均经 ctx 注入，时间只取 ctx.clock。
2. lib/config.mjs 保持 loadConfig({file, ctx})、路径解析、示例拒载和既有错误契约。先校验根对象与示例，再按版本校验；v1 仍要求 providers / models 为对象，原生 v2 按自身结构校验，不能要求其持久化 providers / models。未知配置 schema 按既有 E_CONFIG 失败。保留 T-013 的 SecretRef 和 E_CONFIG_SECRET_INLINE 行为。加载无 schema / v1 只在内存转换，绝不落盘；调用方可从运行时 warnings 观察 W_CONFIG_V1，显式迁移成功 JSON 同样包含该警告，原生 v2 无此警告。
3. models 映射到 catalog.manual、catalog.allow、catalog.levels。每个模型保留原键、id、provider、价格、身份、身份组、只读、弃用等既有语义；等级沿用现有 level / tier 解析行为，level_source 使用既有对象且 kind=config，ref 指向配置来源，at 使用注入时钟。不能把未验证身份或未探测可用性提升为 verified / callable。catalog.aliases、catalog.deprecated、discovery、policy 的字段和默认值取 interfaces 第 11 节；unknown_policy 默认采用已有 after_known，不把示例中的 after_known|reject 写成实际枚举值。
4. providers 映射到 discovery.cli_overrides，保留 CLI 路径、参数、adapter、只读等既有配置；密钥必须在复制前检测，不把明文秘密转移到 overrides 或 manual。secrets 只存既有 SecretRef。源 state_dir 通过 resolvePaths 按输入配置文件的位置和环境解析，显式迁移输出写解析后的绝对 state_dir，保证输出文件位于其他目录时状态位置不改变；缺省 state_dir 同样按源文件解析，不能因输出文件换目录重新生成状态位置。
5. quotas 逐项映射为 pools，不能用互斥分支吞掉同一 provider 同时提供的 credits 和 remaining_usd。池 id 使用 provider 与既有 kind 组合并保持确定、唯一，cli 指向对应 provider。每个池仅写 pool.schema.json 的八个既有必需字段。没有可信完整窗口时 window=null；不得从当前时间猜测窗口起点或 reset_at，也不得写缺字段的 window 对象。具体数值规则见下表。

| v1 输入 | v2 pools 与可观测行为 |
| --- | --- |
| remaining_pct | funding=plan；按明确窗口语义选择 plan_window / plan_weekly；used_fraction.value=1-remaining_pct/100，source=config，at 来自注入时钟。只知道百分比时 capacity_mtok={}，不能反推 token 容量。 |
| remaining 且 unit=tokens | 以 remaining/1000000 作为该配置快照的可用 Mtok 容量，对该 provider 的配置模型建立 capacity_mtok 的既有 value/source 项，source=config，used_fraction.value=0；这是剩余额度快照，不冒称原账户总容量。缺少明确计划窗口时使用无窗口的 paid / credits 池，不新增 kind。 |
| remaining 且 unit=credits | 独立 kind=credits、funding=paid 池。只有输入明确给出有限且正数 credits_per_mtok，才能用 remaining/credits_per_mtok 得到 Mtok 快照，按上一行填容量和零使用读数；该率只用于 credits 到 Mtok，绝不用于 USD。没有有效率时 capacity_mtok={}、used_fraction=null，已有有效率才保留，否则 credits_per_mtok=null。 |
| remaining_usd | 独立 kind=prepaid_usd、funding=paid 池；capacity_mtok={}、used_fraction=null、credits_per_mtok=null。不把 USD 当 credits 或 token，不从模型价格、样本、默认常数反推兑换率。 |
| 同一 provider 同时有 credits 与 remaining_usd | 输出两个不同 id、不同 kind 的池，分别应用上面两行；未知 USD 不能被已知 credits 的数值填充，未知 credits 不能借用 USD 余额。 |

不可换算的余额不写为 0、无限或默认容量，也不把原数字偷偷塞入 source、id、secrets、overrides 或新增属性。空 capacity_mtok 与 null used_fraction 是本次获批的持久化未知表示；具体原余额无法在当前 schema 内无损保留，不声称迁移无损，源文件必须保留。原因放在现有 forecast.reason 中：直接把此类池交给现有 buildForecast 时应为 capacity_unknown，status=unknown、risk=unknown、remaining_mtok=null、tasks_left=null；不用新增池字段或注册新码。若运行时以既有 credits quota 调用现有 normalizeQuota，沿用 credits_conversion_missing，不改其既有语义。测试对每个未知池分别预测，不能只对全部池求聚合后掩盖未知。

6. 当前 lib/select.mjs 仍读取 config.models / providers / quotas。为不越界修改消费方，lib/config.mjs 从 v2 的 catalog、cli_overrides、pools 构建这些既有字段的运行时兼容视图；只从 v2 重建，不继续依赖原始 v1 副本。采用不可枚举属性，_file / _home / warnings 也仅属运行时；显式序列化只挑选 v2 契约字段。不可换算的余额在兼容 quotas 中同样保持未知，不还原猜测的数字。一个 provider 的多个不可换算余额不叠加；无法用旧单 quota 结构表达的组合采用未知。此适配服务现有 draft 兼容，不在本任务重做池选模算法或 forecast 引擎。
7. lib/commands/config/ 实现 config migrate --in <v1> --out <v2>，沿用 run({argv, ctx, config}) 和共享 JSON 错误输出。lib/cli.mjs 仅增加该模块 import、ROUTES 项、resolveRoute 对 config/migrate 的识别及 CONFIG_FREE 中的 config，使命令在尚无默认配置时可启动；保留其他路由和未知命令判定。不得改 bin、劫持 argv 或通过导入副作用注册命令，也不得借此次接入改造全局警告/分发机制。
8. 命令校验参数，缺少输入/输出或同一路径用既有 E_REQUEST_INVALID；拒绝覆盖已有输出并用 E_CONFIG_EXISTS。先完成解析、秘密检查、转换和校验，再写新输出；失败不得改变源文件或留下成功形状的输出。输出为 UTF-8 无 BOM 的纯 v2 JSON，stdout 为单个既有成功 JSON（ok=true，并带 warnings），不自行定义新 envelope/schema；错误按已有 errorBodyFrom、退出码和 stderr 约定。显式输出不含 providers、models、quotas、_file、_home、warnings 等运行时字段。实际经 bin/cliworker.mjs 到达命令模块。
9. test/fixtures/config/ 提供合成 v1.json 及人工核对的期望数据，覆盖无 schema、显式 v1、原生 v2、百分比、tokens、带/不带有效率的 credits、USD、同一 provider 同时持有两种余额。保留有意义的价格/等级/身份/只读/弃用差异。期望数据不得调用被测迁移函数生成。夹具与测试均无真实凭据。
10. test/unit/config-v2.test.mjs 的本任务测试名包含 [AC-034]。逐条断言加载迁移及警告、输入对象/源文件不变、v2 校验、模型与 providers 映射、上述全部池分支、独立余额与未知 forecast、CLI 真实入口、路径语义、非法配置和秘密不泄露。遍历冻结迁移映射核对各 id 都有实际断言；检查 pool 顶层精确键集合以及嵌套 required、枚举、值域，不只检查 schema 字符串。保留零第三方运行时依赖。
11. draft 等价测试使用同一份 v1 夹具：先由公开 loadConfig 加载并 selectModels，再用真实 CLI 写入另一个目录的 v2、重新 loadConfig 后调用同一 selectModels。两边注入相同可用性、请求、时钟和用量；完整结果 assert.deepEqual，涵盖模型、call、quota、forecast、排序及 rejected，且显式断言 models 非空、call.command 有效、存在预定拒选原因和人工预期的模型顺序。比较双方均经过获批迁移语义；不可拿历史 USD 猜测结果当必须保持的余额行为。额外独立断言未知池的风险与原因，防止两边共同猜错仍通过。
12. test/traceability/T-014.json 严格沿用 interfaces 第 15 节：task=T-014、milestone=M2，entries 仅 AC-034，files 为 test/unit/config-v2.test.mjs，实际测试覆盖后 status=covered。不增加 AC、版本或追踪字段。

## 约束

实现 write_scope 为顶部七项；与 brief 相比仅按用户裁决加入 lib/cli.mjs，task-graph.json 的 T-014 当前也已包含该路径。lib/cli.mjs 的权限只限上述路由接入，不授权修复其他命令。本 design 角色只修改同目录 design.md 与 acceptance.md，不执行 git、不创建脚本或报告、不修改任何代码。

Node 20+ / ESM，零第三方运行时依赖，UTF-8 无 BOM。契约、迁移映射与既有范围外测试只读；运行时代码不得依赖 contracts/spec、contracts/golden 或 .collab。秘密不得进入配置输出、日志、stdout、stderr 或错误消息；错误不能回显原始配置值或含秘密的解析片段。T-013 的既有检测在加载与显式迁移两条路径都不能被绕过；依赖未交付时明确记录，不用明文透传替代。

## 建议验收方向

acceptance.md 只登记本任务属主 AC-034，按用户提供的 tools/ci-runner.ps1 提取契约整文件重写。一个 AC 只对应一个独立单行命令，全部检查成功才输出精确字符串 AC-034 OK；任一步失败即非零退出，不能无条件打印。命令使用绝对路径，从 TEMP 工作目录也可运行；ESM 导入若指向本地模块必须用 file:///C:/...。验收命令中的内联 JavaScript 是本轮强制单行格式的需要，不要求另建脚本文件。

AC-034 命令执行目标单测与正式 --ac 发现、校验运行清单/追踪分片，再运行既有配置、路径、draft 回归；测试自身必须覆盖真实 CLI 迁移、重新加载和完整 draft 深相等。报告使用独立系统临时目录，测试不得依赖前一次验收产物、默认配置、真实登录或真实 provider。

项目完成前仍按本机约定执行 pwsh -NoProfile -File C:/git/dsh-CLIWorker/.collab/worktrees/014/scripts/check-fast.ps1，期望退出 0 且输出 check-fast: ok；按 brief 执行 node C:/git/dsh-CLIWorker/.collab/worktrees/014/scripts/milestone-gate.mjs --milestone M2，期望退出 0 且输出 milestone-gate M2: PASS。这两项是下游集成检查，不单独发明 AC，不把其他任务未交付包装为 AC-034 通过或 M2 通过；失败保留归属证据，不越界修改。当前 design 阶段不运行它们：它们会生成额外文件，check-fast 的检查链还可能调用 git，与本角色限制冲突；下游在其授权范围内执行。本轮仅校验设计产物格式，未声称实现测试通过。

## 非目标

不修改 brief.md、impl.md、review*.md、verdict*.json、state.json、run.json、冻结 contracts 或任何代码，不创建其他文件。不实现其他里程碑任务，不新增余额字段或换算规则，不把余额未知当作零余额，不以模块直接调用替代公开 CLI 验收。