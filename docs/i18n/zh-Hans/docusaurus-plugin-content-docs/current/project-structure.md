# 项目目录结构

evjs 应用默认以页面路由作为客户端边界。文档和新应用统一使用一份完整推荐结构；实际项目不需要的目录可以直接删除。

## 推荐结构

```text
my-evjs-app/
├── ev.config.ts                 # 框架配置
├── index.html                   # 共享 HTML 模板，包含 <div id="app">
├── package.json
├── .gitignore                   # 忽略 evjs 生成产物
├── public/                      # 原样复制的静态文件
├── tsconfig.json
└── src/
    ├── styles.css               # 全局 CSS / Tailwind 入口
    ├── middleware.ts            # 全局 server middleware
    ├── layout/
    │   └── index.tsx            # 可选 SPA 根布局
    ├── pages/                   # 页面路由
    │   ├── layout.tsx           # 可选 SPA route layout
    │   ├── index.tsx            # /
    │   ├── (marketing)/
    │   │   └── about.tsx        # /about
    │   ├── dashboard.tsx        # /dashboard
    │   ├── campaign.tsx         # /campaign
    │   ├── insights.tsx         # /insights
    │   └── users/$userId.tsx    # /users/$userId
    ├── api/
    │   └── operators.server.ts  # "use server" functions
    ├── apis/                    # server file routes
    │   ├── middleware.ts        # route-scoped server route middleware
    │   └── api/
    │       └── health.ts        # /api/health server file route
    ├── components/              # 可复用 UI
    ├── features/                # 业务领域模块
    │   └── operations/
    │       ├── components/
    │       ├── hooks/
    │       ├── model.ts
    │       └── types.ts
    ├── lib/                     # 浏览器安全的共享工具
    └── hooks/                   # 全局 React hooks
```

这棵目录覆盖完整框架能力：

- `ev.config.ts` 只在默认值不够时自定义 routing 模式、服务端路径、远程应用、插件或显式页面输出。
- `pages/` 是客户端路由事实来源。SPA 模式会映射到框架托管的 app entry；MPA 模式会映射到独立页面 entry。
- SPA 模式可以有一个可选的外部根布局源码模块。默认 `src/pages` 会在旁边查找
  `src/layout.tsx`、`src/layout.ts`、`src/layout.jsx`、`src/layout.js`，
  或对应的 `src/layout/index.*` 源码模块；自定义 `routing.dir` 时使用该路由目录的父级。
  自动发现的根布局候选只能保留一个，或者通过 `routing.conventions.layout` 指向自定义位置。
  显式布局模块必须使用 `.ts`、`.tsx`、`.js` 或 `.jsx`；声明文件、测试/spec、
  Storybook、client-only 和 server-only 文件都不被接受。设置
  `routing.conventions.layout: false` 可以关闭外部根布局发现。
- `pages/**/layout.*` 和 `pages/**/layout/index.*` 是 SPA route layout。
  它们会在发现到的路由树中创建 pathless layout route，因此
  `src/pages/layout.tsx` 会包裹根级页面路由，`src/pages/posts/layout.tsx`
  会包裹 `/posts` 下的子路由。MPA 页面需要公共外框时，应直接导入普通共享组件，
  或复用 HTML 模板。
- `<routing-dir-parent>/route-types.d.ts` 是 SPA 模式生成的类型安全导航声明。
  默认 `src/pages` 会写入 `src/route-types.d.ts`；`routing.dir:
  "./src/app/pages"` 会写入 `src/app/route-types.d.ts`。MPA 模式会移除旧的生成路由类型文件。
  生成声明使用生成专用的 `@evjs/client/internal/route-types` helper，
  并增强 client runtime 导航类型。保持忽略生成的 route types，不要在应用代码里导入它们。
- 渲染元信息放在页面模块旁边。
- `api/*.server.ts` 放 server functions。
- `api/*.routes.ts` 放标准 HTTP route handlers。
- `server.ts` 组合 `@evjs/server` routes、middleware 和 framework rendering。
- `features/` 把业务逻辑从 route/page files 中移走。

## 约定矩阵

创建文件时优先看这张表。只有少数路径是框架约定，其余只是普通项目组织方式。
完整文件名和作用域规则见 [文件约定](./file-conventions.md)。

