import test from 'node:test'
import assert from 'node:assert/strict'
import { detectInlineSecret, assertNoInlineSecret } from '../../lib/secrets/inline.mjs'

test('[AC-033] detectInlineSecret finds top-level plaintext secret', () => {
  const r = detectInlineSecret({ apiKey: 'sk-abcdefghijklmnop' })
  assert.equal(r.found, true)
  assert.deepEqual(r.paths, ['apiKey'])
})

test('[AC-033] detectInlineSecret recurses into nested objects and arrays', () => {
  const cfg = {
    providers: {
      claude: { token: 'sk-0123456789abcdef' },
      pool: [{ password: 'a'.repeat(40) }],
    },
  }
  const r = detectInlineSecret(cfg)
  assert.equal(r.found, true)
  assert.deepEqual(r.paths, ['providers.claude.token', 'providers.pool[0].password'])
})

test('[AC-033] compatible configs without secrets still load', () => {
  const cfg = {
    providers: { claude: { apiKeyEnv: 'ANTHROPIC_API_KEY', command: 'claude' } },
    models: { a: { provider: 'claude', id: 'a' } },
  }
  assert.deepEqual(detectInlineSecret(cfg), { found: false, paths: [] })
  assert.deepEqual(assertNoInlineSecret(cfg), { ok: true, paths: [] })
})

test('[AC-033] assertNoInlineSecret reports E_INLINE_SECRET with paths', () => {
  const r = assertNoInlineSecret({ token: 'sk-zzzzzzzzzzzzzzzz' })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'E_INLINE_SECRET')
  assert.deepEqual(r.paths, ['token'])
  assert.match(r.message, /token/)
})

test('[AC-033] short or non-secret-like values are not flagged', () => {
  const cfg = { token: 'short', password: 'plain words here', name: 'sk-abcdefghijklmnop' }
  assert.deepEqual(detectInlineSecret(cfg), { found: false, paths: [] })
})
