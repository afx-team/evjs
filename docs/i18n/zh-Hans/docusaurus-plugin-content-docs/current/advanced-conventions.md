# 高级约定控制

evjs 默认使用文件约定：页面路由来自 `src/pages`，服务端文件路由来自
`src/apis`，middleware 来自 `src/middleware.ts` 和
`src/apis/**/middleware.ts`。多数应用应保持这些默认值。

只有当应用有意自己持有运行时组合，或正在从非约定式结构迁移时，才使用本页的控制项。

## 关闭框架发现

关闭不再希望 evjs 发现的约定：

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: false,
  server: {
    routing: false,
    conventions: false,
  },
});
```

只替换其中一类约定时，可以单独使用这些开关：

| 配置 | 作用 |
| --- | --- |
| `routing: false` | 停止从 `src/pages` 自动发现页面路由。 |
| `server.routing: false` | 停止从 `src/apis` 发现服务端文件路由。 |
| `server.conventions: false` | 停止服务端 middleware 约定发现。 |
| `server.conventions.middleware: false` | 只停止 `src/middleware.ts` 和 `src/apis/**/middleware.ts` 发现。 |
| `routing.conventions.layout: false` | 停止外部 SPA 根布局发现。嵌套 route layout 仍属于 SPA routing。 |

如果应用仍需要 evjs 输出浏览器 bundle，请声明显式 app 或显式 pages：

```ts
export default defineConfig({
  routing: false,
  app: {
    entry: "./src/main.tsx",
    html: "./index.html",
    mount: "#app",
  },
});
```

## 程序化浏览器应用

当浏览器应用自己持有路由时，直接使用 standalone client runtime：

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

这条路径适合不希望 evjs 从 `src/pages` 派生 route modules 的应用。

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
