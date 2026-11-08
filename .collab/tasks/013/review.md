# Task 013 评审报告（review，第 3 轮）

## 结论

- **verdict: needs_revision**
- 所验证的 git sha（so 验证的 git sha）: `71b3386783ce8a5dc394ac683c3411735970fd91`
- 通过数/总数: **1/1**（acceptance.md 唯一 AC-032 命令；执行证据有效）
- findings: **4 条**（P1×3、P2×1）
- 本轮结论无追加目标（brief 未指定验收报告路径）
- 本轮为对 r3 HEAD 的**独立复验**，非照抄 r1/r2；r1/r2 的 4 条 findings 中 (A)(C)(D) 未修复、(B) 仅部分修复

## 1. 所验证的 git sha（只读，未执行任何 git 子命令）

`71b3386783ce8a5dc394ac683c3411735970fd91`（写入 verdict.sha）。

- 工作区 `.git:1` = gitdir: C:/git/dsh-CLIWorker/.git/worktrees/013；`.git/worktrees/013/HEAD:1` = ref: refs/heads/task/013；`.git/refs/heads/task/013:1` = `71b3386783ce8a5dc394ac683c3411735970fd91`。
- 只读 zlib 解压松散对象 `.git/objects/71/b3386783ce8a5dc394ac683c3411735970fd91`（184 字节）得 257 字节，对解压字节重算 SHA-1 = `71b3386...`（match=true）；对象头 `commit 246`，tree `bc1268bdd708c0d96470511815fba4b2f4c1eee4`，parent `7d5a28d248e05446356e9e771f0a9780afcae44d`，committer `Kermit <kayzcn@gmail.com> 1794119713 +0800` = 2026-11-08T06:35:13Z，消息 `fix(dev-r3): address review findings (task 013)`。
- reflog `.git/worktrees/013/logs/HEAD` 末两条：`:16` `804bbdb -> 7d5a28d`（stage(review-r2): needs_revision）、`:17` `7d5a28d -> 71b3386`（本 HEAD），之后无新提交；ORIG_HEAD = `e5a8db6cde14369fcca46773a4bf99518c26d542`。
- `ci-results.json:4` ranAt `2026-11-08T14:35:17.3785026+08:00`（= 06:35:17Z）晚于该提交 4 秒，故本 sha 即被验收代码。
- 只读复算 16 个被评审文件工作树 git-blob SHA-1（LF 归一化）与 HEAD tree 逐一相等（MATCH=16 / mismatch=0）：lib/secrets/index.mjs `49e1f73961`、lib/commands/auth/_common.mjs `3b6fac6535`、set.mjs `d1e35034e4`、status.mjs `4b8867d6b6`、clear.mjs `63ee30684e`、lib/config.mjs `7a874a8376`、lib/cli.mjs `e2401542c9`、lib/exec.mjs `3a7a59aa57`、test/unit/secrets.test.mjs `474457820b`、test/integration/secrets-native.test.mjs `0b3d45845f`、acceptance.md `0f896b656e`、design.md `f6422b57ca`、brief.md `13dd5e7f6a`、impl.md `c63bdbe9a4`、review.md `60722500ca`、verdict.json `a399a7b723`；无被评审代码的未提交改动。ci-results.json 工作树 blob `ae7b8c9adc` 与 HEAD `98cedf2f51` 不同，因其为编排方在 HEAD 提交后生成的执行证据（非被评审源码），按口径不计为 finding。
- SHA-256(ci-results.json) = `9f5eb5faf00720afe242dffcdb78a4a81107820c8985d870e1ce9005e433141a`；acceptance.md 工作树 CRLF `1374` 字节 sha256 `b72e876c7628a0e9b20103c99a8c0de861b0d377b3a5d13f1aa9de2898a9e733`，LF 归一化 `1358` 字节 sha256 `d931d998b38cbc8a9f461b3f5f00df3be6a04f1a1fef9891a1149cdac0d229be`，blob sha1 `0f896b656e9ce1d988da3c4365d8aa11e1cc6f52`。

## 2. 逐条核对 acceptance.md（执行项引 CI，静态项只读复核）

acceptance.md 恰有 1 个 `## AC-` 小节（`:9` AC-032）、1 个 pwsh 代码块（`:11-13`）、1 条 `- 期望:`（`:15`，退出码 0、末行 AC-032 OK）、`:7` 悬空条款。

