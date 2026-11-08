import fs from 'node:fs'

let input = ''
for await (const part of process.stdin) input += part
const nonce = input.trim().split(' ').at(-1)
const args = process.argv.slice(2)
const id = args[args.indexOf('--model') + 1]
if (process.env.PROBE_COUNT_FILE) fs.appendFileSync(process.env.PROBE_COUNT_FILE, `${id}\n`)
const mode = process.env.PROBE_MODE || 'ok'
const usage = { input_tokens: 7, output_tokens: 3, cache_read_tokens: 0, cache_write_tokens: 0 }
if (mode === 'auth' || mode === 'quota' || mode === 'deprecated') {
  console.log(JSON.stringify({ type: 'error', code: mode === 'auth' ? 'E_PROVIDER_AUTH' : mode === 'quota' ? 'E_PROVIDER_QUOTA' : 'deprecated' }))
  console.log(JSON.stringify({ type: 'usage', usage }))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ type: 'result', model: mode === 'missing-model' ? undefined : mode === 'mismatch' ? 'claude:other' : `claude:${id}`, text: mode === 'bad-nonce' ? 'wrong' : nonce, usage }))
}
