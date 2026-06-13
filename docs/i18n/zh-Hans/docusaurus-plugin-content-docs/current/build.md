# 构建

## 命令

```bash
ev build
```

`ev build` 会解析配置、创建 `AppGraph`、派生 `BuildPlan`、运行当前 bundler、链接单一 `BuildOutput`，然后输出 HTML。

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

`dist/manifest.json` 是 runtime、server、shell 和 deployment adapter 共同消费的框架契约。

## 构建流水线

1. 加载并解析 `ev.config.ts`。
2. 执行 config/setup 插件 hooks。
3. `createAppGraph()` 分析文件化页面路由树、底层 app/page 输出、server entry 和 remotes。
4. `createBuildPlan()` 生成具体 client/server entries 和 HTML documents。
5. 当前 bundler 编译 `BuildPlan.entries`。
6. `linkBuildOutput()` 合并 `AppGraph`、`BuildPlan` 和 bundler facts。
7. evjs 输出 `dist/manifest.json`。
8. evjs 生成每个计划内 HTML 文档，并调用 `transformHtml(doc, ctx)`。
9. evjs 调用 `buildEnd({ output, isRebuild })`。

Manifest linking 不会在 bundling 后重新扫描用户源码。

## 服务端函数

带 `"use server"` 的文件会转换为浏览器可调用引用和服务端注册：

| 端 | 行为 |
|----|------|
| Client | 函数体替换为内部 RPC stub |
| Server | 函数实现注册到 `@evjs/server` dispatch |

函数输出记录在 `BuildOutput.server.functions`。公开 endpoint 从 `server.basePath` 派生：

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
- 公开 manifest 会做脱敏：浏览器可见输出不应暴露本地源码路径或私有构建 metadata。
- 源码分析在 bundler config 创建前完成，并在 dev 中缓存。
- 组件和样式修改继续走 bundler HMR。
- dev 中新增配置页面需要 bundler `updatePlan()` 能力；当前 Utoopack adapter 会在下层 API 补齐前明确失败。
