# 服务端函数

服务端函数让你在应用代码旁编写后端逻辑，并通过带类型的异步边界调用。evjs 负责端点
与客户端调用的连接。建议使用 `.server.ts` 后缀，让人和工具都能清楚识别边界。

## 基本用法

```ts
// src/apis/users.server.ts
"use server";

export async function getUsers() {
  return await db.users.findMany();
}

export async function createUser(name: string, email: string) {
  return await db.users.create({ data: { name, email } });
}

export const deleteUser = async (id: string) => {
  return await db.users.delete({ where: { id } });
};
```

### 规则

- 文件必须以 `"use server";` 指令开头
- 格式错误的 `"use server"` 模块会在构建器运行前报错；如果能确定源码位置，evjs 会
  同时给出文件路径和解析错误。
- 只有 **命名的可调用导出** 会被转换：`export function`、
  `export async function`、`export const name = () => {}`、
  `export const name = async () => {}`，或
  `export { saveUser as updateUser }` 这类同模块别名
- `"use server"` 模块必须至少导出一个命名服务端函数。如果模块只导出类型或本地
  辅助函数，请移除该指令，或导出可调用函数。
- 服务端函数可以返回普通值或 Promise；运行时都会等待并返回结果。生成器和异步生成器
  不受支持，因为它们返回迭代器，而不是单次调用结果。
- 返回值和结构化的 `ServerError.data` 必须可以 JSON 序列化。返回
  `undefined` 是允许的，客户端代码会解析为 `undefined`；原始 HTTP 响应则返回空的
  成功响应体。
- 调用始终异步跨越客户端与服务端边界。不要尝试传递闭包引用、类实例、DOM 对象、流或
  其他不可序列化的值，也不要依赖同步副作用。
- 导出别名可以使用标识符或字符串字面量名称，但本地绑定必须是函数声明，
  或初始化为函数的 `const`。字符串字面量别名不能为空，也不能带首尾空白。
  普通 TypeScript 导入推荐使用标识符名称。
- `export type { UserInput }` 这类仅类型导出会被运行时转换忽略，可以和服务端函数放在
  同一个模块中。
- 环境 `declare` 导出不会产生运行时实现，因此不是服务端函数。每个导出的服务端函数
  都必须有真实函数体。
- **推荐**：使用 `.server.ts` 或 `.server.tsx` 文件名（例如 `users.server.ts`），让人和
  工具都能识别服务端专用文件。服务端函数没有目录约定。
- 不支持默认导出、从其他模块重新导出运行时函数，也不支持导出常量等非函数运行时值。
- 被应用代码、页面、API 路由或服务端中间件引用的 `"use server"` 模块，会变成可从
  浏览器调用的服务端函数；没有被引用的文件会被忽略。

## 请求上下文辅助函数

服务端函数运行在框架请求生命周期内，因此可以使用 `@evjs/ev/server-context` 导出的
请求上下文辅助函数：

```ts
// src/apis/session.server.ts
"use server";

import { getCookie, headers, request, waitUntil } from "@evjs/ev/server-context";

export async function currentSession() {
  const req = request();
  const locale = headers().get("accept-language");
  const session = getCookie("session");

  waitUntil(auditSessionAccess(req.url));

  return { locale, hasSession: Boolean(session) };
}
```

这些辅助函数只在 evjs 正在处理服务端函数、路由处理器、中间件、SSR 渲染、RSC Flight
请求或 PPR 区域请求时可用。在模块顶层、构建阶段或客户端代码中调用会抛出错误：

```text
[evjs] Server context helpers (request(), headers(), cookie helpers, waitUntil()) must be called during a request lifecycle. Call them inside a server function, route handler, middleware, or framework render.
```

## 查询模式

evjs 提供类型安全的 `useQuery` 和 `useSuspenseQuery`，可直接接受服务端函数。加载器、
预取或变更操作需要复用查询键时，使用配套的缓存辅助函数。

### 直接使用（推荐）

