# Task 038 评审（review）

结论：**pass**（1/1，验证 sha `293b3ad74b29a73fa11718811e5128318c088d37`）。

## SHA 核验（只读，未执行 git）

- `.git` 指针 → `C:/git/dsh-CLIWorker/.git/worktrees/038/HEAD` = `ref: refs/heads/task/038`。
- `.git/refs/heads/task/038` = `293b3ad74b29a73fa11718811e5128318c088d37`，与会话开头最新提交 `293b3ad`（scope acceptance to AC-081）一致。

## 验收口径

acceptance.md 只有一个 AC（AC-081），内含 5 个命令块。AC-038 已按 acceptance.md 末节登记为"待环境验证"，不属于自动验收。notice.json 中的 `ci: 1/2` 是在收窄验收范围（293b3ad）前的旧记录。当前 ci-results.json 为 `passed=1, total=1, ok=true`（ranAt 2026-11-09T11:13:10+08:00）。

ci-results.json 的输出只留下第一个命令块的 TAP（19 个测试 pass、fail/skipped/todo 均为 0，末行 `AC-081 OK`）。其余 4 个命令块没有留下输出，所以我用只读或无写入的方式单独跑了一遍：

| 命令块 | 结果 |
|---|---|
| integration TAP | `node --test test/integration/wsl-smoke-preflight.test.mjs`：tests 19 / pass 19 / fail 0 / skipped 0 / todo 0 |
| 既有 WSL 与 dry-run smoke | 移除 `CLIWORKER_SMOKE` 后运行 `test/smoke/wsl-discover.test.mjs` 和 `test/smoke/smoke-dry-run.test.mjs`：8 / 8 pass |
| unit 回归 | `node --test "test/unit/*.test.mjs"`：532 / 532 pass，skipped 0 |
| 验收文档自检 | `check-acceptance: ok (files=1 warnings=0)`，acs=1 commands=5 |
| check-fast | 见下方"说明"，我没有执行 |

## 规格逐项核对

`scripts/smoke-real.mjs` 的行号如下。

- **探测顺序**：`:134-138` 先检查 Windows 平台和 `wsl.exe`。`:148-152` 用 `wsl -l -q` 以二进制取列表，交给 `parseDistros`（UTF-16LE）。列表失败和无发行版是两个独立原因。
- **先查全部 Node，再做发现**：`:154-167` 对每个发行版先检查 Node，全部通过后才在 `:169-181` 做 Windows inventory，在 `:185-208` 做 CLI 发现。
- **Node 检查**：
  - 全部经 `wsl.exe -d <distro> --exec` 执行，`distro` 是独立的 argv 元素，`-d` 后是完整名称。
  - `:158` 用固定的 `sh -c 'command -v node || exit 1'` 做存在性探测。
  - `:160` 拒绝非绝对路径和 `.exe/.cmd/.bat`。
  - `:162-165` 要求版本严格匹配 `vN.N.N`、`process.platform` 为 `linux`、主版本不低于 20。
  - 没有使用宿主的 `process.version` 或 `execPath`。
- **失败类别**：Node 缺失、版本低于 20、执行或解析失败是三个不同的错误文本。
- **CLI 发现**：`:200` 用 `env -i`、隔离的 `HOME` 和 `CLIWORKER_HOME`、已确认的 Linux Node 执行 `bin/cliworker.mjs discover --config … --full`。
  - 命令失败、非 JSON、平台不符、条目不是 present，都给出 `WSL distribution discovery failed`。
  - entries 为空时给出 `WSL CLI not found`（`:205`），与无 Node 的原因不同。
  - 没有硬编码 CLI 名单。