**AC-032（执行类，判通过）**：`ci-results.json:5-7` 顶层 `passed=1, total=1, ok=true`；`results[0]`（`:9-17`）`passed=true, exitCode=0, durationS=2.81, lastLine='AC-032 OK'`，output 为 TAP：3 个 Subtest 均 ok、`1..3`、`# tests 3`、`# pass 3`、`# fail 0`、`# skipped 0`、`# todo 0`，末行 `AC-032 OK`。逐字命中 `:15` 期望。

按口径，ci-results.json 由编排方用 PowerShell 7 产生，是「执行类」验收项的有效运行证据，**本轮直接引用、未自行重跑**；评审环境缺 pwsh 7 或缺临时文件权限不作为判 needs_revision 的理由，本轮亦未以此为理由。CI 结果不缺失、且不与代码明显矛盾：TAP 三标题与 `test/integration/secrets-native.test.mjs:13`（for 循环遍历 from-env 与 stdin 生成 2 例）、`:111` 第 3 例逐字一致，`# pass 3` 与该文件的 3 个运行时用例一致；HEAD（06:35:13Z）早于 ranAt（06:35:17Z），且 16 个被评审文件工作树 blob 与 HEAD 相等。故**不把 AC-032 标为「无法确认」**。

## 3. 独立只读核对实现与规格（发现 4 项不一致，均为 r1/r2 findings 未彻底修复）

规格以 design.md 与 acceptance.md 为准；对「其余」项按口径用读文件、算哈希、核对行号、只读解压 .git 对象独立验证。本轮独立复验 r3 HEAD `71b3386`（tree 623 文件；r2 HEAD `804bbdb` 为 620）：dev-r3 提交（`7d5a28d -> 71b3386`）仅 **ADDED 1**（handoff/dev-r3-c1-to-c2.md）+ **MODIFIED 4**（impl.md / run.json / state.json / test/integration/secrets-native.test.mjs），**零 lib 生产代码改动、acceptance.md 与 design.md 未改、test/unit/secrets.test.mjs 未改、无新增交付物**。

### (A) 两个必交交付物仍缺失（r1/r2 finding (A) 未修复）

design.md YAML `write_scope :3-11` 九项中 `test/flows/steps/auth.mjs`（`:10`）与 `test/traceability/T-013.json`（`:11`）在**工作树与 HEAD tree 均仍 ABSENT**：只读遍历 HEAD tree（623 文件）确认二者 ABSENT；`test/traceability/` 下 T-001..T-012、T-014 共 13 个分片齐全唯缺 T-013.json，`test/flows/steps/` 仅 doctor.mjs、select.mjs；其余 7 项交付物均在树中。

- `design.md:33` 要求 auth.mjs「真实 bin 两种 set 输入、跨进程消费、状态和清除；使用既有共享 flow」
- `design.md:34` 要求 T-013.json「沿用 task/milestone/entries/ac/files/status，仅登记 AC-032、AC-033；实际覆盖后置 covered」
- `design.md:48`（§13）要求 auth flow 元数据 `name='auth'`、`introduced_by='T-013'`、`ac=['AC-032']`、`run(flow)`
- `design.md:50`（§15）明确「必跑 AC-032 由允许的 integration `.test.mjs` 实际调用 auth flow」；`:51`（§16）要求追踪分片
- `brief.md:9`、`:19-20` 亦列为交付路径

缺失 auth flow 使 §13/§15 的「实际调用 auth flow」无从成立；缺失 T-013.json 使 §15/§16 的「实际覆盖后置 covered」无法登记。dev 自身 r3 `impl.md:33` 明言「共享 auth flow……追踪文件仍缺失」「没有修改 acceptance.md 或将覆盖标为 covered」。

### (B) AC-032 集成部分修复但核心覆盖仍缺（r1/r2 finding (B) 仅部分修复）

较 r2 有实质进展（本轮独立确认）：当前 `test/integration/secrets-native.test.mjs` 共 **3 个运行时用例**——`:13` for 循环遍历 from-env 与 stdin 生成 2 例、`:111` 第 3 例；`:9` 引入 `leakScan`；`:65-71` 的 scan() 以 `sentinels`、`captured` 的 stdout/stderr/argv、`http: []`、`state_dir: temp`、`auditFile` 调用 leakScan 并断言 `ok=true, hits=[], errors=[]`（`test/helpers/leak-scan.mjs:11` 的 ENCODINGS 已含 raw/utf16le/base64/hex）；`:83` set 后、`:89` 消费后、`:107` clear 后各一次 scan；`:90-92` 不同 state_dir 隔离；`:93-98` 覆盖旧值且新进程读到新值；`:99-107` clear 后消费失败（`status != 0` 且 `stdout === ''`，provider 未启动）；`:108` finally 清理临时目录。确为真实跨进程 CLI 行为，非 mock 计数/仅变量名。

