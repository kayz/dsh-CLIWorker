import path from 'node:path'
import { defaultHome } from '../config.mjs'

export function arg(argv, name, fallback) {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : fallback
}

export function flag(argv, name) {
  return argv.includes(name)
}

export function usageFile(config, ctx) {
  return path.join(config._home || defaultHome(ctx.env), 'usage.jsonl')
}
