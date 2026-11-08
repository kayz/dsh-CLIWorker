# Task 032 评审（review）

## 结论：pass（19/19）

- 所验证的 git sha：`627fb09f167b3eea7e39df405269b70958764f3b`（分支 `task/032` HEAD，提交消息 `stage(dev): task 032`）。只读解压 `.git` 松散对象并对解压字节重算 SHA-1 得 `match=true`，全程未执行任何 git 子命令；详见「SHA 核验」。基准（起点）提交 `040d2e9037844e5e2f0421956c1020a8d8f2d36e`（`040d2e9`，ORIG_HEAD），与 `design.md:13`、`acceptance.md:3` 一致。
- 通过数 / 总数：**19 / 19**。`acceptance.md` 恰含 19 个以 `## AC-076 A-nn` 开头的二级小节（`grep -c '^## AC-076 A-' = 19`，行号 16/21/26/31/36/41/46/51/56/61/66/71/76/81/86/91/96/101/106），每节 1 条 `- 命令:` 与 1 条 `- 期望:`（`grep -c '^- 命令:|^- 期望:' = 38`），与 `ci-results.json` 的 19 条 results 一一对应。逐条 `passed=true`、`exitCode=0`、`lastLine='AC-076 OK'`；0 项无法确认，0 条 finding，未自行发明编号、字段、版本号或章节名。
- 执行证据：`.collab/tasks/032/ci-results.json`（SHA-256 `68477142453c1bbb2cbf1553c23a01a838be52b31f7e2944b341f9e2f4498064`，`ranAt=2026-11-08T09:13:08.2925361+08:00`，`:5-7 passed=19 total=19 ok=true`）。按【执行证据口径】直接引用编排方 PowerShell 7 的结果（每条命令含退出码与输出），不以其缺失为判据、也不自行重跑作为判据；评审环境缺 pwsh 7 / 临时文件权限不作为判 needs_revision 的理由。
- CI 结果不与代码矛盾：HEAD 提交时间 `1794100369 +0800` = `2026-11-08T01:12:49Z`，CI `ranAt` = `2026-11-08T01:13:08Z`（晚 19 秒）；`.git/worktrees/032/logs/HEAD` 末条 `725c4d5f… -> 627fb09f…` 即 HEAD，CI 之后无新提交；6 个交付文件按 git blob 算法（LF 归一化后 SHA-1）与 HEAD tree 逐字节比对全部 `BLOB_MATCH=true`，故 CI 跑的就是当前内容。
- 独立复核不只依赖 CI：凡「执行类」以外的规格一致性，均以只读方式（读文件、算哈希、核对行号、只读解析 `.git` 对象、node 直接 import 做纯函数内存求值）独立验证实现与 `design.md` §2–§7、`acceptance.md` A-01~A-19 是否一致；所有复跑均不改动仓库内文件。

## SHA 核验（只读解压 .git 对象，未用 git 子命令）

- 工作区 `.git` 文件:1：`gitdir: C:/git/dsh-CLIWorker/.git/worktrees/032`。
- `.git/worktrees/032/HEAD:1` = `ref: refs/heads/task/032`；`.git/refs/heads/task/032:1` = `627fb09f167b3eea7e39df405269b70958764f3b`；`.git/worktrees/032/ORIG_HEAD:1` = `040d2e9037844e5e2f0421956c1020a8d8f2d36e`（基准）。
- zlib 解压松散对象 `.git/objects/62/7fb09f167b3eea7e39df405269b70958764f3b` 得 230 字节，对解压字节重算 SHA-1 = `627fb09f167b3eea7e39df405269b70958764f3b`（`match=true`）。对象头 `commit 219`，`tree 868f30ae64427c3ae92311cb173fc8948006fee8`，`parent 725c4d5fe27378e59d9182acf13af006e9ff58d4`，时间戳 `1794100369 +0800`，消息 `stage(dev): task 032`（`COMMIT_EDITMSG` 同）。
- reflog 末条 `725c4d5fe27378e59d9182acf13af006e9ff58d4 -> 627fb09f167b3eea7e39df405269b70958764f3b commit: stage(dev): task 032`（`1794100369 +0800`）即 HEAD，无后续提交；CI `ranAt` 晚于该提交 19 秒。

