import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { REGISTRY } from '../../lib/contract/registry.mjs'
import { checkSchema, validate } from '../../lib/contract/validate.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const SCHEMA_DIR = path.join(ROOT, 'contracts', 'schemas')
const EXAMPLE_DIR = path.join(ROOT, 'contracts', 'examples')

const WIRE_NAMES = [
  'config.v2',
  'error-envelope',
  'event.v1',
  'forecast.v1',
  'handle-full.v1',
  'handle.v1',
  'inventory.v1',
  'model.v1',
  'pool',
  'request.v1',
  'selection-failed.v1',
  'selection-ok.v1',
  'session.v1',
  'usage.v1',
]

function loadSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(SCHEMA_DIR, name), 'utf8'))
}

function schemaFiles() {
  return fs
    .readdirSync(SCHEMA_DIR)
    .filter((name) => name.endsWith('.schema.json'))
    .sort()
}

function exampleFiles(name, kind) {
  const dir = path.join(EXAMPLE_DIR, name, kind)
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.json'))
    .sort()
    .map((file) => path.join(dir, file))
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

test('[AC-009] every schema uses only supported keywords', () => {
  for (const name of schemaFiles()) {
    assert.deepStrictEqual(checkSchema(loadSchema(name)), [], `${name} uses an unsupported keyword`)
  }
})

test('[AC-009] every valid example passes its schema', () => {
  for (const name of WIRE_NAMES) {
    const schema = loadSchema(`${name}.schema.json`)
    for (const file of exampleFiles(name, 'valid')) {
      const result = validate(schema, readJson(file), { loadSchema })
      assert.equal(result.ok, true, `${path.basename(file)} of ${name}: ${JSON.stringify(result.errors)}`)
    }
  }
})

test('[AC-009] every invalid example fails with exactly the declared path and keyword', () => {
  for (const name of WIRE_NAMES) {
    const schema = loadSchema(`${name}.schema.json`)
    for (const file of exampleFiles(name, 'invalid')) {
      const spec = readJson(file)
      const result = validate(schema, spec.document, { loadSchema })
      const label = `${name}/${path.basename(file)}`
      assert.equal(result.ok, false, `${label} was accepted`)
      assert.equal(result.errors.length, 1, `${label} produced ${JSON.stringify(result.errors)}`)
      assert.equal(result.errors[0].path, spec.expect.path, `${label} path`)
      assert.equal(result.errors[0].keyword, spec.expect.keyword, `${label} keyword`)
    }
  }
})

test('[AC-009] every wire schema has one valid and two invalid examples', () => {
  const dirs = fs
    .readdirSync(EXAMPLE_DIR)
    .filter((name) => fs.statSync(path.join(EXAMPLE_DIR, name)).isDirectory())
    .sort()
  assert.deepStrictEqual(dirs, WIRE_NAMES)
  for (const name of WIRE_NAMES) {
    assert.ok(exampleFiles(name, 'valid').length >= 1, `${name} needs a valid example`)
    assert.ok(exampleFiles(name, 'invalid').length >= 2, `${name} needs two invalid examples`)
  }
})

test('[AC-009] schema enums for codes, warnings and reject reasons equal the registry', () => {
  const ok = loadSchema('selection-ok.v1.schema.json')
  const rejected = ok.properties.rejected.items.properties.reason.enum
  assert.deepStrictEqual([...rejected].sort(), [...REGISTRY.reject_reasons.v1].sort())

  const warnings = ok.properties.warnings.items.properties.code.enum
  assert.deepStrictEqual([...warnings].sort(), [...REGISTRY.warning_codes].sort())

  const codes = REGISTRY.codes.map((entry) => entry.code).sort()
  for (const name of ['selection-failed.v1', 'error-envelope']) {
    const schema = loadSchema(`${name}.schema.json`)
    const enumCodes = name === 'error-envelope'
      ? schema.properties.error.properties.code.enum
      : schema.properties.error.properties.code.enum
    assert.deepStrictEqual([...enumCodes].sort(), codes, name)
  }
})

test('[AC-009] validator reports the expected path for each supported keyword', () => {
  const cases = [
    ['type', { type: 'string' }, 1, '', 'type'],
    ['enum', { enum: ['a', 'b'] }, 'c', '', 'enum'],
    ['const', { const: 'a' }, 'b', '', 'const'],
    ['required', { type: 'object', required: ['a'] }, {}, '/a', 'required'],
    [
      'properties',
      { type: 'object', properties: { a: { type: 'string' } } },
      { a: 1 },
      '/a',
      'type',
    ],
    [
      'additionalProperties',
      { type: 'object', properties: { a: {} }, additionalProperties: false },
      { a: 1, b: 2 },
      '/b',
      'additionalProperties',
    ],
    ['items', { type: 'array', items: { type: 'string' } }, [1], '/0', 'type'],
    ['minItems', { type: 'array', minItems: 2 }, [1], '', 'minItems'],
    ['maxItems', { type: 'array', maxItems: 1 }, [1, 2], '', 'maxItems'],
    ['uniqueItems', { type: 'array', uniqueItems: true }, [1, 1], '', 'uniqueItems'],
    ['minLength', { type: 'string', minLength: 3 }, 'ab', '', 'minLength'],
    ['maxLength', { type: 'string', maxLength: 2 }, 'abc', '', 'maxLength'],
    ['pattern', { type: 'string', pattern: '^[a-z]+$' }, 'A1', '', 'pattern'],
    ['minimum', { type: 'number', minimum: 2 }, 1, '', 'minimum'],
    ['maximum', { type: 'number', maximum: 2 }, 3, '', 'maximum'],
    [
      '$ref local',
      { $defs: { name: { type: 'string' } }, type: 'object', properties: { a: { $ref: '#/$defs/name' } } },
      { a: 1 },
      '/a',
      'type',
    ],
  ]
  for (const [label, schema, doc, expectedPath, expectedKeyword] of cases) {
    const result = validate(schema, doc)
    assert.equal(result.ok, false, label)
    assert.equal(result.errors.length, 1, `${label}: ${JSON.stringify(result.errors)}`)
    assert.equal(result.errors[0].path, expectedPath, label)
    assert.equal(result.errors[0].keyword, expectedKeyword, label)
  }

  const requiredOnly = validate({ type: 'object', required: ['a'] }, {})
  assert.equal(requiredOnly.errors.length, 1)

  const nested = validate(
    { type: 'object', properties: { models: { type: 'array', items: { type: 'object', properties: { call: { type: 'object', properties: { cwd: { type: 'string' } } } } } } } },
    { models: [{ call: { cwd: 7 } }] }
  )
  assert.equal(nested.errors[0].path, '/models/0/call/cwd')

  const remote = validate(
    { $ref: 'handle.v1.schema.json#/$defs/call' },
    {
      command: 'node',
      args: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      cwd: 'C:/work',
      input: 'pipe',
      output: 'cliworker.event/v1',
      timeout_ms: 1,
    },
    { loadSchema }
  )
  assert.equal(remote.ok, false)
  assert.equal(remote.errors[0].path, '/input')
  assert.equal(remote.errors[0].keyword, 'const')

  assert.throws(() => validate({ oneOf: [{ type: 'string' }] }, 'x'), TypeError)
  assert.throws(() => validate({ type: 'object', properties: { a: { anyOf: [] } } }, { a: 1 }), TypeError)
  assert.deepStrictEqual(checkSchema({ type: 'object', properties: { a: { oneOf: [] } } }), [
    '/properties/a: oneOf',
  ])
})

test('[AC-009] examples carry no token-like strings', () => {
  const forbiddenPatterns = [/sk-/, /Bearer /, /ghp_/, /xox/, /AKIA/]
  const runs = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else runs.push(full)
    }
  }
  walk(EXAMPLE_DIR)

  for (const file of runs) {
    const text = fs.readFileSync(file, 'utf8')
    for (const pattern of forbiddenPatterns) {
      assert.equal(pattern.test(text), false, `${path.relative(ROOT, file)} matches ${pattern}`)
    }
    for (const run of text.match(/[A-Za-z0-9+/=_-]{40,}/g) ?? []) {
      const mixed = /[a-z]/.test(run) && /[A-Z]/.test(run) && /\d/.test(run)
      assert.equal(mixed, false, `${path.relative(ROOT, file)} carries a token-like string`)
    }
    for (const run of text.match(/[0-9a-f]{40,}/g) ?? []) {
      assert.equal(/\d/.test(run), false, `${path.relative(ROOT, file)} carries a hex token`)
    }
  }
})
