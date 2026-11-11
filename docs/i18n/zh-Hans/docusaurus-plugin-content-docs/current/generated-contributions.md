# 生成代码

插件可以生成模块或数据，并挂载到框架提供的扩展槽位。需要让代码进入应用入口、页面包装组件、服务端中间件、HTML 或模块解析时，使用这套 API。

需要执行外部副作用或写入最终平台文件时，请使用生命周期钩子，详见[插件生命周期钩子](./plugin-hooks)。

## 生成流程

生成分为两步：

1. 使用 `ctx.emit` 声明产物。
2. 使用 `ctx.slot(name).add()` 挂到框架扩展槽位。

```mermaid
flowchart LR
  Plugin["emitIR 或 emitPageIR"] --> Emit["生成模块或数据"]
  Emit --> Ref["不透明模块引用"]
  Ref --> Slot["挂载到扩展槽位"]
  Slot --> App["生成的应用代码"]
```

生成逻辑应保持确定性，不产生网络、进程或外部文件副作用。生成阶段早于插件 `setup()`，
不能读取其中初始化的状态。应用输入变化时，evjs 可能再次执行它。

## 生成模块与数据

`ctx.emit` 支持：

| 方法 | 创建内容 |
| --- | --- |
| `module({ id, scope, source, extension? })` | JavaScript、TypeScript、JSX、CSS、Less 或 JSON 源码 |
| `data({ id, scope, value })` | 从静态数据生成的 JSON 模块 |
| `entryFacade({ id, entry, autoStart? })` | 为替换包装组件保留框架入口 |
| `importOf(ref)` | 获取另一个生成产物的模块说明符 |

这些方法返回不透明引用，不暴露文件路径。`importOf(ref)` 只能在生成源码中使用，应用代码绝不能导入 `.ev` 路径。

选择应用、页面或服务端作用域：

```ts
scope: { kind: "application" }
scope: { kind: "page", pageId: "checkout" }
scope: { kind: "server" }
```

生成项的 id 只需在插件内部唯一。`emitPageIR()` 中的 id 还限定在当前页面，因此每个启用页面都可以安全复用相同 id。`@evjs/` 前缀由框架保留。

## 将浏览器模块替换为运行时引用

`emit.moduleReference()` 为一个精确的源码文件声明仅用于浏览器的替换。它没有返回值，
也不需要挂到槽位。插件提供导出映射和允许进入浏览器的数据，运行时工厂决定每个引用的行为。
evjs 不解析装饰器，也不解释协议。

```ts
import { definePlugin } from "@evjs/ev/plugin";

export const references = definePlugin({
  id: "greeting-references",
  emitIR({ emit }) {
    emit.moduleReference({
      id: "greeting",
      resource: "./src/greeting.ts",
      references: [{
        id: "greeting",
        factory: {
          module: "./src/greeting-client.ts",
          export: "createGreetingReference",
        },
        data: { endpoint: "/greetings" },
      }],
      exports: [
        { name: "Greeting", reference: "greeting" },
        { name: "default", reference: "greeting" },
      ],
    });
  },
});
```

浏览器中的两个导出共享 `createGreetingReference(data)` 的结果。如果工厂返回构造函数，
业务可以继续写 `import { Greeting } from "./greeting"; new Greeting()`。
该浏览器替换不包含原模块的初始化逻辑和依赖，服务端编译继续使用原模块。
工厂及其依赖必须适用于浏览器；这项能力不会改写静态类型。

源码必须是应用根目录内已存在的文件。相对源码和运行时路径均从应用根目录解析，
运行时也可以使用包说明符。导出名和工厂导出当前支持 ASCII JavaScript 标识符，
包括 `default`。多个导出可以共享同一引用。一个源码文件只能对应一项贡献，
该限制也覆盖符号链接别名和不同插件。无效或冲突的贡献会在规划阶段报错。

数据必须是严格 JSON，只能包含准备向浏览器公开的信息。完整构建计划保留在 `.ev`，
不是公开部署 manifest。源码变化会自动被监听；插件读取其他元数据文件时，
必须通过 `ctx.addWatchFile()` 注册这些文件。

该能力需要 `@utoo/pack` 1.6.0 或更新版本，并加载报告 `moduleReferencesVersion = 1`
的配套原生绑定。旧版 Utoopack 和 Webpack 适配器
会明确报错，避免将原模块编译进浏览器。bundler 钩子不能替换框架拥有的引用列表。

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

`client.entry` 可以在主入口之前或之后导入。`mode: "replace"` 只用于必须接管入口导出的集成，例如微前端子应用包装器。

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

