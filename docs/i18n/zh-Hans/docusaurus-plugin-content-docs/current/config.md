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

应用有自己的运行时入口、挂载点或真实 route source 时使用 `apps`：

```ts
export default defineConfig({
  apps: {
    console: {
      entry: "./src/console/main.tsx",
      html: "./src/console/index.html",
      routes: "./src/console/routes.tsx",
      mount: "#app",
    },
  },
});
```

`apps.*.routes` 指向运行时代码也会 import 的同一个路由模块。TanStack 这类路由插件只负责 adapter 能力，不负责拥有应用路由路径。

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
   campaign: {
      path: "/campaign",
     component: "./src/pages/campaign/Page.tsx",
     html: "./src/pages/public.html",
      render: "ssr",
      hydrate: "load",
      mount: "#app",
    },
  },
});
```

配置了 `path` 时，该页面也会贡献 framework route。SSR、SSG、PPR 等由框架服务端处理的页面应把 URL、component、render mode、hydration 放在同一条页面声明里。未配置 `path` 时，页面会输出为 `campaign.html` 这样的 HTML 文档。

PPR 页面推荐在页面组件树中声明动态 region：

```ts
export default defineConfig({
  pages: {
    campaign: {
      path: "/campaign",
      component: "./src/pages/campaign/Page.tsx",
      render: "ppr",
      ppr: {
        delivery: "stream",
      },
    },
  },
});
```

```tsx
import { lazy, Suspense } from "react";

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
export const PPR = {
  cache: { revalidate: 60 },
} as const;

export default function OfferRegion() {
  return <section>Live offer inventory</section>;
}
```

框架会分析 page module，并把 Suspense lazy boundary 转成内部 region renderer。
Region id 会从 lazy 组件名派生，因此 `OfferRegion` 会变成 `offer`。
`pages.*.ppr.regions` 仍保留为底层 escape hatch，但 Suspense 声明是推荐 API。

`pages.*.ppr.delivery` 控制初始 document response。`"merge"` 是默认非流式模式：
框架服务端先渲染 shell 和 regions，再返回完整 HTML。`"stream"` 会先发送 shell，
再在同一个 HTML response 中把已完成的 regions patch 到页面里。两种模式的首屏
导航都不要求浏览器主动请求 `/__evjs/ppr`。

PPR 页面由服务端合成，不会生成整页客户端 hydration entry。需要交互能力的
PPR 页面应显式建模为 client islands 或 region-level hydration，而不是 hydrate
整个 page shell。

`render: "rsc"` 已预留给后续专用 RSC transform/runtime adapter。

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
