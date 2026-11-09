import fs from 'node:fs'

const root = 'C:\\git\\dsh-CLIWorker'
const idxPath = root + '\\contracts\\spec\\ac-index.json'
const graphPath = root + '\\.collab\\blueprint\\cliworker-v2\\task-graph.json'
const tcPath = root + '\\scripts\\check-traceability.mjs'

const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'))
const newAcs = [
  { ac: 'AC-084', owner: 'T-041', milestone: 'M5', levels: ['unit', 'contract'], baseline: ['darwin', 'linux', 'win32'] },
  { ac: 'AC-085', owner: 'T-042', milestone: 'M3', levels: ['integration'], baseline: ['darwin', 'linux', 'win32'] },
  { ac: 'AC-086', owner: 'T-043', milestone: 'M5', levels: ['integration'], baseline: ['darwin', 'linux', 'win32'] },
]
for (const entry of newAcs) {
  if (!idx.acs.some((row) => row.ac === entry.ac)) idx.acs.push(entry)
}
fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2) + '\n', 'utf8')

let tc = fs.readFileSync(tcPath, 'utf8')
const before = "const extended = [...expected, 'AC-079', 'AC-080', 'AC-081', 'AC-082', 'AC-083']"
const after = "const extended = [...expected, 'AC-079', 'AC-080', 'AC-081', 'AC-082', 'AC-083', 'AC-084', 'AC-085', 'AC-086']"
if (!tc.includes(after)) {
  if (!tc.includes(before)) throw new Error('allowlist anchor not found')
  fs.writeFileSync(tcPath, tc.replace(before, after), 'utf8')
}

const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'))
const tasks = [
  {
    id: 'T-041',
    title: '生成资产 freshness gate：生成后必须无 diff',
    milestone: 'M5',
    inputs: ['test/fixtures/release-gate/generate.mjs', 'contracts/spec/ac-index.json'],
    outputs: ['scripts/check-generated-fresh.mjs', 'test/unit/check-generated-fresh.test.mjs'],
    depends_on: ['T-030'],
    write_scope: [
      'scripts/check-generated-fresh.mjs',
      'test/unit/check-generated-fresh.test.mjs',
      'test/fixtures/release-gate/generate.mjs',
      'docs/release-checklist.md',
    ],
    acceptance: ['AC-084'],
    acceptance_direction: ['node scripts/run-tests.mjs --ac AC-084'],
    test_levels: ['unit', 'contract'],
  },
  {
    id: 'T-042',
    title: '真实 CLI 探测接线：discover 版本证据与 probe 可用性',
    milestone: 'M3',
    inputs: ['T-037 的 CLI 规则表', 'T-020 的可用性状态机', 'lib/discovery/*'],
    outputs: ['lib/discovery/probe.mjs', 'test/integration/discovery-probe.test.mjs'],
    depends_on: ['T-016', 'T-020', 'T-037'],
    write_scope: [
      'lib/discovery/probe.mjs',
      'lib/discovery/scan.mjs',
      'lib/discovery/rules.mjs',
      'test/integration/discovery-probe.test.mjs',
      'test/fixtures/discovery/**',
    ],
    acceptance: ['AC-085'],
    acceptance_direction: ['node scripts/run-tests.mjs --ac AC-085'],
    test_levels: ['integration'],
  },
  {
    id: 'T-043',
    title: 'AC-077 问题优先页接真实 CLI 问题源',
    milestone: 'M5',
    inputs: ['T-025 的问题优先页', 'T-042 的探测结果', 'lib/http/issues-api.mjs'],
    outputs: ['lib/http/issues-api.mjs', 'test/integration/issues-from-probe.test.mjs'],
    depends_on: ['T-025', 'T-042'],
    write_scope: [
      'lib/http/issues-api.mjs',
      'lib/http/snapshot.mjs',
      'test/integration/issues-from-probe.test.mjs',
      'ui/app.mjs',
      'ui/render.mjs',
      'test/fixtures/ui/**',
    ],
    acceptance: ['AC-086'],
    acceptance_direction: ['node scripts/run-tests.mjs --ac AC-086'],
    test_levels: ['integration'],
  },
]
for (const task of tasks) {
  const i = graph.tasks.findIndex((row) => row.id === task.id)
  if (i >= 0) graph.tasks[i] = task
  else graph.tasks.push(task)
}
const texts = [
  ['AC-084', '凡由生成器产出的资产（release-gate 夹具、契约文档）在 CI 中必须"重新生成后无 diff"：脚本对指定生成器跑一次生成并断言工作区无改动；索引或契约变化导致夹具过期时，该检查必须失败。'],
  ['AC-085', 'discover 对已识别 CLI 输出真实版本证据：调用该 CLI 的版本命令并解析语义化版本写入 entry.version；调用失败时降级为 unverified 并记录原因，不伪造版本。probe 依据该证据更新可用性状态。'],
  ['AC-086', '问题优先页由真实探测结果驱动：issues API 从 probe/discover 证据生成条目（不可用、版本不符、凭据缺失等），无证据时不产生条目；UI 渲染字段与 API 一致。'],
]
for (const [id, text] of texts) {
  if (!graph.acceptance.some((row) => row.id === id)) graph.acceptance.push({ id, text, levels: ['integration'] })
}
fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf8')
console.log('index=' + idx.acs.length + ' tasks=' + graph.tasks.length + ' acs=' + graph.acceptance.length)