## 包装 CSR Application 根节点

需要一个只在客户端运行、并包围完整 CSR Application 的 React 组件时使用 `application.wrapper`。它也覆盖显式跳过根 Layout 的路由：

```ts
emitIR(ctx) {
  const boundary = ctx.emit.module({
    id: "root-boundary",
    scope: { kind: "application" },
    extension: ".tsx",
    source:
      "export default function RootBoundary({ children }) { return children; }",
  });

  ctx.slot("application.wrapper").add({
    id: "root-boundary",
    module: boundary,
    target: { kind: "application", applicationId: "default" },
  });
}
```

省略 `target` 会包裹所有生成的 CSR Application。后加入的贡献位于外层。该槽位刻意不投影 SSR；需要客户端与服务端页面同时生效时使用 `page.wrapper`。

## 为页面添加包装组件

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

`runtime` 接受 `"client"`、`"server"` 或 `"all"`。省略 `target` 会包裹所有页面，也可以指定一个应用或页面。后加入的包装组件位于先加入组件的外层；路由源码中的布局仍位于插件包装组件之外。

## 添加服务端请求中间件

把中间件模块挂到框架服务端请求链：

```ts
ctx.slot("server.request.middleware").add({
  id: "request-tracing",
  module: "./src/plugin/request-tracing.ts",
});
```

它适合插件拥有的跨切面服务端行为。应用专属中间件使用全局入口或显式方法组合，
详见[API 路由与中间件](./server-routes)。
模块默认导出一个 Hono 中间件或有序非空数组。贡献按 slot 顺序在应用全局中间件之前执行，
随后执行当前 HTTP 方法的中间件。无效导出会阻止服务端启动。

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

扩展槽位支持运行时过滤时，可以使用 `"client"`、`"server"` 或 `"all"`。

## 创建独立服务端入口

插件通过 `server.entry` 和显式的 `mode: "create"` 创建 Node 构建入口，不依赖 Page 或 HTTP Route：

```ts
const entryName = ctx.slot("server.entry").add({
  id: "service-entry",
  mode: "create",
  module: "./src/plugin/service.ts",
});
```

`module` 也支持 `emit.module()` 返回的引用。返回的入口名称用于访问
`BuildOutput.assets[entryName]`，不是输出路径。框架在插件和页面贡献命名空间内
分配名称并检测冲突；贡献与模块引用会和其他 slot 一起记录到生成的 IR manifest。

创建模式不接受 `target` 和 `position`。省略 `mode` 仍表示向已有 Page 入口导入模块，
必须提供目标和插入位置。已有 `import/replace` 调用仍返回 `undefined`。
该 slot 只声明构建入口，协议分发和部署由插件负责。

## 扩展服务端页面入口

`server.entry` 向已有页面服务端入口导入或替换。必须精确指定一个已经具有请求时或构建时服务端渲染的页面：

```ts
ctx.slot("server.entry").add({
  id: "server-monitoring",
  target: { kind: "page", pageId: "dashboard" },
  module: "./src/monitoring/server-entry.ts",
  position: "before-main",
});
```

只有集成需要接管完整页面服务端入口时才使用 `mode: "replace"`。页面不存在、页面没有服务端入口或出现多个替换都会让生成失败，不会被静默忽略。

## 扩展槽位参考

| 扩展槽位 | 用途 |
| --- | --- |
| `client.entry` | 导入或替换客户端入口 |
| `server.entry` | 创建独立服务端入口，或导入/替换已有页面服务端入口 |
| `application.wrapper` | 包裹完整的客户端 CSR Application 根节点 |
| `page.wrapper` | 在客户端/服务端渲染中包裹页面组件 |
| `server.request.middleware` | 增加插件拥有的服务端请求中间件 |
| `html.tag` | 增加结构化文档标签 |
| `resolve.alias` | 增加语义模块别名 |
| `resolve.external` | 按运行时外置模块 |

## 检查生成代码

`.ev` 是生成产物，不能编辑，但排查插件时很有用：

1. 运行 `ev prepare`。
2. 查看 `.ev/manifest.json`，找到插件模块与扩展槽位挂载关系。
3. 打开 `.ev/plugins/<plugin-id>` 与 `.ev/entries` 下对应文件。
4. 修改插件源码并重新生成，不要直接修改 `.ev`。

生成代码可以按需使用文档列出的仅供生成代码调用的辅助函数。插件源码本身应从 `@evjs/ev/plugin` 导入公共开发类型，不应导入 `@evjs/ev/_internal/*`。

完整插件流程和小型示例见[插件实践](./plugin-recipes)。
