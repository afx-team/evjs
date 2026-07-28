# 客户端路由

客户端路由只有一种 canonical Page-and-Route 模型：

- `src/pages/**/page.*` 是正向 Page 与 Route 锚点；
- 所在目录就是 Page 私有 scope；
- 目录 segment 决定 URL；
- `routing.mode` 为同一语义 Page/Route 树选择 SPA 或 MPA 物化方式。

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

```text
src/pages/
├── page.tsx                         # /
├── page.config.ts                  # / 的可选构建期配置
├── users/
│   ├── page.tsx                     # /users
│   └── $userId/
│       ├── page.tsx                 # /users/:userId
│       └── components/
│           └── Profile.tsx          # Page 私有代码
└── (account)/
    └── settings/
        └── page.tsx                 # /settings
```

这棵树之外没有第二份 route map 需要同步。

## Pages

canonical Page：

- 是一个 `page.{ts,tsx,js,jsx}` 模块；
- 默认导出组件；
- 持有完整所在目录作为私有源码 scope；
- 由相对 `routing.dir` 的目录获得语义身份与 URL。

```tsx
// src/pages/users/$userId/page.tsx
import { usePageParams } from "@evjs/ev/route";
import { useQuery } from "@evjs/ev/query";
import { getUser } from "./get-user.server";

export default function UserDetailPage() {
  const { userId } = usePageParams();
  const { data: user } = useQuery(getUser, userId);

  if (!user) return null;
  return <h1>{user.name}</h1>;
}
```

Page component 不接收框架 `params`、`search` 或 `loaderData` props。SPA Page
使用 Page hooks：

```tsx
import {
  usePageLoaderData,
  usePageParams,
  usePageSearch,
} from "@evjs/ev/route";
```

Search 初始类型是 `Record<string, string>`。需要 number、boolean 或结构化值时，
在 `validateSearch` 中显式转换。

```tsx
export const validateSearch = (search: Record<string, string>) => ({
  tab: typeof search.tab === "string" ? search.tab : "overview",
});

export async function loader() {
  return { title: "User" };
}

export default function UserDetailPage() {
  const params = usePageParams();
  const search = usePageSearch();
  const data = usePageLoaderData();
  return (
    <h1>
      {data.title}: {params.userId} ({search.tab})
    </h1>
  );
}
```

CSR SPA Page 可导出受支持的 route lifecycle，如 `loader`、`beforeLoad`、
`validateSearch`、`pendingComponent`、`errorComponent` 和
`notFoundComponent`。这些 hook 当前只在浏览器 route tree 中执行；在框架定义
对等的服务端 route lifecycle 与首屏数据传输前，SSR 和 SSG Page 会拒绝这些
export。MPA 不运行浏览器 route tree，因此这些 lifecycle 不是 MPA
data-loading 模型。

## 目录路由树

目录嵌套就是路由嵌套。Segment 语法保持精简：

| 目录 segment | 路由含义 |
| --- | --- |
| `users` | 静态 `users` 段。 |
| `$userId` | 动态 `:userId` 段。 |
| `$...splat` | 终止 catch-all。 |
| `(account)` | 无路径组织分组。 |

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

没有 `page.*` 的目录可以只组织后代，本身不创建 Page。构建会拒绝非法
segment、非终止 splat、重复的归一化路径、动态 shape 歧义和生成 route id
冲突。

### 带子路由的 Page

在 SPA mode 下，父 Page 可以渲染嵌套路由：

```tsx
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

## Page 私有代码

Page 目录中的一切都属于该 Page，除非后代目录拥有另一个 `page.*`：

```text
src/pages/orders/$orderId/
├── page.tsx
├── page.config.ts
├── index.ts
├── model.ts
├── get-order.server.ts
├── components/
│   └── Summary.tsx
└── __tests__/
    └── page.test.tsx
```

只有 `page.*` 创建 Page 与 Route。`index.*`、组件、hook、model、service、
style、测试和 asset 都是普通 Page 私有源码，因此不需要 `_` 前缀。私有 scope
是 ownership/discovery 边界，不是 JavaScript 访问控制。

## Layout 与 Boundary

SPA route composition 可以使用路由树旁边的文件切面：

```text
src/pages/
├── layout.tsx
├── error.tsx
├── not-found.tsx
└── admin/
    ├── layout.tsx
    ├── page.tsx
    └── settings/
        └── page.tsx
