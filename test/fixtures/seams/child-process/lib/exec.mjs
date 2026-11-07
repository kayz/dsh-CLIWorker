import { spawnSync } from 'node:child_process'

export function run(command, args) {
  return spawnSync(command, args, { encoding: 'utf8' })
}
