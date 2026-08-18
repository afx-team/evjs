# API 路由与中间件

Server routes 让你完全控制 HTTP methods、headers 和标准 Web
`Request`/`Response` 对象。在 evjs framework 项目中，服务端路由通过文件约定声明。

完整的服务端文件路由和 middleware 文件名规则见
[文件约定](./file-conventions)。

## 文件路由

文件化服务端路由默认启用。evjs 扫描 `./src/apis/**/api.*`，每个锚点的所在
目录映射为 request URL。该根目录固定，且没有 prefix 配置；如果 URL 需要以
`/api/users` 开头，把锚点放在 `src/apis/api/users` 这类目录下。

```text
src/apis/api.ts                       -> /
src/apis/health/api.ts                -> /health
src/apis/users/api.ts                 -> /users
src/apis/users/$userId/api.ts         -> /users/:userId
src/apis/(internal)/health/api.ts     -> /health
src/apis/api/users/api.ts             -> /api/users
```

`api.{ts,tsx,js,jsx}` 是唯一 request-route 锚点，每个 route 目录只允许一个
源码扩展名变体。锚点至少导出一个大写 HTTP method：`GET`、`POST`、`PUT`、
`PATCH`、`DELETE`、`HEAD` 或 `OPTIONS`：

```ts
// src/apis/api/posts/api.ts
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

支持导入、重新导出或由 Factory 创建的 Handler，只要最终值可调用。Generator Handler
不受支持，因为它返回 Iterator，而不是一份响应。

其他任何 basename 都是普通路由源码，因此 `schema.ts`、`db.ts`、`types.ts`、
`index.ts` 与 `route.ts` 可以就近放置。`api.*` 锚点只能导出大写 HTTP 方法，辅助函数
应移到其他文件。evjs 会拒绝缺少方法、默认或小写导出、不受支持的运行时导出、重复路径、
模糊动态路由，以及同一目录中的多个 `api.*` 变体。

发现到的 route 统一按 segment 逐段比较 specificity：父路径排在后代之前，并在
首个不同位置优先 static segment，再处理 dynamic segment。这样注册顺序稳定，
dynamic route 也不会遮蔽更具体的 static 分支。

API 路由形态不能与页面路由、重定向或活动框架运行时端点重叠。运行 `ev inspect` 可以在
构建前发现冲突。

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
// src/apis/users/$userId/api.ts
export const GET = async (_req, ctx) => {
  const userId = ctx.req.param("userId");
  return Response.json({ id: userId });
};
```

## Middleware

evjs 有两个 server middleware 作用域，且都不包含 matcher 配置。

固定锚点 `src/middlewares/middleware.*` 为所有 server runtime 请求组合全局
middleware，包括 server file routes、server functions、SSR、PPR 与 RSC
framework handling。它默认导出一个 Hono-compatible middleware 函数，或按明确
顺序排列的非空列表。在 TypeScript 中，使用 `satisfies MiddlewareChain` 为列表
提供类型，同时保留各项的具体类型：

```ts
// src/middlewares/middleware.ts
import type { MiddlewareChain } from "@evjs/ev/server-context";
import authentication from "./authentication";
import tracing from "./tracing";

export default [tracing, authentication] satisfies MiddlewareChain;
```

JavaScript 模块可直接默认导出同样的数组，无需 TypeScript 标注。evjs 会在
convention discovery 阶段校验字面量列表，并在创建 server application 时再次
校验所有求值后的列表项。

`src/middlewares` 中的其他文件都是由组合锚点导入的普通模块。文件名不决定执行
顺序，因此既能在一个组合锚点中清晰表达顺序，也允许拆分任意数量的实现模块。

默认导出单个全局 middleware 仍然合法：

```ts
// src/middlewares/middleware.ts
import type { MiddlewareHandler } from "@evjs/ev/server-context";

const tracing: MiddlewareHandler = async (ctx, next) => {
  await next();
  ctx.header("x-server", "evjs");
};

export default tracing;
```

API route middleware 位于 server file-route tree 内，只作用于同目录及 descendant
server file routes：

```text
src/apis/middleware.ts            -> 所有锚定 Route
src/apis/api/middleware.ts        -> /api 与后代 Route
src/apis/api/admin/middleware.ts  -> /api/admin 与后代 Route
src/apis/(admin)/middleware.ts    -> group 及其后代 Route
```

执行顺序是从左到右的全局列表、从父目录到子目录的 API route middleware，
最后是 HTTP method handler；`await next()` 之后的代码按相反顺序回退执行。
Route group 不增加 URL segment，但参与文件系统作用域划分。
`src/apis/api/middleware.ts` 会覆盖 `src/apis/api/api.ts` 的 `/api` 锚点，以及
`src/apis/api/users/api.ts` 等所有后代锚点。

函数签名遵循 Hono：

```ts
import type { MiddlewareHandler } from "@evjs/ev/server-context";

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
或 `ctx.res` 修改下游响应。API route middleware 通过 route handler chain 挂载，
因此可以用 `ctx.req.param()` 读取 route params。

## 内置行为

- **自动 OPTIONS**：返回列出所有已定义方法的 `Allow` 头
- **自动 HEAD**：如果未显式定义，从 `GET` 派生
- **405 Method Not Allowed**：未注册的 HTTP 方法
