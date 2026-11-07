const DEFAULT_FAIL_MESSAGE = 'stub register failed'

export function createHostStub({ failPaths = [], failInject = false, failMessage = DEFAULT_FAIL_MESSAGE } = {}) {
  const registered = []
  const effects = []
  const injectCalls = []
  const handlers = new Map()

  const httpCtx = {
    effect(fn, name) {
      effects.push(name)
      return fn()
    },
    webServer: {
      register(registration) {
        if (!registration || typeof registration !== 'object') throw new TypeError('registration must be an object')
        if (registration.kind !== 'exact') throw new TypeError(`registration kind must be exact, got ${String(registration.kind)}`)
        if (typeof registration.path !== 'string' || !registration.path.startsWith('/')) throw new TypeError(`registration path must start with /, got ${String(registration.path)}`)
        if (typeof registration.handler !== 'function') throw new TypeError('registration handler must be a function')
        if (failPaths.includes('*') || failPaths.includes(registration.path)) throw new Error(`${failMessage}: ${registration.path}`)
        registered.push({ kind: registration.kind, path: registration.path })
        handlers.set(registration.path, registration.handler)
        return undefined
      },
    },
  }

  const ctx = {
    inject(services, callback) {
      injectCalls.push(services)
      if (failInject) throw new Error('stub inject failed')
      return callback(httpCtx)
    },
  }

  function handlerFor(routePath) {
    const handler = handlers.get(routePath)
    if (!handler) throw new Error(`no handler registered for ${routePath}`)
    return handler
  }

  async function request(routePath, options = {}) {
    const {
      method = 'GET',
      url = routePath,
      headers = {},
      remoteAddress = '127.0.0.1',
      host = 'localhost',
      origin,
      body,
    } = options

    const handler = handlerFor(routePath)
    const listeners = new Map()
    const reqHeaders = { ...headers, host }
    if (origin !== undefined) reqHeaders.origin = origin

    const req = {
      method,
      url,
      headers: reqHeaders,
      socket: { remoteAddress },
      on(event, fn) {
        const list = listeners.get(event) || []
        list.push(fn)
        listeners.set(event, list)
        return req
      },
      destroy() {},
    }

    const out = { statusCode: 200, headers: {}, body: '' }
    let finish = () => {}
    const done = new Promise((resolve) => { finish = resolve })

    const res = {
      get statusCode() { return out.statusCode },
      set statusCode(value) { out.statusCode = value },
      setHeader(key, value) { out.headers[String(key).toLowerCase()] = value },
      end(chunk) {
        out.body = chunk === undefined ? '' : String(chunk)
        finish()
      },
    }

    const result = handler(req, res)
    await Promise.resolve()

    const payload = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body))
    if (payload !== '') for (const fn of listeners.get('data') || []) fn(Buffer.from(payload))
    for (const fn of listeners.get('end') || []) fn()

    await done
    if (result && typeof result.then === 'function') await result

    return { statusCode: out.statusCode, headers: out.headers, body: out.body }
  }

  return { ctx, registered, effects, injectCalls, handlerFor, request }
}
