# T-002 实现说明

对应 AC-005（levels: unit）。全部按 `.collab/tasks/002/design.md` 实现，只写了 write_scope 列出的路径
（外加本文件 `impl.md`）。基准提交：`f75bb76`。

## 1. 交付物

| 路径 | 内容 |
|---|---|
| `test/fixtures/characterization/v0.1/` | 0.1 逐字节副本，恰好 7 个文件：`lib/{availability,cli,config,forecast,select}.mjs`、`lib/index.js`、`config/cliworker.example.json`（无 `package.json`、无 `bin/`、无说明文件） |
| `test/characterization/stable.test.mjs` | 6 条保留面用例，只 import 副本 |
| `test/characterization/frozen-files.json` | `source_commit` + 8 条登记（副本 7 + `stable.test.mjs`） |
| `test/characterization/defects.json` | 11 条缺陷，含 `owner_task`、`owner_milestone`、`ac`、`repro_sha256` |
| `test/characterization/defects/*.test.mjs` | 新建 10 个（`a3-runner` 保持 T-001 原样未改），每个文件一个 `[repro]` 段，无 `[fixed]` 段 |
| `test/characterization/canary/<id>/canary.json` | 11 个；9 个用 overlay，`a2-pack` / `a3-runner` 用 `repro_edits` |
| `test/characterization/canary/<id>/overlay/lib/*` | 9 组 0.1 的最小「已修复变体」，扩展名 `.mjs`，无 `*.test.mjs` |
| `test/unit/frozen-files.test.mjs` | design §6 的 15 条用例（9 条 frozen + 6 条 defects） |
| `test/traceability/T-002.json` | AC-005 covered，两个测试文件 |
| `scripts/check-frozen-files.mjs` | 新建；导出 `checkFrozenFiles`、`contentHash`、`classifyPath` |
| `scripts/check-defects.mjs` | 追加 `extractReproSection`、`reproSha256`、`checkRepros` 与 `--strict`；原有导出与默认行为不变 |

## 2. 关键实现决策

### 2.1 副本与 hash 口径

- 副本用「读工作树同路径文件 → 把所有 `\r\n` 换成 `\n` → 写回」生成。design §0 已确认工作树的 `lib/`、
  `config/cliworker.example.json` 与 `f75bb76` 一致；blob 是 LF，所以该过程得到的就是 blob 字节。
  本轮已用验收 B-1 的原命令（只读的 `git ls-tree` / `git cat-file`，不改仓库）复核：stdout `ok 7`。
- `contentHash(buffer)` = `sha256(buffer.toString('latin1').replace(/\r\n/g, '\n'), 'latin1')`，即
  「CRLF→LF 之后的原始字节」的 sha256，小写十六进制。用 latin1 往返保证非 ASCII 字节不被改动。
  因此 autocrlf 检出（CRLF）与 Linux 检出（LF）得到同一哈希。
- `frozen-files.json` 只登记：副本 7 个文件 + `test/characterization/stable.test.mjs`。没有登记
  `contracts/spec/ac-index.json`（T-001 的活索引，冻结会让后续加 AC 卡死 check-fast），也没有登记
  `contracts/golden/**`（当前不存在；T-004 的 `golden/manifest.json` 自带逐文件登记，本检查只要求
  「已登记的不被改动」）。

### 2.2 `scripts/check-frozen-files.mjs`

- 允许集合硬编码：前缀 `test/fixtures/characterization/v0.1/`、精确 `test/characterization/stable.test.mjs`、
  前缀 `contracts/spec/`、前缀 `contracts/golden/`。
- 判定顺序（每条登记）：JSON 结构 → 规范化 → `frozen.forbidden_path`（`lib/`、`bin/`、`config/`，大小写不敏感）
  → `frozen.outside_allowed`（绝对路径、盘符、反斜杠、`..`、不在允许集合）→ 读文件（`file_missing` / `hash_mismatch`）。
