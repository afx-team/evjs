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

## 在浏览器中调用应用内 API

从框架根包导入 `api`，传入完整应用路径。客户端不会补 `/api`，页面路由的
`basepath` 不参与 API 地址计算。

```ts
import { api } from "@evjs/ev";
import type { CreateTaskInput, CreateTaskResult } from "@/shared/task";

const input: CreateTaskInput = { title: "运行测试" };
const task = await api.post("/api/tasks", { json: input }).json<CreateTaskResult>();
```

DTO 放在普通模块中，例如 `src/shared/task.ts`，只定义一次：

```ts
export interface CreateTaskInput { title: string }
export interface CreateTaskResult { id: string; title: string; createdAt: string }
```

服务端业务函数通过 `import type` 引用同一组类型，标注入参和返回值，或在
`Response.json()` 前用 `satisfies` 检查结果。DTO 描述实际 JSON 数据，日期用字符串。
保留业务现有的运行时输入校验。`.json<T>()` 只提供编译期类型，不校验响应，也不绑定
URL 与 DTO。框架不生成 handler 类型、路由客户端或 schema。

`api` 提供 `get/post/put/patch/delete/head/options`。选项沿用 `RequestInit`，
方法由调用名称确定。`json` 负责序列化并默认设置 `Content-Type: application/json`，
与 `body` 互斥。

一次调用只发一个请求，返回附带 `.json<T = unknown>()` 的 `Promise<Response>`。
直接 `await` 保留 Fetch 语义，包括 HTTP 错误响应。`.json()` 对非成功 HTTP 状态或
非 JSON Content-Type 抛出 `ApiError`，可读取 `error.response`、`error.status` 和
`error.url`；这些检查不会消耗响应体。JSON 内容损坏保留原生解析错误，网络及取消
错误直接透传。

```ts
const controller = new AbortController();
const response = await api.post("/api/events", {
  json: { topic: "tasks" },
  signal: controller.signal,
});
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const reader = response.body?.getReader(); // 逐块读取 SSE
// controller.abort() 取消请求及响应流。
```

客户端不重试、不预读响应体。SSE、二进制、HEAD 或 204 空响应使用原始 `Response`。
响应体保留原生只能消费一次的语义，选择 `.json()` 或原始 reader 其中一种方式。

生成的运行时模块在业务模块执行前绑定所属应用和 build，因此支持模块顶层调用。
客户端保存部署配置快照，按“部署默认值 → 应用 transport 配置 → 单次请求选项”
合并，header 名称大小写不敏感。`baseUrl` 保留完整部署前缀再拼接业务路径，
例如 `https://gateway.example/app/v1` 加 `/health` 得到
`https://gateway.example/app/v1/health`。未配置 baseUrl 时使用本地同源路径。

根包客户端面向框架浏览器构建。SSR 中可以安全导入，但不支持在服务端调用。
独立客户端可使用 `@evjs/client/http-api` 的 `createApiClient()`。
升级框架不会改变原生 `fetch`；存量应用需明确替换应用内 API 调用点。

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

根据要编写的能力选择公共入口：

| 导入路径 | 导出 |
| --- | --- |
| `@evjs/ev/middleware` | `MiddlewareHandler`、`MiddlewareChain`、`requestLogger`、`RequestLoggerOptions` 和 `RequestLogEntry` |
| `@evjs/ev/api` | HTTP 方法处理器使用的 `withMiddlewares` 和 `RouteHandlerFn` |
| `@evjs/ev/server-context` | 请求、Cookie 和服务端函数错误辅助接口 |

按策略作用范围选择声明位置：

| 声明 | 作用范围 |
| --- | --- |
| `src/middlewares/middleware.*` | 所有服务端运行时请求，包括 API 路由、服务端函数、SSR、PPR 和 RSC |
| `api.*` 方法导出中的 `withMiddlewares(handler, middlewares)` | 仅该 HTTP 方法 |

全局入口默认导出一个兼容 Hono 的函数，或显式排序的非空数组。`src/middlewares` 中
只允许一种 `middleware.{ts,tsx,js,jsx}` 变体。禁止运行时命名导出，允许仅类型导出；
其他文件名都是普通源码模块。

```ts title="src/middlewares/middleware.ts"
import { type MiddlewareChain, requestLogger } from "@evjs/ev/middleware";
import tracing from "./tracing";

export default [requestLogger(), tracing] satisfies MiddlewareChain;
```

JavaScript 使用相同的数组，无需类型标注。通过展开数组复用链，例如
`[...shared, audit]`。禁止嵌套数组、数组空槽和非函数值。显式数组导出和方法链必须非空；
动态计算的全局链可以在禁用时返回 `[]`。重复列出的函数会重复执行。

