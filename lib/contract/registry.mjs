// Frozen contract registry. Pure data plus pure helpers: no imports, no IO, no clock.
// Change only through a blueprint change: edit this file, bump snapshot_version by one,
// then run `node scripts/snapshot-update.mjs`.

const CODES = [
  {
    code: 'E_INTERNAL',
    exit: 1,
    http_status: 500,
    retryable: false,
    trigger_id: 'internal_error',
    trigger: 'Unhandled exception or broken invariant inside CLIWorker',
  },
  {
    code: 'E_REQUEST_INVALID',
    exit: 2,
    http_status: 400,
    retryable: false,
    trigger_id: 'request_invalid',
    trigger: 'Request field has an invalid type or value (level and schema have their own codes)',
  },
  {
    code: 'E_LEVEL_REQUIRED',
    exit: 2,
    http_status: 400,
    retryable: false,
    trigger_id: 'level_missing',
    trigger: 'Request has no level',
  },
  {
    code: 'E_LEVEL_UNKNOWN',
    exit: 2,
    http_status: 400,
    retryable: false,
    trigger_id: 'level_not_in_set',
    trigger: 'level is present but not Top, High, Middle or Quick (case-insensitive)',
  },
  {
    code: 'E_SCHEMA_UNSUPPORTED',
    exit: 2,
    http_status: 400,
    retryable: false,
    trigger_id: 'schema_unsupported',
    trigger: 'schema is present but is not a supported version',
  },
  {
    code: 'E_UNSAFE_ARG',
    exit: 2,
    http_status: 400,
    retryable: false,
    trigger_id: 'unsafe_argument',
    trigger: 'Argument or path rejected by the safe-execution rules',
  },
  {
    code: 'E_UNKNOWN_COMMAND',
    exit: 2,
    http_status: 404,
    retryable: false,
    trigger_id: 'command_unknown',
    trigger: 'CLI command or sub-command is not in the command table',
  },
  {
    code: 'E_VIEW_FORBIDDEN',
    exit: 2,
    http_status: 403,
    retryable: false,
    trigger_id: 'select_view_without_admin',
    trigger:
      'select route asked for full or draft view without a valid session; CLI models select with view full',
  },
  {
    code: 'E_CONFIG',
    exit: 3,
    http_status: 500,
    retryable: false,
    trigger_id: 'config_invalid',
    trigger: 'Config file is missing, unreadable or fails validation',
  },
  {
    code: 'E_CONFIG_EXAMPLE',
    exit: 3,
    http_status: 500,
    retryable: false,
    trigger_id: 'config_is_example',
    trigger: 'Config has _example true or deep-equals the bundled example ignoring _example',
  },
  {
    code: 'E_CONFIG_EXISTS',
    exit: 3,
    http_status: 409,
    retryable: false,
    trigger_id: 'config_exists',
    trigger: 'init would overwrite an existing config file',
  },
  {
    code: 'E_CONFIG_SECRET_INLINE',
    exit: 3,
    http_status: 400,
    retryable: false,
    trigger_id: 'config_secret_inline',
    trigger: 'Config holds an inline secret value instead of a SecretRef',
  },
  {
    code: 'E_SECRET_BACKEND',
    exit: 3,
    http_status: 500,
    retryable: false,
    trigger_id: 'secret_backend_failed',
    trigger: 'Secret backend is unavailable or rejected the read or write',
  },
  {
    code: 'E_STATE_LOCKED',
    exit: 4,
    http_status: 503,
    retryable: false,
    trigger_id: 'state_lock_timeout',
    trigger: 'State lock was not acquired within lock_wait_ms',
  },
  {
    code: 'E_TIMEOUT',
    exit: 4,
    http_status: 504,
    retryable: true,
    trigger_id: 'call_timeout',
    trigger: 'run exceeded timeout_ms and its process tree was killed',
  },
  {
    code: 'E_NO_CANDIDATE',
    exit: 5,
    http_status: 409,
    retryable: false,
    trigger_id: 'no_candidate_available',
    trigger:
      'No candidate passed the non-quota filters, or the rejections are not all quota-driven',
  },
  {
    code: 'E_INSUFFICIENT_QUOTA',
    exit: 5,
    http_status: 429,
    retryable: true,
    trigger_id: 'all_candidates_quota_rejected',
    trigger:
      'At least one candidate passed every non-quota filter and all such candidates were rejected by quota_low, reserve_protected or quota_unknown_policy',
  },
  {
    code: 'E_LEASE_UNKNOWN',
    exit: 6,
    http_status: 404,
    retryable: false,
    trigger_id: 'lease_not_found',
    trigger: 'run was given a lease id that is not in the state directory',
  },
  {
    code: 'E_LEASE_EXPIRED',
    exit: 6,
    http_status: 410,
    retryable: true,
    trigger_id: 'lease_past_expiry',
    trigger: 'Lease expires_at is earlier than now; the caller must request a new lease',
  },
  {
    code: 'E_LEASE_CONSUMED',
    exit: 6,
    http_status: 409,
    retryable: false,
    trigger_id: 'lease_already_run',
    trigger: 'Lease was already used by an earlier run',
  },
  {
    code: 'E_LEASE_CONFIG_MISMATCH',
    exit: 6,
    http_status: 409,
    retryable: false,
    trigger_id: 'lease_config_mismatch',
    trigger: '--config or --state-dir passed to run differ from the ones recorded in the lease',
  },
  {
    code: 'E_PROVIDER_AUTH',
    exit: 7,
    http_status: 502,
    retryable: false,
    trigger_id: 'provider_auth_failed',
    trigger: 'Provider CLI reported that it is not logged in or the token was rejected',
  },
  {
    code: 'E_PROVIDER_QUOTA',
    exit: 7,
    http_status: 429,
    retryable: false,
    trigger_id: 'provider_quota_exhausted',
    trigger: 'Provider CLI reported that its own quota or rate limit is exhausted',
  },
  {
    code: 'E_PROVIDER_FAILED',
    exit: 7,
    http_status: 502,
    retryable: false,
    trigger_id: 'provider_call_failed',
    trigger: 'Provider CLI exited non-zero for a reason other than auth or quota',
  },
  {
    code: 'E_ADMIN_REQUIRED',
    exit: 8,
    http_status: 403,
    retryable: false,
    trigger_id: 'admin_route_no_session',
    trigger: 'Admin read or write route called without a valid session, including an expired one',
  },
  {
    code: 'E_LOOPBACK_ONLY',
    exit: 8,
    http_status: 403,
    retryable: false,
    trigger_id: 'bootstrap_non_loopback',
    trigger: 'api/session or ui shell failed any of the three loopback checks',
  },
  {
    code: 'E_READONLY',
    exit: 8,
    http_status: 403,
    retryable: false,
    trigger_id: 'write_route_readonly',
    trigger: 'Session is valid, the plugin is readonly, and the route is a write route',
  },
  {
    code: 'E_CSRF',
    exit: 8,
    http_status: 403,
    retryable: false,
    trigger_id: 'write_route_csrf_invalid',
    trigger: 'Session is valid, the plugin is writable, and the csrf header is missing or does not match',
  },
  {
    code: 'E_HEALTH_DEGRADED',
    exit: 9,
    http_status: 503,
    retryable: false,
    trigger_id: 'health_check_failed',
    trigger: 'At least one health check failed',
  },
  {
    code: 'E_SMOKE_DISABLED',
    exit: 9,
    http_status: 501,
    retryable: false,
    trigger_id: 'smoke_not_enabled',
    trigger: 'Smoke command was invoked while smoke is not enabled',
  },
]

