import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const V01 = process.env.CLIWORKER_V01_ROOT
  ?? fileURLToPath(new URL('../../fixtures/characterization/v0.1/', import.meta.url))

const PROBE = [
  "import fs from 'node:fs'",
  "fs.appendFileSync(process.env.CLIWORKER_TEST_PROBE_FILE, 'x')",
  "process.stdout.write('node 1.0.0\\n')",
  '',
].join('\n')

test('[repro] [AC-005] provider status is probed again on every call', async () => {
  const { providerStatus } = await import(pathToFileURL(path.join(V01, 'lib', 'availability.mjs')).href)
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cw-v01-nocache-'))
  const probeFile = path.join(base, 'probe-count.txt')
  const previousCwd = process.cwd()
  const previousProbe = process.env.CLIWORKER_TEST_PROBE_FILE
  try {
    fs.writeFileSync(path.join(base, 'probe.mjs'), PROBE, 'utf8')
    fs.writeFileSync(probeFile, '', 'utf8')
    process.env.CLIWORKER_TEST_PROBE_FILE = probeFile
    process.chdir(base)

    const config = { providers: { local: { cli: 'node', version_args: ['probe.mjs'] } } }
    assert.equal(providerStatus(config).local.state, 'callable')
    assert.equal(providerStatus(config).local.state, 'callable')

    assert.equal(fs.readFileSync(probeFile, 'utf8').length, 2)
  } finally {
    process.chdir(previousCwd)
    if (previousProbe === undefined) delete process.env.CLIWORKER_TEST_PROBE_FILE
    else process.env.CLIWORKER_TEST_PROBE_FILE = previousProbe
    fs.rmSync(base, { recursive: true, force: true })
  }
})
