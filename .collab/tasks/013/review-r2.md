# Task 013 评审报告（review，第 2 轮）

## 结论

- **verdict: needs_revision**
- 所验证的 git sha（so 验证的 git sha）: `804bbdb747658faf11af695921c63a02dc2a2c8c`
- 通过数/总数: **1/1**（acceptance.md 唯一 AC-032 命令；执行证据有效）
- findings: **4 条**（P1×3、P2×1）
- 本轮结论无追加目标（brief 未指定验收报告路径）
- 本轮为对 r2 HEAD 的**独立复验**，非照抄 r1；r1 的 4 条 findings 中 (A)(C)(D) 未修复、(B) 仅部分修复

## 1. 所验证的 git sha（只读，未执行任何 git 子命令）

`804bbdb747658faf11af695921c63a02dc2a2c8c`（写入 verdict.sha）。

- 工作区 `.git:1` = `gitdir: C:/git/dsh-CLIWorker/.git/worktrees/013`
- `.git/worktrees/013/HEAD:1` = `ref: refs/heads/task/013`
- `.git/refs/heads/task/013:1` = `804bbdb747658faf11af695921c63a02dc2a2c8c`
- 只读 zlib 解压松散对象 `.git/objects/80/4bbdb747658faf11af695921c63a02dc2a2c8c`（185 字节）得 257 字节，对解压字节重算 SHA-1 = `804bbdb...`（match=True）；对象头 `commit 246`，tree `90f6b2ceff6b0d6a688cd90c9e5bdfda54cb5ad7`，parent `a8617e2dbadf9ae220c84a766134bca5ca67f67b`，committer `Kermit <kayzcn@gmail.com> 1794118052 +0800` = 2026-11-08T06:07:32Z，消息 `fix(dev-r2): address review findings (task 013)`。
- reflog 末两条：`ad36ca1a -> a8617e2d`（`stage(review-r1): needs_revision`，即 r1 评审已提交）、`a8617e2d -> 804bbdb`（本 HEAD），之后无新提交；`ORIG_HEAD = e5a8db6cde14369fcca46773a4bf99518c26d542`。
- `ci-results.json:4` ranAt `2026-11-08T14:07:34.5789915+08:00`（= 06:07:34Z）晚于该提交 2 秒，故本 sha 即被验收代码。
- 只读复算 7 个被评审文件工作树 git-blob SHA-1（LF 归一化）与 HEAD tree 逐一相等（MATCH=7 / mismatch=0）：`lib/secrets/index.mjs 49e1f73961`、`lib/config.mjs 7a874a8376`、`lib/cli.mjs e2401542c9`、`lib/exec.mjs 3a7a59aa57`、`test/unit/secrets.test.mjs 474457820b`、`test/integration/secrets-native.test.mjs 59ac969b2c`、`acceptance.md 0f896b656e`；无被评审代码的未提交改动。
- SHA-256(ci-results.json) = `86a88269acdea4dc58e01bb5aba526cef23313f712a285cc352414bef62ee218`；acceptance.md 工作树（CRLF）`1374` 字节 sha256 `b72e876c...`，LF 归一化后 `d931d998b38cbc8a9f461b3f5f00df3be6a04f1a1fef9891a1149cdac0d229be`，与 HEAD blob（1358 字节）逐字相等。

## 2. 逐条核对 acceptance.md（执行项引 CI，静态项只读复核）

acceptance.md 恰有 1 个 `## AC-` 小节（`:9` AC-032）、1 个 pwsh 代码块（`:11-13`）、1 条 `- 期望:`（`:15`，退出码 0、末行 `AC-032 OK`）。

**AC-032（执行类，判通过）**：`ci-results.json:5-7` 顶层 `passed=1, total=1, ok=true`；`results[0]`（`:9-17`）`passed=true, exitCode=0, lastLine='AC-032 OK'`，TAP 输出 3 个 Subtest 均 ok、`1..3`、`# tests 3`、`# pass 3`、`# fail 0`、`# skipped 0`、`# todo 0`，末行 `AC-032 OK`。逐字命中 `:15` 期望。

按口径，ci-results.json 由编排方用 PowerShell 7 产生，是「执行类」验收项的有效运行证据，**本轮直接引用、未自行重跑**；评审环境缺 pwsh 7 或缺临时文件权限不作为判 needs_revision 的理由，本轮亦未以此为理由。CI 结果不缺失、且不与代码明显矛盾：TAP 三标题与 `test/integration/secrets-native.test.mjs:12`（`['from-env','stdin']` 循环生成 2 例）、`:81` 的 `test(` 标题逐字一致，`# pass 3` 与该文件的 3 个运行时用例一致；HEAD（06:07:32Z）早于 ranAt（06:07:34Z）。故**不把 AC-032 标为「无法确认」**。

## 3. 独立只读核对实现与规格（发现 4 项不一致，均为 r1 findings 未彻底修复）

