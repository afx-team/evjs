# 页面与路由

在 URL 对应的目录中添加 `page.*` 即可创建页面。evjs 会把目录树转换成 SPA 路由或 MPA 文档。

```ts title="ev.config.ts"
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: { mode: "spa" },
});
```

## 创建页面

页面模块默认导出 React 组件：

```tsx title="src/pages/about/page.tsx"
export default function AboutPage() {
  return <main>About this application</main>;
}
```

所在目录创建 `/about`，根级 `src/pages/page.tsx` 创建 `/`。

只有 `page.ts`、`page.tsx`、`page.js` 或 `page.jsx` 发布页面，其他文件都可以共置而不会变成路由。

## 构建路由树

目录嵌套创建嵌套路由路径：

| 目录 | URL 形态 |
| --- | --- |
| `users` | `/users` |
| `users/$userId` | `/users/:userId` |
| `files/$...splat` | `/files/*` |
| `(marketing)/about` | `/about` |

```text
src/pages/
├── page.tsx                         # /
├── teams/
│   ├── page.tsx                     # /teams
│   └── $teamId/
│       └── page.tsx                 # /teams/:teamId
├── files/
│   └── $...splat/
│       └── page.tsx                 # /files/*
└── (marketing)/
    └── about/
        └── page.tsx                 # /about
```

没有 `page.*` 的目录可以组织后代。`$...splat` 必须是最后一个路径段。动态参数与通配路径仅支持 SPA。

## 将 SPA 挂载到 basepath

当所有浏览器路由都必须位于同一个静态前缀下时，配置 `routing.basepath`：

```ts title="ev.config.ts"
export default defineConfig({
  routing: { mode: "spa", basepath: "/next" },
});
```

源码中的根页面仍是 `/`，`/about` 页面在 `Link`、`navigate`、重定向和生成的路由类型中也仍写作 `/about`；对应浏览器 URL 会变为 `/next` 与 `/next/about`。开发路由、服务端渲染和部署 fallback 同样使用带前缀的路径。MPA 不支持 `basepath`；SPA 挂载在域名根路径时省略该字段。

## 读取路径参数与查询参数

使用 `@evjs/ev/route` 中的路由 Hook 函数：

```tsx title="src/pages/users/$userId/page.tsx"
import { usePageParams, usePageSearch } from "@evjs/ev/route";

export default function UserPage() {
  const { userId } = usePageParams();
  const search = usePageSearch();

  return (
    <h1>
      User {userId} · tab {search.tab ?? "overview"}
    </h1>
  );
}
```

查询参数的初始值都是字符串。CSR SPA 页面可以导出 `validateSearch` 进行转换或补充默认值：

```tsx
export const validateSearch = (search: Record<string, string>) => ({
  tab: typeof search.tab === "string" ? search.tab : "overview",
});
```

`usePageParams()` 是 Page 作用域 API，在 SPA、MPA 和 RSC 渲染中语义一致。SPA 的根布局和嵌套布局使用 `useRouteParams()` 读取当前激活路由分支合并后的参数：

```tsx title="src/pages/layout.tsx"
import { useRouteParams } from "@evjs/ev/route";

export default function RootLayout({ children }: React.PropsWithChildren) {
  const { teamId } = useRouteParams<{ teamId?: string }>();
  return <main data-team-id={teamId}>{children}</main>;
}
```

## 解析浏览器 href

`Link`、`useNavigate()` 与 `redirect()` 接收应用相对路由，并自动应用 `routing.basepath`。原生 `<a>` 和 `window.open()` 等浏览器 API 需要公开浏览器 URL：固定目标使用 `useHref()`，回调中动态生成目标时使用 `useHrefResolver()`。

```tsx
import { useHref, useHrefResolver } from "@evjs/ev/navigation";

export function NativeLinks() {
  const settingsHref = useHref({ to: "/settings" });
  const resolveHref = useHrefResolver();
  return (
    <>
      <a href={settingsHref}>设置</a>
      <button onClick={() => window.open(resolveHref({ to: "/reports/$reportId", params: { reportId: "42" } }))}>
        打开报告
      </button>
    </>
  );
}
```

