import { createFlow } from '../helpers/flow.mjs'
import { leakScan } from '../helpers/leak-scan.mjs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const flow = createFlow({ sentinels: [{ label: 'FLOW', value: process.env.CW_FLOW_SENTINEL }] })
const bin = fileURLToPath(new URL('../../bin/cliworker.mjs', import.meta.url))
flow.spawn = (command, args = [], options = {}) => {
  flow.captured.argv.push([command, ...args])
  const result = spawnSync(command, args, { env: { ...flow.env, ...(options.env || {}) }, input: options.input, encoding: 'utf8', timeout: 180000, windowsHide: true })
  const stdout = result.stdout || ''
  const stderr = result.stderr || ''
  flow.captured.stdout.push(stdout)
  flow.captured.stderr.push(stderr)
  if (result.error) throw result.error
  let json = null
  try { json = JSON.parse(stdout) } catch { /* JSONL or non-JSON response */ }
  return { code: result.status, signal: result.signal, stdout, stderr, json }
}
flow.run = (args, options) => flow.spawn(process.execPath, [bin, ...(args || [])], options)
let failed = false
try {
  const id = process.argv[2]
  if (!['enumerate', 'probe', 'select', 'run', 'http-select'].includes(id)) throw new Error('invalid step')
  const step = await import(`../flows/steps/${id}.mjs`)
  await step.run(flow)
  if (id === 'http-select') {
    const view = JSON.parse(flow.captured.http[0].body)
    if (view.schema !== 'cliworker.selection/v1' || !Array.isArray(view.models) || !view.models.length || !Array.isArray(view.calls) || view.calls.length !== view.models.length) throw new Error('invalid HTTP selection')
  }
} catch {
  failed = true
} finally {
  try {
    const scan = leakScan({ sentinels: flow.sentinels, ...flow.captured, state_dir: flow.root, auditFile: path.join(flow.state_dir, 'audit.jsonl') })
    if (!scan.ok) failed = true
  } catch { failed = true }
  process.stdout.write(JSON.stringify(flow.captured))
  try { flow.cleanup() } catch { failed = true }
  if (failed) { process.stderr.write('flow step failed\n'); process.exitCode = 1 }
}
