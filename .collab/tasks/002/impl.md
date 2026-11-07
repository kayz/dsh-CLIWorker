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

- 本角色被禁止执行 git 命令，因此副本用「读工作树同路径文件 → 把所有 `\r\n` 换成 `\n` → 写回」生成。
  design §0 已确认工作树的 `lib/`、`config/cliworker.example.json` 与 `f75bb76` 一致；blob 是 LF，
  所以该过程得到的就是 blob 字节（验收 B-1 会用 git 再核一遍）。
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

## 3. 验收自测结果

在本工作树（Windows / Node v22.23.3）逐条执行。B-3–B-6、C-2、D-4–D-6 用 bash 的 `mktemp -d` + `cp -r` 复现
pwsh 脚本的同样步骤（临时目录副本，不动仓库）。

| 项 | 命令 | 结果 |
|---|---|---|
| A-1 | `node scripts/run-tests.mjs --ac AC-005` | 通过：`filtered 12 files`，31 tests / 0 fail，6 条 stable + 15 条 frozen/defects + 10 条 `[repro] [AC-005]` 全 ✔ |
| A-2 | `node scripts/check-frozen-files.mjs` | 通过：`check-frozen-files: ok (8 files)` |
| A-3 | `node scripts/check-defects.mjs` | 通过：`check-defects: ok`（严格模式，11 条 canary 全部命中） |
| A-4 | `node scripts/check-fast.mjs` | **失败**，见 §4.1（停在 `check-ci.mjs`，与本任务无关） |
| A-5 | `node scripts/run-tests.mjs` | **失败 2 条**，见 §4.1、§4.2（69 tests / 67 pass） |
| B-1 | git 对比 7 个 blob | 未执行（本角色禁止 git 命令）；副本由 CRLF→LF 归一化生成，见 §2.1 |
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

## 4. 未通过项与根因

这两项都不在本任务写域内，改动它们会同时破坏 E-2，因此保持原样并在此记录。

### 4.1 check-ci 因 CRLF 检出失败（阻塞 A-4，并使 A-5 少一条）

- 现象：`node scripts/check-ci.mjs` → `FAIL ci.stale .github/workflows/ci.yml is not the current generated output`；
  `check-fast` 在第一步 `check-ci.mjs` 就退出，走不到 `check-defects.mjs` / `check-frozen-files.mjs` / `npm test`。
- 证据：`.github/workflows/ci.yml` 在盘上有 57 个 CRLF、`renderCi()` 生成 0 个 CRLF；把实际文件 CRLF→LF 后与
  生成结果**逐字符相等**（`r === a.replace(/\r\n/g,'\n')` 为 true）。即内容没变，只是 `core.autocrlf=true`
  的检出换行（design §0 也写了本机 autocrlf=true、仓库无 `.gitattributes`）。
- 影响面：与 T-002 无关，`.github/` 与 `scripts/check-ci.mjs` 均未被我改动；同一失败也出现在
  `test/unit/runner-selftest.test.mjs` 的 `[AC-002] check-ci accepts the committed workflow`。
- 已验证该失败之外的 A-4 内容：临时把 `scripts/check-ci.mjs` 移开跑了一次 `check-fast`（随后立刻恢复，
  仓库无残留），输出
  `==> check-defects.mjs` / `==> check-frozen-files.mjs` / `==> check-test-discovery.mjs` /
  `==> check-traceability.mjs` / `==> npm test`，其中 `check-defects: ok`、`check-frozen-files: ok (8 files)`，
  即两个新检查确实被 check-fast 自动纳入并通过。
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
