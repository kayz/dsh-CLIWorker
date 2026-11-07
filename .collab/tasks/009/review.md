# Task 009 评审（review）

## 结论：pass（1/1）

- 所验证的 git sha：`02ad1c113204c693756630ada72f859a01043f03`（分支 `task/009` HEAD）。由只读解压 `.git` 对象取得，全程未执行任何 git 子命令；详见「SHA 核验」。基准提交 `1d74a3989d724ccf6b45af14250128e6b0275dea`（`chore(007): mark merged after human permission`）。
- 通过数 / 总数：**1 / 1**。`acceptance.md` 仅含 1 个以 AC id 开头的二级小节 `## AC-025`（`grep -c '^## AC-' = 1`），下挂 1 条 `- 命令:` 与 1 条 `- 期望:`；覆盖范围 7 条说明均由该单条命令验证，不另立 AC 小节。逐条 `passed=true`，0 项无法确认，无 finding。
- 执行证据：`.collab/tasks/009/ci-results.json`（SHA-256 `55324e7c77b76c73532fa6306e05655b180b7976c135e80657547b855c8fccc6`，`ranAt=2026-11-08T07:18:27.7897982+08:00`，`:5-7 passed=1 total=1 ok=true`）。唯一 results 条目 `:8-18` 为 AC-025：`passed=true`、`exitCode=0`、`lastLine='AC-025 OK'`、`output='check-pack: ok\nAC-025 OK'`，与 `acceptance.md:10` 期望逐字相符。按【执行证据口径】直接引用，不自行重跑作为判据；评审环境缺 pwsh 7 / 临时文件权限不作为判 needs_revision 的理由。
- CI 结果不与代码矛盾：`ranAt` 晚于 HEAD 提交时间（`1794093502 +0800` = `2026-11-07T23:18:22Z`），reflog 末条即该提交，CI 之后无新提交，故 CI 结果与当前 HEAD 一致。
- 独立复核不只依赖 CI：凡「执行类」以外的规格一致性，均以只读方式（读文件、算哈希、只读解压 `.git` 对象、核对行号、纯函数内存求值、只读运行 `check-*` 脚本）独立验证；所有补跑脚本均不改动仓库内文件。

## SHA 核验（只读解压 .git 对象，未用 git 子命令）

- 工作区 `.git` 文件:1：`gitdir: C:/git/dsh-CLIWorker/.git/worktrees/009`。
- `.git/worktrees/009/HEAD:1` = `ref: refs/heads/task/009`；`.git/refs/heads/task/009:1` = `02ad1c113204c693756630ada72f859a01043f03`。
- zlib 解压松散对象 `.git/objects/02/ad1c113204c693756630ada72f859a01043f03`，对解压字节重算 SHA-1 = `02ad1c113204c693756630ada72f859a01043f03`（match=true）。对象头 `commit 243`，`tree 75a2289565cf47248e4e501111525dbdd546116b`，`parent 901d098fb27b1d8928fda3e417e950836ee2cf70`，消息 `fix(dev): repair after CI failure (task 009)`，时间戳 `1794093502 +0800`。
- `.git/worktrees/009/ORIG_HEAD` = `1d74a3989d724ccf6b45af14250128e6b0275dea`（基准）；reflog 末条 `901d098f... -> 02ad1c11...` 即 HEAD，无后续提交。
- 工作树 6 个交付文件按 git blob 算法（LF 归一化后 SHA-1）与 HEAD tree 逐字节比对全部 `MATCH=True`（工作树 CRLF、对象 LF），无未提交越界改动。

## 独立只读核对

