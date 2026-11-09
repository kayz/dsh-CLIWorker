import fs from 'node:fs'

const root = 'C:\\git\\dsh-CLIWorker'
const idxPath = root + '\\contracts\\spec\\ac-index.json'
const graphPath = root + '\\.collab\\blueprint\\cliworker-v2\\task-graph.json'
const tcPath = root + '\\scripts\\check-traceability.mjs'

// 1) AC index: append AC-080..083 in ascending order after AC-079
const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'))
const wanted = [
  { ac: 'AC-080', owner: 'T-037', milestone: 'M3', levels: ['integration'], baseline: ['darwin', 'linux', 'win32'] },
  { ac: 'AC-081', owner: 'T-038', milestone: 'M5', levels: ['integration'], baseline: ['darwin', 'linux', 'win32'] },
  { ac: 'AC-082', owner: 'T-039', milestone: 'M3', levels: ['integration'], baseline: ['darwin', 'linux', 'win32'] },
  { ac: 'AC-083', owner: 'T-040', milestone: 'M4', levels: ['integration'], baseline: ['darwin', 'linux', 'win32'] },
]
for (const entry of wanted) {
  if (!idx.acs.some((row) => row.ac === entry.ac)) idx.acs.push(entry)
}
fs.writeFileSync(idxPath, JSON.stringify(idx, null, 2) + '\n', 'utf8')

// 2) check-traceability allowlist: 036 introduced the AC-079 exemption; extend it the same way.
let tc = fs.readFileSync(tcPath, 'utf8')
const before = "const extended = [...expected, 'AC-079']"
const after = "const extended = [...expected, 'AC-079', 'AC-080', 'AC-081', 'AC-082', 'AC-083']"
if (!tc.includes(after)) {
  if (!tc.includes(before)) throw new Error('allowlist anchor not found')
  tc = tc.replace(before, after)
  fs.writeFileSync(tcPath, tc, 'utf8')
}

// 3) task graph: four follow-up tasks
const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'))
const tasks = [
  {
    id: 'T-037',
    title: 'discover 覆盖 11 个已知 CLI 的契约清单',
    milestone: 'M3',
    inputs: ['T-016 的 discovery 积木', 'contracts 里的 CLI 契约'],
    outputs: ['lib/discovery/rules.mjs 扩展', 'test/integration/discovery-rules.test.mjs'],
    depends_on: ['T-016'],
    write_scope: ['lib/discovery/rules.mjs', 'lib/discovery/scan.mjs', 'test/integration/discovery-rules.test.mjs', 'test/fixtures/discovery/**'],
    acceptance: ['AC-080'],
    acceptance_direction: ['node scripts/run-tests.mjs --ac AC-080'],
    test_levels: ['integration'],
  },
  {
    id: 'T-038',
    title: 'AC-038 真机冒烟：WSL 内 Node 与 CLI 探测',
    milestone: 'M5',
    inputs: ['T-029 的 smoke-real.mjs', '本机 WSL Ubuntu-24.04'],
    outputs: ['scripts/smoke-real.mjs 的 WSL 前置探测', 'test/integration/wsl-smoke-preflight.test.mjs'],
    depends_on: ['T-029'],
    write_scope: ['scripts/smoke-real.mjs', 'test/integration/wsl-smoke-preflight.test.mjs', 'docs/release-checklist.md'],
    acceptance: ['AC-081'],
    acceptance_direction: ['node scripts/run-tests.mjs --ac AC-081'],
    test_levels: ['integration'],
  },
  {
    id: 'T-039',
    title: 'discover 补 flow 步骤',
    milestone: 'M3',
    inputs: ['T-016 的 discover 命令', 'T-031 的 flow 步骤框架'],
    outputs: ['test/flows/steps/discover.mjs'],
    depends_on: ['T-016'],
    write_scope: ['test/flows/steps/discover.mjs', 'test/flows/flow.test.mjs', 'test/traceability/T-039.json'],
    acceptance: ['AC-082'],
    acceptance_direction: ['node scripts/run-tests.mjs --ac AC-082'],
    test_levels: ['integration'],
  },
  {
    id: 'T-040',
    title: '跨进程写入并发一致性',
    milestone: 'M4',
    inputs: ['T-011 的锁与 store', 'T-022 的租约提交'],
    outputs: ['test/integration/cross-process-write.test.mjs'],
    depends_on: ['T-011', 'T-022'],
    write_scope: ['test/integration/cross-process-write.test.mjs', 'test/fixtures/store/**', 'test/traceability/T-040.json'],
    acceptance: ['AC-083'],
    acceptance_direction: ['node scripts/run-tests.mjs --ac AC-083'],
    test_levels: ['integration'],
  },
]
for (const task of tasks) {
  const i = graph.tasks.findIndex((row) => row.id === task.id)
  if (i >= 0) graph.tasks[i] = task
  else graph.tasks.push(task)
}
const acTexts = [
  ['AC-080', 'discover 对 11 个已知 CLI 各有可判定的识别规则：给定 PATH 中的可执行文件，能产出该 CLI 的键、provider 与版本证据；未识别的可执行文件不进入 entries。'],
  ['AC-081', 'AC-038 真机冒烟可在 WSL 内执行：脚本先探测发行版内的 Node 与 CLI，缺失时明确报告 fail（不得 skip 折算通过），具备条件时产出 wsl:<distro> 条目。'],
  ['AC-082', 'flow 包含 discover 步骤，且该步骤在 v2 配置下真实调用 CLI、断言 inventory/v1 与落盘文件同源。'],
  ['AC-083', '多进程并发写入 state 时不丢更新：N 个进程各自提交后，最终条目数等于成功提交数。'],
]
for (const [id, text] of acTexts) {
  if (!graph.acceptance.some((row) => row.id === id)) graph.acceptance.push({ id, text, levels: ['integration'] })
}
fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2) + '\n', 'utf8')

console.log('index=' + idx.acs.length + ' tasks=' + graph.tasks.length + ' acs=' + graph.acceptance.length)