规格以 design.md 与 acceptance.md 为准；对「其余」项按口径用读文件、算哈希、核对行号、只读解压 .git 对象独立验证。本轮独立复验 r2 HEAD `804bbdb`（tree 620 文件；r1 HEAD `ad36ca1a` 为 615）：dev-r2 提交（`a8617e2d -> 804bbdb`）仅 **ADDED 1**（handoff 文档）+ **MODIFIED 5**（impl.md / run.json / state.json + 两个测试文件），**零 lib 生产代码改动、acceptance.md 与 design.md 未改**。

### (A) 两个必交交付物仍缺失（r1 finding (A) 未修复）

design.md YAML `write_scope :3-11` 九项中 `test/flows/steps/auth.mjs`（`:10`）与 `test/traceability/T-013.json`（`:11`）在**工作树与 HEAD tree 均仍 ABSENT**：只读遍历 HEAD tree（620 文件）确认二者 ABSENT；对照 `test/traceability/` 下 T-001..T-012、T-014 共 13 个分片齐全唯缺 T-013.json，`test/flows/steps/` 仅 doctor.mjs、select.mjs；其余 7 项交付物均在树中。

- `design.md:33` 要求 auth.mjs「真实 bin 两种 set 输入、跨进程消费、状态和清除；使用既有共享 flow」
- `design.md:34` 要求 T-013.json「沿用 task/milestone/entries/ac/files/status，仅登记 AC-032、AC-033；实际覆盖后置 covered」
- `design.md:48`（§13）要求 auth flow 元数据 `name='auth'`、`introduced_by='T-013'`、`ac=['AC-032']`、`run(flow)`
- `design.md:50`（§15）明确「必跑 AC-032 由允许的 integration `.test.mjs` 实际调用 auth flow」；`:51`（§16）要求追踪分片
- `brief.md:9`、`:19-20` 亦列为交付路径

缺失 auth flow 使 §13/§15 的「实际调用 auth flow」无从成立；缺失 T-013.json 使 §15/§16 的「实际覆盖后置 covered」无法登记。

### (B) AC-032 集成部分进展但核心覆盖仍缺（r1 finding (B) 仅部分修复）

较 r1（2 例）有进展：当前 `test/integration/secrets-native.test.mjs` 共 **3 个运行时用例**——`:12` for `['from-env','stdin']` 生成 2 例、`:81` 第 3 例；每例 `:70` set、`:71` status、`:72` 生产 `runWithSecrets -> fake`、`:74` 仅 `KIMI_API_KEY` 摘要等于令牌 sha256、`:75` argv 无令牌、`:76` clear、`:77` clear 后 status=unset。确为真实跨进程 CLI 行为，非 mock 计数/仅变量名。

但仍远低于规格：

- `design.md:49`（§14）：两种 set 后/消费后/clear 后均 leakScan（stdout/stderr/argv/HTTP/state_dir/audit 为 `ok=true, hits=[], errors=[]`，以 flow.root 为文件扫描根，用 flow.sentinels 的 raw/UTF-16LE/base64/hex）
- `design.md:50`（§15）：显式/默认 ref、覆盖旧值、新进程可读、不同 state_dir 隔离、clear 后消费失败且 provider 未启动、后端失败无文件变化
- `design.md:48`（§13）：auth flow 元数据与独立 status/消费/clear 进程、fake-cli 记录 argv/变量名/sha256
- `brief.md:28`：「两种方式都成功……leak-scan 在所有位置都 0 命中」

只读 grep 两个交付测试文件**无任何 leakScan/leak-scan/flow.scan/flow.sentinels/flow.root/run(flow)/introduced_by/T-013/traceability 引用**（仅 `:61-62` 删除 SENTINEL/CW_FLOW_SENTINEL、`:69` `--from-env SENTINEL` 等源变量名）。仓库 `test/helpers/flow.mjs`、`test/helpers/leak-scan.mjs` 存在，但两个交付测试文件未引用；全 test/ 目录内 leakScan/flow 仅出现在 helpers 自身及既有 flow.test.mjs/doctor.mjs/select.mjs 等，未被 T-013 交付测试接入。

**最强旁证**：dev 自身 r2 `impl.md`（blob `cb1da706...` 相对父 `1fb55fbd...` 新增末段）明言「AC-032 指定的共享 auth flow、完整泄漏扫描及隔离场景仍缺失……追踪文件尚未创建，故本任务尚未完成，不能标记 covered」。

### (C) acceptance.md 未恢复，仍为弱化版（r1 finding (C) 未修复）

acceptance.md 在 r2 **零改动**，字节与 r1 verdict 记录的 `d931d998...` 完全相同。r1 已查明弱化来自 `ad36ca1a`（`fix(task013): AC-032 checks suite pass, not hardcoded test titles`）：此前 `0306845d~588057fb` 的 7546 字节版本含 5 个硬编码规定标题 + run-tests 发现清单 + T-013.json 追踪分片 + flow/cli-envelope 回归断言，被整体删除。用户 note（`inputs.jsonl:6`，05:15Z）只授权「Add the missing test … Or remove that expected title from acceptance if the behaviour is covered elsewhere」（针对单个标题、且以行为已被覆盖为前提），整体删除超出该授权。

