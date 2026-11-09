# Task 044 评审 — UI 资产随 npm 包分发

- 评审 git sha：`7f986fab8e863bb209d4e2c3a2bfe3002158e14e`（task/044，由 `.git` 元数据文件读取；未执行 git）
- 结论：**pass**，AC 通过 1/1
- 执行证据：`ci-results.json`（ranAt 2026-11-09T15:38:02+08:00，AC-087 `passed: true`，exitCode 0，lastLine `AC-087 OK`）

## AC-087 UI 资产分发的 unit 与清单契约 — 通过

逐项核对（只读，对照 design.md / acceptance.md）：

1. **package.json**（`package.json:25-39`）：`files` 保留 bin、lib、config、contracts 四项、cordis.patch.yml、dsh.plugin.json、README.md，仅追加 `ui/**`（:37）与 `docs/ui/cliworker-console.html`（:38）。未用 `docs/**`，未发布 scripts/test。其余字段（版本、main、exports、bin、scripts）未变。
2. **scripts/check-package-contents.mjs**
   - `--root` 约定：缺值、未知参数、以 `--` 开头的值均非零退出（:77-82）；根目录不可读时 npm 启动失败，同样非零。
   - npm 调用（:17-21）：`pack --dry-run --json --ignore-scripts`；`npm_config_offline=true`；使用一次性临时缓存并在 finally 清理；timeout 120000、maxBuffer 16MiB、windowsHide；win32 用 `shell: true`。
   - 失败路径：启动异常、spawn error/超时、非零退出、非法 JSON、非数组、files 缺失、path 非字符串/空/绝对路径/含 `..` 或空段，全部返回 error（:22-45）。输出为 `npm pack ...` 与 `missing package content: <path>`，两类可区分。
   - 内容判定（:61-73）：前缀要求 `file.length > prefix.length`，目录本身和 `ui-old/` 不算命中；逐个断言 ui、bin、lib 源码普通文件在清单内（含嵌套）；HTML 为精确路径。不使用大小、总数或快照。
   - 导入无副作用：`main` 仅在直接执行时运行（:104-106）；成功哨兵仅在零错误时输出（:101）。
   - 复用方式：自带 `runNpmPack`，未修改 `check-pack.mjs`，符合约束。
3. **test/unit/package-contents.test.mjs**：三个 `[AC-087]` 用例，无 skip/todo/only。
   - 纯清单边界（:17-25）：任一必需项缺失、相似前缀、仅缺嵌套资产、额外条目通过、源码为空。
   - npm 失败 seam（:27-49）：启动异常、ENOENT、ETIMEDOUT、非零退出、非法 JSON、`[]`、`[{}]`、空/缺 path、`ui/`、`..`，并断言离线、`--ignore-scripts`、timeout、maxBuffer、windowsHide，以及反斜杠规范化。全程不联网。
   - 真实契约（:51-105）：真实 dry-run 清单加生产检查器；临时副本加嵌套 UI 文件仍通过；移除 `ui/**` 后由实际清单证明 `ui/` 消失，检查器非零、无哨兵、诊断含 `ui/`；分别删除 HTML、bin、lib 后同样如此；真实 package.json 字节未变；临时目录 finally 清理。检查器用绝对路径，并配 `--root` 与独立 cwd。
4. **docs/release-checklist.md**：已有「包内容检查」节，含 `node scripts/check-package-contents.mjs`、`AC-087 OK`、基于 dry-run 清单、强制离线、禁止生命周期脚本、不发布、四类资产要求、缺失时修复 `files` 或资产后重跑，并声明不替代生成资产检查与 real-smoke。既有生成资产检查节仍在。
5. **与旧检查器兼容**：`check-pack.mjs` 的 `FORBIDDEN_PREFIXES`（:27）仅含 test/、scripts/、state/、contracts/golden/、contracts/spec/，不涉及 `ui/`、`docs/`；`ui/` 与 `docs/ui/` 下文件（app.mjs、index.html、render.mjs、cliworker-console.html）不含 `.jsonl` 或 `.local.json`，不会触发禁入规则。`check-fast.mjs` 按 `scripts/check-*.mjs` 自动发现新检查器。
6. **范围**：未发现对 lib/cli.mjs、routes.mjs、context.mjs、ui/** 的修改迹象（评审环境无 git，凭文件内容与 impl.md 判断）。

## 备注（非阻塞）

- `ci-results.json` 只记录 AC-087 一项合并结果，耗时 1.6s、输出仅 `AC-087 OK`，应为该节首条生产检查命令的结果。其余命令块（独立反例、`node --test`、`check-fast.ps1`）没有逐条执行记录。我按只读方式静态核对了这些块对应的实现与测试，逻辑与规格一致，未发现矛盾。impl.md 自述 `node --test` 三项通过、独立反例通过，但未运行完整 `check-fast.ps1`。该完整门禁应由下游发布门禁执行，不作为本轮 needs_revision 理由。
- 轻微：`check-package-contents.mjs` 的 `--root` 值若恰好以 `--` 开头会被拒绝。对本检查器可接受。

## Findings

无 P0/P1/P2 级问题。
