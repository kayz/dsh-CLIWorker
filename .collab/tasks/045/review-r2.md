# Task 045 评审（round 2）

评审基准：HEAD `bb6b81d`（通过读取 `.git` 引用文件得到，未执行 git 命令）。通过 1/1，结论 **pass**。

## 摘要

round 1 的 P1（F1：npm-cli.js 路径写死为 Windows 布局）已修复。其余实现与规格保持一致，没有新增问题。

## F1 复核（已修复）

- `scripts/check-alpha-package.mjs:12-26` 新增导出的 `resolveNpm()`。
  - 候选 1：win32 用 `<node 目录>/node_modules/npm/bin/npm-cli.js`；非 win32 用 `<node 目录>/../lib/node_modules/npm/bin/npm-cli.js`。这与 `scripts/e2e-install.mjs:18` 的做法一致。
  - 候选 2：遍历 PATH 中的绝对目录，win32 找 `node_modules/npm/bin/npm-cli.js`，Unix 找 `npm` 并 `realpathSync`。
  - 要求解析结果的 basename 是 `npm-cli.js` 且为普通文件，否则报 `cannot resolve an installed npm-cli.js`。
  - 在构造隔离环境之后、于 try 内调用（`:52`），失败也会走清理。
- `test/integration/alpha-tarball.test.mjs:8,12` 直接导入 `resolveNpm`，不再自带写死路径。导入检查器不会触发安装：入口守卫在 `check-alpha-package.mjs:110`，只有作为主脚本才运行。
- Unix 路径只做了静态核对，没有在 Unix 上执行。`impl.md` 也如实写了这一点。静态上 ubuntu/macos 的标准 Node 布局会命中候选 1。

## 逐项核对 AC-088

| 要求 | 结论 | 证据 |
|---|---|---|
| 实际 `npm pack`（非 dry-run）并离线安装到仓库外 | 满足 | `check-alpha-package.mjs:36-39,56,64`；`:38` 断言临时父目录不在仓库内 |
| 隔离环境 | 满足 | `:41-43` 最小环境，HOME 等全部指向临时根，npm 缓存与配置隔离，不继承 `CLIWORKER_*` |
| 实际执行 .bin shim；版本与各来源一致 | 满足 | `:65-76`：安装目录为真实目录，shim 存在并被执行，`ok === true`，和 manifest、packed、仓库 package.json 版本比较 |
| doctor / discover 落盘 / models enumerate | 满足 | `:83-85`：status 为 ok 且 checks 全为 ok，inventory detail 为 `not generated`，`inventory.json` 与 stdout 深度相等，models 含夹具 key |
| probe → select → run call → usage → backup/restore | 满足 | `:79,86-93`：假 provider 在临时根内；`nonce_ok`、`probes.json`、`usage.jsonl`；`call` 的 command、config、state-dir、entry 都核对；`start`/`result` 事件、lease_id、usage；marker 恢复为 `before` |
| UI 资产检查 | 满足 | `:94`：四个精确路径均需存在、为普通文件且非空，诊断含 `missing or empty <rel>` |
| 清理失败即失败；入口守卫；哨兵最后输出 | 满足 | `:97-107,110-112` |
| integration 至少两个用例，含 `rejects tarball without ui` | 满足 | 测试 `:30,39`，无 skip/todo/only；`:61-63` 断言非零、无哨兵、stderr 含 `missing or empty ui/` 且不含 `npm install:`；`:56-60` 确认反例仍有 HTML、bin、lib；`:44-47` 校验归档成员路径 |
| 发布清单 | 满足 | `docs/release-checklist.md:11-20`：新命令、`AC-088 OK` 含义、位置参数、清理与失败诊断；保留 AC-087、dry-run、real-smoke 与放行要求；说明不覆盖 WSL/http-select |
| 写域 | 满足 | 三个新增或修改的文件均在 front matter 范围内；`lib/**`、`ui/**`、`package.json` 未改（只读核对，工作区已知改动仅 `.collab/tasks/045/*`） |
| check-fast 自动发现 | 满足 | `scripts/check-fast.mjs:10,86` 按 `check-*.mjs` 发现，并打印 `==> <name>` |

## 执行证据

- `ci-results.json`（ranAt 2026-11-09T17:26，Windows）：AC-088 `passed=true`、exitCode 0、lastLine `AC-088 OK`（4.5s）。我在评审里没有重跑。
- 该文件仍只有一条合并结果，acceptance.md 的第 2 块（integration 两轮）和第 3 块（`check-fast.ps1`）没有各自的执行记录。`impl.md` 自述 integration 已多次通过，但 `check-fast.ps1` 未运行。这两块按静态核对记为符合，不作为已执行证据。

## Findings

- **P2 — F2（延续）：执行证据只有合并的一条。** `check-fast.ps1` 的完整门禁没有独立执行记录，需要编排方在有 pwsh 7 的环境里补跑。这不阻塞本轮通过。
- **P2 — F3（延续）：finally 中安全断言先于 `rmSync`。** 位置是 `scripts/check-alpha-package.mjs:99-102`。断言抛错时，临时根不会被删除，但错误会被 `AggregateError` 与原错误一并报告，而不是被掩盖。这只是边界情况，不阻塞。

## 说明

本轮没有执行 git 命令，没有修改被评审的文件。
