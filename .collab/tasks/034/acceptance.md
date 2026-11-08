# Task 034 验收标准

## AC-033 配置明文拒载与凭据后端失败处理

```pwsh
node --test test/unit/inline-secret.test.mjs test/integration/secret-backend-failure.test.mjs; if ($LASTEXITCODE -ne 0) { throw "AC-033 tests failed" }; Write-Output "AC-033 OK"
```

- 期望: 退出码 0，最后一行是 AC-033 OK。

