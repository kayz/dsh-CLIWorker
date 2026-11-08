/**
 * 递归检测配置中的内联明文密钥。
 *
 * 骨架：T-034 的起点。实现者在此基础上扩展规则，不要删除既有导出。
 */

const SECRET_KEY_RE = /^(api[_-]?key|apikey|token|secret|password|passwd|credential|auth)$/i
const PLAINTEXT_RE = /^(sk-[A-Za-z0-9_-]{8,}|[A-Za-z0-9_-]{32,})$/

/**
 * 递归扫描一个配置对象。
 *
 * @returns {{found: boolean, paths: string[]}}
 *   paths 是形如 `providers.claude.apiKey` 的路径列表，按发现顺序。
 */
export function detectInlineSecret(value, prefix = '') {
  const paths = []
  walk(value, prefix, paths)
  return { found: paths.length > 0, paths }
}

function walk(value, prefix, paths) {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    value.forEach((item, i) => walk(item, prefix ? `${prefix}[${i}]` : `[${i}]`, paths))
    return
  }
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof child === 'string' && SECRET_KEY_RE.test(key) && PLAINTEXT_RE.test(child)) {
      paths.push(path)
      continue
    }
    walk(child, path, paths)
  }
}

/**
 * 判断一个配置是否可以直接加载：含明文密钥时返回 false 并给出路径。
 */
export function assertNoInlineSecret(config) {
  const { found, paths } = detectInlineSecret(config)
  if (!found) return { ok: true, paths: [] }
  return {
    ok: false,
    code: 'E_INLINE_SECRET',
    message: `inline plaintext secret detected at: ${paths.join(', ')}`,
    paths,
  }
}
