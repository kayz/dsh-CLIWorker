export function detectHost(ctx, fsx) {
  if (ctx.platform !== 'linux') return { platform: ctx.platform, wsl: false }
  const distro = typeof ctx.env?.WSL_DISTRO_NAME === 'string' ? ctx.env.WSL_DISTRO_NAME.trim() : ''
  if (distro) return { platform: `wsl:${distro}`, wsl: true }
  let wsl = false
  try { wsl = /microsoft|wsl/i.test(String(fsx.readFileSync('/proc/version', 'utf8'))) } catch { /* unavailable evidence */ }
  return { platform: 'linux', wsl }
}

export function detectPlatform(ctx, fsx) {
  return detectHost(ctx, fsx).platform
}