```tsx
import {
  useQuery,
  useSuspenseQuery,
  useMutation,
  useQueryClient,
  getFnQueryKey,
  getFnQueryOptions,
} from "@evjs/ev/query";
import { getUsers, getUser, createUser } from "../apis/users.server";

// 查询 —— 直接传入服务端函数，类型自动推导
const { data: users } = useQuery(getUsers);               // data: User[]
const { data: user } = useQuery(getUser, userId);          // data: User
const { data } = useSuspenseQuery(getUsers);               // data: User[]（保证有值）

// 变更 —— 直接传入服务端函数，与 useQuery 用法一致
const queryClient = useQueryClient();
const { mutate } = useMutation(createUser, {
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: getFnQueryKey(getUsers) });
  },
});

// 路由加载器 / 预取 —— 使用 getFnQueryOptions()
loader: ({ context }) =>
  context.queryClient.ensureQueryData(getFnQueryOptions(getUsers));
```

这些函数重载要求传入编译后的服务端函数引用。把普通异步函数传给 `useQuery(fn)`、
`useSuspenseQuery(fn)`、`useMutation(fn)`、`getFnQueryKey(fn)` 或
`getFnQueryOptions(fn)` 时，会抛出带 `[evjs]` 前缀并指出被拒绝函数名称的诊断。
普通函数请使用 TanStack 的对象形式，例如
`useQuery({ queryKey, queryFn })`。

### 缓存辅助函数

使用 `getFnQueryKey()` 和 `getFnQueryOptions()`，不要读取服务端函数内部字段：

```ts
getFnQueryKey(getUsers);
getFnQueryKey(getUser, userId);
getFnQueryOptions(getUsers);
```

- **`getFnQueryKey(fn, ...args)`** — 构建 TanStack Query 查询键，用于 `invalidateQueries`、`setQueryData` 等。
- **`getFnQueryOptions(fn, ...args)`** — 返回 `{ queryKey, queryFn }`，用于加载器、预取和 `useInfiniteQuery`。

### 变更操作参数

```tsx
// 无参数：直接调用 mutate()
mutate();

// 单参数：直接传值；参数本身是数组时也直接传数组
mutate({ name: "Alice", email: "alice@example.com" });
mutate(["admin", "editor"]);

// 多参数：传入长度完全匹配的元组
mutate(["Alice", "alice@example.com"]);
```

对于固定签名，evjs 会按参数数量序列化变更参数：

```ts
export async function refresh() {}
export async function saveRoles(roles: string[]) {}
export async function createUser(name: string, email: string) {}
```

灵活签名会使用兼容形式的参数结构：

```ts
export async function search(query: string, options = {}) {}
export async function maybeUser(id?: string) {}
export const saveTags = async (...tags: string[]) => {};
```

对于灵活签名，不传变量会变成 `[]`，数组变量会被当作完整参数列表，非数组变量会变成
一个参数。如果数组本身应该作为一个参数，请声明一个必填参数，例如上面的 `saveRoles()`。

调用 `useMutation(serverFn, options)` 时不要提供 `mutationFn`；evjs 会从服务端函数
推导它，并保留服务端函数的参数序列化信息。标准 TanStack
`useMutation({ mutationFn })` 对象形式会直接传给 TanStack，也可以接收可调用的
服务端函数代理，但不会使用上述函数重载的多参数处理规则。

### 使用 `fetch` 或普通函数

普通函数使用标准 TanStack Query API：