```

Layout 在 SPA 与 MPA materialization 中都会包裹后代；error 与 not-found
切面定义 SPA router boundary。在具备明确 Document contract 前，MPA 会拒绝
这些 router-only facet，而不是静默忽略。

## 导航

使用普通 anchor 或公开 navigation helper：

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

`src/route-types.d.ts` 在生成时属于生成物。保持 ignore，不要从应用源码 import，
也不要复制到模板。

## SPA 与 MPA

`routing.mode` 改变物化方式，不改变 Page 或 Route 语义。

### SPA

```ts
export default defineConfig({
  routing: { mode: "spa" },
});
```

SPA 把目录树物化为浏览器 Client Route，通常共享一个 Application-owned HTML
Document。它支持嵌套路由、动态参数、splat、layout、boundary 与浏览器导航。
每个静态 SSG Page 还会按语义 route path 输出 HTML：`/` 对应
`index.html`，`/report` 对应 `report/index.html`。

### MPA

```ts
export default defineConfig({
  routing: { mode: "mpa" },
});
```

MPA 发现相同的 Page 与语义 route pattern，再物化 Page-owned Document，无需
浏览器 router。它当前只接受静态 Page path；`$param`、终止 `$...splat` 与
router-only boundary 会在 graph 校验失败。Layout 在两种 mode 中都会为 Page
组合。`ev inspect` 和 `ev build` 会拒绝不支持的组合，而不是要求应用改用第二套
路由模型。同一 Page 目录的 `index.html` 可以作为该 MPA Page 的 Document 模板。

## Page 配置

可选页面级配置放在锚点旁：

```ts
// src/pages/orders/$orderId/page.config.ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "订单详情",
  meta: {
    description: "查看单个订单详情。",
    keywords: "订单,详情",
    viewport: "width=device-width, initial-scale=1",
    "theme-color": "#ffffff",
  },
  render: "csr",
  extensions: {
    "@company/analytics": {
      channel: "orders",
    },
  },
});
```

该 module 在构建期同步求值，必须 default-export static JSON data。Core 持有
`title`、named `meta`、`render`、`hydrate`、`prerender` 与 `rsc`。`meta`
接受字符串 key/value，并且只生成 `<meta name="key" content="value">`；
`property`、`charset`、link、script、动态元信息和通用 head DSL 不属于该
contract。插件值放在已注册 namespaced `extensions` key 下。

求值后的配置在 SPA 与 MPA 中附着到同一个 normalized Page identity。在 SPA
mode 下，最深层 active Page 持有 title/meta，不继承父 Page metadata。route
切换会恢复 HTML 模板 baseline，或清除下一个 Page 未声明的值，避免 Page 间
元信息残留。需要 runtime extension data 的插件仍须显式生成并挂载最小
projection。

Page component 不读取 literal `render`、`hydrate`、`prerender` 或 `rsc`
export；这些 setting 统一写在 `page.config.ts`。参见[构建](./build)。

## 显式 SPA route tree

`application.routes` 可以把显式 SPA route tree 归一化到 CoreGraph。它支持：

- 嵌套 `routes`、`component`、layout、wrapper 与 redirect；
- `name`、`icon`、`title`、`hideInMenu`、`flatMenu`、`spmBPos`、`access`、
  `menuKey` 与静态 `menuAssetOptions` 等受支持的 access/menu metadata；
- 每条 Route 的 namespaced `extensions`，以及 Application-owned Document 配置。

`children`、`exact: false` 以及带嵌套路由的 `exact: true` 会被拒绝；
`exact: true` 只作为 terminal-match 结构断言，不会复制到 graph。该配置自身表示
SPA，不能与 `routing` 同时声明，也不能选择 MPA 物化。它会 normalize 到与
canonical Page tree 相同的 CoreGraph，而不是定义另一套路由架构。

要改用 canonical Page tree，应把每个发布 entry 移到其 URL 对应目录并命名为
`page.*`，把页面级配置写入 `page.config.ts`，让 Page 私有代码与锚点 colocate，
然后只声明 `routing.mode`。无关的 `src/pages` 目录不会发布路由，除非启用
canonical routing。
