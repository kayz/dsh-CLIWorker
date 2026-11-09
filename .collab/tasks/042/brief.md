# Task 042 — 真实 CLI 探测接线：discover 版本证据与 probe 可用性

## 目标

T-037 已让 `discover` 识别 11 个已知 CLI（产出条目、`recognized`、`auth/evidence`），但**没有真实版本证据**：`entry.version` 为空或占位，`probe` 也不会依据真实调用结果更新可用性。

本任务把"真实探测"接通：对已识别的 CLI 调用其版本命令，解析语义化版本写入 `entry.version`；调用失败则降级为 `unverified` 并记录原因（**不伪造版本**）。`probe` 依据该证据更新可用性状态机。

## 约束

- 写域：`lib/discovery/probe.mjs`（新建）、`lib/discovery/scan.mjs`、`lib/discovery/rules.mjs`、`test/integration/discovery-probe.test.mjs`、`test/fixtures/discovery/**`
- **不要修改** `lib/cli.mjs`、`lib/routes.mjs`、`lib/context.mjs`、`contracts/schemas/inventory.v1.schema.json`（条目字段已冻结）
- 版本命令必须来自规则表（数据驱动），不得在代码里硬编码模型清单（`check-no-model-table` 会失败）
- 测试用 `test/fixtures/discovery/**` 的假可执行文件，**不发起真实网络**；真实 CLI 的探测作为可选真机验证，不进自动验收
- 探测失败要可区分：命令不存在 / 非零退出 / 输出无法解析，三类各自的状态与原因

## 建议验收方向

AC-085（integration）：成功探测写入真实版本；三类失败各自降级为 unverified 且原因可断言；probe 依据证据更新可用性；无证据时不伪造版本。

## 非目标

不做 vendor 专用认证探测、不做用量读取（属后续任务）

## 验收格式

- 每个 AC 一个二级标题：`## AC-<三位数字> <标题>`；同一 AC 的多条检查放进同一小节
- 小节内必须包含可执行命令：`- 命令:` 行，或 ```pwsh 代码块
- 命令成功时必须在 stdout 打印 `<AC-id> OK` 作为哨兵
- 判据只断言可观察结果（退出码 / stdout 子串 / 文件状态），不要断言测试标题、函数名、行号
- 额外保留一条回归门禁：`node --test "test/unit/*.test.mjs"` 全绿

自检：`node scripts/check-acceptance.mjs .collab/tasks/<NNN>/acceptance.md`
