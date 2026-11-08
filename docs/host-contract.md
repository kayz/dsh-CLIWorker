# 宿主契约

`contracts/host/dsh-host.v1.json` 定义宿主接口。`host_ctx.inject(services, callback)` 在服务存在时同步调用 callback，参数为 httpCtx。`http_ctx.effect(fn, name)` 返回 fn 的结果并传播异常；`webServer.register` 接受 kind 为 `exact`、以 `/` 开头的 path 和 `handler(req, res)`，失败抛异常。

请求必须提供 `socket.remoteAddress` 和 `headers`，可提供 `method` 与 `url`；响应必须提供 `statusCode`、`setHeader` 和 `end`。测试宿主可控制 `remoteAddress`、`host`、`origin`。

`createPlugin` 返回 registered 与 errors；`getRegistration` 返回 status、registered、errors，status 为 ok 或 failed。`apply` 在严格模式下遇到注册错误会抛出；宿主应观察并处理失败，不应吞掉异常。离线测试可使用 `test/helpers/host-stub.mjs` 提供的 stub；真实宿主负责提供服务和监听。

不可运行：以下示意需要真实宿主提供的上下文。
```javascript
import { apply, getRegistration } from 'dsh-cliworker'

apply(hostCtx, { strict: true })
const registration = getRegistration()
if (registration.status !== 'ok') throw new Error('registration failed')
```

宿主需要捕获并报告异常或失败状态；严格模式下的异常带 `registration`，非严格调用也应检查 errors。插件本身不会替宿主启动监听器。
