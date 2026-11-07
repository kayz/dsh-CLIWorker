# CLIWorker v2 收口评审 · 最终会议纪要

> **会议性质**：Studio 只读讨论。本纪要为书记对讨论材料的归纳记录，全程未修改、创建或删除任何文件。
> **书记声明**：纪要区分「用户已确认」与「草稿」。用户仅就主持汇总提出的 5 个 blocking 问题作出答复（均为 `default_adopted`）；主持汇总 `decisions` 中的 8 条系专家共识／主持默认项，未见用户逐项确认，一律记为草稿，不代表最终决定。

## 一、背景

**仓库定位**：目标仓库 `C:\git\dsh-CLIWorker`（DSH 插件 `dsh-cliworker`，Node 20+ ESM、零运行时依赖）是 AgentLine 的独立模型层——provider/CLI 管理、模型目录与身份、价格、额度、消耗速度、预测、排序与降级全部归 CLIWorker；AgentLine 只保留 level / count / usage 入参与 `calls[]` 出参。

**Blueprint 现状**：两轮评审产物位于 `.collab/blueprint/cliworker-v2/`：`design.md`(26KB)、`interfaces.md`(14KB)、`risks.md`、`task-graph.json`(68KB)，以及 `test-strategy.md`、`acceptance-matrix.md`、`testability.json`；`review-v1.verdict.json`（revise，11 条 blocking）、`review-v2.verdict.json`（revise，4 条 blocking）。任务图规模：6 个里程碑、24+ 任务、70+ 条验收。

**已定稿需求（不再发散）**：
1. 修复现有缺陷：配额形状与预测器不匹配（`remaining_pct` / `credits` 恒 unknown）、打包漏 `bin/` 与 `config/`、无 `scripts` 且 `node --test test` 在 Node 22 报 MODULE_NOT_FOUND、usage 落盘与 `--config` 无关、`.gitignore` 规则永不命中。
2. 扫描本地硬盘发现已安装 CLI，覆盖 Linux / macOS / Windows / WSL；已知清单 codex、claudecode、dsh、cursor、codebuddy、antigravity、trae、zcode、qoder、kimi、opencode；登录 token 由用户提供。
3. 为每个 CLI 获取受支持的模型列表（按 CLI 分别实现，失败回退手工补录，不写死模型表）。
4. 模型管理：白名单（非白名单不处理）、四档等级、小 token 真实 probe 的可用性、用量评估（读 CLI 计划额度与余额 + 按实际使用估算可用 Mtoken，例：claude 5h 窗口 opus 2M / sonnet 10M，用掉 50% 后线性递减）、按可用量选模并尽量用足时间窗口限额、充值额度兜底、知道额度刷新时刻。
5. 模型管理界面与实时数据（缺样本显示 unknown，不伪造）。
6. 返回 CLI 调用方式并带上选定 model。

**待裁决议题**：Q1 身份证据的所有权（codex `exec --json` 事件流不提供实际模型字段，AgentLine 把「未提供身份」判为硬失败，导致 codex 无法担任设计／评审角色；用户判断这是「来源」问题，应在调用失败时切换，身份与可用性由 CLIWorker 统一处理）；Q2 梯度替换（Top/High/Middle/Quick 各档备候选，按档位降级而非静默换低档）；Q3 剩余 4 条 blocking 的处置（可推进伪时钟、冻结注册表权威 oracle 的仓库内单一真源、AC-070 与 ci-matrix 矛盾、AC-005 sha256 冻结范围）；Q4 范围与顺序（6 里程碑是否合并、M1 是否独立先合、70+ 验收是否过重）。

**已知环境事实（供判断，未再验证）**：本机仅装 codex、claude、codebuddy、cursor-agent；gemini / kimi / opencode / trae / qoder / antigravity / zcode 均未安装。AgentLine 只读白名单只认 claude-cli / codebuddy-cli / codex-cli，cursor 系无强制只读模式。claude 7 天额度使用率已达 78%，overage 被组织禁用，顶级模型调用有配额风险。

## 二、观点

