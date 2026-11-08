## AC-045

- 命令: `node scripts/run-tests.mjs --ac AC-045; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`
- 期望输出: 退出码 0；输出包含实际通过的 [AC-045] 测试标题，tests 数大于 0，fail、cancelled、skipped、todo 均为 0，结尾包含 run-tests: filtered 1 files。只执行 test/unit/catalog.test.mjs；无匹配、模块导入失败、缺少依赖或空跑均失败。运行报告使用运行器既有系统临时目录，不写仓库。
- 对应测试必须逐项断言：空白名单无候选；未允许模型即使 callable 且有有效等级也不在候选和选择 rejected 中；未允许模型在管理 models 中仍存在、allowed=false，管理副本 availability.reason=not_allowed，state 保持冻结枚举，目录原记录未被改写。使用同一份实际 filterAllowed 结果驱动探测队列和 forecast 注入回调，逐 key 断言未允许模型的探测调用数、预测输入数、计费回调数均为 0，并断言允许的合格对照模型的对应计数大于 0。有真实工作发生后再排除目标，不能用从未运行的管线证明零调用。白名单过滤发生在拒选记录和任何回调之前；别名不能绕过禁止状态，deny 后重新读取仍被排除。
- 同文件必须通过现有 main 和注入 ctx 覆盖 list、allow、deny、level、alias 的动态分发，检查单 JSON 成功或既有错误体、对应退出码、修改后重新加载生效。list 默认显示未允许及弃用模型，--all 可接受，exec/fetch/forecast/记账均未调用。allow/deny 幂等、规范 key 落盘，其他配置及元数据保留；未知目标、非法参数、v1 写入、锁失败、原子写失败不得更改原配置或报告成功。所有文件操作仅使用注入 fakeFs 或测试自建系统临时目录。

## AC-046

- 命令: `node scripts/run-tests.mjs --ac AC-046; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`
- 期望输出: 退出码 0；输出包含实际通过的 [AC-046] 测试标题，tests 数大于 0，fail、cancelled、skipped、todo 均为 0，结尾包含 run-tests: filtered 1 files。只执行 test/unit/catalog-levels.test.mjs；不得依赖 AC-045 运行生成的配置或报告。
- 对应测试必须用人工预期逐项断言：三种来源冲突时 config 胜出，移除配置后 measured 胜出，再移除 measured 后 cli 胜出；完整比较 level_source.kind/ref/at，measured / cli 的证据时间不随读取改写；配置来源引用和时刻符合 design.md，输入顺序变化不影响不同优先级结果。同级证据选最新，等时冲突 E_CONFIG。四种等级及大小写归一全部覆盖；非法配置等级 E_CONFIG，命令缺等级 E_LEVEL_REQUIRED、非法等级 E_LEVEL_UNKNOWN，均无配置写入。
- 白名单内未分档模型的 level 与 level_source 为 null，selectModels 中仅以 level_unassigned 拒选；未允许且未分档模型不出现在选择 rejected。规范 key 与唯一别名解析结果相同，别名不会复制候选；allow/deny/level 对别名和规范 key 操作等价；重复同指向别名幂等，冲突、自指、链、循环、覆盖其他规范 key、未知目标均按设计失败，输入和配置不变。
- 上游弃用或配置弃用均形成 deprecated=true、availability.state=deprecated，以 deprecated 拒选；同时缺等级时仍是 deprecated，allow / level 不复活它；未允许且弃用模型不进入选择 rejected。弃用处理保留原实测证据，不能伪造新的 probe。能力、价格、模型 source 及等级 source 分别完整比较；不同来源的等级覆盖不改价格或能力，有效零价格和 false 能力保留，非法数值不能变成免费或已支持。输出逐条按 contracts/schemas/model.v1.schema.json 校验，不新增属性、可用性或 schema 版本；输入对象及嵌套证据不变。使用合成 canary 验证管理输出、错误、stdout/stderr 不泄露令牌。

## 建议验收方向

- 命令: `node --input-type=module --eval "import a from 'node:assert/strict'; import fs from 'node:fs'; import {validateIndex,mergeShards} from './scripts/check-traceability.mjs'; const index=JSON.parse(fs.readFileSync('contracts/spec/ac-index.json','utf8')); a.deepEqual(validateIndex(index),[]); const result=mergeShards({root:process.cwd(),index}); a.deepEqual(result.errors,[]); const shard=JSON.parse(fs.readFileSync('test/traceability/T-019.json','utf8')); a.deepEqual(shard,{task:'T-019',milestone:'M3',entries:[{ac:'AC-045',files:['test/unit/catalog.test.mjs'],status:'covered'},{ac:'AC-046',files:['test/unit/catalog-levels.test.mjs'],status:'covered'}]}); for(const ac of ['AC-045','AC-046']) a.equal(result.acs[ac],'covered'); console.log('T-019 OK');"; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`
- 期望输出: 退出码 0，stdout 精确为 T-019 OK 加换行。独立读取权威索引、全部追踪分片及测试标题；T-019 只有本任务两项 covered、路径正确、无重复/非属主声明/缺文件/缺实际测试标题。任何断言失败均非零且不得输出成功标记；不接受追踪检查本身成功但两项仍 planned。

- 命令: `pwsh -NoProfile -File scripts/check-fast.ps1; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }`
- 期望输出: 退出码 0，最终输出 check-fast: ok；全量测试实际执行，发现集合校验成功，无失败或取消。本命令是项目既有完成检查，不扩展 T-019 的 AC 属主或代码写入范围。依赖任务未完成或范围外失败应由下游如实报告，不能省略、伪造通过或越界修复。

## 约束

以上是下游实现完成后的验收标准，设计阶段未运行，不表示当前已通过。命令均从仓库根 C:/git/dsh-CLIWorker/.collab/worktrees/019 以 PowerShell 7 独立执行，使用 Node 20+，不依赖默认用户配置、真实登录、真实 provider 或其他验收命令生成的文件。每条命令必须同时满足退出码和期望输出；skip、todo、空跑不能算通过。brief 未提供基准 commit SHA 或既有验收报告路径，不能借用其他任务的报告或将蓝图特征化提交当作本任务基线。