- 另外扫描副本目录与 `stable.test.mjs`，没有登记就 `frozen.unregistered`。
- 输出与 check-defects 同风格：`check-frozen-files: ok (<N> files)` / `FAIL <id> <detail>` + `check-frozen-files: FAILED (<n> errors)`；
  未知参数退出码 2。不调用 git、不读网络。

### 2.3 `stable.test.mjs`

- 两条静态 import：`../fixtures/characterization/v0.1/lib/select.mjs`、`.../lib/config.mjs`。不 import `lib/`、`bin/`、
  `scripts/`，也不 import `lib/cli.mjs`（导入即 `main()`）。
- 保留面按 AC-005 括号里的四类硬编码（`contracts/spec/surfaces.json` 属 T-004，本分支还不存在）：
  弃用与未验证不入候选、等级过滤、exclude 原因优先、四个 schema 名（config / selection / model / handle）。
- 第 6 条用例读自身源码，断言所有以 `.` 开头的 import 说明符都含 `fixtures/characterization/v0.1/`。

### 2.4 `[repro]` 段与 `repro_sha256`

- 段 = 行首无缩进、以 `test('[repro]` 开头且以 `{` 结尾的行 → 其后第一个行首 `})` 行（含）。
- `extractReproSection(source)` 返回 `{ blocks, errors }`；`reproSha256(source)` = sha256(各块 CRLF→LF 后用 `\n` 连接)，
  无段或格式错时返回 `null`。`defects.json` 的取值就是用同一函数生成的，检查也用它，口径唯一。
- 10 个新 repro 的标题都是 `[repro] [AC-005] ...`，块自包含（夹具、临时目录、环境变量还原、清理都在块内）；
  块外只有 `const V01 = process.env.CLIWORKER_V01_ROOT ?? fileURLToPath(new URL('../../fixtures/characterization/v0.1/', import.meta.url))`
  与 node 内置 import，副本一律用 `await import(pathToFileURL(path.join(V01, ...)))` 动态导入。

### 2.5 canary 与 `checkRepros`

- 每条缺陷两次运行：基线（原样副本）必须通过；canary（副本 + overlay + `repro_edits`）必须出现 `not ok <n> - [repro]`。
  只靠退出码非 0 不算命中，所以导入失败/语法错误不会被误判成 canary 成功。
- 临时根用 `fs.mkdtempSync(os.tmpdir()/cliworker-canary-)`，副本复制到 `<tmp>/v0.1` 并补 `package.json = {"type":"module"}`
  （副本里的 `lib/index.js` 需要它），repro 复制到 `<tmp>/repro.test.mjs`，其中 `.` 开头的 import 说明符按原文件所在
  目录改写成 `file://` 绝对 URL；运行 `node --test --test-reporter=tap --test-name-pattern=\[repro\]`，
  环境给 `CLIWORKER_V01_ROOT` 且删除 `NODE_TEST_CONTEXT`，超时 60s，结束后无条件删临时根。
- overlay 路径相对 v0.1 根校验（拒绝绝对路径、盘符、反斜杠、`..`）；`repro_edits[].find` 必须在 repro 源码中恰好出现一次。

### 2.6 `check-defects` 严格模式（向后兼容）

- 只有「不带 `--root`」或「带 `--strict`」才严格。`checkDefects({ root, index, milestone })` 的签名与返回值未变，
  `milestone-gate.mjs` 的调用不走严格分支，T-001 的 `test/unit/milestone-gate.test.mjs` 6 条全绿。
- 严格模式在原有检查之上：账本 id 集合必须恰为 11 个（复用 `defects.set_mismatch`，已存在则不重复加），
  并对每条缺陷调用 `checkRepros`。错误行格式 `FAIL <id> <defect-id> <detail>`。

## 3. 验收自测结果（r1 + r2 复核）

r1 建立交付物；r2 重跑全部验收命令，结果与 r1 一致（两处阻塞未变，均在写域外，见 §4）。
B-3–B-6、C-2、D-4–D-6 用 bash 的 `mktemp -d` + `cp -r` 复现 pwsh 脚本的同样步骤（临时目录副本，不动仓库）。

