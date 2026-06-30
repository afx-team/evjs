# 项目目录结构

evjs 应用默认以页面路由作为客户端边界。文档和新应用统一使用一份完整推荐结构；实际项目不需要的目录可以直接删除。

## 推荐结构

```text
my-evjs-app/
├── ev.config.ts                 # 框架配置
├── index.html                   # 共享 HTML 模板，包含 <div id="app">
├── package.json
├── .gitignore                   # 忽略 evjs 生成产物
├── tsconfig.json                # 包含 @/* -> ./src/* path alias
├── public/                      # 原样复制的静态文件
└── src/
    ├── styles.css               # 全局 CSS / Tailwind 入口
    ├── middleware.ts            # 全局服务端中间件
    ├── layout/
    │   └── index.tsx            # 可选 SPA 根布局
    ├── pages/                   # 页面路由
    │   ├── error.tsx            # 可选根 SPA error boundary
    │   ├── not-found.tsx        # 可选根 SPA not-found boundary
    │   ├── index.tsx            # /
    │   ├── (marketing)/
    │   │   └── about.tsx        # /about
    │   ├── dashboard/
    │   │   ├── layout.tsx       # 嵌套 SPA 路由布局
    │   │   └── index.tsx        # /dashboard
    │   ├── campaign.tsx         # /campaign
    │   ├── insights.tsx         # /insights
    │   └── users/$userId.tsx    # /users/$userId
    ├── apis/                    # 服务端文件路由
    │   ├── middleware.ts        # API 路由中间件
    │   ├── users.server.ts      # 就近放置的服务端函数
    │   └── api/
    │       └── health.ts        # /api/health 服务端文件路由
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

| 能力面 | 约定 | 说明 |
| --- | --- | --- |
| 配置 | `ev.config.ts` | 只在默认值不够时自定义 routing 模式、服务端路径、插件或显式页面输出。 |
| 导入别名 | `tsconfig.json` `paths["@/*"]` | `@/components/Button` 解析到 `src/components/Button`；evjs 会自动配置 bundler alias，模板会配置 TypeScript 以支持编辑器和类型检查。 |
| 客户端路由 | `src/pages` | SPA 和 MPA 页面路由的事实来源。SPA 模式映射到一个 evjs 管理的 app entry；MPA 模式映射到独立页面 entry。 |
| SPA 根 shell | `<routing-dir-parent>/layout/index.tsx` | 默认 `src/pages` 使用 `src/layout/index.tsx`；`routing.dir: "./src/app/pages"` 使用 `src/app/layout/index.tsx`。只有应用 shell 明确放在自定义位置时才使用 `routing.conventions.layout`；设为 `false` 可关闭根布局发现。 |
| 嵌套 SPA 路由布局 | `src/pages/<segment>/layout.*` | 包裹某个路由段下的后代路由。`src/pages/layout.tsx` 和 `src/pages/<segment>/layout/index.*` 都会被拒绝。MPA 页面需要公共外框时导入普通共享组件或复用 HTML 模板。 |
| SPA route 边界 | `src/pages/**/error.*`、`src/pages/**/not-found.*` | 按目录作用域生效的 SPA error 和 not-found boundaries。MPA 页面会把这些文件名当作普通路由。 |
| 生成路由类型 | `<routing-dir-parent>/route-types.d.ts` | SPA 模式写入类型安全导航声明，例如 `src/route-types.d.ts` 或 `src/app/route-types.d.ts`。保持忽略它们，不要在应用代码里导入。 |
| 页面元信息 | 页面模块的 named exports | 渲染元信息和页面组件放在一起。 |
| 服务端函数 | `"use server";` 加 `*.server.*` 模块 | 服务端函数没有目录约定，可以放在 pages、features 或服务端文件路由旁边。 |
| 服务端文件路由 | `src/apis` | 启用 `server.routing` 后发现的 Request/Response 路由模块。没有 route exports 的文件仍然是普通就近 helper。 |
| 服务端中间件 | `src/middleware.ts`、`src/apis/**/middleware.ts` | 全局服务端中间件包裹服务端运行时请求；API 路由中间件只包裹后代服务端文件路由。 |
| 手工 server 代码 | `server.ts` 等普通文件 | Standalone/manual `@evjs/server` 代码不会作为文件约定发现，也和 `server.routing` 无关。 |
| 业务代码 | `features/`、`components/`、`lib/`、`hooks/` | 把业务逻辑、可复用 UI、浏览器安全 helper 和 React hooks 从 route/page files 中移走。 |

## 约定矩阵

创建文件时优先看这张表。只有少数路径是框架约定，其余只是普通项目组织方式。
完整文件名和作用域规则见 [文件约定](./file-conventions)。

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
- SPA 根布局自动发现只接受路由目录旁边的 `layout/index.tsx`。嵌套 SPA
  route layout 使用路由段下的 `layout.*` 模块。自定义外部根布局模块使用
  `routing.conventions.layout`。MPA 路由不消费框架 layout。
- SPA 模式下保留 `src/pages/error.tsx`、`src/pages/not-found.tsx`，以及
  `src/pages/dashboard/error.tsx` 这类作用域文件；`error.*` 和 `not-found.*`
  按路由目录作用域继承。
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
| `src/pages` 下的 route paths、dynamic URL shapes 和生成的 route ID | 生成构建产物前的路由冲突检查 | 每个 URL path 只保留一个页面模块，每个 dynamic URL shape 只保留一种参数命名，并且生成的 route ID 必须唯一 | 并存的 `users.tsx`/`users/index.tsx`、`users/$id.tsx`/`users/$userId.tsx` 或 `admin/panel.tsx`/`admin_panel.tsx` 路由 |
| `src/pages/(group)/**` | Pathless route group | 不增加 URL segment 的页面和 layout 组织目录 | 应出现在浏览器 URL 中的路径段 |
| `src/pages/_*` 和 `src/pages/**/_*` | 忽略的私有路由模块 | 就近放置 helper component、utility、fixture 和页面局部实现细节 | URL 路由、SPA 根布局或生成文件 |
| `src/pages/.*` 和 `src/pages/**/.*` | 忽略的隐藏路由模块 | 本地临时文件或不应参与路由发现的工具元信息 | URL 路由、生成的 route types，或应被页面导入的源码模块 |
| `src/pages/**/*.d.ts`、`src/pages/**/*.{test,spec,story,stories}.*`、`src/pages/**/*.{client,server}.*` | 忽略的路由支撑模块 | 与页面就近放置类型声明、测试、Storybook story、client-only 模块和 server-only 模块 | 路由页面或应该变成 URL 的文件 |
| `<routing-dir-parent>/layout/index.tsx` | 可选外部 SPA 根布局 | 包裹已发现 SPA 路由树的一层应用 shell | MPA 公共外框、route-specific 嵌套布局、`src/layout.tsx` 这类根布局别名，或 `src/pages/layout.tsx` 这类路由目录根布局 |
| `src/pages/<segment>/**/layout.{tsx,ts,jsx,js}` | 嵌套 SPA route layout | 在同一 URL 前缀下包裹子路由的 pathless layout route，例如 `src/pages/posts/layout.tsx` | 应用根 shell、MPA 公共外框、`src/pages/layout.tsx`、`layout/index.*` 别名，或命名为 `layout` 的非 layout helper 目录 |
| `src/pages/**/error.{ts,tsx,js,jsx}` | 作用域 SPA error boundary | 该路由目录作用域及后代路由发生错误时的 React fallback 组件 | URL 路由、MPA 行为、服务端错误，或 helper 模块 |
| `src/pages/**/not-found.{ts,tsx,js,jsx}` | 作用域 SPA not-found boundary | 该路由目录作用域及后代路由调用 `notFound()` 时的 React fallback 组件 | URL 路由、MPA 行为、服务端 404 响应，或 helper 模块 |
| `<routing-dir-parent>/route-types.d.ts` | SPA 导航类型生成物 | 编辑器和类型检查支持 | 手工修改、从应用代码导入、放入模板或脚手架源码，或用于 MPA 模式 |
| 带 `"use server";` 的 `**/*.server.{ts,tsx,js,jsx}` | 推荐的服务端函数模块命名 | 可达并导出命名可调用服务端函数的模块 | 浏览器专用 helper、默认导出、运行时再导出，或依赖目录名触发发现 |
| `src/apis/**/*.{ts,tsx,js,jsx}` | 启用 `server.routing` 时的服务端文件路由发现 | 导出大写 HTTP method 的 Request/Response 路由模块 | `route.ts` 哨兵、`foo.get.ts` method suffix 文件、bracket/catch-all/optional routes、`middleware`/`middlewares`、默认导出，或从路由候选文件导出 helper |
| `src/middleware.{ts,tsx,js,jsx}` | 全局服务端中间件 | 在服务端运行时请求之前运行的 Hono-compatible middleware，包括服务端文件路由、服务端函数、SSR、PPR 和 RSC | 只属于 API routes 的逻辑、matcher 配置、route handlers 或 helper exports |
| `src/apis/**/middleware.{ts,tsx,js,jsx}` | API 路由中间件 | 作用于该目录树下后代服务端文件路由的 Hono-compatible middleware | `api.ts` 这类同级扁平路由、服务端函数/SSR 的全局服务端中间件，或 matcher 配置 |
| `src/apis` 下的 server route paths 和 dynamic URL shapes | 生成构建产物前的 server route 冲突检查 | 每个 URL path 只保留一个 server route module，每个 dynamic URL shape 只保留一种参数命名 | 并存的 `users.ts`/`users/index.ts`、`users/$id.ts`/`users/$userId.ts`，或把同一路径的方法拆到多个文件 |
| `src/features`、`src/components`、`src/lib`、`src/hooks` | 没有直接框架约定 | 业务代码、可复用 UI、浏览器安全 helper 和 React hooks | 依赖文件名被路由发现的文件 |

除非确实需要更底层 API，否则不要在一个应用中混用多套路由所有权模型：

- 普通 SPA/MPA 页面路由使用 `src/pages` 加 `routing`。
- 只有输出无法用 `src/pages` 表达时，才使用显式 `pages` 配置。
- 只有手工启动的单浏览器应用才使用 `app.entry`。

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
但实际规则可以分成四组：

1. **组件契约**：路由文件默认导出页面组件。渲染元信息放在页面组件旁边。语法错误和
   缺少默认导出的错误会在路由发现阶段、bundler 运行前报告。
2. **文件名语法**：`index.tsx` 映射到当前目录根路径。动态段使用 `$param`。
   `[id].tsx` 这类 bracket 段、`$...slug.tsx` 这类 catch-all 段，以及
   `$slug?.tsx` 这类可选段都会被拒绝。
3. **URL segment 安全性**：动态参数名必须是 `$` 后面的 JavaScript 标识符。
   静态段必须小写，并且只能使用 URL-safe 小写字母、数字、`.`、`_`、`-` 或 `~`。
   `$__proto__.tsx`、`$constructor.tsx`、`$prototype.tsx` 和 `$_splat.tsx`
   这类保留名称会被拒绝。
4. **只做组织**：`(marketing)` 这类 route group 是 pathless 目录，因此
   `src/pages/(marketing)/about.tsx` 映射到 `/about`。`(marketing` 这类不完整
   group segment 会被拒绝。

路由发现只会考虑 `.tsx`、`.jsx`、`.ts` 和 `.js` 源码文件。以下 colocated
文件会被忽略：

- 声明文件；
- test/spec 文件；
- Storybook 的 `*.story.*` 和 `*.stories.*` 文件；
- 隐藏 dot 路径；
- `*.client.*` 客户端专用模块；
- `*.server.*` 服务端专用模块；
- 非源码文件；
- `_` 前缀的私有路由段。

非路由 helper 应放在 `_` 前缀文件/目录中，或移到 `src/pages` 外部。

冲突和排序规则也是确定性的：

- 只有参数名不同的同级动态路由不允许共存。同一个 URL shape 应在 `$id.tsx`
  和 `$userId.tsx` 中选择一个。
- 同一个 route path 不能重复动态参数名，所以 `teams/$teamId/users/$teamId.tsx`
  会被拒绝。
- 扁平路由文件和目录 `index` 路由文件不能声明同一个 URL path。`/users` 应在
  `users.tsx` 和 `users/index.tsx` 中选择一种。
- SPA 和 MPA 都按 `/` 最先、父路由早于子路由、同级静态路由早于动态路由排序。
  因此 `users/settings.tsx` 会排在 `users/$id.tsx` 之前。
- 同级静态路由使用与 locale 无关的 code-point 顺序：`a-b.tsx`、`a.b.tsx`、
  `a0.tsx`、`a_c.tsx`、`aa.tsx`、`a~d.tsx` 在任何机器上都保持这个顺序。
- 路由示例和配置应使用 `/` 分隔符。文件系统里的 `\` 分隔符会在路由解析前归一化，
  因此不同操作系统上的路径和生成 route id 保持一致。

生成构建产物前，evjs 会对配置路径应用同样的路由检查。重复 path、动态 URL shape、
route id、空动态参数、保留动态参数、重复动态参数、包含空白、query string 或 hash
的路径都会被拒绝。

生成的 route id 来自 URL path，并把分隔符和标点归一化为下划线。因此
`admin/panel.tsx` 和 `admin_panel.tsx` 都会生成 `admin_panel`，不能同时存在。

### 路由文件名示例

| 文件 | 结果 | 说明 |
| --- | --- | --- |
| `src/pages/index.tsx` | `/` | 目录根路由。 |
| `src/pages/docs/index.tsx` | `/docs` | 嵌套目录根路由。 |
| `src/pages/users/$userId.tsx` | `/users/$userId` | 动态段；参数名必须是 JavaScript 标识符。 |
| `src/pages/users/settings.tsx` | `/users/settings` | 静态同级路由；排序早于 `users/$userId.tsx`。 |
| `src/pages/(marketing)/about.tsx` | `/about` | Pathless route group；`(marketing)` 只组织文件，不增加 URL segment。 |
| `src/pages/posts/layout.tsx` | `/posts` 的 layout route | SPA route layout，会包裹 `/posts` 下的后代路由。 |
| `src/pages/_helpers/format.ts` | 忽略 | `_` 前缀文件和目录在 `src/pages` 内是私有模块。 |
| `src/pages/.draft.tsx` | 忽略 | dot 前缀文件和目录不会参与路由发现。 |
| `src/pages/profile.test.tsx` | 忽略 | test/spec 文件可以和页面就近放置，不会成为路由。 |
| `src/pages/profile.stories.tsx` | 忽略 | Storybook 文件不会成为路由页面。 |
| `src/pages/ClientCard.client.tsx` | 忽略 | 客户端专用模块可以就近放置，不会成为 URL 路由。 |
| `src/pages/users.server.ts` | 忽略 | 服务端专用模块不是页面路由；被页面导入的服务端函数仍由服务端函数转换处理。 |
| `src/pages/users/[id].tsx` | 拒绝 | 不支持 bracket 路由语法；使用 `$id.tsx`。 |
| `src/pages/files/$...path.tsx` | 拒绝 | catch-all 段暂不属于约定。 |
| `src/pages/users/$__proto__.tsx` | 拒绝 | 保留对象属性名不是安全的路由参数名。 |
| `src/pages/docs/$_splat.tsx` | 拒绝 | `_splat` 是 wildcard route params 的保留名称。 |
| `src/pages/layout.tsx` | 拒绝 | SPA 根布局使用 `src/layout/index.tsx`。Route layout 必须嵌套在某个路由段下。 |
| `src/pages/posts/layout/index.tsx` | 拒绝 | Route layout 目录别名不是约定的一部分；使用 `src/pages/posts/layout.tsx`。 |
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

页面文件应保持轻量：

- 读取 params/search；
- 导出页面级 loader 或渲染元信息；
- 从 `features/` 或 `components/` 组合组件；
- 把业务逻辑放到领域模块中。

渲染元信息只接受字面量：

- `render` 和 `hydrate` 是字符串字面量；
- `prerender` 是 `true`，或包含 `partial`、`delivery`、`revalidate` 的对象字面量；
- `prerender.revalidate` 是 `false` 或表示秒数的正整数；
- `rsc` 是 RSC 页面使用的布尔字面量。

格式错误的页面模块会在 bundler 运行前报告文件路径和 parser message。

## 服务端边界

服务端函数没有约定目录。把可调用服务端函数放在以 `"use server";` 开头的可达模块中，
并优先使用 `*.server.*` 文件名，让路由发现忽略这些就近放置的服务端专用文件。

```ts
// src/apis/users.server.ts
"use server";

export async function listUsers() {
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
Route group 不增加路径段，并且这里复用页面路由的 segment 安全规则：bracket、
catch-all、optional、大写静态段、重复 path 和重复 dynamic shape 路由都会被拒绝。

`src/apis` 下的文件只有导出 `GET` 或 `POST` 这类大写 HTTP method 后才会成为
服务端路由。没有 route exports 的文件会被忽略，因此 `schema.ts`、`db.ts` 和
`types.ts` 可以和路由模块就近放置。一旦文件成为路由候选文件，就只能导出大写
HTTP methods；helper 应移到普通非路由文件、`_` 前缀私有文件，或路由树外部模块。
`route.ts` 哨兵、`users.get.ts` 这类 method suffix 文件、小写 method exports、
`middleware`/`middlewares` 导出、默认导出，以及路由候选文件中的其他 helper 导出，
都会在打包前报告。

服务端文件路由默认放在 `src/apis` 下。服务端中间件分成两个互不混用的作用域，
都使用 Hono 的 `MiddlewareHandler` 签名。

全局服务端中间件位于 `src/middleware.ts`。它会在服务端运行时请求之前运行，
包括服务端文件路由、服务端函数、SSR、PPR 和 RSC：

```ts
// src/middleware.ts
import type { MiddlewareHandler } from "@evjs/ev/server-context";

const middleware: MiddlewareHandler = async (ctx, next) => {
  await next();
  ctx.header("x-server", "evjs");
};

export default middleware;
```

API 路由中间件位于服务端文件路由树内。`src/apis/middleware.ts`
作用于 `src/apis` 下的所有服务端文件路由；嵌套的
`src/apis/**/middleware.ts` 只作用于后代路由。例如
`src/apis/api/middleware.ts` 覆盖 `src/apis/api/users.ts` 和
`src/apis/api/**` 下的嵌套文件，但不覆盖同级扁平路由 `src/apis/api.ts`：

```ts
// src/apis/middleware.ts
import type { MiddlewareHandler } from "@evjs/ev/server-context";

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
- `apis/` 是启用 `server.routing` 时的服务端文件路由目录。被可达应用代码导入的
  服务端函数可以用 `*.server.*` 文件名就近放在这里。
- `src/middleware.ts` 是全局服务端中间件；嵌套的 `apis/**/middleware.ts` 是作用于
  后代服务端文件路由的 API 路由中间件。
- `features/` 放业务领域模块。
- `components/` 放通用 UI。
- `lib/` 放浏览器安全的共享工具。
- 服务端密钥和 Node-only API 应留在 `*.server.*`、`apis/`，或只被服务端专用代码引用的模块中。