| 项 | 核对内容 | 结果 |
|---|---|---|
| bin / 版本（`acceptance.md:14`） | `package.json:11-13` `bin.cliworker='bin/cliworker.mjs'`（对象形式、无 `./`）；`:3` 与 `dsh.plugin.json:4` 均 `0.1.0`（equal=true）。`check-pack.mjs:128-144` 两规则；内存求值 `./` 前缀/删除 bin 得 `pack.bin_mismatch`，版本不一致得 `pack.version_mismatch` | 满足 |
| files 白名单（`:15`） | `package.json:25-37` 恰 11 项，与 `design.md:33-46` 逐项一致；不含 config/contracts/contracts/spec/contracts/golden/contracts/examples/test/scripts 等目录级条目；无依赖字段。`a2-pack.test.mjs:20-28` `[fixed]` 断言齐全并通过 | 满足 |
| 真实 pack 必需项（`:16`） | 只读 `runNpmPack('.')`（`npm pack --dry-run --json --ignore-scripts`）→ `error=null`、55 文件；`evaluatePack` 用真实清单/清单文件/`collectLibFiles('.')`（24 lib 文件）→ `errors=[]`。含 bin、config example、registry.snapshot、agentline-forbidden、lib/index.js，三 contracts 前缀各≥1，24 lib 全覆盖 | 满足 |
| 禁入路径（`:17`） | 真实清单过滤 test/scripts/state/golden/spec 前缀、拼接 `.collab/` 前缀、`config/*.local.json`、`*.jsonl` 命中 `forbidden_count=0`；`*.jsonl` 仅位于 `.collab/`（不进包），`config/` 仅 example，无 state/，`contracts/examples/` 40 文件在磁盘但 pack 内该前缀计数=0 | 满足 |
| 负向行为（`:18`） | 内存对 `baseline()` 做 8 类变换，逐项得 `pack.missing_required`/`forbidden_present`/`bin_mismatch`/`version_mismatch`/`not_whitelisted`（golden 同时命中 forbidden+not_whitelisted，印证 `design.md:83`）；7 个固定错误 id 与 `design.md:68-78` 表对齐，按 `:167` id/detail 码点序排序。`pack.test.mjs:103-160` 四条负向测试 | 满足 |
| a2-pack 缺陷登记（`:19`） | 按 `check-defects.mjs:144-179` 独立重算 `[repro]` 段 SHA-256 = `f520198675d74dc94fd4be7bd120a0f7f5168e0058e85369bcc618100dbd9c93` == `defects.json:15`；base blob `599bf9fb` 是 HEAD `0049bcb9` 严格前缀（817→1370 字节），仅追加 1 个 `[fixed]`，`[repro]`/import 未动；`defects.json` base==HEAD（登记值不变）；`bin: null` 全文恰 1 次（canary find 唯一，`check-defects.mjs:364-371`）；`node scripts/check-defects.mjs` → `check-defects: ok`（基线通过 + canary 变体失败） | 满足 |
| 追溯（`:20`） | `T-009.json:1-14` 键恰 task/milestone/entries，AC-025 covered，files 两测试文件，与 `design.md:123-138` 一致；`node scripts/check-traceability.mjs` → `check-traceability: ok (covered=26 planned=48)` | 满足 |
| 写域（只读 tree diff） | base 473 文件 → HEAD 482：ADDED 9（6 个 `.collab/tasks/009/` 编排维护文件 + 3 个 write_scope 文件 `check-pack.mjs`/`pack.test.mjs`/`T-009.json`）；MODIFIED 2（`package.json`、`a2-pack.test.mjs`），均在 `design.md:2-9` write_scope 内；REMOVED 0。`dsh.plugin.json`/`defects.json`/`.gitignore`/`contracts/**`/`lib/**`/`bin/**`/`config/**` 零改动 | 满足 |
| 字符串门 / 令牌门 | `check-pack.mjs:14`、`pack.test.mjs:11` 用 `['.','coll','ab'].join('')` 拼接，新文件无 `.collab` 字面量；`check-unused.mjs scripts/check-pack.mjs` → `ok (files=1)`；CLI `--bogus`/`--root` 缺值退出 2、stderr 含 usage，无令牌/环境/npm 原始输出；6 文件无 `sk-/ghp_/xox/AKIA/Bearer` 字样 | 满足 |