快速规则：

- 路由文件放在配置的 `routing.dir` 下，并使用 `.ts`、`.tsx`、`.js` 或
  `.jsx`。
- 目录根路由使用 `index.*`；动态段使用 `$param`；静态段保持小写且
  URL-safe。
- 支持 `(marketing)` 这类 route group 作为 pathless 组织目录，不会增加 URL
  segment。不完整的 group segment 会被拒绝。动态参数名必须是安全标识符；
  保留对象属性名和 `$_splat` 都会被拒绝。
- `_` 前缀文件和目录是私有 helper，不会成为 URL 路由。
- dot 前缀文件/目录、`.d.ts`、test/spec、Storybook、`*.client.*` 和
  `*.server.*` 文件都会被路由目录忽略，因此就近放置的支撑文件不会变成路由。
- SPA 根布局自动发现接受路由目录旁边唯一的 `layout.*` 或 `layout/index.*`
  源码模块。SPA route layout 使用路由目录内的 `layout.*` 或 `layout/index.*`
  模块。自定义外部根布局模块使用 `routing.conventions.layout`。MPA 路由不消费框架 layout。
- 输出无法遵循目录形状时，使用显式 `pages` 配置，而不是手写 `routing.routes`。

迁移规则保持显式，不通过新增文件名方言来兼容：

- 将 `[id].tsx` 这类 bracket dynamic routes 改成 `$id.tsx`。
- `(marketing)/about.tsx` 这类 route group 只用于 pathless 组织；如果分组名应出现在
  URL 中，请使用 `marketing/about.tsx` 这样的真实 URL segment。
- SPA 嵌套布局使用路由目录内的 layout 模块建模。如果某个外框不应该参与路由树，
  则作为普通组件由需要它的页面 import。
- catch-all、optional、大小写敏感或其他自定义 URL shape 使用显式 `pages` 配置。

