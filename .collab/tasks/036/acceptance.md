# Task 036 — 模型表静态检查与 per-CLI 枚举器

## 验收

以下均在仓库根目录、PowerShell 7 中独立执行；原生命令执行后立即检查 `$LASTEXITCODE`，非 0 即该项失败。下列是下游实现完成后的标准，本 design 阶段未执行，不代表通过。brief 只给出单元测试当前基线 356 pass，没有基准 SHA 或既有验收报告路径。

当前阻塞见 design.md 和 attention.json：中央追踪只接受 AC-001..AC-074，加入 AC-079 分片将使既有单元测试失败；per-CLI 模块接口与范围也待裁决。必须先解决阻塞，不能将以下任何失败改写为通过。

1. AC-079（contract）。

   命令：

   ```pwsh
   node scripts/check-no-model-table.mjs
   ```

   期望输出：退出码 0，stdout 单独一行为 `AC-079 OK`，没有命中或读取错误诊断。非 0、缺成功标记均失败。

2. AC-079 夹具与诊断。

   命令：

   ```pwsh
   node --test test/unit/check-no-model-table.test.mjs
   ```

   期望输出：退出码 0，实际运行的用例标题全部以 `[AC-079]` 开头，`fail 0`、`skipped 0`、`todo 0`，测试数大于 0。用例须包含 design.md 逐项规定的正反例；其中三个 CLI、三个模型 id、对象及嵌套表、混合表、相似白名单路径反例必须观察到实际扫描失败；子进程失败输出必须断言路径、1 基行号、原始片段且没有 `AC-079 OK`。干净与精确白名单子进程必须退出 0。缺少这些行为覆盖即失败，不能用零用例或只检查内部辅助函数代替。

3. AC-079 flow 步骤独立接线。

   命令：

   ```pwsh
   @'
   import assert from 'node:assert/strict';
   import {createFlow, discoverSteps} from './test/helpers/flow.mjs';
   const steps = await discoverSteps();
   const step = steps.find(s => s.name === 'enumerate');
   assert.ok(step, 'enumerate step missing');
   assert.equal(step.mod.introduced_by, 'T-036');
   assert.deepEqual(step.mod.ac, ['AC-079']);
   const flow = createFlow();
   try {
     await step.mod.run(flow);
     assert.ok(flow.captured.argv.some(a =>
       a.includes('models') && a.includes('enumerate') && a.includes(flow.config_path)));
     const scan = flow.scan();
     assert.equal(scan.ok, true);
     assert.deepEqual(scan.hits, []);
     console.log('AC-079 OK');
   } finally { flow.cleanup(); }
   '@ | node --input-type=module
   ```

   期望输出：退出码 0，最后一行为 `AC-079 OK`。步骤被真实发现、实际调用 bin、内部执行 JSON 解析和非空 model/v1 字段断言、泄漏检查通过；步骤缺失、抛错、未调用 CLI 或泄漏均以非 0 失败。

4. AC-079 追踪分片。

   命令：

   ```pwsh
   @'
   import fs from 'node:fs';
   import assert from 'node:assert/strict';
   import {extractTitles} from './scripts/check-traceability.mjs';
   const shard = JSON.parse(fs.readFileSync('test/traceability/T-036.json', 'utf8'));
   assert.deepEqual(shard, {
     task: 'T-036', milestone: 'M3',
     entries: [{ac: 'AC-079', status: 'covered', files: [
       'test/unit/check-no-model-table.test.mjs', 'test/flows/steps/enumerate.mjs'
     ]}]
   });
   for (const file of shard.entries[0].files) assert.ok(fs.statSync(file).isFile());
   const source = fs.readFileSync(shard.entries[0].files[0], 'utf8');
   assert.ok(extractTitles(source).some(t =>
     t.kind === 'plain' && t.title.startsWith('[AC-079]')));
   console.log('AC-079 OK');
   '@ | node --input-type=module
   ```

   期望输出：退出码 0，stdout 为 `AC-079 OK`。JSON、精确字段及值、文件存在性、可执行 AC 测试标题任一不符均非 0。

5. AC-079 全仓追踪兼容。

   命令：

   ```pwsh
   node scripts/check-traceability.mjs --json
   ```

   期望输出：退出码 0，JSON 中 `ok` 为 true、`errors` 为空，`acs` 包含 AC-079 且其 `status` 为 covered。当前索引未兼容时此项必失败；不能删除 T-036 分片、隐藏未知 AC 或使用临时索引代替全仓结果。

6. 既有单元测试回归门禁。

   命令：

   ```pwsh
   node --test "test/unit/*.test.mjs"
   ```

   期望输出：退出码 0，汇总 `fail 0`；在 brief 的 356 pass 基础上保留既有用例并增加 AC-079 用例，不固定最终精确总数。不能通过改断言、删除/跳过既有用例达标。测试文件发现失败或空跑均失败。

7. flow 回归。

   命令：

   ```pwsh
   node --test test/flows/flow.test.mjs
   ```

   期望输出：退出码 0，`fail 0`、`skipped 0`、`todo 0`，既有完整 flow 与步骤发现测试均通过，新增 enumerate 可与其他步骤共用状态目录。

8. 项目完成前检查。

   命令：

   ```pwsh
   pwsh -NoProfile -File scripts/check-fast.ps1
   ```

   期望输出：退出码 0，发现并执行 `check-no-model-table.mjs`，包含 `AC-079 OK`，最后一行为 `check-fast: ok`。任何步骤失败均失败，包含中央追踪冲突；不得绕过自动检查发现机制。此命令及测试可能生成临时数据或间接调用 git，只由后续具备相应执行授权的阶段运行，本设计角色不执行。
