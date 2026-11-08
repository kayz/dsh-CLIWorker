// wsl.exe -l -q emits UTF-16LE, including when it omits the byte-order mark.
export function parseDistros(output) {
  const text = Buffer.isBuffer(output) ? output.toString('utf16le') : String(output ?? '')
  const seen = new Set()
  const result = []
  for (const line of text.replace(/^\uFEFF/, '').replace(/\0/g, '').split(/\r?\n/)) {
    const name = line.trim().replace(/^\*\s*/, '').trim()
    if (name && !seen.has(name)) {
      seen.add(name)
      result.push(name)
    }
  }
  return result
}
