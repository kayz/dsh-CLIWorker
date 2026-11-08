# Task 028 — 验收

工作目录为仓库根，使用 Node 20+ 与 PowerShell 7。每个 pwsh 代码块是一条独立验收命令，执行端将其存为 UTF-8 无 BOM 的临时 ps1，以 `pwsh -NoProfile -File` 执行。每条命令仅在全部断言通过后打印哨兵，退出非 0、异常或缺少哨兵均失败。运行夹具与测试产物放仓库外，不使用真实凭据或模型服务。brief 未指定基准 commit 或既有报告；本验收引用当前只读契约文件。

## AC-067 文档命令离线成功、迁移覆盖与回归（integration）

命令：运行文档检查入口。

```pwsh
$ErrorActionPreference = 'Stop'
$docsOutput = & node scripts/check-docs.mjs 2>&1
if ($LASTEXITCODE -ne 0) { throw ($docsOutput -join "`n") }
$docsText = $docsOutput -join "`n"
if ($docsText -notmatch 'check-docs: ok') { throw 'Missing successful docs check output' }
Write-Output $docsText
Write-Output 'AC-067 OK'
```

期望输出：退出码 0，stdout 包含 `check-docs: ok` 与 `AC-067 OK`。checker 已真实执行 README 与 docs 中标为可运行的片段，未运行数不能伪装成功；六份文档、链接、请求示例和迁移覆盖均通过，命令退出/响应满足 design.md 的判据，未使用真实模型服务或用户配置。

命令：执行文档集成测试，包括使检查器失败的样本。

```pwsh
$ErrorActionPreference = 'Stop'
& node --test test/integration/docs.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Docs integration tests failed' }
Write-Output 'AC-067 OK'
```

期望输出：退出码 0、失败测试数为 0，stdout 包含 `AC-067 OK`。覆盖真实片段的离线执行和 fake-cli 调用记录，以及缺语义正文、缺映射、错目标、未知推荐字段、非零退出/超时、零片段、无效标记/路径/链接等输入均被拒绝；不以测试标题或函数名作为判据。

命令：独立从注册表与迁移映射核对文档覆盖，避免只依赖测试自报成功。

```pwsh
$ErrorActionPreference = 'Stop'
$coverageSource = @'
import fs from 'node:fs';
import assert from 'node:assert/strict';
const read = p => fs.readFileSync(p, 'utf8');
for (const p of ['README.md', 'docs/agentline-integration.md', 'docs/migration.md', 'docs/ui.md', 'docs/platforms.md', 'docs/host-contract.md']) {
  assert.ok(read(p).trim().length > 0, p + ' missing or empty');
}
const registry = JSON.parse(read('contracts/registry.snapshot.json'));
const map = JSON.parse(read('contracts/spec/migration-map.json'));
const text = read('docs/migration.md').replace(/\r\n/g, '\n');
const sections = [...text.matchAll(/^###\s+`?([^`\n]+?)`?\s*\n([\s\S]*?)(?=^#{1,3}\s|$(?![\s\S]))/gm)];
for (const id of registry.semantic_change) {
  const found = sections.filter(m => m[1].trim() === id);
  assert.equal(found.length, 1, 'missing or duplicate semantic section: ' + id);
  assert.ok(found[0][2].split('\n').some(line => line.trim() && !/^\s*(?:\||<!--|#)/.test(line)), 'missing semantic prose: ' + id);
}
const rows = text.split('\n').filter(line => /^\s*\|/.test(line));
for (const item of [...map.draft_to_v1.reasons, ...map.draft_to_v1.fields, ...map.config_v1_to_v2]) {
  const found = rows.filter(line => line.split('|')[1].trim().replace(/`/g, '') === item.id);
  assert.equal(found.length, 1, 'missing or duplicate mapping: ' + item.id);
  const cells = found[0].split('|').slice(2).map(s => s.replace(/`/g, '').trim());
  assert.ok(cells.some(s => s.includes(item.draft ?? item.from)), 'missing mapping source: ' + item.id);
  const targets = item.v1 === undefined ? item.to : [item.v1];
  for (const target of targets) assert.ok(cells.slice(1).some(s => s.includes(target)), 'missing mapping target: ' + item.id + ': ' + target);
  if (targets.length === 0) assert.ok(cells.slice(1).some(s => s.includes('移除')), 'missing removal: ' + item.id);
}
console.log('AC-067 OK');
'@
& node --input-type=module -e $coverageSource
if ($LASTEXITCODE -ne 0) { throw 'Migration coverage failed' }
```

期望输出：退出码 0，stdout 包含 `AC-067 OK`；所有 `semantic_change` 各有唯一段落与正文，`draft_to_v1.reasons`、`draft_to_v1.fields`、`config_v1_to_v2` 每项各有唯一映射行、来源及全部目标，空目标说明移除。检查读取现有源清单，不把目前项数当作固定总数。

命令：执行全量 unit 回归门禁。

```pwsh
$ErrorActionPreference = 'Stop'
& node --test "test/unit/*.test.mjs"
if ($LASTEXITCODE -ne 0) { throw 'Unit regression failed' }
Write-Output 'AC-067 OK'
```

期望输出：退出码 0、失败测试数为 0，stdout 包含 `AC-067 OK`。

命令：执行仓库既有快速检查入口。

```pwsh
$ErrorActionPreference = 'Stop'
& pwsh -NoProfile -File scripts/check-fast.ps1
if ($LASTEXITCODE -ne 0) { throw 'Repository checks failed' }
Write-Output 'AC-067 OK'
```

期望输出：退出码 0，stdout 包含 `check-fast: ok` 与 `AC-067 OK`；包含自动发现的 check-docs、既有 check-no-collab、追溯与其他现有门禁。该命令供实现完成后的验收执行端运行，设计阶段不执行会创建其他文件或调用 git 的完整检查链。

## AC-068 AgentLine 契约说明与禁词零命中（unit）

命令：执行 AgentLine 文档单元测试。

```pwsh
$ErrorActionPreference = 'Stop'
& node --test test/unit/agentline-doc.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'AgentLine documentation tests failed' }
Write-Output 'AC-068 OK'
```

期望输出：退出码 0、失败测试数为 0，stdout 包含 `AC-068 OK`。真实文档包含核心请求字段、顺序执行 calls、再申请和错误/流程状态说明；全文禁词零命中，逐禁词正例和合法长标识符/完整错误码反例均符合边界规则。

命令：直接用只读禁词表扫描完整交付文档，不豁免代码块、注释或链接。

```pwsh
$ErrorActionPreference = 'Stop'
$scanSource = @'
import fs from 'node:fs';
import assert from 'node:assert/strict';
const text = fs.readFileSync('docs/agentline-integration.md', 'utf8');
assert.ok(text.trim(), 'empty AgentLine documentation');
const forbidden = JSON.parse(fs.readFileSync('contracts/agentline-forbidden.json', 'utf8')).keys;
assert.ok(Array.isArray(forbidden) && forbidden.length > 0, 'empty forbidden keys');
const hits = forbidden.filter(key => {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(?<![A-Za-z0-9_])' + escaped + '(?![A-Za-z0-9_])', 'i').test(text);
});
assert.deepEqual(hits, [], 'forbidden whole words: ' + hits.join(', '));
console.log('AC-068 OK');
'@
& node --input-type=module -e $scanSource
if ($LASTEXITCODE -ne 0) { throw 'AgentLine forbidden-word scan failed' }
```

期望输出：退出码 0，stdout 包含 `AC-068 OK`，`contracts/agentline-forbidden.json.keys` 整词扫描命中数为 0。
