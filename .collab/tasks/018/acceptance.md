# Task 018 验收标准

## AC-043 真实 cli resolve 解析出可执行命令

```pwsh
node scripts/run-tests.mjs --ac AC-043; if ($LASTEXITCODE -ne 0) { throw "AC-043 failed" }; Write-Output "AC-043 OK"
```

- 期望: 退出码 0，最后一行是 AC-043 OK。

## AC-044 生产选模拒选不可用模型

```pwsh
node scripts/run-tests.mjs --ac AC-044; if ($LASTEXITCODE -ne 0) { throw "AC-044 failed" }; Write-Output "AC-044 OK"
```

- 期望: 退出码 0，最后一行是 AC-044 OK。

## AC-006 既有单元测试不得被破坏

```pwsh
node --test "test/unit/*.test.mjs"; if ($LASTEXITCODE -ne 0) { throw "existing unit tests broken" }; Write-Output "AC-006 OK"
```

- 期望: 全部既有单元测试通过，最后一行是 AC-006 OK。

