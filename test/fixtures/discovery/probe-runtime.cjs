const fs = require('node:fs')
fs.appendFileSync(process.env.DISCOVERY_RECORD, JSON.stringify(process.argv.slice(2)) + '\n')
if (process.argv[2] === '--version') {
  process.stdout.write('fixture v1.2.3-alpha.1+build.7\n')
} else {
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => { input += chunk })
  process.stdin.on('end', () => {
    const nonce = input.trim().split(/\s+/).at(-1)
    process.stdout.write(JSON.stringify({ type: 'result', model: 'claude:one', text: nonce, usage: { input_tokens: 1, output_tokens: 1 } }) + '\n')
  })
}
