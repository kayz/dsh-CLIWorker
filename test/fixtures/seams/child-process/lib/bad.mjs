import { spawnSync } from 'node:child_process'

export function probe() {
  return spawnSync('node', ['--version'], { encoding: 'utf8' })
}
