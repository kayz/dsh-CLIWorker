const text = value => value == null || value === '' ? 'unknown' : String(value)

export function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

export function renderModels(snapshot, now) {
  const columns = ['白名单', '等级', '可用性', '余量', '刷新时间', '实测证据']
  const rows = (snapshot?.models || []).map(model => {
    const availability = model.availability || {}
    const observed = Date.parse(availability.at)
    const stale = !Number.isFinite(observed) || !Number.isFinite(availability.ttl_s) || now - observed > availability.ttl_s * 1000 || snapshot.last_error != null
    const forecast = (snapshot.forecast || []).find(item => item.model === model.key) || {}
    let remaining = 'unknown'
    if (Number.isFinite(forecast.tasks_left)) remaining = String(forecast.tasks_left)
    else if (Number.isFinite(forecast.tasks_left_assumed)) remaining = `unknown（估计 ${forecast.tasks_left_assumed}，assumed）`
    else if (Number.isFinite(forecast.remaining_fraction)) remaining = `${Math.round(forecast.remaining_fraction * 1000) / 10}%`
    if (stale && remaining !== 'unknown') remaining = `stale（${remaining}）`
    const source = text(model.source?.kind)
    const at = text(availability.at)
    return {
      title: `${text(model.key)} / ${text(model.provider)}`,
      cells: [model.allowed === true ? '是' : model.allowed === false ? '否' : 'unknown', text(model.level), stale ? `stale（${text(availability.state)}）` : availability.state === 'callable' && !availability.evidence ? 'unknown' : text(availability.state), remaining, `读取 ${text(snapshot.at)}；观测 ${at}`, `${text(availability.evidence?.cmd_redacted)}；exit ${text(availability.evidence?.exit)}；source ${source}；at ${at}`],
    }
  })
  return { columns, rows }
}

export function renderModelsHtml(snapshot, now) {
  const { columns, rows } = renderModels(snapshot, now)
  return `<p>source ${escapeHtml(snapshot?.source)}；at ${escapeHtml(snapshot?.at)}</p><table><thead><tr>${columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.cells.map((cell, i) => `<td>${i === 0 ? `<strong>${escapeHtml(row.title)}</strong> ` : ''}${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
}

export function renderIssuesHtml(issues, origin) {
  return issues.map(issue => {
    const evidence = (issue.evidence || []).map(item => {
      let href = null
      try {
        const url = new URL(item, origin)
        if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin === origin && /^https?:\/\//i.test(item)) href = url.href
      } catch { /* display text only */ }
      const safeText = typeof item === 'string' && /^(?:sessions|logs)\/[\w./-]+$/.test(item) && !item.split('/').includes('..') ? item : 'unknown'
      return href ? `<a href="${escapeHtml(href)}">${escapeHtml(item)}</a>` : `${escapeHtml(safeText)}（证据链接未接入）`
    }).join('；')
    return `<article><p>${escapeHtml(issue.task_id)} · ${escapeHtml(issue.role)} · ${escapeHtml(issue.model)} / ${escapeHtml(issue.provider)} · ${escapeHtml(issue.at)} · ${escapeHtml(issue.code || issue.category)} · ${escapeHtml(issue.summary)} · ${escapeHtml(issue.count)}${issue.unclosed ? ' <strong style="color:red">未闭环</strong>' : ''}</p><details><summary>详情</summary><p>${escapeHtml(issue.raw_output)}</p><p>${evidence}</p><p>${escapeHtml(issue.action)}</p></details></article>`
  }).join('')
}
