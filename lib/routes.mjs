// Dynamic CLI route registry. Command modules may self-register by exporting
// `route = { cmd, sub }`; this module discovers those exports so adding a command no longer
// requires editing lib/cli.mjs. File-system access stays behind context.listCommandFiles: this
// module must not import node:fs (see scripts/check-seams.mjs).
import { pathToFileURL } from 'node:url'
import { listCommandFiles } from './context.mjs'

function toRoute(mod) {
  const route = mod && mod.route
  if (!route || typeof route !== 'object' || Array.isArray(route)) return null
  if (typeof route.cmd !== 'string' || route.cmd === '') return null
  const sub = route.sub === undefined ? null : route.sub
  if (sub !== null && typeof sub !== 'string') return null
  return { cmd: route.cmd, sub, module: mod }
}

/**
 * Imports every command module below `dir` (default `lib/commands`) and returns the ones that
 * export a valid `route`, as `[{ cmd, sub, module }]` in file-path order. Modules that fail to
 * import or export no route are skipped rather than failing the whole registry.
 */
export async function collectRoutes(dir) {
  const routes = []
  for (const file of listCommandFiles(dir)) {
    let mod
    try {
      mod = await import(pathToFileURL(file).href)
    } catch {
      continue
    }
    const route = toRoute(mod)
    if (route) routes.push(route)
  }
  return routes
}

/**
 * First route matching `cmd` exactly and `sub` exactly (`null` means "no subcommand"), or null.
 * Duplicate registrations resolve to the first route in file-path order.
 */
export function matchRoute(routes, cmd, sub) {
  if (!Array.isArray(routes)) return null
  const wanted = sub === undefined ? null : sub
  for (const route of routes) {
    if (!route || route.cmd !== cmd) continue
    const actual = route.sub === undefined ? null : route.sub
    if (actual === wanted) return route
  }
  return null
}
