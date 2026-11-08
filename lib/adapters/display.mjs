// Display-only renderings of a direct call. They are derived from the call for humans; nothing here
// parses shell text back into an executable call, and stdin content or credentials never enter them.

function quotePosix(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}

function quotePwsh(value) {
  return "'" + String(value).replace(/'/g, "''") + "'"
}

function words(call) {
  return [call.command, ...(Array.isArray(call.args) ? call.args : [])]
}

/** A POSIX shell literal: single quotes, with an embedded single quote written as `'\''`. */
export function renderPosix(call) {
  return words(call).map(quotePosix).join(' ')
}

/** A PowerShell invocation: the call operator plus single-quoted literals with `'` doubled. */
export function renderPwsh(call) {
  return `& ${words(call).map(quotePwsh).join(' ')}`
}
