# 客户端路由

evjs 路由基于 [TanStack Router](https://tanstack.com/router) 构建。所有路由 API 从 `@evjs/client` 重新导出 —— 不要直接从 `@tanstack/react-router` 导入。

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

## 入口配置

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

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof app.router;
  }
}

app.render("#app");
```

## 根布局

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

## 路由加载器（预取）

使用 `loader` 在路由渲染前预取数据 —— 消除加载转圈：

```tsx
export const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/users",
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

## 可用的重新导出

全部从 `@evjs/client` 导入：

| 类别 | API |
|------|-----|
| **路由创建** | `createAppRootRoute`, `createRoute`, `createRouter`, `createRootRouteWithContext`, `createRouteMask` |
| **组件** | `Link`, `Outlet`, `Navigate`, `RouterProvider`, `ErrorComponent`, `CatchBoundary`, `CatchNotFound` |
| **Hooks** | `useParams`, `useSearch`, `useNavigate`, `useLocation`, `useMatch`, `useMatchRoute`, `useRouter`, `useRouterState`, `useLoaderData`, `useLoaderDeps`, `useRouteContext`, `useBlocker`, `useCanGoBack` |
| **工具** | `redirect`, `notFound`, `isRedirect`, `isNotFound`, `getRouteApi`, `linkOptions`, `lazyRouteComponent`, `createLink` |