### 专家 A
- **Q1**：每个 provider 加 `identity_evidence: {source: stream|cli_flag|config|none, strength: verified|asserted|unknown}`；codex 填 `cli_flag + asserted`（显式传 `-m` 证明请求了哪个模型，证明不了实际跑哪个）。AgentLine 按角色设最低强度：评审、仲裁要求 `verified`，设计和实现接受 `asserted`；强度不够换下一个候选，不再硬失败，每次写入 `calls[].identity` 以便审计。
- **Q2**：候选序列放 pool 层按档位排序；白名单只决定能不能用，目录只放事实。档内换候选算正常替换；跨档必须同时满足 `allow_downgrade: true` 且 `calls[]` 带 `downgraded_from`，缺任一条返回 `E_TIER_EXHAUSTED`，不允许静默降级。
- **Q3**：① `ctx.clock` 提供 `advance` 和 `setNow`，生产代码只经 `ctx.now()` 取时间；② interfaces 第 1～15 节、金标与映射表迁入 `contracts/*.json` 并提交仓库，运行时不读 `.collab/`；③ AC-070 允许标记 `manual-baseline`，凭真机 smoke 报告签收，CI 不要求此类 AC pass，WSL 也归入此类；④ AC-005 的 sha256 只冻结 `contracts/`，不冻结 `lib/`。
- **Q4**：M1 必须独立先合（`package.json` 的 `files` 不含 bin/config、无 scripts 均为现成缺陷）；其余 5 个里程碑合为 3 个：发现与目录、额度与预测、选模与界面；验收收缩到约 30 条，大部分改契约测试，只保留 probe、真机发现、reset_at 推进、端到端选模做集成/E2E。
- **主要风险**：claude 7 天额度已用 78%，若 Top 档只有 opus 很快耗尽，Top 档至少要有一个跨厂商备选（codex）。

### 专家 B
- 立场：只读查看现有评审与契约，独立裁决，重点检查四条阻塞项能否闭环。
- **Q1**：身份归 CLIWorker——记录请求模型、实际回报、证据来源／强度／时效；缺失标 unknown、允许调用，明确冲突才拒绝；AgentLine 消费结果，不重复硬判。
- **Q2**：目录存档位、策略存替换顺序、池只管额度；默认同档替换，跨档须预授权并返回原档／实际档／原因，禁止静默降级。
- **Q3**：interfaces 已补四项方案但须落仓验证：可推进时钟含定时器；版本化单一真源；AC 绑定真实 pass 来源、豁免单列；哈希仅冻结旧副本，当前实现由行为测试约束。
- **Q4**：M1 独立合入；六阶段可保留用于追踪但无须六次发布；70+ 验收保留追踪，公式／枚举转契约测试，打包、跨进程、平台调用、鉴权保留集成/E2E。
- **主要风险**：`reset_at` 仅为估计却直接清零，会虚增可用额度。

### 专家 C
- **Q1**：身份改为「证据」而非布尔值；provider 输出 `identity:{source:cli_reported|env|transport|assumed, strength:strong|weak|none}`，真正强的证据是 CLIWorker 选模时写回的 `selected_model`。AgentLine 按强度分派：strong 正常使用；weak 允许调用、失败即切、结果标 `provisional`；none 不得静默通过但也不整体排除渠道。原「硬失败」改为「触发 fallback」。
- **Q2**：白名单=准入、目录=元数据、池=`tier→[candidates]`+替换策略；同档替换可 silent-ok；跨档必须产出显式 `degrade` 事件（tier_from / tier_to / reason），未授权跨档直接返回 error，不降级。
- **Q3**：① 可推进伪时钟（`advance()` 驱动 now），仅可替换不够；② 注册表快照落仓库 `src/registry/*.json` + sha256 守护测试，blueprint 只做引用；③ AC-070 增第三态 `environment-blocked`（须附证据，不计 pass 也不计 fail）；④ AC-005 钉 schema 键名与事件类型，不钉文件与实现。
- **Q4**：M1 必须独立先发（0.2.0 只修缺陷），M2–M6 压成 2 个里程碑；留 5 条端到端主链路做 E2E，其余降为契约／单元测试。
- **最大风险**：claude 7d 已 78% 且 overage 禁用，Top 档不得默认 claude，需 codex/codebuddy 兜底；只读白名单排除 cursor 系，梯度池实际仅 3 个 provider，别按 11 个设计。

