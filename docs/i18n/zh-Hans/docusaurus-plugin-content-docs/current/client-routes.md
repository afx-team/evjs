# 客户端路由

evjs 支持两种路由编写模型：

- **TanStack Router 兼容模式**：用于类型安全 SPA 路由、loader、搜索参数和导航。相关 API 从 `@evjs/client` 重导出。
- **React route declaration**：用于不依赖 TanStack Router、但仍需要构建期 route metadata、SSR、PPR、RSC、remote 和部署路由的应用。

优先从 `@evjs/client` 导入路由 API，这样 evjs 可以把框架 metadata 和路由兼容能力收敛在一个公开包里。

:::important
**路由路径必须是字符串字面量。** `path` 属性只接受字符串字面量类型——传入 `string` 类型的变量或模板字符串会产生 TypeScript 编译错误。这是通过类型系统强制执行的，以确保路由可被静态分析。

```ts
// ✅ 正确 — 字符串字面量
createRoute({ path: "/users/$id", ... });

// ❌ 编译错误 — 宽泛的 `string` 类型
const p: string = "/users";
createRoute({ path: p, ... });

// ❌ 编译错误 — 模板字符串
createRoute({ path: `/users/${segment}`, ... });
```
:::

## TanStack 入口配置

```tsx
// src/main.tsx
import { createApp } from "@evjs/client";
import { rootRoute } from "./pages/__root";
import { homeRoute } from "./pages/home";
import { postsRoute, postsIndexRoute, postDetailRoute } from "./pages/posts";

const routeTree = rootRoute.addChildren([
  homeRoute,
  postsRoute.addChildren([postsIndexRoute, postDetailRoute]),
]);

const app = createApp({ routeTree });

declare module "@evjs/client" {
  interface Register {
    router: typeof app.router;
  }
}

app.render("#app");
```

### 运行时路由选项

在客户端启动时通过 `createApp()` 传入路由运行时选项。`router` 字段接受 TanStack Router options，但 `routeTree` 和 `context` 由 evjs 管理。可以透传 TanStack Router 原生的全局 catch boundary 关闭选项、预加载策略、route masks、URL rewrites、搜索参数序列化和导航生命周期订阅：

```tsx
import { composeRewrites } from "@evjs/client";

const localeRewrite = {
  input: ({ url }: { url: URL }) => {
    url.pathname = url.pathname.replace(/^\/zh(?=\/|$)/, "") || "/";
    return url;
  },
  output: ({ url }: { url: URL }) => {
    url.pathname = `/zh${url.pathname === "/" ? "" : url.pathname}`;
    return url;
  },
};

const app = createApp({
  routeTree,
  router: {
    disableGlobalCatchBoundary: true,
    defaultPreload: "intent",
    defaultPendingMs: 300,
    rewrite: composeRewrites([localeRewrite]),
  },
});
```

需要埋点、链路追踪或路由性能标记时，可以订阅 router events：

```tsx
const unsubscribe = app.router.subscribe("onResolved", (event) => {
  console.info("navigated", event.toLocation.href);
});

// 如果手动注册 listener，在销毁时调用 unsubscribe()
```

evjs 会设置 `routeTree`，注入 router `context.queryClient`，并在你未配置时把 `defaultPreload` 默认为 `"intent"`。其他 TanStack Router options 保持在 `router` 下透明透传。

## React Route Declaration

不想使用 TanStack Router 时，可以用 `defineReactApp()` 声明 framework-managed routes，并保持单一 app declaration source：

```ts
// src/app.tsx
import { defineReactApp, route } from "@evjs/client";
import Campaign from "./pages/Campaign";
import Dashboard from "./pages/Dashboard";
import Insights from "./pages/Insights";

function App() {
  return <main>Dashboard shell</main>;
}

export default defineReactApp({
  html: "../index.html",
  mount: "#app",
  component: App,
  routes: [
    route("/dashboard", Dashboard, {
      id: "dashboard",
    }),
    route("/campaign", Campaign, {
      id: "campaign",
    }),
    route("/insights", Insights, {
      id: "insights",
    }),
  ],
});
```

然后在配置里指向这份 app declaration source：

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  app: "./src/app.tsx",
});
```

route target 推荐使用静态 import 的 React 组件。组件模块自己声明渲染元信息：

```tsx
// src/pages/Dashboard.tsx
export const render = "ssr";
export const hydrate = "load";

export default function Dashboard() {
  return <main>Dashboard</main>;
}
```

graph analyzer 会读取 import declaration 和静态 named exports，并转换成 route/page/rendering metadata。这样既不依赖隐藏文件约定，也保持 route graph 可构建期分析。`page("./pages/Dashboard.tsx")` 仍保留为底层 escape hatch，用于组件 import 不适合的少数场景。渲染元信息应保留在 page module 内，让每个 route 对 render、hydrate、rsc 和 prerender 行为只有一个来源。

需要 TanStack 的类型系统和导航 API 时使用 TanStack Router；需要框架托管 route rendering 时使用这个模型。

## TanStack 根布局

每个应用都需要一个带 `<Outlet />` 的根路由来渲染子路由：

```tsx
import { createAppRootRoute, Link, Outlet } from "@evjs/client";

