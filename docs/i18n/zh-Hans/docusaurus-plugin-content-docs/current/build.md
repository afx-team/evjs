# 构建

## 命令

```bash
ev inspect
ev inspect --json
ev prepare
ev build
```

- `ev inspect` 校验并报告框架输入，不写入 `.ev` 或 `dist`；
- `ev prepare` 在 `.ev` 写入生成 IR，但不运行 bundler；
- `ev build` 解析配置、创建 graph/plan、运行 bundler、链接 build fact 并写入
  production output。

## Inspect

canonical application 的 routing 摘要使用公开 Page-and-Route 词汇：mode、
Page root、发现的 `page.*` 锚点、目录派生 route pattern、Document 与
diagnostic。

canonical inspect 输出不会展示 provider、resolver 实现或 route-types path。它会
报告 resolved Page、Route、Document、server function、server route、rendering
metadata、extension registry、Page config source、provenance 与 diagnostic。
错误会让 inspect 非零退出。

## 生成 IR

`ev prepare` 写入 `.ev`，包括：

- normalized CoreGraph；
- 生成 framework/plugin module；
- entry facade 与 framework slot；
- import edge；
- 最终 BuildPlan；
- manifest input 与 provenance。

canonical application 把校验后的 semantic graph 写到
`.ev/framework/core-graph.json`。`.ev` 是生成物，不得编辑。

## 输出

默认分离浏览器和 server 文件：

```text
dist/
├── client/
│   ├── index.html
│   ├── main.[hash].js
│   └── [chunk].[hash].js
├── server/
│   └── main.[hash].js
└── deployment-metadata.json
```

部署平台需要其他目录时使用 `output.client` / `output.server`：

```ts
export default defineConfig({
  routing: { mode: "spa" },
  output: {
    client: "dist",
    server: "dist-server",
  },
});
```

生成 HTML 包含浏览器 bootstrap 所需 `ClientRuntime`。
`deployment-metadata.json` 是 canonical serialized deployment projection；
完整 `BuildOutput` 只存在于内存中。Core 不输出 split client/server compatibility
manifest。应用代码不得 import 或编辑 deployment metadata。

## SPA 与 MPA 输出

`routing.mode` 控制 Route/Document materialization：

| Routing mode | Route 输出 | Document 输出 |
| --- | --- | --- |
| `spa` | 一个浏览器 route tree 中的 Client Route | 一个 Application-owned shell，外加每个静态 SSG Page 的 Page-owned 输出 |
| `mpa` | 静态语义 route 的独立 Page entry | 每条静态 Page route 一个 Page-owned Document |

二者使用相同 `<routing.dir>/**/page.*` entry、目录 scope 与语义 route
pattern。

两种 mode 下，静态 SSG Page 都按语义 route 决定输出路径：`/` 写入
`index.html`，`/report` 写入 `report/index.html`，不会从 Page id 推导文件名。
如果混合 SPA 的根 SSG Page 已拥有 `index.html`，同时其他 client route 还需要
fallback，Core 会把 Application shell 单独保留在
`__evjs/<application-id>.html`。

MPA 当前只物化静态 Page route。`$param` 与终止 `$...splat` 仍是有效的 SPA
route 身份，但为它们选择 MPA 会在 graph 校验失败，因为一个动态 pattern
不能唯一对应一个构建期 HTML 输出。Route layout 在两种 mode 中都会组合；
router-only boundary facet 仍仅支持 SPA，MPA 会显式拒绝。

需要 Page-specific Document 模板时，把 `index.html` 放在 MPA Page 旁：

```text
src/pages/report/
├── page.tsx
└── index.html
```

canonical SPA/MPA Page 都发现 Page 目录中可选的 `page.config.ts`：

```ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "报表",
  meta: {
    description: "构建生成的业务报表。",
    keywords: "报表,分析",
    viewport: "width=device-width, initial-scale=1",
    "theme-color": "#ffffff",
  },
  render: "ssr",
  hydrate: "load",
  extensions: {
    "@company/analytics": {
      channel: "report",
    },
  },
});
```

