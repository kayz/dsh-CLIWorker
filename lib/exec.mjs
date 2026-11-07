import { spawnSync } from 'node:child_process'

export function run(command, args = [], { timeout = 20_000 } = {}) {
  try {
    const r = spawnSync(command, args, { encoding: 'utf8', timeout, windowsHide: true, shell: process.platform === 'win32' })
    return { ok: r.status === 0, code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error?.message || null }
  } catch (e) {
    return { ok: false, code: -1, stdout: '', stderr: '', error: e.message }
  }
}