```tsx
const { data } = useQuery({
  queryKey: ["github-user", username],
  queryFn: () =>
    fetch(`https://api.github.com/users/${username}`).then((r) => r.json()),
});
```

## 传输配置

### HTTP（默认）

```tsx
import { initTransport } from "@evjs/ev/transport";
initTransport({
  // 可选，默认使用当前页面来源。
  baseUrl: "https://api.example.com",
  // 跨域调用服务端函数时携带 cookie。
  credentials: "include",
  headers: { "x-app": "my-app" },
});
```

`baseUrl`、`credentials` 和 `headers` 用于配置内置 HTTP 适配器。通常只有服务端运行时
部署在另一个来源时，应用代码才需要配置 `baseUrl`：

- `baseUrl`：服务端运行时调用使用的绝对 HTTP(S) 来源或基础 URL，不能包含首尾空白字符。
- `credentials`：Fetch 凭据策略，例如 `"include"`。
- `headers`：静态请求头，或每次调用时求值的函数。
  内置适配器会固定使用 `Content-Type: application/json`；该选项用于追加认证、追踪或
  CSRF 令牌等请求头。

对于 evjs 构建，如果浏览器需要访问另一个来源上的服务端运行时，
优先在 `ev.config.ts` 中配置 `transport.baseUrl`。这个值会被浏览器发起的请求共享，
例如服务端函数与 RSC Flight 请求。
共享同一个 JavaScript 运行环境的 evjs 应用必须使用相同的框架传输配置。
如果这些应用需要主动共用另一套传输方式，请只调用一次 `initTransport()` 并传入
应用共同持有的配置；显式调用的优先级高于内嵌的框架配置。

Fetch `mode` 不提供配置。服务端函数请求使用浏览器默认 CORS 行为；跨域 Cookie 应通过
`credentials` 和服务端 CORS 响应头配合控制。

内置适配器处理 JSON 请求和响应。网络错误和服务端结构化错误会以
`ServerFunctionError` 暴露给客户端。

### 自定义适配器（如 WebSocket）

实现 `TransportAdapter` 以使用自定义协议：

```tsx
import { initTransport } from "@evjs/ev/transport";
import type { TransportAdapter } from "@evjs/ev/transport";

const wsAdapter: TransportAdapter = {
  send: async (fnId, args) => {
    // 在这里实现你的 WebSocket 或自定义协议
  },
};

initTransport({ adapter: wsAdapter });
```

自定义适配器自行管理协议配置。传给 `send(fnId, args, context)` 的可选
`context` 只包含单次调用级别的 `signal` 值。

### 服务端配置

```ts
// ev.config.ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  server: {
    basePath: "/__evjs", // 服务端函数使用 /__evjs/fn
  },
});
```

## 错误处理

### 服务端

抛出带状态码和数据的结构化错误：

```ts
import { ServerError } from "@evjs/ev/server-context";

export async function getUser(id: string) {
  const user = await db.users.findById(id);
  if (!user) {
    throw new ServerError("用户未找到", {
      status: 404,
      data: { id },
    });
  }
  return user;
}
```

### 客户端

捕获类型化错误：

```tsx
import { ServerFunctionError } from "@evjs/ev/transport";

try {
  const user = await getUser("123");
} catch (e) {
  if (e instanceof ServerFunctionError) {
    console.log(e.message);  // "用户未找到"
    console.log(e.status);   // 404
    console.log(e.data);     // { id: "123" }
  }
}
```

## 哪些导出会成为服务端函数

执行 `ev dev` 和 `ev build` 时，evjs 会校验应用导入的 `"use server"` 模块，并让其中
的命名函数可以被调用。应用不需要手写端点或客户端代理。

不支持的导出会在构建器运行前报错。例如
`export default`、`export const VERSION = "1"` 和
`export declare function getUser()` 都不是合法的服务端函数。
`export { getUser } from "./other"` 这类跨模块重新导出同样不受支持。

只有被应用代码导入的模块才会被包含。如果某个服务端函数不应进入应用，请移除对应导入。

## 使用总结

| 模式 | 用法 |
|------|------|
| 查询 | `useQuery(fn, ...args)` |
| Suspense 查询 | `useSuspenseQuery(fn, ...args)` |
| 变更 | `useMutation(fn)` 或 `useMutation(fn, { onSuccess })` |
| 缓存失效 | `getFnQueryKey(fn, ...args)` |
| 加载器 / 预取 | `getFnQueryOptions(fn, ...args)` → `{ queryKey, queryFn }` |
| 参数传递 | 展开传入：`useQuery(getUser, id)` 而不是 `useQuery(getUser, [id])` |
| 服务端错误 | 服务端 `ServerError` → 客户端 `ServerFunctionError` |
