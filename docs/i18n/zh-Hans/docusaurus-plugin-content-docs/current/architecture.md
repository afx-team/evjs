# 架构

evjs 是围绕文件式页面路由、显式 source declaration、框架 graph、bundler 无关 build plan，以及单一 runtime manifest 构建的 React 框架。

```txt
src/pages + ev.config.ts + server declarations
  -> AppGraph
  -> BuildPlan
  -> bundler build
  -> BuildOutput
  -> runtime / shell / deployment adapters
```

## 公共包

应用代码通过 `@evjs/ev` 导入 config、plugin、build 和 deployment API。
运行时 API 来自 `@evjs/client` 和 `@evjs/server`，使用这些能力的应用应直接
声明对应 runtime 包。其他包是工具包、bundler adapter 或框架包之间共享的
契约包。需要新的能力边界时，先优先考虑在拥有该行为的包中增加 subpath
export，再考虑新增分发包。
Subpath export 必须保持显式且有文档说明；新增 package export 是公开 API 决策，
不是为了方便导入而增加的别名。

```txt
@evjs/ev
  配置、插件生命周期、dev/build 编排、框架构建类型和 deployment helpers

@evjs/client
  浏览器 runtime、服务端函数 transport、page hooks、导航 helpers
  和 remote host helpers

@evjs/server
  Hono/fetch app、服务端函数、服务端路由、SSR/PPR/RSC 请求边界
```

`@evjs/cli` 和 `@evjs/create-app` 是分发工具包。Bundler adapter 保留在
`@evjs/bundler-utoopack` 和 `@evjs/bundler-webpack`，共享 runtime/manifest
契约保留在 `@evjs/shared`。

| 角色 | 包 | 导入建议 |
|------|----|----------|
| 框架面 | `@evjs/ev` | config/build/plugin/deployment API 使用 `@evjs/ev`。 |
| 运行时 API | `@evjs/client`, `@evjs/server` | page hooks、导航、server functions、server routes、渲染和部署运行时使用这些包。 |
| 工具包 | `@evjs/cli`, `@evjs/create-app` | 用于安装或执行；应用模块不应 import 它们。 |
| Bundler adapter | `@evjs/bundler-utoopack`, `@evjs/bundler-webpack` | `@evjs/cli` 持有默认 Utoopack adapter；只有自定义工具时才直接 import adapter。 |
| 共享契约 | `@evjs/shared` | 发布出来是为了让框架包共享 manifest/runtime 类型；应用代码不应直接 import。 |

已发布包的 manifest 保持 ESM-only，并且发布面要刻意收窄。每个分发包都设置
`"type": "module"`，使用 public access 和 MIT license，只白名单发布生成产物：
框架、runtime、adapter 和契约包发布 `esm`；`@evjs/cli` 发布 `dist`/`bin`；
`@evjs/create-app` 发布 `dist`/`templates`。

内部 `@evjs/*` runtime 依赖也保持显式。`@evjs/ev` 消费共享契约，但不发布
runtime subpath；`@evjs/server` 会消费 `@evjs/client` 中的共享 runtime
类型。`@evjs/cli` 持有默认 Utoopack adapter 依赖，bundler adapter 依赖
`@evjs/ev`，而不是彼此依赖。内部 runtime 依赖版本保持为 `"*"`，让发布自动化
把所有分发包作为同一个框架版本处理。

生成专用的 `@evjs/client/internal/*` subpath 用于让框架生成的路由声明、
page bootstrap、server-function stub 和 RSC runtime entry 完成类型检查。
应用代码仍应从 `@evjs/client` 导入导航和运行时 API，不要导入这些生成专用的
internal helper。
例如，`@evjs/client/internal/route-types` 用于生成的 SPA 路由声明，
`@evjs/client/internal/rsc-runtime` 用于 RSC page bootstrap。

不要重新引入 `@evjs/build-tools`、`@evjs/manifest` 或 `@evjs/router-*`
这类历史拆分包。构建 helper 从 `@evjs/ev/build-tools` 导出，manifest
契约从 `@evjs/shared/manifest` 导出。

文档中的代码示例也遵循同一包边界：应用示例从 `@evjs/ev`、
`@evjs/client` 或 `@evjs/server` 导入；只有展示自定义工具时，
adapter 示例才直接导入 `@evjs/bundler-utoopack`。