### 共识与分歧
- **共识**（主持汇总）：M1 独立先合；身份改为可审计证据；跨档降级显式授权；采用可推进时钟及仓库内契约真源。
- **分歧**：① 低强度身份能否参与评审／仲裁（A 要求 verified、codex 不得承担；B/C 允许参与并 provisional/fallback）；② 时钟覆盖范围（B 强调定时器）；③ 真源落点（A `contracts/*.json`、C `src/registry/*.json`、B 版本化单一真源）；④ AC 豁免语义（A manual-baseline、C environment-blocked、B 绑定真实 pass）；⑤ 哈希口径（A 冻结 contracts/、B 冻结旧副本、C 只钉 schema 键名与事件类型）；⑥ 里程碑压缩（A 3 个、B 保留 6 个追踪、C 2 个）；⑦ 验收载体（A 收缩至 ~30、B 保留追踪、C 仅 5 条主链路 E2E）。
- **风险汇总**：claude 配额 78% 且 overage 禁用下的 Top 档单点（A、C）；估计 `reset_at` 直接清零虚增额度（B）；真实可用 provider 仅 3 个（C）。

## 三、问题与回答

> 主持汇总提出 5 个 blocking 问题，用户答复均为 `status: default_adopted`（采纳默认选项）。采纳默认即构成用户确认；未被选中的备选项视为未采纳。

1. **Q-1｜codex 只有 cli_flag/asserted 级身份证据时，能否担任评审和仲裁角色？**
   答：**允许 asserted 参与所有角色，结果标 provisional，失败或身份冲突即切换并完整审计；unknown 不得静默通过**。（`default_adopted`）
   影响：专家 A 的「评审、仲裁必须 verified，codex 仍不能承担评审和仲裁」未采纳；codex 不因身份强度被整体排除。
2. **Q-2｜AC-070 与部分 AC 无法在当前 CI/本机产生 pass 的矛盾如何收口？**
   答：**同时引入 manual-baseline 和 environment-blocked：前者凭真机 smoke 签收，后者必须附环境证据；两者均不计 pass，豁免单独列出**。（`default_adopted`）
   影响：「仅增加 environment-blocked」与「维持 AC-070 原文、不允许豁免」均未采纳。
3. **Q-3｜AC-005 的 sha256 冻结范围应采用哪种口径，才能避免阻断 M1 对 package.json、bin/ 和 config/ 的修复？**
   答：**仅冻结 contracts/ 内版本化契约及注册表快照，并覆盖 schema 键名和事件类型；不冻结 lib/、bin/、config/，M1 行为另测**。（`default_adopted`）
   影响：「只冻结旧实现副本」与「不冻结文件哈希、只钉 schema 键名和事件类型」均未采纳。
4. **Q-4｜M1 之后的里程碑采用哪种组织结构？**
   答：**M1 独立发布，M2–M6 合并为发现与目录、额度与预测、选模与界面三个里程碑**。（`default_adopted`）
   影响：专家 B 的「保留六个里程碑用于追踪」与专家 C 的「压缩为两个里程碑」均未采纳。
5. **Q-5｜70+ 条验收是正式裁减，还是保留追踪并合并执行载体？**
   答：**保留全部 AC 编号与追踪关系，归并为约 30 个可执行检查，公式和枚举走契约测试，仅约 5 条主链路保留 E2E**。（`default_adopted`）
   影响：「正式裁减为约 30 条 AC」与「70+ 条每条继续独立可执行」均未采纳。

## 四、决策

