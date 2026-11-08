# Task 012 评审（当前轮，round 1）

结论：**pass**。所验证的 git sha：`9985d818e7803bcc6053fd96374c52046c15a51e`。逐条核对 `acceptance.md` 的唯一一条 AC（`AC-031`），**1/1 通过、0 项无法确认、0 条 finding**。CI（`.collab/tasks/012/ci-results.json`）顶层为 `passed=1, total=1, ok=true`（:5-7），`results[0]`（:9-17）`exitCode=0`、`lastLine='AC-031 OK'`。

## 1. 核验范围与证据口径

- **SHA 来源（只读）**：工作区 `.git:1` = `gitdir: C:/git/dsh-CLIWorker/.git/worktrees/012` → `worktrees/012/HEAD:1` = `ref: refs/heads/task/012` → `.git/refs/heads/task/012:1` = `9985d818e7803bcc6053fd96374c52046c15a51e`。只读 zlib 解压松散对象 `.git/objects/99/85d818…` 得 254 字节，对解压字节重算 SHA-1 得同一值（match=true）；对象头 `commit 254`，tree `5e85c050…`，parent `6bafba42…`，时间戳 `1794102641 +0800` = `2026-11-08T01:50:41Z`，消息 `fix(dev): repair after CI failure (task 012)`。父链 `9985d81 → 6bafba4 → f9a06c1 → 99f4e3c → 682a62e → …`，`ORIG_HEAD = 682a62ede475d16f090d1e768f3c6d4aa5aa0e6a` 与 `acceptance.md:3`、`design.md:3` 基准 `682a62e` 一致。`ci-results.json:4` 的 `ranAt=2026-11-08T09:50:47.4978303+08:00`（=01:50:47Z）晚于该提交约 6 秒，reflog 末条即该提交、之后无新提交，故 CI 对应当前 HEAD。`ci-results.json` 的 SHA-256 = `84a7042613ebaaa515160cebf66d98198a6b96030d07e4b1f37348483078ce00`。
- **执行证据口径**：`ci-results.json` 由编排方用 PowerShell 7 产生，含每条命令退出码与输出，按口径为执行类验收项的有效运行证据，直接引用、不自行重跑；评审环境缺 pwsh 7 或临时文件权限不作为判 `needs_revision` 的理由。CI 结果不缺失、与代码无明显矛盾（见 §3、§4）。
- **其余一律只读独立验证**：读文件、算哈希、核对行号、只读 zlib 解压 `.git` tree/commit 对象、对 `leak-scan.mjs` 纯函数做内存求值。未执行任何 git 子命令；未重跑任何会写文件的验收/测试/check 脚本。
- 规格以 `design.md` 与 `acceptance.md` 为准；沿用既有 `verdict` 字段（verdict/sha/passed/total/evidence/findings/checks）与 `acceptance.md` 的 `AC-031` 章节名，未新增字段、版本号或章节名。
- `brief.md` 全文 grep `报告/report/追加/.md` 仅命中 `:23`（规格输入清单）与 `:29`（「…被检出并报告位置」，指哨兵位置），无验收报告路径；`design.md` 亦无（grep `验收报告/报告路径/append` 无匹配）。故本轮结论无追加目标、未改动任何历史小节。

## 2. 逐项结论（沿用 acceptance.md 编号，共 1 项）

`acceptance.md` 恰有 1 个 `## AC-` 小节（`:7`）、1 条 `- 命令:`（`:9`）、1 条 `- 期望:`（`:10`）；该单条 `node -e` 命令是判定器，内部逐项判定 `:14-21` 的全部子检查，全部通过才打印 `AC-031 OK`。

