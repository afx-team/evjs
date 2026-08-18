# 渲染

通过相邻 `page.config.ts` 选择每个页面到达浏览器的方式。没有渲染配置的页面使用客户端渲染（CSR）。

## 选择模式

从满足页面需求的最简单模式开始：

| 模式 | 适用情况 | 请求时需要服务端？ | 浏览器 JavaScript |
| --- | --- | --- | --- |
| CSR | 内容偏应用型、与用户相关，或在导航后加载 | 否 | 渲染页面 |
| SSR | 首次响应需要页面 HTML 或请求数据 | 是 | 可选 Hydration |
| SSG | 相同 HTML 可以在构建时创建 | 否 | 可选 Hydration |
| PPR | 稳定外壳可提前构建，局部区域稍后解析 | 是 | 无页面级 Hydration |
| RSC | 页面通过 React Server Components 渲染 | 是 | 仅客户端组件 |

渲染方式与路由发现相互独立：页面仍在同一个目录，并保持相同 URL。

## 客户端渲染

CSR 是默认值。可以完全省略 `page.config.ts`，也可以显式声明：

```ts title="src/pages/dashboard/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  render: "csr",
});
```

CSR 不要设置 `hydrate`。浏览器会创建 React 树，而不是接管服务端生成的标记。

页面不需要在 JavaScript 执行前提供有意义 HTML 时，使用 CSR。

## 服务端渲染

SSR 在每次文档请求时渲染页面：

```ts title="src/pages/account/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  render: "ssr",
  hydrate: "load",
});
```

`hydrate: "load"` 会在客户端包加载后让服务端页面可交互。页面级 HTML 不需要交互时使用 `hydrate: "none"`。

SSR 需要具备服务端能力的部署目标。

## 静态生成

SSG 在 `ev build` 期间创建页面 HTML：

```ts title="src/pages/about/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  render: "ssg",
  hydrate: "none",
});
```

生成页面需要在浏览器变为可交互时，使用 `hydrate: "load"`。SSG 省略 `hydrate` 时默认不 Hydrate。

静态产物无需请求时渲染器即可托管。SPA 模式下，静态页面按语义路径输出：`/report` 生成 `report/index.html`。

## 部分预渲染

PPR 构建可复用的页面外壳，并在请求时解析动态区域：

```ts title="src/pages/feed/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  render: "ssr",
  hydrate: "none",
  prerender: { partial: true },
});
```

PPR 使用 SSR 交付，需要兼容的构建器和服务端部署目标，且不能与同一页面的 RSC 组合。

## React Server Components

通过 `rsc: true` 为页面启用 RSC：

```ts title="src/pages/catalog/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  render: "ssr",
  hydrate: "none",
  rsc: true,
});
```

RSC 页面使用请求时服务端渲染，需要兼容的构建器和服务端部署目标。页面级 Hydration 保持关闭；交互式客户端组件管理自己的浏览器行为。

## 支持的组合

| `render` | `hydrate` | 额外字段 | 结果 |
| --- | --- | --- | --- |
| 省略或 `"csr"` | 省略 | — | 浏览器渲染页面 |
| `"ssr"` | `"load"` 或省略 | — | 请求时 HTML，随后 Hydration |
| `"ssr"` | `"none"` | — | 请求时 HTML，无页面 Hydration |
| `"ssg"` | `"load"` | — | 构建时 HTML，随后 Hydration |
| `"ssg"` | `"none"` 或省略 | — | 构建时 HTML，无页面 Hydration |
| `"ssr"` | `"none"` 或省略 | `prerender: { partial: true }` | PPR |
| `"ssr"` | `"none"` 或省略 | `rsc: true` | RSC |

不支持的组合会在 `ev inspect` 和 `ev build` 期间报告。

## 添加页面元信息

渲染设置可以和静态页面元信息共用一个文件：

```ts title="src/pages/pricing/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "Pricing",
  meta: {
    description: "Compare plans and features.",
    viewport: "width=device-width, initial-scale=1",
  },
  render: "ssg",
  hydrate: "load",
});
```

`meta` 创建 `<meta name="..." content="...">`。它不是通用 Head 元素 API。需要其他静态标签时，可以由页面专属 HTML 模板提供。

## SPA 与 MPA 行为

SPA 和 MPA 使用相同的页面渲染字段，但文档所有权不同：

- SPA 通常共享一个应用文档。静态 SSG 页面还会在其路由路径输出 HTML。
- MPA 为每个静态页面路由创建一份文档。相邻 `index.html` 可以定制该页面模板。
- MPA 不支持动态页面路径、通配路径或仅适用于浏览器路由器的边界。

在服务端渲染页面不会自动把应用变成 MPA；选择 MPA 也不会自动选择 SSR。

## 验证结果

部署前运行：

```bash
ev inspect
ev build
```

`ev inspect` 会报告解析后的渲染选择和能力错误。`ev build` 后，在 `dist/client` 查看浏览器资源和静态 HTML；需要请求时渲染时检查 `dist/server`。

继续阅读[构建](./build)，或在[部署](./deploy)中比较托管方式。
