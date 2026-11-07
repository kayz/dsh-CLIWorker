#!/usr/bin/env node
// Renders docs/contract.md from the registry snapshot, the manifest and the schema directory.
// The output depends only on repository files: no clock, no absolute paths, no environment.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..')
const DOC_REL = 'docs/contract.md'
const USAGE = 'usage: node scripts/gen-contract-doc.mjs [--root <dir>]'

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function cell(value) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/\|/g, '\\|')
}

function table(headers, rows) {
  const lines = [`| ${headers.map(cell).join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`]
  for (const row of rows) lines.push(`| ${row.map(cell).join(' | ')} |`)
  return lines
}

function thresholdRows(rows) {
  return rows.map((row) => [row.risk, row.op, row.value === null ? '' : String(row.value)])
}

export function renderContractDoc(root) {
  const base = path.resolve(root ?? '.')
  const registry = readJson(path.join(base, 'contracts', 'registry.snapshot.json'))
  const manifest = readJson(path.join(base, 'contracts', 'golden', 'manifest.json'))
  const schemaDir = path.join(base, 'contracts', 'schemas')
  const schemas = fs
    .readdirSync(schemaDir)
    .filter((name) => name.endsWith('.schema.json'))
    .sort()

  const lines = []
  lines.push('# CLIWorker 契约（自动生成）')
  lines.push(
    `> 本文件由 scripts/gen-contract-doc.mjs 生成，请勿手改。snapshot_version: ${registry.snapshot_version}`
  )
  lines.push('')

  lines.push('## 1. 错误码')
  lines.push('')
  lines.push(...table(['code', 'exit', 'http_status', 'retryable', 'trigger_id', 'trigger'], registry.codes.map((entry) => [
    entry.code,
    entry.exit,
    entry.http_status,
    entry.retryable,
    entry.trigger_id,
    entry.trigger,
  ])))
  lines.push('')
  lines.push('退出码 0 表示成功（含 truncated），不是错误码，不进入本表。')
  lines.push('')

  lines.push('## 2. 403 触发与判定顺序')
  lines.push('')
  const forbidden = registry.codes.filter((entry) => entry.http_status === 403)
  lines.push(...table(['code', 'exit', 'trigger_id'], forbidden.map((entry) => [entry.code, entry.exit, entry.trigger_id])))
  lines.push('')
  lines.push(`写路由判定顺序：${registry.write_route_order.join(' > ')}。`)
  lines.push('')

  lines.push('## 3. 警告码')
  lines.push('')
  for (const code of registry.warning_codes) lines.push(`- ${code}`)
  lines.push('')

  lines.push('## 4. 拒选原因')
  lines.push('')
  lines.push('### v1')
  lines.push('')
  for (const reason of registry.reject_reasons.v1) lines.push(`- ${reason}`)
  lines.push('')
  lines.push('### admin_only')
  lines.push('')
  for (const reason of registry.reject_reasons.admin_only) lines.push(`- ${reason}`)
  lines.push('')
  lines.push('### draft')
  lines.push('')
  for (const reason of registry.reject_reasons.draft) lines.push(`- ${reason}`)
  lines.push('')

  lines.push('## 5. draft 到 v1 的原因映射')
  lines.push('')
  lines.push(...table(['draft', 'v1'], registry.draft_reason_mapping.map((entry) => [entry.draft, entry.v1])))
  lines.push('')

  lines.push('## 6. forecast 枚举与阈值')
  lines.push('')
  lines.push('### forecast_reasons')
  lines.push('')
  for (const reason of registry.forecast_reasons) lines.push(`- ${reason}`)
  lines.push('')
  lines.push(`### risk`)
  lines.push('')
  lines.push(registry.risk.join(', '))
  lines.push('')
  lines.push('### risk_basis')
  lines.push('')
  lines.push(registry.risk_basis.join(', '))
  lines.push('')
  lines.push('### tasks_left_basis')
  lines.push('')
  lines.push(registry.tasks_left_basis.join(', '))
  lines.push('')
  lines.push('### thresholds.tasks')
  lines.push('')
  lines.push(...table(['risk', 'op', 'value'], thresholdRows(registry.thresholds.tasks)))
  lines.push('')
  lines.push('### thresholds.fraction')
  lines.push('')
  lines.push(...table(['risk', 'op', 'value'], thresholdRows(registry.thresholds.fraction)))
  lines.push('')
  lines.push('### thresholds.priority')
  lines.push('')
  lines.push(registry.thresholds.priority.join(' > '))
  lines.push('')

  lines.push('## 7. 可用性与 identity')
  lines.push('')
  lines.push('### availability')
  lines.push('')
  lines.push(registry.availability.join(', '))
  lines.push('')
  lines.push('### identity')
  lines.push('')
  lines.push(registry.identity.join(', '))
  lines.push('')

  lines.push('## 8. semantic_change')
  lines.push('')
  for (const item of registry.semantic_change) lines.push(`- ${item}`)
  lines.push('')

  lines.push('## 9. 规格与金标登记清单')
  lines.push('')
  lines.push(...table(['path', 'sha256'], manifest.files.map((entry) => [entry.path, entry.sha256])))
  lines.push('')

  lines.push('## 10. 契约 schema 清单')
  lines.push('')
  for (const name of schemas) lines.push(`- ${name}`)
  lines.push('')

  return `${lines.join('\n')}`
}

function main(argv) {
  let root = REPO_ROOT
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--root') {
      const value = argv[i + 1]
      if (typeof value !== 'string' || value === '') {
        process.stderr.write(`gen-contract-doc: --root requires a directory\n${USAGE}\n`)
        process.exitCode = 2
        return
      }
      root = path.resolve(value)
      i += 1
    } else {
      process.stderr.write(`gen-contract-doc: unknown argument: ${flag}\n${USAGE}\n`)
      process.exitCode = 2
      return
    }
  }

  const rendered = renderContractDoc(root)
  const target = path.join(root, DOC_REL)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, rendered, 'utf8')
  process.stdout.write(`gen-contract-doc: wrote ${DOC_REL} (${Buffer.byteLength(rendered, 'utf8')} bytes)\n`)
  process.exitCode = 0
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()

if (invokedDirectly) main(process.argv.slice(2))
