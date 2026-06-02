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
3. `createAppGraph()` 分析显式 app/page/server roots。
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
| Client | 函数体替换为 `createServerReference()` RPC stub |
| Server | 函数实现注册到 `@evjs/server` dispatch |

函数输出记录在 `BuildOutput.server.functions`。公开 endpoint 从 `server.basePath` 派生：

```txt
server.basePath = /__evjs
runtime.server.fn = /__evjs/fn
```

## 框架页面

字符串页面和 `{ entry }` 页面是用户自控 client entry。组件页面携带显式 metadata，让 bundler adapter 可以用通用 page runtime 包装真实 component import。`BuildPlan.import` 仍然指向用户组件路径；evjs 不写隐式生产源码文件。

SSR/PPR 页面会向 plan 添加 server render entries。PPR region 的 cache metadata 会进入 manifest：

```json
{
  "pages": {
    "campaign": {
      "render": "ppr",
      "ppr": {
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
- `BuildOutput` 替代旧 client/server manifests。
- 源码分析在 bundler config 创建前完成，并在 dev 中缓存。
- 组件和样式修改继续走 bundler HMR。
- dev 中新增配置页面需要 bundler `updatePlan()` 能力；当前 Utoopack adapter 会在下层 API 补齐前明确失败。
