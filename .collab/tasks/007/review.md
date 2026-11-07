# Task 007 评审（review）

## 结论：pass（27/27）

- 验证的 git sha：`3108aebe8b80ddff2e2c41c8956fb2af148601b1`（分支 `task/007` HEAD）。基准（起点）提交 `f6f605733017bc05217b17559dae1c608ae3c3dc`，与 `design.md:18`、`acceptance.md:3` 一致。该 sha 由只读解压 `.git` 对象取得，未用 git 子命令。
- 通过数 / 总数：**27 / 27**。`acceptance.md` 共 27 个 `## AC-0xx` 小节（AC-020 7、AC-021 4、AC-022 16），逐条 `passed=true`、无 finding、0 项无法确认。
- 执行证据：`.collab/tasks/007/ci-results.json`（SHA-256 `a8cbe10710a03a88a0baaaaa40370adb74fe0f18f1d3d6b22ba043a9f0466fbc`，`ranAt=2026-11-08T06:33:13.4135763+08:00`，`:5-7 passed=27 total=27 ok=true`）。27 条 results 逐条 `passed=true`、`exitCode=0`、`lastLine='AC-0xx OK'`（`:8-252`）。按【执行证据口径】直接引用，未重跑；评审环境缺 pwsh 7 / 临时文件权限不作为判 needs_revision 的理由。
- `ci-results.json` 的 `ranAt` 晚于最后一次 dev 提交（HEAD 时间戳 `1794090761 +0800` = `2026-11-07T22:32:41Z`，CI 为 `22:33:13.413Z`），且 reflog 末条即该提交，CI 之后无新提交，故 CI 结果与当前 HEAD 不矛盾。
- 独立复核不只依赖 CI：凡「执行类」以外的规格一致性，均以只读方式（读文件、算哈希/解压 git 对象、核对行号、纯函数内存求值、只读运行 `check-*` 脚本）独立验证；所有补跑脚本均不改动仓库内文件。

## SHA 核验（只读解压 .git 对象，未用 git 子命令）

- 工作区 `.git` 文件：`gitdir: C:/git/dsh-CLIWorker/.git/worktrees/007`。
- `.git/worktrees/007/HEAD:1` = `ref: refs/heads/task/007`；`.git/refs/heads/task/007:1` = `3108aebe8b80ddff2e2c41c8956fb2af148601b1`。
- 只读解压该 commit 对象：`type=commit`、`tree b87edf740d5f1fd7e841e35af202193e265b37e3`、`parent f98245bd2d5b9af807b33de876eddce36f9017a9`、消息 `fix(dev): repair after CI failure (task 007)`。
- parent 链回溯 `3108aebe8b80 → f98245bd2d5b → 45895f56e479 → 9be5c184494b → 60eb7e06f204 → f6f605733017` 到达基准；`.git/worktrees/007/ORIG_HEAD` = `f6f605733017bc05217b17559dae1c608ae3c3dc`。

## 独立只读核对

