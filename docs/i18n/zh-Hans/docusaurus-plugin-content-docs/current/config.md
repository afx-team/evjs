# 配置

evjs 默认零配置。应用需要自定义文件路由、页面输出、框架服务端路径、远程应用、插件或非默认 bundler 时，可以创建 `ev.config.ts`。

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  fileRoutes: {
    mode: "spa",
  },
});
```

## 默认值

| 配置 | 默认值 |
|------|--------|
| `entry` | `./src/main.tsx` |
| `html` | `./index.html` |
| `fileRoutes.mode` | `spa` |
| `dev.port` | `3000` |
| `server.dev.port` | `3001` |
| `server.basePath` | `/__evjs` |
| 服务端函数端点 | `${server.basePath}/fn` |

服务端函数端点从 `server.basePath` 派生，没有单独的公开函数端点配置。

## 文件路由

文件路由是主要客户端路由模型。SPA 模式会从 `src/pages` 构建一个
TanStack Router 驱动的应用：

```ts
export default defineConfig({
  fileRoutes: {
    mode: "spa",
    dir: "./src/pages",
    mount: "#app",
  },
});
```

MPA 模式使用同一套文件，但每个路由输出独立页面，不引入客户端路由器：

```ts
export default defineConfig({
  fileRoutes: {
    mode: "mpa",
  },
});
```

当项目存在 `src/pages` 且没有默认的 `src/main.tsx` 时，SPA 文件路由会自动启用。

只有手动 bootstrap 单应用时，才使用顶层 `entry` / `html`：

```ts
export default defineConfig({
  entry: "./src/main.tsx",
  html: "./index.html",
});
```

## 页面

`pages` 是独立页面输出的显式底层 API。当页面集合直接来自 `src/pages` 时，
优先使用 `fileRoutes: { mode: "mpa" }`。字符串页面和 `{ entry }` 页面由用户自己控制 bootstrap：

```ts
export default defineConfig({
  pages: {
    home: "./src/pages/home/main.tsx",
    about: {
      entry: "./src/pages/about/main.tsx",
      html: "./src/pages/about/index.html",
    },
  },
});
```

组件页面由 evjs 的通用 runtime 负责 mount/hydrate：

```ts
export default defineConfig({
 pages: {
    dashboard: {
      path: "/dashboard",
      component: "./src/pages/dashboard/Page.tsx",
      html: "./src/pages/public.html",
      mount: "#app",
    },
  },
});
```

```tsx
// src/pages/dashboard/Page.tsx
export const render = "ssr";
export const hydrate = "load";

export default function DashboardPage() {
  return <main>Dashboard</main>;
}
```

配置了 `path` 时，该页面也会贡献 framework route。SSR、SSG、PPR 等由框架服务端处理的页面应把 URL 和 component 放在配置里，把 rendering metadata 放在组件模块旁边。未配置 `path` 时，页面会输出为 `campaign.html` 这样的 HTML 文档。

### Page Module 静态导出

evjs 会从 framework-managed page module 中读取以下 named static exports。请使用
字面量值，这样 graph analysis 不需要执行用户代码也能解析。

| 导出 | 可选值 | 含义 |
| --- | --- | --- |
| `render` | `"csr"` | 客户端渲染页面。页面在浏览器中 mount，不生成 server document renderer。省略 `render` 时默认是该模式。 |
| `render` | `"ssr"` | 服务端渲染 document。框架服务端为请求生成 HTML，然后浏览器按 `hydrate` 策略 hydration。需要启用 `server`。 |
| `render` | `"ssg"` | 静态 document 意图。manifest 会把页面标记为 fully prerendered/static，默认 hydration mode 是 `none`。不需要动态服务端能力时，deployment adapter 可以把它作为静态 HTML 服务。 |
| `hydrate` | `"none"` | 不对整页做浏览器 hydration。适合静态页面、RSC document，或通过显式 islands/regions 建模交互的 PPR shell。 |
| `hydrate` | `"load"` | 页面 runtime 加载后 hydration。非 SSG 的 server-rendered 页面默认是该模式。 |
| `hydrate` | `"visible"` | 声明 mount point 可见后再 hydration。不支持 visibility scheduling 的 runtime/adapter 可以回退到 `load`。 |
| `hydrate` | `"idle"` | 声明浏览器空闲时再 hydration。不支持 idle scheduling 的 runtime/adapter 可以回退到 `load`。 |
| `prerender` | `true` | 标记页面可 prerender，但不启用 partial prerendering。 |
| `prerender` | `{ partial: true }` | 启用 PPR。框架会从页面树中的 `Suspense` + `lazy(() => import(...))` boundary 推导动态 region。 |
| `prerender.delivery` | `"merge"` | 非流式 PPR delivery。服务端解析 shell 和 regions 后，返回一个完整 HTML response。partial prerendering 默认使用该模式。 |
| `prerender.delivery` | `"stream"` | 流式 PPR delivery。服务端可以先 flush shell，再把已完成的 regions patch 到同一个 response 中。 |
| `prerender.revalidate` | `number` | 声明 prerendered output 的 revalidation 间隔，单位是秒。 |
| `prerender.revalidate` | `false` | 声明 prerendered output 不自动 revalidate。 |
| `rsc` | `true` | 启用 RSC 页面路径。通常和 `render = "ssr"`、`hydrate = "none"` 一起使用。需要当前 bundler/server adapter 支持 `server.rsc`。 |

PPR 页面推荐在页面组件树中声明动态 region：

```ts
export default defineConfig({
  pages: {
    campaign: {
      path: "/campaign",
      component: "./src/pages/campaign/Page.tsx",
    },
  },
});
```

```tsx
import { lazy, Suspense } from "react";

