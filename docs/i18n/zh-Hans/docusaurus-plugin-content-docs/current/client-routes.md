# 客户端路由

evjs 以 `src/pages` 作为客户端路由的唯一事实来源。应用页面写在
页面文件中；框架会发现这些文件，并按配置生成一个 TanStack Router 驱动的
SPA，或生成多个不带路由器的 MPA 页面。evjs 不会写入 `.evjs` 临时路由文件。

## 目录结构

```
src/
├── api/*.server.ts        # 可选 server functions
├── layout.tsx             # 可选 SPA 根布局
└── pages/
    ├── index.tsx          # /
    ├── about.tsx          # /about
    ├── users/$userId.tsx  # /users/$userId
    └── posts/index.tsx    # /posts
```

当项目存在 `src/pages`，且项目没有声明显式的 `app`、`pages` 或 `remote`
配置时，SPA 路由会自动启用。也可以显式配置：

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
    dir: "./src/pages",
    mount: "#app",
  },
});
```

MPA 使用相同的页面文件，只需要切换输出模式：

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "mpa",
  },
});
```

MPA 模式下，每个发现到的页面都会生成独立 HTML 文档和客户端 entry，不会引入
TanStack Router。

## 页面

每个页面模块默认导出 React 组件。页面逻辑需要当前 route 参数、search 参数或
loader data 时，使用 page hooks；用户代码不需要创建 route object、route tree
或 router 注册。

```tsx
// src/pages/users/$userId.tsx
import { usePageParams, useQuery } from "@evjs/client";
import { getUser } from "../../api/users.server";

export default function UserPage() {
  const { userId } = usePageParams();
  const { data: user } = useQuery(getUser, userId);
  if (!user) return null;
  return <h1>{user.name}</h1>;
}
```

SPA 模式下，页面模块可以导出与页面逻辑相关的 TanStack route options，例如
`loader`、`beforeLoad`、`validateSearch`、`pendingComponent`、`errorComponent`
和 `notFoundComponent`。evjs 会把这些导出挂到内部生成的 route 上。MPA 模式不处理
这些 router options，页面按普通 React 组件和数据逻辑编写。

```tsx
// src/pages/search.tsx
import { usePageSearch } from "@evjs/client";

export const validateSearch = (search: Record<string, unknown>) => ({
  q: typeof search.q === "string" ? search.q : "",
});

export default function SearchPage() {
  const search = usePageSearch();
  const q = typeof search.q === "string" ? search.q : "";
  return <h1>Search: {q}</h1>;
}
```

## 布局

SPA 模式下，`src/layout.tsx` 是可选根布局。默认导出会以 `children`
包裹当前页面，因此用户代码不需要引入 TanStack Router 的 `<Outlet />`。

`src/pages` 只放页面路由。不要把根布局放在 `src/pages/layout.tsx`；evjs 会把它
报告为目录约定错误，而不是把它转换成一个页面路由。

```tsx
// src/layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
      </nav>
      {children}
    </main>
  );
}
```

## 导航

页面内可以使用普通 `<a>`，也可以使用 `@evjs/client` 的 `Link`。

```tsx
import { Link } from "@evjs/client";

export default function HomePage() {
  return (
    <Link to="/users/$userId" params={{ userId: "1" }}>
      Open user
    </Link>
  );
}
```

## 渲染元信息

页面模块仍然负责声明自身渲染元信息：

```tsx
export const render = "ssr";
export const hydrate = "load";
export const prerender = { partial: true } as const;

export default function CampaignPage() {
  return <main>Campaign</main>;
}
```

构建图会从页面模块读取这些元信息，并关联到发现到的文件路由。
