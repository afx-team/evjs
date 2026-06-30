# 文件约定

本页列出 evjs 会作为框架约定处理的文件名和目录。约定根目录之外的文件只是普通应用模块，除非它们被某个约定文件导入。

## 约定入口

| 文件或目录 | 约定领域 | 含义 |
| --- | --- | --- |
| `src/pages/**/*.{ts,tsx,js,jsx}` | 客户端页面 | SPA 和 MPA 的客户端页面路由发现。 |
| 与同 basename 页面路由相邻的 `src/pages/**/*.html` | MPA 页面 | MPA 页面专属 HTML 模板，例如 `about.tsx` 对应 `about.html`，`users/index.tsx` 对应 `users/index.html`。 |
| `<routing-dir-parent>/layout/index.tsx` | SPA 布局 | 按约定自动发现的可选外部 SPA 根布局。 |
| `src/pages/<segment>/**/layout.{ts,tsx,js,jsx}` | SPA 布局 | 页面路由树内的嵌套 SPA route layout。 |
| `src/pages/**/error.{ts,tsx,js,jsx}` | SPA 边界 | 离当前路由目录作用域最近的 SPA error boundary。 |
| `src/pages/**/not-found.{ts,tsx,js,jsx}` | SPA 边界 | 离当前路由目录作用域最近的 SPA not-found boundary。 |
| `<routing-dir-parent>/route-types.d.ts` | 生成产物 | evjs 生成的 SPA 导航类型声明。 |
| 带 `"use server";` 的 `*.server.{ts,tsx,js,jsx}` 文件 | server functions | 推荐的 server function 命名约定。 |
| `src/apis/**/*.{ts,tsx,js,jsx}` | 服务端文件路由 | 默认发现的服务端文件路由。 |
| `src/middleware.{ts,tsx,js,jsx}` | 服务端中间件 | 全局服务端中间件。 |
| `src/apis/**/middleware.{ts,tsx,js,jsx}` | API route middleware | server file routes 的 API route middleware。 |

默认客户端路由目录是 `./src/pages`。默认服务端文件路由目录是
`./src/apis`。需要更换客户端路由目录时配置 `routing.dir`；需要更换服务端文件路由目录时配置
`server.routing.dir`。

## 路径段规则

页面路由、服务端文件路由和 API route middleware 使用同一套路径段规则：

| 模式 | 结果 |
| --- | --- |
| `index.*` | 目录根路由。 |
| `$param.*` | 动态段。服务端文件路由会转换为 Hono `:param`。 |
| `(group)` | 用于组织目录的 pathless route group，不增加 URL segment。 |
| `_private.*` 或 `_private/` | 忽略的私有模块或目录。 |
| `.hidden.*` 或 `.hidden/` | 忽略的隐藏模块或目录。 |

静态路由段必须使用小写 URL-safe 字符：小写字母、数字、`.`、`_`、`-`
或 `~`。动态参数名必须是 `$` 后的 JavaScript 标识符，例如 `$userId` 或
`$team_id`。

以下写法会被拒绝：

- `[id].tsx` 这类 bracket route；
- `$...slug.tsx` 这类 catch-all route；
- `$slug?.tsx` 这类 optional param；
- `$.tsx` 这类空动态参数；
- `$__proto__.tsx`、`$constructor.tsx`、`$prototype.tsx` 或
  `$_splat.tsx` 这类保留动态参数；
- `teams/$teamId/users/$teamId.tsx` 这类同一路径中重复的动态参数；
- `users.tsx` 和 `users/index.tsx` 这类重复 path；
- `users/$id.tsx` 和 `users/$userId.tsx` 这类重复 dynamic shape。

路由必须遵循文件形状。evjs 不提供 catch-all、optional 或 bracket routes
的替代文件名方言。

## 忽略的支撑文件

在路由目录下，evjs 会忽略支撑文件，因此它们可以和路由就近放置：

| 模式 | 含义 |
| --- | --- |
| `*.d.ts` | 类型声明。 |
| `*.test.*` 和 `*.spec.*` | 测试。 |
| `*.story.*` 和 `*.stories.*` | Storybook stories。 |
| `*.client.*` | 客户端专用模块。 |
| `*.server.*` | 服务端专用模块。 |
| 不使用 `.ts`、`.tsx`、`.js` 或 `.jsx` 的文件 | 非源码资源或元信息；同 basename 的 MPA `.html` 模板除外。 |

仍然使用源码扩展名的 route-local helper 可以放在 `_` 前缀文件或目录里。例如
`src/pages/users/_format.ts` 和 `src/pages/users/_components/Card.tsx`
都不会成为 URL 路由。

## 客户端页面路由

客户端页面路由放在 `routing.dir` 下：

```text
src/pages/index.tsx              -> /
src/pages/about.tsx              -> /about
src/pages/users/index.tsx        -> /users
src/pages/users/$userId.tsx      -> /users/$userId
src/pages/(marketing)/about.tsx  -> /about
```

每个被发现的页面文件都必须默认导出 React 组件。页面模块也可以导出字面量渲染元信息，例如
`render`、`hydrate`、`prerender` 和 `rsc`。

