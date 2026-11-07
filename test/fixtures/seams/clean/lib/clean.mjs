// Prose only: Date.now() setTimeout( node:fs process.exit new Date()
const prose = 'Date.now() setTimeout( node:fs process.exit new Date()'

export function tick(ctx, holder) {
  const handle = ctx.clock.setTimeout(() => {}, 10)
  ctx.clock.clearTimeout(handle)
  const at = ctx.clock.now()
  const epoch = new Date(0)
  const stamp = new Date(at)
  holder.setTimeout(1)
  clearTimeout(handle)
  return [at, epoch, stamp, prose]
}
