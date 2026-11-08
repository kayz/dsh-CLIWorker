// The only executable and probe established by the frozen inventory example.
// Source: contracts/examples/inventory.v1/valid/01.json.
export const RULES = Object.freeze([{ name: 'claude', versionArgs: Object.freeze(['--version']) }])

export function findRule(name, platform) {
  let value = name
  if (platform === 'win32') value = value.replace(/\.(?:exe|com|cmd|bat)$/i, '').toLowerCase()
  return RULES.find(rule => rule.name === value) ?? null
}
