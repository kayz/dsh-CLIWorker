# Task 013 评审报告（review，本轮独立复验）

## 结论

- **verdict: pass**
- 所验证的 git sha（so 验证的 git sha）: `2ebaa7b1519cfe590085a0ada37b65d092518a20`
- 通过数/总数: **1/1**（acceptance.md 唯一 AC-032 命令；执行证据有效）
- findings: **0 条**（P0/P1/P2 均无）
- 本轮结论无追加目标（brief 未指定验收报告路径）
- 本轮为对当前 HEAD 的**独立复验**，非照抄 r1/r2/r3；前轮 4 条 findings 已逐条销项

## 1. 所验证的 git sha（只读，未执行任何 git 子命令）

`2ebaa7b1519cfe590085a0ada37b65d092518a20`（写入 verdict.sha）。

- 工作区 `.git:1` = `gitdir: C:/git/dsh-CLIWorker/.git/worktrees/013`；`.git/worktrees/013/HEAD:1` = `ref: refs/heads/task/013`；`.git/refs/heads/task/013:1` = `2ebaa7b1519cfe590085a0ada37b65d092518a20`。
- 只读 zlib 解压松散对象 `.git/objects/2e/baa7b1519cfe590085a0ada37b65d092518a20`（对象头 `commit 219`），对解压字节重算 SHA-1 = `2ebaa7b…`（match=true）；tree `aed95f7147ccce19e3e72d7e726cb3d425f07940`，parent `915901470b45d2183cba7c59f0e249358acab274`，author/committer `Kermit <kayzcn@gmail.com> 1794123671 +0800` = 2026-11-08T07:41:11Z，消息 `stage(dev): task 013`。
- reflog `.git/worktrees/013/logs/HEAD:20` 末条 `9159014 -> 2ebaa7b` 即本 HEAD，之后无后续提交（`:19` 为 `fix(dev-r4): address review findings`，`:18` 为 `stage(review-r3)`）。
- `ci-results.json:4` ranAt `2026-11-08T15:41:18.5232444+08:00`（= 07:41:18Z）晚于该提交 7 秒；`run.json` 末条 ci 07:41:18.618Z `passed=1 total=1 ok=true`；`state.json:232-233` status=reviewable / updated_at 07:41:18.621Z。故本 sha 即被验收代码。
- 只读复算 12 个被评审文件工作树 git-blob SHA-1（LF 归一化）与 HEAD tree 逐一相等（MATCH=12/12）：acceptance.md `0f896b656e`、design.md `f6422b57ca`、brief.md `13dd5e7f6a`、impl.md `aa0e79c938`、lib/secrets/index.mjs `efedcc8db7`、lib/config.mjs `7a874a8376`、lib/cli.mjs `e2401542c9`、lib/exec.mjs `3a7a59aa57`、test/unit/secrets.test.mjs `16224b1926`、test/integration/secrets-native.test.mjs `35421ceb96`、test/flows/steps/auth.mjs `a972cbce4d`、test/traceability/T-013.json `91f13dc4d7`。全库 628 文件 worktree-vs-HEAD 仅 `ci-results.json` / `run.json` / `state.json` 三处不一致，均为编排方在 HEAD 提交后生成的执行/状态证据（非被评审源码），按执行证据口径不计为缺陷。
- `ci-results.json` SHA-256 = `46b69723398b8acffd4f15d967e8482007f3fca9fb58c47d8ced6f4aefc421c7`（1828 字节）；acceptance.md 工作树 CRLF 1374 字节 SHA-256 `b72e876c…`，LF 归一化 blob `0f896b656e`，与 r1/r2/r3 记录一致，本轮未改动。
- 只读 tree diff（r3 HEAD `71b3386783ce8a5dc394ac683c3411735970fd91` → 本 HEAD）：**ADDED 5**（`test/flows/steps/auth.mjs`、`test/traceability/T-013.json`，另 3 个为 handoff/review-r3/verdict-r3 文档）、**CHANGED 10**（`lib/secrets/index.mjs`、`test/integration/secrets-native.test.mjs`、`test/unit/secrets.test.mjs` 三项 write_scope 源码，其余为 ci-results/impl/notice/review/run/state/verdict 等编排与文档文件）、**REMOVED 0**。无任何 write_scope 外的生产代码/测试改动，符合 design.md:55-57。

## 2. 逐条核对 acceptance.md

acceptance.md 恰有 1 个 `## AC-` 小节（`:9` AC-032）、1 个 pwsh 代码块（`:11-13`）、1 条 `- 期望:`（`:15`，退出码 0、最后一行是 `AC-032 OK`）、`:7` 测试标题约束条款。