| 项 | 核对内容 | 结果 |
|---|---|---|
| 写域（git 对象全树 diff） | base 429 跟踪文件 → HEAD 448。ADDED 19：13 个 `.collab/tasks/007/` 调度器文件 + `lib/select-draft.mjs`、`scripts/check-unused.mjs`、`test/fixtures/unused/**`(4)、`test/traceability/T-007.json`、`test/unit/{check-unused,select-draft}.test.mjs`；MODIFIED 6：`task-graph.json`、`lib/contract/validate.mjs`、`lib/select.mjs`、3 个 `defects/a5-*.test.mjs`；REMOVED 0。全部 lib/scripts/test 改动落在 `design.md:2-13` 的 write_scope 内，无越界代码改动 | 满足（A-24） |
| 必须未改文件 | `defects.json`、`test/unit/select.test.mjs`、`a1-quota.test.mjs`、`package.json`、`package-lock.json`、`contracts/golden/quota-shapes.json`、`lib/{forecast,pools,context}.mjs`、`lib/commands/models/select.mjs`、`lib/index.js` 均 base==HEAD==工作树逐字节相同；无任何 `contracts/golden/**` 文件被改动 | 满足（A-06/07/11/23/27） |
| 只删 typeOf | `lib/contract/validate.mjs` base 251 行 → HEAD 244 行（delta 7）；删除块恰 `base:45-51`（`typeOf` 函数 6 行 + 其后 1 空行），44 行前缀与 200 行后缀一字不动，HEAD 不含 `typeOf`；等价 `git diff --numstat 0 7`，符合 `design.md §0` 方案 A（`inputs.jsonl:1` 人类批准） | 满足（A-19） |
| `[repro]` / `[fixed]` | 按 `check-defects.mjs:144-179` 算法重算三个缺陷文件 `[repro]` SHA-256 = `3688c428…de5c` / `db3e10e1…f99c` / `565f3cd5…bc89`，与 `defects.json:43,50,57` 逐条相等；三文件 base 为 HEAD 严格前缀（`head.startsWith(base)=true`），各仅追加 1 个顶层 `test('[fixed] …')`，`[repro]` 哈希 base==HEAD 未变 | 满足（A-05/17/20） |
| 实现：select.mjs | `:1-4` 五导入全被使用；`:6` SCHEMA 重导出；`:60-71` usageSamples（按 model 过滤、mtok=billedTokens/1e6、非正/非有限为 null、cost_usd 非有限为 null、非数组 []）；`:73-75` defaultForecast 走 buildForecast 不传 pools/rows/policy；`:95-169` selectModels 惰性 `currentNow()` 一次（`:107-111`）、`Map` 记忆化 `forecastOf`（`:113-126`，每模型读 quota 一次 + 调 forecast 一次）、调用参数 `{model,prices,quota,records,usage,now}`；`:132-142` 六步前置过滤后末步 `heavyRejection`；`:144-167` 排序键与 handle/adapter 取值。无 `Date.now`/`new Date()`/定时器/`isObject` | 与 `design.md §2` 一致 |
| 实现：select-draft.mjs | `:4-6` 三个常量（HEAVY_REJECT_RISKS 冻结）；`:9-13` heavyRejection；`:16-33` draftHandle 恰 14 键、无 `cli`；`:36-53` draftSelection 恰 10 键（`calls=models.map(x=>x.call)`、ok/truncated/reason 规则、缺 level 路径）。零 import、无时钟/IO | 与 `design.md §3` 一致 |
| 实现：check-unused.mjs | `:46-205` 等长掩码（注释/字符串/模板文本/正则，模板 `${…}` 保留且嵌套花括号 `:169-183`）；`:208-236` tokenize 带花括号深度；`:254-304` collectImports（默认/命名 `a as b`/`* as ns`，副作用/动态/import.meta 跳过）；`:306-340` collectFunctions（深度 0、跳过 export、自递归排除）；`:352-382` scanSource 引用计数（`:361` 属性访问不计、展开计）；`:384-455` scanPaths（默认 lib、按码点排序、退出码 0/1/2）；`:512-515` 仅入口运行 main | 与 `design.md §4` 一致 |
| 夹具与测试 | `expected.json:2-11` 恰 8 项；clean 0、dirty/imports 4 导入、dirty/functions 4 函数；`select-draft.test.mjs` 8 个 test、`check-unused.test.mjs` 9 个 test，与 `design.md §6.1/§6.2` 一致；AC 标签隔离：AC-020 命中 3 文件、AC-021 命中 1 文件、AC-022 命中 2 文件 | 满足（A-01/08/12） |
| 追踪分片 | `test/traceability/T-007.json:1-28` 键恰为 task/milestone/entries，3 个 AC 全 covered，files 列表与 `design.md §6.4` 一致；基准 19/55 → 22/52 | 满足（A-21） |
| 字符串门 / 令牌门 | 14 个变更的 lib/scripts/test 文件均无 `.collab` 字面量、`Date.now`、`new Date()`、定时器、`sk-`/`ghp_`/`xox`/`AKIA`/`Bearer` 字样；`package.json` dependencies={} | 满足（A-22/23/27） |

### 内存只读行为复算（import 后只调纯函数，不写文件）

