// Prints the arguments it received as JSON so a test can compare them byte for byte.
process.stdout.write(`${JSON.stringify(process.argv.slice(2))}\n`)