## 独立只读核对

| 项 | 核对内容 | 结果 |
|---|---|---|
| `lib/session.mjs`（design §4） | import 仅 `node:crypto`/`node:path` 与三个相对模块（`:4-16`）；无模块级状态/墙钟/环境；`SESSION_ERRORS` 9 码全 `retryable:false` 固定 message（`:20-66`）、`INVALIDATION_CODES` 六项定序（`:68-75`）、`DEFAULT_SESSION_TTL_S=43200`（`:18`）；`ROLE_POLICIES` 键序/模式（`:77-83`）；`composeInput` 固定顺序与 `## <name>\n<text>\n` 段间一空行（`:147-157`）；`checkInput` start/resume 白名单与固定 message（`:159-178`）；`parseToken` 严格键集/类型/摘要格式（`:184-206`）；`issueToken` `st_`+base64url(`{v,s,m,p,c,t}`)、`sha256(label+'\n'+value)[:12]`（`:92-94,209-222`）；`startSession` 顺序（`:232-278`）；`resumeSession` 检查顺序 provider→model→contract→TTL→forecast（`:284-341`）；`writeRolePolicy` 路径校验/外来 schema/原子写/失败清理（`:362-413`） | 满足（A-03~A-09、A-14） |
| `lib/providers/call.mjs`（design §3） | 仅 `node:path`（`:4`）；`IDENTITY_SOURCES` 六项（`:6-13`）、`SESSION_ID_RE`（`:15`）、`LEVEL_BY_SOURCE`（`:18-25`）；`validateSessionDescriptor` 固定 problems/`resumable`（`:99-135`）；`buildSessionCall` argv 数组、`{session_id}` 整元素与子串替换、非法 id/未知 mode 抛 `TypeError`（`:141-155`）；`runSessionCall` 单次调用（`:158-160`）；`extractSessionId` 四来源、`__proto__`/`constructor`/`prototype` 防护、数字转字符串、正则第 1 捕获组、final `SESSION_ID_RE` 校验（`:172-274`）；`classifyIdentity` 四档、`consistent`、`observed_at`、不含模型名（`:280-307`） | 满足（A-10~A-12） |
| `lib/contract/views.mjs`（design §2） | `VIEW_NAMES`/`resolveView` 未改（`:3,48-69`）；新增 `SESSION_RESULT_SCHEMA`/`SESSION_ACTIONS`/`SESSION_IDENTITY_LEVELS`（`:7-11`）；`sessionView` 成功/失败形状、键序固定、白名单丢弃多余键、`retry_after` 缺省 `null`、失败时丢弃 `session_token`/`reply`、未知 action 抛 `TypeError`（`:17-46`）；全文无 import、`node:`、墙钟、定时器、`process.env`（`:1-70`） | 满足（A-13、A-14） |
| 注册表 / 契约 / 依赖（design §1.1、§8） | `lib/contract/registry.mjs:5-249` 无 `E_SESSION_*`；`node` 只读深比较 `REGISTRY_EQ_SNAPSHOT=true`、`snapshot_version=1`（`contracts/registry.snapshot.json:3`）；`package.json:1-42` 无 dependencies/devDependencies/optionalDependencies；三源文件 import 仅 `node:` 与相对路径、无 `Date.now`/`new Date`/定时器/`process.env`/`performance.now`/`hrtime` | 满足（A-14） |
| 结果不泄露（design §5） | 成功结果键恰 `schema,ok,action,session_token,identity,reply`；`session_token` 不含 provider/CLI/模型 id；`scanView`（`contracts/agentline-forbidden.json`，catalog 含 `key`/`id`/`cli`）在 `reply:''` 后零命中；结果无 `forecast`/`provider`/`cli`/`model_key`/`token` 精确键名 | 满足（A-03、A-08） |
| 写域（design §8 / A-17，只读 tree diff） | base `040d2e9`（498 跟踪文件）→ HEAD `627fb09f`（508）：ADDED 10 = 5 个 `.collab/tasks/032/` 编排维护文件 + 5 个 write_scope 文件；MODIFIED 1 = `lib/contract/views.mjs`；REMOVED 0；写域外（排除 taskdir）= []。6 交付文件工作树与 HEAD blob 全部 `BLOB_MATCH=true`；无 `test/traceability/T-032.json`（Glob 无命中） | 满足（A-17） |
| 测试内容（design §7） | 三文件 `test(` 计数 15/11/7（=33），标题全以 `[AC-076]` 开头，无 `.skip`/`.todo`/`.only`/`skip:`/`todo:`；integration 用真实 `buildForecast`+`fs.mkdtempSync('s032-')`+`rmSync`；unit 用 `createFakeContext` 伪时钟；contract 覆盖 `scanView`/注册表/`sessionView`/四种 `id_from`；A-16 关键词逐项命中 | 满足（A-15、A-16） |
| 回归 / 既有门禁 | `impl.md:33-35` 全量 `tests 359 / pass 356 / fail 3`（失败集合恰基线 `AC-006/013/073`）、`check-defects/check-traceability/check-seams/check-unused : ok`、`check-no-collab (2 violations)`、`check-write-scope ok`；A-18/A-19 的 CI 断言与之一致 | 满足（A-18、A-19） |

