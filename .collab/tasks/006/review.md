# Task 006 评审（review）

## 结论：pass（20/20）

- 验证的 git sha：`f5fa0ea968385911afc487df9c8b28d1bbb41367`（分支 `task/006` HEAD）。基准（起点）提交 `887c7a2115e649e6df5046448dcc97d571e8f660`，与 `design.md:21`、`acceptance.md:3` 一致。
- 通过数 / 总数：**20 / 20**。其中 AC-015 4/4、AC-016 4/4、AC-017 3/3、AC-018 2/2、AC-019 2/2（合计 15 条执行类验收项），仓库门禁 R-1..R-5 5/5。
- 执行证据：`.collab/tasks/006/ci-results.json`（`ranAt=2026-11-08T03:15:16.8518142+08:00`，`passed=15 total=15 ok=true`，文件 SHA-256 `225f866b28804394cc3b6d0c0729bdd867db937f0756c719c823c1c2a177610e`）。15 条结果逐条 `passed=true`、`exitCode=0`、`lastLine='<AC> OK'`。按【执行证据口径】直接引用，未重跑这 15 条；评审环境缺 pwsh 7 / 临时文件权限不作为判 needs_revision 的理由。
- `ci-results.json` 只收录 15 条 AC 命令，不含 R-1..R-5 门禁（与 task 003 的先例一致：门禁由评审以只读方式补验）。本轮补跑的门禁脚本均为只读（不改动仓库内任何文件），输出见下。

## SHA 核验（只读，未执行 git 命令）

- 工作区 `.git` 文件：`gitdir: C:/git/dsh-CLIWorker/.git/worktrees/006`。
- `C:/git/dsh-CLIWorker/.git/worktrees/006/HEAD:1` = `ref: refs/heads/task/006`；`C:/git/dsh-CLIWorker/.git/refs/heads/task/006:1` = `f5fa0ea968385911afc487df9c8b28d1bbb41367`。
- `worktrees/006/logs/HEAD` 末条 `887c7a2… -> f5fa0ea…`，消息 `commit: stage(dev): task 006`；`ORIG_HEAD` = `887c7a2115e649e6df5046448dcc97d571e8f660`。CI `ranAt` 03:15 晚于 dev 提交，代码树在 CI 运行前已定稿，CI 结果与当前 HEAD 不矛盾。

## 独立只读核对

| 项 | 核对内容 | 结果 |
|---|---|---|
| 金标冻结 | 重算 `contracts/golden/manifest.json:1-61` 登记的 14 个文件 CRLF→LF 归一化 SHA-256，mismatch=0；`contracts/golden/**`、`contracts/spec/**` 与登记清单无增删 | 满足 |
| 金标 case 数 | quota-shapes 9、b44 9、thresholds 21、quantiles 15、confidence 11、burn-eta 14（逐文件读取 `cases.length`），与 `design.md:169,185`、`acceptance.md` 的 21/15/11/14 一致 | 满足 |
| 金标内容抽查 | quota-shapes（`q-pct-5`=0.05/low_reserve、`q-credits-rate`=0.001/tasks_left 0/exhausted、`q-usd`=6/usd）、b44（2/10、1/5、1.8/9、0.8/4、`ledger_capacity_unknown`、1.333/6.667、two-pools-min 5）、thresholds/quantiles/confidence/burn-eta 边界值逐项与 `design.md §3` 手算一致 | 一致 |
| a1-quota 追加 | `[repro]` 段 SHA-256 = `1dd92cf7…f1ec`；打开行 `test('[fixed] [AC-015] live forecast reads percentage and credits quotas'` 之前前缀 SHA-256 = `68d8df3d…7888c`；全文 `[fixed]` 恰 1 次；追加段含 7 个 needles 与 `forecast.mjs`，不含 `CLIWORKER_V01`/`fixtures/characterization`；`a1-quota.test.mjs:28-49` 只调用 live `buildForecast`，`[repro]`（:9-27）未动，前面无插入 import/注释/空行 | 满足 |
| task-graph | `.collab/blueprint/cliworker-v2/task-graph.json` LF 归一 SHA-256 = `794e1a3b0ada3c3689175033b639dbc26b04a0106be078e330325e9d9cd8bc6f`（`design.md:241`、`acceptance.md:166`）；`design.md:2-10` front matter 的 8 条 write_scope 与其一致 | 满足 |
| 写域（只读等价） | mtime 核对：工作区建立（02:21）之后被改动的仓库文件恰好是 8 个 write_scope 文件 + 人类批准改动的 `task-graph.json`；`lib/`、`test/`、`contracts/`、`scripts/` 其余文件均无改动 | 满足 |
| 实现：pools | `lib/pools.mjs:43-50` round3（远离零、`-0` 归零）、`:53-63` billedTokens、`:69-97` normalizeQuota 四形状、`:103-126` resolveResetAt 四级优先级、`:128-158` 容量/读数/schema 形状兼容、`:160-228` poolState（cli 越过清零 + config/estimated 仅 recheck）、`:230-272` 池明细与多池取最小、`:275-321` evaluatePools/remainingForModels；与 `design.md §3.1/§3.4/§3.5/§3.6` 一致 | 一致 |
| 实现：forecast | `lib/forecast.mjs:63-67` DEFAULT_POLICY、`:84-91` quantileForUsage（n<3 返回 null、不原地排序）、`:94-100` confidenceFor（cv>1 仅降级 high）、`:103-113` classifyRisk（只返回两键、不接收 assumed）、`:116-138` burn/eta、`:176-356` buildForecast（零剩余规则、tasks_left_basis 无 assumed、样本不足 tasks_left_assumed、status/reason/burn/eta、六字段池输出）与 `design.md §3.2/§3.3/§3.7/§3.8` 逐项一致 | 一致 |
| schema 完整性 | `contracts/schemas/forecast.v1.schema.json:6-26` 的 19 个 required 字段在 `lib/forecast.mjs:328-355` 全部出现；`tasks_left`/`tasks_left_assumed` 被夹到 ≥0 整数（:269-270）；`pools` 映射恰六字段（:334-341） | 满足 |
| 注册表/枚举 | `contracts/registry.snapshot.json:335-343` forecast_reasons、`:357-361` tasks_left_basis ∈ {tasks,usd,none}（无 assumed）、`:362-413` thresholds 与 `design.md §3.3` 字面常量一致 | 一致 |
| 测试真实性 | `test/unit/pools.test.mjs:11-27,98-113` 逐例读金标并 `deepStrictEqual`；`forecast-engine.test.mjs:19-50` fn 分派表 + 四个 case count；`forecast-unknown.test.mjs:16-97` 过 schema、遍历无样本输入；`reset.test.mjs:9-69` 用 `createFakeContext` 伪时钟。AC 标签隔离：AC-015 命中 2 文件，AC-016/017/018/019 各命中 1 文件，无交叉污染 | 满足 |
| R-3 字符串门 | `lib/pools.mjs` 无 `Date.now`/`systemNow`/定时器；`lib/forecast.mjs` 无 `Date.now`，`systemNow` 恰 2 次（导入 `:1` 与旧 `forecast()` 默认参 `:25`） | 满足 |
| R-4 令牌门 | 8 个 write_scope 文件均无 `sk-`/`Bearer `/`ghp_`/`xox`/`AKIA` | 满足 |
| 追踪分片 | `test/traceability/T-006.json:1-15`：task=T-006、milestone=M1、5 个 AC 全 covered、无 `baseline` 键、AC-015 files 顺序与 `acceptance.md:166` 一致 | 满足 |

