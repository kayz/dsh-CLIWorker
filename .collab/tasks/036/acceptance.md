# Task 036 验收标准

## AC-079 代码中不得硬编码模型清单

```pwsh
node scripts/check-no-model-table.mjs; if ($LASTEXITCODE -ne 0) { throw "AC-079 failed" }; Write-Output "AC-079 OK"
```

- 期望: 退出码 0，最后一行是 AC-079 OK。

## AC-006 既有单元测试不得被破坏

```pwsh
node --test "test/unit/*.test.mjs"; if ($LASTEXITCODE -ne 0) { throw "existing unit tests broken" }; Write-Output "AC-006 OK"
```

- 期望: 全部既有单元测试通过，最后一行是 AC-006 OK。

