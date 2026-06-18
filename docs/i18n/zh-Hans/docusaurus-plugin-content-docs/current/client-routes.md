# 客户端路由

evjs 以 `src/pages` 作为客户端路由的唯一事实来源。应用页面写在
页面文件中；框架会发现这些文件，并按配置生成一个框架托管的 SPA，
或生成多个不带路由器的 MPA 页面。evjs 不会写入临时 runtime 路由文件；SPA
模式只会生成类似 `src/evjs-route-types.d.ts` 的类型声明，让 TypeScript 从页面树推导导航 path。

## 目录结构

```
src/
├── api/*.server.ts        # 可选 server functions
├── layout/
│   └── index.tsx          # 可选 SPA 根布局
└── pages/
    ├── index.tsx          # /
    ├── about.tsx          # /about
    ├── users/$userId.tsx  # /users/$userId
    └── posts/index.tsx    # /posts
```

动态路由段使用 `$param` 文件名。`[id].tsx` 或 `[...slug].tsx` 这类
bracket 段会被拒绝，避免目录约定出现多套写法。catch-all 和可选段暂不属于
页面路由约定，因此 `$...slug.tsx`、`$slug?.tsx` 和 `$.tsx` 也会被拒绝。
动态参数名必须是 `$` 后面的 JavaScript 标识符，例如 `$userId.tsx` 或
`$team_id.tsx`，但 `$__proto__.tsx`、`$constructor.tsx`、`$prototype.tsx`
这类保留对象属性名会被拒绝。`$_splat.tsx` 也会被拒绝，因为 wildcard 路由会把
`*` 暴露为 `_splat`。静态路由段必须小写，并且只能使用 URL-safe 字符：小写字母、
数字、`.`、`_`、`-` 或 `~`；如果文件需要映射到自定义或大小写敏感 path，请使用显式
`pages` 配置。同一个 route path 也不能重复动态参数名，例如
`teams/$teamId/users/$teamId.tsx` 会被拒绝。
只有参数名不同的同级动态路由也会被拒绝：`users/$id.tsx` 和
`users/$userId.tsx` 都匹配 `/users/:param`，请保留一个统一参数名，或使用显式
`pages` 配置。

`(marketing)/about.tsx` 这类 route group 段不受支持；如果它应该成为 URL，
请使用 `marketing/about.tsx` 这样的真实路径段。如果文件需要映射到不符合目录
形状的 URL，请使用显式 `pages` 配置。

路由发现会把 `.tsx`、`.jsx`、`.ts` 和 `.js` 文件视为可能的页面模块。
声明文件（`.d.ts`）、测试文件（`*.test.*` 和 `*.spec.*`）、隐藏 dot 文件/目录、
Storybook 文件（`*.story.*` 和 `*.stories.*`）、`*.client.*` 客户端专用模块、
`*.server.*` 服务端专用模块，以及没有这些源码扩展名的文件会被忽略。

路由段以 `_` 开头的文件或目录只作为 `src/pages` 内部私有模块。它们可以使用源码扩展名，
但不会被发现为 URL 路由。可以用它们放页面局部组件、helper 或暂不暴露为 URL 的草稿页面。

SPA 和 MPA 模式使用相同的确定性路由顺序：`/` 最先，父路由排在子路由之前，
同级静态路由排在动态路由之前。例如 `src/pages/users/settings.tsx` 会排在
`src/pages/users/$id.tsx` 之前。graph 和 build plan 使用的 resolved route list
也按同样规则归一化；重复的 path、动态 URL shape 或 route id 也会在这里被拒绝。
`routing.routes` 不是公开的 `defineConfig()` 字段；应用应使用 `src/pages`
发现或显式 `pages` 配置。运行时路由匹配也会按 specificity 选择结果，因此精确/静态路由会优先于
动态或 wildcard 路由，即使外部 manifest 尚未排序。

生成的 route id 必须唯一。evjs 会从 URL path 派生 route id，并把分隔符和标点
归一化为下划线，因此 `src/pages/admin/panel.tsx` 和
`src/pages/admin_panel.tsx` 会被同时拒绝，因为它们都会生成 `admin_panel`。
server-rendered route-derived page id 也使用同样规则。生成的 id 冲突时，请重命名其中一个
route 文件，或改用显式 `pages` 配置并提供唯一 page id。

每个被发现的路由文件都必须默认导出 React 组件。如果 `src/pages` 下的模块不是页面，
请放进 `_` 前缀文件/目录、对客户端专用代码使用 `*.client.*` 命名、对服务端专用代码使用
`*.server.*` 命名，或移到 `src/pages` 外部。语法错误和默认导出错误会在路由发现阶段、
bundler 运行前报告。

当项目存在 `src/pages`，且项目没有声明显式的 `app` 或 `pages`
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