## 内部模块

```txt
@evjs/ev/build-tools
  源码分析、路由/服务端函数提取、graph/plan helpers、框架 transform、HTML helpers

@evjs/shared/manifest
  AppGraph、BuildPlan、BuildOutput 和 manifest schema

@evjs/client generated-only internals
  framework-managed runtime、shell、router-free react-page runtime、transport、
  RSC client runtime、SPA router 集成和 generated bootstrap，通过
  @evjs/client/internal/* 子路径承载，并由 @evjs/client internals 支撑

@evjs/bundler-utoopack
  @evjs/cli 使用的默认 bundler adapter

@evjs/bundler-webpack
  在 Utoopack 下层 API 补齐前，用于验证 SSR/PPR/RSC 以及 dynamic entry/server
  dev plan update 的 fallback adapter
```

`@evjs/ev/build-tools` 不 import bundler adapter。Bundler adapter 消费 `BuildPlan`，不会在 bundling 之后重新扫描源码来发现框架语义。
`@evjs/ev/build-tools` 子路径只暴露 CLI 和 bundler adapter 需要的 tooling API。
底层 module export 解析、server-function ID hashing 和 module-ref helper
保留为 `@evjs/ev` 私有实现。

SPA 文件路由在框架内部使用 TanStack Router；应用页面只写 `src/pages`、
page hooks 和导航 helper，不需要创建 route tree。Generated bootstrap 通过
`@evjs/client/internal/*` 承载。MPA 文件路由和显式 pages 使用 page runtime，
不引入客户端路由器。`@evjs/client` facade 暴露页面代码需要的 hooks、
导航、server function、RSC 和 remote runtime API。

## 构建流程

```mermaid
sequenceDiagram
  participant CLI as "@evjs/cli"
  participant EV as "@evjs/ev"
  participant Tools as "@evjs/ev/build-tools"
  participant Bundler as "BundlerAdapter"
  participant Manifest as "manifest linker"
  participant Plugins as "Plugins"

  CLI->>EV: dev/build(config)
  EV->>Plugins: config hooks
  EV->>EV: resolveConfig()
  EV->>Plugins: setup hooks
  EV->>Tools: createAppGraph(config)
  Tools-->>EV: AppGraph + diagnostics + fileDependencies
  EV->>Plugins: appGraph(graph)
  EV->>Tools: createBuildPlan(config, graph)
  Tools-->>EV: BuildPlan
  EV->>Plugins: buildPlan(plan)
  EV->>Bundler: build(plan)
  Bundler-->>EV: bundler stats/assets
  EV->>Manifest: linkBuildOutput(graph, plan, bundlerFacts)
  Manifest-->>EV: BuildOutput
  EV->>Plugins: buildOutput(output)
  EV->>EV: emit dist/manifest.json
  loop each HTML document
    EV->>Plugins: transformHtml(doc, htmlContext)
  end
  EV->>Plugins: buildEnd({ output, isRebuild })
```

框架 manifest 是 `dist/manifest.json`。旧的 `dist/client/manifest.json` 和 `dist/server/manifest.json` 不再是新架构的核心契约。

## 运行时流程

```mermaid
sequenceDiagram
  participant Browser
  participant Shell as "@evjs/client/internal"
  participant Runtime as "@evjs/client"
  participant Server as "@evjs/server"
  participant Manifest as "BuildOutput"

  Browser->>Runtime: page/app boot
  Runtime->>Manifest: load embedded or /manifest.json
  Runtime->>Shell: create internal shell
  Shell->>Manifest: resolve app/page/remote target
  Shell->>Shell: negotiate remote shared scope
  Shell->>Browser: import JS/CSS module assets
  Shell->>Runtime: mount/hydrate/unmount lifecycle

  Browser->>Server: POST runtime.server.fn
  Server->>Server: dispatch registered server function
  Server-->>Browser: JSON result/error

  Browser->>Server: GET page route
  Server->>Manifest: match route/page/renderer
  Server-->>Browser: SSR HTML

  Browser->>Server: GET PPR page route
  Server->>Manifest: match shell and region renderers
  Server->>Server: render/cache declared regions
  Server-->>Browser: PPR HTML in the same route response

  Browser->>Server: GET runtime.server.rsc?page=id
  Server->>Manifest: read RSC renderer and reference manifests
  Server-->>Browser: React Flight stream
```