但仍远低于规格：

- `design.md:48`（§13）：要求 auth flow 元数据与 flow.run/flow.spawn、fake-cli 记录 argv/变量名/sha256。该文件只 import leakScan（`:9`），未 import `test/helpers/flow.mjs`，无 createFlow/runFlow/flow.spawn/flow.run（自造 `:72-79` 的 spawnSync 与 `:14` 的 mkdtemp 根），无 `run(flow)`；全文件 grep 无 `introduced_by`/`T-013`/`traceability`/`platform-gate`/`skip`/`explicit`/`secrets` 命中。
- `design.md:50`（§15）：要求「显式/默认 ref」——三处 config（`:19`、`:91`、`:115`）均只有 providers/models/state_dir，无 `secrets` 字段，未测试显式 `config.secrets[cli]`；要求「后端失败无文件变化」——preload（`:21-46`、`:117-126`）只模拟成功与条目不存在，无后端失败注入、无 state_dir 递归列表/已有文件字节比较、无原本缺失目录仍不存在的断言。
- `design.md:49`（§14）：要求以 flow.root/flow.sentinels 为扫描根与哨兵集；当前用局部 `temp`/`sentinels` 代替（编码覆盖已由 helper 满足，但共享 flow 契约未落实）。
- `design.md:51`（§16）：附加原生测试按平台/工具/会话门控、skip 按 cliworker.skip/v1 记录、未显式选择时不注册；该文件无 `test/helpers/platform-gate.mjs` 引用、无 skip 门控，3 个用例一律注册。
- `design.md:34`、`:50-51`：追踪分片 T-013.json 仍缺失（见 (A)）。

**最强旁证**：dev 自身 r3 `impl.md:33`：「验收命令通过不代表设计全部完成：共享 auth flow、显式引用、后端失败的文件变化及完整平台和输入覆盖、追踪文件仍缺失」。

### (C) acceptance.md 未恢复，仍为弱化版（r1/r2 finding (C) 未修复）

acceptance.md 在 r3 **零改动**，字节与 r1/r2 记录完全相同（blob `0f896b656e`，LF 1358 字节 sha256 `d931d998...`）。本轮独立只读解压 .git 对象复核弱化历史：`588057fb` 的 acceptance.md blob `78c44991e9`（7546 字节）含 5 个硬编码 AC-032 标题（from-env persists…、stdin persists…、default ref overwrite and state_dir isolation、clear prevents consumption and backend failure preserves files、auth flow uses real CLI and scans all surfaces）+ 5 条期望 + runner 发现清单/T-013.json 追踪分片/flow 与 cli-envelope 回归断言；`ad36ca1a` 起（消息 `fix(task013): AC-032 checks suite pass, not hardcoded test titles`，作者 cliworker）整体删除为 1358 字节，此后 r1/r2/r3 均未改。当前 `:9` 仅 1 个 AC 小节、`:11-13` 单条命令、`:15` 期望仅退出码 0 + 末行。用户 note（`inputs.jsonl:6`，05:15Z）只授权「Add the missing test … Or remove that expected title from acceptance if the behaviour is covered elsewhere」（针对单个标题、且以行为已被覆盖为前提）。本轮不就弱化授权归属作裁定，仅陈述事实：该 1/1 通过只证明弱化后单条命令通过，不构成 design.md §13-§16 的覆盖证据，也不强制 `design.md:61` 的「测试非空、无 skip/todo、正式 runner 发现清单及追踪分片」检查。

### (D) acceptance.md:7 条款悬空（P2，r1/r2 finding (D) 未修复）

