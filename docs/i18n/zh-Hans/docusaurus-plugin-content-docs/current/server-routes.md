# 服务端路由

服务端路由让你完全掌控 HTTP 方法、请求头和标准 Web `Request`/`Response` 对象 —— 不同于使用自动 RPC 的服务端函数。

## 基本用法

使用 `@evjs/server` 的 `createRoute(path, definition)` 定义路由：

:::important
**路由路径必须是字符串字面量。** `path` 参数只接受字符串字面量类型。
在 TypeScript 项目中，传入 `string` 类型变量或模板字符串会产生编译错误；
evjs graph analysis 也会在 bundling 之前报告同样的非法导出路由声明。
路由 definition 也必须是对象字面量，方便静态提取 HTTP methods。路径必须以
`/` 开头，并且每个 route 至少声明一个 HTTP method handler，例如 `GET`、
`POST` 或 `DELETE`。同一个 server route URL shape 只能声明一次；动态参数名
不会形成不同的 shape，所以 `/api/users/:id` 和 `/api/users/:userId` 会冲突。
这个 shape 的所有 HTTP methods 应放在同一个 `createRoute()` 调用里。动态参数名
必须非空，并且是安全的对象 key；不要使用 `:__proto__`、`:constructor` 或
`:prototype` 这类保留名称，也不要在同一个 route path 中重复同一个参数名。
可达的 server route 模块如果存在语法错误，graph analysis 会在 bundling 之前带上
文件路径和 parser message 报错。
Route path 只表示 path pattern：不要包含空白字符、query string 或 URL hash。
query string 请在 handler 里通过 `new URL(request.url).searchParams` 读取。
HTTP method key 必须是受支持的大写方法（`GET`、`POST`、`PUT`、`PATCH`、
`DELETE`、`HEAD`、`OPTIONS`）。definition 中唯一的非 method key 是
`middlewares`；`middleware`、小写 method 名和 spread definition 都会在 bundling
之前报错。method value 必须是函数，`middlewares` 必须是函数数组。内联函数和
引用函数都可以使用，但引用的本地变量必须有静态 initializer；未初始化的本地变量会在
bundling 之前被拒绝。

```ts
// ✅ 正确 — 字符串字面量
createRoute("/api/users", { ... });

// ❌ 编译错误 — 宽泛的 `string` 类型
const p: string = "/api/users";
createRoute(p, { ... });

// ❌ 构建错误 — query string 应从 request.url 读取，不写进 route path
createRoute("/api/users?limit=10", { GET: handler });

// ❌ 构建错误 — 动态参数需要安全且非空的名称
createRoute("/api/users/:__proto__", { GET: handler });
createRoute("/api/users/:", { GET: handler });

// ❌ 构建错误 — method key 要大写，middleware 要用复数
createRoute("/api/users", { get: handler, middleware: [] });

// ❌ 构建错误 — handler 和 middleware entry 都要是函数
createRoute("/api/users", { GET: "not a function", middlewares: [null] });

// ❌ 构建错误 — 被引用的本地变量必须静态初始化
let handler;
createRoute("/api/users", { GET: handler });
```
:::

```ts
// src/api/posts.routes.ts
import { createRoute } from "@evjs/server";

export const postsRoute = createRoute("/api/posts", {
  GET: async (req) => {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit")) || 10;
    return Response.json([{ id: 1, title: "Hello World" }]);
  },
  POST: async (req) => {
    const data = await req.json();
    return Response.json({ success: true, data }, { status: 201 });
  },
});
```

Server route 声明也可以使用本地 export specifier，包括字符串字面量 alias。
evjs 不会为 server route metadata 跟随来自其他模块的 re-export：

```ts
const posts = createRoute("/api/posts", { GET: async () => Response.json([]) });
export { posts as "posts-route" };
```

不要把同一个 URL shape 拆成多个 route export：

```ts
// ❌ graph analysis 会失败 — duplicate path
export const postsGet = createRoute("/api/posts", { GET: async () => Response.json([]) });
export const postsPost = createRoute("/api/posts", { POST: async () => Response.json({ ok: true }) });

// ❌ graph analysis 会失败 — same dynamic route shape
export const userGet = createRoute("/api/users/:id", { GET: async () => Response.json({}) });
export const userPatch = createRoute("/api/users/:userId", { PATCH: async () => Response.json({ ok: true }) });
```