### 只读内存求值复核（均不写仓库文件）

- `node --input-type=module` 直接 import 求值：`REGISTRY_EQ_SNAPSHOT=true snapshot_version=1`；`SESSION_ERRORS=9`、`INVALIDATION_CODES` 六项顺序、`DEFAULT_SESSION_TTL_S=43200`、`ROLE_KEYS=design,design_prereview,dev,review,test_architect`；`composeInput({constraints,findings,diff,summary})` = `## summary\ns\n\n## diff\nd\n\n## findings\na\nb\n\n## constraints\nc\n`（与 `design.md:159`、`A-07` 期望逐字一致）。
- 行为复跑（假 ctx/固定时钟 `2026-11-08T00:00:00Z`，`fakecli`/`prov-x`/`m-secret`）：`buildForecast` 真实实现 `remaining_pct 80/3/0 -> ok/critical/exhausted`；`startSession` 结果键序、`exec` 1 次、stdin `## prompt\nhello\n`、`identity.level=verified`、解码键恰 `[v,s,m,p,c,t]`、`scanView` 零命中；八个失效用例得到固定码且 `retryable:false`/`retry_after:null`、exec 次数 `0/0/0/0/0/0/1/0`；额度 `exhausted/critical` 阻塞且不调用 provider、`ok/low_reserve/unknown/无 forecast` 放行且恰好 1 次。输出 `ALL_IN_MEMORY_CHECKS=PASS`，与 `ci-results.json` 全部 `AC-076 OK` 不矛盾。

## 逐条核对（19/19）

