import fs from 'node:fs'

const root = 'C:\\git\\dsh-CLIWorker'
const idxPath = root + '\\contracts\\spec\\ac-index.json'
const graphPath = root + '\\.collab\\blueprint\\cliworker-v2\\task-graph.json'
const tcPath = root + '\\scripts\\check-traceability.mjs'

const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'))
const added = { ac: 'AC-087', owner: 'T-044', milestone: 'M5', levels: ['unit', 'contract'], baseline: ['darwin', 'linux', 'win32'] }
if (!idx.acs.some((row) => row.ac === added.ac)) idx.acs.push(added)
fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2) + '\n', 'utf8')

let tc = fs.readFileSync(tcPath, 'utf8')
const before = "const extended = [...expected, 'AC-079', 'AC-080', 'AC-081', 'AC-082', 'AC-083', 'AC-084', 'AC-085', 'AC-086']"
const after = "const extended = [...expected, 'AC-079', 'AC-080', 'AC-081', 'AC-082', 'AC-083', 'AC-084', 'AC-085', 'AC-086', 'AC-087']"
if (!tc.includes(after)) {
  if (!tc.includes(before)) throw new Error('allowlist anchor not found')
  fs.writeFileSync(tcPath, tc.replace(before, after), 'utf8')
}

const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'))
const task = {
  id: 'T-044',
  title: 'UI 资产随 npm 包分发',
  milestone: 'M5',
  inputs: ['package.json 的 files 字段', 'ui/**', 'docs/ui/cliworker-console.html'],
  outputs: ['package.json files 增加 ui/**', 'scripts/check-package-contents.mjs', 'test/unit/package-contents.test.mjs'],
  depends_on: ['T-024', 'T-025'],
  write_scope: [
    'package.json',
    'scripts/check-package-contents.mjs',
    'test/unit/package-contents.test.mjs',
    'docs/release-checklist.md',
  ],
  acceptance: ['AC-087'],
  acceptance_direction: ['node scripts/run-tests.mjs --ac AC-087'],
  test_levels: ['unit', 'contract'],
}
const i = graph.tasks.findIndex((row) => row.id === task.id)
if (i >= 0) graph.tasks[i] = task
else graph.tasks.push(task)
const text = '安装包内容可验证：npm pack 产出的 tarball 必须包含 UI 资产（ui/** 与 docs/ui 入口页），且包含 bin/ 与 lib/；缺任一项即失败，并有测试断言文件清单而非固定字节数。'
if (!graph.acceptance.some((row) => row.id === 'AC-087')) {
  graph.acceptance.push({ id: 'AC-087', text, levels: ['unit', 'contract'] })
}
fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf8')
console.log('index=' + idx.acs.length + ' tasks=' + graph.tasks.length)
