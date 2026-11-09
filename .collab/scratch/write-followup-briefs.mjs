import fs from 'node:fs'
import path from 'node:path'

const root = 'C:\\git\\dsh-CLIWorker'

const FORMAT = `
## 验收格式

- 每个 AC 一个二级标题：\`## AC-<三位数字> <标题>\`；同一 AC 的多条检查放进同一小节
- 小节内必须包含可执行命令：\`- 命令:\` 行，或 \`\`\`pwsh 代码块
- 命令成功时必须在 stdout 打印 \`<AC-id> OK\` 作为哨兵
- 判据只断言可观察结果（退出码 / stdout 子串 / 文件状态），不要断言测试标题、函数名、行号
- 额外保留一条回归门禁：\`node --test "test/unit/*.test.mjs"\` 全绿

自检：\`node scripts/check-acceptance.mjs .collab/tasks/<NNN>/acceptance.md\`
`

const COMMON = `
## 约束

- **不要修改** \`lib/cli.mjs\`、\`lib/routes.mjs\`、\`lib/context.mjs\`（注册表已就绪，新增命令靠 \`export const route\` 自注册）
- 不得放宽或删除任何既有断言；\`lib/\` 下禁止 \`process.exit\`
- 不得把 \`skipped\` 折算为通过
- 写域严格限定在下方列出的路径
`