**AC-032（执行类，判通过）**：`ci-results.json:5-7` 顶层 `passed=1, total=1, ok=true`；`results[0]`（`:9-17`）`passed=true, exitCode=0, durationS=5.8, lastLine='AC-032 OK'`，output 为 TAP：6 个 Subtest 全 ok、`1..6`、`# tests 6`、`# pass 6`、`# fail 0`、`# cancelled 0`、`# skipped 0`、`# todo 0`，末行 `AC-032 OK`。逐字命中 `:15` 期望。

ci-results.json 的 6 个标题与 `test/integration/secrets-native.test.mjs:43`、`:44`、`:46`、`:72`、`:95`、`:142` 的 6 个 `test(` 标题逐字一致；`# pass 6` 与该文件 6 个 `test(` 一致。按口径，ci-results.json 由编排方用 PowerShell 7 产生，是「执行类」验收项的有效运行证据，**本轮直接引用、未自行重跑**；评审环境缺 pwsh 7 或缺临时文件权限不作为判 needs_revision 的理由，本轮亦未以此为理由。CI 结果不缺失、且不与代码明显矛盾（native 用例仅在 `:174` 的 `CLIWORKER_TEST_NATIVE_SECRETS==='1'` 时注册，全库 grep `.skip` 仅 `:179` 的 `t.skip` 位于该门控块内，默认运行不产生 skipped/todo；HEAD 07:41:11Z 早于 ranAt 07:41:18Z；被评审源码 blob 与 HEAD 相等），故**不把 AC-032 标为「无法确认」**。

## 3. 独立只读核对实现与规格（design.md + acceptance.md）

规格以 design.md 与 acceptance.md 为准；对「其余」项按口径用读文件、算哈希、核对行号、只读解压 .git 对象独立验证。本轮独立复验当前 HEAD（tree 628 文件），非照抄 r1/r2/r3。

### 3.1 前轮 findings (A)(B) 已销项

- **(A) 两个必交交付物**：design.md YAML `write_scope :3-11` 九项中 `test/flows/steps/auth.mjs`（`:10`）与 `test/traceability/T-013.json`（`:11`）在 HEAD tree 与工作树均存在且已提交（blob `a972cbce4d` / `91f13dc4d7`）。`auth.mjs:8-10` 导出 `name='auth'`、`introduced_by='T-013'`、`ac=['AC-032']`，`:206-228` 导出 `run(flow)` 并用共享 `flow.run/flow.spawn` 跑真实 bin 两种输入各 set/status/消费/clear —— 符合 design.md:33、:48（§13）。`T-013.json:2-15` 仅含 `task/milestone/entries`，entries 各含 `ac/files/status`、`:8/:13` `status='covered'` —— 符合 design.md:34（§16 追踪分片）。`secrets-native.test.mjs:142-171` 实际 `discoverSteps()` 并 `step.mod.run(flow)`（`:147/:151`），断言 `introduced_by='T-013'`（`:149`）、`ac=['AC-032']`（`:150`）与追踪分片键/covered/文件存在（`:159-168`）—— 符合 design.md:50（§15「必跑 AC-032 由允许的 integration `.test.mjs` 实际调用 auth flow」）。
- **(B) AC-032 集成覆盖**：6 个运行时用例（`:43/:44/:46/:72/:95/:142`）覆盖 from-env 与 stdin 跨进程持久化+env 注入（`:23-41`）、默认引用覆盖旧值与不同 state_dir 隔离且 provider 未启动（`:46-70`，`:57` 配置文件字节不变）、显式 keychain 引用含引号/反斜杠/路径形态与 win32 文件名完整 SHA-256（`:72-93`）、clear 后消费失败且 provider 不启动（`:103-107`）、ENOENT/permission 后端失败时 state_dir 递归列表与已有文件字节不变且原本缺失目录未创建（`:110-134`）。`auth.mjs:103-113` 的 `scanAuth` 在 set 后/消费后/clear 后以 `flow.sentinels` 扫描 stdout/stderr/argv/HTTP/state_dir/audit 及整个 `flow.root`，断言 `ok=true, hits=[], errors=[]`（`test/helpers/leak-scan.mjs:11` ENCODINGS 含 raw/utf16le/base64/hex）；`auth.mjs:92-101`、`:183-194` fake-cli 记录 argv/变量名/sha256，目标变量集合恰为 `KIMI_API_KEY`；`:17-90` preload 仅替换后端 `spawnSync` 并 `syncBuiltinESMExports`、AES-256-GCM 替身、密钥仅存测试进程内存/子环境；`:129-204` `createAuthFixture` 在 `flow.root` 生成夹具并在创建 provider 前移除 `CW_TEST_SECRET_*`/`NODE_OPTIONS`；native 用例按 `:174/:175-182` 平台/工具/会话门控、skip 按 `cliworker.skip/v1`（`test/helpers/platform-gate.mjs:80-97`），名称不带 `[AC-032]`/`[AC-033]`。design.md §13-§16 覆盖成立，且为真实跨进程 CLI 行为断言（非 mock 次数/仅变量名/预填 env/直调 auth 模块）。

