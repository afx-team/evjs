# 服务端函数

服务端函数允许你在与前端代码同源的地方编写后端逻辑，并在 React 组件中获得类似本地
async 函数调用的体验，但它本质上仍是类型安全的服务端边界。框架会序列化参数，
通过服务端运行时分发请求，并返回序列化后的结果或结构化错误。虽然我们不强制要求，
但建议将服务端函数文件以 `.server.ts` 结尾。构建系统会自动将它们转换为 RPC 调用。

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
- 格式错误的 `"use server"` 模块会在 bundler 运行前报错；evjs 能解析文件路径时，
  会同时给出文件路径和 parser message。
- 只有 **命名的可调用导出** 会被转换：`export function`、
  `export async function`、`export const name = () => {}`、
  `export const name = async () => {}`，或
  `export { saveUser as updateUser }` 这类同模块别名
- `"use server"` 模块必须至少导出一个命名 server function。如果模块只导出类型或
  本地 helper，请移除该指令，或导出可调用函数。
- Server function 可以返回普通值或 Promise；runtime 都会等待并返回结果。
  Generator 和 async-generator function 不受支持，因为它们返回 iterator，
  不是单个 transport 结果。
- 返回值和结构化的 `ServerError.data` 必须可以 JSON 序列化。返回
  `undefined` 是允许的，客户端代码会解析为 `undefined`；原始 HTTP 响应会序列化为空的成功 payload。
- 调用始终是异步的服务端边界调用。不要依赖 closure identity、同步副作用、
  class instance、DOM object、stream 或其他不可序列化引用跨越该边界。
- 导出别名可以使用 identifier 或字符串字面量名称，但本地绑定必须是函数声明，
  或初始化为函数的 `const`。字符串字面量别名不能为空，也不能带首尾空白。
  普通 TypeScript import 推荐使用 identifier 名称。
- `export type { UserInput }` 这类 type-only export 会被 runtime transform
  忽略，可以和 server function 放在同一个模块中。
- Ambient `declare` 导出不会产生运行时实现，因此不是 server function。
  每个导出的 server function 都必须有真实函数体。
- **推荐**：使用 `.server.ts` 或 `.server.tsx` 文件名（例如 `users.server.ts`），
  让路由发现忽略就近放置的 server-only 文件。Server functions 没有目录约定。
- 不支持默认导出、跨模块 runtime re-export，也不支持导出常量等非函数 runtime 值
- 可达的 `"use server"` 模块会变成可从浏览器调用的服务端函数。"可达" 指由 app
  代码、页面模块、服务端文件路由或服务端中间件导入；无关文件会被忽略。

## 请求上下文 helper

Server function 运行在框架请求生命周期内，因此可以使用 `@evjs/ev/server-context`
导出的请求 helper：

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

这些 helper 只在 evjs 正在处理 server function、route handler、middleware、SSR
render、RSC Flight 请求或 PPR region 请求时可用。在模块顶层、构建阶段或客户端代码中调用会抛出：

```text
[evjs] Server context helpers (request(), headers(), cookie helpers, waitUntil()) must be called during a request lifecycle. Call them inside a server function, route handler, middleware, or framework render.
```

## 查询模式

evjs 提供类型安全的 `useQuery` 和 `useSuspenseQuery`，可直接接受服务端函数。加载器、
预取或变更需要复用 query key 时，使用配套 cache helper。

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

函数重载要求传入编译后的 server function reference。把普通 async function 传给 `useQuery(fn)`、
`useSuspenseQuery(fn)`、`useMutation(fn)`、`getFnQueryKey(fn)` 或
`getFnQueryOptions(fn)` 时，会抛出带 `[evjs]` 前缀并指出被拒绝函数名称的诊断。
非 server function 请使用 TanStack object 形式，例如
`useQuery({ queryKey, queryFn })`。

### 缓存 helper

使用 `getFnQueryKey()` 和 `getFnQueryOptions()`，不要读取服务端函数内部字段：

```ts
getFnQueryKey(getUsers);
getFnQueryKey(getUser, userId);
getFnQueryOptions(getUsers);
```

- **`getFnQueryKey(fn, ...args)`** — 构建 TanStack Query key。用于 `invalidateQueries`、`setQueryData` 等。
- **`getFnQueryOptions(fn, ...args)`** — 返回 `{ queryKey, queryFn }`，用于加载器、预取和 `useInfiniteQuery`。

