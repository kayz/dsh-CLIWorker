import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { normalizeRequest } from '../lib/request.mjs'
import { generateFakeCli, readFakeCliRecords } from '../test/helpers/fake-cli.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const required = ['README.md', 'docs/agentline-integration.md', 'docs/migration.md', 'docs/ui.md', 'docs/platforms.md', 'docs/host-contract.md']
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const fail = (p, message) => { throw new Error(`${p}: ${message}`) }

export function checkMigration(text, registry, map) {
  const sections = [...text.matchAll(/^###\s+`?([^`\n]+?)`?\s*\n([\s\S]*?)(?=^#{1,3}\s|$(?![\s\S]))/gm)]
  for (const id of registry.semantic_change) {
    const matches = sections.filter(x => x[1].trim() === id)
    if (matches.length !== 1 || !matches[0][2].split('\n').some(x => x.trim() && !/^\s*(?:\||<!--|#)/.test(x))) fail('docs/migration.md', `section ${id}`)
  }
  const rows = text.split('\n').filter(x => /^\s*\|/.test(x)).map(x => x.split('|').slice(1, -1).map(c => c.replace(/`/g, '').trim()))
  for (const item of [...map.draft_to_v1.reasons, ...map.draft_to_v1.fields, ...map.config_v1_to_v2]) {
    const found = rows.filter(x => x[0] === item.id)
    const targets = item.v1 === undefined ? item.to : [item.v1]
    if (found.length !== 1 || found[0][1] !== (item.draft ?? item.from) || (targets.length ? found[0][2].split(',').map(x => x.trim()).join('\0') !== targets.join('\0') : found[0][2] !== '移除')) fail('docs/migration.md', `mapping ${item.id}`)
  }
}

export function parseCommand(line) {
  if (/[|;&<>`$\r\n]/.test(line)) throw new Error('unsupported syntax')
  const parts = []; let part = ''; let quote = ''; let active = false
  for (const ch of line) {
    if (quote) { if (ch === quote) quote = ''; else part += ch; active = true }
    else if (ch === "'" || ch === '"') { quote = ch; active = true }
    else if (/\s/.test(ch)) { if (active) { parts.push(part); part = ''; active = false } }
    else { part += ch; active = true }
  }
  if (quote) throw new Error('unclosed quote')
  if (active) parts.push(part)
  if (parts[0] !== 'node' || parts[1] !== 'bin/cliworker.mjs' || parts.length < 3) throw new Error('unsupported command')
  if (parts.some(x => x.includes('..') || path.isAbsolute(x))) throw new Error('unsupported path')
  return parts.slice(2)
}

export function extractBlocks(text, file, strict = true) {
  const lines = text.replace(/\r\n/g, '\n').split('\n'); const blocks = []
  for (let i = 0; i < lines.length; i++) {
    const open = /^```([^\s`]*)(?:\s+[^`]*)?\s*$/.exec(lines[i]); if (!open) continue
    let before = i - 1; while (before >= 0 && !lines[before].trim()) before--
    const marker = lines[before]?.trim() ?? ''; const body = []; i++
    while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++])
    if (i === lines.length) fail(file, 'unclosed block')
    const language = open[1].toLowerCase(); const runnable = marker === '可运行：'; const skipped = /^不可运行：\S/.test(marker)
    if (/^(?:可运行|不可运行)/.test(marker) && !runnable && !skipped) fail(file, 'invalid marker')
    if ((runnable || skipped) && !body.join('\n').trim()) fail(file, 'empty block')
    if (strict && language && !['json', 'text', 'pwsh', 'sh', 'bash', 'javascript', 'js', 'mjs'].includes(language)) fail(file, 'unknown code language')
    if (runnable && language !== 'pwsh') fail(file, 'unsupported runnable language')
    if (strict && !['json', 'text', ''].includes(language) && !runnable && !skipped) fail(file, 'unmarked code block')
    if (runnable) blocks.push(body.filter(x => x.trim()).map(parseCommand))
    if (strict && language === 'json' && file === 'README.md') {
      const request = JSON.parse(body.join('\n')); if (request.schema === 'cliworker.request/v1' && normalizeRequest(request).warnings.some(x => x.code === 'W_FIELD_IGNORED')) fail(file, 'unknown request field')
    }
    if (file === 'README.md' && ['pwsh', 'bash', 'sh'].includes(language)) {
      for (const line of body.filter(x => x.includes('models select') && x.includes('--request '))) {
        const argv = parseCommand(line)
        const request = JSON.parse(argv[argv.indexOf('--request') + 1])
        if (normalizeRequest(request).warnings.some(x => x.code === 'W_FIELD_IGNORED')) fail(file, 'unknown request field')
      }
    }
  }
  return blocks
}

export function fixture(dir) {
  const state = path.join(dir, 'state'), at = new Date().toISOString(), ms = Date.parse(at), model = 'claude:one'
  fs.mkdirSync(state, { recursive: true })
  const fake = generateFakeCli({ dir, name: 'fake', mode: 'ok', help: 'help', version: '1.0', models: '', modelsArgv: ['models'], recordDir: path.join(dir, 'records') })
  const modelRecord = { schema: 'cliworker.model/v1', key: model, id: 'one', cli: process.execPath, provider: 'claude', vendor: 'anthropic', aliases: [], allowed: false, level: 'Top', level_source: { kind: 'config', ref: 'fixture', at }, availability: { state: 'unverified', reason: null, at: null, ttl_s: null, evidence: null }, identity: 'verified', capabilities: { context_tokens: 200000, readonly: true, stdin: true }, prices: { input_per_mtok: 3, output_per_mtok: 15, source: 'manual' }, source: { kind: 'manual', ref: 'fixture', at }, deprecated: false }
  const probe = { ...modelRecord, availability: { state: 'callable', reason: null, at, ttl_s: 86400, evidence: { probe_id: 'fixture', cmd_redacted: 'node', exit: 0, duration_ms: 1, nonce_ok: true, reported_model: model, tokens: null } } }
  const config = { schema: 'cliworker.config/v2', state_dir: state, secrets: {}, discovery: { extra_dirs: [], wsl: false, probe_unknown: false, unknown_patterns: [], cli_overrides: { claude: { cli: process.execPath, args_prefix: [fake], adapter: 'claude', readonly: true, env_names: [] } } }, catalog: { allow: [model], levels: { [model]: 'Top' }, aliases: {}, deprecated: {}, manual: [modelRecord] }, pools: [{ id: 'claude:plan', cli: 'claude', kind: 'plan_window', funding: 'plan', window: { length_s: 18000, anchor: 'rolling', start_at: new Date(ms - 3600000).toISOString(), reset_at: new Date(ms + 3600000).toISOString(), reset_source: 'config' }, capacity_mtok: { [model]: { value: 10, source: 'config' } }, used_fraction: { value: 0.5, source: 'config', at }, credits_per_mtok: null }], policy: { probe_ttl_s: 21600, lease_ttl_s: 7200, reading_ttl_s: 600, lock_stale_ms: 30000, lock_wait_ms: 5000, lock_poll_ms: 25, session_ttl_s: 43200, reserve_fraction_for_high: 0.15, unknown_policy: 'after_known', usage_estimate_mtok: { Heavy: 2, Normal: 0.5, Light: 0.1 }, cache_read_weight: 0, probe_schedule: null } }
  const configPath = path.join(dir, 'config.json'); fs.writeFileSync(configPath, JSON.stringify(config)); fs.writeFileSync(path.join(state, 'probes.json'), JSON.stringify([probe]))
  const legacyPath = path.join(dir, 'legacy.json')
  fs.writeFileSync(legacyPath, JSON.stringify({ schema: 'cliworker.config/v1', state_dir: state, providers: { fixture: { cli: process.execPath, args_prefix: [fake], readonly: true } }, models: { q: { provider: 'fixture', id: 'q', level: 'Quick', identity: 'verified' } } }))
  fs.writeFileSync(path.join(dir, 'request.json'), JSON.stringify({ schema: 'cliworker.request/v1', level: 'Top', count: 1 }))
  return { configPath, legacyPath, state, fake }
}

function runBlock(block, file) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-doc-'))
  try {
    const f = fixture(dir); const env = { CLIWORKER_HOME: path.join(dir, 'home') }
    for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key]
    const fakeScript = process.platform === 'win32' ? f.fake.replace(/\.cmd$/, '.mjs') : f.fake
    const probe = spawnSync(process.execPath, [fakeScript, '--version'], { cwd: dir, env, encoding: 'utf8', timeout: 10000 })
    if (probe.status !== 0 || !readFakeCliRecords(path.join(dir, 'records')).length) fail(file, 'fixture failed')
    for (const commandArgs of block) {
      const args = [...commandArgs]
      if (args.includes('--request')) {
        const request = JSON.parse(args[args.indexOf('--request') + 1]); if (normalizeRequest(request).warnings.some(x => x.code === 'W_FIELD_IGNORED')) fail(file, 'unknown request field')
      }
      for (const [flag, allowed] of [['--config', ['config.json', 'legacy.json']], ['--state-dir', ['state']], ['--request-file', ['request.json']]]) {
        const index = args.indexOf(flag)
        if (index < 0) continue
        if (!allowed.includes(args[index + 1]) || args.lastIndexOf(flag) !== index) fail(file, `unsupported ${flag} path`)
        args[index + 1] = path.join(dir, args[index + 1])
      }
      if (args.includes('--request-file')) {
        const request = JSON.parse(fs.readFileSync(args[args.indexOf('--request-file') + 1], 'utf8'))
        if (normalizeRequest(request).warnings.some(x => x.code === 'W_FIELD_IGNORED')) fail(file, 'unknown request field')
      }
      const configPath = args[0] === 'models' && args[1] === 'list' ? f.legacyPath : f.configPath
      const result = spawnSync(process.execPath, [path.join(root, 'bin/cliworker.mjs'), ...args, ...(args.includes('--config') ? [] : ['--config', configPath])], { cwd: dir, env, encoding: 'utf8', timeout: 15000, windowsHide: true })
      if (result.status !== 0 || result.error) {
        let code = 'unknown'; try { code = JSON.parse(result.stdout).error?.code ?? code } catch {}
        fail(file, `command failed or timed out (${code})`)
      }
      let json; try { json = JSON.parse(result.stdout) } catch { fail(file, 'invalid JSON output') }
      if (json.ok === false || json.warnings?.some(x => x.code === 'W_FIELD_IGNORED')) fail(file, 'unsuccessful response')
      if (args[0] === 'models' && args[1] === 'select' && (!json.calls?.length || json.count_returned !== json.calls.length || json.count_returned !== json.count_requested)) fail(file, 'empty or incomplete selection')
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

export function checkDocs(overrides = {}) {
  const document = file => Object.hasOwn(overrides, file) ? overrides[file] : read(file)
  for (const file of required) if (!document(file).trim()) fail(file, 'empty')
  const readme = document('README.md'); for (const file of required.slice(1)) if (!readme.includes(`](${file})`)) fail('README.md', `missing link ${file}`)
  checkMigration(document('docs/migration.md').replace(/\r\n/g, '\n'), JSON.parse(read('contracts/registry.snapshot.json')), JSON.parse(read('contracts/spec/migration-map.json')))
  const files = ['README.md', ...fs.readdirSync(path.join(root, 'docs')).filter(x => x.endsWith('.md')).map(x => `docs/${x}`)]
  let count = 0, readmeCount = 0, docsCount = 0
  for (const file of files) {
    const content = document(file)
    for (const match of content.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0]; if (!target || /^(?:https?:|mailto:)/.test(target)) continue
      if (!fs.existsSync(path.resolve(root, path.dirname(file), decodeURIComponent(target)))) fail(file, `broken link ${target}`)
    }
    const internalDirectory = ['.', 'collab'].join('')
    if (required.includes(file) && (content.toLowerCase().includes(internalDirectory) || /(?:\bT-\d{3}\b|[A-Za-z]:[\\/]|\/Users\/|\/home\/)/i.test(content))) fail(file, 'internal or absolute path')
    const blocks = extractBlocks(content, file, required.includes(file)); for (const block of blocks) { runBlock(block, file); count += block.length; if (file === 'README.md') readmeCount += block.length; else docsCount += block.length }
  }
  if (!count || !readmeCount || !docsCount) fail('docs', 'missing runnable examples')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { checkDocs(); console.log('check-docs: ok') } catch (error) { console.error(error.message); process.exitCode = 1 }
}