| 项 | 命令 | 结果 |
|---|---|---|
| A-1 | `node scripts/run-tests.mjs --ac AC-005` | 通过：`filtered 12 files`，31 tests / 0 fail，6 条 stable + 15 条 frozen/defects + 10 条 `[repro] [AC-005]` 全 ✔ |
| A-2 | `node scripts/check-frozen-files.mjs` | 通过：`check-frozen-files: ok (8 files)` |
| A-3 | `node scripts/check-defects.mjs` | 通过：`check-defects: ok`（严格模式，11 条 canary 全部命中） |
| A-4 | `node scripts/check-fast.mjs` | **失败**，见 §4.1（停在 `check-ci.mjs`，与本任务无关） |
| A-5 | `node scripts/run-tests.mjs` | **失败 2 条**，见 §4.1、§4.2（69 tests / 67 pass） |
| B-1 | git 对比 7 个 blob | 通过：按验收命令原样执行（只读 plumbing），stdout 恰为 `ok 7` |
| B-2 | 形状与允许集合 | 通过：`ok 8` |
| B-3 | 篡改一个登记字节 | 通过：`FAIL frozen.hash_mismatch .../lib/select.mjs` + `FAILED (1 errors)`，exit 1 |
| B-4 | 登记 lib/bin/config/scripts | 通过：3 条 `frozen.forbidden_path` + 1 条 `frozen.outside_allowed`，`FAILED (4 errors)`，exit 1 |
| B-5 | 副本多一个未登记文件 | 通过：`FAIL frozen.unregistered .../README.md`，exit 1 |
| B-6 | `--bogus` | 通过：exit 2 |
| C-1 | 相对 import 全指向副本 | 通过：`ok 2` |
| C-2 | 改坏副本的 `reason: 'excluded'` | 通过：`not ok 4 - [AC-005] stable: exclude wins and reports excluded`，exit 1 |
| D-1 | defects.json 内容 | 通过：`ok 11` |
| D-2 | repro / canary / 无 `*.test.mjs` | 通过：`ok` |
| D-3 | `[repro]` 与 `[fixed]` 分离 | 通过：`ok 10` |
| D-4 | 篡改 `[repro]` 段 | 通过：含 `FAIL defects.repro_changed a5-dup-call`，exit 1（另有 1 条 a3-runner 基线失败，见 §5 备注） |
| D-5 | canary 覆盖文件换成 0.1 原文 | 通过：含 `FAIL defects.canary_survived a5-dup-call`，且无其它 `canary_survived`，exit 1 |
| D-6 | 删掉 `canary/a4-paths` | 通过：含 `FAIL defects.canary_missing a4-paths`，exit 1 |
| D-7 | `node --test test/unit/milestone-gate.test.mjs` | 通过：6/6，无 ✖ |
| E-1 | `check-traceability` + T-002.json 形状 | 通过：`ok (covered=6 planned=68)`、`ok` |
| E-2 | 写域检查 | 通过：改动只在 write_scope 内（+ `.collab/tasks/002/impl.md`） |
| E-3 | 无第三方依赖 / 无令牌 | 通过：`ok` |

## 4. 未通过项与根因（r3 已全部修复，见 §8）

这两项在 r1/r2 时不在写域内，r3 经批准把 `scripts/check-ci.mjs`、`test/unit/traceability.test.mjs`
扩进写域后按「各改一行」修掉，详见 §8。以下保留原始诊断。

### 4.1 check-ci 因 CRLF 检出失败（阻塞 A-4，并使 A-5 少一条）

- 现象：`node scripts/check-ci.mjs` → `FAIL ci.stale .github/workflows/ci.yml is not the current generated output`；
  `check-fast` 在第一步 `check-ci.mjs` 就退出，走不到 `check-defects.mjs` / `check-frozen-files.mjs` / `npm test`。
- 证据：`.github/workflows/ci.yml` 在盘上有 57 个 CRLF、`renderCi()` 生成 0 个 CRLF；把实际文件 CRLF→LF 后与
  生成结果**逐字符相等**（`r === a.replace(/\r\n/g,'\n')` 为 true）。即内容没变，只是 `core.autocrlf=true`
  的检出换行（design §0 也写了本机 autocrlf=true、仓库无 `.gitattributes`）。