### 3.2 design.md §1-§12 逐项只读核对

- `lib/secrets/index.mjs:13-19` `locate` 仅接受 `{ref:'env|keychain|session:…'}`、未配置时用内存 `keychain:<cli>` 且不改写配置（integration `:57` 校验）；`:21-26` namespace = `cliworker:` + 绝对 state_dir 完整 SHA-256（`lib/config.mjs:110` `_home` 由 `lib/paths.mjs:15-34` `resolvePaths` 得绝对路径，win32 小写）；`:28-33` execute 全程 `ctx.exec`/`shell:false`、秘密只走 `input`；`:35-37/:93` 仅 linux 退出 1 且 stdout/stderr/error 全空才映射 unset；`:39-42` `quoteSecurity` 转义引号/反斜杠、控制字符返回 `E_REQUEST_INVALID`；`:44-95` 三平台 pwsh DPAPI / `security -i` / secret-tool 构造与 Windows 临时密文+rename+失败回滚；`:97-111` env 只读、session 同 ctx 隔离；`:115-133` `runWithSecrets` 只向 `call.env_names` 注入、删除所有携带秘密的未声明变量（win32 大小写不敏感）、`redact` 返回。
- `lib/commands/auth/_common.mjs:6-33`：缺 cli / 多余位置参数 / 未知选项 / 缺选项值 / 空输入 / 空环境变量 → `E_REQUEST_INVALID` 且后端不调用；`:25` `readFileSync(0)` 仅去一个行尾 LF/CRLF，不新增 `ctx.stdin`（`lib/context.mjs:49-60` 无 stdin 字段）；成功仅 `{ok:true,state:'set'|'unset'}`。
- `lib/config.mjs:83-94` 递归对象/数组、键名 `/(token|api_key|secret|password)/i` 且值为字符串 → `E_CONFIG_SECRET_INLINE`，合法 SecretRef 对象放行；`lib/contract/registry.mjs:15-20/:96-101/:104-109` 给出 `E_REQUEST_INVALID=2`、`E_CONFIG_SECRET_INLINE=3 retryable=false`、`E_SECRET_BACKEND=3 retryable=false`。
- `lib/cli.mjs:11-13/:31-33/:41` 仅加三条 auth 静态 import/ROUTES/resolveRoute，`USAGE(:17)`/`CONFIG_FREE(:19)` 未改；`lib/exec.mjs:298` 同步仅 `input!==undefined` 传入、`:493` 异步有 input 才 pipe、`:509-516` stdin error 处理 + `end(input)`（空串亦 EOF）、`:350-360` settle/release/clearTimeout。
- `test/unit/secrets.test.mjs` 共 23 个 `test(`（`[AC-033]` 标题 18 处），覆盖三平台后端构造/参数/shell=false/argv 无秘密/ENOENT 与普通失败/递归目录与已有文件字节/Windows 临时回滚/unset 与损坏区别/输入校验/明文检测/CLI envelope/同步与异步 input、EOF、EPIPE、超时、并发槽、无 input 回归（`:144-174`、`:176-188`、`:245-294`、`:296-333`、`:335-348`、`:350-375`、`:377-387`、`:389-407`、`:409-434`、`:436-448`、`:450-463`、`:465-478`、`:480-520`、`:522-534`、`:536-570`）。`scripts/run-tests.mjs:243-253` 按源码 `[AC-nnn]` 标记选择整个文件；grep 确认 `[AC-032]` 仅出现在 integration 文件（6 处）、`[AC-033]` 仅出现在 unit 文件（18 处），符合 design.md:51（§16）。
- grep 确认 `lib/**` 无 `CW_TEST_SECRET_*` / `CLIWORKER_TEST_NATIVE_SECRETS` / `NODE_OPTIONS` / `SENTINEL` 等生产测试开关或硬编码 env 名（design.md:45、:46、:57）。

## 4. 前轮 findings 销项对照