export const rootRoute = createAppRootRoute({
  component: () => (
    <div>
      <nav>
        <Link to="/">首页</Link>
        <Link to="/posts">文章</Link>
      </nav>
      <Outlet />
    </div>
  ),
});
```

## 动态路由（`$param`）

使用 `$name` 语法定义路径参数，通过 `route.useParams()` 进行类型安全访问：

```tsx
export const userRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/users/$username",
  loader: ({ params, context }) =>
    context.queryClient.ensureQueryData(
      getFnQueryOptions(getUser, params.username),
    ),
  component: () => {
    const { username } = userRoute.useParams();
    return <h2>{username}</h2>;
  },
});
```

## 嵌套路由

父路由通过 `<Outlet />` 渲染子路由，在 `main.tsx` 中通过 `addChildren()` 组装：

```tsx
export const postsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/posts",
  component: () => (
    <div style={{ display: "flex" }}>
      <nav>侧边栏</nav>
      <Outlet />
    </div>
  ),
});

export const postDetailRoute = createRoute({
  getParentRoute: () => postsRoute,
  path: "$postId",
  component: PostDetail,
});
```

## 无路径布局

使用 `id` 代替 `path` 创建不增加 URL 片段的共享 UI：

```tsx
export const dashboardLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "dashboard-layout",
  component: () => <div className="layout"><Outlet /></div>,
});
```

## 搜索参数

使用 `validateSearch` 定义带类型的查询字符串参数：

```tsx
export const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  validateSearch: (search: Record<string, unknown>) => ({
    q: (search.q as string) || "",
    page: Number(search.page) || 1,
  }),
  component: () => {
    const { q, page } = searchRoute.useSearch();
    return <div>搜索: {q}，第 {page} 页</div>;
  },
});
```

使用 search middlewares 可以在导航时统一保留或清理查询参数：

```tsx
import { retainSearchParams, stripSearchParams } from "@evjs/client";

export const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/search",
  validateSearch: (search: Record<string, unknown>) => ({
    q: (search.q as string) || "",
    debug: search.debug === "true",
  }),
  search: {
    middlewares: [retainSearchParams(["q"]), stripSearchParams(["debug"])],
  },
});
```

## 路由加载器（预取）

使用 `loader` 在路由渲染前预取数据 —— 消除加载转圈：

```tsx
export const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/users",
  staleTime: 30_000,
  preloadStaleTime: 10_000,
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(getFnQueryOptions(getUsers)),
  component: UsersPage,
});
```

## 重定向

在 `beforeLoad` 中抛出 `redirect()` 实现渲染前重定向：

```tsx
import { createRoute, redirect } from "@evjs/client";

export const redirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/old-blog",
  beforeLoad: () => {
    throw redirect({ to: "/posts" });
  },
});
```

## 404 兜底

使用 `path: "*"` 捕获所有未匹配的 URL：

```tsx
export const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "*",
  component: () => <h1>404 —— 页面未找到</h1>,
});
```

## 导航

```tsx
import { Link, useNavigate, Navigate } from "@evjs/client";

// 声明式
<Link to="/posts/$postId" params={{ postId: "1" }}>查看</Link>

// 命令式
const navigate = useNavigate();
navigate({ to: "/posts" });

// 重定向组件
<Navigate to="/login" />
```

## Route Masks

Route masks 可以让一个内部路由渲染时，浏览器地址栏展示另一个 URL。它适合详情弹层和 modal routes：

```tsx
import { Link, createRouteMask } from "@evjs/client";

const postModalMask = createRouteMask({
  routeTree,
  from: "/posts",
  to: "/posts/$postId",
  params: { postId: "123" },
});

const app = createApp({
  routeTree,
  router: { routeMasks: [postModalMask] },
});

<Link
  to="/posts/$postId"
  params={{ postId: "123" }}
  mask={{ to: "/posts" }}
>
  打开弹层
</Link>;
```

## 可用的重新导出

这些 API 从 `@evjs/client` 导出：

| 类别 | API |
|------|-----|
| **路由创建** | `createAppRootRoute`, `createRoute`, `createRouter`, `createRootRouteWithContext`, `createRouteMask` |
| **组件** | `Link`, `Outlet`, `Navigate`, `RouterProvider`, `RouterContextProvider`, `ErrorComponent`, `CatchBoundary`, `CatchNotFound`, `Await`, `ClientOnly`, `Match`, `Matches`, `MatchRoute`, `ScrollRestoration`, `Block` |
| **Hooks** | `useParams`, `useSearch`, `useNavigate`, `useLocation`, `useMatch`, `useMatchRoute`, `useMatches`, `useParentMatches`, `useChildMatches`, `useRouter`, `useRouterState`, `useLoaderData`, `useLoaderDeps`, `useRouteContext`, `useLinkProps`, `useBlocker`, `useCanGoBack`, `useAwaited`, `useHydrated`, `useElementScrollRestoration` |
| **工具** | `redirect`, `notFound`, `isRedirect`, `isNotFound`, `getRouteApi`, `RouteApi`, `linkOptions`, `lazyRouteComponent`, `createLink`, `defer`, `retainSearchParams`, `stripSearchParams`, `composeRewrites`, `defaultParseSearch`, `defaultStringifySearch`, `parseSearchWith`, `stringifySearchWith` |
| **History** | `createBrowserHistory`, `createHashHistory`, `createMemoryHistory` |
