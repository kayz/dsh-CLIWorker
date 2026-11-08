// Byte-level leak scanner shared by the flow harness and the canary tests. It is deliberately
// independent of lib/contract/scan.mjs: that scanner inspects contract views, this one looks for
// exact sentinel bytes in every surface a running CLI can touch.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const MIN_SENTINEL_LENGTH = 16

const LABEL_PATTERN = /^[A-Za-z0-9]+$/
const ENCODINGS = ['raw', 'utf16le', 'base64', 'hex']
const AUDIT_NAME = 'audit.jsonl'

function toPosix(value) {
  return String(value).split(path.sep).join('/')
}

function isSamePath(left, right) {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

function toBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (typeof value === 'string') return Buffer.from(value, 'utf8')
  const text = JSON.stringify(value)
  return Buffer.from(typeof text === 'string' ? text : String(value), 'utf8')
}

function encodeSentinel(value, encoding) {
  if (encoding === 'raw') return Buffer.from(value, 'utf8')
  if (encoding === 'utf16le') return Buffer.from(value, 'utf16le')
  const utf8 = Buffer.from(value, 'utf8')
  if (encoding === 'base64') return Buffer.from(utf8.toString('base64'), 'utf8')
  return Buffer.from(utf8.toString('hex'), 'utf8')
}

/** A fresh, unpredictable sentinel value. Only the label ends up in results. */
export function makeSentinel(label) {
  if (typeof label !== 'string' || !LABEL_PATTERN.test(label)) {
    throw new TypeError('sentinel label must match ^[A-Za-z0-9]+$')
  }
  return `cwsentinel_${label}_${crypto.randomBytes(12).toString('hex')}`
}

/** Normalize a sentinel list into `[{label, value}]`, rejecting anything that cannot be scanned safely. */
export function normalizeSentinels(sentinels) {
  if (!Array.isArray(sentinels) || sentinels.length === 0) {
    throw new TypeError('sentinels must be a non-empty array')
  }

  const out = []
  const seen = new Set()

  sentinels.forEach((item, index) => {
    let label
    let value
    if (typeof item === 'string') {
      label = `S${index + 1}`
      value = item
    } else if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      label = item.label
      value = item.value
    } else {
      throw new TypeError(`sentinel ${index} must be a string or {label, value}`)
    }

    if (typeof label !== 'string' || label === '') throw new TypeError(`sentinel ${index} needs a label`)
    if (typeof value !== 'string' || value.length < MIN_SENTINEL_LENGTH) {
      throw new TypeError(`sentinel ${label} must be a string of at least ${MIN_SENTINEL_LENGTH} characters`)
    }
    if (seen.has(label)) throw new TypeError(`duplicate sentinel label: ${label}`)

    seen.add(label)
    out.push({ label, value })
  })

  return out
}

/** Every match of every sentinel in `data`, across raw, utf16le, base64 and hex byte forms. */
export function scanBytes(data, sentinels) {
  const list = normalizeSentinels(sentinels)
  const bytes = toBuffer(data)
  const hits = []

  for (const sentinel of list) {
    for (const encoding of ENCODINGS) {
      const needle = encodeSentinel(sentinel.value, encoding)
      const offset = bytes.indexOf(needle)
      if (offset >= 0) hits.push({ label: sentinel.label, encoding, offset })
    }
  }

  return hits
}

function scanTextSurface(surface, input, list, hits, scanned) {
  if (input === undefined || input === null) return
  const arrayForm = Array.isArray(input)
  const values = arrayForm ? input : [input]

  values.forEach((item, index) => {
    const bytes = toBuffer(item)
    scanned[surface] += bytes.length
    for (const hit of scanBytes(bytes, list)) {
      const at = arrayForm ? `${surface}[${index}]@${hit.offset}` : `${surface}@${hit.offset}`
      hits.push({
        surface,
        location: at,
        sentinel: hit.label,
        encoding: hit.encoding,
        offset: hit.offset,
      })
    }
  })
}

function scanArgv(argv, list, hits, scanned) {
  if (!Array.isArray(argv)) return
  argv.forEach((call, callIndex) => {
    if (!Array.isArray(call)) return
    call.forEach((arg, argIndex) => {
      scanned.argv += 1
      const bytes = toBuffer(arg)
      for (const hit of scanBytes(bytes, list)) {
        hits.push({
          surface: 'argv',
          location: `argv[${callIndex}][${argIndex}]@${hit.offset}`,
          sentinel: hit.label,
          encoding: hit.encoding,
          offset: hit.offset,
        })
      }
    })
  })
}

