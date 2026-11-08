# Task 008 评审（review）

## 结论：pass（18/18）

- 所验证的 git sha：`994745f367fbdeb8c783089600c66a1e2e974846`（分支 `task/008` HEAD）。由只读解压 `.git` 对象取得，全程未执行任何 git 子命令；详见「SHA 核验」。基准（起点）提交 `86ff20e8d8db8ac9a101edae6230a0dfb1d9cde8`（`86ff20e`），与 `design.md:16`、`acceptance.md:3`、`impl.md:3` 一致。
- 通过数 / 总数：**18 / 18**。`acceptance.md` 恰含 18 个以 AC id 开头的二级小节（`grep -c '^## AC-' = 18`，行号 13/18/23/28/33/38/43/48/53/58/63/68/73/78/83/88/93/98），每节 1 条 `- 命令:` 与 1 条 `- 期望:`，与 `ci-results.json` 的 18 条 results 一一对应。逐条 `passed=true`，0 项无法确认，0 条 finding，未自行发明编号/章节名。
- 执行证据：`.collab/tasks/008/ci-results.json`（SHA-256 `d5008a7866e681787f306d2136432006f84cfe4daad33a3fde4e5966cdf46029`，`ranAt=2026-11-08T08:29:27.0663221+08:00`，`:5-7 passed=18 total=18 ok=true`）。18 条 results 逐条 `passed=true`、`exitCode=0`、`lastLine` 为 `AC-023 OK`/`AC-024 OK`。按【执行证据口径】直接引用，不自行重跑作为判据；评审环境缺 pwsh 7 / 临时文件权限不作为判 needs_revision 的理由。
- CI 结果不与代码矛盾：`ranAt` 晚于 HEAD 提交时间（`1794097745 +0800` = 2026-11-08 08:29:05 +0800）共 22 秒，reflog 末条即该提交、CI 之后无新提交；9 个 write_scope 文件工作树与 HEAD blob 逐字节 MATCH=True，故 CI 跑的就是当前内容。
- 独立复核不只依赖 CI：凡「执行类」以外的规格一致性，均以只读方式（读文件、算哈希、核对行号、只读解压 `.git` 对象、node 直接 import 做纯函数内存求值 / createFakeContext 内存复跑 `main()`、只读运行 `check-*` 脚本）独立验证；所有复跑均不改动仓库内文件。

## SHA 核验（只读解压 .git 对象，未用 git 子命令）

- 工作区 `.git` 文件:1：`gitdir: C:/git/dsh-CLIWorker/.git/worktrees/008`。
- `.git/worktrees/008/HEAD:1` = `ref: refs/heads/task/008`；`.git/refs/heads/task/008:1` = `994745f367fbdeb8c783089600c66a1e2e974846`。
- zlib 解压松散对象 `.git/objects/99/4745f367fbdeb8c783089600c66a1e2e974846` 得 230 字节，对解压字节重算 SHA-1 = `994745f367fbdeb8c783089600c66a1e2e974846`（match=true）。对象头 `commit 219`，`tree f7dd288e2264e17290c909bc3ca9adc63382cc7e`，`parent aa5673f9ea8de8f0a50887fcded554d1cebc3c4b`，时间戳 `1794097745 +0800`，消息 `stage(dev): task 008`（`COMMIT_EDITMSG` 同）。
- `.git/worktrees/008/ORIG_HEAD` = `86ff20e8d8db8ac9a101edae6230a0dfb1d9cde8`（基准）；`worktrees/008/logs/HEAD` 末条 `aa5673f9... -> 994745f...` 即 HEAD，无后续提交。
- 只读 tree 比对（见「写域」）：base `86ff20e`（tree `09feb913`，485 跟踪文件）→ HEAD（tree `f7dd288e`，495 跟踪文件）；9 个 write_scope 文件按 git blob 算法（LF 归一后 SHA-1）与 HEAD tree 逐字节比对全部 `MATCH=True`（工作树 CRLF、对象 LF）。

## 独立只读核对