- 影响面：与 T-002 无关，`.github/` 与 `scripts/check-ci.mjs` 均未被我改动；同一失败也出现在
  `test/unit/runner-selftest.test.mjs` 的 `[AC-002] check-ci accepts the committed workflow`。
- 已验证该失败之外的 A-4 内容：在临时根里放 `scripts/`、`test/`、`contracts/`、`package.json`、`.github/` 并把
  `ci.yml` 归一化成 LF，`node scripts/check-ci.mjs --root <tmp>` → `check-ci: ok`；同一临时根下其余检查也全绿。
  在真实仓库里，`check-defects.mjs` / `check-frozen-files.mjs` / `check-test-discovery.mjs` / `check-traceability.mjs`
  与 `npm test` 均已单独跑过且通过（见 §3、§7），所以 A-4 只差 `check-ci` 这一根堵塞点。
- 最小修复（属 T-001 / 后续任务）：让 check-ci 比较前把两侧 CRLF→LF 归一化，或提交 `.gitattributes` 固定 LF。
  修好后 A-4 只剩 A-5 那一项。

### 4.2 T-001 的 AC-004 用例把「AC-005 尚未有分片」写死了（阻塞 A-5）

- 现象：`test/unit/traceability.test.mjs` 的 `[AC-004] mergeShards treats ACs without a shard as planned`
  断言 `merged.acs['AC-005'] === 'planned'`，本任务按 design §7 / 验收 E-1 提交 `T-002.json`（AC-005 `covered`）后，
  该断言变成 `actual 'covered' / expected 'planned'`，全量运行 1 条红。
- 这是规格内部的直接冲突：design §7 与 E-1 要求 AC-005 = `covered`，而 T-001 的用例用它当「没有分片的 AC」样例。
  只要 AC-005 被本任务覆盖，该断言必然失效，与本任务实现无关。
- 最小修复（属 T-001 / 后续任务）：把该断言换成另一个确实没有分片的 AC（例如 `AC-006`），或改成从 index 里挑一个
  「未被任何分片声明的 AC」。一行替换即可，不涉及逻辑变更。
- 我没有直接改：`test/unit/traceability.test.mjs` 不在 write_scope，改它会让 E-2（写域检查）直接变红，净效果不划算。

## 5. 备注

- D-4/D-5/D-6 的临时根只复制了 `test/` 与 `contracts/`（与验收脚本一致），`a3-runner` 的 repro 依赖
  `../../../scripts/run-tests.mjs`，在该临时根里不存在，于是额外出现一条
  `FAIL defects.repro_baseline_failed a3-runner`。验收对这三项的判据只要求出现目标行、且 D-5 不得有其它
  `canary_survived`，均满足；真实仓库（A-3）没有这条噪声。
- `defects.json` 的 `repro_sha256` 是用 `scripts/check-defects.mjs` 导出的 `reproSha256` 生成的，可与
  `node --input-type=module -e "import {reproSha256} from './scripts/check-defects.mjs'; ..."` 复核。
- 本任务不接触任何密钥；repro 与临时目录里只有构造出来的假配置，日志与改动文件里没有令牌。

## 6. 自测命令

```bash
node scripts/run-tests.mjs --ac AC-005
node scripts/check-frozen-files.mjs
node scripts/check-defects.mjs
node --test test/unit/frozen-files.test.mjs
node --test test/unit/milestone-gate.test.mjs
node scripts/check-traceability.mjs
node scripts/run-tests.mjs
```

## 7. r2 复核记录

本轮没有改动任何交付物代码，只重跑了验收；结论与 r1 相同。逐条实测（Windows，Node v22）：

