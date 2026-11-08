import { validate } from '../../lib/contract/validate.mjs'

export const STEP_IDS = ['discover', 'wsl-discover', 'enumerate', 'probe', 'select', 'run', 'http-select']

const stepProperties = {
  id: { type: 'string', minLength: 1 },
  ac: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^AC-[0-9]{3}$' } },
  mandatory: { type: 'boolean' },
  status: { enum: ['pass', 'fail', 'skip'] },
  reason: { type: ['string', 'null'] },
  duration_ms: { type: 'number', minimum: 0 },
}

export const smokeSchema = {
  type: 'object',
  required: ['schema', 'mode', 'version', 'platform', 'node', 'steps', 'redacted'],
  additionalProperties: false,
  properties: {
    schema: { const: 'cliworker.smoke/v1' },
    mode: { enum: ['real', 'dry-run'] },
    version: { type: 'string', minLength: 1 },
    platform: { type: 'string', minLength: 1 },
    node: { type: 'string', minLength: 1 },
    steps: {
      type: 'array', minItems: 7, maxItems: 7,
      items: { type: 'object', required: Object.keys(stepProperties), additionalProperties: false, properties: stepProperties },
    },
    redacted: { const: true },
  },
}

export function validateReport(report, version) {
  const structural = validate(smokeSchema, report)
  if (!structural.ok) return structural
  const errors = []
  if (report.version !== version) errors.push('version')
  for (const [index, step] of report.steps.entries()) {
    if (step.id !== STEP_IDS[index]) errors.push('step order')
    if (step.mandatory !== true) errors.push('mandatory')
    if (step.ac.length !== 1 || step.ac[0] !== (step.id === 'wsl-discover' ? 'AC-038' : 'AC-069')) errors.push('ac')
    if (!Number.isFinite(step.duration_ms)) errors.push('duration')
    if (step.status === 'pass' ? step.reason !== null : typeof step.reason !== 'string' || step.reason.trim() === '') errors.push('reason')
  }
  return { ok: errors.length === 0, errors }
}
