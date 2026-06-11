# 配置

evjs 默认零配置。应用需要显式入口、页面、框架服务端路径、远程应用、插件或非默认 bundler 时，可以创建 `ev.config.ts`。

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  entry: "./src/main.tsx",
  html: "./index.html",
});
```

## 默认值

| 配置 | 默认值 |
|------|--------|
| `entry` | `./src/main.tsx` |
| `html` | `./index.html` |
| `dev.port` | `3000` |
| `server.dev.port` | `3001` |
| `server.basePath` | `/__evjs` |
| 服务端函数端点 | `${server.basePath}/fn` |

服务端函数端点从 `server.basePath` 派生，没有单独的公开函数端点配置。

## 应用

单应用可以直接使用顶层 `entry` / `html`：

```ts
export default defineConfig({
  entry: "./src/main.tsx",
  html: "./index.html",
});
```

应用有自己的运行时入口、挂载点或 framework-managed routes 时使用 `app`。推荐只把 SPA 指向一个 app declaration source：

```ts
export default defineConfig({
  app: "./src/console/app.tsx",
});
```

```ts
// src/console/app.tsx
import { defineReactApp } from "@evjs/client";
import { operationsRoutes } from "./routes/operations";

function ConsoleApp() {
  return <main>Console</main>;
}

export default defineReactApp({
  html: "./index.html",
  mount: "#app",
  component: ConsoleApp,
  routes: [...operationsRoutes],
});
```

app declaration source 拥有 app entry、`html`、`mount` 和 route groups，避免 app 配置分散在 `ev.config.ts` 和 route files 之间。只有确实想分离 runtime entry 时才在 declaration 里显式写 `entry: "./main.tsx"`。

TanStack 这类路由插件只负责 adapter 能力，不负责拥有应用路由路径。

## 页面

`pages` 声明独立页面输出。字符串页面和 `{ entry }` 页面由用户自己控制 bootstrap：

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
`prerender.delivery` 控制初始 document response。`"merge"` 是默认非流式模式：
框架服务端先渲染 shell 和 regions，再返回完整 HTML。`"stream"` 会先发送 shell，
再在同一个 HTML response 中把已完成的 regions patch 到页面里。两种模式的首屏
导航都不要求浏览器主动请求 `/__evjs/ppr`。

PPR 页面由服务端合成，不会生成整页客户端 hydration entry。需要交互能力的
PPR 页面应显式建模为 client islands 或 region-level hydration，而不是 hydrate
整个 page shell。

RSC 页面使用 SSR document render mode，并通过 `componentModel = "rsc"` 声明组件模型：

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
export const componentModel = "rsc";
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
