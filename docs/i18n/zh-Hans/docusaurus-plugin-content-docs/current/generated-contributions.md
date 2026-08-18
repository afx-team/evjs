# 生成代码

插件可以生成模块或数据，并挂载到有文档说明的框架 Slot。需要让代码进入应用入口、页面 Wrapper、服务端中间件、HTML 或模块解析时，使用这套 API。

外部副作用和最终平台文件请使用生命周期 Hook，决策说明见[插件 Hooks](./plugin-hooks)。

## 基本模式

生成分为两步：

1. 使用 `ctx.emit` 声明产物。
2. 使用 `ctx.slot(name).add()` 挂到框架 Slot。

```mermaid
flowchart LR
  Plugin["emitIR 或 emitPageIR"] --> Emit["生成模块或数据"]
  Emit --> Ref["不透明模块引用"]
  Ref --> Slot["挂载到 Slot"]
  Slot --> App["生成的应用代码"]
```

生成逻辑应保持确定性，不产生网络、进程或外部文件副作用。应用输入变化时，evjs 可能再次执行它。

## 生成产物

`ctx.emit` 支持：

| 方法 | 创建内容 |
| --- | --- |
| `module({ id, scope, source, extension? })` | JavaScript、TypeScript、JSX、CSS、Less 或 JSON 源码 |
| `data({ id, scope, value })` | 从静态数据生成的 JSON 模块 |
| `entryFacade({ id, entry, autoStart? })` | 为替换 Wrapper 保留的框架入口 |
| `importOf(ref)` | 导入另一个生成产物的 Specifier |

这些方法返回不透明引用，不暴露文件路径。`importOf(ref)` 只能在生成源码中使用，应用代码绝不能导入 `.ev` 路径。

选择应用或页面作用域：

```ts
scope: { kind: "application" }
scope: { kind: "page", pageId: "checkout" }
```

Contribution id 在插件内局部有效。`emitPageIR()` 中还会局部到当前页面，因此每个启用页面都可以安全复用相同 id。`@evjs/` 前缀由框架保留。

## 向客户端入口添加代码

生成安装器，并在应用主入口后导入：

```ts
import { definePlugin } from "@evjs/ev/plugin";

export const analytics = definePlugin({
  id: "analytics",
  emitIR(ctx) {
    const runtime = ctx.emit.module({
      id: "runtime",
      scope: { kind: "application" },
      source: "export function install() { console.log('analytics'); }",
    });

    const installer = ctx.emit.module({
      id: "installer",
      scope: { kind: "application" },
      source: ({ importOf }) =>
        `import { install } from ${JSON.stringify(importOf(runtime))};\ninstall();`,
    });

    ctx.slot("client.entry").add({
      id: "analytics-installer",
      module: installer,
      position: "after-main",
    });
  },
});
```

`client.entry` 可以在主入口之前或之后导入。`mode: "replace"` 只用于必须拥有入口导出的集成，例如微前端 Slave Wrapper。

替换入口时，使用 `entryFacade()` 保留原入口，不要重建框架启动逻辑：

```ts
emitIR(ctx) {
  const entry = ctx.framework.getApplicationEntry();
  if (!entry) return;

  const original = ctx.emit.entryFacade({
    id: "original-entry",
    entry,
  });

  const wrapper = ctx.emit.module({
    id: "entry-wrapper",
    scope: { kind: "application" },
    source: ({ importOf }) =>
      `export const load = () => import(${JSON.stringify(importOf(original))});`,
  });

  ctx.slot("client.entry").add({
    id: "entry-wrapper",
    module: wrapper,
    mode: "replace",
    position: "before-main",
  });
}
```

对生成的 SPA 应用入口，`autoStart: false` 会导出 App 与 `start(container)` 而不自动挂载。替换入口负责第一次启动。

## 包裹页面

需要 React 行为包围客户端、服务端或两侧页面时，使用 `page.wrapper`。模块必须默认导出接收 `children` 的组件：

