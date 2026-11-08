# Task 014 评审（review，第 1 轮）

## 结论：pass（1/1）

规格以 design.md 与 acceptance.md 为准。acceptance.md 只登记本任务属主 AC-034 一个二级小节，对应一条单行验收命令（`- 命令:`），期望为「退出码 0 且 stdout 含精确字符串 AC-034 OK」。编排方已用 PowerShell 7 执行该命令，结果在 `.collab/tasks/014/ci-results.json`：passed=1、total=1、ok=true，AC-034 条目 passed=true、exitCode=0、lastLine/output=`AC-034 OK`。按本轮【执行证据口径】直接引用，不自行重跑；评审环境缺 pwsh 7 或临时文件权限不作为判 needs_revision 的理由。逐条核对 1/1 通过，0 项无法确认，0 条 finding。

## 1. 核验范围与证据口径

- 只读文件：brief.md、design.md、acceptance.md、impl.md、ci-results.json、state.json、run.json、live.json、notice.json、inputs.jsonl、input-ledger.jsonl、handoff/*、logs/*、lib/config.mjs、lib/config-migrate.mjs、lib/commands/config/migrate.mjs、lib/cli.mjs、bin/cliworker.mjs、test/unit/config-v2.test.mjs、test/fixtures/config/*.json、test/traceability/T-*.json、contracts/spec/ac-index.json、contracts/spec/migration-map.json、contracts/schemas/config.v2.schema.json、contracts/schemas/pool.schema.json、.collab/blueprint/cliworker-v2/interfaces.md、scripts/check-traceability.mjs。
- 执行类证据：`ci-results.json`（编排方 pwsh 7 运行，含每条命令退出码与输出）直接引用；未重跑 acceptance.md:2 的验收命令。
- 其余用只读方式独立验证实现与规格是否一致：读文件、算哈希、核对行号、只读解压 .git 对象、只读复跑不写文件的 check-traceability.mjs。
- 未执行任何 git 命令；未创建或修改 brief.md、design.md、acceptance.md、impl.md、state.json、run.json 及任何被评审代码与文档；仅创建本轮 review.md / review-r1.md / verdict.json / verdict-r1.json。

## 2. SHA 核验（只读解压 .git 对象，未用 git 子命令）

所验证的 git sha（so 验证的 git sha）= `01a754eb093b9f717e0a664450b9a84cb99b954b`（verdict.sha 字段）。

- 工作区 `.git:1` = `gitdir: C:/git/dsh-CLIWorker/.git/worktrees/014`；`worktrees/014/HEAD:1` = `ref: refs/heads/task/014`；`.git/refs/heads/task/014:1` = `01a754eb093b9f717e0a664450b9a84cb99b954b`。
- 只读 zlib 解压松散对象 `.git/objects/01/a754eb093b9f717e0a664450b9a84cb99b954b`，对解压字节重算 SHA-1 = `01a754eb093b9f717e0a664450b9a84cb99b954b`（match=true）；对象头 `commit 258`，tree `4afe0e29289b0c9c784e13ff1813eccb3fad8b61`，parent `d84981554722941c16957ade30fe7e89a60c2ef8`，author/committer `cliworker <cliworker@local> 1794106521 +0800` = 2026-11-08T02:55:21Z，消息 `fix(task014): add missing traceability shard T-014.json`。
- `worktrees/014/logs/HEAD` 末条 `d8498155... -> 01a754eb...` 即该提交；`ORIG_HEAD` = `920bcedd8fe4a79ffeedacdfe0fb426635085b4d`（基准 main）。
- 只读解压 HEAD tree 逐级进入 `test`→`traceability`：`T-014.json` 在树中（blob `9e75a74fc7901811dc6c89014e09251c7c842ece`，149 字节），与工作树文件逐字节相等（equal=true）。
- `ci-results.json:4` ranAt = `2026-11-08T10:55:24.0592457+08:00`（=02:55:24Z）比该提交晚 3 秒，故本 sha 即被验收代码。

## 3. CI 结果与一致性

- `.collab/tasks/014/ci-results.json:5-7`：passed=1、total=1、ok=true；`:8-17` AC-034：passed=true、exitCode=0、durationS=1.24、lastLine(:15)/output(:16)=`AC-034 OK`。SHA-256(ci-results.json)=`4cfd7f6ce1669cd8534e9d27df0c728a82146c42a02036a1d75d47cdb68cf305`。
- `state.json:137-138` status=`reviewable`、末条 history `02:55:24Z implemented->reviewable by ci`；`run.json` 末条 role=ci、exit.code=0、ci={passed:1,total:1,ok:true,ran_at:02:55:24Z}。与 ci-results.json 一致。
- CI 结果未缺失且不与代码明显矛盾：ranAt 晚于 HEAD 提交、reflog 末条即 HEAD、HEAD tree 内分片与工作树逐字节相等；acceptance.md:2 命令内各断言与实现只读逐项对齐（见第 5 节）。按口径未判任何项「无法确认」。

## 4. 本轮用户输入 note（必须纳入考虑）

note（inputs.jsonl 末条 `in-mw78deh7-6a6f98`，02:46:10Z）称「CI fails with ENOENT: test/traceability/T-014.json is missing ... Create it with the correct shape and make check-traceability pass locally before finishing」。该 note 反映的是**修复前**现场：`notice.json`（02:48:08Z）为 `blocked / ci_failed / ci 0/1`。

只读核验该问题已消除，无需（且作为 review 角色不得）创建文件：

- `test/traceability/T-014.json:1-8` 现存在，内容 `{task:'T-014',milestone:'M2',entries:[{ac:'AC-034',status:'covered',files:['test/unit/config-v2.test.mjs']}]}`，与 acceptance.md:2 命令内 `a.deepEqual` 期望对象逐字段相等（键序对 deepEqual 不敏感）：三键 task/milestone/entries、entries 仅 ac/status/files、单条 AC-034、无 baseline/版本/额外追踪字段；符合 design.md:42（§12）、interfaces.md §15，且与 T-001/T-005/T-011 既有分片形状一致。文件 149 字节、无 BOM、无 CR。
- `ac-index.json`：AC-034 owner=`T-014`、milestone=`M2`、levels=`['unit']`，与分片一致。
- HEAD 提交 01a754eb（02:55:21Z）消息即 `add missing traceability shard T-014.json`；其后 CI（02:55:24Z）通过 1/1。分片在 HEAD tree 中且与工作树逐字节相等。
- 只读复跑 `node scripts/check-traceability.mjs` → `check-traceability: ok (covered=34 planned=40)`、退出 0。该脚本只读（grep 无 writeFile/mkdirSync/appendFile/spawn/git，末段仅 process.stdout.write 与 :447 process.exitCode），未创建任何文件；满足 note 的「make check-traceability pass locally」。

## 5. 独立只读核对（实现与规格是否一致）

acceptance.md:2 单行命令的断言逐条对齐：

- `tap(['test/unit/config-v2.test.mjs'])` / `\[AC-034\]`：`test/unit/config-v2.test.mjs:15-82` 共 4 个 [AC-034] 用例（:16 夹具循环 2 例、:26、:54）；`grep -rl '\[AC-034\]' test --include='*.test.mjs'` 恰 1 文件。fail/cancelled/skipped/todo 全 0 由 CI 的 TAP 断言保证。
- `run-tests.mjs --ac AC-034` / `filtered 1 files` / 清单 mode=filtered、filter=AC-034、files=[config-v2.test.mjs]：由上条唯一 [AC-034] 文件与 ci-results.json AC-034 OK 佐证。
- `T-014.json` deepEqual：见第 4 节，形状一致。
- 真实 `bin/cliworker.mjs config migrate`：`lib/cli.mjs:10,16,18,27,35-36` 已注册 config/migrate 路由且 CONFIG_FREE 含 config；`bin/cliworker.mjs` 未改动。`lib/commands/config/migrate.mjs:8-11` E_REQUEST_INVALID、`:19-25` `flag:'wx'`+EEXIST→E_CONFIG_EXISTS、`:20` writeFileSync utf8 无 BOM、`:27` `{ok:true,warnings}` 含 W_CONFIG_V1。
- v2 输出根/池必需键与禁止额外键：`lib/config-migrate.mjs:20` 根 7 键 = `config.v2.schema.json` required（schema/state_dir/secrets/discovery/catalog/pools/policy）；`:9` add() 池 8 键 = `pool.schema.json` required（id/cli/kind/funding/window/capacity_mtok/used_fraction/credits_per_mtok）；无额外键，命中命令的 required/properties 双向键集合断言。
- v2 输出不含 `models/providers/quotas/_file/_home/warnings`：`lib/config.mjs:106-113` 用 `Object.defineProperties` 定义非枚举，JSON.stringify 不含这些运行时字段；:109 仅 v1 带 W_CONFIG_V1。
- 源 v1 字节不变：源文件仅被读取（config.mjs:64；test 内 readFileSync before/after），写入走 `flag:'wx'` 的新输出路径。
- 回归 `tap([config,paths,select,select-draft])`：4 个 `test/unit/{config,paths,select,select-draft}.test.mjs` 均存在（只读确认）。
- 设计要点只读核对：`lib/config-migrate.mjs:2-27` 用 structuredClone 不改入参；:23 models→catalog.manual/allow/levels 且 level_source={kind:'config',ref,at}；:22 providers→discovery.cli_overrides；:12-18 quotas 用四个独立 if 逐项映射（百分比→plan_window/plan_weekly、tokens→credits 带容量、credits→带/不带有效率、USD→prepaid_usd），window=null、不可换算池 capacity_mtok={} / used_fraction=null / credits_per_mtok=null，不虚构兑换率；fixture v1.json 覆盖百分比/tokens/带与不带有效率 credits/USD/同 provider 同时 credits+USD，v1-no-schema.json 覆盖无 schema。`test/unit/config-v2.test.mjs:26-52` 对未知池逐个 buildForecast 断言 status/risk/reason/remaining_mtok/tasks_left 为 unknown/capacity_unknown，`lib/config.mjs:38-55` 从 pools 重建兼容 quotas 且不可换算余额保持未知；:54-82 经真实 CLI 迁移+重新 loadConfig 做完整 draft 深相等与模型顺序/有效 call/拒选断言。
- 编码与秘密：9 个交付文本文件 BOM=false；fixtures 只读 grep `sk-[A-Za-z0-9_-]{20,}|ghp_|xox|AKIA|Bearer |PRIVATE KEY` 命中 0。SHA-256(acceptance.md)=`5a0a72cb04a061c33686d68d09a9f0d1afffc4404010ec44462b912b5860fc4e`，SHA-256(T-014.json)=`07f671042a0b5ea743de050c53a2f3c62df01f53a74d979df97d4e2f47790499`。

## 6. 逐条核对（1/1）

| id | 结论 | 证据 |
| --- | --- | --- |
| AC-034 | 通过 | ci-results.json:8-17 passed=true/exitCode=0/`AC-034 OK`；acceptance.md:1-3；分片形状与 check-traceability 只读核验见第 4 节；实现只读核对见第 5 节 |

## 7. Findings

无。0 条 finding（severity P0/P1/P2）。CI 结果未缺失、与代码无明显矛盾，逐条核对 1/1 通过。

## 8. 备注（非缺陷，不写入 findings）

- `impl.md` 是 dev 的累计过程日志（mtime 10:47 local，早于 02:55Z 分片提交与 CI 通过），末段「AC-034 仍未完成……追踪分片仍缺失……不能声称验收通过」属修复前候选现场自述，不覆盖 HEAD + ci-results.json 的最终事实；按口径以 design.md / acceptance.md 与编排方 CI 为准。
- design.md:56 明确 `check-fast.ps1` 与 `milestone-gate.mjs --milestone M2` 属下游集成检查、不并入 AC-034 判定，且检查链可能调用 git；受「禁止执行 git 命令 / 不重跑验收」约束未运行，不作为判据。
- acceptance.md:3 期望中「目标单测必须逐项证明……」为 :2 单行命令的说明文字；本轮不另立 AC 编号、不发明字段/版本号/章节名，按 :2 命令的实际执行证据判定。
- `brief.md` 全文 grep「报告|report|追加|append|path」无命中，且 design.md:16 与 acceptance.md:3 均注明「brief 未指定基准 commit SHA 或既有验收报告路径」；故本轮结论**无追加目标**，未改动任何历史小节。
- 未修改 brief.md、design.md、acceptance.md、impl.md、state.json、run.json 及任何被评审代码与文档；未执行 git 命令；仅创建 review.md、review-r1.md、verdict.json、verdict-r1.json。沿用既有 verdict 字段（verdict/sha/passed/total/evidence/findings/checks）与 acceptance.md 的 AC-034 章节名，未发明字段、版本号或章节名。
