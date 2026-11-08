import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { REDACTED, createSecretRegistry, redact, redactString } from '../../lib/redact.mjs'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const key of Object.keys(value)) deepFreeze(value[key])
  }
  return value
}

test('[AC-030] redact-sk: sk- prefixed keys are blanked, ordinary words are not', () => {
  const modern = 'sk-proj-AbCdEfGh12345678'
  const anthropic = 'sk-ant-api03-QwErTyUiOp12'
  assert.equal(redactString(`key=${modern} end`), `key=${REDACTED} end`)
  assert.equal(redactString(`a ${anthropic} b ${modern}`), `a ${REDACTED} b ${REDACTED}`)
  assert.equal(redactString('task-description-long'), 'task-description-long')
  assert.equal(redactString('sk-short'), 'sk-short')
})

test('[AC-030] redact-bearer: the Bearer word survives, the credential does not', () => {
  assert.equal(redactString('Authorization: Bearer abc.DEF-123_x~+/='), `Authorization: Bearer ${REDACTED}`)
  assert.equal(redactString('bearer abcdef123456'), `bearer ${REDACTED}`)
  assert.equal(redactString('BeArEr token-value.1'), `BeArEr ${REDACTED}`)
})

test('[AC-030] redact-jwt: three-part base64url tokens are blanked, filenames are not', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlLXZhbHVl'
  assert.equal(redactString(`token: ${jwt}`), `token: ${REDACTED}`)
  assert.equal(redactString('config.example.json'), 'config.example.json')
  assert.equal(redactString('version 1.2.3'), 'version 1.2.3')
})

test('[AC-030] redact-registered: every occurrence goes, and long values do not split short ones', () => {
  const short = 'abcd1234efgh'
  const long = 'abcd1234efgh5678'
  const text = `x ${long} y ${short} z ${short}`
  assert.equal(redactString(text, [short, long]), `x ${REDACTED} y ${REDACTED} z ${REDACTED}`)
  assert.equal(redactString('unchanged', ['', 42, null, undefined]), 'unchanged')
  assert.equal(redactString('two abcd1234efgh here abcd1234efgh', [short]), `two ${REDACTED} here ${REDACTED}`)
})

test('[AC-030] redact-nested: values and keys are redacted, scalars pass through', () => {
  const secret = 'sk-nested-ABCDEFGH1234'
  const input = {
    [secret]: 'as a key',
    list: [secret, 'plain', 7, true, null],
    deep: { ['k-' + secret]: { note: secret } },
  }

  const out = redact(input)

  assert.deepEqual(out[REDACTED], 'as a key')
  assert.deepEqual(out.list, [REDACTED, 'plain', 7, true, null])
  assert.deepEqual(out.deep[`k-${REDACTED}`], { note: REDACTED })
  assert.equal(out.list[2], 7)
  assert.equal(out.list[3], true)
  assert.equal(out.list[4], null)
})

test('[AC-030] redact-error-message: an Error becomes name plus a redacted message, with no stack', () => {
  const secret = 'sk-error-9F8E7D6C5B4A'
  const error = new Error(`failed with key ${secret}`)

  const out = redact({ error, message: error.message })

  assert.deepEqual(out.error, { name: 'Error', message: `failed with key ${REDACTED}` })
  assert.equal('stack' in out.error, false)
  assert.equal(out.message, `failed with key ${REDACTED}`)
})

test('[AC-030] redact-no-mutation: a deeply frozen input is copied, not written to', () => {
  const input = deepFreeze({ token: 'sk-frozen-1234567890', list: ['Bearer abc.def'], nested: { n: 1 } })

  const out = redact(input)

  assert.notEqual(out, input)
  assert.equal(input.token, 'sk-frozen-1234567890')
  assert.equal(input.list[0], 'Bearer abc.def')
  assert.equal(out.token, REDACTED)
  assert.equal(out.list[0], `Bearer ${REDACTED}`)
  assert.equal(out.nested.n, 1)
})

test('[AC-030] redact-cycle: a self reference becomes the circular marker instead of looping', () => {
  const node = { name: 'root' }
  node.self = node

  const out = redact(node)

  assert.equal(out.name, 'root')
  assert.equal(out.self, '[Circular]')
})

test('[AC-030] redact-registry: the registry matches the explicit secrets argument and de-duplicates', () => {
  const secret = 'sk-registry-1234567890'
  const registry = createSecretRegistry()
  registry.add(secret)
  registry.add(secret)
  registry.add('')
  registry.add(null)

  const value = { detail: `token ${secret}`, nested: [{ message: secret }] }

  assert.deepEqual(registry.list(), [secret])
  assert.deepEqual(registry.redact(value), redact(value, { secrets: [secret] }))
  assert.equal(registry.redact(`x ${secret}`), `x ${REDACTED}`)
})

test('[AC-030] redact-seams: the module has no fs import and no time primitive', () => {
  const source = fs.readFileSync(path.join(ROOT, 'lib/redact.mjs'), 'utf8')

  for (const needle of ['node:fs', 'Date.now', 'setTimeout']) {
    assert.equal(source.includes(needle), false, `lib/redact.mjs must not contain ${needle}`)
  }
})