PPR 首屏不会要求浏览器再请求 region endpoint。框架服务端可以对 page route 使用
`merge` 或 `stream` delivery。`merge` 是默认非流式模式，会在 shell 和 regions
都完成后返回最终合成 HTML。`stream` 会先发送 shell HTML，再在同一个 document
response 中发送 region patches。派生的 `runtime.server.ppr` endpoint 仍保留给
direct/debug 访问和 cache 验证使用。

在单个服务端进程里，region resolution 是框架内部调用。在 edge 部署里，同一份
契约可以拆到多层：edge 服务缓存的 shell，再通过 server-to-server 请求访问内源
origin/FaaS 的 dynamic region endpoint。浏览器仍然只看到页面 route：

```mermaid
sequenceDiagram
  participant Browser
  participant Edge as Edge/CDN
  participant Origin as Internal FaaS / Origin

  Browser->>Edge: GET /campaign
  Edge->>Edge: load cached PPR shell
  Edge->>Edge: read public manifest PPR region metadata
  Edge->>Origin: GET /__evjs/ppr/campaign/offer
  Origin->>Origin: render/cache offer region
  Origin-->>Edge: region HTML fragment + cache headers
  Edge->>Edge: apply region cache policy
  alt delivery = merge
    Edge-->>Browser: complete composed HTML
  else delivery = stream
    Edge-->>Browser: shell HTML, then region patch in same response
  end
```

因此 `GET /__evjs/ppr/...` 可能出现在 edge 到 origin 的服务端日志里，但不会出现在
浏览器网络日志里。长期运行时边界应是可替换的 region resolver：Node/dev 可以在
本进程调用 renderer，edge adapter 可以 fetch 内源 FaaS endpoint，而不改变公开页面协议。

推荐的 PPR 编写模型是 React `Suspense` 包裹 `lazy(() => import(...))` 子组件。
页面组件声明 `export const render = "ssr"`，并通过
`export const prerender = { partial: true, delivery }` 开启 partial
prerendering。动态 region 模块可以声明 `export const cache` 和
`export const hydrate`。PPR 是建立在 SSR 之上的 prerendering 策略，不是
独立的 document render mode。

PPR 页面在 public manifest 中的 page-level hydration 是 `none`。需要客户端交互时，
应通过显式 client islands 或 region-level hydration metadata 引入，而不是 hydrate 整个
PPR shell。

RSC Flight 请求也通过同一个 `@evjs/server` 边界进入。Flight endpoint 接受
`page=<id>` 和可选的 `url=<pathname+search>`；`page` id 必须是 manifest page id，
并遵循 build identifier 规则。URL context 必须是同源绝对 path 或 HTTP(S) URL，
且不能包含 hash。Webpack 验证路径已经使用 React Flight client consumption 和 React
client/server reference manifests；Utoopack 仍需要等价的下层 metadata 才能跑通同一路径。