| 前轮 | 内容 | 本轮独立核验 | 状态 |
| --- | --- | --- | --- |
| (A) P1 | `auth.mjs` 与 `T-013.json` 缺失 | HEAD tree/工作树均存在且已提交，元数据/`run(flow)`/covered 分片齐全（§3.1） | 已销项 |
| (B) P1 | 集成缺 auth flow/显式 ref/后端失败/原生门控/追踪分片，dev 自述未完成 | 6 个真实用例 + auth flow + leakScan + 门控 + 分片断言齐全（§3.1）；CI 6/6 通过 | 已销项 |
| (C) P1 | acceptance.md 弱化单命令，CI 1/1 不校验 §13-§16 覆盖 | §13-§16 覆盖现已真实存在并由测试与只读核对证实；acceptance.md 为受保护规格文档，评审不得改写或自行发明验收命令 | 实质销项，文档措辞见备注 |
| (D) P2 | `acceptance.md:7` 条款悬空、`design.md:61` 检查不被命令强制 | ci-results.json 的 6 个标题逐字对应 6 个真实行为断言；runner 发现/追踪分片由 `secrets-native.test.mjs:142-171` 与 `run-tests.mjs:243-253` 落实；属建议性/文档措辞，不写入 findings | 实质销项，见备注 |

## 5. 备注（非缺陷，不写入 findings）

1. `acceptance.md:7` 的「下列覆盖/列出的标题」无标题列表，属文档措辞悬空；但 `ci-results.json` 的 6 个 `[AC-032]` 标题均逐字对应 `secrets-native.test.mjs` 中 6 个真实行为断言，`# skipped 0`/`# todo 0`、native 门控不注册均满足防空洞/防 skip 意图。`design.md:61` 位于「建议验收方向」，其 runner 发现清单与追踪分片检查已由 `secrets-native.test.mjs:142-171`（`discoverSteps`、`T-013.json` 键/entries/covered/files 存在）与 `scripts/run-tests.mjs:243-253`（按源码标记选整个文件）落实。评审角色被禁止修改 acceptance.md，且不自行发明字段、版本号、章节名或验收命令，故不作为缺陷。
2. AC-033 不在 acceptance.md（用户 note 已划归 T-034，design.md:34 仅在追踪分片登记）；本轮不就 AC-033 另立判据、不发明 AC 编号或章节名。`test/unit/secrets.test.mjs` 的 `[AC-033]` 用例与 `T-013.json` 的 AC-033 条目按 design.md §15/§16 只读核对，均存在且 covered。
3. `design.md:65` 的 `check-fast.ps1` 属下游实现检查且检查链含 git，受禁止执行 git 命令/不重跑验收约束未运行；`impl.md` 记录的全项目检查阻碍（范围外 `docs/ui/cliworker-console.html:1073`、`test/unit/gitignore.test.mjs:13/:18`、`test/unit/import-safe.test.mjs:70`、npm pack 退出码）均不在 write_scope、不在 acceptance.md，按执行证据口径与本轮限制不作为 needs_revision 理由。
4. `impl.md` 是 dev 累计过程日志；其历史「本任务尚未完成」表述针对早期候选，本轮判据以当前 HEAD 的 design.md/acceptance.md 与只读文件/行号为准。
5. brief.md 全文无验收报告路径（`design.md:18`、`acceptance.md:3` 亦注明「brief 没有基准 commit SHA 或既有验收报告路径」），故本轮结论**无追加目标、未改动任何历史小节**。
6. 未修改 brief.md、design.md、acceptance.md、impl.md、state.json、run.json 及任何被评审代码与文档；SHA 核验、提交链回溯、tree diff、blob 等价均以只读解压 .git 对象／读文件／算哈希／核对行号完成，未执行任何 git 子命令；仅创建/修改 review.md、review-r1.md、verdict.json、verdict-r1.json（同内容双命名副本），未创建其它文件。

## 6. 判定

acceptance.md 唯一 AC-032 命令由编排方以 PowerShell 7 实际执行、退出 0 且末行 `AC-032 OK`（ci-results.json:5-17），通过数/总数 **1/1**；CI 结果不缺失、不与代码矛盾，未判「无法确认」，亦未以评审环境缺 pwsh 7/临时文件权限或 check-fast 未运行为由。按「规格以 design.md 与 acceptance.md 为准」「独立判断是否真的满足（不要只看文件存在）」「其余请用只读方式独立验证实现与规格是否一致」逐条只读核对：design.md 九项 write_scope 全部交付且均在 HEAD tree，AC-032 集成由 6 个真实跨进程用例覆盖 auth flow/显式与默认 ref/隔离/覆盖旧值/clear 后失败/后端失败无文件变化/全表面泄漏扫描/原生门控，追踪分片 covered，design.md §1-§16 与 acceptance.md AC-032 均满足；前轮 4 条 findings 已销项。按「全部满意才判 pass」，本轮判 **pass**，findings=[]。
