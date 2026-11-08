import path from 'node:path'

// Denials are supplied by the caller; no production secret-path list is defined by the contract.
export function createFsx(fs, { platform = 'linux', deny = [], cwd } = {}) {
  const p = platform === 'win32' ? path.win32 : path.posix
  const base = cwd || (platform === 'win32' ? 'C:\\' : '/')
  const normalize = value => {
    const absolute = p.resolve(base, value)
    return platform === 'win32' ? absolute.toLowerCase() : absolute
  }
  const denied = deny.map(normalize)
  function allowed(value) {
    const target = normalize(value)
    return !denied.some(item => target === item || target.startsWith(item.endsWith(p.sep) ? item : item + p.sep))
  }
  function reject() {
    const error = new Error('access denied')
    error.code = 'EACCES'
    throw error
  }
  // Resolve links one component at a time, checking each target before any access to it.
  function safePath(value) {
    let current = p.resolve(base, value)
    for (let links = 0; links < 40; links += 1) {
      if (!allowed(current)) reject()
      const root = p.parse(current).root
      const parts = current.slice(root.length).split(p.sep).filter(Boolean)
      let parent = root
      let redirected = false
      for (let i = 0; i < parts.length; i += 1) {
        parent = p.join(parent, parts[i])
        if (!allowed(parent)) reject()
        const info = fs.lstatSync(parent)
        if (info.isSymbolicLink()) {
          const dest = fs.readlinkSync(parent)
          current = p.resolve(p.dirname(parent), dest, ...parts.slice(i + 1))
          if (!allowed(current)) reject()
          redirected = true
          break
        }
      }
      if (!redirected) return current
    }
    reject()
  }
  return {
    allowed,
    safePath,
    statSync(value) { return fs.statSync(safePath(value)) },
    readdirSync(value, options) { return fs.readdirSync(safePath(value), options) },
    realpathSync(value) { return safePath(value) },
    readFileSync(value, options) { return fs.readFileSync(safePath(value), options) },
  }
}