本轮 dev-r2 虽改了 2 个测试文件（故 r1 (C) 的「零源码/测试改动」已不再成立），但未把 acceptance.md 恢复为能强制覆盖的命令；`ci-results.json` 的 1/1 仍只证明弱化后单条命令通过，不构成 design.md §13-§16 的覆盖证据，也不强制 `design.md:61` 的「测试非空、无 skip/todo、正式 runner 发现清单及追踪分片」检查。

### (D) acceptance.md:7 条款悬空（P2，r1 finding (D) 未修复）

`acceptance.md:7` 写「测试标题约束只用于确保**下列覆盖**不会被空测试、漏注册或 skip 隐藏……**每个列出的标题**须对应实际行为断言；禁止只有 mock 调用次数、仅检查变量名、预填正确 env 或直接调用 auth 模块后宣称真实 CLI 通过」，但当前 acceptance.md 全文（`:1-16`）已无任何「下列覆盖/列出的标题」，该防空洞条款无指代对象、不可执行。`design.md:61`（建议验收方向）要求的检查亦不再被命令强制。此为验收文档缺陷（评审角色被禁止修改 acceptance.md，无法就地修复），严重度低于 (A)(B)(C)。

## 4. findings 摘要

| severity | 标题 | 位置 |
| --- | --- | --- |
| **P1** | design.md 九项 write_scope 中两个必交交付物仍缺失：`test/flows/steps/auth.mjs`、`test/traceability/T-013.json`（r1 (A) 未修复） | design.md:10 |
| **P1** | AC-032 集成仍缺 leakScan/auth flow/state_dir 隔离/覆盖旧值/后端失败等 §13-§16 覆盖，且 dev 自述未完成（r1 (B) 部分修复） | test/integration/secrets-native.test.mjs:12 |
| **P1** | r2 未恢复 acceptance.md，仍为弱化版单命令；CI 1/1 不校验 §13-§16 覆盖（r1 (C) 未修复） | acceptance.md:11 |
| **P2** | acceptance.md:7 防空洞/防 skip 条款悬空，design.md:61 验收方向检查不被命令强制（r1 (D) 未修复） | acceptance.md:7 |

逐条 detail 见 verdict-r2.json 的 findings 数组。

## 5. 备注（非缺陷，不写入 findings）

1. 用户 note（`inputs.jsonl:3`，04:53Z）已将 AC-033 划归 T-034 并要求从 acceptance.md 移除 AC-033 章节，`commit 0306845d` 与当前 acceptance.md 仅 1 个 AC 一致。本轮不就 AC-033 另立判据、不发明 AC 编号、版本号或章节名；`test/unit/secrets.test.mjs:12/:108/:140` 仍带 [AC-033] 标题但不被 acceptance.md 命令执行，不计入本轮 finding。
2. `design.md:65` 的 `check-fast.ps1` 属下游实现检查且检查链含 git，受禁止执行 git 命令／不重跑验收约束未运行，按既有口径不并入 AC-032 判定。
3. `impl.md` 是 dev 累计过程日志；其「本任务尚未完成」表述仅作 (B)(C) 旁证，判据以 design.md/acceptance.md 与只读文件/行号为准。
4. brief.md 全文 grep `报告|report|追加|append` 无命中；`design.md:18` 亦注明「brief 未提供基准 commit SHA 或既有验收报告路径」。故本轮结论**无追加目标、未改动任何历史小节**。
5. 未修改 brief.md、design.md、acceptance.md、impl.md、state.json、run.json 及任何被评审代码与文档；SHA 核验、提交链回溯、tree diff、blob 等价均以只读解压 .git 对象／读文件／算哈希／核对行号完成，未执行任何 git 子命令；仅创建 review-r2.md、verdict-r2.json（沿用本任务 r1 的双命名口径同步更新 review.md、verdict.json）。

## 6. 判定

acceptance.md 唯一 AC-032 命令由编排方以 PowerShell 7 实际执行、退出 0 且末行 `AC-032 OK`（ci-results.json:5-17），该执行项通过数/总数计 **1/1**；CI 结果不缺失、不与代码矛盾，未判「无法确认」，亦未以评审环境缺 pwsh 7/临时文件权限为由。但按「规格以 design.md 与 acceptance.md 为准」「独立判断是否真的满足（不要只看文件存在）」「其余请用只读方式独立验证实现与规格是否一致」逐条只读核对 r2 HEAD：design.md 九项 write_scope 中 2 个交付物在 HEAD tree 与工作树仍缺失；AC-032 集成仍缺 leakScan/auth flow/state_dir 隔离/覆盖旧值/后端失败/追踪分片；acceptance.md 未恢复仍为弱化版；dev 自身 impl.md 承认「本任务尚未完成，不能标记 covered」。r1 的 4 条 findings 中 (A)(C)(D) 未修复、(B) 仅部分修复。按「发现问题就判 needs_revision 并写成 findings；全部满意才判 pass」，本轮判 **needs_revision**。