导入的中间件和工厂返回值遵循相同规则。无效导出会阻止服务端启动，诊断信息会标明
来源模块，以及无效数组项从零开始的下标。注册后修改导出的数组不会改变已注册的链。

### 方法组合

使用 `withMiddlewares` 为导出的 HTTP 方法处理器组合该方法的策略：

```ts title="src/apis/api/posts/api.ts"
import { withMiddlewares } from "@evjs/ev/api";
import { createPost, listPosts } from "./handlers";
import { requireUser, validatePost } from "./policies";

export const GET = listPosts;
export const POST = withMiddlewares(createPost, [requireUser, validatePost]);
```

`withMiddlewares(handler, middlewares)` 返回一个可调用的 HTTP 方法处理器。
`handler` 参数使用 `(request, ctx) => Response | Promise<Response>` 签名；
`middlewares` 参数接受单个中间件或有序非空数组。

要让多个端点或 HTTP 方法共享策略，可导入同一条链，并在每个目标方法导出中显式组合。
策略链只作用于显式组合的位置。嵌套调用 `withMiddlewares` 时，外层链先执行。

单个中间件使用 `MiddlewareHandler<Env, Path, Input>`，有序链使用
`MiddlewareChain<Env, Path, Input>`，HTTP 方法处理器使用
`RouteHandlerFn<Path, Env, Input>`。这些类型描述 Hono 环境、路由参数和已校验输入。
`withMiddlewares` 从带类型的中间件推导处理器的上下文。使用 Hono `validator()` 等
泛型工厂时，先将结果赋给变量，再组合处理器：

```ts
import { withMiddlewares } from "@evjs/ev/api";
import { validator } from "hono/validator";

const validateBody = validator("json", (value) => ({
  title: String(value.title),
}));

export const POST = withMiddlewares(
  (_request, ctx) => ctx.json(ctx.req.valid("json")),
  validateBody,
);
```

共享上下文变量使用应用级 Hono `ContextVariableMap` 声明或显式环境类型。
中间件读取请求体时，使用 `ctx.req.json()` 并在处理器中复用同一份 Hono 请求体缓存，
或通过 `ctx.req.valid()`、上下文变量传递校验后的数据。原始 `Request` 的请求体流
只能读取一次。

### 执行顺序

请求按以下顺序进入：

```text
插件中间件 -> 应用全局中间件 -> 方法链 -> 处理器
```

插件贡献按 slot 顺序执行，数组从左到右执行；`await next()` 之后的代码按相反顺序退出。
所有层使用同一个 Hono 上下文。不调用 `next()` 并返回 `Response` 会提前结束请求。

```ts
import type { MiddlewareHandler } from "@evjs/ev/middleware";

const requireAuth: MiddlewareHandler = async (ctx, next) => {
  if (!ctx.req.header("authorization")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await next();
  ctx.header("x-authenticated", "true");
};

export default requireAuth;
```

方法中间件可通过 `ctx.req.param()` 读取解析后的路由参数。
`await next()` 之后，可用 `ctx.header()` 或 `ctx.res` 修改响应。方法中间件遵循
Hono 的错误处理行为：异常转成错误响应，中间件退出时可通过 `ctx.error` 读取错误。

从外部 Hono 应用直接调用组合处理器时，传播出调用的异常由宿主的错误边界处理。
需要观察这些错误响应的日志或响应头处理，应注册为宿主的原生中间件。

## HTTP 方法行为

匹配 API 路径后，全局中间件包裹所有响应。显式组合的策略链作用于对应的 HTTP 方法：

| 请求 | 方法链与响应 |
| --- | --- |
| 已声明的方法 | 该方法的链，再执行处理器 |
| 显式 `HEAD` | `HEAD` 链与处理器，最终移除响应体 |
| 只声明 `GET` 时的 `HEAD` | `GET` 链与处理器，最终移除响应体 |
| 自动 `OPTIONS` | 不执行方法链，返回 204 和 `Allow` |
| 不支持的方法 | 仅执行全局中间件，返回 405 和 `Allow` |
| 未匹配 API 路径 | 不执行方法链，继续框架的正常路由处理 |

显式 `OPTIONS` 导出执行自己的方法链。`Allow` 包含支持的显式及自动方法。
更具体的 API 路径拥有自己的 405 响应，不会继续匹配另一个 API 的方法处理器。

需要覆盖自动 `OPTIONS` 和 405 响应的策略应放在全局中间件中。全局鉴权也会执行于
`OPTIONS`；如果希望 CORS 直接响应预检，将它放在全局鉴权之前。方法中间件可以提前
结束由 `GET` 派生的 `HEAD`，最终响应始终没有响应体。
