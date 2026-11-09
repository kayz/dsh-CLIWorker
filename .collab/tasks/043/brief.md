# Task 043 — AC-077 问题优先页接真实 CLI 问题源

## 目标

问题优先页（AC-077）现在渲染的是内部数据，不是真实问题。本任务把它接到真实证据上：issues API 从 `probe`/`discover` 的结果生成条目（不可用、版本不符、凭据缺失等），**无证据时不产生条目**；UI 渲染字段与 API 一致。

## 约束

- 写域：`lib/http/issues-api.mjs`、`lib/http/snapshot.mjs`、`test/integration/issues-from-probe.test.mjs`、`ui/app.mjs`、`ui/render.mjs`、`test/fixtures/ui/**`
- **不要修改** `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`、`lib/index.js`
- **不引入 SSE**：沿用既有 15s 轮询（M5 既定裁决）
- 依赖 T-042 的探测证据；若 T-042 未合并，本任务应如实阻塞而不是自造证据
- 不放宽既有断言；UI 断言只查"字段来自 API 且无伪造条目"

## 建议验收方向

AC-086（integration）：有证据时按类别生成条目（不可用/版本不符/凭据缺失）；无证据时为空；UI 渲染字段与 API 响应一致；伪造的旧静态数据不再出现。

## 非目标

不重做页面视觉、不做 SSE

## 验收格式

- 每个 AC 一个二级标题：`## AC-<三位数字> <标题>`；同一 AC 的多条检查放进同一小节
- 小节内必须包含可执行命令：`- 命令:` 行，或 ```pwsh 代码块
- 命令成功时必须在 stdout 打印 `<AC-id> OK` 作为哨兵
- 判据只断言可观察结果（退出码 / stdout 子串 / 文件状态），不要断言测试标题、函数名、行号
- 额外保留一条回归门禁：`node --test "test/unit/*.test.mjs"` 全绿

自检：`node scripts/check-acceptance.mjs .collab/tasks/<NNN>/acceptance.md`
