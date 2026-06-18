# 构建

## 命令

```bash
ev build
```

`ev build` 会解析配置、创建 `AppGraph`、派生 `BuildPlan`、运行当前 bundler、链接单一 `BuildOutput`，然后输出 HTML。

当你需要解释 evjs 在 bundling 前发现了什么时，使用 `ev inspect`：

```bash
ev inspect
ev inspect --json
```

`ev inspect` 会解析配置和框架声明，但不会运行 bundler，也不会写入 `dist`。
它会报告 routing mode、发现的 page routes、被忽略或拒绝的 route files、
生成 route type 的位置、server functions、server routes、页面 render metadata、
runtime server paths、计划中的 entries/documents 和 diagnostics。只要存在
error 级 diagnostic，命令就以非 0 退出；warning 只展示，不会让命令失败。

## 输出

全栈输出：

```txt
dist/
├── client/
│   ├── index.html
│   ├── main.[hash].js
│   └── [chunk].[hash].js
├── server/
│   └── server.[hash].js
└── manifest.json
```

纯 CSR 输出（`server: false`）是扁平结构：

```txt
dist/
├── index.html
├── main.[hash].js
├── [chunk].[hash].js
└── manifest.json
```

`dist/manifest.json` 是 runtime、server、shell 和 deployment adapter
共同消费的框架契约。HTML 可以把该 manifest 内嵌为 `__EVJS_MANIFEST__`；
当浏览器 runtime 通过 `manifestUrl`、`data-evjs-manifest` 或
`/manifest.json` 获取它时，响应必须是成功的 JSON，并使用
`Content-Type: application/json`，允许附带可选 content-type 参数。

## 构建流水线

1. 加载并解析 `ev.config.ts`。
2. 执行 config/setup 插件 hooks。
3. `createAppGraph()` 分析文件化页面路由文件、底层 app/page 输出、server entry。
4. `createBuildPlan()` 生成具体 client/server entries 和 HTML documents。
5. 当前 bundler 编译 `BuildPlan.entries`。
6. `linkBuildOutput()` 合并 `AppGraph`、`BuildPlan` 和 bundler facts。
7. evjs 输出 `dist/manifest.json`。
8. evjs 生成每个计划内 HTML 文档，并调用 `transformHtml(doc, ctx)`。
9. evjs 调用 `buildEnd({ output, isRebuild })`。

Manifest linking 不会在 bundling 后重新扫描用户源码。

## 程序化准备

只需要框架语义、但不想启动 bundler 的工具，可以从 `@evjs/ev` 调用
`prepareFrameworkBuild()`。它会解析配置、应用页面路由默认值、初始化插件，执行
`buildStart` hooks，报告 graph diagnostics，并返回 resolved config、graph
file dependencies、plugin watch files 和 `dispose()`。`AppGraph` 和
`BuildPlan` 保持为框架内部状态。

该准备 API 会在 bundler 执行、manifest 输出、HTML 输出和 deployment adapter 输出之前停止。

如果需要 CLI 形式的 preflight 和可读 diagnostics，优先使用 `ev inspect`。
它使用同一套 graph 和 plan 准备路径，同时仍将 `AppGraph` 和 `BuildPlan`
保留为框架内部状态。

## 服务端函数

带 `"use server"` 的文件会转换为浏览器可调用引用和服务端注册：

| 端 | 行为 |
|----|------|
| Client | 函数体替换为内部 RPC stub |
| Server | 函数实现注册到 framework server dispatch |

函数输出记录在 `BuildOutput.server.functions`。它的 object key 是 server
function id：必须是非空字符串，且不能包含首尾空白。它们不是 build identifier，
因此生成的 id 可以使用 `fn:refund` 这类分隔符。公开 endpoint 从 `server.basePath`
派生：

```txt
server.basePath = /__evjs
runtime.server.fn = /__evjs/fn
```

## 框架页面

文件化路由和配置式 component page 都会变成 framework-managed component page。
底层 `pages` 字符串简写表示 "component page"；`{ entry }` 页面是用户自控
client entry，仅用于无法套用页面文件约定的场景。组件页面携带显式 metadata，让
bundler adapter 可以用通用 page runtime 包装真实 component import。
`BuildPlan.import` 仍然指向用户组件路径；evjs 不写隐式生产源码文件。

SSR/PPR 页面会向 plan 添加 server render entries。PPR 页面会生成 shell renderer，并为
page component tree 中每个直接包裹 `lazy(() => import(...))` 子组件的 React
`Suspense` boundary 生成 region renderer。运行时框架服务端会在服务 page route 时解析
这些 regions，因此浏览器首屏仍然只有一次 document 请求。PPR 支持两种 document
delivery mode：

- `merge` 是默认非流式模式。服务端等待 regions 完成后返回完整 HTML。
- `stream` 会先发送 shell，再在同一个 HTML response 中发送 region patches。