function scanHttp(http, list, hits, scanned) {
  if (!Array.isArray(http)) return
  http.forEach((entry, index) => {
    scanned.http += 1
    if (entry === null || typeof entry !== 'object') return

    if (entry.body !== undefined && entry.body !== null) {
      const bytes = toBuffer(entry.body)
      for (const hit of scanBytes(bytes, list)) {
        hits.push({
          surface: 'http',
          location: `http[${index}].body@${hit.offset}`,
          sentinel: hit.label,
          encoding: hit.encoding,
          offset: hit.offset,
        })
      }
    }

    if (typeof entry.url === 'string') {
      for (const hit of scanBytes(entry.url, list)) {
        hits.push({
          surface: 'http',
          location: `http[${index}].url@${hit.offset}`,
          sentinel: hit.label,
          encoding: hit.encoding,
          offset: hit.offset,
        })
      }
    }

    if (entry.headers !== null && typeof entry.headers === 'object' && !Array.isArray(entry.headers)) {
      for (const [name, value] of Object.entries(entry.headers)) {
        const target = String(name).toLowerCase()
        const parts = Array.isArray(value) ? value : [value]
        for (const part of parts) {
          for (const hit of scanBytes(toBuffer(part), list)) {
            hits.push({
              surface: 'http',
              location: `http[${index}].headers.${target}@${hit.offset}`,
              sentinel: hit.label,
              encoding: hit.encoding,
              offset: hit.offset,
            })
          }
        }
      }
    }
  })
}

function walkStateDir(dir, relBase, context) {
  const { sentinels, hits, errors, scanned, auditFile } = context

  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
      errors.push({ surface: 'state_dir', location: `state_dir:${relBase}`, code: error.code || 'E_SCAN' })
    }
    return
  }

  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))

  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    const rel = relBase === '' ? entry.name : `${relBase}/${entry.name}`

    if (entry.isSymbolicLink()) continue

    for (const hit of scanBytes(entry.name, sentinels)) {
      hits.push({
        surface: 'state_dir',
        location: `state_dir:${rel}#name`,
        sentinel: hit.label,
        encoding: hit.encoding,
      })
    }

    if (entry.isDirectory()) {
      walkStateDir(full, rel, context)
      continue
    }
    if (!entry.isFile()) continue
    if (auditFile !== null && isSamePath(full, auditFile)) continue

    let data
    try {
      data = fs.readFileSync(full)
    } catch (error) {
      errors.push({ surface: 'state_dir', location: `state_dir:${rel}`, code: error.code || 'E_SCAN' })
      continue
    }

    scanned.files += 1
    for (const hit of scanBytes(data, sentinels)) {
      hits.push({
        surface: 'state_dir',
        location: `state_dir:${rel}@${hit.offset}`,
        sentinel: hit.label,
        encoding: hit.encoding,
        offset: hit.offset,
      })
    }
  }
}

function scanAudit(file, stateDir, list, hits, errors, scanned) {
  let data
  try {
    data = fs.readFileSync(file)
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return
    errors.push({ surface: 'audit', location: path.basename(file), code: error.code || 'E_SCAN' })
    return
  }

  scanned.audit += data.length

  let relative = toPosix(path.relative(stateDir, file))
  if (relative === '' || relative.startsWith('../') || relative.startsWith('/') || path.isAbsolute(relative)) {
    relative = path.basename(file)
  }

  let lineStart = 0
  let lineNumber = 1
  let index = 0
  while (index <= data.length) {
    if (index === data.length || data[index] === 0x0a) {
      const line = data.subarray(lineStart, index)
      for (const hit of scanBytes(line, list)) {
        hits.push({
          surface: 'audit',
          location: `audit:${relative}:${lineNumber}@${hit.offset}`,
          sentinel: hit.label,
          encoding: hit.encoding,
          offset: hit.offset,
        })
      }
      lineStart = index + 1
      lineNumber += 1
    }
    index += 1
  }
}

/**
 * Scan every supplied surface for sentinel bytes. Missing surfaces are skipped; only `sentinels`
 * is required. The returned object never carries a sentinel value, only labels and locations.
 */
export function leakScan(surfaces = {}) {
  const sentinels = normalizeSentinels(surfaces.sentinels)
  const hits = []
  const errors = []
  const scanned = { stdout: 0, stderr: 0, argv: 0, http: 0, files: 0, audit: 0 }

  scanTextSurface('stdout', surfaces.stdout, sentinels, hits, scanned)
  scanTextSurface('stderr', surfaces.stderr, sentinels, hits, scanned)
  scanArgv(surfaces.argv, sentinels, hits, scanned)
  scanHttp(surfaces.http, sentinels, hits, scanned)

  const stateDir = typeof surfaces.state_dir === 'string' && surfaces.state_dir !== '' ? surfaces.state_dir : null
  const auditFile = typeof surfaces.auditFile === 'string' && surfaces.auditFile !== ''
    ? path.resolve(surfaces.auditFile)
    : stateDir === null ? null : path.resolve(stateDir, AUDIT_NAME)

  if (stateDir !== null) {
    walkStateDir(path.resolve(stateDir), '', { sentinels, hits, errors, scanned, auditFile })
  }

  if (auditFile !== null) {
    scanAudit(auditFile, stateDir === null ? path.dirname(auditFile) : path.resolve(stateDir), sentinels, hits, errors, scanned)
  }

  return { ok: hits.length === 0 && errors.length === 0, hits, errors, scanned }
}
