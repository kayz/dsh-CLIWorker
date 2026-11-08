// View resolution for select. Pure function: no IO, no environment, no clock.

export const VIEW_NAMES = ['agentline', 'full', 'draft']

const DRAFT_WARNING = [{ code: 'W_DRAFT_DEPRECATED' }]

export const SESSION_RESULT_SCHEMA = 'cliworker.session-result/v1'

export const SESSION_ACTIONS = Object.freeze(['start', 'resume'])

export const SESSION_IDENTITY_LEVELS = Object.freeze(['verified', 'observed', 'unverified', 'failed'])

/**
 * Assemble a session result from the whitelisted fields only. Success and failure have distinct
 * shapes; anything not named here is dropped, which is what keeps provider details out of results.
 */
export function sessionView(fields = {}) {
  const action = fields.action
  if (!SESSION_ACTIONS.includes(action)) throw new TypeError('session action is invalid')
  const error = fields.error

  if (error === undefined || error === null) {
    return {
      schema: SESSION_RESULT_SCHEMA,
      ok: true,
      action,
      session_token: fields.session_token === undefined ? null : fields.session_token,
      identity: fields.identity === undefined ? null : fields.identity,
      reply: fields.reply === undefined ? '' : fields.reply,
    }
  }

  const result = {
    schema: SESSION_RESULT_SCHEMA,
    ok: false,
    action,
    error: {
      code: error.code,
      message: error.message,
      retryable: error.retryable === true,
      retry_after: error.retry_after === undefined ? null : error.retry_after,
    },
  }
  if (fields.identity !== undefined && fields.identity !== null) result.identity = fields.identity
  return result
}

export function resolveView(options = {}) {
  const transport = options.transport
  const request = options.request ?? {}
  const hasSession = options.hasSession === true

  const full = request.view === 'full'
  const draft = request.schema === undefined || request.compat === 'draft'
  const draftResult = { view: 'draft', warnings: DRAFT_WARNING.map((item) => ({ ...item })), error: null }
  const forbidden = { view: null, warnings: [], error: 'E_VIEW_FORBIDDEN' }
  const agentline = { view: 'agentline', warnings: [], error: null }

  if (transport === 'cli') {
    if (full) return forbidden
    if (draft) return draftResult
    return agentline
  }

  if ((full || draft) && !hasSession) return forbidden
  if (full) return { view: 'full', warnings: [], error: null }
  if (draft) return draftResult
  return agentline
}