- A-02：handle 键 = `adapter,call,forecast,id,identity,identity_group,key,level,prices,provider,quota,readonly,schema,vendor`；`cli=false`、`call=true`、`calls[0]` 与 `handle.call` 深相等。
- A-03：12 模型 / `count:12` → `ok=true`、`models.length=12`、Proxy `reads=12`。
- A-04：9 组 usage×count 的注入 forecast 调用唯一结果 `8/8`。
- A-09：金标 8 个带 `expected.risk` 用例，`want=5`（≥5），Heavy `got=5` 且集合相等、`rejected` 总数 5；Normal/Light `rejected=0`、`models=8`。
- A-10：导出清单恰 6 个、两个 schema 字符串、`HEAVY_REJECT_RISKS` 冻结数组不变。
- `scanPaths`：`lib` → files 21/items 0；`scripts/check-unused.mjs` → files 1/items 0；`test/fixtures/unused` → files 3/items 8。

### 只读运行 `check-*` / `node --test` 复核（均不写仓库文件）

- `check-traceability.mjs` → `check-traceability: ok (covered=22 planned=52)`（退出 0）；`check-seams.mjs` → `check-seams: ok (files=21)`（退出 0）；`check-no-collab.mjs` → `check-no-collab: ok (scanned 265 files)`（退出 0）。
- `check-unused.mjs` → `check-unused: ok (files=21)`；`… scripts/check-unused.mjs` → `ok (files=1)`；`… test/fixtures/unused/clean` → `ok (files=1)`；`--json test/fixtures/unused` → 退出 1、单个 JSON 8 项与 `expected.json` 一致；`--no-such-flag` / `no/such/dir` → 均退出 2、stderr 含 usage、stdout 无 `check-unused: ok`。
- `node --test`：`a5-dup-call`+`a5-forecast-x3` → `pass 4 / fail 0`；`a5-unused` → `pass 2 / fail 0`；`select.test.mjs` → `pass 6 / fail 0`。
- `check-golden-frozen.mjs` 含写 manifest 的分支（`:57-66`），评审未运行，改以「git 对象 diff 显示 `contracts/golden/**` 零改动」只读佐证金标冻结。

## 逐条核对（27/27，引用 ci-results.json + 只读佐证）

- **AC-020 A-01**（`ci-results.json:9-17`）：`exitCode=0`、`AC-020 OK`；`[AC-020]` 仅 3 文件。通过。
- **AC-020 A-02**（`:18-26`）：单模型 handle 键集合、`cli`/`call`、`calls[0]` 深相等，内存复算通过。通过。
- **AC-020 A-03**（`:27-35`）：12 模型 / count 12 / reads 12，内存复算通过。通过。
- **AC-020 A-04**（`:36-44`）：9 组 forecast 计数恒 `8/8`，内存复算通过。通过。
- **AC-020 A-05**（`:45-53`）：`pass 4 / fail 0`，`node --test` 复核通过；两 `[fixed]` 为顶层追加。通过。
- **AC-020 A-06**（`:54-62`）：`defects.json` base==HEAD==工作树相同，无 diff。通过。
- **AC-020 A-07**（`:63-71`）：`select.test.mjs` `pass 6 / fail 0` 且无 diff。通过。
- **AC-021 A-08**（`:72-80`）：`filtered 1 files`，`[AC-021]` 仅 1 文件。通过。
- **AC-021 A-09**（`:81-89`）：金标 Heavy 全拒、Normal/Light 不拒，内存复算 `want=5/got=5`、集合相等。通过。
- **AC-021 A-10**（`:90-98`）：导出清单、schema 字符串、冻结 risk 数组、heavyRejection 规则逐项一致。通过。
- **AC-021 A-11**（`:99-107`）：`a1-quota.test.mjs` 无 diff。通过。
- **AC-022 A-12**（`:108-116`）：`filtered 2 files`，`[AC-022]` 仅 2 文件。通过。
- **AC-022 A-13**（`:117-125`）：`check-unused: ok (files=21)`、`scanPaths(['lib'])` items 0。通过。
- **AC-022 A-14**（`:126-134`）：`--json` 退出 1、8 项与 `expected.json` 集合一致（line 1/5/9/13 与 1/2/3/4）。通过。
- **AC-022 A-15**（`:135-143`）：clean 夹具 `ok (files=1)`。通过。
- **AC-022 A-16**（`:144-152`）：两次用法错误均退出 2、stderr usage、stdout 无 ok。通过。
- **AC-022 A-17**（`:153-161`）：`pass 2 / fail 0`，`lib/select.mjs` 无 `isObject`。通过。
- **AC-022 A-18**（`:162-170`）：扫描器自身 `ok (files=1)`。通过。
- **AC-022 A-19**（`:171-179`）：`validate.mjs` 恰删 7 行（typeOf + 空行）、无 `typeOf` 残留。通过。
- **AC-022 A-20**（`:180-188`）：`check-defects: ok`；三个 `[repro]` 哈希独立重算与 `defects.json` 全部相等、`[fixed]` 各 1 处、`[repro]` 未改。通过。
- **AC-022 A-21**（`:189-197`）：`check-traceability: ok (covered=22 planned=52)`，只读运行确认。通过。
- **AC-022 A-22**（`:198-206`）：`check-seams: ok (files=21)`，命中 `files=2[12]`，只读运行确认。通过。
- **AC-022 A-23**（`:207-215`）：`check-no-collab: ok` 前缀 + 金标零改动（只读对象 diff 佐证 `14 files` 冻结）。通过。
- **AC-022 A-24**（`:216-224`）：写域全树 diff — 代码/测试改动全部在 `design.md` write_scope 内，越界仅 `.collab/` 调度器文件。通过。
- **AC-022 A-25**（`:225-233`）：`check-fast.ps1` 含 `check-fast: ok` 与 `check-unused: ok`，按执行证据口径采信编排方 pwsh 7 运行。通过。
- **AC-022 A-26**（`:234-242`）：`npm test` `fail 0`、`run-tests: full 34 files`，按执行证据口径采信（32 基准 + 2 新增）。通过。
- **AC-022 A-27**（`:243-251`）：dependencies 0、package 两文件无 diff。通过。