Remote shared dependencies 使用 host 显式提供的 share scope。内部 remote runtime
会在加载 remote entry 前检查 remote `shared` 需求，支持 `shareKey`、singleton
检查、eager metadata，以及包含复合比较符和 `||` 的 semver 风格范围；已满足的依赖会通过
remote context 暴露。Host 应用可以通过 `onRemoteSharedNegotiated()` 观察协商结果，
用于诊断、埋点或策略 UI；普通 remote 组件不应该渲染框架依赖版本。React host 页面应该使用
`useRemoteHost()` / `RemoteApp`；更底层的 `startRemoteAppRuntime()` 接收高级
`runtime` hooks，用于自定义 shared scope、manifest 加载、module 加载和错误处理。
Remote host 的 `activeWhen` 选项使用和 `remotes` 配置相同的 pathname pattern 校验。
`RemoteApp` target 的 `remote` 使用和 `remotes` 配置相同的 build identifier 规则；
object 形式的 activation request 会默认继承这个目标，除非显式设置 `remoteId`。
使用 `request.remoteEntryId` 可以选择具体 remote entry，而不需要重复 host remote id。
也可以使用 `request.url` 通过 `activeWhen` 选择 entry；不要在同一个 request 中同时提供两者。
object 形式的 activation request 会把 `remoteId`、`remoteEntryId`、`pageId` 和
`buildId` 按 build identifier 规则校验；`appId` 和 `url` 必须是非空字符串，且不能带首尾空白；
其中 `url` 只能是 HTTP(S) URL，或以 `/` 开头的 pathname。`mountPoint` 提供时必须是 Element object；`hydrate` 提供时必须是 boolean。`manifest`
以及通过可选 `manifestQueryParam` 读取到的 manifest 值必须是非空 HTTP(S) URL 或 path，
且不能带首尾空白。
获取到的 remote manifest name 和 entry id 会在 activation 前按 build identifier
规则校验；获取到的 remote manifest `name` 必须和加载它的 host `remotes.<id>`
一致。module href、asset href 等 manifest 字符串字段如果包含首尾空白，或不能基于
remote manifest base URL 解析成 `http:`/`https:` URL，也会被拒绝。
默认导出的 React remote module 会自动适配成内部 lifecycle module。Remote module
不能把默认 React component 和显式 `mount()`、`hydrate()` 或 `unmount()` 导出混用；
`init()` 可以和默认 component 一起用于 setup。显式 lifecycle module 只作为高级生命周期逃生口保留，
且必须导出 `mount()` 或 `hydrate()`，因为只有 `init()` / `unmount()` 不能渲染 remote entry。
自定义 `runtime.loadModule()` hook 使用同样的 module 形状，因此对于
`react-component` remote entry，可以返回 lifecycle functions，也可以返回
`{ default: RemoteComponent }`。自动包加载和版本选择不属于这版实现。

## 配置归属

```txt
routing
  文件路由事实来源：spa/mpa mode、dir、html、mount point

entry/html
  手动单应用快捷配置

pages.*
  显式独立页面输出：path、entry/component/app、mount point

server.basePath
  派生 fn、ppr、rsc 等框架服务端路径

transport.baseUrl
  浏览器访问框架服务端的 origin 覆盖

plugins
  框架和 bundler 扩展点
```

`routing` 默认指向 `src/pages`。SPA 模式会把发现到的文件转成内部 TanStack
Router app entry；MPA 模式会把同一批文件转成不带客户端路由器的独立页面输出。

Page modules 通过文件名拥有 path-to-component wiring，并通过 `render`、`hydrate`、
`rsc`、`prerender` 等静态导出拥有渲染元信息。当 graph creation 发现 SSR、RSC
或 partial prerender metadata 时，会从该页面模块派生所需的 server renderers、
PPR regions、assets 和 manifest output。
完整 server manifest 会显式保留这些 renderer 关系：SSR、SSG 和 RSC document page
通过由 page id 拥有的 `page-server` renderer 解析，或通过该 page 的某个 route id
拥有的 `page-server` renderer 解析。PPR 页面改由 `ppr-shell` 和 `ppr-region`
entry 解析。

`pages.*` 保留为显式底层页面 API。它适合页面无法自然映射到 `src/pages` 文件树的场景。
渲染元信息仍属于被引用的 page module，而不是 `ev.config.ts`。

## 服务端函数管线

```txt
"use server" module
  -> build-tools extraction
  -> client transform creates internal client references
  -> server transform/register path
  -> BuildOutput.server.functions
  -> framework server dispatches POST runtime.server.fn
```

公开配置只暴露 `server.basePath`；函数 endpoint 从这个 base path 派生。

