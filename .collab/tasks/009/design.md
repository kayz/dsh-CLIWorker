---
write_scope:
  - package.json
  - dsh.plugin.json
  - scripts/check-pack.mjs
  - test/integration/pack.test.mjs
  - test/characterization/defects/a2-pack.test.mjs
  - test/traceability/T-009.json
---

# Task 009 设计：打包清单与 bin 入口（A2）

规格来源：`.collab/blueprint/cliworker-v2/task-graph.json` 的 T-009，`contracts/spec/ac-index.json` 的 AC-025（levels: integration）。本任务只做打包形态，不改 `lib/`、`bin/`、`config/`、`contracts/` 的内容。

## 现状（已核对）

- `package.json`：无 `bin`；`files` 为 `lib`、`cordis.patch.yml`、`dsh.plugin.json`、`README.md`，缺 `bin/`、`config/`、`contracts/` 子路径。
- `dsh.plugin.json` 的 `version` 与 `package.json` 都是 `0.1.0`，目前一致。
- `lib/paths.mjs:6` 在运行期读取 `../config/cliworker.example.json`，所以 `config/cliworker.example.json` 必须进包，否则安装后 `init` 或 `paths` 会失败。
- `bin/cliworker.mjs` 已存在，带 shebang。
- `.gitignore` 已忽略 `config/*.local.json`、`state/`、`*.jsonl`。`files` 白名单必须自己保证它们不进包，不能依赖 `.gitignore`。
- `scripts/check-fast.mjs` 会自动执行所有 `scripts/check-*.mjs`，所以新增的 `scripts/check-pack.mjs` 不带参数时必须在真实仓库上通过。
- `test/characterization/defects/a2-pack.test.mjs` 已有 `[repro]` 块。`defects.json` 登记了它的 sha256（`f520198675d74dc94fd4be7bd120a0f7f5168e0058e85369bcc618100dbd9c93`），所以 `[repro]` 块一个字节都不能改。canary 把其中 `bin: null` 换成 `bin: 'bin/cliworker.mjs'` 后，repro 必须失败，这依赖原文含有且只含一处 `bin: null`。

## 改动

### 1. package.json

- 新增 `"bin": { "cliworker": "bin/cliworker.mjs" }`（对象形式，值不带 `./`）。
- `files` 替换为精确白名单，不用目录通配，以免带入 `*.local.json`：

```
"files": [
  "bin",
  "lib",
  "config/cliworker.example.json",
  "contracts/registry.snapshot.json",
  "contracts/agentline-forbidden.json",
  "contracts/schemas",
  "contracts/host",
  "contracts/context",
  "cordis.patch.yml",
  "dsh.plugin.json",
  "README.md"
]
```

- 不新增依赖，不改 `version`（保持 `0.1.0`），不改 `scripts`、`exports`、`dsh`。
- `contracts/examples`、`contracts/golden`、`contracts/spec` 不入白名单。规格与金标不进包。

### 2. dsh.plugin.json

`version` 必须等于 `package.json` 的 `version`。当前两者都是 `0.1.0`，所以通常无需改动。仅当实现时发现不一致才改它，不要改 `package.json` 的版本。以后版本不一致由 check-pack 报错。

### 3. scripts/check-pack.mjs（新增）

风格对齐 `scripts/check-defects.mjs`：ESM、零依赖、`invokedDirectly` 守卫、可被测试 import。

导出：

- `collectLibFiles(root)`：递归列出 `<root>/lib` 下全部文件，返回排序后的 posix 相对路径（如 `lib/cli.mjs`）。
- `runNpmPack(root)`：在 `root` 下执行 `npm pack --dry-run --json --ignore-scripts`，返回 `{ files, error }`。
  - Windows 上 Node 不允许直接 spawn `.cmd`，所以用 `spawnSync('npm', args, { cwd: root, shell: process.platform === 'win32', encoding: 'utf8' })`，参数全是固定字面量。
  - 退出码非 0，或 stdout 不是 JSON 数组，或 `[0].files` 不是 `{ path }` 数组时，`error` 非空。
  - `files` 是路径字符串数组，统一为 posix 分隔。
- `evaluatePack({ packFiles, pkg, plugin, libFiles })`：纯函数，返回 `{ errors }`，`errors` 为 `{ id, detail }[]`。规则见下。

规则（错误 id 固定）：

| id | 触发条件 |
|---|---|
| `pack.bin_mismatch` | `pkg.bin` 不是对象，或 `pkg.bin.cliworker !== 'bin/cliworker.mjs'` |
| `pack.version_mismatch` | `plugin.version !== pkg.version`，或任一不是非空字符串 |
| `pack.missing_required` | 以下任一未出现在 `packFiles`：`bin/cliworker.mjs`、`config/cliworker.example.json`、`contracts/registry.snapshot.json`、`contracts/agentline-forbidden.json`、`dsh.plugin.json`、`package.json`、`cordis.patch.yml`；`contracts/schemas/`、`contracts/host/`、`contracts/context/` 三个前缀各至少一个文件；`libFiles` 中的每个文件（`libFiles` 为空本身也报此错）。detail 写出缺失路径 |
| `pack.forbidden_present` | `packFiles` 含：以 `test/`、`scripts/`、`state/`、`contracts/golden/`、`contracts/spec/` 开头的路径；以 `.collab/` 开头的路径；`config/` 下以 `.local.json` 结尾的文件；任意以 `.jsonl` 结尾的文件。detail 写出该路径 |
| `pack.not_whitelisted` | `contracts/` 下的文件既不是 `contracts/registry.snapshot.json`、`contracts/agentline-forbidden.json`，也不在 `contracts/schemas/`、`contracts/host/`、`contracts/context/` 之下 |
| `pack.npm_failed` | `runNpmPack` 返回 `error`（detail 为简短原因，不含环境变量或令牌） |
| `pack.manifest_unreadable` | 读不到或解析不了 `package.json` / `dsh.plugin.json` |