该 module 在 graph build 阶段同步求值。Core rendering 字段进入 rendering
BuildPlan。对于实际发射的 MPA/SSG Document，以及构建期编译的 SSR/PPR/RSC
request-time document shell，静态 `title` 和 named `meta` 会物化缺失 tag，并覆盖
模板中匹配的 baseline 值；未声明值保留 baseline。已注册 plugin extension 保持
static graph data，除非能力所属插件把它显式投影到 generated runtime artifact。
Plugin `transformHtml` hook 在框架元信息、assets 与结构化 HTML contribution
物化后运行，可以显式覆盖最终结果。

每个 server-rendered Page 都会在构建期把它配置的 HTML 模板编译成
request-time document shell。模板中手写的 `<html>`、`<head>`、`<body>` 属性和
内容会被保留，同时应用与 static Document 相同的 assets、Page metadata、
`html.tag` contribution 和 `transformHtml` hook。默认 React renderer 在请求时把
Page HTML 与请求相关的 bootstrap data 插入该 shell。

提供自定义 `renderDocument` 会完全替换 compiled shell：仍可从
`ctx.page.metadata` 读取数据，但自定义 renderer 需要自行持有模板 baseline、
assets 与 document structure。插入 `@evjs/server/react` 的
`renderReactPageMetadata(ctx)`，可以保留 core 的安全序列化与 SPA cleanup
行为。构建期 `transformHtml` hook 不会继续处理 custom document renderer
逐请求返回的任意字符串。

## Page Rendering Setting

Page component 不读取 literal `render`、`hydrate`、`prerender` 或 `rsc` export。
把这些值写入同目录 `page.config.ts`：

```ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  render: "ssr",
  hydrate: "none",
  prerender: { partial: true },
});
```

静态生成使用受支持的 `"ssg"` rendering contract。RSC 与 partial-prerendered
Page 必须省略 `hydrate` 或将其设为 `"none"`。RSC Page 使用 `render: "ssr"` 与
`rsc: true`；Flight endpoint 从 `server.basePath` 派生，除非用
`server.rsc.endpoint` 覆盖。同一 Page 不能组合 RSC 与 partial prerendering。
这些 setting normalize 到 Core Page rendering field，且不改变 Page identity。

## 服务端函数与路由

以 `"use server";` 开头的 reachable module 贡献受支持的命名 server function。

服务端请求路由独立从 `src/apis` 发现：

```ts
// src/apis/api/health.ts
export const GET = async () => Response.json({ ok: true });
```

## 构建检查

优先检查用户可控输入：

- `ev.config.ts` 声明 `routing.mode`；
- 每个发布的客户端 Page 只使用一个 `page.*` 扩展名变体；
- 每个 Page 最多使用一个 `page.config.ts` 或 `page.config.js`，其 default
  export 是 static JSON data；
- Page entry 默认导出组件；
- route 目录使用合法 static、`$param`、终止 `$...splat` 与 `(group)`
  segment，且没有 normalized-path 冲突；
- MPA 不使用当前 materializer 报告为不支持的组合；
- template 包含配置的 mount element；
- Page `title` 以及每个 `meta` name/content 都是合法 static string；
- `page.config.ts` 中 Page rendering metadata 使用受支持的值与组合；
- `"use server"` module 以 directive 开头并导出命名 callable；
- `src/apis` route module 导出大写 HTTP method。

运行 build 前应先完成源码转换，再运行 `ev inspect` 审核 Page source、Page config、
route、Document、provenance 与 diagnostic。

## 要点

- 新 SPA/MPA 从同一棵 `page.*` Page-and-Route 树构建；
- `ev inspect` 报告 `routingMode`、Page root、source、Document 默认值，不暴露内部
  provider 选择；
- `.ev`、manifest、build output 与生成的 route-type declaration 都是生成物；
- Bundler adapter 消费 BuildPlan 并返回 build fact，不持有 routing semantic。