PPR component page 不会创建 page-level browser entry。除非后续显式建模 client
islands 或 region-level hydration，否则 public manifest 中的 hydrate mode 是 `none`。

在 SPA 模式中，导出 `render = "ssg"` 的文件路由页面仍然遵循 route-owned document
契约：计划内的 SPA document 只有 app HTML fallback，而该页面会在 manifest 中记录
`rendering.html = "static"`，并获得一个 server renderer 供 static generation 或
deployment adapter 使用。如果需要 `pricing.html` 这类独立静态 HTML 文件，请使用不带
`path` 的 configured component page。

在 MPA 模式中，导出 `render = "ssg"` 的文件路由仍然遵循 MPA document 契约：
它会输出自己的静态 HTML document（例如 `pricing.html`），并获得用于 static
generation 的 server renderer。除非页面显式选择 hydration，否则默认不会创建
browser page entry。
导出 `render = "ssr"` 的 MPA 文件路由则是 route-owned server document：它会获得
`page-server` renderer，并在需要 hydration 时获得 page-level browser entry，但不会输出
静态 HTML 文件。

PPR region 的 cache metadata 会进入 manifest：

```json
{
  "pages": {
    "campaign": {
      "render": "ssr",
      "rendering": {
        "component": "server",
        "html": "partial",
        "prerender": "partial",
        "streaming": false,
        "hydrate": "none"
      },
      "ppr": {
        "delivery": "stream",
        "regions": {
          "inventory": {
            "cache": { "revalidate": 60 }
          }
        }
      }
    }
  }
}
```

## 要点

- 单一框架 manifest：`dist/manifest.json`。
- `BuildOutput` 是框架 manifest 契约。
- 会成为 runtime id 的 manifest object key 必须是 build identifier，包括
  app id、page id 和 PPR region id：只能使用字母、数字、下划线或连字符。
- app 和 page runtime module 必须关联到 JavaScript 资产；如果 client entry
  只产出 CSS 或没有产物，manifest 输出会失败。
- 启用 server 的构建必须把 server runtime entry 关联到 JavaScript 资产；
  deployment adapter 会依赖 `server.entry` 导入框架 handler。
- build entry name 是 manifest asset key。它们必须是 build identifier，并且
  必须在 app、page、runtime 和 server entry 之间全局唯一。
- `manifest.server.renderers` 的 key 是 renderer build entry name，也必须使用
  相同的 build-identifier 规则。
- 在完整 server manifest 中，每个使用 server HTML 的 SSR、SSG 或 RSC document
  page 都必须有一个 `page-server` renderer，并由该 page id 拥有，或由
  `manifest.routes` 中指向该 page 的 route id 拥有。PPR 页面改用 `ppr-shell`
  和 `ppr-region` renderer reference。
- `manifest.routes` 的 id 必须唯一，且是无首尾空白的非空字符串。Page route
  path 必须保持每个归一化 URL path 和 dynamic URL shape 只有一个条目；
  `pageId` 和 `appId` 必须指向已存在的 manifest page 或 app。
- RSC reference map 不使用 build identifier 作为 key：reference id 可以包含
  文件路径、URL、hash 或 server-function 标点。但 key 仍必须是无首尾空白的非空
  字符串，每个 value 必须是 object，并包含无首尾空白的非空 `module`，可选
  `exportName` 也必须是无首尾空白的非空字符串。
- 当 RSC section 只携带 reference metadata 时，`BuildOutput.rsc.endpoint`
  可以省略；一旦 `BuildOutput.rsc.pages` 包含 Flight-rendered page，就必须提供
  endpoint。缺少 `runtime.server.rsc` endpoint 的 RSC page output 会在 manifest
  emission 前失败。
- 在完整 server manifest 中，每个 `BuildOutput.rsc.pages[id].renderer`
  必须指向由同一个 page id 拥有的 `rsc-page` server renderer。公开 manifest
  可以省略 server renderer metadata，因为这些字段会被脱敏。
- `BuildOutput.server.routes` 必须保持每个 URL path 和 dynamic URL shape 只有
  一个条目。动态参数名必须安全，并且在同一个 route path 内唯一。
- 公开 manifest 会做脱敏：浏览器可见输出不应暴露本地源码路径或私有构建 metadata。
- 公开 manifest 使用相同的结构校验，但会把源码 module、server renderer reference
  等 server-only metadata 视为可选，因为这些字段会被刻意脱敏。
- 源码分析在 bundler config 创建前完成，并在 dev 中缓存。
- 组件和样式修改继续走 bundler HMR。
- 默认 Utoopack adapter 可以基于现有 build stats 重新链接 HTML-only dev plan
  update。dev 中新增或删除配置页面 entry 仍需要重启，直到 Utoopack 暴露更底层的
  entry update API。