## 处理器签名

每个处理器接收两个参数：

```ts
(request: Request, ctx: HonoContext) => Response | Promise<Response>
```

| API | 描述 |
|-----|------|
| `ctx.req.param()` | 所有解析的路由参数 |
| `ctx.req.param("id")` | 单个路由参数 |
| `ctx.req.raw` | 底层 Web `Request` |
| `ctx.header()` | 设置响应头 |
| `ctx.json()` | 发送 JSON 响应 |

## 动态路由

使用 Hono 的 `:param` 语法定义路径参数。参数名可以通过
`ctx.req.param("id")` 读取，但它不是 route identity 的一部分。每个 URL shape
保持一个稳定的参数名，并把这个 shape 的所有 methods 放在同一个 route
definition 里。空参数名以及保留对象属性名（`__proto__`、`constructor`、
`prototype`）会被拒绝，因为 `ctx.req.param()` 会以对象形式返回 params。
`/api/users/:userId/posts/:userId` 这类重复参数名也会被拒绝，因为 `userId`
只能表示一个值：

```ts
export const postDetailsRoute = createRoute("/api/posts/:id", {
  GET: async (_req, ctx) => {
    const id = ctx.req.param("id");
    return Response.json({ id, title: "文章详情" });
  },
  DELETE: async (_req, ctx) => {
    const id = ctx.req.param("id");
    await db.deletePost(id);
    return new Response(null, { status: 204 });
  },
});
```

## 中间件

使用 `middlewares` 选项在处理器之前运行逻辑。调用 `next()` 继续或返回 `Response` 短路：

```ts
import { createRoute } from "@evjs/server";

const requireAuth = async (req, next) => {
  const auth = req.headers.get("Authorization");
  if (!auth) return Response.json({ error: "未授权" }, { status: 401 });
  return next();
};

export const protectedRoute = createRoute("/api/protected", {
  middlewares: [requireAuth],
  GET: async () => Response.json({ secret: "data" }),
});
```

使用 `createApp({ middlewares })` 可以声明全局中间件，覆盖 server routes、server functions、SSR、PPR、RSC framework handling：

```ts
import { createApp, requestLogger } from "@evjs/server";

const app = createApp({
  middlewares: [requestLogger()],
  routes: [protectedRoute],
});
```

`createApp({ framework })` 是生成的 server adapter 用来挂载 SSR、SSG
fallback、PPR 和 RSC handling 的底层入口。手动传入时，
`framework.manifest` 必须是已输出的 `BuildOutput` 形状：包含
`version: 1`，以及 object 类型的 `runtime`、`apps`、`pages` 和 array
类型的 `routes`。无效的 framework manifest 会在 `createApp()` 启动阶段失败，
而不是等到第一次 page、PPR 或 RSC 请求时崩溃。
PPR runtime cache 选项也放在 `framework.ppr` 下；它们面向生成的或自定义的
server adapter，不是应用 page config：

```ts
import type { PprRegionCache } from "@evjs/server";

const regionCache: PprRegionCache = platformRegionCache();

createApp({
  framework: {
    manifest,
    render,
    ppr: {
      regionCache,
      staleWhileRevalidate: 30,
    },
  },
});
```

## 挂载路由

在服务端入口中将路由处理器提供给 `createApp()`：

```ts
// src/server.ts
import { createApp } from "@evjs/server";
import { postsRoute, postDetailsRoute } from "./api/posts.routes";

const app = createApp({
  routes: [postsRoute, postDetailsRoute],
});

export default { fetch: app.fetch };
```

然后在 `ev.config.ts` 中配置服务端入口：

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  server: {
    entry: "./src/server.ts",
    dev: { port: 3001 },
  },
});
```

## 内置行为

- **自动 OPTIONS** —— 返回列出所有已定义方法的 `Allow` 头
- **自动 HEAD** —— 如果未显式定义，从 `GET` 派生
- **405 Method Not Allowed** —— 未注册的 HTTP 方法

:::tip

如果你同时使用 `routes` 和 `"use server"` 服务端函数，`createApp()` 会同时处理两者。路由处理器优先挂载；RPC dispatcher 处理从 `server.basePath` 派生出来的 runtime path，例如 `/__evjs/fn`。

:::