const DRAFT_REASON_MAPPING = [
  { draft: 'excluded', v1: 'excluded' },
  { draft: 'not_in_workspace_order', v1: 'excluded' },
  { draft: 'level:<Level>', v1: 'level_mismatch' },
  { draft: 'availability:unverified', v1: 'availability_unverified' },
  { draft: 'availability:blocked', v1: 'availability_blocked' },
  { draft: 'availability:unavailable', v1: 'availability_unavailable' },
  { draft: 'availability:deprecated', v1: 'deprecated' },
  { draft: 'identity_unverified', v1: 'identity_unverified' },
  { draft: 'readonly_unavailable', v1: 'readonly_unavailable' },
  { draft: 'E_FORECAST_EXHAUSTION', v1: 'quota_low' },
]

const REGISTRY_DATA = {
  schema: 'cliworker.registry/v1',
  snapshot_version: 1,
  codes: CODES,
  write_route_order: ['session', 'readonly', 'csrf', 'body'],
  warning_codes: [
    'W_FIELD_IGNORED',
    'W_FIELD_DEPRECATED',
    'W_CONFIG_V1',
    'W_STALE_DATA',
    'W_DRAFT_DEPRECATED',
    'W_MODELS_MANUAL_REQUIRED',
    'W_LEGACY_USAGE',
    'W_TEST_CLOCK',
  ],
  reject_reasons: {
    v1: [
      'excluded',
      'level_mismatch',
      'level_unassigned',
      'availability_unverified',
      'availability_blocked',
      'availability_unavailable',
      'availability_stale',
      'deprecated',
      'identity_unverified',
      'identity_mismatch',
      'readonly_unavailable',
      'adapter_unverified',
      'quota_low',
      'quota_unknown_policy',
      'reserve_protected',
    ],
    admin_only: ['not_allowed'],
    draft: [
      'excluded',
      'not_in_workspace_order',
      'level:<Level>',
      'availability:<state>',
      'identity_unverified',
      'readonly_unavailable',
      'E_FORECAST_EXHAUSTION',
    ],
  },
  draft_reason_mapping: DRAFT_REASON_MAPPING,
  forecast_reasons: [
    'no_samples',
    'capacity_unknown',
    'ledger_capacity_unknown',
    'credits_conversion_missing',
    'usd_samples_missing',
    'reading_stale',
    'window_unknown',
  ],
  risk: ['ok', 'low_reserve', 'critical', 'exhausted', 'unknown'],
  risk_basis: ['tasks', 'usd', 'fraction', 'none'],
  tasks_left_basis: ['tasks', 'usd', 'none'],
  thresholds: {
    tasks: [
      { risk: 'exhausted', op: '<=', value: 0 },
      { risk: 'critical', op: '<=', value: 2 },
      { risk: 'low_reserve', op: '<=', value: 5 },
      { risk: 'ok', op: 'else', value: null },
    ],
    fraction: [
      { risk: 'exhausted', op: '<=', value: 0 },
      { risk: 'critical', op: '<', value: 0.05 },
      { risk: 'low_reserve', op: '<', value: 0.15 },
      { risk: 'ok', op: 'else', value: null },
    ],
    priority: ['tasks', 'usd', 'fraction', 'unknown'],
  },
  availability: ['unverified', 'callable', 'blocked', 'unavailable', 'deprecated'],
  identity: ['verified', 'unverified', 'mismatch'],
  semantic_change: [
    'forecast.tasks_left',
    'forecast.risk',
    'handle.cli_removed',
    'draft_reason_mapping',
    'config_v1_to_v2',
  ],
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze(value[key])
  }
  return value
}