- **AC-076 A-01**（`ci-results.json:9-17`，`acceptance.md:16-19`）：`exitCode=0`、`lastLine='AC-076 OK'`。`--ac AC-076` 断言 `fail 0` 与 `filtered 3 files`；基线为 `FAIL run.no_match AC-076`。通过。
- **AC-076 A-02**（`:18-26`，`:21-24`）：`node --test` 三文件，断言 `# fail 0`、`# pass>=20`、无 skip/todo/cancelled；三文件 33 个 `[AC-076]` 用例，与 `impl.md:31` 一致。通过。
- **AC-076 A-03**（`:27-35`，`:26-29`）：start 单次 exec、argv 数组 `['-p','--model','m-secret']`、stdin `## prompt\nhello\n`、结果键序、`st_<base64url>` 解码键集、除 `reply` 外无 `prov-x/m-secret/fakecli/C:/work`、`scanView` 零命中、相同输入相同 token。只读源码 + 内存求值佐证。通过。
- **AC-076 A-04**（`:36-44`，`:31-34`）：resume 单次 exec、`['--resume','sid-1']`、stdin 仅 `## summary\nS1\n\n## diff\nD1\n`、新 token（同 `s`、`t=T0+60000`）、`identity.level=verified`；`ctx.fs` 无写类访问（`test/contract/session.test.mjs:236-241` `fakeFs().accessed` 为空）。通过。
- **AC-076 A-05**（`:45-53`，`:36-39`）：八用例固定码、`error` 键恰 `code,message,retryable,retry_after`、`retryable:false`、`retry_after:null`、provider 前置检查 0 次 / `RESUME_FAILED` 恰 1 次、provider 与模型同时变仍 `PROVIDER_CHANGED`、TTL 边界 `+43200000` 不过期 / `+1` 过期、`INVALIDATION_CODES` 六项定序。内存求值 `INVALIDATION 8 cases + exec counts=PASS`。通过。
- **AC-076 A-06**（`:54-62`，`:41-44`）：start 失败 `E_SESSION_START_FAILED`（1 次、带 `failed` 身份、不回显 stderr）、空/含空格分号 id → `E_SESSION_ID_MISSING`、`supported:false`/非法 `id_from` → `E_SESSION_NOT_SUPPORTED` 且 0 次、`supports_resume:false` start 成功但 `session_token:null`、空输入/`brief` 键/空 `provider` → `E_REQUEST_INVALID` 且 0 次。通过。
- **AC-076 A-07**（`:63-71`，`:46-49`）：resume 出现 `brief/design/docs/prompt` → `E_REQUEST_INVALID`，message 恰 `resume accepts only summary, diff, findings, constraints`，provider 0 次；空输入 → `input is empty`；值类型错误 → `E_REQUEST_INVALID`；`composeInput` 字节级输出；坏 token → `session_token is malformed`。通过。
- **AC-076 A-08**（`:72-80`，`:51-54`）：真实 `buildForecast` 的 `exhausted/critical` → `E_SESSION_QUOTA_EXHAUSTED`（`retryable:false`、`retry_after:null`、不带 `identity`、provider 0 次）；`ok/low_reserve/unknown/无 forecast` 放行且 1 次；换 provider/模型用 `summary+diff` 新建、stdin 恰 `composeInput({summary,diff})`、新 token 不同于旧；旧 token 在新 target 上得 `E_SESSION_PROVIDER_CHANGED`。内存求值 `QUOTA blocked/pass-through=PASS`。通过。
- **AC-076 A-09**（`:81-89`，`:56-59`）：`ROLE_POLICIES` 键序/模式、`nextAction` 各角色行为、五角色文件落在 `<taskDir>/sessions/<role>.json`、键序固定、不含 `session_id`/token；已有 `agentline.session/v1` 不覆盖（`written:false, reason:'foreign_schema'`）；`../evil`/`../x` 被拒；`renameSync` 失败返 `E_INTERNAL`（message 恰 `failed to write session policy`）且无残留临时文件。通过。
- **AC-076 A-10**（`:90-98`，`:61-64`）：四档可达（`verified`/`observed`+`rollout-file`/`unverified`+`none`/`cli_flag`/`failed`），`unverified`/`observed` 不阻断仍返回 token；模型不一致仅 `consistent:false` 不改档；身份对象不含模型名。通过。
- **AC-076 A-11**（`:99-107`，`:66-69`）：`stdout_json`（含逐行 JSON）、`stdout_regex`、`stderr_regex`、`sidecar_file`（纯文本与 JSON）四种取到 id；含空格/分号、>200 字符、`__proto__` 路径、正则不匹配、sidecar 不存在 → `E_SESSION_ID_MISSING`。通过。
- **AC-076 A-12**（`:108-116`，`:71-74`）：`buildSessionCall` 返回 `{command,args,cwd,input:'stdin'}`、argv 为数组、整元素/子串替换、start 不替换、非法 id/未知 mode 抛 `TypeError`；`validateSessionDescriptor` 合法/one-shot/各非法描述符、`problems` 不含描述符内容；`IDENTITY_SOURCES` 恰六个。通过。
- **AC-076 A-13**（`:117-125`，`:76-79`）：既有 `VIEW_NAMES`/`resolveView` 行为不变；`sessionView` 成功/失败形状、缺省 `session_token:null,identity:null,reply:''`、多余键丢弃、失败丢弃 `session_token`/`reply`、`error` 仅四键且 `retry_after` 缺省 `null`、未知 action 抛 `TypeError`；`views.mjs` 仍纯。通过。
- **AC-076 A-14**（`:126-134`，`:81-84`）：三源文件 import 仅 `node:`/`相对`、无墙钟/定时器/`process.env`；`package.json` 无依赖；注册表无 `E_SESSION_*` 且 `REGISTRY` 与 snapshot 深相等、`snapshot_version=1`；`SESSION_ERRORS` 恰 9 码/冻结/固定 message、`DEFAULT_SESSION_TTL_S=43200`。通过。
- **AC-076 A-15**（`:135-143`，`:86-89`）：15/11/7 个 `test(`（≥10/8/5），标题全 `[AC-076]`，无 `.skip/.todo/.only`、`skip:`、`todo:`。通过。
- **AC-076 A-16**（`:144-152`，`:91-94`）：集成/单元/契约三文件关键字符串逐项存在（额度、真实 `buildForecast`、`composeInput`、角色落盘/外来 schema/原子写；六失效码 + `createFakeContext`；`scanView`/注册表/`sessionView`/四种 `id_from`）。通过。
- **AC-076 A-17**（`:153-161`，`:96-99`）：`check-write-scope --base 040d2e9 ...` ok，契约/脚本/注册表/依赖文件无 diff 与未跟踪文件；只读 tree diff 独立确认写域内、6 交付文件 BLOB_MATCH=true、无 `T-032.json`。通过。
- **AC-076 A-18**（`:162-170`，`:101-104`）：全量失败集合 ⊆ 基线三条 `AC-006/013/073`、`fail<=3`、`tests>=346`；`impl.md:33` 为 `tests 359 / pass 356 / fail 3`。通过。
- **AC-076 A-19**（`:171-179`，`:106-109`）：`check-defects/check-traceability/check-seams/check-unused` 输出 `: ok`；`check-no-collab` 仍 `(2 violations)`。通过。

