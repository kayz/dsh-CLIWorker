// Rebuild the independent, offline release-gate fixture roots.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const base = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(base, '../../..')
const index = JSON.parse(fs.readFileSync(path.join(repo, 'contracts/spec/ac-index.json')))
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json')))
const cases = ['good', 'node-alternative', 'ci-fail', 'baseline-skip', 'wrong-os', 'dry-run', 'unredacted', 'wrong-version', 'unmapped-smoke', 'smoke-fail', 'mandatory-skip', 'waived-missing-smoke', 'waived-mandatory-skip', 'non-real-waiver', 'stale-waiver', 'planned', 'missing-smoke', 'missing-manifest', 'missing-reporter', 'missing-skips', 'filtered', 'missing-executed-file', 'missing-result', 'malformed-report', 'malformed-waivers', 'missing-waivers', 'invalid-index', 'duplicate-owner', 'forged-baseline', 'unknown-waiver', 'duplicate-waiver', 'blank-approval', 'truncated-tap', 'todo', 'skip-conflict', 'untagged-fail', 'ac069-skip', 'nonrequired-skip', 'waived-pass', 'empty-artifacts', 'no-shards', 'fake-pass']
const file = 'test/unit/evidence.test.mjs'
const write = (root, name, data) => { const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data) }
const put = (root, name, data) => write(root, name, JSON.stringify(data, null, 2) + '\n')
const smoke = { schema: 'cliworker.smoke/v1', mode: 'real', version: pkg.version, platform: 'win32', node: process.version, redacted: true, steps: ['discover', 'wsl-discover', 'enumerate', 'probe', 'select', 'run', 'http-select'].map(id => ({ id, ac: [id === 'wsl-discover' ? 'AC-038' : 'AC-069'], mandatory: true, status: 'pass', reason: null, duration_ms: 1 })) }
const source = `import { describe, test } from 'node:test'\nimport assert from 'node:assert/strict'\ndescribe('${file}', () => {\n${index.acs.map(e => `  test('[${e.ac}] evidence', t => { if (process.env.FIXTURE_SKIP === '${e.ac}') t.skip('platform'); if (process.env.FIXTURE_FAIL === '${e.ac}') assert.fail('failure') })`).join('\n')}\n})\n`
const tapCache = new Map()
// Node's TAP reporter prints absolute `location:` and stack paths. Fixtures are committed, so the
// machine/worktree prefix is stripped; only repository-relative paths are kept (portable, and no
// checkout-specific directory name leaks into the repository).
function portableTap(text, root) {
  const posix = root.split(path.sep).join('/')
  const escaped = root.split('\\').join('\\\\')
  return String(text)
    .split(`file:///${posix}`).join('')
    .split(escaped).join('')
    .split(posix).join('')
}
function tap(root, skip = '', fail = '') {
  const key = `${skip}/${fail}`
  if (!tapCache.has(key)) {
    const env = { ...process.env, FIXTURE_SKIP: skip, FIXTURE_FAIL: fail }; delete env.NODE_TEST_CONTEXT
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', file], { cwd: root, env, encoding: 'utf8' })
    if (r.error || (r.status !== 0 && !fail)) throw r.error ?? new Error('fixture TAP failed')
    tapCache.set(key, portableTap(r.stdout, root))
  }
  return tapCache.get(key)
}
for (const name of cases) {
  const root = path.join(base, name)
  fs.mkdirSync(root, { recursive: true })
  put(root, 'package.json', pkg); put(root, 'contracts/spec/ac-index.json', name === 'invalid-index' ? { ...index, schema: 'invalid' } : index); write(root, file, source)
  const groups = new Map()
  for (const e of index.acs) {
    if (!groups.has(e.owner)) groups.set(e.owner, [])
    groups.get(e.owner).push({ ac: e.ac, files: [file], status: name === 'planned' && e.ac === 'AC-001' ? 'planned' : 'covered' })
  }
  if (name !== 'no-shards') for (const [task, entries] of groups) put(root, `test/traceability/${task}.json`, { task, milestone: index.acs.find(e => e.owner === task).milestone, entries })
  if (name === 'duplicate-owner') put(root, 'test/traceability/T-999.json', { task: 'T-999', milestone: 'M1', entries: [{ ac: 'AC-001', files: [file], status: 'covered' }] })
  if (name === 'forged-baseline') put(root, 'test/traceability/T-999.json', { task: 'T-999', milestone: 'M1', baseline: ['linux'], entries: [] })
  const report = structuredClone(smoke)
  if (name === 'dry-run') report.mode = 'dry-run'
  if (name === 'unredacted') report.redacted = false
  if (name === 'wrong-version') report.version += '-old'
  if (name === 'unmapped-smoke') report.steps[1].ac = ['AC-069']
  if (name === 'smoke-fail' || name === 'mandatory-skip' || name === 'waived-mandatory-skip') { report.steps[1].status = name === 'smoke-fail' ? 'fail' : 'skip'; report.steps[1].reason = 'fixture' }
  if (!['missing-smoke', 'waived-missing-smoke', 'stale-waiver'].includes(name)) write(root, 'smoke.json', name === 'malformed-report' ? '{' : JSON.stringify(report))
  else if (fs.existsSync(path.join(root, 'smoke.json'))) fs.unlinkSync(path.join(root, 'smoke.json'))
  const waiver = ac => ({ ac, reason: 'approved fixture', approved_by: 'reviewer', version: name === 'stale-waiver' ? pkg.version + '-old' : pkg.version })
  let waiverList = ['waived-missing-smoke', 'waived-mandatory-skip', 'stale-waiver', 'waived-pass'].includes(name) ? [waiver('AC-038')] : name === 'non-real-waiver' ? [waiver('AC-001')] : []
  if (name === 'unknown-waiver') waiverList = [waiver('AC-999')]
  if (name === 'duplicate-waiver') waiverList = [waiver('AC-038'), waiver('AC-038')]
  if (name === 'blank-approval') waiverList = [{ ...waiver('AC-038'), approved_by: ' ' }]
  if (name !== 'missing-waivers') write(root, 'release/waivers.json', name === 'malformed-waivers' ? '{' : JSON.stringify(waiverList))
  if (name === 'empty-artifacts') fs.mkdirSync(path.join(root, 'ci'), { recursive: true })
  for (const os of name === 'empty-artifacts' ? [] : ['darwin', 'linux', 'win32']) {
    const dir = `ci/${os}`
    let skip = (['baseline-skip', 'node-alternative', 'todo'].includes(name) && os === 'linux') ? 'AC-001' : (name === 'wrong-os' && os === 'win32') || (name === 'nonrequired-skip' && os === 'linux') ? 'AC-027' : name === 'ac069-skip' && os === 'linux' ? 'AC-069' : ''
    const fail = ['ci-fail', 'untagged-fail'].includes(name) && os === 'linux' ? 'AC-001' : ''
    const manifest = { mode: name === 'filtered' && os === 'linux' ? 'filtered' : 'full', filter: name === 'filtered' && os === 'linux' ? 'AC-001' : '', files: name === 'missing-executed-file' && os === 'linux' ? ['test/unit/other.test.mjs'] : [file], platform: os, node: process.version }
    if (!(name === 'missing-manifest' && os === 'linux')) put(root, `${dir}/files-executed.json`, manifest)
    if (!(name === 'missing-reporter' && os === 'linux')) {
      let output = tap(root, skip, fail)
      if (name === 'missing-result' && os === 'linux') output = output.replaceAll('[AC-001]', '[AC-002]')
      if (name === 'fake-pass' && os === 'linux') output = output.replaceAll('[AC-001]', '[AC-002]').replace('duration_ms:', 'example: "ok 999 - [AC-001] fake"\n      duration_ms:')
      if (name === 'untagged-fail' && os === 'linux') output = output.replaceAll('[AC-001]', '[unmarked]')
      if (name === 'truncated-tap' && os === 'linux') output = output.slice(0, output.lastIndexOf('# duration_ms'))
      if (name === 'todo' && os === 'linux') output = output.replace('# SKIP platform', '# TODO platform').replace('# skipped 1', '# skipped 0').replace('# todo 0', '# todo 1')
      write(root, `${dir}/reporter.tap`, output)
    }
    if (!(name === 'missing-skips' && os === 'linux')) write(root, `${dir}/skips.jsonl`, name === 'skip-conflict' && os === 'linux' ? JSON.stringify({ schema: 'cliworker.skip/v1', test: '[AC-001] evidence', file, ac: 'AC-001', requires: 'win32', reason: 'fixture', platform: os, node: process.version }) + '\n' : '')
    if (name === 'node-alternative' && os === 'linux') {
      put(root, 'ci/linux-alternative/files-executed.json', { ...manifest, node: 'v22.0.0' })
      write(root, 'ci/linux-alternative/reporter.tap', tap(root)); write(root, 'ci/linux-alternative/skips.jsonl', '')
    }
  }
}
