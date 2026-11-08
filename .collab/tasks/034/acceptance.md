# Task 034 - 配置明文拒载与凭据后端失败处理

## 目标

只验收 AC-033（unit、integration），以同目录 design.md 为准。用户已决定暂停 T-034，直到 T-013 合并；四文件写入范围不变，不编造接口、不建立测试专用后端。当前未执行以下验收命令，没有通过记录。

brief 未给基准 commit SHA 或既有验收报告路径，不自行添加。T-013 是否合并由调度器或人类确认；本角色禁止执行 git，以下测试结果也不能代替合并确认。合并后须先在包含依赖实现的工作树中核对 lib/secrets、lib/commands/auth 和 auth 路由的真实公开 API，补全设计及测试调用链，随后才实施和验收。

## 约束

以下每条均在仓库根 C:/git/dsh-CLIWorker/.collab/worktrees/034 用 PowerShell 7 独立执行，不依赖其他验收命令的产物。执行原生命令后检查 $LASTEXITCODE；每条必须同时满足退出码和期望输出。文件缺失、导入失败、零用例、失败、取消、跳过或 todo 均不能算本任务目标测试通过。

目标测试只能通过合成配置、模拟 exec 和文件系统等外部依赖调用真实生产模块；不得访问真实登录、网络或原生 keyring，不得仅测错误构造器，不得用测试自建凭据后端代替 T-013。测试源码须含下述行为断言，不能靠打印测试名称或伪造汇总满足要求。暂停期间不执行这些实现验收命令。

## 建议验收方向

- 命令：`node --test --test-reporter=tap test/unit/inline-secret.test.mjs`
- 期望输出：退出码 0；TAP 汇总 tests 大于 0、pass 等于 tests、fail 0、cancelled 0、skipped 0、todo 0。通过的用例须经真实配置加载路径断言：对象和数组递归扫描；token、api_key、secret、password 的大小写变体及合并后既有敏感键规则拒载；错误码为 E_CONFIG_SECRET_INLINE；合法 SecretRef、既有空值语义及非敏感文本兼容；引用对象不能夹带明文绕过扫描；无 schema、v1、v2 合法配置及迁移兼容；源配置不变；错误及捕获输出不含合成秘密。具体输入结构及公开调用在 T-013 合并后依据真实实现补全。

- 命令：`node --test --test-reporter=tap test/integration/secret-backend-failure.test.mjs`
- 期望输出：退出码 0；TAP 汇总 tests 大于 0、pass 等于 tests、fail 0、cancelled 0、skipped 0、todo 0。通过的用例须调用 T-013 的真实后端和 auth status 路由：分别注入 secret-tool、security、pwsh 的 ENOENT，断言 E_SECRET_BACKEND；对应 CLI 错误退出码为 3、retryable=false；state_dir 文件列表在操作前后相同，无明文回退或泄露；失败不能返回成功或伪装 unset；正常的已设置、未设置状态分别只暴露既有 set/unset 状态及既有输出结构，不含凭据。三个平台的模拟故障均实际运行。生产模块路径、路由参数和结果断言在 T-013 合并后按真实 API 补全，不预设新字段。

- 命令：`node --test test/unit/inline-secret.test.mjs test/integration/secret-backend-failure.test.mjs`
- 期望输出：退出码 0；两个文件均实际运行，汇总 tests 大于 0、pass 等于 tests、fail 0、cancelled 0、skipped 0、todo 0；明文拒载、后端失败、凭据状态三项断言全部通过。这是 brief 指定的 AC-033 总验收命令；缺少依赖或目标文件时判为未通过，不以 skip 替代。

- 命令：`node --test --test-reporter=tap test/unit/config.test.mjs test/unit/config-v2.test.mjs`
- 期望输出：退出码 0；TAP 汇总 tests 大于 0、pass 等于 tests、fail 0、cancelled 0、skipped 0、todo 0。现有配置回归全部通过，保持示例拒载、配置错误、迁移、源文件不变、state_dir 与兼容视图行为。不得修改范围外的回归文件使检查通过。

- 命令：`pwsh -NoProfile -File scripts/check-fast.ps1`
- 期望输出：退出码 0，输出包含 `check-fast: ok`，不出现 `check-fast: FAILED step` 或 `check-fast: test injection active`。仅由获授权的下游实现或验证阶段执行，不覆盖为替代检查脚本。环境缺失、依赖未合并或检查失败均记录为未通过，不越界修复；当前 design 阶段未运行。