const briefs = {
  '037': `# Task 037 — discover 覆盖 11 个已知 CLI 的契约清单

## 目标

\`cliworker discover\` 目前只识别 \`claude\` 一个 CLI（\`lib/discovery/rules.mjs\` 只有一条规则）。本任务把已知的 11 个 CLI 都纳入可判定识别：给定 PATH 中存在的可执行文件，discover 能产出该 CLI 的键、provider、版本证据与身份档位；未识别的可执行文件不得进入 \`entries\`。

可观察结果：准备一个只含若干假可执行文件的 PATH，运行 discover，输出里对应条目齐全、键稳定、身份档位符合证据强度；未知可执行文件不出现。

## 约束

- 写域：\`lib/discovery/rules.mjs\`、\`lib/discovery/scan.mjs\`、\`test/integration/discovery-rules.test.mjs\`、\`test/fixtures/discovery/**\`
- **不要修改** \`lib/cli.mjs\`、\`lib/routes.mjs\`、\`lib/context.mjs\`、\`lib/catalog.mjs\`
- 识别规则必须来自配置/契约数据，不得在代码里硬编码模型清单（\`check-no-model-table\` 会失败）
- 不放宽既有断言；\`lib/\` 下禁止 \`process.exit\`

## 建议验收方向

AC-080（integration）：11 个已知 CLI 各自可被识别；未知可执行文件不进入 entries；条目字段（键/provider/identity/version 证据）稳定可断言。测试用 \`test/fixtures/discovery/**\` 下的假可执行文件，不发起真实网络。

## 非目标

不实现真实版本协商、不实现 WSL 内发现（属 T-016/T-038）
${FORMAT}`,

  '038': `# Task 038 — AC-038 真机冒烟：WSL 内 Node 与 CLI 探测

## 目标

\`AC-038\` 要求真实的 \`wsl-discover\` 通过，但当前 \`scripts/smoke-real.mjs\` 只报告 \`WSL requires Node 20 or later\`（本机 WSL 内无 Node）。本任务让冒烟脚本**先探测 WSL 前置条件**（发行版列表、发行版内 \`node\` 是否存在且满足版本、是否有可发现的 CLI），并把这组探测结果作为独立可断言的部分暴露出来：

- 前置满足 → 真实产出 \`wsl:<distro>\` 条目并断言解码无损
- 前置不满足 → 明确 \`fail\` 并给出具体原因（**不得 skip**），整体退出码非 0

可观察结果：在没有 Node 的 WSL 上，脚本明确报 fail 与原因；在有 Node 的 WSL 上，产出 \`wsl:<distro>\` 条目且名称解码正确。

## 约束

- 写域：\`scripts/smoke-real.mjs\`、\`test/integration/wsl-smoke-preflight.test.mjs\`、\`docs/release-checklist.md\`
- **不要修改** \`lib/cli.mjs\`、\`lib/routes.mjs\`、\`lib/context.mjs\`
- 不得把缺失前置条件当作 pass；不得用 Windows 侧 Node 冒充 WSL 内 Node
- 不放宽既有断言

## 建议验收方向

AC-081（integration）：前置探测的三种结果（满足 / 无 Node / 无 WSL）各自可判定；无 Node 时是 fail 而非 skip；满足时产出 \`wsl:<distro>\` 且名称无 BOM/NUL/CRLF 残留。测试用夹具驱动，不依赖本机真实 WSL。

## 非目标

不在 WSL 内安装 Node（属于环境准备，不是代码交付）
${FORMAT}`,

  '039': `# Task 039 — discover 补 flow 步骤

## 目标

\`test/flows/steps/\` 下有 auth/doctor/enumerate/probe/select/run/http-* 八个步骤，但**没有 discover 步骤**，因此 flow 的端到端链路不覆盖发现层。本任务补上该步骤，让 \`runFlow\` 真实调用 discover 并断言产物。

可观察结果：flow 跑起来时 discover 步骤被执行且通过；它产出的 \`inventory.json\` 与 CLI stdout 同源（\`generated_at\` 一致）。

## 约束

- 写域：\`test/flows/steps/discover.mjs\`、\`test/flows/flow.test.mjs\`、\`test/traceability/T-039.json\`
- **不要修改** \`lib/\` 下任何文件（本任务只补测试基础设施）
- 共享 flow fixture 是 legacy \`cliworker.config/v1\`；若 discover 需要 v2 配置，请参照 \`test/flows/steps/enumerate.mjs\` 的做法在 \`flow.root\` 下写自己的 v2 配置，**不要**改共享 fixture
- 不放宽既有断言

## 建议验收方向

AC-082（integration）：flow 发现并执行 discover 步骤；该步骤在 v2 配置下真实调用 CLI、断言 \`cliworker.inventory/v1\` 与落盘文件同源。\`flow.test.mjs\` 的步骤列表断言改为从磁盘派生（不写死列表）。

## 非目标

不改变 flow 的执行框架本身
${FORMAT}`,

  '040': `# Task 040 — 跨进程写入并发一致性

## 目标

多进程同时写 state 时不得丢更新。今晚修过 \`lib/lock.mjs\` 的回收竞态（曾导致 98/100 租约），但**没有一条专门的多进程写入测试**来守住这个语义。

可观察结果：N 个子进程各自完成一次提交，全部退出码 0 时，最终 state 里的条目数恰好等于 N；任何一次丢失都要被测试抓到。

## 约束

- 写域：\`test/integration/cross-process-write.test.mjs\`、\`test/fixtures/store/**\`、\`test/traceability/T-040.json\`
- **不要修改** \`lib/\` 下任何文件（本任务只加测试资产）；若确实发现实现缺陷，先在报告里写清楚，不要擅自改实现
- 不复用 \`test/integration/store-concurrency.test.mjs\` 的既有用例名，避免重复计数
- 子进程数不少于 20，且断言不得放宽为"大于等于某个比例"

## 建议验收方向

AC-083（integration）：N 进程并发写入后条目数精确等于成功提交数；重复运行多次保持稳定（至少 5 轮无失败）。

## 非目标

不测跨机器并发、不测网络文件系统
${FORMAT}`,
}

for (const [id, body] of Object.entries(briefs)) {
  const dir = path.join(root, '.collab', 'tasks', id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'brief.md'), body, 'utf8')
  console.log('wrote', id, body.split('\n').length, 'lines')
}
