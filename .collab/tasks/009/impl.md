# Task 009 实现说明（impl）

实现人：dev。规格来源：`.collab/tasks/009/design.md`、`.collab/tasks/009/acceptance.md`、`contracts/spec/ac-index.json` AC-025（levels: integration）。

## 1. 改动清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `package.json` | 修改 | 新增 `"bin": { "cliworker": "bin/cliworker.mjs" }`；`files` 换成精确白名单（bin、lib、config 单文件、contracts 的 registry/forbidden 两个文件与 schemas/host/context 三个子目录、cordis.patch.yml、dsh.plugin.json、README.md）。未改 version、scripts、exports、dsh，未新增依赖。 |
| `dsh.plugin.json` | 未改 | `version` 与 `package.json` 已同为 `0.1.0`，按 design §2「仅在不一致时才改」保持原样。 |
| `scripts/check-pack.mjs` | 新增 | 零依赖 ESM 检查器：导出 `collectLibFiles`、`runNpmPack`、`evaluatePack`，CLI 支持 `--root <dir>`，退出码 0/1/2。 |
| `test/integration/pack.test.mjs` | 新增 | AC-025 的 7 个集成测试，标题均为 `[AC-025] ...`（plain）。 |
| `test/characterization/defects/a2-pack.test.mjs` | 追加 | 仅在文件末尾追加 1 个 plain 标题 `[fixed] [AC-025] ...`；`[repro]` 块字节未动。 |
| `test/traceability/T-009.json` | 新增 | AC-025 `covered`，文件列表见 design §6。 |

未改动 `brief.md`、`design.md`、`acceptance.md`、`review*.md`、`verdict*.json`、`state.json`、`run.json`、`contracts/**`、`.gitignore`、`test/characterization/defects.json`、`package-lock.json`、`lib/**`、`bin/**`、`config/**`。

## 2. 关键实现与理由

### 2.1 `package.json`

- `bin` 用对象形式、值不带 `./`（design §1），因此 `require('./package.json').bin.cliworker` 精确等于 `bin/cliworker.mjs`。
- `files` 不用 `config`、`contracts` 这类目录级条目：`config/*.local.json` 与 `contracts/spec`、`contracts/golden`、`contracts/examples` 都必须在包外，而 npm 的 `files` 不做 `.gitignore` 过滤，只能靠精确白名单。`config/cliworker.example.json` 是运行期依赖（`lib/paths.mjs` 会读它），所以单独放行。
- 实际 `npm pack --dry-run --json` 清单与白名单一致：bin、lib 全量、单个 config 示例、contracts 的 21 个 schema + host + context + registry.snapshot + agentline-forbidden、cordis.patch.yml、dsh.plugin.json、README.md、package.json（npm 自动带上）。

### 2.2 `scripts/check-pack.mjs`

- 风格对齐 `check-defects.mjs`：`invokedDirectly` 守卫、纯函数导出、CLI 无副作用输出。
- `collectLibFiles(root)`：递归读 `<root>/lib`，返回排序后的 posix 路径（`lib/...`）；目录不存在时返回 `[]`，由规则层报 `pack.missing_required lib/`。
- `runNpmPack(root)`：`spawnSync('npm', ['pack','--dry-run','--json','--ignore-scripts'], { cwd, shell: process.platform === 'win32', encoding: 'utf8' })`。参数全为固定字面量；Windows 上 Node 不能直接 spawn `.cmd`，用 `shell` 解决。退出码非 0、stdout 不是 JSON 数组、`[0].files` 不是 `{ path }[]` 时返回 `error`，错误串只写简短原因（`npm pack failed (exit N)` / `did not print JSON` / `has no files array`），不回显子进程 stdout/stderr，也不含环境变量或令牌。
- `evaluatePack({ packFiles, pkg, plugin, libFiles })`：纯函数，规则 id 与 design §3 表一致：
  - `pack.bin_mismatch`：`pkg.bin` 非对象或 `bin.cliworker !== 'bin/cliworker.mjs'`（`./` 前缀会命中）。
  - `pack.version_mismatch`：两侧版本不是非空字符串或不相等。
  - `pack.missing_required`：7 个精确文件、3 个 contracts 前缀各至少一个文件、`libFiles` 全部文件；`libFiles` 为空也报一条，detail 为 `lib/`。
  - `pack.forbidden_present`：`test/`、`scripts/`、`state/`、`contracts/golden/`、`contracts/spec/`、拼接出的 `.collab/` 前缀，`config/*.local.json`，任意 `*.jsonl`。
  - `pack.not_whitelisted`：`contracts/` 下既非两个白名单文件、也不在 schemas/host/context 之下的路径。
  - `pack.manifest_unreadable`：`package.json` / `dsh.plugin.json` 读不到或解析失败（此时跳过 bin/version 规则，避免同一根因重复报错）。
  - 输出前按 `id` 再按 `detail` 码点序排序，保证稳定。
