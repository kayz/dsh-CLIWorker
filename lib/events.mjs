import { errorBodyFrom, exitCodeFor } from './output.mjs'

/** Writes one event per physical line, with a single terminal result or error. */
export function createEventWriter(ctx, leaseId) {
  let seq = 0
  let finished = false
  function emit(type, fields = {}) {
    if (finished) throw new Error('event stream already finished')
    const event = { schema: 'cliworker.event/v1', seq: ++seq, lease_id: leaseId, type, at: ctx.clock.nowIso(), ...fields }
    ctx.stdout.write(`${JSON.stringify(event)}\n`)
    if (type === 'result' || type === 'error') finished = true
    return event
  }
  return {
    start: () => emit('start'),
    text: (text) => emit('text', { text }),
    usage: ({ input_tokens, output_tokens }) => emit('usage', { usage: { input_tokens, output_tokens } }),
    result: (text, { input_tokens, output_tokens }) => emit('result', {
      ok: true, exit_code: 0, text, usage: { input_tokens, output_tokens },
    }),
    error: (error) => {
      const { error: detail } = errorBodyFrom(error)
      return emit('error', { code: detail.code, message: detail.message, retryable: detail.retryable, exit_code: exitCodeFor(detail.code) })
    },
  }
}
