# 自定义路由与运行时

大多数应用都应使用标准文件约定：`src/pages/**/page.*` 创建页面，
`src/apis/**/api.*` 创建 API 路由，所在目录决定 URL。全局中间件来自
`src/middlewares/middleware.*`；HTTP 方法策略使用 `@evjs/ev/api` 的
`withMiddlewares(handler, middlewares)` 组合。

只有在应用明确需要关闭文件发现、自行维护程序化 SPA 路由树，或直接使用客户端与
服务端运行时时，才使用本页介绍的替代方式。

## 关闭文件约定

文件约定只有一个项目级总开关：

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  conventions: false,
});
```

`conventions: false` 会一次性关闭以下文件发现：

- `src/pages` 下的 `page.*` 文件和客户端路由；
- `src/apis` 下的 `api.*` 文件和 API 路由；
- 全局 `src/middlewares/middleware.*`。

框架不提供分别关闭页面、API 路由或中间件的开关。不要把
`conventions: false` 与 `routing` 同时配置。启用文件约定时，页面固定放在
`src/pages`，API 路由固定放在 `src/apis`。

仅支持 SPA 的 `application.routes`、被应用引用且带 `"use server";` 的模块，以及
插件生成的模块，都不属于文件发现范围；关闭约定后它们仍然可用。

下面的直接运行时示例用于替代框架管理的文件路由，不会引入另一种自动发现的入口文件。

## 程序化浏览器应用

当浏览器应用自行维护路由和启动逻辑时，直接使用客户端运行时。该入口必须由应用自己的
构建器处理；evjs 不会自动发现或构建 `src/main.tsx`：

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

这种方式与框架的文件页面模型相互独立。

### 在已有 React 树中嵌入 Application

当 DOM root 由其他 React 宿主管理时，使用 `app.createComponent()`，不要调用
`app.render()`。返回的句柄包含稳定的 `Component`、对应的 `element` 和幂等的
`dispose()`。组件会渲染完整 Application，包括 Router、QueryClientProvider 和已配置的
wrappers；创建句柄本身不会渲染，也不会创建 DOM root。

```tsx
import { flushSync } from "react-dom";

const controller = new AbortController();
const application = app.createComponent({ signal: controller.signal });

// hostRoot 由集成方应用拥有。
hostRoot.render(application.element);

// 先从宿主树中移除 Application，再释放它的所有权。
flushSync(() => hostRoot.render(null));
application.dispose(); // controller.abort() 也会释放句柄。
```

同一时间只允许一个渲染所有者。从 DOM 渲染切换到组件模式前，先调用 `app.unmount()`；
再次调用 `app.render()` 前，先移除组件并 dispose 句柄。dispose 或 signal abort 不会替
外部宿主卸载 React 树。已 abort 的 signal 会被拒绝。宿主和嵌入的 Application 必须使用
同一个 React renderer。

通过 `pagesApp.updateRuntime()` 集成框架时，必须先配置并等待 history 更新完成，
再取得组件句柄。排队中或尚未完成的 history 更新会阻止取得句柄；已有组件所有者时也
不能更新 history。仅修改路由的更新会保持外层组件稳定，在替换后的树提交后释放旧
Application 句柄。

## 程序化服务端应用

程序化服务端应用直接使用 `@evjs/server`。这些路由由应用代码显式创建，不属于框架的
文件路由，因此 evjs 不会扫描源码中的 `createRoute()` 声明。

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

请像普通 Node、Fetch、Bun、Deno 或平台应用一样启动该入口，不要依赖服务端文件路由发现。
