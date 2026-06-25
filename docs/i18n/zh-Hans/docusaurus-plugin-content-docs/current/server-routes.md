# 服务端路由

Server routes 让你完全控制 HTTP methods、headers 和标准 Web
`Request`/`Response` 对象。在 evjs framework 项目中，服务端路由通过文件约定声明。

`@evjs/server` 仍然是独立的 server runtime package。它不是 evjs 的第二套路由模式，
evjs framework routing 也不会分析编程式 route 声明。

完整的服务端文件路由和 middleware 文件名规则见
[文件约定](./file-conventions.md)。

## 文件路由

使用 `server.routing` 启用服务端文件路由：

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  server: {
    routing: true,
  },
});
```

`server.routing: true` 扫描 `./src/apis`，并把该目录映射到 `/`。Object
形式目前只支持 `dir`。没有 `prefix` 选项；如果 URL 需要以 `/api` 开头，把文件放在
`src/apis/api` 这类目录下。

```text
src/apis/index.ts              -> /
src/apis/health.ts             -> /health
src/apis/users.ts              -> /users
src/apis/users/index.ts        -> /users
src/apis/users/$userId.ts      -> /users/:userId
src/apis/(internal)/health.ts  -> /health
src/apis/api/users.ts          -> /api/users
```

文件只有导出至少一个大写 HTTP method 时才会成为路由：`GET`、`POST`、`PUT`、
`PATCH`、`DELETE`、`HEAD` 或 `OPTIONS`：

```ts
// src/apis/api/posts.ts
export const GET = async (req) => {
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit")) || 10;
  return Response.json([{ id: 1, title: "Hello World", limit }]);
};

export const POST = async (req) => {
  const data = await req.json();
  return Response.json({ success: true, data }, { status: 201 });
};
```

没有 route exports 的文件会被忽略，因此 `schema.ts`、`db.ts`、`types.ts` 可以和路由就近放置。
Route candidate 只能导出大写 HTTP methods；helper 应移到非 route 文件。
`middleware`、`middlewares`、默认导出、重复 path、重复 dynamic shape、bracket
routes、catch-all routes、optional params、小写 method exports、route candidate
中的不受支持 runtime exports，以及 `posts.get.ts` 这类 method suffix 文件，都会在
bundling 之前被拒绝。

## 处理器签名

每个 HTTP method handler 接收 Web `Request` 和 Hono-compatible context：

```ts
(request: Request, ctx: HonoContext) => Response | Promise<Response>
```

Hono `Context` (`ctx`) 提供：

| API | 描述 |
|-----|------|
| `ctx.req.param()` | 所有解析出的路由参数对象 |
| `ctx.req.param("id")` | 按名称读取单个路由参数 |
| `ctx.req.raw` | 底层 Web `Request` |
| `ctx.header()` | 设置响应头 |
| `ctx.json()` | 发送 JSON 响应 |

```ts
// src/apis/users/$userId.ts
export const GET = async (_req, ctx) => {
  const userId = ctx.req.param("userId");
  return Response.json({ id: userId });
};
```

## 文件路由中间件

File-route middleware 是按文件系统作用域生效的约定。Middleware 文件 default-export
一个 Hono-compatible middleware 函数，不包含 matcher 配置：

```ts
// src/middleware.ts
import type { MiddlewareHandler } from "@evjs/server";

const middleware: MiddlewareHandler = async (ctx, next) => {
  await next();
  ctx.header("x-server", "evjs");
};

export default middleware;
```

全局 middleware 位于 `src/middleware.ts`，会在 server file routes、server
functions、SSR、PPR 和 RSC framework handling 之前运行。Route-scoped middleware
位于 route tree 内，只作用于 descendant server file routes：

```text
src/apis/middleware.ts            -> 所有文件路由
src/apis/api/middleware.ts        -> api/** 下的路由
src/apis/api/admin/middleware.ts  -> api/admin/** 下的路由
src/apis/(admin)/middleware.ts    -> (admin)/** 下的路由
```

执行顺序是全局 middleware、从父目录到子目录的 route-scoped middleware、最后是 HTTP
method handler。Route group 不增加 URL segment，但参与文件系统作用域划分。
`src/apis/api/middleware.ts` 覆盖 `src/apis/api/index.ts`、`src/apis/api/users.ts`
以及 `src/apis/api/**` 下的嵌套文件；不覆盖 flat sibling `src/apis/api.ts`。

函数签名遵循 Hono：

```ts
import type { MiddlewareHandler } from "@evjs/server";

const requireAuth: MiddlewareHandler = async (ctx, next) => {
  if (!ctx.req.header("authorization")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await next();
  ctx.header("x-authenticated", "true");
};

export default requireAuth;
```

`ctx` 是 Hono `Context`。`next` 会继续后续 middleware/handler chain。返回
`Response` 可以短路请求。`await next()` 之后，middleware 可以通过 `ctx.header()`
或 `ctx.res` 修改下游响应。Route-scoped middleware 通过 route handler chain 挂载，
因此可以用 `ctx.req.param()` 读取 route params。

## 内置行为

- **自动 OPTIONS**：返回列出所有已定义方法的 `Allow` 头
- **自动 HEAD**：如果未显式定义，从 `GET` 派生
- **405 Method Not Allowed**：未注册的 HTTP 方法