## 渲染子页面

SPA 模式下，父页面通过 `Outlet` 渲染当前子页面：

```tsx title="src/pages/teams/page.tsx"
import { Outlet } from "@evjs/ev/navigation";

export default function TeamsPage() {
  return (
    <section>
      <h1>Teams</h1>
      <Outlet />
    </section>
  );
}
```

如果后代不应渲染在一个父页面中，请使用没有 `page.*` 的目录组织它们。

## 添加布局与边界

布局包裹后代页面：

```text
src/pages/
├── layout.tsx                       # 包裹整个应用
├── error.tsx                        # SPA 错误边界
├── not-found.tsx                    # SPA 未找到边界
└── admin/
    ├── layout.tsx                   # 包裹 /admin 后代
    ├── page.tsx
    └── settings/
        └── page.tsx
```

布局同时支持 SPA 与 MPA。`error.*` 和 `not-found.*` 是浏览器路由边界，因此仅支持 SPA。

## 导航

需要文档级导航时使用标准链接；SPA 导航使用公共辅助 API：

```tsx
import { Link, useNavigate } from "@evjs/ev/navigation";

export default function HomePage() {
  const navigate = useNavigate();

  return (
    <>
      <Link to="/users/1">Open user</Link>
      <button type="button" onClick={() => navigate({ to: "/users/2" })}>
        Next user
      </button>
    </>
  );
}
```

evjs 可能为文件路由生成 `src/route-types.d.ts`。保持忽略即可，导航 API 会自动使用这些声明。

## 在 CSR 页面中加载路由数据

CSR SPA 页面可以导出浏览器路由生命周期函数和组件：

```tsx
import { usePageLoaderData } from "@evjs/ev/route";

export async function loader() {
  return { title: "Users" };
}

export default function UsersPage() {
  const data = usePageLoaderData();
  return <h1>{data.title}</h1>;
}
```

支持的生命周期导出包括 `loader`、`beforeLoad`、`validateSearch`、`pendingComponent`、`errorComponent` 和 `notFoundComponent`。它们在 SPA 浏览器路由树中运行。SSR 与 SSG 页面不使用这种客户端 Loader 模型；请改用[服务端函数](./server-functions)或对应渲染数据流。

## 选择 SPA 或 MPA

改变导航模型时，页面文件不变：

| 能力 | SPA | MPA |
| --- | --- | --- |
| 静态页面 | 支持 | 支持 |
| 动态 `$param` 路由 | 支持 | 不支持 |
| 终止 `$...splat` | 支持 | 不支持 |
| 嵌套布局 | 支持 | 支持 |
| 错误与未找到路由边界 | 支持 | 不支持 |
| 客户端路由导航 | 支持 | 无浏览器路由器 |
| 页面级 HTML 模板 | 用于静态页面产物 | 支持 |

在应用配置中选择 MPA：

```ts title="ev.config.ts"
export default defineConfig({
  routing: { mode: "mpa" },
});
```

MPA 会为静态路由 `/`、`/report` 和 `/foo/bar` 创建 `/index.html`、`/report.html` 与 `/foo/bar.html`。在页面旁添加 `index.html` 可以提供专属文档模板。

## 配置页面元信息与渲染方式

把静态页面选择放在组件旁：

```ts title="src/pages/orders/$orderId/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "Order details",
  meta: {
    description: "Review an individual order.",
  },
  render: "csr",
});
```

当前匹配层级最深的 SPA 页面决定标题和命名元信息。切换到未声明某个值的页面时，会恢复模板中的默认值。

CSR、SSR、SSG、PPR 与 RSC 见[渲染](./rendering)，页面级集成选项见[使用插件](./plugins)。

## 使用显式路由树

`application.routes` 适用于需要自行维护程序化 SPA 路由树的项目。它不能与文件式 `routing` 组合，不能选择 MPA，并使用 `routes` 嵌套。大多数应用应优先使用文件约定，让路由定义与页面代码保持在一起。

该 API 见[自定义路由与运行时](./advanced-conventions)。