## Findings

无（`findings` 为空数组）。逐条核对与独立只读复核均未发现与 `design.md` / `acceptance.md` 不符之处；`ci-results.json` 存在（`passed=19 total=19 ok=true`）、不与当前 HEAD 代码矛盾，无「无法确认」项，无 P0/P1/P2 问题，故判 `pass`。

## 备注（非缺陷）

- `brief.md` 与 `design.md` 均未指定验收报告路径（`brief.md` 全文无「报告/report/追加」，`design.md:13` 记「brief 没有另给验收报告路径」，`acceptance.md:3` 记「brief 未给既有验收报告路径」），故本轮结论无追加目标，未改动任何历史小节。
- `acceptance.md:8-9` 及 `design.md:15-16` 的基线遗留三条失败（`AC-006`/`AC-013`/`AC-073`）与 `check-no-collab (2 violations)` 按规格明确不属于本任务、不要求修复，A-18/A-19 只要求「不新增失败 / 不退化」，不作为判 needs_revision 的理由。
- 未修改 `brief.md`、`design.md`、`acceptance.md`、`impl.md`、`state.json`、`run.json` 及任何被评审代码与文档；SHA、写域、diff 等价核验均通过只读解压 `.git` 对象与读文件完成，未执行任何 git 子命令、未用 git 得出任何验收结论；除本 `review.md` 与 `verdict.json` 外未在仓库内创建任何文件。沿用既有 `verdict` 字段（`verdict/sha/passed/total/evidence/findings/checks`）与 `acceptance.md` 的 19 个章节名，未发明字段、版本号或章节名。
