# 服务端路由

服务端路由让你完全掌控 HTTP 方法、请求头和标准 Web `Request`/`Response` 对象 —— 不同于使用自动 RPC 的服务端函数。

## 基本用法

使用 `@evjs/server` 的 `createRoute(path, definition)` 定义路由：

:::important
**路由路径必须是字符串字面量。** `path` 参数只接受字符串字面量类型——传入 `string` 类型的变量或模板字符串会产生 TypeScript 编译错误。这是通过类型系统强制执行的，以确保路由可被静态分析。

```ts
// ✅ 正确 — 字符串字面量
createRoute("/api/users", { ... });

// ❌ 编译错误 — 宽泛的 `string` 类型
const p: string = "/api/users";
createRoute(p, { ... });
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

使用 Hono 的 `:param` 语法定义路径参数：

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

使用 `middleware` 选项在处理器之前运行逻辑。调用 `next()` 继续或返回 `Response` 短路：

```ts
import { createRoute } from "@evjs/server";

const requireAuth = async (req, next) => {
  const auth = req.headers.get("Authorization");
  if (!auth) return Response.json({ error: "未授权" }, { status: 401 });
  return next();
};

export const protectedRoute = createRoute("/api/protected", {
  middleware: [requireAuth],
  GET: async () => Response.json({ secret: "data" }),
});
```

## 挂载路由

在服务端入口中将路由处理器提供给 `createApp()`：

```ts
// src/server.ts
import { createApp } from "@evjs/server";
import { postsRoute, postDetailsRoute } from "./api/posts.routes";

export const app = createApp({
  routeHandlers: [postsRoute, postDetailsRoute],
});
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

如果你同时使用 `routeHandlers` 和 `"use server"` 服务端函数，`createApp()` 会同时处理**两者**。路由处理器优先挂载；RPC 回退处理 `/api/fn` 的请求。

:::
