# 文件约定

本页列出 evjs 会作为框架约定处理的文件名和目录。约定根目录之外的文件只是普通应用模块，除非它们被某个约定文件导入。

## 约定入口

| 文件或目录 | 归属配置 | 含义 |
| --- | --- | --- |
| `src/pages/**/*.{ts,tsx,js,jsx}` | `routing` | SPA 和 MPA 的客户端页面路由发现。 |
| 与同 basename 页面路由相邻的 `src/pages/**/*.html` | `routing` | MPA 页面专属 HTML 模板，例如 `about.tsx` 对应 `about.html`，`users/index.tsx` 对应 `users/index.html`。 |
| `<routing-dir-parent>/layout.{ts,tsx,js,jsx}` | `routing.conventions.layout` | 存在一个匹配文件时，作为可选外部 SPA 根布局。 |
| `<routing-dir-parent>/layout/index.{ts,tsx,js,jsx}` | `routing.conventions.layout` | 可选外部 SPA 根布局的目录形式。 |
| `src/pages/**/layout.{ts,tsx,js,jsx}` | `routing` | 页面路由树内的 SPA route layout。 |
| `src/pages/**/layout/index.{ts,tsx,js,jsx}` | `routing` | SPA route layout 的目录形式。 |
| `<routing-dir-parent>/route-types.d.ts` | generated | evjs 生成的 SPA 导航类型声明。 |
| 带 `"use server";` 的 `*.server.ts` 文件 | server functions | 推荐的 server function 命名约定。 |
| `src/apis/**/*.{ts,tsx,js,jsx}` | `server.routing` | 启用 `server.routing` 时的服务端文件路由。 |
| `src/middleware.{ts,tsx,js,jsx}` | `server.conventions.middleware` | 启用 server conventions 时的全局 server middleware。 |
| `src/apis/**/middleware.{ts,tsx,js,jsx}` | `server.conventions.middleware` | route-scoped server file-route middleware。 |

默认客户端路由目录是 `./src/pages`。默认服务端文件路由目录是
`./src/apis`。需要更换客户端路由目录时配置 `routing.dir`；需要更换服务端文件路由目录时配置
`server.routing.dir`。

## 路径段规则

页面路由、服务端文件路由和 route-scoped server middleware 使用同一套路径段规则：

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

SPA route layout 使用路由树内的 `layout.*` 文件：

```text
src/pages/layout.tsx             -> 包裹根级页面路由
src/pages/dashboard/layout.tsx   -> 包裹 /dashboard 后代路由
```

外部 SPA 根布局可以放在路由目录旁边：

```text
src/layout.tsx
src/layout/index.tsx
```

如果存在多个外部根布局候选文件，需要保留一个文件，或显式配置
`routing.conventions.layout`。设置 `routing.conventions.layout: false`
可以关闭外部根布局发现。MPA 模式不消费框架 layout。

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

Server function 由 `"use server";` 指令发现，不依赖单一目录。推荐约定是放在
`src/api/` 下，并使用 `.server.ts` 后缀：

```ts
// src/api/users.server.ts
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
- 可达的 server function 会被转换为 client reference 和 framework server output 中的 server registration。

## 服务端文件路由

通过 `server.routing` 启用服务端文件路由。URL 来自 `server.routing.dir`
下的文件路径；这里没有 `prefix` 选项。

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

Server middleware 使用专门的 `middleware.*` 文件，并遵循 Hono 的
`MiddlewareHandler` 签名：

```ts
// src/middleware.ts
import type { MiddlewareHandler } from "@evjs/ev/request";

const middleware: MiddlewareHandler = async (ctx, next) => {
  await next();
  ctx.header("x-server", "evjs");
};

export default middleware;
```

全局 middleware：

```text
src/middleware.ts
```

Route-scoped middleware：

```text
src/apis/middleware.ts
src/apis/api/middleware.ts
src/apis/api/admin/middleware.ts
src/apis/(admin)/middleware.ts
```

执行顺序是：

1. global middleware；
2. 从父目录到子目录的 route-scoped middleware；
3. HTTP method handler。

Middleware 文件必须默认导出一个 middleware 函数，不能导出命名值或 matcher
配置。Route-scoped middleware 只作用于后代 server file routes；例如
`src/apis/api/middleware.ts` 覆盖
`src/apis/api/users.ts`，但不覆盖 flat sibling
`src/apis/api.ts`。

关闭 middleware discovery：

```ts
export default defineConfig({
  server: {
    routing: true,
    conventions: {
      middleware: false,
    },
  },
});
```