## 逐条核对（执行类，引用 ci-results.json）

- **AC-015 A-1**（`ci-results.json:9-17`，`exitCode=0`，`lastLine='AC-015 OK'`）：过滤运行选中 2 个文件。只读佐证：`[AC-015]` 仅出现在 `pools.test.mjs` 与 `a1-quota.test.mjs`；9 个 quota-shapes 标题、golden case count、`[fixed]` 标题均在（`pools.test.mjs:11-27`、`a1-quota.test.mjs:28`）。通过。
- **AC-015 A-2**（`:18-26`）：9 例 quota-shapes 深相等。只读佐证：`buildForecast`（`forecast.mjs:176-356`）对 `q-pct-5/4/0/15`、`q-credits-*`、`q-tokens`、`q-usd` 的计算路径与 `quota-shapes.json:6-72` 逐键吻合。通过。
- **AC-015 A-3**（`:27-35`）：旧 `forecast()` 仍给 tasks_left 10。只读佐证：`forecast.mjs:25-55` 旧函数与 `:6-19` 旧导出原样保留，仅 `:23` 加 `@deprecated`。通过。
- **AC-015 A-4**（`:36-44`）：a1-quota 只追加 `[fixed]`、repro 哈希不变、check-defects 通过。只读佐证：见上表 a1-quota 行；另评审直接运行 `node scripts/check-defects.mjs` 输出 `check-defects: ok`（退出码 0）。通过。
- **AC-016 A-5**（`:45-53`）：过滤运行选中 1 文件。只读佐证：`[AC-016]` 仅 `pools.test.mjs`。通过。
- **AC-016 A-6**（`:54-62`）：9 例 b44 整体深相等。只读佐证：`b44.json:6-200` 期望值与 `pools.mjs:160-321` 的读数/账本/多池/round3 计算一致。通过。
- **AC-016 A-7**（`:63-71`）：schema 形状与计费权重。只读佐证：`pools.mjs:128-149` 接受 `{value}` 容量与 `used_fraction`，`:53-63` billedTokens 的 cache_read 权重 0/1 得 9/8。通过。
- **AC-016 A-8**（`:72-80`）：sonnet 手算。只读佐证：`forecast.mjs:296-322` burn/eta 取最小池、`:158-170` 有效窗口起点 07:00→3h、burn=round3(5/3)=1.667、eta=`12:59:57.840Z`、exhausts=false；`:334-341` 池输出恰六字段；未写来源的窗口经 `pools.mjs:151-158` 归为 `config`。通过。
- **AC-017 A-9**（`:81-89`）：过滤运行 1 文件、12 个标题。只读佐证：`forecast-engine.test.mjs:19-50,52-100` 含四个 `golden case count` 与所列标题。通过。
- **AC-017 A-10**（`:90-98`）：四份金标 21/15/11/14 逐条深相等、burn=0 → eta null/false、round3 正零。只读佐证：`forecast.mjs:43-50(re-export)/84-91/94-100/103-113/116-138` 与四份金标内容一致。通过。
- **AC-017 A-11**（`:99-107`）：10/15/30、medium/high、墙钟抛错仍工作、NaN 抛 TypeError。只读佐证：`forecast.mjs:84-91` 分位数、`:140-146` cv（除以 n）、`:94-100` 降级、`:186` requireNow 抛 TypeError；两文件均无 `Date.now`。通过。
- **AC-018 A-12**（`:108-116`）：过滤运行 1 文件、含 `[AC-018]`、fail 0。只读佐证：`[AC-018]` 仅 `forecast-unknown.test.mjs`。通过。
- **AC-018 A-13**（`:117-125`）：assumed 不进 risk、四份输出过 schema。只读佐证：`forecast.mjs:103-113` classifyRisk 不接收 assumed、`:263-289` 零剩余/unknown/reason 规则、`:257-261` tasks_left_assumed；`forecast-unknown.test.mjs:16-97` 逐例校验 `validate(schema, actual).ok`。通过。
- **AC-019 A-14**（`:126-134`）：过滤运行 1 文件。只读佐证：`[AC-019]` 仅 `reset.test.mjs`。通过。
- **AC-019 A-15**（`:135-143`）：cli>config>estimated>unknown、伪时钟越过重置。只读佐证：`pools.mjs:103-126` 四级优先级与规整、`:160-228` cli 越过清零 / 非 cli 置 recheck、`:240` reset_in_h；`reset.test.mjs:53-69` 用 `ctx.clock.now()` / `advance(2000)`。通过。

