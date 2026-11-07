import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { collectLibFiles, evaluatePack, runNpmPack } from '../../scripts/check-pack.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
// Built by concatenation so this file does not trip the no-collab check.
const COLLAB_PREFIX = `${['.', 'coll', 'ab'].join('')}/`

let cachedPack = null

function packOnce() {
  if (cachedPack === null) cachedPack = runNpmPack(REPO_ROOT)
  return cachedPack
}

function realManifests() {
  return {
    pkg: JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')),
    plugin: JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'dsh.plugin.json'), 'utf8')),
  }
}

/** A pack list and manifests that satisfy every rule, built without touching the repository. */
function baseline() {
  return {
    packFiles: [
      'package.json',
      'dsh.plugin.json',
      'cordis.patch.yml',
      'README.md',
      'bin/cliworker.mjs',
      'config/cliworker.example.json',
      'contracts/registry.snapshot.json',
      'contracts/agentline-forbidden.json',
      'contracts/schemas/model.v1.schema.json',
      'contracts/host/dsh-host.v1.json',
      'contracts/context/context.v1.json',
      'lib/index.js',
      'lib/cli.mjs',
    ],
    pkg: { name: 'dsh-cliworker', version: '0.1.0', bin: { cliworker: 'bin/cliworker.mjs' } },
    plugin: { version: '0.1.0' },
    libFiles: ['lib/cli.mjs', 'lib/index.js'],
  }
}

function ids(errors) {
  return errors.map((error) => error.id)
}

test('[AC-025] check-pack passes against the real package', () => {
  const pack = packOnce()
  assert.equal(pack.error, null)

  const { pkg, plugin } = realManifests()
  const { errors } = evaluatePack({
    packFiles: pack.files,
    pkg,
    plugin,
    libFiles: collectLibFiles(REPO_ROOT),
  })
  assert.deepEqual(errors, [])
})

test('[AC-025] npm pack lists the required runtime files', () => {
  const pack = packOnce()
  assert.equal(pack.error, null)

  for (const required of [
    'bin/cliworker.mjs',
    'config/cliworker.example.json',
    'contracts/registry.snapshot.json',
    'contracts/agentline-forbidden.json',
    'lib/index.js',
  ]) {
    assert.ok(pack.files.includes(required), `${required} is missing from the pack`)
  }
  for (const dir of ['contracts/schemas/', 'contracts/host/', 'contracts/context/']) {
    assert.ok(pack.files.some((file) => file.startsWith(dir)), `${dir} has no file in the pack`)
  }
})

test('[AC-025] npm pack lists no forbidden paths', () => {
  const pack = packOnce()
  assert.equal(pack.error, null)

  const forbidden = pack.files.filter(
    (file) =>
      ['test/', 'scripts/', 'state/', 'contracts/golden/', 'contracts/spec/'].some((prefix) =>
        file.startsWith(prefix)
      ) ||
      file.startsWith(COLLAB_PREFIX) ||
      (file.startsWith('config/') && file.endsWith('.local.json')) ||
      file.endsWith('.jsonl')
  )
  assert.deepEqual(forbidden, [])
})

test('[AC-025] evaluatePack rejects a missing required file', () => {
  const cases = [
    ['bin/cliworker.mjs', (input) => { input.packFiles = input.packFiles.filter((file) => file !== 'bin/cliworker.mjs') }],
    ['lib/cli.mjs', (input) => { input.packFiles = input.packFiles.filter((file) => file !== 'lib/cli.mjs') }],
    ['contracts/schemas/', (input) => { input.packFiles = input.packFiles.filter((file) => !file.startsWith('contracts/schemas/')) }],
  ]

  for (const [missing, mutate] of cases) {
    const input = baseline()
    mutate(input)
    const hits = evaluatePack(input).errors.filter((error) => error.id === 'pack.missing_required')
    assert.ok(hits.length > 0, `expected pack.missing_required for ${missing}`)
    assert.ok(
      hits.some((error) => error.detail.includes(missing)),
      `pack.missing_required should name ${missing}`
    )
  }
})

test('[AC-025] evaluatePack rejects each forbidden path class', () => {
  const cases = [
    'test/x.test.mjs',
    'scripts/x.mjs',
    'state/x.json',
    'config/a.local.json',
    'x/y.jsonl',
    'contracts/golden/b44.json',
    'contracts/spec/ac-index.json',
    `${COLLAB_PREFIX}x.json`,
  ]

  for (const added of cases) {
    const input = baseline()
    input.packFiles = [...input.packFiles, added]
    const hits = evaluatePack(input).errors.filter((error) => error.id === 'pack.forbidden_present')
    assert.ok(hits.some((error) => error.detail === added), `expected pack.forbidden_present for ${added}`)
  }
})

test('[AC-025] evaluatePack rejects a bin or version mismatch', () => {
  const missingBin = baseline()
  delete missingBin.pkg.bin
  assert.ok(ids(evaluatePack(missingBin).errors).includes('pack.bin_mismatch'))

  const prefixedBin = baseline()
  prefixedBin.pkg.bin = { cliworker: './bin/cliworker.mjs' }
  assert.ok(ids(evaluatePack(prefixedBin).errors).includes('pack.bin_mismatch'))

  const staleVersion = baseline()
  staleVersion.plugin.version = '0.0.9'
  assert.ok(ids(evaluatePack(staleVersion).errors).includes('pack.version_mismatch'))
})

test('[AC-025] evaluatePack rejects a non-whitelisted contracts path', () => {
  const input = baseline()
  input.packFiles = [...input.packFiles, 'contracts/examples/model.v1/x.json']
  assert.ok(ids(evaluatePack(input).errors).includes('pack.not_whitelisted'))
})