- **返回值**：`:207-210` 成功时返回按初始顺序排列的原始 inventory 数组。发行版集合在前后比较（`:183`、`:209`）。
- **safeReason**：`:98-114` 区分各类别，不回显 stderr、路径或发行版名。
- **失败 → 退出码**：错误进入 `executeSmoke` 的 catch（`:269-271`），步骤为 fail，后续步骤为 `dependency failed`，`main` 返回 `exitCodeFor('E_INTERNAL')`（`:324`）。
- **步骤和报告结构**：`wsl-discover` 仍是 `mandatory: true`、`ac: ['AC-038']`（`:252`）。步骤仍是原来的 7 步，没有新增报告字段、配置项或环境变量。
- **注入入口**：`executeSmoke(…, wslAction = realWsl)` 和 `main(argv, smoke = executeSmoke)` 的默认值保证命令行始终走真实路径。生产环境变量和命令行参数不能选择夹具。
- **写域**：我无法执行 git，只确认三个目标文件（`scripts/smoke-real.mjs`、`test/integration/wsl-smoke-preflight.test.mjs`、`docs/release-checklist.md`）存在且内容符合 design。`lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs` 由 impl.md 声明未改。
- **文档**：`docs/release-checklist.md:9-11` 说明探测顺序、每个发行版都要有 Linux Node 20+ 和非空 CLI 发现、四类失败原因、不自动安装，以及 `realWsl` 返回值只用于测试。`:30` 说明夹具结果不能证明 AC-038 真机通过。

测试文件 `test/integration/wsl-smoke-preflight.test.mjs` 的覆盖：

- **三种主场景**：满足、Node 缺失、无 WSL 都经同一个 `realWsl`，并通过 `--fixture-child` 子进程驱动完整的 mode=real 脚本入口。满足时七步全 pass、退出 0。后两种退出非 0，`wsl-discover` 为 fail，原因分别指向 Node 和 WSL，后续步骤为 `dependency failed`，并用 `validateReport` 校验。
- **编码与名称**：UTF-16LE 有 BOM 和无 BOM 交替出现，列表里有 NUL、CRLF、重复项、中文加空格的名称。`inventories.map(host.platform)` 与完整预期数组做 `deepEqual`。
- **边界情形**：Node 19 失败、Node 20 通过，以及无发行版、列表失败、版本异常、执行失败、Windows Node 路径伪装、无 CLI、环境不匹配、非法 JSON、错误平台、非 present 条目、集合变化、一个发行版缺 Node。Node 类失败都断言没有执行过 discover。
- **泄漏检查**：完整入口的 stdout 不含 `sensitive-secret`、`/private/path`、`中文 Distro`。
- **无 skip/todo/only**：TAP 的 skipped 和 todo 均为 0。

## 说明（均不阻断）

1. **check-fast 未复核。** CI 里没有 check-fast 的输出。impl.md 记录完整检查的 `npm test` 在写域外的 `test/integration/cross-process-write.test.mjs`（AC-083）失败，期望 24 条、实际 19 条。我单独跑该文件，3 / 3 pass。它与本任务的三个文件无关，更像负载相关的偶发失败。建议人工在空闲环境再跑一次 `scripts/check-fast.ps1`。本任务没有改动那个文件。
2. **Node 伪装测试只覆盖 `.exe` 路径。** 测试只用了 `/mnt/c/node.exe`。"路径无 `.exe` 但 Node 自报 `win32`"这条分支（`:164`）实现上有，测试没有覆盖。属于 P2 级的覆盖缺口。
3. **WSL 启动失败的归类。** `:158` 把"`sh` 探测失败"一律归为 `Node not found`。发行版无法启动时也会得到这个原因，略不精确，但仍是 fail，不会误判为 pass。
4. **名称比较。** `inventory.host.wsl_distros` 与初始列表用 `sameSet` 比较，不看顺序。名称是否含 BOM/NUL/CR/LF 通过"与已校验的干净名称集合相等"间接保证。
5. **PATH 与 Node 版本。** 完整入口测试的 PATH 只含 Node 所在目录，没有额外受控目录。测试用到 `import.meta.filename`（Node 20.11+），而 `engines` 是 `>=20`，在 20.0–20.10 上会失败。

## AC-038 状态

待环境验证。当前本机 WSL（Ubuntu-24.04）内没有 Node，脚本会明确报 fail 且退出非 0，不会 skip，也不会误报 pass。这符合本任务的交付目标。
