# 高级约定控制

canonical client Page 与 Route 使用正向 `src/pages/**/page.*` 锚点，目录决定
URL；服务端请求路由继续使用 `src/apis` 文件约定，middleware 来自
`src/middleware.ts` 与 `src/apis/**/middleware.ts`。

只有当应用有意自己持有运行时组合，或需要使用显式 SPA route tree 时，才使用本页的控制项。

## 关闭文件约定

文件约定发现只有一个项目级开关：

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  conventions: false,
});
```

`conventions: false` 会一次性关闭所有框架文件发现：

- `src/pages` 下的 Page 与客户端 route 锚点；
- `src/apis` 下的 server file route；
- 全局 `src/middleware.ts` 与 route-scoped
  `src/apis/**/middleware.ts`。

框架不提供 client、server、route、middleware 或 facet 级关闭开关。不要把
`conventions: false` 与显式 `routing` 或 `server.routing` 声明一起配置。
文件约定启用时仍可用 `server.routing: { dir }` 调整服务端路由目录；它只定制
目录，不负责关闭发现。

仅支持 SPA 的 `application.routes` 是显式 route-tree 配置输入，不属于文件约定。
reachable 且带 `"use server";` 的模块，以及插件 contribution 生成的模块，
同样不属于文件约定；关闭文件发现后它们仍然可用。已移除的 `app`、`pages` 与
顶层 `routes` 声明会被拒绝。

手动 browser bootstrap 使用下方 standalone runtime；它不是第二套 canonical
routing model。

## 程序化浏览器应用

当浏览器应用自己持有路由时，直接使用 standalone client runtime。该 entry 由应用
自己的 standalone bundler 持有；evjs Framework config 不会发现或构建 magic
`src/main.tsx`：

```tsx
// src/main.tsx
import {
  createApp,
  createAppRootRoute,
  createRoute,
  Link,
  Outlet,
} from "@evjs/client";

const rootRoute = createAppRootRoute({
  component: () => (
    <main>
      <Link to="/">Home</Link>
      <Outlet />
    </main>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <h1>Home</h1>,
});

const app = createApp({
  routeTree: rootRoute.addChildren([indexRoute]),
});

declare module "@evjs/client" {
  interface Register {
    router: typeof app.router;
  }
}

app.render("#app");
```

这条路径适合明确自行持有 browser router 与 bootstrap 的应用，与框架
Page-and-Route 模型相互独立。

## 程序化服务端应用

程序化服务端应用直接使用 `@evjs/server`。它们是运行时原语，不是框架文件路由输入，
因此 evjs 不会扫描源码中的 `createRoute()` 声明。

```ts
// src/server.ts
import { createApp, createRoute } from "@evjs/server";
import { serve } from "@evjs/server/node";

const health = createRoute("/api/health", {
  GET: async () => Response.json({ ok: true }),
});

const app = createApp({
  routes: [health],
});

serve(app, { port: 3001 });
```

不要使用 `server.entry`。它不是框架配置字段。如果服务端运行时是程序化的，
请把它作为普通 Node、Fetch、Bun、Deno 或平台入口运行在服务端文件路由发现之外。
