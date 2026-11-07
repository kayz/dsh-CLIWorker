// AgentLine view scanning. Pure function: the caller supplies the forbidden list, the model
// catalog and the run wrapper. No IO, no environment, no clock.

const CALL_KEYS = ['command', 'args', 'cwd', 'input', 'output', 'timeout_ms']
const EXEC_SUFFIXES = ['.exe', '.cmd', '.bat', '.ps1', '.mjs']

function escapePointer(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1')
}

function childPath(pointer, key) {
  return `${pointer}/${escapePointer(key)}`
}

function executableName(cli) {
  if (typeof cli !== 'string') return null
  const parts = cli.split(/[\\/]/)
  let name = parts[parts.length - 1].toLowerCase()
  for (const suffix of EXEC_SUFFIXES) {
    if (name.endsWith(suffix)) {
      name = name.slice(0, -suffix.length)
      break
    }
  }
  return name === '' ? null : name
}

function forbiddenValues(catalog) {
  const values = new Set()
  const models = catalog && Array.isArray(catalog.models) ? catalog.models : []
  for (const model of models) {
    for (const field of ['id', 'key']) {
      const value = model && model[field]
      if (typeof value === 'string' && value !== '') values.add(value.toLowerCase())
    }
    const name = executableName(model && model.cli)
    if (name) values.add(name)
  }
  return values
}

function isWordChar(char) {
  return char !== '' && /[a-z0-9]/.test(char)
}

function wholeWordMatch(haystack, needle) {
  if (needle === '') return false
  let from = 0
  while (from <= haystack.length) {
    const index = haystack.indexOf(needle, from)
    if (index === -1) return false
    const before = index === 0 ? '' : haystack[index - 1]
    const after = index + needle.length >= haystack.length ? '' : haystack[index + needle.length]
    if (!isWordChar(before) && !isWordChar(after)) return true
    from = index + 1
  }
  return false
}

export function scanView(view, options = {}) {
  const forbidden = options.forbidden ?? {}
  const catalog = options.catalog ?? { models: [] }
  const wrapper = options.wrapper ?? {}

  const keySet = new Set(
    (Array.isArray(forbidden.keys) ? forbidden.keys : []).map((key) => String(key).toLowerCase())
  )
  const valueSet = forbiddenValues(catalog)
  const hits = []
  const seenValues = new Set()

  function addHit(path, kind, match) {
    hits.push({ path, kind, match })
  }

  function scanString(text, path) {
    const lower = text.toLowerCase()
    for (const needle of valueSet) {
      if (!wholeWordMatch(lower, needle)) continue
      const key = `${path}\u0000${needle}`
      if (seenValues.has(key)) continue
      seenValues.add(key)
      addHit(path, 'forbidden_value', needle)
    }
  }

  function checkCall(call, pointer, leaseId) {
    if (!call || typeof call !== 'object' || Array.isArray(call)) {
      addHit(pointer, 'call_mismatch', 'keys')
      return
    }
    const keys = Object.keys(call).sort()
    const expectedKeys = [...CALL_KEYS].sort()
    if (keys.length !== expectedKeys.length || keys.some((key, i) => key !== expectedKeys[i])) {
      addHit(pointer, 'call_mismatch', 'keys')
      return
    }

    if (call.command !== wrapper.command) {
      addHit(childPath(pointer, 'command'), 'call_mismatch', 'command')
    }
    if (call.input !== 'stdin') {
      addHit(childPath(pointer, 'input'), 'call_mismatch', 'input')
    }
    if (call.output !== 'cliworker.event/v1') {
      addHit(childPath(pointer, 'output'), 'call_mismatch', 'output')
    }
    if (typeof call.cwd !== 'string') {
      addHit(childPath(pointer, 'cwd'), 'call_mismatch', 'cwd')
    }
    if (!Number.isInteger(call.timeout_ms) || call.timeout_ms < 1) {
      addHit(childPath(pointer, 'timeout_ms'), 'call_mismatch', 'timeout_ms')
    }

    const args = call.args
    if (!Array.isArray(args) || args.length !== 8) {
      addHit(childPath(pointer, 'args'), 'call_mismatch', 'args')
      return
    }
    const lease = typeof leaseId === 'string' && leaseId !== '' ? leaseId : null
    const template = [
      wrapper.bin,
      'run',
      '--lease',
      lease === null ? args[3] : lease,
      '--state-dir',
      wrapper.state_dir,
      '--config',
      wrapper.config,
    ]
    for (let i = 0; i < 8; i += 1) {
      if (lease === null && i === 3) {
        if (typeof args[3] !== 'string' || !/^l_[A-Za-z0-9]+$/.test(args[3])) {
          addHit(childPath(childPath(pointer, 'args'), i), 'call_mismatch', 'args[3]')
        }
        continue
      }
      if (args[i] !== template[i]) {
        addHit(childPath(childPath(pointer, 'args'), i), 'call_mismatch', `args[${i}]`)
      }
    }
  }

  const root = { value: view, pointer: '', lease: null }
  const stack = [root]
  const rootModels =
    view && typeof view === 'object' && !Array.isArray(view) && Array.isArray(view.models)
      ? view.models
      : null

  while (stack.length > 0) {
    const frame = stack.pop()
    const { value, pointer, lease } = frame

    if (value === null) continue

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        const item = value[i]
        const path = childPath(pointer, i)
        if (item === null) continue
        if (typeof item === 'string') scanString(item, path)
        else if (typeof item === 'object') stack.push({ value: item, pointer: path, lease })
      }
      continue
    }

    if (typeof value === 'string') {
      scanString(value, pointer)
      continue
    }

    if (typeof value !== 'object') continue

    for (const key of Object.keys(value)) {
      const item = value[key]
      const path = childPath(pointer, key)

      if (key.toLowerCase() === 'call' && item && typeof item === 'object') {
        const siblingLease = typeof value.lease_id === 'string' ? value.lease_id : lease
        checkCall(item, path, siblingLease)
        continue
      }

      if (key === 'calls' && Array.isArray(item) && pointer === '') {
        item.forEach((entry, index) => {
          const model = rootModels === null ? null : rootModels[index]
          const itemLease = model && typeof model.lease_id === 'string' ? model.lease_id : null
          checkCall(entry, childPath(path, index), itemLease)
        })
        continue
      }

      if (keySet.has(key.toLowerCase())) {
        addHit(path, 'forbidden_key', key.toLowerCase())
      }
      scanString(String(key), path)

      if (item === null) continue
      if (typeof item === 'string') scanString(item, path)
      else if (typeof item === 'object') stack.push({ value: item, pointer: path, lease })
    }
  }

  return { ok: hits.length === 0, hits }
}
