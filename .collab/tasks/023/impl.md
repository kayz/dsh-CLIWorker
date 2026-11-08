# 实施记录

## 已完成

- 在 `lib/runner.mjs` 增加配置摘要计算：对生效配置对象递归排序，结合规范化状态目录计算 SHA-256。
- 在 `lib/select.mjs` 创建租约时写入 `config_digest`，使摘要与选模使用的配置一起提交。
- 增加 `lib/events.mjs` 事件写入器，按 JSONL 输出连续序号，并限制终结事件只写一次。
- `lib/cli.mjs` 增加路由显式声明和返回值同时启用的流式输出接线，以保留普通命令行为。

## 自测

- `node --check lib/runner.mjs` 和 `node --check lib/select.mjs` 通过。
- `node --test test/unit/import-safe.test.mjs`：5 项通过。
- `node --check lib/events.mjs` 通过；`node --test test/integration/cli-envelope.test.mjs test/unit/import-safe.test.mjs`：10 项通过。

## 未完成

执行器编排、run 路由、供应商输出归一、记账、失败处理、集成测试、flow 和追踪文件尚未实现；新增事件写入器和流式接线尚未经过 run 端到端验证。AC-057、AC-058 和 M4 未验收，不能视为通过。`scripts/check-fast.ps1` 和 milestone gate 未执行：其检查链会调用 git 或产生范围外运行产物，与本任务禁止执行 git 和创建其他文件的约束冲突。