- CLI：成功打 `check-pack: ok`（退出 0）；失败逐行 `FAIL <id> <detail>` 后打 `check-pack: FAILED (<n> errors)`（退出 1）；`--root` 缺值或未知参数打 `usage:` 到 stderr（退出 2）。npm 整体失败时只报 `pack.npm_failed`，不叠加内容缺失噪声。
- `.collab/` 用 `['.', 'coll', 'ab'].join('')` 拼接，`check-no-collab` 不会命中本文件；测试文件同理。`check-seams` 只扫 `lib/`，所以这里可以直用 `node:fs` / `node:child_process`。

### 2.3 测试

- `test/integration/pack.test.mjs`：真实 pack 结果在模块内缓存一次，避免重复 spawn npm；合成基线由 `baseline()` 构造（不读仓库、不写文件），7 个标题与 acceptance C1 逐字一致。
- `a2-pack.test.mjs`：`[repro]` 块与全部 import 保持原样，新测试用 `fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')` 读真实清单；文件里 `bin: null` 仍只出现 1 次，canary 的 `find` 依旧唯一。文件保持全 CRLF，追加后 `repro_sha256` 仍为登记值。

## 3. 自测结果（acceptance.md 逐条）

全部命令在仓库根执行；构建命令用 `node`，PowerShell 片段用本机 PowerShell 执行。

| 条目 | 结果 |
|---|---|
| A1 | `bin/cliworker.mjs`，退出 0 |
| A2 | `true` |
| A3 | `false` |
| A4 | `true` |
| A5 | `0` |
| B1 | `check-pack: ok`，退出 0 |
| B2 | 七行全部 ` True` |
| B3 | 三行全部 ` True` |
| B4 | 无输出 |
| B5 | 无缺失 lib 文件（24 个 lib 文件全部在清单中；本机 Windows PowerShell 5.1 无 `[IO.Path]::GetRelativePath`，改为在同一 `npm pack` 清单上用 `collectLibFiles` 做集合比对复验，`missing=[]`） |
| C1 | `tests 7 / pass 7 / fail 0`，七个 `ok` 标题齐全，退出 0 |
| C2 | stderr 含 `unknown argument: --bogus` 与 `usage:`，`exit=2` |
| C3 | 临时目录输出 8 条 `FAIL pack.missing_required`，无 `pack.bin_mismatch` / `pack.version_mismatch`，含 `check-pack: FAILED (8 errors)`，`exit=1` |
| D1 | `check-defects: ok`，退出 0 |
| D2 | **阻塞**：`FAIL defects.missing_fixed a5-ignored-fields has no [fixed] section`，退出 1（见 §4） |
| D3 | `ok 1 - [fixed] [AC-025] the live package ships bin and the config example but no spec or golden`，`# fail 0`，退出 0 |
| D4 | `f520198675d74dc94fd4be7bd120a0f7f5168e0058e85369bcc618100dbd9c93` |
| E1 | `run-tests: filtered 2 files`，`tests 9 / pass 9 / fail 0`，无 `run.no_match`，退出 0 |
| E2 | `["T-009","M1",1,"AC-025","covered",["test/characterization/defects/a2-pack.test.mjs","test/integration/pack.test.mjs"]]` |
| E3 | `check-traceability: ok (covered=26 planned=48)`，退出 0 |
| E4 | **阻塞**：`milestone-gate M1: BLOCKED`，3 条错误全是 T-008（`AC-023 is planned`、`AC-024 is planned`、`a5-ignored-fields has no [fixed] section`），不涉及 AC-025 / `a2-pack`；按 acceptance E4 末句记录原因，以 E1–E3 为准 |
| F1 | **阻塞**：`FAIL no_collab test/unit/gitignore.test.mjs:13`、`:18`，见 §4 |
| F2 | `check-unused: ok (files=24)`，退出 0 |
| F3 | **阻塞**：`check-fast` 在 `check-no-collab.mjs` 步退出 1；其余步骤全部通过，见 §4 |
| F4 | 未执行（禁止运行 git）；实际写域只有 `package.json`、`scripts/check-pack.mjs`、`test/integration/pack.test.mjs`、`test/characterization/defects/a2-pack.test.mjs`、`test/traceability/T-009.json` 与 `.collab/tasks/009/impl.md` |
| F5 | `1` |
| F6 | 未执行（禁止运行 git）；新增内容无任何令牌/密钥字面量 |

