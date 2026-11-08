// Direct-call construction for `cli resolve`. Pure functions: no IO, no clock, no process state.
//
// Every argument vector below is a form that was already declared by this repository (the legacy
// selection path in lib/select.mjs and the bundled example configuration). A provider that has no
// declared vector, or that only had a shell-concatenated form, is reported as `adapter_unverified`
// instead of being guessed. Parameter names are never invented from a model key.
const NATIVE_PLATFORMS = new Set(['win32', 'darwin', 'linux'])

function declaredFor(model, config) {
  const overrides = config && config.discovery ? config.discovery.cli_overrides : undefined
  const entry = overrides && typeof overrides === 'object' ? overrides[model.provider] : undefined
  return entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}
}

function executableOf(model, declared) {
  if (typeof declared.cli === 'string' && declared.cli !== '') return declared.cli
  if (typeof model.cli === 'string' && model.cli !== '') return model.cli
  return null
}

function envNamesOf(declared) {
  return Array.isArray(declared.env_names)
    ? declared.env_names.filter((name) => typeof name === 'string' && name !== '')
    : []
}

/**
 * The declared argument vector a provider takes after its executable, or a rejection reason.
 * `readonly` only adds a switch that the repository already records for that CLI; asking for a
 * read-only call from a CLI without such a switch is `readonly_unavailable`, never a guess.
 */
function providerArguments(provider, id, { readonly }) {
  switch (provider) {
    case 'claude':
      return {
        args: [
          '-p',
          '--model',
          id,
          '--output-format',
          'stream-json',
          '--verbose',
          ...(readonly ? ['--permission-mode', 'plan'] : []),
        ],
        reason: null,
      }
    case 'codex':
      return { args: ['exec', '--model', id, '-s', 'read-only', '--skip-git-repo-check', '--json'], reason: null }
    case 'codebuddy':
      if (readonly) return { args: null, reason: 'readonly_unavailable' }
      return { args: ['-p', '--model', id, '--output-format', 'stream-json', '--verbose'], reason: null }
    case 'gemini':
      if (readonly) return { args: null, reason: 'readonly_unavailable' }
      return { args: ['-m', id, '-p'], reason: null }
    default:
      return { args: null, reason: 'adapter_unverified' }
  }
}

function isWsl(platform) {
  return typeof platform === 'string' && platform.startsWith('wsl:')
}

/**
 * Parses `--platform`. Omitted means the host platform from ctx; `wsl:<distro>` is the only
 * non-native form. Anything else is a request error rather than a silent fallback.
 */
export function parsePlatform(value, fallback) {
  const platform = value === undefined ? fallback : value
  if (typeof platform !== 'string' || platform === '') {
    const error = new Error(`unsupported platform: ${String(platform)}`)
    error.code = 'E_REQUEST_INVALID'
    throw error
  }
  if (NATIVE_PLATFORMS.has(platform)) return platform
  const wsl = /^wsl:(\S+)$/.exec(platform)
  if (wsl) return platform
  const error = new Error(`unsupported platform: ${platform}`)
  error.code = 'E_REQUEST_INVALID'
  throw error
}

/**
 * Builds the direct call for one resolved model.
 *
 * Returns `{ call, reason }`: on success `reason` is null and `call` is
 * `{command, args, cwd, input:'stdin', env_names}`; otherwise `call` is null and `reason` is one of
 * the registry reject reasons (`adapter_unverified`, `readonly_unavailable`).
 *
 * A WSL target keeps the directory and the model as separate `--cd` / `--exec` arguments; it never
 * goes through `bash -lc`, `sh -c` or `cd … && …`, and the host cwd is not passed as the target cwd.
 */
export function buildDirectCall({ model, config, cwd, platform, readonly = false } = {}) {
  if (!model || typeof model.provider !== 'string' || model.provider === '') {
    return { call: null, reason: 'adapter_unverified' }
  }
  if (typeof model.id !== 'string' || model.id === '') {
    return { call: null, reason: 'adapter_unverified' }
  }
  const declared = declaredFor(model, config)
  const built = providerArguments(model.provider, model.id, { readonly: readonly === true })
  if (built.args === null) return { call: null, reason: built.reason }

  const command = executableOf(model, declared)
  if (command === null) return { call: null, reason: 'adapter_unverified' }

  const prefix = Array.isArray(declared.args_prefix)
    ? declared.args_prefix.filter((value) => typeof value === 'string')
    : []
  const args = [...prefix, ...built.args]
  const env_names = envNamesOf(declared)
  const directory = typeof cwd === 'string' ? cwd : ''

  if (isWsl(platform)) {
    const distro = platform.slice('wsl:'.length)
    return {
      call: {
        command: 'wsl.exe',
        args: ['-d', distro, '--cd', directory, '--exec', command, ...args],
        cwd: null,
        input: 'stdin',
        env_names,
      },
      reason: null,
    }
  }

  return {
    call: { command, args, cwd: directory, input: 'stdin', env_names },
    reason: null,
  }
}