| 项 | 实测输出 |
|---|---|
| A-1 | `run-tests: filtered 12 files`，`ℹ tests 31 / pass 31 / fail 0`；6 条 `stable:`、9 条 `frozen:`、6 条 `defects:`、10 条 `[repro] [AC-005]` 全 ✔ |
| A-2 | `check-frozen-files: ok (8 files)`，exit 0 |
| A-3 | `check-defects: ok`，exit 0（严格模式，11 条 canary 全部命中） |
| A-4 | exit 1，停在 `check-ci.mjs`（§4.1） |
| A-5 | `run-tests: full 17 files`，`ℹ tests 69 / pass 67 / fail 2`：`[AC-002] check-ci accepts the committed workflow`（§4.1）与 `[AC-004] mergeShards ... planned`（§4.2）；其余全绿，含 `[repro] 0.1 has no test script` |
| B-1 | `ok 7` |
| B-2 | `ok 8` |
| B-3 | `FAIL frozen.hash_mismatch .../v0.1/lib/select.mjs` + `FAILED (1 errors)`，exit 1 |
| B-4 | 3×`frozen.forbidden_path` + `frozen.outside_allowed scripts/run-tests.mjs` + `FAILED (4 errors)`，exit 1 |
| B-5 | `FAIL frozen.unregistered .../v0.1/README.md`，exit 1 |
| B-6 | exit 2 |
| C-1 | `ok 2` |
| C-2 | `not ok 4 - [AC-005] stable: exclude wins and reports excluded`，exit 1 |
| D-1 / D-2 / D-3 | `ok 11` / `ok` / `ok 10` |
| D-4 | 含 `FAIL defects.repro_changed a5-dup-call`，exit 1（另有 §5 说明的 a3-runner 噪声） |
| D-5 | 含 `FAIL defects.canary_survived a5-dup-call`，无其它 `canary_survived`，exit 1 |
| D-6 | 含 `FAIL defects.canary_missing a4-paths`，exit 1 |
| D-7 | `ℹ tests 6 / pass 6 / fail 0` |
| E-1 | `check-traceability: ok (covered=6 planned=68)`；T-002.json 形状 `ok` |
| E-3 | `ok` |
| F | 11 个 `node --test --test-name-pattern="\[repro\]"` 逐个跑：每个 `# pass 1 / # fail 0`，exit 0 |

§4.1 的根因本轮改用「临时根里把 `ci.yml` 归一化成 LF 再跑 `check-ci`」复核（全程不碰仓库文件）：
`node scripts/check-ci.mjs --root <tmp>` → `check-ci: ok`。即失败只由 `core.autocrlf=true` 的检出换行引起，
与 `ci.yml` 内容、与本任务实现都无关。

范围：本轮只重写了本文件；`git status --porcelain` 里落在写域外的只有 `.collab/tasks/002/` 编排产物。

## 8. r3：两个阻塞点的最小修复

r3 的用户输入把 `scripts/check-ci.mjs`、`test/unit/traceability.test.mjs`、`.gitattributes` 扩进写域，
并要求「只应用已识别的两处一行修复、不改其它文件」。因此本轮只改前两个文件，各一行；`.gitattributes`
**没有创建**：`check-ci` 在比较前已自行归一化 CRLF，再加仓库级 `eol` 策略会改到全仓文件的检出行为，
超出「两处一行修复」的授权范围，也会给其它任务的冻结哈希引入无关噪声。

### 8.1 `scripts/check-ci.mjs:80` — 比较前归一化 CRLF

- 改法：`if (actual !== expected)` → `if (actual.replace(/\r\n/g, '\n') !== expected.replace(/\r\n/g, '\n'))`。
- 为什么：本机 `core.autocrlf=true`，`.github/workflows/ci.yml` 检出为 CRLF（57 处），而 `renderCi()`
  产出 LF；两者内容逐字符相同，仅换行不同，于是误报 `ci.stale`，并连锁阻塞 `check-fast`（A-4）与
  `runner-selftest` 的 `[AC-002] check-ci accepts the committed workflow`。
- 边界：只放宽换行差异，任何实际内容差异仍然报 `ci.stale`；`ci.matrix_invalid` / `ci.missing` /
  `ci.perf_blocking` 判定完全未动；CLI 参数与退出码未动。

### 8.2 `test/unit/traceability.test.mjs:158` — 样例 AC 换成 AC-006

