// The generator prefixes this script with its instance-specific config.
;(async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const crypto = await import('node:crypto')
  const argv = process.argv.slice(2)
  const envNames = Object.keys(process.env).sort()
  const sha256 = Object.fromEntries(envNames.map((name) => [name, crypto.createHash('sha256').update(process.env[name], 'utf8').digest('hex')]))
  const id = crypto.randomUUID()
  const temporary = path.join(config.recordDir, `${id}.tmp`)
  fs.writeFileSync(temporary, JSON.stringify({ argv, envNames, sha256, cwd: process.cwd() }), { encoding: 'utf8', flag: 'wx' })
  fs.renameSync(temporary, path.join(config.recordDir, `${id}.json`))
  if (argv.length === 1 && argv[0] === '--help') process.stdout.write(config.help)
  else if (argv.length === 1 && argv[0] === '--version') process.stdout.write(config.version)
  else if (JSON.stringify(argv) === JSON.stringify(config.modelsArgv)) process.stdout.write(config.models)
  else if (config.mode === 'timeout') setInterval(() => {}, 1000)
  else if (config.mode === 'auth' || config.mode === 'quota') {
    process.stderr.write(config.mode)
    process.exitCode = 1
  } else if (config.mode === 'deprecated') process.stdout.write('deprecated')
  else if (config.mode === 'mismatch') process.stdout.write('reported_model=other-model')
  else process.stdout.write('ok')
})().catch(() => { process.stderr.write('fake-cli failed'); process.exitCode = 1 })