| 验收项 | 结论 | 证据 |
|---|---|---|
| AC-031 | 通过 | **命令输出**：`ci-results.json:9-17`，`passed=true`、`exitCode=0`、`lastLine='AC-031 OK'`、`output='AC-031 OK'`；顶层 `:5-7` `passed=1/total=1/ok=true`，与 `acceptance.md:10`「退出码 0 且 stdout 末行 AC-031 OK」相符。**逐子项独立佐证**：(1) unit 整跑：`test/unit/leak-scan-canary.test.mjs` 15 个 `test(`、标题全含 `[AC-031]`、无 `.skip/.todo/.only`，满足 `pass>=9`，三项为 0 由 CI 判定；(2) flow 整跑：`test/flows/flow.test.mjs` 8 个 `test(`、标题全含 `[AC-031]`，满足 `pass>=4`；(3) 9 个 unit 选择器按标题命中 `stdout 1 / stderr 1 / state_dir 2 / audit 1 / http 3 / argv 1 / clean 1 / not leak 1 / input 1`，均 ≥1；(4) 4 个 flow 选择器 `discover 2 / full flow 1 / env 1 / self-test 5`，均 ≥1；(5) `run-tests.mjs:243-253` 按源码含 `[AC-031]` 过滤、只读 grep 恰 2 文件、`:280/:314` 打印 `run-tests: filtered 2 files`；(6) 4 个 check 脚本存在，`check-write-scope.mjs:218` 输出 `check-write-scope: ok`、`:207` 仅越界时输出 `write_scope.outside`；(7) 7 个交付文件存在，工作树 `test/` 文件 181 == HEAD tree 中 `test/` 跟踪文件 181、`UNTRACKED_IN_TEST=0`、7/7 交付文件工作树==HEAD blob；(8) 6 个 `.mjs` 仅 `node:*` 与相对 import，无 `lib/` import / 裸模块名 / `require(` / 24 位 hex 硬编码哨兵字面量。**文件行号**：精确 location 断言见 `leak-scan-canary.test.mjs:36/:48/:65/:83/:99/:113/:127/:140`，`flow.test.mjs:33-180`，`leak-scan.mjs:8-317`，`flow.mjs:17-252`。 |

## 3. CI 输出与代码的独立对齐（不只看文件存在）

- **过滤 2 文件**：`scripts/run-tests.mjs:243-253` 用 `source.includes('[AC-031]')` 过滤；只读 grep `[AC-031]` 命中恰 2 文件（`test/unit/leak-scan-canary.test.mjs`、`test/flows/flow.test.mjs`），`:280` `mode='filtered'`、`:314` 打印 `run-tests: filtered 2 files, manifest …`。与 CI 断言的该串一致。
- **选择器命中**：只读从两份测试源码抽取全部 `test(` 标题（unit 15 / flow 8，全含 `[AC-031]`，无 skip/todo），对 9+4 个 `--test-name-pattern` 选择器按子串统计，每个 ≥1；CI 逐个模式 `pass>=1 && fail 0` 有据可依。
- **静态脚本字符串**：`scripts/check-write-scope.mjs:218` 为 `check-write-scope: ok`、`:207` 为越界失败行 `FAIL write_scope.outside …`；`check-traceability.mjs`、`check-test-discovery.mjs`、`check-unused.mjs` 均存在。`run-tests.mjs:19` 的 `TEST_DIRS` 含 `flows`，故 `flow.test.mjs` 被枚举；`test/flows/steps/*.mjs`（Glob 确认恰 `doctor.mjs`、`select.mjs`）不以 `.test.mjs` 结尾，不被枚举为测试文件、不构成 orphan（design §0）。
- **CI 与 HEAD 不矛盾**：HEAD 提交 `2026-11-08T01:50:41Z`，CI `ranAt 01:50:47Z` 晚 6 秒、reflog 之后无新提交；7/7 交付文件按 git blob 算法（LF 归一化后 SHA-1）与 HEAD tree 逐字节相等、工作树 `test/` 无未跟踪/无修改，故 CI 跑的就是当前内容。

## 4. 实现与规格一致性（独立只读核对 + 纯函数内存求值）

