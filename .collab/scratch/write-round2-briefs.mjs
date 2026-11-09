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

const briefs = {
  '041': `# Task 041 — 生成资产 freshness gate：生成后必须无 diff

## 目标

仓库里有多类"由生成器产出"的资产：\`test/fixtures/release-gate/**\`（42 个夹具 root，内嵌 AC 索引快照）与 \`docs/contract.md\`。它们会随契约变化而过期，但**没有任何检查提醒**。

今晚已经因此踩坑两次：AC 索引从 75 扩到 79 后夹具全部过期，本地因为"重新生成过但没提交"而绿，任何干净 worktree 直接全红。

本任务交付一条 CI 检查：**对每个生成器跑一次生成，断言工作区无 diff**。过期即失败，并指出哪个生成器。

## 约束

- 写域：\`scripts/check-generated-fresh.mjs\`、\`test/unit/check-generated-fresh.test.mjs\`、\`test/fixtures/release-gate/generate.mjs\`、\`docs/release-checklist.md\`
- **不要修改** \`lib/cli.mjs\`、\`lib/routes.mjs\`、\`lib/context.mjs\`、\`contracts/spec/**\`
- 检查必须**在 CI 的安全范围**内：只生成到临时目录或生成后精确回滚，不得让检查本身污染工作区（若生成器只支持就地生成，则必须先在临时副本里跑）
- 不放宽既有断言；不得把失败降级为警告

## 建议验收方向

AC-084（unit + contract）：干净树通过；人为改坏一份夹具后失败且指名生成器；索引变化导致夹具过期时失败。用临时目录构造上述三种场景，不依赖真实生成器的副作用。

## 非目标

不重写各生成器本身
${FORMAT}`,

  '042': `# Task 042 — 真实 CLI 探测接线：discover 版本证据与 probe 可用性

## 目标

T-037 已让 \`discover\` 识别 11 个已知 CLI（产出条目、\`recognized\`、\`auth/evidence\`），但**没有真实版本证据**：\`entry.version\` 为空或占位，\`probe\` 也不会依据真实调用结果更新可用性。

本任务把"真实探测"接通：对已识别的 CLI 调用其版本命令，解析语义化版本写入 \`entry.version\`；调用失败则降级为 \`unverified\` 并记录原因（**不伪造版本**）。\`probe\` 依据该证据更新可用性状态机。

## 约束

- 写域：\`lib/discovery/probe.mjs\`（新建）、\`lib/discovery/scan.mjs\`、\`lib/discovery/rules.mjs\`、\`test/integration/discovery-probe.test.mjs\`、\`test/fixtures/discovery/**\`
- **不要修改** \`lib/cli.mjs\`、\`lib/routes.mjs\`、\`lib/context.mjs\`、\`contracts/schemas/inventory.v1.schema.json\`（条目字段已冻结）
- 版本命令必须来自规则表（数据驱动），不得在代码里硬编码模型清单（\`check-no-model-table\` 会失败）
- 测试用 \`test/fixtures/discovery/**\` 的假可执行文件，**不发起真实网络**；真实 CLI 的探测作为可选真机验证，不进自动验收
- 探测失败要可区分：命令不存在 / 非零退出 / 输出无法解析，三类各自的状态与原因

## 建议验收方向

AC-085（integration）：成功探测写入真实版本；三类失败各自降级为 unverified 且原因可断言；probe 依据证据更新可用性；无证据时不伪造版本。

## 非目标

不做 vendor 专用认证探测、不做用量读取（属后续任务）
${FORMAT}`,

  '043': `# Task 043 — AC-077 问题优先页接真实 CLI 问题源

## 目标

问题优先页（AC-077）现在渲染的是内部数据，不是真实问题。本任务把它接到真实证据上：issues API 从 \`probe\`/\`discover\` 的结果生成条目（不可用、版本不符、凭据缺失等），**无证据时不产生条目**；UI 渲染字段与 API 一致。

## 约束

- 写域：\`lib/http/issues-api.mjs\`、\`lib/http/snapshot.mjs\`、\`test/integration/issues-from-probe.test.mjs\`、\`ui/app.mjs\`、\`ui/render.mjs\`、\`test/fixtures/ui/**\`
- **不要修改** \`lib/cli.mjs\`、\`lib/routes.mjs\`、\`lib/context.mjs\`、\`lib/index.js\`
- **不引入 SSE**：沿用既有 15s 轮询（M5 既定裁决）
- 依赖 T-042 的探测证据；若 T-042 未合并，本任务应如实阻塞而不是自造证据
- 不放宽既有断言；UI 断言只查"字段来自 API 且无伪造条目"

## 建议验收方向

AC-086（integration）：有证据时按类别生成条目（不可用/版本不符/凭据缺失）；无证据时为空；UI 渲染字段与 API 响应一致；伪造的旧静态数据不再出现。

## 非目标

不重做页面视觉、不做 SSE
${FORMAT}`,
}

for (const [id, body] of Object.entries(briefs)) {
  const dir = path.join(root, '.collab', 'tasks', id)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'brief.md'), body, 'utf8')
  console.log('wrote', id, body.split('\n').length, 'lines')
}