export const REGISTRY = deepFreeze(REGISTRY_DATA)

export const WRITE_ROUTE_ORDER = REGISTRY.write_route_order

export function getCode(code) {
  for (const entry of REGISTRY.codes) {
    if (entry.code === code) return entry
  }
  return null
}

function deepEqual(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false
    if (!deepEqual(a[key], b[key])) return false
  }
  return true
}

function byCodePoint(a, b) {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

function pushUnique(list, item) {
  if (!list.includes(item)) list.push(item)
}

function compareKeyed({ section, frozenList, currentList, keyName, fields, removed, added, changed }) {
  const frozen = new Map()
  for (const item of frozenList) frozen.set(item[keyName], item)
  const current = new Map()
  for (const item of currentList) current.set(item[keyName], item)
  for (const key of frozen.keys()) {
    if (!current.has(key)) pushUnique(removed, `${section}:${key}`)
  }
  for (const key of current.keys()) {
    if (!frozen.has(key)) pushUnique(added, `${section}:${key}`)
  }
  for (const [key, before] of frozen) {
    if (!current.has(key)) continue
    const after = current.get(key)
    if (fields.some((field) => !deepEqual(before[field], after[field]))) {
      pushUnique(changed, `${section}:${key}`)
    }
  }
}

function compareValueList(listA, listB, section, removed, added) {
  const left = new Set(listA)
  const right = new Set(listB)
  for (const value of left) {
    if (!right.has(value)) pushUnique(removed, `${section}:${value}`)
  }
  for (const value of right) {
    if (!left.has(value)) pushUnique(added, `${section}:${value}`)
  }
}

function compareOrdered(listA, listB, section, changed) {
  if (!deepEqual(listA, listB)) pushUnique(changed, `${section}:*`)
}

export function compareRegistry(frozen, current) {
  const removed = []
  const added = []
  const changed = []

  compareKeyed({
    section: 'codes',
    frozenList: frozen.codes ?? [],
    currentList: current.codes ?? [],
    keyName: 'code',
    fields: ['exit', 'http_status', 'retryable', 'trigger_id', 'trigger'],
    removed,
    added,
    changed,
  })

  compareKeyed({
    section: 'draft_reason_mapping',
    frozenList: frozen.draft_reason_mapping ?? [],
    currentList: current.draft_reason_mapping ?? [],
    keyName: 'draft',
    fields: ['v1'],
    removed,
    added,
    changed,
  })

  compareKeyed({
    section: 'thresholds.tasks',
    frozenList: frozen.thresholds?.tasks ?? [],
    currentList: current.thresholds?.tasks ?? [],
    keyName: 'risk',
    fields: ['op', 'value'],
    removed,
    added,
    changed,
  })

  compareKeyed({
    section: 'thresholds.fraction',
    frozenList: frozen.thresholds?.fraction ?? [],
    currentList: current.thresholds?.fraction ?? [],
    keyName: 'risk',
    fields: ['op', 'value'],
    removed,
    added,
    changed,
  })

  const valueLists = [
    ['warning_codes', (r) => r.warning_codes],
    ['reject_reasons.v1', (r) => r.reject_reasons?.v1],
    ['reject_reasons.admin_only', (r) => r.reject_reasons?.admin_only],
    ['reject_reasons.draft', (r) => r.reject_reasons?.draft],
    ['forecast_reasons', (r) => r.forecast_reasons],
    ['risk', (r) => r.risk],
    ['risk_basis', (r) => r.risk_basis],
    ['tasks_left_basis', (r) => r.tasks_left_basis],
    ['availability', (r) => r.availability],
    ['identity', (r) => r.identity],
    ['semantic_change', (r) => r.semantic_change],
  ]
  for (const [section, pick] of valueLists) {
    compareValueList(pick(frozen) ?? [], pick(current) ?? [], section, removed, added)
  }

  compareOrdered(frozen.write_route_order ?? [], current.write_route_order ?? [], 'write_route_order', changed)
  compareOrdered(
    frozen.thresholds?.priority ?? [],
    current.thresholds?.priority ?? [],
    'thresholds.priority',
    changed
  )

  removed.sort(byCodePoint)
  added.sort(byCodePoint)
  changed.sort(byCodePoint)
  return { removed, added, changed }
}

export function checkFrozen(frozen, current) {
  const diff = compareRegistry(frozen, current)
  const errors = []
  for (const item of diff.removed) errors.push({ id: 'freeze.removed', detail: item })
  for (const item of diff.changed) errors.push({ id: 'freeze.changed', detail: item })
  for (const item of diff.added) errors.push({ id: 'freeze.added', detail: item })

  const ok = deepEqual(frozen, current)
  if (!ok && errors.length === 0) {
    const left = { ...frozen, snapshot_version: null }
    const right = { ...current, snapshot_version: null }
    if (deepEqual(left, right)) {
      errors.push({
        id: 'freeze.version',
        detail: `have=${current.snapshot_version} need=${frozen.snapshot_version}`,
      })
    }
  }
  return { ok, errors }
}

// Reference implementation of the gate decision. Returns null when the request may proceed
// to body validation, or the name of the single 403 code that rejects it.
export function decideGate(facts) {
  const factsValue = facts ?? {}
  const route = factsValue.route
  if (route === 'public') return null
  if (route === 'select') {
    return factsValue.view_full_or_draft && !factsValue.session_valid ? 'E_VIEW_FORBIDDEN' : null
  }
  if (route === 'bootstrap') {
    return factsValue.loopback_ok ? null : 'E_LOOPBACK_ONLY'
  }
  if (route === 'admin_read') {
    return factsValue.session_valid ? null : 'E_ADMIN_REQUIRED'
  }
  if (route === 'admin_write') {
    if (!factsValue.session_valid) return 'E_ADMIN_REQUIRED'
    if (factsValue.readonly) return 'E_READONLY'
    if (!factsValue.csrf_valid) return 'E_CSRF'
    return null
  }
  return null
}
