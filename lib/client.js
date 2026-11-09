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
    function configBlock(data, loading, error) {
      const config = data && data.config
      const valid = config && typeof config === 'object' && !Array.isArray(config)
      const providers = valid && Array.isArray(config.providers) ? config.providers : null
      const callable = Array.isArray(data?.models) && data.models.some(model => model && model.availability && model.availability.state === 'callable')
      return h('section', { className: 'cw-config' },
        h('h2', null, '配置'),
        loading && !data ? h('p', null, '加载中…') : !valid ? h('div', null,
          h('p', null, '配置摘要不可用，请刷新重试，查看 README.md 的配置说明。'),
          h('p', null, '配置文件：unknown；provider 解析状态：unknown')) : h('div', null,
        error ? h('p', null, '上次数据') : null,
        h('p', null, '配置文件：', h('code', null, text(config.path))),
        providers && providers.length
          ? h('ul', null, ...providers.map((provider, index) => h('li', { key: index },
            text(provider?.name) + ' -> ' + text(provider?.cli) + (provider?.resolved === true ? ' ✔ 已解析' : provider?.resolved === false ? ' ✘ 未找到' : ' unknown'))))
          : h('p', null, 'provider 解析状态不可用'),
        callable ? null : h('div', { role: 'note' },
          h('p', null, '当前没有可用模型。把 CLI 装进 PATH，或在配置里把 providers.<name>.cli 指向可执行文件绝对路径。'),
          config.hint ? h('pre', null, text(config.hint)) : null)))
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
          if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || typeof snapshot.at !== 'string' || typeof snapshot.source !== 'string') throw new Error('/cliworker/api/snapshot: invalid response')
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

      const rows = (Array.isArray(data?.models) ? data.models : []).map((model, index) => {
        const availability = model?.availability || {}
        const observed = Date.parse(availability.at)
        const stale = !Number.isFinite(observed) || !Number.isFinite(availability.ttl_s) || nowMs - observed > availability.ttl_s * 1000 || data.last_error != null || !!error
        const forecast = (Array.isArray(data.forecast) ? data.forecast : []).find(item => item?.model === model?.key) || {}
        let remaining = 'unknown'
        if (Number.isFinite(forecast.tasks_left)) remaining = text(forecast.tasks_left)
        else if (Number.isFinite(forecast.tasks_left_assumed)) remaining = `unknown (assumed ${forecast.tasks_left_assumed})`
        else if (Number.isFinite(forecast.remaining_fraction)) remaining = `${Math.round(forecast.remaining_fraction * 1000) / 10}%`
        const safeState = availability.state === 'callable' && !availability.evidence ? 'unknown' : text(availability.state)
        const state = stale ? `stale (${safeState})` : safeState
        return h('li', { key: index }, `${text(model?.key)} / ${text(model?.provider)}; allowed ${text(model?.allowed)}; level ${text(model?.level)}; availability ${state}; at ${text(availability.at)}; remaining ${stale ? `stale (${remaining})` : remaining}`)
      })
      return h('section', { style: { padding: '1rem', overflow: 'auto' } },
        h('h1', null, 'CLIWorker'), h('button', { type: 'button', onClick: refresh, disabled: loading }, '刷新'),
        h('p', { role: 'status' }, loading ? (data ? '正在更新；' : '加载中…；') : error && data ? '上次数据；' : '', `source ${text(data?.source)}; at ${text(data?.at)}`),
        h('section', { className: 'cw-models' }, h('h2', null, '模型'),
          error && h('div', { role: 'alert' }, `${data ? 'stale: ' : ''}读取失败：${error}`, h('button', { type: 'button', onClick: refresh, disabled: loading }, '重试')),
          data && data.last_error != null && h('p', { role: 'alert' }, `stale: snapshot last_error ${text(typeof data.last_error === 'string' ? data.last_error : data.last_error?.code)}`),
          loading && !data ? h('p', null, '加载中…') : data ? (rows.length ? h('ul', null, ...rows) : h('p', null, '暂无模型，请查看下方配置区，配置后刷新。')) : null),
        h('section', { className: 'cw-issues' }, h('h2', null, '问题'),
          loading && !data ? h('p', null, '加载中…') : !Array.isArray(data?.issues) ? h('p', null, '暂无问题数据，请使用顶部刷新重读。') : data.issues.length ? h('ul', null, ...data.issues.map((issue, index) => h('li', { key: index }, `${text(issue?.subject ?? issue?.task_id)}; ${text(issue?.detail ?? issue?.code)}; ${text(issue?.summary)}; ${text(issue?.at)}; ${text(issue?.evidence_ref)}`))) : h('p', null, '暂无问题')),
        configBlock(data, loading, error))
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
