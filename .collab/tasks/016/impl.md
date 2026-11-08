# 实现记录

尚未完成 T-016。已在 `lib/exec.mjs` 中仅对 `wsl` / `wsl.exe` 的 `-l -q` 调用保留 stdout 字节并按 UTF-16LE 解码；异步路径先收集字节，避免分块拆断码元。新增 `lib/discovery/wsl.mjs` 解析列表，以及对应的解码和普通命令回归测试。目的是避免中文发行版名称被 UTF-8 转换破坏。

自测：`node --test test/unit/exec.test.mjs test/unit/discovery/wsl-decode.test.mjs` 通过，16 项通过。四条 AC 命令均返回 `FAIL run.no_match`，因此均未通过；发现、平台识别、拒读、增量清单、命令、flow 和追踪文件仍待实现，现有测试也未覆盖完整 AC-037。

未执行 `scripts/check-fast.ps1`：其会调用 `scripts/check-write-scope.mjs`，后者执行 git 命令，与本任务禁止执行 git 的要求冲突。公共路由当前仍严格匹配子命令，带选项 discover 的真实入口依赖公共路由任务交付。

续接进展：新增 `lib/fsx.mjs` 的拒读及逐组件链接检查、`lib/discovery/platform.mjs` 的注入式宿主识别、`lib/discovery/rules.mjs` 中唯一有契约示例依据的 Claude 版本探测规则，以及 `lib/discovery/inventory.mjs` 的指纹和 evidence.at 缓存判断。新增单元测试覆盖拒读及相邻路径、链接目标、Windows 路径大小写、平台输入、缓存时效及指纹变化。这些组件尚未接入扫描流程，不能视为完整拒读保证或 AC 通过。

续接自测：`node --test test/unit/discovery/*.test.mjs test/unit/exec.test.mjs` 通过 20 项；本轮最终平台判断改动后另行运行对应单元测试。扫描、WSL 跨发行版执行、命令、集成测试、flow 和追踪仍未实现；四项 AC 均未通过。`check-fast.ps1` 因上述 Git 禁令冲突仍未运行。

本轮新增 `lib/discovery/scan.mjs`：在 PATH 和显式额外目录的当前层查找规则及未知模式候选，对覆盖路径进行候选检查，并按 realpath 去重；记录目录访问失败以供后续避免误标删除。新增单元测试验证扫描边界、去重及失败目录。运行 `node --test test/unit/discovery/*.test.mjs`，7 项通过。扫描模块尚未接入发现命令或增量保存，WSL 扫描、探测、集成验收、flow 和追踪仍待实现；四项 AC 未完成。`check-fast.ps1` 仍因 Git 禁令未运行。
