# 实现记录

T-022 的选模、租约、CLI 视图和对应测试已实现；AC-056 的补充完成检查尚未通过，任务不能认定为全部验收完成。

- 选模使用缓存证据、额度策略和锁内租约预留；租约及请求结果原子提交，重放保留原句柄。Windows 锁文件打开遇到瞬时权限错误时，仅对目标锁的 open 操作按注入时钟和等待限制重试。
- AgentLine、管理和 draft 视图共享选模结果。视图测试覆盖策略金标、契约示例、真实 CLI 门控及失败码、paid 详情、假密钥和流程步骤；AC-053 的编排结果也经扫描器检查。追踪分片的六项均标为 covered，表示测试覆盖，不表示补充完成检查已通过。
- 本轮 `node scripts/run-tests.mjs --ac AC-056`：19 项通过；`node scripts/check-traceability.mjs` 通过。`node --test test/integration/store-concurrency.test.mjs`：2 项通过。上一轮修复锁竞争后 50 进程测试连续四次通过，评审另连续三次通过；全量负载下 AC-029 曾失败一次，单独运行通过，尚不能确认原因，与选模入口重试之间没有已证实的因果关系。
- 本轮验证评审建议的 draft 失败兼容：暂时让 draft 返回失败形状后，AC-047 的陈旧缓存测试通过，AC-023 的无 schema 用例也越过原失败，但带 v1 schema 的 `--request-file` 仍期望退出 0 而实际退出 5。design 第 13 节要求零候选 CLI 使用通用错误体和退出码 5，未规定 draft 例外；因此恢复了统一的零候选错误行为。恢复后直接运行两个旧测试文件为 17 通过、2 失败（AC-023 与 AC-047）；两个测试均在 write_scope 外。要让完整检查通过，需由编排方调整冲突的规格或授权修改相关写域外测试。
- 本机未找到 PowerShell 7，不能原样运行 `pwsh -NoProfile -File scripts/check-fast.ps1`。上一轮执行 Node 检查入口在 `check-pack` 因 npm pack 退出 4294963248 而失败；评审环境的 Node 完整检查到达 npm test 后报告上述两个失败及一次 AC-029 失败。均不能作为 `check-fast: ok` 的证据。
- 扫描器的目录值匹配存在名称碰撞边界：模型名 `unknown` 会匹配注册原因 `quota_unknown_policy`。形状夹具使用更具体的模型名，扫描前未删输出字段；扫描器在写域外，此边界留待后续处理。
