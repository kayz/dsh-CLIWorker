# Task 036 — 模型表静态检查与 per-CLI 枚举器

## 验收

以下均在仓库根目录、PowerShell 7 中独立执行；原生命令执行后立即检查 `$LASTEXITCODE`，非 0 即该项失败。下列是下游实现完成后的标准，本 design 阶段未执行，不代表通过。brief 只给出单元测试当前基线 356 pass，没有基准 SHA 或既有验收报告路径。

本轮用户已授权 AC-079 的最小追加与必要的计数迁移，并取消 per-CLI 模块；上一轮 attention.json 的问题已获回答，不再作为暂停条件。以下标准包含中央追踪兼容，产品交付仍为 brief 四项。增量 `e2667e5` 仅作为用户提供的变更引用；沿用工作树已更新的 E_LEVEL_UNKNOWN/E_REQUEST_INVALID 错误码，不执行 git 获取提交内容。

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

   期望输出：退出码 0，JSON 中 `ok` 为 true、`errors` 为空，`acs` 包含 AC-079 且其 `status` 为 covered。不能删除 T-036 分片、隐藏未知 AC 或使用临时索引代替全仓结果。

6. 既有单元测试回归门禁。

   命令：

   ```pwsh
   node --test "test/unit/*.test.mjs"
   ```

   期望输出：退出码 0，汇总 `fail 0`；在 brief 的 356 pass 基础上保留既有用例并增加 AC-079 用例，不固定最终精确总数。仅按 design.md 迁移索引数量断言和对应缺失反例，不降低原校验强度；不能删除/跳过既有用例。测试文件发现失败或空跑均失败。

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

   期望输出：退出码 0，发现并执行 `check-no-model-table.mjs`，包含 `AC-079 OK`，最后一行为 `check-fast: ok`。任何步骤失败均失败；不得绕过自动检查发现机制。此命令及测试可能生成临时数据或间接调用 git，只由后续具备相应执行授权的阶段运行，本设计角色不执行。

9. AC-079 只追加与旧索引兼容。

   命令：

   ```pwsh
   @'
   import fs from 'node:fs';
   import assert from 'node:assert/strict';
   import {validateIndex} from './scripts/check-traceability.mjs';
   import {validate} from './lib/contract/validate.mjs';
   const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
   const legacy = read('test/fixtures/traceability/ac-index.json');
   const current = read('contracts/spec/ac-index.json');
   const schema = read('contracts/schemas/ac-index.schema.json');
   const added = {ac:'AC-079',owner:'T-036',milestone:'M3',
     levels:['contract'],baseline:['darwin','linux','win32']};
   assert.deepEqual(current, {...legacy, acs:[...legacy.acs, added]});
   assert.equal(current.acs.length, legacy.acs.length + 1);
   assert.deepEqual(validateIndex(legacy), []);
   assert.deepEqual(validateIndex(current), []);
   for (const index of [legacy, current]) {
     const result = validate(schema, index);
     assert.equal(result.ok, true, JSON.stringify(result.errors));
     const missing = structuredClone(index);
     missing.acs.splice(1, 1);
     assert.ok(validateIndex(missing).some(e => e.id === 'index.count'));
     const duplicate = structuredClone(index);
     duplicate.acs[duplicate.acs.length - 1] = {...duplicate.acs[0]};
     assert.ok(validateIndex(duplicate).some(e => e.id === 'index.count'));
     const reordered = structuredClone(index);
     [reordered.acs[0], reordered.acs[1]] = [reordered.acs[1], reordered.acs[0]];
     assert.ok(validateIndex(reordered).some(e => e.id === 'index.count'));
   }
   const unknown = structuredClone(current);
   unknown.acs.push({...added, ac:'AC-080'});
   assert.ok(validateIndex(unknown).some(e => e.id === 'index.count'));
   console.log('AC-079 OK');
   '@ | node --input-type=module
   ```

   期望输出：退出码 0，stdout 为 `AC-079 OK`；中央索引仅为原 74 条加 AC-079 共 75 条，原字段、条目内容及顺序完全相同；旧完整夹具与新索引均通过索引检查和 schema 校验，核心条目缺失、重复、乱序、未知扩展均仍失败。旧夹具禁止修改，不能通过改变参照来通过验收。

10. 中央追踪及本轮模型错误码回归。

    命令：

    ```pwsh
    node --test test/unit/traceability.test.mjs test/unit/milestone-gate.test.mjs test/unit/lock.test.mjs test/unit/models-enumerate.test.mjs test/unit/models-add.test.mjs
    ```

    期望输出：退出码 0，`fail 0`、`skipped 0`、`todo 0`；原追踪与 milestone 夹具保留其有效/无效结论，models add 继续断言非法级别 E_LEVEL_UNKNOWN、未知 provider E_REQUEST_INVALID 且配置不变。实际 milestone 文件在 unit 目录；不为不存在的 `test/contract/milestone-gate.test.mjs` 新建文件。

11. 既有契约文档一致性。

    命令：

    ```pwsh
    node scripts/check-contract-doc.mjs
    ```

    期望输出：退出码 0，stdout 为 `check-contract-doc: ok`；当前 schema 已使用 AC ID 正则且支持 AC-079，无需修改 schema 或重生成文档。旧索引与新索引的 schema 兼容已由第 9 条直接校验，不以文档检查代替。

12. 冻结清单同步。

    命令：

    ```pwsh
    node scripts/check-golden-frozen.mjs
    ```

    期望输出：退出码 0，stdout 匹配 `check-golden-frozen: ok (... files)`，没有 `golden.changed`、`golden.unregistered` 或其他失败。实现修改中清单只能刷新中央索引对应摘要，不得接受其他文件漂移。