```ts
emitIR(ctx) {
  const boundary = ctx.emit.module({
    id: "auth-boundary",
    scope: { kind: "application" },
    extension: ".tsx",
    source:
      "export default function AuthBoundary({ children }) { return children; }",
  });

  ctx.slot("page.wrapper").add({
    id: "auth-boundary",
    module: boundary,
    runtime: "all",
    target: { kind: "application", applicationId: "default" },
  });
}
```

`runtime` 接受 `"client"`、`"server"` 或 `"all"`。省略 `target` 会包裹所有页面，也可以指定一个应用或页面。后加入的 Wrapper 包在先加入的外层；路由源码中的 Layout 仍在插件 Wrapper 外。

## 添加服务端请求中间件

把中间件模块挂到框架服务端请求链：

```ts
ctx.slot("server.request.middleware").add({
  id: "request-tracing",
  module: "./src/plugin/request-tracing.ts",
});
```

它适合插件拥有的跨切面服务端行为。应用专属中间件通常应使用文件约定。

## 添加 HTML 标签

结构化 `meta`、`link`、`script` 或 `style` 使用 `html.tag`：

```ts
ctx.slot("html.tag").add({
  id: "analytics-script",
  tag: "script",
  placement: "head-append",
  attrs: {
    src: "https://cdn.example.com/analytics.js",
    crossorigin: "anonymous",
  },
});
```

可选应用或页面 `target` 限制作用范围。只有页面拥有匹配文档时才能指定页面；普通 CSR SPA 页面共享应用文档，因此不能接收页面专属标签。结构化标签无法表达修改时再使用 `transformHtml()`。

## 修改模块解析

生成引用可以参与别名：

```ts
const config = ctx.emit.data({
  id: "config",
  scope: { kind: "application" },
  value: { enabled: true },
});

ctx.slot("resolve.alias").add({
  id: "runtime-config",
  specifier: "@plugin/runtime-config",
  replacement: config,
});
```

按运行时过滤外部依赖：

```ts
ctx.slot("resolve.external").add({
  id: "external-react",
  specifier: "react",
  source: "React",
  runtime: "client",
});
```

Slot 支持时，运行时过滤接受 `"client"`、`"server"` 或 `"all"`。

## 使用服务端页面入口

`server.entry` 向已有页面服务端入口导入或替换。必须精确指定一个已经具有请求时或构建时服务端渲染的页面：

```ts
ctx.slot("server.entry").add({
  id: "server-monitoring",
  target: { kind: "page", pageId: "dashboard" },
  module: "./src/monitoring/server-entry.ts",
  position: "before-main",
});
```

只有集成拥有完整页面服务端入口时才使用 `mode: "replace"`。页面不存在、页面没有服务端入口或出现多个替换都会让生成失败，而不是变成无操作。

## Slot 参考

| Slot | 用途 |
| --- | --- |
| `client.entry` | 导入或替换客户端入口 |
| `server.entry` | 导入或替换已有页面服务端入口 |
| `page.wrapper` | 在客户端/服务端渲染中包裹页面组件 |
| `server.request.middleware` | 增加插件拥有的服务端请求中间件 |
| `html.tag` | 增加结构化文档标签 |
| `resolve.alias` | 增加语义模块别名 |
| `resolve.external` | 按运行时外置模块 |

## 检查生成代码

`.ev` 是生成产物，不能编辑，但排查插件时很有用：

1. 运行 `ev prepare`。
2. 查看 `.ev/manifest.json`，找到插件模块与 Slot 挂载。
3. 打开 `.ev/plugins/<plugin-id>` 与 `.ev/entries` 下对应文件。
4. 修改插件源码并重新生成，不要 Patch `.ev`。

生成代码在需要时可以使用文档说明的 generated-only Helper。插件源码本身应从 `@evjs/ev/plugin` 导入公共创作类型，不应导入 `@evjs/ev/_internal/*`。

完整插件流程和小型示例见[插件配方](./plugin-recipes)。
