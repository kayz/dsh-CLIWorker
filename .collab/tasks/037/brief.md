# Task 037 — discover 覆盖 11 个已知 CLI 的契约清单

## 目标

`cliworker discover` 目前只识别 `claude` 一个 CLI（`lib/discovery/rules.mjs` 只有一条规则）。本任务把已知的 11 个 CLI 都纳入可判定识别：给定 PATH 中存在的可执行文件，discover 能产出该 CLI 的键、provider、版本证据与身份档位；未识别的可执行文件不得进入 `entries`。

可观察结果：准备一个只含若干假可执行文件的 PATH，运行 discover，输出里对应条目齐全、键稳定、身份档位符合证据强度；未知可执行文件不出现。

## 约束

- 写域：`lib/discovery/rules.mjs`、`lib/discovery/scan.mjs`、`test/integration/discovery-rules.test.mjs`、`test/fixtures/discovery/**`
- **不要修改** `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`、`lib/catalog.mjs`
- 识别规则必须来自配置/契约数据，不得在代码里硬编码模型清单（`check-no-model-table` 会失败）
- 不放宽既有断言；`lib/` 下禁止 `process.exit`

## 建议验收方向

AC-080（integration）：11 个已知 CLI 各自可被识别；未知可执行文件不进入 entries；条目字段（键/provider/identity/version 证据）稳定可断言。测试用 `test/fixtures/discovery/**` 下的假可执行文件，不发起真实网络。

## 非目标

不实现真实版本协商、不实现 WSL 内发现（属 T-016/T-038）

## 验收格式

- 每个 AC 一个二级标题：`## AC-<三位数字> <标题>`；同一 AC 的多条检查放进同一小节
- 小节内必须包含可执行命令：`- 命令:` 行，或 ```pwsh 代码块
- 命令成功时必须在 stdout 打印 `<AC-id> OK` 作为哨兵
- 判据只断言可观察结果（退出码 / stdout 子串 / 文件状态），不要断言测试标题、函数名、行号
- 额外保留一条回归门禁：`node --test "test/unit/*.test.mjs"` 全绿

自检：`node scripts/check-acceptance.mjs .collab/tasks/<NNN>/acceptance.md`
