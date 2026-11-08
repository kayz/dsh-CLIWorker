# 实施记录

AC-032 尚未完成，不能声称已验收。交班单显示候选 #1 执行失败，且未提供可核验的代码差异；按禁止执行 Git 的要求未运行 git diff，不能确定现有代码的作者或独立核验差异。继承并保留现场已有的 secrets 后端与消费入口、auth 路由、exec input 透传、配置扫描和相关测试，因为它们与设计方向一致，并且定向回归通过；这些实现仍须按 AC-032 全面验证。

本轮修复了 v1 配置加载时丢弃显式 secrets 引用的问题：保留配置中的引用，使 auth 和消费入口能够定位同一个已声明的后端。新增定向测试验证加载后的引用和 session 访问。该修复没有证明跨进程 keychain 或真实 CLI 流程已经满足验收。

本次修复 Windows 密文写入失败时遗留新建目录的问题：清理临时密文并从 secrets 目录向上删除本次创建的空目录，避免删除已有目录；增加失败路径单测。

自测：`node --test test/unit/secrets.test.mjs test/unit/config.test.mjs test/unit/config-v2.test.mjs test/unit/paths.test.mjs test/unit/exec.test.mjs` 通过 38 项，无跳过。已执行 acceptance.md 中原样 AC-032 命令，因缺少 `test/integration/secrets-native.test.mjs` 而在首条子命令失败。仍需完成跨进程隔离后端、`test/flows/steps/auth.mjs`、泄漏扫描、`test/traceability/T-013.json` 和规定的全部集成断言，再重新执行验收。

用临时的最小有效配置运行真实 CLI：status 和 clear 退出 0，set 返回 E_SECRET_BACKEND、退出 3；当前执行环境中的子进程无法找到 pwsh，因此尚未验证 set 成功。示例配置有 `_example: true`，且加载器拒绝未实质修改的示例副本，单纯复制该文件仍会返回 E_CONFIG_EXAMPLE；集成测试应使用有效隔离配置。

未执行 `node scripts/check-fast.mjs`：它会运行包含 Git 调用的检查和测试，与禁止执行 Git 的要求冲突。也未修改 acceptance.md；移除其中 AC-033 章节与禁止修改 acceptance.md 的要求冲突。AC-033 已移至 T-034，不作为本轮完成目标。
