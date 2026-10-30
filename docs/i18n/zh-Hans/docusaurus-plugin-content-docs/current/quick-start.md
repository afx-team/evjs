# 快速开始

创建一个包含两个页面、一个服务端函数和一个 API 路由的小应用。

## 创建项目

```bash
npx @evjs/create-app my-app
cd my-app
npm install
npm run dev
```

打开开发服务器输出的浏览器地址。

## 选择 SPA 或 MPA

创建 `ev.config.ts`：

```ts title="ev.config.ts"
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

需要客户端导航、嵌套路由和动态路径时使用 `"spa"`。每个页面都是静态路径并应作为独立 HTML 文档加载时，使用 `"mpa"`。

## 添加页面

创建下面的目录：

```text
src/pages/
├── page.tsx                         # /
└── about/
    └── page.tsx                     # /about
```

```tsx title="src/pages/page.tsx"
import { Link } from "@evjs/ev/navigation";

export default function HomePage() {
  return (
    <main>
      <h1>Home</h1>
      <Link to="/about">About this app</Link>
    </main>
  );
}
```

```tsx title="src/pages/about/page.tsx"
export default function AboutPage() {
  return <h1>About</h1>;
}
```

`page.*` 是创建页面的明确标记。所在目录决定 URL，因此不需要再维护一份路由表。

## 配置单个页面

在相邻 `page.config.ts` 中添加静态元信息或选择渲染方式：

```ts title="src/pages/about/page.config.ts"
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "About",
  meta: {
    description: "About this application",
  },
  render: "csr",
});
```

这个文件是可选的，CSR 是默认值。选择 SSR、SSG、PPR 或 RSC 前，请先阅读[渲染](./rendering)。

## 就近组织页面代码

页面旁边的文件都是普通源码，除非它们匹配另一项框架文件约定：

```text
src/pages/about/
├── page.tsx
├── page.config.ts
├── model.ts
├── about.css
└── components/
    └── Team.tsx
```

组件、Hook 函数、模型、测试、样式和资源都不需要 `_` 前缀。

## 添加动态路由

SPA 项目可以使用 `$param` 目录：

```text
src/pages/users/$userId/page.tsx     # /users/:userId
```

```tsx title="src/pages/users/$userId/page.tsx"
import { usePageParams } from "@evjs/ev/route";

export default function UserPage() {
  const { userId } = usePageParams();
  return <h1>User {userId}</h1>;
}
```

使用终止 `$...splat` 表示通配路径，使用 `(group)` 组织路由但不增加 URL 段。MPA 项目只接受静态页面路径。

## 调用服务端代码

创建一个会被应用引用、且以 `"use server";` 开头的模块，并命名导出函数：

```ts title="src/pages/get-message.server.ts"
"use server";

export async function getMessage() {
  return "Hello from the server";
}
```

在页面中使用查询辅助 API 调用：

```tsx title="src/pages/page.tsx"
import { useQuery } from "@evjs/ev/query";
import { getMessage } from "./get-message.server";

export default function HomePage() {
  const { data } = useQuery(getMessage);
  return <h1>{data}</h1>;
}
```

## 添加 HTTP 端点

在 `src/apis` 下创建 `api.*` 文件并导出大写 HTTP 方法：

```ts title="src/apis/health/api.ts"
export function GET() {
  return Response.json({ ok: true });
}
```

端点地址为 `/health`。API 路由使用标准 Web `Request` 和 `Response`。参数和中间件见 [API 路由与中间件](./server-routes)。

## 检查项目并构建

生产构建前，检查路由和渲染选择：

```bash
ev inspect
npm run build
```

浏览器产物默认写入 `dist/client`。使用服务端函数、API 路由或请求时渲染的应用还会生成 `dist/server`。

把 `.ev`、`dist`、`src/route-types.d.ts` 和 `src/plugin-types.d.ts` 当作生成产物，不要编辑或复制进应用模板。

## 接下来

- [项目结构](./project-structure)：各目录的职责和框架识别的文件。
- [页面与路由](./client-routes)：布局、嵌套路由与导航。
- [本地开发](./dev)：端口、代理与 HTTPS。
- [部署](./deploy)：了解不同部署方式。
