# 实现记录

尚未完成 T-016。已在 `lib/exec.mjs` 中仅对 `wsl` / `wsl.exe` 的 `-l -q` 调用保留 stdout 字节并按 UTF-16LE 解码；异步路径先收集字节，避免分块拆断码元。新增 `lib/discovery/wsl.mjs` 解析列表，以及对应的解码和普通命令回归测试。目的是避免中文发行版名称被 UTF-8 转换破坏。

自测：`node --test test/unit/exec.test.mjs test/unit/discovery/wsl-decode.test.mjs` 通过，16 项通过。四条 AC 命令均返回 `FAIL run.no_match`，因此均未通过；发现、平台识别、拒读、增量清单、命令、flow 和追踪文件仍待实现，现有测试也未覆盖完整 AC-037。

未执行 `scripts/check-fast.ps1`：其会调用 `scripts/check-write-scope.mjs`，后者执行 git 命令，与本任务禁止执行 git 的要求冲突。公共路由当前仍严格匹配子命令，带选项 discover 的真实入口依赖公共路由任务交付。