`acceptance.md:7` 写「测试标题约束只用于确保**下列覆盖**不会被空测试、漏注册或 skip 隐藏……**每个列出的标题**须对应实际行为断言；禁止只有 mock 调用次数、仅检查变量名、预填正确 env 或直接调用 auth 模块后宣称真实 CLI 通过」，但当前 acceptance.md 全文（`:1-16`）已无任何「下列覆盖/列出的标题」，该防空洞条款无指代对象、不可执行。`design.md:61`（建议验收方向）要求的检查亦不再被命令强制；`ci-results.json` 输出里的 `# skipped 0`/`# todo 0` 是 TAP 副产物，非命令断言。此为验收文档缺陷（评审角色被禁止修改 acceptance.md，无法就地修复），严重度低于 (A)(B)(C)。

## 4. findings 摘要

| severity | 标题 | 位置 |
| --- | --- | --- |
| **P1** | design.md 九项 write_scope 中两个必交交付物仍缺失：test/flows/steps/auth.mjs、test/traceability/T-013.json（r1/r2 (A) 未修复） | design.md:10 |
| **P1** | AC-032 集成仍缺 auth flow/显式 ref/后端失败无文件变化/原生门控/追踪分片等 §13-§16 覆盖，且 dev 自述未完成（r1/r2 (B) 部分修复） | test/integration/secrets-native.test.mjs:13 |
| **P1** | r3 未恢复 acceptance.md，仍为弱化版单命令；CI 1/1 不校验 §13-§16 覆盖（r1/r2 (C) 未修复） | acceptance.md:11 |
| **P2** | acceptance.md:7 防空洞/防 skip 条款悬空，design.md:61 验收方向检查不被命令强制（r1/r2 (D) 未修复） | acceptance.md:7 |

逐条 detail 见 verdict-r3.json 的 findings 数组。

## 5. 备注（非缺陷，不写入 findings）

1. 用户 note（`inputs.jsonl:3`，04:53Z）已将 AC-033 划归 T-034 并要求从 acceptance.md 移除 AC-033 章节，当前 acceptance.md 仅 1 个 AC 与此一致。本轮不就 AC-033 另立判据、不发明 AC 编号、版本号或章节名；`test/unit/secrets.test.mjs:12/:108/:140` 仍带 [AC-033] 标题但不被 acceptance.md 命令执行，不计入本轮 finding。
2. `design.md:65` 的 `check-fast.ps1` 属下游实现检查且检查链含 git，受禁止执行 git 命令／不重跑验收约束未运行，按既有口径不并入 AC-032 判定。
3. `impl.md` 是 dev 累计过程日志；其「本任务尚未完成」表述仅作 (A)(B)(C) 旁证，判据以 design.md/acceptance.md 与只读文件/行号为准。
4. brief.md 全文 grep `报告|report|追加|append` 无命中；`design.md:18`、acceptance.md:3 亦注明「brief 没有基准 commit SHA 或既有验收报告路径」。故本轮结论**无追加目标、未改动任何历史小节**。
5. 未修改 brief.md、design.md、acceptance.md、impl.md、state.json、run.json 及任何被评审代码与文档；SHA 核验、提交链回溯、tree diff、blob 等价均以只读解压 .git 对象／读文件／算哈希／核对行号完成，未执行任何 git 子命令；仅创建 review-r3.md、verdict-r3.json 并沿用本任务 r1/r2 双命名口径同步更新 review.md、verdict.json。

## 6. 判定

acceptance.md 唯一 AC-032 命令由编排方以 PowerShell 7 实际执行、退出 0 且末行 `AC-032 OK`（ci-results.json:5-17），该执行项通过数/总数计 **1/1**；CI 结果不缺失、不与代码矛盾，未判「无法确认」，亦未以评审环境缺 pwsh 7/临时文件权限为由。但按「规格以 design.md 与 acceptance.md 为准」「独立判断是否真的满足（不要只看文件存在）」「其余请用只读方式独立验证实现与规格是否一致」逐条只读核对 r3 HEAD：design.md 九项 write_scope 中 2 个交付物在 HEAD tree 与工作树仍缺失；AC-032 集成虽新增 leakScan/隔离/覆盖旧值/clear 后消费失败，但仍缺 auth flow、显式 ref、后端失败无文件变化、原生测试门控与追踪分片；acceptance.md 未恢复仍为弱化版；dev 自身 impl.md:33 承认「本任务尚未完成，不能标记 covered」。r1/r2 的 4 条 findings 中 (A)(C)(D) 未修复、(B) 仅部分修复。按「发现问题就判 needs_revision 并写成 findings；全部满意才判 pass」，本轮判 **needs_revision**。