| 文件或目录 | 框架含义 | 用于 | 不用于 |
| --- | --- | --- | --- |
| `src/pages/**/*.{tsx,jsx,ts,js}` | SPA/MPA 页面路由发现 | 轻量页面组件和可选的字面量渲染元信息 | 共享 helper、测试、bracket route、catch-all route 或手写 SPA router/bootstrap 代码 |
| 页面路由旁同 basename 的 `src/pages/**/*.html` | MPA 页面 HTML 模板 | 页面专属 document 模板，例如 `about.tsx` 旁的 `about.html`，或 `users/index.tsx` 旁的 `users/index.html` | SPA layout、路由模块，或其他路由的模板 |
| `src/pages` 下的 route paths、dynamic URL shapes 和生成的 route ID | graph/build plan 生成前的路由冲突检查 | 每个 URL path 只保留一个页面模块，每个 dynamic URL shape 只保留一种参数命名，并且生成的 route ID 必须唯一 | 并存的 `users.tsx`/`users/index.tsx`、`users/$id.tsx`/`users/$userId.tsx` 或 `admin/panel.tsx`/`admin_panel.tsx` 路由 |
| `src/pages/(group)/**` | Pathless route group | 不增加 URL segment 的页面和 layout 组织目录 | 应出现在浏览器 URL 中的路径段 |
| `src/pages/_*` 和 `src/pages/**/_*` | 忽略的私有路由模块 | 就近放置 helper component、utility、fixture 和页面局部实现细节 | URL 路由、SPA 根布局或生成文件 |
| `src/pages/.*` 和 `src/pages/**/.*` | 忽略的隐藏路由模块 | 本地临时文件或不应参与路由发现的工具元信息 | URL 路由、生成的 route types，或应被页面导入的源码模块 |
| `src/pages/**/*.d.ts`、`src/pages/**/*.{test,spec,story,stories}.*`、`src/pages/**/*.{client,server}.*` | 忽略的路由支撑模块 | 与页面就近放置类型声明、测试、Storybook story、client-only 模块和 server-only 模块 | 路由页面或应该变成 URL 的文件 |
| `<routing-dir-parent>/layout.{tsx,ts,jsx,js}` 或 `<routing-dir-parent>/layout/index.{tsx,ts,jsx,js}` | 可选外部 SPA 根布局 | 包裹已发现 SPA 路由树的一层应用 shell | MPA 公共外框、route-specific 嵌套布局或多个根布局候选 |
| `src/pages/**/layout.{tsx,ts,jsx,js}` 或 `src/pages/**/layout/index.{tsx,ts,jsx,js}` | SPA route layout | 在同一 URL 前缀下包裹子路由的 pathless layout route | MPA 公共外框，或命名为 `layout` 的非 layout helper 目录 |
| `<routing-dir-parent>/route-types.d.ts` | SPA 导航类型生成物 | 编辑器和类型检查支持 | 手工修改、从应用代码导入、放入模板或脚手架源码，或用于 MPA 模式 |
| `src/api/*.server.ts` | 推荐的 server function 边界 | 以 `"use server";` 开头并导出命名 callable server functions 的文件 | 浏览器专用 helper、默认导出或 runtime re-export |
| `src/apis/**/*.{ts,tsx,js,jsx}` | 启用 `server.routing` 时的服务端文件路由发现 | 导出大写 HTTP method 的 Request/Response route 模块 | `route.ts` 哨兵、`foo.get.ts` method suffix 文件、bracket/catch-all/optional routes、`middleware`/`middlewares`、默认导出，或从 route candidate 导出 helper |
| `src/middleware.{ts,tsx,js,jsx}` | 启用 server conventions 时的全局服务端中间件约定 | 在 server file routes、server functions、SSR、PPR 和 RSC 之前运行的 Hono-compatible middleware | Matcher 配置、route handlers 或 helper exports |
| `src/apis/**/middleware.{ts,tsx,js,jsx}` | route-scoped server file-route middleware | 作用于该目录树下 descendant server file routes 的 Hono-compatible middleware | `api.ts` 这类 flat sibling routes、全局 server functions/SSR middleware，或 matcher 配置 |
| `src/apis` 下的 server route paths 和 dynamic URL shapes | graph/build plan 生成前的 server route 冲突检查 | 每个 URL path 只保留一个 server route module，每个 dynamic URL shape 只保留一种参数命名 | 并存的 `users.ts`/`users/index.ts`、`users/$id.ts`/`users/$userId.ts`，或把同一路径的方法拆到多个文件 |
| `src/features`、`src/components`、`src/lib`、`src/hooks` | 没有直接框架约定 | 业务代码、可复用 UI、浏览器安全 helper 和 React hooks | 依赖文件名被路由发现的文件 |

除非确实需要更底层 API，否则不要在一个应用中混用多套路由所有权模型：

- 普通 SPA/MPA 页面路由使用 `src/pages` 加 `routing`。
- 只有输出无法用 `src/pages` 表达时，才使用显式 `pages` 配置。
- 只有手工启动的单浏览器应用才使用 top-level `entry`/`html`。

## 对应配置

