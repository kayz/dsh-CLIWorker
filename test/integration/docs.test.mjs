import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { checkDocs, checkEvents, checkMigration, checkSensitive, extractBlocks, parseCommand, runBlock } from '../../scripts/check-docs.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = p => fs.readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
const migration = read('docs/migration.md').replace(/\r\n/g, '\n')
const registry = JSON.parse(read('contracts/registry.snapshot.json'))
const map = JSON.parse(read('contracts/spec/migration-map.json'))

test('[AC-067] real documentation executes offline', () => {
  const result = spawnSync(process.execPath, ['scripts/check-docs.mjs'], { cwd: root, encoding: 'utf8', timeout: 60000 })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /check-docs: ok/)
})

test('[AC-067] migration requires prose, every source and every target', () => {
  checkMigration(migration, registry, map)
  const id = registry.semantic_change[0]
  assert.throws(() => checkMigration(migration.replace(`### ${id}`, '### other'), registry, map))
  assert.throws(() => checkMigration(migration.replace(/### forecast\.tasks_left\n[\s\S]*?(?=### )/, '### forecast.tasks_left\n\n'), registry, map))
  const item = map.draft_to_v1.reasons[0]
  assert.throws(() => checkMigration(migration.split('\n').filter(line => !line.includes('`' + item.id + '`')).join('\n'), registry, map))
  assert.throws(() => checkMigration(migration.replace(`| \`${item.id}\` | \`${item.draft}\` | \`${item.v1}\``, `| \`${item.id}\` | \`${item.draft}\` | wrong`), registry, map))
  for (const entry of [...map.draft_to_v1.reasons, ...map.draft_to_v1.fields, ...map.config_v1_to_v2]) {
    assert.throws(() => checkMigration(migration.split('\n').filter(line => !line.startsWith(`| \`${entry.id}\` |`)).join('\n'), registry, map))
    const line = migration.split('\n').find(line => line.startsWith(`| \`${entry.id}\` |`))
    const cells = line.split('|'); cells[3] = ' wrong '
    assert.throws(() => checkMigration(migration.replace(line, cells.join('|')), registry, map))
  }
  for (const name of registry.semantic_change) assert.throws(() => checkMigration(migration.replace(`### ${name}\n`, '### missing\n'), registry, map))
})

test('[AC-067] parser rejects unsafe or malformed examples', () => {
  assert.deepEqual(parseCommand('node bin/cliworker.mjs models list --config "a b.json"'), ['models', 'list', '--config', 'a b.json'])
  for (const line of ['node bin/cliworker.mjs x | node x', 'node bin/cliworker.mjs x "bad', 'echo hello', 'node bin/cliworker.mjs x ../bad']) assert.throws(() => parseCommand(line))
  assert.equal(extractBlocks('可运行：\r\n```pwsh\r\nnode bin/cliworker.mjs usage summary\r\n```', 'example').length, 1)
  assert.throws(() => extractBlocks('```pwsh\nnode bin/cliworker.mjs x\n```', 'example'))
  assert.throws(() => extractBlocks('可运行：\n```pwsh\n', 'example'))
  assert.throws(() => extractBlocks('可运行：\n```bash\nx\n```', 'example'))
  assert.throws(() => extractBlocks('可运行：\n```pwsh\n```', 'example'))
  assert.throws(() => extractBlocks('可运行：\n不可运行：外部条件\n```pwsh\nnode bin/cliworker.mjs paths\n```', 'example'))
  assert.throws(() => extractBlocks('不可运行：需要环境\n```unknown\nanything\n```', 'example'))
  assert.throws(() => extractBlocks('```json\n{"schema":"cliworker.request/v1","level":"Top","role":"x"}\n```', 'README.md'))
})

test('[AC-067] subprocess failures and timeouts fail without leaking fixture paths', () => {
  assert.throws(() => runBlock([parseCommand('node bin/cliworker.mjs no-such-command')], 'example'), /command failed/)
  assert.throws(() => runBlock([parseCommand('node bin/cliworker.mjs usage summary')], 'example', { timeoutMs: 1 }), /timed out/)
})

test('[AC-067] event stream and credentials are checked', () => {
  const event = (seq, type, extra = {}) => JSON.stringify({ schema: 'cliworker.event/v1', seq, type, ...extra })
  const valid = [event(1, 'start'), event(2, 'result', { ok: true, exit_code: 0 })].join('\n')
  checkEvents(valid, 'example')
  for (const invalid of ['', 'not json', event(1, 'start'), [event(1, 'start'), event(2, 'error')].join('\n'), [event(1, 'start'), event(3, 'result', { ok: true, exit_code: 0 })].join('\n')]) assert.throws(() => checkEvents(invalid, 'example'))
  checkSensitive('{"ref":"env:EXAMPLE_SECRET"}', 'example')
  assert.throws(() => checkSensitive('api_key = "' + 'sk-' + 'x'.repeat(20) + '"', 'example'), /credential/)
})

test('[AC-067] importing the checker does not execute it', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./scripts/check-docs.mjs')"], { cwd: root, encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})

test('[AC-067] malformed document inputs fail', () => {
  const original = read('README.md')
  for (const mutated of [
    original + '\n[broken](missing-file.md)\n',
    original + '\nC:\\private\\config.json\n',
    original.replace('可运行：', '可运行: '),
    original.replace('models select --request', 'models select --request-unknown'),
    original.replaceAll('可运行：', '不可运行：需要配置'),
    original.replace('models list', 'unknown-operation'),
    original.replace('"importance":"normal"', '"unrecognized":true'),
  ]) assert.throws(() => checkDocs({ 'README.md': mutated }))
})
