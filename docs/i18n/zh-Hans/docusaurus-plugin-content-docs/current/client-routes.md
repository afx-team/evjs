# 客户端路由

evjs 以 `src/pages` 作为客户端路由的唯一事实来源。应用页面写在
页面文件中；框架会发现这些文件，并按配置生成一个框架托管的 SPA，
或生成多个不带路由器的 MPA 页面。evjs 不会写入 `.evjs` 临时路由文件。

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

动态路由段使用 `$param` 文件名。`[id].tsx` 或 `[...slug].tsx` 这类
bracket 段会被拒绝，避免目录约定出现多套写法。

路由段以 `_` 开头的文件或目录只作为 `src/pages` 内部私有模块，不会被发现为路由。
可以用它们放页面局部组件、helper 或暂不暴露为 URL 的草稿页面。

每个被发现的路由文件都必须默认导出 React 组件。如果 `src/pages` 下的模块不是页面，
请放进 `_` 前缀文件/目录，或移到 `src/pages` 外部。语法错误和默认导出错误会在
路由发现阶段、bundler 运行前报告。

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
客户端路由器配置。

## 页面

每个页面模块默认导出 React 组件。页面逻辑需要当前 route 参数、search 参数或
loader data 时，使用 page hooks；生成的路由胶水由框架托管。

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

SPA 和 MPA 模式都会把同一份 `params`、`search` 和 `loaderData` 作为 props
传给页面组件。页面代码推荐使用 hooks，这样通常不需要额外写 props 类型。

SPA 模式下，页面模块可以导出与页面逻辑相关的页面生命周期，例如
`loader`、`beforeLoad`、`validateSearch`、`pendingComponent`、`errorComponent`
和 `notFoundComponent`。evjs 会把这些导出挂到框架托管的 route 上。MPA 模式不处理
这些生命周期，页面按普通 React 组件和数据逻辑编写。

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
包裹当前页面，因此用户代码不需要引入路由 outlet 组件。

布局约定只用于 SPA，且只有一个根文件：`src/layout.tsx`。`src/layout/index.tsx`
不是别名。MPA 模式不消费框架 layout 文件；需要公共视觉包裹时，在各页面里导入普通组件即可。

`src/pages` 只放页面路由。不要在 `src/pages` 的任何位置放 `layout.tsx`；evjs 会把它
报告为目录约定错误，而不是把它转换成一个页面路由。嵌套视觉包裹应作为普通组件由需要的页面导入。

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

页面内可以使用普通 `<a>`，也可以使用 `@evjs/client` 的 `Link`。导航 helper
使用同一套文件路径约定来描述 path 和 params。

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
