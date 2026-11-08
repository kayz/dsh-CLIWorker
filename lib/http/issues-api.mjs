// No production issue source is currently defined. These helpers accept explicit
// records only and never inspect local files or infer issues from logs.
const priority = { blocking: 0, major: 1, minor: 2 }

export function projectIssues(previous, records, filters = {}) {
  const groups = new Map()
  const add = (record, retained = false) => {
    const key = JSON.stringify([record.task_id, record.code || record.category])
    let group = groups.get(key)
    if (!group) {
      group = { ...structuredClone(record), count: 0, events: [] }
      groups.set(key, group)
    }
    const events = retained ? record.events : [JSON.stringify(record)]
    for (const event of events || []) if (!group.events.includes(event)) group.events.push(event)
    group.count = group.events.length
    if (record.unclosed) group.unclosed = true
    if (String(record.at) > String(group.at)) {
      const { count, events, unclosed } = group
      Object.assign(group, structuredClone(record), { count, events, unclosed })
    }
  }
  for (const record of previous || []) if (record.unclosed) add(record, true)
  for (const record of records || []) add(record)
  return [...groups.values()].filter(item => ['task_id', 'role', 'severity'].every(key => !filters[key] || item[key] === filters[key]))
    .sort((a, b) => (priority[a.severity] ?? 3) - (priority[b.severity] ?? 3) || String(b.at).localeCompare(String(a.at)))
}
