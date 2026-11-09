// Offline executable-name and version-observation declarations.
const codex = Object.freeze({ name: 'codex', versionArgs: Object.freeze(['--version']) })
const claude = Object.freeze({ name: 'claude', versionArgs: Object.freeze(['--version']) })
const dsh = Object.freeze({ name: 'dsh', versionArgs: Object.freeze(['--version']) })
const cursor = Object.freeze({ name: 'cursor', versionArgs: Object.freeze(['--version']) })
const codebuddy = Object.freeze({ name: 'codebuddy', versionArgs: Object.freeze(['--version']) })
const antigravity = Object.freeze({ name: 'antigravity', versionArgs: Object.freeze(['--version']) })
const trae = Object.freeze({ name: 'trae', versionArgs: Object.freeze(['--version']) })
const zcode = Object.freeze({ name: 'zcode', versionArgs: Object.freeze(['--version']) })
const qoder = Object.freeze({ name: 'qoder', versionArgs: Object.freeze(['--version']) })
const kimi = Object.freeze({ name: 'kimi', versionArgs: Object.freeze(['--version']) })
const opencode = Object.freeze({ name: 'opencode', versionArgs: Object.freeze(['--version']) })

export const RULES = Object.freeze([codex, claude, dsh, cursor, codebuddy, antigravity, trae, zcode, qoder, kimi, opencode])

export function findRule(name, platform) {
  let value = name
  if (platform === 'win32') value = value.replace(/\.(?:exe|com|cmd|bat)$/i, '').toLowerCase()
  return RULES.find(rule => rule.name === value) ?? null
}
