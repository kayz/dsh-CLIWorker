import { renderIssuesHtml, renderModelsHtml } from './render.mjs'

export function startApp({ document, fetch, setTimeout, now = () => Date.now() }) {
  let credentials, pendingSession, pendingRead, snapshot, timer
  const status = document.getElementById('status')
  const list = document.getElementById('model-list')
  const issueSource = document.getElementById('issue-source')
  const issueList = document.createElement?.('div')
  if (issueList) document.getElementById('issues').appendChild(issueList)
  function selectTab(name) {
    for (const tab of ['issues', 'models']) {
      const panel = document.getElementById(tab), button = document.getElementById(`${tab}-tab`)
      if (panel) panel.hidden = tab !== name
      if (button) button.setAttribute('aria-selected', String(tab === name))
    }
  }
  // Keep the last issue rows visible if a poll fails.
  function setIssueSource(value, failure) {
    if (!issueSource) return
    const source = value && (!value.source?.includes('probes unknown') || value.issues?.length) ? '问题来源已接入' : '问题来源未接入'
    if (failure) issueSource.textContent = `${source}；状态 unknown（${failure}，保留上次展示）`
    else if (value?.last_error) issueSource.textContent = `${source}；数据 stale：${value.last_error}；快照 ${value.at || 'unknown'}`
    else issueSource.textContent = `${source}；快照 ${value?.at || 'unknown'}`
  }
  async function session() {
    if (!pendingSession) pendingSession = fetch('/cliworker/api/session').then(async r => { if (!r.ok) throw new Error('session failed'); credentials = await r.json(); return credentials }).finally(() => { pendingSession = null })
    return pendingSession
  }
  async function request(path, options = {}, retry = true) {
    if (!credentials) await session()
    const headers = { ...options.headers, 'x-cliworker-session': credentials.session }
    if (options.method === 'POST') headers['x-cliworker-csrf'] = credentials.csrf
    const response = await fetch(path, { ...options, headers })
    const value = await response.json()
    if (!response.ok && value?.error?.code === 'E_ADMIN_REQUIRED' && retry) { await session(); return request(path, options, false) }
    if (!response.ok) throw new Error(value?.error?.code || 'request failed')
    return value
  }
  async function read() {
    if (pendingRead) return pendingRead
    pendingRead = (async () => {
      try { snapshot = await request('/cliworker/api/snapshot'); status.textContent = snapshot.last_error ? `stale：${snapshot.last_error}；${snapshot.at || 'unknown'}` : '已更新'; list.innerHTML = renderModelsHtml(snapshot, now()); if (issueList) issueList.innerHTML = renderIssuesHtml(snapshot.issues || []); setIssueSource(snapshot) }
      catch { status.textContent = `stale：读取失败；${new Date(now()).toISOString()}`; setIssueSource(snapshot, '读取失败'); if (snapshot) list.innerHTML = renderModelsHtml({ ...snapshot, last_error: '读取失败' }, now()) }
    })().finally(() => { pendingRead = null })
    return pendingRead
  }
  async function tick() { await read(); timer = setTimeout(tick, 15000) }
  selectTab('issues')
  for (const name of ['issues', 'models']) document.getElementById(`${name}-tab`).addEventListener('click', () => {
    selectTab(name)
  })
  for (const button of document.querySelectorAll('[data-job]')) button.addEventListener('click', async () => {
    try { await request(`/cliworker/api/${button.dataset.job}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); await read() } catch { status.textContent = 'stale：操作失败'; if (snapshot) list.innerHTML = renderModelsHtml({ ...snapshot, last_error: '操作失败' }, now()) }
  })
  tick()
  return { read, get timer() { return timer } }
}

if (typeof document !== 'undefined') startApp({ document, fetch, setTimeout })
