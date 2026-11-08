import assert from 'node:assert/strict'
import fs from 'node:fs'
import { routes } from '../../../lib/http/routes.mjs'
import { setup, withFixture } from './http-select.mjs'

export const name = 'http-admin'
export const introduced_by = 'T-024'
export const ac = ['AC-060']

export async function run(flow) {
  await withFixture(flow, async () => {
    const request = setup(flow)
    const bootstrap = await request('/cliworker/api/session')
    assert.equal(bootstrap.statusCode, 200)
    const { session, csrf } = JSON.parse(bootstrap.body)
    const headers = { 'x-cliworker-session': session, 'x-cliworker-csrf': csrf }
    const read = await request('/cliworker/providers', { headers })
    assert.equal(read.statusCode, 200)
    const added = await request('/cliworker/api/manual-model', { method: 'POST', headers, body: { provider: 'claude', id: 'flow-new', level: 'Top' } })
    assert.equal(added.statusCode, 200)
    assert.ok(JSON.parse(fs.readFileSync(flow.config_path, 'utf8')).catalog.manual.some(model => model.key === 'claude:flow-new'))
    const allow = await request('/cliworker/api/allow', { method: 'POST', headers, body: { key: 'claude:flow-new' } })
    assert.equal(allow.statusCode, 200)
    assert.ok(JSON.parse(fs.readFileSync(flow.config_path, 'utf8')).catalog.allow.includes('claude:flow-new'))
    const readonly = setup(flow, { readonly: true })
    const roTokens = JSON.parse((await readonly('/cliworker/api/session')).body)
    for (const route of routes.filter(item => item.level === 'admin_write')) {
      for (const [client, requestHeaders, code] of [
        [request, {}, 'E_ADMIN_REQUIRED'],
        [request, { 'x-cliworker-session': session }, 'E_CSRF'],
        [readonly, { 'x-cliworker-session': roTokens.session }, 'E_READONLY'],
      ]) {
        const response = await client(route.path, { method: 'POST', headers: requestHeaders, body: '{' })
        assert.equal(response.statusCode, 403)
        assert.equal(JSON.parse(response.body).error.code, code)
      }
    }
    const scan = flow.scan()
    assert.ok(scan.scanned.http > 0)
    assert.deepEqual(scan.hits, [])
  })
}