### 只读运行 / 内存求值复核（均不写仓库文件）

- 三步串联：`node scripts/check-pack.mjs` → `check-pack: ok`（0）；`node --test --test-reporter=tap test/integration/pack.test.mjs test/characterization/defects/a2-pack.test.mjs` → `# tests 9 / # pass 9 / # fail 0`（0，7 个 `[AC-025]` + `[repro]` + `[fixed]`）；`node scripts/check-defects.mjs` → `check-defects: ok`（0）；等价判定 `check-pack=0 tests=0 defects=0` → `AC-025 OK`，与 `ci-results.json:16` 一致。
- `node scripts/check-traceability.mjs` → `check-traceability: ok (covered=26 planned=48)`；`node scripts/check-unused.mjs scripts/check-pack.mjs` → `check-unused: ok (files=1)`。
- CLI 边界：`node scripts/check-pack.mjs --bogus` → 退出 2、stderr `unknown argument: --bogus` + usage；`--root` 缺值 → 退出 2、stderr `--root requires a directory` + usage。
- 内存 `evaluatePack` 基线 `errors=[]`；8 类负向变换命中预期 id；`reproSha256`/`extractReproSection`/`hasFixedSection` 复算与登记一致；`runNpmPack` 真实清单 55 文件、`evaluatePack errors=[]`。

## 逐条核对（1/1）

- **AC-025**（`ci-results.json:8-18`，`acceptance.md:7-10`）：`exitCode=0`、`lastLine='AC-025 OK'`、`output='check-pack: ok\nAC-025 OK'`，命中期望（退出码 0，stdout 同时含 `check-pack: ok` 与 `AC-025 OK`）。命令串联 check-pack / 两测试文件 / check-defects 三步；评审只读复跑 `check-pack=0 tests=0 defects=0` → `AC-025 OK`。覆盖范围 7 条（bin/版本、`files` 白名单、真实 pack 必需项、禁入路径、负向行为、a2-pack 缺陷登记、追溯）逐条由上方「独立只读核对」表与内存/只读运行复核佐证，全部满足。通过。

## Findings

无（`findings` 为空数组）。逐条核对与独立只读复核均未发现与 `design.md` / `acceptance.md` 不符之处；CI 结果存在且不与代码矛盾，无「无法确认」项，无 P0/P1/P2 问题。

## 备注（非缺陷）

- `acceptance.md:22` 明确 `check-no-collab` / `check-unused` / `check-fast` 等全局门禁不属于 AC-025，其当前失败项（`test/unit/gitignore.test.mjs:13,18` 的 `.collab` 字面量、`a5-ignored-fields` 缺 `[fixed]`、`milestone-gate M1`、`import-safe.test.mjs:70`）来自其它任务写域，`impl.md §4` 已记录，按口径不计入本 AC 判定，不作为判 needs_revision 的理由。
- `impl.md §7` 记载 dev 依编排 note 整篇重写 `acceptance.md` 为 CI 可抽取形状（授权且 `ci-results.json` 已成功抽出 1 条命令），属编排/规格文件维护，与既有轮次一致，非本任务代码缺陷。
- `brief.md` 与 `design.md` 均未指定验收报告路径，本轮结论无追加目标，未改动任何历史小节。
- 未修改 `brief.md`、`design.md`、`acceptance.md`、`impl.md`、`state.json`、`run.json` 及任何被评审代码与文档；SHA、写域与 diff 等价核验均通过只读解压 `.git` 对象与读文件完成，未执行任何 git 子命令，未以 git 得出任何验收结论；除本 `review.md` 与 `verdict.json` 外未在仓库内创建任何文件（评审期 stdout/stderr 捕获写在系统临时目录并已清理，仓库内无 `*.tgz` 等残留）。沿用既有 verdict 字段与 `AC-025` 章节名，未发明字段、版本号或章节名。