export const render = "ssr";
export const hydrate = "none";
export const prerender = {
  partial: true,
  delivery: "stream",
} as const;

const OfferRegion = lazy(() => import("./Offer.region"));

export default function CampaignPage() {
  return (
    <Suspense fallback={<p>Loading</p>}>
      <OfferRegion />
    </Suspense>
  );
}
```

```tsx
// ./Offer.region.tsx
export const cache = { revalidate: 60 } as const;
export const hydrate = "none";

export default function OfferRegion() {
  return <section>Live offer inventory</section>;
}
```

框架会分析 page module，并把 Suspense lazy boundary 转成内部 region renderer。
Region id 会从 lazy 组件名派生，因此 `OfferRegion` 会变成 `offer`。

Region module 可以声明以下静态导出：

| 导出 | 可选值 | 含义 |
| --- | --- | --- |
| `cache` | `"no-store"` | 每次都动态渲染 region。适合请求相关或用户相关数据。 |
| `cache` | `{ revalidate: number }` | 缓存 region output，并在给定秒数后 revalidate。 |
| `hydrate` | `"none"` | 不在浏览器中 hydrate region。server-only region 默认使用该模式。 |
| `hydrate` | `"load"` | region client runtime 加载后 hydration。 |
| `hydrate` | `"visible"` | 声明 region 可见后 hydration。不支持 visibility scheduling 的 runtime 可以回退到 `load`。 |
| `hydrate` | `"idle"` | 声明 region 在浏览器空闲时 hydration。不支持 idle scheduling 的 runtime 可以回退到 `load`。 |

`prerender.delivery` 控制初始 document response。`"merge"` 是默认非流式模式：
框架服务端先渲染 shell 和 regions，再返回完整 HTML。`"stream"` 会先发送 shell，
再在同一个 HTML response 中把已完成的 regions patch 到页面里。两种模式的首屏
导航都不要求浏览器主动请求 `/__evjs/ppr`。

PPR 页面由服务端合成，不会生成整页客户端 hydration entry。需要交互能力的
PPR 页面应显式建模为 client islands 或 region-level hydration，而不是 hydrate
整个 page shell。

RSC 页面使用 SSR document render mode，并通过 `rsc = true` 显式开启 RSC：

```ts
export default defineConfig({
  pages: {
    insights: {
      path: "/insights",
      component: "./src/pages/Insights.tsx",
    },
  },
  server: {
    rsc: true,
  },
});
```

```tsx
// src/pages/Insights.tsx
export const render = "ssr";
export const rsc = true;
export const hydrate = "none";

export default function InsightsPage() {
  return <main>Insights</main>;
}
```

当前 webpack validation adapter 已经覆盖完整 RSC 请求链路。默认 Utoopack adapter
仍需要补齐等价的 client/server reference metadata 后，才能运行同样路径。

## 服务端

纯 CSR 可以禁用服务端：

```ts
export default defineConfig({ server: false });
```

`server: false` 时：

- 构建输出为扁平 `dist/`；
- `"use server"` 模块会成为构建错误；
- dev 模式不会配置框架服务端代理。

框架服务端边界默认是 `/__evjs`。只有部署平台要求固定路径时，才需要配置
`server.basePath`：

```ts
export default defineConfig({
  server: {
    entry: "./src/server.ts",
    dev: {
      port: 3001,
      https: false,
    },
  },
});
```

派生路径：

```txt
/__evjs/fn       服务端函数
/__evjs/ppr      存在 PPR 页面时的 region direct/debug endpoint
/__evjs/rsc      启用 server.rsc 时的 Flight endpoint
```

PPR 页面首屏不会要求浏览器调用 `/__evjs/ppr`；框架服务端在服务 page route 时解析
declared regions。

只有当浏览器需要调用另一个 origin 上的框架服务端时，才配置 `transport.baseUrl`：

```ts
export default defineConfig({
  transport: {
    baseUrl: "https://api.example.com",
  },
});
```

## 远程应用

远程应用通过 manifest 加载：

```ts
export default defineConfig({
  remotes: {
    crm: {
      manifest: "https://assets.example.com/crm/manifest.json",
      activeWhen: ["/app/crm/*"],
    },
  },
});
```

## 插件

```ts
export default defineConfig({
  plugins: [
    {
      name: "build-timer",
      setup() {
        const start = Date.now();
        return {
          buildEnd({ output }) {
            console.log("Build", output.buildId, Date.now() - start);
          },
        };
      },
    },
  ],
});
```

更多 hook 签名、单 HTML 文档上下文和 bundler 辅助函数见 [插件指南](./plugins.md)。