### 4.1 用户已确认的决策（来自「问题与回答」，均为 `default_adopted`）
1. **低强度身份可参与所有角色**：codex 的 `cli_flag/asserted` 级证据允许担任设计、实现、评审、仲裁角色，结果标 `provisional`；调用失败或身份冲突即切换候选并完整审计；`unknown` 不得静默通过。身份证据统一由 CLIWorker 输出，AgentLine 不再对「未提供身份」重复硬判。（Q-1）
2. **AC-070 收口**：同时引入 `manual-baseline`（凭真机 smoke 报告签收）与 `environment-blocked`（须附环境证据）；两者均不计 pass，豁免单独列出。（Q-2）
3. **AC-005 冻结范围**：仅冻结 `contracts/` 内版本化契约及注册表快照，并覆盖 schema 键名与事件类型；不冻结 `lib/`、`bin/`、`config/`；M1 对 package.json / bin / config 的修复由行为测试另行约束。（Q-3）
4. **里程碑结构**：M1（缺陷修复）独立先合、独立发布；M2–M6 合并为「发现与目录」「额度与预测」「选模与界面」三个里程碑。（Q-4）
5. **验收组织**：保留全部 70+ AC 编号与追踪关系，归并为约 30 个可执行检查；公式、枚举、排序及降级规则走契约／单元测试；仅约 5 条主链路保留 E2E。（Q-5）

以上 5 条为本次讨论中**唯一经用户确认**的决定；凡与专家观点或主持默认项不一致之处，以用户采纳的默认选项为准。

### 4.2 草稿决策（主持汇总 `decisions` 默认项，未经用户逐项确认，仅作草稿，不得视为最终决定）

| # | 决策标题 | 说明（摘要） | 默认选项 | 状态 |
|---|---|---|---|---|
| 1 | 身份证据统一归 CLIWorker | 统一输出 requested_model、reported_model、selected_model、source、strength 与观测时间；strength 采用 verified/asserted/unknown；缺失证据不判死整个 provider，明确冲突才拒绝；AgentLine 消费结果、失败触发 fallback，证据及 provisional 写入 `calls[].identity` | 采用统一证据对象和候选级 fallback，不再由 AgentLine 对「未提供身份」重复硬判 | 草稿（Q-1 已就 asserted 适用范围作出更具体裁定，以 4.1-1 为准） |
| 2 | 梯度替换放在池层 | 白名单只管准入，目录保存事实与档位元数据，池保存 tier→有序 candidates 及替换策略；同档替换须记录；跨档须预授权 `allow_downgrade=true` 并返回 degrade 事件、tier_from/tier_to/reason/downgraded_from，否则 `E_TIER_EXHAUSTED` | 同档可替换、跨档显式授权且可审计，禁止静默降级 | 草稿（无对应用户答复） |
| 3 | 建立仓库内单一契约真源 | interfaces 锚点、金标、映射与冻结注册表迁入版本化 `contracts/*.json`；blueprint 仅作历史引用；运行时与测试不依赖 `.collab/`，以守护测试校验契约及哈希 | `contracts/` 是唯一权威来源，不以 `src/` 或 `.collab/` 另建平行真源 | 草稿（Q-3 已确认冻结范围，重合部分以 4.1-3 为准） |
| 4 | 时钟必须可推进且覆盖定时器 | `ctx.clock` 提供 advance、setNow 与可控定时器，生产代码只能通过 `ctx.now()` 读取时间；reset_at 跨越测试由伪时钟推进完成 | 仅支持替换时钟不满足验收 | 草稿（无对应用户答复） |
| 5 | M1 作为独立缺陷修复版本 | 先修配额形状、打包遗漏、测试 scripts、usage 配置路径与 .gitignore，独立合入发布；后续重构不得成为 M1 前置依赖 | M1 单独验收和发布，不等候后续里程碑 | 草稿（Q-4 已确认 M1 独立发布，以 4.1-4 为准） |
| 6 | 集成与 E2E 只保留真实边界 | 打包、跨进程调用、真机发现与 probe、平台/WSL、鉴权、reset_at 推进、端到端选模保留集成或 E2E；公式、枚举、排序及降级规则降为单元／契约测试 | 保留完整验收追踪，但不把全部验收都做成高成本 E2E | 草稿（Q-5 已确认验收组织，以 4.1-5 为准） |
| 7 | 估计 reset_at 不得直接清零 | 只有来源明确且已确认的额度刷新才将 used_fraction 归零；估计刷新时刻到达后重新读取或标 unknown/stale | 确认刷新才清零，估计刷新只触发复核 | 草稿（无对应用户答复） |
| 8 | Top 档按真实三-provider 池设计 | 只读白名单实际仅 claude、codebuddy、codex，不含 cursor 系，不按 11 个 provider 假设容量；claude 7d 78% 且 overage 禁用，Top 档不得只有 claude/opus，至少配 codex 或 codebuddy 跨厂商候选 | Top 档必须有非 claude 兜底，并优先控制 claude 配额消耗 | 草稿（无对应用户答复） |