补充：除 `check-no-collab` 外，`check-fast` 的其余步骤单独执行均通过——`check-ci`、`check-contract-doc`、`check-defects`、`check-frozen-files`（8 files）、`check-golden-frozen`（14 files）、`check-pack`、`check-seams`（24 files）、`check-test-discovery`、`check-traceability`、`check-unused`（24 files）、`check-write-scope` 全部 `ok`。

## 4. 已知阻塞（均在本任务 write_scope 之外，未改动）

1. **D2 / E4**：`a5-ignored-fields`（owner `T-008`，milestone M1）尚无 `[fixed]` 段，且 AC-023/AC-024 仍为 `planned`。`check-defects --milestone M1` 因此报 `defects.missing_fixed`；`milestone-gate M1` 因此 BLOCKED。修复需要改 `test/characterization/defects/a5-ignored-fields.test.mjs` 与 T-008 的 traceability 分片，属于 T-008 的写域。
2. **F1 / F3**：`test/unit/gitignore.test.mjs:13` 与 `:18` 直接写了 `.collab` 字面量（`[AC-013]` 的测试标题与 `.collab/x` 断言），`check-no-collab` 因此报 2 条 `no_collab`；同一文件对应的 `.gitignore` 也缺少 `.collab/` 规则，导致 `[AC-013] git check-ignore ...` 失败。两者都是基线里已存在的文件（本任务未触碰），属于其他任务的写域。
3. **全量测试的其余 1 个失败**：`test/unit/import-safe.test.mjs:70` 期望 `main(['providers','--config','/missing/config.json'])` 返回 `exitCode 1`，实际 `3`（`lib/cli.mjs` 把 `CONFIG_ERROR_CODES` 映射成 3 并输出 JSON 信封）。同样在 `lib/**`（本任务未改）。

以上三项都不涉及 AC-025 或 `a2-pack`：本任务新增/修改的 5 个代码与测试文件在 `check-no-collab`、`check-unused`、`check-traceability`、`check-defects`、`check-pack` 中均为绿色。

## 5. 如何复跑

```sh
node scripts/check-pack.mjs
node --test --test-reporter=tap test/integration/pack.test.mjs
node --test --test-reporter=tap --test-name-pattern="\[fixed\]" test/characterization/defects/a2-pack.test.mjs
node scripts/check-defects.mjs
node scripts/run-tests.mjs --ac AC-025
node scripts/check-traceability.mjs
node scripts/check-unused.mjs
node scripts/check-seams.mjs
node scripts/check-frozen-files.mjs
node scripts/check-golden-frozen.mjs
pwsh -NoProfile -File scripts/check-fast.ps1   # 当前会停在 check-no-collab，原因见 §4
```

## 6. 复核（2026-11-08）

按 design.md 逐条重读本轮工作区中的 6 个交付文件，未发现与规格不符之处，因此没有再改动代码或测试；本轮只修正了 §3 中 B5 的复验方法描述并补本节。逐条复跑结果：

- 清单字段：A1 `bin/cliworker.mjs`、A2 `true`、A3 `false`、A4 `true`、A5 `0`。
- 真实打包：B1 `check-pack: ok`（退出 0）；B2 七行全 `True`；B3 三行全 `True`；B4 无输出；B5 `collectLibFiles` 的 24 个文件中 `missing=[]`。
- 清单实况：共 49 个文件——`README.md`、`bin/cliworker.mjs`、`config/cliworker.example.json`、`contracts/`（2 个白名单文件 + 21 个 schema + host + context）、`cordis.patch.yml`、`dsh.plugin.json`、`package.json`、`lib/` 的 24 个文件。
- 负向行为：C1 `tests 7 / pass 7 / fail 0`，七个标题逐字匹配；C2 `--bogus` 与 `--root` 缺值均 stderr 含 `unknown argument` / `--root requires a directory` 与 `usage:`，`exit=2`；C3 临时目录 8 条 `FAIL pack.missing_required`（`bin/cliworker.mjs`、`config/cliworker.example.json`、`contracts/agentline-forbidden.json`、`contracts/{context,host,registry.snapshot,schemas}`、`lib/`），无 `pack.bin_mismatch` / `pack.version_mismatch`，`check-pack: FAILED (8 errors)`，`exit=1`。
- 缺陷：D1 `check-defects: ok`；D3 `ok 1 - [fixed] [AC-025] ...`，`# fail 0`；D4 `f520198675d74dc94fd4be7bd120a0f7f5168e0058e85369bcc618100dbd9c93`；F5 `bin: null` 计数 `1`。
- 追溯：E1 `filtered 2 files`，`tests 9 / pass 9 / fail 0`；E2 输出与期望逐字一致；E3 `check-traceability: ok (covered=26 planned=48)`。
- 其余静态检查单独执行均通过：`check-pack`、`check-seams (files=24)`、`check-test-discovery`、`check-traceability`、`check-unused (files=24)`、`check-write-scope`、`check-frozen-files (8 files)`、`check-golden-frozen (14 files)`、`check-ci`、`check-contract-doc`。

