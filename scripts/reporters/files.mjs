// node:test reporter that writes files-executed.json (schema: mode, filter, files, platform, node).
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function toFilePath(value) {
  if (typeof value !== 'string' || value === '') return null
  if (value.startsWith('file:')) {
    try {
      return fileURLToPath(value)
    } catch {
      return null
    }
  }
  return value
}

function relativize(root, file) {
  const absolute = path.isAbsolute(file) ? file : path.resolve(root, file)
  return path.relative(root, absolute).split(path.sep).join('/')
}

export default async function* filesReporter(source) {
  const root = process.env.CLIWORKER_ROOT ? path.resolve(process.env.CLIWORKER_ROOT) : process.cwd()
  const mode = process.env.CLIWORKER_RUN_MODE === 'full' ? 'full' : 'filtered'
  const rawFilter = process.env.CLIWORKER_RUN_FILTER
  const filter = rawFilter !== undefined ? rawFilter : mode === 'full' ? '' : null

  const files = new Set()
  for await (const event of source) {
    const file = toFilePath(event?.data?.file)
    if (file) files.add(relativize(root, file))
  }

  const payload = {
    mode,
    filter,
    files: [...files].sort(),
    platform: process.platform,
    node: process.version,
  }
  yield `${JSON.stringify(payload, null, 2)}\n`
}
