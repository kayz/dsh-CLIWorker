// Minimal JSON Schema subset used to validate the contract files. Pure functions only:
// no imports, no IO. The caller supplies schemas and a cross-file loader.

const ANNOTATIONS = new Set([
  '$schema',
  '$id',
  'title',
  'description',
  '$defs',
  'examples',
  'default',
])

const SUPPORTED = new Set([
  'type',
  'enum',
  'const',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  '$ref',
])

const MAX_DEPTH = 64

const TYPE_NAMES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'])

function escapePointer(value) {
  return String(value).replace(/~/g, '~0').replace(/\//g, '~1')
}

function childPath(pointer, key) {
  return `${pointer}/${escapePointer(key)}`
}

function matchesType(type, value) {
  if (!TYPE_NAMES.has(type)) throw new TypeError(`unsupported type: ${type}`)
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (type === 'number') return typeof value === 'number'
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  if (type === 'null') return value === null
  return typeof value === type
}

function schemaKeywords(schema) {
  return Object.keys(schema).filter((key) => !ANNOTATIONS.has(key))
}

export function checkSchema(schema) {
  const problems = []

  function walk(node, pointer) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return
    for (const key of schemaKeywords(node)) {
      if (!SUPPORTED.has(key)) problems.push(`${pointer}: ${key}`)
    }
    if (node.$defs && typeof node.$defs === 'object') {
      for (const name of Object.keys(node.$defs)) {
        walk(node.$defs[name], childPath(`${pointer}/$defs`, name))
      }
    }
    if (node.properties && typeof node.properties === 'object') {
      for (const name of Object.keys(node.properties)) {
        walk(node.properties[name], childPath(`${pointer}/properties`, name))
      }
    }
    if (node.additionalProperties && typeof node.additionalProperties === 'object') {
      walk(node.additionalProperties, `${pointer}/additionalProperties`)
    }
    if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
      walk(node.items, `${pointer}/items`)
    }
  }

  walk(schema, '')
  return problems
}

function resolveRef(ref, currentRoot, loadSchema) {
  if (typeof ref !== 'string') throw new TypeError(`$ref must be a string`)
  const hash = ref.indexOf('#')
  const filePart = hash === -1 ? ref : ref.slice(0, hash)
  const pointerPart = hash === -1 ? '' : ref.slice(hash + 1)
  let target = currentRoot
  if (filePart !== '') {
    if (typeof loadSchema !== 'function') throw new TypeError(`cannot resolve $ref without loadSchema: ${ref}`)
    target = loadSchema(filePart)
    if (!target || typeof target !== 'object') throw new TypeError(`cannot resolve $ref: ${ref}`)
  }
  if (pointerPart === '') return { schema: target, root: target }
  const match = /^\/\$defs\/([^/]+)$/.exec(pointerPart)
  if (!match) throw new TypeError(`unsupported $ref: ${ref}`)
  const name = decodeURIComponent(match[1]).replace(/~1/g, '/').replace(/~0/g, '~')
  const defs = target.$defs
  if (!defs || !Object.prototype.hasOwnProperty.call(defs, name)) {
    throw new TypeError(`cannot resolve $ref: ${ref}`)
  }
  return { schema: defs[name], root: target }
}

export function validate(schema, doc, options = {}) {
  const loadSchema = options && typeof options.loadSchema === 'function' ? options.loadSchema : null
  const errors = []
  const seen = new Set()

  function push(path, keyword, message) {
    const key = `${path}\u0000${keyword}`
    if (seen.has(key)) return
    seen.add(key)
    errors.push({ path, keyword, message })
  }

  function checkKeywords(node) {
    for (const key of schemaKeywords(node)) {
      if (!SUPPORTED.has(key)) throw new TypeError(`unsupported keyword: ${key}`)
    }
  }

  function validateValue(node, value, pointer, depth, root) {
    if (depth > MAX_DEPTH) throw new TypeError('schema recursion is too deep')
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new TypeError(`schema at ${pointer} is not an object`)
    }
    checkKeywords(node)

    if (typeof node.$ref === 'string') {
      const resolved = resolveRef(node.$ref, root, loadSchema)
      validateValue(resolved.schema, value, pointer, depth + 1, resolved.root)
      return
    }

    if (Object.prototype.hasOwnProperty.call(node, 'type')) {
      const types = Array.isArray(node.type) ? node.type : [node.type]
      if (!types.some((type) => matchesType(type, value))) {
        push(pointer, 'type', `expected ${types.join('|')}`)
        return
      }
    }

    if (Object.prototype.hasOwnProperty.call(node, 'enum')) {
      const list = node.enum
      if (!Array.isArray(list) || !list.some((item) => deepSame(item, value))) {
        push(pointer, 'enum', 'value is not in the enum')
      }
    }

    if (Object.prototype.hasOwnProperty.call(node, 'const')) {
      if (!deepSame(node.const, value)) push(pointer, 'const', 'value does not equal const')
    }

    if (typeof value === 'string') {
      if (typeof node.minLength === 'number' && value.length < node.minLength) {
        push(pointer, 'minLength', `string is shorter than ${node.minLength}`)
      }
      if (typeof node.maxLength === 'number' && value.length > node.maxLength) {
        push(pointer, 'maxLength', `string is longer than ${node.maxLength}`)
      }
      if (typeof node.pattern === 'string' && !new RegExp(node.pattern).test(value)) {
        push(pointer, 'pattern', `string does not match ${node.pattern}`)
      }
    }

    if (typeof value === 'number') {
      if (typeof node.minimum === 'number' && value < node.minimum) {
        push(pointer, 'minimum', `number is smaller than ${node.minimum}`)
      }
      if (typeof node.maximum === 'number' && value > node.maximum) {
        push(pointer, 'maximum', `number is larger than ${node.maximum}`)
      }
    }

    if (Array.isArray(value)) {
      if (typeof node.minItems === 'number' && value.length < node.minItems) {
        push(pointer, 'minItems', `array is shorter than ${node.minItems}`)
      }
      if (typeof node.maxItems === 'number' && value.length > node.maxItems) {
        push(pointer, 'maxItems', `array is longer than ${node.maxItems}`)
      }
      if (node.uniqueItems === true) {
        const strings = value.map((item) => JSON.stringify(item))
        if (new Set(strings).size !== strings.length) push(pointer, 'uniqueItems', 'array has duplicates')
      }
      if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
        value.forEach((item, index) =>
          validateValue(node.items, item, childPath(pointer, index), depth + 1, root)
        )
      }
    }

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const properties = node.properties && typeof node.properties === 'object' ? node.properties : {}
      if (Array.isArray(node.required)) {
        for (const name of node.required) {
          if (!Object.prototype.hasOwnProperty.call(value, name)) {
            push(childPath(pointer, name), 'required', `missing required property ${name}`)
          }
        }
      }
      for (const name of Object.keys(value)) {
        if (Object.prototype.hasOwnProperty.call(properties, name)) {
          validateValue(properties[name], value[name], childPath(pointer, name), depth + 1, root)
        } else if (node.additionalProperties === false) {
          push(childPath(pointer, name), 'additionalProperties', `unexpected property ${name}`)
        } else if (node.additionalProperties && typeof node.additionalProperties === 'object') {
          validateValue(node.additionalProperties, value[name], childPath(pointer, name), depth + 1, root)
        }
      }
    }
  }

  validateValue(schema, doc, '', 0, schema)
  return { ok: errors.length === 0, errors }
}

function deepSame(a, b) {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) if (!deepSame(a[i], b[i])) return false
    return true
  }
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false
    if (!deepSame(a[key], b[key])) return false
  }
  return true
}
