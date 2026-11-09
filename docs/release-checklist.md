# 发布前冒烟

生成资产检查：

```pwsh
node scripts/check-generated-fresh.mjs
```

该检查在独立临时目录运行 `test/fixtures/release-gate/generate.mjs`，比较 `test/fixtures/release-gate/` 的全部生成文件；也运行 `scripts/gen-contract-doc.mjs`，比较 `docs/contract.md`。它只对换行、TAP 耗时和诊断中的 type、location、stack，以及报告顶层合法 Node 版本等运行环境元数据做规范化。检查不会更新工作区。CI 的 `npm run check` 通过 `scripts/check-fast.mjs` 自动发现此检查。失败时，维护者须另行获得资产写域授权，按输出指名的生成器更新对应资产并提交，再重跑检查。通过此检查不能替代 real-smoke 或发布放行。

使用 Node.js 20 或更高版本及 PowerShell 7。CI 只运行夹具模式：

```pwsh
node scripts/smoke-real.mjs --dry-run
```

维护者在 Windows 真机上运行 real：先准备可用的 WSL 和至少一个发行版。每个发行版都需要 Node.js 20+、可发现的 CLI，并且能通过 `wslpath` 访问仓库和 Windows 临时目录。不安装软件，也不使用真实账号或调用云模型。real 模式验证真实 WSL 枚举和各发行版内的发现，其余 provider 链路使用本地夹具，不能据此宣称真实账号或云 provider 可用。

脚本先检查 WSL 和发行版列表，再检查所有发行版内的 Linux Node 可执行文件及版本，最后在各发行版的隔离环境中执行发现；每个发行版都必须返回非空的 CLI 发现结果。WSL 不可用、Node 缺失或低于 20、没有发现 CLI 均为失败：按脱敏原因准备对应的 WSL、Linux Node 或 CLI 环境后重新运行，脚本不会自动安装。独立调用 `realWsl` 返回的 inventories 仅供脚本内测试；stdout 和 `--out` 仍只输出原有 smoke 报告。

报告保留在仓库外，路径由维护者按本地归档要求指定：

```pwsh
$savedSmoke = $env:CLIWORKER_SMOKE
$reportPath = Join-Path ([System.IO.Path]::GetTempPath()) ('cliworker-real-' + [guid]::NewGuid().ToString('N') + '.json')
try {
  $env:CLIWORKER_SMOKE = '1'
  node scripts/smoke-real.mjs --out $reportPath
  if ($LASTEXITCODE -ne 0) { throw 'Real smoke failed' }
} finally {
  if ($null -eq $savedSmoke) { Remove-Item Env:CLIWORKER_SMOKE -ErrorAction SilentlyContinue }
  else { $env:CLIWORKER_SMOKE = $savedSmoke }
}
```

核对报告 `schema` 为 `cliworker.smoke/v1`、`mode` 为 `real`、`platform` 为 `win32`、`version` 与 `package.json` 一致、`redacted` 为 true；七步均为 mandatory 且 pass，尤其检查 `wsl-discover` 的 `ac` 为 `['AC-038']`。脚本成功还要求泄漏扫描零命中且无扫描错误。失败或跳过时查看脱敏的 `reason`，修复原因并重跑；检查临时目录已清理。不要提交本机报告、用户名、绝对路径或凭据。

dry-run 和 AC-081 的 WSL 结果来自夹具，不能证明 AC-038 真机通过或替代 real-smoke 证据。没有合格真机时，只有 T-030 可以依据 `release/waivers.json` 显式处理豁免；本清单不判定发布放行。
