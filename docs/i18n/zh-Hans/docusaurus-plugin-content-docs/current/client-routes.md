# 客户端路由

evjs 以 `src/pages` 作为客户端路由的唯一事实来源。应用页面写在
页面文件中；框架会发现这些文件，并按配置生成一个 evjs 管理的 SPA，
或生成多个不带路由器的 MPA 页面。evjs 不会写入临时 runtime 路由文件；SPA
模式只会生成类似 `src/route-types.d.ts` 的类型声明，让 TypeScript 从页面树推导导航 path。

完整文件名、忽略文件和 layout 规则见
[文件约定](./file-conventions)。

## 目录结构

```
src/
├── apis/*.server.ts       # 可选就近放置的 server functions
├── layout/
│   └── index.tsx          # 可选 SPA 根布局
└── pages/
    ├── error.tsx           # 可选根 SPA error boundary
    ├── not-found.tsx       # 可选根 SPA not-found boundary
    ├── index.tsx          # /
    ├── (marketing)/
    │   └── about.tsx      # /about
    ├── users/$userId.tsx  # /users/$userId
    └── posts/
        ├── layout.tsx     # 嵌套 SPA route layout
        └── index.tsx      # /posts
```

页面路由约定故意保持收敛：

- 动态路由段使用 `$param` 文件名，例如 `$userId.tsx` 或 `$team_id.tsx`。
- `[id].tsx` 和 `[...slug].tsx` 这类 bracket 段会被拒绝。
- catch-all 和可选文件段暂不属于页面路由约定，因此 `$...slug.tsx`、
  `$slug?.tsx` 和 `$.tsx` 都会被拒绝。
- 动态参数名必须是 `$` 后面的 JavaScript 标识符。
- `$__proto__.tsx`、`$constructor.tsx`、`$prototype.tsx` 和 `$_splat.tsx`
  这类保留名称会被拒绝。`$_splat.tsx` 被保留，是因为 wildcard 路由会把 `*`
  暴露为 `_splat`。
- 静态路由段必须小写，并且只能使用 URL-safe 字符：小写字母、数字、`.`、`_`、`-`
  或 `~`。

如果文件需要映射到自定义或大小写敏感 path，请使用显式 `pages` 配置。

冲突检查也保持严格：

- 同一个 route path 不能重复动态参数名，所以
  `teams/$teamId/users/$teamId.tsx` 会被拒绝。
- 只有参数名不同的同级动态路由会被拒绝。`users/$id.tsx` 和
  `users/$userId.tsx` 都匹配 `/users/:param`，请保留一个统一参数名，或使用显式
  `pages` 配置。
- 生成的 route id 必须唯一。evjs 会从 URL path 派生 route id，并把分隔符和标点
  归一化为下划线，因此 `src/pages/admin/panel.tsx` 和
  `src/pages/admin_panel.tsx` 会被同时拒绝，因为它们都会生成 `admin_panel`。

Route group 只用于组织文件：

- `(marketing)/about.tsx` 映射为 `/about`。
- `(marketing)` 不会增加 URL segment。
- `(marketing` 这类不完整 group segment 会被拒绝。
- 如果分组名应该出现在浏览器路径中，请使用 `marketing/about.tsx` 这样的真实路径段。

路由发现会把 `.tsx`、`.jsx`、`.ts` 和 `.js` 文件视为可能的页面模块。以下文件会被忽略：

- 声明文件（`.d.ts`）；
- 测试文件（`*.test.*` 和 `*.spec.*`）；
- Storybook 文件（`*.story.*` 和 `*.stories.*`）；
- `*.client.*` 客户端专用模块；
- `*.server.*` 服务端专用模块；
- 隐藏 dot 文件和目录；
- 没有源码扩展名的文件；
- 路由段以 `_` 开头的文件或目录。

页面局部组件、helper 或暂不暴露为 URL 的草稿页面，应该放进 `_` 前缀文件或目录。

SPA 和 MPA 模式使用相同的确定性路由顺序：

- `/` 最先。
- 父路由排在子路由之前。
- 同级静态路由排在动态路由之前，因此 `src/pages/users/settings.tsx` 会排在
  `src/pages/users/$id.tsx` 之前。

evjs 在生成构建产物前会使用同样的归一化规则。重复的 path、动态 URL shape 和
route id 都会被拒绝。

`routing.routes` 不是公开的 `defineConfig()` 字段；应用应使用 `src/pages`
发现或显式 `pages` 配置。运行时路由匹配也会按 specificity 选择结果，因此精确/静态路由会优先于
动态路由。

每个被发现的页面文件都必须默认导出 React 组件。Layout route 文件可以默认导出一层外框组件；
如果没有默认导出，它会作为 pathless outlet route 工作。语法错误和默认导出错误会在
路由发现阶段、bundler 运行前报告。

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
导出 `render = "ssg"` 的文件路由会在 `ev build` 期间渲染成独立 static HTML
document；默认不创建 browser page entry。MPA 不会引入客户端路由器配置。文件路由可以通过旁边同 basename
的 `.html` 文件使用页面专属 HTML 模板，例如 `src/pages/about.tsx` 对应 `src/pages/about.html`，
`src/pages/product/index.tsx` 对应 `src/pages/product/index.html`；没有 colocated
模板的路由默认使用全局 `index.html` 模板。

## 页面

