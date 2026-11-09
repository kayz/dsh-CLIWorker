window.__ModuleLoader__.load({
  id: 'dsh-cliworker',
  factory(require) {
    const module = { exports: {} }
    const React = require('react')
    const h = React.createElement
    const text = value => value == null || value === '' ? 'unknown' : String(value)

    function SidebarIcon() {
      return h('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }), h('path', { d: 'm7 9 3 3-3 3M12 15h5' }))
    }

// 配置区：DSH 侧栏页面必须能显示配置文件位置与 provider 解析情况，
    // 否则"查不到 CLI"时用户没有任何可操作的入口。
    function configBlock(data) {
      const config = data && data.config
      if (!config || typeof config !== 'object') return null
      const providers = Array.isArray(config.providers) ? config.providers : []
      const callable = (data.models || []).some(model => model && model.availability && model.availability.state === 'callable')
      return h('section', { className: 'cw-config' },
        h('h2', null, '配置'),
        h('p', null, '配置文件：', h('code', null, text(config.path))),
        providers.length
          ? h('ul', null, ...providers.map((provider, index) => h('li', { key: index },
            text(provider.name) + ' -> ' + text(provider.cli) + (provider.resolved ? ' ✔ 已解析' : ' ✘ 未找到'))))
          : null,
        callable ? null : h('div', { role: 'note' },
          h('p', null, '当前没有可用模型。把 CLI 装进 PATH，或在配置里把 providers.<name>.cli 指向可执行文件绝对路径。'),
          config.hint ? h('pre', null, text(config.hint)) : null))
    }

    function Page() {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const live = React.useRef(false)
      const busy = React.useRef(false)
      const session = React.useRef(null)
      const generation = React.useRef(0)

      async function request(path, headers) {
        let response
        try { response = await fetch(path, { method: 'GET', ...(headers ? { headers } : {}) }) } catch { throw new Error(`${path}: network error`) }
        let body
        try { body = await response.json() } catch { throw new Error(`${path}: HTTP ${response.status} invalid JSON`) }
        if (!response.ok) {
          const code = typeof body?.error?.code === 'string' && /^E_[A-Z0-9_]+$/.test(body.error.code) ? body.error.code : ''
          const failure = new Error(`${path}: HTTP ${response.status}${code ? ` ${code}` : ''}`)
          failure.code = code
          throw failure
        }
        return body
      }
      async function refresh() {
        if (busy.current || !live.current) return
        busy.current = true
        const current = generation.current
        const active = () => live.current && generation.current === current
        setLoading(true)
        try {
          async function getSession() {
            const body = await request('/cliworker/api/session')
            if (!active()) return false
            if (body?.schema !== 'cliworker.session/v1' || typeof body.session !== 'string' || !body.session) throw new Error('/cliworker/api/session: invalid response')
            session.current = body.session
            return true
          }
          if (!session.current && !await getSession()) return
          let snapshot
          try { snapshot = await request('/cliworker/api/snapshot', { 'x-cliworker-session': session.current }) } catch (err) {
            if (!active()) return
            if (err.code !== 'E_ADMIN_REQUIRED') throw err
            session.current = null
            if (!await getSession()) return
            snapshot = await request('/cliworker/api/snapshot', { 'x-cliworker-session': session.current })
          }
          if (!active()) return
          if (!snapshot || !Array.isArray(snapshot.models) || !Array.isArray(snapshot.forecast) || !Array.isArray(snapshot.issues) || typeof snapshot.at !== 'string' || typeof snapshot.source !== 'string') throw new Error('/cliworker/api/snapshot: invalid response')
          setData(snapshot)
          setError(null)
        } catch (err) {
          if (active()) setError(err.message)
        } finally {
          if (active()) { busy.current = false; setLoading(false) }
        }
      }
      React.useEffect(() => {
        live.current = true
        refresh()
        return () => { live.current = false; generation.current++; busy.current = false }
      }, [])

      // 以服务端时间戳为参照计算陈旧度（lib/ 的时钟接缝要求，客户端不直接读本机时钟）
      const serverNow = Date.parse(data?.at)
      const nowMs = Number.isFinite(serverNow) ? serverNow : NaN

      const rows = data?.models.map((model, index) => {
        const availability = model?.availability || {}
        const observed = Date.parse(availability.at)
        const stale = !Number.isFinite(observed) || !Number.isFinite(availability.ttl_s) || nowMs - observed > availability.ttl_s * 1000 || data.last_error != null || !!error
        const forecast = data.forecast.find(item => item?.model === model?.key) || {}
        let remaining = 'unknown'
        if (Number.isFinite(forecast.tasks_left)) remaining = text(forecast.tasks_left)
        else if (Number.isFinite(forecast.tasks_left_assumed)) remaining = `unknown (assumed ${forecast.tasks_left_assumed})`
        else if (Number.isFinite(forecast.remaining_fraction)) remaining = `${Math.round(forecast.remaining_fraction * 1000) / 10}%`
        const state = stale ? `stale (${text(availability.state)})` : availability.state === 'callable' && !availability.evidence ? 'unknown' : text(availability.state)
        return h('li', { key: index }, `${text(model?.key)} / ${text(model?.provider)}; allowed ${text(model?.allowed)}; level ${text(model?.level)}; availability ${state}; at ${text(availability.at)}; remaining ${stale ? `stale (${remaining})` : remaining}`)
      })
      return h('section', { style: { padding: '1rem', overflow: 'auto' } },
        h('h1', null, 'CLIWorker'), h('button', { type: 'button', onClick: refresh, disabled: loading }, '刷新'),
        loading && h('p', { role: 'status' }, '加载中…'),
        error && h('p', { role: 'alert' }, `${data ? 'stale: ' : ''}${error}`),
        data && data.last_error != null && h('p', { role: 'alert' }, `stale: snapshot last_error ${text(typeof data.last_error === 'string' ? data.last_error : data.last_error?.code)}`),
        data && h('div', null, h('p', null, `source ${text(data.source)}; at ${text(data.at)}`),
          rows.length ? h('ul', null, ...rows) : h('p', null, '暂无模型'),
          h('h2', null, '问题'), data.issues.length ? h('ul', null, ...data.issues.map((issue, index) => h('li', { key: index }, `${text(issue?.subject ?? issue?.task_id)}; ${text(issue?.detail ?? issue?.code)}; ${text(issue?.summary)}; ${text(issue?.at)}; ${text(issue?.evidence_ref)}`))) : h('p', null, '暂无问题')))
    }

    function apply(ctx) {
      for (const [name, meta, component] of [
        ['sidebar.panellist', { name: 'sidebar.panellist', id: 'cliworker', order: 30, label: 'CLIWorker' }, SidebarIcon],
        ['main', { name: 'main', key: 'cliworker' }, Page],
      ]) {
        try {
          const slots = ctx?.slots
          if (typeof slots?.inject === 'function') slots.inject(name, () => { try { if (typeof slots.register === 'function') slots.register(meta, component) } catch {} })
        } catch {}
      }
    }
    module.exports = { apply, inject: ['slots'], name: 'dsh-cliworker' }
    return module.exports
  },
})