SPA route layout 使用路由段下的 `layout.*` 文件：

```text
src/pages/dashboard/layout.tsx   -> 包裹 /dashboard 后代路由
```

外部 SPA 根布局只有一个自动发现约定：

```text
src/layout/index.tsx
```

`src/pages/layout.tsx`、`src/layout.tsx` 这类根布局别名，以及
`src/pages/dashboard/layout/index.tsx` 这类 route layout 目录别名都会被约定拒绝。
只有当应用 shell 明确放在其他位置时，才显式配置 `routing.conventions.layout`。
MPA 模式不消费框架 layout。

SPA route 边界使用专用约定文件：

```text
src/pages/error.tsx             -> 根 error boundary
src/pages/not-found.tsx         -> 根 not-found boundary
src/pages/dashboard/error.tsx   -> /dashboard 作用域 error boundary
```

`error.*` 和 `not-found.*` 按目录作用域生效，并被后代 page 和 layout routes
继承，直到出现更近的边界文件。Boundary 模块必须默认导出 React 组件。这些 SPA
router conventions 在 MPA 模式下不会被消费，相关文件名仍然是普通页面路由。

MPA 模式下，页面路由可以使用同 basename 的 colocated HTML 模板：

```text
src/pages/about.tsx        -> /about，模板 src/pages/about.html
src/pages/about.html
src/pages/users/index.tsx  -> /users，模板 src/pages/users/index.html
src/pages/users/index.html
```

没有 colocated 模板的路由默认使用全局 `index.html` 模板。如果每个 MPA 路由都有
colocated 模板，则这些路由不要求存在 `index.html`。

SPA 模式会把生成的路由类型写入 `<routing-dir-parent>/route-types.d.ts`。
不要手工修改这个文件，不要从应用代码导入它，也不要把它复制进模板。

## 服务端函数

Server function 由 `"use server";` 指令发现，不依赖目录。使用 `.server.ts` 或
`.server.tsx` 文件名，让路由发现忽略就近放置的 server-only 文件：

```ts
// src/apis/users.server.ts
"use server";

export async function listUsers() {
  return [];
}
```

规则：

- 指令必须位于模块顶部；
- 模块必须导出至少一个命名 callable function；
- 不支持默认导出、runtime re-export、generator、async generator，以及导出的非函数 runtime 值；
- type-only export 会被 runtime transform 忽略；
- 可达的 server function 可以通过内置传输层在浏览器代码中调用；应用代码不需要手写 endpoint 或 proxy 文件。

## 服务端文件路由

服务端文件路由默认启用。URL 来自 `server.routing.dir` 下的文件路径；这里没有
`prefix` 选项。

```text
src/apis/index.ts              -> /
src/apis/health.ts             -> /health
src/apis/users.ts              -> /users
src/apis/users/index.ts        -> /users
src/apis/users/$userId.ts      -> /users/:userId
src/apis/(internal)/health.ts  -> /health
src/apis/api/users.ts          -> /api/users
```

只有导出至少一个大写 HTTP method 的文件才会成为路由：
`GET`、`POST`、`PUT`、`PATCH`、`DELETE`、`HEAD` 或 `OPTIONS`。

```ts
// src/apis/api/posts.ts
export const GET = async () => Response.json([]);

export const POST = async (request) => {
  const body = await request.json();
  return Response.json(body, { status: 201 });
};
```

Server route candidate 只能导出大写 HTTP methods。共享 helper 应移到
`_schema.ts` 这类被忽略的私有文件，或移到路由树外部的模块。

服务端 route candidate 中的以下写法会被拒绝：

- 默认导出；
- `middleware` 或 `middlewares` 导出；
- helper export 或其他不支持的 runtime export；
- `get` 这类小写 HTTP method export；
- `posts.get.ts` 这类 method suffix 文件；
- `route.ts` sentinel 文件；
- 重复 path 或重复 dynamic shape。

没有 HTTP method exports 的文件会被忽略，因此 `schema.ts`、`db.ts` 和
`types.ts` 这类 helper 可以放在路由树里。

## 服务端中间件

evjs 有两个 server middleware 作用域。Middleware 文件 default-export 一个
Hono-compatible middleware 函数，不能导出命名值或 matcher 配置。

全局服务端中间件会包裹服务端运行时请求，包括 server
file routes、server functions、SSR、PPR 和 RSC：

```ts
// src/middleware.ts
import type { MiddlewareHandler } from "@evjs/ev/server-context";

const middleware: MiddlewareHandler = async (ctx, next) => {
  await next();
  ctx.header("x-server", "evjs");
};

export default middleware;
```

全局服务端中间件：

```text
src/middleware.ts
```

API route middleware：

```text
src/apis/middleware.ts
src/apis/api/middleware.ts
src/apis/api/admin/middleware.ts
src/apis/(admin)/middleware.ts
```

执行顺序是：

1. 全局服务端中间件；
2. 从父目录到子目录的 API route middleware；
3. HTTP method handler。

API route middleware 只作用于后代 server file routes；例如
`src/apis/api/middleware.ts` 覆盖
`src/apis/api/users.ts`，但不覆盖 flat sibling
`src/apis/api.ts`。