RSC `use client` reference extraction 会在 `BuildOutput.rsc` 中保留 default
export、identifier export、class export、同模块 alias、namespace re-export
名称（例如 `export * as Widgets from "./widgets"`），以及包含字符串字面量
alias 的 re-export 名称。type-only export 会被忽略。client reference transform
会生成内部 binding 并通过 export specifier 导出，因此 reserved word 和字符串字面量
alias 仍是合法 JavaScript。
`BuildOutput.rsc.clientReferences` 和 `BuildOutput.rsc.serverReferences` 使用
提取出的 reference id 作为无首尾空白的字符串 key。这些 id 可以包含文件路径、URL
语法、`#` 或 `:`；value object 携带无首尾空白的 `module` 和可选 `exportName`。
只有 reference metadata 的 RSC output 可以省略 `BuildOutput.rsc.endpoint`；
包含 RSC page output 时不能省略，因为 Flight 请求需要明确的 endpoint。缺少
`runtime.server.rsc` 时，manifest linker 会拒绝 RSC page output。
在完整 server manifest 中，每个 RSC page renderer reference 必须解析到
`owner.pageId` 匹配该 RSC page id 的 `rsc-page` renderer；公开 manifest
可以省略这些 server-only renderer metadata。
忽略 type-only 和 ambient declaration 后，`"use client"` 模块仍必须暴露至少一个
runtime client reference。
裸的 runtime `export * from "./widgets"` 会被拒绝，因为 framework manifest
必须知道每一个 client reference export name；请改用显式 named re-export 或
namespace re-export。
格式错误的 `"use client"` 模块会在 graph analysis 阶段报告文件路径和 parser
message，再进入 bundler transform 前即可定位问题。

## 部署

Deployment adapter 消费 `BuildOutput`。`@evjs/ev` 提供：

- `createDeploymentArtifact(output)`：生成平台中立的路由、资源和服务端 metadata；
- `nodeDeploymentAdapter()`：具体 Node 生产目标，输出 `dist/deployment.node.json`
  和 `dist/server.mjs`；
- `staticDeploymentAdapter()`：输出静态托管路由 metadata 和 `_redirects`；
- `edgeDeploymentAdapter()`：输出 edge worker 入口，由 worker 调用框架服务端 bundle
  和静态资源 binding。

平台专属 adapter 应从 `BuildOutput` 派生 routing、framework endpoint、SSR、PPR、RSC、
remote、shared dependency 和 asset metadata，而不是读取 bundler stats。
完整 server manifest 会保留源码 module 和 server renderer reference；公开/浏览器
manifest 保持相同的 routing 与 asset 结构，但会脱敏这些 server-only 字段，因此客户端
校验会把它们视为可选。

部署模型由能力分类驱动：

```txt
static-only
  CSR / MPA client entries / SSG / remote manifests / assets

unified node
  static assets + framework endpoints + SSR/PPR/RSC + server functions/routes

unified edge worker
  asset binding + edge-compatible framework server bundle

edge + origin/FaaS split
  edge caches assets/shells
  origin/FaaS resolves functions, routes, SSR/RSC, and PPR regions
```

Adapter 应先分类 `BuildOutput`，再输出平台路由。Static hosting 不应声明支持 SSR、
PPR、RSC、server functions 或 server routes，除非同时接入具备服务端能力的 runtime。

## Dev 更新

框架级声明变化和普通 HMR 分开处理：

```txt
config / page route / server declaration change
  -> recreate AppGraph
  -> recreate BuildPlan
  -> diff BuildPlan
  -> if BuildPlan changes:
       devPlanUpdate hooks
       bundlerDevController.updatePlan(update, nextGraph)
  -> if graph-only:
       refresh active graph + dependency watchers
```

默认 Utoopack adapter 可以通过现有 build stats 重新链接 HTML-only plan update。
dynamic entry 和 server renderer update 仍会返回明确 unsupported error，直到 Utoopack
暴露下层 API。webpack adapter 可在进程内应用这些更宽的 update，用于架构验证。样式和
资源编辑仍走 bundler HMR 路径。server function 和 server route 的实现编辑通常保持同一个
`BuildPlan`；此时框架只刷新 graph metadata 和 watch inputs，更新后的代码由 bundler
的普通 server watch 输出。

Graph analysis 会读取文件路由模块和静态 import closure 来发现 server functions、
server routes、page metadata 和 RSC references。静态 import closure discovery 会解析
模块，因此会跟随普通 import、re-export 和合法的字符串字面量 import alias；字面量
dynamic import 指向项目相对模块时也会被跟踪。dev 会 watch 文件路由目录、显式 graph
roots，以及已经包含 framework marker 的文件。显式配置的 page component 属于 graph
root，因为它的静态 `render`、`hydrate`、`rsc`、`prerender` 导出会影响 framework
planning。普通组件、app entry 和样式编辑继续走 bundler HMR，除非这些模块声明了
framework marker。
