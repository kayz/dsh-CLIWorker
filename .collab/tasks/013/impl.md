# 实施记录

AC-032 尚未完成，不能声称已验收。交班单显示候选 #1 执行失败，且未提供可核验的代码差异；按禁止执行 Git 的要求未运行 git diff，不能确定现有代码的作者或独立核验差异。继承并保留现场已有的 secrets 后端与消费入口、auth 路由、exec input 透传、配置扫描和相关测试，因为它们与设计方向一致，并且定向回归通过；这些实现仍须按 AC-032 全面验证。

本轮修复了 v1 配置加载时丢弃显式 secrets 引用的问题：保留配置中的引用，使 auth 和消费入口能够定位同一个已声明的后端。新增定向测试验证加载后的引用和 session 访问。该修复没有证明跨进程 keychain 或真实 CLI 流程已经满足验收。

本次修复 Windows 密文写入失败时遗留新建目录的问题：清理临时密文并从 secrets 目录向上删除本次创建的空目录，避免删除已有目录；增加失败路径单测。

自测：`node --test test/unit/secrets.test.mjs test/unit/config.test.mjs test/unit/config-v2.test.mjs test/unit/paths.test.mjs test/unit/exec.test.mjs` 通过 38 项，无跳过。已执行 acceptance.md 中原样 AC-032 命令，因缺少 `test/integration/secrets-native.test.mjs` 而在首条子命令失败。仍需完成跨进程隔离后端、`test/flows/steps/auth.mjs`、泄漏扫描、`test/traceability/T-013.json` 和规定的全部集成断言，再重新执行验收。

用临时的最小有效配置运行真实 CLI：status 和 clear 退出 0，set 返回 E_SECRET_BACKEND、退出 3；当前执行环境中的子进程无法找到 pwsh，因此尚未验证 set 成功。示例配置有 `_example: true`，且加载器拒绝未实质修改的示例副本，单纯复制该文件仍会返回 E_CONFIG_EXAMPLE；集成测试应使用有效隔离配置。

未执行 `node scripts/check-fast.mjs`：它会运行包含 Git 调用的检查和测试，与禁止执行 Git 的要求冲突。也未修改 acceptance.md；移除其中 AC-033 章节与禁止修改 acceptance.md 的要求冲突。AC-033 已移至 T-034，不作为本轮完成目标。

候选 #2 继续保留现场已有的 secrets 后端、auth 路由、exec input、配置扫描及其测试：它们符合设计方向，且本轮定向回归 38 项通过。交班单没有可核验的代码差异，且本轮禁止执行 Git，因此无法进一步确认各项改动的来源。

新增 `test/integration/secrets-native.test.mjs`，用真实 CLI 验证默认凭据不存在时的 status；在非 Windows 平台以临时 preload 模拟后端条目不存在。子进程非零退出时断言消息包含 stdout 和 stderr。该测试只覆盖一个状态场景，不满足 AC-032 规定的五项跨进程、消费、隔离和泄漏扫描测试，不能将 AC-032 标为 covered。

自测：从仓库根运行 `node --test --test-name-pattern=AC-032 test/integration/secrets-native.test.mjs`，1 项通过；配置、paths、exec 和 secrets 的既有定向回归共 38 项通过。完整 acceptance.md 的 AC-032 命令仍不能通过：所需测试标题、auth flow 和追踪文件尚未完成；其子进程断言位于禁止修改的 acceptance.md，故未改为输出 stdout/stderr。当前环境未找到 pwsh，无法执行要求的 PowerShell 7 验收命令或 check-fast.ps1；check-fast 检查链还包含被禁止的 Git 调用。上述 Node 测试由执行工具调用，最初提供的 shell 选项实际启动了 Windows PowerShell 5.1，与环境要求不符；后续 Node 命令改用 cmd.exe 直接执行。

本次继续保留现场已有 secrets、auth、exec、配置及测试改动：它们与设计方向一致，且交班单显示上一候选运行失败而没有提供可核验的代码差异。遵照禁止执行 Git 的要求，未运行 git diff，也无法确定这些改动的作者。

在 `test/integration/secrets-native.test.mjs` 新增指定的 from-env 测试：真实 CLI 在独立进程中 set 和 status，再由新进程加载生产配置及 `runWithSecrets` 启动 fake provider。测试用临时 preload 模拟 OS 后端并以认证加密保存替身数据，断言只有声明的 `KIMI_API_KEY` 的摘要与令牌一致，argv 不包含令牌；消费进程不继承来源变量。测试密钥和 preload 环境变量在创建 provider 上下文前移除。

自测：`node --test --test-reporter=tap --test-name-pattern=AC-032 test/integration/secrets-native.test.mjs` 通过 2 项，无跳过。执行 acceptance.md 的 AC-032 命令，因缺少 stdin 跨进程测试标题而失败；其余三个规定标题、完整 flow 和追踪文件也尚未完成，不能声明 AC-032 已覆盖。未运行 check-fast：其检查链包含被明确禁止的 Git 调用。此前记录的 pwsh 不可用不适用于本次，本次使用 pwsh 执行了上述检查。