### 变更参数

```tsx
// 无参数：直接调用 mutate()
mutate();

// 单参数：直接传值；参数本身是数组时也直接传数组
mutate({ name: "Alice", email: "alice@example.com" });
mutate(["admin", "editor"]);

// 多参数：传入长度精确匹配的 tuple
mutate(["Alice", "alice@example.com"]);
```

固定签名下，evjs 可以按参数数量序列化 mutation variables：

```ts
export async function refresh() {}
export async function saveRoles(roles: string[]) {}
export async function createUser(name: string, email: string) {}
```

灵活签名会使用 fallback 参数形状：

```ts
export async function search(query: string, options = {}) {}
export async function maybeUser(id?: string) {}
export const saveTags = async (...tags: string[]) => {};
```

对于灵活签名，不传变量会变成 `[]`，数组变量会被当作完整参数列表，非数组变量会变成
一个参数。如果数组本身应该作为一个参数，请声明一个必填参数，例如上面的 `saveRoles()`。

调用 `useMutation(serverFn, options)` 时不要提供 `mutationFn`；evjs 会从服务端函数
推导它。只有非服务端函数才使用标准 TanStack 的 `useMutation({ mutationFn })`
对象形式。

## 传输配置

### HTTP（默认）

```tsx
import { initTransport } from "@evjs/ev/transport";
initTransport({
  // 可选，默认使用当前页面 origin。
  baseUrl: "https://api.example.com",
  // 跨域调用服务端函数时携带 cookie。
  credentials: "include",
  headers: { "x-app": "my-app" },
});
```

`baseUrl`、`credentials` 和 `headers` 用于配置内置 HTTP 适配器。通常只有服务端运行时
部署在另一个 origin 时，应用代码才需要配置 `baseUrl`：

- `baseUrl`：服务端运行时调用的 absolute HTTP(S) origin 或 base URL；不能包含首尾空白字符。
- `credentials`：fetch credentials 策略，例如 `"include"`。
- `headers`：静态请求头，或每次调用时求值的函数。
  内置 adapter 会固定使用 `Content-Type: application/json`；该选项用于追加
  auth、tracing 或 CSRF token 等请求头。

对于 evjs 构建，如果浏览器需要访问另一个 origin 上的服务端运行时，
优先在 `ev.config.ts` 中配置 `transport.baseUrl`。这个值会被浏览器发起的请求共享，
例如 server functions、RSC Flight，以及面向 server routes 的客户端 helper。

Fetch `mode` 不提供配置。服务端函数请求使用浏览器默认 CORS 行为；跨域
cookie 应通过 `credentials` 和服务端 CORS 响应头配合控制。

内置 adapter 管理 JSON 请求和响应细节。网络错误和服务端结构化错误会以
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
`context` 只包含单次调用级别的值，目前是 `signal`。

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

## 构建行为

执行 `ev dev` 和 `ev build` 时，evjs 会找到可达的 `"use server"` 模块、校验导出，
并让这些函数可以从浏览器代码调用。应用不需要手写 endpoint、client proxy 或服务端注册代码。

不支持的导出会在 bundler 运行前报错。例如
`export default`、`export const VERSION = "1"` 和
`export declare function getUser()` 都不是合法 server function。
`export { getUser } from "./other"` 这类 runtime re-export 同样不受支持。

可达的 server module 会进入当前应用的服务端运行时。如果某个 server function 不应该属于当前应用，
请移除对应 import。

## 要点总结

| 模式 | 用法 |
|------|------|
| 查询 | `useQuery(fn, ...args)` |
| Suspense 查询 | `useSuspenseQuery(fn, ...args)` |
| 变更 | `useMutation(fn)` 或 `useMutation(fn, { onSuccess })` |
| 缓存失效 | `getFnQueryKey(fn, ...args)` |
| 加载器 / 预取 | `getFnQueryOptions(fn, ...args)` → `{ queryKey, queryFn }` |
| 参数传递 | 展开传入：`useQuery(getUser, id)` 而不是 `useQuery(getUser, [id])` |
| 服务端错误 | 服务端 `ServerError` → 客户端 `ServerFunctionError` |