| 项 | 核对内容 | 结果 |
|---|---|---|
| lib/output.mjs（design §2） | `errorBody` 键顺序 `ok,error` / `code,message,retryable,retry_after`；`exitCodeFor` 取注册表 `exit`、未知码回落 1；`errorBodyFrom` 已知码保留、无码/未知码转 `E_INTERNAL` 且 message 仅取 `e.message`（无 stack/令牌）；码不在注册表时换 `E_INTERNAL`；`writeJson` 格式 `JSON.stringify(value,null,2)+'\n'`。内存求值 8 个码逐一校验 + `error-envelope` schema `validate={ok:true}` | 满足（A-02/A-03/A-04/A-06） |
| lib/request.mjs（design §3） | 校验顺序（非对象→`E_REQUEST_INVALID`、schema→`E_SCHEMA_UNSUPPORTED`、level 优先/空值回落 tier、count 1..10、usage 大小写不敏感、importance 精确、可选字段类型）；警告按 `Object.keys(raw)` 顺序、`tier`→`W_FIELD_DEPRECATED`、其它未知→`W_FIELD_IGNORED`、legacy 不警告；规范化请求键顺序 `schema,request_id,level,count,usage,importance,...`；`requestFromArgv` 三写法等价/互斥/覆盖/`--count ^\d+$`；`gateView` draft/agentline/full | 满足（A-09/A-10/A-11/A-12） |
| lib/cli.mjs（design §5） | `USAGE`/`ROUTES`/`resolveRoute`/`CONFIG_FREE` 保持；`main([])` 旧用法行；无路由 `E_UNKNOWN_COMMAND`（exit 2）；catch 统一 `errorBodyFrom`+`exitCodeFor`、删 `CONFIG_ERROR_CODES`/`e.exitCode` 特判；成功路径 `writeJson` exit 0；错误路径不写 stderr。内存复跑 9 错误 + 9 成功 + 无参 + usage + testclock 全部符合 | 满足（A-02..A-06） |
| lib/commands/models/select.mjs（design §4） | `requestFromArgv`→`gateView`→`providerStatus`/`readUsage`→`selectModels`；`[...warnings,...viewWarnings]` 非空才写 `warnings`。A-07 两例（标志 draft `W_DRAFT_DEPRECATED`；--request-file 含 schema/role/tier 得 `W_FIELD_IGNORED`+`W_FIELD_DEPRECATED`、agentline 不带 `W_DRAFT_DEPRECATED`） | 满足（A-07） |
| README.md（design §6 / A-13） | 3 条 `models select` 行（标志/`--request`/`--request-file` 各 ≥1）+ 1 个 ```` ```json request ```` 块（含 `schema`、规范 `level:"Top"`）；所有示例解析后 `warnings=[]`；无 `"role"`/`"tier"` 请求字段；「输出与错误」小节含错误体形状、注册表退出码、`W_FIELD_IGNORED`、`W_FIELD_DEPRECATED`、0.3.0 移除 draft；未复制整张注册表、无令牌 | 满足（A-13） |
| 测试文件（design §7） | `cli-envelope.test.mjs` 5 个 `[AC-023]` 顶层测试（9 错误表驱动 + E_INTERNAL + 9 成功 + W_TEST_CLOCK + 无参）；`request.test.mjs` 8 个 `[AC-024]` 测试；`a5-ignored-fields.test.mjs` 末尾 1 个顶层 `[fixed] [AC-024]`；`T-008.json` 形状正确 | 满足（A-01/A-08/A-14/A-15） |
| 缺陷登记（A-14） | 按 `check-defects.mjs:145-179` 重算 `[repro]` 段 SHA-256 = `ea537e6df09eb0d1a362b8eea314946af7cba467ccbf1fee961bb1d2682ce8ca` == `defects.json:64`；`check-defects: ok`；`[repro]` 一字未改、`[fixed]` 恰 1 个顶层 test | 满足 |
| 追踪（A-15） | `check-traceability: ok (covered=28 planned=46)`（基线 26/48，AC-023/AC-024 转 covered）；`T-008.json` 恰 2 条 covered entries 且 files 与设计一致 | 满足 |
| 回归/既有测试（A-16/A-17） | 全量 `tests 326 / pass 323 / fail 3`，3 条失败恰为基线遗留；`config`/`paths-entries`/`clock` `pass 20 / fail 0`；`import-safe` 保持 `pass 4 / fail 1`，唯一失败为第 3 个 `[AC-006] ctx.stderr` 用例 | 满足 |
| 辅助检查（A-18） | `check-defects`/`check-seams`/`check-unused`/`check-golden-frozen`/`check-frozen-files`/`check-contract-doc` 全部 `ok`、exit 0；新文件 `check-unused` 亦 ok | 满足 |
| 写域（只读 tree diff） | base→HEAD：ADDED 10（5 个 `.collab/tasks/008/` 编排维护文件 + 5 个 write_scope 文件），MODIFIED 4（`README.md`、`lib/cli.mjs`、`lib/commands/models/select.mjs`、`a5-ignored-fields.test.mjs`），REMOVED 0；写域外（排除 taskdir）= []。`brief.md`、`defects.json`、`contracts/**`、`lib/select.mjs`、`lib/index.js`、`lib/contract/*` 零改动 | 满足 |
| 字符串门 / 令牌门 | 9 个改动文件 grep 无 `sk-`/`ghp_`/`xox`/`AKIA`/`PRIVATE KEY`/`Bearer`/`ANTHROPIC_API_KEY` 字面量；错误体 message 只取 `e.message`，A-02 内存复跑 stdout 不含 `sk-t008-secret` | 满足 |

### 只读运行 / 内存求值复核（均不写仓库文件）

- `node scripts/run-tests.mjs` → `tests 326 / pass 323 / fail 3`，3 条 ✖ 标题为 `[AC-073] check-no-collab`、`[AC-013] git check-ignore`、`[AC-006] ctx.stderr`；无新增失败，326 ≥ 312。
- `node scripts/run-tests.mjs --ac AC-023` → `filtered 1 files`、`tests 5 / pass 5 / fail 0`；`--ac AC-024` → `filtered 2 files`、`tests 10 / pass 10 / fail 0`。
- `node --test` 缺陷文件 → `tests 2 / pass 2 / fail 0`（含 `[fixed]` 标题）；`config`+`paths-entries`+`clock` → `tests 20 / pass 20 / fail 0`；`import-safe` → `tests 5 / pass 4 / fail 1`，`not ok 3 - [AC-006] failures are reported on ctx.stderr`。
- `check-traceability` → `ok (covered=28 planned=46)`；`check-defects` → `ok`；`check-seams` → `ok (files=26)`；`check-unused` → `ok`；`check-golden-frozen` → `ok (14 files)`；`check-frozen-files` → `ok (8 files)`；`check-contract-doc` → `ok`。
- node 直接 import `lib/output.mjs`/`lib/request.mjs`/`lib/cli.mjs`/`lib/contract/views.mjs`/`registry.mjs`/`validate.mjs` 做纯函数内存求值：8 个错误码的 `errorBody`/`exitCodeFor`/schema 一致性、`normalizeRequest` 全部警告与非法码映射、`requestFromArgv` 三写法等价与 argv 错误码、`gateView` 三视图；再以 `createFakeContext` 内存复跑 `main()` 的 9 错误调用（7 个注册表码，含 `Object.keys` 键序、registry exit/retryable、`retry_after:null`、`stderr:''`、`validate={ok:true}`、无令牌）、`E_INTERNAL`（usage record --json {bad，exit 1）、9 个成功命令、无参数旧行为、`usage` 单词、`W_TEST_CLOCK`、select 两种警告 —— 全部与 `acceptance.md` 期望逐字相符。

## 逐条核对（18/18）

- **AC-023 A-01**（`ci-results.json:9-17`，`acceptance.md:13-16`）：`exitCode=0`、`lastLine='AC-023 OK'`。`--ac AC-023` 只读复跑 `filtered 1 files / fail 0`（仅 `cli-envelope.test.mjs`），基线为 `FAIL run.no_match`。通过。
- **AC-023 A-02**（`:18-26`，`:18-21`）：9 个错误调用覆盖 7 个码，内存复跑逐个 stdout 单值 JSON、顶层键 `ok,error`、`error` 键 `code,message,retryable,retry_after`、code 相符、retryable 与退出码等于注册表（2/2/2/2/2/2/3/3/2）、`retry_after:null`、stderr 空、error-envelope schema ok、无令牌外泄。通过。
- **AC-023 A-03**（`:27-35`，`:23-26`）：`E_UNKNOWN_COMMAND`/`E_CONFIG`/无码 `Error`（映射 `E_INTERNAL` exit 1）的 stdout 均通过 `error-envelope.schema.json`（内存 `validate={ok:true}`）。通过。
- **AC-023 A-04**（`:36-44`，`:28-31`）：9 个成功命令（含 `models select` 两种写法）逐个 stdout 单 JSON、exit 0、stderr 空。通过。
- **AC-023 A-05**（`:45-53`，`:33-36`）：无参数 exit 1、stdout 空、stderr 以 `ERROR: usage: ...` 开头；`cliworker usage` → `E_UNKNOWN_COMMAND` exit 2。通过。
- **AC-023 A-06**（`:54-62`，`:38-41`）：设置 `CLIWORKER_TEST_CLOCK_FILE` 时 `paths` 成功结果 `warnings` 含 `W_TEST_CLOCK`；`bogus` 错误体顶层键仍恰为 `ok,error`。通过。
- **AC-023 A-07**（`:63-71`，`:43-46`）：`--level Top --count 1` → draft `W_DRAFT_DEPRECATED`、回显 `request.level:'Top'`/`count:1`；`--request-file` 含 schema/role/tier → `W_FIELD_IGNORED`(role)+`W_FIELD_DEPRECATED`(tier)、不带 `W_DRAFT_DEPRECATED`。通过。
- **AC-024 A-08**（`:72-80`，`:48-51`）：`--ac AC-024` 只读复跑 `filtered 2 files / fail 0`（`request.test.mjs` + `a5-ignored-fields.test.mjs`）。通过。
- **AC-024 A-09**（`:81-89`，`:53-56`）：三写法深相等、warnings 空、规范化键序/值正确、标志覆盖 JSON、缺省值正确。通过。
- **AC-024 A-10**（`:90-98`，`:58-61`）：`role`→`W_FIELD_IGNORED`/role 且不入请求；`tier`→`W_FIELD_DEPRECATED` 且当 level；level+tier 以 level 为准；警告按键序；legacy 字段不警告。通过。
- **AC-024 A-11**（`:99-107`，`:63-66`）：importance/count/usage/level/schema/compat/view/timeout_ms/exclude_handles 与 argv 错误全部映射到预期注册表码。通过。
- **AC-024 A-12**（`:108-116`，`:68-71`）：draft（不带 schema 或 compat:draft）→ `W_DRAFT_DEPRECATED`；v1 schema → agentline 无警告；`view:'full'` → `E_VIEW_FORBIDDEN`。通过。
- **AC-024 A-13**（`:117-125`，`:73-76`）：README 1 个 `json request` 块 + 3 条 `models select` 行解析后 warnings 全为 `[]`、无 `"role"`/`"tier"`。通过。
- **AC-024 A-14**（`:126-134`，`:78-81`）：`[fixed]` 通过（`# pass 2 / # fail 0`、输出含 `[fixed]`）；`[repro]` SHA-256 == `defects.json:64`；`check-defects: ok`。通过。
- **AC-024 A-15**（`:135-143`，`:83-86`）：`check-traceability: ok (covered=28 planned=46)`；`T-008.json` 恰 2 条 covered entries、files 如设计。通过。
- **AC-023 A-16**（`:144-152`，`:88-91`）：全量失败集合恰为基线三条、`tests 326 >= 312`、无新增失败。通过。
- **AC-024 A-17**（`:153-161`，`:93-96`）：`config`/`paths-entries`/`clock` 全绿；`import-safe` 保持 `pass 4 / fail 1`、失败仍为第 3 个 `[AC-006]` 用例。通过。
- **AC-023 A-18**（`:162-170`，`:98-101`）：6 个辅助检查只读复跑均 exit 0、`ok`。通过。

## Findings

无（`findings` 为空数组）。逐条核对与独立只读复核均未发现与 `design.md` / `acceptance.md` 不符之处；CI 结果存在（`passed=18 total=18 ok=true`）且不与代码矛盾，无「无法确认」项，无 P0/P1/P2 问题。

## 备注（非缺陷）

- `brief.md` 与 `design.md` 均未指定验收报告路径（`brief.md` 全文 grep `报告/report/追加` 无命中，`design.md:16` 记「brief 没有另给验收报告路径」），故本轮结论无追加目标，未改动任何历史小节。
- `acceptance.md` 的 `check-no-collab`/`check-fast` 全局门禁基线遗留失败、`import-safe.test.mjs` 第 3 个 `[AC-006]` 用例失败，按 `design §1.1` 第 5 条与 A-16/A-17 期望不计入本任务判定，不作为判 needs_revision 的理由。
- 未修改 `brief.md`、`design.md`、`acceptance.md`、`impl.md`、`state.json`、`run.json` 及任何被评审代码与文档；SHA、写域、diff 等价核验均通过只读解压 `.git` 对象与读文件完成，未执行任何 git 子命令、未以 git 得出任何验收结论；除本 `review.md` 与 `verdict.json` 外未在仓库内创建任何文件。沿用既有 `verdict` 字段（`verdict/sha/passed/total/evidence/findings/checks`）与 `acceptance.md` 的 18 个章节名，未发明字段、版本号或章节名。
