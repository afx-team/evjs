# 快速开始

## 创建项目

```bash
npx @evjs/create-app my-app
cd my-app
npm install
npm run dev
```

开发服务器会输出实际使用的浏览器和 server URL。

## 定义应用

创建 `ev.config.ts` 并选择输出 mode：

```ts
import { defineConfig } from "@evjs/ev";

export default defineConfig({
  routing: {
    mode: "spa",
  },
});
```

创建两个 Page route：

```text
src/pages/
├── page.tsx                         # /
└── about/
    └── page.tsx                     # /about
```

```tsx
// src/pages/page.tsx
import { Link } from "@evjs/ev/navigation";

export default function HomePage() {
  return (
    <main>
      <h1>Home</h1>
      <Link to="/about">About</Link>
    </main>
  );
}
```

```tsx
// src/pages/about/page.tsx
export default function AboutPage() {
  return <h1>About</h1>;
}
```

`page.*` 是 Page 与 Route 锚点。相对目录决定 URL，不需要单独的 route 声明。

Page 需要构建期能力时，在旁边添加 `page.config.ts`：

```ts
import { definePageConfig } from "@evjs/ev";

export default definePageConfig({
  title: "关于",
  meta: {
    description: "应用介绍",
    keywords: "evjs,关于",
    viewport: "width=device-width, initial-scale=1",
    "theme-color": "#ffffff",
  },
  render: "csr",
});
```

`title` 与 `meta` 是静态 core Page 元信息；`meta` 只生成
`<meta name="..." content="...">`。插件持有的值使用 `extensions` 下已注册
namespaced key，这些 extension 值不会自动发送到浏览器 runtime。

## Page 私有代码

组件、hook、model、service、测试、样式和 asset 都可以放在 Page 目录：

```text
src/pages/about/
├── page.tsx
├── page.config.ts
├── index.ts
├── model.ts
├── use-about.ts
└── components/
    └── Team.tsx
```

只有 `page.*` 创建 Page 与 Route。包括 `index.*` 在内的其他文件都是普通私有
源码，不需要 `_` 前缀。

## 添加动态路由

使用 `$param` 目录：

```text
src/pages/
└── users/
    └── $userId/
        └── page.tsx                 # /users/:userId
```

```tsx
// src/pages/users/$userId/page.tsx
import { usePageParams } from "@evjs/ev/route";

export default function UserDetailPage() {
  const { userId } = usePageParams();
  return <h1>User {userId}</h1>;
}
```

静态目录创建静态 URL segment；终止 `$...splat` 目录创建 catch-all；
`(group)` 可以组织路由而不增加 URL segment。

## 切换到 MPA

Page 文件树无需移动，只改变物化 mode：

```ts
export default defineConfig({
  routing: {
    mode: "mpa",
  },
});
```

SPA 把文件树物化为浏览器 Client Route，通常共享一个 Document。MPA 从相同
语义 Page 与 Route 出发，物化 Page-owned Document。同一 Page 目录的
`index.html` 可以提供 MPA Document 模板。MPA 当前只接受静态 Page path：
`$param`、终止 `$...splat` 与 router-only boundary 会在 inspect/build 中失败；
layout 在两种 mode 中都会组合。

## 添加服务端函数

Server function 可以放在调用它的 Page 旁边：

```ts
// src/pages/get-message.server.ts
"use server";

export async function getMessage() {
  return "Hello from the server";
}
```

```tsx
// src/pages/page.tsx
import { useQuery } from "@evjs/ev/query";
import { getMessage } from "./get-message.server";

export default function HomePage() {
  const { data } = useQuery(getMessage);
  return <h1>{data}</h1>;
}
```

## 添加服务端路由

Server request Route 使用 `src/apis` 下独立的 positive `api.*` 锚点：

```ts
// src/apis/api/health/api.ts
export function GET() {
  return Response.json({ ok: true });
}
```

完整所在目录 `api/health` 创建 `/api/health`。客户端 `page.*` route 与 server
request Route 是使用对称 positive anchor 的独立系统。

## 构建

```bash
npm run build
```

默认：

- client output 写入 `dist/client`；
- server output 写入 `dist/server`；
- framework IR 位于 `.ev`。

`.ev`、`dist`、`src/route-types.d.ts` 等都应视为生成物，不要编辑或复制到模板。

## 核心包

| 包 | 用途 |
| --- | --- |
| `@evjs/cli` | `ev dev`、`ev build`、`ev inspect` 等命令 |
| `@evjs/ev` | 配置、插件、build graph、部署 helper 与应用 subpath |
| `@evjs/ev/route` | Page params、search 与 loader-data helper |
| `@evjs/ev/navigation` | `Link`、导航、重定向和 outlet |
| `@evjs/ev/query` | Server-function query 与 mutation helper |
| `@evjs/ev/server-context` | Request-context helper |
| `@evjs/ev/transport` | 自定义 client/server transport helper |
| `@evjs/client` | Standalone 浏览器 runtime primitive |
| `@evjs/server` | Standalone server runtime primitive |

框架持有的 Page 应用从 `@evjs/ev` 及其 curated subpath 导入。只有明确的
standalone/manual runtime composition 才直接使用 `@evjs/client` 和
`@evjs/server`。

## 选择一种路由输入

使用文件约定时，每个公开 Page 位于其 URL 对应目录，entry 命名为 `page.*`，Page
设置放在相邻 `page.config.ts`，并声明 `routing.mode: "spa" | "mpa"`。

显式 `application.routes` 是独立、仅支持 SPA 的配置输入。它支持 `page` 或
`component`、嵌套 `routes`、layout、wrapper、redirect 与已注册的 namespaced
Route extension；不能与 `routing` 同时配置，也不会选择 MPA。

无关的 `src/pages` 目录本身不会发布客户端路由。运行 `ev inspect` 可确认
normalized Page/Route 结构。

接下来阅读[项目结构](./project-structure)、[客户端路由](./client-routes)和
[配置](./config)。