- 改法：`assert.equal(merged.acs['AC-005'], 'planned')` → `assert.equal(merged.acs['AC-006'], 'planned')`。
- 为什么：该用例（AC-004「没有分片的 AC 视为 planned」）原先拿 AC-005 当样例；本任务按 design §7 /
  验收 E-1 提交 `test/traceability/T-002.json` 把 AC-005 标成 `covered` 后，断言必然变红。AC-006 在
  `contracts/spec/ac-index.json` 中存在且不被任何分片（`T-001.json`、`T-002.json`）声明，因此仍是
  「无分片」的合法样例。
- 边界：只换样例常量，不改 `mergeShards`、不改同一用例里已 covered 的三条断言、不改其它用例。

### 8.3 r3 全量验收实测（Windows，Node v22）

| 项 | 命令 | 实测 |
|---|---|---|
| A-1 | `node scripts/run-tests.mjs --ac AC-005` | exit 0，`run-tests: filtered 12 files`，31 tests / 31 pass / 0 fail，无 `FAIL`/`✖` |
| A-2 | `node scripts/check-frozen-files.mjs` | exit 0，`check-frozen-files: ok (8 files)` |
| A-3 | `node scripts/check-defects.mjs` | exit 0，`check-defects: ok`（严格模式，11 条 canary 全命中） |
| A-4 | `node scripts/check-fast.mjs` | exit 0，含 `==> check-ci.mjs`、`==> check-defects.mjs`、`==> check-frozen-files.mjs`、`==> npm test`，末行 `check-fast: ok` |
| A-5 | `node scripts/run-tests.mjs` | exit 0，`run-tests: full 17 files`，69 tests / 69 pass / 0 fail；含 `[repro] 0.1 has no test script` 与 10 条 `[repro] [AC-005]` |
| B-1 | 7 个 blob 逐字节对比 | `ok 7` |
| B-2 | frozen-files 形状 | `ok 8` |
| B-3 | 篡改一个登记字节（临时根） | `FAIL frozen.hash_mismatch .../v0.1/lib/select.mjs` + `FAILED (1 errors)`，exit 1 |
| B-4 | 登记 lib/bin/config/scripts（临时根） | 3×`frozen.forbidden_path` + `FAIL frozen.outside_allowed scripts/run-tests.mjs` + `FAILED (4 errors)`，exit 1 |
| B-5 | 副本多一个未登记文件（临时根） | `FAIL frozen.unregistered .../v0.1/README.md`，exit 1 |
| B-6 | `--bogus` | exit 2 |
| C-1 | 相对 import 全指向副本 | `ok 2` |
| C-2 | 改坏副本 `reason: 'excluded'`（临时根） | `not ok 4 - [AC-005] stable: exclude wins and reports excluded`，fail 1 |
| D-1 / D-2 / D-3 | 账本 / canary / `[repro]` 分离 | `ok 11` / `ok` / `ok 10` |
| D-4 | 篡改 `[repro]` 段（临时根，`--strict`） | 含 `FAIL defects.repro_changed a5-dup-call`，exit 1 |
| D-5 | canary 覆盖文件换回 0.1 原文 | 含 `FAIL defects.canary_survived a5-dup-call`，无其它 `canary_survived`，exit 1 |
| D-6 | 删掉 `canary/a4-paths` | 含 `FAIL defects.canary_missing a4-paths`，exit 1 |
| D-7 | `node --test test/unit/milestone-gate.test.mjs` | 6 tests / 6 pass / 0 fail |
| E-1 | `check-traceability` + T-002 形状 | `check-traceability: ok (covered=6 planned=68)`、`ok` |
| E-3 | 无第三方依赖 | `ok` |
| F | 11 个 repro 逐个 `--test-name-pattern="\[repro\]"` | 每条 exit 0、`# pass 1 / # fail 0`（含 a3-runner） |