| 项 | 核对内容 | 结果 |
|---|---|---|
| `leak-scan.mjs` §1 导出 | `:8` `MIN_SENTINEL_LENGTH=16`；`:40-45` `makeSentinel`；`:48-80` `normalizeSentinels`；`:83-97` `scanBytes`；`:292-317` `leakScan` | 5 个导出齐全 |
| 哨兵与校验 | 格式 `cwsentinel_<label>_<24hex>`、坏 label `TypeError`、空/短(<16)/重复 label `TypeError`、字符串列表自动 `S1/S2`；内存求值 16 条全 PASS | 与 design §1.1 一致 |
| 四种编码 | `raw`/`utf16le`/`base64`/`hex` 用 `Buffer.indexOf`（`:31-37/:88-93`）；内存求值三种编码形式均检出且 `encoding` 正确 | 与 design §1.2 一致 |
| location / 面序 / 计数 | `stdout/stderr(:99-118)`、`argv(:120-138)`、`http` 名小写(`:173`)、`state_dir` 递归+码点序+跳符号链接+`#name`(`:204/:210/:212-219`)、`audit 行号:行内偏移`(`:275`) 与审计去重(`:226`)；hits 面序 `:298-314`；`scanned` 六计数(`:106/:125/:143/:236/:259`)；`hit.sentinel` 为 label；`ok=hits+errors` 皆空(`:316`)。内存求值精确得到 `stdout@5`、`stderr[1]@1`、`argv[0][3]@0`、`http[0].body@1`、`http[0].headers.x-token@0`，且 `JSON.stringify(result)` 不含哨兵值 | 与 design §1.3 一致 |
| `flow.mjs` §2 | `:17` `SENTINEL_ENV`、`:18-28` `STEP_ORDER`（9 项与 design 逐字相同）、`:29` `STEPS_DIR`；`:65-93` `discoverSteps` 契约校验/重名/排序；`:139-218` `createFlow`（`os.tmpdir` mkdtemp、`config.json` 夹具、不预建 `state/`、`env` 删 `NODE_TEST_CONTEXT`+`CLIWORKER_*` 且哨兵只经 env）；`:153-214` `spawn/run/recordHttp/scan/cleanup`；`:230-252` `runFlow` 不短路、`error` 按 `<label>` 脱敏、不调用 cleanup | 与 design §2 一致 |
| 两个步骤 §3 | `doctor.mjs:10-30`（`paths`/`providers`，`path.resolve`+win32 忽略大小写，`1.2.3`）、`select.mjs:10-23`（`models select --level Quick --request-id flow-select-1`，恰好模型 `q`）；均不写 state_dir、不把哨兵放 argv | 与 design §3 一致 |
| `flow.test.mjs` §4 | `:33-52` 发现/顺序；`:54-73` 全链同一 state_dir、`leak.ok`、`scanned.argv/stdout>0`、cleanup 后 root 消失；`:75-90` env 传哨兵且 argv 无哨兵；`:92-180` 5 个 `self-test` 夹具（stdout/state_dir/argv 泄露、抛错不短路并脱敏、非法契约）、均 `os.tmpdir` 且 finally 清理；grep 无 `sleep`/墙钟 | 与 design §4 一致 |
| `leak-scan-canary.test.mjs` §4 | 9 项全覆盖：精确 location(`:65/:83/:140`)、干净运行 scanned(`:144-167`)、编码(`:169-190`)、多哨兵(`:192-209`)、不泄露(`:211-232`)、`#name`(`:234-247`)、输入校验(`:249-257`)、缺失目录/audit=0(`:259-269`)、audit 单次(`:70-87`) | 与 design §4 一致 |
| 追踪 `T-012.json` §5 | `:1-14` 三键、`AC-031 → covered`、files 列表两文件 | 满足 |
| 写域（只读 tree diff） | 基准 `682a62e`（536 跟踪）→ HEAD（549）：ADDED 13 = 6 个 `.collab/tasks/012/` 编排文件 + 恰 7 个 write_scope 文件，REMOVED 0、MODIFIED 0，越界 0；`lib/`、`scripts/`、`bin/`、`contracts/` 零改动 | 满足 |
| 依赖/泄露门 | 6 个 `.mjs` 仅 `node:*` 与相对 import，无 `lib/` import、无裸模块名、无 `require(`；唯一 `cwsentinel_` 为 `leak-scan.mjs:44` 模板串（非 24hex 字面量） | 满足 |
| 洁净度 | 工作树 `test/` 181 文件 == HEAD tree 跟踪 181，`UNTRACKED_IN_TEST=0`；7/7 交付文件工作树==HEAD blob | 满足 |

## 5. Findings

无。全部验收项独立判断为满足，无 P0/P1/P2 问题。

## 6. 备注（非缺陷，不写入 findings）

- `design.md §1.3` 要求 hits「面内按位置顺序」；`scanBytes(:88-93)` 在单个缓冲区含多个哨兵/编码时按「哨兵 → 编码」顺序产出而非严格按 offset 排序。顺序仍确定，且所有 canary 用例均为每缓冲区 1 哨兵×1 编码（编码用例拆成 3 个独立文件，按文件名字典序遍历），不触发该分支，不影响任一验收项。
- `design.md §4` canary「每例断言 errors 为空」；实际 `:28/:52/:70` 三例断言 `errors=[]`，`:41/:89/:103/:116/:130` 五例未断言。实现在这些场景本就不产生 errors，不影响验收。
- `impl.md`「本轮（attempt 3）」与 `state.json:58` `attempt=4` 为 dev 内部轮次标注差异，非交付物缺陷。
- `impl.md`「已知阻塞」记载的全量 `run-tests` 3 个基线遗留失败（`AC-073`/`AC-013`/`AC-006`）归属文件不在 T-012 write_scope，按 `acceptance.md:23` 不作为 AC-031 判定条件。

## 7. 交付

本轮仅创建/修改允许的评审产物：`review.md`、`review-r1.md`、`verdict.json`、`verdict-r1.json`（两份 review、两份 verdict 内容一致）。未修改 `brief.md`、`design.md`、`acceptance.md`、`impl.md`、`state.json`、`run.json` 及任何被评审代码与文档；未执行 git 命令；未重跑会写文件的验收/测试/check 脚本；未改动任何历史小节。
