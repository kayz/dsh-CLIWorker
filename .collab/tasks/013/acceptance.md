# Task 013 — 用户提供令牌的密钥管理：SecretRef、OS 后端、只经 env 注入

本轮 option 1 已批准，范围以修订后的 design.md YAML 为准；此前 CLI/exec 范围阻塞已解除。brief 没有基准 commit SHA 或既有验收报告路径。以下是下游实现的验收命令，不表示当前实现已经通过。

每个代码块是一条完整、独立的 PowerShell 7 验收命令，可在仓库根或系统临时目录执行，不依赖另一条命令的产物。Node 20+；失败立即非零退出，只在所有断言成立后输出成功标记。为遵守本轮只能写两份文档的限制，命令直接在文档内给出，不生成 .ps1 文件。本设计阶段不执行测试、报告或 check-fast。

测试标题约束只用于确保下列覆盖不会被空测试、漏注册或 skip 隐藏，不新增产品字段、版本或章节。每个列出的标题须对应实际行为断言；禁止只有 mock 调用次数、仅检查变量名、预填正确 env 或直接调用 auth 模块后宣称真实 CLI 通过。

## AC-032 用户令牌只经适配器声明的环境变量注入

```pwsh
node --test --test-name-pattern=AC-032 test/integration/secrets-native.test.mjs; if ($LASTEXITCODE -ne 0) { throw "AC-032 tests failed" }; Write-Output "AC-032 OK"
```

- 期望: 退出码 0，最后一行是 AC-032 OK。