E-2（`git diff` / `git status` 的写域核对）由编排侧执行：本轮只写了 `scripts/check-ci.mjs`、
`test/unit/traceability.test.mjs` 两个文件与本文件，未触碰 `brief.md` / `design.md` / `acceptance.md` /
`review*` / `verdict*` / `state.json` / `run.json`。（r4 起 `acceptance.md` 按编排指令重写，见 §9。）

D-4/D-5/D-6 仍会出现一条 `FAIL defects.repro_baseline_failed a3-runner`：临时根按要求只复制
`test/` + `contracts/`，a3-runner 的 repro 依赖 `../../../scripts/run-tests.mjs` 因而无法加载。
验收判据只要求出现目标行、且 D-5 不得有其它 `canary_survived`，均满足；真实仓库（A-3）无此噪声。

## 9. r4：按 `ci-runner.ps1` 的解析规则重写 acceptance.md

本轮交付物代码零改动，只处理 CI 报的「exit 2 / 零命令 / 未写 ci-results.json」。

### 9.1 根因

`ci-runner.ps1` 只把匹配
`^#{2,4}\s+((?:AC-?\d+)|(?:[A-Z]{1,3}\d+)|(?:\d+(?:\.\d+)*))\b...` 的标题当作用例：编号必须是
`AC-005`、`A1`、`B3`、`0`、`1` 这类形态。旧稿的标题是 `## A. 总入口` 与 `### A-1 过滤运行 AC-005`，
`A` 后面没有数字、`A-1` 的连字符也不被允许，因此**一个用例都没被解析出来**，脚本在
`no runnable cases parsed` 处 `exit 2`，`run.json` 里 `commands: []`、`passed/total: null`。

### 9.2 改法（内容不变，只改可被解析的形态）

- 结构对齐 T-001：组标题 `## 1. 总入口` … `## 6. 各缺陷 repro 的实质内容`，用例标题
  `### A1`、`### A2` … `### B1` … `### C1`、`### D1` … `### E1` … `### F1`。编号字母 + 数字，
  与旧稿 `A-1`/`B-3`/`D-4` 的对应关系是组内顺序（A 组 5 条、B 组 6 条、C 组 2 条、D 组 7 条、
  E 组 3 条、F 组 2 条，共 25 条）。
- 每个用例只留一个 ```powershell 块：runner 只取标题下第一个代码块，首行即命令，其余同块内容
  顺序执行；断言改成紧随其后的项目符号，不再出现「期望输出」代码块（runner 会把任何代码块当命令）。
- 脚本自包含：不依赖 §0 定义的 `Run`/`NewTmp`（runner 为每个用例另起一个 `pwsh -File` 进程，
  前一条定义的函数不可见）。全部断言成立时打印 `<编号> OK` 并 `exit 0`，否则 `throw`（非 0 退出）。
  runner 的判定是「输出含 `<编号> OK` 且退出码 0」，因此 marker 与退出码都真实反映断言结果。
- 两处 PowerShell 陷阱：`"… $code: …"` 里的 `$code:` 会被当成 scope/drive 限定符而报「变量引用
  无效」，改成 `${code}:`；E-2 的 write_scope 正则补上 task-graph（8af0141）为本任务追加的
  `scripts/check-ci.mjs`、`test/unit/traceability.test.mjs` 以及 `.collab/blueprint/cliworker-v2/task-graph.json`。

### 9.3 自测

用真实 runner 本地跑（输出到临时目录，不写仓库）：

```
pwsh -NoProfile -File <tools>/ci-runner.ps1 -RepoRoot <repo> -TaskDir .collab\tasks\002 -OutFile <temp>.json
```

| 轮次 | 结果 |
|---|---|
| 首轮 | 25 条全部解析出来，18 PASS / 7 FAIL；7 条都是 `$code:` 的 PowerShell 解析错误 |
| 修 `$code:` 后 | **25/25 PASS，runner exit 0**（A1–A5、B1–B6、C1–C2、D1–D7、E1–E3、F1–F2） |

`node scripts/run-tests.mjs --ac AC-005` 复核仍为 `run-tests: filtered 12 files`、31/31 pass；
`check-frozen-files: ok (8 files)`、`check-defects: ok`、`check-fast: ok` 均未受影响。