MPA 模式下，每个发现到的 CSR 页面都会生成独立 HTML 文档和客户端 entry。
导出 `render = "ssg"` 的文件路由会输出独立 static HTML document，并获得用于
static generation 的 server renderer；默认不创建 browser page entry。MPA 不会引入
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

SPA 和 MPA 模式都使用 page hooks 读取路由数据。这样页面模块不需要引入框架
wrapper 类型，也不需要额外写 props 注解。evjs 不会把 `params`、`search`
或 `loaderData` 作为页面组件 props 传入。文件路由从 `$param` 段派生参数；
底层显式 manifest route 也可以使用 `:param` 段，wildcard `*` 段会暴露为
`_splat`。空参数名、保留对象属性名、显式 `:_splat` 参数和重复参数名在这里同样会被拒绝。
一个 route path 最多只能包含一个 wildcard 段，因为 hooks 只会暴露一个 `_splat` 值。
同一套 hooks 会暴露这些参数名。

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

SPA 模式下，根布局是可选文件。它放在路由目录旁边：默认 `src/pages`
使用 `src/layout/index.tsx`，自定义 `routing.dir` 为 `src/app/pages` 时使用
`src/app/layout/index.tsx`。默认导出会以 `children` 包裹当前页面，因此用户代码不需要引入
路由 outlet 组件。

如果迁移应用的共享外框在其他位置，可以通过
`routing.layout: "./src/shell/AppLayout.tsx"` 显式指定。`layout/index.jsx`
或 `layout/index.js` 这类非 TSX 布局模块也应这样配置；自动发现约定仍然只认
`layout/index.tsx`。设置 `routing.layout: false` 可以让 SPA 不消费任何框架根布局。

布局约定只用于 SPA，且路由目录旁边只有一个根目录入口：必须使用精确路径
`layout/index.tsx`。`layout.tsx`、`layout.jsx`、`layout.ts` 和非 TSX 的
`layout/index.*` 都不是别名。MPA 模式不接受也不消费框架 layout 文件；需要公共视觉包裹时，
在各页面里导入普通组件即可。如果只是文档外壳相同，可以复用 HTML 模板。

路由目录只放页面路由。不要在其中任何位置放名为 `layout` 的文件或目录；evjs 会把它报告为目录约定错误，
而不是把它转换成页面路由。这个保留段是精确且大小写敏感的，但 `Layout.tsx`
这类大写文件名仍会因为 discovered route 的小写静态段规则被拒绝。嵌套视觉包裹应作为普通组件由需要的页面导入。
即使 `routing.layout` 显式指向其他模块，或通过 `routing.layout: false` / MPA
模式关闭 layout discovery，这条规则也仍然成立。

```tsx
// src/layout/index.tsx
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

默认 `src/pages` 路由目录下，`ev dev` 和 `ev build` 会在 SPA 模式下写入
`src/evjs-route-types.d.ts`。自定义 `routing.dir` 时，会在该路由目录的父级写入同名文件。
这个文件只用于增强 `@evjs/client` 中 `Link`、`useLinkProps`、`redirect`
等 helper 使用的底层 `@evjs/client` route register；应用代码不需要导入它，
也不需要手写 framework router bootstrap。

生成文件会从 `@evjs/client/internal/route-types` 导入类型 helper。
这是生成专用的 internal subpath；不要在应用源码中导入这个 internal helper。

该声明文件会保留每个路由的字面量 ID 和 path，用于导航类型推导。内部生成的
TypeScript 标识符会自动去重，因此 `admin-panel` 和 `admin_panel` 这类合法
route id 不会生成非法或重复的声明。

确保生成的声明文件在 `tsconfig.json` 的 `include` 范围内。默认
`include: ["src"]` 适用于 `src/pages`，也适用于 `src/app/pages` 这类
`src` 下的自定义目录。如果页面路由放在 `src` 外部，需要把该路由目录的父级也加入
`include`。

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

构建图会从页面模块读取这些元信息，并关联到发现到的文件路由。`render` 和
`hydrate` 必须是字符串字面量，`prerender` 必须是 `true`，或包含 `partial`、
`delivery`、`revalidate` 的对象字面量；`prerender.revalidate` 必须是 `false`
或表示秒数的正整数；`rsc` 必须是布尔字面量。Full prerendering（`prerender = true`
或非 partial prerender 对象）必须声明 `render = "ssg"` 或 `render = "ssr"`；
partial prerendering 必须声明 `render = "ssr"`。

只有 RSC 页面才使用 `export const rsc = true`，且这类页面也必须声明
`render = "ssr"`，并省略 `hydrate` 或声明 `hydrate = "none"`。RSC 页面暂不能同时使用
partial prerendering；请为一个 route 选择一种渲染模型，或拆分成多个 route。`rsc = false`
没有效果，并会产生 warning；除非要用 `true` 启用 RSC，否则请删除它。每个 metadata
名称只能导出一次；重复的 `render`、`hydrate`、`prerender` 或 `rsc` 导出会被拒绝，
而不是按源码顺序取最后一个值。
