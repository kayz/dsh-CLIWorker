# Task 014 — 配置 v2 与 v1 迁移（按仓库内迁移映射，quotas 映射为 pools）

## 约束

本文件定义裁决后实现的通过条件，当前不代表验收通过。design.md 的 CLI 路由范围和额度余额表示冲突尚待 attention.json 裁决；在裁决落实之前不能签署 AC-034 通过。brief 未指定基准 commit SHA 或验收报告路径，不以交班单 checkpoint 充当基线。

下列命令块各自作为独立临时 .ps1 的内容，从仓库根目录用 pwsh -NoProfile -File <临时脚本.ps1> 执行，环境为 Node 20+、PowerShell 7；临时脚本不写入仓库。每条独立判断：退出码及期望输出任一不符即失败，不依赖上一条命令遗留的输出文件。所有测试使用合成夹具、注入可用性和时钟，不依赖真实 CLI 登录或额度。调用原生命令后检查 $LASTEXITCODE。实现完成后执行这些检查；本 design 阶段不能为运行检查写入额外文件。

## 建议验收方向

1. AC-034 全部行为的直接验收。

   命令：

   ~~~pwsh
   node --test test/unit/config-v2.test.mjs
   if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
   ~~~

   期望输出：退出码 0；测试数大于 0，fail=0、cancelled=0、skipped=0。输出中 [AC-034] 用例必须分别证明：无 schema 与显式 v1 的内存迁移均生成 v2 并带 W_CONFIG_V1 且不写源文件；原生 v2 不带此警告；models 到 manual / allow / levels 且 level_source.kind=config；providers 到 discovery.cli_overrides；四种 quotas 按迁移映射变为 pools 并保留数值语义；真实 CLI 子进程成功生成可重新加载的 v2；固定时钟和注入可用性下，迁移前与重新加载迁移文件后的非空 draft 选模完整结果深相等。测试还须断言非法配置和明文密钥失败且错误体不含秘密。缺文件、空测试、跳过以上分支或只验证双方空结果均为失败。

2. AC-034 的正式发现验收。

   命令：

   ~~~pwsh
   node scripts/run-tests.mjs --ac AC-034 --out-dir (Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString()))
   if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
   ~~~

   期望输出：退出码 0，汇总含 run-tests: filtered 1 files；测试失败数为 0，实际执行 test/unit/config-v2.test.mjs 的 [AC-034] 用例；不得出现 FAIL run.no_match AC-034。独立的临时 out-dir 避免覆盖仓库报告。本条检查发现与过滤运行；T-014 分片及完整追踪校验由第 5 条检查覆盖。

3. brief 指定的公开 CLI 入口验收。

   命令：

   ~~~pwsh
   node --input-type=module --eval @'
   import assert from 'node:assert/strict'
   import fs from 'node:fs'
   import path from 'node:path'
   import os from 'node:os'
   import { spawnSync } from 'node:child_process'
   const input = path.resolve('test/fixtures/config/v1.json')
   const before = fs.readFileSync(input)
   const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cliworker-config-'))
   const output = path.join(dir, 'v2.json')
   try {
     const run = spawnSync(process.execPath, [
       'bin/cliworker.mjs', 'config', 'migrate', '--in', input, '--out', output,
     ], { encoding: 'utf8', windowsHide: true })
     assert.ifError(run.error)
     assert.equal(run.status, 0, run.stdout + run.stderr)
     assert.equal(JSON.parse(run.stdout).ok, true)
     assert.equal(run.stderr, '')
     const bytes = fs.readFileSync(output)
     assert.equal(bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])), false)
     const result = JSON.parse(bytes.toString('utf8'))
     assert.equal(result.schema, 'cliworker.config/v2')
     const schema = JSON.parse(fs.readFileSync('contracts/schemas/config.v2.schema.json', 'utf8'))
     for (const key of schema.required) assert.ok(Object.hasOwn(result, key), key)
     for (const key of Object.keys(result)) assert.ok(Object.hasOwn(schema.properties, key), key)
     assert.ok(Array.isArray(result.pools))
     const poolSchema = JSON.parse(fs.readFileSync('contracts/schemas/pool.schema.json', 'utf8'))
     for (const pool of result.pools) {
       for (const key of poolSchema.required) assert.ok(Object.hasOwn(pool, key), key)
       for (const key of Object.keys(pool)) assert.ok(Object.hasOwn(poolSchema.properties, key), key)
     }
     for (const key of ['providers', 'models', 'quotas', '_file', '_home']) {
       assert.equal(Object.hasOwn(result, key), false, key)
     }
     assert.deepEqual(fs.readFileSync(input), before)
     console.log('PASS AC-034 config migrate')
   } finally {
     if (fs.existsSync(output)) fs.unlinkSync(output)
     fs.rmdirSync(dir)
   }
   '@
   if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
   ~~~

   期望输出：退出码 0，stdout 恰为 PASS AC-034 config migrate，stderr 为空；任一断言失败即失败。命令独立调用真实 CLI，检查成功 JSON、文件生成、无 BOM、v2 schema 名、根与 pools 的必需键及禁止额外键、源夹具字节不变，并清理自己的临时文件。完整嵌套 schema、全部映射数值及秘密不泄露由第 1 条自动测试覆盖，不能仅凭本条的结构断言代替。命令每次使用新的临时目录，不依赖第 1、2 条产物。

   当前已复现的失败输出：退出码 2；ok=false；error.code=E_UNKNOWN_COMMAND；error.message=unknown command: config migrate；stderr 为空。此现状是待决冲突的证据，不是允许的验收豁免。

4. 本任务涉及的加载、路径和 draft 兼容回归。

   命令：

   ~~~pwsh
   node --test test/unit/config.test.mjs test/unit/paths.test.mjs test/unit/select.test.mjs test/unit/select-draft.test.mjs
   if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
   ~~~

   期望输出：退出码 0，测试数大于 0，fail=0、cancelled=0、skipped=0；既有示例拒载、E_CONFIG、配置路径/状态路径优先级及 draft 拒选/排序断言全部通过。不得修改这些范围外的测试来接受回归。

5. 项目完成前检查。

   命令：

   ~~~pwsh
   pwsh -NoProfile -File scripts/check-fast.ps1
   if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
   ~~~

   期望输出：退出码 0，最终输出 check-fast: ok；无 FAILED 步骤，完整测试发现和追踪检查通过。该命令内部包含现有检查及全量测试；本阶段因禁止执行 git 及限制额外写入而未运行，裁决后由有相应权限的实现/验收阶段执行，不得用缩减检查替代。

6. brief 指定的 M2 总门禁。

   命令：

   ~~~pwsh
   node scripts/milestone-gate.mjs --milestone M2
   if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
   ~~~

   期望输出：退出码 0，输出 milestone-gate M2: PASS。若输出 BLOCKED 或任何 FAIL，门禁失败；应逐项记录其所属任务，不能仅因 AC-034 通过就宣称 M2 通过，也不能越界补写其他任务分片。此命令检查里程碑覆盖状态，不能替代第 1、2 条实际测试执行。

## 非目标

本阶段不执行上述实现验收，不生成报告，不接入真实 provider，不修改冻结契约或范围外文件。两处待决冲突必须先裁决；本文件不默认扩大 write_scope、不删减 AC-034。
