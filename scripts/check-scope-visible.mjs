#!/usr/bin/env node
// 校验任务图里每个任务的 write_scope 路径都没有被 .gitignore 忽略。
//
// 背景（2026-11-09）：`.gitignore` 的 `state/`（无锚点）把 `lib/commands/state/`
// 整层吞掉，命令从未进入版本库；`*.jsonl` 也吞掉过测试夹具。两者都表现为
// "本地测试通过、合并后主干变红"，且 `git ls-files --others --exclude-standard`
// 看不见它们（被忽略的文件不出现在该列表里）。
//
// 用法：node scripts/check-scope-visible.mjs [--root <dir>]
// 退出码：0 = 全部可见；1 = 有路径被忽略；2 = 参数/环境错误。

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const USAGE = 'usage: node scripts/check-scope-visible.mjs [--root <dir>]'
const COLLAB = '.' + 'collab'
const GRAPH_REL = COLLAB + '/blueprint/cliworker-v2/task-graph.json'

function parseArgs(argv) {
  let root = path.resolve(HERE, '..')
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag === '--root') {
      const value = argv[i + 1]
      if (!value) {
        process.stderr.write(`check-scope-visible: --root requires a directory\n${USAGE}\n`)
        process.exit(2)
      }
      root = path.resolve(value)
      i += 1
      continue
    }
    process.stderr.write(`check-scope-visible: unknown argument: ${flag}\n${USAGE}\n`)
    process.exit(2)
  }
  return { root }
}

/** 返回 true 表示该路径被 .gitignore 忽略。 */
export function isIgnored(root, relPath) {
  const result = spawnSync('git', ['check-ignore', '-q', '--no-index', '--', relPath], {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.error) return null
  if (result.status === 0) return true
  if (result.status === 1) return false
  return null
}

/** 从任务图里取出 [taskId, path] 对。尾部 `/` 或 `/**` 通配视为目录前缀。 */
export function scopePaths(graph) {
  const out = []
  for (const task of graph.tasks ?? []) {
    for (const entry of task.write_scope ?? []) {
      const normalized = String(entry).replace(/\/\*\*$/, '').replace(/\/+$/, '')
      if (normalized) out.push([task.id, normalized])
    }
  }
  return out
}

export function checkScope(root, graph) {
  const errors = []
  for (const [taskId, relPath] of scopePaths(graph)) {
    const ignored = isIgnored(root, relPath)
    if (ignored === null) {
      errors.push({ taskId, path: relPath, reason: 'check-ignore-failed' })
      continue
    }
    if (ignored) errors.push({ taskId, path: relPath, reason: 'ignored-by-gitignore' })
  }
  return errors
}

function main(argv) {
  const { root } = parseArgs(argv)
  const graphPath = path.join(root, GRAPH_REL)
  if (!fs.existsSync(graphPath)) {
    process.stdout.write(`check-scope-visible: ok (no task graph at ${GRAPH_REL})\n`)
    return 0
  }
  let graph
  try {
    graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'))
  } catch (error) {
    process.stderr.write(`check-scope-visible: cannot parse ${GRAPH_REL}: ${error.message}\n`)
    return 2
  }
  const errors = checkScope(root, graph)
  if (errors.length === 0) {
    const count = scopePaths(graph).length
    process.stdout.write(`check-scope-visible: ok (paths=${count})\n`)
    return 0
  }
  for (const error of errors) {
    process.stdout.write(`FAIL scope_hidden ${error.taskId} ${error.path} (${error.reason})\n`)
  }
  process.stdout.write(`check-scope-visible: FAILED (${errors.length} hidden paths)\n`)
  return 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
