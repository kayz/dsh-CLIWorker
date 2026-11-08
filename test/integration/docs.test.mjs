import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { checkDocs, checkMigration, extractBlocks, parseCommand } from '../../scripts/check-docs.mjs'

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
})

test('[AC-067] parser rejects unsafe or malformed examples', () => {
  assert.deepEqual(parseCommand('node bin/cliworker.mjs models list --config "a b.json"'), ['models', 'list', '--config', 'a b.json'])
  for (const line of ['node bin/cliworker.mjs x | node x', 'node bin/cliworker.mjs x "bad', 'echo hello', 'node bin/cliworker.mjs x ../bad']) assert.throws(() => parseCommand(line))
  assert.equal(extractBlocks('可运行：\r\n```pwsh\r\nnode bin/cliworker.mjs usage summary\r\n```', 'example').length, 1)
  assert.throws(() => extractBlocks('```pwsh\nnode bin/cliworker.mjs x\n```', 'example'))
  assert.throws(() => extractBlocks('可运行：\n```pwsh\n', 'example'))
  assert.throws(() => extractBlocks('可运行：\n```bash\nx\n```', 'example'))
  assert.throws(() => extractBlocks('可运行：\n```pwsh\n```', 'example'))
  assert.throws(() => extractBlocks('```json\n{"schema":"cliworker.request/v1","level":"Top","role":"x"}\n```', 'README.md'))
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
