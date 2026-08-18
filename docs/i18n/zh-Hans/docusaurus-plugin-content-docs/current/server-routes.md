# API 路由与中间件

API 路由让你直接使用 HTTP 方法、请求头以及标准 Web `Request`/`Response` 对象。在
evjs 项目中，API 路由通过文件约定声明。

完整的 API 路由和中间件文件名规则见
[文件约定](./file-conventions)。

## 文件路由

文件式 API 路由默认启用。evjs 扫描 `./src/apis/**/api.*`，每个文件的所在目录映射为
请求 URL。根目录固定，不提供额外前缀配置；如果 URL 需要以 `/api/users` 开头，请把
文件放在 `src/apis/api/users` 这类目录下。

```text
src/apis/api.ts                       -> /
src/apis/health/api.ts                -> /health
src/apis/users/api.ts                 -> /users
src/apis/users/$userId/api.ts         -> /users/:userId
src/apis/(internal)/health/api.ts     -> /health
src/apis/api/users/api.ts             -> /api/users
```

`api.{ts,tsx,js,jsx}` 是唯一会创建 API 路由的文件名，每个路由目录只允许一种源码
扩展名。文件至少导出一个大写 HTTP 方法：`GET`、`POST`、`PUT`、
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

处理器可以导入、重新导出或由工厂函数创建，只要最终值可调用。生成器函数不受支持，
因为它返回迭代器，而不是一份响应。

其他文件名都属于普通路由源码，因此 `schema.ts`、`db.ts`、`types.ts`、`index.ts` 与
`route.ts` 可以就近放置。`api.*` 文件只能导出大写 HTTP 方法，辅助函数
应移到其他文件。evjs 会拒绝缺少方法、默认或小写导出、不受支持的运行时导出、重复路径、
模糊动态路由，以及同一目录中的多个 `api.*` 变体。

框架会逐段比较已发现路由的匹配优先级：父路径排在后代之前，遇到不同路径段时先注册
静态路径，再注册动态路径。这样可以保持顺序稳定，动态路由也不会遮蔽更具体的静态分支。

API 路由形态不能与页面路由、重定向或活动框架运行时端点重叠。运行 `ev inspect` 可以在
构建前发现冲突。

## 处理器签名

每个 HTTP 方法处理器接收 Web `Request` 和兼容 Hono 的上下文：

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

## 中间件

evjs 提供两种服务端中间件作用域，均不需要 matcher 配置。

固定入口 `src/middlewares/middleware.*` 为所有服务端请求组合全局中间件，包括 API
路由、服务端函数、SSR、PPR 与 RSC 请求。它默认导出一个兼容 Hono 的中间件函数，或按明确
顺序排列的非空列表。在 TypeScript 中，使用 `satisfies MiddlewareChain` 为列表
提供类型，同时保留各项的具体类型：

```ts
// src/middlewares/middleware.ts
import type { MiddlewareChain } from "@evjs/ev/server-context";
import authentication from "./authentication";
import tracing from "./tracing";

export default [tracing, authentication] satisfies MiddlewareChain;
```

JavaScript 模块可直接默认导出同样的数组，无需 TypeScript 标注。evjs 会在发现文件约定
时校验字面量列表，并在创建服务端应用时再次校验所有求值后的列表项。

`src/middlewares` 中的其他文件都是由 `middleware.*` 显式导入的普通模块。文件名不决定
执行顺序，因此既能在该文件中清晰表达顺序，也允许拆分任意数量的实现模块。

也可以默认导出单个全局中间件：

```ts
// src/middlewares/middleware.ts
import type { MiddlewareHandler } from "@evjs/ev/server-context";

const tracing: MiddlewareHandler = async (ctx, next) => {
  await next();
  ctx.header("x-server", "evjs");
};

export default tracing;
```

API 路由中间件位于 `src/apis` 文件树内，只作用于同目录及后代 API 路由：

```text
src/apis/middleware.ts            -> 所有 API 路由
src/apis/api/middleware.ts        -> /api 及其后代路由
src/apis/api/admin/middleware.ts  -> /api/admin 及其后代路由
src/apis/(admin)/middleware.ts    -> 分组及其后代路由
```

执行顺序依次是从左到右的全局列表、从父目录到子目录的 API 路由中间件，最后是 HTTP
方法处理器；`await next()` 之后的代码按相反顺序执行。路由分组不增加 URL 段，但会
参与文件系统作用域划分。
`src/apis/api/middleware.ts` 会作用于 `src/apis/api/api.ts` 对应的 `/api` 路由，以及
`src/apis/api/users/api.ts` 等所有后代路由。

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

`ctx` 是 Hono `Context`。`next` 会继续执行后续中间件和处理器；返回 `Response` 可以
提前结束请求。`await next()` 之后，中间件可以通过 `ctx.header()` 或 `ctx.res` 修改
下游响应。API 路由中间件可以使用 `ctx.req.param()` 读取路由参数。

## 内置行为

- **自动 OPTIONS**：返回列出所有已定义方法的 `Allow` 头
- **自动 HEAD**：如果未显式定义，从 `GET` 派生
- **405 Method Not Allowed**：未注册的 HTTP 方法