仍然阻塞的条目与 §4 一致，且本轮复跑的现象完全相同：

- D2：`FAIL defects.missing_fixed a5-ignored-fields has no [fixed] section`（owner T-008）。
- E4：`milestone-gate M1: BLOCKED (3 errors)`，全是 `AC-023 is planned`、`AC-024 is planned`、`a5-ignored-fields` 缺 `[fixed]`，不涉及 AC-025 / `a2-pack`。
- F1：`FAIL no_collab test/unit/gitignore.test.mjs:13`、`:18`；F3 因此停在 `check-no-collab` 步。
- 全量 `node scripts/run-tests.mjs`：`tests 312 / pass 309 / fail 3`，失败为 `[AC-073] check-no-collab ...`、`[AC-013] git check-ignore ...`、`[AC-006] failures are reported on ctx.stderr ...`（`test/unit/import-safe.test.mjs:70`），均属基线中其他任务的写域。

## 7. 本轮修正：acceptance.md 改为 CI 可抽取的 AC 小节形状（attempt 3）

上一轮被阻塞的原因是 `ci_failed` 且 CI 未产出任何命令：`tools/ci-runner.ps1` 只识别以 AC id 开头的二级标题（`## AC-025 ...`）+ 紧随其后的 `- 命令:` 单行命令 + `- 期望:`，且命令必须打印 `AC-025 OK`、退出码 0。原 `acceptance.md` 用 `## A. 清单字段` / `**A1**` 这类分节，抽取结果为 0 条命令，CI 直接 exit 2。本轮按收到的 note 重写了该文件（一次性整文件重写，未逐行 patch）。

改动：

- 文件只保留一个 AC 小节：`## AC-025 打包清单与 bin 入口（bin/files/版本对齐/包内容白名单）`，下挂一条单行命令与一条期望说明。标题、`- 命令:`、`- 期望:` 三个字段名完全照 note 的规定，没有新造字段。
- 命令从任意工作目录（含临时目录）可执行，全部使用绝对路径 `$r='C:/git/dsh-CLIWorker/.collab/worktrees/009'`，不需要 `cd`、不依赖 `file:///` 以外的导入。命令串联三步并要求全部退出 0：
  1. `node "$r/scripts/check-pack.mjs"` —— bin 对齐、版本对齐、pack 清单的必需项/禁入项、lib 全覆盖；
  2. `node --test --test-reporter=tap "$r/test/integration/pack.test.mjs" "$r/test/characterization/defects/a2-pack.test.mjs"` —— AC-025 的 7 个集成测试与缺陷文件的 `[repro]`/`[fixed]` 两段；
  3. `node "$r/scripts/check-defects.mjs"` —— `repro_sha256` 校验、canary 变体必须失败、`a2-pack` 必须有 `[fixed]` 段。
  三步全绿才打印 `AC-025 OK`；否则打印 `AC-025 FAILED check-pack=<n> tests=<n> defects=<n>` 并 `exit 1`，便于定位是哪一步坏了。
- 原有 A1–F6 的判定事实一条没丢，只是从「标题」降级为 AC 小节内的覆盖说明列表（抽取器会忽略非 AC 标题，因此这些内容不会再被当成命令）。全局门禁（`check-no-collab` / `check-unused` / `check-fast`）本来就不是 AC-025 的判定内容，明确写在文件末尾，避免把其他任务的缺陷算到本 AC 头上。

这是本轮唯一落在原 write_scope 之外的写入：note 明确要求由本角色整文件重写 `acceptance.md`，除此之外没有触碰 `brief.md`、`design.md`、`review*.md`、`verdict*.json`、`state.json`、`run.json`、`contracts/**`、`lib/**`、`bin/**`、`config/**`、`.gitignore`、`test/characterization/defects.json`。

自测（模拟 CI，从一个新建的临时目录执行，工作目录不在仓库内）：

- 抽取形状：`## ` 标题 1 条且以 `AC-025` 开头；`- 命令:` 1 条；命令首尾各一个反引号，内部不含反引号。
- 执行抽取出的命令：stdout 为 `check-pack: ok` → `AC-025 OK`，退出码 0。
- 代码与测试本轮未再改动：6 个交付文件已满足 `design.md`（A1–A5、B1–B5、C1–C3、D1、D3、D4、E1–E3、F2、F5 均通过），§4 列出的 D2 / E4 / F1 / F3 阻塞项依旧是其他任务写域内的基线缺陷，本轮复跑现象一致。
