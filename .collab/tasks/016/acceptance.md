# Task 016 验收标准

## AC-036 平台识别与 CLI 发现（integration）

```pwsh
node scripts/run-tests.mjs --ac AC-036; if ($LASTEXITCODE -ne 0) { throw "AC-036 failed" }; Write-Output "AC-036 OK"
```

- 期望: 退出码 0，最后一行是 AC-036 OK。

## AC-037 WSL 跨发行版解析（含 UTF-16LE 无损）

```pwsh
node scripts/run-tests.mjs --ac AC-037; if ($LASTEXITCODE -ne 0) { throw "AC-037 failed" }; Write-Output "AC-037 OK"
```

- 期望: 退出码 0，最后一行是 AC-037 OK。

## AC-039 拒读清单

```pwsh
node scripts/run-tests.mjs --ac AC-039; if ($LASTEXITCODE -ne 0) { throw "AC-039 failed" }; Write-Output "AC-039 OK"
```

- 期望: 退出码 0，最后一行是 AC-039 OK。

## AC-040 增量清单

```pwsh
node scripts/run-tests.mjs --ac AC-040; if ($LASTEXITCODE -ne 0) { throw "AC-040 failed" }; Write-Output "AC-040 OK"
```

- 期望: 退出码 0，最后一行是 AC-040 OK。

## AC-006 既有单元测试不得被破坏

```pwsh
node --test "test/unit/*.test.mjs"; if ($LASTEXITCODE -ne 0) { throw "existing unit tests broken" }; Write-Output "AC-006 OK"
```

- 期望: 全部既有单元测试通过，最后一行是 AC-006 OK。