对应的 `ev.config.ts` 可以保持很小：

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
    dir: "./src/pages",
    mount: "#app",
  },

  server: {
    routing: true,
    rsc: true,
  },
});
```

当每个路由都应该输出独立 HTML 文档且不需要客户端路由器配置时，使用
`routing: { mode: "mpa" }`；这种模式不使用框架 layout。MPA 路由可以用同
basename 的 colocated 模板替代全局 `index.html` 模板，例如
`src/pages/product/index.tsx` 对应 `src/pages/product/index.html`。只有页面输出无法
自然映射到 `src/pages` 时，才使用更底层的 `pages` 配置。

## 页面模块

`src/pages` 下每个被发现的文件都默认导出一个 React 组件。动态段使用 `$param`，
`index.tsx` 映射到当前目录根路径。`[id].tsx` 这类 bracket 路由段会被拒绝。
`$...slug.tsx` 或 `$slug?.tsx` 这类 catch-all 和可选段暂不属于约定。
动态参数名必须是 `$` 后面的 JavaScript 标识符；静态路由段必须小写，并且只能使用
URL-safe 小写字母、数字、`.`、`_`、`-` 或 `~`。`$__proto__.tsx`、
`$constructor.tsx`、`$prototype.tsx` 这类保留对象属性名也会被拒绝。`$_splat.tsx`
也会被拒绝，因为 wildcard 路由会把 `*` 暴露为 `_splat`。只有参数名不同的同级动态路由也不允许共存；
同一个 URL shape 应在 `$id.tsx` 和 `$userId.tsx` 中选择一个。同一个 route path
也不能重复动态参数名，所以 `teams/$teamId/users/$teamId.tsx` 会被拒绝。
扁平路由文件和目录 `index` 路由文件不能声明同一个 URL path，因此 `/users`
应在 `users.tsx` 和 `users/index.tsx` 中选择一种。`(marketing)`
这类 route group 段是 pathless 组织目录，因此 `src/pages/(marketing)/about.tsx`
会映射到 `/about`；`(marketing` 这类不完整 group segment 会被拒绝。路由发现会考虑
`.tsx`、`.jsx`、`.ts` 和 `.js` 文件，但会忽略声明文件、测试/spec 文件、隐藏 dot 路径、
`*.client.*` 客户端专用模块、`*.server.*` 服务端专用模块、非源码文件，以及 `_`
前缀的私有路由段；Storybook 的 `*.story.*` / `*.stories.*` 文件也不会成为路由。
非路由 helper 应放在 `_` 前缀文件/目录中，或移到 `src/pages` 外部。SPA 和 MPA 使用同一套确定性顺序：`/` 最先，父路由排在子路由之前，
同级静态路由排在动态路由之前，因此 `users/settings.tsx` 会排在
`users/$id.tsx` 之前。同级静态路由使用与 locale 无关的 code-point 顺序，因此
`a-b.tsx`、`a.b.tsx`、`a0.tsx`、`a_c.tsx`、`aa.tsx`、`a~d.tsx`
在任何机器上都保持这个顺序。路由示例和配置应使用 `/` 分隔符；文件系统里的 `\`
分隔符会在路由解析前归一化，因此不同操作系统上的路径和生成 route id 保持一致。
graph 和 build plan 使用的 resolved route list 也遵循同样规则；重复的 path、
动态 URL shape 或 route id，以及空动态参数、保留动态参数、重复动态参数、显式
`:_splat` 参数、包含空白、query string 或 hash 的路径也会在这里被拒绝。
显式 wildcard 路由最多只能包含一个 `*` 段，因为页面 hooks 只会暴露一个
`_splat` 值。生成的 route id 也来自 URL path，并把分隔符和标点归一化为下划线，
因此 `admin/panel.tsx` 和 `admin_panel.tsx` 都会生成 `admin_panel`，不能同时存在。
语法错误和默认导出错误会在路由发现阶段、bundler 运行前报告。
渲染元信息放在页面组件旁边：

### 路由文件名示例

| 文件 | 结果 | 说明 |
| --- | --- | --- |
| `src/pages/index.tsx` | `/` | 目录根路由。 |
| `src/pages/docs/index.tsx` | `/docs` | 嵌套目录根路由。 |
| `src/pages/users/$userId.tsx` | `/users/$userId` | 动态段；参数名必须是 JavaScript 标识符。 |
| `src/pages/users/settings.tsx` | `/users/settings` | 静态同级路由；排序早于 `users/$userId.tsx`。 |
| `src/pages/(marketing)/about.tsx` | `/about` | Pathless route group；`(marketing)` 只组织文件，不增加 URL segment。 |
| `src/pages/layout.tsx` | `/` 的 layout route | SPA route layout，会包裹根级发现路由。 |
| `src/pages/_helpers/format.ts` | 忽略 | `_` 前缀文件和目录在 `src/pages` 内是私有模块。 |
| `src/pages/.draft.tsx` | 忽略 | dot 前缀文件和目录不会参与路由发现。 |
| `src/pages/profile.test.tsx` | 忽略 | test/spec 文件可以和页面就近放置，不会成为路由。 |
| `src/pages/profile.stories.tsx` | 忽略 | Storybook 文件不会成为路由页面。 |
| `src/pages/ClientCard.client.tsx` | 忽略 | 客户端专用模块可以为 RSC/client references 就近放置，不会成为 URL 路由。 |
| `src/pages/users.server.ts` | 忽略 | 服务端专用模块不是页面路由；被页面导入的 server functions 仍由 server-function transform 处理。 |
| `src/pages/users/[id].tsx` | 拒绝 | 不支持 bracket 路由语法；使用 `$id.tsx`。 |
| `src/pages/files/$...path.tsx` | 拒绝 | catch-all 段暂不属于约定。 |
| `src/pages/users/$__proto__.tsx` | 拒绝 | 保留对象属性名不是安全的路由参数名。 |
| `src/pages/docs/$_splat.tsx` | 拒绝 | `_splat` 是 wildcard route params 的保留名称。 |
| `src/pages/teams/$teamId/users/$teamId.tsx` | 拒绝 | 同一个 route path 内的动态参数名必须唯一。 |
| `src/pages/users.tsx` 和 `src/pages/users/index.tsx` 并存 | 拒绝 | 两者都映射到 `/users`；一个 URL path 只保留一个页面模块。 |
| `src/pages/admin_panel.tsx` 和 `src/pages/admin/panel.tsx` 并存 | 拒绝 | 两者都会生成同一个 route id `admin_panel`。 |

```tsx
// src/pages/campaign.tsx
import { Suspense } from "react";
import { OfferRegion } from "./OfferRegion";
import { OfferSkeleton } from "./OfferSkeleton";

export const render = "ssr";
export const hydrate = "none";
export const prerender = {
  partial: true,
  delivery: "stream",
} as const;

export default function Campaign() {
  return (
    <main>
      <Suspense fallback={<OfferSkeleton />}>
        <OfferRegion />
      </Suspense>
    </main>
  );
}
```

页面文件应保持轻量：读取 params/search，导出页面级 loader 或渲染元信息，并从
`features/` 或 `components/` 组合组件。业务逻辑放到领域模块中。渲染元信息只接受
字面量：`render` 和 `hydrate` 是字符串字面量，`prerender` 是 `true` 或包含
`partial`、`delivery`、`revalidate` 的对象字面量；`prerender.revalidate` 是
`false` 或表示秒数的正整数；`rsc` 是 RSC 页面使用的布尔字面量。格式错误的
页面模块会在 graph analysis 阶段报告文件路径和 parser message，再进入 bundler 前即可定位问题；
读取 region metadata 时，experimental 兼容路径中的格式错误 PPR region 模块也会以同样方式报告。

## 服务端边界

默认把 callable server functions 放在 `src/api/` 下，把服务端文件路由放在
`src/apis` 下。

```ts
// src/api/operators.server.ts
"use server";

export async function listOperators() {
  return [{ id: "ada", name: "Ada Lovelace" }];
}
```

```ts
// src/apis/api/health.ts
export const GET = async () => Response.json({ ok: true });
```

`src/apis` 下的文件路径就是 URL path，因此上面的例子映射到
`/api/health`。根路由使用 `src/apis/index.ts`；动态段使用
`$param` 文件名，并映射为 Hono params，例如 `:userId`。

服务端 middleware 使用 Hono 的 middleware 签名，并放在专门的 `middleware.ts`
约定文件中：

```ts
// src/middleware.ts
import type { MiddlewareHandler } from "@evjs/server";

const middleware: MiddlewareHandler = async (ctx, next) => {
  await next();
  ctx.header("x-server", "evjs");
};

export default middleware;
```

```ts
// src/apis/api/middleware.ts
import type { MiddlewareHandler } from "@evjs/server";

const middleware: MiddlewareHandler = async (ctx, next) => {
  if (!ctx.req.header("authorization")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await next();
};

export default middleware;
```

```ts
// src/apis/users/$userId.ts
export const GET = async (_req, ctx) => {
  const userId = ctx.req.param("userId");
  return Response.json({ id: userId });
};
```

## 命名建议

- `pages/` 是文件路由目录，也可以包含 SSR/PPR/RSC components。
- `api/` 放 callable server functions 和自定义 route helpers。
- `apis/` 是启用 `server.routing` 时的服务端文件路由目录。
- `middleware.ts` 是全局服务端 middleware；嵌套的
  `apis/**/middleware.ts` 会把 middleware 作用域限制到 descendant file
  routes。
- `features/` 放业务领域模块。
- `components/` 放通用 UI。
- `lib/` 放浏览器安全的共享工具。
- 服务端密钥和 Node-only API 应留在 `api/`、`apis/`，或只被 server-only code 引用的模块中。