每个页面模块默认导出 React 组件。页面逻辑需要当前 route 参数、search 参数或
loader data 时，使用 page hooks；生成的路由胶水由 evjs 管理。

```tsx
// src/pages/users/$userId.tsx
import { usePageParams, useQuery } from "@evjs/ev/page";
import { getUser } from "../../apis/users.server";

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
显式 `pages` 配置可以使用 `:param` 段。空参数名、保留对象属性名和重复参数名都会被拒绝。

SPA 模式下，页面模块可以导出与页面逻辑相关的页面生命周期，例如
`loader`、`beforeLoad`、`validateSearch`、`pendingComponent`、`errorComponent`
和 `notFoundComponent`。evjs 会把这些导出挂到 evjs 管理的 route 上。MPA 模式不处理
这些生命周期，页面按普通 React 组件和数据逻辑编写。

SPA 模式还会识别专用 route convention 模块：

- `error.*` 和 `not-found.*` 模块默认导出对应路由目录作用域及后代路由的 fallback
  组件。
- MPA 模式下，`error.*` 和 `not-found.*` 这些文件名仍然是普通页面路由。

```tsx
// src/pages/search.tsx
import { usePageSearch } from "@evjs/ev/page";

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

SPA 模式下，外部根布局是可选文件。自动发现只有一个文件约定：
路由目录旁边的 `layout/index.tsx`。默认 `src/pages` 使用
`src/layout/index.tsx`；自定义 `routing.dir: "./src/app/pages"` 使用
`src/app/layout/index.tsx`。默认导出会以 `children` 包裹整个生成路由树，因此用户代码不需要在应用根部引入
路由 outlet 组件。

只有当应用 shell 明确放在约定路径之外时，才使用
`routing.conventions.layout: "./src/shell/AppLayout.tsx"`。设置
`routing.conventions.layout: false` 可以让 SPA 不消费任何外部框架根布局。
`src/layout.tsx` 这类根布局别名会被自动发现拒绝。

SPA route layout 也可以放在路由目录内部：

- 使用 `layout.tsx`、`layout.jsx`、`layout.ts` 或 `layout.js`，并放在某个路由段下；
- `src/pages/posts/layout.tsx` 会包裹 `/posts` 下的路由；
- `src/pages/(app)/dashboard/layout.tsx` 会在 `/dashboard` 创建 layout，且不会把 `(app)` 加入 URL。

嵌套 route layout 可以和外部根布局共存。即使 `routing.conventions.layout` 显式指向其他模块，或通过
`routing.conventions.layout: false` 关闭外部根布局发现，这条规则也仍然成立。
`src/pages/layout.tsx` 不是根布局约定；应用 shell 使用 `src/layout/index.tsx`。

Layout 约定只用于 SPA。MPA 模式不接受 `routing.conventions.layout`，也不消费框架 layout；
需要公共视觉包裹时，在各页面里导入普通组件即可。如果只是文档外壳相同，可以复用 HTML 模板。

路由目录中名为 `layout` 的 segment 是保留名，`layout/index.*` 别名会被拒绝。
Layout 局部 helper 应放在 `_` 前缀文件或目录下。`Layout.tsx` 这类大写文件名仍会因为 discovered route 的小写静态段规则被拒绝。

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

页面内可以使用普通 `<a>`，也可以使用 `@evjs/ev/page` 的 `Link`。导航 helper
使用同一套文件路径约定来描述 path 和 params。

默认 `src/pages` 路由目录下，`ev dev` 和 `ev build` 会在 SPA 模式下写入
`src/route-types.d.ts`。自定义 `routing.dir` 时，会在该路由目录的父级写入同名文件。
这个文件只用于增强 `@evjs/ev/page` 中 `Link`、`useLinkProps`、`redirect`
等 helper 使用的 route register；应用代码不需要导入它，
也不需要手写 framework router bootstrap。

该声明文件会保留每个路由的字面量 path，用于导航类型推导。保持忽略这个生成文件，
让 evjs 自动更新它。

确保生成的声明文件在 `tsconfig.json` 的 `include` 范围内。默认
`include: ["src"]` 适用于 `src/pages`，也适用于 `src/app/pages` 这类
`src` 下的自定义目录。如果页面路由放在 `src` 外部，需要把该路由目录的父级也加入
`include`。

```tsx
import { Link } from "@evjs/ev/page";

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

evjs 会在构建时读取这些元信息。`render` 和 `hydrate` 必须是字符串字面量，
`prerender` 必须是 `true`，或包含 `partial`、`delivery`、`revalidate`
的对象字面量；`prerender.revalidate` 必须是 `false` 或表示秒数的正整数；
`rsc` 必须是布尔字面量。Full prerendering（`prerender = true` 或非 partial
prerender 对象）必须声明 `render = "ssg"` 或 `render = "ssr"`；partial
prerendering 必须声明 `render = "ssr"`。

只有 RSC 页面才使用 `export const rsc = true`，且这类页面也必须声明
`render = "ssr"`，并省略 `hydrate` 或声明 `hydrate = "none"`。RSC 页面暂不能同时使用
partial prerendering；请为一个 route 选择一种渲染模型，或拆分成多个 route。`rsc = false`
没有效果，并会产生 warning；除非要用 `true` 启用 RSC，否则请删除它。每个 metadata
名称只能导出一次；重复的 `render`、`hydrate`、`prerender` 或 `rsc` 导出会被拒绝，
而不是按源码顺序取最后一个值。
