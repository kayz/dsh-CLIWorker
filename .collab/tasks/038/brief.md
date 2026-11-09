# Task 038 — AC-038 真机冒烟：WSL 内 Node 与 CLI 探测

## 目标

`AC-038` 要求真实的 `wsl-discover` 通过，但当前 `scripts/smoke-real.mjs` 只报告 `WSL requires Node 20 or later`（本机 WSL 内无 Node）。本任务让冒烟脚本**先探测 WSL 前置条件**（发行版列表、发行版内 `node` 是否存在且满足版本、是否有可发现的 CLI），并把这组探测结果作为独立可断言的部分暴露出来：

- 前置满足 → 真实产出 `wsl:<distro>` 条目并断言解码无损
- 前置不满足 → 明确 `fail` 并给出具体原因（**不得 skip**），整体退出码非 0

可观察结果：在没有 Node 的 WSL 上，脚本明确报 fail 与原因；在有 Node 的 WSL 上，产出 `wsl:<distro>` 条目且名称解码正确。

## 约束

- 写域：`scripts/smoke-real.mjs`、`test/integration/wsl-smoke-preflight.test.mjs`、`docs/release-checklist.md`
- **不要修改** `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`
- 不得把缺失前置条件当作 pass；不得用 Windows 侧 Node 冒充 WSL 内 Node
- 不放宽既有断言

## 建议验收方向

AC-081（integration）：前置探测的三种结果（满足 / 无 Node / 无 WSL）各自可判定；无 Node 时是 fail 而非 skip；满足时产出 `wsl:<distro>` 且名称无 BOM/NUL/CRLF 残留。测试用夹具驱动，不依赖本机真实 WSL。

## 非目标

不在 WSL 内安装 Node（属于环境准备，不是代码交付）

## 验收格式

- 每个 AC 一个二级标题：`## AC-<三位数字> <标题>`；同一 AC 的多条检查放进同一小节
- 小节内必须包含可执行命令：`- 命令:` 行，或 ```pwsh 代码块
- 命令成功时必须在 stdout 打印 `<AC-id> OK` 作为哨兵
- 判据只断言可观察结果（退出码 / stdout 子串 / 文件状态），不要断言测试标题、函数名、行号
- 额外保留一条回归门禁：`node --test "test/unit/*.test.mjs"` 全绿

自检：`node scripts/check-acceptance.mjs .collab/tasks/<NNN>/acceptance.md`
