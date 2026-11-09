import fs from 'node:fs'

const root = 'C:\\git\\dsh-CLIWorker'
const idxPath = root + '\\contracts\\spec\\ac-index.json'
const graphPath = root + '\\.collab\\blueprint\\cliworker-v2\\task-graph.json'
const tcPath = root + '\\scripts\\check-traceability.mjs'

const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'))
const added = { ac: 'AC-088', owner: 'T-045', milestone: 'M5', levels: ['integration'], baseline: ['win32'] }
if (!idx.acs.some((row) => row.ac === added.ac)) idx.acs.push(added)
fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2) + '\n', 'utf8')

let tc = fs.readFileSync(tcPath, 'utf8')
const before = "const extended = [...expected, 'AC-079', 'AC-080', 'AC-081', 'AC-082', 'AC-083', 'AC-084', 'AC-085', 'AC-086', 'AC-087']"
const after = "const extended = [...expected, 'AC-079', 'AC-080', 'AC-081', 'AC-082', 'AC-083', 'AC-084', 'AC-085', 'AC-086', 'AC-087', 'AC-088']"
if (!tc.includes(after)) {
  if (!tc.includes(before)) throw new Error('allowlist anchor not found')
  fs.writeFileSync(tcPath, tc.replace(before, after), 'utf8')
}

const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'))
const task = {
  id: 'T-045',
  title: 'alpha 包黑盒验收：以用户视角安装并验证',
  milestone: 'M5',
  inputs: ['npm pack 产出的 dsh-cliworker-<version>.tgz', 'docs/release-checklist.md'],
  outputs: ['test/integration/alpha-tarball.test.mjs', 'scripts/check-alpha-package.mjs'],
  depends_on: ['T-044', 'T-029'],
  write_scope: [
    'test/integration/alpha-tarball.test.mjs',
    'scripts/check-alpha-package.mjs',
    'docs/release-checklist.md',
  ],
  acceptance: ['AC-088'],
  acceptance_direction: ['node scripts/run-tests.mjs --ac AC-088'],
  test_levels: ['integration'],
}
const i = graph.tasks.findIndex((row) => row.id === task.id)
if (i >= 0) graph.tasks[i] = task
else graph.tasks.push(task)
const text = 'alpha 包黑盒可用：把 npm pack 的 tarball 安装到临时目录后，无需仓库内文件即可运行 cliworker --version、doctor、discover、models enumerate 与 smoke --dry-run，且 UI 入口页存在于包内；任一失败即不通过。'
if (!graph.acceptance.some((row) => row.id === 'AC-088')) {
  graph.acceptance.push({ id: 'AC-088', text, levels: ['integration'] })
}
fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf8')
console.log('index=' + idx.acs.length + ' tasks=' + graph.tasks.length)
