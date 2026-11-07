// View resolution for select. Pure function: no IO, no environment, no clock.

export const VIEW_NAMES = ['agentline', 'full', 'draft']

const DRAFT_WARNING = [{ code: 'W_DRAFT_DEPRECATED' }]

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