## Findings

无（`findings` 为空数组）。逐条核对与独立只读复核均未发现与 `design.md` / `acceptance.md` 不符之处；无 P0/P1/P2 问题。

## 备注（非缺陷）

- `impl.md §3.1`：`design.md §2.1` 写「count 钳制到 1..10」，基准 `lib/select.mjs:79` 为 `Math.max(1,Math.min(10,…))`；但 `acceptance.md:21` 的 A-03 强制要求 `count:12` 得 12 个模型，二者不可同时成立。实现改为 `Math.max(1,Number(request.count||1))`（`lib/select.mjs:99`），已在 `impl.md §3.1` 声明；`design.md §1.1` 第 3 条把请求校验（含 10 上限）留给 T-008 之后、`§7` 第 1 条声明行为变化为预期，无既有测试/金标依赖 10 上限。属受 acceptance 约束且已记录的最小偏差，不记为 finding。
- `impl.md §3.2`：`--json` 的 `file` 相对「被扫描路径锚点」而非 `--root`（`design.md §4.1` 与 `§4.3/§6.2` 自相矛盾，A-14 要求输出 `dirty/…` 才能与 `expected.json` 比对）；`impl.md §3.3`：`...name` 展开计为引用，否则 `lib/index.js` 会误报、违反 `design.md §5` 第 2 步「预期只有 isObject 与 typeOf」。二者均为受 acceptance 约束且已记录的细化，不记为 finding。
- `inputs.jsonl:2` 的人类 note 明确要求整篇重写 `acceptance.md` 为 CI 可提取形状，故该文件（及 `impl.md`）的写域外改动有授权；`ci-results.json` 的 27 条与 `run.json:268-274` 的 `passed=27 total=27 ok=true` 一致。
- `brief.md` 未指定验收报告路径（`design.md:18` 明示「brief 没有另给验收报告路径」），因此本轮结论无追加目标，未改动任何历史小节。
- 未修改 `brief.md`、`design.md`、`acceptance.md`、`impl.md`、`state.json`、`run.json` 及任何被评审代码/文档；SHA、写域与 diff 等价核验均通过只读解压 `.git` 对象完成，未用 git 子命令得出任何验收结论（评审末尾仅用一条只读 `git status --short` 确认本轮未在仓库内创建其它文件，不改变状态、不参与验收判定）；除本 `review.md` 与 `verdict.json` 外未创建其它仓库内文件。
