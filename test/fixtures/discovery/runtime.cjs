const fs = require('node:fs')
fs.appendFileSync(process.env.DISCOVERY_RECORD, `${process.argv[1]} ${process.argv.slice(2).join(' ')}\n`)
process.stdout.write('fixture 1.2.3\n')