书记说明：4.2 全部为主持汇总给出的专家共识／默认项，用户未在本次问答中逐条确认；其中与 Q-1/Q-3/Q-4/Q-5 重合的部分以 4.1 用户答复为准，其余（#2、#4、#7、#8）为纯草稿。本纪要不含书记自行作出的任何决定；草稿项须经用户确认后方可成为正式决策。以下 JSON 为 4.2 决策默认项的结构化记录，`default` 字段即默认选项，不代表用户最终裁定。

## 修订记录（第 1 轮）
- 专家 expert_c 拒绝：不能按现状收口，反对以「剩余 4 条 blocking 已处置」为前提确认。

1) 基线过期，且此前被略过的 blocking 仍未闭环。仓库内除 v1/v2 还有 .collab/blueprint/cliworker-v2/review-v3.verdict.json（round 3，revise）：7 条 open，其中 F-02、F-05 为 blocking——F-02 指出 contracts/golden/** 与 contracts/spec/** 无逐文件 sha256 清单、check-golden-frozen 未进 check-fast、无检查器强制 write_scope；F-05 指出 [repro] 段无变异 canary 且不受哈希保护。纪要通篇未提 v3，Q3 只处置了原 4 条中的 AC-070 与 AC-005；可推进时钟(D-4)、仓库内单一真源(D-3) 仍是草稿，从未提交用户确认，却与「已解决」混同。在 F-02/F-05 open 时确认收口，等于把两条 blocking 静默丢弃。

2) Q-3 的已确认口径与蓝图现状正面冲突，无法直接实施。Q-3 采纳的是「冻结 contracts/ 契约与注册表快照，覆盖 schema 键名与事件类型，不冻结 lib/bin/config」，并明确否决「只冻结旧实现副本」；但 design.md:28 与 design.md:126-127 的 AC-005 恰是只冻结 v0.1 副本与 stable.test.mjs、清单外路径直接失败，v3 的 F-08 也把「只冻结 0.1 副本」记为已解决。实现方无法同时满足。须先裁定：contracts/spec+golden 走逐文件哈希守护；contracts/registry.snapshot.json 只做版本化 + compareRegistry + snapshot_version 递增，不得哈希冻结，否则 M2 发现新模型即被守护测试卡死；v0.1 副本仅作回归夹具。

3) 4.1-1 超出 Q-1 的原文授权。Q-1 答复只覆盖「asserted 可参与所有角色、结果标 provisional、失败或身份冲突即切换、unknown 不得静默通过」；「身份证据统一由 CLIWorker 输出、AgentLine 不再重复硬判」属 D-1 默认项，仍是草稿。把 D-1 内容写进「用户已确认」，会让 requested/reported/selected、source、strength、observed_at 这套字段以未经确认的形式被冻结。

4) 其余四项我无异议：Q-1/Q-2/Q-4/Q-5 与我的立场一致或为可接受超集（三里程碑的粒度争议可容忍；全部 AC 编号保留、约 30 个可执行检查、5 条主链路 E2E 可行）。但 Q-2 需补可执行的收口条件：manual-baseline 与 environment-blocked 必须单独成表，并由 CI 校验「既不计 pass 也不计 fail、skip 不得折算 pass」，否则 AC-070 会被 skip 消解。

5) D-5 前提经核实成立：package.json 无 scripts，files 仅 lib、cordis.patch.yml、dsh.plugin.json、README.md，确缺 bin/ 与 config/，M1 独立先合可行。但 M1 若仍按 v3 的 AC-005 口径（只冻结 0.1 副本）执行，将与 Q-3 冲突，须先改 test-strategy 再进 M1。

处理建议：暂不以本纪要收口。重发纪要需 (a) 补入 v3 的 2 条 blocking 与 5 条 major，逐条给出处置或显式豁免；(b) 将 D-3、D-4、D-7、D-8 提交用户确认，其中 D-4（advance/setNow 伪时钟）是 AC-028/029 的可测性前提，不宜留作草稿；(c) 修正 4.1-1 的授权范围；(d) 按第 2 点改写 Q-3 冻结口径并与 design.md:28、design.md:126-127 对齐。
- 状态：等待用户处理

- 用户处理（answer）：基线更正：Blueprint 已完成第 3 轮（非第 2 轮），当前剩余 2 条 blocking（F-02 金标 oracle 可静默漂移、F-05 缺陷档案缺变异 canary），testability 尚余 6 条 open blocker。之前纪要引用的「剩余 4 条 blocking」是过期基线，特此更正。用户已决定：接受现有设计直接进入 Build，这 2 条 blocking 不作为设计收口前提，而是作为 M1 任务的强制验收项带入实现阶段（对应 AC-073 与 AC-005）；其余 testability blocker 按 Q-2 选定的 manual-baseline / environment-blocked 口径记录，均不计 pass。请据此重新评估是否确认纪要。

## 修订记录（第 2 轮）
- 专家 expert_c 拒绝：方向（先进 Build、把 F-02/F-05 降为 M1 强制验收）可以接受，但当前映射与冻结口径仍不自洽，按现状确认会第二次把 blocking 静默消解，故暂不确认。已核验：.collab/blueprint/cliworker-v2/review-v3.verdict.json 存在，round 3 为 revise，F-02/F-05 status=open 且 severity=blocking，F-01/F-03/F-04/F-06/F-07 为 open major；testability.json 的 TB-1..TB-6 全部 open，与「6 条 testability blocker」一致；package.json 无 scripts、files 仅 lib/cordis.patch.yml/dsh.plugin.json/README.md，D-5 前提成立；contracts/ 目录尚不存在（Q-3 的冻结对象还不存在，AC-073/AC-005 无从落地）。必须处理：1) F-02→AC-073、F-05→AC-005 的映射不成立。AC-073 原文只校验 git 跟踪 + 各自 schema + check-no-collab + docs/contract.md 逐字节一致 + snapshot 内容，没有 contracts/golden/** 与 contracts/spec/** 的逐文件 sha256 清单，没有 check-golden-frozen 纳入 check-fast，没有检查器强制 write_scope——这正是 F-02 认定的缺口；AC-005 原文只要求 [repro] 对副本断言缺陷存在并通过，无变异 canary，且 [repro] 段不受任何哈希保护——这正是 F-05 认定的缺口。这两条以现有文本进 M1 无法失败，mandatory 验收项形同虚设，等于换一种方式丢弃 blocking。须在纪要或 test-strategy 中直接写出加强后的可判据：golden/spec 逐文件哈希清单 + check-golden-frozen 进 check-fast + write_scope 强制者；每条缺陷一类变异 canary（用已修复的 v0.1 变体跑 repro 必须失败）+ repro 与 fixed 分离或 [repro] 段登记哈希由 check-defects 校验。2) Q-3 与 AC-005 文本正面冲突，实现方无法同时满足。design.md:26-28 与 task-graph AC-005 明写 frozen-files.json 只登记 test/fixtures/characterization/v0.1/ 与 stable.test.mjs，且「清单出现任何其他路径（包括 lib 下路径）时直接失败」，因此无法把 contracts/ 纳入冻结清单；须同步改写 AC-005 与 check-frozen-files 的允许集合为「v0.1 副本 + stable.test.mjs + contracts/spec/** + contracts/golden/**」，并把 lib/bin/config 明确列为禁止登记，否则 M1 要么违反 Q-3，要么违反 AC-005。3) 「冻结注册表快照」需显式豁免哈希。registry.snapshot.json 若做 sha256 冻结，M2 一发现新模型即被守护测试卡死，与 F-02 要求的 snapshot_version 递增/compareRegistry 语义冲突；建议写成「spec+golden 逐文件冻结，registry.snapshot.json 只版本化 + compareRegistry + snapshot_version 递增，不冻结哈希，v0.1 副本仅作回归夹具」，并注明该例外优先于 Q-3 的字面表述。4) 把 TB-1/TB-3/TB-4/TB-6 归入 manual-baseline / environment-blocked 是分类错误，属把可修复的规格缺陷永久豁免：这些都不是环境不足（时钟变量双语义与 health/doctor 判定、全跳过文件导致集合相等在三 OS 必失败、a1-quota 双属主同写 test/characterization/defects 且 write_scope 重叠、ac-index 属主三处矛盾、T-002 缺 T-004 依赖）。其中 F-04 的写冲突与 F-07 的依赖缺失会直接阻断 M1 执行，F-03 会让 ubuntu/macos 完整运行必然失败；必须在 M1 前修 task-graph 与 test-strategy，只有 WSL 真机 discover、probe 之类才适用 Q-2 豁免，且豁免仍需单独成表并由 CI 校验「既不计 pass 也不计 fail、skip 不得折算 pass」。5) D-1 的字段集（requested_model/reported_model/selected_model/source/strength/observed_at）仍只是默认项：Q-1 授权的是「asserted 可参与所有角色、结果标 provisional、失败或身份冲突即切换、unknown 不得静默通过」这一行为规则，不覆盖字段冻结；纪要若要固化字段，须单列确认或明确标注为默认采纳，不得并入「用户已确认」。6) D-7（估计 reset_at 不得直接清零）与 D-8（Top 档必须有非 claude 跨厂商兜底）仍为草稿且我在 design.md 未找到锚点（grep reset_at/used_fraction/E_TIER_EXHAUSTED/allow_downgrade 在 design.md 无实质命中，仅 registry 表提到 identity 枚举）；D-2 的 degrade/E_TIER_EXHAUSTED 与 D-4 的可推进时钟已在 design（AC-007/AC-072、F-08 已判 resolved）落地，可按事实采纳。转为 accept 的最小条件：把上述 1-4 的加强文本写进 AC-005/AC-073 与 test-strategy，明确 registry 快照豁免哈希，修好 F-04/F-07 的图冲突，并把 TB 豁免重新分类；这四项是文本与图内可完成的修改，不需要重跑蓝图评审。
- 状态：等待用户处理

- 用户处理（answer）：六条已按可判据改造完成（改的是图与策略，没有重跑蓝图评审）：1) AC-005 重写：冻结允许集合恰为 v0.1 副本 + stable.test.mjs + contracts/spec/** + contracts/golden/**，lib/、bin/、config/、scripts/ 明列为禁止登记；新增每条缺陷的变异 canary（用已修复 v0.1 变体跑 repro 必须失败，否则 check-defects 失败），[repro] 与 [fixed] 分离且 [repro] 段 sha256 登记。2) AC-073 重写：contracts/golden/manifest.json 逐文件 sha256，check-golden-frozen 纳入 check-fast，新增 check-write-scope 报出登记清单外与 write_scope 外的变更。3) contracts/registry.snapshot.json 明确豁免哈希，只做 snapshot_version 递增 + compareRegistry，该例外优先于字面冻结。4) F-04 写冲突已解：a1-quota.test.mjs 单一属主为 T-002，T-006/T-007 的 write_scope 与 outputs 已移除该路径；F-07 已修：T-002 依赖补入 T-004。5) 豁免重分类写入 test-strategy.md 第 6 节：manual-baseline / environment-blocked 只适用于真实环境限制，TB-1/3/4/6 属规格缺陷必须 M1 前修图，不归入环境豁免；豁免单独成表且 skip 不折算 pass。6) D-1 字段集、D-7 估计刷新、D-8 Top 档兜底已作为第 10 节锚点写入 design.md。task-graph.json 仍通过 graph_schema、graph_acyclic、task_fields_complete、matrix_consistent 校验。