## 仓库门禁核对（ci-results.json 未收录，评审以只读方式补验）

- **R-1** `node scripts/run-tests.mjs`：退出码 0，`ℹ tests 262 / pass 262 / fail 0`，末行 `run-tests: full 32 files, manifest …`，无 `FAIL discovery`、无 `✖`。满足 `acceptance.md:157-161`。通过。
- **R-2** 逐项只读补跑：`node scripts/check-seams.mjs` → `check-seams: ok (files=20)`（退出码 0）；`node scripts/check-traceability.mjs` → `check-traceability: ok (covered=19 planned=55)`（退出码 0）；`node scripts/check-golden-frozen.mjs` → `check-golden-frozen: ok (14 files)`（退出码 0）。分片五 AC 全 covered、无 baseline、AC-015 files 顺序、`task-graph.json` SHA-256 均按 `acceptance.md:166` 静态核对一致。`check-write-scope.mjs --base …` 的 `git diff`/`git ls-files` 部分因评审禁止执行 git 命令未重跑；其非 git 部分（manifest 登记 14 文件、front matter 8 条 write_scope、task-graph 哈希、mtime 变更清单）已只读核对无越界，符合「评审环境限制不作为 needs_revision 理由」的口径。通过。
- **R-3** 静态字符串核对：`lib/pools.mjs` 无 5 个禁用词；`lib/forecast.mjs` 无 `Date.now`、`systemNow` 恰 2 次。零参数 `new Date()` 由 R-2 的 `check-seams: ok (files=20)` 覆盖。通过。
- **R-4** 静态核对：8 个 write_scope 文件均无 5 个令牌字样。通过。
- **R-5** `node scripts/check-defects.mjs` → `check-defects: ok`（退出码 0）；`node scripts/check-fast.mjs` → 末行 `check-fast: ok`（退出码 0，`262/262`、`fail 0`）。满足 `acceptance.md:193-197`。通过。

## Findings

无（`findings` 为空数组）。逐条核对与门禁补验均未发现与 `design.md` / `acceptance.md` 不符之处；无 P0/P1/P2 问题。

## 备注（非缺陷）

- `brief.md` 未指定验收报告路径（`design.md:21`、`acceptance.md:3,10` 亦确认），因此本轮结论无追加目标，未改动任何历史小节。
- `ci-results.json` 的 `results` 为 15 条 AC 命令，与 `run.json:197-204,253-260` 的 `passed=15 total=15 ok=true` 一致；R-1..R-5 属仓库门禁，按本仓库惯例由评审只读补验。
- 只读核验中注意到 `lib/pools.mjs:136-149` 的读数回落只在 `reading` / `used_fraction` 二选一的形状下生效（金标与 A-7 均如此，A-7 的 `used_fraction` 用例不带 `reading` 键）；两种字段同时给出且 `reading` 值无效的组合未被任何 AC 或金标覆盖，不触发验收项，故不记为 finding。
- 未修改 `brief.md`、`design.md`、`acceptance.md`、`impl.md`、`state.json`、`run.json` 及任何被评审代码/文档；未执行 git 命令；除本 `review.md` 与 `verdict.json` 外未创建其它文件。