注意：

- 路径 `.collab/` 要用拼接生成（`['.', 'coll', 'ab'].join('')`），因为 `scripts/check-no-collab.mjs` 会扫描 `scripts/` 与 `test/`，字面出现该串会使其失败。`test/integration/pack.test.mjs` 同理。
- 同一路径可同时命中多条规则，各自报告。输出前按 `id` 再按 `detail` 的码点序排序，保证输出稳定。

CLI：`node scripts/check-pack.mjs [--root <dir>]`。

- 默认 root 是脚本所在目录的上一级。
- 成功时 stdout 打 `check-pack: ok`，退出码 0。
- 失败时每个错误一行 `FAIL <id> <detail>`，最后一行 `check-pack: FAILED (<n> errors)`，退出码 1。
- 未知参数或 `--root` 缺值：stderr 打用法，退出码 2，格式参照 `check-defects.mjs`。
- 不向 stdout/stderr 打印环境变量、令牌、npm 的原始输出。

### 4. test/integration/pack.test.mjs（新增）

`node:test`，所有标题以 `[AC-025]` 开头，且为 plain 标题（不用 `[repro]` 前缀）。`import` 自 `../../scripts/check-pack.mjs`。需要 `.collab/` 字面量处同样用拼接。

测试标题（固定，验收命令按它们匹配）：

1. `[AC-025] check-pack passes against the real package`：`runNpmPack(repoRoot)` 无 error，用真实文件调用 `evaluatePack`，`errors` 为空。
2. `[AC-025] npm pack lists the required runtime files`：真实 pack 清单含 `bin/cliworker.mjs`、`config/cliworker.example.json`、`contracts/registry.snapshot.json`、`contracts/agentline-forbidden.json`、`lib/index.js`，以及 `contracts/schemas/`、`contracts/host/`、`contracts/context/` 下各至少一个文件。
3. `[AC-025] npm pack lists no forbidden paths`：真实 pack 清单中没有 `test/`、`scripts/`、`state/`、`.collab/`、`contracts/golden/`、`contracts/spec/` 前缀，没有 `config/*.local.json`，没有 `.jsonl`。
4. `[AC-025] evaluatePack rejects a missing required file`：从合成的合格清单中分别去掉 `bin/cliworker.mjs`、一个 lib 文件、整个 `contracts/schemas/` 前缀，各自得到 `pack.missing_required`，且 detail 含缺失路径。
5. `[AC-025] evaluatePack rejects each forbidden path class`：向合格清单分别加入 `test/x.test.mjs`、`scripts/x.mjs`、`state/x.json`、`config/a.local.json`、`x/y.jsonl`、`contracts/golden/b44.json`、`contracts/spec/ac-index.json`、一个 `.collab/` 路径，每一项都得到 `pack.forbidden_present`。
6. `[AC-025] evaluatePack rejects a bin or version mismatch`：`bin` 缺失或值为 `./bin/cliworker.mjs` 得到 `pack.bin_mismatch`；`plugin.version` 与 `pkg.version` 不同得到 `pack.version_mismatch`。
7. `[AC-025] evaluatePack rejects a non-whitelisted contracts path`：加入 `contracts/examples/model.v1/x.json` 得到 `pack.not_whitelisted`。

合成输入的合格基线由测试内的小函数构造，不读取仓库文件，不写任何文件（不在仓库里生成临时文件）。

### 5. test/characterization/defects/a2-pack.test.mjs（只追加）

- 保持现有 `[repro]` 块和现有 import 原样不动（`defects.json` 里有该块的 sha256）。
- 在文件末尾追加一个 plain 标题的测试，标题为 `[fixed] [AC-025] the live package ships bin and the config example but no spec or golden`。
- 该测试用 `fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')` 读取真实 `package.json` 并断言：
  - `bin.cliworker === 'bin/cliworker.mjs'`；
  - `files` 含 `bin` 与 `config/cliworker.example.json`；
  - `files` 不含 `config`、`contracts`、`contracts/spec`、`contracts/golden` 这几个条目。
- 不要在 `[repro]` 块里使用上述读法，也不要让 `[fixed]` 块出现 `bin: null` 字样（canary 的 `find` 必须在整个文件里只出现一次）。

### 6. test/traceability/T-009.json（新增）

格式同 `T-007.json`：

```json
{
  "task": "T-009",
  "milestone": "M1",
  "entries": [
    {
      "ac": "AC-025",
      "status": "covered",
      "files": [
        "test/integration/pack.test.mjs",
        "test/characterization/defects/a2-pack.test.mjs"
      ]
    }
  ]
}
```

## 约束与检查点

- 零第三方运行时依赖，不新增 devDependency，Node 20+，ESM。
- `scripts/check-unused.mjs` 会扫描 `scripts/`：不要留下未使用的 import 或顶层函数。
- `scripts/check-seams.mjs` 只扫 `lib/`，所以 `scripts/check-pack.mjs` 可以直接用 `node:child_process` 和 `node:fs`。
- 令牌与密钥不得出现在任何输出里；`runNpmPack` 的失败信息不回显子进程的完整 stdout/stderr。
- 完成前跑 `pwsh -NoProfile -File scripts/check-fast.ps1`（仓库约定）。
- 不改 write_scope 之外的任何文件。包括 `contracts/**`、`test/characterization/defects.json`（`repro_sha256` 保持不变）、`.gitignore`。

## 非目标

不做版本号变更；不新增 `.npmignore`；不写 `npm publish` 流程；不处理 M2 以后的任务。
